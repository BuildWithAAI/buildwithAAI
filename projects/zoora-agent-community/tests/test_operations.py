import hashlib
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch

from helpers import Fixture
from zoora_community.operations import ROOT, Runtime, doctor, monitor, package_snapshot
from zoora_community.recovery import copy_snapshot, restore_backup, verify_backup
from zoora_community.store import Store
from zoora_community.validation import Problem


class OperationsTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(real_time=True)
        self.addCleanup(self.f.close)
        _, self.operator = self.f.operator()
        self.agent_id, self.agent = self.f.agent(self.operator)

    def backup(self):
        path = self.f.root / "snapshot.sqlite3"
        self.f.store.backup(path)
        return path

    def test_doctor_checks_audit_and_rolled_back_write_without_mutation(self):
        before = self.f.store.path.read_bytes()
        result = doctor(self.f.state)
        self.assertEqual(result["audit"], self.f.store.audit())
        self.assertEqual(result["checks"]["database_write_rollback"], "AVAILABLE")
        self.assertEqual(self.f.store.path.read_bytes(), before)

    def test_package_snapshot_changes_with_code_and_freezes_assets(self):
        import shutil
        package = self.f.root / "package"
        shutil.copytree(ROOT / "zoora_community", package / "zoora_community", ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copytree(ROOT / "web", package / "web")
        shutil.copyfile(ROOT / "requirements.lock", package / "requirements.lock")
        digest, assets = package_snapshot(package)
        page = package / "web/index.html"
        page.write_bytes(b"replacement")
        updated, _ = package_snapshot(package)
        self.assertNotEqual(digest, updated)
        self.assertNotEqual(assets["/"][0], b"replacement")
        module = package / "zoora_community/__init__.py"
        module.write_text('VERSION="changed"\n', encoding="utf-8")
        self.assertNotEqual(updated, package_snapshot(package)[0])

    def test_snapshot_reaudit_restore_and_credentials_are_explicitly_preserved(self):
        backup = self.backup()
        before = hashlib.sha256(backup.read_bytes()).hexdigest()
        verified = verify_backup(backup)
        self.assertEqual(verified["audit"], self.f.store.audit())
        state = self.f.root / "restored"
        result = restore_backup(backup, state)
        self.assertFalse(result["all_previous_credentials_revoked"])
        restored = Store(state)
        self.assertEqual(restored.audit(), verified["audit"])
        self.assertEqual(restored.call("GET", "/v1/me", token=self.agent)[0], 200)
        self.assertEqual(restored.call("GET", "/v1/agents/" + self.agent_id + "/wallet-proof")[1]["status"], "SIGNATURE_VERIFIED")
        self.assertEqual(hashlib.sha256(backup.read_bytes()).hexdigest(), before)
        if os.name == "posix":
            self.assertEqual(state.stat().st_mode & 0o777, 0o700)
            self.assertEqual(restored.path.stat().st_mode & 0o777, 0o600)

    def test_tampered_audit_rejected_before_publication(self):
        backup = self.backup()
        with sqlite3.connect(backup) as connection:
            connection.execute("UPDATE audit SET hash=? WHERE seq=1", ("f" * 64,))
        for action in (lambda: verify_backup(backup), lambda: restore_backup(backup, self.f.root / "rejected")):
            with self.assertRaises(Problem) as rejected:
                action()
            self.assertEqual(rejected.exception.code, "AUDIT_CHAIN_FAILURE")
        self.assertFalse(self.f.root.joinpath("rejected").exists())

    def test_tampered_proof_rejected_and_backup_not_published(self):
        with closing(self.f.store._connection()) as connection:
            connection.execute("UPDATE wallet_proofs SET signature=?", ("A" * 86 + "==",))
        destination = self.f.root / "invalid.sqlite3"
        with self.assertRaises(Problem):
            self.f.store.backup(destination)
        self.assertFalse(destination.exists())
        self.assertFalse(list(self.f.root.glob(".zoora-backup-*")))

    def test_existing_backup_and_state_are_never_overwritten(self):
        backup = self.backup()
        before = backup.read_bytes()
        with self.assertRaises(FileExistsError):
            self.f.store.backup(backup)
        self.assertEqual(backup.read_bytes(), before)
        with self.assertRaises(FileExistsError):
            restore_backup(backup, self.f.state)
        self.f.store.audit()
        empty = self.f.root / "empty"
        empty.mkdir(mode=0o700)
        with self.assertRaises(FileExistsError):
            restore_backup(backup, empty)
        self.assertEqual(list(empty.iterdir()), [])

    def test_sidecars_and_symlinks_are_rejected(self):
        backup = self.backup()
        sidecar = Path(str(backup) + "-wal")
        sidecar.write_bytes(b"unverified journal")
        with self.assertRaises(Problem) as rejected:
            verify_backup(backup)
        self.assertEqual(rejected.exception.code, "BACKUP_SIDECAR_PRESENT")
        sidecar.unlink()
        if os.name == "posix":
            link = self.f.root / "link.sqlite3"
            link.symlink_to(backup)
            with self.assertRaises(Problem):
                verify_backup(link)

    def test_copy_deadline_failure_does_not_publish_backup(self):
        with closing(self.f.store._connection()) as source:
            with self.assertRaises(Problem) as rejected:
                copy_snapshot(source, self.f.root / "incomplete.sqlite3", deadline_seconds=0)
        self.assertEqual(rejected.exception.code, "BACKUP_TIMEOUT")

    def test_probe_clock_regression_fails_closed_and_leaves_records_intact(self):
        before = self.f.store.path.read_bytes()
        self.f.store.clock = lambda: 0
        with self.assertRaises(Problem) as rejected:
            self.f.store.storage_probe(local=True)
        self.assertEqual(rejected.exception.code, "CLOCK_REGRESSION")
        self.assertEqual(self.f.store.path.read_bytes(), before)

    def test_monitor_refuses_identity_mismatch_and_existing_output(self):
        credential = self.f.owner_path
        report = Runtime(self.f.store, "WAITRESS_3_0_2").ready(local=True)
        for changes in ({"package_digest": "f" * 64}, {"transport": "DEVELOPMENT_HTTP"}, {"checks": {"instance_id": "wrong"}}, {"scope": "PROCESS_LIVENESS"}):
            with patch("zoora_community.operations.Client.request", return_value=(200, dict(report, **changes))):
                with self.assertRaises(Problem) as rejected:
                    monitor(self.f.state, 8765, credential)
                self.assertEqual(rejected.exception.code, "MONITOR_IDENTITY_MISMATCH")
        output = self.f.root / "monitor.jsonl"
        output.write_text("existing", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            monitor(self.f.state, 8765, credential, out=output)
        self.assertEqual(output.read_text(), "existing")

    def test_monitor_limits_are_bounded_before_network(self):
        for samples, interval in ((0, 1), (61, 1), (1, 0), (1, float("nan")), (1, 61)):
            with self.assertRaises(Problem):
                monitor(self.f.state, 8765, self.f.owner_path, samples=samples, interval=interval)

    def test_monitor_does_not_echo_untrusted_service_error(self):
        with patch("zoora_community.operations.Client.request", side_effect=Problem(503, self.f.owner)):
            with self.assertRaises(Problem) as failed:
                monitor(self.f.state, 8765, self.f.owner_path)
            self.assertEqual(failed.exception.code, "MONITOR_REQUEST_FAILED")


if __name__ == "__main__":
    unittest.main()
