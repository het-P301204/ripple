"""RIPPLE HTTP API (FastAPI). Localhost-only by default; serves the built dashboard when present."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from pathlib import Path, PurePosixPath
from typing import Any, Optional

from fastapi import Body, FastAPI, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from pydantic import ValidationError
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException

from ripple.config import DEFAULT_REGISTRIES, Settings, get_version, load_settings, parse_settings, save_settings
from ripple.models import ALL_CHECKS, Ecosystem, ScanOptions, ScanSource
from ripple.reports import EXTENSIONS, MEDIA_TYPES, render
from ripple.reports.common import slug
from ripple.security import clean_label, escape_controls, is_reserved_device_name

from . import store
from .jobs import JobManager, JobQueueFull

log = logging.getLogger("ripple.server")

STATIC_DIR = Path(__file__).parent / "static"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_FILES = 64
DEV_ORIGINS = ["http://localhost:5175", "http://127.0.0.1:5175"]
DEFAULT_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1", "testserver"}
EXPORT_FORMATS = ("json", "sarif", "csv", "html")

_OPTION_KEYS = {"checks", "ecosystem", "live", "max_edit_distance", "rate_limit_rps", "timeout_s", "cache_ttl_s",
                "internal_scopes"}

_STATUS_CODES = {400: "bad_request", 403: "forbidden", 404: "not_found", 405: "method_not_allowed",
                 413: "payload_too_large", 415: "unsupported_media_type", 422: "validation_error",
                 429: "too_many_requests"}

MAX_SETTINGS_BYTES = 256 * 1024          # PUT /api/settings body cap
MAX_STORED_SCANS = 500                   # server-created scans kept on disk (oldest pruned)
_HOST_RE = re.compile(r"^(?P<host>\[[0-9a-fA-F:.]+\]|[A-Za-z0-9._-]+)(?::(?P<port>\d{1,5}))?$")
_UNSAFE_METHODS = ("POST", "PUT", "DELETE", "PATCH")

# The API never serves anything renderable; the SPA needs its own scripts/styles/fonts and nothing else.
_API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
_SPA_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; "
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
# Exported HTML reports are attachments, but if one is ever opened inline it must stay inert.
_EXPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; sandbox"


class BodyTooLarge(Exception):
    """Kept for callers that want to signal an oversize body explicitly (mapped to HTTP 413)."""


class BodyLimitMiddleware:
    """Pure-ASGI request-body cap. Unlike a Content-Length check it also covers chunked uploads, and it stops
    reading (so nothing is spooled to disk) the moment the limit is crossed: the application then sees a client
    disconnect, whatever error it raises for that is replaced by a clean 413 response."""

    def __init__(self, app, max_bytes: int, path_limits: Optional[dict[str, int]] = None):
        self.app = app
        self.max_bytes = max_bytes
        self.path_limits = path_limits or {}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") in ("GET", "HEAD", "OPTIONS"):
            return await self.app(scope, receive, send)
        limit = self.path_limits.get(scope.get("path", ""), self.max_bytes)
        declared = next((v for k, v in scope.get("headers", []) if k == b"content-length"), b"")
        if declared.isdigit() and int(declared) > limit:
            return await self._reject(send, limit)
        received = 0
        exceeded = False
        started = False          # a response (ours or the app's) has begun

        async def limited_receive():
            nonlocal received, exceeded
            if exceeded:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True                   # stop consuming the stream immediately
                    return {"type": "http.disconnect"}
            return message

        async def tracking_send(message):
            nonlocal started
            if exceeded:                              # swallow whatever the app answers; we send the 413
                if not started:
                    started = True
                    await self._reject(send, limit)
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except BodyTooLarge:
            exceeded = True
        except Exception:
            if not exceeded:
                raise
        if exceeded and not started:
            await self._reject(send, limit)

    @staticmethod
    async def _reject(send, limit: int) -> None:
        body = json.dumps({"error": {"code": "payload_too_large",
                                     "message": f"Request exceeds the {max(limit // (1024 * 1024), 1)} MB limit."}}).encode()
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
                                (b"connection", b"close")]})
        await send({"type": "http.response.body", "body": body})


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


def safe_filename(name: Optional[str], fallback: str = "upload") -> str:
    """Basename only; no control/bidi characters, no NTFS stream (``:``) or device names; bounded length.

    Upload names are labels (never used as filesystem paths), but they flow into reports, SARIF URIs and
    terminal output, so they get the same treatment as any other attacker-supplied string.
    """
    base = PurePosixPath((name or "").replace("\\", "/")).name
    base = escape_controls(base)
    base = re.sub(r"[\\<>:\"|?*]", "", base).strip(" .")
    if is_reserved_device_name(base):
        base = "_" + base
    return base[:200] or fallback


async def read_uploads(request: Request, max_bytes: int) -> tuple[list[tuple[str, bytes]], Any]:
    """Parse multipart ``files`` / ``files[]`` with a hard total-size cap. Returns (files, form)."""
    ctype = request.headers.get("content-type", "")
    if "multipart/form-data" not in ctype.lower():
        raise ApiError(415, "unsupported_media_type", "Send the lockfiles as multipart/form-data (field 'files').")
    try:
        form = await request.form(max_files=MAX_FILES, max_fields=MAX_FILES)
    except BodyTooLarge:
        raise ApiError(413, "payload_too_large", f"Upload exceeds the {max_bytes // (1024 * 1024)} MB limit.") from None
    except Exception as exc:
        raise ApiError(400, "bad_request", "The upload could not be read.") from exc
    items = [v for k in ("files", "files[]") for v in form.getlist(k) if isinstance(v, UploadFile)]
    if not items:
        await form.close()
        raise ApiError(400, "no_files", "No files were uploaded. Attach at least one lockfile in the 'files' field.")
    if len(items) > MAX_FILES:
        await form.close()
        raise ApiError(400, "too_many_files", f"At most {MAX_FILES} files can be uploaded at once.")
    remaining = max_bytes
    out: list[tuple[str, bytes]] = []
    used: set[str] = set()
    try:
        for up in items:
            data = await up.read(remaining + 1)
            if len(data) > remaining:
                raise ApiError(413, "payload_too_large", f"Upload exceeds the {max_bytes // (1024 * 1024)} MB limit.")
            remaining -= len(data)
            name = safe_filename(up.filename)
            n = 1
            while name.lower() in used:      # same basename twice: keep both files distinct (and detectable)
                n += 1
                name = f"upload-{n}/{safe_filename(up.filename)}"
            used.add(name.lower())
            out.append((name, data))
    except BaseException:
        await form.close()
        raise
    return out, form


def _parse_options(raw: Optional[str], settings: Settings) -> tuple[ScanOptions, Optional[str]]:
    sc = settings.scanner
    base: dict[str, Any] = {
        "max_edit_distance": sc.max_edit_distance, "rate_limit_rps": sc.rate_limit_rps, "timeout_s": sc.timeout_s,
        "cache_ttl_s": sc.cache_ttl_s, "internal_scopes": list(sc.internal_scopes),
    }
    project: Optional[str] = None
    if raw:
        try:
            given = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ApiError(422, "validation_error", "'options' must be valid JSON.") from exc
        if not isinstance(given, dict):
            raise ApiError(422, "validation_error", "'options' must be a JSON object.")
        if isinstance(given.get("project"), str):
            project = clean_label(given["project"], 120) or None
        # registry_overrides is deliberately NOT accepted from API clients (SSRF guard): registries come
        # from persisted settings only.
        base.update({k: v for k, v in given.items() if k in _OPTION_KEYS and v is not None})
    try:
        opts = ScanOptions.model_validate(base)
    except ValidationError as exc:
        raise ApiError(422, "validation_error", "Invalid scan options: " + _fields(exc)) from exc
    bad_checks = [c for c in opts.checks if c not in ALL_CHECKS]
    if bad_checks or not opts.checks:
        raise ApiError(422, "validation_error", f"Invalid checks. Valid values: {', '.join(ALL_CHECKS)}.")
    if not 1 <= opts.max_edit_distance <= 3:
        raise ApiError(422, "validation_error", "max_edit_distance must be between 1 and 3.")
    if not 0 < opts.rate_limit_rps <= 50:
        raise ApiError(422, "validation_error", "rate_limit_rps must be between 0 and 50.")
    if not 0 < opts.timeout_s <= 120:
        raise ApiError(422, "validation_error", "timeout_s must be between 0 and 120.")
    if not 0 <= opts.cache_ttl_s <= 7 * 86400:
        raise ApiError(422, "validation_error", "cache_ttl_s must be between 0 and 604800.")
    opts.internal_scopes = [clean_label(s, 128) for s in opts.internal_scopes if isinstance(s, str) and s.strip()][:50]
    if opts.live:
        opts.registry_overrides = settings.registry_overrides()
    return opts, project


def _fields(exc: ValidationError) -> str:
    fields = sorted({".".join(str(p) for p in e.get("loc", ())) or "value" for e in exc.errors()})
    return ", ".join(fields)


def _detect_dict(info: Any, filename: str) -> dict:
    if not isinstance(info, dict):
        info = info.model_dump() if hasattr(info, "model_dump") else dict(vars(info))
    eco = info.get("ecosystem")
    return {
        "filename": info.get("filename", filename),
        "ecosystem": getattr(eco, "value", eco),
        "supported": bool(info.get("supported")),
        "kind": info.get("kind"),
        "dependency_count": info.get("dependency_count"),
        "error": info.get("error"),
    }


def _friendly_html(title: str, body: str) -> str:
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><style>
:root{{color-scheme:dark}}body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#090A0B;color:#E6E7EA;font:15px/1.6 system-ui,Segoe UI,sans-serif}}
main{{max-width:560px;padding:32px;background:#111316;border:1px solid rgba(255,255,255,.08);border-radius:20px}}
h1{{margin:0 0 8px;font-size:22px}}h1 b{{color:#A78BFA}}code{{background:#15171A;padding:2px 8px;border-radius:8px;font-family:ui-monospace,Consolas,monospace;font-size:13px;color:#F472B6}}
p{{color:#9CA3AF;margin:8px 0}}a{{color:#A78BFA}}</style></head><body><main>{body}</main></body></html>"""


