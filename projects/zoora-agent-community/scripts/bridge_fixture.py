"""LOCAL test-provider contract only. Public TLS key must never protect real traffic."""

from contextlib import contextmanager
import copy
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import ssl
import sqlite3
import subprocess
import sys
import threading
from unittest.mock import patch
from contextlib import closing
from urllib.parse import parse_qs, urlsplit
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from zoora_community.bridge_sandbox import HOST, BridgeSandboxClient, main  # noqa: E402
from zoora_community.validation import canonical  # noqa: E402

CERT = ROOT / "tests" / "fixtures" / "bridge-localhost-cert.pem"
TLS_KEY = CERT.with_name("bridge-localhost-public-test-key.pem")
KEY = "sk-test-PUBLIC-LOCAL-FIXTURE-NEVER-A-REAL-API-KEY"


def intent(index=1):
    return {"request_id": f"{index:032x}", "customer_id": "00000000-0000-0000-0000-000000000001",
            "source_address": "11111111111111111111111111111111",
            "destination_address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "amount_usdc": "12.500001"}


def version_one_journal(path):
    """Test-only reconstruction of v1's exact columns; histories must be CREATE/POLL only."""
    with closing(sqlite3.connect(path, autocommit=True)) as connection:
        if connection.execute("SELECT COUNT(*) FROM attempts WHERE kind NOT IN ('CREATE','POLL')").fetchone()[0]:
            raise ValueError("Not a legacy history")
        connection.execute("ALTER TABLE attempts DROP COLUMN candidate_id")
        connection.execute("DROP TABLE bridge_migrations")
        connection.execute("DROP TABLE bridge_control")
        connection.execute("PRAGMA user_version=1")


class ProviderFixture:
    def __init__(self):
        self.requests, self.effects = [], {}
        self.lock = threading.Lock()
        self.mode = "ok"
        self.status = 200
        self.body_override = None
        self.encoding = None
        self.content_type = "application/json"
        self.declared_length = None
        self.listing = None
        self.repeat_page = False
        self.entered, self.release = threading.Event(), threading.Event()

    @contextmanager
    def serve(self):
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.0"

            def log_message(self, *_args):
                pass

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length)
                body = json.loads(raw)
                key = self.headers.get("Idempotency-Key")
                with fixture.lock:
                    fixture.requests.append({"method": "POST", "path": self.path, "headers": dict(self.headers), "body": raw.decode()})
                    if key not in fixture.effects:
                        fixture.effects[key] = {**body, "id": str(uuid.uuid4()), "state": "awaiting_funds"}
                    value = copy.deepcopy(fixture.effects[key])
                fixture.entered.set()
                if fixture.mode == "block":
                    fixture.release.wait(timeout=5)
                if fixture.mode == "drop":
                    self.close_connection = True
                    return
                self.respond(value, 201 if fixture.status == 200 else fixture.status)

            def do_GET(self):
                with fixture.lock:
                    fixture.requests.append({"method": "GET", "path": self.path, "headers": dict(self.headers), "body": None})
                    if self.path.startswith("/v0/transfers?"):
                        query = parse_qs(urlsplit(self.path).query)
                        data = copy.deepcopy(fixture.listing if fixture.listing is not None else list(reversed(list(fixture.effects.values()))))
                        cursor = query.get("starting_after", [None])[0]
                        if cursor and not fixture.repeat_page:
                            index = next((i for i, item in enumerate(data) if item["id"] == cursor), len(data))
                            data = data[index + 1:]
                        data = data[:int(query["limit"][0])]
                        value = {"count": len(data), "data": data}
                    else:
                        value = next((copy.deepcopy(v) for v in fixture.effects.values() if self.path == "/v0/transfers/" + v["id"]), {})
                fixture.entered.set()
                if fixture.mode == "block_reads":
                    fixture.release.wait(timeout=5)
                self.respond(value, fixture.status if value else 404)

            def respond(self, value, status):
                raw = fixture.body_override if fixture.body_override is not None else canonical(value).encode()
                self.send_response(status)
                self.send_header("Content-Type", fixture.content_type)
                self.send_header("Content-Length", str(len(raw) if fixture.declared_length is None else fixture.declared_length))
                if fixture.encoding:
                    self.send_header("Content-Encoding", fixture.encoding)
                if 300 <= status < 400:
                    self.send_header("Location", "https://api.bridge.xyz/v0/transfers")
                self.end_headers()
                try:
                    self.wfile.write(raw)
                except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
                    pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(CERT, TLS_KEY)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        self.port = server.server_port
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02})
        thread.start()
        try:
            yield self
        finally:
            self.release.set()
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    @contextmanager
    def transport(self):
        original = http.client.HTTPSConnection
        trusted = ssl.create_default_context(cafile=str(CERT))

        def connection(host, *, timeout, context):
            if host != HOST or context.verify_mode != ssl.CERT_REQUIRED or not context.check_hostname:
                raise AssertionError("Test requires the production factory's sandbox host and strict TLS settings")
            return original("127.0.0.1", self.port, timeout=timeout, context=trusted)

        with patch("zoora_community.bridge_sandbox.HTTPSConnection", connection):
            yield

    def cli(self, state, args, *, at=1_800_000_000_000, crash=False):
        return subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error", str(Path(__file__).resolve()),
            "_cli", str(self.port), str(at), "restore-crash" if crash == "restore" else "poll-crash" if crash == "poll" else "crash" if crash else "normal", "--state", str(state), *map(str, args)],
            cwd=ROOT, capture_output=True, text=True, timeout=15)


def cli_fixture():
    # Only this test harness redirects transport; the shipped CLI has no endpoint/test-clock switch.
    fixture = ProviderFixture()
    fixture.port = int(sys.argv[2])
    at, crash = int(sys.argv[3]), sys.argv[4]
    args = sys.argv[5:]
    original_create = BridgeSandboxClient.create
    original_poll = BridgeSandboxClient.poll
    from zoora_community import bridge_recovery
    original_sync = bridge_recovery.sync_directory

    def create_then_crash(client, body, key):
        result = original_create(client, body, key)
        if crash == "crash":
            os._exit(79)
        return result

    def poll_then_crash(client, transfer_id, body):
        result = original_poll(client, transfer_id, body)
        if crash == "poll-crash":
            os._exit(80)
        return result

    def sync_then_crash(path):
        original_sync(path)
        if crash == "restore-crash" and path == Path(args[args.index("--state") + 1]).absolute():
            os._exit(81)

    with fixture.transport(), patch("zoora_community.bridge_journal.time.time_ns", lambda: at * 1_000_000), \
            patch.object(BridgeSandboxClient, "create", create_then_crash), \
            patch.object(BridgeSandboxClient, "poll", poll_then_crash), \
            patch.object(bridge_recovery, "sync_directory", sync_then_crash), \
            patch.object(sys, "argv", ["bridge-sandbox", *args]):
        return main()


if __name__ == "__main__":
    sys.exit(cli_fixture())
