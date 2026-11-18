"""Spawn entrypoint for the multi-process cap test. Imports stay inside the child."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))


def child(db: str) -> str:
    from harness import FakeChain, FakeClock, FakeKill, FakeOracle, FakeProbe, FakeVet, ScriptedFeed, ScriptedMarks, buy
    from zoora_signer.secrets import MemorySecretStore
    from zoora_signer.signer import RefuseBroadcaster, Services, Signer
    from zoora_signer.signing import throwaway_secret

    path = Path(db)
    clock = FakeClock()
    secrets = MemorySecretStore()
    secrets.hmac_key = b"k" * 32
    secrets.event_hmac = b"e" * 32
    secrets.signing_key = throwaway_secret()
    secrets.rpc_url = "https://example.invalid/rpc?api-key=not-a-real-key"
    services = Services(
        db_path=path,
        secrets=secrets,
        oracle=FakeOracle(),
        vet=FakeVet(clock),
        clock=clock,
        chain=FakeChain(),
        marks=ScriptedMarks(),
        kill=FakeKill(),
        probe=FakeProbe(),
        broadcaster=RefuseBroadcaster(),
        hud_path=path.with_suffix(".hud.jsonl"),
        feed=ScriptedFeed(),
    )
    signer = Signer.attach(services)
    return buy(signer).code
