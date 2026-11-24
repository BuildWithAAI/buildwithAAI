"""Fetch helpers on top of rpc.RPC (stdlib only, no case data).

get_tx(rpc, sig): getTransaction (jsonParsed) with maxSupportedTransactionVersion
1, because wallets in these audits send version-1 transactions, which a
version-0 request cannot read (-32015). Answers are cached by RPC.

fetch_many(rpc, sigs, log_every=200): fetch a list of signature rows
(getSignaturesForAddress output), skipping failed ones (row["err"]).
"""

import json
import os
import time

_LAST_BLOCK = 0.0

from rpc import RPCError


def get_tx(rpc, sig):
    """getTransaction (jsonParsed). Asks for maxSupportedTransactionVersion 1,
    which returns legacy, v0 and v1 transactions alike (with 0, a v1 transaction
    is refused with -32015, which would cost a second call). A cached answer
    from an earlier version-0 request is reused."""
    p0 = [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0, "commitment": "finalized"}]
    p1 = [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 1, "commitment": "finalized"}]
    for p in (p1, p0):
        if os.path.exists(rpc._path("getTransaction", p)):
            return rpc.call("getTransaction", p)
    return rpc.call("getTransaction", p1)


def fetch_many(rpc, rows, log_every=200, log=print):
    out = {}
    n = 0
    for r in rows:
        if r.get("err"):
            continue
        out[r["signature"]] = get_tx(rpc, r["signature"])
        n += 1
        if log and log_every and n % log_every == 0:
            log(f"  fetched {n} txs ({rpc.stats})")
    return out


# ------------------------------------------------------------ time cursors
def _block_time(rpc, slot, tries=8):
    """(slot, blockTime) of the first non-skipped slot at or after `slot`."""
    for _ in range(tries):
        try:
            t = rpc.call("getBlockTime", [slot])
            if t:
                return slot, t
        except RPCError:
            pass
        slot += 1
    raise RPCError(f"no block found near slot {slot}")


def slot_at_time(rpc, t_target, tol=2):
    """Slot whose blockTime is within `tol` s of t_target (secant search)."""
    cur = rpc.call("getSlot", [{"commitment": "finalized"}], refresh=True)
    b = _block_time(rpc, cur - 500)
    a = _block_time(rpc, b[0] - int(max(1, (b[1] - t_target)) / 0.4))
    for _ in range(20):
        (sa, ta), (sb, tb) = a, b
        if abs(tb - t_target) <= tol:
            return b
        if tb == ta:
            b = _block_time(rpc, sb + (1 if t_target > tb else -400))
            continue
        s = int(sb + (t_target - tb) * (sb - sa) / (tb - ta))
        a, b = b, _block_time(rpc, s)
    return b


def cursor_at_time(rpc, t_target):
    """A transaction signature from a block at ~t_target.

    getSignaturesForAddress accepts any signature as its `before` cursor and
    pages backwards from that signature's slot, so this lets a scan start at a
    chosen time instead of paging down from the newest activity.
    Returns (signature, slot, blockTime). Memoised per target time in
    <cache_dir>/cursors.json so reruns hit the same cached pages."""
    memo_path = os.path.join(rpc.cache_dir, "cursors.json")
    try:
        memo = json.load(open(memo_path))
    except (OSError, ValueError):
        memo = {}
    if str(int(t_target)) in memo:
        return tuple(memo[str(int(t_target))])
    slot, bt = slot_at_time(rpc, t_target)
    blk = rpc.call("getBlock", [slot, {"transactionDetails": "signatures", "rewards": False,
                                       "maxSupportedTransactionVersion": 1, "commitment": "finalized"}])
    res = (blk["signatures"][-1], slot, bt)
    memo[str(int(t_target))] = list(res)
    with open(memo_path + ".tmp", "w") as f:
        json.dump(memo, f)
    os.replace(memo_path + ".tmp", memo_path)
    return res


def block_accounts(rpc, slot):
    """getBlock in 'accounts' mode: every tx in the slot, in block order, with
    signer flags and pre/post SOL and token balances (no instructions or logs).
    The list position is the transaction index used for same-slot ordering.
    A program invoked by CPI must be listed in the tx's account keys, so venue can
    be read from the keys.

    Blocks are ~5 MB of JSON, so the raw response is kept gzip-compressed
    (<cache>/getBlock/<sha256>.json.gz) instead of as plain JSON."""
    import gzip
    params = [slot, {"encoding": "jsonParsed", "transactionDetails": "accounts",
                     "rewards": False, "maxSupportedTransactionVersion": 1,
                     "commitment": "finalized"}]
    plain = rpc._path("getBlock", params)
    gz = plain + ".gz"
    if os.path.exists(gz):
        with gzip.open(gz, "rt") as f:
            return json.load(f)["result"]
    # mainnet-beta allows getBlock 6 times per 10 s per IP: keep this process
    # at <= 1 call per 1.8 s on top of RPC's own pacing.
    global _LAST_BLOCK
    wait = _LAST_BLOCK + 1.8 - time.time()
    if wait > 0:
        time.sleep(wait)
    res = rpc.call("getBlock", params)
    _LAST_BLOCK = time.time()
    if os.path.exists(plain):
        with open(plain, "rb") as fi, gzip.open(gz + ".tmp", "wb", compresslevel=6) as fo:
            fo.write(fi.read())
        os.replace(gz + ".tmp", gz)
        os.remove(plain)
    return res


def block_tx_as_tx(block, i, slot):
    """Wrap block['transactions'][i] (accounts mode) so trades.parse_wallet_trades
    and friends can read it like a getTransaction result. Instructions are absent,
    so venue must come from account keys (see venue_from_keys)."""
    t = block["transactions"][i]
    return {"transaction": {"message": {"accountKeys": t["transaction"]["accountKeys"], "instructions": []},
                            "signatures": t["transaction"]["signatures"]},
            "meta": t["meta"], "blockTime": block.get("blockTime"), "slot": slot, "tx_index": i,
            "version": t.get("version")}


def venue_from_keys(tx):
    keys = {k["pubkey"] if isinstance(k, dict) else k for k in tx["transaction"]["message"]["accountKeys"]}
    if "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" in keys:
        return "pumpfun"
    if "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA" in keys:
        return "pumpswap"
    return "other"
