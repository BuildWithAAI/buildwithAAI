"""Cap predicate shared by the reservation transaction and the fuzzer."""

from __future__ import annotations

from dataclasses import dataclass

from zoora_signer.constants import (
    BUYS_PER_DAY,
    DAILY_LOSS_CAP_CENTS,
    EXPOSURE_CAP_CENTS,
    INTENTS_PER_HOUR,
    OPEN_TRADE_CAP,
    SLIPPAGE_CAP_BPS,
    STAKE_CAP_CENTS,
    WALLET_CAP_CENTS,
)


@dataclass(frozen=True)
class CapView:
    open_slots: int
    buys_today: int
    daily_loss_cents: int
    reserved_loss_cents: int
    exposure_cents: int
    wallet_cents: int
    intents_this_hour: int
    activity: str
    buy_halt: str | None
    buys_last_10_min: int = 0
    unknown_mark: bool = False


@dataclass(frozen=True)
class CapResult:
    accept: bool
    code: str
    halt: bool
    buy_halt: str | None


def evaluate_buy(view: CapView, stake_cents: int, slippage_bps: int) -> CapResult:
    if view.activity == "HALTED":
        return CapResult(False, "KILL_HOLD", False, view.buy_halt)
    if view.activity != "ACTIVE":
        return CapResult(False, "PAUSED", False, view.buy_halt)
    if view.buy_halt:
        return CapResult(False, "BUY_HALT", False, view.buy_halt)
    if view.unknown_mark:
        return CapResult(False, "UNKNOWN_MARK", False, view.buy_halt)
    if stake_cents <= 0:
        return CapResult(False, "STAKE", False, view.buy_halt)
    if stake_cents > STAKE_CAP_CENTS:
        return CapResult(False, "STAKE", False, view.buy_halt)
    if slippage_bps > SLIPPAGE_CAP_BPS:
        return CapResult(False, "SLIPPAGE", False, view.buy_halt)
    if view.buys_last_10_min >= 1:
        return CapResult(False, "RATE_LIMIT", False, view.buy_halt)
    if view.intents_this_hour >= INTENTS_PER_HOUR:
        return CapResult(False, "RATE_LIMIT", False, view.buy_halt)
    if view.open_slots > OPEN_TRADE_CAP or view.buys_today > BUYS_PER_DAY:
        return CapResult(False, "LEDGER_BREACH", True, view.buy_halt)
    if view.open_slots + 1 > OPEN_TRADE_CAP:
        return CapResult(False, "OPEN_TRADES", False, view.buy_halt)
    if view.buys_today + 1 > BUYS_PER_DAY:
        return CapResult(False, "BUYS_DAY", False, view.buy_halt)
    if view.daily_loss_cents >= DAILY_LOSS_CAP_CENTS:
        return CapResult(False, "DAILY_LOSS", False, "daily_loss")
    worst = view.daily_loss_cents + view.reserved_loss_cents + stake_cents
    if worst > DAILY_LOSS_CAP_CENTS:
        return CapResult(False, "DAILY_LOSS", False, view.buy_halt)
    if view.exposure_cents + stake_cents > EXPOSURE_CAP_CENTS:
        return CapResult(False, "EXPOSURE", False, view.buy_halt)
    if view.wallet_cents > WALLET_CAP_CENTS:
        return CapResult(False, "WALLET", False, "wallet")
    return CapResult(True, "OK", False, None)


def evaluate_sell(view: CapView, *, owner: bool) -> CapResult:
    if view.activity == "HALTED":
        if owner:
            return CapResult(True, "OWNER_SELL", False, view.buy_halt)
        return CapResult(False, "KILL_HOLD", False, view.buy_halt)
    if view.activity != "ACTIVE" and not owner:
        return CapResult(False, "PAUSED", False, view.buy_halt)
    return CapResult(True, "OK", False, view.buy_halt)
