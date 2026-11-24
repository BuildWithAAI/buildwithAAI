"""Signal-driven shadow exit books (Zoorped 2026-11-04). SIMULATION ONLY: nothing here can trade.

Research: /workspace/runners/signal_exit_backtest.md (28-trade fair set, 1-min candles). Two silent control books mirror
every momentum entry, like momentum_ladder / momentum_x1 ($1,000 notional each, never cash-limited, no events/alerts):

  momentum_clip5_rug_dust  the live clip5 exit (20% of the original at 2x/3x/4x/6x/10x at the rung price; -50% stop before
                           the first clip, then max(entry, 60% of the peak) at the mark; 48 h max hold) PLUS
                           * rug rule: a mark <= 0.65 x the previous mark (<= 20 min old) -> sell everything but the dust at
                             the NEXT mark;
                           * fade deterioration (PAPER simulation assumption, NOT validated/optimal): when TWO fresh marks
                             both have complete DexScreener m5 buys+sells (and preferably vol_m5), sell-share rises and
                             activity fades vs the prior mark, and price is not making a new high -> sell tradeable at NEXT
                             mark. Missing/stale/incomplete flow data never triggers a fade sell (retain stop/rug/trail).
                           * a permanent 5% dust bag: 5% of the tokens are never sold (the 10x rung sells 15%, not 20%).
  momentum_sighv           SIG-HV (no fixed multiples): nothing is sold under a 2x mark; above it sell 20% of what is left
                           each time the mark clears the last sale by max(25%, min(100%, 3 x ATR15)); sell 15% on every
                           overheated new high (mark >= 1.4 x 15-min mean); pressure score (red share, upper wick, momentum
                           decay, -20% and -35% from the high, big sell candle) sells 12.5/25/50% of what is left at scores
                           2/3/4, re-armed on each new high; rug rule (as above, or a big sell candle at -35% from the
                           high); stop -50% of entry until the first sale, then max(entry, 60% of the peak); 5% dust;
                           48 h max hold.

Fills: signal sales (rug rule, vol-step, heat, pressure) are decided at one mark and filled at the NEXT mark's price
(intended = the deciding mark, actual = the next mark; both logged). Stops and max hold fill at the mark that crosses
them (gap-through). clip5 rungs fill at the rung price, exactly like the live book. Dust: never sold; the book's realized
PnL counts it at ZERO, the report also values it at its last marked price. Closed positions keep their dust tokens and
the watcher re-marks them about every 15 min while it has spare room in its DexScreener batch."""
from __future__ import annotations
import json, math
from dataclasses import dataclass
from . import costs as K
from . import exits as X

DUST_FRAC = 0.05
RUG_RATIO = 0.65
PREV_MAX_AGE_S = 20 * 60          # the rug rule compares with the previous mark only if it is at most this old
HIST_S = 45 * 60                  # marks/candles history used by the features

# ---- fade deterioration (clip5_rug_dust / experiment100) -----------------------------------------------
# LABELED SIMULATION ASSUMPTIONS — not backtested as optimal; not a claim of live liquidation certainty.
FADE_POLICY_VERSION = "fade_exit_20261105-v1"
FADE_MIN_MARK_GAP_S = 45          # need distinct watcher observations (~60s cadence); reject same-second noise
FADE_MIN_TXNS_M5 = 10             # both marks need buys_m5+sells_m5 >= this (else data insufficient)
FADE_SELL_SHARE = 0.65            # current m5 sell share must be at least this
FADE_SELL_SHARE_RISE = 0.15       # and at least this much higher than the prior fresh mark
FADE_ACTIVITY_RATIO = 0.70        # vol_m5 or txn count must fall to <= this fraction of the prior mark


