"""Reproducible local exports; every fill and allocation remains simulated."""

import csv
import hashlib
import io
import os
import re
from contextlib import suppress
from pathlib import Path

from . import RULE_VERSION, __version__
from .data import (
    Config,
    D,
    ResearchError,
    canonical,
    decode,
    digest,
    precision,
    require,
)
from .detector import detect, event_labels
from .paper import VARIANTS, budget_scenario, simulate

OUTPUT_LIMIT = 64 * 1024 * 1024
FILES = {"report.json", "signals.csv", "trades.csv", "equity.csv", "COMMUNITY_UPDATE.md"}
STUDY_FILES = {"plan.json", "study.json", "folds.csv", "trials.csv", "study.html", "COMMUNITY_UPDATE.md"}


def code_fingerprint():
    root = Path(__file__).parent
    members = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
               for p in sorted(root.glob("*.py"))}
    return {"files": members, "sha256": digest(members),
            "scope": "LOCAL_PACKAGE_BYTES_NOT_EXTERNAL_ATTESTATION"}


def run(dataset, config=None, source_head=None):
    config = Config() if config is None else config
    require(source_head is None or (isinstance(source_head, str) and
            len(source_head) == 40 and all(c in "0123456789abcdef" for c in source_head)),
            "INVALID_SOURCE_HEAD")
    with precision():
        signals, skips = detect(dataset)
        results = [simulate(dataset, config, signals, variant) for variant in VARIANTS]
        fingerprint = code_fingerprint()
        identity = {"dataset_sha256": dataset.dataset_sha256, "config": config.record(),
                    "rules": RULE_VERSION, "code_sha256": fingerprint["sha256"],
                    "declared_source_head": source_head}
        report = {"protocol": "ZOORA_SFP_PAPER_REPORT_V1", "version": __version__,
                  "rule_version": RULE_VERSION, "run_id": digest(identity),
                  "source_head_sha": source_head,
                  "source_head_status": "DECLARED_NOT_ATTESTED" if source_head else "UNDECLARED",
                  "code_fingerprint": fingerprint,
                  "activity": "OFFLINE_RESEARCH_PAPER_SIMULATION",
                  "execution_model": "CONSERVATIVE_OHLC_BOUND_NOT_EXECUTABLE_QUOTE",
                  "market": dataset.market, "price_classification": dataset.classification,
                  "availability_semantics": dataset.availability,
                  "source_verification": "UNAVAILABLE", "fixture_purpose": dataset.purpose,
                  "source_sha256": dataset.source_sha256, "dataset_sha256": dataset.dataset_sha256,
                  "bars": len(dataset.bars), "first_open_ms": dataset.bars[0].open_ms,
                  "last_close_ms": dataset.bars[-1].close_ms,
                  "captured_ms": dataset.captured_ms, "coverage_gaps": list(dataset.gaps),
                  "config": config.record(), "detector_skips": dict(sorted(skips.items())),
                  "signal_count": len(signals), "signals": [s.record() for s in signals],
                  "event_labels": event_labels(dataset, signals),
                  "results": [{k: v for k, v in r.items() if k != "equity"} for r in results],
                  "sample_status": "ENGINE_FIXTURE_NOT_PERFORMANCE_EVIDENCE" if
                  dataset.classification == "SYNTHETIC" else "RESEARCH_PILOT_NOT_RELEASE_EVIDENCE",
                  "go_no_go_status": "NOT_EVALUATED",
                  "walk_forward_status": "SEPARATE_FROZEN_STUDY_COMMAND_NOT_PERFORMANCE_PROOF",
                  "multiple_testing_status": "NOT_EVALUATED",
                  "matched_random_baseline": "TRAIN_DENSITY_TIME_CONTROLS_AVAILABLE_EXACT_MATCHING_UNIMPLEMENTED",
                  "risk_control": "CLOSED_BAR_PAPER_CIRCUIT_NOT_LIVE_GOVERNOR",
                  "quantity_resolution": "SYNTHETIC_0.00000001_BASE_UNITS",
                  "customer_activity": False, "funds_transferred": "0",
                  "tokens_purchased": "0", "tokens_burned": "0",
                  "funding_source": "INITIAL_SIMULATED_CAPITAL_NOT_CREATOR_FEE_RECEIPTS",
                  "price_floor": "NOT_ESTABLISHED",
                  "limitations": [
                      "All executions, fees, slippage and allocations are synthetic scenarios.",
                      "OHLC cannot establish actual quote/fill availability or intrabar order.",
                      "Ambiguous stop/target paths use a conservative stop bound, not a measured fill.",
                      "A missing interval while invested leaves the position unresolved.",
                      "Source attribution and receipt timing are input assertions, not verified providers.",
                      "Open inventory marks are not realized profit or guaranteed exit value.",
                      "Exact exposure-matched controls, independently unseen market evaluation and selection-risk acceptance are absent.",
                      "No wallet, network, trading, buyback or burn execution exists in this package."]}
    return report, results


