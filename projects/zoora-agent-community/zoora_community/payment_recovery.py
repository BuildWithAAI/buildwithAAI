"""Pinned queue/provider recovery packages. Restores never regain create authority."""

from contextlib import ExitStack, closing, contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import zipfile

from .bridge_recovery import inspect_journal, read_connection
from .bridge_sandbox import sha, transfer_body
from .payment_contract import display, stamp
from .payment_pipeline import LEASE_MS, PIPELINE_VERSION, RECOVERY_DDL, PaymentPipeline
from .recovery import copy_snapshot, sync_directory, sync_file
from .store import private_regular
from .validation import DIGEST, Problem, canonical, matching, parse_json

FORMAT = "ZOORA_PAYMENT_RECOVERY_V1"
POLICY = "RECOVERY_ONLY_NO_CREATE"
QUEUE = "payment-pipeline.sqlite3"
PROVIDER = "provider/bridge-sandbox.sqlite3"
LIMITS = {"manifest.json": 512 * 1024, QUEUE: 16 * 1024 * 1024, PROVIDER: 8 * 1024 * 1024}
MAX_PACKAGE_BYTES = sum(LIMITS.values()) + 8192


def joint_audit(pipeline, queue, provider=None, *, allow_legacy=False):
    """Inspect all history and links while callers hold provider, then queue admission."""
    loaded = pipeline._load(queue, allow_legacy=allow_legacy)
    control, mandate, orders, claims, latest, total = loaded
    if ([r[0] for r in queue.execute("PRAGMA quick_check")] != ["ok"]
            or queue.execute("PRAGMA page_size").fetchone()[0] != 4096
            or queue.execute("PRAGMA journal_mode").fetchone()[0] != "delete"):
        raise Problem(503, "PIPELINE_CONSISTENCY_FAILURE")
    provider_audit = inspect_journal(pipeline.bridge, provider) if provider is not None else None
    if (control["recovery"]["mode"] == "RECOVERY_ONLY" and provider_audit is not None
            and provider_audit["journal_mode"] != "RECOVERY_ONLY"):
        raise Problem(503, "PIPELINE_RECOVERY_MODE_MISMATCH")
    rows = {r["id"]: r for r in provider.execute("SELECT * FROM intents")} if provider is not None else {}
    if set(rows) - {r["id"] for r in orders}:
        raise Problem(503, "PIPELINE_UNLINKED_PROVIDER_INTENT")
    inventory = []
    for order in orders:
        key, terms = order["id"], json.loads(order["terms_json"])
        history = [c for c in claims if c["order_id"] == key]
        fences = [c for c in history if c["dispatch_ms"] is not None]
        view = None
        if key in rows:
            row, body, attempts, known, last_time = pipeline.bridge._load(provider, key)
            if (json.loads(row["intent_json"]) != terms["intent"]
                    or body != transfer_body(terms["intent"], row["idempotency_key"])
                    or row["created_ms"] < order["created_ms"]):
                raise Problem(503, "PIPELINE_PROVIDER_BINDING_MISMATCH")
            creates = [a for a in attempts if a["kind"] == "CREATE"]
            if len(creates) > 1 or any(len([c for c in fences
                    if c["started_ms"] <= a["started_ms"] < c["started_ms"] + LEASE_MS
                    and c["dispatch_ms"] < c["started_ms"] + LEASE_MS]) != 1 for a in creates):
                raise Problem(503, "PIPELINE_PROVIDER_DISPATCH_MISMATCH")
            view = pipeline.bridge._view(row, body, attempts, known, last_time)
        elif fences:
            raise Problem(503, "PIPELINE_PROVIDER_HISTORY_MISSING")
        for claim in history:
            if claim["result_json"] is None:
                continue
            result = json.loads(claim["result_json"])
            if (result["provider_body_sha256"] is not None and
                    (view is None or result["provider_body_sha256"] != view["body_sha256"])
                    or result["provider_attempts"] > (view["attempts"] if view else 0)
                    or result["transfer_id"] is not None and (view is None or view["observation"] is None
                        or result["transfer_id"] != view["observation"]["id"])):
                raise Problem(503, "PIPELINE_RESULT_PROVIDER_MISMATCH")
        action = "NO_PRIOR_PROVIDER_ATTEMPT"
        if view and view["attempts"]:
            action = "GET_EXACT_TRANSFER" if view["observation"] else "DISCOVER_THEN_EXPLICIT_MATCHING_ID"
        inventory.append({"order_id": key, "terms_sha256": order["terms_sha256"],
            "book_id": terms["envelope"]["book_id"], "purchase_id": terms["envelope"]["purchase_id"],
            "amount_usdc": terms["envelope"]["amount_usdc"], "claims": len(history), "dispatch_fences": len(fences),
            "provider_body_sha256": view["body_sha256"] if view else None,
            "idempotency_key": view["idempotency_key"] if view else None,
            "provider_attempts": view["attempts"] if view else 0,
            "known_transfer_id": view["observation"]["id"] if view and view["observation"] else None,
            "recovery_action": action})
    return {"pipeline_schema_version": control["pipeline_schema_version"],
        "pipeline_mode": control["recovery"]["mode"], "mandate_sha256": control["mandate_sha256"],
        "source_instance_id": mandate["instance_id"], "operator_id": mandate["operator_id"],
        "queue_logical_sha256": sha({"control": control, "orders": orders, "claims": claims}),
        "orders": len(orders), "claims": len(claims),
        "unfinished_claims": sum(c["finished_ms"] is None for c in claims),
        "dispatch_fences": sum(c["dispatch_ms"] is not None for c in claims),
        "last_recorded_ms": max(latest, provider_audit["last_recorded_ms"] if provider_audit else 0),
        "admitted_principal_usdc": display(total), "provider": provider_audit, "inventory": inventory,
        "source_state_included": False, "credentials_included": False,
        "scope": "QUEUE_PROVIDER_INTERNAL_CONSISTENCY", "external_attestation": "UNAVAILABLE",
        "restore_policy": POLICY, "external_bridge_requests": 0, "wallet_execution": False,
        "settlement_accounting": "UNAVAILABLE"}