@dataclass(frozen=True)
class SigHV:
    name: str = "sighv"
    pre_stop: float = -0.50
    min_profit_x: float = 2.0
    k_atr: float = 3.0
    atr_window_s: int = 900
    step_min: float = 0.25
    step_max: float = 1.0
    vslice: float = 0.20
    ext_ratio: float = 1.4
    mean_window_s: int = 900
    heat_slice: float = 0.15
    tiers: tuple = ((4, 0.50), (3, 0.25), (2, 0.125))
    keep: float = 0.60
    dust: float = DUST_FRAC
    max_hold_s: int = 48 * 3600
    rug_ratio: float = RUG_RATIO
    bigsell_dd: float = 0.35
    red_share: float = 0.6
    red_min_txns: int = 10
    mdecay_run: float = 0.30

    def describe(self, grad=None):
        t = ", ".join(f"{f:.1%} at score {s}" for s, f in sorted(self.tiers))
        return (f"sighv: no sale under {self.min_profit_x:g}x; then {self.vslice:.0%} of the rest each time the mark clears the last sale by "
                f"max({self.step_min:.0%}, min({self.step_max:.0%}, {self.k_atr:g} x ATR15)); {self.heat_slice:.0%} on each overheated new high "
                f"(>= {self.ext_ratio:g}x the 15-min mean); pressure sells {t} (re-armed on a new high); rug rule (mark <= {self.rug_ratio:g}x the "
                f"previous mark, or a big sell candle at -35% from the high) sells all but the dust at the next mark; stop {self.pre_stop:+.0%} "
                f"until the first sale, then max(entry, {self.keep:.0%} of the peak); {self.dust:.0%} dust never sold; max hold {self.max_hold_s / 3600:g}h")


SIGHV = SigHV()
CLIP5_RUG_DUST = X.Policy("clip5_rug_dust", X.POLICIES["clip5"].rungs, keep=0.60)
# control policy name -> book (engine.CONTROL_BOOKS adds these)
SIGNAL_BOOKS = {"momentum_clip5_rug_dust": "clip5_rug_dust", "momentum_sighv": "sighv"}


def describe(name):
    if name == "sighv":
        return SIGHV.describe()
    if name == "clip5_rug_dust":
        return (CLIP5_RUG_DUST.describe().replace("clip5_rug_dust:", "clip5_rug_dust: clip5 (live rules)")
                + f"; + rug rule (mark <= {RUG_RATIO:g}x the previous mark -> sell all but the dust at the next mark)"
                + f"; + fade deterioration {FADE_POLICY_VERSION} (sim assumption: rising m5 sell-share + fading m5 activity "
                  f"on two fresh complete marks -> next-mark exit; missing flow data never sells); "
                  f"{DUST_FRAC:.0%} dust never sold (the 10x rung sells 15%)")
    return None


def stop_level(name, entry, clipped, peak):
    if not clipped:
        return entry * 0.5
    return max(entry, 0.60 * (peak or entry))


def tradeable(p):
    return max(0.0, (p.get("tokens") or 0.0) - (p.get("dust_tokens") or 0.0))


def dust_value(tokens, price, liq, entry_cost):
    """Dust at a price after exit costs (what selling it would return)."""
    if not tokens or not price:
        return 0.0
    v = tokens * price
    return v * (1 - K.exit_cost(v, liq, entry_cost))


# ---- features (pure) ------------------------------------------------------------------------------------------
def _price_at(marks, t):
    best = None
    for m in marks:
        if m["at"] <= t + 1e-6:
            best = m
        else:
            break
    return best


