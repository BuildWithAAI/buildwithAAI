"""Read curriculum, assess public practice or replay a paper-only teaching lab."""
import argparse
import json
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from multi_brain_research.contracts import ContractError
from multi_brain_research.education import (
    Curriculum,
    Learner,
    SchoolObservationRound,
    assess,
    exact_fields,
    parse_attempt,
    parse_json,
    require,
    verify_assessment,
)
from multi_brain_research.graph import canonical
from multi_brain_research.paper_school import (
    PaperDecision,
    PaperMarket,
    PaperPolicy,
    Quote,
    replay_paper,
)


def read(path):
    with Path(path).open("rb") as stream:
        return parse_json(stream.read(1_048_577))


def save(path, value):
    # Exclusive publication: an existing artifact or symlink is never replaced.
    payload = canonical(value) + b"\n"
    with Path(path).open("xb") as stream:
        stream.write(payload)


def parse_paper(value):
    exact_fields(value, ("schema_version", "attempt", "market", "policy", "quotes", "decisions"))
    require(type(value["schema_version"]) is int and value["schema_version"] == 1, "UNSUPPORTED_PAPER_SCHEMA")
    for name, model in (("market", PaperMarket), ("policy", PaperPolicy)):
        exact_fields(value[name], model.__dataclass_fields__)
    for name, model, maximum in (("quotes", Quote, 5000), ("decisions", PaperDecision, 1000)):
        require(type(value[name]) is list and 1 <= len(value[name]) <= maximum, "INVALID_PAPER_BOUND")
        for row in value[name]:
            exact_fields(row, model.__dataclass_fields__)
    return (parse_attempt(value["attempt"]), PaperMarket(**value["market"]), PaperPolicy(**value["policy"]),
            tuple(Quote(**quote) for quote in value["quotes"]),
            tuple(PaperDecision(**decision) for decision in value["decisions"]))


