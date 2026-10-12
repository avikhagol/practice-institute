"""Student-only public gateway (defense in depth for the Cloudflare Tunnel).

The desktop runtime serves two loopback listeners from ONE process and ONE app instance:

- owner listener  (default 127.0.0.1:8787): full app — /admin, /api/admin and /api/v1.
- public listener (default 127.0.0.1:8788): this ASGI wrapper — only /api/v1 and its
  descendants; everything else is a bare 404 before the application sees it.

cloudflared must point at the public listener only. Even if the ingress file is edited to
a catch-all, admin routes and source originals stay unreachable from the tunnel.

The path check is fail-closed: the raw request target must be plain ASCII segments made of
the characters the student API actually uses (exam codes and token_urlsafe ids). Any
percent-encoding, dot segment, empty segment, backslash, semicolon or query-borne trick in
the path is rejected, so decoding differences between cloudflared, uvicorn and Starlette
cannot widen what is reachable. "/api/v10" and "/api/v1x" never match "/api/v1".
"""

from __future__ import annotations

import re
from typing import Any, Awaitable, Callable

PUBLIC_PREFIX = "/api/v1"
PUBLIC_METHODS = frozenset({"GET", "HEAD", "POST", "OPTIONS"})
# Exactly /api/v1, /api/v1/ or /api/v1/<seg>(/<seg>)* with an optional trailing slash.
_PUBLIC_PATH = re.compile(r"^/api/v1(?:/[A-Za-z0-9_-]{1,128})*/?$")
# Request headers the student API never needs. Cookies are dropped so an admin session
# cookie can never ride along a tunneled request.
_DROP_HEADERS = frozenset({b"cookie"})
MAX_PATH_BYTES = 512

Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]


def is_public_path(raw_path: bytes, path: str) -> bool:
    """True only for canonical student API paths. Both the raw target and the decoded
    path must be identical and canonical."""
    if not raw_path or len(raw_path) > MAX_PATH_BYTES:
        return False
    try:
        raw = raw_path.decode("ascii")
    except UnicodeDecodeError:
        return False
    if raw != path:
        return False  # any decoding happened (e.g. %2F, %2e, UTF-8) -> reject
    return _PUBLIC_PATH.fullmatch(raw) is not None


async def _not_found(send: Send) -> None:
    body = b'{"error":"not-found"}'
    await send({"type": "http.response.start", "status": 404, "headers": [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(body)).encode()),
        (b"cache-control", b"no-store"),
        (b"x-content-type-options", b"nosniff"),
    ]})
    await send({"type": "http.response.body", "body": body})


class StudentGateway:
    """ASGI wrapper exposing only the student API of `app`."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        kind = scope["type"]
        if kind == "lifespan":
            # The owner listener runs the app lifespan (migrations, sweeper). Acknowledge only.
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        if kind != "http":
            if kind == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            return
        raw_path = scope.get("raw_path") or scope.get("path", "").encode("utf-8", "surrogateescape")
        if scope.get("method") not in PUBLIC_METHODS or not is_public_path(raw_path, scope.get("path", "")):
            await _not_found(send)
            return
        headers = [(k, v) for k, v in scope.get("headers", []) if k.lower() not in _DROP_HEADERS]
        await self.app({**scope, "headers": headers, "root_path": "", "pi_public": True}, receive, send)


def loopback_hosts(port: int) -> frozenset[bytes]:
    return frozenset({f"127.0.0.1:{port}".encode(), f"localhost:{port}".encode()})


class OwnerHostGuard:
    """ASGI wrapper for the owner listener: only loopback Host headers reach the app.

    The app derives its same-origin check from Host, so a DNS-rebinding page
    (Host: evil.example:8787, Origin: http://evil.example:8787) would otherwise pass it and
    reach /api/admin/login. Requests with any other Host get a bare 404."""

    def __init__(self, app: ASGIApp, port: int) -> None:
        self.app = app
        self.allowed = loopback_hosts(port)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            hosts = [v.lower() for k, v in scope.get("headers", []) if k.lower() == b"host"]
            if len(hosts) != 1 or hosts[0] not in self.allowed:
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                else:
                    await _not_found(send)
                return
        await self.app(scope, receive, send)
