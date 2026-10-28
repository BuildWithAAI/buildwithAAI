"""Exercise SYNTHETIC shared-snapshot scenarios through the actual JSONL coordinator."""

from dataclasses import asdict
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from multi_brain_research.consensus import ObservationRound  # noqa: E402
from multi_brain_research.consensus_fixture import (events_for_scenarios, pair, snapshot,
                                                  receipt, unavailable_policy)  # noqa: E402
from multi_brain_research.consensus_stream import parse_policy, replay_stream  # noqa: E402
from multi_brain_research.graph import canonical  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    config, events, expected = events_for_scenarios()
    config_bytes = canonical(asdict(config)) + b"\n"
    event_bytes = b"".join(canonical(event) + b"\n" for event in events)
    (args.output / "policy.json").write_bytes(config_bytes)
    (args.output / "events.jsonl").write_bytes(event_bytes)
    target = args.output / "audit.jsonl"
    subprocess.run([sys.executable, str(ROOT / "scripts/replay_brain_consensus.py"),
                    "--policy", str(args.output / "policy.json"), "--events", str(args.output / "events.jsonl"),
                    "--output", str(target)], check=True, capture_output=True)
    # Reparse the retained wire format and replay it independently from the CLI process.
    independently_replayed = io.BytesIO()
    summary = replay_stream(parse_policy(config_bytes), io.BytesIO(event_bytes), independently_replayed)
    if independently_replayed.getvalue() != target.read_bytes():
        raise ValueError("independent stream replay differs")
    records = [json.loads(line)["record"] for line in target.read_bytes().splitlines()
               if json.loads(line)["event"] == "FINALIZED"]
    measured = [{"round_id": record["round_id"], "research_signal": record["research_signal"]} for record in records]
    if measured != [{key: row[key] for key in ("round_id", "research_signal")} for row in expected]:
        raise ValueError("scenario outcome differs from specified expectation")
    blocked = unavailable_policy()
    observation = snapshot(blocked)
    blocked_round = ObservationRound(blocked, pair(), observation)
    for module in blocked.modules[:3]:
        blocked_round.submit(receipt(module, observation, blocked))
    unavailable = blocked_round.finalize(1002)
    if unavailable["research_signal"] != "ABSTAIN":
        raise ValueError("missing encoder did not block")
    (args.output / "missing-encoder.json").write_bytes(canonical(unavailable) + b"\n")
    if any(record["execution_allowed"] or record["action"] != "NO_EXECUTION" for record in [*records, unavailable]):
        raise ValueError("unexpected execution permission")
    report = {"classification": "SYNTHETIC_SOFTWARE_TEST_ONLY", "scenarios": expected + [
        {"scenario": "missing_encoder", "round_id": unavailable["round_id"], "research_signal": "ABSTAIN"}],
        "replay": summary, "independent_replay_bytes_equal": True,
        "code_commit": subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip(),
        "artifact_sha256": {name: hashlib.sha256((args.output / name).read_bytes()).hexdigest()
                            for name in ("policy.json", "events.jsonl", "audit.jsonl", "missing-encoder.json")},
        "market_validation": "NOT_ESTABLISHED", "action": "NO_EXECUTION", "execution_allowed": False}
    (args.output / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"classification": report["classification"], "scenarios": len(report["scenarios"]),
                      "independent_replay_bytes_equal": True, "action": "NO_EXECUTION"}, sort_keys=True))


if __name__ == "__main__":
    main()
