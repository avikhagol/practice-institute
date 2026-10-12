"""Student-only public gateway: path canonicalisation and route isolation."""
import pytest
from fastapi.testclient import TestClient

from conftest import STUDENT_ORIGIN, make_exam
from practice_institute.gateway import StudentGateway, is_public_path

ALLOWED = ["/api/v1", "/api/v1/", "/api/v1/health", "/api/v1/time", "/api/v1/exams/ABC123",
           "/api/v1/exams/ABC123/join", "/api/v1/attempts/a_b-C9/answers", "/api/v1/exams/X/ranks/"]
BLOCKED = ["/", "/admin", "/admin/", "/admin/index.html", "/api/admin/me", "/api/admin/sources/1/file",
           "/api", "/api/", "/api/v10", "/api/v10/health", "/api/v1x", "/api/v1.json", "/api/v1-x",
           "/api/V1/health", "/API/v1/health", "//api/v1/health", "/api/v1//health", "/api//v1",
           "/api/v1/../admin/", "/api/v1/./health", "/api/v1/..", "/api/v1/.", "/api/v1/%2e%2e/admin",
           "/api/v1%2fhealth", "/api/v1/health%00", "/api/v1\\..\\admin", "/api/v1/health;x",
           "/api/v1/export.csv", "/docs", "/openapi.json", "/redoc", "/api/v1/" + "a" * 129,
           "/api/v1/café", "/favicon.ico", "/health"]


@pytest.mark.parametrize("path", ALLOWED)
def test_canonical_student_paths_are_public(path):
    assert is_public_path(path.encode(), path)


@pytest.mark.parametrize("path", BLOCKED)
def test_non_student_and_noncanonical_paths_are_blocked(path):
    raw = path.encode("utf-8")
    assert not is_public_path(raw, path)


def test_decoded_path_differing_from_raw_target_is_blocked():
    # uvicorn decodes %2F into the path while raw_path keeps the original bytes.
    assert not is_public_path(b"/api/v1/exams%2F..%2F..%2Fadmin", "/api/v1/exams/../../admin")
    assert not is_public_path(b"/api/v1/health", "/api/v1/health/")
    assert not is_public_path(b"", "")
    assert not is_public_path(b"/api/v1/\xff", "/api/v1/\udcff")


@pytest.fixture
def public(settings, admin_password, clock):
    from practice_institute import app as app_mod
    app = app_mod.create_app(settings)
    with TestClient(app, base_url="http://127.0.0.1:8787") as owner:
        with TestClient(StudentGateway(app), base_url="http://127.0.0.1:8788") as gate:
            yield owner, gate


def test_gateway_serves_student_api_and_404s_everything_else(public):
    owner, gate = public
    assert gate.get("/api/v1/health").status_code == 200
    assert gate.get("/api/v1/time").status_code == 200
    for path in ("/admin/", "/api/admin/me", "/api/admin/sources", "/api/admin/sources/1/file", "/",
                 "/api/v10/health", "/docs", "/openapi.json"):
        r = gate.get(path)
        assert r.status_code == 404, path
        assert r.json() == {"error": "not-found"}
    assert gate.post("/api/admin/login", json={"username": "owner", "password": "x" * 12}).status_code == 404
    assert gate.request("PUT", "/api/v1/health").status_code == 404
    assert gate.request("DELETE", "/api/v1/health").status_code == 404
    # Owner listener is unchanged.
    assert owner.get("/api/admin/me").status_code == 401


