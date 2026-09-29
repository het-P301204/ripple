"""Shared security helpers: untrusted-text sanitising and outbound-URL validation.

Everything RIPPLE displays or stores can be influenced by an attacker: package names come from uploaded
lockfiles, descriptions / maintainers / install scripts come from public registries. These helpers make such
strings inert (terminal escape sequences, bidi tricks, line spoofing) and keep outbound requests away from
link-local / cloud-metadata endpoints.
"""
from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
import unicodedata
from typing import Any
from urllib.parse import urlsplit

# ---------------------------------------------------------------------------------------------------------
# Text sanitising
# ---------------------------------------------------------------------------------------------------------

_FLATTEN = {"\n": " ", "\r": " ", "\t": " ", "\x0b": " ", "\x0c": " ", "\x85": " ", " ": " ", " ": " "}
_BAD_CATEGORIES = {"Cc", "Cf", "Cs", "Zl", "Zp"}


def _escape_char(ch: str) -> str:
    cp = ord(ch)
    if cp < 0x100:
        return f"\\x{cp:02x}"
    if cp < 0x10000:
        return f"\\u{cp:04x}"
    return f"\\U{cp:08x}"


def escape_controls(text: Any, *, flatten: bool = True) -> str:
    """Return ``text`` with control / format / line-separator characters made visible and harmless.

    * ``\\n \\r \\t`` and other line breaks become a single space when ``flatten`` (default), so an attacker
      string cannot forge extra lines in terminal output or logs.
    * Other control characters (ESC, BEL, C1 controls, DEL ...), bidirectional overrides and zero-width /
      format characters are replaced with a literal escape such as ``\\x1b`` or ``\\u202e`` - the reviewer can
      still see that something odd was present, but no terminal, browser or spreadsheet will act on it.
    """
    if text is None:
        return ""
    s = text if isinstance(text, str) else str(text)
    if s.isprintable():
        return s
    out: list[str] = []
    for ch in s:
        if ch in _FLATTEN and flatten:
            out.append(_FLATTEN[ch])
        elif ch == "\n" and not flatten:
            out.append(ch)
        elif ch.isprintable() or (unicodedata.category(ch) not in _BAD_CATEGORIES and ch not in "￾￿"):
            out.append(ch)
        else:
            out.append(_escape_char(ch))
    return "".join(out)


def clean_label(text: Any, max_len: int = 120, default: str = "") -> str:
    """Sanitised, whitespace-trimmed, length-bounded label (project names, filenames ...)."""
    s = escape_controls(text).strip()
    if len(s) > max_len:
        s = s[: max_len - 1] + "…"
    return s or default


def clean_optional(text: Any, max_len: int | None = None) -> str | None:
    if text is None:
        return None
    s = escape_controls(text)
    return s if max_len is None or len(s) <= max_len else s[:max_len]


# ---------------------------------------------------------------------------------------------------------
# Secret redaction (lockfiles routinely embed registry credentials in URLs)
# ---------------------------------------------------------------------------------------------------------

REDACTED = "***"
_URL_USERINFO = re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://)([^/\s?#@]*)@")
_SECRET_QUERY = re.compile(
    r"(?i)([?&;](?:[\w.-]*(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|apikey|access[_-]?key|auth|credential|"
    r"signature|sig)[\w.-]*|key)=)[^&#\s\"']+")
_ENV_STYLE = re.compile(r"(?i)\b((?:https?|git\+https?|ssh)://)\$\{?[A-Za-z_][A-Za-z0-9_]*\}?(?::\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)?@")


def _mask_userinfo(m: "re.Match[str]") -> str:
    scheme, userinfo = m.group(1), m.group(2)
    if scheme.lower().rstrip(":/").endswith("ssh") and ":" not in userinfo:
        return m.group(0)                          # ``ssh://git@host`` names a login, not a secret
    return f"{scheme}{REDACTED}@"


def redact_secrets(text: Any) -> Any:
    """Mask credentials embedded in URLs (``https://user:token@host``, ``?token=...``).

    Reports, SARIF files and the scan history are meant to be shared; a private-index URL copied verbatim from a
    lockfile (``--index-url https://__token__:pypi-...@host/simple``) would leak the token with them.
    """
    if not isinstance(text, str) or ("@" not in text and "=" not in text):
        return text
    out = _URL_USERINFO.sub(_mask_userinfo, text)
    return _SECRET_QUERY.sub(lambda m: f"{m.group(1)}{REDACTED}", out)


# ---------------------------------------------------------------------------------------------------------
# Windows reserved device names (used to reject ids / filenames that would open a device instead of a file)
# ---------------------------------------------------------------------------------------------------------

