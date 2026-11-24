"""Whole-market scanner daemon for the `scanner` paper book (SIMULATION ONLY: no wallets, keys, signing or orders).

Every 5 min, as a plain local process (no LLM / agent calls, no StalkChain or X calls, no pump.fun API):
  1. discover  DexScreener token-boosts (latest + top), token-profiles, community-takeovers and a few /latest/dex/search
               queries (Solana only), plus GeckoTerminal solana trending_pools + new_pools when the GeckoTerminal budget shared
               with the 1-min exit watcher (smr/paper/gtshare.py, 4 calls/min in total, 5-min pause after any 429) allows.
  2. quote     one DexScreener /tokens/v1 batch per 30 mints (price, liquidity, market cap, m5/h1 txns + volume, pair age).
  3. prefilter market cap bounds (min_mcap_usd / max_mcap_usd; either may be disabled), liquidity >= min_liq_usd, liquidity-vs-market-cap sanity
               (gates.quote_sanity), minimum 1h volume / txns, not dumping (1h change > -60%), not already traded.
  4. runner    transparent "runner score" (runner_score() below) for every survivor; logged to scanner_candidates.
  5. risk      the live risk model (version unchanged; SKIP >= 40, REDUCED >= 35 from the deployed thresholds) through
               smr.pipeline.score_mint with the reduced health-check parameters (15 early buyers, 1 hop, 8 traced wallets),
               for the best few survivors not scored recently (dedupe: scanner_scores cache, or the paper cycle's own score).
               Hard rug flags -> SKIP. Cached StalkChain holder reads (data/holder_cache.json, ingested by the routine) can
               add a holder count or a veto; nothing is fetched from StalkChain here.
  6. gates     the entry gates of the live books: price-source disagreement hold (DexScreener vs GeckoTerminal > 25%),
               market cap > $30k on circulating supply, liquidity sanity, liquidity / holder market gates, the Mayhem gate
               (pump.fun Mayhem coins and unknown status never enter; non-pump.fun mints have no bonding curve -> not
               Mayhem), and the bundle gate.
  7. enter     only when the momentum book's own selection passes (smr.momentum.combine: same sizing tiers, REDUCED cap)
               AND runner_score >= min_runner. Conservative fill = max(decision quote, close of the entry minute's 1-min
               candle from GeckoTerminal; DexScreener re-quote if the candle is unavailable). BUY event (book='scanner').
Exits: the 1-min exit watcher steps scanner positions exactly like momentum_clip5_rug_dust (clip5 rungs + rug rule
(1-min close <= 0.65x the previous) + 5% dust bag) and writes PARTIAL_SELL / SELL events for them.

The runner score does NOT predict a 100x. It is a logged, documented ranking of "accelerating right now" so its value can be
measured later against what the coins actually did (scanner_candidates keeps every scored candidate)."""
from __future__ import annotations
import fcntl, json, logging, logging.handlers, os, re, signal, subprocess, sys, threading, time
from collections import deque
from dataclasses import dataclass, asdict, fields as dc_fields
from . import costs as K
from . import gates as G
from . import sigexit as SX
from .engine import (SCANNER_BOOK, EXPERIMENT100_BOOK, DEFAULT_END, DEFAULT_MIN_MCAP_USD, PUMP_CURVE_SUPPLY, MAYHEM_AGENT, book_state, circulating_supply,
                     fdv_of, iso_ct, safe_reason, _buy_payload, start_bankroll_for)
from .sanitize import safe_field

DEFAULT_INTERVAL_S = 300
STALE_FACTOR = 5
LEASE_KEY = "scanner_lease"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
B58 = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
SIG = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{64,90}$")
DEX_LISTS = ("/token-boosts/latest/v1", "/token-boosts/top/v1", "/token-profiles/latest/v1", "/community-takeovers/latest/v1")
# majors / stables / wrapped assets are not meme candidates
EXCLUDE = {"So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
           "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
           "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
           "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
           "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"}


@dataclass
class ScannerConfig:
    interval_s: int = DEFAULT_INTERVAL_S
    min_mcap_usd: float = DEFAULT_MIN_MCAP_USD          # arbitrary floor; 0 = disabled (experiment100 mcap flex)
    max_mcap_usd: float | None = 50_000_000.0           # arbitrary ceiling; None = disabled (experiment100 mcap flex)
    mcap_policy_version: str | None = None              # e.g. mcap_flex_20261105-v1 stamped on entries
    band_lo_usd: float = 30_000.0
    band_hi_usd: float = 3_000_000.0
    min_liq_usd: float = 5_000.0
    min_vol_h1_usd: float = 5_000.0
    min_txns_h1: int = 30
    max_drop_h1_pct: float = -60.0
    search_queries: tuple = ("pump", "bonk", "meme", "pumpswap")
    max_quote_mints: int = 150                          # 5 DexScreener batch calls at most
    gt_discovery: bool = True                           # GeckoTerminal trending_pools + new_pools (2 calls, shared budget)
    score_per_cycle: int = 4                            # new live risk scores per cycle (each ~15-100 s of RPC)
    score_parallel: int = 3
    score_timeout_s: float = 150.0
    rescore_after_s: float = 6 * 3600
    retry_failed_after_s: float = 3600
    max_abandoned_threads: int = 6
    n_buyers: int = 15                                  # reduced params, same as the health check
    hops: int = 1
    trace_limit: int = 8
    min_runner: float = 60.0
    prescore_runner: float = 50.0                       # only survivors at or above this are risk-scored
    max_open: int = 12
    max_new_per_cycle: int = 3
    # experiment100 concurrency sleeve (defaults inert for legacy scanner book)
    max_open_notional_usd: float | None = None   # cap on sum(size_usd of open); None = no notional cap
    reserve_cash_usd: float | None = None        # free cash floor entries may not breach (fees+size from above-reserve only)
    entry_wait_s: float = 15.0                          # after the entry minute closes, wait this long for the candle
    end_ts: float | None = DEFAULT_END                  # None = no new-entry cutoff (experiment100); still paper-only
    obs_keep_s: float = 3 * 86400
    book: str = SCANNER_BOOK                            # positions.book / events.book
    start_bankroll: float | None = None                 # None -> start_bankroll_for(book)
    sizing_mode: str = "pct"                            # pct (legacy scanner) | fixed (experiment100 $1/$2)
    fixed_entry_usd: float = 1.0
    tier2_cash_usd: float = 250.0                       # available cash (not floating) before $2 entries
    tier2_entry_usd: float = 2.0
    require_quality_preentry: bool = False              # True: fresh StalkChain quality must clear BEFORE fill
    quality_cache_max_age_s: int = 1800
    paper_only: bool = True                             # hard safeguard; never enables live trading
    live_trading: bool = False                          # must stay false; start() refuses if true
    source: str = "defaults"

    @classmethod
    def load(cls, path=None):
        path = path or os.path.join(ROOT, "data", "scanner.json")
        c = cls()
        try:
            with open(path) as f:
                d = json.load(f)
        except (OSError, ValueError):
            return c
        names = {f.name for f in dc_fields(cls)}
        for k, v in (d or {}).items():
            if k in names and k != "source":
                if k in ("end_ts", "max_mcap_usd", "max_open_notional_usd", "reserve_cash_usd", "mcap_policy_version") and v is None:
                    setattr(c, k, None)
                else:
                    setattr(c, k, tuple(v) if k == "search_queries" else v)
        if c.start_bankroll is None:
            c.start_bankroll = start_bankroll_for(c.book)
        c.source = path
        return c


# ---- runner score (pure; documented in docs/paper_trading.md) --------------------------------------------------------
RUNNER_WEIGHTS = {"vol_accel": 20, "buy_pressure": 15, "buyer_growth": 15, "liq_growth": 10, "mcap_band": 15, "age": 10,
                  "holder_growth": 5, "x_heat": 10}
RUNNER_MIN_COVERAGE = 0.6


