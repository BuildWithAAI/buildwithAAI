"""Strict real public RPC → authenticated HTTP → SQLite → restart acceptance; no transactions sent."""

import json
import os
from pathlib import Path
import sys
import tempfile
import time

from integration_evidence import ROOT, Running
from fixture_signatures import address, signed_body
from zoora_community.solana_rpc import NETWORKS, SYSTEM_PROGRAM, SolanaRPC, transaction_signature
from zoora_community.store import Store

# Public Mainnet signature discovered by the failing source-head CI run. Reuse
# that precise regression, rather than accidentally verifying v1 with a v0 sample.
V1_REGRESSION_SIGNATURE = "3JVGAK858KfighRrigaRedzWNXN9YACXPJFeqTXmM9s3tAzNWqPChuLATddFpzLQptePEb6JyP4TUEfz7bE2kYFJ"


def run():
    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "activity": "OBSERVED_PUBLIC_CHAIN_RECORD_WITH_AUTOMATED_TEST_AGENT",
                "customer_wallets": 0, "transactions_submitted": 0, "networks": [], "checks": []}
    success = True
    cases = [(cluster, None) for cluster in NETWORKS] + [("solana:mainnet", V1_REGRESSION_SIGNATURE)]
    for cluster, pinned_signature in cases:
        entry = {"network": cluster, "source": "https://" + NETWORKS[cluster][0], "status": "BLOCKED",
                 "case": "PUBLIC_V1_REGRESSION_TRANSACTION" if pinned_signature else "RECENT_PUBLIC_TRANSACTION"}
        evidence["networks"].append(entry)
        try:
            rpc = SolanaRPC()
            discovery_hash = None
            if pinned_signature:
                signature = transaction_signature(pinned_signature)
            else:
                recent, _raw, discovery_hash = rpc._request(cluster, "getSignaturesForAddress",
                    [SYSTEM_PROGRAM, {"commitment": "finalized", "limit": 1}], time.monotonic() + 8)
                assert type(recent) is list and len(recent) == 1, "No finalized signature returned"
                signature = transaction_signature(recent[0]["signature"])
            with tempfile.TemporaryDirectory(prefix="zoora-live-read-") as name:
                folder = Path(name)
                state, owner_file = folder / "state", folder / "owner.credential.json"
                store = Store.initialize(state, owner_file)
                owner = json.loads(owner_file.read_text())["token"]
                operator = store.call("POST", "/v1/operators", {"handle": "live_read_test"}, owner)[1]["credential"]["token"]
                challenge = store.call("POST", "/v1/wallet/challenges", {"handle": "read_only_test",
                    "wallet": address("live-read-fixture"), "capabilities": ["research"]}, operator)[1]
                registration = store.call("POST", "/v1/agents", signed_body(challenge, "live-read-fixture"), operator)[1]
                agent_id, token = registration["agent"]["id"], registration["credential"]["token"]
                running = Running(state, folder, enable_solana=True)
                try:
                    observed = running.client.request("POST", "/v1/agents/" + agent_id + "/transactions",
                                                     {"network": cluster, "signature": signature}, token)[1]
                    report = observed["report"]
                    entry.update({"signature": signature, "observation_state": report["state"],
                                  "quality_flags": report["quality_flags"]})
                    for key in ("provider_error_code", "failed_rpc_method", "provider_error_response_sha256"):
                        if key in report:
                            entry[key] = report[key]
                    assert report["state"] == "AVAILABLE", "Read-only observation did not return verified-schema data"
                    assert report["genesis_hash"] == NETWORKS[cluster][1]
                    assert report["classification"] == "OBSERVED"
                    assert report["slot"] is not None and report["fee_lamports"] is not None
                    assert report["related_to_agent"] is False
                    assert report["pnl"] == "UNAVAILABLE"
                    if pinned_signature:
                        assert report["transaction_version"] == 1 and report["transformation_version"] == 2
                        assert report["transaction_config_analysis"] == "UNAVAILABLE"
                    detail = running.client.request("GET", "/v1/transactions/" + observed["id"])[1]
                    assert owner not in running.path.read_text() and token not in running.path.read_text()
                finally:
                    running.stop()
                audit = Store(state).audit()
                running = Running(state, folder)
                try:
                    assert running.client.request("GET", "/v1/transactions/" + observed["id"])[1] == detail
                    assert running.client.request("GET", "/v1/status")[1]["solana_rpc"] == "DISABLED"
                finally:
                    running.stop()
            entry.update({"status": "VERIFIED", "report": report, "audit_events": audit["audit_events"],
                          "discovery_response_sha256": discovery_hash, "read_only_rpc_requests": 2 if pinned_signature else 3})
            filename = "live-" + cluster.split(":")[1] + ("-v1" if pinned_signature else "") + "-rpc.json"
            (output / filename).write_text(json.dumps({"source_head_sha": evidence["source_head_sha"],
                "classification": "OBSERVED", "source": entry["source"], "response": detail}, indent=2) + "\n", encoding="utf-8")
            evidence["checks"].append(cluster + (" v1 regression" if pinned_signature else "") + ": real RPC response persists through authenticated HTTP and restart without wallet execution")
        except Exception as error:
            # Safe type/code only; no credential values or provider response errors.
            success = False
            entry["failure"] = getattr(error, "code", type(error).__name__)
    evidence["result"] = "VERIFIED" if success else "BLOCKED"
    (output / "live-rpc.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(run())
