"""vet(mint) orchestration: fetch facts under a wall-clock budget, evaluate pure checks, fail closed.
DESIGN/REFERENCE ONLY. Read-only public data; never signs, trades, or touches keys. Never calls the pump.fun API."""
from __future__ import annotations
import os, subprocess, threading, time
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_EXCEPTION
from .schema import VetResult, CHECKS, aggregate
from .validate import validate_mint
from .vconfig import VetConfig
from . import checks as K, onchain as O
from .. import config as C
from ..cache import make_key

_SLOW: dict = {}
_SLOW_LOCK = threading.Lock()
_CODE_VERSION = None


def code_version():
    global _CODE_VERSION
    if _CODE_VERSION is None:
        try:
            _CODE_VERSION = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=C.ROOT, capture_output=True, text=True,
                                           timeout=5).stdout.strip() or "unknown"
        except Exception:
            _CODE_VERSION = "unknown"
    return _CODE_VERSION


class NoPumpFunApi:
    """The pump.fun frontend API returns Cloudflare 403 to this box. The gate never calls it (and never bypasses it)."""
    def __getattr__(self, name):
        def _refuse(*a, **k):
            raise RuntimeError("pump.fun API disabled in the vet gate (403; not bypassed)")
        return _refuse


_ctx = None
_ctx_lock = threading.Lock()


def vet_context(cfg: VetConfig | None = None):
    """Shared pipeline Context with gate overrides: serial lookback limited to what free RPC can backfill
    (publicnode serves ~33 h of signature history), and the pump.fun API replaced by a refusing stub."""
    global _ctx
    cfg = cfg or VetConfig()
    with _ctx_lock:
        if _ctx is None:
            from dataclasses import replace
            from ..context import Context
            _ctx = Context(settings=replace(C.load_settings(), serial_lookback_hours=cfg.serial_lookback_h, max_launch_txs=cfg.max_launch_txs))
            _ctx.pumpfun = NoPumpFunApi()
        return _ctx


def _run(name, fn, sources):
    """Execute a fact fetcher; never raises. Adds latency_ms/as_of/sources/error."""
    t = time.monotonic()
    try:
        f = fn()
        if isinstance(f, tuple):
            f, slot = f
        else:
            slot = None
        f = dict(f or {})
        if slot:
            f["slot"] = slot
    except Exception as e:      # any source failure -> fact error -> check UNKNOWN
        f = {"error": f"{type(e).__name__}: {e}"[:200]}
    f.setdefault("as_of", time.time())
    f["latency_ms"] = int((time.monotonic() - t) * 1000)
    f["sources"] = sources
    return name, f


def _collect(futs, deadline, F, timings):
    left = max(0.0, deadline - time.monotonic())
    done, pending = wait(futs, timeout=left)
    for fu in done:
        name, f = fu.result()
        F[name] = f
        timings[name] = f["latency_ms"]
    for fu in pending:
        n = futs[fu]
        F[n] = {"error": "timeout (budget exhausted)", "as_of": time.time(), "latency_ms": None, "sources": []}
        timings[n] = None
        fu.cancel()


def _slow_facts(ctx, mint, F, cfg, pool, deadline, timings):
    """early buyers -> (traces || serial). Cached per mint for cfg.slow_ttl_s (they describe the launch, not the present)."""
    try:
        _slow_facts_inner(ctx, mint, F, cfg, pool, deadline, timings)
    except RuntimeError:      # pool shut down after the budget expired: the caller already marked these facts as timeouts
        pass


