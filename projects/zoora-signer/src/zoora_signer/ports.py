"""Ports. Production adapters and tests both implement these."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Protocol

from zoora_signer.models import OracleReading


class BroadcasterKind(Enum):
    """REFUSE is the only kind in this build. LIVE belongs to the broadcaster PR."""

    REFUSE = "refuse"
    LIVE = "live"


class Clock(Protocol):
    def now_ms(self) -> int: ...


class Oracle(Protocol):
    def quote(self, now_ms: int) -> OracleReading: ...


class MarkSource(Protocol):
    def mark_cents(self, mint: str, tokens: int, cost_cents: int, recovered_cents: int) -> int | None: ...


class ChainView(Protocol):
    authoritative: bool

    def sol_lamports(self) -> int: ...

    def signature_status(self, signature: str) -> str: ...

    def fee_bps(self) -> int | None: ...


class KillSwitch(Protocol):
    def poll(self) -> str: ...


class OsProbe(Protocol):
    def clocks(self) -> tuple[int, int]: ...

    def time_skew_ms(self) -> int | None: ...

    def defender_active(self) -> bool: ...

    def elevated_or_admin(self) -> bool: ...

    def acl_owner_only(self) -> bool: ...

    def consume_power_event(self) -> bool: ...


class SecretStore(Protocol):
    def get_signing_key(self) -> bytes | None: ...

    def wallet_pubkey(self) -> str | None: ...

    def get_hmac_key(self) -> bytes | None: ...

    def set_hmac_key(self, key: bytes) -> None: ...

    def get_event_hmac(self) -> bytes | None: ...

    def set_event_hmac(self, key: bytes) -> None: ...

    def get_rpc_url(self) -> str | None: ...

    def has_signing_key(self) -> bool: ...


class Broadcaster(Protocol):
    kind: BroadcasterKind
    enabled: bool

    def submit(self, payload: bytes) -> None: ...


@dataclass(frozen=True)
class PullBatch:
    unreachable: bool
    intents: list[tuple[bytes, str]]


class IntentFeed(Protocol):
    def pull(self, after: str | None) -> PullBatch: ...

    def push_events(self, events: list[dict[str, object]]) -> None: ...


class VetClient(Protocol):
    def vet(self, mint: str) -> tuple[int | None, str, bool]: ...
