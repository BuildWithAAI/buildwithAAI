"""MetaTrader 5 execution adapter -- STUB with a live-trading guard.

THIS BOX (Linux) CANNOT TRADE: the MetaTrader5 package is Windows-only.
Live use is intended for the user's Windows PC with the MT5 terminal running
and logged in. Even there, every order is refused unless the adapter was
constructed with ``confirm_live=True`` AND the call passes
``confirm_live=True``. Without both, ``place_order`` raises
``LiveTradingNotConfirmed`` and nothing is sent. With ``dry_run=True`` (the
default) the would-be MT5 request dict is returned instead of being sent.

The order_send path is written against the documented MT5 API but has NOT
been executed against a real terminal. Treat as untested until verified on
a demo account first.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from typing import Any

from ..reporting.audit import AuditLog


class LiveTradingNotConfirmed(PermissionError):
    pass


class MT5NotAvailable(RuntimeError):
    pass


def _load_agent_guard():
    """agent-guard integration (fail closed): live orders are refused if the guard can't be imported.
    On the Windows PC copy /workspace/agent-guard there and set AGENT_GUARD_PATH / AGENT_GUARD_HOME."""
    p = os.environ.get("AGENT_GUARD_PATH", "/workspace/agent-guard")
    if p not in sys.path:
        sys.path.insert(0, p)
    try:
        import agent_guard
    except Exception as exc:  # noqa: BLE001
        raise LiveTradingNotConfirmed(f"agent-guard not importable ({exc}); live MT5 order refused (fail closed)") from exc
    return agent_guard


def _notional_usd(pair: str, lots: float, price: float) -> float:
    """Approximate USD notional of an FX order (100k units per lot)."""
    units = float(lots) * 100_000
    if pair[:3] == "USD":
        return units
    if pair[3:6] == "USD":
        return units * float(price)
    raise LiveTradingNotConfirmed(f"cannot compute USD notional for {pair}; non-USD crosses need a guard update")


@dataclass
class MT5OrderRequest:
    pair: str
    side: int
    lots: float
    stop: float | None
    target: float | None
    comment: str = "aai-fx"
    magic: int = 20261101
    deviation_points: int = 10


class MT5Broker:
    def __init__(self, confirm_live: bool = False, dry_run: bool = True, symbol_suffix: str = "",
                 audit: AuditLog | None = None) -> None:
        self._confirmed = confirm_live is True  # must be the literal True, not truthy
        self.dry_run = dry_run
        self.symbol_suffix = symbol_suffix
        self.audit = audit

    def _audit(self, event: str, payload: dict[str, Any]) -> None:
        if self.audit is not None:
            self.audit.append(event, payload)

    def build_request(self, req: MT5OrderRequest, mt5: Any = None) -> dict[str, Any]:
        """Translate to an MT5 order_send dict (symbolic constants if mt5 is None)."""
        k = (lambda n: getattr(mt5, n)) if mt5 is not None else (lambda n: n)
        d: dict[str, Any] = {
            "action": k("TRADE_ACTION_DEAL"),
            "symbol": req.pair + self.symbol_suffix,
            "volume": float(req.lots),
            "type": k("ORDER_TYPE_BUY") if req.side > 0 else k("ORDER_TYPE_SELL"),
            "deviation": req.deviation_points,
            "magic": req.magic,
            "comment": req.comment,
            "type_time": k("ORDER_TIME_GTC"),
            "type_filling": k("ORDER_FILLING_IOC"),  # broker-specific; check symbol_info().filling_mode
        }
        if req.stop is not None:
            d["sl"] = float(req.stop)
        if req.target is not None:
            d["tp"] = float(req.target)
        return d

    def guard_live(self, ag, req: MT5OrderRequest, price: float, equity: float | None) -> dict:
        """agent-guard hard limits (venue/symbol allowlist, notional % equity, effective leverage,
        daily loss, trades/hour, approval above cap). Raises a GuardError on any violation."""
        notional = _notional_usd(req.pair, req.lots, price)
        lev = notional / float(equity) if equity else 0.0
        intent = ag.OrderIntent(agent="forex", venue="mt5", symbol=req.pair + self.symbol_suffix, side="buy" if req.side > 0 else "sell",
                                notional_usd=notional, equity_usd=equity, leverage=max(lev, 1e-9),
                                entry=float(price), stop=req.stop, meta={"comment": req.comment})
        try:
            return ag.check_order(intent)
        except ag.GuardError as exc:
            self._audit("live_order_refused", {"pair": req.pair, "lots": req.lots, "reason": f"agent-guard: {exc}"})
            raise

    def place_order(self, req: MT5OrderRequest, confirm_live: bool = False) -> dict[str, Any]:
        attempt = {"pair": req.pair, "side": req.side, "lots": req.lots, "dry_run": self.dry_run,
                   "adapter_confirmed": self._confirmed, "call_confirmed": confirm_live is True}
        if not (self._confirmed and confirm_live is True):
            self._audit("live_order_refused", {**attempt, "reason": "live confirmation flag missing"})
            raise LiveTradingNotConfirmed(
                "Refusing live MT5 order: construct MT5Broker(confirm_live=True) AND call "
                "place_order(..., confirm_live=True). Use PaperBroker for simulation.")
        if req.lots <= 0:
            raise ValueError("lots must be > 0")
        if self.dry_run:
            self._audit("live_order_dry_run", {**attempt, "request": self.build_request(req)})
            return {"dry_run": True, "request": self.build_request(req)}
        ag = _load_agent_guard()  # agent-guard: global kill switch is checked before anything live
        try:
            ag.killswitch.require_not_engaged("forex", f"send live MT5 order {req.pair}")
        except ag.GuardError as exc:
            self._audit("live_order_refused", {**attempt, "reason": f"agent-guard: {exc}"})
            raise
        if not sys.platform.startswith("win"):
            self._audit("live_order_refused", {**attempt, "reason": "not Windows"})
            raise MT5NotAvailable("MetaTrader5 is Windows-only; live orders can only be sent from the Windows PC.")
        try:  # pragma: no cover - windows only
            import MetaTrader5 as mt5
        except ImportError as exc:  # pragma: no cover
            raise MT5NotAvailable("MetaTrader5 package not installed") from exc
        if not mt5.initialize():  # pragma: no cover
            raise MT5NotAvailable(f"mt5.initialize failed: {mt5.last_error()}")
        tick = mt5.symbol_info_tick(req.pair + self.symbol_suffix)  # pragma: no cover
        request = self.build_request(req, mt5)  # pragma: no cover
        request["price"] = tick.ask if req.side > 0 else tick.bid  # pragma: no cover
        acct = mt5.account_info()  # pragma: no cover
        self.guard_live(ag, req, request["price"], getattr(acct, "equity", None))  # pragma: no cover
        self._audit("live_order_sending", {**attempt, "request": {k: str(v) for k, v in request.items()}})
        result = mt5.order_send(request)  # pragma: no cover
        out = result._asdict() if result is not None else {"error": str(mt5.last_error())}  # pragma: no cover
        self._audit("live_order_result", {k: str(v) for k, v in out.items()})  # pragma: no cover
        return out  # pragma: no cover
