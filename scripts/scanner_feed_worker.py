"""Real scanner/community services and bounded observation-agent processes."""

from __future__ import annotations

from dataclasses import replace
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib
from pathlib import Path
import secrets
import ssl
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ecosystem_research import network as n, scanner_feed as f  # noqa: E402
from src.ecosystem_research.scanner_client import ScannerClient, token_file  # noqa: E402
from src.ecosystem_research.checkout import verify_checkout  # noqa: E402
from src.ecosystem_research.controller import FileLock  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402

sys.path.insert(0, str(ROOT / "scripts"))
import ecosystem_network_worker as nw  # noqa: E402


def scanner_modules(path):
    root = Path(path).resolve()
    verify_checkout(root, "scanner")
    sys.path.insert(0, str(root / "src"))
    from aai_scanner.config import Config
    from aai_scanner.release import package_identity
    from aai_scanner.service import Scanner
    from aai_scanner.storage import Store
    from aai_scanner.web import Application

    lab.require(
        Path(importlib.import_module("aai_scanner").__file__).resolve().parent
        == root / "src/aai_scanner",
        "FEED_SCANNER_IMPORT_PATH",
    )
    return Config, package_identity, Scanner, Store, Application


def collect(cfg):
    client = ScannerClient(
        origin=cfg["scanner_origin"],
        release_sha256=cfg["scanner_release_sha256"],
        mint=cfg["mint"],
        rpc_hosts=cfg["rpc_hosts"],
        token=token_file(cfg["scanner_token_file"])
        if cfg.get("scanner_token_file")
        else None,
        ca_file=cfg.get("scanner_ca_file"),
    )
    folder = Path(cfg["directory"])
    count, interval = cfg.get("count", 1), cfg.get("interval_seconds", 30)
    lab.require(
        type(count) is int
        and 1 <= count <= f.MAX_RECORDS
        and type(interval) is int
        and 30 <= interval <= 300,
        "FEED_POLL_BOUNDS",
    )
    # Only the explicit transport test uses a shorter cadence to exercise cached delivery.
    if cfg.get("test_cadence"):
        lab.require(
            cfg.get("classification") == "SYNTHETIC_TRANSPORT_TEST",
            "FEED_TEST_CADENCE_SCOPE",
        )
    if not folder.exists():
        folder.mkdir(mode=0o700, parents=True)
        ev.write(folder / "policy.json", client.rules)
        journal = f.ObservationJournal(
            folder / "observations.sqlite3", client.rules
        ).initialize()
        head = lab.digest(client.rules)
    else:
        lab.require(
            n.same(ev.read(folder / "policy.json"), client.rules),
            "FEED_COLLECTOR_POLICY_CHANGED",
        )
        journal = f.ObservationJournal(folder / "observations.sqlite3", client.rules)
        head = cfg.get("expected_head")
        lab.pin(head)
        journal.snapshot(head)
    lock = FileLock(folder / "collector.lock").acquire()
    try:
        failures = 0
        for index in range(count):
            lock.check()
            record = client.capture()
            value = journal.append(record, head)
            head = value["head_sha256"]
            failed = value["event"]["assessment"]["status"] == "INTAKE_REJECTED"
            failures = failures + 1 if failed else 0
            if failures >= 3:
                break
            if index + 1 < count:
                retry = max(
                    [
                        v.get("retry_after_seconds") or 0
                        for v in record["responses"].values()
                    ]
                    or [0]
                )
                delay = 0.02 if cfg.get("test_cadence") else max(interval, retry)
                deadline = time.monotonic() + delay
                while time.monotonic() < deadline:
                    time.sleep(min(0.25, deadline - time.monotonic()))
        return journal.status(time.time_ns() // 1000000)
    finally:
        lock.close()


def agent(cfg):
    Client, read_credential, _, _, _ = nw.components(cfg["community_source"])
    client = nw.client_for(Client, cfg)
    token = read_credential(cfg["credential"])
    source, digest, project = (
        cfg["controller_manifest_sha256"],
        cfg["bundle_sha256"],
        cfg["project_id"],
    )
    bundle = n.receive(client, token, project, source, digest)
    folder = Path(cfg["directory"])
    journal = f.ObservationJournal(
        folder / "observations.sqlite3", ev.read(folder / "policy.json")
    )
    state = journal.snapshot(cfg["expected_head"])
    lab.require(state["events"], "FEED_NO_OBSERVATION")
    as_of = state["last_ms"]
    report = f.agent_report(journal, bundle, source, cfg["expected_head"], as_of)

    def handler():
        lab.require(
            journal.status(time.time_ns() // 1000000)["current_retrieval"],
            "FEED_EXPIRED_BEFORE_PUBLICATION",
        )
        return f.agent_report(journal, bundle, source, cfg["expected_head"], as_of)

    lab.require(
        journal.status(time.time_ns() // 1000000)["current_retrieval"],
        "FEED_EXPIRED_BEFORE_PUBLICATION",
    )
    receipt = n.dispatch(client, token, project, "consume", report, handler)
    if cfg.get("output"):
        output = Path(cfg["output"])
        ev.write(output / "agent-report.json", report)
        ev.write(output / "agent-receipt.json", receipt)
    return {
        "protocol": "AAI_SCANNER_AGENT_DELIVERY_V1",
        "receipt": receipt,
        "feed_head_sha256": cfg["expected_head"],
        "available_models": 4,
        "model_inference_performed": False,
        "research_signal": "ABSTAIN",
        "action": "NO_EXECUTION",
        "live_execution_allowed": False,
    }


class RunningScanner:
    def __init__(self, cfg, state, token, *, synthetic=False, port=0):
        Config, package_identity, Scanner, Store, Application = scanner_modules(
            cfg["scanner_source"]
        )
        from waitress import create_server, wasyncore
        from zoora_community.wsgi_server import StrictChannel

        self.wasyn = wasyncore
        self.store = Store(str(state))
        rpc_url = "https://api.mainnet.solana.com"
        self.config = Config(
            rpc_url=rpc_url, database=str(state), api_token=token, timeout=5
        )
        if synthetic:
            # Pinned upstream test providers retain SYNTHETIC flags. No operational
            # command constructs these objects or substitutes a provider response.
            for name in ("", ".evidence", ".market", ".mint", ".transport"):
                sys.modules["src.aai_scanner" + name] = importlib.import_module(
                    "aai_scanner" + name
                )
            sys.path.insert(0, str(Path(cfg["scanner_source"]) / "tests"))
            from scanner_fixtures import FakeRPC, FakeMarket

            scanner = Scanner(
                self.config, self.store, rpc=FakeRPC(), market=FakeMarket()
            )
        else:
            scanner = Scanner(self.config, self.store)
        self.app = Application(self.config, self.store, scanner)
        self.channels = {}
        self.server = create_server(
            self.app,
            map=self.channels,
            host="127.0.0.1",
            port=port,
            threads=4,
            connection_limit=16,
            backlog=8,
            max_request_header_size=8192,
            max_request_body_size=4097,
            channel_timeout=5,
            cleanup_interval=1,
            asyncore_loop_timeout=0.1,
            clear_untrusted_proxy_headers=True,
            expose_tracebacks=False,
            log_socket_errors=False,
        )
        self.server.channel_class = StrictChannel
        self.port = int(self.server.effective_port)
        self.origin = "http://127.0.0.1:" + str(self.port)
        self.configure(self.origin)
        self.release = package_identity()
        lab.require(
            self.release["status"] == "AVAILABLE", "FEED_SCANNER_RELEASE_UNAVAILABLE"
        )
        self.stopping = threading.Event()
        self.thread = threading.Thread(target=self.run)
        self.thread.start()

    def configure(self, origin):
        self.config = replace(
            self.config,
            port=self.port,
            public_url=origin,
            public_mode=origin.startswith("https:"),
        )
        self.app.config = self.app.scanner.config = self.config.validate()
        self.app.hosts = {origin.split("://", 1)[1]}
        self.app.origins = {origin}

    def run(self):
        while not self.stopping.is_set() and self.channels:
            self.wasyn.loop(timeout=0.1, map=self.channels, count=1)

    def close(self, snapshot=None):
        self.stopping.set()
        self.server.pull_trigger()
        self.thread.join(5)
        self.server.task_dispatcher.shutdown(timeout=8)
        self.server.close()
        self.wasyn.close_all(map=self.channels, ignore_all=True)
        try:
            if snapshot is not None:
                with self.store.lock:
                    f.publish_sqlite_snapshot(self.store.db, snapshot)
        finally:
            self.store.close()


class TLSProxy:
    """Real TLS test terminator forwarding to the actual scanner Waitress app."""

    def __init__(self, scanner, certificate, key):
        self.requests = []
        self.redirect = False
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                proxy.requests.append(
                    (self.path, self.headers.get("Authorization") is not None)
                )
                if proxy.redirect:
                    self.send_response(302)
                    self.send_header("Location", "https://example.invalid/not-followed")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                connection = http.client.HTTPConnection(
                    "127.0.0.1", scanner.port, timeout=25
                )
                try:
                    connection.request(
                        self.command, self.path, body, dict(self.headers)
                    )
                    response = connection.getresponse()
                    data = response.read(f.MAX_RAW + 1)
                    self.send_response(response.status)
                    for key, value in response.getheaders():
                        if key.lower() in (
                            "content-type",
                            "cache-control",
                            "content-length",
                            "retry-after",
                        ):
                            self.send_header(key, value)
                    self.end_headers()
                    self.wfile.write(data)
                finally:
                    connection.close()

            do_POST = do_GET

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.origin = "https://127.0.0.1:" + str(self.server.server_port)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certificate, key)
        self.server.socket = context.wrap_socket(self.server.socket, server_side=True)
        scanner.configure(self.origin)
        self.thread = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.05}
        )
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.thread.join(5)
        self.server.server_close()