def _csv(rows, fields):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fields, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for row in rows:
        safe = {}
        for field in fields:
            value = row.get(field)
            if (isinstance(value, str) and value.startswith(("=", "+", "-", "@"))
                    and not re.fullmatch(r"-[0-9]+(?:\.[0-9]+)?", value)):
                value = "'" + value
            safe[field] = value
        writer.writerow(safe)
    return stream.getvalue().encode("utf-8")


def community_update(report):
    rows = []
    for result in report["results"]:
        budget = result["buy_burn_scenario"]
        rows.append("| " + " | ".join([
            result["variant"], str(result["completed_trades"]),
            format(D(result["realized_net_including_open_entry_costs"]), ".4f"),
            format(D(result["unrealized_price_change"]), ".4f"),
            format(D(result["costs_including_slippage"]), ".4f"),
            format(D(result["max_close_mark_drawdown"]), ".2%"),
            format(D(budget["buy_burn_budget_quote_units"]), ".4f")]) + " |")
    market = report["market"]
    text = [
        "# SFP testing update",
        "",
        "**OFFLINE PAPER SIMULATION — NOT REAL TRADING OR A VERIFIED STRATEGY EDGE.**",
        "",
        "Data: " + report["price_classification"] + ". Availability: " +
        report["availability_semantics"] + ". Source verification is unavailable.",
        "Fixture purpose: " + report["fixture_purpose"] + ".",
        "Market label: " + market["base"] + "/" + market["quote"] + " at " + market["venue"] +
        "; quote units are not asserted USD values.",
        "",
        "Run: " + report["run_id"] + ". Dataset: " + report["dataset_sha256"] + ".",
        "Bars: " + str(report["bars"]) + "; SFP events: " + str(report["signal_count"]) +
        "; recorded coverage gaps: " + str(len(report["coverage_gaps"])) + ".",
        "",
        "| Variant | Closed trades | Realized net scenario | Open price change | Costs incl. slippage | Close-mark drawdown | Unspent buy/burn scenario budget |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        *rows,
        "",
        ("A: reclaim. B: upward 4-hour context. C: later structure confirmation. "
         "NO_TRADE: cash. TREND_ONLY: the frozen daily upward-context benchmark."),
        "",
        ("An unresolved position is not forced closed to create profit. Fees and slippage "
         "are assumptions; ambiguous paths use a stop bound. Daily limits observe closed bars "
         "and cannot guarantee maximum losses. Inspect report.json and the CSV records for "
         "skips, unresolved positions and coverage."),
        "",
        ("Funding is initial simulated capital, not creator-fee income. Buy/burn allocation "
         "is UNSELECTED unless an explicitly labelled scenario rate was supplied. Its budget "
         "uses recovered cumulative realized net and free cash above initial capital. "
         "Deposits and open gains are not distributable profit."),
        "",
        "**Funds moved: 0. Tokens purchased: 0. Tokens burned: 0. No price floor established.**",
        "",
        ("Testing is available. Real historical source/quote verification, numerical strategy "
         "acceptance gates, exact exposure matching, independently unseen market evaluation and "
         "forward evaluation remain unfinished. These results do not authorize a funded strategy, "
         "token purchase, burn or a selected allocation."),
        ""]
    return "\n".join(text).encode("utf-8")


