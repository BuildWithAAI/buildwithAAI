"""Momentum + narrative selection for the paper 'momentum' book (SIMULATION ONLY; UNPROVEN, no claimed edge).

Signals are computed at entry from market data the paper engine already fetches (no extra per-coin calls):
  DexScreener pair (batch /tokens/v1): txns m5/h1 buys+sells, volume m5/h1, priceChange m5/h1/h6, marketCap, pairCreatedAt
  GeckoTerminal top pool (same batch tokens/multi call, include=top_pools): unique buyers/sellers m5/h1, when present
  our own 15-min marks of the launch (peak price seen) for the pullback / new-high state

Every component is mapped to 0..1 and combined with config weights into a 0..100 momentum score; components with no
data are dropped and the remaining weights renormalised (and `coverage` says how much weight had data). The risk score
is NOT replaced: SKIP from the risk model or the entry gates is a hard veto upstream; here the risk score only applies a
small penalty and REDUCED caps the size. All thresholds live in MomentumConfig (override: JSON file at
$SMR_MOMENTUM_CONFIG or data/momentum.json). Defaults are conservative guesses, not fitted values."""
from __future__ import annotations
import json, math, os
from dataclasses import dataclass, field, asdict, fields

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@dataclass
class MomentumConfig:
    enabled: bool = True
    # ---- momentum component weights (relative) ----
    weights: dict = field(default_factory=lambda: {"volume_accel": 0.20, "buy_pressure": 0.20, "price_trend": 0.20,
                                                   "turnover": 0.15, "unique_buyers": 0.10, "peak_state": 0.15})
    accel_lo: float = 0.5          # m5 volume x12 / h1 volume: 0.5 -> 0, 2.0 -> 1
    accel_hi: float = 2.0
    buy_ratio_lo: float = 0.45     # buys/(buys+sells), m5 and h1 blended: 0.45 -> 0, 0.70 -> 1
    buy_ratio_hi: float = 0.70
    h1_change_full: float = 100.0  # +100% in 1 h -> full price-trend credit
    m5_change_full: float = 20.0
    turnover_full: float = 1.0     # h1 volume / market cap: 100% turnover in an hour -> 1
    buyers_m5_full: float = 150.0  # unique buyers in 5 min for full credit
    min_coverage: float = 0.5      # need data for >= 50% of the weight, else no entry
    # ---- combination ----
    w_momentum: float = 0.70
    w_narrative: float = 0.30
    risk_penalty_from: float = 20.0   # risk score points above this ...
    risk_penalty_per_pt: float = 0.5  # ... cost this many combined points each (SKIP >= 40 is vetoed before this)
    min_momentum: float = 50.0        # both floors must hold to enter
    min_combined: float = 55.0
    # ---- sizing (fraction of realized bankroll) ----
    size_tiers: list = field(default_factory=lambda: [[75.0, 0.02], [65.0, 0.015], [55.0, 0.01]])
    reduced_max_size: float = 0.01    # risk REDUCED (score >= 35 or gates) caps the size
    max_open: int = 12                # concurrent momentum positions
    max_new_per_cycle: int = 4        # best-ranked first
    watch_s: int = 6 * 3600           # non-SKIP launches are re-checked for momentum until this long after launch
    # ---- moon-bag exit ----
    stop_loss: float = -0.50          # before the partial: -50% on market price
    take_profit: float = 1.00         # at 2x: sell enough to recover stake + fees
    partial_min_frac: float = 0.50
    partial_max_frac: float = 0.60
    trail_from_peak: float = 0.40     # moon bag: sell when price is 40% below its peak since the partial
    max_hold_s: int = 48 * 3600       # moon bag max hold (from entry)
    pre_tp_time_exit_s: int = 24 * 3600   # no 2x within 24 h -> exit like the strategy book
    # ---- narrative ----
    narrative_window_s: int = 6 * 3600
    runner_h6_change: float = 100.0   # a coin "ran": +100% in 6 h, or
    runner_h1_volume: float = 100_000.0  # >= $100k volume in 1 h, or it graduated / 2x'd in our ledger
    theme_min_coins: int = 2
    narrative_runners_full: int = 4   # runners in the theme (other than the coin) for full credit
    fading_h1_change: float = -30.0   # theme runners' median h1 change below this = fading
    late_copycat_after_s: int = 3 * 3600  # coin created this long after the theme's first runner, in a fading theme

    @classmethod
    def load(cls, path=None):
        path = path or os.environ.get("SMR_MOMENTUM_CONFIG") or os.path.join(ROOT, "data", "momentum.json")
        c = cls()
        if path and os.path.exists(path):
            try:
                with open(path) as f:
                    over = json.load(f)
                names = {f.name for f in fields(cls)}
                for k, v in (over or {}).items():
                    if k in names:
                        setattr(c, k, v)
            except (OSError, ValueError):
                pass
        if os.environ.get("SMR_PAPER_MOMENTUM", "").strip() in ("0", "false", "off"):
            c.enabled = False
        return c

    def as_dict(self):
        return asdict(self)