def _slow_facts_inner(ctx, mint, F, cfg, pool, deadline, timings):
    from ..early_buyer_extractor import extract_early_buyers
    from ..batch_tracer import BatchTracer
    from .. import data_extractors as dx
    cv = F.get("curve") or {}
    coin = {"creator": cv.get("creator"), "bonding_curve": cv.get("curve_address")}

    hint = (F.get("dex") or {}).get("created_hint")

    def early():
        """First buyers in the first cfg.early_window_s after the create tx (point-in-time, like the backtest's as-of
        scoring): find the create tx on-chain, then page the mint's signatures BEFORE an anchor at create+window."""
        cr = O.find_creation_time(ctx, mint, hint)
        if not cr:
            raise LookupError("creation time not found on-chain (older than ~33 h or create-stream anchors missing)")
        e = None
        for w in cfg.early_windows_s:      # hot coins have >10k (mostly failed bot) sigs in 5 min: shrink the window
            as_of = int(cr["t_after"]) + w
            if as_of < time.time() - 120 and not ctx.anchors.anchor_at(as_of, max_pages=0):
                raise LookupError("no create-stream anchor at create+window (index gap); point-in-time query impossible")
            e = extract_early_buyers(ctx, mint, as_of=min(as_of, int(time.time())), n=cfg.early_buyers_n, coin=coin,
                                     max_sig_pages=cfg.max_sig_pages)
            e["window_s"] = w
            if e.get("history_complete"):
                break
        e["creation_lookup"] = cr
        e["as_of"] = time.time()
        return e
    fut = {pool.submit(_run, "early", early, ["rpc:getSignaturesForAddress", "rpc:getTransaction"]): "early"}
    _collect(fut, deadline, F, timings)
    e = F["early"]
    if e.get("error") or not e.get("creation"):
        for n in ("traces", "serial"):
            F[n] = {"error": "early buyers unavailable", "as_of": time.time(), "sources": []}
        return
    c = e["creation"]
    wallets = []
    if e.get("creator") and c.get("signature"):
        wallets.append({"wallet": e["creator"], "role": "deployer", "anchor_sig": c["signature"], "anchor_time": c.get("block_time")})
    wallets += [{"wallet": b["wallet"], "role": "early_buyer", "anchor_sig": b["signature"], "anchor_time": b["block_time"]}
                for b in e["buyers"] if b["wallet"] != e.get("creator")]

    def traces():
        tr = BatchTracer(ctx)
        out = tr.trace(mint, wallets, hops=cfg.trace_hops) if wallets else {}
        ok = sum(1 for w in wallets if (out.get(w["wallet"]) or {}).get("info"))
        return {"traces": out, "wallets": len(wallets), "coverage": round(ok / len(wallets), 3) if wallets else None,
                "hops": cfg.trace_hops, "tracer_stats": tr.stats, "as_of": time.time()}

    def serial():
        s = dx.serial_deployer(ctx, e.get("creator"), int(c.get("block_time") or time.time()), c.get("signature"), cfg.serial_measure)
        s = dict(s or {"error": "no creator"})
        s["as_of"] = time.time()
        return s
    futs = {pool.submit(_run, "traces", traces, ["rpc:getSignaturesForAddress", "rpc:getTransaction", "funding_graph.db"]): "traces",
            pool.submit(_run, "serial", serial, ["rpc:getSignaturesForAddress", "rpc:getTransaction", "launches.db(create stream)"]): "serial"}
    _collect(futs, deadline, F, timings)


def _derive(ctx, F, cfg):
    """Pure-ish derivations that need several facts (clusters, fresh ratio, market cap)."""
    from ..cluster_extractor import extract_clusters
    from .. import data_extractors as dx
    cv, mt, px = F.get("curve") or {}, F.get("mint") or {}, F.get("sol_usd") or {}
    supply = mt.get("supply_raw")
    if cv.get("found") and not cv.get("error"):
        src = F.get("pool") if cv.get("complete") else None
        if cv.get("complete"):
            m = O.pool_market(src or {}, px.get("price"))
        else:
            m = O.curve_market(cv, px.get("price"))
        F["market_onchain"] = m
    e, t = F.get("early") or {}, F.get("traces") or {}
    if not e.get("error") and not t.get("error") and e.get("creation"):
        hm = K.holder_metrics(F) if (F.get("holders") and not F["holders"].get("error")) else None
        F["clusters"] = extract_clusters(e, t.get("traces") or {}, window_h=ctx.settings.funding_window_hours,
                                         balances=hm["balances"] if hm else None, balances_complete=bool(hm))
        fr = dx.fresh_wallets(e, t.get("traces") or {}, ctx.settings.fresh_wallet_hours)
        fr["latency_ms"] = t.get("latency_ms")
        F["fresh"] = {k: v for k, v in fr.items() if k != "fresh_wallets"}
    elif t.get("error") or e.get("error"):
        F["fresh"] = {"error": t.get("error") or e.get("error")}


