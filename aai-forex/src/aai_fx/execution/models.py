from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any

import pandas as pd


class OrderStatus(str, Enum):
    PENDING = "PENDING"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"


def _ser(d: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for k, v in d.items():
        if isinstance(v, pd.Timestamp):
            out[k] = v.isoformat()
        elif isinstance(v, Enum):
            out[k] = v.value
        else:
            out[k] = v
    return out


@dataclass
class Order:
    id: str
    ts: pd.Timestamp  # submission time
    pair: str
    side: int  # +1 buy, -1 sell
    lots: float
    kind: str  # "ENTRY" | "EXIT"
    stop: float | None = None
    target: float | None = None
    risk_amount: float = 0.0
    strategy: str = ""
    reason: str = ""
    status: OrderStatus = OrderStatus.PENDING
    simulated: bool = True

    def to_dict(self) -> dict[str, Any]:
        return _ser(asdict(self))


@dataclass
class Fill:
    order_id: str
    ts: pd.Timestamp
    pair: str
    side: int
    lots: float
    price: float
    mid: float
    commission: float
    kind: str  # ENTRY | EXIT | STOP | TARGET
    simulated: bool = True

    def to_dict(self) -> dict[str, Any]:
        return _ser(asdict(self))


@dataclass
class Position:
    pair: str
    side: int
    lots: float
    entry_price: float
    entry_ts: pd.Timestamp
    stop: float | None
    target: float | None
    initial_risk: float  # account ccy, |entry-stop| * units converted at entry
    entry_commission: float
    strategy: str = ""
    bars_held: int = 0
    meta: dict[str, Any] = field(default_factory=dict)
    swap: float = 0.0  # accrued financing (account ccy, negative = cost)

    def to_dict(self) -> dict[str, Any]:
        return _ser(asdict(self))


@dataclass
class ClosedTrade:
    pair: str
    side: int
    lots: float
    entry_ts: pd.Timestamp
    exit_ts: pd.Timestamp
    entry_price: float
    exit_price: float
    exit_kind: str
    gross_pnl: float
    commission: float
    net_pnl: float
    initial_risk: float
    r_multiple: float
    bars_held: int
    strategy: str = ""
    swap: float = 0.0  # financing included in net_pnl

    def to_dict(self) -> dict[str, Any]:
        return _ser(asdict(self))
