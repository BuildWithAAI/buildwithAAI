"""Temporal source gates, durable intake and real loopback client boundaries."""

from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sqlite3
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from src.ecosystem_research import scanner_feed as f
from src.ecosystem_research.scanner_client import ScannerClient
from src.solana_research import coin_evidence as ev
from feed_fixtures import (
    MINT,
    NOW,
    RELEASE,
    health,
    iso,
    record,
    report,
    rules,
    ready,
    wire,
)


class FeedProjectionTests(unittest.TestCase):
    def test_declared_core_schema_does_not_establish_upstream_truth_or_execution(self):
        value = f.assess(record(), rules())
        self.assertEqual(value["status"], "CURRENT_CORE_DECLARED")
        self.assertEqual(value["projection"]["facts"]["price_usd"], "2")
        self.assertIn("NOT_INDEPENDENT", value["projection"]["source_attestation"])
        self.assertFalse(value["live_execution_allowed"])

    def test_synthetic_receipts_never_become_current_observed_core(self):
        value = report()
        value["network_evidence"]["quality_flags"] = ["SYNTHETIC_TEST_FIXTURE"]
        projected = f.project_report(value, rules(), NOW)
        self.assertEqual(projected["status"], "PARTIAL_OR_UNTRUSTED")
        self.assertTrue(all(v is None for v in projected["facts"].values()))

    def test_stale_or_future_reports_clear_current_facts(self):
        for moment in (NOW - 120001, NOW + 1):
            value = report()
            value["available_at"] = iso(moment)
            projected = f.project_report(value, rules(), NOW)
            self.assertIn("REPORT_STALE_OR_FUTURE", projected["issues"]["report"])
            self.assertTrue(all(v is None for v in projected["facts"].values()))

    def test_missing_value_is_not_replaced_with_zero_and_zero_liquidity_is_preserved(
        self,
    ):
        value = report()
        value["market"]["liquidity_usd"]["value"] = "0"
        self.assertEqual(
            f.project_report(value, rules(), NOW)["facts"]["reported_liquidity_usd"],
            "0",
        )
        value["market"]["liquidity_usd"]["value"] = None
        self.assertIsNone(
            f.project_report(value, rules(), NOW)["facts"]["reported_liquidity_usd"]
        )

    def test_bool_price_and_missing_source_hash_are_rejected_as_measurements(self):
        value = report()
        value["market"]["price_usd"]["value"] = True
        self.assertIsNone(f.project_report(value, rules(), NOW)["facts"]["price_usd"])
        value = report()
        value["market"]["price_usd"]["source"]["raw_sha256"] = None
        self.assertIn(
            "SOURCE_HASH", f.project_report(value, rules(), NOW)["issues"]["usd_price"]
        )

    def test_wrong_network_and_wrong_provider_host_remain_untrusted(self):
        value = report()
        value["network_evidence"]["genesis_hash"] = "wrong"
        self.assertIn(
            "MAINNET_UNCONFIRMED",
            f.project_report(value, rules(), NOW)["issues"]["network"],
        )
        value = report()
        value["market"]["price_usd"]["source"]["endpoint_host"] = "unapproved.test"
        self.assertIn(
            "SOURCE_HOST", f.project_report(value, rules(), NOW)["issues"]["usd_price"]
        )

    def test_wrong_mint_is_an_intake_error(self):
        value = record()
        decoded = report()
        decoded["mint"] = "1" * 32
        value["responses"]["scan"] = wire(
            decoded, "POST", "/api/scan", {"mint": MINT, "refresh": False}
        )
        del value["responses"]["health_after"]
        self.assertEqual(f.assess(value, rules())["error"], "FEED_REPORT_ADDRESS")

    def test_changed_release_and_request_after_rejection_fail_closed(self):
        value = record()
        wrong = health()
        wrong["release"]["sha256"] = "f" * 64
        value["responses"] = {"health_before": wire(wrong)}
        self.assertEqual(f.assess(value, rules())["error"], "FEED_RELEASE_MISMATCH")
        value["responses"]["ready"] = wire(ready(), path="/api/ready")
        with self.assertRaisesRegex(ValueError, "REQUEST_AFTER_REJECTION"):
            f.assess(value, rules())

    def test_no_store_and_wire_digest_are_enforced(self):
        for change in ({"no_store": False}, {"raw_sha256": "f" * 64}):
            value = record()
            value["responses"] = {"health_before": value["responses"]["health_before"]}
            value["responses"]["health_before"].update(change)
            self.assertEqual(f.assess(value, rules())["status"], "INTAKE_REJECTED")

    def test_bad_report_collection_and_bad_mint_units_do_not_become_facts(self):
        value = report()
        value["holders"]["accounts"] = None
        self.assertIsNone(
            f.project_report(value, rules(), NOW)["facts"]["largest_token_accounts"]
        )
        value = report()
        value["mint_info"]["decimals"] = True
        self.assertIsNone(
            f.project_report(value, rules(), NOW)["facts"]["mint_authority_active"]
        )


class FeedJournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "feed.sqlite3"
        self.journal = f.ObservationJournal(self.path, rules()).initialize()

    def append(self, value=None):
        return self.journal.append(
            record() if value is None else value, self.journal.snapshot()["head_sha256"]
        )

    def test_standalone_snapshot_flushes_a_writable_file_and_never_overwrites(self):
        destination = Path(self.temp.name) / "snapshot.sqlite3"
        real_sync = os.fsync
        flushed = []

        def sync(descriptor):
            # A zero-byte write checks handle access without changing bytes.
            import stat

            if stat.S_ISREG(os.fstat(descriptor).st_mode):
                os.write(descriptor, b"")
                flushed.append(True)
            real_sync(descriptor)

        with closing(sqlite3.connect(self.path)) as source:
            with patch.object(f.os, "fsync", side_effect=sync):
                f.publish_sqlite_snapshot(source, destination)
            self.assertTrue(flushed)
            with closing(sqlite3.connect(destination)) as copied:
                self.assertEqual(
                    copied.execute("PRAGMA integrity_check").fetchall(), [("ok",)]
                )
                self.assertEqual(
                    copied.execute("PRAGMA journal_mode").fetchone()[0], "delete"
                )
                self.assertEqual(
                    copied.execute("SELECT * FROM metadata").fetchall(),
                    source.execute("SELECT * FROM metadata").fetchall(),
                )
            original = destination.read_bytes()
            with self.assertRaisesRegex(ValueError, "SNAPSHOT_EXISTS"):
                f.publish_sqlite_snapshot(source, destination)
            self.assertEqual(destination.read_bytes(), original)
        self.assertFalse(any(Path(self.temp.name).glob(".feed-snapshot-*")))

    def test_reopen_and_cold_process_preserve_committed_intake(self):
        first = self.append()
        reopened = f.ObservationJournal(self.path, rules())
        self.assertEqual(reopened.snapshot()["head_sha256"], first["head_sha256"])
        config = Path(self.temp.name) / "rules.json"
        ev.write(config, rules())
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                "-c",
                "from pathlib import Path;import sys;from src.ecosystem_research.scanner_feed import ObservationJournal;"
                "from src.solana_research.coin_evidence import read;print(ObservationJournal(Path(sys.argv[1]),read(Path(sys.argv[2]))).snapshot()['head_sha256'])",
                str(self.path),
                str(config),
            ],
            capture_output=True,
            timeout=20,
            check=False,
            cwd=Path(__file__).resolve().parents[1],
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.decode().strip(), first["head_sha256"])

    def test_repeated_cached_report_does_not_inflate_unique_reports(self):
        self.append()
        cached = report()
        cached["cached"] = True
        self.append(record(NOW + 1000, cached))
        self.assertEqual(len(self.journal.snapshot()["events"]), 2)
        self.assertEqual(self.journal.snapshot()["unique_reports"], 1)

    def test_exact_delivery_retry_does_not_add_an_event(self):
        first = self.append()
        retry = self.append()
        self.assertTrue(retry["replayed"])
        self.assertEqual(retry["head_sha256"], first["head_sha256"])
        self.assertEqual(len(self.journal.snapshot()["events"]), 1)

    def test_stale_expected_head_and_clock_rewind_make_no_change(self):
        old = self.journal.snapshot()["head_sha256"]
        self.append()
        current = self.journal.snapshot()["head_sha256"]
        with self.assertRaisesRegex(ValueError, "COMPARE_AND_SWAP"):
            self.journal.append(record(NOW + 1), old)
        with self.assertRaisesRegex(ValueError, "CLOCK_REWIND"):
            self.journal.append(record(NOW - 1), current)
        self.assertEqual(self.journal.snapshot()["head_sha256"], current)

    def test_expired_genesis_is_rechecked_at_read_time(self):
        value = report()
        value["network_evidence"]["available_at"] = iso(NOW - 290000)
        self.append(record(model=value))
        self.assertTrue(self.journal.status(NOW)["current_core_declared"])
        self.assertFalse(self.journal.status(NOW + 20000)["current_core_declared"])

    def test_latest_historical_status_is_not_a_current_health_claim(self):
        self.append()
        status = self.journal.status(NOW + 121000)
        self.assertEqual(status["latest_status"], "CURRENT_CORE_DECLARED")
        self.assertFalse(status["current_retrieval"])
        self.assertEqual(status["action"], "NO_EXECUTION")

    def test_rehashed_changed_projection_still_fails_replay(self):
        self.append()
        with closing(sqlite3.connect(self.path)) as db, db:
            value = ev.parse(
                db.execute("SELECT body FROM events").fetchone()[0].encode()
            )
            value["assessment"]["projection"]["facts"]["price_usd"] = "999"
            value["sha256"] = ev.digest(
                {k: v for k, v in value.items() if k != "sha256"}
            )
            db.execute("UPDATE events SET body=?", (ev.canonical(value),))
        with self.assertRaisesRegex(ValueError, "EVENT_REPLAY"):
            self.journal.snapshot()

    def test_missing_or_changed_policy_is_rejected(self):
        changed = rules()
        changed["rpc_hosts"] = ["other.test"]
        with self.assertRaisesRegex(ValueError, "POLICY_BINDING"):
            f.ObservationJournal(self.path, changed).snapshot()

    def test_growth_failure_rolls_back_record_and_checkpoint(self):
        big = record()
        source = health()
        source["note"] = "x" * 100000
        big["responses"]["health_before"] = wire(source)
        before = self.journal.snapshot()["head_sha256"]
        with patch.object(f, "MAX_DATABASE", self.path.stat().st_size + 4096):
            with self.assertRaisesRegex(ValueError, "DATABASE_BOUND"):
                self.journal.append(big, before)
        self.assertEqual(self.journal.snapshot()["head_sha256"], before)

    def test_agent_report_binds_models_but_refuses_unqualified_feature_mapping(self):
        self.append()
        bundle = ev.read(
            Path(__file__).parent / "fixtures/ecosystem-network-bundle.json"
        )
        source = "b521bad111dab36cc42d20bcc29d041d25b4f7f2cbcb39261bf8b65280991ecd"
        value = f.agent_report(
            self.journal, bundle, source, self.journal.snapshot()["head_sha256"], NOW
        )
        self.assertEqual(len(value["available_advisory_models"]), 4)
        self.assertFalse(value["model_inference_performed"])
        self.assertFalse(value["training_performed"])
        self.assertTrue(value["model_input_contract"].startswith("BLOCKED_"))


