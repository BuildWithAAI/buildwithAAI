"""Unsigned buy and sell builders. This module does not sign and does not broadcast.

Bonding-curve trades use buy_v3 and sell_v3 from idl/pump.json at the pinned docs
commit. Those are the current 17-account trades. buy_v2 and sell_v2 are still in
the IDL; v3 is the instruction TRADE_V3.md tells callers to use, and it is the
one the local validator rehearsal executes. PumpSwap uses buy_v2 and sell_v2
from idl/pump_amm.json, also 17 accounts. v3 keeps protocol and creator fees on
the curve, so the creator vault is not an account. The fee config and the user
volume accumulator are required.

The returned transaction is a v0 message with no address lookup tables. Its
signature slot is the default empty signature. Nothing here calls a signer.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

from solders.hash import Hash
from solders.instruction import AccountMeta
from solders.instruction import Instruction as SoldersInstruction
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import VersionedTransaction

from zoora_signer.constants import (
    ASSOCIATED_TOKEN,
    BUY_V3_DISCRIMINATOR,
    COMPUTE_BUDGET,
    CU_LIMIT,
    FEE_PROGRAM,
    PRIORITY_MICRO_LAMPORTS,
    PUMP_PROGRAM,
    PUMP_SWAP,
    PUMPSWAP_BUY_V2_DISCRIMINATOR,
    PUMPSWAP_SELL_V2_DISCRIMINATOR,
    SELL_V3_DISCRIMINATOR,
    SIGNATURE_FEE_LAMPORTS,
    SLIPPAGE_CAP_BPS,
    STAKE_CAP_CENTS,
    SYSTEM_PROGRAM,
    TOKEN_2022_ATA_RENT_LAMPORTS,
    USD_CAP_MICRO,
    USER_VOLUME_ACCOUNT_BYTES,
    WSOL_MINT,
)
from zoora_signer.quote import (
    decode_bonding_curve,
    fee_lamports,
    lamports_for_micro,
    lamports_for_micro_price,
    micro_cost_ceil,
    micro_for_lamports,
    net_sol_from_inclusive,
    parse_fee_bps,
    parse_mint,
    priority_fee_lamports,
    rent_exempt_lamports,
    sol_for_tokens,
    tokens_for_net_sol,
)

_ZERO = bytes(32)


class AllowlistError(ValueError):
    pass


class BuildError(AllowlistError):
    pass


class PlaceholderBuilder(AllowlistError):
    """Sweeps move SOL with a system transfer, which the allowlist rejects."""


@dataclass(frozen=True)
class BuiltTx:
    raw: bytes
    accounts: tuple[str, ...]
    data: bytes
    token_amount: int
    quote_lamports: int
    limit_lamports: int
    all_in_lamports: int
    decimals: int
    token_program: str
    protocol_fee_bps: int
    creator_fee_bps: int
    priority_micro_lamports: int
    rent_lamports: int = 0


def assert_allowlisted(raw: bytes, **checks: object) -> None:
    from zoora_signer.message_policy import PolicyError, validate_transaction

    try:
        validate_transaction(raw, **checks)  # type: ignore[arg-type]
    except PolicyError as exc:
        raise BuildError(str(exc)) from exc


def build_sweep(*, payer: str, dest: str, lamports: int, whitelist: set[str]) -> BuiltTx:
    del payer, dest, lamports, whitelist
    raise PlaceholderBuilder("SWEEP_REFUSED")


def build_curve_buy(
    *,
    user: str,
    mint_address: str,
    mint_data: bytes,
    mint_owner: str,
    curve_data: bytes,
    fee_config_data: bytes,
    buyback_fee_recipient: str,
    sol_usd_cents: int,
    stake_cents: int,
    slippage_bps: int,
    ata_rent_lamports: int = TOKEN_2022_ATA_RENT_LAMPORTS,
    create_base_ata: bool = True,
    curve_lamports: int | None = None,
    volume_exists: bool = False,
    sol_usd_micro: int | None = None,
    volume_rent_lamports: int | None = None,
) -> BuiltTx:
    curve = _curve(curve_data)
    decimals, token_program = _mint(mint_data, mint_owner)
    market_cap = _market_cap(int(curve["virtual_quote"]), int(curve["supply"]), int(curve["virtual_token"]))
    protocol, creator = _fees(fee_config_data, market_cap)
    budget = _budget(stake_cents, sol_usd_cents, slippage_bps, sol_usd_micro)
    rent, fixed = _fixed_costs(
        ata_rent_lamports,
        create_base_ata=create_base_ata,
        volume_exists=volume_exists,
        curve_data=curve_data,
        curve_lamports=curve_lamports,
        volume_rent_lamports=volume_rent_lamports,
    )
    quote = _quote_before_slippage(budget, fixed, slippage_bps)
    net = net_sol_from_inclusive(quote, protocol, creator)
    tokens = tokens_for_net_sol(net, int(curve["virtual_quote"]), int(curve["virtual_token"]))
    if tokens <= 0 or tokens > int(curve["real_token"]):
        raise BuildError("QUOTE")
    limit = _with_slippage(quote, slippage_bps, up=True)
    if limit + fixed > budget:
        raise BuildError("CAP")
    _reject_if_over_cap(limit + fixed, sol_usd_cents, stake_cents, sol_usd_micro)
    accounts = _curve_accounts(user, mint_address, token_program, str(curve_quote(curve)), buyback_fee_recipient)
    data = BUY_V3_DISCRIMINATOR + struct.pack("<QQ", tokens, limit)
    raw = _compile(
        user, accounts, data, PUMP_PROGRAM, token_program, mint_address, create_base_ata,
        max_all_in=budget, expected_token=tokens, expected_limit=limit, rent_lamports=rent,
    )
    return _result(
        raw, accounts, data, tokens, quote, limit, limit + fixed, decimals, token_program, protocol, creator, rent,
    )


def build_curve_sell(
    *,
    user: str,
    mint_address: str,
    mint_data: bytes,
    mint_owner: str,
    curve_data: bytes,
    fee_config_data: bytes,
    buyback_fee_recipient: str,
    token_in: int,
    slippage_bps: int,
) -> BuiltTx:
    curve = _curve(curve_data)
    decimals, token_program = _mint(mint_data, mint_owner)
    market_cap = _market_cap(int(curve["virtual_quote"]), int(curve["supply"]), int(curve["virtual_token"]))
    protocol, creator = _fees(fee_config_data, market_cap)
    if slippage_bps < 0 or slippage_bps > SLIPPAGE_CAP_BPS:
        raise BuildError("SLIPPAGE")
    if token_in <= 0:
        raise BuildError("QUOTE")
    gross = sol_for_tokens(token_in, int(curve["virtual_quote"]), int(curve["virtual_token"]))
    net = gross - fee_lamports(gross, protocol) - fee_lamports(gross, creator)
    if net <= 0:
        raise BuildError("QUOTE")
    minimum = _with_slippage(net, slippage_bps, up=False)
    if minimum <= 0:
        raise BuildError("QUOTE")
    accounts = _curve_accounts(user, mint_address, token_program, str(curve_quote(curve)), buyback_fee_recipient)
    data = SELL_V3_DISCRIMINATOR + struct.pack("<QQ", token_in, minimum)
    raw = _compile(
        user, accounts, data, PUMP_PROGRAM, token_program, mint_address, False,
        max_all_in=None, expected_token=token_in, expected_limit=minimum, rent_lamports=0,
    )
    return _result(raw, accounts, data, token_in, net, minimum, 0, decimals, token_program, protocol, creator, 0)


def build_pumpswap_buy(
    *,
    user: str,
    pool: str,
    base_mint: str,
    quote_mint: str,
    base_reserve: int,
    quote_reserve: int,
    mint_supply: int,
    mint_data: bytes,
    mint_owner: str,
    fee_config_data: bytes,
    pool_base_token_account: str,
    pool_quote_token_account: str,
    user_base_token_account: str,
    user_quote_token_account: str,
    buyback_fee_recipient: str,
    sol_usd_cents: int,
    stake_cents: int,
    slippage_bps: int,
    ata_rent_lamports: int = 0,
    create_base_ata: bool = False,
    is_pump_pool: bool = True,
) -> BuiltTx:
    decimals, token_program = _mint(mint_data, mint_owner)
    market_cap = _market_cap(quote_reserve, mint_supply, base_reserve)
    protocol, creator = _fees(fee_config_data, market_cap, flat=not is_pump_pool)
    budget = _budget(stake_cents, sol_usd_cents, slippage_bps)
    rent, fixed = _fixed_costs(
        ata_rent_lamports,
        create_base_ata=create_base_ata,
        volume_exists=True,
        curve_data=b"",
        curve_lamports=0,
    )
    quote = _quote_before_slippage(budget, fixed, slippage_bps)
    net = net_sol_from_inclusive(quote, protocol, creator)
    tokens = tokens_for_net_sol(net, quote_reserve, base_reserve)
    if tokens <= 0:
        raise BuildError("QUOTE")
    limit = _with_slippage(quote, slippage_bps, up=True)
    if limit + fixed > budget:
        raise BuildError("CAP")
    _reject_if_over_cap(limit + fixed, sol_usd_cents, stake_cents)
    accounts = _swap_accounts(
        user, pool, base_mint, quote_mint, token_program, pool_base_token_account,
        pool_quote_token_account, user_base_token_account, user_quote_token_account, buyback_fee_recipient,
    )
    data = PUMPSWAP_BUY_V2_DISCRIMINATOR + struct.pack("<QQ", tokens, limit)
    raw = _compile(
        user, accounts, data, PUMP_SWAP, token_program, base_mint, create_base_ata,
        max_all_in=budget, expected_token=tokens, expected_limit=limit, rent_lamports=rent,
        allow_pumpswap=True,
    )
    return _result(
        raw, accounts, data, tokens, quote, limit, limit + fixed, decimals, token_program, protocol, creator, rent,
    )


def build_pumpswap_sell(
    *,
    user: str,
    pool: str,
    base_mint: str,
    quote_mint: str,
    base_reserve: int,
    quote_reserve: int,
    mint_supply: int,
    mint_data: bytes,
    mint_owner: str,
    fee_config_data: bytes,
    pool_base_token_account: str,
    pool_quote_token_account: str,
    user_base_token_account: str,
    user_quote_token_account: str,
    buyback_fee_recipient: str,
    token_in: int,
    slippage_bps: int,
    is_pump_pool: bool = True,
) -> BuiltTx:
    decimals, token_program = _mint(mint_data, mint_owner)
    market_cap = _market_cap(quote_reserve, mint_supply, base_reserve)
    protocol, creator = _fees(fee_config_data, market_cap, flat=not is_pump_pool)
    if slippage_bps < 0 or slippage_bps > SLIPPAGE_CAP_BPS:
        raise BuildError("SLIPPAGE")
    gross = sol_for_tokens(token_in, quote_reserve, base_reserve)
    net = gross - fee_lamports(gross, protocol) - fee_lamports(gross, creator)
    if net <= 0:
        raise BuildError("QUOTE")
    minimum = _with_slippage(net, slippage_bps, up=False)
    if minimum <= 0:
        raise BuildError("QUOTE")
    accounts = _swap_accounts(
        user, pool, base_mint, quote_mint, token_program, pool_base_token_account,
        pool_quote_token_account, user_base_token_account, user_quote_token_account, buyback_fee_recipient,
    )
    data = PUMPSWAP_SELL_V2_DISCRIMINATOR + struct.pack("<QQ", token_in, minimum)
    raw = _compile(
        user, accounts, data, PUMP_SWAP, token_program, base_mint, False,
        max_all_in=None, expected_token=token_in, expected_limit=minimum, rent_lamports=0,
        allow_pumpswap=True,
    )
    return _result(raw, accounts, data, token_in, net, minimum, 0, decimals, token_program, protocol, creator, 0)


def curve_quote(curve: dict[str, int | bool | bytes]) -> Pubkey:
    raw = curve["quote_mint"]
    assert isinstance(raw, bytes)
    wsol = bytes(Pubkey.from_string(WSOL_MINT))
    if raw == _ZERO or raw == wsol:
        return Pubkey.from_string(WSOL_MINT)
    raise BuildError("QUOTE_MINT")


def _curve(data: bytes) -> dict[str, int | bool | bytes]:
    parsed = decode_bonding_curve(data)
    if parsed is None:
        raise BuildError("CURVE")
    if parsed["complete"]:
        raise BuildError("COMPLETE")
    if parsed["cashback"]:
        raise BuildError("CASHBACK")
    return parsed


def _mint(data: bytes, owner: str) -> tuple[int, str]:
    parsed = parse_mint(data, owner)
    if parsed is None:
        raise BuildError("MINT")
    return parsed


def _fees(data: bytes, market_cap: int, *, flat: bool = False) -> tuple[int, int]:
    parsed = parse_fee_bps(data, market_cap, flat=flat)
    if parsed is None:
        raise BuildError("FEE")
    return parsed


def _market_cap(quote_reserve: int, supply: int, base_reserve: int) -> int:
    if base_reserve <= 0 or quote_reserve <= 0 or supply <= 0:
        raise BuildError("QUOTE")
    return quote_reserve * supply // base_reserve


def _budget(stake_cents: int, sol_usd_cents: int, slippage_bps: int, micro_per_sol: int | None = None) -> int:
    if stake_cents <= 0 or stake_cents > STAKE_CAP_CENTS:
        raise BuildError("CAP")
    if slippage_bps < 0 or slippage_bps > SLIPPAGE_CAP_BPS:
        raise BuildError("SLIPPAGE")
    micro = min(stake_cents * 10_000, USD_CAP_MICRO)
    if micro_per_sol is None:
        lamports = lamports_for_micro(micro, sol_usd_cents)
    else:
        lamports = lamports_for_micro_price(micro, micro_per_sol)
    if lamports is None or lamports <= 0:
        raise BuildError("CAP")
    return lamports


def _fixed_costs(
    ata_rent: int,
    *,
    create_base_ata: bool,
    volume_exists: bool,
    curve_data: bytes,
    curve_lamports: int | None,
    volume_rent_lamports: int | None = None,
) -> tuple[int, int]:
    if create_base_ata and ata_rent <= 0:
        raise BuildError("RENT")
    if ata_rent < 0:
        raise BuildError("RENT")
    rent = (ata_rent if create_base_ata else 0) + _volume_rent(volume_exists, volume_rent_lamports)
    rent += _curve_topup(curve_data, curve_lamports)
    return rent, rent + SIGNATURE_FEE_LAMPORTS + priority_fee_lamports(CU_LIMIT, PRIORITY_MICRO_LAMPORTS)


def _volume_rent(exists: bool, override: int | None) -> int:
    if exists:
        return 0
    if override is None:
        return rent_exempt_lamports(USER_VOLUME_ACCOUNT_BYTES)
    if override <= 0:
        raise BuildError("RENT")
    return override


def _curve_topup(curve_data: bytes, curve_lamports: int | None) -> int:
    if not curve_data:
        return 0
    need = rent_exempt_lamports(len(curve_data))
    if curve_lamports is None:
        return need
    if curve_lamports < 0:
        raise BuildError("RENT")
    return max(0, need - curve_lamports)


def _quote_before_slippage(budget: int, fixed: int, slippage_bps: int) -> int:
    if fixed >= budget:
        raise BuildError("CAP")
    room = budget - fixed
    quote = room * 10_000 // (10_000 + slippage_bps)
    if quote <= 0:
        raise BuildError("CAP")
    return quote


def _with_slippage(amount: int, slippage_bps: int, *, up: bool) -> int:
    if up:
        return amount * (10_000 + slippage_bps) // 10_000
    return amount * (10_000 - slippage_bps) // 10_000


def _reject_if_over_cap(
    all_in: int,
    sol_usd_cents: int,
    stake_cents: int,
    micro_per_sol: int | None = None,
) -> None:
    if micro_per_sol is None:
        spent = micro_for_lamports(all_in, sol_usd_cents)
    else:
        spent = micro_cost_ceil(all_in, micro_per_sol)
    allowed = min(stake_cents * 10_000, USD_CAP_MICRO)
    if spent is None or spent > allowed:
        raise BuildError("CAP")


def _pda(seeds: list[bytes], program: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(seeds, program)[0]


def _ata(owner: Pubkey, token_program: Pubkey, mint: Pubkey) -> Pubkey:
    return _pda([bytes(owner), bytes(token_program), bytes(mint)], Pubkey.from_string(ASSOCIATED_TOKEN))


def _curve_accounts(user: str, mint_address: str, token_program: str, quote_mint: str, buyback: str) -> tuple[str, ...]:
    pump = Pubkey.from_string(PUMP_PROGRAM)
    fee_program = Pubkey.from_string(FEE_PROGRAM)
    user_key = Pubkey.from_string(user)
    mint = Pubkey.from_string(mint_address)
    quote = Pubkey.from_string(quote_mint)
    base_program = Pubkey.from_string(token_program)
    quote_program = Pubkey.from_string(
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" if quote_mint == WSOL_MINT else token_program
    )
    curve = _pda([b"bonding-curve", bytes(mint)], pump)
    return (
        str(_pda([b"global"], pump)),
        mint_address,
        str(quote),
        str(base_program),
        str(quote_program),
        str(curve),
        str(_ata(curve, base_program, mint)),
        str(_ata(curve, quote_program, quote)),
        user,
        str(_ata(user_key, base_program, mint)),
        str(_ata(user_key, quote_program, quote)),
        str(_pda([b"user_volume_accumulator", bytes(user_key)], pump)),
        str(_pda([b"fee_config", bytes(pump)], fee_program)),
        buyback,
        SYSTEM_PROGRAM,
        str(_pda([b"__event_authority"], pump)),
        PUMP_PROGRAM,
    )


def _swap_accounts(
    user: str,
    pool: str,
    base_mint: str,
    quote_mint: str,
    token_program: str,
    pool_base: str,
    pool_quote: str,
    user_base: str,
    user_quote: str,
    buyback: str,
) -> tuple[str, ...]:
    program = Pubkey.from_string(PUMP_SWAP)
    fee_program = Pubkey.from_string(FEE_PROGRAM)
    user_key = Pubkey.from_string(user)
    quote_program = (
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" if quote_mint == WSOL_MINT else token_program
    )
    derived_user_base = str(_ata(user_key, Pubkey.from_string(token_program), Pubkey.from_string(base_mint)))
    derived_user_quote = str(_ata(user_key, Pubkey.from_string(quote_program), Pubkey.from_string(quote_mint)))
    pool_key = Pubkey.from_string(pool)
    derived_pool_base = str(_ata(pool_key, Pubkey.from_string(token_program), Pubkey.from_string(base_mint)))
    derived_pool_quote = str(_ata(pool_key, Pubkey.from_string(quote_program), Pubkey.from_string(quote_mint)))
    if user_base != derived_user_base or user_quote != derived_user_quote:
        raise BuildError("DERIVED")
    if pool_base != derived_pool_base or pool_quote != derived_pool_quote:
        raise BuildError("DERIVED")
    if buyback != derived_user_quote:
        raise BuildError("DERIVED")
    return (
        pool,
        user,
        str(_pda([b"global_config"], program)),
        base_mint,
        quote_mint,
        user_base,
        user_quote,
        pool_base,
        pool_quote,
        token_program,
        quote_program,
        SYSTEM_PROGRAM,
        str(_pda([b"user_volume_accumulator", bytes(user_key)], program)),
        str(_pda([b"fee_config", bytes(program)], fee_program)),
        buyback,
        str(_pda([b"__event_authority"], program)),
        PUMP_SWAP,
    )


_CURVE_FLAGS = (
    (False, False), (False, False), (False, False), (False, False), (False, False),
    (True, False), (True, False), (True, False), (True, True), (True, False),
    (True, False), (True, False), (False, False), (True, False), (False, False),
    (False, False), (False, False),
)
_SWAP_FLAGS = (
    (True, False), (True, True), (False, False), (False, False), (False, False),
    (True, False), (True, False), (True, False), (True, False), (False, False),
    (False, False), (False, False), (True, False), (False, False), (True, False),
    (False, False), (False, False),
)


def _compile(
    user: str,
    accounts: tuple[str, ...],
    data: bytes,
    program: str,
    token_program: str,
    mint_address: str,
    create_base_ata: bool,
    *,
    max_all_in: int | None,
    expected_token: int,
    expected_limit: int,
    rent_lamports: int,
    allow_pumpswap: bool = False,
) -> bytes:
    flags = _CURVE_FLAGS if program == PUMP_PROGRAM else _SWAP_FLAGS
    if len(accounts) != len(flags):
        raise BuildError("ACCOUNTS")
    metas = [
        AccountMeta(Pubkey.from_string(key), is_signer, is_writable)
        for key, (is_writable, is_signer) in zip(accounts, flags, strict=True)
    ]
    payer = Pubkey.from_string(user)
    instructions = [_limit_ix(), _price_ix()]
    if create_base_ata:
        ata_index = 9 if program == PUMP_PROGRAM else 5
        instructions.append(
            _ata_ix(
                payer,
                Pubkey.from_string(accounts[ata_index]),
                Pubkey.from_string(mint_address),
                Pubkey.from_string(token_program),
            )
        )
    instructions.append(SoldersInstruction(Pubkey.from_string(program), data, metas))
    message = MessageV0.try_compile(payer, instructions, [], Hash.default())
    if message.address_table_lookups:
        raise BuildError("ADDRESS_LOOKUP_TABLE")
    transaction = VersionedTransaction.populate(message, [Signature.default()])
    raw = bytes(transaction)
    assert_allowlisted(
        raw,
        owner=user,
        mint=mint_address,
        max_all_in_lamports=max_all_in,
        expected_token_amount=expected_token,
        expected_limit_lamports=expected_limit,
        rent_lamports=rent_lamports,
        allow_pumpswap=allow_pumpswap,
    )
    return raw


def _limit_ix() -> SoldersInstruction:
    return SoldersInstruction(Pubkey.from_string(COMPUTE_BUDGET), bytes([2]) + struct.pack("<I", CU_LIMIT), [])


def _price_ix() -> SoldersInstruction:
    # Micro-lamports per compute unit, not a lamport total.
    return SoldersInstruction(
        Pubkey.from_string(COMPUTE_BUDGET),
        bytes([3]) + struct.pack("<Q", PRIORITY_MICRO_LAMPORTS),
        [],
    )


def _ata_ix(payer: Pubkey, ata: Pubkey, mint: Pubkey, token_program: Pubkey) -> SoldersInstruction:
    system = Pubkey.from_string(SYSTEM_PROGRAM)
    return SoldersInstruction(
        Pubkey.from_string(ASSOCIATED_TOKEN),
        bytes([1]),
        [
            AccountMeta(payer, True, True),
            AccountMeta(ata, False, True),
            AccountMeta(payer, False, False),
            AccountMeta(mint, False, False),
            AccountMeta(system, False, False),
            AccountMeta(token_program, False, False),
        ],
    )


def _result(
    raw: bytes,
    accounts: tuple[str, ...],
    data: bytes,
    token_amount: int,
    quote_lamports: int,
    limit_lamports: int,
    all_in_lamports: int,
    decimals: int,
    token_program: str,
    protocol: int,
    creator: int,
    rent_lamports: int,
) -> BuiltTx:
    return BuiltTx(
        raw=raw,
        accounts=accounts,
        data=data,
        token_amount=token_amount,
        quote_lamports=quote_lamports,
        limit_lamports=limit_lamports,
        all_in_lamports=all_in_lamports,
        decimals=decimals,
        token_program=token_program,
        protocol_fee_bps=protocol,
        creator_fee_bps=creator,
        priority_micro_lamports=PRIORITY_MICRO_LAMPORTS,
        rent_lamports=rent_lamports,
    )
