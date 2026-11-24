"""Threshold fitting (TRAIN split only) and held-out evaluation.

Split: time-ordered by launch time; first `train_frac` = train, rest = test (no shuffling -> no leakage from
the future into fitted thresholds). Only two parameters are fitted (skip_score, reduced_score) to limit
overfitting on a small sample. Rule weights: a small fixed set of variants (WEIGHT_VARIANTS, e.g. turning off
rules with lift < 1) is compared by TRAIN AUC; the pick is applied before threshold fitting. Rule thresholds stay at defaults.
Objectives on train (both are balanced accuracy, so a low base rate cannot be "won" by skipping everything):
  skip_score    : score >= skip_score (or a hard flag) as a detector of bad_24h
  reduced_score : score >= reduced_score as a detector of adverse_24h = bad_24h OR return_24h <= -10%
Ties go to the value closest to the documented default. With < MIN_POS positives in train the defaults are kept.
Tier-sized 24h return (NORMAL 3%, REDUCED 1%, SKIP 0%; returns clipped to [-100%, +300%]) is reported, not fitted:
it is dominated by a handful of outliers at this sample size."""
from __future__ import annotations
import datetime as dt, hashlib, json, math, os
from .. import config as C
from .. import rug_detection_rules as R

SIZE = {"SKIP": 0.0, "REDUCED": 1.0, "NORMAL": 3.0}


def load(path):
    rows = [json.loads(l) for l in open(path)]
    rows = [r for r in rows if (r.get("label") or {}).get("usable") and r["label"].get("bad_24h") is not None]
    rows.sort(key=lambda r: r.get("create_time") or r["as_of"])
    return rows


def tier(r, skip, reduced):
    if r["hard_flags"] or r["score"] >= skip:
        return "SKIP"
    if r["score"] >= reduced:
        return "REDUCED"
    if r["confidence"] == "low":
        return "REDUCED"
    return "NORMAL"


def clip(x):
    return max(-1.0, min(3.0, x))


def evaluate(rows, skip, reduced, label="bad_24h"):
    cm = {t: {"bad": 0, "ok": 0} for t in SIZE}
    pnl = []
    for r in rows:
        t = tier(r, skip, reduced)
        y = r["label"][label]
        cm[t]["bad" if y else "ok"] += 1
        pnl.append(SIZE[t] / 100 * clip(r["label"].get("return_24h") or 0))
    n = len(rows); nbad = sum(cm[t]["bad"] for t in cm)
    def rate(a, b):
        return round(a / b, 4) if b else None
    out = {"n": n, "bad": nbad, "base_rate_bad": rate(nbad, n), "confusion": cm, "tiers": {}}
    for t in SIZE:
        k = cm[t]["bad"] + cm[t]["ok"]
        out["tiers"][t] = {"n": k, "share": rate(k, n), "bad_rate": rate(cm[t]["bad"], k)}
    # SKIP as the positive prediction for "bad"
    tp, fp = cm["SKIP"]["bad"], cm["SKIP"]["ok"]
    out["skip_precision_bad"] = rate(tp, tp + fp)
    out["skip_recall_bad"] = rate(tp, nbad)
    tp2 = tp + cm["REDUCED"]["bad"]; fp2 = fp + cm["REDUCED"]["ok"]
    out["skip_or_reduced_precision_bad"] = rate(tp2, tp2 + fp2)
    out["skip_or_reduced_recall_bad"] = rate(tp2, nbad)
    nok = n - nbad
    out["normal_precision_ok"] = rate(cm["NORMAL"]["ok"], cm["NORMAL"]["ok"] + cm["NORMAL"]["bad"])
    out["normal_recall_ok"] = rate(cm["NORMAL"]["ok"], nok)
    out["mean_sized_return_pct_of_bankroll"] = round(100 * sum(pnl) / n, 4) if n else None
    return out


def auc(rows, key="raw_points", label="bad_24h"):
    v = lambda r: r["score"] if r.get(key) is None else r[key]   # 0 is a real value; only fall back when missing
    pos = [v(r) for r in rows if r["label"][label]]
    neg = [v(r) for r in rows if not r["label"][label]]
    if not pos or not neg:
        return None
    s = sum((p > q) + 0.5 * (p == q) for p in pos for q in neg)
    return round(s / (len(pos) * len(neg)), 4)


