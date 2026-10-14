"""Transactional local research history. Hashes are checkpoints, not witnesses."""

import hashlib
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from .data import (
    HOUR,
    MAX_BYTES,
    ResearchError,
    canonical,
    decode,
    digest,
    exact,
    integer,
    parse_dataset,
    require,
)
from .importer import import_csv
from .reports import code_fingerprint
from .study import STUDY_RULES, bar_record, known_prefix, parse_plan, run_study
from .study_reports import validate_study

PROTOCOL = "ZOORA_SFP_NOTEBOOK_V1"
APPLICATION_ID = 0x5A534650
MAX_EVENTS = 64
MAX_ARTIFACT = 32 * 1024 * 1024
MAX_STORED = 128 * 1024 * 1024
MAX_DATABASE = 256 * 1024 * 1024
ZERO = "0" * 64
SCHEMA = """CREATE TABLE events (
    seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, recorded_ms INTEGER NOT NULL,
    previous_sha256 TEXT NOT NULL, metadata BLOB NOT NULL,
    artifact BLOB NOT NULL, event_sha256 TEXT NOT NULL UNIQUE
)"""


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def dataset_value(ds):
    return {"protocol": "ZOORA_SFP_DATASET_V1", "market": ds.market,
            "classification": ds.classification, "availability": ds.availability,
            "source_sha256": ds.source_sha256, "captured_ms": ds.captured_ms,
            "purpose": ds.purpose, "bars": [bar_record(b) for b in ds.bars]}


def _clock():
    return time.time_ns() // 1_000_000


def event_record(seq, kind, recorded_ms, previous, metadata, artifact):
    integer(seq, 1, MAX_EVENTS)
    integer(recorded_ms, 0, 253_402_300_799_000)
    require(kind in {"OPEN", "CAPTURE", "EVALUATION"} and isinstance(metadata, dict), "INVALID_EVENT")
    require(isinstance(artifact, bytes) and len(artifact) <= MAX_ARTIFACT, "ARTIFACT_SIZE_LIMIT")
    identity = {"protocol": PROTOCOL, "seq": seq, "kind": kind, "recorded_ms": recorded_ms,
                "previous_sha256": previous, "metadata": metadata,
                "artifact_sha256": sha(artifact), "artifact_bytes": len(artifact)}
    return dict(identity, event_sha256=digest(identity))


def _initial(raw, plan, delay_ms, recorded_ms):
    parse_plan(plan)
    ds = parse_dataset(raw)
    integer(delay_ms, 0, 24 * HOUR)
    require(ds.availability == "SYNTHETIC_RECONSTRUCTION" and
            all(b.available_ms == b.close_ms + delay_ms for b in ds.bars),
            "NOTEBOOK_REQUIRES_DECLARED_RECONSTRUCTION_DELAY")
    require(ds.captured_ms <= recorded_ms, "CAPTURE_AFTER_LOCAL_RECORDING_TIME")
    require(ds.dataset_sha256 == plan["prepared_from_dataset_sha256"] and
            ds.captured_ms == plan["prepared_from_capture_ms"], "PLAN_BASELINE_MISMATCH")
    require(ds.market == plan["market"] and ds.classification == plan["price_classification"] and
            ds.availability == plan["availability_semantics"], "STUDY_DATA_CONTRACT_MISMATCH")
    require(known_prefix(ds, plan["start_ms"] + plan["train_hours"] * HOUR).dataset_sha256 ==
            plan["first_train_prefix_sha256"], "FROZEN_TRAINING_HISTORY_CHANGED")
    return ds


