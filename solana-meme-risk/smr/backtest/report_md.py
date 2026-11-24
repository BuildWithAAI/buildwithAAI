"""Render backtest/report.json as Markdown."""
from __future__ import annotations


def _cm(e):
    L = ["| tier | n | bad | ok | bad rate |", "|---|---:|---:|---:|---:|"]
    for t in ("SKIP", "REDUCED", "NORMAL"):
        c = e["confusion"][t]; ti = e["tiers"][t]
        L.append(f"| {t} | {ti['n']} | {c['bad']} | {c['ok']} | {ti['bad_rate'] if ti['bad_rate'] is not None else '-'} |")
    return "\n".join(L)


def _metrics(e):
    keys = ["n", "base_rate_bad", "skip_precision_bad", "skip_recall_bad", "skip_or_reduced_precision_bad", "skip_or_reduced_recall_bad",
            "normal_precision_ok", "normal_recall_ok", "mean_sized_return_pct_of_bankroll"]
    return "\n".join(f"- {k}: {e.get(k)}" for k in keys)


def write(rep, path):
    L = [f"# Backtest report - pump.fun launch risk (generated {rep['generated_at']})", "",
         "**Read this first:** small sample, one ~2-day period, free public data. Treat as a sanity check of the rules, not a proof of edge.", "",
         "## Setup", f"- Dataset: `{rep['dataset']}` - {rep['n_usable']} usable launches (random sample of pump.fun creates with >=15 successful txs in the first 5 min)",
         f"- Scoring time: launch + 300 s, point-in-time (as-of anchored RPC queries; no data after as_of is used for features)",
         f"- Label: {rep['label_definition']}",
         f"- Split: {rep['split']['method']}; train n={rep['split']['train']['n']} ({rep['split']['train']['from']} -> {rep['split']['train']['to']}), "
         f"test n={rep['split']['test']['n']} ({rep['split']['test']['from']} -> {rep['split']['test']['to']})",
         f"- Fitted on train only: skip_score >= {rep['fitted']['skip_score']}, reduced_score >= {rep['fitted']['reduced_score']} "
         f"(defaults {rep['defaults']['skip_score']}/{rep['defaults']['reduced_score']}); objective: {rep['fitted']['objective']}", "",
         f"- **Deployment:** {'fitted thresholds DEPLOYED' if rep.get('deployed') else 'fitted thresholds NOT deployed; documented defaults remain live'} ({rep.get('deploy_rule')})",
         f"- Weight variant picked on TRAIN AUC: {(rep.get('weight_experiment') or {}).get('picked_on_train')} -> weights {rep.get('weights')}; live version held-out AUC {rep.get('live_test_auc')}",
         "- Variants (train / test AUC): " + "; ".join(f"{k} {v['train_auc']} / {v['test_auc']}" for k, v in ((rep.get('weight_experiment') or {}).get('variants') or {}).items()), "",
         "## Held-out TEST results (fitted thresholds)", _cm(rep["test"]), "", _metrics(rep["test"]), "",
         f"- bootstrap 95% CI (test): {rep['test_ci95']}",
         f"- AUC of raw rule points vs bad_24h: train {rep['auc_raw_points']['train']}, test {rep['auc_raw_points']['test']}",
         f"- AUC of raw rule points vs adverse_24h (bad OR return <= -10%): {rep.get('auc_raw_points_vs_adverse')}",
         f"- TEST balanced accuracy: {rep.get('test_balanced_accuracy')}",
         f"- Fit notes: {(rep['fitted'].get('train_fit') or {}).get('fit_notes')}", "",
         "### Baselines on TEST", *(f"- {k}: {v}" for k, v in rep["test_baselines"].items()), "",
         "### TEST with default (unfitted) thresholds", _cm(rep["test_with_default_thresholds"]), "", _metrics(rep["test_with_default_thresholds"]), "",
         "## TRAIN results (in-sample, optimistic)", _cm(rep["train"]), "", _metrics(rep["train"]), "",
         "## Per-rule hit rates (all rows / test)", "| rule | fired (all) | hit rate | bad rate fired | bad rate not fired | lift | no data | test fired | test lift |",
         "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for r, a in rep["rule_stats"]["all"].items():
        t = rep["rule_stats"]["test"].get(r, {})
        L.append(f"| {r} | {a['fired']} | {a['hit_rate']} | {a['bad_rate_when_fired']} | {a['bad_rate_when_not_fired']} | {a['lift']} | {a['no_data']} | {t.get('fired')} | {t.get('lift')} |")
    L += ["", "## Secondary labels (TEST)", *(f"- {k}: {v}" for k, v in rep["secondary_labels_test"].items()), "",
          f"## Outcome mix (all)\n- {rep['outcome_mix']}", ""]
    L += ["## Interpretation (hand-written; re-check when the data changes)",
          "- Held-out AUC near 0.5 means the combined score did not separate bad from ok launches in this sample. Do not read the tier sizes as validated.",
          "- Most qualifying launches simply stop trading within minutes and sit near their 5-minute price. Under this label that is 'ok' (you can still sell back to the curve), so the bad class is rare (~9%) and the effective sample of bad launches is small (~28 overall, 11 in test).",
          "- creator_sold and serial_deployer show lift < 1: when the creator has already dumped (or is a serial launcher) by +5 min, the drop has usually happened before entry, so the coin flatlines afterwards instead of falling another 50%. These rules predict 'dead coin', not 'further loss', Since 2026-11-03 their weight is chosen by the train-AUC weight experiment (currently 0: kept as informational evidence, no points).",
          "- early_concentration and creator_holds have the most consistent lift (train and test), but they fire rarely.", ""]
    open(path, "w").write("\n".join(L))
