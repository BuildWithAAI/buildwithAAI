"""Actual offline migration CLI and restarted HTTP service; AUTOMATED TEST data only."""

import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile

from integration_evidence import ROOT, Running, command
from fixture_signatures import signed_body
from legacy_fixture import create
from zoora_community.client import read_credential


def run():
    with tempfile.TemporaryDirectory(prefix="zoora-migration-acceptance-") as name:
        folder = Path(name)
        legacy, files, ids = create(folder)
        before = legacy.audit()
        backup = folder / "before.sqlite3"
        result = command("migrate", "--state", legacy.state, "--backup", backup)
        assert json.loads(result.stdout)["schema_version"] == 2
        with sqlite3.connect(backup) as connection:
            assert connection.execute("PRAGMA user_version").fetchone()[0] == 1
            assert connection.execute("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()[0] == before["audit_head"]
        running = Running(legacy.state, folder)
        try:
            token = read_credential(files["agent"])
            route = "/v1/agents/" + ids["agent_id"]
            assert running.client.request("GET", "/v1/me", token=token)[1]["principal_id"] == ids["agent_id"]
            assert running.client.request("GET", route)[1]["wallet_status"] == "DECLARED_UNVERIFIED"
            for table in ("projects", "posts", "offers"):
                assert len(running.client.request("GET", "/v1/" + table)[1]["items"]) == 1
            challenge = running.client.request("POST", route + "/wallet-challenges", {}, token)[1]
            proof = running.client.request("POST", route + "/wallet-proof", signed_body(challenge, "legacy-fixture"), token)[1]
            assert proof["status"] == "SIGNATURE_VERIFIED"
            assert running.client.request("GET", route)[1]["wallet_status"] == "SIGNATURE_VERIFIED"
            assert token not in running.path.read_text()
        finally:
            running.stop()
        after = json.loads(command("audit", "--state", legacy.state).stdout)
        assert after["audit_events"] == before["audit_events"] + 3
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "activity": "AUTOMATED_TEST_FIXTURE", "from_schema": 1, "to_schema": 2,
                "checks": ["actual migration CLI retains schema-1 backup and audit prefix",
                           "restarted HTTP service preserves content and old credentials",
                           "legacy declaration stays unverified until actual signed challenge",
                           "new proof and migration pass internal audit"],
                "before_audit_events": before["audit_events"], "after_audit_events": after["audit_events"],
                "chain_requests": 0, "transactions_submitted": 0}
    (ROOT / "evidence-output").mkdir(exist_ok=True)
    (ROOT / "evidence-output" / "migration.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    sys.exit(run())
