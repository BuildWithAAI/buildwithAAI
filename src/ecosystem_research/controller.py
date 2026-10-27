"""Exclusive, crash-recoverable execution of a fixed verified experience plan.

Local cooperating processes only. SQLite commits memory and its checkpoint together;
an OS file lock owns the controller, while a database epoch fences stale sessions.
"""
from __future__ import annotations

from contextlib import closing
import os
from pathlib import Path
import secrets
import sqlite3

from . import experience as x
from ..multi_brain_research import training_lab as lab
from ..solana_research import coin_evidence as ev

PROTOCOL = "AAI_EXPERIENCE_CONTROLLER_V1"
MAX_BATCHES = 32


def validate_plan(plan):
    lab.require(type(plan) is list and 1 <= len(plan) <= MAX_BATCHES, "CONTROLLER_PLAN_BOUND")
    names, clock, count = set(), 0, 0
    for batch in plan:
        lab.exact(batch, ("id", "clock", "requests"))
        lab.require(type(batch["id"]) is str and 1 <= len(batch["id"]) <= 64
                    and batch["id"] not in names, "CONTROLLER_BATCH_ID")
        lab.require(type(batch["clock"]) is int and clock <= batch["clock"] <= 10**9
                    and type(batch["requests"]) is list and 1 <= len(batch["requests"]) <= x.MAX_EVENTS,
                    "CONTROLLER_BATCH_BOUND")
        names.add(batch["id"])
        clock, count = batch["clock"], count + len(batch["requests"])
    lab.require(count <= 4096 and len(ev.canonical(plan).encode()) <= 4 * 1024**2, "CONTROLLER_PLAN_BYTES")


def cursor(state):
    return {"head_sha256": state["head"], "events": len(state["events"]), "clock": state["clock"]}


def project(state, batch, rules):
    """Replay admission without writing, including deliveries that append no event."""
    lab.require(batch["clock"] >= state["clock"], "CONTROLLER_CLOCK_REWIND")
    results, start = [], len(state["events"])
    for request in batch["requests"]:
        identity = lab.digest([batch["clock"], request])
        status, reason = x.admission(request, batch["clock"], rules, state)
        if identity in state["requests"] or status == "DUPLICATE":
            results.append({"status": "DUPLICATE", "reason": reason, "appended": False})
            continue
        lab.require(len(state["events"]) < x.MAX_EVENTS, "CONTROLLER_EVENT_BOUND")
        body = {"sequence": len(state["events"]), "previous_sha256": state["head"], "clock": batch["clock"],
                "request": request, "status": status, "reason": reason}
        x.advance(state, {**body, "sha256": lab.digest(body)}, rules)
        results.append({"status": status, "reason": reason, "appended": True})
    return results, state["events"][start:]


def checkpoint(state, sequence, digest):
    return {"sequence": sequence, "sha256": digest, "journal": cursor(state)}


def validate_anchor(value):
    lab.exact(value, ("sequence", "sha256", "journal"))
    lab.exact(value["journal"], ("head_sha256", "events", "clock"))
    lab.pin(value["sha256"])
    if value["journal"]["head_sha256"] != "0" * 64:
        lab.pin(value["journal"]["head_sha256"])
    lab.require(type(value["sequence"]) is int and -1 <= value["sequence"] < MAX_BATCHES
                and type(value["journal"]["events"]) is int and 0 <= value["journal"]["events"] <= x.MAX_EVENTS
                and type(value["journal"]["clock"]) is int and 0 <= value["journal"]["clock"] <= 10**9,
                "CONTROLLER_ANCHOR_TYPES")


def check_size(connection):
    pages = connection.execute("PRAGMA page_count").fetchone()[0]
    size = connection.execute("PRAGMA page_size").fetchone()[0]
    lab.require(pages * size <= x.MAX_DATABASE_BYTES, "CONTROLLER_DATABASE_BOUND")


def safe_path(path):
    value = Path(os.path.abspath(path))
    lab.require(not any(p.is_symlink() for p in (value, *value.parents)), "CONTROLLER_SYMLINK")
    return value


