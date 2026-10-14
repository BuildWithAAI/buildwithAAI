"""Local testing commands, with no money-moving action."""

import argparse
import json
import os
import sys
from pathlib import Path

from .data import MAX_BYTES, Config, ResearchError, canonical, decode, number, parse_dataset, require
from .importer import import_csv
from .notebook import capture_csv, evaluate_notebook, load_notebook, notebook_status, open_notebook
from .notebook_reports import EXPORT_PROTOCOL, render_notebook, verify_notebook_export
from .reports import publish, render, run, verify
from .study import make_plan, run_study
from .study_reports import render_study, verify_study


def read_input(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= MAX_BYTES,
            "INVALID_INPUT_FILE")
    with path.open("rb") as stream:
        body = stream.read(MAX_BYTES + 1)
    require(len(body) <= MAX_BYTES, "INPUT_SIZE_LIMIT")
    return body


def exclusive_file(path, body):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())


def config_arguments(r):
    r.add_argument("--initial-cash", default="10000")
    r.add_argument("--risk-bps", type=int, default=10)
    r.add_argument("--daily-loss-bps", type=int, default=50)
    r.add_argument("--fee-bps", type=int, default=10)
    r.add_argument("--slippage-bps", type=int, default=5)
    r.add_argument("--fixed-cost", default="0.01")
    r.add_argument("--latency-ms", type=int, default=0)
    r.add_argument("--hold-bars", type=int, default=168)


def config_for(args):
    return Config(number(args.initial_cash), args.risk_bps, args.daily_loss_bps,
                  args.fee_bps, args.slippage_bps, number(args.fixed_cost),
                  args.latency_ms, args.hold_bars, getattr(args, "buy_burn_scenario_bps", None))


