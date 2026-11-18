"""Unsigned v3 and PumpSwap builders. No signing and no broadcast."""

from __future__ import annotations

import base64
import json
import struct
from pathlib import Path

import pytest
from solders.transaction import VersionedTransaction

from zoora_signer.constants import (
    BUY_V3_DISCRIMINATOR,
    CU_LIMIT,
    PRIORITY_MICRO_LAMPORTS,
    PUMP_PROGRAM,
    PUMP_SWAP,
    PUMPSWAP_BUY_V2_DISCRIMINATOR,
    SELL_V3_DISCRIMINATOR,
    SPL_TOKEN,
    TOKEN_2022,
    TOKEN_2022_ATA_RENT_LAMPORTS,
)
from zoora_signer.message_policy import PolicyError, validate_transaction
from zoora_signer.quote import lamports_for_micro, micro_for_lamports
from zoora_signer.txbuild import (
    BuildError,
    BuiltTx,
    PlaceholderBuilder,
    build_curve_buy,
    build_curve_sell,
    build_pumpswap_buy,
    build_pumpswap_sell,
    build_sweep,
)

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / "fixtures" / "e2e_curve.json").read_text(encoding="utf-8"))
ORDER = FIXTURE["accounts_in_order"]
MINT = ORDER[1]
USER = ORDER[8]
BUYBACK = ORDER[13]
CURVE = base64.b64decode(FIXTURE["accounts"][ORDER[5]]["data"])
FEE = base64.b64decode(FIXTURE["accounts"][ORDER[12]]["data"])
MINT_DATA = base64.b64decode(FIXTURE["accounts"][MINT]["data"])
PRICE = 100_000  # $1000/SOL, so one lamport is one micro-USD


def _buy(**overrides: object) -> BuiltTx:
    args: dict[str, object] = {
        "user": USER,
        "mint_address": MINT,
        "mint_data": MINT_DATA,
        "mint_owner": TOKEN_2022,
        "curve_data": CURVE,
        "fee_config_data": FEE,
        "buyback_fee_recipient": BUYBACK,
        "sol_usd_cents": PRICE,
        "stake_cents": 200,
        "slippage_bps": 0,
        "ata_rent_lamports": 0,
        "create_base_ata": False,
        "curve_lamports": int(FIXTURE["accounts"][ORDER[5]]["lamports"]),
        "volume_exists": False,
    }
    args.update(overrides)
    return build_curve_buy(**args)  # type: ignore[arg-type]


def test_curve_buy_accounts_data_and_cap() -> None:
    built = _buy()
    assert built.data[:8] == BUY_V3_DISCRIMINATOR
    assert built.accounts[0] == "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
    assert built.accounts[5] == ORDER[5]
    assert built.accounts[6] == ORDER[6]
    assert built.accounts[8] == USER
    assert built.accounts[12] == ORDER[12]
    assert built.accounts[13] == BUYBACK
    assert built.accounts[14] == "11111111111111111111111111111111"
    assert built.accounts[16] == PUMP_PROGRAM
    assert built.accounts[15] == ORDER[15]
    assert len(built.accounts) == 17
    assert built.protocol_fee_bps == 95
    assert built.creator_fee_bps == 30
    assert built.decimals == MINT_DATA[44]
    assert built.token_program == TOKEN_2022
    tokens, limit = struct.unpack_from("<QQ", built.data, 8)
    assert tokens == built.token_amount
    assert limit == built.limit_lamports
    cap = lamports_for_micro(2_000_000, PRICE)
    assert cap == 2_000_000
    assert built.all_in_lamports == cap
    assert micro_for_lamports(built.all_in_lamports, PRICE) == 2_000_000
    assert micro_for_lamports(built.all_in_lamports + 1, PRICE) == 2_000_001
    message = VersionedTransaction.from_bytes(built.raw).message
    assert list(message.address_table_lookups) == []
    validate_transaction(
        built.raw,
        owner=str(USER),
        mint=str(MINT),
        max_all_in_lamports=built.all_in_lamports,
        expected_token_amount=built.token_amount,
        expected_limit_lamports=built.limit_lamports,
        rent_lamports=built.rent_lamports,
    )
    # SetComputeUnitPrice is micro-lamports per CU, not a lamport total.
    assert PRIORITY_MICRO_LAMPORTS == 1_000
    assert CU_LIMIT == 200_000


def test_slippage_and_rent_round_down() -> None:
    built = _buy(
        slippage_bps=1500,
        create_base_ata=True,
        ata_rent_lamports=TOKEN_2022_ATA_RENT_LAMPORTS,
        volume_exists=True,
    )
    assert built.limit_lamports == built.quote_lamports * 11_500 // 10_000
    assert built.all_in_lamports <= lamports_for_micro(2_000_000, PRICE)
    assert micro_for_lamports(built.all_in_lamports, PRICE) <= 2_000_000
    with pytest.raises(BuildError, match="CAP"):
        _buy(create_base_ata=True, ata_rent_lamports=lamports_for_micro(2_000_000, PRICE))