def rescore(r, scale):
    """Raw points of a dataset row with some rules' points scaled (0 = rule made informational). Offline, no RPC."""
    return sum(v["points"] * scale.get(n, 1.0) for n, v in r["rules"].items())


WEIGHT_VARIANTS = {"live": {}, "creator_sold_off": {"creator_sold": 0.0}, "serial_off": {"serial_deployer": 0.0},
                   "both_off": {"creator_sold": 0.0, "serial_deployer": 0.0},
                   "both_half": {"creator_sold": 0.5, "serial_deployer": 0.5}}


# Report-only variants: negative scales model "the rule NOT firing is the risk" (e.g. creator still holding).
# AUC is rank-based, so subtracting a rule's points equals adding them to the rows where it didn't fire.
# They are measured for the log but never picked or deployed: the live scorer has no negative weights.
REPORT_ONLY_VARIANTS = {"creator_sold_inverted": {"creator_sold": -1.0, "serial_deployer": 0.0},
                        "both_inverted": {"creator_sold": -1.0, "serial_deployer": -1.0}}


def weight_experiment(train, test):
    """AUC per weight variant; the pick is made on TRAIN AUC only, test is reported for the deploy gate."""
    out, ro = {}, {}
    for dst, variants in ((out, WEIGHT_VARIANTS), (ro, REPORT_ONLY_VARIANTS)):
        for name, sc in variants.items():
            f = lambda rs: auc([dict(r, raw_points=rescore(r, sc)) for r in rs])
            dst[name] = {"scale": sc, "train_auc": f(train), "test_auc": f(test)}
    pick = max(out, key=lambda k: out[k]["train_auc"] or 0)
    return {"variants": out, "picked_on_train": pick, "report_only": ro}


def rule_stats(rows, label="bad_24h"):
    names = sorted({k for r in rows for k in r["rules"]})
    out = {}
    for nme in names:
        f = [r for r in rows if r["rules"].get(nme, {}).get("triggered")]
        nf = [r for r in rows if not r["rules"].get(nme, {}).get("triggered")]
        nodata = sum(1 for r in rows if not r["rules"].get(nme, {}).get("data", True))
        br = lambda xs: round(sum(r["label"][label] for r in xs) / len(xs), 4) if xs else None
        bf, bn = br(f), br(nf)
        out[nme] = {"fired": len(f), "hit_rate": round(len(f) / len(rows), 4) if rows else None, "bad_rate_when_fired": bf,
                    "bad_rate_when_not_fired": bn, "lift": round(bf / bn, 3) if bf is not None and bn else None, "no_data": nodata}
    return out


MIN_POS = 10
DEPLOY_MIN_TEST_AUC = 0.60
# Overfitting guard: the time-ordered test split has been inspected across sessions, so a new version must ALSO
# pass on a fresh holdout of launches created strictly after `fresh_after` (unix s; newer than every launch used
# so far). Fresh rows are excluded from train/test, never used for picking, and a fit with no / too small a fresh
# holdout is never deployed. Source: arg, else env SMR_FRESH_HOLDOUT_AFTER.
FRESH_MIN_N = 30
FRESH_MIN_POS = 5


def adverse(r):
    lb = r["label"]
    return int(bool(lb.get("bad_24h")) or (lb.get("return_24h") is not None and lb["return_24h"] <= -0.10))


def balanced_acc(rows, thr, y):
    tp = fn = tn = fp = 0
    for r in rows:
        pred = bool(r["hard_flags"]) or r["score"] >= thr
        if y(r):
            tp += pred; fn += not pred
        else:
            fp += pred; tn += not pred
    if not (tp + fn) or not (tn + fp):
        return None
    return 0.5 * (tp / (tp + fn) + tn / (tn + fp))


