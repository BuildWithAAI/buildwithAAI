"""Real CLI workflow for local freeze, incremental history and complete study exports."""

import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.acceptance import cli  # noqa: E402
from zoora_sfp.data import canonical, decode, require  # noqa: E402


def main():
    with tempfile.TemporaryDirectory(prefix="bt006-acceptance-") as temporary:
        folder = Path(temporary)
        plan = folder / "plan.json"
        dataset = ROOT / "fixtures/study-demo.json"
        cli("prepare-study", "--dataset", dataset, "--out", plan)
        require(canonical(decode(plan.read_bytes())) ==
                canonical(decode((ROOT / "fixtures/study-plan.json").read_bytes())), "PLAN_FIXTURE_MISMATCH")
        before = plan.read_bytes()
        cli("prepare-study", "--dataset", dataset, "--out", plan, success=False)
        require(plan.read_bytes() == before, "PLAN_OVERWRITTEN")
        a, b = folder / "a", folder / "b"
        for out in [a, b]:
            cli("study", "--dataset", dataset, "--plan", plan, "--out", out)
            cli("verify", "--report-dir", out)
        for path in a.iterdir():
            require(path.read_bytes() == (b / path.name).read_bytes(), "NONDETERMINISTIC_STUDY_EXPORT")
        report = json.loads((a / "study.json").read_bytes())
        require(len(report["folds"]) == 3 and len(report["trials"]) == 72, "INCOMPLETE_TRIAL_MATRIX")
        require(all(s["numeric_screen"] == "FAIL" for s in report["summary"]), "FALSE_SYNTHETIC_ACCEPTANCE")
        require(report["readiness"] == "BLOCKED_NOT_A_FUNDED_STRATEGY", "UNSUPPORTED_READINESS")
        source = json.loads(dataset.read_bytes())
        source["bars"] = source["bars"][:444]
        source["captured_ms"] = source["bars"][-1]["available_ms"]
        source["source_sha256"] = hashlib.sha256(canonical(source["bars"])).hexdigest()
        early = folder / "early.json"
        early.write_bytes(canonical(source))
        partial = folder / "partial"
        cli("study", "--dataset", early, "--plan", plan, "--out", partial)
        cli("verify", "--report-dir", partial)
        early_report = json.loads((partial / "study.json").read_bytes())
        require(all(s["evaluated_folds"] == 0 for s in early_report["summary"]), "FUTURE_ROWS_INVENTED")
        require(early_report["folds"][0]["selected_variant"] == report["folds"][0]["selected_variant"],
                "FUTURE_PRICES_CHANGED_TRAINING_SELECTION")
        with (b / "study.html").open("ab") as stream:
            stream.write(b"SYNTHETIC_TAMPER")
        cli("verify", "--report-dir", b, success=False)
        for result in [report, early_report]:
            require(result["price_classification"] == "SYNTHETIC" and
                    result["funds_transferred"] == result["tokens_purchased"] == result["tokens_burned"] == "0",
                    "UNSUPPORTED_FINANCIAL_ACTIVITY")
        checks = ["actual CLI freezes a plan identical to the fixture and refuses replacement",
                  "actual CLI evaluates and verifies the complete seven-file study export",
                  "two actual study runs are byte-identical within the same source checkout",
                  "three folds retain 72 training/control/cost/delay trials with failed screens visible",
                  "earlier history leaves evaluation pending without changing first training selection",
                  "altered portable HTML fails manifest verification",
                  "synthetic source, blocked funded readiness and zero financial activity remain explicit"]
        evidence = {"protocol": "ZOORA_BT006_STUDY_ACCEPTANCE_V1", "source_head_sha": os.environ.get("SOURCE_HEAD_SHA"),
                    "run_id": report["run_id"], "plan_sha256": report["plan_sha256"],
                    "code_fingerprint": report["code_sha256"], "checks": checks,
                    "folds": 3, "trials": 72, "incremental_history_verified": True,
                    "market_data_verified": False, "strategy_edge_verified": False,
                    "funds_transferred": "0", "tokens_purchased": "0", "tokens_burned": "0"}
        output = ROOT / "evidence-output"
        output.mkdir(exist_ok=True)
        saved = output / "study-report"
        saved.mkdir(exist_ok=True)
        for path in a.iterdir():
            (saved / path.name).write_bytes(path.read_bytes())
        cli("verify", "--report-dir", saved)
        raw = canonical(evidence) + b"\n"
        (output / "study-acceptance.json").write_bytes(raw)
        print(json.dumps({"study_checks": len(checks), "folds": 3, "trials": 72,
                          "sha256": hashlib.sha256(raw).hexdigest(), "funds_transferred": "0"}))


if __name__ == "__main__":
    main()