def test_sell_min_sol_and_decimals() -> None:
    sold = build_curve_sell(
        user=USER,
        mint_address=MINT,
        mint_data=MINT_DATA,
        mint_owner=TOKEN_2022,
        curve_data=CURVE,
        fee_config_data=FEE,
        buyback_fee_recipient=BUYBACK,
        token_in=10_000_000_000_000,
        slippage_bps=1500,
    )
    assert sold.data[:8] == SELL_V3_DISCRIMINATOR
    _tokens, minimum = struct.unpack_from("<QQ", sold.data, 8)
    assert minimum == sold.quote_lamports * 8_500 // 10_000
    assert sold.limit_lamports == minimum
    validate_transaction(
        sold.raw,
        owner=str(USER),
        mint=str(MINT),
        expected_token_amount=sold.token_amount,
        expected_limit_lamports=sold.limit_lamports,
    )
    spl = bytearray(82)
    spl[44] = 9
    spl[45] = 1
    other = _buy(mint_data=bytes(spl), mint_owner=SPL_TOKEN, create_base_ata=False)
    assert other.decimals == 9
    assert other.token_program == SPL_TOKEN
    assert other.accounts[3] == SPL_TOKEN
    assert _buy().accounts[3] == TOKEN_2022
    assert other.token_amount == _buy().token_amount


def test_missing_fee_and_slippage_fail_closed() -> None:
    with pytest.raises(BuildError, match="FEE"):
        _buy(fee_config_data=b"\x00" * 80)
    with pytest.raises(BuildError, match="SLIPPAGE"):
        _buy(slippage_bps=1501)
    with pytest.raises(PlaceholderBuilder):
        build_sweep(payer=USER, dest=BUYBACK, lamports=1, whitelist=set())


def test_pumpswap_builder_matches_the_v2_idl() -> None:
    from solders.pubkey import Pubkey

    from zoora_signer.constants import SPL_TOKEN, WSOL_MINT
    from zoora_signer.txbuild import _ata

    pool_key = Pubkey.new_unique()
    pool = str(pool_key)
    user_key = Pubkey.from_string(str(USER))
    base = Pubkey.from_string(str(MINT))
    quote = Pubkey.from_string(WSOL_MINT)
    base_program = Pubkey.from_string(TOKEN_2022)
    quote_program = Pubkey.from_string(SPL_TOKEN)
    user_base = str(_ata(user_key, base_program, base))
    user_quote = str(_ata(user_key, quote_program, quote))
    pool_base = str(_ata(pool_key, base_program, base))
    pool_quote = str(_ata(pool_key, quote_program, quote))
    built = build_pumpswap_buy(
        user=USER,
        pool=pool,
        base_mint=MINT,
        quote_mint="So11111111111111111111111111111111111111112",
        base_reserve=1_000_000_000_000,
        quote_reserve=50_000_000_000,
        mint_supply=1_000_000_000_000_000,
        mint_data=MINT_DATA,
        mint_owner=TOKEN_2022,
        fee_config_data=FEE,
        pool_base_token_account=pool_base,
        pool_quote_token_account=pool_quote,
        user_base_token_account=user_base,
        user_quote_token_account=user_quote,
        buyback_fee_recipient=user_quote,
        sol_usd_cents=PRICE,
        stake_cents=200,
        slippage_bps=0,
        is_pump_pool=True,
    )
    assert built.data[:8] == PUMPSWAP_BUY_V2_DISCRIMINATOR
    assert built.accounts[2] == "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw"
    assert built.accounts[16] == PUMP_SWAP
    assert len(built.accounts) == 17
    assert built.protocol_fee_bps == 95 and built.creator_fee_bps == 30
    with pytest.raises(PolicyError, match="PUMPSWAP_DISABLED"):
        validate_transaction(
            built.raw,
            owner=str(USER),
            mint=str(MINT),
            max_all_in_lamports=built.all_in_lamports,
            expected_token_amount=built.token_amount,
            expected_limit_lamports=built.limit_lamports,
            rent_lamports=built.rent_lamports,
        )
    validate_transaction(
        built.raw,
        owner=str(USER),
        mint=str(MINT),
        max_all_in_lamports=built.all_in_lamports,
        expected_token_amount=built.token_amount,
        expected_limit_lamports=built.limit_lamports,
        rent_lamports=built.rent_lamports,
        allow_pumpswap=True,
    )
    sold = build_pumpswap_sell(
        user=USER,
        pool=pool,
        base_mint=MINT,
        quote_mint="So11111111111111111111111111111111111111112",
        base_reserve=1_000_000_000_000,
        quote_reserve=50_000_000_000,
        mint_supply=1_000_000_000_000_000,
        mint_data=MINT_DATA,
        mint_owner=TOKEN_2022,
        fee_config_data=FEE,
        pool_base_token_account=pool_base,
        pool_quote_token_account=pool_quote,
        user_base_token_account=user_base,
        user_quote_token_account=user_quote,
        buyback_fee_recipient=user_quote,
        token_in=1_000_000,
        slippage_bps=1500,
    )
    validate_transaction(
        sold.raw,
        owner=str(USER),
        mint=str(MINT),
        expected_token_amount=sold.token_amount,
        expected_limit_lamports=sold.limit_lamports,
        allow_pumpswap=True,
    )


def test_live_settle_does_not_fetch_the_signing_key(tmp_path: Path) -> None:
    from harness import activate, build, buy

    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    assert signer.set_mode("LIVE").ok
    calls = {"n": 0}
    original = services.secrets.get_signing_key

    def wrapped() -> bytes | None:
        calls["n"] += 1
        return original()

    services.secrets.get_signing_key = wrapped  # type: ignore[method-assign]
    assert buy(signer).code == "SIGN_REFUSED"
    assert calls["n"] == 0
