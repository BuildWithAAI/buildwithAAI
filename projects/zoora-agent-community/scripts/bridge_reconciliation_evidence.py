"""Actual CLI/local TLS, explicit v1 backup migration, discovery and recovery after expiry."""

from contextlib import closing
import copy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import uuid

from bridge_fixture import KEY, ROOT, ProviderFixture, intent, version_one_journal
from zoora_community.bridge_journal import JOURNAL_VERSION, LEASE_MS, RETRY_MS, BridgeJournal
from zoora_community.validation import canonical


def foreign(index):
    return {"id": str(uuid.UUID(int=index + 100)), "client_reference_id": "another-customer",
            "name": "PRIVATE OTHER CUSTOMER", "bank_account": "NEVER EXPOSE"}


def run():
    checks, outputs = [], []

    def check(name, value):
        if not value:
            raise AssertionError(name)
        checks.append(name)

    with tempfile.TemporaryDirectory(prefix="zoora-bridge-reconcile-") as name:
        folder = Path(name)
        state, key_file, intent_file = folder / "state", folder / "key", folder / "intent.json"
        key_file.write_text(KEY, encoding="ascii")
        key_file.chmod(0o600)
        at = 1_800_000_000_000
        expired = at + RETRY_MS + 1
        provider = ProviderFixture()
        with provider.serve():
            def cli(arguments, expected=0, stamp=at, crash=False):
                value = provider.cli(state, arguments, at=stamp, crash=crash)
                outputs.append(value.stdout + value.stderr)
                if value.returncode != expected:
                    raise AssertionError("Unexpected recovery CLI result: " + value.stderr)
                return json.loads(value.stdout) if value.stdout.strip() else json.loads(value.stderr) if value.stderr.strip() else None

            def prepare(index):
                intent_file.write_text(canonical(intent(index)), encoding="utf-8")
                return cli(["prepare", "--intent-file", intent_file])

            def operation(kind, index=1, transfer_id=None, **options):
                args = [kind, "--request-id", intent(index)["request_id"], "--key-file", key_file]
                if transfer_id:
                    args += ["--transfer-id", transfer_id]
                return cli(args, **options)

            prepared = prepare(1)
            provider.mode = "drop"
            unknown = operation("advance", expected=2)
            provider.mode = "ok"
            prepare(2)
            known = operation("advance", 2)
            operation("advance", 2)
            journal = BridgeJournal(state)
            version_one_journal(journal.path)
            before = len(provider.requests)
            refused = cli(["show", "--request-id", intent()["request_id"]], expected=1)
            check("schema-one journal refuses ordinary operations before network until explicitly migrated",
                  refused["error"] == "BRIDGE_JOURNAL_MIGRATION_REQUIRED" and len(provider.requests) == before)
            backup = folder / "before-v2.sqlite3"
            migration = cli(["migrate", "--backup", backup])
            with closing(sqlite3.connect(backup)) as connection:
                saved_schema = connection.execute("PRAGMA user_version").fetchone()[0]
                saved_attempts = connection.execute("SELECT COUNT(*) FROM attempts").fetchone()[0]
            check("actual migration CLI saves and pins the audited old schema before upgrade",
                  saved_schema == 1 and saved_attempts == 3 and migration["journal_schema_version"] == JOURNAL_VERSION
                  and migration["backup_sha256"] == hashlib.sha256(backup.read_bytes()).hexdigest())
            after = journal.show(intent()["request_id"])
            check("migration preserves uncertain original request key body and first-attempt time",
                  after["state"] == "UNKNOWN" and after["idempotency_key"] == prepared["idempotency_key"]
                  and after["body"] == unknown["body"] and after["first_attempt_ms"] == unknown["first_attempt_ms"])
            saved_known = journal.show(intent(2)["request_id"])
            check("migration retains a known transfer and backfills its historical poll target",
                  saved_known["observation"]["id"] == known["observation"]["id"]
                  and saved_known["last_candidate_id"] == known["observation"]["id"])

            transfer = copy.deepcopy(provider.effects[prepared["idempotency_key"]])
            before = len(provider.requests)
            stopped = operation("advance", expected=1, stamp=expired)
            check("expired unknown attempt cannot issue another POST", stopped["error"] == "BRIDGE_RETRY_WINDOW_CLOSED_RECONCILE_REQUIRED" and len(provider.requests) == before)
            provider.listing = [foreign(i) for i in range(20)] + [transfer]
            discovery = operation("discover", stamp=expired)
            check("actual read-only discovery finds the original candidate on page two",
                  discovery["candidate_ids"] == [transfer["id"]] and discovery["pages_scanned"] == 2
                  and discovery["records_scanned"] == 21)
            check("discovery does not attach a transfer or change the saved retry anchor",
                  journal.show(intent()["request_id"]) == after and not discovery["automatic_binding"]
                  and not discovery["may_authorize_new_post"])
            wrong = operation("reconcile", transfer_id=known["observation"]["id"], stamp=expired, expected=2)
            check("wrong transfer with different client reference cannot bind to the unknown intent",
                  wrong["state"] == "UNKNOWN" and wrong["last_attempt_error"] == "BRIDGE_RESPONSE_REJECTED" and wrong["observation"] is None)
            reconciled = operation("reconcile", transfer_id=transfer["id"], stamp=expired)
            check("explicit reconciliation binds matching saved terms through GET after retry closure",
                  reconciled["state"] == "OBSERVED" and reconciled["last_attempt_kind"] == "RECONCILE"
                  and reconciled["observation"]["id"] == transfer["id"] and reconciled["idempotency_key"] == prepared["idempotency_key"])
            polled = operation("advance", stamp=expired)
            check("subsequent advance reads the retained ID rather than recreating the payment",
                  polled["last_attempt_kind"] == "POLL" and provider.requests[-1]["method"] == "GET")

            prepared_three = prepare(3)
            provider.mode = "drop"
            operation("advance", 3, expected=2)
            provider.mode = "ok"
            third_id = provider.effects[prepared_three["idempotency_key"]]["id"]
            operation("reconcile", 3, transfer_id=third_id, stamp=expired, crash="poll", expected=80)
            crashed = journal.show(intent(3)["request_id"])
            check("actual process death after successful recovery GET retains its committed target and lease",
                  crashed["incomplete_attempt"] and crashed["last_candidate_id"] == third_id and crashed["state"] == "UNKNOWN")
            before = len(provider.requests)
            busy = operation("reconcile", 3, transfer_id=third_id, stamp=expired, expected=1)
            check("live recovery lease excludes another CLI process before HTTP",
                  busy["error"] == "BRIDGE_ATTEMPT_BUSY" and len(provider.requests) == before)
            recovered = operation("reconcile", 3, transfer_id=third_id, stamp=expired + LEASE_MS + 1)
            check("later CLI process recovers the exact target using only another GET",
                  recovered["observation"]["id"] == third_id and provider.requests[-1]["method"] == "GET")

            prepare(4)
            provider.mode = "drop"
            fourth = operation("advance", 4, expected=2)
            provider.mode = "ok"
            provider.listing = []
            empty = operation("discover", 4, stamp=expired)
            check("empty discovery remains explicitly inconclusive and leaves uncertainty unchanged",
                  empty["status"] == "NO_MATCH_IN_SCAN" and not empty["negative_result_proves_absence"]
                  and journal.show(intent(4)["request_id"]) == fourth)
            stopped = operation("advance", 4, stamp=expired, expected=1)
            check("negative lookup cannot reopen a closed POST retry window", stopped["error"] == "BRIDGE_RETRY_WINDOW_CLOSED_RECONCILE_REQUIRED")
            original = copy.deepcopy(provider.effects[fourth["idempotency_key"]])
            provider.listing = [original, {**original, "id": str(uuid.uuid4())}]
            ambiguous = operation("discover", 4, stamp=expired)
            check("multiple matching references are surfaced without choosing or binding one",
                  ambiguous["status"] == "MULTIPLE_CANDIDATES_IN_SCAN" and len(ambiguous["candidate_ids"]) == 2
                  and journal.show(intent(4)["request_id"]) == fourth)
            provider.listing = [foreign(i) for i in range(110)]
            bounded = operation("discover", 4, stamp=expired)
            check("discovery stops after five pages and exposes incomplete scan coverage",
                  bounded["pages_scanned"] == 5 and bounded["records_scanned"] == 100
                  and not bounded["scan_reached_short_page"] and not bounded["may_authorize_new_post"])

            with closing(sqlite3.connect(journal.path)) as connection:
                kinds = dict(connection.execute("SELECT kind,COUNT(*) FROM attempts GROUP BY kind"))
                count = connection.execute("SELECT COUNT(*) FROM intents").fetchone()[0]
                checkpoint = connection.execute("SELECT backup_sha256 FROM bridge_migrations").fetchone()[0]
                candidate_rows = connection.execute("SELECT candidate_id,observation_json FROM attempts WHERE kind='RECONCILE' AND error_code IS NULL AND finished_ms IS NOT NULL").fetchall()
            check("independent SQLite inspection reconciles creation poll and recovery histories",
                  kinds == {"CREATE": 4, "POLL": 2, "RECONCILE": 4} and count == 4
                  and checkpoint == migration["backup_sha256"]
                  and all(candidate == json.loads(observation)["id"] for candidate, observation in candidate_rows))
            check("no extra provider-fixture transfer is created by recovery discovery or lease replay",
                  len(provider.effects) == 4 and sum(r["method"] == "POST" for r in provider.requests) == 4)
            check("keys and other customers' private fields stay out of CLI and database",
                  all(all(secret not in output for secret in (KEY, "PRIVATE OTHER CUSTOMER", "NEVER EXPOSE")) for output in outputs)
                  and KEY.encode() not in journal.path.read_bytes() and KEY.encode() not in backup.read_bytes())
            check("recovery observations never claim wallet execution or verified settlement",
                  all(not value["wallet_execution"] and value["settlement_accounting"] == "UNAVAILABLE" for value in (reconciled, recovered, polled)))
            wire = [{"method": r["method"], "path": r["path"], "idempotency_header_present": "Idempotency-Key" in r["headers"]} for r in provider.requests]
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "classification": "LOCAL_HTTPS_RECONCILIATION_FIXTURE", "transport": "ACTUAL_VERIFIED_LOCAL_TLS",
                "clock": "INJECTED_FOR_EXPIRY_AND_LEASE_BOUNDARIES", "checks": checks,
                "journal_schema_version": JOURNAL_VERSION, "backup_schema_version": saved_schema, "migration": migration,
                "journal_intents": count, "attempt_kinds": kinds, "journal_attempts": sum(kinds.values()),
                "http_requests": len(wire), "post_requests": sum(r["method"] == "POST" for r in wire),
                "unique_fixture_transfers": len(provider.effects), "wire": wire,
                "external_bridge_requests": 0, "bridge_account_acceptance": "UNVERIFIED",
                "production_execution": False, "wallet_execution": False, "transactions_submitted": 0,
                "commerce_budget_integration": False, "settlement_accounting": "UNAVAILABLE"}
    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    (output / "bridge-reconciliation.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(canonical(evidence))


if __name__ == "__main__":
    run()
