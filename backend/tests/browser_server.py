"""Disposable loopback backend for browser acceptance. Never uses the owner's database."""
import tempfile
from dataclasses import replace
from pathlib import Path

import uvicorn
from practice_institute.app import create_app
from practice_institute.config import load_settings
from practice_institute.db import connect, migrate
from practice_institute.security import hash_password

with tempfile.TemporaryDirectory(prefix="pi-browser-") as folder:
    root = Path(folder)
    # A full desktop/mobile suite has >8 logins/minute; production rate limits
    # remain unchanged and are exercised by API security tests.
    settings = replace(load_settings(), data_dir=root, db_path=root / "test.sqlite3", allowed_origins=["http://127.0.0.1:4317"], login_rate_per_min=30)
    conn = connect(settings.db_path); migrate(conn)
    conn.execute("INSERT INTO admins(username,password_hash,role,created_at) VALUES ('browser-owner',?,'owner',0)", (hash_password("disposable-browser-password"),))
    conn.close()
    uvicorn.run(create_app(settings), host="127.0.0.1", port=8789)
