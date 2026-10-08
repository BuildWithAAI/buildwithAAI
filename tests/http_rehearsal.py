"""Actual Waitress/CLI wire check; SYNTHETIC sources must fail the live-data gate."""
import argparse
import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from src.aai_scanner.config import Config
from src.aai_scanner.evidence import now
from src.aai_scanner.release import package_identity
from tests.scanner_fixtures import ACCOUNT, MINT

ROOT = Path(__file__).resolve().parents[1]


def server():
    # Fixtures stay solely in tests; the production CLI never imports this module.
    from waitress import serve
    from src.aai_scanner.service import Scanner
    from src.aai_scanner.storage import Store
    from src.aai_scanner.web import Application
    from tests.scanner_fixtures import FakeMarket, FakeRPC
    config = Config.from_env()
    store = Store(config.database)
    try:
        serve(Application(config, store, Scanner(config, store, FakeRPC(), FakeMarket())),
              host="127.0.0.1", port=config.port, threads=4, expose_tracebacks=False)
    finally:
        store.close()


def run():
    with tempfile.TemporaryDirectory(prefix="aai-http-check-") as folder:
        root = Path(folder)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        origin = f"http://127.0.0.1:{port}"
        token = secrets.token_urlsafe(32)
        env = {key: value for key, value in os.environ.items() if not key.startswith("AAI_")}
        env.update(AAI_HOST="127.0.0.1", AAI_PORT=str(port), AAI_PUBLIC_URL=origin,
                   AAI_API_TOKEN=token, AAI_DATABASE=str(root / "server.sqlite3"), AAI_RPC_URL="https://rpc.test")
        child = subprocess.Popen([sys.executable, "-m", "tests.http_rehearsal", "--server"], cwd=ROOT, env=env,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 10
            while True:
                try:
                    with urllib.request.urlopen(origin + "/api/health", timeout=2) as response:
                        assert response.status == 200
                    break
                except OSError:
                    if time.monotonic() > deadline or child.poll() is not None:
                        raise AssertionError("Disposable HTTP server did not start") from None
                    time.sleep(0.05)
            output = root / "nested/proof.json"
            client_env = dict(env, AAI_DATABASE=str(root / "must-not-create.sqlite3"))
            executed = subprocess.run([sys.executable, "-m", "src.aai_scanner", "verify-http", "--mint", MINT,
                                       "--wallet", ACCOUNT, "--output", str(output)], cwd=ROOT, env=client_env,
                                      capture_output=True, text=True, timeout=30)
            assert executed.returncode == 1, "Synthetic sources must never qualify as live data"
            assert token not in executed.stdout + executed.stderr
            assert "Traceback" not in executed.stderr
            evidence = json.loads(output.read_text())
            assert evidence["status"] == "FAILED" and evidence["public_launch"] == "UNVERIFIED"
            for name in ("process", "release_identity", "authentication", "application"):
                assert evidence["checks"][name]["status"] == "PASSED", f"Wire check failed: {name}"
            assert evidence["checks"]["token_report"]["status"] == "FAILED"
            assert evidence["checks"]["wallet_report"]["status"] == "FAILED"
            assert "NON_OBSERVED_SOURCE" in evidence["checks"]["token_report"]["sections"]["network"]["issues"]
            assert not Path(client_env["AAI_DATABASE"]).exists()
            request = urllib.request.Request(origin + "/api/history?mint=" + MINT, headers={"Authorization": "Bearer " + token})
            with urllib.request.urlopen(request, timeout=5) as response:
                assert len(json.load(response)["observations"]) == 1
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
    return {"status": "PASSED", "verification_type": "OFFLINE_APPLICATION_HTTP_REHEARSAL", "available_at": now(),
            "release": package_identity(), "source_classification": "SYNTHETIC",
            "checks": ["actual_waitress_and_cli_http", "matching_package_identity", "anonymous_access_rejected",
                       "authenticated_local_readiness", "token_and_wallet_wire_contracts", "synthetic_live_gate_rejected",
                       "client_database_not_opened", "target_observation_persisted"],
            "live_data_verification": "UNVERIFIED", "live_provider_calls": 0, "telegram_messages": 0,
            "public_deployment": "NOT_STARTED"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", action="store_true")
    parser.add_argument("--output")
    args = parser.parse_args()
    if args.server:
        server()
        return
    output = json.dumps(run(), indent=2)
    if args.output:
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(output + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
