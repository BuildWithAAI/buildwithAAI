"""Zoora Strategy research harness.

For every (data source, symbol, timeframe, variant, EMA pair) it runs, on a
single-symbol simulated account with compounding 1% risk:

* FULL   : first tradable bar after EMA warm-up -> end of data
* IS/OOS : chronological split of the post-warm-up bars (default 70/30); each
           side on a fresh account; OOS features use only data before each bar
* WF     : rolling walk-forward on post-warm-up bars. The ONLY parameter chosen
           on each train window is ``stop_atr`` in {2, 3} (objective Sharpe,
           >= 5 trades); the next unseen test window is traded with it. Test
           windows are stitched by compounding.

The in-simulation drawdown kill switch is disabled (research mode) so the
raw behaviour is visible; the first 20% breach is still recorded.
Every number written by this module comes from an engine run.
"""

from __future__ import annotations

import json
import logging
import math
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ..backtest.engine import BacktestEngine, BacktestResult
from ..config import AppConfig, load_config
from ..data.base import Timeframe
from ..data.store import ParquetStore
from ..data.validation import validate_ohlcv
from ..strategies import make_strategy
from ..strategies.zoora import ema_warmup_bars

log = logging.getLogger(__name__)

VARIANTS: dict[str, dict[str, Any]] = {
    "zoora_trend": {"stop_atr": 3.0},
    "zoora_pullback": {"stop_atr": 2.0, "band_atr": 0.25, "target_r": 2.0},
    "zoora_cross": {"stop_atr": 3.0},
}
EMA_PAIRS: dict[str, tuple[int, int]] = {"200/800": (200, 800), "198/792": (198, 792)}
WF_BARS: dict[str, tuple[int, int]] = {"D1": (780, 260), "H4": (4680, 1560), "H1": (12480, 6240)}
WF_GRID = {"stop_atr": [2.0, 3.0]}
KEEP = ("trade_count", "cagr_pct", "sharpe", "sortino", "max_drawdown_pct", "profit_factor", "expectancy_r",
        "win_rate_pct", "total_return_pct", "total_swap", "total_commission", "period_days", "long_trades",
        "short_trades", "avg_bars_held")


# ------------------------------------------------------------------ data prep
COMMON_WARMUP = max(ema_warmup_bars(s) for _, s in EMA_PAIRS.values())


def prepare_dukascopy(cfg: AppConfig, root: Path, symbols: list[str], start: datetime) -> dict[str, Any]:
    """Download (cached) Dukascopy BID+ASK H1, build mid H1, resample H4/D1 on server time, validate, store."""
    from ..data.dukascopy_provider import DukascopyProvider, resample_server_time
    prov = DukascopyProvider(root / "data/raw/dukascopy", workers=8, retries=15)
    store = ParquetStore(root / cfg.data.store_dir)
    summary: dict[str, Any] = {"provider": "dukascopy", "built_at": datetime.now(timezone.utc).isoformat(), "results": []}
    for sym in symbols:
        h1 = prov.fetch_h1_mid(sym, start, datetime.now(timezone.utc))
        spread = h1.pop("spread")
        tfs = {Timeframe.H1: h1, Timeframe.H4: resample_server_time(h1, Timeframe.H4),
               Timeframe.D1: resample_server_time(h1, Timeframe.D1)}
        for tf, raw in tfs.items():
            raw = raw.drop(columns=[c for c in raw.columns if c == "spread"])
            clean, rep = validate_ohlcv(raw, sym, tf)
            store.write(clean, "dukascopy", tf, sym, meta={"provider": "dukascopy", "validation": rep.to_dict()})
            summary["results"].append({"pair": sym, "timeframe": tf.value, "rows": rep.rows_out,
                                       "first_bar": rep.first_bar, "last_bar": rep.last_bar,
                                       "missing_bars": rep.missing_bars, "ohlc_repaired": rep.ohlc_repaired,
                                       "weekend_removed": rep.weekend_removed, "spikes": len(rep.spikes_flagged)})
        sp = spread[spread > 0]
        by_year = sp.groupby(sp.index.year).median()
        summary.setdefault("spread_median_price", {})[sym] = {
            "all": float(sp.median()), "p90": float(sp.quantile(0.9)),
            "by_year": {int(k): float(v) for k, v in by_year.items()}}
    out = root / cfg.data.store_dir / "dukascopy_summary.json"
    out.write_text(json.dumps(summary, indent=2, default=str))
    return summary


