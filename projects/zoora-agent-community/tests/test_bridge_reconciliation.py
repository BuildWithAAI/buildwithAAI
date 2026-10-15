"""Read-only discovery/recovery, preserved unknown outcomes and explicit journal upgrade."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import copy
import hashlib
import json
import sqlite3
from unittest.mock import patch
import uuid

from test_bridge_sandbox import SandboxCase
from bridge_fixture import KEY, intent
from zoora_community.bridge_journal import LEASE_MS, RETRY_MS, BridgeJournal
from zoora_community.bridge_sandbox import BridgeSandboxClient, transfer_body
from zoora_community.validation import Problem, canonical


def legacy(journal):
    """Recreate the exact v1 columns from a current fixture with CREATE/POLL history only."""
    with closing(sqlite3.connect(journal.path, autocommit=True)) as connection:
        connection.execute("ALTER TABLE attempts DROP COLUMN candidate_id")
        connection.execute("DROP TABLE bridge_migrations")
        connection.execute("PRAGMA user_version=1")


def foreign(index):
    return {"id": str(uuid.UUID(int=index + 100)), "client_reference_id": "unrelated-reference",
            "customer_name": "PRIVATE OTHER CUSTOMER", "bank_account": "NEVER EXPOSE"}


class DiscoveryTests(SandboxCase):
    def test_second_page_candidate_is_found_with_documented_cursor_and_no_write(self):
        body = transfer_body(intent(), str(uuid.uuid4()))
        match = {**body, "id": str(uuid.uuid4()), "state": "awaiting_funds"}
        self.provider.listing = [foreign(i) for i in range(20)] + [match]
        result = self.client.discover(body)
        self.assertEqual(result["candidate_ids"], [match["id"]])
        self.assertEqual((result["pages_scanned"], result["records_scanned"]), (2, 21))
        self.assertTrue(result["scan_reached_short_page"])
        self.assertIn("starting_after=" + self.provider.listing[19]["id"], self.provider.requests[1]["path"])
        self.assertTrue(all(r["method"] == "GET" and "Idempotency-Key" not in r["headers"] for r in self.provider.requests))
        for secret in ("PRIVATE OTHER CUSTOMER", "NEVER EXPOSE", KEY):
            self.assertNotIn(secret, canonical(result))

    def test_empty_scan_does_not_prove_no_transfer_or_authorize_post(self):
        result = self.client.discover(self.body)
        self.assertEqual(result["status"], "NO_MATCH_IN_SCAN")
        self.assertFalse(result["negative_result_proves_absence"])
        self.assertFalse(result["may_authorize_new_post"])

    def test_multiple_matching_ids_are_candidates_without_automatic_selection(self):
        self.provider.listing = [{**self.body, "id": str(uuid.uuid4()), "state": "awaiting_funds"} for _ in range(2)]
        result = self.client.discover(self.body)
        self.assertEqual(result["status"], "MULTIPLE_CANDIDATES_IN_SCAN")
        self.assertEqual(len(result["candidate_ids"]), 2)
        self.assertFalse(result["automatic_binding"])

    def test_same_reference_with_wrong_terms_is_rejected_instead_of_silently_skipped(self):
        self.provider.listing = [{**self.body, "id": str(uuid.uuid4()), "state": "awaiting_funds", "amount": "99.0"}]
        self.error("BRIDGE_RESPONSE_REJECTED", lambda: self.client.discover(self.body))

    def test_repeated_pagination_ids_are_rejected(self):
        self.provider.listing = [foreign(i) for i in range(20)]
        self.provider.repeat_page = True
        self.error("BRIDGE_DISCOVERY_PAGINATION_REJECTED", lambda: self.client.discover(self.body))
        self.assertEqual(len(self.provider.requests), 2)

    def test_scanning_stops_at_five_pages_and_admits_incomplete_coverage(self):
        self.provider.listing = [foreign(i) for i in range(110)]
        result = self.client.discover(self.body)
        self.assertEqual((result["pages_scanned"], result["records_scanned"]), (5, 100))
        self.assertFalse(result["scan_reached_short_page"])
        self.assertFalse(result["negative_result_proves_absence"])
        self.assertEqual(len(self.provider.requests), 5)

    def test_list_schema_and_duplicate_ids_are_rejected(self):
        for value in ({"count": True, "data": []}, {"count": 2, "data": []}, {"count": 1, "data": [None]},
                      {"count": 2, "data": [foreign(1), foreign(1)]}):
            self.provider.body_override = canonical(value).encode()
            with self.assertRaises(Problem) as caught:
                self.client.discover(self.body)
            self.assertIn(caught.exception.code, {"BRIDGE_DISCOVERY_SCHEMA_REJECTED", "BRIDGE_DISCOVERY_PAGINATION_REJECTED"})

    def test_pages_share_one_deadline_and_stop_before_more_http(self):
        self.provider.listing = [foreign(i) for i in range(30)]
        now = [0]
        original = self.client._request

        def request(*args, **kwargs):
            result = original(*args, **kwargs)
            now[0] = 11
            return result

        with patch.object(self.client, "_request", request), \
                patch("zoora_community.bridge_sandbox.time.monotonic", lambda: now[0]):
            self.error("BRIDGE_TIMEOUT", lambda: self.client.discover(self.body))
        self.assertEqual(len(self.provider.requests), 1)

    def test_pagination_paths_cannot_inject_filters_or_other_resources(self):
        for suffix in ("/../../customers", "?limit=100", "?limit=20&starting_after=bad", "?limit=20&state=error",
                       "?limit=20&starting_after=" + str(uuid.uuid4()) + "&limit=100"):
            with self.assertRaises(Problem):
                self.client._request("GET", "/v0/transfers" + suffix)
        self.assertEqual(self.provider.requests, [])


class ReconciliationTests(SandboxCase):
    def setUp(self):
        super().setUp()
        self.at = 1_800_000_000_000
        self.journal = BridgeJournal(self.folder / "journal", clock=lambda: self.at)
        self.prepared = self.journal.prepare(intent())
        self.request_id = intent()["request_id"]
        self.provider.mode = "drop"
        self.journal.advance(self.request_id, self.client)
        self.provider.mode = "ok"
        self.transfer_id = next(iter(self.provider.effects.values()))["id"]
        self.at += RETRY_MS + 1

    def reconcile(self, candidate=None):
        return self.journal.reconcile(self.request_id, self.client, candidate or self.transfer_id)

    def test_expired_unknown_can_reconcile_exact_id_without_a_second_post(self):
        self.error("BRIDGE_RETRY_WINDOW_CLOSED_RECONCILE_REQUIRED", lambda: self.journal.advance(self.request_id, self.client))
        result = self.reconcile()
        self.assertEqual(result["state"], "OBSERVED")
        self.assertEqual(result["last_attempt_kind"], "RECONCILE")
        self.assertEqual(result["observation"]["id"], self.transfer_id)
        self.assertEqual(result["first_attempt_ms"], self.at - RETRY_MS - 1)
        self.journal.advance(self.request_id, self.client)
        self.assertEqual([r["method"] for r in self.provider.requests], ["POST", "GET", "GET"])

    def test_discovery_does_not_modify_journal_or_restart_retry_clock(self):
        before = self.journal.show(self.request_id)
        result = self.journal.discover(self.request_id, self.client)
        self.assertEqual(result["candidate_ids"], [self.transfer_id])
        self.assertEqual(self.journal.show(self.request_id), before)
        self.error("BRIDGE_RETRY_WINDOW_CLOSED_RECONCILE_REQUIRED", lambda: self.journal.advance(self.request_id, self.client))

    def test_search_miss_retains_unknown_and_cannot_recreate_payment(self):
        before = self.journal.show(self.request_id)
        self.provider.listing = []
        self.assertEqual(self.journal.discover(self.request_id, self.client)["candidate_ids"], [])
        self.assertEqual(self.journal.show(self.request_id), before)
        self.error("BRIDGE_RETRY_WINDOW_CLOSED_RECONCILE_REQUIRED", lambda: self.journal.advance(self.request_id, self.client))
        self.assertEqual(sum(r["method"] == "POST" for r in self.provider.requests), 1)

    def test_wrong_id_or_terms_do_not_bind_and_do_not_reset_expiry(self):
        wrong = str(uuid.uuid4())
        result = self.reconcile(wrong)
        self.assertEqual((result["state"], result["last_attempt_error"]), ("UNKNOWN", "BRIDGE_HTTP_404"))
        changed = copy.deepcopy(next(iter(self.provider.effects.values())))
        changed["destination"]["currency"] = "sol"
        self.provider.body_override = canonical(changed).encode()
        result = self.reconcile()
        self.assertEqual(result["last_attempt_error"], "BRIDGE_RESPONSE_REJECTED")
        self.assertIsNone(result["observation"])
        self.error("BRIDGE_RETRY_WINDOW_CLOSED_RECONCILE_REQUIRED", lambda: self.journal.advance(self.request_id, self.client))

    def test_accepted_id_cannot_be_replaced_even_by_explicit_reconciliation(self):
        self.reconcile()
        count = len(self.provider.requests)
        self.error("BRIDGE_KNOWN_TRANSFER_CONFLICT", lambda: self.reconcile(str(uuid.uuid4())))
        self.assertEqual(len(self.provider.requests), count)

    def test_rotated_credential_cannot_discover_or_reconcile_without_account_continuity(self):
        client = BridgeSandboxClient(KEY + "-changed")
        self.error("BRIDGE_CREDENTIAL_CHANGED_RECONCILE_REQUIRED", lambda: self.journal.reconcile(self.request_id, client, self.transfer_id))
        self.error("BRIDGE_CREDENTIAL_CHANGED_RECONCILE_REQUIRED", lambda: self.journal.discover(self.request_id, client))
        self.assertEqual(len(self.provider.requests), 1)

    def test_prepared_but_never_attempted_intent_cannot_import_an_external_payment(self):
        self.journal.prepare(intent(2))
        self.error("BRIDGE_RECOVERY_REQUIRES_PRIOR_ATTEMPT", lambda: self.journal.reconcile(intent(2)["request_id"], self.client, self.transfer_id))
        self.error("BRIDGE_RECOVERY_REQUIRES_PRIOR_ATTEMPT", lambda: self.journal.discover(intent(2)["request_id"], self.client))

    def test_reconciliation_claim_uses_the_same_live_lease(self):
        self.provider.mode = "block_reads"
        self.provider.entered.clear()
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(self.reconcile)
            self.assertTrue(self.provider.entered.wait(timeout=5))
            self.error("BRIDGE_ATTEMPT_BUSY", self.reconcile)
            self.provider.release.set()
            self.assertEqual(first.result(timeout=10)["state"], "OBSERVED")

    def test_actual_cli_recovery_crash_retains_candidate_and_retries_only_get(self):
        key_file = self.folder / "key"
        key_file.write_text(KEY, encoding="ascii")
        key_file.chmod(0o600)
        args = ["reconcile", "--request-id", self.request_id, "--key-file", key_file, "--transfer-id", self.transfer_id]
        crashed = self.provider.cli(self.journal.state, args, at=self.at, crash="poll")
        self.assertEqual(crashed.returncode, 80, crashed.stderr)
        pending = self.journal.show(self.request_id)
        self.assertTrue(pending["incomplete_attempt"])
        self.assertEqual(pending["last_candidate_id"], self.transfer_id)
        self.at += LEASE_MS + 1
        result = self.provider.cli(self.journal.state, args, at=self.at)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["observation"]["id"], self.transfer_id)
        self.assertEqual([r["method"] for r in self.provider.requests], ["POST", "GET", "GET"])

    def test_tampered_persisted_candidate_cannot_rebind_history(self):
        self.reconcile()
        with closing(sqlite3.connect(self.journal.path, autocommit=True)) as connection:
            connection.execute("UPDATE attempts SET candidate_id=? WHERE kind='RECONCILE'", (str(uuid.uuid4()),))
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", self.reconcile)


class JournalMigrationTests(SandboxCase):
    def setUp(self):
        super().setUp()
        self.at = 1_800_000_000_000
        self.journal = BridgeJournal(self.folder / "old-journal", clock=lambda: self.at)
        self.journal.prepare(intent())
        self.known = self.journal.advance(intent()["request_id"], self.client)
        self.journal.advance(intent()["request_id"], self.client)
        self.journal.prepare(intent(2))
        self.provider.mode = "drop"
        self.pending = self.journal.advance(intent(2)["request_id"], self.client)
        self.provider.mode = "ok"
        legacy(self.journal)
        self.backup = self.folder / "schema-one.sqlite3"

    def test_version_one_requires_explicit_migration_before_any_network(self):
        before = len(self.provider.requests)
        self.error("BRIDGE_JOURNAL_MIGRATION_REQUIRED", lambda: self.journal.show(intent()["request_id"]))
        self.error("BRIDGE_JOURNAL_MIGRATION_REQUIRED", lambda: self.journal.advance(intent(2)["request_id"], self.client))
        self.assertEqual(len(self.provider.requests), before)

    def test_upgrade_preserves_exact_keys_observations_pending_attempts_and_snapshot(self):
        result = self.journal.migrate(self.backup)
        self.assertEqual(result["backup_sha256"], hashlib.sha256(self.backup.read_bytes()).hexdigest())
        with closing(sqlite3.connect(self.backup)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM attempts").fetchone()[0], 3)
        known = self.journal.show(intent()["request_id"])
        pending = self.journal.show(intent(2)["request_id"])
        self.assertEqual(known["observation"], self.known["observation"])
        self.assertEqual(known["last_candidate_id"], self.known["observation"]["id"])
        self.assertEqual(pending["idempotency_key"], self.pending["idempotency_key"])
        self.assertEqual(pending["state"], "UNKNOWN")
        self.assertEqual(result["journal_schema_version"], 2)

    def test_existing_backup_is_never_overwritten_and_upgrade_does_not_start(self):
        self.backup.write_bytes(b"keep original")
        with self.assertRaises((Problem, OSError)):
            self.journal.migrate(self.backup)
        self.assertEqual(self.backup.read_bytes(), b"keep original")
        with closing(sqlite3.connect(self.journal.path)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)

    def test_failure_after_alter_rolls_back_and_retains_valid_old_backup(self):
        original = self.journal._upgrade

        def fail(connection, digest):
            original(connection, digest)
            raise RuntimeError("injected failure before commit")

        with patch.object(self.journal, "_upgrade", fail), self.assertRaises(RuntimeError):
            self.journal.migrate(self.backup)
        for path in (self.journal.path, self.backup):
            with closing(sqlite3.connect(path)) as connection:
                self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)
                self.assertNotIn("candidate_id", [r[1] for r in connection.execute("PRAGMA table_info(attempts)")])

    def test_corrupt_old_history_is_refused_before_backup_or_upgrade(self):
        with closing(sqlite3.connect(self.journal.path, autocommit=True)) as connection:
            connection.execute("UPDATE intents SET body_sha256=?", ("0" * 64,))
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", lambda: self.journal.migrate(self.backup))
        self.assertFalse(self.backup.exists())

    def test_orphan_legacy_attempt_is_refused_before_backup(self):
        with closing(sqlite3.connect(self.journal.path, autocommit=True)) as connection:
            row = list(connection.execute("SELECT * FROM attempts LIMIT 1").fetchone())
            row[0], row[1] = uuid.uuid4().hex, "f" * 32
            connection.execute("INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?)", row)
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", lambda: self.journal.migrate(self.backup))
        self.assertFalse(self.backup.exists())

    def test_already_current_journal_refuses_a_second_migration(self):
        self.journal.migrate(self.backup)
        self.error("BRIDGE_JOURNAL_ALREADY_CURRENT", lambda: self.journal.migrate(self.folder / "another.sqlite3"))
