"""Live-order gate. Disabled unless an env flag and a separate config both opt in.

Even then the adapter stub does not send, sign, or read a key. Risk limits
run before that stub. A config that contains a secret is rejected.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

ENV_FLAG = "GIANT_BRAIN_LIVE_TRADING"
ENV_CONFIG = "GIANT_BRAIN_LIVE_CONFIG"
LIVE_VALUE = "enabled"
LIMIT_FIELDS = (
    "live_enabled",
    "max_position_notional_usd",
    "max_daily_loss_usd",
    "max_open_positions",
    "kill_switch",
    "token_allowlist",
    "venue_allowlist",
)
SECRET_FIELDS = {"private_key", "api_key", "secret", "seed", "seed_phrase", "wallet_secret", "mnemonic"}


class ExecutionError(ValueError):
    pass


def _secrets(value) -> bool:
    if type(value) is dict:
        if SECRET_FIELDS & set(value) or any(_secrets(item) for item in value.values()):
            return True
    elif type(value) is list:
        return any(_secrets(item) for item in value)
    return False


def load_config(path: Path) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if type(data) is not dict or any(field not in data for field in LIMIT_FIELDS) or _secrets(data):
        raise ExecutionError("LIVE_CONFIG")
    if type(data["live_enabled"]) is not bool or type(data["kill_switch"]) is not bool:
        raise ExecutionError("LIVE_CONFIG")
    if type(data["max_position_notional_usd"]) is bool or type(data["max_position_notional_usd"]) not in (int, float) or data["max_position_notional_usd"] <= 0:
        raise ExecutionError("LIVE_CONFIG")
    if type(data["max_daily_loss_usd"]) is bool or type(data["max_daily_loss_usd"]) not in (int, float) or data["max_daily_loss_usd"] <= 0:
        raise ExecutionError("LIVE_CONFIG")
    if type(data["max_open_positions"]) is not int or data["max_open_positions"] < 1:
        raise ExecutionError("LIVE_CONFIG")
    if type(data["token_allowlist"]) is not list or type(data["venue_allowlist"]) is not list:
        raise ExecutionError("LIVE_CONFIG")
    return data


def config_from_env(env: dict | None = None) -> dict | None:
    env = os.environ if env is None else env
    raw = env.get(ENV_CONFIG)
    if not raw:
        return None
    return load_config(Path(raw))


def live_opt_in(env: dict | None, config: dict | None) -> bool:
    env = os.environ if env is None else env
    return env.get(ENV_FLAG) == LIVE_VALUE and type(config) is dict and config.get("live_enabled") is True


def enforce(order: dict, book: dict, config: dict) -> dict:
    """Return a refusal or a pass. This function does not transmit anything."""
    if type(order) is not dict or type(book) is not dict or type(config) is not dict:
        raise ExecutionError("ORDER")
    mint = order.get("mint")
    venue = order.get("venue")
    notional = order.get("notional_usd")
    reasons = []
    if config.get("kill_switch") is True:
        reasons.append("KILL_SWITCH")
    if mint not in set(config.get("token_allowlist") or []):
        reasons.append("TOKEN_NOT_ALLOWLISTED")
    if venue not in set(config.get("venue_allowlist") or []):
        reasons.append("VENUE_NOT_ALLOWLISTED")
    if type(notional) is bool or type(notional) not in (int, float) or notional <= 0 or notional > config.get("max_position_notional_usd", 0):
        reasons.append("MAX_POSITION")
    open_count = book.get("open_positions")
    if type(open_count) is not int or open_count >= config.get("max_open_positions", 0):
        reasons.append("MAX_OPEN_POSITIONS")
    daily = book.get("daily_loss_usd")
    if type(daily) is bool or type(daily) not in (int, float) or daily >= config.get("max_daily_loss_usd", 0):
        reasons.append("MAX_DAILY_LOSS")
    return {
        "allowed": not reasons,
        "reasons": reasons,
        "sent": False,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }


class LiveAdapter:
    """Stub. submit() never sends, including when the opt-in flags are set."""

    def __init__(self, env: dict | None = None, config: dict | None = None):
        self.env = os.environ if env is None else env
        self.config = config

    def submit(self, order: dict, book: dict) -> dict:
        if self.config is None:
            return {"allowed": False, "reasons": ["LIVE_CONFIG_ABSENT"], "sent": False, "action": "NO_EXECUTION", "execution_allowed": False, "live_orders": False}
        decision = enforce(order, book, self.config)
        if not decision["allowed"]:
            return decision
        if not live_opt_in(self.env, self.config):
            decision["reasons"] = ["LIVE_DISABLED"]
            return decision
        decision["allowed"] = False
        decision["reasons"] = ["LIVE_ADAPTER_NOT_IMPLEMENTED"]
        return decision
