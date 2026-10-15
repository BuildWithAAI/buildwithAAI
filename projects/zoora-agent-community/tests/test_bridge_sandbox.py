"""Local HTTPS contract, process crashes, provider ambiguity and narrow transport."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import copy
import http.client
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from bridge_fixture import KEY, ProviderFixture, intent
from zoora_community.bridge_journal import JOURNAL_VERSION, LEASE_MS, RETRY_MS, BridgeJournal
from zoora_community.bridge_sandbox import (
    MAX_RESPONSE, BridgeSandboxClient, amount, body_value, read_key, transfer_body,
)
from zoora_community.validation import Problem, canonical

REFERENCE = "00000000-0000-0000-0000-000000000002"


class SandboxCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.provider = ProviderFixture()
        self.server = self.provider.serve()
        self.server.__enter__()
        self.addCleanup(self.server.__exit__, None, None, None)
        self.transport = self.provider.transport()
        self.transport.__enter__()
        self.addCleanup(self.transport.__exit__, None, None, None)
        self.client = BridgeSandboxClient(KEY)
        self.body = transfer_body(intent(), REFERENCE)

    def error(self, code, fn):
        with self.assertRaises(Problem) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)


class BridgeTransportTests(SandboxCase):
    def test_actual_https_post_binds_every_term_and_uses_documented_headers(self):
        observed = self.client.create(self.body, REFERENCE)
        record = self.provider.requests[0]
        self.assertEqual((record["method"], record["path"]), ("POST", "/v0/transfers"))
        self.assertEqual(record["headers"]["Api-Key"], KEY)
        self.assertEqual(record["headers"]["Idempotency-Key"], REFERENCE)
        self.assertEqual(json.loads(record["body"]), self.body)
        self.assertEqual(observed["state"], "awaiting_funds")
        self.assertNotIn(KEY, canonical(observed))
        self.assertNotIn("source_deposit_instructions", observed)

    def test_actual_https_poll_has_no_idempotency_header_and_binds_exact_id(self):
        created = self.client.create(self.body, REFERENCE)
        polled = self.client.poll(created["id"], self.body)
        self.assertEqual(created["id"], polled["id"])
        self.assertEqual(self.provider.requests[-1]["method"], "GET")
        self.assertNotIn("Idempotency-Key", self.provider.requests[-1]["headers"])

    def test_changed_customer_amount_address_mint_rail_and_reference_are_rejected(self):
        self.client.create(self.body, REFERENCE)
        original = copy.deepcopy(self.provider.effects[REFERENCE])
        changes = [("amount", "12.5"), ("on_behalf_of", REFERENCE), ("client_reference_id", REFERENCE[:-1] + "3")]
        for name, value in changes:
            with self.subTest(name=name):
                mutated = {**original, name: value}
                self.provider.body_override = canonical(mutated).encode()
                self.error("BRIDGE_RESPONSE_REJECTED", lambda: self.client.create(self.body, REFERENCE))
        for side, name, value in [("source", "from_address", self.body["destination"]["to_address"]),
                                  ("destination", "to_address", self.body["source"]["from_address"]),
                                  ("destination", "currency", "sol"), ("source", "payment_rail", "ethereum")]:
            with self.subTest(side=side, field=name):
                mutated = copy.deepcopy(original)
                mutated[side][name] = value
                self.provider.body_override = canonical(mutated).encode()
                self.error("BRIDGE_RESPONSE_REJECTED", lambda: self.client.create(self.body, REFERENCE))

    def test_poll_cannot_rebind_provider_identity(self):
        observed = self.client.create(self.body, REFERENCE)
        other = {**self.provider.effects[REFERENCE], "id": "00000000-0000-0000-0000-000000000004"}
        self.provider.body_override = canonical(other).encode()
        self.error("BRIDGE_RESPONSE_REJECTED", lambda: self.client.poll(observed["id"], self.body))

    def test_duplicate_nonfinite_nonobject_and_invalid_json_are_rejected(self):
        for raw in (b'{"id":1,"id":2}', b'{"amount":NaN}', b'[]', b'{bad'):
            with self.subTest(raw=raw):
                self.provider.body_override = raw
                self.error("BRIDGE_RESPONSE_REJECTED", lambda: self.client.create(self.body, REFERENCE))

    def test_response_size_is_bounded(self):
        self.provider.body_override = b" " * (MAX_RESPONSE + 1)
        self.error("BRIDGE_RESPONSE_TOO_LARGE", lambda: self.client.create(self.body, REFERENCE))

    def test_truncated_or_invalid_content_length_is_not_a_complete_observation(self):
        self.provider.declared_length = 64_000
        self.error("BRIDGE_RESPONSE_REJECTED", lambda: self.client.create(self.body, REFERENCE))
        self.provider.declared_length = "not-a-length"
        self.error("BRIDGE_RESPONSE_REJECTED", lambda: self.client.create(self.body, REFERENCE))

    def test_client_reference_and_idempotency_key_cannot_diverge(self):
        other = "00000000-0000-0000-0000-000000000003"
        self.error("BRIDGE_REFERENCE_KEY_MISMATCH", lambda: self.client.create(self.body, other))
        self.assertEqual(self.provider.requests, [])

    def test_redirect_and_provider_error_never_follow_or_disclose_body(self):
        for code in (302, 401, 403, 409, 422, 429, 500):
            with self.subTest(status=code):
                self.provider.status = code
                self.provider.body_override = ("provider reflected " + KEY).encode()
                self.error("BRIDGE_HTTP_" + str(code), lambda: self.client.create(self.body, REFERENCE))
        self.assertEqual(len(self.provider.requests), 7)

    def test_compression_and_wrong_content_type_are_rejected(self):
        self.provider.encoding = "gzip"
        self.error("BRIDGE_ENCODING_REJECTED", lambda: self.client.create(self.body, REFERENCE))
        self.provider.encoding = None
        self.provider.content_type = "text/html"
        self.error("BRIDGE_ENCODING_REJECTED", lambda: self.client.create(self.body, REFERENCE))

    def test_total_deadline_is_checked_before_reading(self):
        with patch("zoora_community.bridge_sandbox.time.monotonic", side_effect=[0, 11]):
            self.error("BRIDGE_TIMEOUT", lambda: self.client.create(self.body, REFERENCE))

    def test_unknown_certificate_is_rejected_with_verification_enabled(self):
        self.transport.__exit__(None, None, None)
        original = http.client.HTTPSConnection

        def local(host, *, timeout, context):
            self.assertTrue(context.check_hostname)
            return original("127.0.0.1", self.provider.port, timeout=timeout, context=context)

        with patch("zoora_community.bridge_sandbox.HTTPSConnection", local):
            self.error("BRIDGE_UNAVAILABLE", lambda: self.client.create(self.body, REFERENCE))
        self.assertEqual(self.provider.requests, [])

    def test_only_sandbox_keys_and_the_two_narrow_operations_are_accepted(self):
        for value in ("sk-live-DO-NOT-USE-PRODUCTION", KEY + "\r\nX: bad", KEY + " ", "short", None):
            self.error("BRIDGE_SANDBOX_KEY_REQUIRED", lambda value=value: BridgeSandboxClient(value))
        for method, path in [("DELETE", "/v0/transfers"), ("POST", "https://api.bridge.xyz/v0/transfers"),
                             ("GET", "/v0/customers"), ("GET", "/v0/transfers/../customers")]:
            with self.assertRaises(Problem):
                self.client._request(method, path)
        self.assertEqual(self.provider.requests, [])

    def test_amounts_are_exact_six_decimal_strings_without_float_or_exponent(self):
        self.assertEqual(amount("0.000001"), "0.000001")
        self.assertEqual(amount("12.5"), "12.500000")
        for value in (0, 1.0, True, "0", "-1", "1e6", "01", "1.0000001", "1000000.000001", " 2", "2."):
            self.error("INVALID_BRIDGE_AMOUNT", lambda value=value: amount(value))

    def test_unreviewed_flags_fees_routes_and_fields_cannot_be_smuggled(self):
        for key in ("developer_fee", "features", "dry_run", "private_key"):
            self.error("INVALID_FIELDS", lambda key=key: body_value({**self.body, key: "unreviewed"}))
        value = copy.deepcopy(self.body)
        value["source"]["payment_rail"] = "bridge_wallet"
        self.error("INVALID_BRIDGE_BODY", lambda: body_value(value))

    def test_key_file_does_not_accept_symlink_public_permissions_or_extra_lines(self):
        key_file = self.folder / "sandbox-key"
        key_file.write_text(KEY + "\n", encoding="ascii")
        key_file.chmod(0o600)
        self.assertEqual(read_key(key_file), KEY)
        if os.name == "posix":
            link = self.folder / "link"
            link.symlink_to(key_file)
            self.error("UNSAFE_BRIDGE_KEY_FILE", lambda: read_key(link))
            key_file.chmod(0o644)
            self.error("UNSAFE_BRIDGE_KEY_FILE", lambda: read_key(key_file))
            key_file.chmod(0o600)
        key_file.write_text(KEY + "\nother", encoding="ascii")
        self.error("BRIDGE_SANDBOX_KEY_REQUIRED", lambda: read_key(key_file))


class BridgeJournalTests(SandboxCase):
    def setUp(self):
        super().setUp()
        self.at = 1_800_000_000_000
        self.journal = BridgeJournal(self.folder / "journal", clock=lambda: self.at)
        self.initial = self.journal.prepare(intent())

    def advance(self):
        return self.journal.advance(intent()["request_id"], self.client)

    def test_prepare_is_durable_idempotent_and_does_not_call_the_provider(self):
        self.assertEqual(self.initial, self.journal.prepare(intent()))
        reopened = BridgeJournal(self.journal.state).show(intent()["request_id"])
        self.assertEqual(reopened, self.initial)
        self.assertEqual(self.provider.requests, [])
        self.assertEqual(self.initial["state"], "PREPARED")
        self.error("BRIDGE_INTENT_CONFLICT", lambda: self.journal.prepare({**intent(), "amount_usdc": "99"}))

    def test_lost_acknowledgment_retains_exact_body_key_and_one_fixture_effect(self):
        self.provider.mode = "drop"
        unknown = self.advance()
        self.assertEqual(unknown["state"], "UNKNOWN")
        self.assertEqual(len(self.provider.effects), 1)
        self.provider.mode = "ok"
        recovered = self.advance()
        self.assertEqual(recovered["state"], "OBSERVED")
        self.assertEqual(recovered["attempts"], 2)
        first, second = self.provider.requests
        self.assertEqual(first["body"], second["body"])
        self.assertEqual(first["headers"]["Idempotency-Key"], second["headers"]["Idempotency-Key"])
        self.assertEqual(len(self.provider.effects), 1)

    def test_known_transfer_is_only_polled_even_after_retry_window(self):
        before = self.advance()
        self.at += RETRY_MS + 1_000_000
        self.provider.effects[before["idempotency_key"]]["state"] = "payment_processed"
        after = self.advance()
        self.assertEqual(after["observation"]["state"], "payment_processed")
        self.assertEqual([r["method"] for r in self.provider.requests], ["POST", "GET"])
        self.assertEqual(after["settlement_accounting"], "UNAVAILABLE")
        self.assertFalse(after["wallet_execution"])

    def test_unknown_outcome_past_conservative_window_blocks_any_new_http(self):
        self.provider.mode = "drop"
        self.advance()
        self.at += RETRY_MS
        self.error("BRIDGE_RETRY_WINDOW_CLOSED_RECONCILE_REQUIRED", self.advance)
        self.assertEqual(len(self.provider.requests), 1)
        self.assertEqual(self.journal.show(intent()["request_id"])["state"], "UNKNOWN")

    def test_credential_change_is_blocked_before_network(self):
        self.advance()
        other = BridgeSandboxClient(KEY + "-rotated")
        self.error("BRIDGE_CREDENTIAL_CHANGED_RECONCILE_REQUIRED", lambda: self.journal.advance(intent()["request_id"], other))
        self.assertEqual(len(self.provider.requests), 1)

    def test_clock_rollback_does_not_widen_retry_window(self):
        self.advance()
        self.at -= 1
        self.error("BRIDGE_CLOCK_REGRESSION", self.advance)
        self.assertEqual(len(self.provider.requests), 1)

    def test_failed_poll_retains_old_evidence_and_marks_latest_outcome_unknown(self):
        observed = self.advance()
        self.at += 1
        self.provider.status = 500
        after = self.advance()
        self.assertEqual(after["state"], "UNKNOWN")
        self.assertEqual(after["observation"], observed["observation"])
        self.assertEqual(after["observation_at_ms"], observed["observation_at_ms"])
        self.assertEqual(after["last_attempt_error"], "BRIDGE_HTTP_500")
        self.assertEqual(self.provider.requests[-1]["method"], "GET")

    def test_concurrent_connections_cannot_claim_one_unfinished_attempt(self):
        self.provider.mode = "block"
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(self.advance)
            self.assertTrue(self.provider.entered.wait(timeout=5))
            other = BridgeJournal(self.journal.state, clock=lambda: self.at)
            self.error("BRIDGE_ATTEMPT_BUSY", lambda: other.advance(intent()["request_id"], self.client))
            self.provider.release.set()
            self.assertEqual(first.result(timeout=10)["state"], "OBSERVED")
        self.assertEqual(len(self.provider.requests), 1)

    def test_stale_worker_cannot_overwrite_newer_reconciliation(self):
        self.provider.mode = "block"
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(self.advance)
            self.assertTrue(self.provider.entered.wait(timeout=5))
            self.at += LEASE_MS + 1
            self.provider.mode = "ok"
            newer = self.advance()
            self.provider.release.set()
            self.error("BRIDGE_STALE_ATTEMPT", lambda: first.result(timeout=10))
        self.assertEqual(self.journal.show(intent()["request_id"])["observation"], newer["observation"])
        self.assertEqual(len(self.provider.effects), 1)

    def test_actual_cli_process_death_after_https_acceptance_recovers_same_key(self):
        key_file = self.folder / "key"
        key_file.write_text(KEY, encoding="ascii")
        key_file.chmod(0o600)
        args = ["advance", "--request-id", intent()["request_id"], "--key-file", key_file]
        crashed = self.provider.cli(self.journal.state, args, at=self.at, crash=True)
        self.assertEqual(crashed.returncode, 79, crashed.stderr)
        pending = self.journal.show(intent()["request_id"])
        self.assertEqual(pending["state"], "UNKNOWN")
        self.assertTrue(pending["incomplete_attempt"])
        self.error("BRIDGE_ATTEMPT_BUSY", self.advance)
        self.at += LEASE_MS + 1
        recovered = self.advance()
        self.assertEqual(recovered["state"], "OBSERVED")
        self.assertEqual(len(self.provider.effects), 1)
        self.assertEqual(recovered["idempotency_key"], pending["idempotency_key"])

    def test_two_actual_cli_processes_cannot_dispatch_one_active_attempt(self):
        key_file = self.folder / "key"
        key_file.write_text(KEY, encoding="ascii")
        key_file.chmod(0o600)
        args = ["advance", "--request-id", intent()["request_id"], "--key-file", key_file]
        self.provider.mode = "block"
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(self.provider.cli, self.journal.state, args, at=self.at)
            self.assertTrue(self.provider.entered.wait(timeout=5))
            second = self.provider.cli(self.journal.state, args, at=self.at)
            self.provider.release.set()
            self.assertEqual(second.returncode, 1, second.stdout)
            self.assertEqual(json.loads(second.stderr)["error"], "BRIDGE_ATTEMPT_BUSY")
            done = first.result(timeout=10)
            self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(len(self.provider.requests), 1)

    def test_private_directory_and_schema_are_checked_before_dispatch(self):
        with closing(sqlite3.connect(self.journal.path, autocommit=True)) as connection:
            connection.execute(f"PRAGMA user_version={JOURNAL_VERSION + 1}")
        self.error("BRIDGE_JOURNAL_SCHEMA_REJECTED", self.advance)
        if os.name == "posix":
            self.journal.state.chmod(0o755)
            self.error("BRIDGE_PRIVATE_DIRECTORY_REQUIRED", self.advance)
            self.journal.state.chmod(0o700)
        self.assertEqual(self.provider.requests, [])

    def test_schema_and_binding_corruption_are_refused_before_network(self):
        with closing(sqlite3.connect(self.journal.path, autocommit=True)) as connection:
            connection.execute("UPDATE intents SET body_sha256=?", ("0" * 64,))
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", self.advance)
        self.assertEqual(self.provider.requests, [])

    def test_malformed_prepared_json_is_a_safe_consistency_failure(self):
        with closing(sqlite3.connect(self.journal.path, autocommit=True)) as connection:
            connection.execute("UPDATE intents SET intent_json='{' ")
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", lambda: self.journal.prepare(intent()))

    def test_observation_cannot_be_moved_to_another_body(self):
        self.advance()
        with closing(sqlite3.connect(self.journal.path, autocommit=True)) as connection:
            value = json.loads(connection.execute("SELECT observation_json FROM attempts").fetchone()[0])
            value["body_sha256"] = "0" * 64
            connection.execute("UPDATE attempts SET observation_json=?", (canonical(value),))
        self.error("BRIDGE_JOURNAL_CONSISTENCY_FAILURE", self.advance)
        self.assertEqual(len(self.provider.requests), 1)

    def test_attempt_and_intent_capacity_are_bounded_without_more_http(self):
        with patch("zoora_community.bridge_journal.MAX_ATTEMPTS", 1):
            self.advance()
            self.error("BRIDGE_ATTEMPT_LIMIT", self.advance)
        with patch("zoora_community.bridge_journal.MAX_INTENTS", 1):
            self.error("BRIDGE_INTENT_LIMIT", lambda: self.journal.prepare(intent(2)))
        self.assertEqual(len(self.provider.requests), 1)

    def test_api_key_is_absent_from_database_and_views(self):
        value = self.advance()
        self.assertNotIn(KEY, canonical(value))
        self.assertNotIn(KEY.encode(), self.journal.path.read_bytes())
        self.assertFalse(value["commerce_budget_integration"])