def run_lab(output, cfg):
    lab.require(
        cfg["mode"] in ("SYNTHETIC_TRANSPORT_TEST", "LIVE_PROVIDER_READS"),
        "FEED_LAB_MODE",
    )
    Client, _, Store, Problem, WSGIServer = nw.components(cfg["community_source"])
    bundle = ev.read(output / "bundle.json")
    source = cfg["controller_manifest_sha256"]
    n.validate_bundle(bundle, source)
    NetworkStore = n.store_type(Store, Problem, bundle, source)
    synthetic = cfg["mode"] == "SYNTHETIC_TRANSPORT_TEST"
    with tempfile.TemporaryDirectory() as temporary:
        private = Path(temporary)
        owner_path = private / "owner.json"
        store = NetworkStore.initialize(output / "agents", owner_path)
        owner = ev.read(owner_path)["token"]
        community = WSGIServer(store, 0)
        community_thread = threading.Thread(target=community.serve_forever)
        community_thread.start()
        scanner = proxy = None
        try:
            bootstrap = Client(port=community.server_port)
            _, instance = bootstrap.request("GET", "/v1/status")
            instance = instance["instance_id"]
            admin = Client(port=community.server_port, expected_instance=instance)
            publisher, publisher_cred, operator_a = nw.enroll(
                admin, owner, "scan_publisher"
            )
            observer, observer_cred, operator_b = nw.enroll(
                admin, owner, "scan_observer"
            )
            for role, credential in (
                ("publisher", publisher_cred),
                ("observer", observer_cred),
            ):
                ev.write(private / (role + ".json"), credential)
                (private / (role + ".json")).chmod(0o600)
            publisher_client = n.connect(
                Client,
                port=community.server_port,
                expected_instance=instance,
                expected_agent=publisher,
            )
            _, project = publisher_client.request(
                "POST",
                "/v1/projects",
                {
                    "title": "Scanner observation handoff",
                    "summary": "Current source declarations, no model fitting or execution",
                },
                publisher_cred["token"],
            )
            project = project["id"]
            publisher_client.request(
                "POST",
                f"/v1/projects/{project}/members",
                {"agent_id": observer},
                publisher_cred["token"],
            )
            peer = {
                "community_source": cfg["community_source"],
                "port": community.server_port,
                "expected_instance": instance,
                "expected_agent": publisher,
                "credential": str(private / "publisher.json"),
                "project_id": project,
                "bundle_sha256": ev.sha(n.raw(bundle)),
                "controller_manifest_sha256": source,
            }
            publication = nw.child(
                "publish", {**peer, "bundle_file": str(output / "bundle.json")}
            )
            scan_token = secrets.token_urlsafe(32)
            ev.write(private / "scanner.json", {"token": scan_token})
            scanner = RunningScanner(
                cfg, private / "scanner-live.sqlite3", scan_token, synthetic=synthetic
            )
            mint = "So11111111111111111111111111111111111111112"
            intake = {
                "scanner_origin": scanner.origin,
                "scanner_release_sha256": scanner.release["sha256"],
                "mint": mint,
                "rpc_hosts": ["rpc.test"] if synthetic else ["api.mainnet.solana.com"],
                "scanner_token_file": str(private / "scanner.json"),
                "directory": str(output / "http-feed"),
                "count": 2,
                "interval_seconds": 30,
                "test_cadence": synthetic,
                "classification": cfg["mode"],
            }
            first = child("collect", intake)
            fixtures = (
                Path(cfg["community_source"])
                / "projects/zoora-agent-community/tests/fixtures"
            )
            certificate = fixtures / "bridge-localhost-cert.pem"
            proxy = TLSProxy(
                scanner, certificate, fixtures / "bridge-localhost-public-test-key.pem"
            )
            tls_intake = {
                **intake,
                "scanner_origin": proxy.origin,
                "scanner_ca_file": str(certificate),
                "directory": str(output / "tls-feed"),
                "count": 1,
            }
            second = child("collect", tls_intake)
            # Correct package pin precedes credentials, even over an otherwise trusted TLS channel.
            mismatch = ScannerClient(
                origin=proxy.origin,
                release_sha256="f" * 64,
                mint=mint,
                rpc_hosts=intake["rpc_hosts"],
                token=scan_token,
                ca_file=certificate,
            )
            before = len(proxy.requests)
            rejected = mismatch.capture()
            lab.require(
                f.assess(rejected, mismatch.rules)["error"] == "FEED_RELEASE_MISMATCH"
                and len(proxy.requests) == before + 1
                and proxy.requests[-1][1] is False,
                "FEED_RELEASE_PROBE_AUTH_LEAK",
            )
            untrusted = ScannerClient(
                origin=proxy.origin,
                release_sha256=scanner.release["sha256"],
                mint=mint,
                rpc_hosts=intake["rpc_hosts"],
                token=scan_token,
            )
            before = len(proxy.requests)
            rejected = untrusted.capture()
            lab.require(
                f.assess(rejected, untrusted.rules)["status"] == "INTAKE_REJECTED"
                and len(proxy.requests) == before,
                "FEED_UNTRUSTED_TLS_HTTP",
            )
            proxy.redirect = True
            before = len(proxy.requests)
            valid = ScannerClient(
                origin=proxy.origin,
                release_sha256=scanner.release["sha256"],
                mint=mint,
                rpc_hosts=intake["rpc_hosts"],
                token=scan_token,
                ca_file=certificate,
            )
            rejected = valid.capture()
            lab.require(
                f.assess(rejected, valid.rules)["error"] == "FEED_HTTP_302"
                and len(proxy.requests) == before + 1,
                "FEED_REDIRECT_FOLLOWED",
            )
            proxy.redirect = False
            consume = {
                **peer,
                "expected_agent": observer,
                "credential": str(private / "observer.json"),
                "directory": str(output / "tls-feed"),
                "expected_head": second["head_sha256"],
                "output": str(output),
            }
            delivered = child("agent", consume)
            replay = child("agent", {k: v for k, v in consume.items() if k != "output"})
            lab.require(
                replay["receipt"]["replayed"] is True
                and delivered["receipt"]["job_id"] == replay["receipt"]["job_id"],
                "FEED_AGENT_REPLAY_CREATED_JOB",
            )
            ev.write(
                output / "delivery.json",
                {
                    "publication": publication["receipt"],
                    "observation": delivered["receipt"],
                    "project_id": project,
                    "instance_id": instance,
                    "mode": cfg["mode"],
                    "http": first,
                    "tls": second,
                    "release_before_bearer_checked": True,
                    "untrusted_tls_rejected": True,
                    "redirect_rejected": True,
                    "agent_replay_without_new_job": True,
                    "scanner_release": scanner.release,
                    "live_execution_allowed": False,
                },
            )
            for path in output.rglob("*"):
                if path.is_file():
                    data = path.read_bytes()
                    lab.require(
                        not any(
                            v.encode() in data
                            for v in (
                                owner,
                                publisher_cred["token"],
                                observer_cred["token"],
                                operator_a,
                                operator_b,
                                scan_token,
                            )
                        ),
                        "FEED_CREDENTIAL_LEAK",
                    )
        finally:
            try:
                if proxy is not None:
                    proxy.close()
            finally:
                try:
                    if scanner is not None:
                        scanner.close(output / "scanner.sqlite3")
                finally:
                    community.shutdown()
                    community_thread.join(10)
        ev.write(output / "audit.json", store.audit())
    return verify_lab(output, cfg)