class FeedClientTests(unittest.TestCase):
    def setUp(self):
        self.calls, self.override = [], {}
        self.token = "explicit_unit_test_token_1234567890123456"
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                self.reply()

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", 0)))
                self.reply()

            def reply(self):
                outer.calls.append((self.path, self.headers.get("Authorization")))
                now = time.time_ns() // 1000000
                code, value, extra = outer.override.get(
                    self.path,
                    (
                        200,
                        health(now)
                        if self.path == "/api/health"
                        else ready()
                        if self.path == "/api/ready"
                        else report(now),
                        {},
                    ),
                )
                payload = ev.canonical(value).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(payload)))
                for key, value in extra.items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(payload)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.01}
        )
        self.thread.start()
        self.addCleanup(self.close)
        self.client = ScannerClient(
            origin="http://127.0.0.1:" + str(self.server.server_port),
            release_sha256=RELEASE,
            mint=MINT,
            rpc_hosts=["rpc.test"],
            token=self.token,
        )

    def close(self):
        self.server.shutdown()
        self.thread.join(5)
        self.server.server_close()

    def test_actual_wire_flow_and_authentication_scope(self):
        value = self.client.capture()
        self.assertEqual(
            f.assess(value, self.client.rules)["status"], "CURRENT_CORE_DECLARED"
        )
        self.assertEqual(
            [p for p, _ in self.calls],
            ["/api/health", "/api/ready", "/api/scan", "/api/health"],
        )
        self.assertIsNone(self.calls[0][1])
        self.assertIsNone(self.calls[-1][1])
        self.assertTrue(self.calls[1][1].startswith("Bearer "))

    def test_wrong_release_stops_before_bearer_or_scan(self):
        bad = health(time.time_ns() // 1000000)
        bad["release"]["sha256"] = "f" * 64
        self.override["/api/health"] = (200, bad, {})
        value = self.client.capture()
        self.assertEqual(
            f.assess(value, self.client.rules)["error"], "FEED_RELEASE_MISMATCH"
        )
        self.assertEqual(len(self.calls), 1)
        self.assertIsNone(self.calls[0][1])

    def test_redirect_and_rate_limit_are_not_retried_or_followed(self):
        self.override["/api/scan"] = (429, {"error": "busy"}, {"Retry-After": "120"})
        value = self.client.capture()
        self.assertEqual(f.assess(value, self.client.rules)["error"], "FEED_HTTP_429")
        self.assertEqual(value["responses"]["scan"]["retry_after_seconds"], 120)
        self.calls.clear()
        self.override["/api/health"] = (
            302,
            {},
            {"Location": "http://127.0.0.1:1/never"},
        )
        self.client.capture()
        self.assertEqual(len(self.calls), 1)

    def test_echoed_credential_is_not_retained(self):
        self.override["/api/scan"] = (200, {"stolen": self.token}, {})
        value = self.client.capture()
        self.assertEqual(value["io_error"]["code"], "CREDENTIAL_ECHO")
        self.assertNotIn(self.token, ev.canonical(value))

    def test_metadata_credential_echo_is_not_retained(self):
        self.override["/api/scan"] = (200, {}, {"Content-Type": self.token})
        value = self.client.capture()
        self.assertEqual(value["responses"]["scan"]["content_type"], "UNSUPPORTED")
        self.assertEqual(
            f.assess(value, self.client.rules)["error"], "FEED_HTTP_HEADERS"
        )
        self.assertNotIn(self.token, ev.canonical(value))

    def test_cli_collect_resume_status_and_stale_head_before_io(self):
        root = Path(__file__).resolve().parents[1]
        command = [sys.executable, "-B", str(root / "scripts/run_scanner_feed.py")]

        def invoke(arguments, expected_code=0):
            result = subprocess.run(
                command + arguments,
                cwd=root,
                capture_output=True,
                timeout=30,
                check=False,
            )
            self.assertEqual(
                result.returncode, expected_code, result.stdout + result.stderr
            )
            return ev.parse(result.stdout)

        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            credential = folder / "scanner-token.json"
            ev.write(credential, {"token": self.token})
            arguments = [
                "collect",
                "--directory",
                str(folder / "feed"),
                "--community-python",
                sys.executable,
                "--scanner-origin",
                self.client.origin,
                "--scanner-release-sha256",
                RELEASE,
                "--mint",
                MINT,
                "--rpc-host",
                "rpc.test",
                "--scanner-token-file",
                str(credential),
            ]
            first = invoke(arguments)
            second = invoke(arguments + ["--expected-head", first["head_sha256"]])
            self.assertEqual(second["attempts"], 2)
            before = len(self.calls)
            rejected = invoke(arguments + ["--expected-head", "f" * 64], 2)
            self.assertIn("FEED_EXPECTED_HEAD", rejected["error"])
            self.assertEqual(len(self.calls), before)
            status = invoke(["status", "--directory", str(folder / "feed")])
            self.assertEqual(status["head_sha256"], second["head_sha256"])
            self.assertTrue(status["current_retrieval"])
            self.assertFalse(status["live_execution_allowed"])

    def test_non_loopback_plaintext_and_bad_origins_fail_before_io(self):
        for origin in (
            "http://scanner.test",
            "http://127.0.0.1:0",
            "https://scanner.test/path",
            "https://user:pass@scanner.test",
        ):
            with self.assertRaises(ValueError):
                ScannerClient(
                    origin=origin,
                    release_sha256=RELEASE,
                    mint=MINT,
                    rpc_hosts=["rpc.test"],
                    token=self.token,
                )


if __name__ == "__main__":
    unittest.main()