_RESERVED = re.compile(r"^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$", re.I)


def is_reserved_device_name(name: str) -> bool:
    """True for names Windows treats as devices (``CON``, ``NUL.json``, ``com1.txt`` ...)."""
    stem = name.split(".", 1)[0].rstrip(" ")
    return bool(_RESERVED.match(stem))


# ---------------------------------------------------------------------------------------------------------
# Outbound URL validation (SSRF guard)
# ---------------------------------------------------------------------------------------------------------

MAX_URL_LEN = 300
BLOCKED_HOSTNAMES = frozenset({
    "metadata", "metadata.google.internal", "metadata.goog", "instance-data", "instance-data.ec2.internal",
    "metadata.tencentyun.com", "kubernetes.default", "kubernetes.default.svc",
})
_BLOCKED_ADDRESSES = frozenset(ipaddress.ip_address(a) for a in (
    "169.254.169.254", "169.254.170.2", "100.100.100.200", "192.0.0.192", "fd00:ec2::254", "fd00:ec2::23",
))
_LEGACY_IPV4 = re.compile(r"(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+)){0,3}", re.I)


def _as_ip(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    h = host.strip("[]")
    try:
        return ipaddress.ip_address(h)
    except ValueError:
        pass
    if "%" in h:                                  # IPv6 zone id
        try:
            return ipaddress.ip_address(h.split("%", 1)[0])
        except ValueError:
            return None
    if _LEGACY_IPV4.fullmatch(h):                 # 2852039166, 0xa9fea9fe, 0251.0376.0251.0376, 169.254.43518 ...
        try:
            return ipaddress.IPv4Address(socket.inet_aton(h))
        except (OSError, ValueError):
            return None
    return None


def ip_is_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Link-local, unspecified, multicast, reserved and well-known cloud-metadata addresses.

    Loopback and RFC 1918 ranges are deliberately *allowed*: teams run private registry mirrors there.
    """
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return ip_is_blocked(ip.ipv4_mapped)
        if ip.sixtofour is not None and ip_is_blocked(ip.sixtofour):
            return True
    if ip.is_loopback:                             # ::1 is inside IPv6's "reserved" ::/8 - keep it usable
        return False
    if ip in _BLOCKED_ADDRESSES or ip.is_link_local or ip.is_unspecified or ip.is_multicast:
        return True
    return isinstance(ip, ipaddress.IPv4Address) and ip.is_reserved


def validate_registry_url(url: str) -> str:
    """Validate a registry base URL from settings / options. Returns the normalised URL or raises ``ValueError``."""
    if not isinstance(url, str):
        raise ValueError("registry URL must be a string")
    u = url.strip().rstrip("/")
    if not u or len(u) > MAX_URL_LEN:
        raise ValueError("registry URL is empty or too long")
    if any(ch.isspace() or not ch.isprintable() for ch in u):
        raise ValueError("registry URL contains whitespace or control characters")
    try:
        parts = urlsplit(u)
        port = parts.port                          # raises ValueError on a bad port
    except ValueError:
        raise ValueError("registry URL is malformed") from None
    if parts.scheme.lower() not in ("http", "https"):
        raise ValueError("registry URL must start with http:// or https://")
    host = (parts.hostname or "").strip(".").lower()
    if not host:
        raise ValueError("registry URL has no host name")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise ValueError("registry URL must not contain credentials")
    if parts.query or parts.fragment or "?" in u or "#" in u:
        raise ValueError("registry URL must not contain a query string or fragment")
    if port is not None and not 0 < port < 65536:
        raise ValueError("registry URL has an invalid port")
    if host in BLOCKED_HOSTNAMES:
        raise ValueError("registry URL points at a blocked metadata host")
    ip = _as_ip(host)
    if ip is not None and ip_is_blocked(ip):
        raise ValueError("registry URL points at a link-local / metadata / reserved address")
    return u


async def assert_public_target(host: str, port: int, resolve: bool = True) -> None:
    """Refuse link-local / metadata / reserved request targets (IP literals always; DNS names when ``resolve``).

    Raises ``ValueError``. Resolution errors are left to the HTTP layer to report as ordinary network errors.
    """
    ip = _as_ip(host)
    if ip is not None:
        if ip_is_blocked(ip):
            raise ValueError("request target is a link-local / metadata / reserved address")
        return
    if host.lower().strip(".") in BLOCKED_HOSTNAMES:
        raise ValueError("request target is a blocked metadata host")
    if not resolve:
        return
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        return
    for info in infos:
        addr = info[4][0]
        resolved = _as_ip(str(addr))
        if resolved is not None and ip_is_blocked(resolved):
            raise ValueError("request target resolves to a link-local / metadata / reserved address")
