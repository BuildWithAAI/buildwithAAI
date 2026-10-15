"""Actual authenticated CLI/HTTP, crash, race, restore and schema-5 upgrade checks."""

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
from commerce_evidence import inspect
from zoora_community.client import read_credential
from zoora_community.commerce import run as model_run
from zoora_community.store import Store
from zoora_community.validation import Problem, canonical

BASE = "/v1/commerce/books"


def policy():
    return {"authority": {"operator": "operator", "agents": ["agent_one", "agent_two"],
                          "payees": ["supplier"], "purposes": ["operate"], "payment_limit": 100,
                          "payment_budget": 100, "fee_budget": 10, "valid_from": 0, "expires": 900_000},
            "activities": ["white_label_supply", "agent_service"],
            "merchants": [{"merchant": "supplier", "platform": "generic",
                           "activities": ["white_label_supply", "agent_service"], "methods": ["x402"], "recurring": False}],
            "routes": [{"method": "x402", "enabled": True, "account_owner": "operator", "eligible_until": 900_000, "recurring": False}],
            "subscriptions": []}


def purchase(index, amount=60):
    return {"kind": "PURCHASE", "request": {"quote": {"purchase_id": f"{index:032x}",
              "invoice_id": f"{index + 100:032x}", "payee": "supplier", "purpose": "operate",
              "network": "SIMULATED_NETWORK", "asset": "SIMULATED_UNIT", "resource_sha256": "a" * 64,
              "amount": amount, "fee_cap": 3, "expires": 800_000}, "activity": "white_label_supply",
              "method": "x402", "recurring": False, "subscription_id": None, "cycle": None}}


