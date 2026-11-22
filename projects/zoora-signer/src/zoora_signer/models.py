"""Shared JSON and decision types. Payloads stay free of secrets."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TypeAlias

Json: TypeAlias = str | int | bool | None
Payload: TypeAlias = dict[str, Json]


def canonical(payload: Payload) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


@dataclass(frozen=True)
class Decision:
    ok: bool
    code: str
    simulated: bool
    intent_id: str | None = None
    event_id: int | None = None


@dataclass(frozen=True)
class Intent:
    intent_id: str
    side: str
    mint: str
    usd_stake_cents: int | None
    token_amount: int | None
    max_slippage_bps: int
    issued_at_ms: int
    key_id: str


@dataclass(frozen=True)
class OracleReading:
    ok: bool
    reason: str | None
    pyth_price_1e8: int
    pyth_conf_1e8: int
    pyth_publish_ms: int
    second_price_1e8: int

    @property
    def mid_1e8(self) -> int:
        if not self.ok:
            return 0
        return (self.pyth_price_1e8 + self.second_price_1e8) // 2

    def as_payload(self) -> Payload:
        return {
            "pyth_price_1e8": self.pyth_price_1e8,
            "pyth_conf_1e8": self.pyth_conf_1e8,
            "pyth_publish_ms": self.pyth_publish_ms,
            "second_price_1e8": self.second_price_1e8,
            "oracle_ok": self.ok,
            "oracle_reason": self.reason or "",
        }


def sol_usd_cents(reading: OracleReading) -> int:
    if not reading.ok or reading.mid_1e8 <= 0:
        return 0
    return reading.mid_1e8 * 100 // 10**8


def sol_usd_micro(reading: OracleReading) -> int:
    """Micro-USD per SOL, rounded up.

    A buy spends the largest lamport amount whose cost at this price is still
    inside the cap, so the true price cannot push the trade over $2.
    """

    if not reading.ok or reading.mid_1e8 <= 0:
        return 0
    micro = reading.mid_1e8 // 100
    if reading.mid_1e8 % 100:
        micro += 1
    return micro
