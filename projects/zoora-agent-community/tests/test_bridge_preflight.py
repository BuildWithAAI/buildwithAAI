"""Customer onboarding signals over real local TLS, without journal or payment grants."""

import hashlib
import json
from unittest.mock import patch

from test_bridge_sandbox import SandboxCase
from bridge_fixture import KEY, customer, intent
from zoora_community.bridge_journal import BridgeJournal
from zoora_community.bridge_sandbox import MAX_RESPONSE, BridgeSandboxClient
from zoora_community.validation import Problem, canonical


class BridgePreflightTests(SandboxCase):
    def preflight(self):
        return self.client.preflight(intent()["customer_id"])

    def test_exact_customer_get_returns_only_redacted_signals_and_provenance(self):
        result = self.preflight()
        wire = self.provider.requests[0]
        self.assertEqual((wire["method"], wire["path"], wire["body"]),
            ("GET", "/v0/customers/" + intent()["customer_id"], None))
        self.assertEqual(wire["headers"]["Api-Key"], KEY)
        self.assertNotIn("Idempotency-Key", wire["headers"])
        self.assertEqual(result["assessment"], "CUSTOMER_SIGNALS_OBSERVED")
        self.assertEqual(result["response_sha256"], hashlib.sha256(canonical(customer()).encode()).hexdigest())
        self.assertEqual(result["credential_sha256"], self.client.credential_fingerprint)
        for secret in (KEY, "PRIVATE", "first_name", "email", "developer_reason", "capabilities"):
            self.assertNotIn(secret, canonical(result))
        self.assertEqual(self.provider.effects, {})

    def test_observation_is_never_payment_route_settlement_or_rotation_authority(self):
        result = self.preflight()
        for field in ("may_authorize_new_post", "credential_rotation_authorized",
                "provider_account_continuity_verified", "solana_usdc_route_verified", "wallet_execution"):
            self.assertIs(result[field], False)
        self.assertEqual(result["settlement_accounting"], "UNAVAILABLE")
        self.assertEqual(result["scope"], "BASE_CUSTOMER_ONBOARDING_ONLY")

    def test_current_documented_response_does_not_invent_a_missing_kyc_status(self):
        result = self.preflight()
        self.assertIsNone(result["kyc_status"])
        self.assertEqual(result["missing_fields"], [])

    def test_explicit_conflicting_legacy_kyc_blocks_otherwise_approved_customer(self):
        for value in ("paused", "rejected", "deposits_restricted", "offboarded", "under_review"):
            self.provider.customer["kyc_status"] = value
            result = self.preflight()
            self.assertEqual(result["assessment"], "CUSTOMER_SIGNALS_BLOCKED")
            self.assertIn("kyc_status", result["blocking_fields"])

    def test_legacy_kyc_approval_is_retained_without_synthesizing_customer_status(self):
        self.provider.customer["kyc_status"] = "approved"
        del self.provider.customer["status"]
        result = self.preflight()
        self.assertEqual(result["assessment"], "CUSTOMER_SIGNALS_INCOMPLETE")
        self.assertIsNone(result["customer_status"])
        self.assertEqual(result["missing_fields"], ["customer_status"])

    def test_all_documented_nonactive_customer_states_block(self):
        for value in ("awaiting_questionnaire", "awaiting_ubo", "deposits_restricted", "incomplete",
                "not_started", "offboarded", "paused", "rejected", "under_review"):
            self.provider.customer["status"] = value
            result = self.preflight()
            self.assertEqual(result["assessment"], "CUSTOMER_SIGNALS_BLOCKED")
            self.assertIn("customer_status", result["blocking_fields"])

    def test_unknown_status_strings_are_never_reflected_or_treated_as_approval(self):
        for field in ("status", "kyc_status"):
            self.provider.customer = {**customer(), field: "private-person@example.test"}
            result = self.preflight()
            self.assertEqual(result["assessment"], "CUSTOMER_SIGNALS_BLOCKED")
            self.assertNotIn("private-person", canonical(result))
            self.assertIn("UNRECOGNIZED", canonical(result))
        self.provider.customer = customer()
        self.provider.customer["endorsements"][0]["status"] = KEY
        self.assertNotIn(KEY, canonical(self.preflight()))

    def test_missing_and_null_terms_are_incomplete_and_false_terms_block(self):
        for value in (None, False):
            self.provider.customer["has_accepted_terms_of_service"] = value
            result = self.preflight()
            self.assertEqual(result["assessment"], "CUSTOMER_SIGNALS_INCOMPLETE" if value is None else "CUSTOMER_SIGNALS_BLOCKED")
        del self.provider.customer["has_accepted_terms_of_service"]
        self.assertIn("terms_accepted", self.preflight()["missing_fields"])

    def test_truthy_terms_strings_and_integers_are_rejected(self):
        for value in ("true", 1, 0, [], {}):
            self.provider.customer["has_accepted_terms_of_service"] = value
            self.error("BRIDGE_CUSTOMER_RESPONSE_REJECTED", self.preflight)

    def test_customer_response_must_match_exact_requested_uuid(self):
        for value in ("00000000-0000-0000-0000-000000000002", None, True, "PRIVATE CUSTOMER"):
            self.provider.customer["id"] = value
            self.error("BRIDGE_CUSTOMER_RESPONSE_REJECTED", self.preflight)

    def test_invalid_caller_uuid_cannot_reach_network(self):
        for value in (None, "../transfers", intent()["customer_id"] + "?expand=all", "https://api.bridge.xyz", 1):
            self.error("INVALID_BRIDGE_ID", lambda value=value: self.client.preflight(value))
        self.assertEqual(self.provider.requests, [])

    def test_missing_empty_or_unrelated_endorsements_do_not_imply_base_approval(self):
        for value in (None, [], [{"name": "sepa", "status": "approved"}]):
            self.provider.customer["endorsements"] = value
            result = self.preflight()
            self.assertEqual(result["assessment"], "CUSTOMER_SIGNALS_INCOMPLETE")
            self.assertIsNone(result["base_endorsement_status"])

    def test_other_endorsements_and_private_requirements_are_never_disclosed(self):
        self.provider.customer["endorsements"].append({"name": "PRIVATE ENDORSEMENT", "status": "PRIVATE STATUS", "requirements": {"PRIVATE": KEY}})
        self.assertEqual(self.preflight()["assessment"], "CUSTOMER_SIGNALS_OBSERVED")
        self.assertNotIn("PRIVATE", canonical(self.preflight()))

    def test_duplicate_base_approval_is_rejected_even_with_conflicting_status(self):
        self.provider.customer["endorsements"].append({"name": "base", "status": "rejected"})
        self.error("BRIDGE_CUSTOMER_RESPONSE_REJECTED", self.preflight)

    def test_malformed_or_oversized_endorsement_collection_is_rejected(self):
        for value in ({}, "base", [None], [{}], [{"name": True}], [{"name": "x" * 65}],
                [{"name": str(i), "status": "approved"} for i in range(33)]):
            self.provider.customer["endorsements"] = value
            self.error("BRIDGE_CUSTOMER_RESPONSE_REJECTED", self.preflight)

    def test_incomplete_rejected_or_unrecognized_base_status_blocks(self):
        for value in ("incomplete", "pending", "rejected", "NEW_PROVIDER_STATUS"):
            self.provider.customer["endorsements"][0]["status"] = value
            result = self.preflight()
            self.assertEqual(result["assessment"], "CUSTOMER_SIGNALS_BLOCKED")
            self.assertIn("base_endorsement_status", result["blocking_fields"])

    def test_missing_base_status_or_requirements_is_incomplete(self):
        for field in ("status", "requirements"):
            self.provider.customer = customer()
            del self.provider.customer["endorsements"][0][field]
            self.assertEqual(self.preflight()["assessment"], "CUSTOMER_SIGNALS_INCOMPLETE")

    def test_approved_base_with_outstanding_requirements_stays_blocked(self):
        for field, value in (("pending", ["PRIVATE PENDING"]), ("issues", [{"PRIVATE": KEY}]),
                ("missing", {"all_of": ["PRIVATE MISSING"]})):
            self.provider.customer = customer()
            self.provider.customer["endorsements"][0]["requirements"][field] = value
            result = self.preflight()
            self.assertIs(result["base_requirements_clear"], False)
            self.assertEqual(result["blocking_fields"], ["base_requirements_clear"])
            self.assertNotIn("PRIVATE", canonical(result))

    def test_partial_requirement_summary_does_not_claim_clearance(self):
        for field in ("pending", "issues", "missing"):
            self.provider.customer = customer()
            del self.provider.customer["endorsements"][0]["requirements"][field]
            result = self.preflight()
            self.assertIsNone(result["base_requirements_clear"])
            self.assertEqual(result["assessment"], "CUSTOMER_SIGNALS_INCOMPLETE")

    def test_malformed_requirement_summaries_are_rejected_without_reflection(self):
        for value in ([], "PRIVATE", {"pending": None}, {"issues": True}, {"missing": []}, {"pending": ["x"] * 257}):
            self.provider.customer["endorsements"][0]["requirements"] = value
            self.error("BRIDGE_CUSTOMER_RESPONSE_REJECTED", self.preflight)

    def test_nonstring_and_oversized_status_fields_are_rejected(self):
        for field in ("status", "kyc_status"):
            for value in (True, [], {}, 1, "x" * 65):
                self.provider.customer = {**customer(), field: value}
                self.error("BRIDGE_CUSTOMER_RESPONSE_REJECTED", self.preflight)

    def test_deprecated_capabilities_cannot_replace_current_approval_signals(self):
        self.provider.customer = {"id": intent()["customer_id"], "capabilities": {"payin_crypto": "active", "payout_crypto": "active"}}
        result = self.preflight()
        self.assertEqual(result["assessment"], "CUSTOMER_SIGNALS_INCOMPLETE")
        self.assertEqual(len(result["missing_fields"]), 4)

    def test_extra_personal_fields_change_response_hash_but_never_projection(self):
        first = self.preflight()
        self.provider.customer["email"] = "another-private-email@example.test"
        second = self.preflight()
        self.assertNotEqual(first.pop("response_sha256"), second.pop("response_sha256"))
        self.assertEqual(first, second)

    def test_http_errors_and_redirects_do_not_echo_provider_bodies(self):
        for code in (302, 401, 403, 404, 429, 500):
            self.provider.status = code
            self.provider.body_override = (KEY + " PRIVATE ERROR").encode()
            self.error("BRIDGE_HTTP_" + str(code), self.preflight)
        self.assertEqual(len(self.provider.requests), 6)

    def test_customer_response_inherits_bounded_strict_json_transport(self):
        for raw in (b'{"id":1,"id":2}', b'{"status":NaN}', b'[]', b'null', b'{bad'):
            self.provider.body_override = raw
            self.error("BRIDGE_RESPONSE_REJECTED", self.preflight)
        self.provider.body_override = b" " * (MAX_RESPONSE + 1)
        self.error("BRIDGE_RESPONSE_TOO_LARGE", self.preflight)

    def test_customer_get_cannot_expand_into_generic_mutation_or_list_api(self):
        target = "/v0/customers/" + intent()["customer_id"]
        for method, path, body, key in (("POST", target, self.body, None), ("DELETE", target, None, None),
                ("GET", "/v0/customers", None, None), ("GET", target + "/endorsements", None, None),
                ("GET", target + "?expand=all", None, None), ("GET", target, self.body, None),
                ("GET", target, None, "00000000-0000-0000-0000-000000000002")):
            with self.assertRaises(Problem):
                self.client._request(method, path, body, key)
        self.assertEqual(self.provider.requests, [])

    def test_actual_cli_works_without_state_and_reports_blocked_signals_as_exit_two(self):
        key = self.folder / "sandbox-key"
        key.write_text(KEY, encoding="ascii")
        key.chmod(0o600)
        args = ["preflight", "--customer-id", intent()["customer_id"], "--key-file", key]
        result = self.provider.cli(None, args)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["assessment"], "CUSTOMER_SIGNALS_OBSERVED")
        self.provider.customer["status"] = "paused"
        result = self.provider.cli(None, args)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(json.loads(result.stdout)["assessment"], "CUSTOMER_SIGNALS_BLOCKED")
        self.assertEqual(list(self.folder.iterdir()), [key])

    def test_actual_cli_rejects_state_argument_before_network_or_directory_creation(self):
        result = self.provider.cli(self.folder / "must-not-exist",
            ["preflight", "--customer-id", intent()["customer_id"], "--key-file", self.folder / "missing"])
        self.assertEqual(result.returncode, 2)
        self.assertIn("preflight does not accept --state", result.stderr)
        self.assertFalse((self.folder / "must-not-exist").exists())
        self.assertEqual(self.provider.requests, [])

    def test_actual_cli_provider_failure_has_only_redacted_error_and_no_journal(self):
        key = self.folder / "key"
        key.write_text(KEY, encoding="ascii")
        key.chmod(0o600)
        self.provider.status = 401
        self.provider.body_override = KEY.encode()
        result = self.provider.cli(None, ["preflight", "--customer-id", intent()["customer_id"], "--key-file", key])
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr), {"error": "BRIDGE_HTTP_401"})
        self.assertEqual(list(self.folder.iterdir()), [key])

    def test_preflight_cannot_mutate_or_rebind_existing_credential_bound_journal(self):
        journal = BridgeJournal(self.folder / "state")
        journal.prepare(intent())
        with patch("zoora_community.bridge_journal.time.time_ns", return_value=1_800_000_000_000_000_000):
            self.provider.mode = "drop"
            journal.advance(intent()["request_id"], self.client)
            before = journal.show(intent()["request_id"])
            digest = hashlib.sha256(journal.path.read_bytes()).hexdigest()
            self.provider.mode = "ok"
            self.preflight()
            self.assertEqual(journal.show(intent()["request_id"]), before)
            self.assertEqual(hashlib.sha256(journal.path.read_bytes()).hexdigest(), digest)
        self.assertEqual([r["method"] for r in self.provider.requests], ["POST", "GET"])
        self.assertEqual(len(self.provider.effects), 1)

    def test_successful_preflight_with_new_key_cannot_rotate_saved_payment_credentials(self):
        journal = BridgeJournal(self.folder / "state")
        journal.prepare(intent())
        self.provider.mode = "drop"
        journal.advance(intent()["request_id"], self.client)
        self.provider.mode = "ok"
        new_client = BridgeSandboxClient(KEY + "X")
        self.assertEqual(new_client.preflight(intent()["customer_id"])["assessment"], "CUSTOMER_SIGNALS_OBSERVED")
        before = len(self.provider.requests)
        self.error("BRIDGE_CREDENTIAL_CHANGED_RECONCILE_REQUIRED",
            lambda: journal.advance(intent()["request_id"], new_client))
        self.assertEqual(len(self.provider.requests), before)


if __name__ == "__main__":
    import unittest
    unittest.main()
