"""Actual coordinated-package CLI, five checkpoints and GET-only interrupted recovery."""

from contextlib import closing, redirect_stdout
import hashlib
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import zipfile

from bridge_fixture import KEY, ROOT, intent
from payment_pipeline_evidence import run as connected_rehearsal
from zoora_community.payment_pipeline import LEASE_MS
from zoora_community.validation import canonical


def run():
    checks, checkpoints, outputs, records = [], {}, [], {}

    def check(label, condition):
        if not condition:
            raise AssertionError(label)
        checks.append(label)

    def checkpoint(label, context):
        path = context["folder"] / (label + ".zip")
        before = len(context["provider"].requests)
        result = context["provider"].pipeline_cli(context["pipeline"].state, ["backup", "--output", path], at=context["at"])
        if result.returncode != 0:
            raise AssertionError("checkpoint backup failed: " + result.stderr)
        saved = json.loads(result.stdout)
        checkpoints[label] = {"path": path, "saved": saved, "order_id": context["order_id"], "at": context["at"]}
        check("actual backup succeeds at " + label + " without a provider request",
              saved["backup_sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
              and len(context["provider"].requests) == before)

    def finish(context):
        folder, pipeline, provider = context["folder"], context["pipeline"], context["provider"]
        at = context["at"] + 2 * LEASE_MS + 1
        boundary = len(provider.requests)

        def cli(args, *, target=pipeline.state, expected=0, crash="normal", stamp=at):
            result = provider.pipeline_cli(target, args, at=stamp, crash=crash)
            outputs.append(result.stdout + result.stderr)
            if result.returncode != expected:
                raise AssertionError("unexpected recovery CLI result: " + result.stderr)
            return json.loads(result.stdout or result.stderr) if result.stdout or result.stderr else None

        def restore(saved, target, *, crash="normal", expected=0, stamp=at):
            return cli(["restore", "--backup", saved["path"], "--sha256", saved["saved"]["backup_sha256"]],
                       target=target, crash=crash, expected=expected, stamp=stamp)

        def recover(target, key, *, transfer=None, expected=0, crash="normal", stamp=at):
            args = ["recover", "--order-id", key, "--key-file", context["key"]]
            if transfer:
                args += ["--transfer-id", transfer]
            return cli(args, target=target, expected=expected, crash=crash, stamp=stamp)

        audited = cli(["joint-audit"])
        full = folder / "complete-payment.zip"
        saved = cli(["backup", "--output", full])
        verified = cli(["verify-backup", "--backup", full, "--sha256", saved["backup_sha256"]])
        check("joint audit links ten queue orders nine provider intents and twelve complete-history attempts",
              audited == saved["audit"] == verified["audit"] and audited["orders"] == 10
              and audited["provider"]["journal_intents"] == 9 and audited["provider"]["journal_attempts"] == 12)
        check("snapshot audit conserves thirteen admitted USDC and every claim and fence",
              audited["admitted_principal_usdc"] == "13.000000" and audited["claims"] == 17
              and audited["unfinished_claims"] == 4 and audited["dispatch_fences"] == 9)
        with zipfile.ZipFile(full) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            member_hashes = {name: hashlib.sha256(archive.read(name)).hexdigest() for name in manifest["files"]}
            raw_members = b"".join(archive.read(name) for name in archive.namelist())
        check("independent archive bytes match both database pins and exclude all bearer and API secrets",
              member_hashes == manifest["files"] and all(token.encode() not in raw_members for token in [KEY, *context["tokens"]]))
        check("audit backup verification and five earlier checkpoints performed no provider HTTP",
              len(provider.requests) == boundary)
        unchanged = full.read_bytes()
        check("exclusive backup refuses overwrite and preserves the original exact bytes",
              cli(["backup", "--output", full], expected=1)["error"] == "PIPELINE_BACKUP_EXISTS" and full.read_bytes() == unchanged)
        wrong = folder / "wrong-pin"
        check("an incorrect outer pin refuses restore without publishing any state",
              cli(["restore", "--backup", full, "--sha256", "0" * 64], target=wrong, expected=1)["error"] == "PIPELINE_BACKUP_HASH_MISMATCH"
              and not wrong.exists())
        # Stop the actual source process: every subsequent recovery command must stand alone.
        source_path = folder / "community/community.sqlite3"
        source_before = hashlib.sha256(source_path.read_bytes()).hexdigest()
        context["running"].stop()

        stale_target = folder / "stale-recovered"
        stale = restore(checkpoints["before_dispatch"], stale_target)
        stale_order = stale["audit"]["inventory"][0]["order_id"]
        refused = cli(["run-one", "--order-id", stale_order, "--key-file", context["key"],
            "--credential-file", context["agent_file"], "--port", context["running"].port], target=stale_target, expected=1)
        check("an old snapshot predating four actual transfers refuses normal dispatch before accessing the stopped source",
              refused["error"] == "PIPELINE_RESTORED_READ_ONLY" and stale["pipeline_mode"] == stale["provider_mode"] == "RECOVERY_ONLY")
        stale_result = recover(stale_target, stale_order, expected=2)
        check("a restored pre-attempt instruction remains unsubmitted without any replacement POST",
              stale_result["code"] == "PIPELINE_RECOVERY_REQUIRES_ATTEMPT" and len(provider.requests) == boundary)
        check("migration cannot reactivate a restored queue",
              cli(["migrate", "--backup", checkpoints["before_dispatch"]["path"], "--sha256",
                   checkpoints["before_dispatch"]["saved"]["backup_sha256"]], target=stale_target, expected=1)["error"] == "PIPELINE_MIGRATION_NOT_REQUIRED")

        restored_records = []
        for label in ("submit", "create", "fence", "finish"):
            saved_checkpoint = checkpoints[label]
            target = folder / ("recovered-" + label)
            restored = restore(saved_checkpoint, target, stamp=saved_checkpoint["at"])
            key = saved_checkpoint["order_id"]
            check("restoring " + label + " preserves original keys bodies and historical claims",
                  restored["snapshot_audit"] == saved_checkpoint["saved"]["audit"]
                  and restored["audit"]["inventory"] == saved_checkpoint["saved"]["audit"]["inventory"]
                  and restored["audit"]["admitted_principal_usdc"] == saved_checkpoint["saved"]["audit"]["admitted_principal_usdc"])
            first = len(provider.requests)
            lease = recover(target, key, expected=1, stamp=saved_checkpoint["at"])
            check("restored live queue lease at " + label + " excludes a second recovery worker before HTTP",
                  lease["error"] == "PIPELINE_ORDER_BUSY" and len(provider.requests) == first)
            candidate_ids = []
            if label in {"submit", "fence"}:
                outcome = recover(target, key, expected=2)
                check("pre-provider " + label + " restore cannot initiate a first create",
                      outcome["code"] == "PIPELINE_RECOVERY_REQUIRES_ATTEMPT" and len(provider.requests) == first)
            elif label == "create":
                discovery = recover(target, key, expected=2)
                candidate_ids = discovery["candidate_ids"]
                check("accepted but unrecorded snapshot requires bounded GET discovery without binding automatically",
                      discovery["phase"] == "RECONCILIATION_REQUIRED" and len(candidate_ids) == 1)
                outcome = recover(target, key, transfer=candidate_ids[0])
                check("explicit matching-ID GET reconciles the interrupted accepted transfer",
                      outcome["phase"] == "PROVIDER_OBSERVED" and outcome["transfer_id"] == candidate_ids[0])
            else:
                outcome = recover(target, key)
                check("provider-persisted snapshot resumes through the original exact transfer GET",
                      outcome["phase"] == "PROVIDER_OBSERVED" and provider.requests[-1]["method"] == "GET")
            restored_records.append({"checkpoint": label, "order_id": key,
                "snapshot_audit": restored["snapshot_audit"], "restored_audit": cli(["joint-audit"], target=target),
                "outcome": outcome, "candidate_ids": candidate_ids, "request_start": first, "request_end": len(provider.requests)})

        complete = {"path": full, "saved": saved}
        partial = folder / "interrupted-partial"
        restore(complete, partial, crash="restore-partial", expected=86)
        check("actual exit 86 after provider publication exposes only its recovery-only DB and no queue",
              (partial / "provider/bridge-sandbox.sqlite3").is_file() and not (partial / "payment-pipeline.sqlite3").exists()
              and cli(["show"], target=partial, expected=1)["error"] == "STATE_UNAVAILABLE")
        input_file = folder / "new-intent.json"
        input_file.write_text(canonical(intent(99)), encoding="utf-8")
        raw = provider.cli(partial / "provider", ["prepare", "--intent-file", input_file], at=at)
        check("partially published provider DB refuses new intents through the standalone provider CLI",
              raw.returncode == 1 and json.loads(raw.stderr)["error"] == "BRIDGE_RESTORED_JOURNAL_READ_ONLY")
        complete_target = folder / "interrupted-complete"
        restore(complete, complete_target, crash="restore-published", expected=87)
        complete_audit = cli(["joint-audit"], target=complete_target)
        check("actual exit 87 after complete publication leaves both durable modes recovery-only",
              complete_audit["pipeline_mode"] == complete_audit["provider"]["journal_mode"] == "RECOVERY_ONLY")
        known = next(row for row in complete_audit["inventory"] if row["known_transfer_id"])
        recover(complete_target, known["order_id"], crash="finish", expected=85)
        check("actual recovery exit 85 retains provider GET evidence and an unfinished queue claim",
              cli(["joint-audit"], target=complete_target)["unfinished_claims"] == 5)
        recover(complete_target, known["order_id"], stamp=at + LEASE_MS + 1)
        recovered_audit = cli(["joint-audit"], target=complete_target)
        check("later recovery process polls the same transfer while lifetime admission remains thirteen",
              recovered_audit["admitted_principal_usdc"] == "13.000000"
              and recovered_audit["provider"]["journal_attempts"] == 14 and recovered_audit["unfinished_claims"] == 5)

        legacy = folder / "legacy-fixture"
        (legacy / "provider").mkdir(mode=0o700, parents=True)
        legacy.chmod(0o700)
        for member in ("payment-pipeline.sqlite3", "provider/bridge-sandbox.sqlite3"):
            shutil.copyfile(pipeline.state / member, legacy / member)
            (legacy / member).chmod(0o600)
        with closing(sqlite3.connect(legacy / "payment-pipeline.sqlite3", autocommit=True)) as connection:
            connection.execute("DROP TABLE pipeline_recovery")
            connection.execute("PRAGMA user_version=1")
        check("schema-1 fixture refuses implicit activation in the new worker",
              cli(["show"], target=legacy, expected=1)["error"] == "PIPELINE_MIGRATION_REQUIRED")
        legacy_package = folder / "legacy.zip"
        legacy_saved = cli(["backup", "--output", legacy_package], target=legacy)
        migrated = cli(["migrate", "--backup", legacy_package, "--sha256", legacy_saved["backup_sha256"]], target=legacy)
        check("explicit migration is backed by an exact verified queue-provider package and preserves all bindings",
              migrated["from_schema"] == 1 and migrated["pipeline_schema_version"] == 2
              and migrated["audit"]["pipeline_mode"] == "ACTIVE"
              and migrated["audit"]["inventory"] == legacy_saved["audit"]["inventory"])

        wire = [{"method": r["method"], "path": r["path"], "idempotency_key": r["headers"].get("Idempotency-Key"),
            "body_sha256": hashlib.sha256(r["body"].encode()).hexdigest() if r["body"] is not None else None} for r in provider.requests]
        check("every request after the backup boundary is GET-only and the original eight fixture transfers stay unique",
              all(r["method"] == "GET" for r in wire[boundary:]) and len(wire) == 29 and len(provider.effects) == 8
              and sum(r["method"] == "POST" for r in wire) == 8)
        check("source database remains byte-for-byte unchanged while its service is stopped",
              hashlib.sha256(source_path.read_bytes()).hexdigest() == source_before)
        check("private output and backup contain no bearer credential or sandbox API key",
              all(secret not in output for output in outputs for secret in [KEY, *context["tokens"]]))
        output = ROOT / "evidence-output"
        shutil.copyfile(full, output / "payment-recovery-fixture.zip")
        (output / "payment-recovery-fixture.zip").chmod(0o600)
        for label, value in checkpoints.items():
            with zipfile.ZipFile(value["path"]) as archive:
                raw = b"".join(archive.read(name) for name in archive.namelist())
            if any(token.encode() in raw for token in [KEY, *context["tokens"]]):
                raise AssertionError("fixture checkpoint contained a credential")
            target = output / ("payment-recovery-checkpoint-" + label + ".zip")
            shutil.copyfile(value["path"], target)
            target.chmod(0o600)
        records.update({"source_snapshot_audit": audited, "package_sha256": saved["backup_sha256"], "package_member_sha256": member_hashes,
            "checkpoint_restores": restored_records, "publication_process_deaths": [86, 87], "recovery_process_death": 85,
            "final_restored_audit": recovered_audit, "migration": migrated, "source_db_unchanged": True,
            "recovery_boundary": boundary, "wire": wire, "fixture_bindings": context["bindings"]})

    with redirect_stdout(io.StringIO()):
        base = connected_rehearsal(after_rehearsal=finish, recovery_checkpoint=checkpoint)
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
        "classification": "CONNECTED_PAYMENT_RECOVERY_PACKAGE_LOCAL_FIXTURE", "checks": checks,
        "base_pipeline_checks": len(base["checks"]), "base_process_deaths": base["crashes"],
        "checkpoints": {label: {"backup_sha256": value["saved"]["backup_sha256"], "audit": value["saved"]["audit"],
            "order_id": value["order_id"]} for label, value in checkpoints.items()}, **records,
        "external_bridge_requests": 0, "wallet_execution": False, "real_funds_authorized": False,
        "settlement_accounting": "UNAVAILABLE", "source_state_included": False, "credentials_included": False}
    (ROOT / "evidence-output/payment-recovery.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    audited = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error", "scripts/payment_recovery_audit.py",
        "--report", "evidence-output/payment-recovery.json", "--fixture", "evidence-output/payment-recovery-fixture.zip",
        "--source-sha", evidence["source_head_sha"], "--self-test"], cwd=ROOT, capture_output=True, text=True, timeout=30)
    if audited.returncode != 0:
        raise AssertionError("independent package audit failed: " + audited.stderr)
    evidence["independent_audit"] = json.loads(audited.stdout)
    (ROOT / "evidence-output/payment-recovery.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(canonical(evidence))


if __name__ == "__main__":
    run()
