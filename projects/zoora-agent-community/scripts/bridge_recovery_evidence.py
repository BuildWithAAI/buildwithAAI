"""Actual CLI/local TLS: stale snapshots, recovery-only restore, crash and v2 upgrade."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile

from bridge_fixture import KEY, ROOT, ProviderFixture, intent
from zoora_community.bridge_journal import JOURNAL_VERSION, LEASE_MS
from zoora_community.bridge_sandbox import sha
from zoora_community.validation import canonical


def run():
    checks, outputs = [], []

    def check(name, passed):
        if not passed:
            raise AssertionError(name)
        checks.append(name)

    with tempfile.TemporaryDirectory(prefix="zoora-bridge-snapshot-") as name:
        folder = Path(name)
        state, recovered = folder / "source", folder / "recovered"
        key, input_file = folder / "key", folder / "intent.json"
        key.write_text(KEY, encoding="ascii")
        key.chmod(0o600)
        at = 1_800_000_000_000
        later = at + 2 * LEASE_MS + 2
        provider = ProviderFixture()
        with provider.serve():
            def cli(arguments, *, target=state, expected=0, stamp=at, crash=False):
                result = provider.cli(target, arguments, at=stamp, crash=crash)
                outputs.append(result.stdout + result.stderr)
                if result.returncode != expected:
                    raise AssertionError("Unexpected snapshot CLI result: " + result.stderr)
                return json.loads(result.stdout) if result.stdout.strip() else json.loads(result.stderr) if result.stderr.strip() else None

            def prepare(index):
                input_file.write_text(canonical(intent(index)), encoding="utf-8")
                return cli(["prepare", "--intent-file", input_file])

            def op(kind, index=1, transfer_id=None, **options):
                args = [kind, "--request-id", intent(index)["request_id"]]
                if kind != "show":
                    args += ["--key-file", key]
                if transfer_id:
                    args += ["--transfer-id", transfer_id]
                return cli(args, **options)

            original = prepare(1)
            stale_file = folder / "before-submit.sqlite3"
            stale = cli(["backup", "--output", stale_file])
            check("actual backup CLI preserves prepared state and reports its exact file pin without HTTP",
                  stale["backup_sha256"] == hashlib.sha256(stale_file.read_bytes()).hexdigest()
                  and stale["audit"]["journal_attempts"] == 0 and provider.requests == [])
            op("advance", crash=True, expected=79)
            first_id = provider.effects[original["idempotency_key"]]["id"]
            prepared_two = prepare(2)
            known = op("advance", 2)
            op("advance", 2)
            prepare(3)
            provider.mode = "drop"
            unknown = op("advance", 3, expected=2)
            provider.mode = "ok"
            source_audit = cli(["audit"])
            full_file = folder / "complete.sqlite3"
            saved = cli(["backup", "--output", full_file])
            check("full snapshot retains three intents four attempts one known transfer and one unfinished claim",
                  saved["audit"] == source_audit and source_audit["journal_intents"] == 3
                  and source_audit["journal_attempts"] == 4 and source_audit["known_transfers"] == 1
                  and source_audit["incomplete_attempts"] == 1)
            verified = cli(["verify-backup", "--backup", full_file, "--sha256", saved["backup_sha256"]])
            check("verification CLI checks the pinned complete snapshot without changing source history",
                  verified["audit"] == source_audit and cli(["audit"]) == source_audit
                  and not verified["snapshot_is_current_external_truth"])
            stale_state = folder / "stale-recovered"
            restore_boundary = len(provider.requests)
            restored_stale = cli(["restore", "--backup", stale_file, "--sha256", stale["backup_sha256"]], target=stale_state)
            stale_view = op("show", target=stale_state)
            before = len(provider.requests)
            refused = op("advance", target=stale_state, expected=1)
            check("snapshot predating an actual accepted create can never recreate that payment",
                  stale_view["state"] == "PREPARED" and stale_view["idempotency_key"] == original["idempotency_key"]
                  and restored_stale["journal_mode"] == "RECOVERY_ONLY" and not restored_stale["may_create_transfers"]
                  and refused["error"] == "BRIDGE_RESTORED_JOURNAL_READ_ONLY" and len(provider.requests) == before)
            prepare(4)
            # The full snapshot intentionally predates this new source intent too.
            refused = cli(["prepare", "--intent-file", input_file], target=stale_state, expected=1)
            check("restored state refuses new payment instructions rather than inheriting source authority",
                  refused["error"] == "BRIDGE_RESTORED_JOURNAL_READ_ONLY")
            restored = cli(["restore", "--backup", full_file, "--sha256", saved["backup_sha256"]], target=recovered)
            check("restore publishes durable recovery-only control and preserves exact original snapshot totals",
                  restored["snapshot_audit"] == source_audit and restored["audit"]["journal_attempts"] == 4
                  and restored["audit"]["journal_mode"] == "RECOVERY_ONLY")
            known_read = op("advance", 2, target=recovered)
            check("fresh CLI process polls a restored known ID with GET and no create authority",
                  known_read["observation"] == known["observation"] and not known_read["may_create_transfers"]
                  and provider.requests[-1]["method"] == "GET")
            restored_unknown = op("show", 3, target=recovered)
            before = len(provider.requests)
            refused = op("advance", 3, target=recovered, expected=1)
            check("unknown restored intent refuses POST even inside its original retry window",
                  refused["error"] == "BRIDGE_RESTORED_JOURNAL_READ_ONLY" and len(provider.requests) == before
                  and op("show", 3, target=recovered) == restored_unknown)
            discovered = op("discover", 3, target=recovered)
            third_id = discovered["candidate_ids"][0]
            check("read-only discovery of restored uncertainty finds matching original terms without attaching them",
                  discovered["status"] == "ONE_CANDIDATE_IN_SCAN" and op("show", 3, target=recovered) == restored_unknown)
            provider.listing = []
            empty = op("discover", 3, target=recovered)
            before = len(provider.requests)
            refused = op("advance", 3, target=recovered, expected=1)
            check("empty restored-state lookup is inconclusive and cannot restore payment-create authority",
                  not empty["negative_result_proves_absence"] and refused["error"] == "BRIDGE_RESTORED_JOURNAL_READ_ONLY"
                  and len(provider.requests) == before)
            provider.listing = None
            bound = op("reconcile", 3, third_id, target=recovered)
            check("restored unknown payment reconciles only by GET retaining original body key and first time",
                  bound["body"] == unknown["body"] and bound["idempotency_key"] == unknown["idempotency_key"]
                  and bound["first_attempt_ms"] == unknown["first_attempt_ms"]
                  and bound["restored_from_sha256"] == saved["backup_sha256"] and provider.requests[-1]["method"] == "GET")
            before = len(provider.requests)
            busy = op("reconcile", 1, first_id, target=recovered, expected=1)
            check("restored unfinished source claim keeps its original live lease",
                  busy["error"] == "BRIDGE_ATTEMPT_BUSY" and len(provider.requests) == before)
            op("reconcile", 1, first_id, target=recovered, stamp=at + LEASE_MS + 1, crash="poll", expected=80)
            crashed = op("show", target=recovered)
            before = len(provider.requests)
            busy = op("reconcile", 1, first_id, target=recovered, stamp=at + LEASE_MS + 1, expected=1)
            check("process death after a restored recovery GET preserves target and excludes concurrent replay",
                  crashed["incomplete_attempt"] and crashed["last_candidate_id"] == first_id
                  and busy["error"] == "BRIDGE_ATTEMPT_BUSY" and len(provider.requests) == before)
            resumed = op("reconcile", 1, first_id, target=recovered, stamp=later)
            check("later process recovers the same target by GET after the retained lease",
                  resumed["observation"]["id"] == first_id and resumed["journal_mode"] == "RECOVERY_ONLY"
                  and provider.requests[-1]["method"] == "GET")
            crash_state = folder / "published-before-crash"
            cli(["restore", "--backup", full_file, "--sha256", saved["backup_sha256"]],
                target=crash_state, stamp=later, crash="restore", expected=81)
            crash_view = op("show", 3, target=crash_state)
            refused = op("advance", 3, target=crash_state, stamp=later, expected=1)
            check("actual restore process death after publication leaves only a recovery-only usable journal",
                  crash_view["journal_mode"] == "RECOVERY_ONLY" and refused["error"] == "BRIDGE_RESTORED_JOURNAL_READ_ONLY")
            before_bytes = (recovered / "bridge-sandbox.sqlite3").read_bytes()
            cli(["restore", "--backup", full_file, "--sha256", saved["backup_sha256"]], target=recovered, stamp=later, expected=1)
            check("restore never replaces an existing recovery directory or its newer observations",
                  (recovered / "bridge-sandbox.sqlite3").read_bytes() == before_bytes)
            cli(["backup", "--output", full_file], expected=1)
            check("backup never replaces its earlier pinned snapshot",
                  hashlib.sha256(full_file.read_bytes()).hexdigest() == saved["backup_sha256"])
            bad_file = folder / "corrupted.sqlite3"
            bad_file.write_bytes(b"X" + full_file.read_bytes()[1:])
            bad_file.chmod(0o600)
            bad_state = folder / "must-not-publish"
            refused = cli(["restore", "--backup", bad_file, "--sha256", saved["backup_sha256"]], target=bad_state, expected=1)
            check("changed backup fails its external pin before publishing any state",
                  refused["error"] == "BRIDGE_BACKUP_HASH_MISMATCH" and not bad_state.exists())
            with closing(sqlite3.connect(state / "bridge-sandbox.sqlite3", autocommit=True)) as connection:
                connection.execute("DROP TABLE bridge_control")
                connection.execute("PRAGMA user_version=2")
            refused = cli(["audit"], expected=1)
            legacy_file = folder / "before-schema-three.sqlite3"
            migrated = cli(["migrate", "--backup", legacy_file])
            check("actual schema-two migration requires an exclusive verified old snapshot before normal use",
                  refused["error"] == "BRIDGE_JOURNAL_MIGRATION_REQUIRED" and migrated["from_schema"] == 2
                  and migrated["journal_schema_version"] == JOURNAL_VERSION
                  and hashlib.sha256(legacy_file.read_bytes()).hexdigest() == migrated["backup_sha256"])
            after = op("show", 2)
            check("schema-two upgrade preserves known payment identity and starts only the original source as active",
                  after["observation"] == known["observation"] and after["idempotency_key"] == prepared_two["idempotency_key"]
                  and after["journal_mode"] == "ACTIVE" and op("show", 2, target=recovered)["journal_mode"] == "RECOVERY_ONLY")
            collision = folder / "raced.sqlite3"
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: provider.cli(state, ["backup", "--output", collision], at=later), range(2)))
            for value in results:
                outputs.append(value.stdout + value.stderr)
            winner = next(json.loads(v.stdout) for v in results if v.returncode == 0)
            check("two actual backup CLI processes publish exactly one snapshot without overwrite",
                  sorted(v.returncode for v in results) == [0, 1]
                  and winner["backup_sha256"] == hashlib.sha256(collision.read_bytes()).hexdigest()
                  and json.loads(next(v.stderr for v in results if v.returncode == 1))["error"] == "BRIDGE_BACKUP_EXISTS")
            second_file = folder / "recovery-again.sqlite3"
            second = cli(["backup", "--output", second_file], target=recovered, stamp=later)
            again = cli(["restore", "--backup", second_file, "--sha256", second["backup_sha256"]], target=folder / "again", stamp=later)
            check("a backup of restored state stays recovery-only after another restore",
                  second["audit"]["journal_mode"] == again["audit"]["journal_mode"] == "RECOVERY_ONLY"
                  and not again["may_create_transfers"])
            with closing(sqlite3.connect(recovered / "bridge-sandbox.sqlite3")) as connection:
                connection.row_factory = sqlite3.Row
                kinds = dict(connection.execute("SELECT kind,COUNT(*) FROM attempts GROUP BY kind"))
                rows = [dict(r) for r in connection.execute("SELECT id,body_json,body_sha256,idempotency_key FROM intents ORDER BY id")]
                first_times = dict(connection.execute("SELECT intent_id,MIN(started_ms) FROM attempts GROUP BY intent_id"))
                attempts = [dict(r) for r in connection.execute("SELECT intent_id,kind,candidate_id,observation_json FROM attempts ORDER BY intent_id,sequence")]
                control = tuple(connection.execute("SELECT mode,restored_from_sha256 FROM bridge_control").fetchone())
                recovery_rows = connection.execute("SELECT candidate_id,observation_json FROM attempts WHERE kind='RECONCILE' AND observation_json IS NOT NULL").fetchall()
            with closing(sqlite3.connect(full_file)) as connection:
                connection.row_factory = sqlite3.Row
                saved_rows = [dict(r) for r in connection.execute("SELECT id,body_json,body_sha256,idempotency_key FROM intents ORDER BY id")]
                saved_first_times = dict(connection.execute("SELECT intent_id,MIN(started_ms) FROM attempts GROUP BY intent_id"))
            bindings = []
            for row in rows:
                observed = [json.loads(a["observation_json"])["id"] for a in attempts if a["intent_id"] == row["id"] and a["observation_json"]]
                bindings.append({"request_id": row["id"], "original_body": json.loads(row["body_json"]),
                    "snapshot_body_sha256": next(r["body_sha256"] for r in saved_rows if r["id"] == row["id"]),
                    "restored_body_sha256": row["body_sha256"],
                    "snapshot_idempotency_key": next(r["idempotency_key"] for r in saved_rows if r["id"] == row["id"]),
                    "restored_idempotency_key": row["idempotency_key"],
                    "snapshot_first_attempt_ms": saved_first_times[row["id"]],
                    "restored_first_attempt_ms": first_times[row["id"]], "known_transfer_id": observed[-1],
                    "recovery_targets": [a["candidate_id"] for a in attempts if a["intent_id"] == row["id"] and a["kind"] == "RECONCILE"]})
            final_audit = cli(["audit"], target=recovered, stamp=later)
            check("independent SQLite inspection binds complete restored bodies identities targets and history counts",
                  kinds == {"CREATE": 3, "POLL": 2, "RECONCILE": 3} and final_audit["journal_attempts"] == 8
                  and final_audit["known_transfers"] == 3 and control == ("RECOVERY_ONLY", saved["backup_sha256"])
                  and rows == saved_rows and first_times == saved_first_times
                  and all(sha(json.loads(r["body_json"])) == r["body_sha256"] and json.loads(r["body_json"])["client_reference_id"] == r["idempotency_key"] for r in rows)
                  and all(candidate == json.loads(observation)["id"] for candidate, observation in recovery_rows))
            check("all restores discovery and recovery add no payment-create effect",
                  len(provider.effects) == 3 and sum(r["method"] == "POST" for r in provider.requests) == 3
                  and restore_boundary == 4 and all(r["method"] == "GET" for r in provider.requests[restore_boundary:]))
            check("bearer keys remain absent from CLI output snapshots and restored database",
                  all(KEY not in value for value in outputs)
                  and all(KEY.encode() not in p.read_bytes() for p in (full_file, stale_file, legacy_file, second_file, recovered / "bridge-sandbox.sqlite3")))
            check("snapshot verification and provider observations never claim settlement or external attestation",
                  verified["audit"]["external_attestation"] == "UNAVAILABLE"
                  and resumed["settlement_accounting"] == "UNAVAILABLE" and not resumed["wallet_execution"])
            wire = [{"method": r["method"], "path": r["path"], "idempotency_header_present": "Idempotency-Key" in r["headers"],
                     "idempotency_key": r["headers"].get("Idempotency-Key"),
                     "body_sha256": sha(json.loads(r["body"])) if r["body"] is not None else None} for r in provider.requests]
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "classification": "LOCAL_HTTPS_RECOVERY_ONLY_SNAPSHOT_FIXTURE", "transport": "ACTUAL_VERIFIED_LOCAL_TLS",
                "clock": "INJECTED_FOR_LEASE_BOUNDARIES", "checks": checks, "journal_schema_version": JOURNAL_VERSION,
                "backup_sha256": saved["backup_sha256"], "source_snapshot_audit": source_audit,
                "restored_audit": final_audit, "attempt_kinds": kinds, "migration": migrated,
                "fixture_request_bindings": bindings, "first_restore_after_request_count": restore_boundary,
                "restore_process_death_exit": 81, "recovery_process_death_exit": 80,
                "http_requests": len(wire), "post_requests": sum(r["method"] == "POST" for r in wire),
                "unique_fixture_transfers": len(provider.effects), "wire": wire,
                "external_bridge_requests": 0, "bridge_account_acceptance": "UNVERIFIED",
                "production_execution": False, "wallet_execution": False, "transactions_submitted": 0,
                "commerce_budget_integration": False, "settlement_accounting": "UNAVAILABLE"}
    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    (output / "bridge-recovery.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(canonical(evidence))


if __name__ == "__main__":
    run()
