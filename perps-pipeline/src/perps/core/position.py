"""Position state machine shared by the backtester and the paper engine (one source of truth for
stop / take-profit / trailing / time-stop / liquidation logic)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from .costs import CostModel, gross_pnl


@dataclass
class Position:
    symbol: str
    side: int
    qty: float                    # base units
    contracts: float
    entry_time: str
    entry_price: float
    stop_price: float
    initial_stop: float
    take_profit: float | None
    liquidation_price: float
    margin: float
    risk_amount: float            # expected loss at stop incl. costs (1R in $)
    entry_fee: float
    notional: float
    implied_leverage: float
    bars_held: int = 0
    funding: float = 0.0
    best_price: float = 0.0
    strategy: str = ""
    timeframe: str = ""
    meta: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    def unrealized(self, price: float) -> float:
        return gross_pnl(self.side, self.qty, self.entry_price, price)


@dataclass
class ExitFill:
    price: float
    reason: str          # stop | trail_stop | take_profit | liquidation | signal | time | end
    maker: bool = False


def check_intrabar(pos: Position, o: float, h: float, l: float, costs: CostModel, atr: float = 0.0) -> ExitFill | None:
    """Resolve exits *within* a bar, using only that bar's OHLC. Conservative ordering:
    gap-through at the open first, then liquidation, then stop before take-profit when both touch.
    """
    s = pos.side
    close_side = -s
    stop_reason = "trail_stop" if pos.stop_price != pos.initial_stop else "stop"
    # 1) gaps at the open
    if (s > 0 and o <= pos.liquidation_price) or (s < 0 and o >= pos.liquidation_price):
        return ExitFill(pos.liquidation_price, "liquidation")
    if (s > 0 and o <= pos.stop_price) or (s < 0 and o >= pos.stop_price):
        return ExitFill(costs.stop_fill(o, close_side, atr), stop_reason)
    if pos.take_profit is not None and ((s > 0 and o >= pos.take_profit) or (s < 0 and o <= pos.take_profit)):
        return ExitFill(o, "take_profit", maker=costs.take_profit_is_maker)
    # 2) intrabar touches (stop first if both stop and TP are inside the range)
    stop_hit = (s > 0 and l <= pos.stop_price) or (s < 0 and h >= pos.stop_price)
    if stop_hit:
        liq_hit = (s > 0 and l <= pos.liquidation_price) or (s < 0 and h >= pos.liquidation_price)
        fill = costs.stop_fill(pos.stop_price, close_side, atr)
        if liq_hit and ((s > 0 and fill <= pos.liquidation_price) or (s < 0 and fill >= pos.liquidation_price)):
            return ExitFill(pos.liquidation_price, "liquidation")
        return ExitFill(fill, stop_reason)
    if pos.take_profit is not None and ((s > 0 and h >= pos.take_profit) or (s < 0 and l <= pos.take_profit)):
        return ExitFill(pos.take_profit, "take_profit", maker=costs.take_profit_is_maker)
    return None


def update_after_close(pos: Position, h: float, l: float, c: float, atr: float, trail_atr_mult: float) -> None:
    """Called at bar close if the position survived the bar. Trailing stop changes take effect from
    the NEXT bar (no intrabar path assumptions)."""
    pos.bars_held += 1
    if pos.side > 0:
        pos.best_price = max(pos.best_price or pos.entry_price, h)
    else:
        pos.best_price = min(pos.best_price or pos.entry_price, l)
    if trail_atr_mult > 0 and atr == atr and atr > 0:
        if pos.side > 0:
            new = pos.best_price - trail_atr_mult * atr
            if new > pos.stop_price:
                pos.stop_price = min(new, c)  # never place the stop above the current close
        else:
            new = pos.best_price + trail_atr_mult * atr
            if new < pos.stop_price:
                pos.stop_price = max(new, c)