def _static_file(static: Path, full_path: str) -> Optional[Path]:
    """Map a URL path to a file inside ``static`` or ``None``.

    Rejects anything that could leave the directory *before* touching the filesystem: backslashes and drive
    letters (a ``\\\\host\\share`` path would make Windows open an SMB connection just to resolve it), NTFS
    streams, device names, control characters and ``.`` / ``..`` / empty segments.
    """
    if any(ord(c) < 32 or c in '\\:*?"<>|' for c in full_path):
        return None
    parts = full_path.split("/")
    for part in parts:
        if part in ("", ".", "..") or part.endswith((".", " ")) or is_reserved_device_name(part):
            return None
    try:
        root = static.resolve()
        candidate = root.joinpath(*parts).resolve()
        if root in candidate.parents and candidate.is_file():
            return candidate
    except (OSError, ValueError):
        pass
    return None


def create_app(static_dir: Optional[Path] = None, jobs: Optional[JobManager] = None,
               extra_origins: Optional[list[str]] = None, max_upload_bytes: int = MAX_UPLOAD_BYTES,
               live: Optional[bool] = None) -> FastAPI:
    static = Path(static_dir) if static_dir is not None else STATIC_DIR
    manager = jobs or JobManager()
    server_live = live if live is not None else os.environ.get("RIPPLE_SERVER_LIVE") in ("1", "true", "yes")
    origins = DEV_ORIGINS + list(extra_origins or [])

    app = FastAPI(title="RIPPLE API", version=get_version(), docs_url=None, redoc_url=None, openapi_url=None)
    app.state.jobs = manager
    app.state.static_dir = static
    health_cache: dict[str, tuple[float, str]] = {}

    # -- security middleware ---------------------------------------------------------------------------
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                       allow_headers=["*"], allow_credentials=False, max_age=600)

    @app.middleware("http")
    async def guard(request: Request, call_next):
        # 1. DNS-rebinding defence: the Host header must be a loopback name (or explicitly allowed).
        allowed = os.environ.get("RIPPLE_ALLOWED_HOSTS", "")
        host_header = request.headers.get("host", "")
        m = _HOST_RE.match(host_header.strip())
        hostname = m.group("host").lower() if m else None
        if allowed.strip() != "*":
            extra = {h.strip().lower() for h in allowed.split(",") if h.strip()}
            if hostname is None or hostname not in DEFAULT_HOSTS | extra:
                return error_response(400, "invalid_host", "This host name is not allowed.")
        # 2. CSRF defence for state-changing requests: browsers always send Origin (and Sec-Fetch-Site) on
        #    cross-site POST/PUT/DELETE. A foreign or "null" Origin, or a cross-site fetch without Origin,
        #    is refused. Non-browser clients (curl, the CLI) send neither and are unaffected.
        if request.method in _UNSAFE_METHODS:
            origin = request.headers.get("origin")
            site = request.headers.get("sec-fetch-site", "").lower()
            if origin is not None:
                if origin not in origins and origin not in (f"http://{host_header}", f"https://{host_header}"):
                    return error_response(403, "forbidden_origin", "Cross-origin requests from this origin are not allowed.")
            elif site not in ("", "same-origin", "none"):
                return error_response(403, "forbidden_origin", "Cross-site requests are not allowed.")
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
            response.headers.setdefault("Content-Security-Policy", _API_CSP)
        else:
            response.headers.setdefault("Content-Security-Policy", _SPA_CSP)
        return response

    # Outermost: cap request bodies while they stream (covers chunked uploads that have no Content-Length).
    app.add_middleware(BodyLimitMiddleware, max_bytes=max_upload_bytes + 1024 * 1024,
                       path_limits={"/api/settings": MAX_SETTINGS_BYTES})

    # -- error handlers ----------------------------------------------------------------------------------
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return error_response(exc.status, exc.code, exc.message)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        code = _STATUS_CODES.get(exc.status_code, "error")
        msg = {404: "The requested resource was not found.", 405: "Method not allowed."}.get(
            exc.status_code, "The request could not be completed.")
        return error_response(exc.status_code, code, msg)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        fields = sorted({".".join(str(p) for p in e.get("loc", ()) if p != "body") or "request" for e in exc.errors()})
        return error_response(422, "validation_error", "Invalid request: " + ", ".join(fields))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("unhandled error on %s %s", request.method, escape_controls(request.url.path))   # no log forging
        return error_response(500, "internal", "Something went wrong on the server. Check the server log for details.")

    # -- API -----------------------------------------------------------------------------------------------
    def _registry_state(url: str) -> str:
        if not server_live:
            return "unchecked"
        cached = health_cache.get(url)
        if cached and time.time() - cached[0] < 60:
            return cached[1]
        state = "unreachable"
        try:
            from ripple.registries.base import probe  # the read-only client: GET only, same-host redirects, SSRF-checked

            state = "ok" if asyncio.run(probe(url)) else "unreachable"
        except Exception:
            state = "unreachable"
        health_cache[url] = (time.time(), state)
        return state

    @app.get("/api/health")
    def health():
        settings = load_settings()
        regs = {eco: {"url": settings.registries.get(eco, DEFAULT_REGISTRIES[eco]),
                      "state": _registry_state(settings.registries.get(eco, DEFAULT_REGISTRIES[eco]))}
                for eco in DEFAULT_REGISTRIES}
        return {"status": "ok", "version": get_version(), "mode": "live" if server_live else "offline",
                "registries": regs}

    @app.get("/api/demo")
    def demo():
        return JSONResponse(store.ensure_demo().model_dump(mode="json"))

    @app.post("/api/detect")
    async def detect_files(request: Request):
        files, form = await read_uploads(request, max_upload_bytes)
        await form.close()
        from ripple.engine import detect  # engine-owned

        results = []
        for name, data in files:
            try:
                info = await run_in_threadpool(detect, name, data)
                results.append(_detect_dict(info, name))
            except Exception as exc:  # detection must never take the endpoint down
                log.info("detect failed for %s: %s", name, type(exc).__name__)
                results.append({"filename": name, "ecosystem": None, "supported": False, "kind": None,
                                "dependency_count": None,
                                "error": "This file type is not supported or could not be read."})
        return results

    @app.post("/api/scans", status_code=202)
    async def create_scan(request: Request):
        files, form = await read_uploads(request, max_upload_bytes)
        raw_options = form.get("options")
        raw_options = raw_options if isinstance(raw_options, str) and len(raw_options) <= 64 * 1024 else None
        form_project = form.get("project")
        await form.close()
        settings = load_settings()
        options, project = _parse_options(raw_options, settings)
        if isinstance(form_project, str) and form_project.strip():
            project = clean_label(form_project, 120)
        from ripple.engine import ScanInput  # engine-owned

        inputs = [ScanInput(filename=n, content=d) for n, d in files]
        source = ScanSource(kind="file", files=[n for n, _ in files])
        try:
            job_id = manager.submit(inputs, options, project=project or "uploaded-project", source=source)
        except JobQueueFull:
            raise ApiError(429, "too_many_requests", "Too many scans are in progress. Wait for one to finish and retry.")
        return JSONResponse({"job_id": job_id}, status_code=202)

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        status = manager.get(job_id)
        if status is None:
            raise ApiError(404, "not_found", "Job not found. It may have expired.")
        return status.model_dump(mode="json")

    @app.get("/api/scans")
    def list_scans():
        return [e.model_dump(mode="json") for e in store.history()]

    @app.get("/api/scans/{scan_id}")
    def get_scan(scan_id: str):
        try:
            return JSONResponse(store.load(scan_id).model_dump(mode="json"))
        except store.ScanNotFound:
            raise ApiError(404, "not_found", "Scan not found.")

    @app.delete("/api/scans/{scan_id}", status_code=204)
    def delete_scan(scan_id: str):
        try:
            removed = store.delete(scan_id)
        except store.ScanNotFound:
            removed = False
        if not removed:
            raise ApiError(404, "not_found", "Scan not found.")
        return Response(status_code=204)

    @app.get("/api/scans/{scan_id}/export")
    def export_scan(scan_id: str, format: str = Query("json")):
        fmt = format.lower()
        if fmt not in EXPORT_FORMATS:
            raise ApiError(422, "validation_error", f"Unsupported format. Choose one of: {', '.join(EXPORT_FORMATS)}.")
        try:
            result = store.load(scan_id)
        except store.ScanNotFound:
            raise ApiError(404, "not_found", "Scan not found.")
        body = render(result, fmt)
        filename = f"ripple-{slug(result.project)}-{slug(result.id)}.{EXTENSIONS[fmt]}"
        return Response(content=body.encode("utf-8"), media_type=MEDIA_TYPES[fmt],
                        headers={"Content-Disposition": f'attachment; filename="{filename}"',
                                 "Content-Security-Policy": _EXPORT_CSP})

    @app.get("/api/settings")
    def get_settings():
        return load_settings().to_public()

    @app.put("/api/settings")
    def put_settings(payload: Any = Body(...)):
        if not isinstance(payload, dict):
            raise ApiError(422, "validation_error", "Settings must be a JSON object.")
        try:
            settings = parse_settings(payload)
        except (ValidationError, ValueError) as exc:
            if isinstance(exc, ValidationError):
                msg = "Invalid settings: " + _fields(exc)
                detail = "; ".join(sorted({str(e.get("msg", "")).replace("Value error, ", "") for e in exc.errors()}))
                msg += f" ({detail})" if detail else ""
            else:
                msg = f"Invalid settings: {exc}"
            raise ApiError(422, "validation_error", msg)
        try:
            saved = save_settings(settings)
        except (OSError, ValueError):
            raise ApiError(500, "internal", "Settings could not be saved.")
        return saved.to_public()

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"], include_in_schema=False)
    def api_not_found(rest: str):
        raise ApiError(404, "not_found", "Unknown API endpoint.")

    # -- static dashboard (SPA fallback) ----------------------------------------------------------------
    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        index = static / "index.html"
        if not index.is_file():
            return HTMLResponse(_friendly_html(
                "RIPPLE API",
                "<h1><b>RIPPLE</b> API is running</h1>"
                "<p>The dashboard has not been built yet. Run <code>cd web &amp;&amp; npm install &amp;&amp; npm run build</code> "
                "and restart, or start the dev server with <code>npm run dev</code> (http://localhost:5175).</p>"
                "<p>The JSON API is available under <code>/api</code> (try <a href='/api/health'>/api/health</a>).</p>"))
        if full_path:
            served = _static_file(static, full_path)
            if served is not None:
                return FileResponse(served)
            if PurePosixPath(full_path).suffix:  # missing asset - do not mask it with index.html
                raise ApiError(404, "not_found", "The requested resource was not found.")
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
