"""Historical sample of pump.fun launches, drawn from the pump mint-authority signature stream (TSLvdd...),
which signs every pump.fun create. (pump.fun's /coins listing caps offset at ~1000, so it cannot reach back
days; the on-chain stream can.)

1. page the stream back to `max_age_h` (pages are stored in launches.db and double as as-of anchors)
2. draw `n` random successful stream signatures created between `max_age_h` and `min_age_h` ago
3. fetch each create tx -> mint, creator (fee payer), bonding curve
4. eligibility (decided only from data up to create+300s): >= `min_txs` successful mint transactions in
   the first 5 minutes (filters the large majority of launches that never trade; these are not candidates
   a trader would consider)
"""
from __future__ import annotations
import random, time
from concurrent.futures import ThreadPoolExecutor
from .. import chain, config as C, logging_setup as L
from ..sources.rpc import RpcError

log = L.get("bt.sample")


def page_stream(ctx, hours_back, progress=print):
    now = int(time.time())
    progress(f"indexing create stream {hours_back}h back (contiguous)")
    return ctx.anchors.ensure_range(now - int(hours_back * 3600), now, max_pages=600)


def _check(ctx, sig, bt, min_txs, window_s):
    try:
        tx = ctx.rpc.get_transaction(sig)
    except RpcError as e:
        return {"create_sig": sig, "eligible": 0, "note": f"tx: {e}"[:200]}
    if not tx or not tx.get("meta") or tx["meta"].get("err") or not chain.is_create(tx):
        return {"create_sig": sig, "eligible": 0, "note": "not a successful create"}
    mints = {b["mint"] for b in tx["meta"].get("postTokenBalances") or []}
    mint = None
    for m in mints:
        if chain.curve_from_create(tx, m):
            bal = max(int(b["uiTokenAmount"]["amount"]) for b in tx["meta"]["postTokenBalances"] if b["mint"] == m)
            if bal >= 5e14:
                mint = m
    if not mint:
        return {"create_sig": sig, "eligible": 0, "note": "mint not found"}
    curve = chain.curve_from_create(tx, mint)
    t0 = tx.get("blockTime") or bt
    a = ctx.anchors.anchor_at(t0 + window_s, max_pages=0)
    if not a:
        return {"create_sig": sig, "mint": mint, "create_time": t0, "eligible": 0, "note": "no anchor"}
    try:
        page = ctx.rpc.get_signatures(mint, 1000, before=a["signature"])
    except RpcError as e:
        return {"create_sig": sig, "mint": mint, "eligible": 0, "note": f"sigs: {e}"[:200]}
    n = sum(1 for s in page if s.get("err") is None and t0 <= (s.get("blockTime") or 0) <= t0 + window_s)
    return {"create_sig": sig, "mint": mint, "create_time": t0, "slot": tx["slot"], "creator": chain.fee_payer(tx),
            "curve": curve, "txs_first_5m": n, "eligible": int(n >= min_txs), "note": None}


def sample(ctx, store, n=600, min_age_h=26, max_age_h=72, min_txs=15, window_s=300, seed=7, workers=12, progress=print):
    cnt = page_stream(ctx, max_age_h + ctx.settings.serial_lookback_hours + 1, progress)
    progress(f"stream index: {cnt}")
    now = time.time()
    rows = ctx.anchors.db.execute("SELECT signature, block_time FROM stream WHERE err=0 AND block_time BETWEEN ? AND ? ORDER BY block_time",
                                  (int(now - max_age_h * 3600), int(now - min_age_h * 3600))).fetchall()
    done = {r[0] for r in store.q("SELECT create_sig FROM candidates")}
    rng = random.Random(seed)
    pick = [r for r in rng.sample(rows, min(n, len(rows))) if r[0] not in done]
    progress(f"{len(rows)} creates in window; checking {len(pick)} new candidates")
    cols = ["create_sig", "mint", "create_time", "slot", "creator", "curve", "txs_first_5m", "eligible", "checked_at", "note"]
    k = 0
    with ThreadPoolExecutor(workers) as ex:
        for r in ex.map(lambda r: _check(ctx, r[0], r[1], min_txs, window_s), pick):
            r["checked_at"] = time.time()
            store.x(f"INSERT OR REPLACE INTO candidates VALUES ({','.join('?' * len(cols))})", [r.get(c) for c in cols])
            k += 1
            if k % 50 == 0:
                progress(f"checked {k}/{len(pick)}")
    return store.q("SELECT COUNT(*), SUM(eligible) FROM candidates")[0]
