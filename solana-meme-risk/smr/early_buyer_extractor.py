"""Stage 1 - early buyers (point-in-time).

Collects the token's successful transactions from creation up to `as_of` (no lookahead: for past `as_of`
the signature query is anchored with a finalized signature at `as_of`, see AnchorIndex), orders them by
(slot, transactionIndex) and records:
  * the first N buyers (wallets whose balance of the mint increased, excluding curve/pool/burn accounts)
  * per-owner net holdings at `as_of` (exact when every transaction in the window was fetched)
  * bonding-curve state at `as_of` (price ratio vs launch, curve progress)
Bundle signal: buyers in the creation slot.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from . import chain, config as C, logging_setup as L
from .sources.rpc import RpcError

log = L.get("early")


def _collect_signatures(ctx, mint, as_of, live, max_pages):
    before, warnings = None, []
    if not live:
        a = ctx.anchors.anchor_at(int(as_of))
        if not a:
            warnings.append("could not resolve a point-in-time anchor signature; results may include post-as_of data")
        else:
            before = a["signature"]
    out = []
    complete = False
    for _ in range(max_pages):
        page = ctx.rpc.get_signatures(mint, 1000, before=before)
        out.extend(page)
        if len(page) < 1000:
            complete = True; break
        before = page[-1]["signature"]
    out = [s for s in out if s.get("blockTime") is None or s["blockTime"] <= as_of]
    return out, complete, warnings


def extract_early_buyers(ctx, mint, *, as_of=None, n=None, coin=None, max_sig_pages=30):
    s = ctx.settings
    n = n or s.early_buyers_n
    now = ctx.clock()
    live = as_of is None or as_of >= now - 120
    as_of = int(now if as_of is None else as_of)
    coin = coin or {}
    res = {"mint": mint, "as_of": as_of, "mode": "live" if live else "point_in_time", "creator": coin.get("creator"),
           "bonding_curve": coin.get("bonding_curve"), "creation": None, "buyers": [], "warnings": [],
           "history_complete": False, "window_txs_total": 0, "window_txs_fetched": 0, "holdings_complete": False}
    sigs, complete, w = _collect_signatures(ctx, mint, as_of, live, max_sig_pages)
    res["warnings"] += w
    res["history_complete"] = complete
    if not complete:
        res["warnings"].append(f"signature history >{max_sig_pages * 1000}; creation not reached - early buyers are not the true first buyers")
    ok = [x for x in sigs if x.get("err") is None]
    ok.sort(key=lambda x: (x["slot"], x.get("transactionIndex") if x.get("transactionIndex") is not None else 1 << 30))
    res["window_txs_total"] = len(ok)
    if not ok:
        res["warnings"].append("no successful transactions found for mint before as_of")
        return res
    fetch = ok[: s.max_launch_txs]
    res["holdings_complete"] = complete and len(fetch) == len(ok)
    if len(fetch) < len(ok):
        res["warnings"].append(f"{len(ok)} txs before as_of; fetched oldest {len(fetch)} (holdings at as_of incomplete)")

    def get(sig):
        try:
            return ctx.rpc.get_transaction(sig)
        except RpcError as e:
            return {"__error__": str(e)}
    with ThreadPoolExecutor(s.workers) as ex:
        txs = list(ex.map(get, [x["signature"] for x in fetch]))
    errs = sum(1 for t in txs if not t or "__error__" in t)
    if errs:
        res["warnings"].append(f"{errs} transaction fetches failed")
        res["holdings_complete"] = False
    res["window_txs_fetched"] = len(txs) - errs

    first = next((t for t in txs if t and "__error__" not in t and t.get("meta")), None)
    create_tx = next((t for t in txs[:5] if t and "__error__" not in t and t.get("meta") and chain.is_create(t)), None)
    if create_tx is None and complete:
        res["warnings"].append("oldest transactions do not contain a pump.fun Create instruction")
    anchor_tx = create_tx or first
    create_slot = anchor_tx["slot"]
    fp = chain.fee_payer(anchor_tx)
    curve = res["bonding_curve"] or (chain.curve_from_create(anchor_tx, mint) if create_tx else None)
    res["bonding_curve"] = curve
    if not res["creator"]:
        res["creator"] = fp
    creator = res["creator"]
    res["creation"] = {"signature": anchor_tx["transaction"]["signatures"][0], "slot": create_slot, "block_time": anchor_tx.get("blockTime"),
                       "fee_payer": fp, "creator": creator, "fee_payer_is_creator": fp == creator, "is_create_ix": create_tx is not None}
    exclude = {x for x in (curve, coin.get("pool_address"), coin.get("associated_bonding_curve")) if x} | set(C.INFRA_OWNERS)
    quote_mint = coin.get("quote_mint") or C.SYSTEM_PROGRAM
    sol_quote = quote_mint in (C.SYSTEM_PROGRAM, C.WSOL_MINT)
    q_dec = 9 if sol_quote else (coin.get("quote_decimals") or 6)

    seen, holdings, sold = {}, {}, {}
    curve_tok = None
    for meta, tx in zip(fetch, txs):
        if not tx or "__error__" in tx or not tx.get("meta"):
            continue
        payer = chain.fee_payer(tx)
        deltas = chain.token_deltas(tx, mint)
        if curve:
            ct = chain.token_post_balance(tx, mint, curve)
            if ct is not None:
                curve_tok = ct
        q_raw = (chain.sol_delta(tx, curve) if sol_quote else chain.token_deltas(tx, quote_mint).get(curve)) if curve else None
        payer_delta = chain.sol_delta(tx, payer) or 0
        for owner, d in deltas.items():
            if owner is None or owner in exclude:
                continue
            holdings[owner] = holdings.get(owner, 0) + d
            if d < 0:
                sold[owner] = sold.get(owner, 0) - d
            if d <= 0:
                continue
            if owner in seen:
                seen[owner]["token_amount_raw"] += d; seen[owner]["n_buys"] += 1
                continue
            if len(seen) >= n:
                continue
            seen[owner] = {
                "rank": len(seen) + 1, "wallet": owner, "signer": payer, "signer_is_owner": payer == owner,
                "signature": meta["signature"], "slot": tx["slot"], "tx_index": meta.get("transactionIndex"), "block_time": tx.get("blockTime"),
                "quote_mint": quote_mint,
                "quote_amount": round(q_raw / 10 ** q_dec, 6) if q_raw and q_raw > 0 else None,
                "sol_amount": round(q_raw / 1e9, 6) if sol_quote and q_raw and q_raw > 0 else None,
                "signer_sol_spent": round(-payer_delta / 1e9, 6) if payer_delta < 0 else 0.0,
                "token_amount_raw": d,
                "is_creator": owner == creator,
                "in_creation_tx": tx is create_tx,
                "same_slot_as_create": tx["slot"] == create_slot,
                "slot_offset": tx["slot"] - create_slot, "n_buys": 1,
            }
    buyers = list(seen.values())
    for b in buyers:
        b["pct_supply_bought"] = round(100 * b["token_amount_raw"] / C.PUMP_TOTAL_SUPPLY_RAW, 4)
        held = holdings.get(b["wallet"], 0)
        b["pct_supply_held_as_of"] = round(100 * max(0, held) / C.PUMP_TOTAL_SUPPLY_RAW, 4) if res["holdings_complete"] else None
        b["sold_raw_by_as_of"] = sold.get(b["wallet"], 0)
    res["buyers"] = buyers
    res["create_slot"] = create_slot
    res["holdings_as_of"] = {o: v for o, v in holdings.items() if v > 0}
    res["curve_as_of"] = None if curve_tok is None else {
        "curve_token_raw": curve_tok, "price_ratio_vs_launch": round(chain.price_ratio_vs_launch(curve_tok), 4),
        "progress": chain.curve_progress(curve_tok), "graduated": chain.curve_real_tokens(curve_tok) == 0}
    res["creator_sold_raw"] = sold.get(creator, 0)
    return res
