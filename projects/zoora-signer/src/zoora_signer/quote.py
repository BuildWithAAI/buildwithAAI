"""Bonding-curve quote. Fee comes from the chain. A missing fee fails closed."""

from __future__ import annotations

import struct


def tokens_out(sol_in: int, virtual_sol: int, virtual_tokens: int, fee_bps: int | None) -> int | None:
    if fee_bps is None or fee_bps < 0 or fee_bps >= 10_000:
        return None
    if sol_in <= 0 or virtual_sol <= 0 or virtual_tokens <= 0:
        return None
    net = sol_in * (10_000 - fee_bps) // 10_000
    if net <= 0:
        return None
    return (virtual_tokens * net) // (virtual_sol + net)


def sol_out(tokens_in: int, virtual_sol: int, virtual_tokens: int, fee_bps: int | None) -> int | None:
    if fee_bps is None or fee_bps < 0 or fee_bps >= 10_000:
        return None
    if tokens_in <= 0 or virtual_sol <= 0 or virtual_tokens <= 0 or tokens_in >= virtual_tokens:
        return None
    gross = (virtual_sol * tokens_in) // (virtual_tokens + tokens_in)
    net = gross * (10_000 - fee_bps) // 10_000
    return net if net > 0 else None


def decode_global_fee_bps(data: bytes) -> int | None:
    """Layout checked against the live global account on 2026-11-17.

    8-byte Anchor discriminator, bool, two pubkeys, four u64 reserves, then fee bps.
    """

    offset = 8 + 1 + 32 + 32 + 8 * 4
    if len(data) < offset + 8:
        return None
    if data[:8] != bytes.fromhex("a7e8e8b1c86c727f"):
        return None
    (fee,) = struct.unpack_from("<Q", data, offset)
    if fee <= 0 or fee >= 10_000:
        return None
    return int(fee)


RENT_LAMPORTS_PER_BYTE_YEAR = 3_480
RENT_EXEMPTION_YEARS = 2
RENT_PER_BYTE = RENT_LAMPORTS_PER_BYTE_YEAR * RENT_EXEMPTION_YEARS
RENT_TOLERANCE_BPS = 100


def rent_exempt_lamports(data_len: int) -> int:
    """Local getMinimumBalanceForRentExemption: (data_len + 128) * 6960."""

    if data_len < 0:
        return 0
    return (data_len + 128) * RENT_PER_BYTE


def accept_chain_rent(chain: int, data_len: int) -> int | None:
    """Budget max(chain, formula). Refuse a value more than 1% from the formula."""

    formula = rent_exempt_lamports(data_len)
    if formula <= 0 or chain <= 1:
        return None
    if abs(chain - formula) * 10_000 > formula * RENT_TOLERANCE_BPS:
        return None
    return max(chain, formula)


def lamports_for_cents(cents: int, sol_usd_cents: int) -> int | None:
    if cents < 0 or sol_usd_cents <= 0:
        return None
    return cents * 1_000_000_000 // sol_usd_cents


def lamports_for_micro(micro_usd: int, sol_usd_cents: int) -> int | None:
    """Largest lamport count whose value is at most micro_usd. Rounds down."""

    if micro_usd <= 0 or sol_usd_cents <= 0:
        return None
    return lamports_for_micro_price(micro_usd, sol_usd_cents * 10_000)


def lamports_for_micro_price(micro_usd: int, micro_per_sol: int) -> int | None:
    """Lamports a buy may spend. The price is already rounded up."""

    if micro_usd <= 0 or micro_per_sol <= 0:
        return None
    return micro_usd * 1_000_000_000 // micro_per_sol


def micro_cost_ceil(lamports: int, micro_per_sol: int) -> int | None:
    """USD cost of a lamport amount, rounded up."""

    if lamports < 0 or micro_per_sol <= 0:
        return None
    num = lamports * micro_per_sol
    micro = num // 1_000_000_000
    if num % 1_000_000_000:
        micro += 1
    return micro


def micro_for_lamports(lamports: int, sol_usd_cents: int) -> int | None:
    if lamports < 0 or sol_usd_cents <= 0:
        return None
    return lamports * sol_usd_cents * 10_000 // 1_000_000_000


def fee_lamports(amount: int, bps: int) -> int:
    if amount <= 0 or bps <= 0:
        return 0
    return (amount * bps + 9_999) // 10_000


def net_sol_from_inclusive(quote: int, protocol_bps: int, creator_bps: int) -> int:
    """Largest net curve input whose ceil fees still fit inside quote."""

    if quote <= 0:
        return 0
    low = 0
    high = quote
    best = 0
    while low <= high:
        mid = (low + high) // 2
        total = mid + fee_lamports(mid, protocol_bps) + fee_lamports(mid, creator_bps)
        if total <= quote:
            best = mid
            low = mid + 1
        else:
            high = mid - 1
    return best


