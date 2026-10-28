"""Actual CLI acceptance, independent accounting/hashes, checkpoint and sensitivity evidence."""
from __future__ import annotations
import copy
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "target" / "validation-evidence"
OUT.mkdir(parents=True, exist_ok=True)
BINARY = ROOT / "target" / "release" / ("zoora-review-market.exe" if os.name == "nt" else "zoora-review-market")
HEAD = os.environ.get("SOURCE_HEAD_SHA", subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip())
TESTS = []

def check(name, condition):
    if not condition:
        raise AssertionError(name)
    TESTS.append(name)

def cli(*args, ok=True, binary=BINARY):
    p = subprocess.run([str(binary), *map(str, args)], cwd=ROOT, capture_output=True, text=True, timeout=240)
    assert (p.returncode == 0) == ok, (args, p.stdout, p.stderr)
    return p

def digest(domain, value):
    return hashlib.sha256(domain.encode() + b"\0" + json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()

def campaign_hash(d):
    return digest("ZOORA_AE012_ECONOMY_CAMPAIGN_V1", [d[k] for k in ["schema_version", "model", "classification", "unit", "rng", "config", "runs"]])

def run_hash(d):
    keys = ["config", "seed", "scenario", "policy", "intentions", "intentions_fingerprint", "admissions", "ledger", "final_balances", "rounds", "metrics", "community"]
    return digest("ZOORA_AE012_ECONOMY_RUN_V1", [[d[k] for k in ["schema_version", "model", "classification", "unit", "rng"]], *[d[k] for k in keys]])

def stocks(s):
    assert int(s["opening_units"]) == sum(int(s[k]) for k in ["agent_liquid_units", "treasury_units", "liquidity_budget_units", "burned_units"])

def inspect_run(d):
    assert d["fingerprint"] == run_hash(d)
    assert d["intentions_fingerprint"] == digest("ZOORA_AE012_INTENTIONS_V1", d["intentions"])
    c = d["config"]
    opening = c["starting_balance"] // (10 if d["scenario"] == "BUDGET_SQUEEZE" else 1)
    balances = [opening] * c["agents"]
    payment = returned = fees = burned = lp = treasury = 0
    direct = d["community"]["direct"]
    observations = []
    for event in direct["journal"]:
        command = event["command"]
        if command["type"] in ["PAYMENT_RECEIPT", "VOLUNTARY_REFUND_RECEIPT"] and event["outcome"]["status"] == "RECORDED":
            observations.append((command["type"], command["receipt"]))
    assert len(observations) == len(d["ledger"])
    for n, (e, (kind, receipt)) in enumerate(zip(d["ledger"], observations)):
        is_payment = e["kind"] == "PAYMENT"
        assert e["sequence"] == n and (kind == "PAYMENT_RECEIPT") == is_payment
        assert (e["agreement_id"], e["sender"], e["recipient"], e["amount"], e["tick"]) == tuple(receipt[k] for k in ["agreement_id", "sender", "recipient", "amount", "availability_tick"])
        assert receipt["classification"] == "SYNTHETIC" and receipt["slot"] is None
        expected_fee = c["price"] * c["fee_bps"] // 10000 if is_payment else 0
        assert e["fee"] == expected_fee
        assert e["burned"] == expected_fee * c["burn_share_bps"] // 10000
        assert e["liquidity_budget"] == expected_fee * c["liquidity_share_bps"] // 10000
        assert e["treasury"] == expected_fee - e["burned"] - e["liquidity_budget"]
        balances[e["sender"]] -= e["amount"] + e["fee"]
        balances[e["recipient"]] += e["amount"]
        assert min(balances) >= 0
        payment += e["amount"] if is_payment else 0
        returned += 0 if is_payment else e["amount"]
        fees += e["fee"]; burned += e["burned"]; lp += e["liquidity_budget"]; treasury += e["treasury"]
        assert sum(balances) + fees == opening * c["agents"]
    assert balances == [int(b["units"]) for b in d["final_balances"]]
    m = d["metrics"]
    assert (payment, returned) == (int(direct["metrics"]["payments_recorded"]), int(direct["metrics"]["voluntary_refunds_recorded"]))
    assert (payment, returned, fees) == tuple(int(m["flows"][k]) for k in ["payments", "voluntary_returns", "fees"])
    assert (sum(balances), treasury, lp, burned) == tuple(int(m["stocks"][k]) for k in ["agent_liquid_units", "treasury_units", "liquidity_budget_units", "burned_units"])
    assert m["counts"]["admitted_work"] + m["counts"]["admitted_attacks"] == len(d["community"]["orders"])
    assert m["counts"]["acknowledged_work"] == sum(a["delivery_acknowledged"] for a in direct["agreements"])
    assert int(m["unacknowledged_net_units"]) == sum(int(a["payments_received"])-int(a["voluntary_refunds_received"]) for a in direct["agreements"] if not a["delivery_acknowledged"])
    assert int(m["undelivered_net_units"]) == sum(int(a["payments_received"])-int(a["voluntary_refunds_received"]) for a in direct["agreements"] if a["delivery_digest"] is None)
    assert all(v is False for v in direct["wallet_boundary"].values())
    stocks(m["stocks"])
    for r in d["rounds"]:
        stocks(r["stocks"])
    for k in m["counts"]:
        assert m["counts"][k] == sum(r["counts"][k] for r in d["rounds"])
    for k in m["flows"]:
        assert int(m["flows"][k]) == sum(int(r["flows"][k]) for r in d["rounds"])

def orchestrate(config, directory, *flags, ok=True):
    p = subprocess.run([sys.executable, str(ROOT/"scripts/run_economy_campaign.py"), "--config", str(config), "--output-dir", str(directory), *flags], cwd=ROOT, text=True, capture_output=True, timeout=360)
    assert (p.returncode == 0) == ok, (p.stdout[-1200:], p.stderr)
    return p

start = time.perf_counter()
with tempfile.TemporaryDirectory() as temp_name:
    temp = Path(temp_name)
    # Small full-journal checkpoint run, deliberately paused and resumed.
    text = (ROOT/"configs/economy-fee-sensitivity.toml").read_text()
    text = text.replace("[7, 11, 19, 31, 42, 59, 73, 89, 101, 127]", "[42]")
    smoke = temp/"smoke.toml"; smoke.write_text(text, encoding="utf-8")
    checkpoint = temp/"checkpoint"
    orchestrate(smoke, checkpoint, "--max-new-runs", "2")
    progress = json.loads((checkpoint/"progress.json").read_text())
    check("early checkpoint cannot claim completion", progress["state"] == "INCOMPLETE" and progress["completed_runs"] == 2)
    before = [(p.name, p.read_bytes()) for p in sorted((checkpoint/"runs").glob("*.json"))]
    orchestrate(smoke, checkpoint, "--resume")
    progress = json.loads((checkpoint/"progress.json").read_text())
    check("resume completes all sixteen expected runs", progress["state"] == "COMPLETE" and progress["completed_runs"] == 16)
    check("resume preserves cached run bytes", all((checkpoint/"runs"/name).read_bytes() == data for name, data in before))
    for path in sorted((checkpoint/"runs").glob("*.json")):
        inspect_run(json.loads(path.read_text()))
    check("independent ledger replay matches all sixteen full transcripts", True)
    orchestrate(smoke, checkpoint, ok=False)
    check("existing output refuses implicit overwrite", True)
    changed = temp/"changed.toml"; changed.write_text(text.replace("fee_bps = 100", "fee_bps = 101"))
    orchestrate(changed, checkpoint, "--resume", ok=False)
    check("resume rejects changed fee configuration", True)
    victim = sorted((checkpoint/"runs").glob("*.json"))[0]
    original = victim.read_bytes(); victim.write_text("{broken")
    orchestrate(smoke, checkpoint, "--resume", ok=False)
    check("resume rejects corrupt cached evidence", json.loads((checkpoint/"progress.json").read_text())["state"] == "INCOMPLETE")
    victim.write_bytes(original)
    reference = None; fee_suite = None; summaries = []
    for tag, config in [("reference", "economy-campaign.toml"), ("fee-sensitivity", "economy-fee-sensitivity.toml")]:
        path = OUT/("economy-"+tag+".json")
        cli("economy-campaign", ROOT/"configs"/config, path)
        cli("replay-economy-campaign", path)
        data = json.loads(path.read_text())
        check(tag+" independent campaign hash", data["fingerprint"] == campaign_hash(data))
        check(tag+" complete 160-run matrix", len(data["runs"]) == 160)
        for seed in data["config"]["seeds"]:
            assert len({r["intentions_fingerprint"] for r in data["runs"] if r["seed"] == seed}) == 1
        check(tag+" all policies and shocks share intentions per seed", True)
        for r in data["runs"]:
            stocks(r["metrics"]["stocks"])
            assert int(r["metrics"]["flows"]["fees"]) == sum(int(r["metrics"]["stocks"][k]) for k in ["treasury_units", "liquidity_budget_units", "burned_units"])
        check(tag+" all 160 stock/fee reconciliations", True)
        csv_path = path.with_suffix(".csv"); html_path = path.with_suffix(".html")
        cli("economy-csv", path, csv_path);cli("economy-viewer", path, html_path)
        rows = list(csv.DictReader(io.StringIO(csv_path.read_text())))
        check(tag+" CSV has all runs and source fingerprints", len(rows) == 160 and all(r["campaign_fingerprint"] == data["fingerprint"] and r["unit"] == "SIMULATED_UNITS" for r in rows))
        html = html_path.read_text()
        check(tag+" viewer has no connection permission", "connect-src 'none'" in html and html.count("</script>") == 2)
        forged = copy.deepcopy(data);forged["runs"][0]["metrics"]["flows"]["fees"] = "999";forged["fingerprint"] = campaign_hash(forged)
        bad = temp/(tag+"-forged.json");bad.write_text(json.dumps(forged))
        cli("replay-economy-campaign", bad, ok=False)
        cli("economy-viewer", bad, temp/(tag+"-forbidden.html"), ok=False)
        check(tag+" rehashed false fees cannot replay or export", not (temp/(tag+"-forbidden.html")).exists())
        summaries.append({"tag":tag, "runs":160, "fingerprint":data["fingerprint"], "file_sha256":hashlib.sha256(path.read_bytes()).hexdigest()})
        if tag == "reference": reference = data
        else: fee_suite = data
    check("fee sensitivity preserves every intended workload", [r["intentions_fingerprint"] for r in reference["runs"]] == [r["intentions_fingerprint"] for r in fee_suite["runs"]])
    # Verify one full journal in debug/release and against the corresponding summary.
    for policy in ["BASELINE", "OPERATOR_CAP"]:
        outputs=[]
        for profile in ["debug", "release"]:
            output=temp/(profile+policy+".json")
            binary=ROOT/"target"/profile/BINARY.name
            cli("economy-run", smoke, "42", "SHARED_OPERATOR_SPAM", policy, output, binary=binary)
            cli("replay-economy", output, binary=binary)
            outputs.append(output.read_bytes())
        check(policy+" debug/release journals are byte-identical", outputs[0] == outputs[1])
        data=json.loads(outputs[0]);inspect_run(data)
        forged=copy.deepcopy(data);forged["ledger"][0]["fee"]+=1;forged["fingerprint"]=run_hash(forged)
        bad=temp/(policy+"-forged-run.json");bad.write_text(json.dumps(forged));cli("replay-economy",bad,ok=False)
        check(policy+" rehashed false ledger transfer rejected", True)
        row=next(r for r in fee_suite["runs"] if r["seed"]==42 and r["scenario"]=="SHARED_OPERATOR_SPAM" and r["policy"]==policy)
        # smoke config has one seed, so the full run hash differs; metrics and community are identical.
        check(policy+" independently checked transcript matches large campaign metrics", data["metrics"]==row["metrics"] and data["community"]["fingerprint"]==row["community_fingerprint"])
    # Validate bound failures and exclusive output behavior using the real CLI.
    invalid=temp/"invalid.toml";invalid.write_text(text.replace("rounds = 12", "rounds = 25"))
    cli("economy-campaign",invalid,temp/"invalid.json",ok=False)
    check("out-of-bound config creates no output", not (temp/"invalid.json").exists())
    cli("economy-campaign",smoke,checkpoint/"campaign.json",ok=False)
    check("CLI refuses existing campaign output", True)

summary={"source_head_sha":HEAD,"source_tree_dirty":bool(subprocess.check_output(["git","status","--porcelain"],cwd=ROOT)),"classification":"SYNTHETIC","unit":"SIMULATED_UNITS",
         "platform":platform.platform(),"unique_reference_and_sensitivity_runs":320,
         "tests":TESTS,"campaigns":summaries,"elapsed_seconds":round(time.perf_counter()-start,3),
         "timing_scope":"SINGLE_LOCAL_OR_CI_ACCEPTANCE_SAMPLE_NOT_A_THROUGHPUT_CLAIM",
         "live_wallets_or_transactions":False}
(OUT/"economy-evidence.json").write_text(json.dumps(summary,indent=2)+"\n",encoding="utf-8")
print(json.dumps(summary,indent=2))
