"""Shared fixtures for the acceptance tests. Keys exist only in memory."""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path

from zoora_signer.models import Decision, OracleReading
from zoora_signer.oracle import judge_oracle
from zoora_signer.ports import PullBatch
from zoora_signer.secrets import MemorySecretStore
from zoora_signer.signer import RefuseBroadcaster, Services, Signer, parse_intent
from zoora_signer.signing import throwaway_secret

MINT = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
MINT_B = "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw"
PRICE = 100 * 10**8


class FakeClock:
    def __init__(self, now: int = 1_763_400_000_000) -> None:
        self.now = now

    def now_ms(self) -> int:
        return self.now


class FakeOracle:
    def __init__(self) -> None:
        self.price = PRICE
        self.conf = 1
        self.age_ms = 0
        self.second = PRICE
        self.down = False

    def quote(self, now_ms: int) -> OracleReading:
        if self.down:
            return judge_oracle(
                pyth_price_1e8=None,
                pyth_conf_1e8=None,
                pyth_publish_ms=None,
                second_price_1e8=None,
                now_ms=now_ms,
            )
        return judge_oracle(
            pyth_price_1e8=self.price,
            pyth_conf_1e8=self.conf,
            pyth_publish_ms=now_ms - self.age_ms,
            second_price_1e8=self.second,
            now_ms=now_ms,
        )


class ScriptedMarks:
    def __init__(self) -> None:
        self.by_mint: dict[str, int | None] = {}

    def mark_cents(self, mint: str, tokens: int, cost_cents: int, recovered_cents: int) -> int | None:
        if mint in self.by_mint:
            return self.by_mint[mint]
        return cost_cents


class FakeChain:
    def __init__(self) -> None:
        self.authoritative = False
        self.sol = 100_000_000
        self.fee: int | None = 95
        self.sigs: dict[str, str] = {}

    def sol_lamports(self) -> int:
        return self.sol

    def signature_status(self, signature: str) -> str:
        return self.sigs.get(signature, "absent")

    def fee_bps(self) -> int | None:
        return self.fee


class FakeKill:
    def __init__(self) -> None:
        self.state = "clear"

    def poll(self) -> str:
        if self.state == "error":
            raise RuntimeError("unreachable")
        return self.state


class FakeProbe:
    def __init__(self) -> None:
        self.wall = 1_000
        self.mono = 1_000
        self.skew: int | None = 0
        self.defender = True
        self.elevated = False
        self.acl = True
        self.power = False

    def clocks(self) -> tuple[int, int]:
        return self.wall, self.mono

    def time_skew_ms(self) -> int | None:
        return self.skew

    def defender_active(self) -> bool:
        return self.defender

    def elevated_or_admin(self) -> bool:
        return self.elevated

    def acl_owner_only(self) -> bool:
        return self.acl

    def consume_power_event(self) -> bool:
        flag = self.power
        self.power = False
        return flag


class FakeVet:
    def __init__(self, clock: FakeClock) -> None:
        self.clock = clock
        self.script: list[tuple[int | None, str, bool]] = []
        self.calls = 0

    def vet(self, mint: str) -> tuple[int | None, str, bool]:
        self.calls += 1
        if self.script:
            return self.script.pop(0)
        body = {
            "schema": "vet/1",
            "mint": mint,
            "verdict": "PASS",
            "allow": True,
            "evaluated_at": self.clock.now_ms() / 1000,
            "config_version": "vetcfg-20261117-v6",
            "code_version": "test",
            "reasons": [],
        }
        return 0, json.dumps(body), False


class ScriptedFeed:
    def __init__(self) -> None:
        self.batch = PullBatch(False, [])
        self.pushed = 0

    def pull(self, after: str | None) -> PullBatch:
        return self.batch

    def push_events(self, events: list[dict[str, object]]) -> None:
        self.pushed += len(events)