class FileLock:
    """Nonblocking local ownership. Never unlink or replace the lock file."""

    def __init__(self, path):
        self.path, self.file, self.pid = safe_path(path), None, os.getpid()

    def acquire(self):
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(self.path, flags, 0o600)
        self.file = os.fdopen(descriptor, "r+b", buffering=0)
        try:
            if os.fstat(descriptor).st_size == 0:
                self.file.write(b"\0")
                self.file.flush()
            self.file.seek(0)
            if os.name == "posix":
                import fcntl
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            elif os.name == "nt":
                import msvcrt
                msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
            else:
                raise ValueError("CONTROLLER_OS_LOCK_UNSUPPORTED")
            self.check()
        except (OSError, ValueError) as error:
            self.file.close()
            self.file = None
            raise ValueError("CONTROLLER_BUSY_OR_UNSAFE_LOCK") from error
        return self

    def check(self):
        lab.require(self.file is not None and not self.file.closed and self.pid == os.getpid(), "CONTROLLER_STALE_SESSION")
        safe_path(self.path)
        actual, held = self.path.stat(), os.fstat(self.file.fileno())
        lab.require((actual.st_dev, actual.st_ino) == (held.st_dev, held.st_ino)
                    and actual.st_nlink == 1, "CONTROLLER_LOCK_REPLACED")

    def close(self):
        # Closing the descriptor releases the OS lock, including after process death.
        if self.file is not None:
            self.file.close()
            self.file = None


class ControlledJournal:
    def __init__(self, path, rules, plan, upstream_sha256):
        self.path = safe_path(path)
        lab.pin(upstream_sha256)
        validate_plan(plan)
        self.plan = ev.parse(ev.canonical(plan).encode())
        self.journal = x.ExperienceJournal(self.path, rules)
        self.binding = {"protocol": PROTOCOL, "policy_sha256": lab.digest(self.journal.rules),
                        "plan_sha256": lab.digest(self.plan), "upstream_sha256": upstream_sha256,
                        "live_execution_allowed": False}

    def _connect(self, *, readonly):
        safe_path(self.path)
        lab.require(self.path.stat().st_nlink == 1, "CONTROLLER_DATABASE_ALIAS")
        connection = self.journal._connect(readonly=readonly)
        connection.execute("PRAGMA busy_timeout=0")
        return connection

    def initialize(self):
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        lock = FileLock(str(self.path) + ".lock").acquire()
        try:
            safe_path(self.path)
            with self.path.open("xb"):
                pass
            self.path.chmod(0o600)
            with closing(sqlite3.connect(self.path, timeout=0)) as connection:
                connection.executescript("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN IMMEDIATE; "
                    "CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); "
                    "CREATE TABLE events (sequence INTEGER PRIMARY KEY, body TEXT NOT NULL); "
                    "CREATE TABLE controller_binding (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); "
                    "CREATE TABLE controller_owner (id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL, owner TEXT NOT NULL); "
                    "CREATE TABLE controller_commits (sequence INTEGER PRIMARY KEY, body TEXT NOT NULL);")
                connection.execute("INSERT INTO metadata VALUES ('policy_sha256',?)", (lab.digest(self.journal.rules),))
                connection.execute("INSERT INTO controller_binding VALUES (1,?)", (ev.canonical(self.binding),))
                connection.execute("INSERT INTO controller_owner VALUES (1,0,'')")
                connection.commit()
            lock.check()
        finally:
            lock.close()
        return self

    def _load(self, connection):
        actual = self.journal._replay(connection)
        lab.require(connection.execute("SELECT body FROM controller_binding").fetchall()
                    == [(ev.canonical(self.binding),)], "CONTROLLER_BINDING_CHANGED")
        owner_rows = connection.execute("SELECT epoch,owner FROM controller_owner").fetchall()
        lab.require(len(owner_rows) == 1, "CONTROLLER_OWNER_ROWS")
        epoch, owner = owner_rows[0]
        lab.require(type(epoch) is int and 0 <= epoch <= 1024 and type(owner) is str
                    and (owner == "" or len(owner) == 32 and all(v in "0123456789abcdef" for v in owner)),
                    "CONTROLLER_OWNER_RECORD")
        rows = connection.execute("SELECT sequence,body FROM controller_commits ORDER BY sequence").fetchall()
        lab.require(len(rows) <= len(self.plan), "CONTROLLER_CHECKPOINT_BOUND")
        state, commits = x.empty(), []
        anchor = checkpoint(state, -1, lab.digest(self.binding))
        for index, (sequence, raw) in enumerate(rows):
            value = ev.parse(raw.encode())
            lab.require(type(sequence) is int and sequence == index, "CONTROLLER_SQL_SEQUENCE")
            before = anchor
            results, _ = project(state, self.plan[index], self.journal.rules)
            body = {"protocol": PROTOCOL, "sequence": index, "batch_sha256": lab.digest(self.plan[index]),
                    "batch_id": self.plan[index]["id"], "before": before, "after": cursor(state), "results": results}
            expected = {**body, "sha256": lab.digest(body)}
            lab.require(ev.canonical(value) == ev.canonical(expected), "CONTROLLER_CHECKPOINT_REPLAY")
            anchor = checkpoint(state, index, expected["sha256"])
            commits.append(expected)
        lab.require(actual == state, "CONTROLLER_UNCHECKPOINTED_MEMORY")
        return {"checkpoint": anchor, "commits": commits, "state": state, "epoch": epoch, "owner": owner}

    def snapshot(self, expected=None):
        if expected is not None:
            validate_anchor(expected)
        with closing(self._connect(readonly=True)) as connection:
            connection.execute("BEGIN")
            result = self._load(connection)
            if expected is not None:
                lab.require(result["checkpoint"] == expected, "CONTROLLER_EXPECTED_CHECKPOINT")
            return result

    def acquire(self, expected, *, recover=False):
        validate_anchor(expected)
        lab.require(type(recover) is bool, "CONTROLLER_RECOVERY_FLAG")
        lock = FileLock(str(self.path) + ".lock").acquire()
        try:
            with closing(self._connect(readonly=False)) as connection:
                connection.execute("BEGIN IMMEDIATE")
                value = self._load(connection)
                lab.require(value["checkpoint"] == expected, "CONTROLLER_EXPECTED_CHECKPOINT")
                lab.require(bool(value["owner"]) == recover, "CONTROLLER_RECOVERY_REQUIRED" if value["owner"]
                            else "CONTROLLER_RECOVERY_NOT_REQUIRED")
                lab.require(value["epoch"] < 1024, "CONTROLLER_EPOCH_BOUND")
                owner, epoch = secrets.token_hex(16), value["epoch"] + 1
                connection.execute("UPDATE controller_owner SET epoch=?,owner=?", (epoch, owner))
                connection.commit()
            return Session(self, lock, epoch, owner)
        except BaseException:
            lock.close()
            raise