def gather(mint, ctx, cfg, *, use_cache=True):
    """-> (facts, timings_ms, cache_info). Never raises."""
    t0 = time.monotonic()
    deadline = t0 + cfg.budget_s
    F, timings, cache = {"mint_address": mint}, {}, {"slow_facts": "miss"}
    pool = ThreadPoolExecutor(8)     # not a context manager: its exit would wait for timed-out work and break the budget
    try:
        fast = {pool.submit(_run, "curve", lambda: O.read_curve(ctx, mint), ["rpc:getAccountInfo(bonding_curve)"]): "curve",
                pool.submit(_run, "mint", lambda: O.read_mint(ctx, mint), ["rpc:getAccountInfo(mint)"]): "mint",
                pool.submit(_run, "sol_usd", lambda: dict(zip(("price", "as_of"), O.sol_usd(ctx))), ["dexscreener"]): "sol_usd",
                pool.submit(_run, "dex", lambda: O.dex_market(ctx, mint), ["dexscreener"]): "dex"}
        _collect(fast, min(deadline, t0 + cfg.fast_stage_s), F, timings)
        cv, mt = F.get("curve") or {}, F.get("mint") or {}
        timings["fast_stage_total"] = int((time.monotonic() - t0) * 1000)
        if cv.get("error") or not cv.get("found") or cv.get("owner") != C.PUMP_PROGRAM or cv.get("quote_mint") not in (None, "SOL"):
            return F, timings, {"slow_facts": "skipped (not a SOL-quoted pump.fun curve)"}   # authority check will FAIL/UNKNOWN
        stage2 = {pool.submit(_run, "holders", lambda: dict(zip(("balances", "as_of"), O.read_holders(
                      ctx, mint, mt.get("token_program") or C.TOKEN_2022_PROGRAM))), ["rpc:getProgramAccounts(mainnet-beta)"]): "holders"}
        if cv.get("complete"):
            stage2[pool.submit(_run, "pool", lambda: O.read_pool(ctx, mint), ["rpc:getMultipleAccounts(pumpswap pool, lp mint)"])] = "pool"
        slow_deadline = deadline - cfg.refresh_reserve_s
        slow_hit = None
        if use_cache:
            with _SLOW_LOCK:
                hit = _SLOW.get(mint)
            if not hit:
                try:      # persisted so a CLI recheck (new process) can reuse the launch facts
                    d = ctx.cache.get(make_key("vet_slow", mint, cfg.version), cfg.slow_ttl_s)
                    hit = (d["ts"], d["facts"]) if isinstance(d, dict) and "ts" in d else None
                except Exception:
                    hit = None
            if hit and time.time() - hit[0] <= cfg.slow_ttl_s:
                slow_hit = hit
        if slow_hit:
            F.update(slow_hit[1]); cache = {"slow_facts": "hit", "slow_facts_age_s": round(time.time() - slow_hit[0], 1)}
            for n in ("early", "traces", "serial"):
                timings[n] = 0
            _collect(stage2, slow_deadline, F, timings)
        else:
            S, ST = {"curve": F.get("curve")}, {}     # slow thread writes here only; copied once at the deadline
            th = threading.Thread(target=_slow_facts, args=(ctx, mint, S, cfg, pool, slow_deadline, ST), daemon=True)
            th.start()
            _collect(stage2, slow_deadline, F, timings)
            th.join(max(0.0, slow_deadline - time.monotonic()))
            snap, tsnap = dict(S), dict(ST)
            for n in ("early", "traces", "serial"):
                if n in snap:
                    F[n] = snap[n]; timings[n] = tsnap.get(n)
            for n in ("early", "traces", "serial"):
                F.setdefault(n, {"error": "timeout (budget exhausted)", "as_of": time.time(), "sources": []})
                timings.setdefault(n, None)
            if all(not (F.get(n) or {}).get("error") for n in ("early", "traces", "serial")):
                entry = (min(F[n]["as_of"] for n in ("early", "traces", "serial")), {n: F[n] for n in ("early", "traces", "serial")})
                with _SLOW_LOCK:
                    _SLOW[mint] = entry
                if use_cache:
                    try:
                        ctx.cache.set(make_key("vet_slow", mint, cfg.version), {"ts": entry[0], "facts": entry[1]}, cfg.slow_ttl_s)
                    except Exception:
                        pass
        # Final refresh of mutable facts, so evaluation never uses reads taken before the slow stage.
        refresh = {pool.submit(_run, "curve", lambda: O.read_curve(ctx, mint), ["rpc:getAccountInfo(bonding_curve)"]): "curve",
                   pool.submit(_run, "mint", lambda: O.read_mint(ctx, mint), ["rpc:getAccountInfo(mint)"]): "mint",
                   pool.submit(_run, "dex", lambda: O.dex_market(ctx, mint), ["dexscreener"]): "dex"}
        if cv.get("complete"):
            refresh[pool.submit(_run, "pool", lambda: O.read_pool(ctx, mint), ["rpc:getMultipleAccounts(pumpswap pool, lp mint)"])] = "pool"
        if time.time() - (F.get("holders") or {}).get("as_of", 0) > cfg.max_holders_age_s / 2:
            refresh[pool.submit(_run, "holders", lambda: dict(zip(("balances", "as_of"), O.read_holders(
                ctx, mint, mt.get("token_program") or C.TOKEN_2022_PROGRAM))), ["rpc:getProgramAccounts(mainnet-beta)"])] = "holders"
        t_ref = time.monotonic()
        rt = {}
        _collect(refresh, deadline, F, rt)
        timings.update({f"refresh_{k}": v for k, v in rt.items()})
        timings["refresh_total"] = int((time.monotonic() - t_ref) * 1000)
        hm_owners = []
        h = F.get("holders") or {}
        if h.get("balances"):
            ex = K._excluded_owners(F)
            hm_owners = [o for o, _ in sorted(((o, v) for o, v in h["balances"].items() if o not in ex), key=lambda kv: -kv[1])[:15]]
        name, po = _run("program_owned", lambda: {"owners": O.program_owned(ctx, hm_owners)}, ["rpc:getMultipleAccounts"])
        F["program_owned"] = po.get("owners") or {}
        timings["program_owned"] = po["latency_ms"]
        if po.get("error"):
            F["holders"] = {"error": "program-owned exclusion failed: " + po["error"], "as_of": time.time()}
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    _derive(ctx, F, cfg)
    return F, timings, cache


