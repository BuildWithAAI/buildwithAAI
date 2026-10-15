"""Verified private snapshots; restored journals can only read provider records."""

from contextlib import closing
from functools import lru_cache
import hashlib
import os
from pathlib import Path
import sqlite3
import stat
import tempfile

from .bridge_journal import DDL, JOURNAL_VERSION, MAX_ATTEMPTS, MAX_INTENTS, BridgeJournal
from .bridge_sandbox import sha
from .recovery import copy_snapshot, sync_directory, sync_file
from .validation import DIGEST, Problem, matching

MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024


def schema_shape(connection):
    objects = connection.execute("SELECT type,name,tbl_name FROM sqlite_master ORDER BY type,name").fetchall()
    result = {"objects": [list(row) for row in objects], "tables": {}}
    for kind, name, _ in objects:
        if kind == "table" and name in {"intents", "attempts", "bridge_migrations", "bridge_control"}:
            result["tables"][name] = {
                "columns": [list(r) for r in connection.execute("SELECT * FROM pragma_table_info(?)", (name,))],
                "foreign_keys": [list(r) for r in connection.execute("SELECT * FROM pragma_foreign_key_list(?)", (name,))],
                "indexes": []}
            for row in connection.execute("SELECT * FROM pragma_index_list(?) ORDER BY name", (name,)):
                result["tables"][name]["indexes"].append({
                    "definition": list(row)[1:],
                    "columns": [list(r) for r in connection.execute("SELECT * FROM pragma_index_info(?)", (row[1],))]})
    return result


@lru_cache(maxsize=3)
def expected_shape(version):
    with closing(sqlite3.connect(":memory:", autocommit=True)) as connection:
        connection.executescript(DDL)
        if version < 3:
            connection.execute("DROP TABLE bridge_control")
        if version == 1:
            connection.execute("ALTER TABLE attempts DROP COLUMN candidate_id")
            connection.execute("DROP TABLE bridge_migrations")
        return schema_shape(connection)


def inspect_journal(journal, connection, *, allow_legacy=False):
    """Audit every row, including orphan attempts and inactive intents; expose only totals."""
    try:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version in (1, 2) and not allow_legacy:
            raise Problem(503, "BRIDGE_JOURNAL_MIGRATION_REQUIRED")
        if version not in {1, 2, JOURNAL_VERSION}:
            raise Problem(503, "BRIDGE_JOURNAL_SCHEMA_REJECTED")
        if (schema_shape(connection) != expected_shape(version)
                or [r[0] for r in connection.execute("PRAGMA quick_check")] != ["ok"]
                or connection.execute("PRAGMA foreign_key_check").fetchall()
                or connection.execute("PRAGMA page_size").fetchone()[0] != 4096
                or connection.execute("PRAGMA journal_mode").fetchone()[0] != "delete"):
            raise ValueError("snapshot schema or integrity")
        tables = {"intents": [dict(r) for r in connection.execute("SELECT * FROM intents ORDER BY id")],
                  "attempts": [dict(r) for r in connection.execute("SELECT * FROM attempts ORDER BY id")]}
        if len(tables["intents"]) > MAX_INTENTS or len(tables["attempts"]) > MAX_INTENTS * MAX_ATTEMPTS:
            raise ValueError("snapshot capacity")
        latest, known, incomplete = 0, set(), 0
        for row in tables["intents"]:
            loaded = journal._load(connection, row["id"], legacy=version == 1)
            latest = max(latest, loaded[4])
            incomplete += sum(a["finished_ms"] is None for a in loaded[2])
            if loaded[3]:
                if loaded[3]["id"] in known:
                    raise ValueError("provider identity reused across intents")
                known.add(loaded[3]["id"])
        if version >= 2:
            tables["bridge_migrations"] = [dict(r) for r in connection.execute("SELECT * FROM bridge_migrations ORDER BY version")]
            if len(tables["bridge_migrations"]) > 2:
                raise ValueError("migration count")
            for row in tables["bridge_migrations"]:
                if (row["version"] not in range(2, version + 1) or type(row["at_ms"]) is not int
                        or not 0 <= row["at_ms"] < 2**63):
                    raise ValueError("migration record")
                matching(row["backup_sha256"], DIGEST, "INVALID_DIGEST")
                latest = max(latest, row["at_ms"])
        control = journal._control(connection) if version == JOURNAL_VERSION else None
        if control:
            tables["bridge_control"] = [control]
            latest = max(latest, control["restored_at_ms"] or 0)
        return {"journal_schema_version": version, "journal_intents": len(tables["intents"]),
                "journal_attempts": len(tables["attempts"]), "known_transfers": len(known),
                "incomplete_attempts": incomplete, "last_recorded_ms": latest,
                "logical_state_sha256": sha({"schema_version": version, "tables": tables}),
                "journal_mode": control["mode"] if control else "LEGACY_REQUIRES_MIGRATION",
                "scope": "SNAPSHOT_INTERNAL_CONSISTENCY", "external_attestation": "UNAVAILABLE",
                "external_bridge_requests": 0, "wallet_execution": False,
                "settlement_accounting": "UNAVAILABLE"}
    except (sqlite3.Error, ValueError, KeyError, IndexError, TypeError):
        raise Problem(503, "BRIDGE_JOURNAL_CONSISTENCY_FAILURE") from None


