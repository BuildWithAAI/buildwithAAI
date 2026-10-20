"""Capture or reconstruct an AAI.fun research tape; no keys, wallets or orders."""
import argparse
import json
from pathlib import Path
import secrets
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from solana_research.coin_evidence import (  # noqa: E402
    ENDPOINTS, EvidenceError, digest, read, reconstruct, replay, verify_outputs, write,
)
from solana_research.evidence_capture import capture  # noqa: E402


def save_reconstruction(archive, output, alias_salt):
    tape = reconstruct(archive)
    plan = {"alias_salt": alias_salt}
    trace = replay(tape, alias_salt=alias_salt)
    for name, value in (("trade-tape.json", tape), ("replay-plan.json", plan), ("public-replay.json", trace)):
        write(output / name, value)
    verified = verify_outputs(output)
    summary = {**verified, "status": "RECONSTRUCTED_SOURCE_SAMPLE",
               "archive_classification": archive["classification"], "tape_sha256": digest(tape),
               "trace_head_sha256": trace["head_sha256"], "captured_block_count": tape["captured_block_count"],
               "failed_transaction_count": tape["failed_transaction_count"],
               "known_fee_lamports": tape["known_fee_lamports"], "unknown_fee_count": tape["unknown_fee_count"],
               "other_or_unmapped_cpi_events": tape["other_or_unmapped_cpi_events"],
               "market_validation_established": False, "training_performed": False,
               "historical_observer_availability_known": False, "execution_quotes_available": False,
               "live_execution_allowed": False}
    write(output / "summary.json", summary)
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    live = subs.add_parser("capture")
    live.add_argument("--endpoint", choices=ENDPOINTS, default=ENDPOINTS[0])
    live.add_argument("--start-slot", type=int)
    live.add_argument("--blocks", type=int, default=1)
    live.add_argument("--require-trades", action="store_true")
    live.add_argument("--output", type=Path, required=True)
    offline = subs.add_parser("build")
    offline.add_argument("--archive", type=Path, required=True)
    offline.add_argument("--output", type=Path, required=True)
    verify = subs.add_parser("verify")
    verify.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "verify":
            result = verify_outputs(args.directory)
        elif args.command == "capture":
            archive = capture(args.output, endpoint=args.endpoint, start_slot=args.start_slot, count=args.blocks)
            result = save_reconstruction(archive, args.output, secrets.token_hex(32))
            if args.require_trades and result["trade_count"] == 0:
                raise EvidenceError("NO_SUPPORTED_TRADES_OBSERVED")
        else:
            archive = read(args.archive)
            args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
            write(args.output / "archive.json", archive)
            result = save_reconstruction(archive, args.output, secrets.token_hex(32))
        print(json.dumps(result, sort_keys=True))
        return 0
    except (EvidenceError, OSError, RuntimeError, ValueError) as error:
        print(json.dumps({"status": "INCOMPLETE_OR_REJECTED", "error": str(error),
                          "training_performed": False, "live_execution_allowed": False}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