def tokens_for_net_sol(net_sol: int, virtual_sol: int, virtual_tokens: int) -> int:
    if net_sol <= 0 or virtual_sol <= 0 or virtual_tokens <= 0:
        return 0
    return (virtual_tokens * net_sol) // (virtual_sol + net_sol)


def sol_for_tokens(tokens: int, virtual_sol: int, virtual_tokens: int) -> int:
    if tokens <= 0 or virtual_sol <= 0 or virtual_tokens <= 0 or tokens >= virtual_tokens:
        return 0
    return (virtual_sol * tokens) // (virtual_tokens + tokens)


def priority_fee_lamports(cu_limit: int, micro_lamports_per_cu: int) -> int:
    if cu_limit <= 0 or micro_lamports_per_cu <= 0:
        return 0
    return (cu_limit * micro_lamports_per_cu + 999_999) // 1_000_000


def parse_mint(data: bytes, owner: str) -> tuple[int, str] | None:
    """Return (decimals, token program). Fails closed on a short or uninitialized mint."""

    from zoora_signer.constants import SPL_TOKEN, TOKEN_2022

    if owner not in {SPL_TOKEN, TOKEN_2022} or len(data) < 46 or data[45] != 1:
        return None
    decimals = data[44]
    if decimals > 9:
        return None
    return int(decimals), owner


def decode_bonding_curve(data: bytes) -> dict[str, int | bool | bytes] | None:
    if len(data) < 8 + 8 * 5 + 1 + 32 + 2 + 32:
        return None
    offset = 8
    virtual_token, virtual_quote, real_token, real_quote, supply = struct.unpack_from("<QQQQQ", data, offset)
    offset += 40
    complete = data[offset] == 1
    offset += 1
    creator = data[offset : offset + 32]
    offset += 32
    mayhem = data[offset] == 1
    offset += 1
    cashback = data[offset] == 1
    offset += 1
    quote_mint = data[offset : offset + 32]
    if virtual_token <= 0 or virtual_quote <= 0 or supply <= 0:
        return None
    return {
        "virtual_token": int(virtual_token),
        "virtual_quote": int(virtual_quote),
        "real_token": int(real_token),
        "real_quote": int(real_quote),
        "supply": int(supply),
        "complete": complete,
        "mayhem": mayhem,
        "cashback": cashback,
        "creator": creator,
        "quote_mint": quote_mint,
    }


def parse_fee_bps(data: bytes, market_cap_lamports: int, *, flat: bool = False) -> tuple[int, int] | None:
    """Protocol and creator bps from a Pump Fees fee_config account.

    A missing or unreadable schedule returns None. A parsed total of 0 is also
    refused: this reader does not substitute 0 for a failed read.
    """

    import hashlib

    if len(data) < 8 + 1 + 32 + 24 + 4 or data[:8] != hashlib.sha256(b"account:FeeConfig").digest()[:8]:
        return None
    offset = 8 + 1 + 32
    _lp, protocol, creator = struct.unpack_from("<QQQ", data, offset)
    offset += 24
    if offset + 4 > len(data):
        return None
    (count,) = struct.unpack_from("<I", data, offset)
    offset += 4
    if count > 64 or offset + count * 40 > len(data):
        return None
    if flat or count == 0:
        chosen_flat = (int(protocol), int(creator))
        if chosen_flat[0] <= 0 and chosen_flat[1] <= 0:
            return None
        if chosen_flat[0] < 0 or chosen_flat[1] < 0 or sum(chosen_flat) >= 10_000:
            return None
        return chosen_flat
    chosen: tuple[int, int] | None = None
    first: tuple[int, int] | None = None
    best_threshold = -1
    for _index in range(count):
        threshold = int.from_bytes(data[offset : offset + 16], "little")
        offset += 16
        _tier_lp, tier_protocol, tier_creator = struct.unpack_from("<QQQ", data, offset)
        offset += 24
        fees = (int(tier_protocol), int(tier_creator))
        if first is None:
            first = fees
        if market_cap_lamports >= threshold and threshold >= best_threshold:
            best_threshold = threshold
            chosen = fees
    if market_cap_lamports < 0:
        return None
    if chosen is None:
        chosen = first
    if chosen is None:
        return None
    protocol_bps, creator_bps = chosen
    if protocol_bps <= 0 and creator_bps <= 0:
        return None
    if protocol_bps < 0 or creator_bps < 0 or protocol_bps + creator_bps >= 10_000:
        return None
    return protocol_bps, creator_bps
