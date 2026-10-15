"""Actual CLI/HTTP, cross-agent race, restart, restore and schema-4 migration."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import uuid

from integration_evidence import ROOT, Running, command
from fixture_signatures import address, signed_body
from legacy_fixture import create
from zoora_community.client import read_credential
from zoora_community.store import Store
from zoora_community.validation import Problem, canonical


def run():
    checks = []

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    def refused(code, callback):
        try:
            callback()
        except Problem as error:
            if error.code != code:
                raise
        else:
            raise AssertionError("Expected refusal: " + code)

    with tempfile.TemporaryDirectory(prefix="zoora-task-capacity-") as name:
        folder = Path(name)
        state, owner_file = folder / "state", folder / "owner.json"
        command("init", "--state", state, "--owner-file", owner_file)
        owner = read_credential(owner_file)
        server = Running(state, folder)
        secrets = [owner]
        route = None

        def cli_policy(maximum, revision):
            body = folder / "policy.json"
            body.write_text(canonical({"max_pending": maximum, "expected_revision": revision,
                                      "reason": "Automated local resource policy"}), encoding="utf-8")
            result = command("request", "PATCH", route, "--port", server.port,
                             "--credential-file", owner_file, "--body-file", body)
            if any(secret in result.stdout + result.stderr for secret in secrets):
                raise AssertionError("Secret leaked to CLI output")
            return json.loads(result.stdout)["result"]["capacity"]

        def submit(token, body=None):
            body = body or {"request_id": uuid.uuid4().hex, "title": "Capacity fixture", "prompt": "Private test task"}
            return server.client.request("POST", "/v1/jobs", body, token)[1]

        def stop(job):
            return server.client.request("POST", "/v1/jobs/" + job["id"] + "/stop", {}, owner)[1]

        try:
            operator = server.client.request("POST", "/v1/operators", {"handle": "capacity_operator"}, owner)[1]
            operator_id, operator_token = operator["operator"]["id"], operator["credential"]["token"]
            secrets.append(operator_token)
            route = "/v1/operators/" + operator_id + "/task-capacity"
            agents = []
            for index in range(2):
                label = "PUBLIC-CAPACITY-TEST-KEY-NEVER-FUND-" + str(index)
                challenge = server.client.request("POST", "/v1/wallet/challenges",
                    {"handle": "capacity_agent_" + str(index), "wallet": address(label), "capabilities": ["research"]}, operator_token)[1]
                result = server.client.request("POST", "/v1/agents", signed_body(challenge, label), operator_token)[1]
                agents.append(result["credential"]["token"])
                secrets.append(agents[-1])
            view = cli_policy(1, 0)
            check("actual owner CLI saves schema-5 shared limit at revision one", view["revision"] == 1 and view["max_pending"] == 1)
            body = {"request_id": uuid.uuid4().hex, "title": "Exact retry", "prompt": "Private fixture"}
            first = submit(agents[0], body)
            refused("OPERATOR_TASK_LIMIT", lambda: submit(agents[1]))
            retry = submit(agents[0], body)
            check("known second agent is refused while exact original request reconciles", retry["replayed"] and retry["job"]["id"] == first["job"]["id"])
            for token in (operator_token, *agents):
                refused("FORBIDDEN", lambda token=token: server.client.request("PATCH", route,
                        {"max_pending": 32, "expected_revision": 1, "reason": "Cannot self-promote"}, token))
            other = server.client.request("POST", "/v1/operators", {"handle": "unrelated_capacity_operator"}, owner)[1]["credential"]["token"]
            secrets.append(other)
            refused("FORBIDDEN", lambda: server.client.request("GET", route, token=other))
            refused("UNAUTHORIZED", lambda: server.client.request("GET", route))
            check("HTTP denies agent/operator policy changes and unauthenticated or unrelated reads", True)
            check("queued stop frees the shared place", stop(first["job"])["state"] == "CANCELLED")

            def race(index):
                try:
                    result = submit(agents[index % 2])
                    return index % 2, result["job"]
                except Problem as error:
                    return error.code

            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(race, range(8)))
            winners = [item for item in results if isinstance(item, tuple)]
            check("eight actual HTTP submissions across two agents admit exactly one", len(winners) == 1 and results.count("OPERATOR_TASK_LIMIT") == 7)
            winner, job = winners[0]
            claim = server.client.request("POST", "/v1/jobs/claim", {"max_steps": 4, "timeout_seconds": 60}, agents[winner])[1]
            stopped = stop(job)
            refused("OPERATOR_TASK_LIMIT", lambda: submit(agents[1 - winner]))
            check("running stop remains pending and cannot free an overlapping admission", stopped["state"] == "RUNNING" and stopped["stop_requested"])
            completion = {"attempt_id": claim["job"]["attempt_id"], "claim_token": claim["claim_token"],
                          "state": "FAILED", "report_sha256": None, "report_bytes": None, "steps": 0, "error_code": "FIXTURE_STOP"}
            secrets.append(claim["claim_token"])
            complete_route = "/v1/jobs/" + job["id"] + "/complete"
            finished = server.client.request("POST", complete_route, completion, agents[winner])[1]
            replayed = server.client.request("POST", complete_route, completion, agents[winner])[1]
            check("terminal stopped completion releases capacity and exact completion is idempotent", finished["job"]["state"] == "CANCELLED" and replayed["replayed"])
            queued = [submit(agents[0])["job"]]
            cli_policy(2, 1)
            queued.append(submit(agents[1])["job"])
            limited = cli_policy(0, 2)
            refused("OPERATOR_TASK_LIMIT", lambda: submit(agents[0]))
            refused("TASK_CAPACITY_CONFLICT", lambda: server.client.request("PATCH", route,
                    {"max_pending": 32, "expected_revision": 1, "reason": "Stale write"}, owner))
            check("lowering to zero retains two queued tasks and rejects stale policy updates", limited["pending"] == 2 and limited["over_limit"])
        finally:
            server.stop()
        server = Running(state, folder)
        try:
            view = server.client.request("GET", route, token=owner)[1]
            check("new service process preserves quota revision and both pending tasks", (view["revision"], view["max_pending"], view["pending"]) == (3, 0, 2))
            audit = Store(state).audit()
            backup = folder / "capacity-backup.sqlite3"
            command("backup", "--state", state, "--out", backup)
            check("actual backup verification preserves audited capacity history", json.loads(command("verify-backup", "--backup", backup).stdout)["audit"] == audit)
            check("raw API and claim credentials are absent from database and HTTP logs",
                  all(secret.encode() not in state.joinpath("community.sqlite3").read_bytes() and secret not in server.path.read_text() for secret in secrets))
        finally:
            server.stop()
        restored, recovered_owner = folder / "restored", folder / "recovered-owner.json"
        command("restore", "--backup", backup, "--state", restored)
        command("recover-owner", "--state", restored, "--owner-file", recovered_owner, "--invalidate-all-credentials")
        server = Running(restored, folder)
        try:
            recovered = read_credential(recovered_owner)
            view = server.client.request("GET", route, token=recovered)[1]
            refused("UNAUTHORIZED", lambda: server.client.request("GET", route, token=owner))
            check("restore plus credential-invalidating recovery retains policy but retires invalid work", (view["revision"], view["max_pending"], view["pending"]) == (3, 0, 0))
            Store(restored).audit()
        finally:
            server.stop()

        legacy_folder = folder / "legacy"
        legacy_folder.mkdir(mode=0o700)
        legacy, files, _ = create(legacy_folder)
        with closing(sqlite3.connect(legacy.path, autocommit=True)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            for version in (2, 3, 4):
                ddl = ROOT / "zoora_community" / f"migration_{version:03}.sql"
                for statement in ddl.read_text(encoding="utf-8").split(";"):
                    if statement.strip():
                        connection.execute(statement)
            connection.execute("PRAGMA user_version=4")
            connection.execute("COMMIT")
        old = Store(legacy.state, _schema_version=4)
        with closing(old._connection()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            principal = old._authenticate(connection, read_credential(files["agent"]), old.clock())
            for _ in range(2):
                old._jobs_write(connection, principal, "POST", "/v1/jobs",
                    {"request_id": uuid.uuid4().hex, "title": "Preserved schema four", "prompt": "Migration fixture"}, old.clock())
            connection.execute("COMMIT")
        before = old.audit()
        legacy_backup = folder / "before-schema-five.sqlite3"
        migrated = json.loads(command("migrate", "--state", old.state, "--backup", legacy_backup).stdout)
        server = Running(old.state, legacy_folder)
        try:
            view = server.client.request("GET", "/v1/task-capacity", token=read_credential(files["agent"]))[1]
            with closing(sqlite3.connect(legacy_backup)) as connection:
                backup_version = connection.execute("PRAGMA user_version").fetchone()[0]
            check("actual schema-4 migration CLI preserves its audited backup and two original tasks",
                  migrated["schema_version"] == 5 and backup_version == 4 and view["revision"] == 0 and view["max_pending"] is None
                  and view["pending"] == 2 and Store(old.state).audit()["audit_events"] == before["audit_events"] + 1)
        finally:
            server.stop()
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "activity": "AUTOMATED_TEST_FIXTURE", "wallet_classification": "SYNTHETIC",
                "schema_version": 5, "checks": checks, "transport": server.transport,
                "operator_policy": "OWNER_SELECTED_OPT_IN", "earned_trust_enforcement": False,
                "independent_human_verification": False, "transactions_submitted": 0,
                "model_requests": 0, "public_deployment": False}
    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    (output / "task-capacity.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(canonical(evidence))


if __name__ == "__main__":
    run()