def evaluate(F, cfg, now):
    T = cfg.thresholds
    out = {}
    for n in CHECKS:
        out[n] = K.ALL[n](F, T, now, cfg)
    return out


def vet(mint, *, ctx=None, cfg: VetConfig | None = None, use_cache=True, clock=time.time) -> VetResult:
    """Vet one mint. Returns a VetResult; never raises for data problems (they become UNKNOWN).
    The caller (executor) must allow a buy only if result.allow is True and the result is younger than cfg.result_ttl_s."""
    cfg = cfg or VetConfig()
    t0 = time.monotonic()
    ok, code, info = validate_mint(mint)
    F = {"input": {"ok": ok, "code": code, **info}}
    timings, cache = {}, {}
    if ok:
        ctx = ctx or vet_context(cfg)
        G, timings, cache = gather(mint, ctx, cfg, use_cache=use_cache)
        F.update(G)
    now = clock()
    checks = evaluate(F, cfg, now) if ok else {"input": K.check_input(F, cfg.thresholds, now, cfg)}
    verdict = aggregate(checks)
    stamps = [c.data_as_of for c in checks.values() if c.data_as_of]
    srcs = [s for c in checks.values() for s in c.sources]
    return VetResult(mint=mint if isinstance(mint, str) and ok else "<invalid>", verdict=verdict, checks=checks, evaluated_at=now,
                     valid_until=now + cfg.result_ttl_s, latency_ms=int((time.monotonic() - t0) * 1000), budget_ms=int(cfg.budget_s * 1000),
                     config_version=cfg.version, code_version=code_version(), sources_used=srcs,
                     data_as_of={"oldest": min(stamps) if stamps else None, "newest": max(stamps) if stamps else None},
                     cache={**cache, "fact_latency_ms": timings})
