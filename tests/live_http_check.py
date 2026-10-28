"""Explicit live check through disposable loopback production CLI; never starts Telegram.

This sends permitted real provider reads. Require --live; CI never invokes this tool.
"""
import argparse
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from src.aai_scanner.config import Config
from src.aai_scanner.market import WRAPPED_SOL
from src.aai_scanner.mint import decode_address
from src.aai_scanner.qualification import DEFAULT_WALLET

ROOT = Path(__file__).resolve().parents[1]


def run(mint=WRAPPED_SOL, wallet=DEFAULT_WALLET):
    decode_address(mint)
    decode_address(wallet)
    with tempfile.TemporaryDirectory(prefix="aai-live-http-") as folder:
        root = Path(folder)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        origin = f"http://127.0.0.1:{port}"
        token = secrets.token_urlsafe(32)
        # Preserve only explicitly configured provider settings, not deployment/bot secrets.
        env = {key: value for key, value in os.environ.items() if not key.startswith("AAI_")}
        for name in ("AAI_RPC_URL", "AAI_RPC_FALLBACK_URLS", "AAI_PROVIDER_TIMEOUT"):
            if name in os.environ:
                env[name] = os.environ[name]
        env.update(AAI_HOST="127.0.0.1", AAI_PORT=str(port), AAI_PUBLIC_URL=origin,
                   AAI_API_TOKEN=token, AAI_DATABASE=str(root / "server.sqlite3"))
        Config(rpc_url=env.get("AAI_RPC_URL", Config.rpc_url),
               rpc_fallback_urls=tuple(value.strip() for value in env.get("AAI_RPC_FALLBACK_URLS", "").split(",") if value.strip()),
               timeout=int(env.get("AAI_PROVIDER_TIMEOUT", "10")), port=port, public_url=origin,
               api_token=token, database=env["AAI_DATABASE"]).validate()
        child = subprocess.Popen([sys.executable, "-m", "src.aai_scanner", "serve"], cwd=ROOT, env=env,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 10
            while True:
                try:
                    with urllib.request.urlopen(origin + "/api/health", timeout=2) as response:
                        if response.status == 200:
                            break
                except OSError:
                    pass
                if time.monotonic() > deadline or child.poll() is not None:
                    raise RuntimeError("Disposable scanner did not start")
                time.sleep(0.05)
            output = root / "evidence.json"
            client_env = dict(env, AAI_DATABASE=str(root / "must-not-open.sqlite3"))
            executed = subprocess.run([sys.executable, "-m", "src.aai_scanner", "verify-http", "--mint", mint,
                                       "--wallet", wallet, "--output", str(output)], cwd=ROOT, env=client_env,
                                      capture_output=True, text=True, timeout=115)
            if executed.returncode not in (0, 1) or not output.is_file() or token in executed.stdout + executed.stderr:
                raise RuntimeError("Live HTTP check could not produce safe evidence")
            evidence = json.loads(output.read_text())
            if Path(client_env["AAI_DATABASE"]).exists():
                raise RuntimeError("Verifier unexpectedly opened the client database")
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=5)
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, timeout=5)
    evidence.update(test_environment="DISPOSABLE_LOOPBACK_PRODUCTION_CLI_WITH_REAL_PROVIDER_READS",
                    checkout_head=head.stdout.strip() if re.fullmatch(r"[a-f0-9]{40}", head.stdout.strip()) else None,
                    working_tree_dirty=bool(dirty.stdout.strip()) if dirty.returncode == 0 else None,
                    telegram_messages=0, public_deployment="NOT_STARTED")
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", required=True)
    parser.add_argument("--mint", default=WRAPPED_SOL)
    parser.add_argument("--wallet", default=DEFAULT_WALLET)
    parser.add_argument("--output")
    args = parser.parse_args()
    result = run(args.mint, args.wallet)
    output = json.dumps(result, indent=2, allow_nan=False)
    if args.output:
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(output + "\n", encoding="utf-8")
    print(output)
    return 0 if result["status"] == "PASSED" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, OSError, subprocess.SubprocessError):
        print("Live HTTP check failed; verify environment and local setup.", file=sys.stderr)
        sys.exit(1)
