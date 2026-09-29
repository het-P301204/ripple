"""Map exceptions to user-safe error codes/messages (never leak stack traces or paths)."""
from __future__ import annotations

UNSUPPORTED = "unsupported_lockfile"
REGISTRY = "registry_unavailable"
PARSE = "parse_error"
INTERNAL = "internal"

SUPPORTED_HINT = (
    "Supported lockfiles: npm (package-lock.json, yarn.lock), PyPI (requirements.txt, Pipfile.lock, pyproject.toml), "
    "Go (go.mod, go.sum), Rust (Cargo.lock)."
)


class RippleUserError(Exception):
    """An error whose message is safe to show to the user as-is."""

    def __init__(self, message: str, code: str = INTERNAL):
        super().__init__(message)
        self.message = message
        self.code = code


def classify(exc: BaseException) -> tuple[str, str]:
    """Return ``(error_code, safe_message)`` for an exception raised while scanning."""
    if isinstance(exc, RippleUserError):
        return exc.code, exc.message
    names = {c.__name__.lower() for c in type(exc).__mro__}
    joined = " ".join(names)
    if "unsupported" in joined:
        return UNSUPPORTED, f"Unsupported lockfile. {SUPPORTED_HINT}"
    if "registry" in joined or "timeout" in joined or "connect" in joined or "httpx" in joined:
        return REGISTRY, "A package registry was unavailable or rate limited. Retry later or scan offline."
    if "parse" in joined or "decode" in joined or "json" in joined or "toml" in joined or isinstance(exc, ValueError):
        return PARSE, "The lockfile could not be parsed. Check that the file is complete and unmodified."
    return INTERNAL, "The scan failed unexpectedly. Re-run with --debug (CLI) or check the server log for details."
