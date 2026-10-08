"""Operational boundaries. Fixtures are SYNTHETIC; no live provider calls."""
import io
import json
import os
import sqlite3
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from src.aai_scanner.config import Config
from src.aai_scanner.operations import data_readiness, readiness
from src.aai_scanner.service import Scanner
from src.aai_scanner.storage import Store, restore_backup, verify_backup
from src.aai_scanner.web import Application
from tests.scanner_fixtures import FakeMarket, FakeRPC, MINT


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.store = Store(str(self.root / "live.sqlite3"))
        self.addCleanup(self.store.close)
        self.store.add_watch(MINT)
        self.store.set_state("telegram_offset", 123)

    def test_online_backup_and_new_file_restore_preserve_data_and_are_private(self):
        Scanner(Config(), self.store, FakeRPC(), FakeMarket()).scan(MINT)
        backup, restored = self.root / "backup.sqlite3", self.root / "restored.sqlite3"
        self.store.backup(backup)
        before = backup.read_bytes()
        self.assertEqual(verify_backup(backup)["watches"], 1)
        self.assertEqual(backup.read_bytes(), before, "verification must not change the snapshot")
        restore_backup(backup, restored)
        db = Store(str(restored))
        try:
            self.assertEqual(db.get_state("telegram_offset"), "123")
            self.assertEqual(db.watches()[0]["mint"], MINT)
            self.assertEqual(len(db.history(MINT)), 1)
        finally:
            db.close()
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        self.assertFalse(Path(str(backup) + "-wal").exists())
        self.assertEqual(self.store.watches()[0]["mint"], MINT)

    def test_dangling_symlink_and_existing_destinations_are_preserved(self):
        target, outside = self.root / "backup.sqlite3", self.root / "untouched.sqlite3"
        target.symlink_to(outside)
        with self.assertRaises(ValueError):
            self.store.backup(target)
        self.assertTrue(target.is_symlink())
        self.assertFalse(outside.exists())

    def test_publication_race_never_overwrites_new_destination(self):
        target = self.root / "backup.sqlite3"
        original_link = os.link
        def race(source, destination):
            Path(destination).write_bytes(b"preserve concurrent file")
            return original_link(source, destination)
        with patch("src.aai_scanner.storage.os.link", side_effect=race), self.assertRaises(FileExistsError):
            self.store.backup(target)
        self.assertEqual(target.read_bytes(), b"preserve concurrent file")
        self.assertEqual(list(self.root.glob(".scanner-backup-*")), [])

    def test_failed_verification_publishes_nothing(self):
        target = self.root / "backup.sqlite3"
        with patch("src.aai_scanner.storage.verify_backup", side_effect=ValueError("corrupt")), self.assertRaises(ValueError):
            self.store.backup(target)
        self.assertFalse(target.exists())
        self.assertEqual(list(self.root.glob(".scanner-backup-*")), [])

    def test_restore_refuses_existing_live_file_and_stale_sidecar(self):
        backup = self.root / "backup.sqlite3"
        self.store.backup(backup)
        with self.assertRaises(ValueError):
            restore_backup(backup, self.store.path)
        target = self.root / "restore.sqlite3"
        Path(str(target) + "-wal").write_bytes(b"existing WAL")
        with self.assertRaises(ValueError):
            restore_backup(backup, target)
        self.assertFalse(target.exists())
        self.assertEqual(self.store.get_state("telegram_offset"), "123")

    def test_corrupt_wrong_schema_and_future_version_backups_are_rejected(self):
        for name, content in (("corrupt", b"not SQLite"), ("empty", b"")):
            source = self.root / name
            source.write_bytes(content)
            with self.assertRaises((ValueError, sqlite3.Error)):
                restore_backup(source, self.root / (name + "-restore"))
            self.assertFalse((self.root / (name + "-restore")).exists())
        source = self.root / "future.sqlite3"
        self.store.backup(source)
        db = sqlite3.connect(source)
        db.execute("PRAGMA user_version=2")
        db.close()
        with self.assertRaises(ValueError):
            verify_backup(source)

    def test_verifier_rejects_symlink_and_snapshot_with_sidecars(self):
        source = self.root / "backup.sqlite3"
        self.store.backup(source)
        link = self.root / "link.sqlite3"
        link.symlink_to(source)
        with self.assertRaises(ValueError):
            verify_backup(link)
        Path(str(source) + "-shm").write_bytes(b"sidecar")
        with self.assertRaises(ValueError):
            verify_backup(source)

    def test_probe_rolls_back_state_and_detects_read_only_storage(self):
        self.store.set_state("readiness_probe", "original")
        self.assertEqual(self.store.probe(integrity=True)["integrity"], "PASSED")
        self.assertEqual(self.store.get_state("readiness_probe"), "original")
        self.store.db.execute("PRAGMA query_only=ON")
        result = readiness(Config(), self.store)
        self.assertFalse(result["application_ready"])
        self.assertEqual(result["checks"]["storage"]["code"], "STORAGE_CHECK_FAILED")

    def test_existing_version_one_schema_is_not_silently_repaired(self):
        source = self.root / "missing-table.sqlite3"
        db = sqlite3.connect(source)
        db.execute("PRAGMA user_version=1")
        db.close()
        with self.assertRaises(ValueError):
            Store(str(source))
        db = sqlite3.connect(source)
        self.assertEqual(db.execute("SELECT name FROM sqlite_master").fetchall(), [])
        db.close()

    def test_backup_budget_failure_cleans_up_unpublished_snapshot(self):
        target = self.root / "timeout.sqlite3"
        with patch("src.aai_scanner.storage.time.monotonic", side_effect=[0, 31]), self.assertRaises(RuntimeError):
            self.store.backup(target)
        self.assertFalse(target.exists())
        self.assertEqual(list(self.root.glob(".scanner-backup-*")), [])


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.addCleanup(self.store.close)
        self.config = replace(Config(), api_token="a" * 32)
        self.scanner = Scanner(self.config, self.store, FakeRPC(), FakeMarket())
        self.app = Application(self.config, self.store, self.scanner)

    def request(self, path="/api/ready", token="a" * 32, method="GET"):
        env = {"PATH_INFO": path, "REQUEST_METHOD": method, "HTTP_HOST": "127.0.0.1:8787",
               "HTTP_AUTHORIZATION": "Bearer " + token, "REMOTE_ADDR": "127.0.0.1", "wsgi.input": io.BytesIO()}
        response = {}
        def start(status, headers):
            response.update(code=int(status.split()[0]), headers=dict(headers))
        response["body"] = json.loads(b"".join(self.app(env, start)))
        return response

    def test_unauthenticated_health_does_not_expose_readiness_details(self):
        self.assertEqual(self.request(token="wrong")["code"], 401)
        health = self.request(path="/api/health", token="wrong")
        self.assertEqual(health["code"], 200)
        self.assertEqual(health["body"]["scope"], "PROCESS_ONLY")
        self.assertNotIn("checks", health["body"])

    def test_ready_local_service_does_not_invent_live_data_or_contact_providers(self):
        response = self.request()
        self.assertEqual(response["code"], 200)
        self.assertTrue(response["body"]["application_ready"])
        self.assertEqual(response["body"]["data"]["status"], "UNVERIFIED")
        self.assertEqual(response["body"]["public_launch"], "UNVERIFIED")
        self.assertEqual(self.scanner.rpc.calls, [])
        self.assertEqual(self.scanner.market.calls, [])
        self.assertEqual(response["headers"]["Cache-Control"], "no-store")

    def test_storage_failure_is_503_with_safe_code_and_health_stays_process_only(self):
        self.store.db.execute("PRAGMA query_only=ON")
        response = self.request()
        self.assertEqual(response["code"], 503)
        self.assertEqual(response["body"]["checks"]["storage"]["code"], "STORAGE_CHECK_FAILED")
        self.assertEqual(self.request(path="/api/health")["code"], 200)

    def test_missing_assets_and_wrong_runtime_dependency_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder, patch("src.aai_scanner.operations.STATIC", Path(folder)):
            self.assertEqual(self.request()["code"], 503)
        with patch("src.aai_scanner.operations.metadata.version", return_value="unsupported"):
            self.assertEqual(self.request()["code"], 503)

    def test_readiness_requires_get(self):
        self.assertEqual(self.request(method="POST")["code"], 405)

    def test_last_report_complete_partial_stale_missing_and_future_timestamps(self):
        current = datetime(2026, 10, 8, tzinfo=timezone.utc)
        coverage = {"available_at": current.isoformat(), "complete": True, "missing_sections": []}
        self.assertEqual(data_readiness(coverage, current)["status"], "AVAILABLE")
        coverage.update(complete=False, missing_sections=["largest_token_accounts"])
        self.assertEqual(data_readiness(coverage, current)["status"], "UNAVAILABLE")
        self.assertEqual(data_readiness(coverage, current + timedelta(seconds=121))["status"], "STALE")
        self.assertEqual(data_readiness(coverage, current - timedelta(seconds=1))["status"], "UNVERIFIED")
        for value in (None, "bad timestamp", "2026-10-08T00:00:00"):
            coverage["available_at"] = value
            self.assertEqual(data_readiness(coverage, current)["status"], "UNVERIFIED")

    def test_actual_partial_report_coverage_is_distinct_from_application_health(self):
        self.scanner.rpc.fail.add("getTokenLargestAccounts")
        self.scanner.scan(MINT)
        response = self.request()
        self.assertEqual(response["code"], 200)
        self.assertEqual(response["body"]["data"]["status"], "UNAVAILABLE")
        self.assertIn("largest_token_accounts", response["body"]["data"]["missing_sections"])

    def test_deployment_doctor_requires_private_listener_https_access_and_absolute_database(self):
        self.assertFalse(readiness(self.config, self.store, deployment=True)["application_ready"])
        prepared = replace(self.config, public_mode=True, public_url="https://scanner.example", database="/var/lib/aai-scanner/db.sqlite3")
        self.assertTrue(readiness(prepared, self.store, deployment=True)["application_ready"])
        for changes in ({"host": "0.0.0.0"}, {"database": "relative.sqlite3"}, {"port": 8888}):
            self.assertFalse(readiness(replace(prepared, **changes), self.store, deployment=True)["application_ready"])