def prepare_yfinance_d1(cfg: AppConfig, root: Path, symbols: list[str]) -> dict[str, Any]:
    from ..data.yfinance_provider import YFinanceProvider
    prov, store = YFinanceProvider(), ParquetStore(root / cfg.data.store_dir)
    res = {}
    for sym in symbols:
        raw = prov.fetch(sym, Timeframe.D1, datetime(2000, 1, 1, tzinfo=timezone.utc), None)
        clean, rep = validate_ohlcv(raw, sym, Timeframe.D1)
        store.write(clean, "yfinance_long", Timeframe.D1, sym, meta={"provider": "yfinance", "validation": rep.to_dict()})
        res[sym] = {"rows": rep.rows_out, "first_bar": rep.first_bar, "last_bar": rep.last_bar,
                    "ohlc_repaired": rep.ohlc_repaired, "missing_bars": rep.missing_bars}
    return res


# ------------------------------------------------------------------ runs
def _m(r: BacktestResult | dict[str, Any]) -> dict[str, Any]:
    m = r.metrics if isinstance(r, BacktestResult) else r
    return {k: m.get(k) for k in KEEP}


def _exposure(res: BacktestResult, df: pd.DataFrame, t0: pd.Timestamp) -> float | None:
    idx = df.index[df.index >= t0]
    if not len(idx):
        return None
    inpos = np.zeros(len(idx), bool)
    for t in res.trades:
        inpos |= (idx >= t.entry_ts) & (idx < t.exit_ts)
    return float(100 * inpos.mean())


def _engine(cfg: AppConfig, variant: str, tf: str, params: dict[str, Any]) -> BacktestEngine:
    return BacktestEngine(cfg, make_strategy(variant, tf, params), enforce_drawdown_kill=False)


@dataclass
class Job:
    source: str
    symbol: str
    tf: str
    variant: str
    ema: str
    cfg_path: str
    root: str
    oos_fraction: float = 0.3


def run_job(job: Job) -> dict[str, Any]:
    t_start = time.time()
    cfg = load_config(job.cfg_path)
    root = Path(job.root)
    tf = Timeframe.parse(job.tf)
    df = ParquetStore(root / cfg.data.store_dir).read(job.source, tf, job.symbol)
    df = df[["open", "high", "low", "close", "volume"]]
    fast, slow = EMA_PAIRS[job.ema]
    base = {**VARIANTS[job.variant], "ema_fast": fast, "ema_slow": slow}
    strat = make_strategy(job.variant, job.tf, base)
    # Common evaluation window: both EMA pairs start trading after the LONGEST warm-up in the grid
    # (EMA800 -> 1843 bars), so 200/800 vs 198/792 are compared on identical bars / windows.
    warm = max(strat.warmup_bars, COMMON_WARMUP)
    out: dict[str, Any] = {"source": job.source, "symbol": job.symbol, "tf": job.tf, "variant": job.variant,
                           "ema": job.ema, "params": base, "warmup_bars": warm, "bars": len(df),
                           "data_first": df.index[0].isoformat(), "data_last": df.index[-1].isoformat()}
    if len(df) < warm + 300:
        out["skipped"] = f"only {len(df)} bars; need warm-up {warm} + 300"
        return out
    data = {job.symbol: df}
    post = df.index[warm:]
    t0 = post[0]
    split = post[int(len(post) * (1 - job.oos_fraction))]
    out.update({"trade_start": t0.isoformat(), "split": split.isoformat()})
    full = _engine(cfg, job.variant, job.tf, base).run(data, start=t0)
    out["full"] = _m(full)
    out["full"]["first_dd_breach"] = full.first_drawdown_breach
    out["full"]["rejections"] = full.rejections
    out["entries"] = [(t.entry_ts.isoformat(), t.side) for t in full.trades]
    eq = full.equity.resample("1D").last().dropna()
    out["daily_equity"] = {k.strftime("%Y-%m-%d"): float(v) for k, v in eq.items()}
    out["is"] = _m(_engine(cfg, job.variant, job.tf, base).run(data, start=t0, end=split))
    out["oos"] = _m(_engine(cfg, job.variant, job.tf, base).run(data, start=split))
    c = df["close"]
    out["buy_hold"] = {"full_pct": float(100 * (c.iloc[-1] / c[c.index >= t0].iloc[0] - 1)),
                       "oos_pct": float(100 * (c.iloc[-1] / c[c.index >= split].iloc[0] - 1))}
    out["full"]["time_in_market_pct"] = _exposure(full, df, t0)
    # walk-forward: choose stop_atr on each train window, apply it to the next unseen test window.
    # The test windows are traded as ONE continuous account (positions carry across window
    # boundaries) via a stop_atr schedule, so long-hold variants are not cut at window ends.
    tr_n, te_n = WF_BARS[job.tf]
    wins, sched = [], []
    s = 0
    while s + tr_n + 50 < len(post):
        tr0, tr1 = post[s], post[s + tr_n]
        te1 = post[min(s + tr_n + te_n, len(post) - 1)]
        best, best_v = None, None
        for st in WF_GRID["stop_atr"]:
            r = _engine(cfg, job.variant, job.tf, {**base, "stop_atr": st}).run(data, start=tr0, end=tr1)
            v = r.metrics.get("sharpe")
            if (r.metrics.get("trade_count") or 0) >= 5 and v is not None and (best_v is None or v > best_v):
                best, best_v = st, v
        chosen = best if best is not None else base["stop_atr"]
        sched.append((tr1.isoformat(), chosen))
        wins.append({"train": f"{tr0.date()}..{tr1.date()}", "test": f"{tr1.date()}..{te1.date()}",
                     "stop_atr": chosen, "train_sharpe": best_v, "fallback_default": best is None})
        s += te_n
    if sched:
        wf_start = pd.Timestamp(sched[0][0])
        rw = _engine(cfg, job.variant, job.tf, {**base, "stop_atr_schedule": sched}).run(data, start=wf_start)
        out["wf"] = _m(rw)
        out["wf"]["windows"] = len(wins)
        out["wf"]["start"] = wf_start.isoformat()
        out["buy_hold"]["wf_pct"] = float(100 * (c.iloc[-1] / c[c.index >= wf_start].iloc[0] - 1))
    else:
        out["wf"] = {"windows": 0, "note": "not enough post-warm-up bars for one window"}
    out["wf_windows"] = wins
    out["elapsed_s"] = round(time.time() - t_start, 1)
    return out


