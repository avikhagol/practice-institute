"""Runtime configuration, read once from environment variables (see ../.env.example).

No secret has a default. The admin password lives only as an Argon2 hash in the
database, created by `uv run pi-admin setup` (interactive).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw not in (None, "") else default


def _list(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    db_path: Path
    data_dir: Path
    # Browser origins (scheme://host[:port]) allowed to call the *student* API cross-origin,
    # e.g. https://<user>.github.io . Admin routes never accept cross-origin requests.
    allowed_origins: list[str] = field(default_factory=list)
    # Secure cookie flag. Keep true behind an HTTPS tunnel; false only for http://127.0.0.1 dev.
    cookie_secure: bool = False
    max_body_bytes: int = 256 * 1024
    max_source_pages: int = 200
    max_upload_bytes: int = 40 * 1024 * 1024
    # Server allowance checked under the write lock. It cannot prove a request was in flight.
    # Measured on the server clock only; client-supplied timestamps are never trusted.
    submit_grace_ms: int = 2000
    session_ttl_s: int = 8 * 3600
    trust_proxy_headers: bool = False
    expiry_sweep_s: float = 2.0
    join_rate_per_min: int = 20
    login_rate_per_min: int = 8
    # Built admin site. Packaged runtimes pass an absolute PI_ADMIN_DIST; the default is the
    # source-checkout layout (app/dist-admin next to backend/).
    admin_dist: Path = BACKEND_DIR.parent / "app" / "dist-admin"


def load_settings() -> Settings:
    data_dir = Path(os.environ.get("PI_DATA_DIR", BACKEND_DIR / "data")).resolve()
    db_path = Path(os.environ.get("PI_DB_PATH", data_dir / "practice-institute.sqlite3")).resolve()
    return Settings(
        db_path=db_path,
        data_dir=data_dir,
        allowed_origins=_list("PI_ALLOWED_ORIGINS"),
        cookie_secure=_bool("PI_COOKIE_SECURE", False),
        max_body_bytes=_int("PI_MAX_BODY_BYTES", 256 * 1024),
        max_source_pages=_int("PI_MAX_SOURCE_PAGES", 200),
        max_upload_bytes=_int("PI_MAX_UPLOAD_BYTES", 40 * 1024 * 1024),
        submit_grace_ms=_int("PI_SUBMIT_GRACE_MS", 2000),
        session_ttl_s=_int("PI_SESSION_TTL_S", 8 * 3600),
        trust_proxy_headers=_bool("PI_TRUST_PROXY_HEADERS", False),
        expiry_sweep_s=float(os.environ.get("PI_EXPIRY_SWEEP_S", "2.0")),
        join_rate_per_min=_int("PI_JOIN_RATE_PER_MIN", 20),
        login_rate_per_min=_int("PI_LOGIN_RATE_PER_MIN", 8),
        admin_dist=Path(os.environ.get("PI_ADMIN_DIST") or BACKEND_DIR.parent / "app" / "dist-admin").resolve(),
    )
