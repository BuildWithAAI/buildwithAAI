"""Local testing commands, with no money-moving action."""

import argparse
import json
import os
import sys
from pathlib import Path

from .data import MAX_BYTES, Config, ResearchError, number, parse_dataset, require
from .importer import import_csv
from .reports import publish, render, run, verify


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


def parser():
    p = argparse.ArgumentParser(description="Offline SFP research and paper reports; no live execution.")
    commands = p.add_subparsers(dest="command", required=True)
    r = commands.add_parser("run", help="Analyze one declared dataset and export paper scenarios.")
    r.add_argument("--dataset", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--initial-cash", default="10000")
    r.add_argument("--risk-bps", type=int, default=10)
    r.add_argument("--daily-loss-bps", type=int, default=50)
    r.add_argument("--fee-bps", type=int, default=10)
    r.add_argument("--slippage-bps", type=int, default=5)
    r.add_argument("--fixed-cost", default="0.01")
    r.add_argument("--latency-ms", type=int, default=0)
    r.add_argument("--hold-bars", type=int, default=168)
    r.add_argument("--buy-burn-scenario-bps", type=int)
    r.add_argument("--source-head", default=os.environ.get("SOURCE_HEAD_SHA"))
    v = commands.add_parser("verify", help="Check local file hashes and paper accounting.")
    v.add_argument("--report-dir", required=True)
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
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "run":
            dataset = parse_dataset(read_input(args.dataset))
            config = Config(number(args.initial_cash), args.risk_bps, args.daily_loss_bps,
                            args.fee_bps, args.slippage_bps, number(args.fixed_cost),
                            args.latency_ms, args.hold_bars, args.buy_burn_scenario_bps)
            report, results = run(dataset, config, args.source_head)
            publish(args.out, render(report, results))
            result = {"status": "SAVED_PAPER_REPORT", "run_id": report["run_id"],
                      "signals": report["signal_count"], "funds_transferred": "0",
                      "tokens_purchased": "0", "tokens_burned": "0"}
        elif args.command == "verify":
            result = verify(args.report_dir)
        else:
            body, result = import_csv(read_input(args.csv), base=args.base, quote=args.quote,
                                      venue=args.venue, source_id=args.source_id,
                                      captured_ms=args.captured_ms, delay_ms=args.delay_ms,
                                      classification=args.classification)
            exclusive_file(args.out, body)
            result["status"] = "IMPORTED_UNVERIFIED_HISTORY"
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
