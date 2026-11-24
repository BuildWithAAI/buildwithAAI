"""Position sizing: size = risk$ / per-unit loss at stop, rounded down to exchange lot constraints.

Per-unit loss includes the price distance to the stop, the expected adverse stop slippage and the
round-trip taker fees, so a stop-out costs ~risk$ *after* costs (never more, modulo gaps).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from ..data.models import InstrumentSpec


@dataclass(frozen=True)
class SizingResult:
    ok: bool
    reason: str
    side: int = 0
    contracts: float = 0.0
    qty: float = 0.0                 # base units
    entry_price: float = 0.0
    stop_price: float = 0.0
    notional: float = 0.0
    implied_leverage: float = 0.0    # notional / equity
    margin: float = 0.0              # isolated margin at margin_leverage
    liquidation_price: float = 0.0
    risk_amount: float = 0.0         # target risk $
    expected_loss_at_stop: float = 0.0  # incl. fees + stop slippage, after lot rounding

    def to_dict(self) -> dict:
        return asdict(self)


def liquidation_price(entry: float, side: int, leverage: float, mmr: float) -> float:
    """Isolated-margin liquidation estimate for a linear contract (ignores fees in margin)."""
    if side > 0:
        return entry * (1 - 1 / leverage + mmr)
    return entry * (1 + 1 / leverage - mmr)


def size_position(
    *,
    equity: float,
    risk_fraction: float,
    entry_price: float,
    stop_price: float,
    side: int,
    spec: InstrumentSpec,
    taker_fee: float,
    stop_slippage_bps: float = 0.0,
    max_leverage: float = 10.0,
    margin_leverage: float = 10.0,
    mmr: float = 0.005,
    liquidation_buffer: float = 0.25,
    available_margin: float | None = None,
) -> SizingResult:
    if side not in (1, -1):
        return SizingResult(False, "invalid side")
    if equity <= 0:
        return SizingResult(False, "non-positive equity")
    if entry_price <= 0 or stop_price <= 0:
        return SizingResult(False, "non-positive price")
    stop_dist = (entry_price - stop_price) * side
    if stop_dist <= 0:
        return SizingResult(False, "stop on wrong side of entry")
    risk_amount = equity * risk_fraction
    stop_fill = stop_price - side * stop_price * stop_slippage_bps / 1e4
    per_unit_loss = abs(entry_price - stop_fill) + entry_price * taker_fee + stop_fill * taker_fee
    qty = risk_amount / per_unit_loss

    lev_eff = min(margin_leverage, spec.max_leverage)
    # leverage cap: notional / equity <= max_leverage
    max_qty_lev = equity * min(max_leverage, spec.max_leverage) / entry_price
    capped = ""
    if qty > max_qty_lev:
        qty, capped = max_qty_lev, " (capped by max_leverage)"
    if available_margin is not None:
        max_qty_margin = max(0.0, available_margin) * lev_eff / entry_price
        if qty > max_qty_margin:
            qty, capped = max_qty_margin, " (capped by available margin)"
    if spec.max_market_size:
        qty = min(qty, spec.contracts_to_base(spec.max_market_size))

    contracts = spec.floor_contracts(spec.base_to_contracts(qty))
    if contracts < spec.min_size - 1e-12 or contracts <= 0:
        need = spec.contracts_to_base(spec.min_size) * per_unit_loss
        return SizingResult(False, f"below exchange min size: min lot risks ${need:.2f} vs budget ${risk_amount:.2f}"
                            f"{capped}", side=side, risk_amount=risk_amount, entry_price=entry_price,
                            stop_price=stop_price)
    qty = spec.contracts_to_base(contracts)
    notional = qty * entry_price
    if spec.min_notional and notional < spec.min_notional:
        return SizingResult(False, f"notional {notional:.2f} below exchange min {spec.min_notional}", side=side)
    liq = liquidation_price(entry_price, side, lev_eff, mmr)
    liq_dist = abs(entry_price - liq)
    if stop_dist > liq_dist * (1 - liquidation_buffer):
        return SizingResult(False, f"stop {stop_price:.6g} too close to/beyond liquidation {liq:.6g} at {lev_eff:g}x",
                            side=side, entry_price=entry_price, stop_price=stop_price, liquidation_price=liq)
    return SizingResult(
        ok=True, reason="ok" + capped, side=side, contracts=contracts, qty=qty, entry_price=entry_price,
        stop_price=stop_price, notional=notional, implied_leverage=notional / equity, margin=notional / lev_eff,
        liquidation_price=liq, risk_amount=risk_amount, expected_loss_at_stop=qty * per_unit_loss,
    )