@contextmanager
def locked_state(pipeline, *, allow_legacy=False):
    # Same order as provider create_once -> local queue fence; never invert these locks.
    private_regular(pipeline.path, LIMITS[QUEUE])
    present = pipeline.bridge.path.exists() or pipeline.bridge.path.is_symlink()
    with ExitStack() as stack:
        provider = stack.enter_context(pipeline.bridge._connection()) if present else None
        queue = stack.enter_context(pipeline._connection(allow_legacy=allow_legacy))
        if not present and (pipeline.bridge.path.exists() or pipeline.bridge.path.is_symlink()):
            raise Problem(409, "PIPELINE_PROVIDER_APPEARED_RETRY")
        yield queue, provider


def audit(pipeline):
    with locked_state(pipeline) as (queue, provider):
        return joint_audit(pipeline, queue, provider)


def digest_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def staged_audit(staging):
    pipeline = PaymentPipeline(staging)
    try:
        with ExitStack() as stack:
            queue = stack.enter_context(closing(read_connection(pipeline.path)))
            provider = stack.enter_context(closing(read_connection(pipeline.bridge.path))) if pipeline.bridge.path.exists() else None
            return joint_audit(pipeline, queue, provider, allow_legacy=True)
    except (sqlite3.Error, ValueError, TypeError, KeyError, UnicodeError, RecursionError):
        raise Problem(503, "PIPELINE_PACKAGE_CONSISTENCY_FAILURE") from None