def features(marks, candles, peak_before, cfg: SigHV = SIGHV):
    """marks: ascending [{at, price, buys_m5, sells_m5, ...}], the last one is the current mark. candles: closed 1-min
    GeckoTerminal bars [[t, o, h, l, c, v], ...] ascending (may be empty). peak_before: highest mark before this one
    (at least the entry price). Every feature uses data up to the current mark only."""
    cur = marks[-1]
    now, c = cur["at"], cur["price"]
    prev = marks[-2] if len(marks) >= 2 and now - marks[-2]["at"] <= PREV_MAX_AGE_S else None
    rug = bool(prev and prev["price"] and c <= cfg.rug_ratio * prev["price"])
    rh = max(peak_before or c, c)
    newhigh = c > (peak_before or 0)
    dd = 1 - c / rh if rh > 0 else 0.0
    cs = [x for x in candles if x[0] >= now - cfg.mean_window_s - 60]
    if len(cs) >= 5:
        closes = [x[4] for x in cs] + [c]
    else:
        closes = [m["price"] for m in marks if m["at"] >= now - cfg.mean_window_s]
    mean = sum(closes) / len(closes) if closes else c
    ext = mean > 0 and c >= cfg.ext_ratio * mean
    # momentum decay: 5-min rate of change now <= 0 after >= +30% within the last 15 min (marks)
    def roc(m):
        p5 = _price_at(marks, m["at"] - 300)
        return (m["price"] / p5["price"] - 1) if p5 and p5["price"] and m["at"] - p5["at"] <= 420 else None
    rocs = [r for r in (roc(m) for m in marks if m["at"] >= now - 900) if r is not None]
    r_now = roc(cur)
    mdecay = bool(rocs and max(rocs) >= cfg.mdecay_run and r_now is not None and r_now <= 0)
    # red share: 1-min candles (red-candle volume share over 5 bars) when fresh, else DexScreener m5 sells/(buys+sells)
    last = candles[-1] if candles and candles[-1][0] >= now - 180 else None
    red, red_src = False, None
    c5 = [x for x in candles if x[0] >= now - 360][-5:]
    if last is not None and c5 and sum(x[5] for x in c5) > 0:
        red = sum(x[5] for x in c5 if x[4] < x[1]) / sum(x[5] for x in c5) >= cfg.red_share; red_src = "gt_candles"
    else:
        b, s = cur.get("buys_m5"), cur.get("sells_m5")
        if b is not None and s is not None and b + s >= cfg.red_min_txns:
            red = s / (b + s) >= cfg.red_share; red_src = "dexscreener_m5_counts"
    wick = bigsell = False
    if last is not None:
        t, o, h, l, cc, v = last[:6]
        rng = h - l
        wick = bool(rng > 0 and h > 0 and (h - max(o, cc)) / rng >= 0.3 and (h - max(o, cc)) / h >= 0.10 and h >= 0.9 * max(rh, h))
        prior = [x for x in candles[:-1]][-20:]
        vavg = sum(x[5] for x in prior) / len(prior) if prior else 0
        bigsell = bool(cc < o and vavg > 0 and v >= 3 * vavg and cc <= 0.85 * o)
    # volatility (ATR15 as a fraction of price): candle ranges when there are >= 5 recent bars, else mark-to-mark moves
    cv = [x for x in candles if x[0] >= now - cfg.atr_window_s - 60 and x[4] > 0]
    if len(cv) >= 5:
        vol = sum((x[2] - x[3]) / x[4] for x in cv) / len(cv); vol_src = "gt_candles"
    else:
        mv = [m for m in marks if m["at"] >= now - cfg.atr_window_s]
        ch = [abs(b["price"] / a["price"] - 1) for a, b in zip(mv, mv[1:]) if a["price"]]
        vol = sum(ch) / len(ch) if ch else 0.0; vol_src = "marks"
    f = {"price": c, "prev_price": prev["price"] if prev else None, "rug": rug, "newhigh": newhigh, "rh": rh, "dd": dd,
         "dd20": dd >= 0.20, "dd35": dd >= 0.35, "ext": bool(ext), "mean15": mean, "mdecay": mdecay, "roc5": r_now,
         "red5": bool(red), "red_src": red_src, "wick": wick, "bigsell": bigsell, "vol": vol, "vol_src": vol_src,
         "candles": len(candles)}
    f["pressure"] = sum(bool(f[k]) for k in ("red5", "wick", "mdecay", "dd20", "dd35", "bigsell"))
    return f


