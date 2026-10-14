"""Actual CLI path from a frozen baseline through incremental CSVs and retained evaluations."""

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.acceptance import cli  # noqa: E402
from zoora_sfp.data import canonical, require  # noqa: E402
from zoora_sfp.notebook_reports import history_rows, restore  # noqa: E402


def csv_body(bars):
    return ("\n".join(",".join([str(b["open_ms"] // 1000), b["open"], b["high"], b["low"], b["close"],
                               "100", "2"]) for b in bars) + "\n").encode()


def main():
    source = json.loads((ROOT / "fixtures/study-demo.json").read_bytes())
    with tempfile.TemporaryDirectory(prefix="bt007-acceptance-") as temporary:
        root = Path(temporary)
        initial, plan, notebook = root / "initial.json", root / "plan.json", root / "research.sqlite3"
        baseline = dict(source, bars=source["bars"][:444], captured_ms=source["bars"][443]["available_ms"])
        initial.write_bytes(canonical(baseline))
        cli("prepare-study", "--dataset", initial, "--out", plan)
        opened = cli("notebook-open", "--notebook", notebook, "--dataset", initial, "--plan", plan)
        cli("notebook-open", "--notebook", notebook, "--dataset", initial, "--plan", plan, success=False)
        cli("notebook-evaluate", "--notebook", notebook)
        first_head = cli("notebook-status", "--notebook", notebook)["head_sha256"]
        cli("notebook-evaluate", "--notebook", notebook)
        require(cli("notebook-status", "--notebook", notebook)["head_sha256"] == first_head,
                "DUPLICATE_EVALUATION_APPENDED")
        start = 443
        for end in [809, 1216]:
            raw_csv = root / f"capture-{end}.csv"
            raw_csv.write_bytes(csv_body(source["bars"][start:end]))
            captured = cli("notebook-capture", "--notebook", notebook, "--csv", raw_csv,
                           "--captured-ms", source["bars"][end - 1]["available_ms"])
            cli("notebook-capture", "--notebook", notebook, "--csv", raw_csv,
                "--captured-ms", source["bars"][end - 1]["available_ms"], success=False)
            stale = root / f"stale-{end}"
            cli("notebook-export", "--notebook", notebook, "--out", stale, success=False)
            require(not stale.exists(), "STALE_REPORT_EXPORTED")
            # Rejection must retain the same committed checkpoint.
            require(cli("notebook-status", "--notebook", notebook)["head_sha256"] == captured["head_sha256"],
                    "REJECTED_OPERATION_MUTATED_HISTORY")
            cli("notebook-evaluate", "--notebook", notebook)
            start = end - 1
        status = cli("notebook-status", "--notebook", notebook, "--replay")
        cli("notebook-status", "--notebook", notebook, "--expected-head", opened["head_sha256"], success=False)
        out, again = root / "export", root / "again"
        for folder in [out, again]:
            cli("notebook-export", "--notebook", notebook, "--expected-head", status["head_sha256"], "--out", folder)
        require(all(p.read_bytes() == (again / p.name).read_bytes() for p in out.iterdir()),
                "NONDETERMINISTIC_NOTEBOOK_EXPORT")
        cli("verify", "--report-dir", out, "--expected-head", status["head_sha256"], "--replay")
        state = restore(json.loads((out / "notebook.json").read_bytes()))
        rows = history_rows(state)
        require([r["trials"] for r in rows] == [9, 30, 72] and
                [r["complete_folds"] for r in rows] == [0, 1, 3], "MISSING_INCREMENTAL_EVALUATIONS")
        require(all(r["failed_screens"] == 8 for r in rows), "MISSING_FAILED_SCREENS")
        require(status["events"] == 6 and status["csv_captures"] == 2 and status["evaluations"] == 3 and
                status["evaluation_bars_already_present_at_open"] == 0 and
                status["source_verification"] == "UNAVAILABLE" and status["classification"] == "SYNTHETIC",
                "UNSUPPORTED_HISTORY_CLAIM")
        first_training = [[t for t in e["report"]["trials"] if t["phase"] == "TRAIN" and t["fold"] == 0]
                          for e in state["evaluations"]]
        require(first_training[0] == first_training[1] == first_training[2], "FIRST_TRAINING_HISTORY_CHANGED")
        notebook.unlink()
        cli("verify", "--report-dir", out, "--expected-head", status["head_sha256"], "--replay")
        with (again / "audit.html").open("ab") as stream:
            stream.write(b"TAMPER")
        cli("verify", "--report-dir", again, success=False)
        checks = [
            "actual CLI opens a frozen baseline notebook and refuses replacement",
            "identical evaluations are idempotent and failed screens remain recorded",
            "two overlapping CSV captures retain original bytes and extend one frozen plan",
            "duplicate captures and stale exports are rejected without committing events",
            "three retained evaluations progress through 9, 30 and 72 trials with all screens failing",
            "first training trials remain identical after both history appends",
            "full engine replay and a separately supplied head checkpoint verify the notebook",
            "ten-file exports are byte-identical and verify after the SQLite source is removed",
            "tampered audit HTML fails verification; source/unseen claims remain unverified and money activity zero"]
        require(status["funds_transferred"] == status["tokens_purchased"] == status["tokens_burned"] == "0",
                "NONZERO_ACTIVITY")
        evidence = {"protocol": "ZOORA_BT007_NOTEBOOK_ACCEPTANCE_V1",
                    "source_head_sha": os.environ.get("SOURCE_HEAD_SHA"), "checks": checks,
                    "head_sha256": status["head_sha256"], "plan_sha256": status["plan_sha256"],
                    "evaluations": rows, "status": status, "market_data_verified": False,
                    "independent_unseen_data_verified": False, "strategy_edge_verified": False,
                    "funds_transferred": "0", "tokens_purchased": "0", "tokens_burned": "0"}
        output = ROOT / "evidence-output"
        output.mkdir(exist_ok=True)
        saved = output / "notebook-report"
        saved.mkdir(exist_ok=True)
        for path in out.iterdir():
            shutil.copyfile(path, saved / path.name)
        (output / "notebook-acceptance.json").write_bytes(canonical(evidence) + b"\n")
        cli("verify", "--report-dir", saved, "--expected-head", status["head_sha256"], "--replay")
        print(json.dumps({"notebook_checks": len(checks), "events": 6, "evaluations": 3,
                          "trial_counts": [9, 30, 72], "funds_transferred": "0"}))


if __name__ == "__main__":
    main()