def demo(curriculum, folder):
    from multi_brain_research.consensus_fixture import pair, policy, receipt, snapshot
    from multi_brain_research.school_fixture import paper_fixture, synthetic_attempt

    folder.mkdir(parents=True, exist_ok=False)
    save(folder / "curriculum.json", curriculum.data())
    records = {}
    for track in curriculum.data()["tracks"]:
        attempt = synthetic_attempt(curriculum, track=track["track_id"])
        report = assess(curriculum, attempt, attempt.completed_ms)
        require(not report["live_execution_allowed"], "UNEXPECTED_EXECUTION_PERMISSION")
        records[track["track_id"]] = report
        save(folder / (track["track_id"] + "-practice.json"), {"attempt": asdict(attempt), "assessment": report})
    _, attempt, market, config, quotes, decisions = paper_fixture(curriculum)
    wire = {"schema_version": 1, "attempt": asdict(attempt), "market": asdict(market), "policy": asdict(config),
            "quotes": [asdict(quote) for quote in quotes], "decisions": [asdict(decision) for decision in decisions]}
    save(folder / "paper-input.json", wire)
    paper = replay_paper(curriculum, *parse_paper(parse_json(canonical(wire))))
    save(folder / "paper-in-process.json", paper)
    command = [sys.executable, str(Path(__file__).resolve()), "--curriculum", str(folder / "curriculum.json"),
               "paper", "--input", str(folder / "paper-input.json"), "--output", str(folder / "paper-cli.json")]
    subprocess.run(command, check=True, capture_output=True, timeout=30)
    require((folder / "paper-cli.json").read_bytes() == (folder / "paper-in-process.json").read_bytes(), "CLI_REPLAY_MISMATCH")
    # Independent fixture accounting: gross 900, commissions 213 and gas 10.
    require(paper["ending_cash"] == 1_000_677 and paper["net_marked_pnl"] == 677
            and paper["paid_fees"] == 213 and paper["paid_gas_quote"] == 10, "FIXTURE_ACCOUNTING_MISMATCH")
    coordinator_policy = policy()
    at = attempt.completed_ms + 100
    observation = snapshot(coordinator_policy, at=at)
    attempts = tuple(synthetic_attempt(curriculum, Learner(module.module_id, module.pipeline_sha256(), module.calibration_sha256), at=at - 10)
                     for module in coordinator_policy.modules)
    educated = SchoolObservationRound(coordinator_policy, pair(), observation, curriculum, attempts)
    for module in coordinator_policy.modules:
        educated.submit(receipt(module, observation, coordinator_policy))
    coordinated = educated.finalize(at + 2)
    require(not coordinated["live_execution_allowed"], "UNEXPECTED_EXECUTION_PERMISSION")
    save(folder / "educated-research-round.json", coordinated)
    report = {"classification": "SYNTHETIC_SOFTWARE_TEST_ONLY", "model_training": "NOT_PERFORMED",
              "curriculum_sha256": curriculum.sha256(), "tracks": len(records), "lessons": len(curriculum.data()["lessons"]),
              "practice_cases": len(curriculum.data()["cases"]), "cli_and_in_process_bytes_identical": True,
              "fixture_net_pnl": paper["net_marked_pnl"], "forecast_quality": "NOT_ESTABLISHED",
              "rh_blocked": not records["rh_unresolved"]["paper_lab_allowed"], "xauusd_blocked": not records["xauusd"]["paper_lab_allowed"],
              "action": "NO_EXECUTION", "live_execution_allowed": False}
    save(folder / "report.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--curriculum", type=Path, default=ROOT / "research/trading-school/curriculum.json")
    commands = parser.add_subparsers(dest="command", required=True)
    study = commands.add_parser("study")
    study.add_argument("--track", required=True)
    study.add_argument("--output", type=Path, required=True)
    practice = commands.add_parser("assess")
    practice.add_argument("--attempt", type=Path, required=True)
    practice.add_argument("--now-ms", type=int, required=True)
    practice.add_argument("--output", type=Path, required=True)
    verify = commands.add_parser("verify-assessment")
    verify.add_argument("--attempt", type=Path, required=True)
    verify.add_argument("--record", type=Path, required=True)
    verify.add_argument("--now-ms", type=int, required=True)
    verify.add_argument("--output", type=Path, required=True)
    for name in ("paper", "verify-paper"):
        paper = commands.add_parser(name)
        paper.add_argument("--input", type=Path, required=True)
        paper.add_argument("--output", type=Path, required=True)
        if name == "verify-paper":
            paper.add_argument("--record", type=Path, required=True)
    synthetic = commands.add_parser("demo")
    synthetic.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        curriculum = Curriculum.load(args.curriculum)
        if args.command == "study":
            track = curriculum.track(args.track)
            data = curriculum.data()
            result = {"assessment_scope": "PUBLIC_PRACTICE_ONLY", "curriculum_sha256": curriculum.sha256(), "track": track,
                      "lessons": [next(row for row in data["lessons"] if row["lesson_id"] == key) for key in track["lessons"]],
                      "practice_cases": [{key: value for key, value in row.items() if key != "expected"}
                                         for row in curriculum.cases(args.track)],
                      "sources": data["sources"], "live_execution_allowed": False}
        elif args.command in ("assess", "verify-assessment"):
            attempt = parse_attempt(read(args.attempt))
            result = (assess(curriculum, attempt, args.now_ms) if args.command == "assess"
                      else verify_assessment(curriculum, attempt, read(args.record), args.now_ms))
        elif args.command in ("paper", "verify-paper"):
            result = replay_paper(curriculum, *parse_paper(read(args.input)))
            if args.command == "verify-paper":
                require(canonical(result) == canonical(read(args.record)), "PAPER_RECORD_MISMATCH")
        else:
            result = demo(curriculum, args.output)
        if args.command != "demo":
            save(args.output, result)
        print(json.dumps({"status": "RECORDED", "action": "NO_EXECUTION", "live_execution_allowed": False}, sort_keys=True))
    except (ContractError, OSError, ValueError, TypeError, subprocess.SubprocessError) as error:
        code = str(error) if type(error) is ContractError else "INPUT_OR_OUTPUT_REFUSED"
        print(json.dumps({"error": code, "action": "NO_EXECUTION"}, sort_keys=True), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
