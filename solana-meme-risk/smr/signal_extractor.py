"""Stage 4 - signal extraction. Pipeline order:
   early buyers -> anchored funding traces -> clusters -> signals (-> rules -> risk score)
Independent I/O (mint authorities, serial-deployer outcome measurement) runs concurrently with tracing."""
from __future__ import annotations
import time
from concurrent.futures import ThreadPoolExecutor
from . import config as C, logging_setup as L
from .early_buyer_extractor import extract_early_buyers
from .batch_tracer import BatchTracer
from .cluster_extractor import extract_clusters
from . import data_extractors as dx

log = L.get("signals")
COIN_FIELDS = ("name", "symbol", "creator", "created_timestamp", "complete", "usd_market_cap", "bonding_curve", "pool_address",
               "quote_mint", "program")


def extract_signals(ctx, mint, *, as_of=None, n_buyers=None, hops=None, trace_limit=None, coin=None, progress=None):
    s = ctx.settings
    t0 = time.time(); tm = {}
    say = progress or (lambda m: None)
    warnings = []
    if coin is None:
        try:
            coin = ctx.pumpfun.coin(mint) or {}
        except Exception as e:
            coin = {}; warnings.append(f"pump.fun API unavailable: {e}")
    if not coin:
        warnings.append("pump.fun API has no record of this mint; using on-chain data only")
    now = ctx.clock()
    live = as_of is None or as_of >= now - 120

    say("early buyers"); t = time.time()
    early = extract_early_buyers(ctx, mint, as_of=as_of, n=n_buyers, coin=coin)
    tm["early_buyers_s"] = round(time.time() - t, 2)
    create_time = (early.get("creation") or {}).get("block_time") or (coin.get("created_timestamp") or 0) / 1000 or None
    t_ref = early["as_of"]

    pool = ThreadPoolExecutor(3)
    f_auth = pool.submit(dx.mint_authorities, ctx, mint)
    t_serial = int(create_time or t_ref)
    f_serial = pool.submit(dx.serial_deployer, ctx, early.get("creator"), t_serial, (early.get("creation") or {}).get("signature"))

    say("funding traces"); t = time.time()
    tracer = BatchTracer(ctx)
    wallets = []
    c = early.get("creation") or {}
    if early.get("creator") and c.get("signature"):
        wallets.append({"wallet": early["creator"], "role": "deployer", "anchor_sig": c["signature"], "anchor_time": c.get("block_time")})
    for b in early["buyers"]:
        if b["wallet"] != early.get("creator"):
            wallets.append({"wallet": b["wallet"], "role": "early_buyer", "anchor_sig": b["signature"], "anchor_time": b["block_time"]})
    if trace_limit:
        wallets = wallets[:trace_limit]
    traces = tracer.trace(mint, wallets, hops=hops) if wallets else {}
    tm["funding_traces_s"] = round(time.time() - t, 2)

    say("clusters"); t = time.time()
    auth = f_auth.result()
    holders = dx.holder_concentration(ctx, mint, early, coin, auth, live)
    clusters = extract_clusters(early, traces, window_h=s.funding_window_hours,
                                balances=holders.get("balances") if holders.get("source") else None,
                                balances_complete=bool(holders.get("source")))
    tm["clusters_holders_s"] = round(time.time() - t, 2)

    say("deployer / serial / liquidity"); t = time.time()
    proxy = dx.deployer_proxy(early, traces)
    funder = proxy.get("deployer_primary_funder")
    f_fserial = pool.submit(dx.serial_deployer, ctx, funder, t_serial, None, False) if funder and not ctx.labels.is_non_linking(funder) else None
    liq = dx.liquidity(ctx, mint, coin, early, live)
    serial = f_serial.result()
    funder_serial = f_fserial.result() if f_fserial else None
    pool.shutdown()
    tm["serial_liquidity_s"] = round(time.time() - t, 2)

    fresh = dx.fresh_wallets(early, traces, s.fresh_wallet_hours)
    slot = dx.same_slot_buys(early)
    traced = [w["wallet"] for w in wallets]
    infos = [(traces.get(w) or {}).get("info") or {} for w in traced]
    creator_bought = sum(b["token_amount_raw"] for b in early["buyers"] if b["is_creator"])
    tm["total_s"] = round(time.time() - t0, 2)
    return {
        "mint": mint, "as_of": t_ref, "mode": early["mode"], "create_time": create_time,
        "coin": {k: coin.get(k) for k in COIN_FIELDS},
        "early": early, "traces": traces, "clusters": clusters, "same_slot": slot, "deployer": proxy, "fresh": fresh,
        "authorities": auth, "holders": holders, "serial": serial, "funder_serial": funder_serial, "liquidity": liq,
        "creator_flow": {"bought_raw": creator_bought, "sold_raw": early.get("creator_sold_raw", 0),
                         "sold_pct_of_bought": round(100 * early.get("creator_sold_raw", 0) / creator_bought, 1) if creator_bought else None},
        "coverage": {
            "wallets_traced": len(traced),
            "wallet_histories_complete": sum(1 for i in infos if i.get("history_complete")),
            "hub_wallets": sum(1 for i in infos if i.get("is_hub")),
            "labeled_wallets": sum(1 for i in infos if i.get("label")),
            "early_history_complete": early["history_complete"], "holdings_source": holders.get("source"),
            "window_txs_total": early["window_txs_total"], "window_txs_fetched": early["window_txs_fetched"],
            "tracer": tracer.stats, "graph_db_counts": ctx.graph.counts(),
            "warnings": (warnings + early.get("warnings", []) + holders.get("warnings", []) + tracer.warnings)[:40],
        },
        "timings": tm,
    }
