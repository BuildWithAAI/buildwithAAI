"""Optional Discord webhook notifier. Reads DISCORD_WEBHOOK_URL from the environment only;
no-op when unset. The URL is never logged or written to disk."""
from __future__ import annotations

import os

import requests

from ..logging_utils import get_logger

log = get_logger(__name__)
MAX_LEN = 1900


def notify_discord(text: str, session=None) -> bool:
    url = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    if not url:
        log.info("discord notifier disabled (DISCORD_WEBHOOK_URL unset)")
        return False
    if not url.startswith("https://discord.com/api/webhooks/") and \
            not url.startswith("https://discordapp.com/api/webhooks/"):
        log.error("DISCORD_WEBHOOK_URL is not a Discord webhook URL; refusing to send")
        return False
    body = text if len(text) <= MAX_LEN else text[: MAX_LEN - 20] + "\n…(truncated)"
    s = session or requests
    r = s.post(url, json={"content": body}, timeout=10)
    ok = 200 <= r.status_code < 300
    log.info("discord notify", extra={"status": r.status_code})
    return ok