def fit(train):
    T0 = C.Thresholds()
    bad = lambda r: r["label"]["bad_24h"]
    note = []
    if sum(bad(r) for r in train) < MIN_POS:
        skip = T0.skip_score; note.append(f"skip_score kept at default: < {MIN_POS} bad launches in train")
    else:
        skip = max(range(20, 101, 5), key=lambda t: ((balanced_acc(train, t, bad) or 0), -abs(t - T0.skip_score)))
    if sum(adverse(r) for r in train) < MIN_POS:
        red = min(T0.reduced_score, skip - 5); note.append(f"reduced_score kept at default: < {MIN_POS} adverse launches in train")
    else:
        red = max(range(0, skip, 5), key=lambda t: ((balanced_acc(train, t, adverse) or 0), -abs(t - T0.reduced_score)))
    e = evaluate(train, skip, red)
    e["fit_notes"] = note
    e["balanced_acc_skip_vs_bad"] = balanced_acc(train, skip, bad)
    e["balanced_acc_reduced_vs_adverse"] = balanced_acc(train, red, adverse)
    return skip, red, e


def auc_ci(rows, B=500, seed=1, **kw):
    """Bootstrap 95% range for AUC (resampling launches). None when too few rows of either class."""
    import random
    if auc(rows, **kw) is None:
        return None
    rng = random.Random(seed); vals = []
    for _ in range(B):
        v = auc([rows[rng.randrange(len(rows))] for _ in rows], **kw)
        if v is not None:
            vals.append(v)
    vals.sort()
    return [vals[int(0.025 * len(vals))], vals[int(0.975 * len(vals)) - 1]] if vals else None


MOVED_MIN_X = 1.1


def moved_subset_auc(rows, min_x=MOVED_MIN_X):
    """AUC (+95% range) on launches that had already moved >= min_x launch price at as_of.
    Launches still at launch price are almost never bad (the label nearly rules it out), so the
    headline AUC is dominated by "did anything happen"; this view measures risk ranking where it matters."""
    sub = [r for r in rows if (r.get("entry_x_launch") or 0) >= min_x]
    return {"min_entry_x_launch": min_x, "n": len(sub), "n_bad": sum(bool(r["label"]["bad_24h"]) for r in sub),
            "auc": auc(sub) if sub else None, "auc_ci95": auc_ci(sub) if sub else None}


def split_fresh(rows, fresh_after):
    """-> (rows used for train/test, fresh holdout rows created strictly after `fresh_after`)."""
    if fresh_after is None:
        return rows, []
    t = lambda r: r.get("create_time") or r["as_of"]
    return [r for r in rows if t(r) <= fresh_after], [r for r in rows if t(r) > fresh_after]


def bootstrap_ci(rows, skip, red, metric, B=500, seed=1):
    import random
    rng = random.Random(seed); vals = []
    for _ in range(B):
        s = [rows[rng.randrange(len(rows))] for _ in rows]
        v = evaluate(s, skip, red)[metric]
        if v is not None:
            vals.append(v)
    vals.sort()
    return [vals[int(0.025 * len(vals))], vals[int(0.975 * len(vals)) - 1]] if vals else None


