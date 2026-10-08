"""Private-chat scanner adapter. Credentials never enter reports or logs."""
import hashlib
import os
import re
import time
from urllib.parse import quote
from .service import BusyError, Limiter
from .transport import ProviderError, fetch_json


class Commands:
    def __init__(self, scanner, public_url):
        self.scanner, self.public_url = scanner, public_url

    def answer(self, text):
        if not isinstance(text, str) or len(text) > 256:
            return "Use /help for scanner commands."
        parts = text.strip().split()
        if not parts:
            return "Use /help for scanner commands."
        command = parts[0].split("@")[0].lower()
        if command in ("/start", "/help"):
            return ("AAI Solana Intelligence — read-only scanner\n"
                    "/scan <mint> — token, market and evidence report\n"
                    "/wallet <address> — SOL balance and recent address activity\n"
                    "/status — last observed source states\n"
                    "No signing, trades or profit claims. Send public addresses only.")
        if command == "/status":
            states = self.scanner.last_sources
            return "AAI scanner available; execution disabled.\n" + (
                "\n".join(f"{key}: {value['status'] if value else 'UNVERIFIED'}" for key, value in states.items())
                if states else "Providers: UNVERIFIED until a scan completes.")
        if command not in ("/scan", "/wallet"):
            return "Unknown command. Use /help."
        if len(parts) != 2:
            return f"Usage: {command} <public address>"
        try:
            if command == "/wallet":
                result = self.scanner.wallet(parts[1])
                balance = result["balance_sol"]["value"]
                return (f"Address: {parts[1]}\nSOL balance: {balance if balance is not None else 'Unavailable'}\n"
                        "Realized P/L: unavailable — balance is not profit.\n"
                        f"Collected: {result['available_at']}")
            report = self.scanner.scan(parts[1])
            mint, market = report["mint_info"], report["market"]
            def value(key):
                item = market[key]["value"]
                return item if item is not None else "Unavailable"
            flags = "\n".join("- " + row["message"] for row in report["risk_findings"][:5]) or "No listed findings; safety is not established."
            source = market["source"] or {}
            return (f"AAI: {market['symbol'] or 'Unknown token'}\nMint: {parts[1]}\n"
                    f"Report: {report['status']} | On-chain mint: {mint['status']}\n"
                    f"Coverage gaps: {', '.join(report['coverage']['missing_sections']) or 'None in core sections'}\n"
                    f"USD price: {value('price_usd')}\nSOL price: {value('price_sol')}\n"
                    f"Selected-pool liquidity USD: {value('liquidity_usd')}\n"
                    f"24h selected-pool volume USD: {value('volume_24h_usd')}\n"
                    f"Findings:\n{flags}\n"
                    f"Source: DEX Screener + Solana RPC\n"
                    f"Market retrieval: {source.get('available_at', 'Unavailable')}\n"
                    f"{'Cached observation; ' if report['cached'] else ''}upstream tick time unknown.\n"
                    f"Details: {self.public_url}/report?mint={quote(parts[1])}")[:3500]
        except ValueError:
            return "Invalid Solana address. Send the token mint or public wallet address."
        except BusyError:
            return "Scanner busy or rate-limited. Retry shortly."
        except ProviderError:
            return "Source unavailable or unverified. Retry later."


class TelegramBot:
    def __init__(self, scanner, store, public_url):
        if os.environ.get("AAI_TELEGRAM_ENABLED") != "1":
            raise ValueError("Telegram disabled; set AAI_TELEGRAM_ENABLED=1 only for an authorized bot")
        self.token = os.environ.get("AAI_TELEGRAM_BOT_TOKEN", "")
        if not re.fullmatch(r"[0-9]{5,20}:[A-Za-z0-9_-]{20,120}", self.token):
            raise ValueError("A valid Telegram bot token must be supplied through environment configuration")
        try:
            self.allowed = {int(value) for value in os.environ.get("AAI_TELEGRAM_ALLOWED_CHAT_IDS", "").split(",") if value.strip()}
        except ValueError:
            raise ValueError("Allowed private chat IDs must be numeric") from None
        if not self.allowed:
            raise ValueError("At least one explicitly allowed private test chat ID is required")
        self.store, self.commands, self.limiter = store, Commands(scanner, public_url), Limiter()
        self.offset_key = "telegram-offset:" + hashlib.sha256(self.token.encode()).hexdigest()[:16]

    def _api(self, method, data):
        if method not in ("getMe", "getWebhookInfo", "getUpdates", "sendMessage"):
            raise ValueError("Telegram method not allowed")
        result, _ = fetch_json(f"https://api.telegram.org/bot{self.token}/{method}", data, timeout=30)
        if not isinstance(result, dict) or result.get("ok") is not True or "result" not in result:
            raise ProviderError("Telegram API request failed")
        return result["result"]

    def check(self):
        identity = self._api("getMe", {})
        webhook = self._api("getWebhookInfo", {})
        if webhook.get("url"):
            raise ValueError("A webhook is configured; polling will not override it")
        return {"status": "AVAILABLE", "bot_id": identity.get("id"), "username": identity.get("username"),
                "allowed_chats": len(self.allowed), "scope": "READ_ONLY_IDENTITY_CHECK"}

    def poll_once(self):
        offset = int(self.store.get_state(self.offset_key, "0"))
        updates = self._api("getUpdates", {"offset": offset, "timeout": 20,
                                         "limit": 20, "allowed_updates": ["message"]})
        if not isinstance(updates, list) or len(updates) > 20:
            raise ProviderError("Malformed Telegram update collection")
        for update in updates:
            if not isinstance(update, dict) or type(update.get("update_id")) is not int:
                raise ProviderError("Malformed Telegram update")
            update_id = update["update_id"]
            if update_id < offset:
                continue
            message = update.get("message") or {}
            if not isinstance(message, dict):
                raise ProviderError("Malformed Telegram message")
            chat = message.get("chat") or {}
            if not isinstance(chat, dict):
                raise ProviderError("Malformed Telegram chat")
            chat_id = chat.get("id")
            if chat.get("type") == "private" and type(chat_id) is int and chat_id in self.allowed and "text" in message:
                if self.limiter.allow("global", 30) and self.limiter.allow(str(chat_id), 6):
                    answer = self.commands.answer(message["text"])
                elif self.limiter.allow("notice:" + str(chat_id), 1):
                    answer = "Rate limit reached. Retry in one minute."
                else:
                    answer = None
                if answer is not None:
                    self._api("sendMessage", {"chat_id": chat_id, "text": answer,
                                             "link_preview_options": {"is_disabled": True}})
            # Persist only after delivery; crash retries can duplicate a reply (at-least-once).
            offset = update_id + 1
            self.store.set_state(self.offset_key, offset)

    def run(self):
        self.check()
        while True:
            try:
                self.poll_once()
            except ProviderError:
                time.sleep(2)
