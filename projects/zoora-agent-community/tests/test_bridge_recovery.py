"""Stale private snapshots must never regain transfer-create authority."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from unittest.mock import patch
import uuid

from test_bridge_sandbox import SandboxCase
from bridge_fixture import KEY, ROOT, intent
from zoora_community import bridge_recovery
from zoora_community.bridge_journal import JOURNAL_VERSION, LEASE_MS, RETRY_MS, BridgeJournal
from zoora_community.bridge_recovery import verify_backup
from zoora_community.validation import canonical


class BridgeSnapshotTests(SandboxCase):
    def setUp(self):
        super().setUp()
        self.at = 1_800_000_000_000
        self.journal = BridgeJournal(self.folder / "source", clock=lambda: self.at)
        self.prepared = self.journal.prepare(intent())
        self.backup = self.folder / "snapshot.sqlite3"
        self.restored = BridgeJournal(self.folder / "restored", clock=lambda: self.at)

    def snapshot(self):
        self.saved = self.journal.backup(self.backup)
        return self.saved["backup_sha256"]

    def restore(self, digest=None):
        return self.restored.restore(self.backup, digest or self.saved["backup_sha256"])

    def mutate(self, sql, parameters=(), path=None):
        with closing(sqlite3.connect(path or self.journal.path, autocommit=True)) as connection:
            connection.execute(sql, parameters)

    def test_backup_hash_and_complete_history_match_without_provider_calls(self):
        self.journal.advance(intent()["request_id"], self.client)
        self.journal.prepare(intent(2))
        self.provider.mode = "drop"
        self.journal.advance(intent(2)["request_id"], self.client)
        before = self.journal.audit()
        digest = self.snapshot()
        checked = verify_backup(self.backup, digest)
        self.assertEqual(checked["audit"], before)
        self.assertEqual(digest, hashlib.sha256(self.backup.read_bytes()).hexdigest())
        self.assertEqual(self.journal.audit(), before)
        self.assertEqual((before["journal_intents"], before["journal_attempts"], before["known_transfers"]), (2, 2, 1))
        self.assertEqual(len(self.provider.requests), 2)
        self.assertNotIn(KEY.encode(), self.backup.read_bytes())
        self.assertNotIn(KEY, canonical(checked))

    def test_missing_source_backup_does_not_create_journal_or_destination(self):
        missing = BridgeJournal(self.folder / "missing")
        self.error("BRIDGE_JOURNAL_NOT_FOUND", lambda: missing.backup(self.backup))
        self.error("BRIDGE_JOURNAL_NOT_FOUND", missing.audit)
        self.assertFalse(missing.state.exists())
        self.assertFalse(self.backup.exists())

    def test_backup_refuses_existing_destination_without_overwrite(self):
        self.snapshot()
        before = self.backup.read_bytes()
        self.error("BRIDGE_BACKUP_EXISTS", lambda: self.journal.backup(self.backup))
        self.assertEqual(self.backup.read_bytes(), before)

    def test_stale_pre_submission_snapshot_cannot_create_or_prepare_new_payment(self):
        digest = self.snapshot()
        actual = self.journal.advance(intent()["request_id"], self.client)
        restored = self.restore(digest)
        view = self.restored.show(intent()["request_id"])
        self.assertEqual(view["state"], "PREPARED")
        self.assertEqual(view["idempotency_key"], actual["idempotency_key"])
        self.assertEqual(view["journal_mode"], "RECOVERY_ONLY")
        self.assertFalse(restored["may_create_transfers"])
        self.assertFalse(view["may_create_transfers"])
        self.error("BRIDGE_RESTORED_JOURNAL_READ_ONLY", lambda: self.restored.advance(intent()["request_id"], self.client))
        self.error("BRIDGE_RESTORED_JOURNAL_READ_ONLY", lambda: self.restored.prepare(intent(2)))
        self.assertEqual(view, self.restored.prepare(intent()))
        self.assertEqual(len(self.provider.requests), 1)
        self.assertEqual(len(self.provider.effects), 1)

    def test_restored_unknown_is_get_recoverable_without_reopening_create(self):
        self.provider.mode = "drop"
        unknown = self.journal.advance(intent()["request_id"], self.client)
        digest = self.snapshot()
        self.restore(digest)
        self.provider.mode = "ok"
        self.error("BRIDGE_RESTORED_JOURNAL_READ_ONLY", lambda: self.restored.advance(intent()["request_id"], self.client))
        discovery = self.restored.discover(intent()["request_id"], self.client)
        transfer_id = discovery["candidate_ids"][0]
        self.at += RETRY_MS + 1
        recovered = self.restored.reconcile(intent()["request_id"], self.client, transfer_id)
        polled = self.restored.advance(intent()["request_id"], self.client)
        for value in (recovered, polled):
            self.assertEqual(value["idempotency_key"], unknown["idempotency_key"])
            self.assertEqual(value["body"], unknown["body"])
            self.assertEqual(value["first_attempt_ms"], unknown["first_attempt_ms"])
            self.assertEqual(value["journal_mode"], "RECOVERY_ONLY")
            self.assertEqual(value["restored_from_sha256"], digest)
        self.assertEqual([r["method"] for r in self.provider.requests], ["POST", "GET", "GET", "GET"])

    def test_restored_known_transfer_allows_only_get_and_retains_credential_binding(self):
        known = self.journal.advance(intent()["request_id"], self.client)
        self.snapshot()
        self.restore()
        self.error("BRIDGE_CREDENTIAL_CHANGED_RECONCILE_REQUIRED", lambda: self.restored.advance(
            intent()["request_id"], type(self.client)(KEY + "different")))
        after = self.restored.advance(intent()["request_id"], self.client)
        self.assertEqual(after["observation"], known["observation"])
        self.assertEqual([r["method"] for r in self.provider.requests], ["POST", "GET"])

    def test_snapshot_of_in_flight_payment_retains_pending_claim_and_lease(self):
        self.provider.mode = "block"
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(self.journal.advance, intent()["request_id"], self.client)
            try:
                self.assertTrue(self.provider.entered.wait(timeout=5))
                self.snapshot()
            finally:
                self.provider.release.set()
            known = pending.result(timeout=10)
        self.restore()
        before = self.restored.show(intent()["request_id"])
        self.assertTrue(before["incomplete_attempt"])
        self.error("BRIDGE_ATTEMPT_BUSY", lambda: self.restored.reconcile(intent()["request_id"], self.client, known["observation"]["id"]))
        self.at += LEASE_MS
        recovered = self.restored.reconcile(intent()["request_id"], self.client, known["observation"]["id"])
        self.assertEqual(recovered["observation"], known["observation"])
        self.assertEqual([r["method"] for r in self.provider.requests], ["POST", "GET"])

    def test_backing_up_and_restoring_recovery_state_never_reactivates_it(self):
        self.snapshot()
        self.restore()
        second = self.restored.backup(self.folder / "recovery-copy.sqlite3")
        next_journal = BridgeJournal(self.folder / "second-restore", clock=lambda: self.at)
        next_journal.restore(self.folder / "recovery-copy.sqlite3", second["backup_sha256"])
        self.error("BRIDGE_RESTORED_JOURNAL_READ_ONLY", lambda: next_journal.advance(intent()["request_id"], self.client))
        self.assertEqual(next_journal.audit()["journal_mode"], "RECOVERY_ONLY")
        self.assertEqual(self.provider.requests, [])

    def test_existing_even_empty_restore_directory_is_never_reused(self):
        self.snapshot()
        self.restored.state.mkdir()
        with self.assertRaises(FileExistsError):
            self.restore()
        self.assertEqual(list(self.restored.state.iterdir()), [])

    def test_restore_cannot_replace_source_state(self):
        self.snapshot()
        before = self.journal.path.read_bytes()
        with self.assertRaises(FileExistsError):
            self.journal.restore(self.backup, self.saved["backup_sha256"])
        self.assertEqual(self.journal.path.read_bytes(), before)
        self.assertEqual(self.journal.audit()["journal_mode"], "ACTIVE")

    def test_wrong_trusted_hash_refuses_before_any_restored_state_is_published(self):
        self.snapshot()
        self.error("BRIDGE_BACKUP_HASH_MISMATCH", lambda: self.restore("0" * 64))
        self.assertFalse(self.restored.state.exists())
        self.assertEqual(self.provider.requests, [])

    def test_rehashed_non_database_is_not_a_valid_snapshot(self):
        self.backup.write_bytes(b"not a database")
        self.backup.chmod(0o600)
        digest = hashlib.sha256(self.backup.read_bytes()).hexdigest()
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", lambda: self.restore(digest))
        self.assertFalse(self.restored.state.exists())

    def test_semantically_corrupt_backup_is_refused_even_with_matching_file_hash(self):
        self.snapshot()
        self.mutate("UPDATE intents SET body_sha256=?", ("0" * 64,), self.backup)
        digest = hashlib.sha256(self.backup.read_bytes()).hexdigest()
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", lambda: self.restore(digest))
        self.assertFalse(self.restored.state.exists())

    def test_unknown_backup_schema_is_refused_without_suggesting_an_unsupported_upgrade(self):
        self.snapshot()
        self.mutate(f"PRAGMA user_version={JOURNAL_VERSION + 1}", path=self.backup)
        digest = hashlib.sha256(self.backup.read_bytes()).hexdigest()
        self.error("BRIDGE_JOURNAL_SCHEMA_REJECTED", lambda: self.restore(digest))
        self.assertFalse(self.restored.state.exists())

    def test_full_audit_refuses_orphan_attempt_not_visible_to_single_intent_read(self):
        self.journal.advance(intent()["request_id"], self.client)
        with closing(sqlite3.connect(self.journal.path, autocommit=True)) as connection:
            row = list(connection.execute("SELECT * FROM attempts LIMIT 1").fetchone())
            row[0], row[1] = uuid.uuid4().hex, "f" * 32
            connection.execute("INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?,?)", row)
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", self.journal.audit)
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", self.snapshot)
        self.assertFalse(self.backup.exists())

    def test_unreviewed_trigger_schema_is_refused_before_restore_can_execute_it(self):
        self.snapshot()
        self.mutate("CREATE TRIGGER reactivate AFTER UPDATE ON bridge_control BEGIN UPDATE bridge_control SET mode='ACTIVE',restored_from_sha256=NULL,restored_at_ms=NULL; END", path=self.backup)
        digest = hashlib.sha256(self.backup.read_bytes()).hexdigest()
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", lambda: self.restore(digest))
        self.assertFalse(self.restored.state.exists())

    def test_full_audit_refuses_one_provider_id_bound_to_different_intents(self):
        first = self.journal.advance(intent()["request_id"], self.client)
        self.journal.prepare(intent(2))
        from zoora_community.bridge_sandbox import transfer_body
        second = self.journal.show(intent(2)["request_id"])
        self.provider.body_override = canonical({**transfer_body(intent(2), second["idempotency_key"]),
            "id": first["observation"]["id"], "state": "awaiting_funds"}).encode()
        self.journal.advance(intent(2)["request_id"], self.client)
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", self.journal.audit)
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", self.snapshot)
        self.assertFalse(self.backup.exists())

    def test_invalid_or_missing_durable_mode_fails_before_http(self):
        self.mutate("UPDATE bridge_control SET mode='UNKNOWN'")
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", lambda: self.journal.advance(intent()["request_id"], self.client))
        self.mutate("DELETE FROM bridge_control")
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", lambda: self.journal.advance(intent()["request_id"], self.client))
        self.assertEqual(self.provider.requests, [])

    def test_backup_sidecars_symlinks_and_public_permissions_are_refused(self):
        digest = self.snapshot()
        for suffix in ("-wal", "-shm", "-journal"):
            sidecar = self.backup.with_name(self.backup.name + suffix)
            sidecar.write_bytes(b"unmerged")
            self.error("BRIDGE_BACKUP_SIDECAR_PRESENT", lambda: verify_backup(self.backup, digest))
            sidecar.unlink()
        if os.name == "posix":
            link = self.folder / "linked.sqlite3"
            link.symlink_to(self.backup)
            self.error("BRIDGE_UNSAFE_BACKUP", lambda: verify_backup(link, digest))
            self.backup.chmod(0o644)
            self.error("BRIDGE_UNSAFE_BACKUP", lambda: verify_backup(self.backup, digest))

    def test_snapshot_size_is_checked_before_reading(self):
        digest = self.snapshot()
        with patch.object(bridge_recovery, "MAX_SNAPSHOT_BYTES", 10):
            self.error("BRIDGE_UNSAFE_BACKUP", lambda: verify_backup(self.backup, digest))

    def test_changed_copy_is_refused_before_backup_publication(self):
        original = bridge_recovery.copy_snapshot

        def changed(source, destination):
            original(source, destination)
            self.mutate("DELETE FROM intents", path=destination)

        with patch.object(bridge_recovery, "copy_snapshot", changed):
            self.error("BRIDGE_BACKUP_STATE_MISMATCH", self.snapshot)
        self.assertFalse(self.backup.exists())
        self.assertEqual(self.journal.show(intent()["request_id"]), self.prepared)

    def test_restore_clock_cannot_predate_saved_history_or_later_recovery_clock(self):
        self.journal.advance(intent()["request_id"], self.client)
        self.snapshot()
        self.at -= 1
        self.error("BRIDGE_CLOCK_REGRESSION", self.restore)
        self.assertFalse(self.restored.state.exists())
        self.at += 100
        self.restore()
        self.at -= 1
        self.error("BRIDGE_CLOCK_REGRESSION", lambda: self.restored.advance(intent()["request_id"], self.client))
        self.error("BRIDGE_CLOCK_REGRESSION", lambda: self.restored.discover(intent()["request_id"], self.client))
        self.assertEqual(len(self.provider.requests), 1)

    def test_publication_failure_leaves_no_usable_restore_directory(self):
        self.snapshot()
        with patch.object(bridge_recovery.os, "link", side_effect=OSError("injected publish failure")), self.assertRaises(OSError):
            self.restore()
        self.assertFalse(self.restored.state.exists())
        self.assertEqual(self.provider.requests, [])

    def test_verify_cli_needs_no_state_or_credentials_and_does_not_mutate_snapshot(self):
        digest = self.snapshot()
        before = self.backup.read_bytes()
        result = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error", "-m",
            "zoora_community.bridge_sandbox", "verify-backup", "--backup", str(self.backup), "--sha256", digest],
            cwd=ROOT, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["verified"])
        self.assertEqual(self.backup.read_bytes(), before)
        self.assertEqual(self.provider.requests, [])

    def test_audit_refuses_overlapping_unfinished_claims(self):
        args = ["advance", "--request-id", intent()["request_id"], "--key-file", self.folder / "key"]
        (self.folder / "key").write_text(KEY)
        (self.folder / "key").chmod(0o600)
        self.assertEqual(self.provider.cli(self.journal.state, args, at=self.at, crash=True).returncode, 79)
        with closing(sqlite3.connect(self.journal.path, autocommit=True)) as connection:
            row = list(connection.execute("SELECT * FROM attempts").fetchone())
            row[0], row[2], row[4] = uuid.uuid4().hex, 2, self.at + LEASE_MS - 1
            connection.execute("INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?,?)", row)
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", self.journal.audit)

    def test_audit_refuses_historically_expired_create_retry(self):
        self.provider.mode = "drop"
        self.journal.advance(intent()["request_id"], self.client)
        with closing(sqlite3.connect(self.journal.path, autocommit=True)) as connection:
            row = list(connection.execute("SELECT * FROM attempts").fetchone())
            row[0], row[2], row[4], row[5] = uuid.uuid4().hex, 2, self.at + RETRY_MS, self.at + RETRY_MS
            connection.execute("INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?,?)", row)
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", self.journal.audit)


class BridgeSchemaTwoMigrationTests(SandboxCase):
    def setUp(self):
        super().setUp()
        self.at = 1_800_000_000_000
        self.journal = BridgeJournal(self.folder / "source", clock=lambda: self.at)
        self.journal.prepare(intent())
        self.known = self.journal.advance(intent()["request_id"], self.client)
        self.journal.reconcile(intent()["request_id"], self.client, self.known["observation"]["id"])
        with closing(sqlite3.connect(self.journal.path, autocommit=True)) as connection:
            connection.execute("DROP TABLE bridge_control")
            connection.execute("PRAGMA user_version=2")
        self.backup = self.folder / "schema-two.sqlite3"

    def test_schema_two_needs_explicit_backed_up_migration_preserving_recovery_history(self):
        self.error("BRIDGE_JOURNAL_MIGRATION_REQUIRED", lambda: self.journal.advance(intent()["request_id"], self.client))
        result = self.journal.migrate(self.backup)
        self.assertEqual((result["from_schema"], result["journal_schema_version"]), (2, JOURNAL_VERSION))
        view = self.journal.show(intent()["request_id"])
        self.assertEqual(view["last_attempt_kind"], "RECONCILE")
        self.assertEqual(view["observation"], self.known["observation"])
        self.assertEqual(view["journal_mode"], "ACTIVE")
        with closing(sqlite3.connect(self.backup)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 2)
        self.assertEqual(len(self.provider.requests), 2)

    def test_failed_schema_two_upgrade_rolls_back_and_retains_original_snapshot(self):
        original = self.journal._upgrade

        def failure(connection, digest):
            original(connection, digest)
            raise RuntimeError("injected after control creation")

        with patch.object(self.journal, "_upgrade", failure), self.assertRaises(RuntimeError):
            self.journal.migrate(self.backup)
        for path in (self.journal.path, self.backup):
            with closing(sqlite3.connect(path)) as connection:
                self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 2)
                self.assertFalse(connection.execute("SELECT name FROM sqlite_master WHERE name='bridge_control'").fetchall())

    def test_legacy_operational_restore_is_refused_without_new_state(self):
        digest = hashlib.sha256(self.journal.path.read_bytes()).hexdigest()
        target = BridgeJournal(self.folder / "restored", clock=lambda: self.at)
        self.error("BRIDGE_JOURNAL_MIGRATION_REQUIRED", lambda: target.restore(self.journal.path, digest))
        self.assertFalse(target.state.exists())