class Session:
    def __init__(self, controller, lock, epoch, owner):
        self.controller, self.lock, self.epoch, self.owner = controller, lock, epoch, owner

    def _check(self, value):
        self.lock.check()
        lab.require((value["epoch"], value["owner"]) == (self.epoch, self.owner), "CONTROLLER_FENCED_SESSION")

    def apply(self, index, expected):
        self.lock.check()
        validate_anchor(expected)
        c = self.controller
        lab.require(type(index) is int and 0 <= index < len(c.plan), "CONTROLLER_BATCH_INDEX")
        with closing(c._connect(readonly=False)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            value = c._load(connection)
            self._check(value)
            if index < len(value["commits"]):
                original = value["commits"][index]
                lab.require(expected == original["before"], "CONTROLLER_RETRY_CHECKPOINT")
                return {"commit": original, "duplicate": True}
            lab.require(index == len(value["commits"]) and expected == value["checkpoint"], "CONTROLLER_COMPARE_AND_SWAP")
            results, events = project(value["state"], c.plan[index], c.journal.rules)
            body = {"protocol": PROTOCOL, "sequence": index, "batch_sha256": lab.digest(c.plan[index]),
                    "batch_id": c.plan[index]["id"], "before": expected, "after": cursor(value["state"]), "results": results}
            commit = {**body, "sha256": lab.digest(body)}
            for event in events:
                connection.execute("INSERT INTO events VALUES (?, ?)", (event["sequence"], ev.canonical(event)))
            connection.execute("INSERT INTO controller_commits VALUES (?, ?)", (index, ev.canonical(commit)))
            check_size(connection)
            self.lock.check()
            connection.commit()
        return {"commit": commit, "duplicate": False}

    def close(self):
        if self.lock.file is None:
            return
        try:
            self.lock.check()
            with closing(self.controller._connect(readonly=False)) as connection:
                connection.execute("BEGIN IMMEDIATE")
                self._check(self.controller._load(connection))
                connection.execute("UPDATE controller_owner SET owner='' WHERE epoch=? AND owner=?", (self.epoch, self.owner))
                connection.commit()
        finally:
            self.lock.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
