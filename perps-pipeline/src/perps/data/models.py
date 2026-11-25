"""Exchange-agnostic data models."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any

OHLCV_COLUMNS = ["ts", "open", "high", "low", "close", "volume", "quote_volume"]
FUNDING_COLUMNS = ["ts", "funding_rate"]
OI_COLUMNS = ["ts", "open_interest", "open_interest_ccy"]


@dataclass(frozen=True)
class InstrumentSpec:
    """Normalised instrument metadata. Quantities are expressed in *base units* via contract_value.

    For Blofin, order size is in contracts: base_qty = contracts * contract_value.
    For Bybit, order qty is in base coin directly (contract_value = 1).
    """

    exchange: str
    symbol: str                 # canonical, e.g. BTC-USDT
    exchange_symbol: str        # native, e.g. BTC-USDT (blofin) / BTCUSDT (bybit)
    base: str
    quote: str
    contract_value: float       # base units per contract
    min_size: float             # contracts
    lot_size: float             # contracts increment
    tick_size: float
    max_leverage: float
    max_market_size: float | None = None
    min_notional: float = 0.0
    funding_interval_hours: float = 8.0
    state: str = "live"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    # ---- rounding helpers -------------------------------------------------------------
    def round_price(self, price: float) -> float:
        return round(round(price / self.tick_size) * self.tick_size, 12)

    def floor_contracts(self, contracts: float) -> float:
        steps = math.floor(contracts / self.lot_size + 1e-9)
        return round(steps * self.lot_size, 12)

    def contracts_to_base(self, contracts: float) -> float:
        return contracts * self.contract_value

    def base_to_contracts(self, qty: float) -> float:
        return qty / self.contract_value


def canonical_symbol(base: str, quote: str = "USDT") -> str:
    return f"{base.upper()}-{quote.upper()}"
