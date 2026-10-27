"""Explicit read-only network pilot; offline CI never runs this script."""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from zoora_sfp.data import ResearchError, canonical, require  # noqa: E402
from zoora_sfp.source_reports import verify_source  # noqa: E402

PROFILE = "RECENT_SOLUSD_RETROSPECTIVE_1F_96H_V1"


def invoke(*args):
    completed = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_sfp",
                                *map(str, args)], cwd=ROOT, capture_output=True, timeout=60, check=False)
    try:
        result = json.loads(completed.stdout if completed.returncode == 0 else completed.stderr)
    except (ValueError, UnicodeError) as exc:
        raise ResearchError("PUBLIC_PILOT_CLI_INVALID_RESPONSE") from exc
    require(isinstance(result, dict), "PUBLIC_PILOT_CLI_INVALID_RESPONSE")
    require(completed.returncode == 0, result.get("error", "PUBLIC_PILOT_CLI_FAILED"))
    return result


def main():
    parser = argparse.ArgumentParser(description="Two public GET requests, then one explicit retrospective research plan.")
    parser.add_argument("--out", required=True)
    parser.add_argument("--profile", required=True, choices=[PROFILE])
    args = parser.parse_args()
    root = Path(args.out).absolute()
    status = {"protocol": "ZOORA_BT008_PUBLIC_SOURCE_PILOT_V1", "profile": args.profile,
              "source_head_sha": os.environ.get("SOURCE_HEAD_SHA"), "classification": "SOURCE_ASSERTED_OBSERVATIONS",
              "status": "BLOCKED_NOT_COMPLETED", "market_truth_verified": False, "unseen_data_verified": False,
              "readiness": "BLOCKED_NOT_A_FUNDED_STRATEGY", "funds_transferred": "0",
              "tokens_purchased": "0", "tokens_burned": "0"}
    try:
        require(not root.exists(), "OUTPUT_ALREADY_EXISTS")
        root.mkdir(mode=0o700)
    except (OSError, ResearchError):
        print(json.dumps({"error": "PUBLIC_PILOT_OUTPUT_UNAVAILABLE"}), file=sys.stderr)
        return 2
    try:
        capture = invoke("capture-kraken", "--out", root / "source")
        source = verify_source(root / "source")
        status["quality"] = capture["quality"]
        require(not source["quality"]["flags"], "PUBLIC_PILOT_SOURCE_QUALITY_BLOCKED")
        # These settings are fixed by PROFILE, never selected using the resulting returns.
        invoke("prepare-study", "--dataset", root / "source/dataset.json", "--test-hours", 96,
               "--folds", 1, "--out", root / "plan.json")
        invoke("notebook-open-source", "--notebook", root / "research.sqlite3", "--source-dir", root / "source",
               "--plan", root / "plan.json")
        evaluated = invoke("notebook-evaluate", "--notebook", root / "research.sqlite3")
        invoke("notebook-export", "--notebook", root / "research.sqlite3", "--out", root / "report")
        invoke("verify", "--report-dir", root / "report", "--replay")
        report = json.loads((root / "report/study.json").read_bytes())
        require(all(f["test_coverage"]["status"] == "COMPLETE" for f in report["folds"]),
                "PUBLIC_PILOT_EVALUATION_COVERAGE_INCOMPLETE")
        status.update(status="COMPLETED_RETROSPECTIVE_PROVIDER_REPORTED_PILOT", run_id=evaluated["run_id"],
                      trials=evaluated["trials"], summary=report["summary"])
        code = 0
    except (ResearchError, OSError, subprocess.TimeoutExpired) as exc:
        status["error"] = str(exc) if isinstance(exc, ResearchError) else "PUBLIC_PILOT_LOCAL_OR_TIMEOUT_FAILURE"
        code = 2
    (root / "PILOT_STATUS.json").write_bytes(canonical(status) + b"\n")
    print(json.dumps({k: v for k, v in status.items() if k not in {"quality", "summary"}}))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