def test_gateway_preserves_exact_origin_cors(public):
    _owner, gate = public
    ok = gate.options("/api/v1/health", headers={"Origin": STUDENT_ORIGIN, "Access-Control-Request-Method": "GET"})
    assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == STUDENT_ORIGIN
    bad = gate.options("/api/v1/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers
    plain = gate.get("/api/v1/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in plain.headers


def test_gateway_strips_admin_cookie_and_student_flow_works(admin, settings, clock):
    exam = make_exam(admin, clock)
    session = admin.cookies.get("pi_admin_session")
    assert session
    gate = TestClient(StudentGateway(admin.app), base_url="http://127.0.0.1:8788")
    gate.headers["Origin"] = STUDENT_ORIGIN
    r = gate.post(f"/api/v1/exams/{exam['code']}/join", json={"alias": "Gate student"})
    assert r.status_code == 201, r.text
    joined = r.json()
    auth = {"Authorization": f"Bearer {joined['token']}"}
    assert gate.get(f"/api/v1/attempts/{joined['attempt_id']}", headers=auth).status_code == 200
    # An admin cookie never reaches the app through the gateway.
    gate.cookies.set("pi_admin_session", session)
    assert gate.get("/api/admin/me").status_code == 404


def test_gateway_drops_cookie_header_before_the_app():
    import asyncio
    seen, sent = {}, []

    async def app(scope, receive, send):
        seen.update(scope["headers"])
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def receive():
        return {"type": "http.request", "body": b""}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "GET", "path": "/api/v1/health", "raw_path": b"/api/v1/health",
             "headers": [(b"cookie", b"pi_admin_session=synthetic"), (b"authorization", b"Bearer t")]}
    asyncio.run(StudentGateway(app)(scope, receive, send))
    assert b"cookie" not in seen and seen[b"authorization"] == b"Bearer t"
    assert sent[0]["status"] == 204


@pytest.fixture
def guarded(settings, admin_password, clock):
    from practice_institute import app as app_mod
    from practice_institute.gateway import OwnerHostGuard
    with TestClient(OwnerHostGuard(app_mod.create_app(settings), 8787), base_url="http://127.0.0.1:8787") as owner:
        yield owner, admin_password


def test_owner_host_guard_allows_loopback_hosts(guarded):
    owner, password = guarded
    assert owner.get("/api/v1/health").status_code == 200
    assert owner.get("/api/v1/health", headers={"Host": "localhost:8787"}).status_code == 200
    assert owner.post("/api/admin/login", json={"username": "owner", "password": password}).status_code == 200
    assert owner.get("/api/admin/me").status_code == 200


@pytest.mark.parametrize("host", ["evil.example:8787", "evil.example", "127.0.0.1", "127.0.0.1:8788",
                                  "localhost", "127.0.0.1:8787.evil.example", "[::1]:8787", ""])
def test_owner_host_guard_blocks_rebinding_hosts(guarded, host):
    owner, password = guarded
    # DNS rebinding: Origin and Host agree, so the app's own same-origin check would pass.
    r = owner.post("/api/admin/login", json={"username": "owner", "password": password},
                   headers={"Host": host, "Origin": f"http://{host}"})
    assert r.status_code == 404 and r.json() == {"error": "not-found"}
    assert "set-cookie" not in r.headers
    assert owner.get("/admin/", headers={"Host": host}).status_code == 404


@pytest.fixture
def limited(settings, admin_password, clock, request):
    from dataclasses import replace
    from practice_institute import app as app_mod
    tuned = replace(settings, join_rate_per_min=1, trust_proxy_headers=getattr(request, "param", False))
    app = app_mod.create_app(tuned)
    with TestClient(app, base_url="http://127.0.0.1:8787") as owner:
        r = owner.post("/api/admin/login", json={"username": "owner", "password": admin_password})
        assert r.status_code == 200, r.text
        owner.headers["X-CSRF-Token"] = r.json()["csrf_token"]
        exam = make_exam(owner, clock)
        owner.cookies.clear()
        with TestClient(StudentGateway(app), base_url="http://127.0.0.1:8788") as gate:
            gate.headers["Origin"] = STUDENT_ORIGIN
            yield owner, gate, exam["code"]


_aliases = iter(range(10_000))


def _join(client, code, ip=None):
    headers = {"CF-Connecting-IP": ip} if ip is not None else {}
    return client.post(f"/api/v1/exams/{code}/join", json={"alias": f"Rate student {next(_aliases)}"}, headers=headers).status_code


def test_gateway_keys_rate_limit_on_cf_connecting_ip(limited):
    _, gate, code = limited
    assert _join(gate, code, "203.0.113.10") == 201
    assert _join(gate, code, "203.0.113.11") == 201
    assert _join(gate, code, "203.0.113.10") == 429


def test_gateway_invalid_cf_connecting_ip_falls_back_to_peer(limited):
    _, gate, code = limited
    assert _join(gate, code, "not-an-ip") == 201
    assert _join(gate, code, "also bad") == 429
    assert _join(gate, code) == 429


@pytest.mark.parametrize("limited", [False, True], indirect=True)
def test_owner_listener_never_keys_on_cf_connecting_ip(limited):
    owner, _, code = limited
    assert _join(owner, code, "203.0.113.20") == 201
    assert _join(owner, code, "203.0.113.21") == 429
