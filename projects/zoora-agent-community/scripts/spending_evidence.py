"""Actual normal/optimized CLI, retained reference and separate accounting audit."""

import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from zoora_community.spending import ASSET, DOMAIN, NETWORK  # noqa: E402
from zoora_community.validation import canonical  # noqa: E402
import hashlib  # noqa: E402


def inspect(report):
    """Recompute accounting from retained states, without AuthorityBook/run/replay."""
    policy = report["input"]["policy"]
    states = [event["state"] for event in report["events"]] + [report["final_state"]]
    for state in states:
        records = state["payments"]
        identities = [(r["quote"]["payee"], r["quote"]["invoice_id"]) for r in records]
        if len(set(identities)) != len(identities):
            raise AssertionError("Duplicate invoice")
        spent = fees = principal_held = fees_held = 0
        for record in records:
            q = record["quote"]
            if q["network"] != NETWORK or q["asset"] != ASSET or q["payer"] not in policy["agents"]:
                raise AssertionError("Unexpected admitted binding")
            if q["payee"] not in policy["payees"] or q["purpose"] not in policy["purposes"] or q["amount"] > policy["payment_limit"]:
                raise AssertionError("Payment outside mandate")
            if record["state"] == "SETTLED":
                spent += q["amount"]
            if record["state"] in {"SETTLED", "FAILED"}:
                fees += record["actual_fee"]
            if record["state"] in {"AUTHORIZED", "IN_FLIGHT"}:
                principal_held += q["amount"]
                fees_held += q["fee_cap"]
        expected = {"payment_spent": spent, "fee_spent": fees, "payment_reserved": principal_held,
                    "fee_reserved": fees_held, "payment_remaining": policy["payment_budget"] - spent - principal_held,
                    "fee_remaining": policy["fee_budget"] - fees - fees_held}
        if expected != state["totals"] or expected["payment_remaining"] < 0 or expected["fee_remaining"] < 0:
            raise AssertionError("Accounting does not reconcile")
    return len(states)


def run():
    checks = []

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    def cli(*args, optimized=False, expected=0):
        p = subprocess.run([sys.executable, *(["-O"] if optimized else []), "-bb", "-X", "dev", "-W", "error",
                            "-m", "zoora_community.spending", *map(str, args)], cwd=ROOT,
                           capture_output=True, text=True, timeout=20)
        if p.returncode != expected or "Traceback" in p.stderr:
            raise AssertionError("Spending CLI did not produce the expected safe result: " + p.stderr[-180:])
        return json.loads(p.stdout if expected == 0 else p.stderr)

    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    reference = (ROOT / "examples/spending-reference.json").read_bytes()
    source = ROOT / "examples/spending-input.json"
    with tempfile.TemporaryDirectory(prefix="zoora-spending-evidence-") as name:
        folder = Path(name)
        normal, optimized = folder / "normal.json", folder / "optimized.json"
        meta = cli("run", "--input", source, "--out", normal)
        check("actual normal CLI reproduces all 27 retained actions", meta["actions"] == 27)
        check("fresh complete report matches the retained reference bytes", normal.read_bytes() == reference)
        second = cli("run", "--input", source, "--out", optimized, optimized=True)
        check("actual optimized CLI preserves checks and produces identical report bytes", normal.read_bytes() == optimized.read_bytes() and second == meta)
        for mode in (False, True):
            verified = cli("replay", "--input", normal, "--sha256", meta["fingerprint"], optimized=mode)
            check("actual replay verifies the external pin under " + ("optimized" if mode else "normal") + " Python", verified["verified"] and verified["actions"] == 27)
        report = json.loads(normal.read_bytes())
        state_count = inspect(report)
        check("separate accounting audit reconciles each state and both budgets", state_count == 28)
        check("settled principal and fees match the explicit expected result",
              report["final_state"]["totals"] == {"payment_spent": 150, "fee_spent": 9, "payment_reserved": 0,
                  "fee_reserved": 0, "payment_remaining": 0, "fee_remaining": 1})
        outcomes = [e["outcome"] for e in report["events"]]
        check("shared aliases, changed quotes and duplicate invoices are refused",
              all(v in outcomes for v in ("PAYMENT_BUDGET", "PURCHASE_CONFLICT", "INVOICE_ALREADY_BOUND")))
        late = report["events"][23]
        check("unknown submitted payment remains fully reserved after mandate expiry and revocation",
              late["action"]["at_tick"] == 25 and late["state"]["revoked"] and late["state"]["totals"]["payment_reserved"] == 90)
        check("receipt conflicts and running cancellation never release uncertain funds",
              "RECEIPT_CONFLICT" in outcomes and "CANNOT_CANCEL_SUBMITTED_PAYMENT" in outcomes)
        check("all execution, authority and evidence flags retain their simulation boundary",
              not report["wallet_execution"] and report["classification"] == "SYNTHETIC"
              and report["controller_authentication"] == "UNAVAILABLE" and report["wallet_balances"] == "UNAVAILABLE")
        denied = cli("run", "--input", source, "--out", normal, expected=1)
        check("existing report is never overwritten", denied["error"] == "SPENDING_OUTPUT_REQUIRES_NEW_FILE" and normal.read_bytes() == reference)
        denied = cli("replay", "--input", normal, "--sha256", "0" * 64, expected=1)
        check("wrong external report pin is refused", denied["error"] == "SPENDING_REPORT_PIN_MISMATCH")
        bad = copy.deepcopy(report)
        bad["final_state"]["totals"]["payment_spent"] = 0
        bad["fingerprint"] = hashlib.sha256(DOMAIN + canonical({k: v for k, v in bad.items() if k != "fingerprint"}).encode()).hexdigest()
        forged = folder / "forged.json"
        forged.write_text(canonical(bad), encoding="utf-8")
        denied = cli("replay", "--input", forged, "--sha256", bad["fingerprint"], expected=1)
        check("rehashed fabricated final accounting still fails full replay", denied["error"] == "SPENDING_REPLAY_MISMATCH")
        bad_source = json.loads(source.read_bytes())
        bad_source["policy"]["private_key"] = "never accept wallet secrets"
        invalid, absent = folder / "invalid.json", folder / "absent.json"
        invalid.write_text(canonical(bad_source), encoding="utf-8")
        denied = cli("run", "--input", invalid, "--out", absent, expected=1)
        check("secret-shaped unsupported fields fail before creating a report", denied["error"] == "INVALID_FIELDS" and not absent.exists())
        (output / "spending-report.json").write_bytes(normal.read_bytes())
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "classification": "SYNTHETIC", "checks": checks, "actions": 27,
                "independently_checked_states": state_count, "fingerprint": meta["fingerprint"],
                "transactions_submitted": 0, "wallet_execution": False,
                "signer_integration": False, "protocol_conformance_tested": False,
                "service_authorization": False, "public_deployment": False}
    (output / "spending-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(canonical(evidence))


if __name__ == "__main__":
    run()
