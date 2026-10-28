"""Collect, resume, verify and prepare bounded AAI.fun historical source sessions."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.solana_research import source_history as history  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402
from src.multi_brain_research import trade_learning as learning  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    capture = commands.add_parser("capture")
    capture.add_argument("--output", type=Path, required=True)
    capture.add_argument("--slots", type=int, default=8)
    capture.add_argument("--start-slot", type=int)
    capture.add_argument("--endpoint", choices=ev.ENDPOINTS, default=ev.ENDPOINTS[0])
    for command in ("resume", "verify", "prepare"):
        child = commands.add_parser(command)
        child.add_argument("--directory", type=Path, required=True)
        if command == "prepare":
            child.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "capture":
            result = history.collect(args.output, slot_count=args.slots,
                                     start_slot=args.start_slot, endpoint=args.endpoint)
        elif args.command == "resume":
            result = history.resume(args.directory)
        else:
            archives, manifest = history.verify(args.directory)
            if args.command == "prepare":
                result = learning.prepare(archives, args.output, stitch=True)
            else:
                result = {"verified": True, **history.summary(manifest)}
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ValueError, OSError, RuntimeError) as error:
        print(json.dumps({"status": "HISTORY_REJECTED", "error": str(error),
                          "training_performed": False, "live_execution_allowed": False}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
