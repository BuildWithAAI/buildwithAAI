"""AAI.fun source preparation and trade-specific readout training; standard library only."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.multi_brain_research import trade_learning as learning  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    demo = sub.add_parser("demo")
    demo.add_argument("--output", type=Path, required=True)
    prepare = sub.add_parser("prepare")
    prepare.add_argument("--archive", type=Path, action="append", required=True)
    prepare.add_argument("--output", type=Path, required=True)
    inspect = sub.add_parser("verify-sources")
    inspect.add_argument("--directory", type=Path, required=True)
    train = sub.add_parser("train")
    train.add_argument("--source", type=Path, required=True)
    train.add_argument("--plan", type=Path, required=True)
    train.add_argument("--output", type=Path, required=True)
    train.add_argument("--features", type=Path)
    verify = sub.add_parser("verify")
    verify.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "demo":
            from src.multi_brain_research.trade_fixture import demo as fixture
            archives, _, plan = fixture()
            result = learning.run(archives, plan, args.output)
        elif args.command == "prepare":
            lab.require(1 <= len(args.archive) <= 8, "SOURCE_ARCHIVE_BOUND")
            result = learning.prepare([ev.read(path) for path in args.archive], args.output)
        elif args.command == "verify-sources":
            _, data = learning.load_sources(args.directory)
            result = {"verified": True, **learning.assessment(data)}
        elif args.command == "train":
            archives, _ = learning.load_sources(args.source)
            result = learning.run(archives, ev.read(args.plan), args.output,
                                  ev.read(args.features) if args.features else None)
        else:
            result = learning.verify(args.directory)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ValueError, OSError, RuntimeError) as error:
        print(json.dumps({"status": "TRADE_LEARNING_REJECTED", "error": str(error),
                          "training_performed": False, "live_execution_allowed": False}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