def merge_csv(previous, raw, captured_ms, delay_ms, recorded_ms):
    """Require a matching last-bar overlap; retain gaps and reject backfills/revisions."""
    require(previous.captured_ms < captured_ms <= recorded_ms, "NONINCREASING_OR_FUTURE_CAPTURE")
    body, imported = import_csv(raw, **previous.market, captured_ms=captured_ms,
                                delay_ms=delay_ms, classification=previous.classification)
    incoming = parse_dataset(body)
    old = {b.open_ms: bar_record(b) for b in previous.bars}
    last = previous.bars[-1].open_ms
    require(any(b.open_ms == last for b in incoming.bars), "LAST_BAR_OVERLAP_REQUIRED")
    additions = []
    for bar in incoming.bars:
        if bar.open_ms <= last:
            require(bar.open_ms in old, "HISTORY_BACKFILL_REJECTED")
            require(old[bar.open_ms] == bar_record(bar), "HISTORICAL_REVISION_REJECTED")
        else:
            additions.append(bar_record(bar))
    require(additions, "NO_NEW_COMPLETED_BARS")
    value = dataset_value(previous)
    value["bars"].extend(additions)
    value["captured_ms"] = captured_ms
    value["source_sha256"] = digest({"protocol": "ZOORA_SFP_SOURCE_CHAIN_V1",
                                     "previous_dataset_sha256": previous.dataset_sha256,
                                     "raw_csv_sha256": sha(raw), "captured_ms": captured_ms,
                                     "delay_ms": delay_ms})
    ds = parse_dataset(canonical(value))
    receipt = {"input_format": "KRAKEN_H1_SEVEN_COLUMN_CSV", "raw_csv_sha256": sha(raw),
               "raw_csv_bytes": len(raw), "captured_ms": captured_ms, "delay_ms": delay_ms,
               "previous_dataset_sha256": previous.dataset_sha256,
               "dataset_sha256": ds.dataset_sha256, "added_bars": len(additions),
               "overlap_bars": len(incoming.bars) - len(additions), "total_bars": len(ds.bars),
               "coverage_gaps": list(ds.gaps), "unfinished_rows_excluded":
               imported["unfinished_or_not_yet_available"],
               "source_verification": "UNAVAILABLE", "availability": "SYNTHETIC_RECONSTRUCTION",
               "capture_time_status": "USER_ASSERTED_NOT_INDEPENDENTLY_ATTESTED"}
    return ds, receipt


def replay_events(events, artifacts, expected_head=None, rerun=False):
    """Replay inputs and accounting. Optional full replay requires matching engine bytes."""
    require(isinstance(events, list) and isinstance(artifacts, list) and
            1 <= len(events) == len(artifacts) <= MAX_EVENTS, "INVALID_EVENT_COUNT")
    previous, last_time, stored = ZERO, 0, 0
    ds, plan, delay, capture_head = None, None, None, None
    evaluations, captures, run_ids = [], [], set()
    for seq, (event, raw) in enumerate(zip(events, artifacts, strict=True), 1):
        exact(event, {"protocol", "seq", "kind", "recorded_ms", "previous_sha256", "metadata",
                      "artifact_sha256", "artifact_bytes", "event_sha256"}, "INVALID_EVENT_FIELDS")
        require(canonical(event) == canonical(event_record(seq, event["kind"], event["recorded_ms"], previous,
                                                          event["metadata"], raw)), "EVENT_CHAIN_MISMATCH")
        require(event["recorded_ms"] >= last_time, "LOCAL_CLOCK_MOVED_BACKWARDS")
        stored += len(raw) + len(canonical(event))
        require(stored <= MAX_STORED, "NOTEBOOK_STORAGE_LIMIT")
        meta = event["metadata"]
        if seq == 1:
            require(event["kind"] == "OPEN", "OPEN_EVENT_REQUIRED")
            exact(meta, {"plan", "delay_ms", "dataset_sha256"})
            plan, delay = meta["plan"], meta["delay_ms"]
            ds = _initial(raw, plan, delay, event["recorded_ms"])
            require(meta["dataset_sha256"] == ds.dataset_sha256, "DATASET_ID_MISMATCH")
            capture_head = event["event_sha256"]
        elif event["kind"] == "CAPTURE":
            exact(meta, {"receipt"})
            ds, receipt = merge_csv(ds, raw, meta["receipt"]["captured_ms"], delay, event["recorded_ms"])
            require(canonical(meta["receipt"]) == canonical(receipt), "CAPTURE_RECEIPT_MISMATCH")
            capture_head = event["event_sha256"]
            captures.append(dict(event_seq=seq, event_sha256=capture_head, **receipt))
        else:
            require(event["kind"] == "EVALUATION", "OPEN_EVENT_REPEATED")
            exact(meta, {"capture_event_sha256", "dataset_sha256", "run_id", "code_sha256"})
            report = decode(raw, MAX_ARTIFACT)
            validate_study(report, plan)
            require(meta == {"capture_event_sha256": capture_head, "dataset_sha256": ds.dataset_sha256,
                             "run_id": report["run_id"], "code_sha256": report["code_sha256"]} and
                    report["dataset_sha256"] == ds.dataset_sha256 and
                    report["source_sha256"] == ds.source_sha256 and report["captured_ms"] == ds.captured_ms,
                    "EVALUATION_DATA_MISMATCH")
            require(report["run_id"] not in run_ids, "DUPLICATE_EVALUATION")
            run_ids.add(report["run_id"])
            if rerun:
                require(report["code_sha256"] == code_fingerprint()["sha256"], "REPLAY_ENGINE_BYTES_DIFFER")
                require(run_study(ds, plan, report["source_head_sha"]) == report, "EVALUATION_REPLAY_MISMATCH")
            evaluations.append({"event_seq": seq, "event_sha256": event["event_sha256"],
                                "recorded_ms": event["recorded_ms"], "report": report})
        previous, last_time = event["event_sha256"], event["recorded_ms"]
    require(expected_head is None or expected_head == previous, "EXPECTED_HEAD_MISMATCH")
    return {"events": events, "artifacts": artifacts, "dataset": ds, "plan": plan,
            "delay_ms": delay, "head_sha256": previous, "capture_head": capture_head,
            "captures": captures, "evaluations": evaluations, "stored_bytes": stored}


