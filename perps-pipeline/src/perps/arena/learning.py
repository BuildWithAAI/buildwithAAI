"""Learning layer: per-arm statistics, auto-written lessons, and versioned, reasoned parameter changes.

Rules are deliberately conservative and sample-size gated (no change before `min_trades` closed trades
and `min_trades_between_changes` trades on the current version) so the arms cannot curve-fit noise.
Every change bumps the arm's params version, is logged with its reason and the evidence, and every
trade records the params version it was taken under.
"""

from __future__ import annotations

import hashlib
import json
import statistics
from collections import Counter
from pathlib import Path
from typing import Any

from .config import ArenaCfg
from .ledger import utcnow

TAG_LESSONS = {
    "tp_hit": "targets are reachable - keep the setup",
    "gave_back_profit": "winners turn into losers - target may be too far / consider trailing",
    "immediate_adverse": "entries get hit straight away - stop too tight or signal is a false break",
    "thesis_failed": "setup did not follow through",
    "time_exit": "no follow-through within the hold window",
    "signal_exit": "invalidation rule cut the trade",
    "fees_ate_edge": "fees exceed the gross edge - needs bigger moves per trade or maker fills",
    "fee_heavy": "fees are a large share of each move",
    "funding_impact": "funding materially changed the result",
    "regime_change": "higher-timeframe regime flipped during trades",
    "liquidated": "a stop failed to protect the position",
    "trailed_out_in_profit": "trailing stop banked gains",
}


def _hash(d: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(d, sort_keys=True, default=str).encode()).hexdigest()[:12]


class ParamStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, arm: str) -> Path:
        return self.root / f"{arm}.json"

    def load(self, arm: str) -> dict[str, Any] | None:
        p = self.path(arm)
        return json.loads(p.read_text()) if p.exists() else None

    def save(self, arm: str, doc: dict[str, Any]) -> None:
        tmp = self.path(arm).with_suffix(".tmp")
        tmp.write_text(json.dumps(doc, indent=2, default=str))
        tmp.replace(self.path(arm))

    def ensure(self, arm: str, seed_params: dict[str, Any], seed_risk: float) -> dict[str, Any]:
        doc = self.load(arm)
        seed_hash = _hash({"params": seed_params, "risk": seed_risk})
        if doc is None:
            doc = {"arm": arm, "seed_hash": seed_hash,
                   "current": {"version": 1, "params": seed_params, "risk_per_trade": seed_risk, "benched": False},
                   "history": [{"version": 1, "ts": utcnow(), "params": seed_params, "risk_per_trade": seed_risk,
                                "reason": "initial seed from config/arena.yaml", "changes": {}}]}
            self.save(arm, doc)
        elif doc.get("seed_hash") != seed_hash:
            # operator edited config/arena.yaml -> new version, recorded as such
            self.bump(arm, doc, seed_params, seed_risk, doc["current"].get("benched", False),
                      "config/arena.yaml seed changed by operator", {"seed": "changed"})
            doc["seed_hash"] = seed_hash
            self.save(arm, doc)
        return doc

    def bump(self, arm: str, doc: dict[str, Any], params: dict[str, Any], risk: float, benched: bool, reason: str,
             changes: dict[str, Any], evidence: dict[str, Any] | None = None) -> int:
        v = int(doc["current"]["version"]) + 1
        doc["current"] = {"version": v, "params": params, "risk_per_trade": risk, "benched": benched}
        doc["history"].append({"version": v, "ts": utcnow(), "params": params, "risk_per_trade": risk,
                               "benched": benched, "reason": reason, "changes": changes, "evidence": evidence or {}})
        self.save(arm, doc)
        return v


