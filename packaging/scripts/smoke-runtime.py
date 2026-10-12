#!/usr/bin/env python3
"""Developer-only bundled Linux smoke, with isolated synthetic data and loopback ports.

Run from the repository: rtk proxy python3 packaging/scripts/smoke-runtime.py
This checks a copied payload under a Unicode/spaces path, not an OS installation.
"""
import json
from pathlib import Path
import selectors
import shutil
import socket
import subprocess
import tempfile
import urllib.error
import urllib.request


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    root = Path(__file__).resolve().parents[2]
    payload = root / "packaging/output/runtime-linux"
    if not (payload / "manifest.json").is_file():
        raise SystemExit("Build Linux payload first with build-runtime.sh linux")
    output = root / "packaging/output"
    with tempfile.TemporaryDirectory(prefix="Smoke Παράδειγμα space ", dir=output) as folder:
        base = Path(folder)
        runtime = base / "runtime"
        shutil.copytree(payload, runtime, symlinks=True)
        owner, public = free_port(), free_port()
        while public == owner:
            public = free_port()
        env = {
            "PATH": "/usr/bin:/bin", "HOME": str(base), "LANG": "C.UTF-8",
            "PI_DATA_DIR": str(base / "synthetic data"),
            "PI_ADMIN_DIST": str(runtime / "admin"), "PI_COOKIE_SECURE": "false",
            "PI_ALLOWED_ORIGINS": "http://127.0.0.1:4317", "PI_TRUST_PROXY_HEADERS": "false",
            "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUTF8": "1",
        }
        command = [str(runtime / "python/bin/python3"), "-I", "-B", "-m", "practice_institute.cli"]
        for subcommand, expected in (
            ("owner-status", {"owner_exists": False}),
            ("exam-activity", {"active_attempts": 0, "open_exams": 0}),
        ):
            result = subprocess.run(command + [subcommand], cwd=base, env=env,
                                    text=True, capture_output=True, timeout=15, check=True)
            value = json.loads(result.stdout)
            if any(value.get(key) != wanted for key, wanted in expected.items()):
                raise AssertionError(f"Unexpected {subcommand} response")
        process = subprocess.Popen(
            command + ["serve-desktop", "--stdin-control", "--owner-port", str(owner),
                       "--public-port", str(public)], cwd=base, env=env, text=True,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                if not selector.select(30):
                    raise AssertionError("No ready event within 30 seconds")
                if json.loads(process.stdout.readline()).get("event") != "ready":
                    raise AssertionError("Expected ready event")
            for port, path in ((owner, "/api/v1/health"), (public, "/api/v1/health"),
                               (owner, "/admin/")):
                with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as response:
                    if response.status != 200:
                        raise AssertionError(f"Unexpected status for {path}")
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{public}/api/admin/me", timeout=5)
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise
            else:
                raise AssertionError("Public admin route was exposed")
            process.stdin.write("stop\n")
            process.stdin.flush()
            stdout, stderr = process.communicate(timeout=15)
            events = [json.loads(line).get("event") for line in stdout.splitlines()]
            if process.returncode != 0 or events != ["stopping", "stopped"]:
                raise AssertionError("Runtime did not stop cleanly")
            print(json.dumps({"unicodeSpacesPayload": True, "ownerStatus": "passed",
                              "examActivity": "passed", "ownerHealth": 200,
                              "publicHealth": 200, "ownerAdmin": 200, "publicAdmin": 404,
                              "stopExit": process.returncode, "events": events,
                              "stderrEmpty": not stderr}))
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)


if __name__ == "__main__":
    main()
