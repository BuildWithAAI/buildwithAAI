"""Parse Solana `getTransaction` (jsonParsed) results into per-wallet trades.

Python 3 standard library only. No case data lives here.

Everything is derived from each transaction's `meta`, not from instruction
decoding, so it works for direct venue calls and for router/bot CPIs alike:

  * token delta  = sum over postTokenBalances - preTokenBalances whose
                   `owner` is the wallet, per mint (wSOL excluded);
  * SOL delta    = the wallet's own lamport delta (fees, rent and tips are
                   already inside it when the wallet pays them) PLUS the
                   delta of wSOL token accounts the wallet owns;
  * failed transactions (meta.err != null) are skipped;
  * venue        = 'pumpfun' if the Pump.fun bonding-curve program appears
                   in the outer or inner instructions, 'pumpswap' for the
                   PumpSwap AMM, else 'other'.

A row with token_delta > 0 and SOL spent is a buy; token_delta < 0 and SOL
received is a sell. Token movements with no SOL leg are reported as
transfer_in / transfer_out so they are not mistaken for trades.
"""

PUMP_BONDING_CURVE = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
PUMPSWAP_AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
WSOL_MINT = "So11111111111111111111111111111111111111112"
# Stablecoins that act as the quote leg of a trade (USD units, 1:1 assumed).
STABLE_MINTS = {
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
    "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB": "USD1",
}
QUOTE_MINTS = {WSOL_MINT, *STABLE_MINTS}
STABLE_EPS = 0.01   # USD; smaller stable movements are treated as dust
SYSTEM_PROGRAM = "11111111111111111111111111111111"
LAMPORTS = 1_000_000_000

# A token movement whose SOL leg is smaller than this (in SOL, absolute) is
# treated as a transfer rather than a trade. 0.003 SOL covers fees + ATA rent.
TRANSFER_SOL_EPS = 0.003


def account_keys(tx):
    """All account pubkeys in order: static keys, then loaded writable, then readonly."""
    msg = tx["transaction"]["message"]
    keys = []
    for k in msg.get("accountKeys", []):
        keys.append(k["pubkey"] if isinstance(k, dict) else k)
    la = (tx.get("meta") or {}).get("loadedAddresses") or {}
    # jsonParsed already merges loaded addresses into accountKeys (with a
    # `source` field). Only append when they are missing.
    if len(keys) < len((tx["meta"] or {}).get("preBalances", [])):
        keys += la.get("writable", []) + la.get("readonly", [])
    return keys


def program_ids(tx):
    ids = set()
    msg = tx["transaction"]["message"]
    for ix in msg.get("instructions", []):
        if ix.get("programId"):
            ids.add(ix["programId"])
    for inner in (tx.get("meta") or {}).get("innerInstructions") or []:
        for ix in inner.get("instructions", []):
            if ix.get("programId"):
                ids.add(ix["programId"])
    return ids


def venue_of(tx):
    ids = program_ids(tx)
    if PUMP_BONDING_CURVE in ids:
        return "pumpfun"
    if PUMPSWAP_AMM in ids:
        return "pumpswap"
    return "other"


def fee_payer(tx):
    keys = account_keys(tx)
    return keys[0] if keys else None


def _raw(tb):
    return int(tb["uiTokenAmount"]["amount"]), int(tb["uiTokenAmount"]["decimals"])


def token_deltas_by_owner(tx):
    """{owner: {mint: (delta_raw, decimals)}} from pre/post token balances."""
    meta = tx["meta"]
    acc = {}
    seen = {}
    for tb in meta.get("preTokenBalances") or []:
        amt, dec = _raw(tb)
        key = (tb["accountIndex"], tb["mint"])
        seen[key] = (tb.get("owner"), dec)
        acc[key] = acc.get(key, 0) - amt
    for tb in meta.get("postTokenBalances") or []:
        amt, dec = _raw(tb)
        key = (tb["accountIndex"], tb["mint"])
        seen[key] = (tb.get("owner"), dec)
        acc[key] = acc.get(key, 0) + amt
    out = {}
    for key, d in acc.items():
        owner, dec = seen[key]
        if d == 0 or owner is None:
            continue
        m = out.setdefault(owner, {})
        prev = m.get(key[1], (0, dec))[0]
        m[key[1]] = (prev + d, dec)
    return out


def lamport_delta(tx, address):
    keys = account_keys(tx)
    meta = tx["meta"]
    total = 0
    for i, k in enumerate(keys):
        if k == address and i < len(meta["preBalances"]):
            total += meta["postBalances"][i] - meta["preBalances"][i]
    return total


def sol_delta(tx, owner, tok=None):
    """Owner's SOL change in lamports: native lamports + owned wSOL accounts."""
    tok = tok if tok is not None else token_deltas_by_owner(tx)
    lam = lamport_delta(tx, owner)
    wsol = tok.get(owner, {}).get(WSOL_MINT, (0, 9))[0]
    return lam + wsol


def stable_delta(tok, owner):
    """(usd_delta, symbol) summed over the owner's stablecoin accounts."""
    total, sym = 0.0, None
    for m, (d, dec) in tok.get(owner, {}).items():
        if m in STABLE_MINTS:
            total += d / (10 ** dec)
            sym = STABLE_MINTS[m] if sym is None else sym
    return total, sym