def create_backup(pipeline, destination):
    destination = Path(destination).absolute()
    with tempfile.TemporaryDirectory(prefix=".payment-backup-", dir=destination.parent) as name:
        staging = Path(name)
        with locked_state(pipeline, allow_legacy=True) as (queue, provider):
            before = joint_audit(pipeline, queue, provider, allow_legacy=True)
            paths = [QUEUE] + ([PROVIDER] if provider is not None else [])
            if provider is not None:
                (staging / "provider").mkdir(mode=0o700)
            for member in paths:
                with closing(read_connection(pipeline.state / member)) as source:
                    copy_snapshot(source, staging / member)
            checked = staged_audit(staging)
            if checked != before:
                raise Problem(503, "PIPELINE_BACKUP_STATE_MISMATCH")
        manifest = {"format": FORMAT, "files": {member: digest_file(staging / member) for member in paths}, "audit": checked}
        package = staging / "package.zip"
        descriptor = os.open(package, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w+b") as output, zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr("manifest.json", canonical(manifest).encode())
            for member in paths:
                archive.writestr(member, (staging / member).read_bytes())
        private_regular(package, MAX_PACKAGE_BYTES)
        pin = digest_file(package)
        sync_file(package)
        try:
            os.link(package, destination, follow_symlinks=False)
        except FileExistsError:
            raise Problem(409, "PIPELINE_BACKUP_EXISTS") from None
        try:
            sync_directory(destination.parent)
        except BaseException:
            destination.unlink()
            raise
    return {"backed_up": True, "backup_sha256": pin, "audit": checked, "restore_policy": POLICY}


def package_bytes(path, expected_sha256):
    matching(expected_sha256, DIGEST, "INVALID_DIGEST")
    path = Path(path).absolute()
    private_regular(path, MAX_PACKAGE_BYTES)
    before = path.lstat()
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(descriptor, "rb") as source:
        opened = os.fstat(source.fileno())
        if (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns) != (
                before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns):
            raise Problem(400, "PIPELINE_UNSAFE_PACKAGE")
        raw = source.read(MAX_PACKAGE_BYTES + 1)
        after = os.fstat(source.fileno())
    if (len(raw) != before.st_size or len(raw) > MAX_PACKAGE_BYTES
            or (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns)):
        raise Problem(400, "PIPELINE_UNSAFE_PACKAGE")
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise Problem(409, "PIPELINE_BACKUP_HASH_MISMATCH")
    return raw


def stage_package(backup, expected_sha256, staging):
    raw = package_bytes(backup, expected_sha256)
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            members = archive.infolist()
            names = [m.filename for m in members]
            if (set(names) not in ({"manifest.json", QUEUE}, set(LIMITS)) or len(names) != len(set(names))
                    or any(m.compress_type != zipfile.ZIP_STORED or m.flag_bits & 1
                        or not 0 < m.file_size <= LIMITS[m.filename] for m in members)):
                raise ValueError("package members")
            manifest = parse_json(archive.read("manifest.json"), LIMITS["manifest.json"])
            if PROVIDER in names:
                (staging / "provider").mkdir(mode=0o700)
            files = {}
            for member in names:
                if member == "manifest.json":
                    continue
                value = archive.read(member)
                files[member] = hashlib.sha256(value).hexdigest()
                descriptor = os.open(staging / member, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(descriptor, "wb") as output:
                    output.write(value)
            checked = staged_audit(staging)
            if manifest != {"format": FORMAT, "files": files, "audit": checked}:
                raise ValueError("manifest mismatch")
    except (zipfile.BadZipFile, ValueError, KeyError, TypeError, UnicodeError, RecursionError, NotImplementedError):
        raise Problem(503, "PIPELINE_PACKAGE_REJECTED") from None
    return checked


def verify_backup(backup, expected_sha256):
    with tempfile.TemporaryDirectory(prefix="payment-verify-") as name:
        checked = stage_package(backup, expected_sha256, Path(name))
    return {"verified": True, "backup_sha256": expected_sha256, "audit": checked, "restore_policy": POLICY}


def upgrade_queue(connection):
    for statement in RECOVERY_DDL.split(";"):
        if statement.strip():
            connection.execute(statement)
    connection.execute("PRAGMA user_version=2")


def migrate(pipeline, backup, expected_sha256):
    checked = verify_backup(backup, expected_sha256)["audit"]
    with locked_state(pipeline, allow_legacy=True) as (queue, provider):
        before = joint_audit(pipeline, queue, provider, allow_legacy=True)
        if before["pipeline_schema_version"] != 1:
            raise Problem(409, "PIPELINE_MIGRATION_NOT_REQUIRED")
        if before != checked:
            raise Problem(409, "PIPELINE_MIGRATION_BACKUP_MISMATCH")
        at = stamp(pipeline.clock())
        if at < before["last_recorded_ms"]:
            raise Problem(409, "PIPELINE_CLOCK_REGRESSION")
        upgrade_queue(queue)
        queue.execute("UPDATE pipeline_recovery SET migrated_from_sha256=?,migrated_at_ms=? WHERE id=1", (expected_sha256, at))
        after = joint_audit(pipeline, queue, provider)
    return {"migrated": True, "from_schema": 1, "pipeline_schema_version": PIPELINE_VERSION,
        "backup_sha256": expected_sha256, "audit": after}


def restore_backup(pipeline, backup, expected_sha256):
    with tempfile.TemporaryDirectory(prefix=".payment-restore-", dir=pipeline.state.parent) as name:
        staging = Path(name)
        before = stage_package(backup, expected_sha256, staging)
        at = stamp(pipeline.clock())
        if at < before["last_recorded_ms"]:
            raise Problem(409, "PIPELINE_CLOCK_REGRESSION")
        staged = PaymentPipeline(staging, clock=pipeline.clock)
        with staged._connection(allow_legacy=True) as queue:
            if before["pipeline_schema_version"] == 1:
                upgrade_queue(queue)
            queue.execute("UPDATE pipeline_recovery SET mode='RECOVERY_ONLY',restored_from_sha256=?,restored_at_ms=? WHERE id=1",
                          (expected_sha256, at))
        with staged.bridge._connection() as provider:
            provider.execute("UPDATE bridge_control SET mode='RECOVERY_ONLY',restored_from_sha256=?,restored_at_ms=? WHERE id=1",
                             (expected_sha256, at))
        after = staged_audit(staging)
        for member in (QUEUE, PROVIDER):
            sync_file(staging / member)
        # Both files are quarantined before any publication. Interrupted partial
        # publication can expose only GET-only state; never overwrite an old target.
        pipeline.state.mkdir(mode=0o700)
        published = []
        provider_created = False
        try:
            pipeline.bridge.state.mkdir(mode=0o700)
            provider_created = True
            for member in (PROVIDER, QUEUE):
                destination = pipeline.state / member
                os.link(staging / member, destination, follow_symlinks=False)
                published.append(destination)
            sync_directory(pipeline.bridge.state)
            sync_directory(pipeline.state)
            sync_directory(pipeline.state.parent)
        except BaseException:
            for path in reversed(published):
                path.unlink()
            if provider_created:
                pipeline.bridge.state.rmdir()
            pipeline.state.rmdir()
            raise
    return {"restored": True, "backup_sha256": expected_sha256, "snapshot_audit": before,
        "audit": after, "pipeline_mode": "RECOVERY_ONLY", "provider_mode": "RECOVERY_ONLY",
        "may_submit_purchases": False, "may_create_transfers": False, "restore_policy": POLICY,
        "source_state_restored": False, "snapshot_is_current_external_truth": False,
        "windows_durability": "UNVERIFIED" if os.name == "nt" else "NOT_APPLICABLE"}
