"""Actual production CLI/HTTP recovery rehearsal; temporary private state, no providers or messages.

python -m tests.operations_rehearsal [--caddy /path/to/caddy] [--output evidence.json]
"""
import argparse
import hashlib
import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from src.aai_scanner.storage import Store

MINT = "So11111111111111111111111111111111111111112"
ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def run(caddy=None):
    checks = []
    with tempfile.TemporaryDirectory(prefix="aai-operations-") as folder:
        root = Path(folder)
        port, proxy_port = free_port(), free_port()
        origin = f"http://127.0.0.1:{proxy_port if caddy else port}"
        host = origin.split("//")[1]
        token = secrets.token_urlsafe(32)
        env = {key: value for key, value in os.environ.items() if not key.startswith("AAI_")}
        env.update(AAI_HOST="127.0.0.1", AAI_PORT=str(port), AAI_PUBLIC_URL=origin,
                   AAI_API_TOKEN=token, AAI_DATABASE=str(root / "live.sqlite3"),
                   AAI_SITE=origin, AAI_UPSTREAM=f"127.0.0.1:{port}")
        process, proxy = None, None

        def command(*args, success=True, recovery=False):
            command_env = dict(env)
            if recovery:
                # Recovery is independent of invalid configuration and the live DB path.
                command_env.update(AAI_PORT="invalid", AAI_DATABASE=str(root / "must-not-create.sqlite3"))
            result = subprocess.run([sys.executable, "-m", "src.aai_scanner", *map(str, args)],
                                    cwd=ROOT, env=command_env, capture_output=True, text=True, timeout=20)
            assert (result.returncode == 0) == success, f"CLI {args[0]} had unexpected exit {result.returncode}"
            if not success:
                assert "Traceback" not in result.stderr and token not in result.stderr
                return None
            return json.loads(result.stdout) if args[0] != "backup" else None

        def request(path, method="GET", body=None, authorized=True):
            data = json.dumps(body).encode() if body is not None else None
            headers = {"Host": host, "Content-Type": "application/json"}
            if authorized:
                headers["Authorization"] = "Bearer " + token
            destination = origin if caddy else f"http://127.0.0.1:{port}"
            req = urllib.request.Request(destination + path, data=data, headers=headers, method=method)
            try:
                response = urllib.request.urlopen(req, timeout=8)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                raw = response.read()
                payload = json.loads(raw) if response.headers.get("Content-Type", "").startswith("application/json") else raw
                return response.status, payload

        def wait_ready():
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                try:
                    if request("/api/health", authorized=False)[0] == 200:
                        return
                except (OSError, ValueError):
                    pass
                time.sleep(0.1)
            raise AssertionError("Service did not start within rehearsal budget")

        def start():
            return subprocess.Popen([sys.executable, "-m", "src.aai_scanner", "serve"], cwd=ROOT,
                                    env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        try:
            assert command("doctor")["application_ready"]
            checks.append("offline_doctor_with_integrity")
            # Validate the unit with only install paths expanded for this checkout.
            # This does not install/start systemd, provision a host, or prove supervision.
            unit = (ROOT / "deploy/scanner/aai-scanner.service").read_text()
            unit = unit.replace("/opt/buildwithaai/current/.venv/bin/python", sys.executable)
            unit = unit.replace("/opt/buildwithaai/current", str(ROOT))
            service = root / "aai-scanner.service"
            service.write_text(unit)
            subprocess.run(["systemd-analyze", "verify", "--man=no", str(service)],
                           check=True, capture_output=True, timeout=20)
            checks.append("systemd_unit_validation_with_expanded_install_paths")
            process = start()
            if caddy:
                subprocess.run([caddy, "validate", "--config", str(ROOT / "deploy/scanner/Caddyfile"),
                                "--adapter", "caddyfile"], env=env, check=True, capture_output=True, timeout=20)
                proxy = subprocess.Popen([caddy, "run", "--config", str(ROOT / "deploy/scanner/Caddyfile"),
                                          "--adapter", "caddyfile"], env=env,
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                checks.append("caddy_template_validation_and_loopback_proxy")
            wait_ready()
            assert request("/api/ready", authorized=False)[0] == 401
            code, ready = request("/api/ready")
            assert code == 200 and ready["data"]["status"] == "UNVERIFIED"
            assert ready["public_launch"] == "UNVERIFIED"
            assert request("/")[0] == 200
            checks.append("authenticated_readiness_and_static_interface")
            assert request("/api/watchlist", "POST", {"mint": MINT})[0] == 200
            checks.append("persistent_watch_write")
            process.kill()  # Deliberate crash of OUR disposable rehearsal process only.
            process.wait(timeout=10)
            process = start()
            wait_ready()
            assert request("/api/watchlist")[1]["watches"][0]["mint"] == MINT
            checks.append("crash_restart_recovers_acknowledged_write")
            store = Store(env["AAI_DATABASE"])
            try:
                store.set_state("telegram_offset", 123)  # Local polling state only; no Telegram call.
            finally:
                store.close()
            snapshot = root / "backup.sqlite3"
            command("backup", snapshot)
            assert command("verify-backup", snapshot, recovery=True)["watches"] == 1
            command("backup", snapshot, success=False)
            before = hashlib.sha256(snapshot.read_bytes()).hexdigest()
            command("restore", snapshot, env["AAI_DATABASE"], success=False, recovery=True)
            corrupt = root / "corrupt.sqlite3"
            corrupt.write_bytes(b"invalid backup")
            command("restore", corrupt, root / "corrupt-restore.sqlite3", success=False, recovery=True)
            assert not (root / "corrupt-restore.sqlite3").exists()
            checks.append("online_backup_readonly_verification_and_safe_rejection")
            process.terminate()
            process.wait(timeout=10)
            process = None
            restored = root / "restored.sqlite3"
            command("restore", snapshot, restored, recovery=True)
            assert not (root / "must-not-create.sqlite3").exists()
            assert hashlib.sha256(snapshot.read_bytes()).hexdigest() == before
            store = Store(str(restored))
            try:
                assert store.get_state("telegram_offset") == "123"
            finally:
                store.close()
            env["AAI_DATABASE"] = str(restored)
            assert command("doctor")["application_ready"]
            process = start()
            wait_ready()
            assert request("/api/watchlist")[1]["watches"][0]["mint"] == MINT
            checks.append("new_file_restore_and_restarted_http_persistence")
        finally:
            for child in (process, proxy):
                if child and child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait(timeout=5)
    return {"status": "PASSED", "verification_type": "LOCAL_OPERATIONAL_REHEARSAL",
            "available_at": datetime.now(timezone.utc).isoformat(), "checks": checks,
            "proxy": "VERIFIED_LOOPBACK_HTTP" if caddy else "NOT_TESTED",
            "systemd_unit": "VALIDATED_WITH_EXPANDED_INSTALL_PATHS",
            "systemd_supervision": "NOT_TESTED", "tls": "NOT_TESTED", "live_provider_calls": 0,
            "telegram_messages": 0, "public_deployment": "NOT_STARTED"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--caddy")
    parser.add_argument("--output")
    args = parser.parse_args()
    result = run(args.caddy)
    output = json.dumps(result, indent=2)
    if args.output:
        target = Path(args.output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(output + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
