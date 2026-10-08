import io
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch
from src.aai_scanner.config import Config
from src.aai_scanner.service import BusyError, Scanner
from src.aai_scanner.storage import Store
from src.aai_scanner.telegram import Commands, TelegramBot
from src.aai_scanner.web import Application
from tests.scanner_fixtures import ACCOUNT, MINT, FakeMarket, FakeRPC


class ScannerIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.rpc, self.market = FakeRPC(), FakeMarket()
        self.scanner = Scanner(Config(), self.store, self.rpc, self.market)
        self.addCleanup(self.store.close)

    def test_complete_offline_report_preserves_sources_and_missing_pnl(self):
        result = self.scanner.scan(MINT)
        self.assertEqual(result["status"], "AVAILABLE")
        self.assertEqual(result["market"]["price_sol"]["value"], "0.02")
        self.assertIsNone(result["accounting"]["realized_pnl_usd"])
        self.assertIsNone(result["accounting"]["deposits"])
        self.assertEqual(result["holders"]["top_accounts_supply_share_pct"]["value"], "40")
        self.assertEqual(len(self.store.history(MINT)), 1)
        self.assertIn("getAccountInfo", self.rpc.calls)
        self.assertNotIn("sendTransaction", self.rpc.calls)

    def test_cache_does_not_create_fake_observations_or_new_timestamps(self):
        first = self.scanner.scan(MINT)
        calls = len(self.rpc.calls)
        second = self.scanner.scan(MINT)
        self.assertTrue(second["cached"])
        self.assertEqual(first["available_at"], second["available_at"])
        self.assertEqual(first["market"]["source"], second["market"]["source"])
        self.assertEqual(len(self.rpc.calls), calls)
        self.assertEqual(self.store.counts()["observations"], 1)

    def test_refresh_has_minimum_interval_and_later_collects_new_observation(self):
        self.scanner.scan(MINT)
        self.assertTrue(self.scanner.scan(MINT, refresh=True)["cached"])
        timestamp, report = self.scanner.cache[MINT]
        self.scanner.cache[MINT] = timestamp - 6, report
        self.assertFalse(self.scanner.scan(MINT, refresh=True)["cached"])
        self.assertEqual(self.store.counts()["observations"], 2)

    def test_failed_mint_source_does_not_look_verified(self):
        self.rpc.fail.add("getAccountInfo")
        report = self.scanner.scan(MINT)
        self.assertEqual(report["status"], "UNVERIFIED")
        self.assertEqual(report["mint_info"]["status"], "FAILED")
        self.assertEqual(report["market"]["price_usd"]["status"], "AVAILABLE")
        self.assertEqual(report["holders"]["status"], "UNAVAILABLE")

    def test_failed_holder_and_activity_sources_are_recorded(self):
        self.rpc.fail.update({"getTokenLargestAccounts", "getSignaturesForAddress"})
        report = self.scanner.scan(MINT)
        self.assertEqual(report["holders"]["status"], "FAILED")
        self.assertEqual(report["activity"]["status"], "FAILED")
        self.assertGreaterEqual(sum(row["code"] == "SOURCE_GAP" for row in report["risk_findings"]), 2)

    def test_mismatched_slots_are_flagged(self):
        self.rpc.holder_slot = 101
        self.assertIn("NON_ATOMIC_SLOTS", self.scanner.scan(MINT)["holders"]["quality_flags"])

    def test_inconsistent_supply_never_yields_over_100_percent(self):
        self.rpc.holder_amount = str(10**13)
        result = self.scanner.scan(MINT)["holders"]
        self.assertIsNone(result["top_accounts_supply_share_pct"]["value"])
        self.assertIn("SUPPLY_DENOMINATOR_UNAVAILABLE_OR_INCONSISTENT", result["quality_flags"])

    def test_wallet_balance_is_not_deposits_or_trading_profit(self):
        result = self.scanner.wallet(ACCOUNT)
        self.assertEqual(result["balance_sol"]["value"], "1.234567890")
        self.assertEqual(result["balance_usd"]["value"], "123.456789000")
        self.assertIsNone(result["accounting"]["realized_pnl"])
        self.assertIsNone(result["accounting"]["deposits"])

    def test_capacity_rejects_before_new_provider_calls(self):
        self.scanner.slots.acquire()
        self.scanner.slots.acquire()
        with self.assertRaises(BusyError):
            self.scanner.scan(MINT)
        self.assertEqual(self.rpc.calls, [])
        self.scanner.slots.release()
        self.scanner.slots.release()

    def test_invalid_address_does_not_reach_providers(self):
        with self.assertRaises(ValueError):
            self.scanner.scan("not-a-mint")
        self.assertEqual(self.rpc.calls, [])
        self.assertEqual(self.market.calls, [])