def run():
    checks, tokens, logs = [], [], []

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    def denied(code, fn):
        try:
            fn()
        except Problem as error:
            if error.code != code:
                raise
        else:
            raise AssertionError("Expected refusal: " + code)

    with tempfile.TemporaryDirectory(prefix="zoora-durable-commerce-") as name:
        folder = Path(name)
        state, owner_file = folder / "state", folder / "owner.json"
        command("init", "--state", state, "--owner-file", owner_file)
        owner = read_credential(owner_file)
        tokens.append(owner)
        server = Running(state, folder)
        try:
            operator_file, operator_body = folder / "operator.json", folder / "operator-body.json"
            operator_body.write_text(canonical({"handle": "commerce_operator"}), encoding="utf-8")
            cli = command("request", "POST", "/v1/operators", "--port", server.port,
                          "--credential-file", owner_file, "--body-file", operator_body,
                          "--save-credential", operator_file)
            operator = read_credential(operator_file)
            tokens.append(operator)
            agents = []
            bindings = []
            for index, alias in enumerate(("agent_one", "agent_two")):
                label = "PUBLIC-DURABLE-COMMERCE-TEST-NEVER-FUND-" + str(index)
                challenge = server.client.request("POST", "/v1/wallet/challenges",
                    {"handle": alias, "wallet": address(label), "capabilities": ["research"]}, operator)[1]
                enrolled = server.client.request("POST", "/v1/agents", signed_body(challenge, label), operator)[1]
                agents.append(enrolled["credential"]["token"])
                tokens.append(agents[-1])
                bindings.append({"alias": alias, "agent_id": enrolled["agent"]["id"]})
            value = {"request_id": "a" * 32, "policy": policy(), "bindings": bindings}
            body_file = folder / "book.json"
            body_file.write_text(canonical(value), encoding="utf-8")
            cli = command("request", "POST", BASE, "--port", server.port, "--credential-file", operator_file, "--body-file", body_file)
            book = json.loads(cli.stdout)["result"]["book"]
            route = BASE + "/" + book["id"]
            check("actual CLI creates a private authenticated operator book without printing credentials",
                  book["revision"] == 0 and book["controller_authentication"] == "LOCAL_API_CREDENTIAL"
                  and all(token not in cli.stdout + cli.stderr for token in tokens))

            def post(cmd, token, request_id=None):
                return server.client.request("POST", route + "/actions", {"request_id": request_id or uuid.uuid4().hex, "command": cmd}, token)[1]

            def view(token=operator):
                return server.client.request("GET", route, token=token)[1]

            def bound(kind, index=0, **extra):
                record = view()["state"]["purchases"][index]
                return {"kind": kind, "purchase_id": record["request"]["quote"]["purchase_id"],
                        "binding_sha256": record["binding_sha256"], **extra}

            stranger = server.client.request("POST", "/v1/operators", {"handle": "unrelated_commerce_operator"}, owner)[1]["credential"]["token"]
            tokens.append(stranger)
            denied("UNAUTHORIZED", lambda: server.client.request("GET", route))
            denied("FORBIDDEN", lambda: view(stranger))
            denied("FORBIDDEN", lambda: server.client.request("POST", BASE, value, agents[0]))
            check("HTTP rejects anonymous or unrelated access and agent-created mandates", True)
            denied("SERVER_COMMERCE_IDENTITY_REQUIRED", lambda: post({**purchase(1), "actor": "agent_two"}, agents[0]))
            denied("SERVER_COMMERCE_IDENTITY_REQUIRED", lambda: post({**purchase(1), "at_tick": 0}, agents[0]))
            check("HTTP will not accept a caller-invented actor or execution clock", True)

            def race(index):
                return index, post(purchase(index + 1), agents[index % 2])["outcome"]

            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(race, range(8)))
            winners = [i for i, outcome in results if outcome == "AUTHORIZED"]
            check("eight actual HTTP requests across two agents admit exactly one shared-budget purchase",
                  len(winners) == 1 and sum(outcome == "PAYMENT_BUDGET" for _, outcome in results) == 7)
            winner = winners[0] % 2
            submit_id = "c" * 32
            submission = bound("SUBMIT")
            submitted = post(submission, agents[winner], submit_id)
            attempt = submitted["book"]["state"]["authority"]["payments"][0]["attempt_id"]
            denied("FORBIDDEN", lambda: post(bound("RESOLVE", fixture=True, outcome="SETTLED", receipt_id="f" * 32, actual_fee=2), agents[winner]))
            denied("SYNTHETIC_FIXTURE_REQUIRED", lambda: post(bound("RESOLVE", outcome="SETTLED", receipt_id="f" * 32, actual_fee=2), operator))
            check("agents cannot fabricate settlement and operator fixtures need an explicit synthetic marker", True)
            post(bound("RESOLVE", fixture=True, outcome="SETTLED", receipt_id="f" * 32, actual_fee=2), operator)
            fulfillment = bound("FULFILL", fixture=True, order_id="d" * 32)
            post(fulfillment, operator)
            check("repeated fulfillment observation retains one supplier order", post(fulfillment, operator)["outcome"] == "REPLAY")
            refund = bound("REFUND", fixture=True, receipt_id="e" * 32, amount=10)
            post(refund, operator)
            refunded = post(refund, operator)
            check("partial refund observations reconcile once without resetting lifetime allowance",
                  refunded["outcome"] == "REPLAY" and refunded["book"]["state"]["accounting"]["net_settled_principal"] == 50
                  and refunded["book"]["state"]["authority"]["totals"]["payment_remaining"] == 40)
            post(purchase(20, 30), agents[1 - winner])
            second = bound("SUBMIT", index=1)
            second_id = "b" * 32
            before = post(second, agents[1 - winner], second_id)
            second_attempt = before["book"]["state"]["authority"]["payments"][1]["attempt_id"]
            post(bound("RESOLVE", index=1, fixture=True, outcome="UNKNOWN", receipt_id=None, actual_fee=None), operator)
            logs.append(server.path.read_text())
            server.child.kill()
            server.child.wait(timeout=5)
        finally:
            server.stop()

        server = Running(state, folder)
        try:
            replayed = post(second, agents[1 - winner], second_id)
            check("killed service restarts with the same pending attempt and retained reservation",
                  replayed["replayed"] and replayed["book"]["state"]["authority"]["payments"][1]["attempt_id"] == second_attempt
                  and replayed["book"]["state"]["authority"]["totals"]["payment_reserved"] == 30)
            check("earlier submitted purchase still resolves to its original attempt", view()["state"]["authority"]["payments"][0]["attempt_id"] == attempt)
            post({"kind": "REVOKE"}, operator)
            stopped = post(purchase(21, 1), agents[winner])
            check("operator revocation blocks new purchase and preserves submitted uncertainty",
                  stopped["outcome"] == "AUTHORITY_REVOKED" and stopped["book"]["state"]["authority"]["totals"]["payment_reserved"] == 30)
            post(bound("RESOLVE", index=1, fixture=True, outcome="SETTLED", receipt_id="9" * 32, actual_fee=1), operator)
            final = view()
            check("late fixture settlement records gross/refunded/net principal and separate fees exactly",
                  final["state"]["accounting"] == {"gross_settled_principal": 90, "refunded_principal": 10,
                      "net_settled_principal": 80, "fee_spent": 3, "refunds_restore_spending_budget": False})
            backup = folder / "commerce-backup.sqlite3"
            audit = Store(state).audit()
            command("backup", "--state", state, "--out", backup)
            check("actual backup CLI retains a fully replayed audited ledger", json.loads(command("verify-backup", "--backup", backup).stdout)["audit"] == audit)
            logs.append(server.path.read_text())
            check("bearer secrets stay out of database, CLI and service logs",
                  all(token.encode() not in state.joinpath("community.sqlite3").read_bytes() and all(token not in log for log in logs) for token in tokens))
        finally:
            server.stop()
        with closing(Store(state)._connection()) as connection:
            row = connection.execute("SELECT * FROM commerce_books WHERE id=?", (book["id"],)).fetchone()
            actions = [json.loads(r[0]) for r in connection.execute("SELECT action_json FROM commerce_actions WHERE book_id=? ORDER BY sequence", (book["id"],))]
            report = model_run({"policy": json.loads(row["policy_json"]), "actions": actions})
        check("durable database commands reconstruct the complete offline report and independent accounting",
              report["final_state"] == final["state"] and inspect(report) == len(actions) + 1)
        restored, recovered_owner = folder / "restored", folder / "recovered-owner.json"
        command("restore", "--backup", backup, "--state", restored)
        command("recover-owner", "--state", restored, "--owner-file", recovered_owner, "--invalidate-all-credentials")
        server = Running(restored, folder)
        try:
            recovered = read_credential(recovered_owner)
            denied("UNAUTHORIZED", lambda: view(operator))
            restored_view = view(recovered)
            check("restore and credential-invalidating recovery preserve book state while refusing old access",
                  restored_view["state"] == final["state"] and restored_view["state_sha256"] == final["state_sha256"])
            Store(restored).audit()
        finally:
            server.stop()

        legacy_folder = folder / "legacy"
        legacy_folder.mkdir(mode=0o700)
        legacy, files, _ = create(legacy_folder)
        with closing(sqlite3.connect(legacy.path, autocommit=True)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            for version in (2, 3, 4, 5):
                for statement in (ROOT / "zoora_community" / f"migration_{version:03}.sql").read_text().split(";"):
                    if statement.strip():
                        connection.execute(statement)
            connection.execute("PRAGMA user_version=5")
            connection.execute("COMMIT")
        old = Store(legacy.state, _schema_version=5)
        with closing(old._connection()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            head = connection.execute("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()[0]
            old._event(connection, {"role": "OWNER", "principal_id": "owner"}, "SCHEMA_MIGRATE", "schema",
                       {"from": 1, "to": 5, "backup_audit_head": head}, old.clock())
            connection.execute("COMMIT")
        old_audit = old.audit()
        legacy_backup = folder / "before-schema-six.sqlite3"
        upgraded = json.loads(command("migrate", "--state", old.state, "--backup", legacy_backup).stdout)
        server = Running(old.state, legacy_folder)
        try:
            no_grants = server.client.request("GET", BASE, token=read_credential(files["agent"]))[1]
            with closing(sqlite3.connect(legacy_backup)) as connection:
                saved_version = connection.execute("PRAGMA user_version").fetchone()[0]
            check("actual schema-5 migration CLI preserves its audited backup and grants no spending automatically",
                  upgraded["schema_version"] == 6 and saved_version == 5 and not no_grants["items"]
                  and Store(old.state).audit()["audit_events"] == old_audit["audit_events"] + 1)
        finally:
            server.stop()
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "classification": "AUTOMATED_LOCAL_API_ACCEPTANCE", "economics": "SYNTHETIC",
                "schema_version": 6, "checks": checks, "transport": server.transport,
                "durable_commands": len(actions), "independently_checked_states": len(actions) + 1,
                "model_report_fingerprint": report["fingerprint"], "final_accounting": final["state"]["accounting"],
                "wallet_execution": False, "provider_integration": False, "transactions_submitted": 0,
                "public_deployment": False, "model_requests": 0}
    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    (output / "durable-commerce-report.json").write_text(canonical(report) + "\n", encoding="utf-8")
    (output / "durable-commerce.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(canonical(evidence))


if __name__ == "__main__":
    run()
