"""Prepare blinded episode replay and fit/replay a supervised readout offline."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from multi_brain_research.training_lab import (  # noqa: E402
    TrainingError, demo_data, read_json, run, verify,
)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    demo = sub.add_parser("demo")
    demo.add_argument("--output", required=True, type=Path)
    train = sub.add_parser("train")
    train.add_argument("--dataset", required=True, type=Path)
    train.add_argument("--plan", required=True, type=Path)
    train.add_argument("--features", type=Path)
    train.add_argument("--output", required=True, type=Path)
    check = sub.add_parser("verify")
    check.add_argument("--directory", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "demo":
            data, plan = demo_data()
            result = run(data, plan, args.output)
        elif args.command == "train":
            result = run(read_json(args.dataset), read_json(args.plan), args.output,
                         read_json(args.features) if args.features else None)
        else:
            result = verify(args.directory)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (TrainingError, OSError, KeyError, TypeError, ValueError):
        print(json.dumps({"error": "TRAINING_INPUT_OR_EVIDENCE_REJECTED", "live_execution_allowed": False}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
