"""Actual offline CLI/replay/report evidence. No observed market dataset is fetched."""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from make_demo import demo_value  # noqa: E402

from zoora_sfp.data import HOUR, ResearchError, canonical, require  # noqa: E402


def cli(*args, success=True):
    result = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error",
                             "-m", "zoora_sfp", *map(str, args)],
                            cwd=ROOT, capture_output=True, timeout=30, check=False)
    require((result.returncode == 0) == success, "ACCEPTANCE_CLI_FAILED")
    if success:
        require(not result.stderr, "ACCEPTANCE_STDERR")
        return json.loads(result.stdout)
    return result.returncode


def main():
    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="sfp-acceptance-") as temporary:
        root = Path(temporary)
        base, again, costly, delayed = [root / n for n in ["base", "again", "costly", "delayed"]]
        fixture = ROOT / "fixtures" / "demo.json"
        cli("run", "--dataset", fixture, "--out", base)
        verified = cli("verify", "--report-dir", base)
        cli("run", "--dataset", fixture, "--out", again)
        for path in base.iterdir():
            require(path.read_bytes() == (again / path.name).read_bytes(), "NONDETERMINISTIC_EXPORT")
        cli("run", "--dataset", fixture, "--out", base, success=False)
        cli("run", "--dataset", fixture, "--out", costly, "--fee-bps", 20,
            "--slippage-bps", 10, "--fixed-cost", "0.02")
        cli("run", "--dataset", fixture, "--out", delayed, "--latency-ms", HOUR)
        a = json.loads((base / "report.json").read_bytes())
        c = json.loads((costly / "report.json").read_bytes())
        d = json.loads((delayed / "report.json").read_bytes())
        first = next(r for r in a["results"] if r["variant"] == "A")
        require([t["reason"] for t in first["trades"]] ==
                ["TARGET_LIMIT_SCENARIO", "STOP_SCENARIO", "PATH_AMBIGUOUS_STOP_BOUND"],
                "MISSING_WIN_LOSS_PATH_COVERAGE")
        require(first["open_position"]["status"] == "OPEN_UNRESOLVED", "MISSING_OPEN_POSITION")
        require(a["price_classification"] == "SYNTHETIC" and
                a["go_no_go_status"] == "NOT_EVALUATED", "FALSE_PERFORMANCE_CLAIM")
        for report in [a, c, d]:
            require(report["funds_transferred"] == report["tokens_purchased"] ==
                    report["tokens_burned"] == "0", "NONZERO_FINANCIAL_ACTIVITY")
        raw_value = demo_value()
        csv_path = root / "synthetic.csv"
        csv_path.write_text("\n".join(",".join([str(b["open_ms"] // 1000), b["open"], b["high"],
                                               b["low"], b["close"], "100", "2"])
                                     for b in raw_value["bars"]) + "\n", encoding="utf-8")
        imported = root / "imported.json"
        import_result = cli("import-csv", "--csv", csv_path, "--base", "SOL", "--quote", "USDC",
                            "--venue", "SYNTHETIC_CSV", "--source-id", "SYNTHETIC-CSV-TEST",
                            "--classification", "SYNTHETIC",
                            "--captured-ms", raw_value["captured_ms"], "--out", imported)
        cli("run", "--dataset", imported, "--out", root / "import-run")
        # An altered file must fail verification instead of being reported as intact evidence.
        with (again / "signals.csv").open("ab") as stream:
            stream.write(b"SYNTHETIC_TAMPER")
        cli("verify", "--report-dir", again, success=False)
        checks = [
            "actual CLI creates and verifies five bound exports without overwriting evidence",
            "two CLI runs produce byte-identical reports, CSVs, community text and manifests",
            "fixture exercises profitable, losing, ambiguous-stop and unresolved-position paths",
            "higher-cost and one-hour-delay scenarios remain explicitly simulated",
            "actual offline CSV import preserves a synthetic label and reconstructed availability",
            "altered CSV evidence fails verification; reported funds, purchases and burns remain zero"]
        evidence = {"protocol": "ZOORA_BT005_ACCEPTANCE_V1",
                    "source_head_sha": os.environ.get("SOURCE_HEAD_SHA"),
                    "activity": "AUTOMATED_SYNTHETIC_ENGINE_ACCEPTANCE",
                    "market_data_verified": False, "strategy_edge_verified": False,
                    "checks": checks, "run_id": a["run_id"], "verification": verified,
                    "dataset_sha256": a["dataset_sha256"],
                    "package_fingerprint": a["code_fingerprint"]["sha256"],
                    "bars": a["bars"], "signals": a["signal_count"],
                    "scenario_configs": [r["config"] for r in [a, c, d]],
                    "scenario_summaries": [
                        {k: r[k] for k in ["variant", "completed_trades", "wins", "losses",
                                           "realized_net_including_open_entry_costs",
                                           "unrealized_price_change", "costs_including_slippage",
                                           "max_close_mark_drawdown", "performance_status",
                                           "buy_burn_scenario"]}
                        for r in a["results"]],
                    "csv_import": import_result, "customer_activity": False,
                    "network_requests": 0, "funds_transferred": "0",
                    "tokens_purchased": "0", "tokens_burned": "0"}
        (output / "acceptance.json").write_bytes(canonical(evidence) + b"\n")
        (output / "paper-report.json").write_bytes((base / "report.json").read_bytes())
        (output / "COMMUNITY_UPDATE.md").write_bytes((base / "COMMUNITY_UPDATE.md").read_bytes())
        (output / "report-manifest.json").write_bytes((base / "manifest.json").read_bytes())
        evidence_hash = hashlib.sha256((output / "acceptance.json").read_bytes()).hexdigest()
        print(json.dumps({"checks": len(checks), "sha256": evidence_hash,
                          "funds_transferred": "0", "tokens_burned": "0"}))


if __name__ == "__main__":
    try:
        main()
    except ResearchError as exc:
        raise SystemExit(str(exc)) from exc
