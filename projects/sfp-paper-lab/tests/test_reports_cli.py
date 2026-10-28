import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from helpers import csv_bytes, dataset, prefix, value

from zoora_sfp.data import Config, ResearchError, canonical, digest
from zoora_sfp.reports import publish, render, run, verify

ROOT = Path(__file__).resolve().parents[1]


class ReportTests(unittest.TestCase):
    def test_deterministic_outputs_and_prefix_source_classification(self):
        ds = dataset(prefix(260))
        a, ar = run(ds)
        b, br = run(ds)
        self.assertEqual(render(a, ar), render(b, br))
        self.assertEqual(a["price_classification"], "SYNTHETIC")
        self.assertEqual(a["execution_model"], "CONSERVATIVE_OHLC_BOUND_NOT_EXECUTABLE_QUOTE")
        self.assertEqual(a["sample_status"], "ENGINE_FIXTURE_NOT_PERFORMANCE_EVIDENCE")
        self.assertEqual(a["funds_transferred"], "0")
        self.assertEqual(a["tokens_burned"], "0")

    def test_labelled_proposal_does_not_approve_allocation_or_burn(self):
        report, _ = run(dataset(prefix(260)), Config(buy_burn_scenario_bps=3000))
        a = next(r for r in report["results"] if r["variant"] == "A")
        self.assertGreater(float(a["buy_burn_scenario"]["buy_burn_budget_quote_units"]), 0)
        self.assertEqual(a["buy_burn_scenario"]["policy_status"], "SIMULATION_PROPOSAL_ONLY")
        self.assertEqual(a["buy_burn_scenario"]["tokens_burned"], "0")

    def test_publish_verify_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            report, results = run(dataset(prefix(260)))
            p = Path(d) / "evidence"
            publish(p, render(report, results))
            self.assertEqual(verify(p)["members_verified"], 5)
            before = (p / "report.json").read_bytes()
            with self.assertRaisesRegex(ResearchError, "OUTPUT_ALREADY_EXISTS"):
                publish(p, render(report, results))
            self.assertEqual(before, (p / "report.json").read_bytes())

    def test_each_output_is_bound_to_manifest(self):
        for name in ["signals.csv", "trades.csv", "equity.csv", "COMMUNITY_UPDATE.md"]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as d:
                report, results = run(dataset(prefix(260)))
                p = Path(d) / "evidence"
                publish(p, render(report, results))
                with (p / name).open("ab") as f:
                    f.write(b"tampered")
                with self.assertRaisesRegex(ResearchError, "EVIDENCE_HASH"):
                    verify(p)

    def test_manifest_tamper_and_unexpected_member_are_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            report, results = run(dataset(prefix(260)))
            p = Path(d) / "evidence"
            publish(p, render(report, results))
            (p / "extra").write_text("unexpected")
            with self.assertRaises(ResearchError):
                verify(p)
            (p / "extra").unlink()
            m = json.loads((p / "manifest.json").read_text())
            m["run_id"] = "f" * 64
            (p / "manifest.json").write_text(json.dumps(m))
            with self.assertRaises(ResearchError):
                verify(p)

    def test_rehashed_false_financial_claims_and_invalid_accounting_are_rejected(self):
        report, results = run(dataset(prefix(260)), Config(buy_burn_scenario_bps=3000))
        cases = ["root_burn", "budget_burn", "nonfinite_nav", "false_budget", "identity"]
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as d:
                p = Path(d) / "evidence"
                publish(p, render(report, results))
                altered = json.loads((p / "report.json").read_bytes())
                if case == "root_burn":
                    altered["tokens_burned"] = "1"
                elif case == "budget_burn":
                    altered["results"][0]["buy_burn_scenario"]["tokens_burned"] = "1"
                elif case == "nonfinite_nav":
                    altered["results"][0]["ending_marked_nav"] = "NaN"
                elif case == "false_budget":
                    altered["results"][0]["buy_burn_scenario"]["buy_burn_budget_quote_units"] = "999"
                else:
                    altered["dataset_sha256"] = "f" * 64
                raw = canonical(altered) + b"\n"
                (p / "report.json").write_bytes(raw)
                manifest = json.loads((p / "manifest.json").read_bytes())
                manifest["members"]["report.json"] = {
                    "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
                manifest.pop("manifest_sha256")
                manifest["manifest_sha256"] = digest(manifest)
                (p / "manifest.json").write_bytes(canonical(manifest) + b"\n")
                with self.assertRaises(ResearchError):
                    verify(p)

    def test_export_error_cleans_only_own_reserved_directory(self):
        with tempfile.TemporaryDirectory() as d:
            report, results = run(dataset(prefix(260)))
            p = Path(d) / "evidence"
            with (patch("zoora_sfp.reports.os.open", side_effect=OSError("SYNTHETIC disk failure")),
                  self.assertRaises(OSError)):
                publish(p, render(report, results))
            self.assertFalse(p.exists())

    def test_unknown_source_commit_cannot_be_reported_as_verified(self):
        report, _ = run(dataset(prefix(260)), source_head="a" * 40)
        self.assertEqual(report["source_head_status"], "DECLARED_NOT_ATTESTED")
        self.assertEqual(report["source_verification"], "UNAVAILABLE")
        with self.assertRaises(ResearchError):
            run(dataset(prefix(260)), source_head="not-a-sha")


class CLITests(unittest.TestCase):
    def call(self, *args, optimized=False):
        command = [sys.executable, "-bb", "-X", "dev", "-W", "error"]
        if optimized:
            command.append("-O")
        return subprocess.run([*command, "-m", "zoora_sfp", *args], cwd=ROOT,
                              capture_output=True, text=True, timeout=30, check=False,
                              env={k: v for k, v in os.environ.items() if k != "SOURCE_HEAD_SHA"})

    def test_actual_cli_run_verify_and_existing_output(self):
        with tempfile.TemporaryDirectory() as d:
            out = str(Path(d) / "out")
            r = self.call("run", "--dataset", "fixtures/demo.json", "--out", out)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(json.loads(r.stdout)["tokens_burned"], "0")
            r = self.call("verify", "--report-dir", out)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(json.loads(r.stdout)["members_verified"], 5)
            before = (Path(out) / "report.json").read_bytes()
            r = self.call("run", "--dataset", "fixtures/demo.json", "--out", out)
            self.assertEqual(r.returncode, 2)
            self.assertEqual(before, (Path(out) / "report.json").read_bytes())

    def test_optimized_validation_cannot_be_disabled(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "invalid.json"
            v = value()
            v["bars"][0]["low"] = "900"
            p.write_bytes(canonical(v))
            out = Path(d) / "out"
            r = self.call("run", "--dataset", str(p), "--out", str(out), optimized=True)
            self.assertEqual(r.returncode, 2)
            self.assertIn("INVALID_OHLC", r.stderr)
            self.assertFalse(out.exists())

    def test_actual_csv_import_is_offline_and_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            v = prefix(60)
            raw = Path(d) / "source.csv"
            raw.write_bytes(csv_bytes(v))
            out = Path(d) / "dataset.json"
            args = ["import-csv", "--csv", str(raw), "--base", "SOL", "--quote", "USDC",
                    "--venue", "KRAKEN", "--source-id", "USER-supplied",
                    "--classification", "SOURCE_ASSERTED_OBSERVATIONS",
                    "--captured-ms", str(v["captured_ms"]), "--out", str(out)]
            r = self.call(*args)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(json.loads(r.stdout)["source_verification"], "UNAVAILABLE")
            before = out.read_bytes()
            self.assertEqual(self.call(*args).returncode, 2)
            self.assertEqual(out.read_bytes(), before)

    def test_live_trade_sign_and_burn_commands_absent(self):
        for command in ["trade", "sign", "buy", "burn", "send", "serve"]:
            with self.subTest(command=command):
                self.assertNotEqual(self.call(command).returncode, 0)


if __name__ == "__main__":
    unittest.main()
