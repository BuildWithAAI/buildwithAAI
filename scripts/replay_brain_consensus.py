"""Replay bounded worker-receipt events into auditable, non-executable consensus records."""

import argparse
from contextlib import ExitStack
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from multi_brain_research.consensus_stream import MAX_LINE_BYTES, parse_policy, replay_stream  # noqa: E402
from multi_brain_research.contracts import ContractError  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--events", type=Path, help="JSONL file; default reads stdin")
    parser.add_argument("--output", type=Path, help="Create a new audit file; default writes stdout")
    args = parser.parse_args()
    try:
        with ExitStack() as stack:
            with args.policy.open("rb") as stream:
                policy = parse_policy(stream.read(MAX_LINE_BYTES + 1))
            source = stack.enter_context(args.events.open("rb")) if args.events else sys.stdin.buffer
            target = stack.enter_context(args.output.open("xb")) if args.output else sys.stdout.buffer
            summary = replay_stream(policy, source, target)
        print(json.dumps(summary, sort_keys=True), file=sys.stderr)
    except (ContractError, OSError) as exc:
        # Do not echo submitted text, local paths, credentials or stack traces.
        code = str(exc) if isinstance(exc, ContractError) else type(exc).__name__
        print(json.dumps({"status": "INCOMPLETE_OR_REFUSED", "reason": code,
                          "action": "NO_EXECUTION", "execution_allowed": False}), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