def run_all(cfg_path: str, root: Path, sources: dict[str, list[str]], symbols: list[str],
            workers: int = 7) -> list[dict[str, Any]]:
    jobs = [Job(src, sym, tf, v, e, cfg_path, str(root))
            for src, tfs in sources.items() for sym in symbols for tf in tfs for v in VARIANTS for e in EMA_PAIRS]
    # longest first for better packing
    jobs.sort(key=lambda j: {"H1": 0, "H4": 1, "D1": 2}[j.tf])
    with ProcessPoolExecutor(workers) as ex:
        return list(ex.map(run_job, jobs))


# ------------------------------------------------------------------ comparison
def head_to_head(a: dict[str, Any], b: dict[str, Any], tol_bars: int, tf: str) -> dict[str, Any]:
    """Compare 200/800 (a) with 198/792 (b) on the same source/symbol/tf/variant."""
    delta = pd.Timedelta(minutes=Timeframe.parse(tf).minutes * tol_bars)
    ea = [(pd.Timestamp(t), s) for t, s in a.get("entries", [])]
    eb = [(pd.Timestamp(t), s) for t, s in b.get("entries", [])]
    matched = sum(1 for ta, sa in ea if any(sa == sb and abs(ta - tb) <= delta for tb, sb in eb))
    da, db = pd.Series(a.get("daily_equity", {})), pd.Series(b.get("daily_equity", {}))
    j = pd.concat([da.pct_change(), db.pct_change()], axis=1).dropna()
    corr = float(j.corr().iloc[0, 1]) if len(j) > 10 and j.std().min() > 0 else None

    def d(k: str, seg: str) -> float | None:
        x, y = (a.get(seg) or {}).get(k), (b.get(seg) or {}).get(k)
        return None if x is None or y is None else float(y) - float(x)
    return {"entries_a": len(ea), "entries_b": len(eb),
            "matched_entries_pct": 100.0 * matched / len(ea) if ea else None,
            "daily_return_corr": corr,
            "d_cagr_full": d("cagr_pct", "full"), "d_exp_r_full": d("expectancy_r", "full"),
            "d_sharpe_full": d("sharpe", "full"), "d_cagr_oos": d("cagr_pct", "oos"),
            "d_exp_r_oos": d("expectancy_r", "oos"), "d_cagr_wf": d("cagr_pct", "wf")}


def _f(x: Any, nd: int = 2, pct: bool = False) -> str:
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return "-"
    return f"{x:.{nd}f}{'%' if pct else ''}"


