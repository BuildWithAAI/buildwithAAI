"""SYNTHETIC Telegram API boundary checks; transport never reaches Telegram."""
import unittest
import io
import json
import urllib.error
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from src.aai_scanner.config import Config
from src.aai_scanner.service import Scanner
from src.aai_scanner.storage import Store
from src.aai_scanner.telegram import TelegramBot
from src.aai_scanner.transport import ProviderError
from tests.scanner_fixtures import FakeMarket, FakeRPC, MINT

IDENTITY = {"id": 123456, "is_bot": True, "username": "SyntheticTestBot", "first_name": "SYNTHETIC"}
WEBHOOK = {"url": "", "has_custom_certificate": False, "pending_update_count": 0}
UPDATE = {"update_id": 5, "message": {"chat": {"id": 42, "type": "private"}, "text": "/help"}}
DELIVERY = {"message_id": 7, "chat": {"id": 42, "type": "private"}}


class TelegramBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.addCleanup(self.store.close)
        self.scanner = Scanner(Config(), self.store, FakeRPC(), FakeMarket())
        self.environment = {"AAI_TELEGRAM_ENABLED": "1", "AAI_TELEGRAM_BOT_TOKEN": "123456:" + "x" * 32,
                            "AAI_TELEGRAM_ALLOWED_CHAT_IDS": "42", "AAI_TELEGRAM_EXPECTED_USERNAME": ""}
        with patch.dict("os.environ", self.environment):
            self.bot = TelegramBot(self.scanner, self.store, "https://scanner.example")

    def test_identity_check_sends_no_messages_and_does_not_certify_commands(self):
        with patch.object(self.bot, "_api", side_effect=[IDENTITY, WEBHOOK]) as api:
            result = self.bot.check()
        self.assertEqual([call.args[0] for call in api.call_args_list], ["getMe", "getWebhookInfo"])
        self.assertEqual(result["messages_sent"], 0)
        self.assertFalse(result["commands_verified"])

    def test_malformed_nonbot_or_missing_identity_is_not_available(self):
        for identity in (None, [], {}, dict(IDENTITY, id=True), dict(IDENTITY, is_bot=False), dict(IDENTITY, username="evil\nurl")):
            with patch.object(self.bot, "_api", return_value=identity), self.assertRaises(ProviderError):
                self.bot.check()

    def test_expected_bot_username_mismatch_fails_before_webhook_or_polling(self):
        self.bot.expected_username = "AAIScanBot"
        with patch.object(self.bot, "_api", return_value=IDENTITY) as api, self.assertRaises(ValueError):
            self.bot.check()
        self.assertEqual(api.call_count, 1)
        self.bot.expected_username = "@SyntheticTestBot".lstrip("@").lower()
        with patch.object(self.bot, "_api", side_effect=[IDENTITY, WEBHOOK]):
            self.assertTrue(self.bot.check()["expected_username_verified"])

    def test_existing_or_malformed_webhook_is_not_overridden(self):
        for webhook in ({}, [], dict(WEBHOOK, url=None), dict(WEBHOOK, url="https://existing.example/hook")):
            with patch.object(self.bot, "_api", side_effect=[IDENTITY, webhook]) as api, self.assertRaises((ProviderError, ValueError)):
                self.bot.check()
            self.assertEqual([call.args[0] for call in api.call_args_list], ["getMe", "getWebhookInfo"])

    def test_wrong_or_malformed_delivery_receipt_never_advances_offset(self):
        for delivery in ({}, True, dict(DELIVERY, message_id=0), {"message_id": 7, "chat": {"id": 99, "type": "private"}}):
            with patch.object(self.bot, "_api", side_effect=[[UPDATE], delivery]), self.assertRaises(ProviderError):
                self.bot.poll_once()
            self.assertIsNone(self.store.get_state(self.bot.offset_key))

    def test_confirmed_delivery_advances_offset_and_retry_after_failure_is_at_least_once(self):
        with patch.object(self.bot, "_api", side_effect=[[UPDATE], ProviderError("SYNTHETIC timeout", code="CONNECTION_FAILED")]), self.assertRaises(ProviderError):
            self.bot.poll_once()
        with patch.object(self.bot, "_api", side_effect=[[UPDATE], DELIVERY]):
            self.bot.poll_once()
        self.assertEqual(self.store.get_state(self.bot.offset_key), "6")

    def test_unordered_duplicate_and_invalid_update_ids_are_rejected_before_send(self):
        for updates in ([dict(UPDATE, update_id=True)], [dict(UPDATE, update_id=-1)], [UPDATE, UPDATE], [UPDATE, dict(UPDATE, update_id=4)]):
            with patch.object(self.bot, "_api", return_value=updates) as api, self.assertRaises(ProviderError):
                self.bot.poll_once()
            self.assertEqual(api.call_count, 1)
            self.assertIsNone(self.store.get_state(self.bot.offset_key))

    def test_json_retry_after_is_preserved_and_no_immediate_request_occurs(self):
        error = {"ok": False, "error_code": 429, "description": "SYNTHETIC private credential", "parameters": {"retry_after": 60}}
        with patch("src.aai_scanner.telegram.fetch_json", return_value=(error, "SYNTHETIC")) as api:
            with self.assertRaises(ProviderError) as raised:
                self.bot._api("sendMessage", {})
            self.assertEqual(raised.exception.retry_after, 60)
            self.assertNotIn("credential", str(raised.exception))
            with self.assertRaises(ProviderError) as cooldown:
                self.bot._api("getUpdates", {})
            self.assertEqual(cooldown.exception.code, "COOLDOWN")
            self.assertEqual(api.call_count, 1)

    def test_http_retry_after_is_respected_across_methods(self):
        error = ProviderError("HTTP 429", code="HTTP_ERROR", http_status=429, retry_after=20)
        with patch("src.aai_scanner.telegram.fetch_json", side_effect=error) as api:
            for method in ("sendMessage", "getUpdates"):
                with self.assertRaises(ProviderError):
                    self.bot._api(method, {})
            self.assertEqual(api.call_count, 1)

    def test_real_transport_reads_retry_after_from_http_429_json_and_redacts_body(self):
        body = io.BytesIO(json.dumps({"ok": False, "error_code": 429, "description": self.bot.token,
                                      "parameters": {"retry_after": 120}}).encode())
        error = urllib.error.HTTPError("https://api.telegram.org/private-token", 429, "SYNTHETIC", {}, body)
        opener = unittest.mock.Mock()
        opener.open.side_effect = error
        with patch("src.aai_scanner.transport.urllib.request.build_opener", return_value=opener), self.assertRaises(ProviderError) as raised:
            self.bot._api("getUpdates", {})
        self.assertEqual(raised.exception.retry_after, 120)
        self.assertNotIn(self.bot.token, str(raised.exception))
        self.assertTrue(body.closed)
        with patch("src.aai_scanner.telegram.fetch_json") as api, self.assertRaises(ProviderError):
            self.bot._api("sendMessage", {})
        api.assert_not_called()

    def test_http_retry_body_limits_and_malformed_json_preserve_header_delay(self):
        for content in (b"not JSON", b"x" * 65537, json.dumps({"parameters": {"retry_after": True}}).encode()):
            self.bot.cooldown_until = 0
            error = urllib.error.HTTPError("https://api.telegram.org/private-token", 429, "SYNTHETIC", {"Retry-After": "80"}, io.BytesIO(content))
            opener = unittest.mock.Mock()
            opener.open.side_effect = error
            with patch("src.aai_scanner.transport.urllib.request.build_opener", return_value=opener), self.assertRaises(ProviderError) as raised:
                self.bot._api("getMe", {})
            self.assertEqual(raised.exception.retry_after, 80)

    def test_cooldown_expiry_allows_a_new_request_and_invalid_retry_after_is_bounded(self):
        self.bot.cooldown_until = 100
        with patch("src.aai_scanner.telegram.time.monotonic", return_value=100), patch("src.aai_scanner.telegram.fetch_json", return_value=({"ok": True, "result": IDENTITY}, "SYNTHETIC")):
            self.assertEqual(self.bot._api("getMe", {}), IDENTITY)
        for delay in (True, -1, "60", 2**100):
            error = {"ok": False, "error_code": 429, "parameters": {"retry_after": delay}}
            self.bot.cooldown_until = 0
            with patch("src.aai_scanner.telegram.fetch_json", return_value=(error, "SYNTHETIC")), self.assertRaises(ProviderError) as raised:
                self.bot._api("getMe", {})
            self.assertEqual(raised.exception.retry_after, 2**31 - 1 if type(delay) is int and delay > 0 else None)

    def test_fatal_authentication_or_polling_conflict_stops_run(self):
        for status in (401, 403, 409):
            with patch.object(self.bot, "check"), patch.object(self.bot, "poll_once", side_effect=ProviderError("SYNTHETIC", code="TELEGRAM_API_ERROR", http_status=status)) as poll, patch("src.aai_scanner.telegram.time.sleep") as sleep, self.assertRaises(ProviderError):
                self.bot.run()
            self.assertEqual(poll.call_count, 1)
            sleep.assert_not_called()

    def test_transient_error_waits_in_interruptible_bounded_chunks(self):
        error = ProviderError("SYNTHETIC rate limit", code="HTTP_ERROR", http_status=429, retry_after=120)
        with patch.object(self.bot, "check"), patch.object(self.bot, "poll_once", side_effect=error), patch("src.aai_scanner.telegram.time.sleep", side_effect=KeyboardInterrupt) as sleep, self.assertRaises(KeyboardInterrupt):
            self.bot.run()
        sleep.assert_called_once_with(30)

    def test_only_allowlisted_api_methods_can_reach_transport(self):
        with patch("src.aai_scanner.telegram.fetch_json") as api, self.assertRaises(ValueError):
            self.bot._api("deleteWebhook", {})
        api.assert_not_called()

    def test_negative_zero_and_oversized_private_chat_ids_are_rejected(self):
        for chat in ("-42", "0", str(2**52)):
            with patch.dict("os.environ", dict(self.environment, AAI_TELEGRAM_ALLOWED_CHAT_IDS=chat)), self.assertRaises(ValueError):
                TelegramBot(self.scanner, self.store, "https://scanner.example")

    def test_all_commands_work_through_polled_synthetic_delivery_without_signing(self):
        for index, text in enumerate(("/start", "/help", "/scan " + MINT, "/wallet " + MINT, "/status"), 1):
            update = dict(UPDATE, update_id=index, message={"chat": {"id": 42, "type": "private"}, "text": text})
            with patch.object(self.bot, "_api", side_effect=[[update], DELIVERY]) as api:
                self.bot.poll_once()
            sent = api.call_args.args[1]
            self.assertEqual(sent["chat_id"], 42)
            self.assertTrue(sent["text"])
        self.assertEqual(self.store.get_state(self.bot.offset_key), "6")

    def test_status_distinguishes_unverified_partial_and_stale_last_reports(self):
        self.assertIn("Last report data: UNVERIFIED", self.bot.commands.answer("/status"))
        self.scanner.rpc.fail.add("getTokenLargestAccounts")
        self.scanner.scan(MINT)
        self.assertIn("Last report data: UNAVAILABLE", self.bot.commands.answer("/status"))
        self.scanner.last_coverage["available_at"] = (datetime.now(timezone.utc) - timedelta(seconds=121)).isoformat()
        self.assertIn("Last report data: STALE", self.bot.commands.answer("/status"))

    def test_server_500_retries_but_malformed_envelopes_do_not(self):
        with patch.object(self.bot, "check"), patch.object(self.bot, "poll_once", side_effect=ProviderError("SYNTHETIC server failure", code="HTTP_ERROR", http_status=500)), patch("src.aai_scanner.telegram.time.sleep", side_effect=KeyboardInterrupt) as sleep, self.assertRaises(KeyboardInterrupt):
            self.bot.run()
        sleep.assert_called_once_with(3)
        for envelope in (None, {}, {"ok": 1, "result": {}}, {"ok": True}):
            with patch("src.aai_scanner.telegram.fetch_json", return_value=(envelope, "SYNTHETIC")), self.assertRaises(ProviderError):
                self.bot._api("getMe", {})
