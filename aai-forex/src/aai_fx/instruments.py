"""Instrument specifications and currency conversion.

Contract specs here are *generic retail defaults*: FX 100k units per lot,
gold (XAUUSD) 100 troy oz per lot (so a $1.00 move = $100 per lot), 0.01 lot
step. Real brokers differ (contract size, lot step, min lot, digits,
commission currency). On MT5 these must be read from ``symbol_info()`` and
applied via ``register_instrument`` / the ``instruments:`` config section.

UNCONFIRMED: Bybit MT5 ``AUDUSD+`` / ``XAUUSD+`` contract size, digits, lot
limits, spreads, commission and swaps have NOT been verified. Export
``symbol_info()`` from the terminal and put the values in the config.

Gold "pip" convention used here: ``pip_size = 0.01`` (one MT5 point on a
2-digit XAUUSD quote, $1 per lot at 100 oz). Many traders call $0.10 a pip;
spreads/stops in this codebase are always expressed in *pip_size units*.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class Instrument:
    symbol: str  # canonical, e.g. "EURUSD"
    base: str
    quote: str
    pip_size: float
    contract_size: float = 100_000.0
    lot_step: float = 0.01
    min_lot: float = 0.01
    max_lot: float = 100.0
    yf_ticker: str | None = None  # override for non-FX (e.g. gold futures)
    broker_symbol: str | None = None  # e.g. "XAUUSD+" on Bybit MT5

    @property
    def is_jpy_quote(self) -> bool:
        return self.quote == "JPY"

    @property
    def yfinance_ticker(self) -> str:
        return self.yf_ticker or f"{self.symbol}=X"

    def price_to_pips(self, price_diff: float) -> float:
        return price_diff / self.pip_size

    def pips_to_price(self, pips: float) -> float:
        return pips * self.pip_size

    def usd_direction(self, side: int) -> int:
        """Net USD exposure sign of a position: +1 long USD, -1 short USD, 0 none.

        ``side`` is +1 for long the pair (buy base / sell quote), -1 for short.
        """
        if self.base == "USD":
            return side
        if self.quote == "USD":
            return -side
        return 0


def _mk(sym: str) -> Instrument:
    base, quote = sym[:3], sym[3:]
    pip = 0.01 if quote == "JPY" else 0.0001
    return Instrument(symbol=sym, base=base, quote=quote, pip_size=pip)


MAJORS: tuple[str, ...] = ("EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD")
CROSSES: tuple[str, ...] = ("EURGBP", "EURJPY", "GBPJPY", "EURCHF", "AUDJPY", "EURAUD", "GBPCHF", "CADJPY")

METALS: tuple[str, ...] = ("XAUUSD",)

INSTRUMENTS: dict[str, Instrument] = {s: _mk(s) for s in MAJORS + CROSSES}
# Gold: 100 oz/lot generic CFD spec. yfinance has no spot gold; GC=F is COMEX
# front-month futures (roll gaps, futures basis) -- see data docs.
INSTRUMENTS["XAUUSD"] = Instrument(symbol="XAUUSD", base="XAU", quote="USD", pip_size=0.01,
                                   contract_size=100.0, lot_step=0.01, min_lot=0.01, max_lot=100.0,
                                   yf_ticker="GC=F")


def normalize_symbol(sym: str) -> str:
    """Canonical 6-letter symbol. Strips broker suffixes like Bybit's ``+``
    (``XAUUSD+`` -> ``XAUUSD``) and ``.``-suffixes (``EURUSD.pro``)."""
    s = sym.upper().replace("/", "").replace("_", "").replace("=X", "").strip()
    s = s.split(".")[0].rstrip("+#!")
    if s == "GC=F":
        return "XAUUSD"
    if len(s) != 6:
        raise ValueError(f"Not an FX symbol: {sym!r}")
    return s


def get_instrument(sym: str) -> Instrument:
    s = normalize_symbol(sym)
    if s not in INSTRUMENTS:
        INSTRUMENTS[s] = _mk(s)
    return INSTRUMENTS[s]


def register_instrument(sym: str, **overrides: object) -> Instrument:
    """Override an instrument spec (e.g. from MT5 ``symbol_info`` or config)."""
    from dataclasses import replace
    base = get_instrument(sym)
    inst = replace(base, **overrides)  # type: ignore[arg-type]
    INSTRUMENTS[base.symbol] = inst
    return inst


class ConversionError(RuntimeError):
    pass


def conversion_rate(from_ccy: str, to_ccy: str, rates: Mapping[str, float]) -> float:
    """Units of ``to_ccy`` per 1 unit of ``from_ccy`` using mid ``rates``.

    ``rates`` maps a 6-letter pair (e.g. "USDJPY") to its mid price
    (quote units per 1 base). Tries direct, inverse, then triangulation via
    USD, EUR. Raises ConversionError rather than guessing.
    """
    from_ccy, to_ccy = from_ccy.upper(), to_ccy.upper()
    if from_ccy == to_ccy:
        return 1.0
    direct = rates.get(from_ccy + to_ccy)
    if direct is not None and direct > 0:
        return float(direct)
    inverse = rates.get(to_ccy + from_ccy)
    if inverse is not None and inverse > 0:
        return 1.0 / float(inverse)
    for via in ("USD", "EUR"):
        if via in (from_ccy, to_ccy):
            continue
        try:
            a = _direct_or_inverse(from_ccy, via, rates)
            b = _direct_or_inverse(via, to_ccy, rates)
            return a * b
        except ConversionError:
            continue
    raise ConversionError(f"No rate path {from_ccy}->{to_ccy} in {sorted(rates)}")


def _direct_or_inverse(a: str, b: str, rates: Mapping[str, float]) -> float:
    if a == b:
        return 1.0
    if (r := rates.get(a + b)) is not None and r > 0:
        return float(r)
    if (r := rates.get(b + a)) is not None and r > 0:
        return 1.0 / float(r)
    raise ConversionError(f"No rate {a}{b} or {b}{a}")
