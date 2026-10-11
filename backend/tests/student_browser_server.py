"""Disposable restartable process fixture. Only test data, never owner's database."""
import os
from pathlib import Path
import uvicorn
from practice_institute.app import create_app
from practice_institute.config import load_settings
from practice_institute.db import connect, migrate
from practice_institute.security import hash_password

settings = load_settings()
assert os.environ.get("PI_STUDENT_BROWSER_TEST") == "1"
assert settings.data_dir.name.startswith("pi-student-browser-")
conn = connect(settings.db_path)
migrate(conn)
if not conn.execute("SELECT 1 FROM admins").fetchone():
    conn.execute("INSERT INTO admins(username,password_hash,role,created_at) VALUES ('browser-owner',?,'owner',0)", (hash_password("disposable-browser-password"),))
conn.close()
uvicorn.run(create_app(settings), host="127.0.0.1", port=8791, log_level="warning")
