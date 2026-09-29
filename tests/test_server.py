"""HTTP API tests (FastAPI TestClient). No network. Uses a fake engine for determinism, plus optional real-engine tests."""
import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from helpers_sample import PACKAGE_LOCK, REQUIREMENTS, fake_engine, ripple_home, sample_scan  # noqa: F401
from ripple.models import STAGES
from ripple.server import store
from ripple.server.app import create_app
from ripple.server.jobs import JobManager


@pytest.fixture()
def client(ripple_home, fake_engine):
    return TestClient(create_app(jobs=JobManager()))


def upload(client, files, options=None, url="/api/scans", **extra):
    data = {}
    if options is not None:
        data["options"] = json.dumps(options)
    data.update(extra)
    payload = [("files", (name, content, "application/octet-stream")) for name, content in files]
    return client.post(url, files=payload, data=data)


def wait_job(client, job_id, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        st = client.get(f"/api/jobs/{job_id}").json()
        if st["status"] in ("done", "error"):
            return st
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def assert_error_shape(resp, status, code=None):
    assert resp.status_code == status
    body = resp.json()
    assert set(body.keys()) == {"error"}
    assert set(body["error"].keys()) == {"code", "message"}
    if code:
        assert body["error"]["code"] == code
    text = resp.text
    for leak in ("Traceback", "File \"", ".py", "C:\\", "secret", "/home/"):
        assert leak not in text, leak
    return body["error"]


# --- health / settings ---------------------------------------------------------------------------------

def test_health_offline_registries_unchecked(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["mode"] == "offline" and body["version"]
    assert set(body["registries"]) == {"npm", "pypi", "go", "rust"}
    assert all(v["state"] == "unchecked" for v in body["registries"].values())
    assert body["registries"]["npm"]["url"] == "https://registry.npmjs.org"


def test_settings_roundtrip(client):
    s = client.get("/api/settings").json()
    assert s["scanner"]["thresholds"] == {"critical": 80, "high": 60, "medium": 35, "low": 15}
    assert s["output"]["default_format"] == "rich"
    s["scanner"]["max_edit_distance"] = 1
    s["scanner"]["internal_scopes"] = ["@acme"]
    s["registries"]["pypi"] = "https://pypi.internal.example"
    r = client.put("/api/settings", json=s)
    assert r.status_code == 200 and r.json()["scanner"]["max_edit_distance"] == 1
    again = client.get("/api/settings").json()
    assert again == r.json()
    assert again["registries"]["pypi"] == "https://pypi.internal.example"
    assert client.get("/api/health").json()["registries"]["pypi"]["url"] == "https://pypi.internal.example"


def test_settings_validation_errors(client):
    e = assert_error_shape(client.put("/api/settings", json={"registries": {"npm": "file:///etc/passwd"}}), 422,
                           "validation_error")
    assert e["message"]
    assert_error_shape(client.put("/api/settings", json={"scanner": {"max_edit_distance": 99}}), 422)
    assert_error_shape(client.put("/api/settings", json=[1, 2]), 422)
    assert client.get("/api/settings").json()["registries"]["npm"] == "https://registry.npmjs.org"


# --- demo -----------------------------------------------------------------------------------------------

def test_demo_is_idempotent(client, fake_engine):
    a = client.get("/api/demo")
    b = client.get("/api/demo")
    assert a.status_code == 200 and b.status_code == 200
    assert a.json()["id"] == b.json()["id"] == "scan-demo-payments-api"
    assert a.json()["mode"] == "demo"
    assert fake_engine.demo_builds == 1
    hist = client.get("/api/scans").json()
    assert [h["id"] for h in hist].count("scan-demo-payments-api") == 1


# --- detect -----------------------------------------------------------------------------------------------

def test_detect_reports_support_and_sanitises_names(client):
    r = upload(client, [("package-lock.json", PACKAGE_LOCK), ("../../etc/passwd", "root:x:0:0"),
                        ("C:\\evil\\requirements.txt", REQUIREMENTS)], url="/api/detect")
    assert r.status_code == 200
    by_name = {d["filename"]: d for d in r.json()}
    assert by_name["package-lock.json"]["supported"] is True
    assert by_name["package-lock.json"]["ecosystem"] == "npm"
    assert by_name["passwd"]["supported"] is False
    assert by_name["requirements.txt"]["supported"] is True  # backslash path reduced to basename
    for d in r.json():
        assert set(d) == {"filename", "ecosystem", "supported", "kind", "dependency_count", "error"}


def test_detect_requires_files_and_multipart(client):
    assert_error_shape(client.post("/api/detect", files={"note": (None, "hi")}), 400, "no_files")
    assert_error_shape(client.post("/api/detect", json={"a": 1}), 415)


# --- scan jobs --------------------------------------------------------------------------------------------

def test_upload_job_poll_result_export(client):
    r = upload(client, [("package-lock.json", PACKAGE_LOCK), ("requirements.txt", REQUIREMENTS)],
               options={"checks": ["confusion", "typosquat"], "internal_scopes": ["@acme"]}, project="my-app")
    assert r.status_code == 202
    job_id = r.json()["job_id"]
    st = wait_job(client, job_id)
    assert st["status"] == "done" and st["progress"] == 1.0 and st["error"] is None and st["scan_id"]
    assert [s["id"] for s in st["stages"]] == [sid for sid, _ in STAGES]
    assert all(s["state"] == "done" for s in st["stages"])
    assert st["stages"][0]["detail"].endswith("finished")

    scan = client.get(f"/api/scans/{st['scan_id']}")
    assert scan.status_code == 200 and scan.json()["project"] == "my-app"

    for fmt, ctype, ext in (("json", "application/json", "json"), ("sarif", "application/sarif+json", "sarif"),
                            ("csv", "text/csv", "csv"), ("html", "text/html", "html")):
        e = client.get(f"/api/scans/{st['scan_id']}/export", params={"format": fmt})
        assert e.status_code == 200, fmt
        assert e.headers["content-type"].startswith(ctype)
        disp = e.headers["content-disposition"]
        assert disp.startswith("attachment; filename=\"ripple-") and disp.endswith(f".{ext}\"")
        assert e.headers["x-content-type-options"] == "nosniff"
    sarif = client.get(f"/api/scans/{st['scan_id']}/export", params={"format": "sarif"}).json()
    assert sarif["version"] == "2.1.0" and sarif["runs"][0]["tool"]["driver"]["name"] == "RIPPLE"
    assert client.get(f"/api/scans/{st['scan_id']}/export").json()["id"] == st["scan_id"]  # default json


def test_options_are_validated_and_defaults_come_from_settings(client, fake_engine):
    client.put("/api/settings", json={"scanner": {"max_edit_distance": 1, "rate_limit_rps": 2}})
    job = upload(client, [("package-lock.json", PACKAGE_LOCK)], options={"timeout_s": 7}).json()["job_id"]
    wait_job(client, job)
    opts, project, source, names = fake_engine.calls[-1]
    assert opts.max_edit_distance == 1 and opts.rate_limit_rps == 2 and opts.timeout_s == 7
    assert opts.live is False and names == ["package-lock.json"] and source.files == ["package-lock.json"]
    assert_error_shape(upload(client, [("package-lock.json", "{}")], options={"checks": ["nuke"]}), 422, "validation_error")
    assert_error_shape(upload(client, [("package-lock.json", "{}")], options={"timeout_s": 9999}), 422)
    bad = client.post("/api/scans", files=[("files", ("package-lock.json", b"{}"))], data={"options": "{oops"})
    assert_error_shape(bad, 422, "validation_error")


def test_registry_overrides_from_clients_are_ignored(client, fake_engine):
    job = upload(client, [("package-lock.json", PACKAGE_LOCK)],
                 options={"live": True, "registry_overrides": {"npm": "http://169.254.169.254/"}}).json()["job_id"]
    wait_job(client, job)
    opts = fake_engine.calls[-1][0]
    assert opts.live is True
    assert "169.254.169.254" not in json.dumps(opts.registry_overrides)


def test_progress_reflects_real_stage_state(ripple_home, fake_engine):
    fake_engine.gate = threading.Event()
    client = TestClient(create_app(jobs=JobManager()))
    job_id = upload(client, [("package-lock.json", PACKAGE_LOCK)]).json()["job_id"]
    seen = None
    for _ in range(200):
        st = client.get(f"/api/jobs/{job_id}").json()
        states = [s["state"] for s in st["stages"]]
        if states[0] == "done" and states[1] == "active":
            seen = st
            break
        time.sleep(0.02)
    assert seen is not None, "never observed the intermediate state"
    assert seen["status"] == "running" and 0.0 < seen["progress"] < 1.0
    assert seen["stages"][0]["detail"] == "parse finished"
    assert all(s["state"] == "pending" for s in seen["stages"][2:])
    fake_engine.gate.set()
    final = wait_job(client, job_id)
    assert final["status"] == "done" and final["progress"] == 1.0


def test_unsupported_upload_is_a_job_error_with_code(client):
    job_id = upload(client, [("notes.txt", "hello")]).json()["job_id"]
    st = wait_job(client, job_id)
    assert st["status"] == "error" and st["error_code"] == "unsupported_lockfile"
    assert st["error"] and "package-lock.json" in st["error"] and st["scan_id"] is None


def test_engine_failures_map_to_safe_error_codes(client):
    cases = [(b"BOOM", "internal"), (b"BADPARSE", "parse_error"), (b"REGDOWN", "registry_unavailable")]
    for payload, code in cases:
        st = wait_job(client, upload(client, [("package-lock.json", payload)]).json()["job_id"])
        assert st["status"] == "error" and st["error_code"] == code, payload
        blob = json.dumps(st)
        for leak in ("C:\\", "secret", "engine.py", "Traceback", "registry.internal", "token=abc"):
            assert leak not in blob, (payload, leak)


def test_unsupported_files_next_to_supported_become_a_warning(client):
    st = wait_job(client, upload(client, [("package-lock.json", PACKAGE_LOCK), ("readme.md", "hi")]).json()["job_id"])
    assert st["status"] == "done"
    scan = client.get(f"/api/scans/{st['scan_id']}").json()
    assert any("readme.md" in w for w in scan["warnings"])


def test_unknown_job_404(client):
    assert_error_shape(client.get("/api/jobs/nope"), 404, "not_found")


# --- history / delete -------------------------------------------------------------------------------------

def test_history_newest_first_and_delete(client):
    store.save(sample_scan("scan-a", created_at="2026-01-01T00:00:00Z"))
    store.save(sample_scan("scan-b", created_at="2026-03-01T00:00:00Z"))
    store.save(sample_scan("scan-c", created_at="2026-02-01T00:00:00Z"))
    hist = client.get("/api/scans").json()
    assert [h["id"] for h in hist] == ["scan-b", "scan-c", "scan-a"]
    assert set(hist[0]) == {"id", "project", "created_at", "mode", "dependencies", "findings", "risk_score",
                            "risk_label", "ecosystems"}
    assert hist[0]["risk_score"] == 72 and hist[0]["ecosystems"] == ["npm", "pypi", "rust"]
    d = client.delete("/api/scans/scan-c")
    assert d.status_code == 204 and d.content == b""
    assert_error_shape(client.get("/api/scans/scan-c"), 404, "not_found")
    assert_error_shape(client.delete("/api/scans/scan-c"), 404, "not_found")
    assert [h["id"] for h in client.get("/api/scans").json()] == ["scan-b", "scan-a"]


def test_scan_id_cannot_traverse_paths(client, ripple_home):
    ripple_home.mkdir(parents=True, exist_ok=True)
    (ripple_home / "secret.json").write_text("{}")
    for bad in ("..%2Fsecret", "..%5Csecret", "%2e%2e%2fsecret"):
        assert_error_shape(client.get(f"/api/scans/{bad}"), 404)
        assert_error_shape(client.delete(f"/api/scans/{bad}"), 404)
    assert (ripple_home / "secret.json").exists()


def test_export_errors(client):
    store.save(sample_scan("scan-x"))
    assert_error_shape(client.get("/api/scans/scan-x/export", params={"format": "pdf"}), 422, "validation_error")
    assert_error_shape(client.get("/api/scans/missing/export", params={"format": "json"}), 404, "not_found")


# --- error handling / security ------------------------------------------------------------------------------

def test_unknown_routes_return_json_errors(client):
    assert_error_shape(client.get("/api/nope"), 404, "not_found")
    r = client.post("/api/health")
    assert r.status_code in (404, 405) and set(r.json()) == {"error"}


def test_unhandled_exception_returns_safe_500(ripple_home, fake_engine, monkeypatch):
    def boom():
        raise RuntimeError("secret database password in C:\\internal\\thing.py")

    monkeypatch.setattr(store, "history", boom)
    c = TestClient(create_app(), raise_server_exceptions=False)
    assert_error_shape(c.get("/api/scans"), 500, "internal")


def test_upload_size_cap(ripple_home, fake_engine):
    c = TestClient(create_app(max_upload_bytes=2048))
    small = upload(c, [("package-lock.json", "x" * 100)])
    assert small.status_code == 202
    big = upload(c, [("package-lock.json", "x" * 1500), ("requirements.txt", "y" * 1500)])
    assert_error_shape(big, 413, "payload_too_large")
    assert_error_shape(upload(c, [("package-lock.json", "x" * 5000)], url="/api/detect"), 413)
    assert_error_shape(c.post("/api/scans", files={"note": (None, "hi")}), 400, "no_files")


def test_host_and_origin_guards(client):
    assert_error_shape(client.get("/api/health", headers={"host": "evil.example"}), 400, "invalid_host")
    assert client.get("/api/health", headers={"host": "127.0.0.1:8787"}).status_code == 200
    assert client.get("/api/health", headers={"host": "localhost:8787"}).status_code == 200
    r = client.post("/api/scans", files=[("files", ("package-lock.json", b"{}"))],
                    headers={"origin": "http://evil.example"})
    assert_error_shape(r, 403, "forbidden_origin")
    ok = client.post("/api/scans", files=[("files", ("package-lock.json", b"{}"))],
                     headers={"origin": "http://localhost:5175"})
    assert ok.status_code == 202


def test_cors_allows_dev_server_only(client):
    ok = client.options("/api/scans", headers={"origin": "http://localhost:5175",
                                                "access-control-request-method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5175"
    ok2 = client.get("/api/health", headers={"origin": "http://127.0.0.1:5175"})
    assert ok2.headers.get("access-control-allow-origin") == "http://127.0.0.1:5175"
    bad = client.get("/api/health", headers={"origin": "http://evil.example"})
    assert "access-control-allow-origin" not in bad.headers


def test_uploaded_content_is_never_executed(client, ripple_home):
    marker = ripple_home / "pwned"
    payload = f"__import__('os').makedirs(r'{marker}')"
    job_id = upload(client, [("package-lock.json", payload)]).json()["job_id"]
    wait_job(client, job_id)
    assert not marker.exists()


# --- static / SPA -------------------------------------------------------------------------------------------

def test_friendly_page_when_web_build_missing(ripple_home, fake_engine, tmp_path):
    c = TestClient(create_app(static_dir=tmp_path / "missing"))
    r = c.get("/")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    assert "npm run build" in r.text and "/api/health" in r.text
    assert c.get("/some/spa/route").status_code == 200


def test_spa_fallback_and_static_files(ripple_home, fake_engine, tmp_path):
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<!doctype html><title>RIPPLE UI</title>")
    (static / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "outside.txt").write_text("private")
    c = TestClient(create_app(static_dir=static))
    assert "RIPPLE UI" in c.get("/").text
    assert "RIPPLE UI" in c.get("/scans/abc/findings").text          # client-side route
    assert c.get("/assets/app.js").text == "console.log(1)"
    assert_error_shape(c.get("/assets/missing.js"), 404, "not_found")  # assets are not masked by index.html
    assert "private" not in c.get("/..%2foutside.txt").text
    assert "private" not in c.get("/%2e%2e/outside.txt").text
    assert c.get("/api/health").status_code == 200                     # API keeps working alongside the SPA


# --- real engine (skipped until/unless the engine exists) --------------------------------------------------------

@pytest.fixture()
def real_client(ripple_home):
    pytest.importorskip("ripple.engine")
    return TestClient(create_app(jobs=JobManager()))


def test_real_engine_demo_and_export(real_client):
    demo = pytest.importorskip("ripple.demo")
    if not hasattr(demo, "build_demo_scan"):
        pytest.skip("demo dataset not available")
    r = real_client.get("/api/demo")
    assert r.status_code == 200
    scan = r.json()
    assert scan["mode"] == "demo" and scan["summary"]["total_dependencies"] > 100
    assert real_client.get("/api/demo").json()["id"] == scan["id"]
    sarif = real_client.get(f"/api/scans/{scan['id']}/export", params={"format": "sarif"}).json()
    assert len(sarif["runs"][0]["results"]) == len(scan["findings"])


def test_real_engine_upload_flow(real_client):
    from helpers_sample import CARGO_LOCK

    r = upload(real_client, [("package-lock.json", PACKAGE_LOCK), ("requirements.txt", REQUIREMENTS),
                             ("Cargo.lock", CARGO_LOCK)], options={"internal_scopes": ["@acme"]})
    assert r.status_code == 202
    st = wait_job(real_client, r.json()["job_id"], timeout=60)
    assert st["status"] == "done", st
    scan = real_client.get(f"/api/scans/{st['scan_id']}").json()
    assert scan["summary"]["total_dependencies"] >= 5
    det = upload(real_client, [("package-lock.json", PACKAGE_LOCK), ("notes.txt", "x")], url="/api/detect").json()
    assert {d["filename"]: d["supported"] for d in det} == {"package-lock.json": True, "notes.txt": False}