def verify_lab(output, cfg):
    _, _, Store, _, _ = nw.components(cfg["community_source"])
    _, package_identity, _, _, _ = scanner_modules(cfg["scanner_source"])
    from aai_scanner.storage import verify_backup

    delivery = ev.read(output / "delivery.json")
    lab.require(
        delivery["mode"] == cfg["mode"]
        and cfg["mode"] in ("SYNTHETIC_TRANSPORT_TEST", "LIVE_PROVIDER_READS")
        and n.same(delivery["scanner_release"], package_identity()),
        "FEED_LAB_SOURCE_BINDING",
    )
    bundle = ev.read(output / "bundle.json")
    n.validate_bundle(bundle, cfg["controller_manifest_sha256"])
    states = {}
    for name in ("http", "tls"):
        folder = output / (name + "-feed")
        journal = f.ObservationJournal(
            folder / "observations.sqlite3", ev.read(folder / "policy.json")
        )
        lab.require(
            journal.rules["scanner_release_sha256"] == package_identity()["sha256"]
            and journal.rules["mint"] == "So11111111111111111111111111111111111111112"
            and journal.rules["rpc_hosts"]
            == (
                ["rpc.test"]
                if cfg["mode"] == "SYNTHETIC_TRANSPORT_TEST"
                else ["api.mainnet.solana.com"]
            )
            and journal.rules["authenticated_scanner"] is True,
            "FEED_LAB_POLICY_BINDING",
        )
        state = journal.snapshot(delivery[name]["head_sha256"])
        lab.require(
            len(state["events"]) == (2 if name == "http" else 1), "FEED_ATTEMPT_REPLAY"
        )
        states[name] = state
        if cfg["mode"] == "SYNTHETIC_TRANSPORT_TEST":
            lab.require(
                all(
                    e["assessment"]["status"] == "PARTIAL_OR_UNTRUSTED"
                    for e in state["events"]
                ),
                "FEED_SYNTHETIC_DECLARED_CURRENT",
            )
    report = ev.read(output / "agent-report.json")
    journal = f.ObservationJournal(
        output / "tls-feed/observations.sqlite3",
        ev.read(output / "tls-feed/policy.json"),
    )
    lab.require(
        n.same(
            report,
            f.agent_report(
                journal,
                bundle,
                cfg["controller_manifest_sha256"],
                states["tls"]["head_sha256"],
                report["evaluated_as_of_ms"],
            ),
        ),
        "FEED_AGENT_REPORT_REPLAY",
    )
    import sqlite3
    from contextlib import closing

    with closing(
        sqlite3.connect(
            (output / "agents/community.sqlite3").as_uri() + "?mode=ro", uri=True
        )
    ) as db:
        db.row_factory = sqlite3.Row
        lab.require(
            db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 2
            and db.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 2,
            "FEED_JOB_COUNTS",
        )
        for name, payload in (("publication", bundle), ("observation", report)):
            receipt = delivery[name]
            job = db.execute(
                "SELECT * FROM jobs WHERE id=?", (receipt["job_id"],)
            ).fetchone()
            artifact = db.execute(
                "SELECT * FROM artifacts WHERE id=?", (receipt["artifact_id"],)
            ).fetchone()
            lab.require(
                job is not None
                and artifact is not None
                and job["state"] == receipt["state"] == "SUCCEEDED"
                and job["agent_id"] == artifact["author_id"] == receipt["agent_id"]
                and job["project_id"]
                == artifact["project_id"]
                == receipt["project_id"]
                == delivery["project_id"]
                and job["artifact_id"] == artifact["id"]
                and job["report_sha256"]
                == artifact["digest"]
                == ev.sha(n.raw(payload))
                == receipt["report_sha256"]
                and job["report_bytes"]
                == receipt["report_bytes"]
                == len(n.raw(payload)),
                "FEED_JOB_REPORT_BINDING",
            )
    lab.require(
        n.same(ev.read(output / "agent-receipt.json"), delivery["observation"]),
        "FEED_RECEIPT_REPLAY",
    )
    scanner_snapshot = verify_backup(output / "scanner.sqlite3")
    with closing(
        sqlite3.connect(
            (output / "scanner.sqlite3").as_uri() + "?mode=ro&immutable=1", uri=True
        )
    ) as db:
        stored = [
            ev.parse(row[0].encode())
            for row in db.execute("SELECT report FROM observations ORDER BY id")
        ]
    received = {}
    for state in states.values():
        for event in state["events"]:
            if event["assessment"]["projection"] is not None:
                record = event["record"]["responses"]["scan"]
                report_value = f.response_value(
                    record,
                    "POST",
                    "/api/scan",
                    {"mint": journal.rules["mint"], "refresh": False},
                )
                report_value["cached"] = False
                received[ev.sha(n.raw(report_value))] = report_value
    lab.require(
        len(stored) == len(received)
        and all(ev.sha(n.raw(value)) in received for value in stored),
        "FEED_SCANNER_SNAPSHOT_REPLAY",
    )
    lab.require(
        n.same(Store(output / "agents").audit(), ev.read(output / "audit.json")),
        "FEED_COMMUNITY_AUDIT",
    )
    lab.require(
        all(
            delivery.get(k) is True
            for k in (
                "release_before_bearer_checked",
                "untrusted_tls_rejected",
                "redirect_rejected",
                "agent_replay_without_new_job",
            )
        )
        and delivery["live_execution_allowed"] is False,
        "FEED_TRANSPORT_CLAIMS",
    )
    statuses = [
        e["assessment"]["status"] for state in states.values() for e in state["events"]
    ]
    return {
        "protocol": "AAI_SCANNER_FEED_SUMMARY_V1",
        "mode": cfg["mode"],
        "capture_attempts": len(statuses),
        "statuses": {s: statuses.count(s) for s in sorted(set(statuses))},
        "http_attempts": 2,
        "tls_attempts": 1,
        "completed_jobs": 2,
        "job_artifacts": 2,
        "available_models": 4,
        "scanner_persisted_reports": scanner_snapshot["observations"],
        "synthetic_rejected_as_observed": cfg["mode"] == "SYNTHETIC_TRANSPORT_TEST",
        "scanner_release_before_auth": True,
        "verified_tls": True,
        "agent_replay_without_new_job": True,
        "model_input_contract": report["model_input_contract"],
        "model_inference_performed": False,
        "training_performed": False,
        "research_signal": "ABSTAIN",
        "live_execution_allowed": False,
    }