def parse_wallet_trades(tx, wallet, signature=None, tx_index=None):
    """Return a list of trade/transfer rows for `wallet` in this transaction.

    The quote leg is SOL (native + wSOL) or a USD stablecoin (USDC/USDT/USD1),
    whichever moved opposite to the token. `sol_delta` is always the wallet's
    full SOL change (for a stablecoin trade that is just fees, tips and rent).
    """
    if not tx or not tx.get("meta"):
        return []
    meta = tx["meta"]
    if meta.get("err") is not None:
        return []
    tok = token_deltas_by_owner(tx)
    mine = {m: v for m, v in tok.get(wallet, {}).items() if m not in QUOTE_MINTS}
    if not mine:
        return []
    sol = sol_delta(tx, wallet, tok) / LAMPORTS
    usd, usd_sym = stable_delta(tok, wallet)
    is_payer = fee_payer(tx) == wallet
    fee = meta.get("fee", 0) if is_payer else 0
    venue = venue_of(tx)
    sig = signature or tx["transaction"]["signatures"][0]
    rows = []
    n = len(mine)
    for mint, (d_raw, dec) in mine.items():
        amt = d_raw / (10 ** dec)
        # If one tx moves several mints we split the quote leg evenly; flag it.
        s_sol, s_usd = sol / n, usd / n
        quote, qamt = None, 0.0
        if d_raw > 0 and s_usd < -STABLE_EPS:
            side, quote, qamt = "buy", usd_sym, -s_usd
        elif d_raw < 0 and s_usd > STABLE_EPS:
            side, quote, qamt = "sell", usd_sym, s_usd
        elif d_raw > 0 and s_sol < -TRANSFER_SOL_EPS:
            side, quote, qamt = "buy", "SOL", -s_sol
        elif d_raw < 0 and s_sol > TRANSFER_SOL_EPS:
            side, quote, qamt = "sell", "SOL", s_sol
        elif d_raw > 0:
            side = "transfer_in"
        else:
            side = "transfer_out"
        rows.append({
            "wallet": wallet,
            "token": mint,
            "side": side,
            "token_amount": abs(amt),
            "quote": quote,                       # 'SOL', 'USDC', 'USDT', 'USD1' or None
            "quote_amount": qamt,                 # spent (buy) / received (sell), fees incl. if SOL
            "sol_amount": abs(s_sol) if quote == "SOL" else 0.0,
            "sol_delta": s_sol,                   # signed SOL change: + received, - spent
            "usd_delta": s_usd,                   # signed stablecoin change
            "fee_sol": fee / LAMPORTS,
            "blockTime": tx.get("blockTime"),
            "slot": tx.get("slot"),
            "tx_index": tx_index,
            "venue": venue,
            "multi_mint": n > 1,
            "signature": sig,
        })
    return rows


def system_transfers(tx):
    """All parsed System Program SOL transfers (outer + inner) in a successful tx."""
    if not tx or not tx.get("meta") or tx["meta"].get("err") is not None:
        return []
    out = []
    msg = tx["transaction"]["message"]
    ixs = list(msg.get("instructions", []))
    for inner in tx["meta"].get("innerInstructions") or []:
        ixs += inner.get("instructions", [])
    for ix in ixs:
        if ix.get("programId") != SYSTEM_PROGRAM:
            continue
        p = ix.get("parsed")
        if not isinstance(p, dict):
            continue
        t = p.get("type")
        info = p.get("info", {})
        if t in ("transfer", "transferWithSeed") and "lamports" in info:
            out.append({"source": info.get("source"), "destination": info.get("destination"),
                        "lamports": int(info["lamports"])})
        elif t in ("createAccount", "createAccountWithSeed") and "lamports" in info:
            out.append({"source": info.get("source"), "destination": info.get("newAccount"),
                        "lamports": int(info["lamports"]), "create": True})
    return out


def pool_trades(tx, pool_owner, mint, signature=None, tx_index=None):
    """Trades against a venue account (bonding curve PDA or AMM pool authority).

    Price = |quote change of the pool| / |token change of the pool| (venue
    price, excluding trader-side fees). Quote is SOL (lamports + wSOL) or a
    stablecoin, whichever the pool holds. Returns one row per tx with the net
    pool flow, plus the traders whose token balance for `mint` changed.
    """
    if not tx or not tx.get("meta") or tx["meta"].get("err") is not None:
        return None
    tok = token_deltas_by_owner(tx)
    pool_tok = tok.get(pool_owner, {}).get(mint)
    if not pool_tok or pool_tok[0] == 0:
        return None
    d_raw, dec = pool_tok
    pool_sol = sol_delta(tx, pool_owner, tok)
    pool_usd, pool_sym = stable_delta(tok, pool_owner)
    traders = []
    for owner, mints in tok.items():
        if owner == pool_owner or mint not in mints:
            continue
        td, tdec = mints[mint]
        traders.append({"owner": owner, "token_delta": td / (10 ** tdec)})
    tokens = abs(d_raw) / (10 ** dec)
    # Launch transaction: the venue's token account has no pre-balance (supply is
    # minted into it in this tx), so SOL/token here is not a market price.
    pre_owners = {(tb.get("owner"), tb["mint"]) for tb in tx["meta"].get("preTokenBalances") or []}
    is_create = d_raw > 0 and (pool_owner, mint) not in pre_owners
    if abs(pool_usd) > STABLE_EPS:
        quote, sol = pool_sym, abs(pool_usd)
    else:
        quote, sol = "SOL", abs(pool_sol) / LAMPORTS
    return {
        "signature": signature or tx["transaction"]["signatures"][0],
        "blockTime": tx.get("blockTime"), "slot": tx.get("slot"), "tx_index": tx_index,
        # pool receives tokens => traders sold
        "side": "sell" if d_raw > 0 else "buy",
        "token_amount": tokens, "quote": quote, "quote_amount": sol,
        "price_quote_per_token": None if is_create else ((sol / tokens) if tokens else None),
        "is_create": is_create,
        "traders": traders, "venue": venue_of(tx),
    }
