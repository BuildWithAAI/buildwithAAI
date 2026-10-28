"""Actual CLI processes and local verified HTTPS; ZERO external Bridge requests."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import copy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile

from bridge_fixture import KEY, ROOT, ProviderFixture, intent
from zoora_community.bridge_journal import LEASE_MS, RETRY_MS, BridgeJournal
from zoora_community.validation import canonical


def run():
    checks = []

    def check(name, value):
        if not value:
            raise AssertionError(name)
        checks.append(name)

    with tempfile.TemporaryDirectory(prefix="zoora-bridge-contract-") as name:
        folder = Path(name)
        state, key_file, intent_file = folder / "sandbox", folder / "key", folder / "intent.json"
        key_file.write_text(KEY, encoding="ascii")
        key_file.chmod(0o600)
        at = 1_800_000_000_000
        provider = ProviderFixture()
        with provider.serve():
            outputs = []

            def cli(args, expected=0, stamp=at, crash=False):
                result = provider.cli(state, args, at=stamp, crash=crash)
                outputs.append(result.stdout + result.stderr)
                if result.returncode != expected:
                    raise AssertionError("Unexpected test CLI result: " + result.stderr)
                return json.loads(result.stdout) if result.stdout.strip() else None

            def prepare(index):
                intent_file.write_text(canonical(intent(index)), encoding="utf-8")
                return cli(["prepare", "--intent-file", intent_file])

            def advance(index=1, **changes):
                return cli(["advance", "--request-id", intent(index)["request_id"], "--key-file", key_file], **changes)

            prepared = prepare(1)
            check("actual CLI prepares and reopens one immutable intent without network", prepare(1) == prepared and not provider.requests)
            intent_file.write_text(canonical({**intent(), "amount_usdc": "99"}), encoding="utf-8")
            cli(["prepare", "--intent-file", intent_file], expected=1)
            check("changed terms under one request identity refuse before HTTP", not provider.requests)
            provider.mode = "drop"
            unknown = advance(expected=2)
            check("lost HTTPS acknowledgment leaves the persisted intent uncertain", unknown["state"] == "UNKNOWN" and len(provider.effects) == 1)
            provider.mode = "ok"
            recovered = advance(stamp=at + 1000)
            check("new CLI process retries exact bytes and the original key with one fixture effect",
                  recovered["state"] == "OBSERVED" and len(provider.effects) == 1
                  and provider.requests[0]["body"] == provider.requests[1]["body"]
                  and provider.requests[0]["headers"]["Idempotency-Key"] == provider.requests[1]["headers"]["Idempotency-Key"])
            check("wire request has sandbox authentication and explicit Solana USDC terms",
                  provider.requests[0]["headers"]["Api-Key"] == KEY
                  and json.loads(provider.requests[0]["body"])["amount"] == "12.500001"
                  and json.loads(provider.requests[0]["body"])["source"]["payment_rail"] == "solana")
            provider.effects[recovered["idempotency_key"]]["state"] = "payment_processed"
            later = at + 26 * 60 * 60 * 1000
            observed = advance(stamp=later)
            check("known transfer is read-only polled beyond the POST retry window",
                  provider.requests[-1]["method"] == "GET" and "Idempotency-Key" not in provider.requests[-1]["headers"]
                  and observed["observation"]["id"] == recovered["observation"]["id"])
            check("provider processed label never credits the commerce ledger or claims wallet execution",
                  observed["observation"]["state"] == "payment_processed"
                  and not observed["commerce_budget_integration"] and not observed["wallet_execution"]
                  and observed["settlement_accounting"] == "UNAVAILABLE")
            wrong = copy.deepcopy(provider.effects[recovered["idempotency_key"]])
            wrong["destination"]["currency"] = "sol"
            provider.body_override = canonical(wrong).encode()
            refused = advance(stamp=later + 1, expected=2)
            check("mismatched provider terms retain prior evidence and flag latest uncertainty",
                  refused["state"] == "UNKNOWN" and refused["last_attempt_error"] == "BRIDGE_RESPONSE_REJECTED"
                  and refused["observation"] == observed["observation"])
            provider.status = 500
            provider.body_override = ("DO NOT EXPOSE " + KEY).encode()
            failed_poll = advance(stamp=later + 2, expected=2)
            check("failed read-only poll retains evidence and exposes no provider error body",
                  failed_poll["state"] == "UNKNOWN" and failed_poll["last_attempt_error"] == "BRIDGE_HTTP_500"
                  and failed_poll["observation"] == observed["observation"] and provider.requests[-1]["method"] == "GET")
            provider.body_override = None
            provider.status = 200

            crash_prepared = prepare(2)
            advance(2, expected=79, crash=True)
            pending = cli(["show", "--request-id", intent(2)["request_id"]])
            check("actual abrupt CLI exit after HTTPS acceptance retains a committed unfinished attempt",
                  pending["state"] == "UNKNOWN" and pending["incomplete_attempt"] and len(provider.effects) == 2)
            before = len(provider.requests)
            advance(2, expected=1)
            check("unexpired process lease refuses a second dispatch", len(provider.requests) == before)
            after = advance(2, stamp=at + LEASE_MS + 1)
            check("expired lease resumes the same intent without another fixture transfer",
                  after["state"] == "OBSERVED" and after["idempotency_key"] == crash_prepared["idempotency_key"]
                  and len(provider.effects) == 2)

            prepare(3)
            provider.mode = "drop"
            advance(3, expected=2)
            provider.mode = "ok"
            before = len(provider.requests)
            advance(3, stamp=at + RETRY_MS, expected=1)
            check("uncertain intent at conservative 23-hour boundary cannot be recreated", len(provider.requests) == before)

            prepare(4)
            provider.mode = "block"
            provider.entered.clear()
            with ThreadPoolExecutor(max_workers=1) as pool:
                first = pool.submit(advance, 4)
                if not provider.entered.wait(timeout=5):
                    raise AssertionError("No fixture request")
                before = len(provider.requests)
                advance(4, expected=1)
                provider.release.set()
                complete = first.result(timeout=10)
            provider.mode = "ok"
            check("two actual CLI processes cannot own one active dispatch", len(provider.requests) == before and complete["state"] == "OBSERVED")

            key_file.write_text(KEY + "-different-account", encoding="ascii")
            before = len(provider.requests)
            advance(4, expected=1)
            check("changed sandbox credential cannot silently cross provider accounts", len(provider.requests) == before)
            key_file.write_text(KEY, encoding="ascii")
            journal = BridgeJournal(state)
            with closing(sqlite3.connect(journal.path)) as connection:
                rows = connection.execute("SELECT id,body_json,body_sha256 FROM intents ORDER BY id").fetchall()
                attempts = connection.execute("SELECT COUNT(*) FROM attempts").fetchone()[0]
                for request_id, body_json, body_hash in rows:
                    if hashlib.sha256(body_json.encode()).hexdigest() != body_hash:
                        raise AssertionError("Independent body digest mismatch")
                    if json.loads(body_json) != journal.show(request_id)["body"]:
                        raise AssertionError("Independent saved payload mismatch")
            check("independent SQLite inspection binds all four saved payload digests and attempt count", len(rows) == 4 and attempts == 9)
            check("public fixture bearer key stays out of CLI output and durable database",
                  all(KEY not in value for value in outputs) and KEY.encode() not in journal.path.read_bytes())
            wire = [{"method": r["method"], "path": r["path"],
                     "body_sha256": hashlib.sha256(r["body"].encode()).hexdigest() if r["body"] else None,
                     "idempotency_key": r["headers"].get("Idempotency-Key")} for r in provider.requests]
            check("all requests stay in the fixed transfer API contract", all(r["path"].startswith("/v0/transfers") for r in wire))
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "classification": "LOCAL_HTTPS_PROVIDER_CONTRACT_FIXTURE", "checks": checks,
                "transport": "ACTUAL_VERIFIED_LOCAL_TLS", "clock": "INJECTED_FOR_LEASE_AND_RETRY_BOUNDARIES",
                "journal_intents": len(rows), "journal_attempts": attempts,
                "http_requests": len(wire), "unique_fixture_transfers": len(provider.effects),
                "wire": wire, "external_bridge_requests": 0, "bridge_account_acceptance": "UNVERIFIED",
                "production_execution": False, "wallet_execution": False, "transactions_submitted": 0,
                "commerce_budget_integration": False, "settlement_accounting": "UNAVAILABLE"}
    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    (output / "bridge-sandbox.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(canonical(evidence))


if __name__ == "__main__":
    run()