def main(dataset, outdir, settings, fit_thresholds=True, train_frac=0.6, progress=print, fit=True, fresh_after=None):
    rows = load(dataset)
    if fresh_after is None and os.environ.get("SMR_FRESH_HOLDOUT_AFTER"):
        fresh_after = int(os.environ["SMR_FRESH_HOLDOUT_AFTER"])
    rows, fresh = split_fresh(rows, fresh_after)
    if len(rows) < 20:
        progress(f"only {len(rows)} usable rows; need >= 20"); return None
    k = int(len(rows) * train_frac)
    train, test = rows[:k], rows[k:]
    T0 = C.Thresholds()
    live_test_auc = auc(test)          # rows were scored with the live weights
    wexp = weight_experiment(train, test)
    if fit:
        scale = wexp["variants"][wexp["picked_on_train"]]["scale"]
    else:
        tf0 = os.path.join(outdir, "thresholds.fitted.json")
        w0 = (json.load(open(tf0)).get("weights") or {}) if os.path.exists(tf0) else {}
        scale = {r: v / R.WEIGHTS[r] for r, v in w0.items() if R.WEIGHTS.get(r)}
    if scale:   # re-derive score/raw_points under the candidate weights (exact for 0-weights; offline)
        rs = lambda r: dict(r, raw_points=rescore(r, scale), score=min(100, int(round(rescore(r, scale)))))
        rows, train, test, fresh = [rs(r) for r in rows], [rs(r) for r in train], [rs(r) for r in test], [rs(r) for r in fresh]
    weights = {r: int(round(R.WEIGHTS[r] * v)) for r, v in scale.items()}
    if fit:
        skip, red, tr_eval = fit_fn(train)
    else:
        tf = os.path.join(outdir, "thresholds.fitted.json")
        tf = tf if os.path.exists(tf) else settings.thresholds_file
        j = json.load(open(tf)) if os.path.exists(tf) else {"thresholds": {}}
        skip = j["thresholds"].get("skip_score", T0.skip_score); red = j["thresholds"].get("reduced_score", T0.reduced_score)
    ts = lambda r: dt.datetime.utcfromtimestamp(r.get("create_time") or r["as_of"]).strftime("%Y-%m-%dT%H:%MZ")
    rep = {
        "generated_at": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dataset": os.path.relpath(dataset, os.path.dirname(outdir)), "n_usable": len(rows),
        "label_definition": "bad_24h = (price(as_of+24h) <= 0.5 x price(as_of)) OR (not graduated AND price(as_of+24h) <= 1.10 x launch price AND <= 0.8 x entry); as_of = launch + 300 s; prices from on-chain bonding-curve / PumpSwap pool balances",
        "split": {"method": "time-ordered", "train_frac": train_frac, "train": {"n": len(train), "from": ts(train[0]), "to": ts(train[-1])},
                  "test": {"n": len(test), "from": ts(test[0]), "to": ts(test[-1])}},
        "fitted": {"skip_score": skip, "reduced_score": red, "objective": "balanced accuracy on TRAIN: skip_score vs bad_24h; reduced_score vs adverse_24h (bad_24h OR return_24h <= -10%)",
                   "train_fit": tr_eval if fit else None},
        "defaults": {"skip_score": T0.skip_score, "reduced_score": T0.reduced_score},
        "train": evaluate(train, skip, red), "test": evaluate(test, skip, red),
        "test_with_default_thresholds": evaluate(test, T0.skip_score, T0.reduced_score),
        "test_baselines": {"all_NORMAL": _all(test, "NORMAL"), "all_REDUCED": _all(test, "REDUCED")},
        "auc_raw_points": {"train": auc(train), "test": auc(test)},
        "auc_ci95": {"train": auc_ci(train), "test": auc_ci(test)},
        "fresh_holdout": {"after": fresh_after, "n": len(fresh), "n_bad": sum(r["label"]["bad_24h"] for r in fresh),
                          "from": ts(fresh[0]) if fresh else None, "to": ts(fresh[-1]) if fresh else None,
                          "auc": auc(fresh) if fresh else None, "auc_ci95": auc_ci(fresh) if fresh else None},
        "auc_moved_subset": {"train": moved_subset_auc(train), "test": moved_subset_auc(test), "fresh": moved_subset_auc(fresh)},
        "test_balanced_accuracy": {"skip_vs_bad": balanced_acc(test, skip, lambda r: r["label"]["bad_24h"]),
                                   "reduced_vs_adverse": balanced_acc(test, red, adverse),
                                   "adverse_base_rate": round(sum(adverse(r) for r in test) / len(test), 4)},
        "auc_raw_points_vs_adverse": {"train": auc([dict(r, label={**r["label"], "adverse": adverse(r)}) for r in train], label="adverse"),
                                      "test": auc([dict(r, label={**r["label"], "adverse": adverse(r)}) for r in test], label="adverse")},
        "test_ci95": {m: bootstrap_ci(test, skip, red, m) for m in ("skip_precision_bad", "skip_recall_bad", "mean_sized_return_pct_of_bankroll")},
        "weight_experiment": wexp, "weights": weights, "live_test_auc": live_test_auc,
        "rule_stats": {"all": rule_stats(rows), "train": rule_stats(train), "test": rule_stats(test)},
        "secondary_labels_test": {lab: {"base_rate": round(sum(r["label"].get(lab) or 0 for r in test) / len(test), 4),
                                        "auc": auc([r for r in test if r["label"].get(lab) is not None], label=lab)}
                                  for lab in ("loss50_24h", "dead_24h", "crash_24h", "bad_1h", "bad_6h")},
        "outcome_mix": {"graduated_24h": sum(r["label"].get("graduated_24h") or 0 for r in rows),
                        "median_return_24h": sorted(r["label"].get("return_24h") or 0 for r in rows)[len(rows) // 2]},
    }
    json.dump(rep, open(os.path.join(outdir, "report.json"), "w"), indent=2)
    if fit:
        h = hashlib.sha256(json.dumps([skip, red, len(train), weights]).encode()).hexdigest()[:8]
        ver = f"bt{dt.datetime.utcnow():%Y%m%d}-{h}"
        tj = {"version": ver, "fitted_on": rep["split"]["train"], "objective": rep["fitted"]["objective"],
              "thresholds": {"skip_score": skip, "reduced_score": red}, "weights": weights, "weight_variant": wexp["picked_on_train"],
              "test_auc": rep["auc_raw_points"]["test"], "live_test_auc": live_test_auc}
        json.dump(tj, open(os.path.join(outdir, "thresholds.fitted.json"), "w"), indent=2)
        # Deployment gate: fitted thresholds only go live if the score separates outcomes on held-out data.
        # Otherwise the conservative defaults stay (they route almost everything to SKIP/REDUCED).
        ta = rep["auc_raw_points"]["test"]
        fh = rep["fresh_holdout"]
        fresh_ok = bool(fh["n"] >= FRESH_MIN_N and fh["n_bad"] >= FRESH_MIN_POS and fh["auc"] is not None and fh["auc"] >= DEPLOY_MIN_TEST_AUC)
        rep["fresh_holdout"]["passed"] = fresh_ok
        rep["deployed"] = bool(ta is not None and ta >= DEPLOY_MIN_TEST_AUC and (live_test_auc is None or ta > live_test_auc) and fresh_ok)
        rep["deploy_rule"] = (f"deploy fitted thresholds/weights only if held-out AUC >= {DEPLOY_MIN_TEST_AUC}, it beats the live version, "
                              f"and a fresh holdout (>= {FRESH_MIN_N} launches, >= {FRESH_MIN_POS} bad, created after every launch used so far) also has AUC >= {DEPLOY_MIN_TEST_AUC}")
        if rep["deployed"]:
            json.dump(tj, open(settings.thresholds_file, "w"), indent=2)
            progress(f"deployed {settings.thresholds_file} ({ver}): skip>={skip} reduced>={red}")
        else:
            progress(f"NOT deployed (held-out AUC {ta}, fresh holdout n={fh['n']} auc={fh['auc']} passed={fresh_ok}; gate {DEPLOY_MIN_TEST_AUC}); fitted values in backtest/thresholds.fitted.json; defaults stay live")
        json.dump(rep, open(os.path.join(outdir, "report.json"), "w"), indent=2)
    if not fit:   # report-only: say what is actually live
        tf = os.path.join(outdir, "thresholds.fitted.json")
        fv = json.load(open(tf)).get("version") if os.path.exists(tf) else None
        rep["deployed"] = bool(fv) and fv == settings.thresholds_version
        rep["deploy_rule"] = f"live version: {settings.thresholds_version}"
    from .report_md import write
    write(rep, os.path.join(outdir, "REPORT.md"))
    progress(f"test: {json.dumps({k: rep['test'][k] for k in ('n', 'base_rate_bad', 'skip_precision_bad', 'skip_recall_bad', 'mean_sized_return_pct_of_bankroll')})}")
    return rep


def _all(rows, t):
    n = len(rows)
    return {"n": n, "tier": t, "base_rate_bad": round(sum(r["label"]["bad_24h"] for r in rows) / n, 4),
            "mean_sized_return_pct_of_bankroll": round(100 * sum(SIZE[t] / 100 * clip(r["label"].get("return_24h") or 0) for r in rows) / n, 4)}


fit_fn = fit