class StorageRecoveryTests(unittest.TestCase):
    def test_reopen_and_backup_restore_preserve_watches_and_history(self):
        with tempfile.TemporaryDirectory() as folder:
            path, backup = Path(folder) / "scanner.sqlite3", Path(folder) / "backup.sqlite3"
            store = Store(str(path))
            store.add_watch(MINT)
            scanner = Scanner(Config(), store, FakeRPC(), FakeMarket())
            scanner.scan(MINT)
            store.set_state("test-offset", 7)
            store.backup(str(backup))
            store.close()
            reopened, restored = Store(str(path)), Store(str(backup))
            try:
                for database in (reopened, restored):
                    self.assertEqual(database.watches()[0]["mint"], MINT)
                    self.assertEqual(len(database.history(MINT)), 1)
                    self.assertEqual(database.get_state("test-offset"), "7")
            finally:
                reopened.close()
                restored.close()

    def test_backup_will_not_overwrite_existing_file(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "important.txt"
            target.write_text("keep")
            store = Store(":memory:")
            try:
                with self.assertRaises(ValueError):
                    store.backup(str(target))
                self.assertEqual(target.read_text(), "keep")
            finally:
                store.close()

    def test_invalid_watch_cannot_enter_database(self):
        store = Store(":memory:")
        try:
            with self.assertRaises(ValueError):
                store.add_watch("'; DROP TABLE watches;--")
            self.assertEqual(store.watches(), [])
        finally:
            store.close()


class HttpBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.scanner = Scanner(Config(), self.store, FakeRPC(), FakeMarket())
        self.app = Application(Config(), self.store, self.scanner)
        self.addCleanup(self.store.close)

    def request(self, path, method="GET", body=None, **headers):
        payload = json.dumps(body).encode() if body is not None else b""
        env = {"PATH_INFO": path, "REQUEST_METHOD": method, "HTTP_HOST": "127.0.0.1:8787",
               "REMOTE_ADDR": "127.0.0.1", "QUERY_STRING": "", "wsgi.input": io.BytesIO(payload),
               "CONTENT_TYPE": "application/json", "CONTENT_LENGTH": str(len(payload))}
        env.update(headers)
        response = {}
        def start(status, values):
            response.update(status=int(status.split()[0]), headers=dict(values))
        raw = b"".join(self.app(env, start))
        response["raw"] = raw
        if response["headers"]["Content-Type"].startswith("application/json"):
            response["body"] = json.loads(raw)
        return response

    def test_real_wsgi_request_generates_report_and_history(self):
        response = self.request("/api/scan", "POST", {"mint": MINT})
        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["mint"], MINT)
        result = self.request("/api/history", QUERY_STRING="mint=" + MINT)
        self.assertEqual(len(result["body"]["observations"]), 1)

    def test_health_is_process_only_and_no_provider_health_is_invented(self):
        response = self.request("/api/status")
        self.assertEqual(response["body"]["scope"], "PROCESS_ONLY")
        self.assertEqual(response["body"]["provider_sources"], {})

    def test_authentication_required_for_api_in_remote_mode(self):
        config = replace(Config(), public_mode=True, public_url="https://scanner.example", api_token="a" * 32)
        self.app = Application(config, self.store, self.scanner)
        self.assertEqual(self.request("/api/watchlist", HTTP_HOST="scanner.example")["status"], 401)
        response = self.request("/api/watchlist", HTTP_HOST="scanner.example", HTTP_AUTHORIZATION="Bearer " + "a" * 32)
        self.assertEqual(response["status"], 200)

    def test_cross_origin_mutation_and_rebinding_host_are_rejected(self):
        self.assertEqual(self.request("/api/watchlist", "POST", {"mint": MINT}, HTTP_ORIGIN="https://evil.example")["status"], 403)
        self.assertEqual(self.request("/api/watchlist", HTTP_HOST="evil.example:8787")["status"], 403)
        self.assertEqual(self.store.watches(), [])

    def test_content_type_and_oversized_bodies_are_rejected(self):
        self.assertEqual(self.request("/api/watchlist", "POST", {"mint": MINT}, CONTENT_TYPE="text/plain")["status"], 400)
        self.assertEqual(self.request("/api/watchlist", "POST", {"mint": MINT}, CONTENT_LENGTH="5000")["status"], 400)

    def test_invalid_address_and_non_boolean_refresh_are_rejected(self):
        self.assertEqual(self.request("/api/scan", "POST", {"mint": "bad"})["status"], 400)
        self.assertEqual(self.request("/api/scan", "POST", {"mint": MINT, "refresh": "yes"})["status"], 400)

    def test_static_routes_cannot_traverse_filesystem(self):
        self.assertEqual(self.request("/../../.env")["status"], 404)
        response = self.request("/")
        self.assertEqual(response["status"], 200)
        self.assertIn("Content-Security-Policy", response["headers"])
        self.assertIn(b"AAI", response["raw"])

    def test_execution_route_does_not_exist(self):
        self.assertEqual(self.request("/api/execute", "POST", {})["status"], 404)

    def test_watch_add_delete_through_http(self):
        self.assertEqual(self.request("/api/watchlist", "POST", {"mint": MINT})["status"], 200)
        self.assertEqual(len(self.request("/api/watchlist")["body"]["watches"]), 1)
        self.assertEqual(self.request("/api/watchlist", "DELETE", {"mint": MINT})["body"]["watches"], [])

    def test_http_rate_limit_returns_retry_after(self):
        self.app.limiter.allow = lambda *args: False
        response = self.request("/api/status")
        self.assertEqual(response["status"], 429)
        self.assertEqual(response["headers"]["Retry-After"], "5")

    def test_remote_configuration_cannot_start_without_access_controls(self):
        for config in (replace(Config(), host="0.0.0.0"), replace(Config(), public_url="https://scanner.example"),
                       replace(Config(), public_mode=True, public_url="https://scanner.example", api_token="short")):
            with self.subTest(config=config), self.assertRaises(ValueError):
                config.validate()


class TelegramAdapterTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.scanner = Scanner(Config(), self.store, FakeRPC(), FakeMarket())
        self.commands = Commands(self.scanner, "https://scanner.example")
        self.addCleanup(self.store.close)

    def test_commands_give_useful_read_only_summaries(self):
        for command in ("/start", "/help"):
            self.assertIn("No signing", self.commands.answer(command))
        report = self.commands.answer("/scan " + MINT)
        self.assertIn("USD price: 2", report)
        self.assertIn("SOL price: 0.02", report)
        self.assertIn("https://scanner.example/report?mint=" + MINT, report)
        self.assertIn("not profit", self.commands.answer("/wallet " + ACCOUNT))
        self.assertIn("execution disabled", self.commands.answer("/status"))

    def test_invalid_input_and_unknown_commands_do_not_scan(self):
        self.assertIn("Invalid", self.commands.answer("/scan bad"))
        self.assertIn("Usage", self.commands.answer("/scan"))
        self.assertIn("Unknown", self.commands.answer("/trade " + MINT))

    def bot(self):
        environment = {"AAI_TELEGRAM_ENABLED": "1", "AAI_TELEGRAM_BOT_TOKEN": "123456:" + "x" * 32,
                       "AAI_TELEGRAM_ALLOWED_CHAT_IDS": "42"}
        with patch.dict("os.environ", environment):
            return TelegramBot(self.scanner, self.store, "https://scanner.example")

    def test_bot_is_disabled_by_default(self):
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(ValueError):
                TelegramBot(self.scanner, self.store, "https://scanner.example")

    def test_only_allowed_private_chats_receive_replies(self):
        bot = self.bot()
        updates = [
            {"update_id": 1, "message": {"chat": {"id": 99, "type": "private"}, "text": "/help"}},
            {"update_id": 2, "message": {"chat": {"id": 42, "type": "group"}, "text": "/help"}},
            {"update_id": 3, "message": {"chat": {"id": 42, "type": "private"}, "text": "/help"}},
        ]
        with patch.object(bot, "_api", side_effect=[updates, {}]) as api:
            bot.poll_once()
        self.assertEqual(api.call_count, 2)
        self.assertEqual(api.call_args[0][1]["chat_id"], 42)
        self.assertEqual(self.store.get_state(bot.offset_key), "4")

    def test_failed_delivery_does_not_advance_offset(self):
        from src.aai_scanner.transport import ProviderError
        bot = self.bot()
        update = {"update_id": 5, "message": {"chat": {"id": 42, "type": "private"}, "text": "/help"}}
        with patch.object(bot, "_api", side_effect=[[update], ProviderError("Synthetic delivery failure")]):
            with self.assertRaises(ProviderError):
                bot.poll_once()
        self.assertIsNone(self.store.get_state(bot.offset_key))