def build(tmp: Path, **overrides: object) -> tuple[Signer, Services]:
    clock = FakeClock()
    secrets = MemorySecretStore()
    secrets.hmac_key = b"k" * 32
    secrets.signing_key = throwaway_secret()
    secrets.rpc_url = "https://example.invalid/rpc?api-key=not-a-real-key"
    tmp.mkdir(parents=True, exist_ok=True)
    services = Services(
        db_path=tmp / "signer.sqlite",
        secrets=secrets,
        oracle=FakeOracle(),
        vet=FakeVet(clock),
        clock=clock,
        chain=FakeChain(),
        marks=ScriptedMarks(),
        kill=FakeKill(),
        probe=FakeProbe(),
        broadcaster=RefuseBroadcaster(),
        hud_path=tmp / "hud.jsonl",
        feed=ScriptedFeed(),
    )
    for key, value in overrides.items():
        setattr(services, key, value)
    signer = Signer.open(services)
    return signer, services


def activate(signer: Signer) -> Decision:
    return signer.resume()


def buy(
    signer: Signer,
    cents: int = 200,
    slippage: int = 1500,
    mint: str = MINT,
    intent_id: str | None = None,
) -> Decision:
    import json

    from zoora_signer.constants import INTENT_PREFIX

    body = {
        "intent_id": intent_id or str(uuid.uuid4()),
        "issued_at_ms": signer.s.clock.now_ms(),
        "key_id": "1",
        "max_slippage_bps": slippage,
        "mint": mint,
        "side": "buy",
        "usd_stake_micro": cents * 10_000,
    }
    raw = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    key = signer.s.secrets.get_hmac_key()
    assert key is not None
    signature = __import__("hmac").new(key, INTENT_PREFIX + raw, __import__("hashlib").sha256).hexdigest()
    return signer.handle_intent(raw, signature)


def sell(signer: Signer, mint: str = MINT, tokens: int | None = None) -> Decision:
    raw_body = {
        "intent_id": str(uuid.uuid4()),
        "issued_at_ms": signer.s.clock.now_ms(),
        "key_id": "1",
        "max_slippage_bps": 1500,
        "mint": mint,
        "side": "sell",
    }
    if tokens is not None:
        raw_body["token_amount"] = tokens
    raw = json.dumps(raw_body, sort_keys=True, separators=(",", ":")).encode()
    key = signer.s.secrets.get_hmac_key()
    assert key is not None
    from zoora_signer.constants import INTENT_PREFIX

    signature = __import__("hmac").new(key, INTENT_PREFIX + raw, __import__("hashlib").sha256).hexdigest()
    return signer.handle_intent(raw, signature)


def set_ledger(signer: Signer, lamports: int) -> None:
    import sqlite3

    conn = sqlite3.connect(signer.path)
    conn.execute("UPDATE signer_state SET ledger_sol_lamports = ?", (lamports,))
    conn.commit()
    conn.close()
    record_state(signer)


def record_state(signer: Signer) -> None:
    """Record a fixture edit so the next intent sees a matching state digest."""
    from zoora_signer.db import transact
    from zoora_signer.signer import _state_digest

    def op(conn: sqlite3.Connection) -> None:
        signer._event(conn, "fixture_state", {"state_sha256": _state_digest(conn)})

    transact(signer.path, op)


def pass_body(mint: str, evaluated_s: float, **extra: object) -> str:
    body: dict[str, object] = {
        "schema": "vet/1",
        "mint": mint,
        "verdict": "PASS",
        "allow": True,
        "evaluated_at": evaluated_s,
        "config_version": "vetcfg-20261117-v6",
        "code_version": "test",
        "reasons": [],
    }
    body.update(extra)
    return json.dumps(body)


def parsed_intent_roundtrip() -> None:
    raw = {
        "intent_id": "x",
        "side": "buy",
        "mint": MINT,
        "usd_stake_cents": 200,
        "max_slippage_bps": 1,
        "issued_at_ms": 1,
    }
    assert parse_intent(raw) is not None