# ---- decisions (pure) -----------------------------------------------------------------------------------------
def decide_sighv(st, entry, entry_at, price, peak_before, f, now, cfg: SigHV = SIGHV):
    """-> (immediate, pending, new_state). immediate: ("stop"|"max_hold", reason, trigger) sells the rest (but dust) at
    this mark. pending: (fraction of the tradeable rest, reason) filled at the next mark. Same order as the backtest:
    floor, max hold, re-arm on a new high, rug rule, min-profit gate, vol-step, pressure tiers, heat."""
    st = dict(st or {})
    clipped = bool(st.get("clipped"))
    lvl = entry * (1 + cfg.pre_stop) if not clipped else max(entry, cfg.keep * (peak_before or entry))
    if price <= lvl:
        return ("stop", "sighv_stop_loss" if not clipped else "sighv_floor", lvl), None, st
    if now - entry_at >= cfg.max_hold_s:
        return ("max_hold", f"sighv_max_hold_{int(cfg.max_hold_s // 3600)}h", None), None, st
    if f["newhigh"]:
        st["tier"] = 0
    if f["rug"] or (f["bigsell"] and f["dd"] >= cfg.bigsell_dd):
        return None, (1.0, "sighv_rug_rule" if f["rug"] else "sighv_big_sell_rug"), st
    if price < cfg.min_profit_x * entry:
        return None, None, st
    g = min(cfg.step_max, max(cfg.step_min, cfg.k_atr * (f.get("vol") or 0.0)))
    if st.get("ref") is None or price >= st["ref"] * (1 + g):
        st.update(ref=price, clipped=True)
        return None, (cfg.vslice, f"sighv_vstep_{g:.2f}"), st
    want, frac = 0, 0.0
    for score, fr in cfg.tiers:
        if f["pressure"] >= score:
            want, frac = score, fr; break
    if want and want > int(st.get("tier") or 0):
        st.update(tier=want, clipped=True)
        return None, (frac, f"sighv_pressure_{f['pressure']}"), st
    if f["ext"] and f["newhigh"]:
        st["clipped"] = True
        return None, (cfg.heat_slice, "sighv_heat"), st
    return None, None, st



def _m5_flow(mark):
    """-> (buys, sells, vol, txns, sell_share) or None if incomplete / non-finite."""
    if not mark:
        return None
    try:
        b, s = mark.get("buys_m5"), mark.get("sells_m5")
        if b is None or s is None:
            return None
        b, s = float(b), float(s)
        if not (math.isfinite(b) and math.isfinite(s)) or b < 0 or s < 0:
            return None
        tx = b + s
        if tx < FADE_MIN_TXNS_M5:
            return None
        vol = mark.get("vol_m5")
        vol = float(vol) if vol is not None and math.isfinite(float(vol)) else None
        return b, s, vol, tx, s / tx
    except (TypeError, ValueError):
        return None


