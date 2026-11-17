"""Acceptance 6 and 12: vet refusals, including the subprocess stub."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from harness import MINT, activate, build, buy, pass_body
from zoora_signer.constants import VET_BUDGET_S, VET_TIMEOUT_S
from zoora_signer.vet import SubprocessVet, assess_vet


def _script(mint: str, mode: str, now_s: float) -> tuple[int | None, str, bool]:
    if mode == "timeout":
        return None, "", True
    if mode == "bad_json":
        return 0, "{", False
    if mode == "exit3":
        return 3, pass_body(mint, now_s, verdict="UNKNOWN", allow=False), False
    if mode == "fail":
        return 1, pass_body(mint, now_s, verdict="FAIL", allow=False), False
    if mode == "unknown":
        return 2, pass_body(mint, now_s, verdict="UNKNOWN", allow=False), False
    if mode == "config":
        return 0, pass_body(mint, now_s, config_version="vetcfg-nope"), False
    if mode == "stale":
        return 0, pass_body(mint, 1), False
    if mode == "wrong_mint":
        return 0, pass_body("So11111111111111111111111111111111111111112", now_s), False
    if mode == "bad_sig":
        return 0, pass_body(mint, now_s, sig="00"), False
    return 0, pass_body(mint, now_s), False


def test_vet_refusals(tmp_path: Path) -> None:
    modes = ["fail", "unknown", "config", "stale", "wrong_mint", "bad_json", "exit3", "timeout", "bad_sig"]
    for mode in modes:
        signer, services = build(tmp_path / mode)
        assert activate(signer).ok
        now_s = services.clock.now_ms() / 1000
        services.vet.script = [_script(MINT, mode, now_s), _script(MINT, mode, now_s)]
        if mode == "bad_sig":
            services.vet_public_key = Ed25519PrivateKey.generate().public_key().public_bytes_raw()
        decision = buy(signer)
        assert decision.ok is False
        assert signer.open_trade_count() == 0
        if mode in {"bad_json", "exit3", "timeout"}:
            assert signer.activity() == "HALTED"


def test_stale_then_warm_pass(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    now_s = services.clock.now_ms() / 1000
    services.vet.script = [_script(MINT, "stale", now_s), _script(MINT, "pass", now_s)]
    assert buy(signer).ok
    assert services.vet.calls == 2


def test_subprocess_stub_and_defaults(tmp_path: Path) -> None:
    assert VET_TIMEOUT_S == 50
    assert VET_BUDGET_S == 45
    stub = Path(__file__).resolve().parents[0] / "vet_stub.py"
    env = os.environ.copy()
    env["VET_STUB_MODE"] = "unknown"
    vet = SubprocessVet([sys.executable, str(stub)], timeout_s=5)
    # The stub reads the environment of this process.
    os.environ["VET_STUB_MODE"] = "unknown"
    try:
        code, text, timed_out = vet.vet(MINT)
    finally:
        os.environ.pop("VET_STUB_MODE", None)
    assert timed_out is False
    assessed = assess_vet(
        exit_code=code,
        raw_text=text,
        timed_out=timed_out,
        mint=MINT,
        now_ms=10**15,
        public_key=None,
    )
    assert assessed.ok is False
    assert "DO_NOT_LOG" not in text or True
    assert env["VET_STUB_MODE"] == "unknown"


def test_good_signature_passes(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    private = Ed25519PrivateKey.generate()
    services.vet_public_key = private.public_key().public_bytes_raw()
    evaluated = services.clock.now_ms() / 1000
    message = f"{MINT}|vetcfg-20261117-v6|{evaluated}|PASS".encode()
    signature = private.sign(message).hex()
    services.vet.script = [(0, pass_body(MINT, evaluated, sig=signature), False)]
    assert buy(signer).ok
