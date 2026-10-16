"""Actual separate-process customer checks over verified local TLS; zero external calls."""

import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile

from bridge_fixture import KEY, ROOT, ProviderFixture, customer, intent
from zoora_community.bridge_journal import RETRY_MS, BridgeJournal
from zoora_community.validation import canonical


def run():
    checks, outputs, cases = [], [], []

    def check(name, passed):
        if not passed:
            raise AssertionError(name)
        checks.append(name)

    with tempfile.TemporaryDirectory(prefix="zoora-bridge-preflight-") as name:
        folder = Path(name)
        key = folder / "key"
        key.write_text(KEY, encoding="ascii")
        key.chmod(0o600)
        provider = ProviderFixture()
        with provider.serve():
            def cli(args, expected=0, state=None, at=1_800_000_000_000, parser_error=False):
                result = provider.cli(state, args, at=at)
                outputs.append(result.stdout + result.stderr)
                if result.returncode != expected:
                    raise AssertionError("Unexpected preflight CLI result: " + result.stderr)
                return {"parser_error": True} if parser_error else json.loads(result.stdout or result.stderr)

            def preflight(label, expected=0, *, customer_id=None, key_path=key, state=None, parser_error=False):
                customer_id = intent()["customer_id"] if customer_id is None else customer_id
                before, effects = len(provider.requests), len(provider.effects)
                result = cli(["preflight", "--customer-id", customer_id, "--key-file", key_path],
                    expected, state=state, parser_error=parser_error)
                cases.append({"case": label, "exit_code": expected, "request_start": before,
                    "request_end": len(provider.requests), "fixture_effects_before": effects,
                    "fixture_effects_after": len(provider.effects), "result": result})
                return result

            observed = preflight("documented-current-shape")
            check("actual CLI observes the exact customer through GET without requiring a state directory",
                  observed["assessment"] == "CUSTOMER_SIGNALS_OBSERVED" and list(folder.iterdir()) == [key]
                  and provider.requests[0]["path"] == "/v0/customers/" + intent()["customer_id"])
            check("report retains raw-response hash and credential fingerprint without a bearer key",
                  observed["response_sha256"] == hashlib.sha256(canonical(customer()).encode()).hexdigest()
                  and observed["credential_sha256"] == hashlib.sha256(b"ZOORA_BRIDGE_SANDBOX_KEY_V1\0" + KEY.encode()).hexdigest()
                  and observed["kyc_status"] is None)
            check("observed customer signals confer no payment route rotation wallet or settlement authority",
                  all(observed[field] is False for field in ("may_authorize_new_post", "credential_rotation_authorized",
                      "provider_account_continuity_verified", "solana_usdc_route_verified", "wallet_execution"))
                  and observed["settlement_accounting"] == "UNAVAILABLE")

            provider.customer["status"] = "paused"
            blocked = preflight("paused-account", 2)
            check("actual CLI reports a paused account as blocked with exit two", blocked["blocking_fields"] == ["customer_status"])
            provider.customer = customer()
            del provider.customer["status"]
            incomplete = preflight("missing-status", 2)
            check("missing customer status stays incomplete instead of inheriting endorsement approval",
                  incomplete["assessment"] == "CUSTOMER_SIGNALS_INCOMPLETE" and incomplete["missing_fields"] == ["customer_status"])
            provider.customer = {**customer(), "kyc_status": "rejected"}
            conflict = preflight("conflicting-legacy-kyc", 2)
            check("explicit conflicting legacy KYC blocks an otherwise active approved customer", conflict["blocking_fields"] == ["kyc_status"])
            provider.customer = {**customer(), "has_accepted_terms_of_service": False}
            check("unaccepted terms block without automatically accepting them",
                  preflight("terms-not-accepted", 2)["blocking_fields"] == ["terms_accepted"])
            provider.customer = {**customer(), "endorsements": []}
            check("missing base endorsement is incomplete despite active deprecated capabilities",
                  preflight("missing-base", 2)["assessment"] == "CUSTOMER_SIGNALS_INCOMPLETE")
            provider.customer = customer()
            provider.customer["endorsements"][0]["requirements"]["issues"] = [{"developer_reason": "PRIVATE ISSUE"}]
            check("outstanding requirements block even when the base status says approved",
                  preflight("contradictory-requirements", 2)["blocking_fields"] == ["base_requirements_clear"])
            provider.customer = customer()
            provider.customer["endorsements"].append(copy.deepcopy(provider.customer["endorsements"][0]))
            check("duplicate endorsement claims are rejected rather than selecting an approval",
                  preflight("duplicate-base", 1)["error"] == "BRIDGE_CUSTOMER_RESPONSE_REJECTED")
            provider.customer = {**customer(), "id": "00000000-0000-0000-0000-000000000002"}
            check("different returned customer ID is rejected", preflight("wrong-customer", 1)["error"] == "BRIDGE_CUSTOMER_RESPONSE_REJECTED")
            provider.customer = {**customer(), "status": "PRIVATE UNKNOWN STATUS"}
            unknown = preflight("unrecognized-status", 2)
            check("unknown provider status is blocked and replaced by a fixed redacted marker",
                  unknown["customer_status"] == "UNRECOGNIZED" and unknown["assessment"] == "CUSTOMER_SIGNALS_BLOCKED")

            provider.customer = customer()
            provider.body_override = ("PRIVATE ERROR " + KEY).encode()
            provider.status = 401
            check("authentication failure returns a fixed error without reflecting the provider body",
                  preflight("unauthorized", 1) == {"error": "BRIDGE_HTTP_401"})
            provider.status = 302
            check("redirect is refused without following the production Location header",
                  preflight("redirect", 1) == {"error": "BRIDGE_HTTP_302"})
            provider.status = 200
            provider.body_override = b'{"id":1,"id":2}'
            check("duplicate-field JSON cannot become a customer observation",
                  preflight("duplicate-json", 1) == {"error": "BRIDGE_RESPONSE_REJECTED"})
            provider.body_override = b" " * 65_537
            check("customer response size is bounded before projection",
                  preflight("oversized-response", 1) == {"error": "BRIDGE_RESPONSE_TOO_LARGE"})
            provider.body_override = None
            before = len(provider.requests)
            check("invalid requested customer ID is rejected before HTTP",
                  preflight("invalid-local-id", 1, customer_id="../transfers")["error"] == "INVALID_BRIDGE_ID"
                  and len(provider.requests) == before)
            bad_key = folder / "production-shaped-key"
            bad_key.write_text("sk-live-PUBLIC-INVALID-FIXTURE-KEY", encoding="ascii")
            bad_key.chmod(0o600)
            check("production-shaped key is refused before HTTP",
                  preflight("production-key-rejected", 1, key_path=bad_key)["error"] == "BRIDGE_SANDBOX_KEY_REQUIRED"
                  and len(provider.requests) == before)
            forbidden = folder / "must-not-exist"
            preflight("state-argument-rejected", 2, state=forbidden, parser_error=True)
            check("preflight refuses a state argument before touching the requested directory or network",
                  not forbidden.exists() and len(provider.requests) == before)
            check("all standalone checks leave no payment database or fixture transfer",
                  not list(folder.rglob("*.sqlite3")) and not provider.effects)

            # Establish a genuinely credential-bound unknown intent in a separate scenario.
            state, input_file = folder / "original", folder / "intent.json"
            input_file.write_text(canonical(intent()), encoding="utf-8")
            cli(["prepare", "--intent-file", input_file], state=state)
            provider.mode = "drop"
            cli(["advance", "--request-id", intent()["request_id"], "--key-file", key], 2, state=state)
            provider.mode = "ok"
            journal = BridgeJournal(state)
            original_audit = journal.audit()
            original_hash = hashlib.sha256(journal.path.read_bytes()).hexdigest()
            alternate_key = folder / "alternate-key"
            alternate_key.write_text(KEY + "X", encoding="ascii")
            alternate_key.chmod(0o600)
            preflight("alternate-credential-observed", key_path=alternate_key)
            before = len(provider.requests)
            rotated = cli(["advance", "--request-id", intent()["request_id"], "--key-file", alternate_key], 1, state=state)
            check("successful read under another key cannot rotate a saved payment credential",
                  rotated["error"] == "BRIDGE_CREDENTIAL_CHANGED_RECONCILE_REQUIRED" and len(provider.requests) == before)
            expired = cli(["advance", "--request-id", intent()["request_id"], "--key-file", key], 1,
                state=state, at=1_800_000_000_000 + RETRY_MS + 1)
            check("customer observation cannot reopen an expired uncertain POST",
                  expired["error"] == "BRIDGE_RETRY_WINDOW_CLOSED_RECONCILE_REQUIRED" and len(provider.requests) == before)
            original_after = journal.audit()
            original_hash_after = hashlib.sha256(journal.path.read_bytes()).hexdigest()
            check("preflight and refused retries leave original journal bytes and audited history unchanged",
                  original_audit == original_after and original_hash == original_hash_after)

            snapshot, restored = folder / "snapshot.sqlite3", folder / "restored"
            saved = cli(["backup", "--output", snapshot], state=state)
            cli(["restore", "--backup", snapshot, "--sha256", saved["backup_sha256"]], state=restored)
            recovered = BridgeJournal(restored)
            restored_audit = recovered.audit()
            restored_hash = hashlib.sha256(recovered.path.read_bytes()).hexdigest()
            preflight("observation-alongside-recovery-only-state")
            restored_after = recovered.audit()
            restored_hash_after = hashlib.sha256(recovered.path.read_bytes()).hexdigest()
            check("customer observation cannot change recovery-only journal mode or bytes",
                  restored_audit == restored_after and restored_hash == restored_hash_after
                  and restored_after["journal_mode"] == "RECOVERY_ONLY")

            wire = [{"method": r["method"], "path": r["path"], "body_present": r["body"] is not None,
                "idempotency_header_present": "Idempotency-Key" in r["headers"]} for r in provider.requests]
            customer_wire = [r for r in wire if r["path"].startswith("/v0/customers/")]
            check("every customer request is exact-ID GET without body or idempotency header",
                  all(r == {"method": "GET", "path": "/v0/customers/" + intent()["customer_id"],
                      "body_present": False, "idempotency_header_present": False} for r in customer_wire))
            check("every preflight case preserves the number of fixture transfer effects",
                  all(c["fixture_effects_before"] == c["fixture_effects_after"] for c in cases)
                  and len(provider.effects) == 1 and sum(r["method"] == "POST" for r in wire) == 1)
            check("CLI outputs exclude API keys customer PII internal reasons and requirement contents",
                  all(all(secret not in output for secret in (KEY, "PRIVATE", "developer_reason", "capabilities")) for output in outputs))
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
        "classification": "LOCAL_HTTPS_CUSTOMER_PREFLIGHT_FIXTURE", "transport": "ACTUAL_VERIFIED_LOCAL_TLS",
        "checks": checks, "preflight_cases": cases, "http_requests": len(wire),
        "customer_get_requests": len(customer_wire), "post_requests": sum(r["method"] == "POST" for r in wire),
        "preflight_post_requests": 0, "unique_fixture_transfers": len(provider.effects), "wire": wire,
        "original_journal": {"before": original_audit, "after": original_after,
            "before_file_sha256": original_hash, "after_file_sha256": original_hash_after},
        "restored_journal": {"before": restored_audit, "after": restored_after,
            "before_file_sha256": restored_hash, "after_file_sha256": restored_hash_after},
        "external_bridge_requests": 0, "provider_account_acceptance": "UNVERIFIED",
        "production_execution": False, "wallet_execution": False, "transactions_submitted": 0,
        "solana_usdc_route_verified": False, "credential_rotation_authorized": False,
        "commerce_budget_integration": False, "settlement_accounting": "UNAVAILABLE"}
    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    (output / "bridge-preflight.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(canonical(evidence))


if __name__ == "__main__":
    run()
