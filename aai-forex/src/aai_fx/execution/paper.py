"""Paper broker: simulated order/fill/position ledger. Never touches a real
account. Used by the backtest engine and by `aai-fx scan --paper`.

Fill model (input prices are MID):
* market orders fill at the NEXT bar open: buy = mid + half spread + slippage,
  sell = mid - half spread - slippage
* stops trigger on bid (long) / ask (short) and fill at the worse of stop and
  the bar open (gap-through), plus stop slippage
* targets (limits) fill at the target, or the open if it gapped through
* stop and target hit in the same bar -> STOP assumed first (conservative)
* commission per lot per side, in account currency
"""

from __future__ import annotations

import itertools
import json
from pathlib import Path
from typing import Any, Mapping

import pandas as pd

from ..config import CostConfig
from ..instruments import conversion_rate, get_instrument
from ..reporting.audit import AuditLog
from .models import ClosedTrade, Fill, Order, OrderStatus, Position


class PaperBroker:
    def __init__(self, starting_equity: float, account_ccy: str, costs: CostConfig,
                 audit: AuditLog | None = None, ledger_dir: str | Path | None = None) -> None:
        self.account_ccy = account_ccy
        self.costs = costs
        self.cash = float(starting_equity)
        self.positions: dict[str, Position] = {}
        self.pending: list[Order] = []
        self.orders: list[Order] = []
        self.fills: list[Fill] = []
        self.trades: list[ClosedTrade] = []
        self.audit = audit
        self.ledger_dir = Path(ledger_dir) if ledger_dir else None
        self._ids = itertools.count(1)
        self.total_commission = 0.0
        self.total_spread_cost = 0.0
        self.total_swap = 0.0

    # ------------------------------------------------------------------ utils
    def _ledger(self, name: str, rec: dict[str, Any]) -> None:
        if self.ledger_dir is None:
            return
        self.ledger_dir.mkdir(parents=True, exist_ok=True)
        with open(self.ledger_dir / f"{name}.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, default=str) + "\n")

    def _log(self, event: str, payload: dict[str, Any]) -> None:
        if self.audit is not None:
            self.audit.append(event, payload)

    def _half_spread(self, pair: str) -> float:
        return get_instrument(pair).pip_size * self.costs.for_pair(pair).spread_pips / 2.0

    def cost_pips_round_trip(self, pair: str) -> float:
        c = self.costs.for_pair(pair)
        return c.spread_pips + c.slippage_pips + c.stop_slippage_pips

    def _commission(self, pair: str, lots: float) -> float:
        return self.costs.commission_for(pair) * lots

    def _to_acct(self, pair: str, amount_quote: float, rates: Mapping[str, float]) -> float:
        return amount_quote * conversion_rate(get_instrument(pair).quote, self.account_ccy, rates)

    # ---------------------------------------------------------------- orders
    def submit_market(self, pair: str, side: int, lots: float, ts: pd.Timestamp, stop: float | None = None,
                      target: float | None = None, risk_amount: float = 0.0, strategy: str = "",
                      reason: str = "", kind: str = "ENTRY") -> Order:
        if lots <= 0:
            raise ValueError("lots must be > 0")
        o = Order(id=f"P{next(self._ids):06d}", ts=ts, pair=pair, side=side, lots=lots, kind=kind, stop=stop,
                  target=target, risk_amount=risk_amount, strategy=strategy, reason=reason)
        self.pending.append(o)
        self.orders.append(o)
        self._log("order_submitted", o.to_dict())
        self._ledger("orders", o.to_dict())
        return o

    def submit_close(self, pair: str, ts: pd.Timestamp, reason: str = "", strategy: str = "") -> Order | None:
        pos = self.positions.get(pair)
        if pos is None or any(o.pair == pair and o.kind == "EXIT" for o in self.pending):
            return None
        return self.submit_market(pair, -pos.side, pos.lots, ts, reason=reason, strategy=strategy, kind="EXIT")

    def has_pending(self, pair: str) -> bool:
        return any(o.pair == pair for o in self.pending)

    # -------------------------------------------------------------- bar loop
    def process_bar(self, pair: str, ts: pd.Timestamp, o: float, h: float, l: float, c: float,
                    rates: dict[str, float]) -> list[ClosedTrade]:
        """Apply one bar for ``pair``: fill pending at open, then stops/targets."""
        closed: list[ClosedTrade] = []
        rates[pair] = o
        self._accrue_swap(pair, ts, o, rates)
        hs = self._half_spread(pair)
        pip = get_instrument(pair).pip_size
        cst = self.costs.for_pair(pair)
        for order in [x for x in self.pending if x.pair == pair]:
            self.pending.remove(order)
            slip = cst.slippage_pips * pip
            px = o + hs + slip if order.side > 0 else o - hs - slip
            self.total_spread_cost += self._to_acct(pair, (hs + slip) * order.lots * get_instrument(pair).contract_size, rates)
            comm = self._commission(pair, order.lots)
            order.status = OrderStatus.FILLED
            fill = Fill(order.id, ts, pair, order.side, order.lots, px, o, comm, order.kind)
            self._record_fill(fill)
            if order.kind == "ENTRY":
                if pair in self.positions:
                    order.status = OrderStatus.CANCELLED
                    continue
                # If the open gapped through the stop, the stop check below fills it on this bar.
                units = order.lots * get_instrument(pair).contract_size
                init_risk = (self._to_acct(pair, abs(px - order.stop) * units, rates)
                             if order.stop is not None else order.risk_amount)
                self.cash -= comm
                self.positions[pair] = Position(pair, order.side, order.lots, px, ts, order.stop, order.target,
                                                init_risk, comm, order.strategy)
            else:
                t = self._close(pair, px, ts, "EXIT", comm, rates)
                if t:
                    closed.append(t)
        pos = self.positions.get(pair)
        if pos is not None:
            pos.bars_held += 1
            sslip = cst.stop_slippage_pips * pip
            px_exit, kind = None, None
            if pos.side > 0:
                if pos.stop is not None and l - hs <= pos.stop:
                    px_exit, kind = min(pos.stop, o - hs) - sslip, "STOP"
                elif pos.target is not None and h - hs >= pos.target:
                    px_exit, kind = max(pos.target, o - hs), "TARGET"
            else:
                if pos.stop is not None and h + hs >= pos.stop:
                    px_exit, kind = max(pos.stop, o + hs) + sslip, "STOP"
                elif pos.target is not None and l + hs <= pos.target:
                    px_exit, kind = min(pos.target, o + hs), "TARGET"
            if px_exit is not None and kind is not None:
                units = pos.lots * get_instrument(pair).contract_size
                self.total_spread_cost += self._to_acct(pair, (hs + (sslip if kind == "STOP" else 0.0)) * units, rates)
                rates[pair] = c
                comm = self._commission(pair, pos.lots)
                self._record_fill(Fill(f"{kind[0]}-{pair}-{ts.isoformat()}", ts, pair, -pos.side, pos.lots,
                                       px_exit, (pos.stop if kind == "STOP" else pos.target) or c, comm, kind))
                t = self._close(pair, px_exit, ts, kind, comm, rates)
                if t:
                    closed.append(t)
                    # cancel stale exit orders for this pair
                    for x in [x for x in self.pending if x.pair == pair and x.kind == "EXIT"]:
                        x.status = OrderStatus.CANCELLED
                        self.pending.remove(x)
        rates[pair] = c
        return closed

    def _accrue_swap(self, pair: str, ts: pd.Timestamp, px: float, rates: Mapping[str, float]) -> None:
        pos = self.positions.get(pair)
        if pos is None:
            return
        cst = self.costs.for_pair(pair)
        rate = cst.swap_long_pct_pa if pos.side > 0 else cst.swap_short_pct_pa
        last = pd.Timestamp(pos.meta.get("swap_ts", pos.entry_ts))
        nights = (ts.floor("D") - last.floor("D")).days
        if nights <= 0:
            return
        pos.meta["swap_ts"] = ts.isoformat()
        if rate == 0.0:
            return
        notional = self._to_acct(pair, pos.lots * get_instrument(pair).contract_size * px, rates)
        amt = notional * rate / 100.0 / 365.0 * nights
        pos.swap += amt
        self.cash += amt
        self.total_swap += amt

    def _record_fill(self, f: Fill) -> None:
        self.fills.append(f)
        self.total_commission += f.commission
        self._log("fill", f.to_dict())
        self._ledger("fills", f.to_dict())

    def _close(self, pair: str, px: float, ts: pd.Timestamp, kind: str, comm: float,
               rates: Mapping[str, float]) -> ClosedTrade | None:
        pos = self.positions.pop(pair, None)
        if pos is None:
            return None
        units = pos.lots * get_instrument(pair).contract_size
        gross = self._to_acct(pair, (px - pos.entry_price) * pos.side * units, rates)
        total_comm = pos.entry_commission + comm
        net = gross - total_comm + pos.swap  # swap was already credited/debited to cash as it accrued
        self.cash += gross - comm
        r = net / pos.initial_risk if pos.initial_risk > 0 else 0.0
        t = ClosedTrade(pair, pos.side, pos.lots, pos.entry_ts, ts, pos.entry_price, px, kind, gross, total_comm,
                        net, pos.initial_risk, r, pos.bars_held, pos.strategy, swap=pos.swap)
        self.trades.append(t)
        self._log("trade_closed", t.to_dict())
        self._ledger("trades", t.to_dict())
        return t

    # ------------------------------------------------------------- valuation
    def unrealized(self, rates: Mapping[str, float]) -> float:
        tot = 0.0
        for p in self.positions.values():
            mid = rates[p.pair]
            hs = self._half_spread(p.pair)
            exit_px = mid - hs if p.side > 0 else mid + hs
            units = p.lots * get_instrument(p.pair).contract_size
            tot += self._to_acct(p.pair, (exit_px - p.entry_price) * p.side * units, rates)
        return tot

    def equity(self, rates: Mapping[str, float]) -> float:
        return self.cash + self.unrealized(rates)

    # ----------------------------------------------------------- persistence
    def snapshot(self) -> dict[str, Any]:
        return {"cash": self.cash, "positions": [p.to_dict() for p in self.positions.values()],
                "pending": [o.to_dict() for o in self.pending], "next_id": next(self._ids)}

    @classmethod
    def restore(cls, snap: dict[str, Any], **kwargs: Any) -> "PaperBroker":
        b = cls(starting_equity=snap["cash"], **kwargs)
        for p in snap.get("positions", []):
            p = dict(p)
            p["entry_ts"] = pd.Timestamp(p["entry_ts"])
            b.positions[p["pair"]] = Position(**p)
        for o in snap.get("pending", []):
            o = dict(o)
            o["ts"] = pd.Timestamp(o["ts"])
            o["status"] = OrderStatus(o["status"])
            od = Order(**o)
            b.pending.append(od)
            b.orders.append(od)
        b._ids = itertools.count(int(snap.get("next_id", 1)))
        return b
