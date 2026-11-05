"""Score one captured observation in paper mode. Does not send an order."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from multi_brain_research.giant_brain import fuse, paper_backtest, source_status  # noqa: E402
from multi_brain_research.paper_log import append  # noqa: E402
from multi_brain_research.walk_forward import walk_forward  # noqa: E402
from multi_brain_research.watch import replay  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--observation", type=Path, help="One JSON observation")
    parser.add_argument("--tape", type=Path, help="JSON list of observations for a paper backtest")
    parser.add_argument("--memory", type=Path, help="Crow memory JSONL. Created when a backtest records outcomes")
    parser.add_argument("--paper-log", type=Path)
    parser.add_argument("--now-ms", type=int, default=1_700_000_000_000)
    parser.add_argument("--snapshot-root", type=Path, help="Giant Brain snapshot directory")
    parser.add_argument("--theses-dir", type=Path, help="Where thesis JSON and markdown are written")
    parser.add_argument("--ledger", type=Path, help="Paper position ledger JSONL")
    parser.add_argument("--threshold-ppm", type=int, default=600_000)
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--not-before-ms", type=int, help="Open new paper positions only at or after this time")
    parser.add_argument("--candle-dir", type=Path, help="JSONL minute candles keyed by pair address")
    parser.add_argument("--exit-policy", choices=("ladder_e", "single_target"), default="ladder_e")
    parser.add_argument("--walk-forward", action="store_true", help="Score the post-gap snapshots with and without crow memory")
    parser.add_argument("--capture-holders", action="store_true", help="Read holder concentration for the newest snapshot and append JSONL")
    parser.add_argument("--holder-pending", action="store_true", help="With --capture-holders, read only mints in recent snapshots that lack a fresh cached read")
    parser.add_argument("--holder-limit", type=int, help="Cap the number of mints read")
    parser.add_argument("--holder-fresh-ms", type=int, help="Skip an AVAILABLE read younger than this many milliseconds")
    parser.add_argument("--holder-retry-ms", type=int, help="Retry a NOT_OBSERVED read after this many milliseconds")
    parser.add_argument("--holder-window", type=int, help="How many newest snapshots to scan for pending mints")
    parser.add_argument("--no-holder-reads", action="store_true", help="Do not join stored holder reads during a replay or walk-forward")
    parser.add_argument("--capture-pool-trades", action="store_true", help="Read GeckoTerminal pool trades for candidate mints and append JSONL")
    parser.add_argument("--pool-trade-pending", action="store_true", help="With --capture-pool-trades, skip mints that already have a fresh read")
    parser.add_argument("--pool-trade-limit", type=int, help="Cap the number of pools read")
    parser.add_argument("--entry-veto", action="store_true", help="Refuse a paper open when a causal holder read is RAISED or a causal large-sell share is at least half")
    parser.add_argument("--cutoff-file", help="Last snapshot included, relative to the store. Later files stay out")
    parser.add_argument("--not-after-ms", type=int, help="Drop snapshots whose timestamp is at or after this millisecond")
    parser.add_argument("--top-volume-only", action="store_true", help="Score only the volume-ranked limit and do not close vanished mints")
    parser.add_argument("--min-recalled-return", type=float, help="Refuse a paper open unless crow recalled at least this later return")
    parser.add_argument("--max-crow-distance", type=float, help="Refuse a paper open when the crow match is farther than this")
    parser.add_argument("--require-primary-vote", action=argparse.BooleanOptionalAction, default=True, help="Refuse a paper open when FlyVis has no numeric vote. On by default. --no-require-primary-vote scores without that refusal")
    parser.add_argument("--audit-path", type=Path, help="Write one JSONL row per scored print for the with-crow books")
    parser.add_argument("--work-dir", type=Path, help="Ledger and memory directory for --walk-forward")
    parser.add_argument("--status", action="store_true", help="Print which sources are configured")
    args = parser.parse_args()
    if args.status:
        print(json.dumps(source_status(), sort_keys=True))
    if args.walk_forward:
        if args.snapshot_root is None or args.work_dir is None:
            parser.error("--walk-forward requires --snapshot-root and --work-dir")
        print(json.dumps(walk_forward(
            args.snapshot_root, args.work_dir, limit=args.limit, threshold_ppm=args.threshold_ppm,
            candle_dir=args.candle_dir, use_holder_reads=not args.no_holder_reads,
            use_entry_veto=args.entry_veto, retain_universe=not args.top_volume_only,
            cutoff_file=args.cutoff_file, not_before_ms=args.not_before_ms, not_after_ms=args.not_after_ms,
            min_recalled_return=args.min_recalled_return, max_crow_distance=args.max_crow_distance,
            require_primary_vote=args.require_primary_vote, audit_path=args.audit_path,
        ), sort_keys=True))
        return 0
    if args.capture_pool_trades:
        if args.snapshot_root is None:
            parser.error("--capture-pool-trades requires --snapshot-root")
        from multi_brain_research.flow_capture import PENDING_LIMIT, capture_pool_trades
        print(json.dumps(capture_pool_trades(
            args.snapshot_root,
            pending_only=True,
            limit=PENDING_LIMIT if args.pool_trade_limit is None else args.pool_trade_limit,
        ), sort_keys=True))
        return 0
    if args.capture_holders:
        if args.snapshot_root is None:
            parser.error("--capture-holders requires --snapshot-root")
        from multi_brain_research.holder_capture import capture_holders
        kwargs = {}
        if args.holder_pending:
            kwargs["pending_only"] = True
        if args.holder_limit is not None:
            kwargs["limit"] = args.holder_limit
        if args.holder_fresh_ms is not None:
            kwargs["fresh_ms"] = args.holder_fresh_ms
        if args.holder_retry_ms is not None:
            kwargs["retry_ms"] = args.holder_retry_ms
        if args.holder_window is not None:
            kwargs["window"] = args.holder_window
        print(json.dumps(capture_holders(args.snapshot_root, **kwargs), sort_keys=True))
        return 0
    if args.snapshot_root:
        if args.theses_dir is None or args.ledger is None:
            parser.error("--snapshot-root requires --theses-dir and --ledger")
        print(json.dumps(replay(
            args.snapshot_root, args.ledger, args.theses_dir, threshold_ppm=args.threshold_ppm,
            limit=args.limit, not_before_ms=args.not_before_ms, not_after_ms=args.not_after_ms,
            cutoff_file=args.cutoff_file, candle_dir=args.candle_dir,
            exit_policy=args.exit_policy, use_holder_reads=not args.no_holder_reads,
            use_entry_veto=args.entry_veto, retain_universe=not args.top_volume_only,
            min_recalled_return=args.min_recalled_return, max_crow_distance=args.max_crow_distance,
            require_primary_vote=args.require_primary_vote, audit_path=args.audit_path,
        ), sort_keys=True))
        return 0
    if args.tape is None and args.observation is None:
        if args.status:
            return 0
        parser.error("pass --observation or --tape")
    if args.paper_log is None:
        parser.error("--paper-log is required to record a paper signal")
    if args.tape:
        observations = json.loads(args.tape.read_text(encoding="utf-8"))
        result = paper_backtest(observations, args.paper_log, args.memory)
        print(json.dumps(result, sort_keys=True))
        return 0
    if args.observation is None:
        parser.error("pass --observation or --tape")
    observation = json.loads(args.observation.read_text(encoding="utf-8"))
    signal = fuse(observation, now_ms=args.now_ms, memory_path=args.memory)
    append(args.paper_log, signal)
    print(json.dumps({
        "fused_score_ppm": signal["fused_score_ppm"],
        "confidence_ppm": signal["confidence_ppm"],
        "coordinator_signal": None if signal["coordinator"] is None else signal["coordinator"]["research_signal"],
        "mode": signal["mode"],
        "execution_allowed": signal["execution_allowed"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