def child(action, cfg):
    import subprocess
    from src.ecosystem_research.checkout import worker_environment

    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "packet.json"
        ev.write(path, cfg)
        path.chmod(0o600)
        result = subprocess.run(
            [
                sys.executable,
                "-I",
                "-B",
                str(Path(__file__).resolve()),
                action,
                str(path),
            ],
            env=worker_environment(),
            capture_output=True,
            timeout=180,
            check=False,
        )
    lab.require(
        len(result.stdout) + len(result.stderr) <= 1024**2, "FEED_WORKER_LOG_BOUND"
    )
    if result.returncode:
        try:
            code = ev.parse(result.stdout).get("error", "INVALID_OUTPUT")
        except ValueError:
            code = "INVALID_OUTPUT"
        raise ValueError("FEED_CHILD_REJECTED:" + str(code)[:180])
    return ev.parse(result.stdout)


def main():
    action, packet = sys.argv[1], Path(sys.argv[2])
    try:
        lab.require(packet.stat().st_size <= 16384, "FEED_PACKET_BOUND")
        cfg = ev.read(packet)
        if action == "collect":
            result = collect(cfg)
        elif action == "agent":
            result = agent(cfg)
        elif action == "lab-build":
            result = run_lab(Path(cfg["output"]), cfg)
        elif action == "lab-verify":
            result = verify_lab(Path(cfg["output"]), cfg)
        elif action == "status":
            folder = Path(cfg["directory"])
            result = f.ObservationJournal(
                folder / "observations.sqlite3", ev.read(folder / "policy.json")
            ).status(time.time_ns() // 1000000)
        else:
            raise ValueError("FEED_WORKER_ACTION")
        print(ev.canonical({"verified": True, **result}))
        return 0
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        code = getattr(error, "code", None)
        if code is None:
            if isinstance(error, ValueError):
                code = str(error)
            else:
                # Keep failures diagnosable across operating systems without
                # exposing exception arguments, credentials or private paths.
                frames, trace = [], error.__traceback__
                while trace is not None:
                    frames.append(
                        Path(trace.tb_frame.f_code.co_filename).name
                        + ":"
                        + str(trace.tb_lineno)
                    )
                    trace = trace.tb_next
                code = (
                    type(error).__name__
                    + ":"
                    + str(getattr(error, "errno", None))
                    + ":"
                    + "/".join(frames[-3:])
                )
        print(
            ev.canonical(
                {
                    "status": "FEED_REJECTED",
                    "error": str(code)[:250],
                    "live_execution_allowed": False,
                }
            )
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
