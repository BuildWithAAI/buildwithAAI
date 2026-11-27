"""Config loading. default.toml, optionally overlaid by AAI_CONFIG=<path>. Hard ceilings enforced here."""
from __future__ import annotations
import copy, os, tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = ROOT / "config" / "default.toml"

# Absolute ceiling from the user's risk rule. Not configurable.
HARD_MAX_RISK_PER_TRADE = 0.03
HARD_MIN_RISK_PER_TRADE = 0.01


class ConfigError(ValueError):
    pass


def _merge(a: dict, b: dict) -> dict:
    out = copy.deepcopy(a)
    for k, v in b.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def validate(cfg: dict) -> dict:
    r = cfg["risk"]
    if cfg.get("account", {}).get("mode") != "paper":
        raise ConfigError("only account.mode='paper' is supported")
    if r["max_risk_per_trade"] > HARD_MAX_RISK_PER_TRADE + 1e-12:
        raise ConfigError(f"max_risk_per_trade {r['max_risk_per_trade']} exceeds hard ceiling {HARD_MAX_RISK_PER_TRADE}")
    if r["min_risk_per_trade"] < HARD_MIN_RISK_PER_TRADE - 1e-12 or r["min_risk_per_trade"] > r["max_risk_per_trade"]:
        raise ConfigError("min_risk_per_trade must be >= 1% and <= max_risk_per_trade")
    if not (r["min_risk_per_trade"] <= r["default_risk_per_trade"] <= r["max_risk_per_trade"]):
        raise ConfigError("default_risk_per_trade must be within [min, max]")
    for sec, v in r.get("sector_max_risk_per_trade", {}).items():
        if v > HARD_MAX_RISK_PER_TRADE + 1e-12:
            raise ConfigError(f"sector {sec} risk {v} exceeds hard ceiling")
    if "longterm" in r.get("sector_caps", {}) or "longterm" in r.get("sector_max_risk_per_trade", {}):
        raise ConfigError("'longterm' is a separate capital bucket, not a trading sector; remove it from risk.sector_caps")
    lt = cfg.get("longterm", {})
    if lt and (lt.get("mode") != "draft_tickets_only" or lt.get("leverage_allowed") or lt.get("kill_switch_scope") != "trading"
               or not lt.get("excluded_from_trading_risk", True)):
        raise ConfigError("longterm must be draft_tickets_only, no leverage, excluded from trading risk, kill_switch_scope='trading'")
    for acct, pol in lt.get("account_policies", {}).items():
        if pol.get("executor") != "user":
            raise ConfigError(f"{acct}: executor must be 'user' (no agent holds execution ownership)")
        if pol.get("speculative_total_cap", "hard") not in ("hard", "informational"):
            raise ConfigError(f"{acct}: speculative_total_cap must be 'hard' or 'informational'")
        if pol.get("agent_role") == "auditor" and pol.get("ticketing") != "disabled":
            raise ConfigError(f"{acct}: auditor-only accounts must have ticketing='disabled'")
    if r["max_total_open_risk"] <= 0 or r["max_total_open_risk"] > 0.20:
        raise ConfigError("max_total_open_risk must be in (0, 0.20]")
    return cfg


def load(path: str | os.PathLike | None = None, overrides: dict | None = None) -> dict:
    with open(DEFAULT_PATH, "rb") as f:
        cfg = tomllib.load(f)
    extra = path or os.environ.get("AAI_CONFIG")
    if extra:
        with open(extra, "rb") as f:
            cfg = _merge(cfg, tomllib.load(f))
    if overrides:
        cfg = _merge(cfg, overrides)
    sp = Path(cfg["store"]["path"])
    cfg["store"]["path"] = str(sp if sp.is_absolute() else ROOT / sp)
    if os.environ.get("AAI_DB"):
        cfg["store"]["path"] = os.environ["AAI_DB"]
    from . import watchlist  # owner-edited EDGAR watchlist (data/watchlist.json, CLI-only writer); invalid file = default
    watchlist.apply(cfg)
    return validate(cfg)