def read_connection(path):
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=3, autocommit=True)
    try:
        connection.row_factory = sqlite3.Row
        connection.setconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE, True)
        connection.setconfig(sqlite3.SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, False)
        connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 65_536)
        connection.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 8192)
        connection.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
        connection.execute("PRAGMA trusted_schema=OFF")
        connection.execute("PRAGMA query_only=ON")
    except BaseException:
        connection.close()
        raise
    return connection


def create_backup(journal, destination):
    destination = Path(destination).absolute()
    if not journal.path.exists():
        raise Problem(404, "BRIDGE_JOURNAL_NOT_FOUND")
    with tempfile.TemporaryDirectory(prefix=".bridge-backup-", dir=destination.parent) as name:
        snapshot = Path(name) / "bridge-sandbox.sqlite3"
        with journal._connection() as connection:
            before = inspect_journal(journal, connection)
            # The writer holds admission while a separate reader copies committed state.
            with closing(read_connection(journal.path)) as source:
                copy_snapshot(source, snapshot)
            with closing(read_connection(snapshot)) as source:
                audit = inspect_journal(journal, source)
            if audit != before:
                raise Problem(503, "BRIDGE_BACKUP_STATE_MISMATCH")
            sync_file(snapshot)
            digest = hashlib.sha256(snapshot.read_bytes()).hexdigest()
            try:
                os.link(snapshot, destination, follow_symlinks=False)
            except FileExistsError:
                raise Problem(409, "BRIDGE_BACKUP_EXISTS") from None
            try:
                sync_directory(destination.parent)
            except BaseException:
                destination.unlink()
                raise
    return {"backed_up": True, "backup_sha256": digest, "audit": audit,
            "restore_policy": "RECOVERY_ONLY_NO_CREATE", "snapshot_is_current_external_truth": False}


def backup_bytes(path, expected_sha256):
    matching(expected_sha256, DIGEST, "INVALID_DIGEST")
    path = Path(path).absolute()
    for suffix in ("-journal", "-wal", "-shm"):
        sidecar = path.with_name(path.name + suffix)
        if sidecar.exists() or sidecar.is_symlink():
            raise Problem(503, "BRIDGE_BACKUP_SIDECAR_PRESENT")
    before = path.lstat()
    if (not stat.S_ISREG(before.st_mode) or before.st_size > MAX_SNAPSHOT_BYTES
            or os.name == "posix" and (stat.S_IMODE(before.st_mode) & 0o077 or before.st_uid != os.getuid())):
        raise Problem(400, "BRIDGE_UNSAFE_BACKUP")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(descriptor, "rb") as source:
        opened = os.fstat(source.fileno())
        if (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns) != (
                before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns):
            raise Problem(400, "BRIDGE_UNSAFE_BACKUP")
        raw = source.read(MAX_SNAPSHOT_BYTES + 1)
        after = os.fstat(source.fileno())
    if (len(raw) != before.st_size or len(raw) > MAX_SNAPSHOT_BYTES
            or (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns)):
        raise Problem(400, "BRIDGE_UNSAFE_BACKUP")
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise Problem(409, "BRIDGE_BACKUP_HASH_MISMATCH")
    return raw


def stage_backup(backup, expected_sha256, staging):
    raw = backup_bytes(backup, expected_sha256)
    snapshot = staging / "bridge-sandbox.sqlite3"
    descriptor = os.open(snapshot, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(raw)
    try:
        with closing(read_connection(snapshot)) as source:
            audit = inspect_journal(BridgeJournal(staging), source)
    except sqlite3.Error:
        raise Problem(503, "BRIDGE_JOURNAL_CONSISTENCY_FAILURE") from None
    return snapshot, audit


def verify_backup(backup, expected_sha256):
    with tempfile.TemporaryDirectory(prefix="bridge-verify-") as name:
        _, audit = stage_backup(backup, expected_sha256, Path(name))
    return {"verified": True, "backup_sha256": expected_sha256, "audit": audit,
            "restore_policy": "RECOVERY_ONLY_NO_CREATE", "snapshot_is_current_external_truth": False}


def restore_backup(journal, backup, expected_sha256):
    with tempfile.TemporaryDirectory(prefix=".bridge-restore-", dir=journal.state.parent) as name:
        staging = Path(name)
        snapshot, before = stage_backup(backup, expected_sha256, staging)
        at = journal._clock()
        if at < before["last_recorded_ms"]:
            raise Problem(409, "BRIDGE_CLOCK_REGRESSION")
        staged = BridgeJournal(staging, clock=journal.clock)
        with staged._connection() as connection:
            connection.execute("UPDATE bridge_control SET mode='RECOVERY_ONLY',restored_from_sha256=?,restored_at_ms=? WHERE id=1",
                               (expected_sha256, at))
            audit = inspect_journal(staged, connection)
        sync_file(snapshot)
        # Publish only the already-quarantined database, and only to a new directory.
        journal.state.mkdir(mode=0o700)
        published = False
        try:
            os.link(snapshot, journal.path, follow_symlinks=False)
            published = True
            sync_directory(journal.state)
            sync_directory(journal.state.parent)
        except BaseException:
            if published:
                journal.path.unlink()
            journal.state.rmdir()
            raise
    return {"restored": True, "backup_sha256": expected_sha256, "snapshot_audit": before, "audit": audit,
            "journal_mode": "RECOVERY_ONLY", "may_create_transfers": False,
            "restore_policy": "RECOVERY_ONLY_NO_CREATE", "snapshot_is_current_external_truth": False,
            "windows_durability": "UNVERIFIED" if os.name == "nt" else "NOT_APPLICABLE"}
