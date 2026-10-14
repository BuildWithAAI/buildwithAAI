"""Portable study reports, explicit research-only screens and local consistency checks."""

import hashlib
import html
from datetime import UTC, datetime
from pathlib import Path

from .data import D, ResearchError, canonical, decode, digest, precision, require
from .paper import VARIANTS
from .reports import OUTPUT_LIMIT, STUDY_FILES, _csv, _money
from .study import (
    CANDIDATES,
    SCENARIOS,
    STUDY_RULES,
    config_from_record,
    parse_plan,
    select_training,
    stress_configs,
    summarize,
)


def human(value, percent=False):
    if value is None:
        return "—"
    number = D(value) * (100 if percent else 1)
    return f"{number:.2f}%" if percent else f"{number:.4f}"


def time_text(milliseconds):
    return datetime.fromtimestamp(milliseconds // 1000, UTC).strftime("%Y-%m-%d %H:%M UTC")


def community(report):
    rows = ["# AAI chronological SFP testing update", "",
            "**OFFLINE RESEARCH. SYNTHETIC EXECUTION. NO VERIFIED TRADING EDGE OR EARNINGS.**", "",
            f"Input: {report['price_classification']}. Source verification: UNAVAILABLE.",
            f"Run: {report['run_id']}. Frozen plan: {report['plan_sha256']}.",
            f"Planned folds: {len(report['folds'])}; recorded trials: {len(report['trials'])}.", "",
            "A: reclaim. B: upward 4-hour context. C: later structure confirmation.", "",
            ("Training selects among A/B/C using only eligible positive closed results; otherwise it chooses cash. "
            "Test outcomes never select the variant for that same fold. The holding/decision embargo separates "
            "training and evaluation. Chronological windows are not independently attested as unseen."), "",
            "| Variant | Evaluated folds | Closed trades | Mean marked return | Max close-mark drawdown | Numeric screen |",
            "| --- | --- | --- | --- | --- | --- |"]
    for s in report["summary"]:
        rows.append(f"| {s['variant']} | {s['evaluated_folds']} | {s['closed_trades']} | "
                    f"{human(s['mean_marked_return'], True)} | {human(s['max_close_mark_drawdown'], True)} | "
                    f"{s['numeric_screen']} |")
    rows += ["", ("Marked returns include unrealized inventory; they are not realized profit or promised exit value. "
             "Costs are already included in net results. End-of-window inventory is not forced sold."), "",
             ("Cash, trend, full-affordable-capital buy-and-hold and fixed-seed time controls are recorded. "
             "Random entry density comes from training and is frozen before test prices; this is not exact exposure matching. "
             "Doubled-cost and one-hour-delay trials appear in study.json/trials.csv and the portable HTML report."), "",
             ("Folds are independent experiments with fresh simulated starting capital, not a compounded treasury. "
             "Summing fold profits does not create funds for a buy/burn program. "
             "Numeric gates are research proposals; a screen pass cannot authorize trading."), "",
             "**Readiness: BLOCKED. Funds moved: 0. Tokens bought: 0. Tokens burned: 0. No price floor established.**", "",
             ("Verified historical sources and executable quotes, genuinely untouched evaluation and statistical "
             "selection review remain required. The portable report makes no network request and sends no message."), ""]
    return "\n".join(rows).encode()


def dashboard(report):
    esc = html.escape
    body = []
    for row in report["summary"]:
        cells = [row["variant"], str(row["evaluated_folds"]), str(row["closed_trades"]),
                 human(row["mean_marked_return"], True), human(row["max_close_mark_drawdown"], True),
                 row["numeric_screen"], ", ".join(row["screen_reasons"]) or "Research screen only"]
        body.append("<tr>" + "".join("<td>" + esc(c) + "</td>" for c in cells) + "</tr>")
    details = []
    for f in report["folds"]:
        matched = [t for t in report["trials"] if t["fold"] == f["fold"]]
        lines = []
        for t in matched:
            m = t["metrics"]
            cells = [t["phase"], t["variant"], t["scenario"], str(t["seed"] if t["seed"] is not None else "—"),
                     str(m["completed_trades"]), human(m["realized_net_including_open_entry_costs"]),
                     human(m["unrealized_price_change"]), human(m["costs_including_slippage"]),
                     human(m["observed_exposure_fraction"], True), human(m["max_close_mark_drawdown"], True),
                     "Open" if m["open_position"] is not None else "Flat"]
            lines.append("<tr>" + "".join("<td>" + esc(c) + "</td>" for c in cells) + "</tr>")
        details.append(f"<details><summary>Fold {f['fold'] + 1} · selected {esc(f['selected_variant'])} · "
                       f"test {esc(f['test_coverage']['status'])}</summary><p>Training: {time_text(f['train_start_ms'])} to "
                       f"{time_text(f['train_end_ms'])}. Test: {time_text(f['test_start_ms'])} to {time_text(f['test_end_ms'])}. "
                       f"Random density: {f['random_rate_bps']} bps; fixed before test.</p>"
                       "<div class='scroll'><table><thead><tr>" +
                       "".join("<th>" + c + "</th>" for c in ["Phase", "Variant", "Scenario", "Seed", "Closed", "Net",
                                                                    "Open price change", "Costs", "Exposure", "DD", "End"]) +
                       "</tr></thead><tbody>" + "".join(lines) + "</tbody></table></div></details>")
    page = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'">
<title>AAI · SFP research report</title><style>
:root{color-scheme:dark;font:16px system-ui;background:#080d17;color:#e2e8f0}body{margin:0}main{max-width:1120px;margin:auto;padding:28px 18px}
h1{font-size:clamp(2rem,6vw,3.4rem);letter-spacing:-.04em;margin:12px 0}h2{font-size:1.25rem}p{line-height:1.6;max-width:85ch;color:#b5c3d9}
.tag{color:#67e8f9;font-weight:700;letter-spacing:.12em;font-size:.8rem}.notice{padding:18px;border:1px solid #854d0e;background:#251b0b;border-radius:12px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:24px 0}.card,details{background:#111a2b;border:1px solid #26344d;border-radius:12px;padding:18px}
.card strong{display:block;font-size:1.5rem;margin:8px 0}.scroll{overflow:auto}table{border-collapse:collapse;min-width:720px;width:100%;font-size:.85rem}th,td{text-align:left;padding:12px;border-bottom:1px solid #26344d;vertical-align:top}
th{color:#67e8f9}details{margin:14px 0}summary{cursor:pointer;font-weight:650}code{overflow-wrap:anywhere;color:#94a3b8;font-size:.75rem}a{color:#67e8f9}footer{margin-top:32px;border-top:1px solid #26344d;padding-top:18px}
</style></head><body><main><div class="tag">BUILD WITH AAI · BT-006</div><h1>SFP research, inspectable.</h1>
<div class="notice"><strong>Offline paper testing · funded strategy blocked</strong><p>INPUT_CLASSIFICATION prices. All fills, costs and performance screens are simulated. This report establishes no trading edge, earnings or price floor.</p></div>
<div class="cards"><div class="card">Planned folds<strong>FOLD_COUNT</strong>Chronological windows</div><div class="card">Recorded trials<strong>TRIAL_COUNT</strong>Failures retained</div><div class="card">Funds moved<strong>0</strong>Tokens bought/burned: 0</div></div>
<h2>Base scenarios</h2><p>Marked returns include open inventory. Numeric gates are research proposals. Buy-and-hold uses full affordable capital; the other strategies use bounded nominal risk. These exposures are different. Random seeds share the same price history and are not independent market samples.</p>
<div class="scroll"><table><thead><tr><th>Variant</th><th>Folds</th><th>Closed</th><th>Mean marked return</th><th>Max DD</th><th>Screen</th><th>Reasons</th></tr></thead><tbody>SUMMARY_ROWS</tbody></table></div>
<h2>Fold ledger · costs and delay</h2><p>Training scores select only that fold's candidate. Test outcomes do not change its choice. Failed coverage yields an incomplete fold, not a compressed period. End positions stay open. Costs are already deducted from net.</p>FOLD_DETAILS
<footer><p>Independent simulated accounts; no combined treasury or burn budget. Local plan hashes prove internal consistency, not external preregistration or untouched data. Historical sources, executable quotes and selection uncertainty remain unverified.</p><p><a href="study.json">Full study JSON</a> · <a href="trials.csv">Trial CSV</a> · <a href="plan.json">Frozen plan</a> · <a href="COMMUNITY_UPDATE.md">Community text</a></p><p>Run <code>RUN_ID</code><br>Plan <code>PLAN_ID</code></p></footer></main></body></html>"""
    for marker, value in {"INPUT_CLASSIFICATION": esc(report["price_classification"]),
                          "FOLD_COUNT": str(len(report["folds"])), "TRIAL_COUNT": str(len(report["trials"])),
                          "SUMMARY_ROWS": "".join(body), "FOLD_DETAILS": "".join(details),
                          "RUN_ID": esc(report["run_id"]), "PLAN_ID": esc(report["plan_sha256"])}.items():
        page = page.replace(marker, value)
    return page.encode()


def render_study(report, plan):
    folds = [{"fold": f["fold"], "train_start_ms": f["train_start_ms"], "train_end_ms": f["train_end_ms"],
              "test_start_ms": f["test_start_ms"], "test_end_ms": f["test_end_ms"],
              "selected_variant": f["selected_variant"], "train_coverage": f["train_coverage"]["status"],
              "test_coverage": f["test_coverage"]["status"], "random_rate_bps": f["random_rate_bps"]}
             for f in report["folds"]]
    trials = [dict({k: t[k] for k in ["trial_id", "fold", "phase", "variant", "scenario", "seed"]},
                   **{k: t["metrics"][k] for k in ["completed_trades", "realized_net_including_open_entry_costs",
                                                  "unrealized_price_change", "costs_including_slippage",
                                                  "ending_marked_nav", "max_close_mark_drawdown", "marked_return",
                                                  "profit_factor", "expectancy_net", "observed_exposure_fraction"]})
              for t in report["trials"]]
    payloads = {"study.json": canonical(report) + b"\n", "plan.json": canonical(plan) + b"\n",
                "folds.csv": _csv(folds, list(folds[0])),
                "trials.csv": _csv(trials, list(trials[0])) if trials else b"trial_id\n",
                "COMMUNITY_UPDATE.md": community(report), "study.html": dashboard(report)}
    require(sum(len(body) for body in payloads.values()) <= OUTPUT_LIMIT, "OUTPUT_SIZE_LIMIT")
    manifest = {"protocol": "ZOORA_SFP_STUDY_EVIDENCE_V1", "run_id": report["run_id"],
                "audit_scope": "INTERNAL_CONSISTENCY_NOT_ATTESTATION",
                "members": {name: {"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}
                            for name, body in sorted(payloads.items())}}
    manifest["manifest_sha256"] = digest(manifest)
    payloads["manifest.json"] = canonical(manifest) + b"\n"
    return payloads


def verify_study(folder):
    folder = Path(folder)
    require(folder.is_dir() and not folder.is_symlink(), "INVALID_EVIDENCE_DIRECTORY")
    require({p.name for p in folder.iterdir()} == STUDY_FILES | {"manifest.json"}, "UNEXPECTED_EVIDENCE_MEMBERS")
    paths = [folder / name for name in STUDY_FILES | {"manifest.json"}]
    require(all(p.is_file() and not p.is_symlink() for p in paths) and
            sum(p.stat().st_size for p in paths) <= OUTPUT_LIMIT + 8192, "INVALID_EVIDENCE_FILE")
    try:
        manifest = decode((folder / "manifest.json").read_bytes(), OUTPUT_LIMIT + 8192)
        supplied = manifest.pop("manifest_sha256")
        require(supplied == digest(manifest) and manifest["protocol"] == "ZOORA_SFP_STUDY_EVIDENCE_V1" and
                set(manifest["members"]) == STUDY_FILES and
                manifest["audit_scope"] == "INTERNAL_CONSISTENCY_NOT_ATTESTATION", "INVALID_MANIFEST")
        for name, expected in manifest["members"].items():
            raw = (folder / name).read_bytes()
            require(expected == {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)},
                    "EVIDENCE_HASH_MISMATCH")
        plan = decode((folder / "plan.json").read_bytes())
        cfg = parse_plan(plan)
        stresses = stress_configs(cfg)
        report = decode((folder / "study.json").read_bytes(), OUTPUT_LIMIT)
        require(report["protocol"] == "ZOORA_SFP_STUDY_REPORT_V1" and report["rules"] == STUDY_RULES and
                report["plan_sha256"] == plan["plan_sha256"], "INVALID_STUDY_REPORT")
        fingerprint = report["code_fingerprint"]
        require(fingerprint["sha256"] == digest(fingerprint["files"]), "CODE_FINGERPRINT_MISMATCH")
        identity = {k: report[k] for k in ["rules", "plan_sha256", "dataset_sha256", "code_sha256", "source_head_sha"]}
        require(report["code_sha256"] == fingerprint["sha256"] and digest(identity) == report["run_id"] ==
                manifest["run_id"], "RUN_ID_MISMATCH")
        require(report["readiness"] == "BLOCKED_NOT_A_FUNDED_STRATEGY" and
                report["funds_transferred"] == report["tokens_purchased"] == report["tokens_burned"] == "0" and
                report["account_policy"] == "INDEPENDENT_FOLD_ACCOUNTS_NOT_A_COMPOUNDED_TREASURY",
                "UNSUPPORTED_FINANCIAL_CLAIM")
        require(len(report["folds"]) == plan["folds"], "FOLD_COUNT_MISMATCH")
        require(report["source_verification"] == "UNAVAILABLE" and
                report["price_classification"] == plan["price_classification"] and
                report["market"] == plan["market"] and
                report["unseen_status"] == "CHRONOLOGICAL_WINDOWS_NOT_ATTESTED_UNSEEN", "UNSUPPORTED_SOURCE_CLAIM")
        for i, fold in enumerate(report["folds"]):
            start = plan["start_ms"]
            train_end = start + (plan["train_hours"] + i * plan["test_hours"]) * 3600000
            test_start = train_end + plan["embargo_hours"] * 3600000
            test_end = test_start + plan["test_hours"] * 3600000
            require(fold["fold"] == i and fold["train_start_ms"] == start and
                    fold["train_end_ms"] == train_end and fold["test_start_ms"] == test_start and
                    fold["test_end_ms"] == test_end, "FOLD_SCHEDULE_MISMATCH")
        seen = set()
        with precision():
            for trial in report["trials"]:
                require(trial["trial_id"] not in seen, "DUPLICATE_TRIAL")
                seen.add(trial["trial_id"])
                require(trial["phase"] in {"TRAIN", "TEST"} and trial["scenario"] in SCENARIOS and
                        type(trial["fold"]) is int and 0 <= trial["fold"] < plan["folds"], "INVALID_TRIAL")
                config = config_from_record(trial["config"])
                fold = report["folds"][trial["fold"]]
                window = ([fold["train_start_ms"], fold["train_end_ms"]] if trial["phase"] == "TRAIN"
                          else [fold["test_start_ms"], fold["test_end_ms"]])
                require(trial["window"] == window and trial["rules"] == STUDY_RULES and
                        config.record() == stresses[trial["scenario"]].record(), "TRIAL_PLAN_MISMATCH")
                if trial["phase"] == "TRAIN":
                    require(trial["variant"] in CANDIDATES and trial["scenario"] == "BASE" and
                            trial["seed"] is None, "INVALID_TRAINING_TRIAL")
                else:
                    require(trial["variant"] in {*VARIANTS, "BUY_HOLD", "RANDOM_TIME"}, "INVALID_TEST_VARIANT")
                    require((trial["variant"] == "RANDOM_TIME" and trial["seed"] in plan["seeds"] and
                             type(trial["seed"]) is int and trial["scenario"] == "BASE") or
                            (trial["variant"] != "RANDOM_TIME" and trial["seed"] is None), "INVALID_TRIAL_SEED")
                identity = {k: trial[k] for k in ["fold", "phase", "variant", "scenario", "seed", "window",
                                                 "prefix_sha256", "config", "rules"]}
                require(digest(identity) == trial["trial_id"], "TRIAL_ID_MISMATCH")
                m = trial["metrics"]
                net = sum((_money(t["net_pnl"]) for t in trial["trades"]), D(0))
                require(net == _money(m["completed_trade_net"]) and len(trial["trades"]) == m["completed_trades"],
                        "STUDY_TRADE_TOTAL_MISMATCH")
                expected = (config.initial_cash + _money(m["realized_net_including_open_entry_costs"]) +
                            _money(m["unrealized_price_change"]))
                require(abs(expected - _money(m["ending_marked_nav"])) < D("0.000000000000000000000001"),
                        "STUDY_NAV_RECONCILIATION_FAILED")
                require(_money(m["marked_return"]) == _money(m["ending_marked_nav"]) / config.initial_cash - 1,
                        "STUDY_RETURN_MISMATCH")
                require(0 <= _money(m["ending_cash"]) <= _money(m["ending_marked_nav"]) and
                        _money(m["realized_net_including_open_entry_costs"]) <= net and
                        0 <= _money(m["max_close_mark_drawdown"]) <= 1, "INVALID_STUDY_ACCOUNTING")
                if m["open_position"] is None:
                    require(_money(m["realized_net_including_open_entry_costs"]) == net and
                            _money(m["unrealized_price_change"]) == 0 and
                            _money(m["ending_cash"]) == _money(m["ending_marked_nav"]), "INVALID_FLAT_ACCOUNT")
                for trade in trial["trades"]:
                    require(trial["window"][0] <= trade["entry_open_ms"] < trial["window"][1] and
                            trade["decision_available_ms"] <= trade["entry_open_ms"] and
                            trade["exit_bar_available_ms"] <= trial["window"][1], "TRIAL_TIMING_MISMATCH")
            for f in report["folds"]:
                train = [t for t in report["trials"] if t["fold"] == f["fold"] and t["phase"] == "TRAIN"]
                require([t["variant"] for t in train] == list(CANDIDATES), "TRAIN_TRIALS_MISMATCH")
                selected, reason = select_training(train, plan["min_train_trades"],
                                                   f["train_coverage"]["status"] == "COMPLETE")
                require(selected == f["selected_variant"] and reason == f["selection_reason"],
                        "TRAINING_SELECTION_MISMATCH")
                evaluation = [t for t in report["trials"] if t["fold"] == f["fold"] and t["phase"] == "TEST"]
                expected = ({(v, s, None) for v in VARIANTS for s in SCENARIOS} |
                            {("BUY_HOLD", "BASE", None)} |
                            {("RANDOM_TIME", "BASE", seed) for seed in plan["seeds"]})
                if f["test_coverage"]["status"] != "COMPLETE":
                    expected = set()
                require({(t["variant"], t["scenario"], t["seed"]) for t in evaluation} == expected and
                        len(evaluation) == len(expected), "TEST_TRIAL_MATRIX_MISMATCH")
                require(f["training_trial_ids"] == [t["trial_id"] for t in train] and
                        f["test_trial_ids"] == [t["trial_id"] for t in evaluation] and
                        f["random_rate_bps"] == min(10000, train[0]["metrics"]["plans"] * 10000 //
                                                  ((f["train_end_ms"] - f["train_start_ms"]) // 3600000)),
                        "FOLD_LEDGER_MISMATCH")
            require(report["summary"] == summarize(report["trials"], report["folds"], plan),
                    "STUDY_SUMMARY_MISMATCH")
    except (KeyError, TypeError, ValueError, UnicodeError, IndexError) as exc:
        if isinstance(exc, ResearchError):
            raise
        raise ResearchError("INVALID_STUDY_EVIDENCE") from exc
    return {"protocol": manifest["protocol"], "run_id": report["run_id"],
            "members_verified": len(STUDY_FILES), "scope": manifest["audit_scope"]}
