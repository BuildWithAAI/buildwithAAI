"""Pre-trade hard limits. Call check_order() immediately before sending ANY order (live or paper-
to-exchange). It raises a GuardError subclass on any violation; it never returns 'maybe'.

Checks (in order, fail-closed): kill switch -> config valid -> agent known -> lane enabled -> venue allowlist ->
symbol allowlist -> per-symbol overrides -> leverage -> per-order notional cap -> notional % equity -> risk % per trade
(if stop given) -> daily loss -> trades/hour + trades/day -> approval above cap.
"""
from __future__ import annotations

import fcntl
import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import approvals, audit_log, config, killswitch, paths
from .errors import ApprovalRequired, GuardError, RiskLimitViolation


@dataclass
class OrderIntent:
    agent: str
    venue: str
    symbol: str
    side: str                       # buy|sell|long|short
    notional_usd: float
    equity_usd: float | None
    leverage: float = 1.0
    entry: float | None = None
    stop: float | None = None
    day_start_equity_usd: float | None = None
    reduce_only: bool = False
    approval_id: str | None = None
    meta: dict = field(default_factory=dict)


def _day() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


class _State:
    """Per-agent trade timestamps + day-start equity, in state/risk_state.json (flock-protected)."""

    def __init__(self, path: Path | None = None):
        self.path = Path(path or (paths.state_dir() / "risk_state.json"))

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(self.fd, fcntl.LOCK_EX)
        raw = os.read(self.fd, 10_000_000) or b"{}"
        try:
            self.data = json.loads(raw)
        except ValueError:
            self.data = {}
        return self

    def save(self):
        os.lseek(self.fd, 0, 0)
        os.ftruncate(self.fd, 0)
        os.write(self.fd, json.dumps(self.data).encode())

    def __exit__(self, *exc):
        fcntl.flock(self.fd, fcntl.LOCK_UN)
        os.close(self.fd)


def _deny(intent: OrderIntent, reason: str, exc=RiskLimitViolation):
    audit_log.append("order_denied", intent.agent, {**_summary(intent), "reason": reason}, outcome="denied")
    raise exc(reason)


def _summary(i: OrderIntent) -> dict:
    d = asdict(i)
    d.pop("meta", None)
    return d


def check_order(intent: OrderIntent, record: bool = True, cfg: dict | None = None) -> dict:
    """Raise on violation; on success record the trade (for frequency limits) and audit-log it."""
    try:
        killswitch.require_not_engaged(intent.agent, f"place order {intent.symbol}")
        cfg = cfg or config.load()
        lim = config.agent_limits(cfg, intent.agent)
    except GuardError as e:
        if not isinstance(e, killswitch.KillSwitchEngaged):
            audit_log.append("order_denied", intent.agent, {**_summary(intent), "reason": str(e)}, outcome="denied")
        raise

    if lim.get("enabled", True) is not True:
        _deny(intent, f"agent {intent.agent!r} trading lane is disabled (enabled=false) - no trading")
    venues = lim.get("venues") or []
    if intent.venue not in venues:
        _deny(intent, f"venue {intent.venue!r} not allowed for agent {intent.agent!r} (allowed: {venues})")
    syms = lim.get("symbols") or []
    if "*" not in syms and intent.symbol not in syms:
        _deny(intent, f"symbol {intent.symbol!r} not on allowlist for {intent.agent!r}")
    # Optional per-symbol overrides (exact symbol match, e.g. "XAUUSD+"); can only be set by the human.
    sym_lim = (lim.get("symbol_limits") or {}).get(intent.symbol) or {}
    if sym_lim:
        lim = {**lim, **{k: v for k, v in sym_lim.items() if not k.startswith("_")}}
    if intent.side not in ("buy", "sell", "long", "short"):
        _deny(intent, f"invalid side {intent.side!r}")
    try:
        notional, lev = float(intent.notional_usd), float(intent.leverage)
    except (TypeError, ValueError):
        _deny(intent, "notional/leverage not numeric")
    if not (notional > 0) or not (lev > 0):
        _deny(intent, "notional and leverage must be > 0")
    if intent.equity_usd is None or not (float(intent.equity_usd) > 0):
        _deny(intent, "account equity unknown or <= 0 - fail closed")
    eq = float(intent.equity_usd)
    if lev > float(lim["max_leverage"]) + 1e-9:
        _deny(intent, f"leverage {lev}x > max {lim['max_leverage']}x")
    if not intent.reduce_only:
        if notional > float(lim["max_order_notional_usd"]) + 1e-9:
            _deny(intent, f"order notional ${notional:,.2f} > hard cap ${lim['max_order_notional_usd']:,.2f}")
        pct = 100.0 * notional / eq
        if pct > float(lim["max_notional_pct_equity"]) + 1e-9:
            _deny(intent, f"position notional {pct:.2f}% of equity > max {lim['max_notional_pct_equity']}%")
        if intent.entry and intent.stop and lim.get("max_risk_pct_per_trade"):
            risk_pct = 100.0 * notional * abs(intent.entry - intent.stop) / intent.entry / eq
            if risk_pct > float(lim["max_risk_pct_per_trade"]) + 1e-9:
                _deny(intent, f"risk to stop {risk_pct:.2f}% of equity > max {lim['max_risk_pct_per_trade']}%")

    with _State() as st:
        a = st.data.setdefault(intent.agent, {"trades": [], "day": None, "day_start_equity": None})
        if a.get("day") != _day():
            a["day"], a["day_start_equity"] = _day(), float(intent.day_start_equity_usd or eq)
        day0 = float(intent.day_start_equity_usd or a["day_start_equity"] or eq)
        loss_pct = max(0.0, 100.0 * (1 - eq / day0)) if day0 > 0 else 100.0
        if not intent.reduce_only and loss_pct >= float(lim["max_daily_loss_pct"]) - 1e-9 and loss_pct > 0:
            _deny(intent, f"daily loss {loss_pct:.2f}% >= limit {lim['max_daily_loss_pct']}% - no new risk today")
        now = time.time()
        a["trades"] = [t for t in a["trades"] if now - t < 86400]
        last_hour = sum(1 for t in a["trades"] if now - t < 3600)
        if last_hour >= int(lim["max_trades_per_hour"]):
            _deny(intent, f"{last_hour} trades in last hour >= max {lim['max_trades_per_hour']}")
        if len(a["trades"]) >= int(lim.get("max_trades_per_day", 10**9)):
            _deny(intent, f"{len(a['trades'])} trades in last 24h >= max {lim['max_trades_per_day']}")
        if not intent.reduce_only and notional > float(lim["approval_required_above_notional_usd"]) + 1e-9:
            if not intent.approval_id:
                _deny(intent, f"notional ${notional:,.2f} > approval threshold "
                              f"${lim['approval_required_above_notional_usd']:,.2f}: human approval token required",
                      ApprovalRequired)
            approvals.consume(intent.approval_id, agent=intent.agent, action="order",
                              asset=intent.symbol, amount=notional, destination=intent.venue)
        if record:
            a["trades"].append(now)
            st.save()
    rec = audit_log.append("order_allowed", intent.agent, _summary(intent))
    return {"allowed": True, "audit_seq": rec["seq"]}