@contextmanager
def connection(path, write=False):
    path = Path(path)
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= MAX_DATABASE,
            "INVALID_NOTEBOOK_FILE")
    require(not any(Path(str(path) + suffix).is_symlink() for suffix in ["-journal", "-wal", "-shm"]),
            "INVALID_NOTEBOOK_SIDECAR")
    con = None
    try:
        con = sqlite3.connect(path.resolve().as_uri() + ("?mode=rw" if write else "?mode=ro"),
                              uri=True, timeout=0.25, isolation_level=None)
        con.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_ARTIFACT + MAX_BYTES)
        con.execute("PRAGMA trusted_schema=OFF")
        if write:
            con.execute("PRAGMA synchronous=FULL")
            con.execute("BEGIN IMMEDIATE")
        else:
            con.execute("PRAGMA query_only=ON")
            con.execute("BEGIN")
        yield con
        con.execute("COMMIT")
    except sqlite3.Error as exc:
        raise ResearchError("NOTEBOOK_SQLITE_OPERATION_FAILED") from exc
    finally:
        if con is not None:
            con.close()


def _load(con, expected_head=None, rerun=False):
    require(con.execute("PRAGMA application_id").fetchone()[0] == APPLICATION_ID and
            con.execute("PRAGMA user_version").fetchone()[0] == 1, "INVALID_NOTEBOOK_SCHEMA")
    schema = con.execute("SELECT name,type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").fetchall()
    require(schema == [("events", "table")], "INVALID_NOTEBOOK_SCHEMA")
    require([r[1] for r in con.execute("PRAGMA table_info(events)")] ==
            ["seq", "kind", "recorded_ms", "previous_sha256", "metadata", "artifact", "event_sha256"],
            "INVALID_NOTEBOOK_SCHEMA")
    count, size = con.execute(
        "SELECT count(*),coalesce(sum(length(metadata)+length(artifact)),0) FROM events").fetchone()
    require(count <= MAX_EVENTS and size <= MAX_STORED, "NOTEBOOK_STORAGE_LIMIT")
    events, artifacts = [], []
    try:
        for seq, kind, stamp, previous, metadata, raw, supplied in con.execute("SELECT * FROM events ORDER BY seq"):
            event = event_record(seq, kind, stamp, previous, decode(metadata), raw)
            require(event["event_sha256"] == supplied, "EVENT_HASH_MISMATCH")
            events.append(event)
            artifacts.append(raw)
        return replay_events(events, artifacts, expected_head, rerun)
    except (KeyError, TypeError, IndexError) as exc:
        raise ResearchError("INVALID_NOTEBOOK_RECORD") from exc


def _insert(con, event, raw):
    con.execute("INSERT INTO events VALUES(?,?,?,?,?,?,?)",
                (event["seq"], event["kind"], event["recorded_ms"], event["previous_sha256"],
                 canonical(event["metadata"]), raw, event["event_sha256"]))


def open_notebook(path, raw, plan, delay_ms=0):
    stamp = _clock()
    ds = _initial(raw, plan, delay_ms, stamp)
    event = event_record(1, "OPEN", stamp, ZERO,
                         {"plan": plan, "delay_ms": delay_ms, "dataset_sha256": ds.dataset_sha256}, raw)
    path = Path(path)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise ResearchError("NOTEBOOK_ALREADY_EXISTS") from exc
    os.close(fd)
    try:
        with connection(path, write=True) as con:
            con.execute("PRAGMA max_page_count=65536")
            con.execute(f"PRAGMA application_id={APPLICATION_ID}")
            con.execute("PRAGMA user_version=1")
            con.execute(SCHEMA)
            _insert(con, event, raw)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return {"status": "OPENED_LOCAL_RESEARCH_NOTEBOOK", "head_sha256": event["event_sha256"],
            "plan_sha256": plan["plan_sha256"], "source_verification": "UNAVAILABLE"}