def parser():
    p = argparse.ArgumentParser(description="Offline SFP research and paper reports; no live execution.")
    commands = p.add_subparsers(dest="command", required=True)
    r = commands.add_parser("run", help="Analyze one declared dataset and export paper scenarios.")
    r.add_argument("--dataset", required=True)
    r.add_argument("--out", required=True)
    config_arguments(r)
    r.add_argument("--buy-burn-scenario-bps", type=int)
    r.add_argument("--source-head", default=os.environ.get("SOURCE_HEAD_SHA"))
    v = commands.add_parser("verify", help="Check local file hashes and paper accounting.")
    v.add_argument("--report-dir", required=True)
    v.add_argument("--expected-head")
    v.add_argument("--replay", action="store_true", help="Rerun notebook evaluations with matching engine bytes.")
    c = commands.add_parser("import-csv", help="Import supplied 1-hour Kraken-format CSV offline.")
    c.add_argument("--csv", required=True)
    c.add_argument("--base", required=True)
    c.add_argument("--quote", required=True)
    c.add_argument("--venue", required=True)
    c.add_argument("--source-id", required=True)
    c.add_argument("--classification", required=True,
                   choices=["SYNTHETIC", "SOURCE_ASSERTED_OBSERVATIONS"])
    c.add_argument("--captured-ms", required=True, type=int)
    c.add_argument("--delay-ms", type=int, default=0)
    c.add_argument("--out", required=True)
    f = commands.add_parser("prepare-study", help="Freeze a chronological research plan before evaluation.")
    f.add_argument("--dataset", required=True)
    f.add_argument("--out", required=True)
    config_arguments(f)
    f.add_argument("--warmup-hours", type=int, default=204)
    f.add_argument("--train-hours", type=int, default=240)
    f.add_argument("--test-hours", type=int, default=192)
    f.add_argument("--folds", type=int, default=3)
    f.add_argument("--embargo-hours", type=int)
    f.add_argument("--seeds", type=int, nargs="+", default=[11, 23, 47, 89, 131])
    f.add_argument("--min-train-trades", type=int, default=3)
    f.add_argument("--min-test-trades", type=int, default=30)
    f.add_argument("--max-drawdown-bps", type=int, default=300)
    s = commands.add_parser("study", help="Run frozen chronological trials and export a portable dashboard.")
    s.add_argument("--dataset", required=True)
    s.add_argument("--plan", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--source-head", default=os.environ.get("SOURCE_HEAD_SHA"))
    for command, help_text in [
        ("notebook-open", "Create a persistent notebook for a frozen plan and its original dataset."),
        ("notebook-capture", "Retain original CSV bytes and append matching, unrevised history."),
        ("notebook-evaluate", "Record the complete chronological evaluation without removing old results."),
        ("notebook-status", "Verify notebook inputs, checkpoints and evaluation history."),
        ("notebook-export", "Export all recorded evidence and the latest study for community review."),
    ]:
        n = commands.add_parser(command, help=help_text)
        n.add_argument("--notebook", required=True)
        if command == "notebook-open":
            n.add_argument("--dataset", required=True)
            n.add_argument("--plan", required=True)
            n.add_argument("--delay-ms", type=int, default=0)
        else:
            n.add_argument("--expected-head")
        if command == "notebook-capture":
            n.add_argument("--csv", required=True)
            n.add_argument("--captured-ms", type=int, required=True)
        elif command == "notebook-evaluate":
            n.add_argument("--source-head", default=os.environ.get("SOURCE_HEAD_SHA"))
        elif command == "notebook-status":
            n.add_argument("--replay", action="store_true")
        elif command == "notebook-export":
            n.add_argument("--out", required=True)
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "run":
            dataset = parse_dataset(read_input(args.dataset))
            config = config_for(args)
            report, results = run(dataset, config, args.source_head)
            publish(args.out, render(report, results))
            result = {"status": "SAVED_PAPER_REPORT", "run_id": report["run_id"],
                      "signals": report["signal_count"], "funds_transferred": "0",
                      "tokens_purchased": "0", "tokens_burned": "0"}
        elif args.command == "verify":
            manifest = decode(read_input(Path(args.report_dir) / "manifest.json"))
            require(isinstance(manifest, dict), "INVALID_MANIFEST")
            if manifest.get("protocol") == EXPORT_PROTOCOL:
                result = verify_notebook_export(args.report_dir, args.expected_head, args.replay)
            else:
                require(args.expected_head is None and not args.replay, "NOTEBOOK_VERIFY_OPTIONS_REQUIRED")
                result = (verify_study(args.report_dir) if manifest.get("protocol") ==
                          "ZOORA_SFP_STUDY_EVIDENCE_V1" else verify(args.report_dir))
        elif args.command == "prepare-study":
            dataset = parse_dataset(read_input(args.dataset))
            plan = make_plan(dataset, config_for(args), warmup_hours=args.warmup_hours,
                             train_hours=args.train_hours, test_hours=args.test_hours, folds=args.folds,
                             seeds=args.seeds, min_train_trades=args.min_train_trades,
                             min_test_trades=args.min_test_trades, max_drawdown_bps=args.max_drawdown_bps,
                             embargo_hours=args.embargo_hours)
            exclusive_file(args.out, canonical(plan) + b"\n")
            result = {"status": "FROZEN_LOCAL_RESEARCH_PLAN", "plan_sha256": plan["plan_sha256"],
                      "preregistration": plan["preregistration"]}
        elif args.command == "study":
            dataset = parse_dataset(read_input(args.dataset))
            plan = decode(read_input(args.plan))
            report = run_study(dataset, plan, args.source_head)
            publish(args.out, render_study(report, plan))
            result = {"status": "SAVED_CHRONOLOGICAL_STUDY", "run_id": report["run_id"],
                      "folds": len(report["folds"]), "trials": len(report["trials"]),
                      "readiness": report["readiness"], "funds_transferred": "0", "tokens_burned": "0"}
        elif args.command == "import-csv":
            body, result = import_csv(read_input(args.csv), base=args.base, quote=args.quote,
                                      venue=args.venue, source_id=args.source_id,
                                      captured_ms=args.captured_ms, delay_ms=args.delay_ms,
                                      classification=args.classification)
            exclusive_file(args.out, body)
            result["status"] = "IMPORTED_UNVERIFIED_HISTORY"
        elif args.command == "notebook-open":
            result = open_notebook(args.notebook, read_input(args.dataset), decode(read_input(args.plan)),
                                   args.delay_ms)
        elif args.command == "notebook-capture":
            result = capture_csv(args.notebook, read_input(args.csv), args.captured_ms, args.expected_head)
        elif args.command == "notebook-evaluate":
            result = evaluate_notebook(args.notebook, args.source_head, args.expected_head)
        elif args.command == "notebook-status":
            result = notebook_status(load_notebook(args.notebook, args.expected_head, args.replay))
            result["full_evaluation_replay"] = args.replay
        elif args.command == "notebook-export":
            state = load_notebook(args.notebook, args.expected_head)
            publish(args.out, render_notebook(state))
            result = {"status": "SAVED_RESEARCH_NOTEBOOK", "head_sha256": state["head_sha256"],
                      "members": 10, "funds_transferred": "0", "tokens_burned": "0"}
        print(json.dumps(result, sort_keys=True))
        return 0
    except ResearchError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 2
    except OSError:
        print(json.dumps({"error": "LOCAL_FILE_OPERATION_FAILED"}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
