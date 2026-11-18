"""SQLite in WAL mode. Reservations commit inside BEGIN IMMEDIATE."""

from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
from collections.abc import Callable
from typing import TypeVar

from zoora_signer.models import Json, Payload, canonical

GENESIS = "0" * 64
T = TypeVar("T")

SCHEMA = """
CREATE TABLE IF NOT EXISTS signer_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  execution_mode TEXT NOT NULL,
  activity TEXT NOT NULL,
  halt_reason TEXT,
  buy_halt_reason TEXT,
  route_approved INTEGER NOT NULL,
  route_source TEXT,
  route_source_date TEXT,
  hmac_version INTEGER NOT NULL,
  provider_name TEXT NOT NULL,
  boot_id TEXT NOT NULL,
  ledger_sol_lamports INTEGER,
  paper_pnl_cents INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS anchor_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  written INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_ms INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id TEXT NOT NULL UNIQUE,
  side TEXT NOT NULL,
  mint TEXT NOT NULL,
  stake_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  ct_day TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  reached_signing INTEGER NOT NULL DEFAULT 0,
  release_reason TEXT,
  trade_id INTEGER,
  signature TEXT
);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  cost_cents INTEGER NOT NULL,
  recovered_cents INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  status TEXT NOT NULL,
  opened_ms INTEGER NOT NULL,
  simulated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS decisions (
  intent_id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL,
  code TEXT NOT NULL,
  simulated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS intent_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id TEXT NOT NULL,
  seen_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS equity_day (
  ct_day TEXT PRIMARY KEY,
  start_equity_cents INTEGER NOT NULL,
  withdrawals_cents INTEGER NOT NULL DEFAULT 0,
  deposits_cents INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS expected_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lamports INTEGER NOT NULL,
  ttl_ms INTEGER NOT NULL,
  created_ms INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS whitelist (
  address TEXT PRIMARY KEY,
  added_ms INTEGER NOT NULL
);
"""


class SecretInLog(RuntimeError):
    pass


def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, isolation_level=None, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(path: str, provider: str) -> None:
    conn = connect(path)
    try:
        conn.executescript(SCHEMA)
        columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(trades)").fetchall()}
        if "simulated" not in columns:
            conn.execute("ALTER TABLE trades ADD COLUMN simulated INTEGER NOT NULL DEFAULT 0")
        state_columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(signer_state)").fetchall()}
        if "paper_pnl_cents" not in state_columns:
            conn.execute("ALTER TABLE signer_state ADD COLUMN paper_pnl_cents INTEGER NOT NULL DEFAULT 0")
        meta = conn.execute("SELECT id FROM anchor_meta WHERE id = 1").fetchone()
        events = conn.execute("SELECT COUNT(*) AS n FROM events").fetchone()
        if meta is None and (events is None or int(events["n"]) == 0):
            conn.execute("INSERT INTO anchor_meta (id, written) VALUES (1, 0)")
        row = conn.execute("SELECT id FROM signer_state WHERE id = 1").fetchone()
        if row is None:
            conn.execute(
                """
                INSERT INTO signer_state (
                  id, execution_mode, activity, halt_reason, buy_halt_reason,
                  route_approved, route_source, route_source_date, hmac_version,
                  provider_name, boot_id, ledger_sol_lamports
                ) VALUES (1, 'DRY_RUN', 'PAUSED', NULL, NULL, 0, NULL, NULL, 1, ?, '', NULL)
                """,
                (provider,),
            )
    finally:
        conn.close()


def transact(path: str, fn: Callable[[sqlite3.Connection], T]) -> T:
    conn = connect(path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        result = fn(conn)
        conn.execute("COMMIT")
        return result
    except Exception:
        try:
            conn.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise
    finally:
        conn.close()


def screen(payload: Payload, needles: tuple[str, ...]) -> None:
    text = canonical(payload)
    for needle in needles:
        if len(needle) >= 8 and needle in text:
            raise SecretInLog("SECRET_IN_LOG")


def _event_material(event_id: int, ts_ms: int, kind: str, prev: str, body: str) -> bytes:
    return f"{event_id}|{ts_ms}|{kind}|{prev}|{body}".encode()


def legacy_event_digest(event_id: int, ts_ms: int, kind: str, prev: str, body: str) -> str:
    """Unkeyed sha256 chain used by databases from before the event HMAC."""

    return hashlib.sha256(_event_material(event_id, ts_ms, kind, prev, body)).hexdigest()


def event_digest(event_id: int, ts_ms: int, kind: str, prev: str, body: str, key: bytes) -> str:
    return hmac.new(key, _event_material(event_id, ts_ms, kind, prev, body), hashlib.sha256).hexdigest()


def append_event(
    conn: sqlite3.Connection,
    kind: str,
    payload: Payload,
    ts_ms: int,
    needles: tuple[str, ...],
    key: bytes,
) -> int:
    if len(key) < 32:
        raise ValueError("EVENT_HMAC")
    screen(payload, needles)
    body = canonical(payload)
    prev_row = conn.execute("SELECT id, hash FROM events ORDER BY id DESC LIMIT 1").fetchone()
    prev = str(prev_row["hash"]) if prev_row is not None else GENESIS
    event_id = int(prev_row["id"]) + 1 if prev_row is not None else 1
    digest = event_digest(event_id, ts_ms, kind, prev, body, key)
    conn.execute(
        "INSERT INTO events (id, ts_ms, kind, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?)",
        (event_id, ts_ms, kind, body, prev, digest),
    )
    return event_id


def verify_chain(conn: sqlite3.Connection, key: bytes) -> bool:
    """Every event must be HMAC'd with the event key and carry event_key_id.

    There is no unkeyed prefix. An old database is refused; start a fresh one
    and run init-event-key before the first event.
    """

    if len(key) < 32:
        return False
    prev = GENESIS
    rows = conn.execute(
        "SELECT id, ts_ms, kind, payload, prev_hash, hash FROM events ORDER BY id"
    ).fetchall()
    for row in rows:
        if str(row["prev_hash"]) != prev:
            return False
        body = str(row["payload"])
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            return False
        if not isinstance(payload, dict) or not isinstance(payload.get("event_key_id"), str):
            return False
        if not payload["event_key_id"]:
            return False
        expect = event_digest(int(row["id"]), int(row["ts_ms"]), str(row["kind"]), prev, body, key)
        if str(row["hash"]) != expect:
            return False
        prev = expect
    return True


def query(path: str, fn: Callable[[sqlite3.Connection], T]) -> T:
    """Read without starting a write transaction."""

    conn = connect(path)
    try:
        return fn(conn)
    finally:
        conn.close()


def read_events(conn: sqlite3.Connection, after: int) -> list[tuple[int, str, str]]:
    rows = conn.execute(
        "SELECT id, kind, payload FROM events WHERE id > ? ORDER BY id",
        (after,),
    ).fetchall()
    return [(int(row["id"]), str(row["kind"]), str(row["payload"])) for row in rows]


def cell(row: sqlite3.Row, key: str) -> Json:
    value = row[key]
    if value is None or isinstance(value, str | int | bool):
        return value
    return str(value)
