from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import paths
from .errors import GuardConfigError

REQUIRED_DEFAULTS = ("max_notional_pct_equity", "max_daily_loss_pct", "max_trades_per_hour", "max_leverage",
                     "approval_required_above_notional_usd", "max_order_notional_usd")


def load(path: Path | None = None) -> dict:
    p = Path(path or paths.config_file())
    try:
        cfg = json.loads(p.read_text())
    except (OSError, ValueError) as e:
        raise GuardConfigError(f"agent-guard config unreadable ({p}): {e} - fail closed") from e
    d = cfg.get("defaults") or {}
    missing = [k for k in REQUIRED_DEFAULTS if k not in d]
    if missing or not isinstance(cfg.get("agents"), dict):
        raise GuardConfigError(f"agent-guard config invalid: missing {missing or 'agents'} - fail closed")
    return cfg


def agent_limits(cfg: dict, agent: str) -> dict[str, Any]:
    a = cfg["agents"].get(agent)
    if a is None:
        raise GuardConfigError(f"agent {agent!r} not in agent-guard config - fail closed")
    return {**cfg["defaults"], **{k: v for k, v in a.items() if not k.startswith("_")}}
