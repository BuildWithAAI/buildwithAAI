"""Actual CLI/replay and independent AE-016 acceptance evidence."""
from __future__ import annotations
import copy
import csv
import gzip
import io
import json
import os
import platform
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from trust_audit import inspect_campaign, inspect_run, run_hash, campaign_hash

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "target/validation-evidence"
OUT.mkdir(parents=True, exist_ok=True)
NAME = "zoora-review-market" + (".exe" if os.name == "nt" else "")
CHECKS = []
EXPECTED = "f5bdab1d42c6663fe1bb8b989e99cac8385022a35a9d90e8cde3e9f4e3c08c68"


def check(label, value=True):
    assert value, label
    CHECKS.append(label)


def cli(*args, profile="release", ok=True):
    p = subprocess.run([str(ROOT / "target" / profile / NAME), *map(str, args)],
                       cwd=ROOT, text=True, capture_output=True, timeout=120)
    assert (p.returncode == 0) == ok, (args, p.stdout[-500:], p.stderr)
    return p


start = time.perf_counter()
with tempfile.TemporaryDirectory() as directory:
    temp = Path(directory)
    campaign = OUT / "trust-campaign.json"
    cli("trust-campaign", ROOT / "configs/trust-campaign.toml", campaign)
    cli("replay-trust-campaign", campaign)
    data = json.loads(campaign.read_bytes())
    counts = inspect_campaign(data)
    check("15 complete scenario histories independently audited", len(data["cases"]) == 15)
    check("reference fingerprint is pinned", data["fingerprint"] == EXPECTED)
    retained = gzip.decompress((ROOT / "examples/trust-campaign.json.gz").read_bytes())
    check("retained full journal archive matches regenerated campaign bytes", retained == campaign.read_bytes())
    debug = temp / "debug.json"
    cli("trust-campaign", ROOT / "configs/trust-campaign.toml", debug, profile="debug")
    check("debug and optimized campaigns are byte-identical", debug.read_bytes() == campaign.read_bytes())
    by_name = {c["name"]: c["run"] for c in data["cases"]}
    for name, run in by_name.items():
        source, output = temp / (name + "-input.json"), temp / (name + ".json")
        source.write_text(json.dumps(run["input"]), encoding="utf-8")
        cli("trust-run", source, output)
        cli("replay-trust", output)
        actual = json.loads(output.read_bytes())
        assert actual == run
        inspect_run(actual)
        check(name + " actual CLI input reproduces its full history")
    csv_path = OUT / "trust-campaign.csv"
    cli("trust-csv", campaign, csv_path)
    rows = list(csv.DictReader(io.StringIO(csv_path.read_text(encoding="utf-8"))))
    check("CSV includes all 120 agent outcomes and exact credit denominators",
          len(rows) == 120 and all(r["credit_denominator"] == "10000" for r in rows))
    check("CSV preserves source run and campaign fingerprints",
          all(r["campaign_fingerprint"] == data["fingerprint"] and
              r["run_fingerprint"] == by_name[r["case"]]["fingerprint"] for r in rows))
    profile = lambda name, agent=0: by_name[name]["profiles"][agent]
    check("small and large tasks earn equal work credit without a per-task bonus",
          profile("SMALL_TASKS")["earned_credit_microunits"] == profile("ONE_LARGE_TASK")["earned_credit_microunits"] == 1_000_000)
    check("one large task does not replace independent customer history", profile("ONE_LARGE_TASK")["tier"] == 0)
    check("balanced history unlocks two work slots", profile("BALANCED_HISTORY")["tier"] == 1 and profile("BALANCED_HISTORY")["active_contracts"] == 2)
    check("review and sufficient work unlock four work slots", profile("ESTABLISHED_HISTORY")["tier"] == 2 and profile("ESTABLISHED_HISTORY")["active_contracts"] == 4)
    check("large payment totals cannot buy trust and remain exact", int(by_name["HIGH_PAYMENT_VOLUME"]["direct"]["metrics"]["payments_recorded"]) == 2 * (2**64 - 1) and profile("HIGH_PAYMENT_VOLUME")["tier"] == 0)
    check("collective shares conserve 202 credits without becoming participant payouts",
          profile("COLLECTIVE_ATTRIBUTION")["earned_credit_microunits"] == 1_212_000 and
          profile("COLLECTIVE_ATTRIBUTION", 3)["earned_credit_microunits"] == 808_000)
    check("same-owner customer wallets count as one customer operator", profile("RELATED_CUSTOMER")["customer_operators"] == 1)
    check("disputes pause new work without reversing payments", profile("DISPUTE_AFTER_CREDIT")["dispute_hold"] and int(by_name["DISPUTE_AFTER_CREDIT"]["direct"]["metrics"]["voluntary_refunds_recorded"]) == 0)
    check("verification downgrade keeps existing commitments", profile("VERIFICATION_REVOKED")["tier"] == 0 and profile("VERIFICATION_REVOKED")["active_contracts"] == 4)
    check("per-agent limits expose a wallet-rotation bypass", sum(profile("WALLET_ROTATION", a)["active_contracts"] for a in [0, 5, 7]) == 3)
    check("no signer custody freeze reversal or chain authentication is introduced",
          all(not any(c["run"]["direct"]["wallet_boundary"].values()) for c in data["cases"]))

    base = by_name["COLLECTIVE_ATTRIBUTION"]
    mutations = {}
    forged = copy.deepcopy(base); forged["profiles"][0]["tier"] = 2; mutations["false-tier"] = forged
    forged = copy.deepcopy(base); forged["contracts"][0]["credit_shares"][0]["earned_microunits"] += 1; mutations["extra-credit"] = forged
    forged = copy.deepcopy(base); forged["journal"][0]["profiles_after"][0]["active_contracts"] += 1; mutations["false-history"] = forged
    forged = copy.deepcopy(base); forged["direct"]["metrics"]["payments_recorded"] = "0"; mutations["false-payment"] = forged
    for label, forged in mutations.items():
        forged["fingerprint"] = run_hash(forged)
        path = temp / (label + ".json"); path.write_text(json.dumps(forged), encoding="utf-8")
        cli("replay-trust", path, ok=False)
        try:
            inspect_run(forged)
        except AssertionError:
            pass
        else:
            raise AssertionError("independent audit accepted " + label)
        check("native replay and independent audit reject rehashed " + label)
    forged = copy.deepcopy(data); forged["cases"].pop(); forged["fingerprint"] = campaign_hash(forged)
    path = temp / "missing-case.json"; path.write_text(json.dumps(forged), encoding="utf-8")
    cli("replay-trust-campaign", path, ok=False)
    forbidden = temp / "forbidden.csv"; cli("trust-csv", path, forbidden, ok=False)
    check("missing rehashed scenario cannot replay or export", not forbidden.exists())
    reordered = copy.deepcopy(data); reordered["cases"].reverse(); reordered["fingerprint"] = campaign_hash(reordered)
    path = temp / "reordered.json"; path.write_text(json.dumps(reordered), encoding="utf-8")
    cli("replay-trust-campaign", path, ok=False)
    check("reordered rehashed demonstration matrix is rejected")
    command = [sys.executable, "-O", str(ROOT / "scripts/trust_audit.py"), str(campaign)]
    p = subprocess.run(command, text=True, capture_output=True, timeout=120)
    check("Python -O refuses to bypass independent assertions", p.returncode != 0 and "without -O" in p.stderr)
    unchanged = campaign.read_bytes()
    cli("trust-campaign", ROOT / "configs/trust-campaign.toml", campaign, ok=False)
    check("existing evidence cannot be overwritten", campaign.read_bytes() == unchanged)
    invalid = temp / "invalid.toml"
    invalid.write_text((ROOT / "configs/trust-campaign.toml").read_text().replace("maturity_ticks = 3", "maturity_ticks = 0"), encoding="utf-8")
    path = temp / "invalid-output.json"; cli("trust-campaign", invalid, path, ok=False)
    check("invalid timing configuration produces no report", not path.exists())
    for label, change in [
        ("past-time", lambda i: i["actions"].append({**i["actions"][0], "tick": 0})),
        ("unknown-input-field", lambda i: i.update(hidden_override=True)),
        ("excess-identities", lambda i: i["config"].update(operators=[0] * 65)),
        ("excess-actions", lambda i: i.update(actions=[i["actions"][0]] * 4097)),
    ]:
        value = copy.deepcopy(base["input"]); change(value)
        source, output = temp / (label + "-input.json"), temp / (label + "-output.json")
        source.write_text(json.dumps(value), encoding="utf-8")
        cli("trust-run", source, output, ok=False)
        check(label + " is refused before output creation", not output.exists())

head = os.environ.get("SOURCE_HEAD_SHA") or subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
summary = dict(source_head_sha=head, source_tree_dirty=bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT)),
               classification="SYNTHETIC", model="zoora-trust-campaign/0.1.0", platform=platform.platform(),
               cases=15, fingerprint=data["fingerprint"], independently_audited=counts,
               checks=CHECKS, elapsed_seconds=round(time.perf_counter() - start, 3),
               timing_scope="SINGLE_ACCEPTANCE_SAMPLE_NOT_LIVE_THROUGHPUT", network_or_signer=False)
(OUT / "trust-evidence.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, indent=2))
