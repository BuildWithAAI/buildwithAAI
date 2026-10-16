"""Safe delivery retries apply only to exact idempotent commerce commands."""

import copy
import unittest
from unittest.mock import patch

from test_payment_pipeline import PipelineCase
from zoora_community.client import commerce_action
from zoora_community.validation import Problem, canonical


class DeliveryClientTests(unittest.TestCase):
    def setUp(self):
        self.body = {"request_id": "a" * 32, "command": {"kind": "REVOKE"}}
        self.calls = []

    def request(self, method, path, body, token):
        self.calls.append((method, path, copy.deepcopy(body), token))
        return self.reply(method, path, body, token)

    def test_storage_retries_keep_frozen_command_even_if_a_caller_or_transport_mutates_it(self):
        original = copy.deepcopy(self.body)

        def reply(_method, _path, body, _token):
            if len(self.calls) < 3:
                self.body["request_id"] = "b" * 32
                body["request_id"] = "c" * 32
                raise Problem(503, "STORAGE_UNAVAILABLE")
            return 201, {"outcome": "REVOKED"}

        self.reply = reply
        with patch("zoora_community.client.time.sleep"):
            self.assertEqual(commerce_action(self, "d" * 32, self.body, "local-token")[1]["outcome"], "REVOKED")
        self.assertEqual(len(self.calls), 3)
        self.assertTrue(all(c[:3] == ("POST", "/v1/commerce/books/" + "d" * 32 + "/actions", original) for c in self.calls))

    def test_permanent_storage_failure_stops_after_three_exact_attempts(self):
        def reply(*_args):
            raise Problem(503, "STORAGE_UNAVAILABLE")
        self.reply = reply
        with patch("zoora_community.client.time.sleep"), self.assertRaises(Problem) as caught:
            commerce_action(self, "d" * 32, self.body, "local-token")
        self.assertEqual(caught.exception.code, "STORAGE_UNAVAILABLE")
        self.assertEqual(len(self.calls), 3)

    def test_unknown_network_delivery_stays_explicitly_uncertain_after_bounded_retries(self):
        def reply(*_args):
            raise OSError("PRIVATE PROVIDER DETAIL")
        self.reply = reply
        with patch("zoora_community.client.time.sleep"), self.assertRaises(Problem) as caught:
            commerce_action(self, "d" * 32, self.body, "local-token")
        self.assertEqual(caught.exception.code, "COMMERCE_DELIVERY_UNCERTAIN")
        self.assertEqual(len(self.calls), 3)

    def test_unauthorized_conflicted_or_rate_limited_commands_are_never_retried(self):
        for status, code in ((401, "UNAUTHORIZED"), (409, "COMMERCE_REQUEST_CONFLICT"), (429, "RATE_LIMITED")):
            self.calls = []
            def reply(*_args, status=status, code=code):
                raise Problem(status, code)
            self.reply = reply
            with self.assertRaises(Problem):
                commerce_action(self, "d" * 32, self.body, "local-token")
            self.assertEqual(len(self.calls), 1)

    def test_invalid_bounds_other_routes_and_secret_fields_fail_before_delivery(self):
        for bound in (0, 4, True):
            with self.assertRaises(Problem):
                commerce_action(self, "d" * 32, self.body, "local-token", attempts=bound)
        for book_id, body in (("../operators", self.body), ("d" * 32, {**self.body, "api_key": "PRIVATE"})):
            with self.assertRaises(Problem):
                commerce_action(self, book_id, body, "local-token")
        self.assertEqual(self.calls, [])


class DeliveryIntegrationTests(PipelineCase):
    def test_lost_committed_source_reply_replays_one_command_and_creates_one_provider_effect(self):
        key = self.stage()["order_id"]
        original = self.api.request
        submitted = []

        def drop_once(method, path, body=None, token=None):
            result = original(method, path, body, token)
            if method == "POST" and body and body.get("command", {}).get("kind") == "SUBMIT":
                submitted.append((canonical(body), result[1]["replayed"]))
                if len(submitted) == 1:
                    raise ConnectionResetError("PRIVATE LOST REPLY")
            return result

        with patch.object(self.api, "request", drop_once):
            self.assertEqual(self.run_one(key)["phase"], "PROVIDER_OBSERVED")
        self.assertEqual(len(submitted), 2)
        self.assertEqual(submitted[0][0], submitted[1][0])
        self.assertEqual([s[1] for s in submitted], [False, True])
        book = self.api.request("GET", self.route, token=self.agent)[1]
        self.assertEqual(book["revision"], 2)
        self.assertEqual(len(self.provider.effects), 1)
        self.f.store.audit()
