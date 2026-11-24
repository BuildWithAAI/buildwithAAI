"""Executor-side hard caps, kill switches, float cap. Pure Python: no network, no signing, no keys.

Fully automated (no human approval per fill). Dollar limits below are PROPOSED, PENDING ZOORPED'S EXPLICIT
CONFIRMATION. Live mode stays blocked until OwnerConfig.limits_confirmed_by_owner is True (set only by Zoorped)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from .outcomes import Pending


@dataclass(frozen=True)
class Caps:  # PROPOSED, pending Zoorped's explicit confirmation
    per_trade_usd: float = 1.0
    max_open_positions: int = 5
    max_open_notional_usd: float = 5.0
    daily_loss_limit_usd: float = 10.0
    float_max_pct_of_deposit: float = 0.30      # Zoorped 2026-11-09 9:58 PM CST: "30% of the deposit"
    max_new_per_5min: int = 3
    max_new_per_day: int = 20
    max_slippage_bps_buy: int = 1000
    max_slippage_bps_sell: int = 2500
    min_mcap_usd: float = 30_000.0              # same floor as experiment100 paper (owner decision 2026-11-09)
    rebuy_cooldown_s: int = 600
    heartbeat_timeout_s: int = 900
    max_clock_skew_s: float = 10.0              # local clock vs chain block time


@dataclass(frozen=True)
class OwnerConfig:
    """Owner-set values. The executor cannot infer these; it never edits them."""
    deposit_basis_usd: float | None = None      # what Zoorped funded in total (hot + vault); None => no BUYs
    limits_confirmed_by_owner: bool = False     # Zoorped's own explicit confirmation; False => live blocked
    mode: str = "shadow"                        # shadow | dryrun | live


@dataclass
class State:
    open_positions: dict = field(default_factory=dict)  # mint -> {"notional_usd": float}
    pending: dict = field(default_factory=dict)         # signature -> outcomes.Pending (UNKNOWN until resolved)
    daily_pnl_usd: float = 0.0                           # realized + unrealized, CT day
    hot_wallet_value_usd: float = 0.0                    # SOL + marked positions in the hot burner only
    entries_ts: list = field(default_factory=list)
    last_sell_ts: dict = field(default_factory=dict)
    last_heartbeat_ts: float = 0.0
    deny_mints: set = field(default_factory=set)
    allow_mints: set | None = None
    alerts: list = field(default_factory=list)


class CapRejected(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Switches:
    """Windows paths in production, e.g. C:\\ProgramData\\solexec\\control\\KILL and ...\\HALT_BUYS."""
    kill_file: Path            # TOTAL kill: blocks BUY and SELL
    halt_buys_file: Path       # BUY halt: SELLs still allowed

    def total_kill(self) -> bool:
        return self.kill_file.exists() or os.environ.get("SOLEXEC_KILL") == "1"

    def buys_halted(self) -> bool:
        return self.halt_buys_file.exists()


def float_cap_usd(caps: Caps, owner: OwnerConfig) -> float | None:
    if not owner.deposit_basis_usd or owner.deposit_basis_usd <= 0:
        return None
    return caps.float_max_pct_of_deposit * owner.deposit_basis_usd


def _effective_exposure(st: State, caps: Caps):
    """UNKNOWN BUYs count as open positions at max exposure (their full intended size, at least per-trade max)."""
    mints = set(st.open_positions)
    notional = sum(p["notional_usd"] for p in st.open_positions.values())
    for p in st.pending.values():
        if p.side == "BUY" and p.status == "UNKNOWN":
            if p.mint not in mints:
                mints.add(p.mint)
            notional += max(p.max_exposure_usd, caps.per_trade_usd)
    return mints, notional


def check(sig: dict, st: State, caps: Caps, owner: OwnerConfig, sw: Switches, *, now_s: float, chain_time_s: float | None,
          executor_mcap_usd: float | None, executor_mayhem: bool | None, breaker=None) -> dict:
    """Decide whether a *validated* signal may proceed. Returns sizing; raises CapRejected otherwise.

    executor_mcap_usd / executor_mayhem / chain_time_s come from the executor's own reads, never from the signal."""
    if sw.total_kill():
        raise CapRejected("kill_switch_total")
    if owner.mode not in ("shadow", "dryrun", "live"):
        raise CapRejected("bad_mode")
    if owner.mode == "live" and not owner.limits_confirmed_by_owner:
        raise CapRejected("live_blocked_limits_not_confirmed_by_owner")
    if chain_time_s is None or abs(now_s - chain_time_s) > caps.max_clock_skew_s:
        raise CapRejected("clock_skew_or_chain_time_unknown")
    side, mint = sig["side"], sig["mint"]
    pend_mint = [p for p in st.pending.values() if p.mint == mint and p.status == "UNKNOWN"]

    if side == "SELL":   # allowed during BUY halts, breaker trips and daily-loss stop; only total kill stops it
        if pend_mint:
            raise CapRejected("unknown_outcome_pending")      # reconcile first; never double-send
        if mint not in st.open_positions:
            raise CapRejected("sell_without_position")
        return {"fraction_bps": sig["size"]["fraction_bps"],
                "slippage_bps": min(sig["max_slippage_bps"], caps.max_slippage_bps_sell)}

    if sw.buys_halted():
        raise CapRejected("buys_halted")
    if breaker is not None and breaker.tripped:
        raise CapRejected("circuit_breaker_tripped")
    if pend_mint:
        raise CapRejected("unknown_outcome_pending")
    if now_s - st.last_heartbeat_ts > caps.heartbeat_timeout_s:
        raise CapRejected("producer_heartbeat_stale")
    fcap = float_cap_usd(caps, owner)
    if fcap is None:
        raise CapRejected("deposit_basis_unset")
    if st.hot_wallet_value_usd > fcap:
        st.alerts.append({"code": "float_over_cap", "hot_wallet_usd": round(st.hot_wallet_value_usd, 2),
                          "cap_usd": round(fcap, 2), "action": "owner should sweep to vault; executor never moves funds"})
        raise CapRejected("float_over_cap")
    if mint in st.deny_mints:
        raise CapRejected("mint_denied")
    if st.allow_mints is not None and mint not in st.allow_mints:
        raise CapRejected("mint_not_allowed")
    r = sig["risk"]
    if r["decision"] == "SKIP":
        raise CapRejected("risk_skip")
    if r["quality"] != "CLEAR":
        raise CapRejected("quality_not_clear")
    if r["mayhem"] is not False or executor_mayhem is not False:   # unknown == Mayhem
        raise CapRejected("mayhem_or_unknown")
    if executor_mcap_usd is None or executor_mcap_usd < caps.min_mcap_usd:
        raise CapRejected("mcap_below_min_or_unknown")
    if "usd" not in sig["size"]:
        raise CapRejected("buy_size_must_be_usd")
    if st.daily_pnl_usd <= -caps.daily_loss_limit_usd:
        raise CapRejected("daily_loss_stop")
    mints, notional = _effective_exposure(st, caps)
    if mint in mints:
        raise CapRejected("duplicate_open_mint")
    if now_s - st.last_sell_ts.get(mint, -1e18) < caps.rebuy_cooldown_s:
        raise CapRejected("rebuy_cooldown")
    if len(mints) >= caps.max_open_positions:
        raise CapRejected("max_open_positions")
    size = min(float(sig["size"]["usd"]), caps.per_trade_usd)   # clamp down, never up
    if notional + size > caps.max_open_notional_usd:
        raise CapRejected("max_open_notional")
    if sum(1 for t in st.entries_ts if now_s - t < 300) >= caps.max_new_per_5min:
        raise CapRejected("rate_5min")
    if sum(1 for t in st.entries_ts if now_s - t < 86_400) >= caps.max_new_per_day:
        raise CapRejected("rate_day")
    return {"size_usd": size, "slippage_bps": min(sig["max_slippage_bps"], caps.max_slippage_bps_buy)}