def load_notebook(path, expected_head=None, rerun=False):
    with connection(path) as con:
        return _load(con, expected_head, rerun)


def _append(path, state, kind, metadata, raw):
    event = event_record(len(state["events"]) + 1, kind, _clock(), state["head_sha256"], metadata, raw)
    # Validate the entire proposed history before entering the small write transaction.
    replay_events([*state["events"], event], [*state["artifacts"], raw])
    with connection(path, write=True) as con:
        _load(con, state["head_sha256"])
        _insert(con, event, raw)
    return event


def capture_csv(path, raw, captured_ms, expected_head=None):
    state = load_notebook(path, expected_head)
    require(len(raw) <= MAX_BYTES, "INPUT_SIZE_LIMIT")
    require(not any(c["raw_csv_sha256"] == sha(raw) for c in state["captures"]), "DUPLICATE_CAPTURE")
    ds, receipt = merge_csv(state["dataset"], raw, captured_ms, state["delay_ms"], _clock())
    event = _append(path, state, "CAPTURE", {"receipt": receipt}, raw)
    return {"status": "APPENDED_UNVERIFIED_HISTORY", "head_sha256": event["event_sha256"],
            "dataset_sha256": ds.dataset_sha256, "receipt": receipt, "evaluation_status": "REQUIRED"}


def evaluate_notebook(path, source_head=None, expected_head=None):
    state = load_notebook(path, expected_head)
    report = run_study(state["dataset"], state["plan"], source_head)
    for evaluation in state["evaluations"]:
        if evaluation["report"]["run_id"] == report["run_id"]:
            return {"status": "EVALUATION_ALREADY_RECORDED", "run_id": report["run_id"],
                    "head_sha256": state["head_sha256"]}
    event = _append(path, state, "EVALUATION",
                    {"capture_event_sha256": state["capture_head"],
                     "dataset_sha256": state["dataset"].dataset_sha256,
                     "run_id": report["run_id"], "code_sha256": report["code_sha256"]}, canonical(report))
    return {"status": "RECORDED_CHRONOLOGICAL_EVALUATION", "run_id": report["run_id"],
            "head_sha256": event["event_sha256"], "trials": len(report["trials"]),
            "readiness": report["readiness"], "funds_transferred": "0", "tokens_burned": "0"}


def notebook_status(state):
    ds, plan = state["dataset"], state["plan"]
    latest = state["evaluations"][-1]["report"] if state["evaluations"] else None
    first_test = plan["start_ms"] + (plan["train_hours"] + plan["embargo_hours"]) * HOUR
    initial = parse_dataset(state["artifacts"][0])
    return {"protocol": PROTOCOL, "head_sha256": state["head_sha256"],
            "plan_sha256": plan["plan_sha256"], "events": len(state["events"]),
            "csv_captures": len(state["captures"]), "evaluations": len(state["evaluations"]),
            "bars": len(ds.bars), "coverage_gaps": list(ds.gaps), "captured_ms": ds.captured_ms,
            "dataset_sha256": ds.dataset_sha256, "classification": ds.classification,
            "evaluation_status": "CURRENT" if latest and latest["dataset_sha256"] == ds.dataset_sha256
            else "REQUIRED", "latest_run_id": latest["run_id"] if latest else None,
            "evaluation_bars_already_present_at_open": sum(b.open_ms >= first_test for b in initial.bars),
            "unseen_status": "NOT_INDEPENDENTLY_ATTESTED", "source_verification": "UNAVAILABLE",
            "clock_status": "LOCAL_HOST_CLOCK_NOT_EXTERNAL_WITNESS",
            "history_scope": "THIS_NOTEBOOK_ONLY_NOT_ALL_PROJECT_EXPERIMENTS",
            "rollback_detection": "REQUIRES_SEPARATELY_RETAINED_EXPECTED_HEAD",
            "readiness": "BLOCKED_NOT_A_FUNDED_STRATEGY", "funds_transferred": "0",
            "tokens_purchased": "0", "tokens_burned": "0", "rules": STUDY_RULES}
