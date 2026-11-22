"""Acceptance 8: property test of the cap invariants."""

from __future__ import annotations

from dataclasses import dataclass

from hypothesis import given, settings
from hypothesis import strategies as st

from zoora_signer.caps import CapView, evaluate_buy
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


@dataclass
class Book:
    open_slots: int = 0
    buys: int = 0
    loss: int = 0
    exposure: int = 0
    wallet: int = 1_000
    hits: int = 0


def _view(book: Book) -> CapView:
    return CapView(
        open_slots=book.open_slots,
        buys_today=book.buys,
        daily_loss_cents=book.loss,
        reserved_loss_cents=0,
        exposure_cents=book.exposure,
        wallet_cents=book.wallet,
        intents_this_hour=book.hits,
        activity="ACTIVE",
        buy_halt=None,
    )


@given(
    stakes=st.lists(st.integers(min_value=1, max_value=400), min_size=1, max_size=30),
    slippages=st.lists(st.integers(min_value=0, max_value=3_000), min_size=1, max_size=30),
)
@settings(max_examples=80)
def test_cap_invariants(stakes: list[int], slippages: list[int]) -> None:
    book = Book()
    for stake, slippage in zip(stakes, slippages, strict=False):
        result = evaluate_buy(_view(book), stake, slippage)
        if result.accept:
            assert stake <= STAKE_CAP_CENTS
            assert slippage <= SLIPPAGE_CAP_BPS
            assert book.open_slots + 1 <= OPEN_TRADE_CAP
            assert book.buys + 1 <= BUYS_PER_DAY
            assert book.loss + stake <= DAILY_LOSS_CAP_CENTS
            assert book.exposure + stake <= EXPOSURE_CAP_CENTS
            assert book.wallet <= WALLET_CAP_CENTS
            assert book.hits < INTENTS_PER_HOUR
            book.open_slots += 1
            book.buys += 1
            book.exposure += stake
            book.hits += 1
            if book.open_slots == OPEN_TRADE_CAP:
                book.open_slots = 0
                book.exposure = 0
        else:
            assert result.code in {
                "STAKE",
                "SLIPPAGE",
                "OPEN_TRADES",
                "BUYS_DAY",
                "DAILY_LOSS",
                "EXPOSURE",
                "WALLET",
                "RATE_LIMIT",
                "PAUSED",
                "KILL_HOLD",
                "BUY_HALT",
                "LEDGER_BREACH",
            }
        assert book.open_slots <= OPEN_TRADE_CAP
        assert book.buys <= BUYS_PER_DAY
        assert book.exposure <= EXPOSURE_CAP_CENTS