def render(report, results):
    payloads = {
        "report.json": canonical(report) + b"\n",
        "signals.csv": _csv(report["signals"], ["id", "index", "direction", "pivot_index",
                                               "level", "pivot_confirmed_ms", "available_ms",
                                               "atr", "stop", "confirmation", "classification"]),
        "trades.csv": _csv((dict(t, variant=r["variant"]) for r in results for t in r["trades"]),
                          ["variant", "signal_id", "entry_index", "exit_index",
                           "decision_available_ms", "entry_open_ms", "exit_bar_available_ms",
                           "entry", "exit", "quantity", "entry_fee", "exit_fee",
                           "slippage_cost", "nominal_risk", "net_pnl", "net_r",
                           "reason", "path_ambiguous", "classification"]),
        "equity.csv": _csv((dict(e, variant=r["variant"]) for r in results for e in r["equity"]),
                          ["variant", "index", "close_ms", "available_ms", "cash",
                           "inventory_mark", "nav", "daily_entry_halt", "mark_classification"]),
        "COMMUNITY_UPDATE.md": community_update(report)}
    require(sum(len(v) for v in payloads.values()) <= OUTPUT_LIMIT, "OUTPUT_SIZE_LIMIT")
    members = {name: {"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}
               for name, body in sorted(payloads.items())}
    manifest = {"protocol": "ZOORA_SFP_LOCAL_EVIDENCE_V1", "run_id": report["run_id"],
                "members": members, "audit_scope": "INTERNAL_CONSISTENCY_NOT_ATTESTATION"}
    manifest["manifest_sha256"] = digest(manifest)
    payloads["manifest.json"] = canonical(manifest) + b"\n"
    return payloads


def publish(folder, payloads):
    folder = Path(folder)
    created = []
    require((set(payloads) == FILES | {"manifest.json"} or
             set(payloads) == STUDY_FILES | {"manifest.json"}) and
            all(isinstance(body, bytes) for body in payloads.values()), "INVALID_EXPORT")
    require(sum(len(v) for v in payloads.values()) <= OUTPUT_LIMIT + 8192, "OUTPUT_SIZE_LIMIT")
    try:
        folder.mkdir(mode=0o700, parents=False, exist_ok=False)
    except FileExistsError as exc:
        raise ResearchError("OUTPUT_ALREADY_EXISTS") from exc
    try:
        for name, body in sorted(payloads.items()):
            require(name in FILES | STUDY_FILES | {"manifest.json"}, "INVALID_OUTPUT_NAME")
            path = folder / name
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append(path)
            with os.fdopen(fd, "wb") as stream:
                stream.write(body)
                stream.flush()
                os.fsync(stream.fileno())
    except BaseException:
        for path in created:
            path.unlink(missing_ok=True)
        with suppress(OSError):
            folder.rmdir()
        raise


def verify(folder):
    folder = Path(folder)
    require(folder.is_dir() and not folder.is_symlink(), "INVALID_EVIDENCE_DIRECTORY")
    require({p.name for p in folder.iterdir()} == FILES | {"manifest.json"},
            "UNEXPECTED_EVIDENCE_MEMBERS")
    paths = [folder / n for n in FILES | {"manifest.json"}]
    require(all(p.is_file() and not p.is_symlink() for p in paths), "INVALID_EVIDENCE_FILE")
    require(sum(p.stat().st_size for p in paths) <= OUTPUT_LIMIT + 8192, "OUTPUT_SIZE_LIMIT")
    try:
        manifest = decode((folder / "manifest.json").read_bytes(), OUTPUT_LIMIT + 8192)
        supplied = manifest.pop("manifest_sha256")
        require(supplied == digest(manifest), "MANIFEST_HASH_MISMATCH")
        require(manifest["protocol"] == "ZOORA_SFP_LOCAL_EVIDENCE_V1" and
                set(manifest["members"]) == FILES and
                manifest["audit_scope"] == "INTERNAL_CONSISTENCY_NOT_ATTESTATION",
                "INVALID_MANIFEST")
        for name, expected in manifest["members"].items():
            raw = (folder / name).read_bytes()
            require(expected == {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)},
                    "EVIDENCE_HASH_MISMATCH")
        report = decode((folder / "report.json").read_bytes(), OUTPUT_LIMIT)
        require(report["run_id"] == manifest["run_id"] and
                report["protocol"] == "ZOORA_SFP_PAPER_REPORT_V1", "RUN_ID_MISMATCH")
        require(report["activity"] == "OFFLINE_RESEARCH_PAPER_SIMULATION" and
                report["funds_transferred"] == report["tokens_purchased"] ==
                report["tokens_burned"] == "0", "UNSUPPORTED_FINANCIAL_CLAIM")
        raw_config = report["config"]
        config = Config(_money(raw_config["initial_cash"]), raw_config["risk_bps"],
                        raw_config["daily_loss_bps"], raw_config["fee_bps"],
                        raw_config["slippage_bps"], _money(raw_config["fixed_cost"]),
                        raw_config["latency_ms"], raw_config["hold_bars"],
                        raw_config["buy_burn_scenario_bps"])
        require(config.record() == raw_config, "INVALID_CONFIG_RECORD")
        fingerprint = report["code_fingerprint"]
        require(fingerprint["sha256"] == digest(fingerprint["files"]),
                "CODE_FINGERPRINT_MISMATCH")
        identity = {"dataset_sha256": report["dataset_sha256"], "config": config.record(),
                    "rules": report["rule_version"], "code_sha256": fingerprint["sha256"],
                    "declared_source_head": report["source_head_sha"]}
        require(digest(identity) == report["run_id"], "RUN_ID_MISMATCH")
        with precision():
            for result in report["results"]:
                initial = config.initial_cash
                expected = (initial + _money(result["realized_net_including_open_entry_costs"]) +
                            _money(result["unrealized_price_change"]))
                require(abs(expected - _money(result["ending_marked_nav"])) <
                        D("0.000000000000000000000001"), "PAPER_NAV_RECONCILIATION_FAILED")
                net = sum((_money(t["net_pnl"]) for t in result["trades"]), D(0))
                require(abs(net - _money(result["completed_trade_net"])) <
                        D("0.000000000000000000000001"), "TRADE_TOTAL_MISMATCH")
                budget = result["buy_burn_scenario"]
                require(budget["funds_transferred"] == budget["tokens_purchased"] ==
                        budget["tokens_burned"] == "0", "UNSUPPORTED_FINANCIAL_CLAIM")
                recomputed = budget_scenario(
                    _money(result["realized_net_including_open_entry_costs"]),
                    _money(result["ending_cash"]), initial,
                    config.buy_burn_scenario_bps,
                    bool(result["open_position"] is not None or report["coverage_gaps"]))
                require(budget == recomputed, "BUDGET_RECONCILIATION_FAILED")
    except (KeyError, TypeError, ValueError, UnicodeError) as exc:
        if isinstance(exc, ResearchError):
            raise
        raise ResearchError("INVALID_EVIDENCE") from exc
    return {"protocol": manifest["protocol"], "run_id": report["run_id"],
            "members_verified": len(FILES), "scope": manifest["audit_scope"]}


def _money(value):
    require(isinstance(value, str) and
            re.fullmatch(r"-?(?:0|[1-9][0-9]{0,54})(?:\.[0-9]{1,80})?", value),
            "INVALID_REPORT_DECIMAL")
    result = D(value)
    require(result.is_finite(), "INVALID_REPORT_DECIMAL")
    return result
