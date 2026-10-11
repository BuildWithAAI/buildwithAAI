"""Consistent, evidence-audited snapshots with exclusive publication and offline restore."""

from contextlib import closing
import os
from pathlib import Path
import sqlite3
import tempfile
import time

from .store import MAX_DATABASE_BYTES, SCHEMA_VERSION, Store, exclusive_file, private_regular
from .validation import Problem


def sync_file(path):
    with path.open("r+b") as output:
        os.fsync(output.fileno())


def sync_directory(path):
    # POSIX directory fsync covers publication. Windows needs an independent
    # filesystem/ACL/durability review; do not report the POSIX guarantee there.
    if os.name == "posix":
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def copy_snapshot(source, destination, *, deadline_seconds=10):
    with exclusive_file(destination):
        pass
    deadline = time.monotonic() + deadline_seconds

    def progress(status, remaining, total):
        if total * 4096 > MAX_DATABASE_BYTES:
            raise Problem(503, "BACKUP_TOO_LARGE")
        if time.monotonic() >= deadline:
            raise Problem(503, "BACKUP_TIMEOUT")

    with closing(sqlite3.connect(destination, autocommit=True)) as target:
        target.setconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE, True)
        target.setconfig(sqlite3.SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, False)
        target.execute("PRAGMA trusted_schema=OFF")
        source.backup(target, pages=256, progress=progress, sleep=0.05)
    private_regular(destination, MAX_DATABASE_BYTES)


def audit_snapshot(state, schema_version=SCHEMA_VERSION):
    return Store(state, _schema_version=schema_version).audit()


def create_backup(store, destination):
    destination = Path(destination).absolute()
    with tempfile.TemporaryDirectory(prefix=".zoora-backup-", dir=destination.parent) as name:
        staging = Path(name)
        snapshot = staging / "community.sqlite3"
        with closing(store._connection()) as source:
            store._check_schema(source, store.schema_version)
            copy_snapshot(source, snapshot)
        audit = audit_snapshot(staging, store.schema_version)
        sync_file(snapshot)
        # Hard-link publication is atomic and refuses an existing path. If the
        # filesystem doesn't support it, fail closed; never fall back to overwrite.
        os.link(snapshot, destination, follow_symlinks=False)
        try:
            sync_directory(destination.parent)
        except BaseException:
            destination.unlink()
            raise
    return audit


def stage_backup(backup, staging):
    backup = Path(backup).absolute()
    private_regular(backup, MAX_DATABASE_BYTES)
    if any(backup.with_name(backup.name + suffix).exists() or
           backup.with_name(backup.name + suffix).is_symlink()
           for suffix in ("-journal", "-wal", "-shm")):
        raise Problem(503, "BACKUP_SIDECAR_PRESENT")
    with closing(sqlite3.connect(backup.as_uri() + "?mode=ro", uri=True, timeout=3,
                                autocommit=True)) as source:
        source.setconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE, True)
        source.setconfig(sqlite3.SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, False)
        source.execute("PRAGMA trusted_schema=OFF")
        source.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 1_000_000)
        source.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 16_384)
        source.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
        Store._check_schema(source)
        if (source.execute("PRAGMA page_size").fetchone()[0] != 4096 or
                source.execute("PRAGMA journal_mode").fetchone()[0] != "delete"):
            raise Problem(503, "UNSUPPORTED_BACKUP_FORMAT")
        copy_snapshot(source, staging / "community.sqlite3")
    return audit_snapshot(staging)


def verify_backup(backup):
    with tempfile.TemporaryDirectory(prefix="zoora-verify-") as name:
        audit = stage_backup(backup, Path(name))
    return {"status": "AVAILABLE", "scope": "SNAPSHOT_INTERNAL_CONSISTENCY",
            "audit": audit, "credential_policy": "PRESERVED_REQUIRE_OFFLINE_RECOVERY",
            "external_attestation": "UNAVAILABLE"}


def restore_backup(backup, state):
    state = Path(state).absolute()
    with tempfile.TemporaryDirectory(prefix=".zoora-restore-", dir=state.parent) as name:
        staging = Path(name)
        audit = stage_backup(backup, staging)
        snapshot = staging / "community.sqlite3"
        sync_file(snapshot)
        # Even an empty existing directory is never reused or replaced.
        state.mkdir(mode=0o700)
        published = False
        try:
            os.link(snapshot, state / "community.sqlite3", follow_symlinks=False)
            published = True
            sync_directory(state)
            sync_directory(state.parent)
        except BaseException:
            if published:
                state.joinpath("community.sqlite3").unlink()
            state.rmdir()
            raise
    return {"restored": True, "scope": "OFFLINE_NEW_STATE_DIRECTORY", "audit": audit,
            "all_previous_credentials_revoked": False,
            "next_action": "RECOVER_OWNER_INVALIDATE_ALL_CREDENTIALS_BEFORE_SERVING",
            "windows_durability": "UNVERIFIED" if os.name == "nt" else "NOT_APPLICABLE"}
