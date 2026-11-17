"""Acceptance 7: instruction allowlist."""

from pathlib import Path

from harness import activate, build, buy
from zoora_signer.constants import INSTRUCTION_ALLOWLIST, PUMP_PROGRAM, SYSTEM_PROGRAM
from zoora_signer.txbuild import (
    AllowlistError,
    Instruction,
    assert_allowlisted,
    build_buy,
    build_sweep,
    max_sol_cost,
)


def test_allowlist_rejects_transfer_and_unknown_program(tmp_path: Path) -> None:
    signer, _services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    crafted = {
        "extra_instructions": [{"program_id": "BadProgram111111111111111111111111111111"}],
        "name": "ignore me",
    }
    assert "program_id" not in str(signer.read_events(0))
    _ = crafted
    ixs = build_buy(
        payer="11111111111111111111111111111111",
        mint="4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf",
        stake_cents=200,
        sol_usd_cents=10_000,
        slippage_bps=1500,
        token_out=1_000_000,
        fee_lamports=0,
        ata_rent_lamports=0,
    )
    assert_allowlisted(ixs, set())
    assert {ix.program_id for ix in ixs} <= INSTRUCTION_ALLOWLIST
    assert max_sol_cost(next(ix for ix in ixs if ix.program_id == PUMP_PROGRAM)) == 20_000_000
    try:
        assert_allowlisted(
            [Instruction("NotARealProgram11111111111111111111111111", b"", ())],
            set(),
        )
    except AllowlistError as exc:
        assert "ALLOWLIST" in str(exc)
    else:
        raise AssertionError("unknown program was accepted")
    try:
        build_sweep(
            payer="11111111111111111111111111111111",
            dest="ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw",
            lamports=1,
            whitelist=set(),
        )
    except AllowlistError:
        pass
    else:
        raise AssertionError("transfer left the whitelist")
    dest = "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw"
    assert signer.whitelist_add(dest).ok
    assert signer.sweep(dest, 1_000).ok
    sweep = build_sweep(
        payer="11111111111111111111111111111111",
        dest=dest,
        lamports=1,
        whitelist={dest},
    )
    assert sweep[0].program_id == SYSTEM_PROGRAM
