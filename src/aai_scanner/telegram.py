"""Private-chat scanner adapter. Credentials never enter reports or logs."""
import hashlib
import math
import os
import re
import time
from urllib.parse import quote
from .service import BusyError, Limiter
from .operations import data_readiness
from .transport import ProviderError, fetch_json


def positive_id(value):
    return type(value) is int and 0 < value < 2**52


def bot_identity(identity):
    if (not isinstance(identity, dict) or not positive_id(identity.get("id")) or identity.get("is_bot") is not True
            or not isinstance(identity.get("username"), str) or not re.fullmatch(r"[A-Za-z0-9_]{1,32}", identity["username"])):
        raise ProviderError("Telegram bot identity failed validation")
    return identity


def delivered_message(result, chat_id):
    chat = result.get("chat") if isinstance(result, dict) else None
    if (not isinstance(result, dict) or not positive_id(result.get("message_id")) or not isinstance(chat, dict)
            or type(chat.get("id")) is not int or chat["id"] != chat_id or chat.get("type") != "private"):
        raise ProviderError("Telegram delivery receipt failed validation")


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
            data = data_readiness(self.scanner.last_coverage)
            return ("AAI scanner process available; execution disabled.\n"
                    f"Last report data: {data['status']}\n"
                    f"Collected: {data['available_at'] or 'No report in this process'}\n"
                    "Last observations only; not continuous provider checks.\n") + (
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
                        f"Balance source: {(result['balance_sol']['source'] or {}).get('endpoint_host', 'Unavailable')}\n"
                        f"Balance state: {result['balance_sol']['status']}\n"
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
                    f"Mint RPC: {mint['evidence'].get('endpoint_host', 'Unavailable')}\n"
                    f"Market host: {source.get('endpoint_host', 'Unavailable')}\n"
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
        if any(not positive_id(chat_id) for chat_id in self.allowed):
            raise ValueError("Allowed private chat IDs must be positive, supported Telegram IDs")
        self.expected_username = os.environ.get("AAI_TELEGRAM_EXPECTED_USERNAME", "").lstrip("@")
        if self.expected_username and not re.fullmatch(r"[A-Za-z0-9_]{1,32}", self.expected_username):
            raise ValueError("Invalid expected Telegram bot username")
        self.cooldown_until = 0
        self.store, self.commands, self.limiter = store, Commands(scanner, public_url), Limiter()
        self.offset_key = "telegram-offset:" + hashlib.sha256(self.token.encode()).hexdigest()[:16]

    def _api(self, method, data):
        if method not in ("getMe", "getWebhookInfo", "getUpdates", "sendMessage"):
            raise ValueError("Telegram method not allowed")
        remaining = math.ceil(self.cooldown_until - time.monotonic())
        if remaining > 0:
            raise ProviderError("Telegram is cooling down", code="COOLDOWN", retry_after=remaining)
        try:
            result, _ = fetch_json(f"https://api.telegram.org/bot{self.token}/{method}", data, timeout=30,
                                   json_retry_after=True)
            if not isinstance(result, dict) or type(result.get("ok")) is not bool:
                raise ProviderError("Malformed Telegram response envelope")
            if result["ok"] is False:
                parameters = result.get("parameters")
                delay = parameters.get("retry_after") if isinstance(parameters, dict) else None
                delay = min(delay, 2**31 - 1) if type(delay) is int and delay > 0 else None
                status = result.get("error_code")
                status = status if type(status) is int and 400 <= status <= 599 else None
                raise ProviderError("Telegram API request failed", code="TELEGRAM_API_ERROR", http_status=status, retry_after=delay)
            if "result" not in result:
                raise ProviderError("Telegram response is missing result")
        except ProviderError as error:
            if error.retryable or error.http_status == 500:
                delay = error.retry_after or (30 if error.http_status == 429 else 3)
                self.cooldown_until = max(self.cooldown_until, time.monotonic() + delay)
            raise
        return result["result"]

    def check(self):
        identity = bot_identity(self._api("getMe", {}))
        if self.expected_username and identity["username"].lower() != self.expected_username.lower():
            raise ValueError("Telegram bot identity does not match configured username")
        webhook = self._api("getWebhookInfo", {})
        if (not isinstance(webhook, dict) or not isinstance(webhook.get("url"), str)
                or type(webhook.get("pending_update_count")) is not int or webhook["pending_update_count"] < 0):
            raise ProviderError("Telegram webhook information failed validation")
        if webhook["url"]:
            raise ValueError("A webhook is configured; polling will not override it")
        return {"status": "AVAILABLE", "bot_id": identity.get("id"), "username": identity.get("username"),
                "allowed_chats": len(self.allowed), "scope": "READ_ONLY_IDENTITY_CHECK",
                "expected_username_verified": bool(self.expected_username), "pending_updates": webhook["pending_update_count"],
                "commands_verified": False, "messages_sent": 0}

    def poll_once(self):
        offset = int(self.store.get_state(self.offset_key, "0"))
        updates = self._api("getUpdates", {"offset": offset, "timeout": 20,
                                         "limit": 20, "allowed_updates": ["message"]})
        if not isinstance(updates, list) or len(updates) > 20:
            raise ProviderError("Malformed Telegram update collection")
        previous = -1
        for update in updates:
            if (not isinstance(update, dict) or not positive_id(update.get("update_id")) or update["update_id"] <= previous):
                raise ProviderError("Malformed or unordered Telegram update collection")
            previous = update["update_id"]
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
                    delivered = self._api("sendMessage", {"chat_id": chat_id, "text": answer,
                                                         "link_preview_options": {"is_disabled": True}})
                    delivered_message(delivered, chat_id)
            # Persist only after delivery; crash retries can duplicate a reply (at-least-once).
            offset = update_id + 1
            self.store.set_state(self.offset_key, offset)

    def run(self):
        self.check()
        while True:
            try:
                self.poll_once()
            except ProviderError as error:
                if not error.retryable and error.http_status != 500:
                    raise
                # Chunk long Retry-After waits to preserve interruption responsiveness.
                time.sleep(min(30, max(1, error.retry_after or 3)))
