"""Offline actual-CLI acceptance of raw provider input and source-preserving notebooks."""

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.acceptance import cli  # noqa: E402
from scripts.make_study_demo import study_demo  # noqa: E402
from zoora_sfp.data import HOUR, canonical, require  # noqa: E402
from zoora_sfp.notebook_reports import restore  # noqa: E402


def fixtures(end):
    bars = study_demo()["bars"][:end]
    pair = {"error": [], "result": {"SOL/USD": {"base": "SOL", "quote": "USD", "altname": "SOLUSD",
            "wsname": "SOL/USD", "aclass_base": "currency", "aclass_quote": "currency", "status": "online"}}}
    rows = [[b["open_ms"] // 1000, b["open"], b["high"], b["low"], b["close"], b["close"], "100", 2]
            for b in bars]
    return pair, {"error": [], "result": {"SOL/USD": rows, "last": rows[-1][0]}}, bars[-1]["open_ms"] + HOUR // 2


def main():
    with tempfile.TemporaryDirectory(prefix="bt008-acceptance-") as temporary:
        root = Path(temporary)
        for end in [445, 721]:
            pair, ohlc, stamp = fixtures(end)
            pair_path, ohlc_path = root / "pair.json", root / f"ohlc-{end}.json"
            pair_path.write_bytes(canonical(pair))
            ohlc_path.write_bytes(canonical(ohlc))
            source = root / f"source-{end}"
            cli("import-kraken", "--pair-response", pair_path, "--ohlc-response", ohlc_path,
                "--captured-ms", stamp, "--classification", "SYNTHETIC", "--out", source)
            cli("verify", "--report-dir", source)
        initial, complete = root / "source-445", root / "source-721"
        plan, notebook = root / "plan.json", root / "research.sqlite3"
        cli("prepare-study", "--dataset", initial / "dataset.json", "--test-hours", 96, "--folds", 1, "--out", plan)
        cli("notebook-open-source", "--notebook", notebook, "--source-dir", initial, "--plan", plan)
        cli("notebook-evaluate", "--notebook", notebook)
        first_head = cli("notebook-status", "--notebook", notebook)["head_sha256"]
        cli("notebook-capture-source", "--notebook", notebook, "--source-dir", complete, "--expected-head", first_head)
        cli("notebook-capture-source", "--notebook", notebook, "--source-dir", complete, success=False)
        cli("notebook-export", "--notebook", notebook, "--out", root / "stale", success=False)
        cli("notebook-evaluate", "--notebook", notebook)
        status = cli("notebook-status", "--notebook", notebook, "--replay")
        out = root / "notebook-report"
        cli("notebook-export", "--notebook", notebook, "--out", out)
        cli("verify", "--report-dir", out, "--expected-head", status["head_sha256"], "--replay")
        state = restore(json.loads((out / "notebook.json").read_bytes()))
        require([len(e["report"]["trials"]) for e in state["evaluations"]] == [3, 24], "SOURCE_TRIAL_MATRIX")
        require(state["events"][0]["kind"] == "OPEN_SOURCE" and state["events"][2]["kind"] == "CAPTURE_SOURCE" and
                status["provider_response_events"] == 2, "RAW_PROVIDER_INPUTS_NOT_RETAINED")
        require(all(s["numeric_screen"] == "FAIL" for e in state["evaluations"] for s in e["report"]["summary"]),
                "FALSE_STRATEGY_ACCEPTANCE")
        q = json.loads((complete / "quality.json").read_bytes())
        require(q["bars"] == 720 and q["uncommitted_final_rows_excluded"] == 1 and
                q["provider_contract_warnings"] == ["OBSERVED_721_ROWS_VS_DOCUMENTED_720_LIMIT"] and
                q["classification"] == "SYNTHETIC" and q["transport"] == "LOCAL_FILE_IMPORT_NOT_WITNESSED",
                "FALSE_SOURCE_CLAIM")
        with (complete / "ohlc-response.json").open("ab") as stream:
            stream.write(b"edited")
        cli("verify", "--report-dir", complete, success=False)
        # Restore the original raw bytes for the complete evidence export.
        original = json.loads((complete / "capture.json").read_bytes())
        import base64
        (complete / "ohlc-response.json").write_bytes(base64.b64decode(original["ohlc_base64"]))
        cli("verify", "--report-dir", complete)
        notebook.unlink()
        cli("verify", "--report-dir", out, "--replay")
        checks = [
            "actual CLI imports two explicitly synthetic raw-response bundles and verifies exact mappings",
            "fixed SOL/USD spot identity, closed-only rows and the 721-vs-720 warning remain visible",
            "explicit one-fold 96-hour profile freezes before running the recorded evaluation",
            "source notebook retains original pair/OHLC inputs through open and append events",
            "pending and completed evaluations retain 3 and 24 trials with all failed screens",
            "duplicate source captures and stale exports fail without removing earlier results",
            "saved checkpoints and matching-engine full replay validate the complete portable notebook",
            "altered raw responses fail verification and export works after SQLite removal"]
        evidence = {"protocol": "ZOORA_BT008_PROVIDER_ACCEPTANCE_V1",
                    "source_head_sha": os.environ.get("SOURCE_HEAD_SHA"), "checks": checks,
                    "classification": "SYNTHETIC", "public_requests_made": 0,
                    "head_sha256": status["head_sha256"], "trial_counts": [3, 24],
                    "provider_response_events": 2, "source_truth_verified": False,
                    "funds_transferred": "0", "tokens_purchased": "0", "tokens_burned": "0"}
        output = ROOT / "evidence-output"
        output.mkdir(exist_ok=True)
        for source, name in [(initial, "provider-initial"), (complete, "provider-source"), (out, "provider-notebook")]:
            saved = output / name
            saved.mkdir(exist_ok=True)
            for path in source.iterdir():
                shutil.copyfile(path, saved / path.name)
        (output / "provider-acceptance.json").write_bytes(canonical(evidence) + b"\n")
        print(json.dumps({"provider_checks": len(checks), "trial_counts": [3, 24],
                          "public_requests_made": 0, "funds_transferred": "0"}))


if __name__ == "__main__":
    main()
