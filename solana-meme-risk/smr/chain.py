"""Pure helpers over jsonParsed Solana transactions (no I/O) - unit-testable with recorded fixtures."""
from __future__ import annotations
from . import config as C


def account_keys(tx) -> list[str]:
    return [k["pubkey"] if isinstance(k, dict) else k for k in tx["transaction"]["message"]["accountKeys"]]


def fee_payer(tx) -> str:
    return account_keys(tx)[0]


def token_deltas(tx, mint) -> dict:
    """owner -> raw token delta of `mint` in this tx."""
    m = tx["meta"]; pre, post = {}, {}
    for b in m.get("preTokenBalances") or []:
        if b["mint"] == mint:
            pre[b["accountIndex"]] = (b.get("owner"), int(b["uiTokenAmount"]["amount"]))
    for b in m.get("postTokenBalances") or []:
        if b["mint"] == mint:
            post[b["accountIndex"]] = (b.get("owner"), int(b["uiTokenAmount"]["amount"]))
    out = {}
    for idx in set(pre) | set(post):
        owner = (post.get(idx) or pre.get(idx))[0]
        d = post.get(idx, (owner, 0))[1] - pre.get(idx, (owner, 0))[1]
        out[owner] = out.get(owner, 0) + d
    return out


def token_post_balance(tx, mint, owner) -> int | None:
    for b in tx["meta"].get("postTokenBalances") or []:
        if b["mint"] == mint and b.get("owner") == owner:
            return int(b["uiTokenAmount"]["amount"])
    return None


def sol_delta(tx, address) -> int | None:
    keys = account_keys(tx)
    if address not in keys:
        return None
    i = keys.index(address); m = tx["meta"]
    return m["postBalances"][i] - m["preBalances"][i]


def is_create(tx) -> bool:
    return any(l.startswith("Program log: Instruction: Create") for l in (tx["meta"].get("logMessages") or []))


def all_instructions(tx):
    ixs = list(tx["transaction"]["message"].get("instructions") or [])
    for inner in tx["meta"].get("innerInstructions") or []:
        ixs.extend(inner.get("instructions") or [])
    return ixs


def incoming_sol(tx, wallet) -> list[tuple[str, int]]:
    """(source, lamports) for SOL moved INTO wallet via system transfer/createAccount(+WithSeed), incl. inner ixs."""
    out = []
    for ix in all_instructions(tx):
        if ix.get("program") != "system" or not isinstance(ix.get("parsed"), dict):
            continue
        t, info = ix["parsed"].get("type"), ix["parsed"].get("info", {})
        if t in ("transfer", "transferWithSeed") and info.get("destination") == wallet:
            out.append((info.get("source"), int(info.get("lamports", 0))))
        elif t in ("createAccount", "createAccountWithSeed") and info.get("newAccount") == wallet:
            out.append((info.get("source"), int(info.get("lamports", 0))))
    return [(s, l) for s, l in out if s and s != wallet]


def system_transfer_recipients(tx) -> set[str]:
    """Distinct recipients of system transfers in a tx (detects multi-send funding transactions)."""
    r = set()
    for ix in all_instructions(tx):
        if ix.get("program") == "system" and isinstance(ix.get("parsed"), dict) and ix["parsed"].get("type") in ("transfer", "createAccount"):
            info = ix["parsed"]["info"]; r.add(info.get("destination") or info.get("newAccount"))
    return r - {None}


def curve_from_create(tx, mint) -> str | None:
    """Owner of the token account that holds most of the supply right after create = bonding curve."""
    best, amt = None, -1
    for b in tx["meta"].get("postTokenBalances") or []:
        if b["mint"] == mint and b.get("owner") not in C.INFRA_OWNERS:
            a = int(b["uiTokenAmount"]["amount"])
            if a > amt:
                best, amt = b.get("owner"), a
    return best


def curve_real_tokens(curve_ata_raw: int) -> int:
    """Bonding-curve real token reserves from the curve's token-account balance (ATA also holds the
    206.9M-token migration reserve). Balance 0 = migrated."""
    return max(0, int(curve_ata_raw) - C.PUMP_CURVE_RESERVED_RAW)


def price_ratio_vs_launch(curve_ata_raw: int) -> float:
    """Bonding-curve price relative to launch price, from the curve token account balance alone.
    Constant product: price = k / vTok^2 with vTok = real + offset, so ratio = (vTok0 / vTok)^2."""
    v0 = C.PUMP_INITIAL_REAL_TOKEN_RAW + C.PUMP_VIRTUAL_TOKEN_OFFSET_RAW
    v = curve_real_tokens(curve_ata_raw) + C.PUMP_VIRTUAL_TOKEN_OFFSET_RAW
    return (v0 / v) ** 2


def curve_progress(curve_ata_raw: int) -> float:
    return round(min(1.0, max(0.0, 1 - curve_real_tokens(curve_ata_raw) / C.PUMP_INITIAL_REAL_TOKEN_RAW)), 4)