def _f(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _clamp01(x):
    return max(0.0, min(1.0, x))


def _ramp(x, lo, hi):
    if x is None:
        return None
    return _clamp01((x - lo) / (hi - lo)) if hi > lo else float(x >= hi)


# ---- raw extraction (numbers only: nothing textual from the market data is kept) ---------------------------------
def from_dex_pair(p):
    """Numeric momentum fields of a DexScreener pair dict."""
    if not isinstance(p, dict):
        return None
    tx, vol, ch = p.get("txns") or {}, p.get("volume") or {}, p.get("priceChange") or {}
    out = {}
    for w in ("m5", "h1", "h6"):
        t = tx.get(w) or {}
        out[f"buys_{w}"] = _f(t.get("buys")); out[f"sells_{w}"] = _f(t.get("sells"))
        out[f"vol_{w}"] = _f(vol.get(w)); out[f"chg_{w}"] = _f(ch.get(w))
    out["pair_created_ms"] = _f(p.get("pairCreatedAt"))
    return out


def from_gt_pool(attrs):
    """Unique buyers/sellers from a GeckoTerminal pool's attributes (transactions.m5/h1)."""
    if not isinstance(attrs, dict):
        return None
    tx = attrs.get("transactions") or {}
    out = {}
    for w in ("m5", "h1"):
        t = tx.get(w) or {}
        out[f"buyers_{w}"] = _f(t.get("buyers")); out[f"sellers_{w}"] = _f(t.get("sellers"))
    return out if any(v is not None for v in out.values()) else None


def peak_state(raw, ret_now=None, max_ret=None):
    """new_high | near_high | pullback | fading | unknown, plus drawdown from the peak we observed (if any).
    From priceChange buckets: m5>0 and h1>0 -> rising; h1>0, m5 <= -10 -> pulling back; h6 up big but h1 down -> fading.
    When we have our own marks (ret_now/max_ret vs the launch entry), drawdown from that peak refines it."""
    m5, h1, h6 = (raw or {}).get("chg_m5"), (raw or {}).get("chg_h1"), (raw or {}).get("chg_h6")
    dd = None
    if ret_now is not None and max_ret is not None and max_ret > -1:
        dd = 1 - (1 + ret_now) / (1 + max(max_ret, ret_now))
    if m5 is None and h1 is None:
        st = "unknown"
    elif (h1 or 0) <= -25 or (h6 is not None and h6 >= 100 and (h1 or 0) < -10):
        st = "fading"
    elif (m5 or 0) > 0 and (h1 or 0) > 0:
        st = "new_high" if dd is None or dd <= 0.05 else ("near_high" if dd <= 0.15 else "pullback")
    elif (h1 or 0) > 0 and (m5 or 0) <= -10:
        st = "pullback"
    elif (h1 or 0) > 0:
        st = "near_high"
    else:
        st = "pullback" if (m5 or 0) > 0 else "fading"
    if dd is not None and dd >= 0.5:
        st = "fading"
    return st, (None if dd is None else round(dd, 4))


PEAK_CREDIT = {"new_high": 1.0, "near_high": 0.75, "pullback": 0.4, "fading": 0.0}


def momentum_score(raw, gt=None, mcap_usd=None, cfg: MomentumConfig | None = None, ret_now=None, max_ret=None):
    """-> dict(score 0..100 or None, coverage, components, signals). Pure function of its inputs."""
    cfg = cfg or MomentumConfig()
    raw = raw or {}
    g = gt or {}
    v5, v1 = raw.get("vol_m5"), raw.get("vol_h1")
    accel = (v5 * 12 / v1) if v5 is not None and v1 else None
    def ratio(b, s):
        return b / (b + s) if b is not None and s is not None and b + s > 0 else None
    r5, r1 = ratio(raw.get("buys_m5"), raw.get("sells_m5")), ratio(raw.get("buys_h1"), raw.get("sells_h1"))
    br = (0.6 * r5 + 0.4 * r1) if r5 is not None and r1 is not None else (r5 if r5 is not None else r1)
    m5, h1 = raw.get("chg_m5"), raw.get("chg_h1")
    trend = None
    if h1 is not None or m5 is not None:
        trend = 0.6 * _clamp01((h1 or 0) / cfg.h1_change_full) + 0.4 * _clamp01((m5 or 0) / cfg.m5_change_full)
    turnover = (v1 / mcap_usd) if v1 is not None and mcap_usd else None
    buyers = g.get("buyers_m5")
    st, dd = peak_state(raw, ret_now, max_ret)
    comps = {"volume_accel": _ramp(accel, cfg.accel_lo, cfg.accel_hi), "buy_pressure": _ramp(br, cfg.buy_ratio_lo, cfg.buy_ratio_hi),
             "price_trend": trend, "turnover": None if turnover is None else _clamp01(turnover / cfg.turnover_full),
             "unique_buyers": None if buyers is None else _clamp01(buyers / cfg.buyers_m5_full),
             "peak_state": PEAK_CREDIT.get(st)}
    w = cfg.weights
    tot = sum(w.values()) or 1.0
    have = {k: v for k, v in comps.items() if v is not None and w.get(k)}
    cov = sum(w[k] for k in have) / tot
    score = None
    if have and cov >= cfg.min_coverage:
        score = round(100 * sum(w[k] * v for k, v in have.items()) / sum(w[k] for k in have), 1)
    rnd = lambda x, n=3: None if x is None else round(x, n)
    return {"score": score, "coverage": round(cov, 2), "components": {k: rnd(v) for k, v in comps.items()},
            "signals": {"vol_m5_usd": rnd(v5, 0), "vol_h1_usd": rnd(v1, 0), "vol_accel_x": rnd(accel, 2),
                        "buy_ratio_m5": rnd(r5), "buy_ratio_h1": rnd(r1), "txns_m5": _sum(raw.get("buys_m5"), raw.get("sells_m5")),
                        "chg_m5_pct": rnd(m5, 1), "chg_h1_pct": rnd(h1, 1), "chg_h6_pct": rnd(raw.get("chg_h6"), 1),
                        "unique_buyers_m5": buyers, "unique_buyers_h1": g.get("buyers_h1"), "unique_sellers_m5": g.get("sellers_m5"),
                        "turnover_h1": rnd(turnover), "peak_state": st, "drawdown_from_seen_peak": dd}}


def _sum(a, b):
    return None if a is None and b is None else int((a or 0) + (b or 0))


def combine(mom, narr, risk_score, decision, cfg: MomentumConfig | None = None):
    """Selection among NON-SKIP coins only. -> dict(combined, size_pct, enter, why). SKIP -> never enters."""
    cfg = cfg or MomentumConfig()
    if decision not in ("NORMAL", "REDUCED"):
        return {"combined": None, "size_pct": 0.0, "enter": False, "why": "risk/gates SKIP (hard veto)"}
    m = mom.get("score") if mom else None
    if m is None:
        return {"combined": None, "size_pct": 0.0, "enter": False, "why": "momentum data missing"}
    n = (narr or {}).get("score") or 0.0
    pen = max(0.0, (risk_score or 0) - cfg.risk_penalty_from) * cfg.risk_penalty_per_pt
    c = round(cfg.w_momentum * m + cfg.w_narrative * n - pen, 1)
    if m < cfg.min_momentum:
        return {"combined": c, "size_pct": 0.0, "enter": False, "why": f"momentum {m} under {cfg.min_momentum}"}
    if c < cfg.min_combined:
        return {"combined": c, "size_pct": 0.0, "enter": False, "why": f"combined {c} under {cfg.min_combined}"}
    size = 0.0
    for lo, pct in sorted(cfg.size_tiers, key=lambda t: -t[0]):
        if c >= lo:
            size = pct; break
    if decision == "REDUCED":
        size = min(size, cfg.reduced_max_size)
    return {"combined": c, "size_pct": size, "enter": size > 0, "why": "momentum+narrative pass" if size > 0 else "no size tier"}


# ---- moon-bag exit (pure) -----------------------------------------------------------------------------------------
def partial_fraction(size_usd, tokens, target_price, exit_cost_fn, cfg: MomentumConfig | None = None):
    """Fraction of tokens to sell at the 2x target so the proceeds after exit costs return the whole stake (size_usd
    already includes the entry fee/slippage), bounded to [partial_min_frac, partial_max_frac]."""
    cfg = cfg or MomentumConfig()
    value = tokens * target_price
    if value <= 0:
        return cfg.partial_max_frac
    f = 0.5
    for _ in range(8):     # exit cost depends on the sale size: fixed-point iterate
        xc = exit_cost_fn(value * f)
        if xc >= 1:
            return cfg.partial_max_frac
        f = size_usd / (value * (1 - xc))
    f = math.ceil(f * 1e4) / 1e4      # round up: never short of the stake
    return max(cfg.partial_min_frac, min(cfg.partial_max_frac, f))


def evaluate_moon_exit(pos, price, now, cfg: MomentumConfig | None = None):
    """-> (action, reason, fill_price) or None. action: 'partial' | 'close'. Pure.
    Before the partial: 2x -> partial at the target (resting limit), -50% -> close at observed price,
    pre_tp_time_exit_s -> close. After: trailing stop trail_from_peak below the peak since entry (>= the 2x level),
    or max_hold_s from entry -> close the moon bag at the observed price."""
    cfg = cfg or MomentumConfig()
    if price is None:
        return None
    r = price / pos["entry_price"] - 1
    age = now - pos["entry_at"]
    if not pos.get("partial_at"):
        if r >= cfg.take_profit:
            return "partial", "take_profit_partial_2x", pos["entry_price"] * (1 + cfg.take_profit)
        if r <= cfg.stop_loss:
            return "close", "stop_loss", price
        if age >= cfg.pre_tp_time_exit_s:
            return "close", f"time_exit_{int(cfg.pre_tp_time_exit_s // 3600)}h", price
        return None
    peak = max(pos.get("peak_price") or 0, price, pos["entry_price"] * (1 + cfg.take_profit))
    if price <= peak * (1 - cfg.trail_from_peak):
        return "close", "moon_bag_trailing_stop", price
    if age >= cfg.max_hold_s:
        return "close", f"moon_bag_max_hold_{int(cfg.max_hold_s // 3600)}h", price
    return None
