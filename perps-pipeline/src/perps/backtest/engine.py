"""Event-driven bar backtester (multi-symbol, shared equity).

Timing model (no lookahead):
  * Strategy signals are computed on bar t using data up to bar t's close.
  * Entries execute at bar t+1's OPEN (+ adverse slippage, taker fee).
  * Stops / take-profits are resolved within each bar from its OHLC only (stop-first when ambiguous);
    gaps through a level fill at the open.
  * Trailing stops / time stops / signal exits are evaluated at bar close and act from bar t+1.
  * Funding is charged at each settlement timestamp while a position is open (sign-aware).
  * Isolated-margin liquidation is checked every bar.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..config import Settings
from ..core.costs import CostModel, funding_payment, gross_pnl
from ..core.position import ExitFill, Position, check_intrabar, update_after_close
from ..data.models import InstrumentSpec
from ..risk.limits import RiskManager
from ..risk.sizing import size_position
from ..strategies.base import Strategy

log = logging.getLogger(__name__)


@dataclass
class SymbolData:
    symbol: str
    bars: pd.DataFrame              # index: UTC DatetimeIndex; columns open high low close volume
    spec: InstrumentSpec
    funding: pd.DataFrame | None = None   # index UTC; column funding_rate


@dataclass
class BacktestResult:
    trades: pd.DataFrame
    equity: pd.Series
    exposure: pd.Series
    initial_equity: float
    rejections: dict[str, int] = field(default_factory=dict)
    kill_reason: str = ""
    meta: dict = field(default_factory=dict)


class BacktestEngine:
    def __init__(self, settings: Settings, exchange: str | None = None) -> None:
        self.s = settings
        fees = settings.fee_rates(exchange)
        self.costs = CostModel(
            maker_fee=fees.maker, taker_fee=fees.taker,
            market_slippage_bps=settings.slippage.market_bps, stop_slippage_bps=settings.slippage.stop_bps,
            atr_slippage_frac=settings.slippage.atr_frac,
            take_profit_is_maker=settings.backtest.take_profit_fee == "maker",
        )

    def run(self, strategy: Strategy, data: list[SymbolData], trade_start: pd.Timestamp | None = None,
            trade_end: pd.Timestamp | None = None, initial_equity: float | None = None) -> BacktestResult:
        s, costs = self.s, self.costs
        eq0 = float(initial_equity or s.capital.initial_equity)
        risk = RiskManager(s.risk, eq0, kill_file=None)  # backtests ignore the on-disk kill file
        exits = strategy.exit_params

        # --- precompute per-symbol arrays --------------------------------------------------------
        sym_arrays = {}
        for d in data:
            b = d.bars
            sig = strategy.compute(b)
            fund = pd.Series(dtype=float)
            if d.funding is not None and not d.funding.empty:
                fund = d.funding["funding_rate"].astype(float)
            sym_arrays[d.symbol] = {
                "t": b.index, "o": b["open"].to_numpy(float), "h": b["high"].to_numpy(float),
                "l": b["low"].to_numpy(float), "c": b["close"].to_numpy(float),
                "sig": sig["signal"].to_numpy(int), "sd": sig["stop_dist"].to_numpy(float),
                "sp": sig["stop_price"].to_numpy(float), "atr": sig["atr"].to_numpy(float),
                "xl": sig["exit_long"].to_numpy(bool), "xs": sig["exit_short"].to_numpy(bool),
                "fund_t": fund.index, "fund_r": fund.to_numpy(float), "fund_ptr": 0, "spec": d.spec,
            }
        timeline = pd.DatetimeIndex(sorted(set().union(*[set(a["t"]) for a in sym_arrays.values()])))
        if trade_start is not None:
            trade_start = pd.Timestamp(trade_start)
        if trade_end is not None:
            trade_end = pd.Timestamp(trade_end)
        pos_index = {sym: {t: i for i, t in enumerate(a["t"])} for sym, a in sym_arrays.items()}

        cash = eq0
        positions: dict[str, Position] = {}
        pending_entry: dict[str, tuple[int, float, float, float]] = {}  # sym -> (side, stop_dist, stop_px, atr)
        pending_exit: dict[str, str] = {}
        last_close: dict[str, float] = {}
        trades: list[dict] = []
        eq_curve = np.empty(len(timeline))
        expo = np.zeros(len(timeline))

        def equity_now() -> float:
            return cash + sum(p.unrealized(last_close.get(sym, p.entry_price)) for sym, p in positions.items())

        def close_position(sym: str, fill: ExitFill, t: pd.Timestamp) -> None:
            nonlocal cash
            p = positions.pop(sym)
            exit_notional = p.qty * fill.price
            fee = costs.fee(exit_notional, maker=fill.maker)
            g = gross_pnl(p.side, p.qty, p.entry_price, fill.price)
            if fill.reason == "liquidation":
                g = max(g, -p.margin)  # isolated: loss capped at posted margin
            net = g - p.entry_fee - fee + p.funding
            cash += g - fee  # entry fee + funding already debited from cash
            trades.append({
                "symbol": sym, "side": "long" if p.side > 0 else "short", "entry_time": p.entry_time,
                "exit_time": t, "entry_price": p.entry_price, "exit_price": fill.price, "qty": p.qty,
                "contracts": p.contracts, "notional": p.notional, "implied_leverage": p.implied_leverage,
                "initial_stop": p.initial_stop, "take_profit": p.take_profit, "risk_amount": p.risk_amount,
                "gross_pnl": g, "fees": p.entry_fee + fee, "funding": p.funding, "net_pnl": net,
                "r_multiple": net / p.risk_amount if p.risk_amount > 0 else np.nan, "exit_reason": fill.reason,
                "bars_held": p.bars_held,
            })

        for k, t in enumerate(timeline):
            in_window = (trade_start is None or t >= trade_start) and (trade_end is None or t < trade_end)
            for sym, a in sym_arrays.items():
                i = pos_index[sym].get(t)
                if i is None:
                    continue
                o, h, l, c, at = a["o"][i], a["h"][i], a["l"][i], a["c"][i], a["atr"][i]
                spec: InstrumentSpec = a["spec"]
                # ---- 1. pending exit at this open ----------------------------------------------
                if sym in positions and sym in pending_exit:
                    p = positions[sym]
                    close_position(sym, ExitFill(costs.market_fill(o, -p.side, at), pending_exit.pop(sym)), t)
                pending_exit.pop(sym, None)
                # ---- 2. pending entry at this open ---------------------------------------------
                if sym in pending_entry:
                    side, sdist, spx, eatr = pending_entry.pop(sym)
                    if in_window and sym not in positions:
                        last_close[sym] = o
                        eq = equity_now()
                        ok, why = risk.can_open(eq, len(positions))
                        if ok:
                            fill = costs.market_fill(o, side, eatr)
                            stop = spx if spx == spx else fill - side * sdist
                            stop = spec.round_price(stop)
                            used_margin = sum(p.margin for p in positions.values())
                            sz = size_position(
                                equity=eq, risk_fraction=risk.risk_fraction, entry_price=fill, stop_price=stop,
                                side=side, spec=spec, taker_fee=costs.taker_fee,
                                stop_slippage_bps=costs.market_slippage_bps + costs.stop_slippage_bps,
                                max_leverage=s.risk.max_leverage, margin_leverage=s.risk.margin_leverage,
                                mmr=s.risk.maintenance_margin_rate, liquidation_buffer=s.risk.liquidation_buffer,
                                available_margin=eq - used_margin,
                            )
                            if sz.ok:
                                fee = costs.fee(sz.notional)
                                cash -= fee
                                r_dist = abs(fill - stop)
                                tp = (fill + side * exits.take_profit_r * r_dist) if exits.take_profit_r > 0 else None
                                positions[sym] = Position(
                                    symbol=sym, side=side, qty=sz.qty, contracts=sz.contracts, entry_time=str(t),
                                    entry_price=fill, stop_price=stop, initial_stop=stop,
                                    take_profit=spec.round_price(tp) if tp else None,
                                    liquidation_price=sz.liquidation_price, margin=sz.margin,
                                    risk_amount=sz.expected_loss_at_stop, entry_fee=fee,
                                    notional=sz.notional, implied_leverage=sz.implied_leverage,
                                    best_price=fill, strategy=strategy.name, timeframe=strategy.timeframe,
                                )
                            else:
                                key = "sizing: " + sz.reason.split(":")[0].split(" (")[0]
                                risk.state.rejections[key] = risk.state.rejections.get(key, 0) + 1
                # ---- 3. funding settlements inside this bar [t, next_t) -----------------------
                # Charged iff the position is open at the settlement instant (entry strictly before it).
                # Approximation: a settlement strictly inside a bar is charged before intrabar exits.
                if len(a["fund_t"]):
                    ft, fr = a["fund_t"], a["fund_r"]
                    nxt = a["t"][i + 1] if i + 1 < len(a["t"]) else t + pd.Timedelta(minutes=1)
                    j = a["fund_ptr"]
                    while j < len(ft) and ft[j] < t:
                        j += 1
                    while j < len(ft) and ft[j] < nxt:
                        if sym in positions and ft[j] > pd.Timestamp(positions[sym].entry_time):
                            p = positions[sym]
                            fp = funding_payment(p.side, p.qty, o if ft[j] == t else c, fr[j])
                            p.funding += fp
                            cash += fp
                        j += 1
                    a["fund_ptr"] = j
                # ---- 4. intrabar stop / TP / liquidation ----------------------------------------
                if sym in positions:
                    p = positions[sym]
                    ex = check_intrabar(p, o, h, l, costs, at)
                    if ex is not None:
                        close_position(sym, ex, t)
                last_close[sym] = c
                # ---- 5. end-of-bar management --------------------------------------------------
                if sym in positions:
                    p = positions[sym]
                    update_after_close(p, h, l, c, at, exits.trail_atr_mult)
                    if exits.max_hold_bars and p.bars_held >= exits.max_hold_bars:
                        pending_exit[sym] = "time"
                    elif (p.side > 0 and a["xl"][i]) or (p.side < 0 and a["xs"][i]):
                        pending_exit[sym] = "signal"
                    if trade_end is not None and i + 1 < len(a["t"]) and a["t"][i + 1] >= trade_end:
                        pending_exit.pop(sym, None)
                        close_position(sym, ExitFill(costs.market_fill(c, -p.side, at), "end"), t)
                # ---- 6. new signal -> order for next open --------------------------------------
                elif in_window and a["sig"][i] != 0 and i + 1 < len(a["t"]):
                    nt = a["t"][i + 1]
                    if trade_end is None or nt < trade_end:
                        pending_entry[sym] = (int(a["sig"][i]), float(a["sd"][i]), float(a["sp"][i]), float(at))
            eq = equity_now()
            eq_curve[k] = eq
            expo[k] = 1.0 if positions else 0.0
            risk.on_equity(t, eq)

        # force-close anything still open at the final close
        for sym in list(positions):
            p = positions[sym]
            px = costs.market_fill(last_close[sym], -p.side)
            close_position(sym, ExitFill(px, "end"), timeline[-1])
        if len(timeline):
            eq_curve[-1] = cash

        tdf = pd.DataFrame(trades)
        equity = pd.Series(eq_curve, index=timeline, name="equity")
        exposure = pd.Series(expo, index=timeline, name="exposure")
        if trade_start is not None:
            equity, exposure = equity[equity.index >= trade_start], exposure[exposure.index >= trade_start]
        if trade_end is not None:
            equity, exposure = equity[equity.index < trade_end], exposure[exposure.index < trade_end]
        return BacktestResult(tdf, equity, exposure, eq0, dict(risk.state.rejections), risk.state.kill_reason,
                              meta={"strategy": strategy.describe(), "symbols": [d.symbol for d in data]})