def _f(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v and abs(v) != float("inf") else None


def _ramp(x, lo, hi):
    if x is None:
        return None
    return max(0.0, min(1.0, (x - lo) / (hi - lo))) if hi > lo else float(x >= hi)


def runner_score(raw, gt=None, mcap=None, liq=None, age_h=None, liq_then=None, holders=None, holders_then=None, x_points=None,
                 x_max=10.0, cfg: ScannerConfig | None = None):
    """-> {"score" 0..100 | None, "coverage", "components", "signals"}. Each feature is 0..1 (None = unknown, dropped and
    the weights renormalised); score None when under 60% of the weight is known.
      vol_accel     5-min volume annualised to 1h vs the last hour: (vol_m5 x 12) / vol_h1, 1x -> 0, 3x -> 1
      buy_pressure  buys / (buys + sells), 0.6 x m5 + 0.4 x h1, 50% -> 0, 65% -> 1
      buyer_growth  GeckoTerminal unique buyers (m5 x 12) / h1, 1x -> 0, 2.5x -> 1; without GeckoTerminal the DexScreener buy
                    COUNT growth (buys_m5 x 12 / buys_h1) is used as a proxy (flagged in signals)
      liq_growth    liquidity now / liquidity at the scanner's own observation 20-90 min ago, 1.0x -> 0, 1.5x -> 1
      mcap_band     1 inside $30k-$3M; 0 under $30k; $3M-$10M falls 1 -> 0.3; above $10M 0.1
      age           pair age: < 15 min 0.4; 15 min - 48 h 1; 48 h - 7 d falls to 0.4; older 0.2
      holder_growth holders now / holders 20-90 min ago (only when a count is known: cached StalkChain / score), 1.0 -> 0, 1.3 -> 1
      x_heat        fresh X heat points already ingested by the routine (data/x_heat.json) / max points; neutral (unknown) otherwise"""
    cfg = cfg or ScannerConfig()
    raw, g = raw or {}, gt or {}
    v5, v1 = _f(raw.get("vol_m5")), _f(raw.get("vol_h1"))
    accel = v5 * 12 / v1 if v5 is not None and v1 else None
    def ratio(b, s):
        b, s = _f(b), _f(s)
        return b / (b + s) if b is not None and s is not None and b + s > 0 else None
    r5, r1 = ratio(raw.get("buys_m5"), raw.get("sells_m5")), ratio(raw.get("buys_h1"), raw.get("sells_h1"))
    br = 0.6 * r5 + 0.4 * r1 if r5 is not None and r1 is not None else (r5 if r5 is not None else r1)
    gb5, gb1 = _f(g.get("buyers_m5")), _f(g.get("buyers_h1"))
    bsrc = None
    if gb5 is not None and gb1:
        bg, bsrc = gb5 * 12 / gb1, "gt_unique_buyers"
    else:
        b5, b1 = _f(raw.get("buys_m5")), _f(raw.get("buys_h1"))
        bg = b5 * 12 / b1 if b5 is not None and b1 else None
        bsrc = "dexscreener_buy_count_proxy" if bg is not None else None
    lg = liq / liq_then if liq and liq_then else None
    hg = holders / holders_then if holders and holders_then else None
    if mcap is None:
        band = None
    elif mcap < cfg.band_lo_usd:
        band = 0.0
    elif mcap <= cfg.band_hi_usd:
        band = 1.0
    elif mcap <= 10_000_000:
        band = 1.0 - 0.7 * (mcap - cfg.band_hi_usd) / (10_000_000 - cfg.band_hi_usd)
    else:
        band = 0.1
    if age_h is None:
        agef = None
    elif age_h < 0.25:
        agef = 0.4
    elif age_h <= 48:
        agef = 1.0
    elif age_h <= 168:
        agef = 1.0 - 0.6 * (age_h - 48) / 120
    else:
        agef = 0.2
    comps = {"vol_accel": _ramp(accel, 1.0, 3.0), "buy_pressure": _ramp(br, 0.50, 0.65), "buyer_growth": _ramp(bg, 1.0, 2.5),
             "liq_growth": _ramp(lg, 1.0, 1.5), "mcap_band": band, "age": agef, "holder_growth": _ramp(hg, 1.0, 1.3),
             "x_heat": None if x_points is None else max(0.0, min(1.0, x_points / (x_max or 10.0)))}
    have = {k: v for k, v in comps.items() if v is not None}
    tot = sum(RUNNER_WEIGHTS.values())
    cov = sum(RUNNER_WEIGHTS[k] for k in have) / tot
    score = round(100 * sum(RUNNER_WEIGHTS[k] * v for k, v in have.items()) / sum(RUNNER_WEIGHTS[k] for k in have), 1) \
        if have and cov >= RUNNER_MIN_COVERAGE else None
    rnd = lambda x, n=3: None if x is None else round(x, n)
    return {"score": score, "coverage": round(cov, 2), "components": {k: rnd(v) for k, v in comps.items()},
            "signals": {"vol_m5_usd": rnd(v5, 0), "vol_h1_usd": rnd(v1, 0), "vol_accel_x": rnd(accel, 2), "buy_ratio_m5": rnd(r5),
                        "buy_ratio_h1": rnd(r1), "buyer_growth_x": rnd(bg, 2), "buyer_growth_source": bsrc,
                        "unique_buyers_m5": gb5, "unique_buyers_h1": gb1, "liq_growth_x": rnd(lg, 3), "holder_growth_x": rnd(hg, 3),
                        "mcap_usd": rnd(mcap, 0), "age_h": rnd(age_h, 2), "x_heat_points": x_points},
            "note": "ranking of current acceleration, logged for later evaluation; not a prediction of a 100x"}


# ---- sources ------------------------------------------------------------------------------------------------------
class GtBudgetError(RuntimeError):
    pass


class SharedGt:
    """GeckoTerminal HttpSource behind the shared watcher+scanner budget: every real request takes one slot first."""
    def __init__(self, h, share, who="scanner"):
        self.h, self.share, self.who = h, share, who
        self.calls = 0
        self.denied = 0
        self.rate_limited = 0

    def get_json(self, path, ttl=0):
        if self.share is not None and not self.share.try_acquire(self.who):
            self.denied += 1
            raise GtBudgetError("geckoterminal shared budget full or paused")
        self.calls += 1
        try:
            return self.h.get_json(path, ttl=0)
        except Exception as e:
            if "429" in str(e) or "circuit open" in str(e):
                self.rate_limited += 1
                if self.share is not None:
                    from .gtshare import PAUSE_S
                    self.share.penalize(self.who, PAUSE_S)
            raise


class _Ctxish:
    def __init__(self, dex_h, gt_h):
        self.dex = type("D", (), {"h": dex_h})()
        self.gt = type("G", (), {"h": gt_h})()


def live_sources(db):
    """DexScreener (single attempt, no disk cache) + GeckoTerminal behind the shared budget."""
    from .. import config as C
    from ..cache import DiskCache
    from ..sources.http import HttpSource
    from .gtshare import GtShare
    from .watcher import gt_share_path
    s = C.load_settings()
    off = DiskCache(":memory:", mode="off")
    dex = HttpSource("dexscreener", s.dexscreener_api, 1.0, off, {"User-Agent": s.http_ua}, max_attempts=1, timeout=20)
    gt = HttpSource("geckoterminal", s.geckoterminal_api, 0.4, off, {"User-Agent": s.http_ua, "Accept": "application/json"}, max_attempts=1, timeout=20)
    return dex, SharedGt(gt, GtShare(gt_share_path(db)))


# ---- the scanner ---------------------------------------------------------------------------------------------------
class Scanner:
    """One instance per process. cycle() is one full scan; every network/scoring dependency is injectable for tests:
       dex_h / gt_h          objects with get_json(path, ttl)
       score_fn(mint)        -> risk_report.v1 doc (default: smr.pipeline.score_mint, reduced params, no pump.fun API)
       chain_fn(mint, create_sig) -> {"supply", "agent_balance", "mayhem", "mayhem_source"} (default: on-chain RPC)
       narrative_fn()        -> narrative index (default: smr.narrative.build_index, DexScreener lists cached 10 min)"""

    def __init__(self, led, dex_h, gt_h=None, *, ctx=None, cfg: ScannerConfig | None = None, clock=time.time, sleep=time.sleep,
                 score_fn=None, chain_fn=None, narrative_fn=None, edge_cfg=None, momentum_cfg=None, thresholds=None,
                 logger=None, pid=None, heartbeat_path=None):
        from .. import config as C
        from ..momentum import MomentumConfig
        from . import edge as EG
        self.led, self.dex_h, self.gt_h, self.ctx = led, dex_h, gt_h, ctx
        self.cfg = cfg or ScannerConfig.load()
        self.clock, self.sleep = clock, sleep
        self.score_fn = score_fn or self._score_live
        self.chain_fn = chain_fn or self._chain_live
        self.narrative_fn = narrative_fn or self._narrative_live
        self.ecfg = edge_cfg or EG.EdgeConfig.load()
        self.mcfg = momentum_cfg or MomentumConfig.load()
        self.thresholds = thresholds or (ctx.settings.thresholds if ctx is not None and hasattr(ctx.settings, "thresholds") else C.Thresholds())
        self.log = logger or logging.getLogger("smr.paper.scanner")
        self.pid = pid or os.getpid()
        self.hb_path = heartbeat_path
        self.calls = {"dexscreener": deque(), "geckoterminal": deque()}
        self.cycles = 0
        self.errors = 0
        self.started = clock()
        self.last = {}
        self._abandoned = []

    # ---- helpers ------------------------------------------------------------------------------------------------
    def _count(self, src, n=1):
        now = self.clock()
        q = self.calls[src]
        q.extend([now] * n)
        while q and q[0] < now - 3600:
            q.popleft()

    def _dex(self, path):
        self._count("dexscreener")
        return self.dex_h.get_json(path, ttl=0)

    def _gt(self, path):
        if self.gt_h is None:
            raise GtBudgetError("geckoterminal disabled")
        before = getattr(self.gt_h, "calls", None)
        try:
            return self.gt_h.get_json(path, ttl=0)
        finally:
            if before is None or getattr(self.gt_h, "calls", 0) > before:
                self._count("geckoterminal")

    # ---- 1) discovery ------------------------------------------------------------------------------------------
    def discover(self, st):
        """-> {mint: {"sources": set, "gt_pool": dict|None}}; Solana base58 mints only, majors/stables excluded."""
        from ..momentum import from_gt_pool
        found = {}
        def add(m, src, gt=None):
            if not isinstance(m, str) or not B58.match(m) or m in EXCLUDE:
                return
            e = found.setdefault(m, {"sources": set(), "gt_pool": None})
            e["sources"].add(src)
            if gt and not e["gt_pool"]:
                e["gt_pool"] = gt
        for path in DEX_LISTS:
            name = path.strip("/").split("/")[0]
            try:
                rows = self._dex(path) or []
            except Exception as e:
                st["errors"].append(f"dexscreener {name}: {type(e).__name__}"[:120]); continue
            for r in rows if isinstance(rows, list) else []:
                if isinstance(r, dict) and r.get("chainId") == "solana":
                    add(r.get("tokenAddress"), name)
        for qy in self.cfg.search_queries:
            try:
                j = self._dex(f"/latest/dex/search?q={qy}") or {}
            except Exception as e:
                st["errors"].append(f"dexscreener search {qy}: {type(e).__name__}"[:120]); continue
            for p in (j.get("pairs") or []) if isinstance(j, dict) else []:
                if isinstance(p, dict) and p.get("chainId") == "solana":
                    add((p.get("baseToken") or {}).get("address"), f"search:{qy}")
        if self.cfg.gt_discovery and self.gt_h is not None:
            for path, name in (("/networks/solana/trending_pools?duration=1h&page=1", "gt_trending_1h"), ("/networks/solana/new_pools?page=1", "gt_new_pools")):
                try:
                    j = self._gt(path) or {}
                except GtBudgetError as e:
                    st["gt_skipped"].append(f"{name}: {e}"); continue
                except Exception as e:
                    st["errors"].append(f"geckoterminal {name}: {type(e).__name__} {str(e)[-40:]}"[:140]); continue
                for d in j.get("data") or []:
                    bt = (((d.get("relationships") or {}).get("base_token") or {}).get("data") or {}).get("id") or ""
                    if bt.startswith("solana_"):
                        add(bt[7:], name, from_gt_pool(d.get("attributes")))
        st["sources"] = {}
        for m, e in found.items():
            for s in e["sources"]:
                k = s.split(":")[0]
                st["sources"][k] = st["sources"].get(k, 0) + 1
        return found

    # ---- 2) quotes ---------------------------------------------------------------------------------------------
    def quote(self, mints, st):
        from .prices import dexscreener_quotes
        mints = list(mints)[: self.cfg.max_quote_mints]
        if not mints:
            return {}
        qs, errs = dexscreener_quotes(_Ctxish(_Counted(self, self.dex_h), None), mints, now=self.clock())
        st["errors"] += errs[:3]
        return qs

    # ---- history (own observations) -----------------------------------------------------------------------------
    def _then(self, mint, now, col):
        r = self.led.one(f"SELECT {col} AS v FROM scanner_obs WHERE mint=? AND at BETWEEN ? AND ? AND {col} IS NOT NULL ORDER BY at LIMIT 1",
                         (mint, now - 90 * 60, now - 20 * 60))
        return r["v"] if r else None

    def _record_obs(self, qs, found, holders, now):
        with self.led.tx():
            for m, q in qs.items():
                mr = q.mom_raw or {}
                gp = (found.get(m) or {}).get("gt_pool") or {}
                self.led.db.execute("INSERT OR IGNORE INTO scanner_obs (mint, at, price, mcap, liq, vol_m5, vol_h1, buys_m5, sells_m5, buys_h1, sells_h1, "
                                    "buyers_m5, buyers_h1, holders) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                                    (m, now, q.price_usd, q.mcap_usd, q.liquidity_usd, mr.get("vol_m5"), mr.get("vol_h1"), mr.get("buys_m5"),
                                     mr.get("sells_m5"), mr.get("buys_h1"), mr.get("sells_h1"), gp.get("buyers_m5"), gp.get("buyers_h1"), holders.get(m)))
            self.led.db.execute("DELETE FROM scanner_obs WHERE at < ?", (now - self.cfg.obs_keep_s,))

    # ---- 3) prefilter ------------------------------------------------------------------------------------------
    def prefilter(self, m, q):
        c = self.cfg
        mr = q.mom_raw or {}
        liq, mc = q.liquidity_usd, q.mcap_usd
        if self.led.one("SELECT 1 AS x FROM positions WHERE book=? AND mint=?", (self.cfg.book, m)):
            return "already traded by the scanner book"
        if mc is None:
            # known-price / quote validity — not an arbitrary $30k floor
            return "market cap unknown"
        if c.min_mcap_usd and mc < c.min_mcap_usd:
            return f"market cap ${mc:,.0f} under ${c.min_mcap_usd:,.0f}"
        if c.max_mcap_usd is not None and mc > c.max_mcap_usd:
            return f"market cap ${mc:,.0f} over ${c.max_mcap_usd:,.0f}"
        if liq is None or liq < c.min_liq_usd:
            return "liquidity unknown" if liq is None else f"liquidity ${liq:,.0f} under ${c.min_liq_usd:,.0f}"
        bad = G.quote_sanity(liq, mc)
        if bad:
            return f"liquidity sanity: {bad}"
        if liq > 1.5 * mc:
            return f"liquidity ${liq:,.0f} above 1.5x market cap (implausible quote)"
        v1 = _f(mr.get("vol_h1"))
        if v1 is None or v1 < c.min_vol_h1_usd:
            return f"1h volume ${v1 or 0:,.0f} under ${c.min_vol_h1_usd:,.0f}"
        tx = (_f(mr.get("buys_h1")) or 0) + (_f(mr.get("sells_h1")) or 0)
        if tx < c.min_txns_h1:
            return f"{tx:.0f} txns in 1h under {c.min_txns_h1}"
        ch = _f(mr.get("chg_h1"))
        if ch is not None and ch <= c.max_drop_h1_pct:
            return f"dumping: {ch:.0f}% in 1h"
        return None

    # ---- 5) risk score (cached / deduped) -----------------------------------------------------------------------
    def cached_score(self, m, now):
        r = self.led.one("SELECT * FROM scanner_scores WHERE mint=?", (m,))
        if r:
            age = now - (r["scored_at"] or 0)
            if r["status"] == "scored" and age <= self.cfg.rescore_after_s:
                return r
            if r["status"] != "scored" and age <= self.cfg.retry_failed_after_s:
                return r
        return None

    def _score_live(self, mint):
        from ..pipeline import score_mint
        c = self.cfg
        # coin={} : never ask the pump.fun frontend API (Cloudflare 403; ctx.pumpfun is the disabled stub as well)
        return score_mint(mint, ctx=self.ctx, as_of=None, n_buyers=c.n_buyers, hops=c.hops, trace_limit=c.trace_limit, coin={})

    def score_many(self, mints, st):
        """Score up to score_per_cycle mints in parallel threads with one wall-clock deadline. A thread that overruns is
        abandoned (daemon thread; its late result is dropped) and recorded as timeout."""
        from . import edge as EG
        self._abandoned = [t for t in self._abandoned if t.is_alive()]
        room = max(0, self.cfg.max_abandoned_threads - len(self._abandoned))
        mints = mints[: min(self.cfg.score_per_cycle, room)]
        if len(self._abandoned) and not mints:
            st["score_skipped_abandoned_threads"] = len(self._abandoned)
        res, lock = {}, threading.Lock()
        work = list(mints)
        def worker():
            while True:
                with lock:
                    if not work:
                        return
                    m = work.pop(0)
                t = time.time()
                try:
                    d = self.score_fn(m); err = None
                except Exception as e:
                    d, err = None, f"{type(e).__name__}: {e}"[:200]
                with lock:
                    res[m] = (d, err, time.time() - t)
        ths = [threading.Thread(target=worker, daemon=True) for _ in range(min(self.cfg.score_parallel, len(mints)))]
        for t in ths:
            t.start()
        deadline = time.time() + self.cfg.score_timeout_s
        for t in ths:
            t.join(max(0.0, deadline - time.time()))
        with lock:
            got = dict(res)
            work.clear()
        self._abandoned += [t for t in ths if t.is_alive()]
        now = self.clock()
        out = {}
        with self.led.tx():
            for m in mints:
                d, err, el = got.get(m, (None, "timeout: score did not finish inside the scanner budget", self.cfg.score_timeout_s))
                row = {"mint": m, "scored_at": now, "elapsed_s": round(el, 1), "source": "scanner_live_reduced"}
                if d is None:
                    row.update({"status": "timeout" if (err or "").startswith("timeout") else "error", "error": safe_field(err, 200)})
                    st["risk"]["timeouts" if row["status"] == "timeout" else "errors"] += 1
                else:
                    s = d.get("orchestrator_summary") or {}
                    ev = d.get("evidence") or {}
                    bf = EG.bundle_fields(d)
                    cr = (ev.get("creation") or {}) if isinstance(ev.get("creation"), dict) else {}
                    sig = cr.get("signature") if isinstance(cr.get("signature"), str) and SIG.match(cr.get("signature")) else None
                    row.update({"status": "scored", "decision": d.get("recommendation"), "score": d.get("score"), "model_version": s.get("model"),
                                "top_reasons": json.dumps([safe_reason(t) for t in (s.get("top_reasons") or [])[:3]]),
                                "hard_flags": json.dumps([safe_field(x, 60) for x in (s.get("hard_flags") or [])][:6]),
                                "holder_count": (ev.get("holders") or {}).get("holder_count"), "bundle_pct": bf.get("bundle_pct"),
                                "bundle_wallets": bf.get("bundle_wallets"), "cluster_pct": bf.get("cluster_pct"), "create_sig": sig})
                    st["risk"]["scored_new"] += 1
                self.led.insert("scanner_scores", row, mode="INSERT OR REPLACE")
                out[m] = self.led.one("SELECT * FROM scanner_scores WHERE mint=?", (m,))
        return out

    def paper_cycle_score(self, m):
        """Dedupe: the 15-min paper cycle already scored this mint (as of create+5 min, same live model)."""
        l = self.led.one("SELECT * FROM launches WHERE mint=? AND status='scored' AND void_reason IS NULL", (m,))
        if not l:
            return None
        return {"mint": m, "status": "scored", "decision": l["asof_decision"] or l["decision"], "score": l["score"], "model_version": l["model_version"],
                "top_reasons": l["top_reasons"], "hard_flags": l["hard_flags"], "holder_count": l["holder_count"], "bundle_pct": l.get("bundle_pct"),
                "bundle_wallets": l.get("bundle_wallets"), "cluster_pct": l.get("cluster_pct"), "create_sig": l.get("create_sig"),
                "mayhem": l.get("mayhem"), "mayhem_source": l.get("mayhem_source"), "scored_at": l["scored_at"], "source": "paper_cycle_asof"}

    # ---- 6) on-chain facts for the gates ------------------------------------------------------------------------
    def _chain_live(self, mint, create_sig=None):
        """Supply, Mayhem agent balance and Mayhem status (free RPC; no pump.fun API). Never raises."""
        from .. import data_extractors as dx
        from .. import mayhem as MY
        from .pda import pump_bonding_curve
        out = {"supply": None, "agent_balance": None, "mayhem": None, "mayhem_source": "unknown"}
        if self.ctx is None:
            return out
        try:
            a = dx.mint_authorities(self.ctx, mint)
            out["supply"] = a["supply_raw"] / 10 ** a["decimals"] if a.get("supply_raw") and a.get("decimals") is not None else None
        except Exception:
            pass
        if out["supply"] and out["supply"] > PUMP_CURVE_SUPPLY * 1.001:
            try:
                r = self.ctx.rpc.call("getTokenAccountsByOwner", [MAYHEM_AGENT, {"mint": mint}, {"encoding": "jsonParsed"}], ttl=60,
                                      skip_eps=("publicnode",))
                vals = (r or {}).get("value")
                if vals is not None:
                    out["agent_balance"] = sum(float(x["account"]["data"]["parsed"]["info"]["tokenAmount"]["uiAmountString"]) for x in vals)
            except Exception:
                pass
        try:
            curve = pump_bonding_curve(mint)
            acc = self.ctx.rpc.call("getAccountInfo", [curve, {"encoding": "base64"}], ttl=3600)
        except Exception as e:
            out["mayhem_source"] = f"error: {type(e).__name__}"[:60]
            return out
        if isinstance(acc, dict) and acc.get("value") is None:
            # no pump.fun bonding curve for this mint: not a pump.fun coin, so not a Mayhem coin (supply/agent still checked)
            m = MY.classify(None, None, out["supply"], out["agent_balance"])
            out["mayhem"] = 1 if m["mayhem"] is True else 0
            out["mayhem_source"] = m["source"] if m["mayhem"] is True else "no_pumpfun_bonding_curve"
            return out
        r = MY.detect(self.ctx, mint, create_sig=create_sig, curve=curve, supply=out["supply"], agent_balance=out["agent_balance"])
        out["mayhem"], out["mayhem_source"] = MY.as_int(r.get("mayhem")), safe_field(r.get("source") or "unknown", 60)
        return out

    def _narrative_live(self):
        from .. import narrative as N
        return N.build_index(self.ctx, self.led, self.clock(), self.mcfg)

    # ---- holders / X heat (already-ingested data only) ----------------------------------------------------------
    def _holders(self, m, score_row, fdv, now):
        from . import edge as EG
        if self.cfg.require_quality_preentry:
            # experiment100: StalkChain quality must clear BEFORE any fill. Unknown/stale/incomplete is never safe.
            return self._quality_preentry(m, now)
        h = score_row.get("holder_count") if score_row else None
        if h is not None:
            return h, "score_live_rpc" if (score_row or {}).get("source") == "scanner_live_reduced" else "as_of_reconstruction", None
        rec = EG.HolderCache(self.ecfg.holders, now).fresh(m)
        g = EG.live_holder_gate(None, fdv, rec, self.ecfg.holders)
        if g:
            return g["holders"], "stalkchain_live", g["veto"]
        return None, "unknown", None

    def _quality_preentry(self, m, now):
        """Strict pre-entry StalkChain gate (experiment100). -> (holders, source, veto_or_block_reason).
        A non-None third value always blocks entry. Never enters then voids."""
        from . import edge as EG
        cfg = self.ecfg.holders
        # use experiment age override when set on scanner cfg
        age = getattr(self.cfg, "quality_cache_max_age_s", None) or cfg.cache_max_age_s
        cache = EG.HolderCache(cfg, now)
        # HolderCache.fresh uses cfg.cache_max_age_s; temporarily tolerate via manual age check
        raw = cache.tokens.get(m)
        if not isinstance(raw, dict):
            return None, "stalkchain_missing", "stalkchain_quality_unavailable: no cached token quality (queue holders plan)"
        fetched = raw.get("fetched_ts") or 0
        if not (0 <= now - fetched <= age):
            return None, "stalkchain_stale", "stalkchain_quality_unavailable: cached token quality stale (queue holders plan)"
        rec = {**raw, "age_s": round(now - fetched)}
        missing = EG.quality_fields_missing(rec, cfg)
        if missing:
            return None, "stalkchain_incomplete", f"stalkchain_quality_unavailable: incomplete fields ({', '.join(missing)})"
        veto = EG.holder_veto(rec, cfg)
        if veto:
            return rec.get("holders"), "stalkchain_live", veto
        return rec.get("holders"), "stalkchain_live", None


    def _shadow_quality_miss(self, mint, row, q, fdv, sr, veto, t0):
        """Log-only learning for unknown/stale quality (never funds a paper entry; never labels clear)."""
        try:
            path = os.path.join(os.path.dirname(os.path.abspath(self.led.path)), "audits", "quality_shadow.jsonl")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            rec = {
                "kind": "quality_shadow_unknown",
                "policy_version": "quality_plan_cache_20261106-v1.1",
                "funded_book": False,
                "labeled_clear": False,
                "at": t0,
                "at_ct": iso_ct(t0),
                "mint": mint,
                "symbol": safe_field(getattr(q, "symbol", None) or row.get("symbol"), 32),
                "runner_score": row.get("runner_score") or (sr or {}).get("runner_score"),
                "risk_decision": (sr or {}).get("decision") or row.get("risk_decision"),
                "mcap": fdv,
                "liq": getattr(q, "liquidity_usd", None),
                "price": getattr(q, "price_usd", None),
                "veto": safe_reason(veto)[:240],
                "note": "SHADOW only — unknown/stale quality is NOT clear; not an entry",
            }
            with open(path, "a") as f:
                f.write(json.dumps(rec, default=str) + "\n")
        except Exception:
            pass

    def _entry_size_usd(self, cash, bankroll, sel_pct):
        c = self.cfg
        if c.sizing_mode == "fixed":
            # $2 only when available cash (start + closed/partial PnL - open cost) >= tier2 threshold from own gains path
            want = c.tier2_entry_usd if cash + 1e-9 >= c.tier2_cash_usd else c.fixed_entry_usd
            return round(min(want, max(0.0, cash)), 2)
        return round((sel_pct or 0) * bankroll, 2)


    def _open_notional(self, led):
        """Sum of original size_usd still open (full size while open; not reduced by partials for sleeve cap)."""
        r = led.one("SELECT COALESCE(SUM(size_usd),0) AS n FROM positions WHERE book=? AND status='open' AND void_reason IS NULL",
                    (self.cfg.book,))
        return float(r["n"] or 0)

    def _entry_sleeve(self, b, size, fee_need=0.0):
        """-> (ok, reason). Reserve cash is untouchable by size or fixed fees; open notional capped separately.
        Does not force fills up to max_open — caller still respects slots/gates."""
        c = self.cfg
        open_n = int(b.get("open") or 0)
        if open_n >= c.max_open:
            return False, "max_open"
        notion_cap = c.max_open_notional_usd
        if notion_cap is not None:
            # prefer live open_cost principal if present; sleeve uses original size sum when provided on b
            open_notion = b.get("open_notional_usd")
            if open_notion is None:
                open_notion = b.get("open_cost") or 0.0
            if open_notion + size > float(notion_cap) + 1e-9:
                return False, "max_open_notional"
        reserve = c.reserve_cash_usd
        if reserve is not None:
            # cash after committing size + fixed entry fees/rent must remain >= reserve
            need = float(size) + float(fee_need or 0.0)
            if b["cash"] - need + 1e-9 < float(reserve):
                return False, "reserve_cash"
        return True, None

    def _window_open(self, t0):
        return self.cfg.end_ts is None or t0 <= self.cfg.end_ts

    # ---- one cycle ---------------------------------------------------------------------------------------------
    def cycle(self):
        from ..momentum import momentum_score, combine
        from .. import narrative as N
        from . import edge as EG
        t0 = self.clock()
        c = self.cfg
        st = {"started_at_ct": iso_ct(t0), "errors": [], "gt_skipped": [], "candidates": 0, "quoted": 0, "prefilter_pass": 0,
              "prefilter_rejects": {}, "runner_scored": 0, "runner_insufficient_data": 0, "risk": {"scored_new": 0, "cached": 0,
              "paper_cycle_dedupe": 0, "errors": 0, "timeouts": 0, "decisions": {}}, "blocked": {"rug_skip": 0, "hard_flags": 0,
              "mayhem": 0, "mayhem_unknown": 0, "bundle": 0, "gates_skip": 0, "price_disagreement": 0, "no_cross_check": 0,
              "under_30k": 0, "under_min_mcap": 0, "mcap_unknown": 0, "liq_sanity": 0, "stalkchain_veto": 0, "stalkchain_pending": 0, "momentum_rule": 0, "runner_below_min": 0},
              "entries": [], "top_runners": [], "end_of_window": (False if c.end_ts is None else t0 > c.end_ts), "book": c.book, "sizing_mode": c.sizing_mode, "require_quality_preentry": c.require_quality_preentry}
        with self.led.tx():
            cid = self.led.insert("scanner_cycles", {"started_at": t0})
            self.led.db.execute("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)",
                                (LEASE_KEY, json.dumps({"pid": self.pid, "at": t0, "until": t0 + 3 * c.interval_s, "at_ct": iso_ct(t0)})))
        found = self.discover(st)
        st["candidates"] = len(found)
        # GeckoTerminal-discovered mints first (they carry unique-buyer data), then the rest in discovery order
        order = sorted(found, key=lambda m: (found[m]["gt_pool"] is None,))
        qs = self.quote(order, st)
        st["quoted"] = len(qs)
        hc = EG.HolderCache(self.ecfg.holders, t0)
        holders_now = {m: (hc.fresh(m) or {}).get("holders") for m in qs}
        self._record_obs(qs, found, holders_now, t0)
        xd = EG.XData(self.ecfg.x, t0) if self.ecfg.x.enabled else None
        surv, rows = [], []
        for m, q in qs.items():
            sym = safe_field(q.symbol, 32)
            why = self.prefilter(m, q)
            base = {"cycle_id": cid, "at": t0, "mint": m, "symbol": sym, "sources": json.dumps(sorted(found[m]["sources"])), "mcap": q.mcap_usd,
                    "liq": q.liquidity_usd, "price": q.price_usd}
            pc = (q.mom_raw or {}).get("pair_created_ms")
            age_h = (t0 - pc / 1000) / 3600 if pc else None
            base["age_h"] = None if age_h is None else round(age_h, 2)
            if why:
                k = re.sub(r"[$\d,.\-]+", "", why).split(":")[0].strip()[:40]
                st["prefilter_rejects"][k] = st["prefilter_rejects"].get(k, 0) + 1
                continue
            xp = None
            if xd is not None:
                xr = xd.lookup(None, sym)
                xp = xr.get("points") if xr.get("fresh") else None
            rs = runner_score(q.mom_raw, found[m]["gt_pool"], q.mcap_usd, q.liquidity_usd, age_h, self._then(m, t0, "liq"),
                              holders_now.get(m), self._then(m, t0, "holders"), xp, getattr(self.ecfg.x, "max_points", 10.0), c)
            st["prefilter_pass"] += 1
            if rs["score"] is None:
                st["runner_insufficient_data"] += 1
            else:
                st["runner_scored"] += 1
            surv.append((m, q, rs, base))
        surv.sort(key=lambda x: -(x[2]["score"] or -1))
        # risk scores: cached / paper-cycle dedupe first, then new live scores for the best uncached survivors
        scores, need = {}, []
        for m, q, rs, base in surv:
            if rs["score"] is None or rs["score"] < c.prescore_runner:
                continue
            r = self.cached_score(m, t0)
            if r is not None:
                scores[m] = r; st["risk"]["cached"] += 1; continue
            r = self.paper_cycle_score(m)
            if r is not None:
                scores[m] = r; st["risk"]["paper_cycle_dedupe"] += 1; continue
            need.append(m)
        if need and self._window_open(t0):
            scores.update(self.score_many(need, st))
        # entry evaluation for scored non-SKIP survivors
        narr = None
        bk = book_state(self.led, self.cfg.book)
        open_n = bk["open"]
        finals = []
        for m, q, rs, base in surv:
            sr = scores.get(m)
            row = {**base, "runner_score": rs["score"], "runner_detail": json.dumps(rs, default=str), "stage": "runner", "reason": None}
            if sr is None or rs["score"] is None or rs["score"] < c.prescore_runner:
                row["reason"] = ("no runner score (too little data)" if rs["score"] is None else
                                 f"runner score under the risk-scoring floor {c.prescore_runner:g}" if rs["score"] < c.prescore_runner else
                                 "risk score queued (per-cycle scoring cap)")
                rows.append(row); continue
            sr = dict(sr)
            row.update({"risk_decision": sr.get("decision"), "risk_score": sr.get("score"), "stage": "risk"})
            if sr.get("status") != "scored":
                row["reason"] = f"risk score {sr.get('status')}"; rows.append(row); continue
            st["risk"]["decisions"][sr["decision"]] = st["risk"]["decisions"].get(sr["decision"], 0) + 1
            hard = json.loads(sr.get("hard_flags") or "[]")
            if sr["decision"] == "SKIP":
                st["blocked"]["rug_skip"] += 1
                if hard:
                    st["blocked"]["hard_flags"] += 1
                row["reason"] = "risk SKIP" + (f" (hard flags: {', '.join(hard[:3])})" if hard else ""); rows.append(row); continue
            finals.append((m, q, rs, sr, row))
            rows.append(row)
        # gates + selection on a fresh cross-checked quote for the finalists (one GeckoTerminal multi call)
        pending = []
        if finals and not st["end_of_window"]:
            from .prices import quotes as both_quotes
            fq, errs = {}, []
            try:
                fq, errs = both_quotes(_Ctxish(_Counted(self, self.dex_h), _GtCounted(self)), [f[0] for f in finals], now=self.clock(), gt_all=True)
            except Exception as e:
                errs = [f"{type(e).__name__}: {e}"[:160]]
            st["errors"] += [e for e in errs if "budget" not in e][:3]
            for m, q0, rs, sr, row in finals:
                q = fq.get(m)
                row["stage"] = "gates"
                if q is None:
                    row["reason"] = "no fresh quote"; continue
                if not q.gt_price_usd:
                    st["blocked"]["no_cross_check"] += 1
                    row["reason"] = "hold: GeckoTerminal price cross-check unavailable (shared budget/429)"; continue
                if q.price_usd and abs(q.gt_price_usd / q.price_usd - 1) > 0.25:
                    st["blocked"]["price_disagreement"] += 1
                    row["reason"] = f"hold: price sources disagree (DexScreener {q.price_usd:.4g} vs GeckoTerminal {q.gt_price_usd:.4g})"; continue
                ch = self.chain_fn(m, sr.get("create_sig"))
                supply, agent = ch.get("supply"), ch.get("agent_balance")
                circ = circulating_supply(supply, agent)
                fdv = fdv_of(q, supply, circ)
                row["mayhem"] = ch.get("mayhem")
                if fdv is None:
                    st["blocked"]["mcap_unknown"] = st["blocked"].get("mcap_unknown", 0) + 1
                    row["reason"] = "market cap unknown (need priced FDV / known quote)"; continue
                if c.min_mcap_usd and fdv < c.min_mcap_usd:
                    st["blocked"]["under_min_mcap"] = st["blocked"].get("under_min_mcap", 0) + 1
                    row["reason"] = f"market cap ${fdv:,.0f} not above ${c.min_mcap_usd:,.0f}"; continue
                bad = G.quote_sanity(q.liquidity_usd, fdv)
                if bad:
                    st["blocked"]["liq_sanity"] += 1
                    row["reason"] = f"liquidity sanity: {bad}"; continue
                if ch.get("mayhem") != 0:
                    st["blocked"]["mayhem" if ch.get("mayhem") == 1 else "mayhem_unknown"] += 1
                    row["reason"] = G.mayhem_reasons(ch.get("mayhem"), ch.get("mayhem_source"))[0]; continue
                bb = EG.bundle_block(sr, self.ecfg.bundle)
                if bb:
                    st["blocked"]["bundle"] += 1
                    row["reason"] = bb; continue
                holders, hsrc, veto = self._holders(m, sr, fdv, self.clock())
                if veto:
                    key = "stalkchain_pending" if str(veto).startswith("stalkchain_quality_unavailable") else "stalkchain_veto"
                    st["blocked"][key] = st["blocked"].get(key, 0) + 1
                    row["reason"] = safe_reason(veto)
                    if key == "stalkchain_pending" and c.require_quality_preentry:
                        self._shadow_quality_miss(m, row, q, fdv, sr, veto, t0)
                    continue
                g = G.entry_gates(q.liquidity_usd, holders, fdv, self.thresholds, hsrc)
                final = G.stricter(sr["decision"], g["cap"])
                row["final_decision"] = final
                if final == "SKIP":
                    st["blocked"]["gates_skip"] += 1
                    row["reason"] = "entry gates: " + "; ".join(g["reasons"])[:200]; continue
                mom = momentum_score(q.mom_raw, q.gt_pool or found[m]["gt_pool"], fdv, self.mcfg)
                if narr is None:
                    try:
                        narr = self.narrative_fn() or {}
                    except Exception as e:
                        narr = {}; st["errors"].append(f"narrative: {type(e).__name__}"[:80])
                ns = N.score_coin(narr.get("themes") or {}, {"mint": m, "symbol": safe_field(q.symbol, 32), "name": safe_field(q.name, 64),
                                                            "created_at": (t0 - rs["signals"]["age_h"] * 3600) if rs["signals"]["age_h"] else None},
                                  self.clock(), self.mcfg) if narr else {"score": 0.0, "theme": None}
                sel = combine(mom, ns, sr.get("score"), final, self.mcfg)
                row["stage"] = "select"
                if not sel["enter"]:
                    st["blocked"]["momentum_rule"] += 1
                    row["reason"] = f"momentum book rule: {sel['why']}"; continue
                if rs["score"] < c.min_runner:
                    st["blocked"]["runner_below_min"] += 1
                    row["reason"] = f"runner score {rs['score']} under {c.min_runner:g}"; continue
                pending.append({"mint": m, "q": q, "rs": rs, "sr": sr, "row": row, "fdv": fdv, "supply": supply, "circ": circ, "agent": agent,
                                "chain": ch, "holders": holders, "hsrc": hsrc, "gates": g, "final": final, "mom": mom, "narr": ns, "sel": sel,
                                "sources": sorted(found[m]["sources"])})
        # enter (conservative fill: max(quote, entry-minute close))
        pending.sort(key=lambda p: -p["rs"]["score"])
        # concurrency: max_open count, optional notional sleeve, never force buys; reserve enforced at fill with fees
        slots = max(0, min(c.max_new_per_cycle, c.max_open - open_n))
        if c.max_open_notional_usd is not None:
            open_notion = self._open_notional(self.led)
            # conservative: assume next fills at current tier size (cash may still block $2)
            est = c.fixed_entry_usd if bk["cash"] + 1e-9 < c.tier2_cash_usd else c.tier2_entry_usd
            room = int(max(0.0, float(c.max_open_notional_usd) - open_notion) // max(est, 1e-9))
            slots = min(slots, room)
        if c.reserve_cash_usd is not None:
            # how many est-sized entries fit above reserve (fees checked exactly at enter)
            est = c.fixed_entry_usd if bk["cash"] + 1e-9 < c.tier2_cash_usd else c.tier2_entry_usd
            room_cash = int(max(0.0, bk["cash"] - float(c.reserve_cash_usd)) // max(est, 1e-9))
            slots = min(slots, room_cash)
        for p in pending[slots:]:
            p["row"]["reason"] = "no slot (max open / notional sleeve / reserve / max new per cycle)"
        pending = pending[:slots]
        if pending:
            self._enter_all(pending, st)
        with self.led.tx():
            for r in rows:
                self.led.insert("scanner_candidates", {k: r.get(k) for k in ("cycle_id", "at", "mint", "symbol", "sources", "stage", "reason", "mcap", "liq",
                                                                            "age_h", "runner_score", "runner_detail", "risk_decision", "risk_score",
                                                                            "final_decision", "mayhem", "position_id", "price")})
            st["top_runners"] = [{"symbol": r["symbol"], "mint": r["mint"], "runner_score": r["runner_score"], "mcap_usd": round(r["mcap"] or 0),
                                  "liq_usd": round(r["liq"] or 0), "age_h": r["age_h"], "risk": r.get("risk_decision"), "outcome": r.get("reason") or
                                  ("ENTERED" if r.get("position_id") else r.get("stage"))}
                                 for r in sorted(rows, key=lambda r: -(r["runner_score"] or -1))[:5]]
            st["elapsed_s"] = round(self.clock() - t0, 1)
            st["errors"] = st["errors"][:8]
            st["calls_this_cycle"] = {k: sum(1 for t in v if t >= t0) for k, v in self.calls.items()}
            self.led.update("scanner_cycles", {"id": cid}, {"finished_at": self.clock(), "elapsed_s": st["elapsed_s"], "stats": json.dumps(st, default=str)})
        st["cycle_id"] = cid
        self.cycles += 1
        self.last = st
        self.log.info(json.dumps({"kind": "cycle", **st}, default=str))
        return st

    # ---- 7) entries --------------------------------------------------------------------------------------------
    def _entry_close(self, p, minute):
        """Close of the 1-min candle that started at `minute` (GeckoTerminal OHLCV, shared budget); None if unavailable."""
        q = p["q"]
        if not q.pair:
            return None, "no pool address"
        try:
            j = self._gt(f"/networks/solana/pools/{q.pair}/ohlcv/minute?aggregate=1&limit=5&currency=usd") or {}
        except GtBudgetError as e:
            return None, str(e)
        except Exception as e:
            return None, f"{type(e).__name__}: {str(e)[-60:]}"
        for x in ((j.get("data") or {}).get("attributes") or {}).get("ohlcv_list") or []:
            try:
                if int(float(x[0])) == int(minute) and float(x[4]) > 0:
                    return float(x[4]), "geckoterminal_1m_candle"
            except (TypeError, ValueError, IndexError):
                continue
        return None, "entry-minute candle not found"

    def _enter_all(self, pending, st):
        from .prices import dexscreener_quotes
        decided = self.clock()
        minute = int(decided // 60) * 60
        wait = minute + 60 + self.cfg.entry_wait_s - self.clock()
        if wait > 0:
            self.sleep(wait)
        req = None
        for p in pending:
            close, csrc = self._entry_close(p, minute)
            if close is None:
                if req is None:
                    try:
                        req, _ = dexscreener_quotes(_Ctxish(_Counted(self, self.dex_h), None), [x["mint"] for x in pending], now=self.clock())
                    except Exception:
                        req = {}
                rq = req.get(p["mint"])
                close, csrc = (rq.price_usd, f"dexscreener re-quote ({csrc})") if rq else (None, f"none ({csrc})")
            fill = max(p["q"].price_usd, close or 0.0)
            self._enter(p, decided, fill, close, csrc, st)

    def _enter(self, p, decided, fill, close, csrc, st):
        led, q, now = self.led, p["q"], self.clock()
        with led.tx():
            if led.one("SELECT 1 AS x FROM positions WHERE book=? AND mint=?", (self.cfg.book, p["mint"])):
                return
            b = book_state(led, self.cfg.book)
            pct = p["sel"]["size_pct"]
            size = self._entry_size_usd(b["cash"], b["bankroll"], pct)
            if size <= 0:
                return
            if size > b["cash"] + 1e-9:
                led.insert("misses", {"book": self.cfg.book, "mint": p["mint"], "decision": p["final"], "reason": "no_cash", "size_usd": size,
                                      "cash_usd": round(b["cash"], 2), "at": now}, mode="INSERT OR IGNORE")
                p["row"]["reason"] = "no cash"; return
            fee_fields = {}
            if self.cfg.book == EXPERIMENT100_BOOK:
                from . import fixed_fees as FF
                fm = FF.load()
                if fm is None or fm.missing_blocking():
                    reason = "fixed_fee_config_incomplete"
                    if fm is not None:
                        reason = "fixed_fee_config_incomplete:" + ",".join(fm.missing_blocking())
                    led.insert("misses", {"book": self.cfg.book, "mint": p["mint"], "decision": p["final"], "reason": reason,
                                          "size_usd": size, "cash_usd": round(b["cash"], 2), "at": now}, mode="INSERT OR IGNORE")
                    p["row"]["reason"] = reason; return
                # cash must cover size + entry fixed fee + rent lock
                need = size + fm.per_tx_usd() + fm.rent_usd()
                if need > b["cash"] + 1e-9:
                    led.insert("misses", {"book": self.cfg.book, "mint": p["mint"], "decision": p["final"],
                                          "reason": "no_cash_after_fixed_fees", "size_usd": size,
                                          "cash_usd": round(b["cash"], 2), "at": now}, mode="INSERT OR IGNORE")
                    p["row"]["reason"] = "no cash after fixed fees"; return
                bad = fm.uneconomic_reason(size)
                if bad:
                    led.insert("misses", {"book": self.cfg.book, "mint": p["mint"], "decision": p["final"], "reason": bad,
                                          "size_usd": size, "cash_usd": round(b["cash"], 2), "at": now}, mode="INSERT OR IGNORE")
                    p["row"]["reason"] = bad; return
                fee_fields = FF.entry_fields(fm)
            fee_need = float(fee_fields.get("entry_fixed_fee_usd") or 0) + float(fee_fields.get("rent_locked_usd") or 0)
            b_live = {**b, "open": book_state(led, self.cfg.book)["open"],
                      "open_notional_usd": self._open_notional(led),
                      "cash": book_state(led, self.cfg.book)["cash"]}
            ok, why = self._entry_sleeve(b_live, size, fee_need)
            if not ok:
                led.insert("misses", {"book": self.cfg.book, "mint": p["mint"], "decision": p["final"], "reason": why,
                                      "size_usd": size, "cash_usd": round(b_live["cash"], 2), "at": now}, mode="INSERT OR IGNORE")
                p["row"]["reason"] = why; return
            ec = K.side_cost(size, q.liquidity_usd)
            tokens = size * (1 - ec) / fill
            fdv = p["fdv"] * fill / q.price_usd if q.price_usd else p["fdv"]
            fillrec = {"decided_at_ct": iso_ct(decided), "decision_quote_usd": q.price_usd, "entry_minute_close_usd": close,
                       "entry_minute_close_source": csrc, "fill_price_usd": fill,
                       "fill_rule": "max(decision quote, entry-minute 1-min close) (conservative)",
                       "fill_vs_quote_pct": round((fill / q.price_usd - 1) * 100, 2) if q.price_usd else None}
            rules = {"policy": SX.CLIP5_RUG_DUST.name, "rule": SX.describe(SX.CLIP5_RUG_DUST.name),
                     "marked_by": "1-min exit watcher (15-min paper cycle only as a fallback when the watcher is down)"}
            detail = {"runner": p["rs"], "momentum": p["mom"], "narrative": p["narr"], "selection": p["sel"], "exit_rules": rules, "fill": fillrec,
                      "risk_source": p["sr"].get("source"), "discovered_via": p["sources"]}
            if fee_fields:
                detail["fixed_fees"] = {"fee_model_version": fee_fields.get("fee_model_version"),
                                        "entry_fixed_fee_usd": fee_fields.get("entry_fixed_fee_usd"),
                                        "rent_locked_usd": fee_fields.get("rent_locked_usd")}
            if getattr(self.cfg, "mcap_policy_version", None):
                detail["mcap_policy"] = {"version": self.cfg.mcap_policy_version,
                                         "min_mcap_usd": self.cfg.min_mcap_usd,
                                         "max_mcap_usd": self.cfg.max_mcap_usd,
                                         "note": "arbitrary $30k floor / $50M ceiling disabled for experiment100; known mcap required; gates.MIN_FDV_USD (~$1k dead/dumped) retained"}
            # size_pct recorded as size/bankroll for audit; fixed mode still stores the effective fraction
            if self.cfg.sizing_mode == "fixed" and b["bankroll"] > 0:
                pct = size / b["bankroll"]
            pos = {"book": self.cfg.book, "mint": p["mint"], "decision": p["final"], "score": p["sr"].get("score"), "size_pct": pct, "size_usd": size,
                   "bankroll_at_entry": b["bankroll"], "entry_at": now, "entry_price": fill, "entry_mcap": fdv, "entry_liq": q.liquidity_usd,
                   "entry_cost": ec, "asof_decision": p["sr"].get("decision"),
                   "gate_reasons": json.dumps([safe_reason(r) for r in p["gates"]["reasons"]]), "entry_fdv": fdv,
                   "entry_trigger": ("experiment100" if self.cfg.book == EXPERIMENT100_BOOK else "scanner"),
                   "tokens": tokens, "tokens_initial": tokens, "status": "open", "last_price": fill, "last_price_at": now, "last_mcap": fdv,
                   "last_liq": q.liquidity_usd, "last_mark_at": now, "min_ret": 0.0, "max_ret": 0.0, "theme": p["narr"].get("theme"),
                   "mom_score": p["mom"].get("score"), "narr_score": p["narr"].get("score"), "mom_combined": p["sel"].get("combined"),
                   "mom_detail": json.dumps(detail, default=str), "peak_price": fill, "mayhem": 0, "runner_score": p["rs"]["score"],
                   "exit_policy": SX.CLIP5_RUG_DUST.name, "clips_done": 0, "clip_log": "[]",
                   "stop_price": SX.stop_level(SX.CLIP5_RUG_DUST.name, fill, False, fill),
                   "dust_frac": SX.DUST_FRAC, "dust_tokens": tokens * SX.DUST_FRAC, "sig_state": "{}",
                   **fee_fields}
            pos["id"] = led.insert("positions", pos)
            age_h = p["rs"]["signals"].get("age_h")
            view = {"symbol": safe_field(q.symbol, 32), "name": safe_field(q.name, 64), "asof_decision": p["sr"].get("decision"),
                    "gate_reasons": pos["gate_reasons"], "top_reasons": p["sr"].get("top_reasons"), "holder_count": p["holders"],
                    "holder_source": p["hsrc"], "entry_source": q.source,
                    "entry_trigger": ("experiment100" if self.cfg.book == EXPERIMENT100_BOOK else "scanner"), "supply": p["supply"], "circ_supply": p["circ"],
                    "created_at": (now - age_h * 3600) if age_h else None, "min_entry_mcap": self.cfg.min_mcap_usd, "mayhem": 0,
                    "mayhem_source": p["chain"].get("mayhem_source"), "bundle_pct": p["sr"].get("bundle_pct"), "bundle_wallets": p["sr"].get("bundle_wallets")}
            from .scanbook import clip_fields
            payload = {**_buy_payload(led, pos, view), "runner_score": p["rs"]["score"], "runner": p["rs"], "momentum_score": p["mom"].get("score"),
                       "narrative_score": p["narr"].get("score"), "combined_score": p["sel"].get("combined"), "theme": p["narr"].get("theme"),
                       "momentum": p["mom"], "risk_score_source": p["sr"].get("source"), "risk_model_version": p["sr"].get("model_version"),
                       "discovered_via": p["sources"], "entry_fill": fillrec, "pair_age_h": age_h, **clip_fields(pos)}
            led.insert("events", {"created_at": now, "book": self.cfg.book, "kind": "BUY", "position_id": pos["id"], "mint": p["mint"],
                                  "payload": payload}, mode="INSERT OR IGNORE")
        p["row"].update({"position_id": pos["id"], "stage": "entered", "reason": None})
        st["entries"].append({"symbol": view["symbol"], "mint": p["mint"], "decision": p["final"], "size_usd": size, "fill": fill,
                              "quote": q.price_usd, "entry_minute_close": close, "runner_score": p["rs"]["score"], "mcap_usd": round(fdv)})
        self.log.info(json.dumps({"kind": "entry", "position_id": pos["id"], **st["entries"][-1]}, default=str))

    # ---- heartbeat / loop ----------------------------------------------------------------------------------------
    def heartbeat(self, now, error=None):
        if not self.hb_path:
            return
        hb = {"pid": self.pid, "at": now, "at_ct": iso_ct(now), "interval_s": self.cfg.interval_s, "cycles": self.cycles, "errors": self.errors,
              "started_at_ct": iso_ct(self.started), "last_cycle": self.last, "last_error": error,
              "calls_last_hour": {k: len(v) for k, v in self.calls.items()},
              "abandoned_score_threads": len([t for t in self._abandoned if t.is_alive()])}
        share = getattr(self.gt_h, "share", None)
        if share is not None:
            try:
                hb["gt_shared"] = share.state()
            except OSError:
                pass
        tmp = self.hb_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(hb, f, default=str)
        os.replace(tmp, self.hb_path)

    def run(self, stop: threading.Event, cycle_lock_path=None):
        while not stop.is_set():
            t = self.clock()
            try:
                with _cycle_lock(cycle_lock_path, blocking=True):
                    self.cycle()
                self.heartbeat(self.clock())
            except Exception as e:
                self.errors += 1
                self.log.exception(json.dumps({"kind": "cycle_error", "error": f"{type(e).__name__}: {e}"[:300]}))
                try:
                    self.heartbeat(self.clock(), error=f"{type(e).__name__}: {e}"[:300])
                except OSError:
                    pass
            # heartbeat at least every 60 s while idle, so a hung process is told apart from a quiet one
            end = t + self.cfg.interval_s
            while not stop.is_set() and self.clock() < end:
                stop.wait(min(60.0, max(1.0, end - self.clock())))
                if not stop.is_set():
                    try:
                        self.heartbeat(self.clock())
                    except OSError:
                        pass


class _Counted:
    """DexScreener source wrapper that counts every request for the heartbeat."""
    def __init__(self, sc, h):
        self.sc, self.h = sc, h

    def get_json(self, path, ttl=0):
        self.sc._count("dexscreener")
        return self.h.get_json(path, ttl=0)


class _GtCounted:
    def __init__(self, sc):
        self.sc = sc

    def get_json(self, path, ttl=0):
        return self.sc._gt(path)


class _cycle_lock:
    """Cross-process lock around one scan, so `scanner once` and the daemon never scan at the same time."""
    def __init__(self, path, blocking=True, timeout_s=600):
        self.path, self.blocking, self.timeout_s, self.f = path, blocking, timeout_s, None

    def __enter__(self):
        if not self.path:
            return self
        self.f = open(self.path, "w")
        t0 = time.time()
        while True:
            try:
                fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except OSError:
                if not self.blocking or time.time() - t0 > self.timeout_s:
                    self.f.close(); self.f = None
                    raise TimeoutError("another scanner cycle is running")
                time.sleep(1.0)

    def __exit__(self, *a):
        if self.f:
            fcntl.flock(self.f, fcntl.LOCK_UN); self.f.close()


# ---- process management (mirrors smr/paper/watcher.py) -------------------------------------------------------------
def paths(db):
    d = os.path.dirname(os.path.abspath(db))
    return {k: os.path.join(d, f"scanner.{k}") for k in ("pid", "lock", "log", "out")} | {
        "heartbeat": os.path.join(d, "scanner.heartbeat.json"), "cycle_lock": os.path.join(d, "scanner.cycle.lock")}


def _alive(pid):
    try:
        os.kill(pid, 0)
    except (OSError, TypeError):
        return False
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            cmd = f.read().replace(b"\0", b" ")
        return b"scanner" in cmd and b"run" in cmd
    except OSError:
        return True


def _read_pid(P):
    try:
        with open(P["pid"]) as f:
            return int(f.read().strip())
    except (OSError, ValueError):
        return None


def status(db):
    P = paths(db)
    pid = _read_pid(P)
    alive = bool(pid and _alive(pid))
    hb = None
    try:
        with open(P["heartbeat"]) as f:
            hb = json.load(f)
    except (OSError, ValueError):
        pass
    now = time.time()
    age = round(now - hb["at"], 1) if hb else None
    iv = (hb or {}).get("interval_s") or DEFAULT_INTERVAL_S
    # heartbeats come at least every 60 s while idle and after every cycle; a cycle itself can take a few minutes
    lim = max(3 * 60, iv + 240)
    lc = (hb or {}).get("last_cycle") or {}
    return {"running": alive, "pid": pid if alive else None, "heartbeat_age_s": age, "healthy": bool(alive and age is not None and age <= lim),
            "stale": bool(alive and (age is None or age > STALE_FACTOR * iv)), "heartbeat_at_ct": (hb or {}).get("at_ct"),
            "cycles": (hb or {}).get("cycles"), "errors": (hb or {}).get("errors"), "last_error": (hb or {}).get("last_error"),
            "last_cycle": {k: lc.get(k) for k in ("started_at_ct", "candidates", "quoted", "prefilter_pass", "runner_scored", "entries", "elapsed_s",
                                                  "calls_this_cycle")} if lc else None,
            "calls_last_hour": (hb or {}).get("calls_last_hour"), "gt_shared": (hb or {}).get("gt_shared"),
            "log": P["log"], "heartbeat_file": P["heartbeat"]}


def stop(db, timeout_s=20):
    P = paths(db)
    pid = _read_pid(P)
    if not pid or not _alive(pid):
        return {"action": "not_running"}
    os.kill(pid, signal.SIGTERM)
    t0 = time.time()
    while time.time() - t0 < timeout_s and _alive(pid):
        time.sleep(0.3)
    if _alive(pid):
        os.kill(pid, signal.SIGKILL); time.sleep(0.5)
        return {"action": "killed", "pid": pid}
    return {"action": "stopped", "pid": pid}


def _maintenance_block(db):
    """If <db-dir>/MAINTENANCE.json is active, refuse start/restart (supervision coordination)."""
    import json, time as _t
    path = os.path.join(os.path.dirname(os.path.abspath(db)), "MAINTENANCE.json")
    try:
        with open(path) as f:
            m = json.load(f)
    except (OSError, ValueError):
        return None
    if not m.get("active"):
        return None
    until = m.get("until")
    if until is not None and _t.time() > float(until):
        return None
    return {"action": "blocked_maintenance", "maintenance": m, "db": os.path.abspath(db)}


def start(db, interval_s=DEFAULT_INTERVAL_S, wait_s=20):
    """Idempotent: running + fresh heartbeat -> nothing; running but stale (hung) -> restart; dead -> start (nohup)."""
    blocked = _maintenance_block(db)
    if blocked:
        return {**blocked, **{k: status(db).get(k) for k in ("running", "healthy", "pid", "stale", "heartbeat_age_s")}}
    st = status(db)
    action = "started"
    if st["running"] and not st["stale"]:
        return {"action": "already_running", **st}
    if st["running"] and st["stale"]:
        stop(db); action = "restarted_stale"
    P = paths(db)
    cmd = [sys.executable, "-m", "risk", "scanner", "run", "--db", os.path.abspath(db), "--interval", str(interval_s)]
    if os.path.exists("/usr/bin/nohup") or os.path.exists("/bin/nohup"):
        cmd = ["nohup", *cmd]
    out = open(P["out"], "ab")
    subprocess.Popen(cmd, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, start_new_session=True, close_fds=True)
    out.close()
    t0 = time.time()
    while time.time() - t0 < wait_s:
        st = status(db)
        if st["running"] and st["heartbeat_age_s"] is not None and st["heartbeat_age_s"] < 5:
            break
        time.sleep(0.5)
    return {"action": action, **status(db)}


def config_beside_db(db):
    """Prefer <db-dir>/scanner.json so experiment100 can isolate config without touching the $1000 ledger."""
    cand = os.path.join(os.path.dirname(os.path.abspath(db)), "scanner.json")
    return cand if os.path.isfile(cand) else None


def make(db, interval_s=DEFAULT_INTERVAL_S, logger=None, heartbeat=True, config_path=None):
    """A Scanner on the ledger at `db` (Context with the pump.fun API disabled; no StalkChain / X clients)."""
    from ..context import Context
    from .engine import _NoPumpFun
    from .ledger import Ledger
    ctx = Context()
    ctx.pumpfun = _NoPumpFun()
    led = Ledger(db)
    dex, gt = live_sources(db)
    cfg = ScannerConfig.load(config_path or config_beside_db(db))
    if getattr(cfg, "live_trading", False) or not getattr(cfg, "paper_only", True):
        raise RuntimeError("refusing to start scanner: paper_only must be true and live_trading false (no live executor)")
    cfg.interval_s = interval_s
    from . import edge as EG
    edge_path = os.path.join(os.path.dirname(os.path.abspath(db)), "paper_edge.json")
    edge_cfg = EG.EdgeConfig.load(edge_path if os.path.isfile(edge_path) else None)
    return Scanner(led, dex, gt, ctx=ctx, cfg=cfg, edge_cfg=edge_cfg, logger=logger,
                   heartbeat_path=paths(db)["heartbeat"] if heartbeat else None)


def run_forever(db, interval_s=DEFAULT_INTERVAL_S):
    P = paths(db)
    lockf = open(P["lock"], "w")
    try:
        fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print(json.dumps({"skipped": "another scanner holds the lock"})); return 0
    log = logging.getLogger("smr.paper.scanner.file")
    log.setLevel(logging.INFO); log.propagate = False
    h = logging.handlers.RotatingFileHandler(P["log"], maxBytes=2_000_000, backupCount=5)
    h.setFormatter(logging.Formatter("%(message)s"))
    log.addHandler(h)
    with open(P["pid"], "w") as f:
        f.write(str(os.getpid()))
    stop_ev = threading.Event()
    signal.signal(signal.SIGTERM, lambda *a: stop_ev.set())
    signal.signal(signal.SIGINT, lambda *a: stop_ev.set())
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    sc = make(db, interval_s, logger=log)
    sc.heartbeat(time.time())
    log.info(json.dumps({"kind": "start", "pid": os.getpid(), "at_ct": iso_ct(time.time()), "interval_s": interval_s, "db": db,
                         "config": asdict(sc.cfg)}, default=str))
    try:
        sc.run(stop_ev, P["cycle_lock"])
    finally:
        try:
            with sc.led.tx():
                r = sc.led.one("SELECT v FROM meta WHERE k=?", (LEASE_KEY,))
                if r and (json.loads(r["v"]) or {}).get("pid") == sc.pid:
                    sc.led.db.execute("DELETE FROM meta WHERE k=?", (LEASE_KEY,))
        except Exception:
            pass
        log.info(json.dumps({"kind": "stop", "pid": os.getpid(), "at_ct": iso_ct(time.time()), "cycles": sc.cycles, "errors": sc.errors}))
        try:
            if _read_pid(P) == os.getpid():
                os.remove(P["pid"])
        except OSError:
            pass
        sc.led.close()
        os._exit(0)          # abandoned score threads must not keep the process alive
    return 0


def once(db):
    """One foreground scan (waits for a running daemon's scan to finish first). -> cycle stats."""
    P = paths(db)
    sc = make(db, heartbeat=False)
    with _cycle_lock(P["cycle_lock"], blocking=True):
        st = sc.cycle()
    st["calls_last_hour_this_process"] = {k: len(v) for k, v in sc.calls.items()}
    return st
