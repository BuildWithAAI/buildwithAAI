"""Cross-journal integrity, pinned recovery, stale snapshots and migration boundaries."""

from contextlib import closing
import hashlib
import json
import os
import sqlite3
import zipfile
from unittest.mock import patch

from test_payment_pipeline import PipelineCase
from bridge_fixture import KEY, intent
from zoora_community import payment_recovery as recovery
from zoora_community.bridge_sandbox import sha, transfer_body
from zoora_community.payment_pipeline import LEASE_MS, PaymentPipeline
from zoora_community.validation import Problem, canonical


class PaymentRecoveryTests(PipelineCase):
    def setUp(self):
        super().setUp()
        self.backup = self.folder / "payment.zip"
        self.restored = PaymentPipeline(self.folder / "restored", clock=lambda: self.f.at)

    def save(self):
        self.saved = recovery.create_backup(self.pipeline, self.backup)
        return self.saved["backup_sha256"]

    def restore(self, pin=None):
        return recovery.restore_backup(self.restored, self.backup, pin or self.saved["backup_sha256"])

    def sql(self, statement, values=(), path=None):
        with closing(sqlite3.connect(path or self.pipeline.path, autocommit=True)) as connection:
            connection.execute(statement, values)

    def legacy(self):
        self.sql("DROP TABLE pipeline_recovery")
        self.sql("PRAGMA user_version=1")

    def altered_package(self, edit):
        with zipfile.ZipFile(self.backup) as archive:
            values = {name: archive.read(name) for name in archive.namelist()}
        edit(values)
        target = self.folder / "altered.zip"
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as archive:
            for name, raw in values.items():
                archive.writestr(name, raw)
        target.chmod(0o600)
        return target, hashlib.sha256(target.read_bytes()).hexdigest()

    def test_joint_audit_binds_every_order_and_retains_lifetime_principal_without_http(self):
        known = self.stage(self.purchase(1, amount="1.250001"))["order_id"]
        self.run_one(known)
        self.stage(self.purchase(2, amount="1.000001"))
        before = len(self.provider.requests)
        audited = recovery.audit(self.pipeline)
        self.assertEqual((audited["orders"], audited["claims"], audited["dispatch_fences"]), (2, 1, 1))
        self.assertEqual(audited["admitted_principal_usdc"], "2.250002")
        self.assertEqual(audited["provider"]["journal_attempts"], 1)
        actions = {r["order_id"]: r["recovery_action"] for r in audited["inventory"]}
        self.assertEqual(actions[known], "GET_EXACT_TRANSFER")
        self.assertEqual(set(actions.values()), {"GET_EXACT_TRANSFER", "NO_PRIOR_PROVIDER_ATTEMPT"})
        self.assertEqual(len(self.provider.requests), before)
        self.assertFalse(audited["source_state_included"])

    def test_backup_and_verification_preserve_both_complete_histories_and_exact_outer_pin(self):
        self.run_one(self.stage()["order_id"])
        before = recovery.audit(self.pipeline)
        pin = self.save()
        self.assertEqual(pin, hashlib.sha256(self.backup.read_bytes()).hexdigest())
        self.assertEqual(recovery.verify_backup(self.backup, pin)["audit"], before)
        self.assertEqual(recovery.audit(self.pipeline), before)
        with zipfile.ZipFile(self.backup) as archive:
            self.assertEqual(set(archive.namelist()), set(recovery.LIMITS))
            manifest = json.loads(archive.read("manifest.json"))
            for name, expected in manifest["files"].items():
                self.assertEqual(hashlib.sha256(archive.read(name)).hexdigest(), expected)
        for token in (KEY, self.agent, self.operator, self.f.owner):
            self.assertNotIn(token.encode(), self.backup.read_bytes())

    def test_pre_create_snapshot_cannot_recreate_a_later_accepted_transfer(self):
        key = self.stage()["order_id"]
        self.save()
        self.run_one(key)
        before = len(self.provider.requests)
        restored = self.restore()
        self.assertEqual(restored["audit"]["pipeline_mode"], "RECOVERY_ONLY")
        self.assertEqual(restored["audit"]["provider"]["journal_mode"], "RECOVERY_ONLY")
        self.error("PIPELINE_RESTORED_READ_ONLY", lambda: self.restored.run_one(key, None, None, self.client))
        refused = self.restored.run_one(key, None, None, self.client, recovery_only=True)
        self.assertEqual(refused["code"], "PIPELINE_RECOVERY_REQUIRES_ATTEMPT")
        self.error("BRIDGE_RESTORED_JOURNAL_READ_ONLY", lambda: self.restored.bridge.prepare(intent(20)))
        self.assertEqual(len(self.provider.requests), before)
        self.assertEqual(len(self.provider.effects), 1)

    def test_restored_stage_batch_and_revoke_are_refused_before_credential_or_network_access(self):
        envelope = self.purchase()
        self.stage(envelope)
        self.save()
        self.restore()
        for call in (lambda: self.restored.stage(envelope, None, None),
                lambda: self.restored.run_batch(lambda: None, None, self.client),
                lambda: self.restored.revoke(None, None)):
            self.error("PIPELINE_RESTORED_READ_ONLY", call)
        self.assertEqual(self.provider.requests, [])
        self.assertEqual(self.restored.audit()["claims"], 0)

    def test_known_transfer_recovery_is_get_only_and_does_not_require_source_service(self):
        key = self.stage()["order_id"]
        known = self.run_one(key)
        self.save()
        self.restore()
        boundary = len(self.provider.requests)
        result = self.restored.run_one(key, None, None, self.client, recovery_only=True)
        self.assertEqual(result["transfer_id"], known["transfer_id"])
        self.assertEqual([r["method"] for r in self.provider.requests[boundary:]], ["GET"])
        self.assertEqual(self.restored.show()["admitted_principal_usdc"], "1.000000")
        self.assertEqual(recovery.audit(self.restored)["provider"]["journal_attempts"], 2)

    def test_unknown_transfer_requires_discovery_then_explicit_matching_id_without_post_retry(self):
        key = self.stage()["order_id"]
        self.provider.mode = "drop"
        self.assertEqual(self.run_one(key)["phase"], "PROVIDER_UNKNOWN")
        self.provider.mode = "ok"
        self.save()
        self.restore()
        boundary = len(self.provider.requests)
        found = self.restored.run_one(key, None, None, self.client, recovery_only=True)
        self.assertEqual(len(found["candidate_ids"]), 1)
        result = self.restored.run_one(key, None, None, self.client, recovery_only=True,
                                       transfer_id=found["candidate_ids"][0])
        self.assertEqual(result["phase"], "PROVIDER_OBSERVED")
        self.assertEqual([r["method"] for r in self.provider.requests[boundary:]], ["GET", "GET"])
        self.assertEqual(len(self.provider.effects), 1)

    def test_restore_keeps_unfinished_claim_and_lease_exclusion_until_elapsed(self):
        key = self.stage()["order_id"]
        self.pipeline._claim(key)
        self.save()
        self.restore()
        self.error("PIPELINE_ORDER_BUSY", lambda: self.restored.run_one(key, None, None, self.client, recovery_only=True))
        self.f.at += LEASE_MS
        result = self.restored.run_one(key, None, None, self.client, recovery_only=True)
        self.assertEqual(result["code"], "PIPELINE_RECOVERY_REQUIRES_ATTEMPT")
        self.assertEqual(self.restored.audit()["unfinished_claims"], 1)

    def test_revocation_and_admission_remain_after_restore_and_resnapshot(self):
        self.run_one(self.stage()["order_id"])
        revoked = self.pipeline.revoke(self.api, self.operator)["revoked_ms"]
        self.save()
        self.restore()
        self.assertEqual(self.restored.show()["revoked_ms"], revoked)
        second = self.folder / "second.zip"
        saved = recovery.create_backup(self.restored, second)
        again = PaymentPipeline(self.folder / "again", clock=lambda: self.f.at)
        recovery.restore_backup(again, second, saved["backup_sha256"])
        self.assertFalse(again.show()["may_submit_purchases"])
        self.assertEqual(again.show()["admitted_principal_usdc"], "1.000000")

    def test_unknown_outer_pin_and_changed_bytes_never_publish_a_target(self):
        self.save()
        self.error("PIPELINE_BACKUP_HASH_MISMATCH", lambda: self.restore("0" * 64))
        self.backup.write_bytes(self.backup.read_bytes() + b"changed")
        self.error("PIPELINE_BACKUP_HASH_MISMATCH", self.restore)
        self.assertFalse(self.restored.state.exists())

    def test_self_consistent_outer_hash_does_not_hide_a_forged_internal_manifest(self):
        self.save()
        def edit(values):
            value = json.loads(values["manifest.json"])
            value["audit"]["admitted_principal_usdc"] = "900.000000"
            values["manifest.json"] = canonical(value).encode()
        changed, pin = self.altered_package(edit)
        self.error("PIPELINE_PACKAGE_REJECTED", lambda: recovery.restore_backup(self.restored, changed, pin))
        self.assertFalse(self.restored.state.exists())

    def test_archive_path_traversal_and_extra_members_are_rejected_without_extraction(self):
        self.save()
        for member in ("../escape", "/absolute", "credential.json"):
            changed, pin = self.altered_package(lambda values, member=member: values.update({member: b"PRIVATE"}))
            self.error("PIPELINE_PACKAGE_REJECTED", lambda changed=changed, pin=pin: recovery.verify_backup(changed, pin))
        self.assertFalse((self.folder / "escape").exists())

    def test_duplicate_archive_member_is_rejected(self):
        self.save()
        target = self.folder / "duplicate.zip"
        with zipfile.ZipFile(self.backup) as source, zipfile.ZipFile(target, "w") as output:
            for name in source.namelist():
                output.writestr(name, source.read(name))
            with self.assertWarns(UserWarning):
                output.writestr("manifest.json", source.read("manifest.json"))
        target.chmod(0o600)
        pin = hashlib.sha256(target.read_bytes()).hexdigest()
        self.error("PIPELINE_PACKAGE_REJECTED", lambda: recovery.verify_backup(target, pin))

    def test_backup_and_restore_never_overwrite_existing_destinations(self):
        self.save()
        before = self.backup.read_bytes()
        self.error("PIPELINE_BACKUP_EXISTS", lambda: recovery.create_backup(self.pipeline, self.backup))
        self.restored.state.mkdir(mode=0o700)
        sentinel = self.restored.state / "existing"
        sentinel.write_text("keep")
        with self.assertRaises(FileExistsError):
            self.restore()
        self.assertEqual(sentinel.read_text(), "keep")
        self.assertEqual(self.backup.read_bytes(), before)

    def test_publication_sync_failure_cleans_only_the_new_target(self):
        self.save()
        with patch.object(recovery, "sync_directory", side_effect=OSError("private path")), self.assertRaises(OSError):
            self.restore()
        self.assertFalse(self.restored.state.exists())
        self.assertTrue(self.backup.exists())

    def test_restore_refuses_time_before_any_retained_queue_or_provider_event(self):
        self.stage()
        self.save()
        self.f.at -= 1
        self.error("PIPELINE_CLOCK_REGRESSION", self.restore)
        self.assertFalse(self.restored.state.exists())

    def test_legacy_queue_requires_a_verified_exact_current_package_for_migration(self):
        key = self.stage()["order_id"]
        self.run_one(key)
        self.legacy()
        self.error("PIPELINE_MIGRATION_REQUIRED", self.pipeline.show)
        self.save()
        before = self.saved["audit"]
        changed = recovery.migrate(self.pipeline, self.backup, self.saved["backup_sha256"])
        self.assertEqual(changed["from_schema"], 1)
        self.assertEqual(changed["audit"]["pipeline_mode"], "ACTIVE")
        self.assertEqual(changed["audit"]["inventory"], before["inventory"])
        self.assertEqual(self.pipeline.show()["recovery"]["migrated_from_sha256"], self.saved["backup_sha256"])
        self.assertEqual(self.run_one(key)["phase"], "PROVIDER_OBSERVED")

    def test_migration_refuses_a_stale_queue_or_provider_history(self):
        key = self.stage()["order_id"]
        self.run_one(key)
        self.legacy()
        self.save()
        self.pipeline.bridge.advance(key, self.client)
        self.error("PIPELINE_MIGRATION_BACKUP_MISMATCH", lambda: recovery.migrate(self.pipeline, self.backup, self.saved["backup_sha256"]))
        self.error("PIPELINE_MIGRATION_REQUIRED", self.pipeline.audit)

    def test_legacy_package_restore_upgrades_only_into_recovery_and_cannot_be_migrated_active(self):
        self.stage()
        self.legacy()
        self.save()
        self.restore()
        self.assertEqual(self.restored.show()["pipeline_schema_version"], 2)
        self.assertFalse(self.restored.show()["may_submit_purchases"])
        self.error("PIPELINE_MIGRATION_NOT_REQUIRED", lambda: recovery.migrate(self.restored, self.backup, self.saved["backup_sha256"]))

    def test_migration_transaction_rolls_back_all_schema_changes_on_failure(self):
        self.legacy()
        self.save()
        original = recovery.upgrade_queue
        def fail(connection):
            original(connection)
            raise OSError("injected local failure")
        with patch.object(recovery, "upgrade_queue", fail), self.assertRaises(OSError):
            recovery.migrate(self.pipeline, self.backup, self.saved["backup_sha256"])
        self.assertEqual(recovery.verify_backup(self.backup, self.saved["backup_sha256"])["audit"], self.saved["audit"])
        self.error("PIPELINE_MIGRATION_REQUIRED", self.pipeline.show)

    def test_joint_audit_rejects_a_valid_but_unlinked_provider_intent(self):
        self.pipeline.bridge.prepare(intent(99))
        self.error("PIPELINE_UNLINKED_PROVIDER_INTENT", lambda: recovery.audit(self.pipeline))

    def test_joint_audit_rejects_individually_valid_changed_provider_terms(self):
        self.stage()
        terms = self.pipeline.show()["orders"][0]["terms"]
        view = self.pipeline.bridge.prepare(terms["intent"])
        changed = {**terms["intent"], "amount_usdc": "2.000000"}
        body = transfer_body(changed, view["idempotency_key"])
        self.sql("UPDATE intents SET intent_json=?,body_json=?,body_sha256=?", (canonical(changed), canonical(body), sha(body)), self.pipeline.bridge.path)
        self.pipeline.bridge.audit()
        self.pipeline.audit()
        self.error("PIPELINE_PROVIDER_BINDING_MISMATCH", lambda: recovery.audit(self.pipeline))

    def test_joint_audit_rejects_raw_create_that_has_no_authenticated_queue_dispatch_fence(self):
        key = self.stage()["order_id"]
        self.pipeline.bridge.prepare(self.pipeline.show()["orders"][0]["terms"]["intent"])
        self.pipeline.bridge.advance(key, self.client)
        self.pipeline.bridge.audit()
        self.error("PIPELINE_PROVIDER_DISPATCH_MISMATCH", lambda: recovery.audit(self.pipeline))

    def test_joint_audit_rejects_provider_result_hash_that_does_not_match_the_linked_body(self):
        self.run_one(self.stage()["order_id"])
        with closing(sqlite3.connect(self.pipeline.path)) as connection:
            value = json.loads(connection.execute("SELECT result_json FROM claims").fetchone()[0])
        value["provider_body_sha256"] = "0" * 64
        self.sql("UPDATE claims SET result_json=?", (canonical(value),))
        self.pipeline.audit()
        self.error("PIPELINE_RESULT_PROVIDER_MISMATCH", lambda: recovery.audit(self.pipeline))

    def test_missing_provider_history_blocks_new_execution_before_recreating_the_journal(self):
        key = self.stage()["order_id"]
        self.run_one(key)
        self.pipeline.bridge.path.unlink()
        before = len(self.provider.requests)
        self.error("PIPELINE_PROVIDER_HISTORY_MISSING", lambda: recovery.audit(self.pipeline))
        self.assertEqual(self.run_one(key)["code"], "PIPELINE_PROVIDER_HISTORY_MISSING")
        self.assertFalse(self.pipeline.bridge.path.exists())
        self.assertEqual(len(self.provider.requests), before)

    def test_recovery_mode_and_provenance_corruption_fail_before_execution(self):
        self.save()
        self.restore()
        self.sql("UPDATE pipeline_recovery SET mode='ACTIVE'", path=self.restored.path)
        self.error("PIPELINE_CONSISTENCY_FAILURE", self.restored.show)

    def test_joint_audit_rejects_an_active_provider_under_a_restored_queue(self):
        self.save()
        self.restore()
        self.sql("UPDATE bridge_control SET mode='ACTIVE',restored_from_sha256=NULL,restored_at_ms=NULL", path=self.restored.bridge.path)
        self.error("PIPELINE_RECOVERY_MODE_MISMATCH", lambda: recovery.audit(self.restored))

    def test_missing_queue_backup_does_not_create_any_state(self):
        missing = PaymentPipeline(self.folder / "missing")
        self.error("STATE_UNAVAILABLE", lambda: recovery.create_backup(missing, self.backup))
        self.assertFalse(missing.state.exists())
        self.assertFalse(self.backup.exists())

    def test_unsafe_package_symlink_is_refused(self):
        if os.name == "nt":
            self.skipTest("symbolic link privilege is not assumed on Windows")
        self.save()
        link = self.folder / "linked.zip"
        link.symlink_to(self.backup)
        with self.assertRaises(Problem) as caught:
            recovery.verify_backup(link, self.saved["backup_sha256"])
        self.assertEqual(caught.exception.code, "UNSAFE_STATE_FILE")
