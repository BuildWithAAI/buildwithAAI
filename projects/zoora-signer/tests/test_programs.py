"""Program ids match the 2026-11-17 on-chain read and the official docs."""

from __future__ import annotations

import json
from pathlib import Path

from zoora_signer.constants import (
    OBSERVED_CURVE_FEE_BPS,
    PUMP_GLOBAL,
    PUMP_PROGRAM,
    PUMP_SWAP,
    PUMP_SWAP_GLOBAL,
    README_EXAMPLE_FEE_BPS,
    SPL_TOKEN,
    TOKEN_2022,
)
from zoora_signer.quote import decode_global_fee_bps, tokens_out


def test_pinned_ids_match_the_fixture() -> None:
    path = Path(__file__).resolve().parents[1] / "fixtures" / "program_accounts.json"
    fixture = json.loads(path.read_text(encoding="utf-8"))
    assert fixture["verified_on"] == "2026-11-17"
    by_key = {row["pubkey"]: row for row in fixture["accounts"]}
    assert by_key[PUMP_PROGRAM]["executable"] is True
    assert by_key[PUMP_PROGRAM]["owner"].startswith("BPFLoaderUpgradeab1e")
    assert by_key[PUMP_SWAP]["executable"] is True
    assert by_key[TOKEN_2022]["executable"] is True
    assert by_key[SPL_TOKEN]["executable"] is True
    assert by_key[PUMP_GLOBAL]["owner"] == PUMP_PROGRAM
    assert by_key[PUMP_SWAP_GLOBAL]["owner"] == PUMP_SWAP
    prefix = (Path(__file__).resolve().parents[1] / "fixtures" / "pump_global_prefix.bin").read_bytes()
    assert decode_global_fee_bps(prefix) == OBSERVED_CURVE_FEE_BPS
    assert OBSERVED_CURVE_FEE_BPS != README_EXAMPLE_FEE_BPS


def test_missing_fee_fails_closed() -> None:
    assert tokens_out(1_000_000, 30_000_000_000, 1_073_000_000_000_000, None) is None
    with_fee = tokens_out(1_000_000, 30_000_000_000, 1_073_000_000_000_000, 95)
    documented = tokens_out(1_000_000, 30_000_000_000, 1_073_000_000_000_000, 100)
    assert with_fee is not None and documented is not None
    assert with_fee != documented


def test_package_does_not_submit() -> None:
    root = Path(__file__).resolve().parents[1] / "src" / "zoora_signer"
    text = "\n".join(path.read_text(encoding="utf-8") for path in root.glob("*.py"))
    assert "sendTransaction" not in text
    assert "send_transaction" not in text
