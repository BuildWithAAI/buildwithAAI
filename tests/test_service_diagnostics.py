"""Failure evidence must identify the request without copying credentials or payloads."""

import json
import unittest

from scripts import research_services_worker as w


class FailureEvidenceTests(unittest.TestCase):
    def test_context_keeps_only_operation_and_valid_public_identifiers(self):
        context = w.failure_context("act", {
            "credential": "private-credential-path", "token": "secret-token", "origin": "private-origin",
            "action": {"kind": "ORDER", "request_id": "1" * 32, "order_id": "2" * 32,
                       "instructions": "secret-seller-content", "authorization": "Bearer secret-token"},
        })
        self.assertEqual(context, {"operation": "act", "kind": "ORDER", "request_id": "1" * 32, "order_id": "2" * 32})

    def test_malformed_context_cannot_become_a_secret_log(self):
        self.assertEqual(w.failure_context("Bearer secret-token", {"action": "secret-body"}), {})
        self.assertEqual(w.failure_context("act", {"action": {"kind": "secret-kind", "request_id": "secret-token"}}),
                         {"operation": "act"})

    def test_failure_retains_child_code_request_and_completed_checks(self):
        error = ValueError("Untrusted remote response with secret-token")
        error.source_error_code = "SERVICE_NOT_FOUND"
        error.service_context = {"operation": "act", "kind": "CANCEL", "request_id": "1" * 32,
                                 "order_id": "2" * 32, "token": "secret-token"}
        value = w.failure_document(error, {"first_passed": True, "not_completed": False})
        self.assertEqual(value["error_code"], "SERVICE_NOT_FOUND")
        self.assertEqual(value["context"]["kind"], "CANCEL")
        self.assertEqual(value["completed_checks"], ["first_passed"])
        self.assertEqual(value["status"], "INCOMPLETE")
        self.assertFalse(value["financial_settlement"])
        self.assertFalse(value["live_execution_allowed"])
        self.assertNotIn("secret-token", json.dumps(value))

    def test_trace_retains_location_without_exception_text_or_absolute_paths(self):
        try:
            raise RuntimeError("private-credential-path secret-token")
        except RuntimeError as error:
            value = w.failure_document(error, {})
        self.assertTrue(value["trace"])
        self.assertEqual(value["trace"][-1]["file"], "test_service_diagnostics.py")
        self.assertNotIn("secret-token", json.dumps(value))
        self.assertNotIn("private-credential-path", json.dumps(value))
        self.assertIsNone(value["error_code"])

    def test_only_static_domain_codes_are_retained_from_value_errors(self):
        self.assertEqual(w.failure_document(ValueError("SERVICE_RACE_OVERSUBSCRIBED"), {})["error_code"],
                         "SERVICE_RACE_OVERSUBSCRIBED")
        self.assertIsNone(w.failure_document(ValueError("request failed: Bearer secret-token"), {})["error_code"])


if __name__ == "__main__":
    unittest.main()