def arm_stats(trades: list[dict[str, Any]]) -> dict[str, Any]:
    closed = [t for t in trades if t["status"] == "closed" and t.get("exit_reason") != "archived"]
    rs = [float(t["r_multiple"]) for t in closed]
    pnl = [float(t["net_pnl"]) for t in closed]
    wins = [t for t in closed if t["net_pnl"] > 0]
    out: dict[str, Any] = {
        "closed_trades": len(closed), "open_trades": sum(1 for t in trades if t["status"] == "open"),
        "wins": len(wins), "losses": len(closed) - len(wins),
        "win_rate": len(wins) / len(closed) if closed else None,
        "expectancy_r": statistics.fmean(rs) if rs else None,
        "median_r": statistics.median(rs) if rs else None,
        "net_pnl": sum(pnl), "gross_pnl": sum(float(t["gross_pnl"]) for t in closed),
        "fees": sum(float(t["entry_fee"]) + float(t["exit_fee"]) for t in closed),
        "funding": sum(float(t.get("funding", 0)) for t in closed),
        "avg_duration_min": statistics.fmean([float(t["duration_min"]) for t in closed]) if closed else None,
        "avg_mae_r": statistics.fmean([float(t["mae_r"]) for t in closed]) if closed else None,
        "avg_mfe_r": statistics.fmean([float(t["mfe_r"]) for t in closed]) if closed else None,
        "median_mfe_r": statistics.median([float(t["mfe_r"]) for t in closed]) if closed else None,
        "tp_hit_rate": sum(1 for t in closed if t["exit_reason"] == "take_profit") / len(closed) if closed else None,
        "exit_reasons": dict(Counter(t["exit_reason"] for t in closed)),
        "tags": dict(Counter(tag for t in closed for tag in t.get("tags", []))),
        "best_r": max(rs) if rs else None, "worst_r": min(rs) if rs else None,
    }
    return out