def render(results: list[dict[str, Any]], data_summary: dict[str, Any]) -> str:
    lines = ["# Zoora Strategy research results", "",
             f"Generated {datetime.now(timezone.utc).isoformat()} (UTC). Research mode: drawdown kill disabled. "
             "1% risk of current equity (compounding), single-symbol accounts, costs + assumed swaps from "
             "`configs/zoora.yaml`. All numbers below are engine outputs.", ""]
    hdr = ("| src | sym | tf | variant | EMA | trades | CAGR | Sharpe | MaxDD | PF | Exp R | "
           "IS trades | IS CAGR | IS ExpR | OOS trades | OOS CAGR | OOS Sharpe | OOS MaxDD | OOS PF | OOS ExpR | "
           "WF win | WF trades | WF CAGR | WF Sharpe | WF ExpR |")
    hdr = hdr[:-1] + "| in-mkt | swap $ | B&H full |"
    lines += [hdr, "|" + "---|" * (hdr.count("|") - 1)]
    for r in results:
        if "skipped" in r:
            lines.append(f"| {r['source']} | {r['symbol']} | {r['tf']} | {r['variant']} | {r['ema']} | skipped: {r['skipped']} |")
            continue
        F, I, O, W = r["full"], r["is"], r["oos"], r["wf"]
        lines.append("| " + " | ".join([
            r["source"], r["symbol"], r["tf"], r["variant"].replace("zoora_", ""), r["ema"],
            str(F["trade_count"]), _f(F["cagr_pct"], 2, True), _f(F["sharpe"]), _f(F["max_drawdown_pct"], 1, True),
            _f(F["profit_factor"]), _f(F["expectancy_r"], 3),
            str(I["trade_count"]), _f(I["cagr_pct"], 2, True), _f(I["expectancy_r"], 3),
            str(O["trade_count"]), _f(O["cagr_pct"], 2, True), _f(O["sharpe"]), _f(O["max_drawdown_pct"], 1, True),
            _f(O["profit_factor"]), _f(O["expectancy_r"], 3),
            str(W.get("windows", 0)), str(W.get("trade_count", "-")), _f(W.get("cagr_pct"), 2, True),
            _f(W.get("sharpe")), _f(W.get("expectancy_r"), 3),
            _f(F.get("time_in_market_pct"), 0, True), _f(F.get("total_swap"), 0),
            _f(r.get("buy_hold", {}).get("full_pct"), 0, True)]) + " |")
    return "\n".join(lines) + "\n"


def render_h2h(results: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    by = {(r["source"], r["symbol"], r["tf"], r["variant"], r["ema"]): r for r in results if "skipped" not in r}
    rows = []
    lines = ["| src | sym | tf | variant | trades 200/800 | trades 198/792 | entries matched (+-3 bars) | "
             "daily-ret corr | dCAGR full | dExpR full | dCAGR OOS | dExpR OOS | dCAGR WF |",
             "|" + "---|" * 13]
    for (src, sym, tf, v, e), a in sorted(by.items()):
        if e != "200/800" or (src, sym, tf, v, "198/792") not in by:
            continue
        b = by[(src, sym, tf, v, "198/792")]
        h = head_to_head(a, b, 3, tf)
        rows.append({"source": src, "symbol": sym, "tf": tf, "variant": v, **h})
        lines.append("| " + " | ".join([src, sym, tf, v.replace("zoora_", ""), str(h["entries_a"]), str(h["entries_b"]),
                                        _f(h["matched_entries_pct"], 0, True), _f(h["daily_return_corr"], 3),
                                        _f(h["d_cagr_full"], 2), _f(h["d_exp_r_full"], 3), _f(h["d_cagr_oos"], 2),
                                        _f(h["d_exp_r_oos"], 3), _f(h["d_cagr_wf"], 2)]) + " |")
    return "\n".join(lines) + "\n", rows


def main_research(cfg_path: str, root: Path, prepare: bool = True, workers: int = 7,
                  sources: dict[str, list[str]] | None = None) -> Path:
    cfg = load_config(cfg_path)
    syms = list(cfg.pairs)
    data_summary: dict[str, Any] = {}
    if prepare:
        data_summary["dukascopy"] = prepare_dukascopy(cfg, root, syms, datetime(2008, 1, 1, tzinfo=timezone.utc))
        data_summary["yfinance_long"] = prepare_yfinance_d1(cfg, root, syms)
    sources = sources or {"dukascopy": ["D1", "H4", "H1"], "yfinance_long": ["D1"]}
    results = run_all(cfg_path, root, sources, syms, workers)
    out_dir = root / "research" / "zoora"
    out_dir.mkdir(parents=True, exist_ok=True)
    h2h_md, h2h = render_h2h(results)
    slim = [{k: v for k, v in r.items() if k not in ("daily_equity",)} for r in results]
    (out_dir / "results.json").write_text(json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(),
                                                      "config": cfg_path, "config_fingerprint": cfg.fingerprint(),
                                                      "data": data_summary, "results": slim, "head_to_head": h2h},
                                                     indent=1, default=str))
    md = render(results, data_summary) + "\n## 200/800 vs 198/792 head-to-head (delta = 198/792 minus 200/800)\n\n" + h2h_md
    (out_dir / "results.md").write_text(md)
    return out_dir