def fade_deterioration(cur_mark, prev_mark, now, peak_price=None):
    """Confirmed momentum/flow deterioration vs a prior FRESH mark, or None.

    Returns None when data is missing/stale/insufficient — callers MUST retain stop/rug/trail (no fictitious sell).
    On hit -> dict with reason + immutable observation audit fields (simulation assumption labels included).
    Precedence is caller-side: hard stop / max hold / rug beat fade.
    """
    if not cur_mark or not prev_mark:
        return None
    try:
        cat, pat = float(cur_mark.get("at") or 0), float(prev_mark.get("at") or 0)
        cpx, ppx = float(cur_mark.get("price") or 0), float(prev_mark.get("price") or 0)
    except (TypeError, ValueError):
        return None
    if cat <= 0 or pat <= 0 or cpx <= 0 or ppx <= 0:
        return None
    age = cat - pat
    if age < FADE_MIN_MARK_GAP_S or age > PREV_MAX_AGE_S:
        return None
    if now - cat > PREV_MAX_AGE_S:  # current observation itself too stale vs decision time
        return None
    cur_f, prev_f = _m5_flow(cur_mark), _m5_flow(prev_mark)
    if not cur_f or not prev_f:
        return None
    cb, cs, cv, ctx, cshare = cur_f
    pb, ps, pv, ptx, pshare = prev_f
    if cshare < FADE_SELL_SHARE or cshare < pshare + FADE_SELL_SHARE_RISE - 1e-12:
        return None
    # activity fade: prefer vol_m5 when both present; else txn count
    if cv is not None and pv is not None and pv > 0:
        activity_ok = cv <= FADE_ACTIVITY_RATIO * pv + 1e-12
        activity_kind = "vol_m5"
        activity_cur, activity_prev = cv, pv
    else:
        activity_ok = ctx <= FADE_ACTIVITY_RATIO * ptx + 1e-12
        activity_kind = "txns_m5"
        activity_cur, activity_prev = ctx, ptx
    if not activity_ok:
        return None
    # do not treat strength/new-high as "dying"
    peak = float(peak_price or cpx)
    if cpx >= peak - 1e-18 and cpx > ppx:
        return None
    if cpx > ppx:  # still printing higher vs prior mark — not confirmed dying on price+flow
        return None
    return {
        "reason": "clip5_rug_dust_fade_deterioration",
        "policy_version": FADE_POLICY_VERSION,
        "assumption_label": "SIMULATION_ASSUMPTION_NOT_VALIDATED",
        "decide_at": cat,
        "decide_at_ct": None,  # filled by caller with iso_ct if desired
        "prev_at": pat,
        "cur_price": cpx,
        "prev_price": ppx,
        "cur_buys_m5": cb, "cur_sells_m5": cs, "cur_sell_share": round(cshare, 4),
        "prev_buys_m5": pb, "prev_sells_m5": ps, "prev_sell_share": round(pshare, 4),
        "activity_kind": activity_kind,
        "activity_cur": activity_cur, "activity_prev": activity_prev,
        "activity_ratio": round(activity_cur / activity_prev, 4) if activity_prev else None,
        "thresholds": {"sell_share": FADE_SELL_SHARE, "sell_share_rise": FADE_SELL_SHARE_RISE,
                       "activity_ratio": FADE_ACTIVITY_RATIO, "min_txns_m5": FADE_MIN_TXNS_M5,
                       "min_gap_s": FADE_MIN_MARK_GAP_S, "max_prev_age_s": PREV_MAX_AGE_S},
        "source": "dexscreener_m5_counts_on_marks",
        "watcher_cadence_note": "evaluated on ~60s watcher marks, not tick realtime",
    }


def decide_clip5_rug_dust(pos, price, prev_price, now, *, prev_mark=None, cur_mark=None):
    """-> (actions from the live clip5 rules on the non-dust tokens, pending next-mark sale or None).

    Precedence: hard stop / max_hold (immediate) > rug pending > fade pending > rungs in `acts`.
    Fade never fires on missing/stale/incomplete m5 flow — existing stop/rug/trail retained.
    """
    acts = X.evaluate(CLIP5_RUG_DUST, pos, price, now)
    if acts and acts[0][0] in ("stop", "max_hold"):
        return acts, None
    pend = None
    if prev_price and price <= RUG_RATIO * prev_price:
        pend = (1.0, "clip5_rug_dust_rug_rule")  # 2-tuple preserved for legacy tests; audit via sigbooks default
    else:
        fade = fade_deterioration(cur_mark, prev_mark, now, peak_price=pos.get("peak_price") or pos.get("entry_price"))
        if fade:
            pend = (1.0, fade["reason"], fade)
    return acts, pend



def loads(s, default):
    try:
        v = json.loads(s) if s else default
        return v if v is not None else default
    except (TypeError, ValueError):
        return default


def finite(x):
    return x is not None and isinstance(x, (int, float)) and math.isfinite(x)