def learn(arm: str, cfg: ArenaCfg, store: ParamStore, trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Apply the sample-gated adjustment rules. Returns the list of changes made (possibly empty)."""
    doc = store.load(arm)
    if doc is None:
        return []
    lc = cfg.learning
    lim = cfg.arm_limits(arm)
    cur = doc["current"]
    closed = [t for t in trades if t["status"] == "closed" and t.get("exit_reason") != "archived"]
    on_ver = [t for t in closed if int(t.get("params_version", 0)) == int(cur["version"])]
    made: list[dict[str, Any]] = []
    if len(closed) < lc.min_trades:
        return made
    params, risk, benched = dict(cur["params"]), float(cur["risk_per_trade"]), bool(cur.get("benched", False))
    changes: dict[str, Any] = {}
    reasons: list[str] = []
    evidence: dict[str, Any] = {"closed_total": len(closed), "closed_on_version": len(on_ver)}
    if len(on_ver) >= lc.min_trades_between_changes:
        st = arm_stats(on_ver)
        evidence.update({k: st[k] for k in ("expectancy_r", "median_mfe_r", "tp_hit_rate", "tags")})
        tp = float(params.get("take_profit_r", 0) or 0)
        if tp and st["median_mfe_r"] is not None and st["median_mfe_r"] >= 1.0 and (st["tp_hit_rate"] or 0) < 0.2:
            new_tp = max(1.0, round(0.9 * float(st["median_mfe_r"]), 2))
            if new_tp < tp:
                changes["take_profit_r"] = [tp, new_tp]
                params["take_profit_r"] = new_tp
                reasons.append(f"median MFE {st['median_mfe_r']:.2f}R but only {st['tp_hit_rate']:.0%} of trades reached "
                               f"the {tp}R target -> lower target to {new_tp}R")
        losers = [t for t in on_ver if t["net_pnl"] <= 0]
        quick = sum(1 for t in losers if "immediate_adverse" in t.get("tags", []))
        if losers and quick / len(losers) >= 0.5 and "atr_stop_mult" in params:
            old = float(params["atr_stop_mult"])
            new = round(min(3.0, old * 1.25), 3)
            if new > old:
                changes["atr_stop_mult"] = [old, new]
                params["atr_stop_mult"] = new
                reasons.append(f"{quick}/{len(losers)} losers were stopped immediately with no favourable move -> "
                               f"widen stop {old} -> {new} ATR (risk $ unchanged; size shrinks)")
    st_all = arm_stats(closed)
    er = st_all["expectancy_r"] or 0.0
    if len(closed) >= lc.cut_risk_after and er < lc.cut_risk_er and risk > lim.min_risk:
        changes["risk_per_trade"] = [risk, lim.min_risk]
        risk = lim.min_risk
        reasons.append(f"E[R] {er:+.2f} over {len(closed)} trades < {lc.cut_risk_er} -> cut risk to {lim.min_risk:.0%}")
    if len(closed) >= lc.bench_after and er < lc.bench_er and not benched:
        changes["benched"] = [False, True]
        benched = True
        reasons.append(f"E[R] {er:+.2f} over {len(closed)} trades < {lc.bench_er} -> arm benched (no new entries)")
    if changes:
        risk = min(max(risk, lim.min_risk), lim.max_risk)       # the 1-3% band can never be left
        v = store.bump(arm, doc, params, risk, benched, "; ".join(reasons), changes, evidence)
        made.append({"arm": arm, "version": v, "changes": changes, "reason": "; ".join(reasons)})
    return made


def write_outputs(out_dir: Path, cfg: ArenaCfg, arms: list[dict[str, Any]], trades: list[dict[str, Any]],
                  store: ParamStore, equity: dict[str, float]) -> dict[str, Any]:
    stats: dict[str, Any] = {"generated": utcnow(), "arms": {}}
    lines = ["# Arena lessons (auto-generated every tick)", "",
             "Simulated paper trading on live public market data. Lessons are drawn from each arm's closed-trade "
             "post-mortems; parameter changes are sample-gated (see config/arena.yaml `learning`).", ""]
    for a in arms:
        name = a["name"]
        tr = [t for t in trades if t["arm"] == name]
        st = arm_stats(tr)
        doc = store.load(name) or {"current": {}, "history": []}
        eq = equity.get(name, a["cash"])
        st.update({"equity": eq, "cash": a["cash"], "initial": a["initial"], "return_pct": eq / a["initial"] - 1,
                   "peak": a["peak"], "drawdown_pct": 1 - eq / a["peak"] if a["peak"] else None,
                   "killed": bool(a["killed"]), "kill_reason": a["kill_reason"],
                   "benched": bool(doc["current"].get("benched", False)),
                   "params_version": doc["current"].get("version"),
                   "risk_per_trade": doc["current"].get("risk_per_trade")})
        stats["arms"][name] = st
        lines += [f"## {name} (params v{st['params_version']}, risk {st['risk_per_trade']:.2%})", ""]
        if not st["closed_trades"]:
            lines += [f"- No closed trades yet ({st['open_trades']} open). Equity ${eq:.2f}.", ""]
        else:
            lines += [f"- {st['closed_trades']} closed, win rate {st['win_rate']:.0%}, E[R] {st['expectancy_r']:+.2f}, "
                      f"net ${st['net_pnl']:+.2f} (gross ${st['gross_pnl']:+.2f}, fees ${st['fees']:.2f}, funding "
                      f"${st['funding']:+.2f}); equity ${eq:.2f}.",
                      f"- Avg MAE {st['avg_mae_r']:+.2f}R, avg MFE {st['avg_mfe_r']:+.2f}R, TP hit rate "
                      f"{st['tp_hit_rate']:.0%}, avg duration {st['avg_duration_min']:.0f} min."]
            for tag, n in sorted(st["tags"].items(), key=lambda kv: -kv[1]):
                lines.append(f"- {tag} x{n}: {TAG_LESSONS.get(tag, '')}")
            if st["closed_trades"] < cfg.learning.min_trades:
                lines.append(f"- Sample too small for parameter changes ({st['closed_trades']}/"
                             f"{cfg.learning.min_trades}); observations only.")
            lines.append("")
            for t in [t for t in tr if t["status"] == "closed"][-5:]:
                lines.append(f"  - #{t['id']} {t['symbol']} {'L' if t['side'] > 0 else 'S'} {t['r_multiple']:+.2f}R "
                             f"({t['exit_reason']}): {t.get('postmortem', '')}")
            lines.append("")
        hist = doc.get("history", [])[1:]
        if hist:
            lines.append("Parameter changes:")
            lines += [f"- v{h['version']} {h['ts']}: {h['reason']}" for h in hist]
            lines.append("")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "stats.json").write_text(json.dumps(stats, indent=2, default=str))
    review = out_dir / "review_lessons.md"  # curated daily-review findings, preserved across ticks
    if review.exists():
        lines += ["", "---", "", review.read_text()]
    (out_dir / "lessons.md").write_text("\n".join(lines))
    return stats
