"""Fee, slippage and funding arithmetic (linear USDT-margined contracts)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CostModel:
    maker_fee: float = 0.0002
    taker_fee: float = 0.0006
    market_slippage_bps: float = 2.0
    stop_slippage_bps: float = 3.0       # in addition to market slippage
    atr_slippage_frac: float = 0.0
    take_profit_is_maker: bool = False

    def market_fill(self, ref_price: float, side: int, atr: float = 0.0) -> float:
        """Adverse fill for a market order: buy (side=+1) pays up, sell (side=-1) receives less."""
        slip = ref_price * self.market_slippage_bps / 1e4 + self.atr_slippage_frac * (atr if atr == atr else 0.0)
        return ref_price + side * slip

    def stop_fill(self, ref_price: float, side: int, atr: float = 0.0) -> float:
        """Stop-market fill; `side` is the side of the *closing* order."""
        slip = ref_price * (self.market_slippage_bps + self.stop_slippage_bps) / 1e4
        slip += self.atr_slippage_frac * (atr if atr == atr else 0.0)
        return ref_price + side * slip

    def fee(self, notional: float, maker: bool = False) -> float:
        return abs(notional) * (self.maker_fee if maker else self.taker_fee)


def funding_payment(side: int, qty: float, mark_price: float, rate: float) -> float:
    """Cash flow to the position holder at a funding settlement.

    Positive rate: longs pay shorts. Returns a signed cash amount (negative = paid).
    """
    return -side * qty * mark_price * rate


def gross_pnl(side: int, qty: float, entry: float, exit_: float) -> float:
    return side * qty * (exit_ - entry)
