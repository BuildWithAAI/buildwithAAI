"""Capped signer. Boots DRY_RUN and PAUSED. This build does not broadcast."""

from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TypeVar
from zoneinfo import ZoneInfo

from zoora_signer.caps import CapView, evaluate_buy, evaluate_sell
from zoora_signer.constants import (
    BUY_MIN_INTERVAL_MS,
    CLOCK_SKEW_MS,
    CT_ZONE,
    DAILY_LOSS_CAP_CENTS,
    HMAC_MIN_BYTES,
    INTENT_PREFIX,
    INTENT_TTL_MS,
    PREFLIGHT_INTERVAL_MS,
    RPC_PROVIDER_NAME,
    SLEEP_JUMP_MS,
    UNCONFIRMED_MS,
    USD_CAP_MICRO,
    VET_CONFIG_VERSION,
    VET_FRESH_MS,
    WALLET_CAP_CENTS,
)
from zoora_signer.db import SecretInLog, append_event, init_db, query, read_events, transact, verify_chain
from zoora_signer.models import Decision, Intent, OracleReading, Payload, sol_usd_cents, sol_usd_micro
from zoora_signer.ports import (
    Broadcaster,
    ChainView,
    Clock,
    IntentFeed,
    KillSwitch,
    MarkSource,
    Oracle,
    OsProbe,
    SecretStore,
    VetClient,
)
from zoora_signer.quote import lamports_for_cents
from zoora_signer.secrets import reject_key_material_in_env
from zoora_signer.txbuild import BuiltTx
from zoora_signer.vet import VetAssessment, assess_vet

MINT_OK = __import__("re").compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
STICKY_HALTS = frozenset(
    {
        "unexpected_sol",
        "reconcile_unknown",
        "LEDGER_BREACH",
        "agent_guard",
        "anchor_mismatch",
        "hash_chain",
        "settle_error",
        "unconfirmed",
    }
)


def _parse_reasons(text: str) -> set[str]:
    return {part for part in text.split(",") if part}


def _format_reasons(reasons: set[str]) -> str:
    return ",".join(sorted(reasons))


def _lamport_cents(lamports: int, sol_cents: int) -> tuple[int, int]:
    """Ceiling cents for caps, floor cents for loss. Both come from integer micro-USD."""

    if lamports <= 0 or sol_cents <= 0:
        return 0, 0
    num = lamports * sol_cents * 10_000
    micro = num // 1_000_000_000
    if num % 1_000_000_000:
        micro += 1
    ceil_cents = (micro + 9_999) // 10_000
    floor_cents = (num // 1_000_000_000) // 10_000
    return ceil_cents, floor_cents


def _state_digest(db: sqlite3.Connection) -> str:
    row = db.execute("SELECT * FROM signer_state WHERE id = 1").fetchone()
    if row is None:
        return ""
    body = "|".join(f"{key}={row[key]}" for key in row.keys())
    return hashlib.sha256(body.encode()).hexdigest()


def _add_halt(db: sqlite3.Connection, reason: str) -> None:
    """Append a halt reason. Sticky reasons are never replaced."""

    row = db.execute("SELECT halt_reason FROM signer_state WHERE id = 1").fetchone()
    current = _parse_reasons(str(row["halt_reason"] or "") if row is not None else "")
    current.add(reason)
    db.execute(
        "UPDATE signer_state SET activity = 'HALTED', halt_reason = ? WHERE id = 1",
        (_format_reasons(current),),
    )


def ct_day(now_ms: int) -> str:
    moment = datetime.fromtimestamp(now_ms / 1000, ZoneInfo(CT_ZONE))
    return moment.date().isoformat()


def sign_intent(raw: dict[str, object], key: bytes) -> str:
    body = json.dumps(raw, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hmac.new(key, body.encode(), hashlib.sha256).hexdigest()


@dataclass
class Services:
    db_path: Path
    secrets: SecretStore
    oracle: Oracle
    vet: VetClient
    clock: Clock
    chain: ChainView
    marks: MarkSource
    kill: KillSwitch
    probe: OsProbe
    broadcaster: Broadcaster
    feed: IntentFeed | None = None
    hud_path: Path | None = None
    vet_public_key: bytes | None = None
    provider_name: str = RPC_PROVIDER_NAME
    local_exits_enabled: bool = False
    fee_lamports: int = 0
    ata_rent_lamports: int = 0
    defer_settle: bool = False
    telegram_allow: set[str] | None = None
    market: object | None = None
    time_stop_ms: int = 6 * 60 * 60 * 1000
    hard_stop_bps: int = 5_000


T = TypeVar("T")


class AnchorMismatch(Exception):
    """A write found signer_state different from the last recorded digest."""


_MISMATCH = object()


def _state_snapshot(row: sqlite3.Row) -> dict[str, str | int | bool | None]:
    snap: dict[str, str | int | bool | None] = {}
    for key in row.keys():
        value = row[key]
        if value is None or isinstance(value, str | int | bool):
            snap[str(key)] = value
        else:
            snap[str(key)] = str(value)
    return snap


def _reanchor_payload(
    previous: dict[str, str | int | bool | None],
    new: dict[str, str | int | bool | None],
    chain_sol: int,
    provider: str,
) -> Payload:
    payload: Payload = {"provider": provider, "chain_sol": chain_sol}
    for key, value in previous.items():
        payload[f"previous_{key}"] = value
    for key, value in new.items():
        payload[f"new_{key}"] = value
    return payload


class RefuseBroadcaster:
    enabled = False

    def submit(self, payload: bytes) -> None:
        raise RuntimeError("BROADCAST_DISABLED")


class Signer:
    def __init__(self, services: Services) -> None:
        self.s = services
        self.path = str(services.db_path)
        self._last_wall = 0
        self._last_mono = 0
        self._last_preflight = 0
        self._feed_cursor: str | None = None
        self._hud_after = 0
        self._pushed_after = 0

    @classmethod
    def open(cls, services: Services) -> Signer:
        signer = cls(services)
        signer.boot()
        return signer

    @classmethod
    def attach(cls, services: Services) -> Signer:
        """Read-only handle. Does not create the database or write a boot event."""
        return cls(services)

    def boot(self) -> None:
        reject_key_material_in_env()
        init_db(self.path, self.s.provider_name)
        boot_id = uuid.uuid4().hex
        opening = self.s.chain.sol_lamports()

        def op(conn: sqlite3.Connection) -> None:
            from sqlite3 import Connection

            db = conn if isinstance(conn, Connection) else None
            assert isinstance(db, Connection)
            if not self._anchor_matches(db) or not self._state_event_matches(db):
                _add_halt(db, "anchor_mismatch")
            row = db.execute("SELECT * FROM signer_state WHERE id = 1").fetchone()
            assert row is not None
            halted = str(row["activity"]) == "HALTED"
            mode = "DRY_RUN" if int(row["route_approved"]) != 1 else str(row["execution_mode"])
            ledger = row["ledger_sol_lamports"]
            if ledger is None:
                ledger = opening
            if halted:
                db.execute(
                    """
                    UPDATE signer_state
                    SET execution_mode = ?, boot_id = ?, ledger_sol_lamports = ?, provider_name = ?
                    WHERE id = 1
                    """,
                    (mode, boot_id, int(ledger), self.s.provider_name),
                )
                self._event(db, "boot_halt_persisted", {"boot_id": boot_id, "reason": str(row["halt_reason"] or "")})
            else:
                db.execute(
                    """
                    UPDATE signer_state
                    SET activity = 'PAUSED', halt_reason = NULL, execution_mode = ?,
                        boot_id = ?, ledger_sol_lamports = ?, provider_name = ?
                    WHERE id = 1
                    """,
                    (mode, boot_id, int(ledger), self.s.provider_name),
                )
                self._event(db, "boot_paused", {"boot_id": boot_id, "mode": mode})
            self._reconcile(db)
            if not self._verify(db):
                _add_halt(db, "hash_chain")
                self._event(db, "halt", {"reason": "hash_chain"})

        transact(self.path, op)
        wall, mono = self.s.probe.clocks()
        self._last_wall, self._last_mono = wall, mono
        self.run_preflight("boot")
        self.poll_kill()
        self._sync_hud()

    def run_preflight(self, reason: str) -> list[str]:
        failures: list[str] = []
        skew = self.s.probe.time_skew_ms()
        if skew is None or skew > CLOCK_SKEW_MS:
            failures.append("clock_sync")
        if not self.s.probe.defender_active():
            failures.append("defender")
        if self.s.probe.elevated_or_admin():
            failures.append("standard_user")
        if not self.s.probe.acl_owner_only():
            failures.append("acl")
        slept = self._sleep_jump() or self.s.probe.consume_power_event()
        if slept:
            failures.append("sleep_resume")
        self._last_preflight = self.s.clock.now_ms()
        if failures:
            self._pause(reason, failures)
        elif reason == "boot":
            self._note("preflight", {"reason": reason, "result": "pass"})
        return failures

    def poll(self) -> None:
        now = self.s.clock.now_ms()
        if now - self._last_preflight >= PREFLIGHT_INTERVAL_MS:
            self.run_preflight("interval")
        self.poll_kill()
        self._expire_unconfirmed()

    def poll_kill(self) -> str:
        try:
            status = self.s.kill.poll()
        except Exception:
            status = "killed"
        if status != "clear":
            self._halt("agent_guard")
            return "killed"
        return "clear"

    def doctor_lines(self) -> list[str]:
        skew = self.s.probe.time_skew_ms()
        checks = (
            ("boot_paused", self.activity() == "PAUSED" or self.activity() == "HALTED"),
            ("clock_sync", skew is not None and skew <= CLOCK_SKEW_MS),
            ("defender", self.s.probe.defender_active()),
            ("standard_user", not self.s.probe.elevated_or_admin()),
            ("acl", self.s.probe.acl_owner_only()),
            ("signing_key", self.s.secrets.has_signing_key()),
        )
        return [f"{name}: {'pass' if ok else 'fail'}" for name, ok in checks]

    def handle_intent(self, raw: bytes, signature: str) -> Decision:
        if self.poll_kill() != "clear":
            return Decision(False, "KILL_HOLD", self.mode() != "LIVE")
        reject_key_material_in_env()
        try:
            if not self._hmac_ok(raw, signature):
                return self._note("intent_refused", {"code": "BAD_HMAC", "provider": self.s.provider_name})
            parsed = json.loads(
                raw.decode("utf-8"),
                parse_constant=_reject_non_finite,
                object_pairs_hook=_reject_duplicate_keys,
            )
        except (UnicodeError, json.JSONDecodeError, ValueError):
            return self._note("intent_refused", {"code": "BAD_INTENT"})
        if not isinstance(parsed, dict):
            return self._note("intent_refused", {"code": "BAD_INTENT"})
        intent = parse_intent(parsed)
        if intent is None:
            return self._note("intent_refused", {"code": "BAD_INTENT"})
        if intent.key_id != self._key_id():
            return self._note("intent_refused", {"code": "BAD_KEY_ID", "intent_id": intent.intent_id})
        try:
            stored = self._stored(intent.intent_id)
        except AnchorMismatch:
            return Decision(False, "ANCHOR_MISMATCH", self.mode() != "LIVE")
        if stored is not None:
            return stored
        now = self.s.clock.now_ms()
        if now - intent.issued_at_ms > INTENT_TTL_MS or intent.issued_at_ms - now > 5_000:
            return self._refuse(intent, "EXPIRED", None, None)
        reading = self.s.oracle.quote(now)
        if not reading.ok:
            self._halt(reading.reason or "ORACLE_DOWN")
            return self._refuse(intent, reading.reason or "ORACLE_DOWN", reading, None)
        assessment: VetAssessment | None = None
        if intent.side == "buy":
            assessment = self._vet_fresh(intent.mint, now)
            return self._buy(intent, reading, assessment)
        return self._sell_intent(intent, reading)

    def pull_once(self) -> list[Decision]:
        feed = self.s.feed
        if feed is None:
            self._note("feed_unreachable", {"code": "NO_FEED"})
            return []
        try:
            batch = feed.pull(self._feed_cursor)
        except Exception:
            self._note("feed_unreachable", {"code": "UNREACHABLE"})
            return []
        if batch.unreachable:
            self._note("feed_unreachable", {"code": "UNREACHABLE"})
            return []
        decisions: list[Decision] = []
        for raw, signature in batch.intents:
            try:
                decisions.append(self.handle_intent(raw, signature))
            except Exception:
                decisions.append(Decision(False, "BAD_INTENT", True))
        try:
            rows = self.read_events(self._pushed_after)
            if rows:
                feed.push_events(
                    [{"id": row_id, "kind": kind, "payload": payload} for row_id, kind, payload in rows]
                )
                self._pushed_after = rows[-1][0]
        except Exception:
            self._note("feed_unreachable", {"code": "PUSH_FAILED"})
        return decisions

    def resume(self) -> Decision:
        failures = self.run_preflight("resume")
        if failures:
            return Decision(False, "PREFLIGHT", False)
        if self.poll_kill() != "clear":
            return Decision(False, "KILL_HOLD", False)
        now = self.s.clock.now_ms()
        reading = self.s.oracle.quote(now)
        if not reading.ok:
            self._halt(reading.reason or "ORACLE_DOWN")
            return Decision(False, reading.reason or "ORACLE_DOWN", False)

        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            if not self._verify(db):
                _add_halt(db, "hash_chain")
                self._event(db, "halt", {"reason": "hash_chain"})
                return Decision(False, "HASH_CHAIN", False)
            row = _state(db)
            if str(row["activity"]) == "HALTED":
                reasons = _parse_reasons(str(row["halt_reason"] or ""))
                kept = reasons & STICKY_HALTS
                if kept != reasons:
                    db.execute(
                        "UPDATE signer_state SET halt_reason = ? WHERE id = 1",
                        (_format_reasons(kept) if kept else None,),
                    )
                    self._event(db, "halt_retained", {"reason": _format_reasons(kept)})
                return Decision(False, "HALT_PERSISTED", False)
            db.execute("UPDATE signer_state SET activity = 'ACTIVE' WHERE id = 1")
            if reading.ok:
                self._ensure_snapshot(db, now, sol_usd_cents(reading))
                self._refresh_buy_halt(db, now, sol_usd_cents(reading))
            event_id = self._event(db, "owner_resume", {"provider": self.s.provider_name})
            simulated = str(row["execution_mode"]) != "LIVE"
            return Decision(True, "RESUMED", simulated, event_id=event_id)

        decision = self._run(op)
        self._sync_hud()
        return decision

    def unhalt(self, confirmation: str) -> Decision:
        if confirmation != "UNHALT":
            return Decision(False, "CONFIRMATION_REQUIRED", False)

        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            if not self._verify(db):
                _add_halt(db, "hash_chain")
                self._event(db, "halt", {"reason": "hash_chain"})
                return Decision(False, "HASH_CHAIN", False)
            row = _state(db)
            if str(row["activity"]) != "HALTED":
                return Decision(False, "NOT_HALTED", False)
            reasons = _parse_reasons(str(row["halt_reason"] or ""))
            for reason in sorted(reasons & STICKY_HALTS):
                if not self._reconcile_ready(db, reason):
                    return Decision(False, "RECONCILE_REQUIRED", False)
            db.execute("UPDATE signer_state SET activity = 'PAUSED', halt_reason = NULL WHERE id = 1")
            self._event(db, "unhalt", {"previous": _format_reasons(reasons)})
            return Decision(True, "UNHALTED", True)

        decision = self._run(op)
        self._sync_hud()
        return decision

    def halt(self, reason: str = "owner") -> Decision:
        self._halt(reason)
        return Decision(True, "HALTED", False)

    def telegram(self, message: dict[str, object] | str) -> Decision:
        parsed = _telegram_update(message)
        if parsed is None:
            self._note("telegram_rejected", {"code": "TELEGRAM_MALFORMED"})
            return Decision(False, "TELEGRAM_MALFORMED", False)
        code, chat, sender, text = parsed
        if code is not None:
            self._note("telegram_rejected", {"code": code})
            return Decision(False, code, False)
        allowed = self._telegram_allow()
        if not chat or not sender or chat not in allowed or sender not in allowed:
            self._note("telegram_rejected", {"code": "TELEGRAM_NOT_ALLOWLISTED"})
            return Decision(False, "TELEGRAM_NOT_ALLOWLISTED", False)
        if text in {"halt", "/halt", "kill"}:
            return self.halt("telegram")
        self._note("telegram_rejected", {"code": "TELEGRAM_HALT_ONLY"})
        return Decision(False, "TELEGRAM_HALT_ONLY", False)

    def set_route(self, source_url: str, source_date: str, permission_text: str) -> Decision:
        if not source_url.startswith("https://") or not _iso_date(source_date) or not permission_text.strip():
            return Decision(False, "ROUTE_SOURCE_REQUIRED", False)
        digest = hashlib.sha256(permission_text.encode()).hexdigest()

        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            db.execute(
                """
                UPDATE signer_state
                SET route_approved = 1, route_source = ?, route_source_date = ?
                WHERE id = 1
                """,
                (source_url, source_date),
            )
            event_id = self._event(
                db,
                "route_approved",
                {
                    "source_url": source_url,
                    "source_date": source_date,
                    "permission_sha256": digest,
                    "provider": self.s.provider_name,
                },
            )
            return Decision(True, "ROUTE_APPROVED", False, event_id=event_id)

        decision = self._run(op)
        self._sync_hud()
        return decision

    def set_mode(self, mode: str) -> Decision:
        if mode not in {"DRY_RUN", "LIVE"}:
            return Decision(False, "BAD_MODE", False)

        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            row = _state(db)
            if mode == "LIVE" and int(row["route_approved"]) != 1:
                self._event(db, "live_refused", {"code": "ROUTE_REQUIRED"})
                return Decision(False, "ROUTE_REQUIRED", True)
            if mode == "LIVE" and not self.s.secrets.has_signing_key():
                self._event(db, "live_refused", {"code": "SIGNING_KEY_REQUIRED"})
                return Decision(False, "SIGNING_KEY_REQUIRED", True)
            if mode == "LIVE" and any(
                getattr(reader, "is_stub", False) for reader in (self.s.oracle, self.s.marks, self.s.chain)
            ):
                self._event(db, "live_refused", {"code": "LIVE_STUB"})
                return Decision(False, "LIVE_STUB", True)
            if mode == "LIVE" and self._devnet_in_live():
                self._event(db, "live_refused", {"code": "LIVE_HOST"})
                return Decision(False, "LIVE_HOST", True)
            db.execute("UPDATE signer_state SET execution_mode = ? WHERE id = 1", (mode,))
            self._event(db, "mode", {"mode": mode})
            return Decision(True, "MODE", mode != "LIVE")

        decision = self._run(op)
        self._sync_hud()
        return decision

    def rotate_hmac(self, new_key: bytes) -> Decision:
        if len(new_key) < HMAC_MIN_BYTES:
            return Decision(False, "HMAC_TOO_SHORT", False)
        self.s.secrets.set_hmac_key(new_key)

        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            db.execute(
                "UPDATE signer_state SET hmac_version = hmac_version + 1 WHERE id = 1"
            )
            version = int(_state(db)["hmac_version"])
            self._event(db, "hmac_rotated", {"version": version})
            return Decision(True, "HMAC_ROTATED", False)

        decision = self._run(op)
        self._sync_hud()
        return decision

    def whitelist_add(self, address: str) -> Decision:
        if MINT_OK.fullmatch(address) is None:
            return Decision(False, "BAD_ADDRESS", False)

        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            db.execute(
                "INSERT OR IGNORE INTO whitelist (address, added_ms) VALUES (?, ?)",
                (address, self.s.clock.now_ms()),
            )
            self._event(db, "whitelist_add", {"address": address})
            return Decision(True, "WHITELISTED", False)

        decision = self._run(op)
        self._sync_hud()
        return decision

    def reanchor(self, confirmation: str) -> Decision:
        """Anchor the current head only when the chain and the ledger agree.

        A typed REANCHOR is required. A kill, a broken event chain, a ledger that
        does not match the authoritative SOL balance, or an open reservation refuses.
        """

        if confirmation != "REANCHOR":
            return Decision(False, "CONFIRMATION_REQUIRED", False)
        if self.poll_kill() != "clear":
            return Decision(False, "KILL_HOLD", False)

        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            if not self._verify(db):
                return Decision(False, "HASH_CHAIN", False)
            if not self.s.chain.authoritative:
                return Decision(False, "RECONCILE_REQUIRED", False)
            try:
                chain_sol = self.s.chain.sol_lamports()
            except Exception:
                return Decision(False, "RECONCILE_REQUIRED", False)
            if type(chain_sol) is not int or chain_sol < 0:
                return Decision(False, "RECONCILE_REQUIRED", False)
            row = _state(db)
            ledger = int(row["ledger_sol_lamports"] or 0)
            if ledger != chain_sol:
                return Decision(False, "RECONCILE_REQUIRED", False)
            pending = db.execute(
                "SELECT COUNT(*) AS n FROM reservations WHERE status IN ('reserved', 'signing')"
            ).fetchone()
            if pending is not None and int(pending["n"]) != 0:
                return Decision(False, "RECONCILE_REQUIRED", False)
            previous = _state_snapshot(row)
            event_id = self._event(
                db,
                "reanchor",
                _reanchor_payload(previous, _state_snapshot(_state(db)), chain_sol, self.s.provider_name),
            )
            return Decision(True, "REANCHORED", False, event_id=event_id)

        decision = transact(self.path, op)
        self._sync_hud()
        return decision

    def expect_deposit(self, lamports: int, ttl_s: int = 3600) -> Decision:
        if lamports <= 0 or ttl_s <= 0:
            return Decision(False, "BAD_DEPOSIT", False)
        now = self.s.clock.now_ms()

        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            db.execute(
                """
                INSERT INTO expected_deposits (lamports, ttl_ms, created_ms, consumed)
                VALUES (?, ?, ?, 0)
                """,
                (lamports, ttl_s * 1000, now),
            )
            self._event(db, "expect_deposit", {"lamports": lamports, "ttl_s": ttl_s})
            return Decision(True, "EXPECT_DEPOSIT", False)

        decision = self._run(op)
        self._sync_hud()
        return decision

    def observe_sol(self, new_lamports: int, source: str | None) -> Decision:
        now = self.s.clock.now_ms()

        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            current = int(_state(db)["ledger_sol_lamports"] or 0)
            delta = new_lamports - current
            if delta == 0:
                return Decision(True, "NO_DELTA", False)
            if delta > 0:
                reading = self.s.oracle.quote(now)
                if not reading.ok:
                    _add_halt(db, reading.reason or "ORACLE_DOWN")
                    self._event(db, "halt", {"reason": reading.reason or "ORACLE_DOWN"})
                    return Decision(False, reading.reason or "ORACLE_DOWN", False)
                matched = db.execute(
                    """
                    SELECT id, lamports FROM expected_deposits
                    WHERE consumed = 0 AND lamports = ? AND created_ms + ttl_ms >= ?
                    ORDER BY id LIMIT 1
                    """,
                    (delta, now),
                ).fetchone()
                allowed = source is not None and self._whitelisted(db, source)
                if matched is not None and allowed:
                    db.execute(
                        "UPDATE expected_deposits SET consumed = 1 WHERE id = ?",
                        (int(matched["id"]),),
                    )
                    db.execute(
                        "UPDATE signer_state SET ledger_sol_lamports = ? WHERE id = 1",
                        (new_lamports,),
                    )
                    day = ct_day(now)
                    reading = self.s.oracle.quote(now)
                    cents = 0
                    if reading.ok:
                        price = sol_usd_cents(reading)
                        cents = delta * price // 1_000_000_000
                    db.execute(
                        """
                        UPDATE equity_day SET deposits_cents = deposits_cents + ?
                        WHERE ct_day = ?
                        """,
                        (cents, day),
                    )
                    self._event(db, "deposit", {"lamports": delta, "source": source or ""})
                    return Decision(True, "DEPOSIT", False)
            _add_halt(db, "unexpected_sol")
            self._event(db, "halt", {"reason": "unexpected_sol"})
            return Decision(False, "UNEXPECTED_SOL", False)

        decision = self._run(op)
        self._sync_hud()
        return decision

    def sweep(self, dest: str, lamports: int) -> Decision:
        del dest, lamports
        if self.activity() == "HALTED":
            return Decision(False, "KILL_HOLD", False)
        return Decision(False, "PLACEHOLDER_BUILDER", False)

    def owner_sell(self, mint: str, token_amount: int | None = None) -> Decision:
        return self._sell(mint, token_amount, owner=True, intent_id=None)

    def owner_sell_after_tamper(self, mint: str, confirmation: str) -> Decision:
        """Build a sell of the owner's own tokens after a database tamper.

        The kill switch must be clear and the owner must type OWNER_SELL. The size
        is the chain token balance. The ledger is not changed. The event keeps the
        previous state digest, so the halt stays. This build still cannot broadcast.
        """

        if confirmation != "OWNER_SELL":
            return Decision(False, "CONFIRMATION_REQUIRED", False)
        if self.poll_kill() != "clear":
            return Decision(False, "KILL_HOLD", False)
        owner = self._owner_pubkey()
        market = self.s.market
        reader = getattr(market, "sell_inputs", None)
        inputs = reader(mint) if callable(reader) else None
        if owner is None or not isinstance(inputs, dict):
            return Decision(False, "BROADCAST_REFUSED", False)
        chain = self._chain_trade_facts(owner, mint, False)
        if chain is None or chain[8] <= 0:
            return Decision(False, "BROADCAST_REFUSED", False)
        from zoora_signer.message_policy import PolicyError, validate_transaction
        from zoora_signer.txbuild import BuildError, build_curve_sell

        try:
            built = build_curve_sell(
                user=owner,
                mint_address=mint,
                mint_data=chain[6],
                mint_owner=chain[7],
                curve_data=chain[5],
                fee_config_data=bytes(inputs["fee_config_data"]),
                buyback_fee_recipient=str(inputs["buyback"]),
                token_in=chain[8],
                slippage_bps=int(inputs.get("slippage_bps", 1500)),
            )
            validate_transaction(
                built.raw,
                owner=owner,
                mint=mint,
                max_all_in_lamports=built.all_in_lamports or None,
                expected_token_amount=built.token_amount,
                expected_limit_lamports=built.limit_lamports,
                rent_lamports=built.rent_lamports,
            )
        except (BuildError, PolicyError, KeyError, TypeError, ValueError):
            return Decision(False, "BROADCAST_REFUSED", False)

        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            ledger_before = int(_state(db)["ledger_sol_lamports"] or 0)
            last = db.execute("SELECT payload FROM events ORDER BY id DESC LIMIT 1").fetchone()
            previous_digest: str | None = None
            if last is not None:
                try:
                    body = json.loads(str(last["payload"]))
                except json.JSONDecodeError:
                    body = None
                if isinstance(body, dict) and isinstance(body.get("state_sha256"), str):
                    previous_digest = str(body["state_sha256"])
            payload: Payload = {
                "mint": mint,
                "token_amount": chain[8],
                "owner": owner,
                "code": "BROADCAST_REFUSED",
                "ledger_sol_lamports": ledger_before,
            }
            if previous_digest is not None:
                payload["state_sha256"] = previous_digest
            event_id = self._event(db, "owner_sell_after_tamper", payload)
            if int(_state(db)["ledger_sol_lamports"] or 0) != ledger_before:
                return Decision(False, "LEDGER_BREACH", False, event_id=event_id)
            return Decision(False, "BROADCAST_REFUSED", False, event_id=event_id)

        decision = transact(self.path, op)
        try:
            self.s.broadcaster.submit(built.raw)
        except Exception:
            return decision
        return decision

    def _owner_pubkey(self) -> str | None:
        pub = getattr(self.s.secrets, "wallet_pubkey", None)
        if not callable(pub):
            return None
        found = pub()
        return found if isinstance(found, str) and found else None

    def _unsigned_buy(self, intent: Intent, price: int, micro_per_sol: int) -> BuiltTx | None:
        owner = self._owner_pubkey()
        market = self.s.market
        reader = getattr(market, "buy_inputs", None)
        if owner is None or price <= 0 or micro_per_sol <= 0 or not callable(reader):
            return None
        inputs = reader(intent.mint)
        if not isinstance(inputs, dict):
            return None
        if self.mode() == "LIVE" and self._devnet_in_live():
            return None
        from zoora_signer.txbuild import BuildError, build_curve_buy

        chain = self._chain_trade_facts(owner, intent.mint, inputs.get("volume_exists"))
        if chain is None:
            return None
        try:
            return build_curve_buy(
                user=owner,
                mint_address=intent.mint,
                mint_data=chain[6],
                mint_owner=chain[7],
                curve_data=chain[5],
                fee_config_data=bytes(inputs["fee_config_data"]),
                buyback_fee_recipient=str(inputs["buyback"]),
                sol_usd_cents=price,
                sol_usd_micro=micro_per_sol,
                stake_cents=intent.usd_stake_cents or 0,
                slippage_bps=intent.max_slippage_bps,
                ata_rent_lamports=chain[3],
                create_base_ata=chain[4],
                curve_lamports=chain[0],
                volume_exists=chain[1],
                volume_rent_lamports=chain[2],
            )
        except (BuildError, KeyError, TypeError):
            return None

    def _chain_trade_facts(
        self,
        owner: str,
        mint: str,
        claimed_volume: object,
    ) -> tuple[int, bool, int | None, int, bool, bytes, bytes, str, int] | None:
        """Curve bytes, mint bytes, rent, and the ATA balance from the chain."""

        from solders.pubkey import Pubkey

        from zoora_signer.constants import (
            BONDING_CURVE_DISCRIMINATOR,
            PUMP_PROGRAM,
            SPL_TOKEN,
            USER_VOLUME_ACCOUNT_BYTES,
        )
        from zoora_signer.quote import parse_mint
        from zoora_signer.txbuild import _ata, _pda

        mint_info = self._account(mint)
        if mint_info is None or not mint_info[0]:
            return None
        mint_owner = mint_info[3]
        mint_data = mint_info[4]
        if parse_mint(mint_data, mint_owner) is None:
            return None
        pump = Pubkey.from_string(PUMP_PROGRAM)
        owner_key = Pubkey.from_string(owner)
        mint_key = Pubkey.from_string(mint)
        base_program = Pubkey.from_string(mint_owner)
        curve = str(_pda([b"bonding-curve", bytes(mint_key)], pump))
        volume = str(_pda([b"user_volume_accumulator", bytes(owner_key)], pump))
        user_ata = str(_ata(owner_key, base_program, mint_key))
        curve_info = self._account(curve)
        volume_info = self._account(volume)
        ata_info = self._account(user_ata)
        if curve_info is None or volume_info is None or ata_info is None or not curve_info[0]:
            return None
        if curve_info[3] != PUMP_PROGRAM or not curve_info[4].startswith(BONDING_CURVE_DISCRIMINATOR):
            return None
        if ata_info[0] and ata_info[3] != mint_owner:
            return None
        if claimed_volume is True and not volume_info[0]:
            return None
        volume_verified = (
            volume_info[0]
            and volume_info[3] == PUMP_PROGRAM
            and volume_info[2] == USER_VOLUME_ACCOUNT_BYTES
        )
        if claimed_volume is True and not volume_verified:
            volume_verified = False
        if volume_verified:
            volume_rent: int | None = None
            volume_exists = True
        else:
            volume_rent = self._rent(USER_VOLUME_ACCOUNT_BYTES)
            if volume_rent is None:
                return None
            volume_exists = False
        if ata_info[0]:
            ata_rent = 0
            create = False
        else:
            ata_size = 165 if mint_owner == SPL_TOKEN else 182
            rented = self._rent(ata_size)
            if rented is None:
                return None
            ata_rent = rented
            create = True
        ata_amount = 0
        if ata_info[0] and len(ata_info[4]) >= 72:
            ata_amount = int.from_bytes(ata_info[4][64:72], "little")
        return (
            curve_info[1],
            volume_exists,
            volume_rent,
            ata_rent,
            create,
            curve_info[4],
            mint_data,
            mint_owner,
            ata_amount,
        )

    def _account(self, address: str) -> tuple[bool, int, int, str, bytes] | None:
        ask = getattr(self.s.chain, "account_info", None)
        if not callable(ask):
            return None
        try:
            value = ask(address)
        except Exception:
            return None
        if not isinstance(value, tuple) or len(value) != 5:
            return None
        exists, lamports, size, owner, data = value
        if (
            type(exists) is not bool
            or type(lamports) is not int
            or type(size) is not int
            or not isinstance(owner, str)
            or not isinstance(data, bytes)
        ):
            return None
        if lamports < 0 or size < 0:
            return None
        if not exists and (lamports != 0 or size != 0):
            return None
        return exists, lamports, size, owner, data

    def _rent(self, size: int) -> int | None:
        ask = getattr(self.s.chain, "rent_exemption", None)
        if not callable(ask):
            return None
        try:
            value = ask(size)
        except Exception:
            return None
        if type(value) is not int:
            return None
        from zoora_signer.quote import accept_chain_rent

        return accept_chain_rent(value, size)

    def _broadcast_sell(self, mint: str, token_amount: int | None) -> Decision:
        if self.poll_kill() != "clear":
            return self._note("sell_refused", {"code": "KILL_HOLD", "mint": mint})
        owner = self._owner_pubkey()
        market = self.s.market
        reader = getattr(market, "sell_inputs", None)
        inputs = reader(mint) if callable(reader) else None
        if owner is None or not isinstance(inputs, dict):
            return self._note("sell_refused", {"code": "BROADCAST_REFUSED", "mint": mint})
        if self._devnet_in_live():
            return self._note("sell_refused", {"code": "LIVE_HOST", "mint": mint})
        from zoora_signer.message_policy import PolicyError, validate_transaction
        from zoora_signer.txbuild import BuildError, build_curve_sell

        chain = self._chain_trade_facts(owner, mint, False)
        if chain is None:
            return self._note("sell_refused", {"code": "BROADCAST_REFUSED", "mint": mint})
        try:
            amount = int(token_amount if token_amount is not None else inputs.get("token_in") or chain[8])
            built = build_curve_sell(
                user=owner,
                mint_address=mint,
                mint_data=chain[6],
                mint_owner=chain[7],
                curve_data=chain[5],
                fee_config_data=bytes(inputs["fee_config_data"]),
                buyback_fee_recipient=str(inputs["buyback"]),
                token_in=amount,
                slippage_bps=int(inputs.get("slippage_bps", 1500)),
            )
            if self.poll_kill() != "clear":
                return self._note("sell_refused", {"code": "KILL_HOLD", "mint": mint})
            validate_transaction(
                built.raw,
                owner=owner,
                mint=mint,
                max_all_in_lamports=built.all_in_lamports or None,
                expected_token_amount=amount,
                expected_limit_lamports=built.limit_lamports,
                rent_lamports=built.rent_lamports,
            )
            if self.poll_kill() != "clear":
                return self._note("sell_refused", {"code": "KILL_HOLD", "mint": mint})
            self.s.broadcaster.submit(built.raw)
        except PolicyError:
            return self._note("sell_refused", {"code": "POLICY_REJECTED", "mint": mint})
        except BuildError as exc:
            return self._note("sell_refused", {"code": str(exc), "mint": mint})
        except Exception:
            return self._note("sell_refused", {"code": "BROADCAST_REFUSED", "mint": mint})
        return self._note("sell_refused", {"code": "BROADCAST_REFUSED", "mint": mint})

    def sell_all(self) -> list[Decision]:
        def op(conn: sqlite3.Connection) -> list[str]:
            db = _db(conn)
            rows = db.execute(
                "SELECT mint FROM trades WHERE status IN ('open', 'moon')"
            ).fetchall()
            return [str(row["mint"]) for row in rows]

        try:
            mints = self._transact(op)
        except AnchorMismatch:
            return [Decision(False, "ANCHOR_MISMATCH", self.mode() != "LIVE")]
        return [self.owner_sell(mint) for mint in mints]

    def run_scheduled_exits(self) -> list[Decision]:
        if self.activity() == "HALTED":
            self._note("auto_exit_suppressed", {"reason": "kill"})
            return []
        if not self.s.local_exits_enabled or self.activity() != "ACTIVE":
            self._note("auto_exit_suppressed", {"reason": "disabled"})
            return []
        now = self.s.clock.now_ms()

        def op(conn: sqlite3.Connection) -> list[tuple[str, int]]:
            db = _db(conn)
            rows = db.execute(
                "SELECT mint, tokens, cost_cents, recovered_cents, opened_ms, status FROM trades WHERE status = 'open'"
            ).fetchall()
            due: list[tuple[str, int]] = []
            for row in rows:
                mark = self.s.marks.mark_cents(
                    str(row["mint"]),
                    int(row["tokens"]),
                    int(row["cost_cents"]),
                    int(row["recovered_cents"]),
                )
                hard = mark is not None and mark * 10_000 <= int(row["cost_cents"]) * self.s.hard_stop_bps
                stale = int(row["recovered_cents"]) == 0 and now - int(row["opened_ms"]) >= self.s.time_stop_ms
                if hard or stale:
                    due.append((str(row["mint"]), int(row["tokens"])))
            return due

        due = self._transact(op)
        return [self._sell(mint, amount, owner=False, intent_id=None) for mint, amount in due]

    def activity(self) -> str:
        if not Path(self.path).is_file():
            return "PAUSED"

        def op(conn: sqlite3.Connection) -> str:
            return str(_state(_db(conn))["activity"])

        return query(self.path, op)

    def mode(self) -> str:
        if not Path(self.path).is_file():
            return "DRY_RUN"

        def op(conn: sqlite3.Connection) -> str:
            return str(_state(_db(conn))["execution_mode"])

        return query(self.path, op)

    def route_approved(self) -> bool:
        if not Path(self.path).is_file():
            return False

        def op(conn: sqlite3.Connection) -> bool:
            return int(_state(_db(conn))["route_approved"]) == 1

        return query(self.path, op)

    def read_events(self, after: int) -> list[tuple[int, str, str]]:
        def op(conn: sqlite3.Connection) -> list[tuple[int, str, str]]:
            return read_events(_db(conn), after)

        return query(self.path, op)

    def open_trade_count(self) -> int:
        def op(conn: sqlite3.Connection) -> int:
            row = _db(conn).execute("SELECT COUNT(*) AS n FROM trades WHERE status = 'open'").fetchone()
            assert row is not None
            return int(row["n"])

        return query(self.path, op)

    def _buy(self, intent: Intent, reading: OracleReading, assessment: VetAssessment | None) -> Decision:
        price = sol_usd_cents(reading)
        stake = intent.usd_stake_cents or 0
        vet_payload = _vet_payload(assessment)

        def op(conn: sqlite3.Connection) -> tuple[Decision, int | None]:
            db = _db(conn)
            now_tx = self.s.clock.now_ms()
            if now_tx - intent.issued_at_ms > INTENT_TTL_MS or intent.issued_at_ms - now_tx > 5_000:
                return self._record_refusal(db, intent, "EXPIRED", reading, assessment), None
            if (
                assessment is None
                or not assessment.ok
                or assessment.config_version != VET_CONFIG_VERSION
                or now_tx - assessment.evaluated_ms > VET_FRESH_MS
            ):
                code = assessment.code if assessment is not None and assessment.code else "VET"
                if assessment is not None and assessment.service_error:
                    _add_halt(db, "vetting_service")
                return self._record_refusal(db, intent, code, reading, assessment), None
            prior = db.execute(
                "SELECT ok, code, simulated FROM decisions WHERE intent_id = ?",
                (intent.intent_id,),
            ).fetchone()
            if prior is not None:
                return (
                    Decision(bool(prior["ok"]), str(prior["code"]), bool(prior["simulated"]), intent.intent_id),
                    None,
                )
            existing = db.execute(
                "SELECT id, status FROM reservations WHERE intent_id = ?",
                (intent.intent_id,),
            ).fetchone()
            if existing is not None and str(existing["status"]) != "reserved":
                return (Decision(True, "REPLAY", True, intent.intent_id), None)
            if self._wallet_exposure(db, price)[3]:
                return self._record_refusal(db, intent, "UNKNOWN_MARK", reading, assessment), None
            self._ensure_snapshot(db, now_tx, price)
            self._refresh_buy_halt(db, now_tx, price)
            hour, recent = self._accepted_buy_counts(db, now_tx)
            view = self._view(db, now_tx, price, hour, recent)
            result = evaluate_buy(view, stake, intent.max_slippage_bps)
            if result.halt:
                _add_halt(db, result.code)
            if result.buy_halt and result.buy_halt != view.buy_halt:
                db.execute(
                    "UPDATE signer_state SET buy_halt_reason = ? WHERE id = 1",
                    (result.buy_halt,),
                )
            payload: Payload = {
                "intent_id": intent.intent_id,
                "mint": intent.mint,
                "code": result.code,
                "provider": self.s.provider_name,
                "stake_cents": stake,
                **reading.as_payload(),
                **vet_payload,
            }
            if not result.accept:
                db.execute(
                    "INSERT INTO decisions (intent_id, ok, code, simulated) VALUES (?, 0, ?, 1)",
                    (intent.intent_id, result.code),
                )
                event_id = self._event(db, "intent_refused", payload)
                return (Decision(False, result.code, True, intent.intent_id, event_id), None)
            db.execute(
                """
                INSERT INTO reservations (
                  intent_id, side, mint, stake_cents, status, ct_day, created_ms, reached_signing
                ) VALUES (?, 'buy', ?, ?, 'reserved', ?, ?, 0)
                """,
                (intent.intent_id, intent.mint, stake, ct_day(now_tx), now_tx),
            )
            reservation_id = int(db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            event_id = self._event(db, "reserved", payload)
            return (Decision(True, "RESERVED", True, intent.intent_id, event_id), reservation_id)

        try:
            decision, reservation_id = self._transact(op)
        except AnchorMismatch:
            return Decision(False, "ANCHOR_MISMATCH", True, intent.intent_id)
        except SecretInLog:
            self._halt("secret_in_log")
            return Decision(False, "SECRET_IN_LOG", False, intent.intent_id)
        except Exception:
            self._halt("reservation_error")
            return Decision(False, "RESERVATION_ERROR", False, intent.intent_id)
        self._sync_hud()
        if reservation_id is None or self.s.defer_settle:
            return decision
        try:
            return self._settle_buy(intent, reading, reservation_id, stake)
        except Exception:
            try:
                return self._release(reservation_id, "SETTLE_ERROR", intent.intent_id)
            except Exception:
                self._halt("settle_error")
                return Decision(False, "SETTLE_ERROR", False, intent.intent_id)

    def _settle_buy(
        self,
        intent: Intent,
        reading: OracleReading,
        reservation_id: int,
        stake: int,
    ) -> Decision:
        now = self.s.clock.now_ms()
        if now - intent.issued_at_ms > INTENT_TTL_MS:
            return self._release(reservation_id, "EXPIRED", intent.intent_id)
        if self.activity() == "HALTED":
            return self._release(reservation_id, "KILL_HOLD", intent.intent_id)
        if self.mode() == "LIVE":
            if self.poll_kill() != "clear":
                return self._release(reservation_id, "KILL_HOLD", intent.intent_id)
            price = sol_usd_cents(reading)
            micro = sol_usd_micro(reading)
            built = self._unsigned_buy(intent, price, micro)
            owner = self._owner_pubkey()
            if built is None or owner is None:
                return self._release(reservation_id, "SIGN_REFUSED", intent.intent_id)
            from zoora_signer.message_policy import PolicyError, validate_transaction
            from zoora_signer.quote import lamports_for_micro_price

            try:
                if self.poll_kill() != "clear":
                    return self._release(reservation_id, "KILL_HOLD", intent.intent_id)
                budget = lamports_for_micro_price(min((intent.usd_stake_cents or 0) * 10_000, USD_CAP_MICRO), micro)
                validate_transaction(
                    built.raw,
                    owner=owner,
                    mint=intent.mint,
                    max_all_in_lamports=budget,
                    expected_token_amount=built.token_amount,
                    expected_limit_lamports=built.limit_lamports,
                    rent_lamports=built.rent_lamports,
                )
            except PolicyError:
                return self._release(reservation_id, "POLICY_REJECTED", intent.intent_id)
            return self._release(reservation_id, "SIGN_REFUSED", intent.intent_id)
        price = sol_usd_cents(reading)
        lamports = lamports_for_cents(stake, price)
        if lamports is None:
            return self._release(reservation_id, "UNPRICEABLE", intent.intent_id)
        return self._fill(intent, reservation_id, stake, lamports, "dry-run:no-tx", simulated=True)

    def _fill(
        self,
        intent: Intent,
        reservation_id: int,
        stake: int,
        lamports: int,
        signature: str,
        simulated: bool,
    ) -> Decision:
        now = self.s.clock.now_ms()

        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            current = int(_state(db)["ledger_sol_lamports"] or 0)
            spend = min(current, lamports)
            db.execute(
                "UPDATE signer_state SET ledger_sol_lamports = ? WHERE id = 1",
                (current - spend,),
            )
            db.execute(
                """
                INSERT INTO trades (mint, cost_cents, recovered_cents, tokens, status, opened_ms)
                VALUES (?, ?, 0, ?, 'open', ?)
                """,
                (intent.mint, stake, 1_000_000, now),
            )
            trade_id = int(db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            db.execute(
                """
                UPDATE reservations
                SET status = ?, reached_signing = 1, trade_id = ?, signature = ?
                WHERE id = ?
                """,
                ("simulated" if simulated else "signing", trade_id, signature, reservation_id),
            )
            db.execute(
                "INSERT OR REPLACE INTO decisions (intent_id, ok, code, simulated) VALUES (?, 1, 'FILLED', ?)",
                (intent.intent_id, 1 if simulated else 0),
            )
            event_id = self._event(
                db,
                "fill",
                {
                    "intent_id": intent.intent_id,
                    "mint": intent.mint,
                    "stake_cents": stake,
                    "simulated": simulated,
                    "provider": self.s.provider_name,
                    "signature": signature if simulated else "live-local",
                },
            )
            return Decision(True, "FILLED", simulated, intent.intent_id, event_id)

        decision = self._run(op)
        self._sync_hud()
        return decision

    def _sell_intent(self, intent: Intent, reading: OracleReading) -> Decision:
        return self._sell(
            intent.mint,
            intent.token_amount,
            owner=False,
            intent_id=intent.intent_id,
            reading=reading,
        )

    def _sell(
        self,
        mint: str,
        token_amount: int | None,
        *,
        owner: bool,
        intent_id: str | None,
        reading: OracleReading | None = None,
    ) -> Decision:
        if self.mode() == "LIVE":
            return self._broadcast_sell(mint, token_amount)
        now = self.s.clock.now_ms()
        if reading is None:
            reading = self.s.oracle.quote(now)
        price = sol_usd_cents(reading) if reading.ok else 0

        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            if intent_id is not None:
                prior = db.execute(
                    "SELECT ok, code, simulated FROM decisions WHERE intent_id = ?",
                    (intent_id,),
                ).fetchone()
                if prior is not None:
                    return Decision(bool(prior["ok"]), str(prior["code"]), bool(prior["simulated"]), intent_id)
            view = self._view(db, now, price, 0, 0)
            result = evaluate_sell(view, owner=owner)
            if not result.accept:
                if intent_id is not None:
                    db.execute(
                        "INSERT INTO decisions (intent_id, ok, code, simulated) VALUES (?, 0, ?, 1)",
                        (intent_id, result.code),
                    )
                self._event(
                    db,
                    "sell_refused",
                    {"mint": mint, "code": result.code, "owner": owner, "provider": self.s.provider_name},
                )
                return Decision(False, result.code, True, intent_id)
            trade = db.execute(
                """
                SELECT id, tokens, cost_cents, recovered_cents FROM trades
                WHERE mint = ? AND status IN ('open', 'moon') ORDER BY id LIMIT 1
                """,
                (mint,),
            ).fetchone()
            if trade is None:
                return Decision(False, "NO_POSITION", True, intent_id)
            tokens = int(trade["tokens"])
            sold = tokens if token_amount is None or token_amount > tokens else token_amount
            if sold <= 0:
                return Decision(False, "BAD_SIZE", True, intent_id)
            mark = self.s.marks.mark_cents(mint, tokens, int(trade["cost_cents"]), int(trade["recovered_cents"]))
            mark_unknown = mark is None
            if mark_unknown and not owner:
                return Decision(False, "UNPRICEABLE", True, intent_id)
            proceeds = 0 if mark is None else mark * sold // tokens
            recovered = int(trade["recovered_cents"]) + proceeds
            left = tokens - sold
            if left <= 0:
                status = "closed"
            elif recovered >= int(trade["cost_cents"]):
                status = "moon"
            else:
                status = "open"
            db.execute(
                "UPDATE trades SET tokens = ?, recovered_cents = ?, status = ? WHERE id = ?",
                (left, recovered, status, int(trade["id"])),
            )
            if price > 0:
                credit = lamports_for_cents(proceeds, price) or 0
                current = int(_state(db)["ledger_sol_lamports"] or 0)
                db.execute(
                    "UPDATE signer_state SET ledger_sol_lamports = ? WHERE id = 1",
                    (current + credit,),
                )
            if intent_id is not None:
                db.execute(
                    "INSERT INTO decisions (intent_id, ok, code, simulated) VALUES (?, 1, ?, 1)",
                    (intent_id, status.upper()),
                )
            self._event(
                db,
                "sell",
                {
                    "mint": mint,
                    "owner": owner,
                    "proceeds_cents": proceeds,
                    "status": status,
                    "provider": self.s.provider_name,
                    "simulated": True,
                    "mark_unknown": mark_unknown,
                },
            )
            return Decision(True, status.upper(), True, intent_id)

        decision = self._run(op)
        self._sync_hud()
        return decision

    def _release(self, reservation_id: int, reason: str, intent_id: str | None) -> Decision:
        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            db.execute(
                """
                UPDATE reservations SET status = 'released', release_reason = ? WHERE id = ?
                """,
                (reason, reservation_id),
            )
            if intent_id is not None:
                db.execute(
                    "INSERT OR REPLACE INTO decisions (intent_id, ok, code, simulated) VALUES (?, 0, ?, 1)",
                    (intent_id, reason),
                )
            self._event(db, "released", {"reason": reason, "intent_id": intent_id or ""})
            return Decision(False, reason, True, intent_id)

        decision = self._run(op)
        self._sync_hud()
        return decision

    def _record_refusal(
        self,
        db: sqlite3.Connection,
        intent: Intent,
        code: str,
        reading: OracleReading | None,
        assessment: VetAssessment | None,
    ) -> Decision:
        payload: Payload = {
            "intent_id": intent.intent_id,
            "mint": intent.mint,
            "code": code,
            "provider": self.s.provider_name,
        }
        if reading is not None:
            payload.update(reading.as_payload())
        payload.update(_vet_payload(assessment))
        db.execute(
            "INSERT OR IGNORE INTO decisions (intent_id, ok, code, simulated) VALUES (?, 0, ?, 1)",
            (intent.intent_id, code),
        )
        event_id = self._event(db, "intent_refused", payload)
        return Decision(False, code, True, intent.intent_id, event_id)

    def _accepted_buy_counts(self, db: sqlite3.Connection, now_ms: int) -> tuple[int, int]:
        hour = db.execute(
            "SELECT COUNT(*) AS n FROM reservations WHERE side = 'buy' AND created_ms > ?",
            (now_ms - 3_600_000,),
        ).fetchone()
        recent = db.execute(
            "SELECT COUNT(*) AS n FROM reservations WHERE side = 'buy' AND created_ms > ?",
            (now_ms - BUY_MIN_INTERVAL_MS,),
        ).fetchone()
        assert hour is not None and recent is not None
        return int(hour["n"]), int(recent["n"])

    def _reconcile_ready(self, db: sqlite3.Connection, reason: str) -> bool:
        if reason == "LEDGER_BREACH":
            view = self._view(db, self.s.clock.now_ms(), 0, 0, 0)
            return view.open_slots <= 3 and view.buys_today <= 10
        if reason == "unexpected_sol":
            if not self.s.chain.authoritative:
                return False
            ledger = int(_state(db)["ledger_sol_lamports"] or 0)
            return self.s.chain.sol_lamports() == ledger
        if reason == "agent_guard":
            if not self._chain_reconciled(db):
                return False
            try:
                return self.s.kill.poll() == "clear"
            except Exception:
                return False
        if reason == "anchor_mismatch":
            if not self._verify(db) or not self._anchor_matches(db) or not self._state_event_matches(db):
                return False
            last = db.execute("SELECT kind FROM events ORDER BY id DESC LIMIT 1").fetchone()
            return last is not None and str(last["kind"]) == "reanchor"
        if reason == "hash_chain":
            return self._verify(db)
        if reason == "settle_error":
            if not self._chain_reconciled(db):
                return False
            pending = db.execute("SELECT COUNT(*) AS n FROM reservations WHERE status = 'reserved'").fetchone()
            return pending is not None and int(pending["n"]) == 0 and self._verify(db)
        if reason == "unconfirmed":
            if not self._chain_reconciled(db):
                return False
            signing = db.execute("SELECT COUNT(*) AS n FROM reservations WHERE status = 'signing'").fetchone()
            return signing is not None and int(signing["n"]) == 0
        if reason == "reconcile_unknown":
            if not self.s.chain.authoritative:
                return False
            rows = db.execute(
                "SELECT signature FROM reservations WHERE status = 'signing'"
            ).fetchall()
            return all(self.s.chain.signature_status(str(row["signature"] or "")) != "unknown" for row in rows)
        return True

    def _chain_reconciled(self, db: sqlite3.Connection) -> bool:
        if not self.s.chain.authoritative:
            return False
        rows = db.execute("SELECT signature FROM reservations WHERE status = 'signing'").fetchall()
        return all(self.s.chain.signature_status(str(row["signature"] or "")) != "unknown" for row in rows)

    def _vet_fresh(self, mint: str, now: int) -> VetAssessment:
        exit_code, text, timed_out = self.s.vet.vet(mint)
        first = assess_vet(
            exit_code=exit_code,
            raw_text=text,
            timed_out=timed_out,
            mint=mint,
            now_ms=now,
            public_key=self.s.vet_public_key,
        )
        if first.ok or not first.stale:
            return first
        exit_code, text, timed_out = self.s.vet.vet(mint)
        return assess_vet(
            exit_code=exit_code,
            raw_text=text,
            timed_out=timed_out,
            mint=mint,
            now_ms=self.s.clock.now_ms(),
            public_key=self.s.vet_public_key,
        )

    def _view(
        self,
        conn: sqlite3.Connection,
        now_ms: int,
        sol_cents: int,
        accepted_hour: int,
        buys_last_10_min: int,
    ) -> CapView:
        db = _db(conn)
        state = _state(db)
        day = ct_day(now_ms)
        open_row = db.execute("SELECT COUNT(*) AS n FROM trades WHERE status = 'open'").fetchone()
        flight = db.execute(
            """
            SELECT COUNT(*) AS n, COALESCE(SUM(stake_cents), 0) AS stake
            FROM reservations WHERE side = 'buy' AND status IN ('reserved', 'signing')
            """
        ).fetchone()
        buys = db.execute(
            """
            SELECT COUNT(*) AS n FROM reservations
            WHERE side = 'buy' AND ct_day = ? AND (reached_signing = 1 OR status = 'reserved')
            """,
            (day,),
        ).fetchone()
        assert open_row is not None and flight is not None and buys is not None
        wallet, loss_wallet, exposure, unknown = self._wallet_exposure(db, sol_cents)
        exposure += int(flight["stake"])
        loss = self._loss(db, day, loss_wallet)
        buy_halt = state["buy_halt_reason"]
        return CapView(
            open_slots=int(open_row["n"]) + int(flight["n"]),
            buys_today=int(buys["n"]),
            daily_loss_cents=loss,
            reserved_loss_cents=int(flight["stake"]),
            exposure_cents=exposure,
            wallet_cents=wallet,
            intents_this_hour=accepted_hour,
            activity=str(state["activity"]),
            buy_halt=str(buy_halt) if buy_halt else None,
            buys_last_10_min=buys_last_10_min,
            unknown_mark=unknown,
        )

    def _wallet_exposure(self, db: sqlite3.Connection, sol_cents: int) -> tuple[int, int, int, bool]:
        conn = _db(db)
        state = _state(conn)
        lamports = int(state["ledger_sol_lamports"] or 0)
        wallet, loss_wallet = _lamport_cents(lamports, sol_cents)
        exposure = 0
        unknown = False
        rows = conn.execute(
            """
            SELECT mint, tokens, cost_cents, recovered_cents, status FROM trades
            WHERE status IN ('open', 'moon')
            """
        ).fetchall()
        for row in rows:
            cost = int(row["cost_cents"])
            recovered = int(row["recovered_cents"])
            unrecovered = max(0, cost - recovered)
            mark = self.s.marks.mark_cents(str(row["mint"]), int(row["tokens"]), cost, recovered)
            if mark is None:
                unknown = True
                continue
            if str(row["status"]) == "open":
                exposure += max(unrecovered, mark)
            else:
                exposure += mark
            wallet += mark
            loss_wallet += mark
        return wallet, loss_wallet, exposure, unknown

    def _loss(self, db: sqlite3.Connection, day: str, wallet: int) -> int:
        conn = _db(db)
        row = conn.execute("SELECT * FROM equity_day WHERE ct_day = ?", (day,)).fetchone()
        if row is None:
            return 0
        start = int(row["start_equity_cents"])
        withdrawals = int(row["withdrawals_cents"])
        deposits = int(row["deposits_cents"])
        return start - (wallet + withdrawals - deposits)

    def _ensure_snapshot(self, db: sqlite3.Connection, now_ms: int, sol_cents: int) -> None:
        conn = _db(db)
        day = ct_day(now_ms)
        row = conn.execute("SELECT ct_day FROM equity_day WHERE ct_day = ?", (day,)).fetchone()
        if row is not None:
            return
        _wallet, wallet, _exposure, unknown = self._wallet_exposure(conn, sol_cents)
        if unknown or sol_cents <= 0:
            return
        conn.execute(
            """
            INSERT INTO equity_day (ct_day, start_equity_cents, withdrawals_cents, deposits_cents)
            VALUES (?, ?, 0, 0)
            """,
            (day, wallet),
        )

    def _refresh_buy_halt(self, db: sqlite3.Connection, now_ms: int, sol_cents: int) -> None:
        conn = _db(db)
        wallet, loss_wallet, _exposure, unknown = self._wallet_exposure(conn, sol_cents)
        if unknown or sol_cents <= 0:
            conn.execute("UPDATE signer_state SET buy_halt_reason = 'unknown_mark' WHERE id = 1")
            return
        loss = self._loss(conn, ct_day(now_ms), loss_wallet)
        if loss >= DAILY_LOSS_CAP_CENTS:
            reason: str | None = "daily_loss"
        elif wallet > WALLET_CAP_CENTS:
            reason = "wallet"
        else:
            reason = None
        conn.execute("UPDATE signer_state SET buy_halt_reason = ? WHERE id = 1", (reason,))

    def _prior_hits(self, db: sqlite3.Connection, now_ms: int) -> int:
        row = _db(db).execute(
            "SELECT COUNT(*) AS n FROM intent_hits WHERE seen_ms > ?",
            (now_ms - 3_600_000,),
        ).fetchone()
        assert row is not None
        return int(row["n"])

    def _reconcile(self, db: sqlite3.Connection) -> None:
        conn = _db(db)
        rows = conn.execute(
            """
            SELECT id, signature, reached_signing, status FROM reservations
            WHERE status IN ('reserved', 'signing')
            """
        ).fetchall()
        for row in rows:
            if int(row["reached_signing"]) == 0 and str(row["status"]) == "reserved":
                conn.execute(
                    "UPDATE reservations SET status = 'released', release_reason = 'reboot' WHERE id = ?",
                    (int(row["id"]),),
                )
                continue
            if not self.s.chain.authoritative:
                _add_halt(conn, "reconcile_unknown")
                continue
            status = self.s.chain.signature_status(str(row["signature"] or ""))
            if status == "confirmed":
                conn.execute("UPDATE reservations SET status = 'confirmed' WHERE id = ?", (int(row["id"]),))
            elif status == "unknown":
                _add_halt(conn, "reconcile_unknown")
            else:
                conn.execute(
                    """
                    UPDATE reservations SET status = 'released', release_reason = 'unconfirmed'
                    WHERE id = ?
                    """,
                    (int(row["id"]),),
                )
        self._event(conn, "reconciled", {"rows": len(rows)})

    def _expire_unconfirmed(self) -> None:
        now = self.s.clock.now_ms()

        def op(conn: sqlite3.Connection) -> bool:
            db = _db(conn)
            row = db.execute(
                """
                SELECT id FROM reservations
                WHERE status = 'signing' AND created_ms < ?
                LIMIT 1
                """,
                (now - UNCONFIRMED_MS,),
            ).fetchone()
            if row is None:
                return False
            _add_halt(db, "unconfirmed")
            self._event(db, "halt", {"reason": "unconfirmed"})
            return True

        if self._transact(op):
            self._sync_hud()

    def _pause(self, reason: str, failures: list[str]) -> None:
        def op(conn: sqlite3.Connection) -> None:
            db = _db(conn)
            if str(_state(db)["activity"]) != "HALTED":
                db.execute("UPDATE signer_state SET activity = 'PAUSED' WHERE id = 1")
            self._event(db, "preflight_failed", {"reason": reason, "checks": ",".join(failures)})

        self._transact(op)
        self._sync_hud()

    def _halt(self, reason: str) -> None:
        def op(conn: sqlite3.Connection) -> None:
            db = _db(conn)
            _add_halt(db, reason)
            self._event(db, "halt", {"reason": reason, "provider": self.s.provider_name})

        transact(self.path, op)
        self._sync_hud()

    def _note(self, kind: str, payload: Payload) -> Decision:
        code = str(payload.get("code") or kind)

        def op(conn: sqlite3.Connection) -> Decision:
            event_id = self._event(_db(conn), kind, payload)
            return Decision(False, code, True, event_id=event_id)

        try:
            decision = self._run(op)
        except SecretInLog:
            return Decision(False, "SECRET_IN_LOG", False)
        self._sync_hud()
        return decision

    def _refuse(
        self,
        intent: Intent,
        code: str,
        reading: OracleReading | None,
        assessment: VetAssessment | None,
    ) -> Decision:
        payload: Payload = {
            "intent_id": intent.intent_id,
            "mint": intent.mint,
            "code": code,
            "provider": self.s.provider_name,
        }
        if reading is not None:
            payload.update(reading.as_payload())
        payload.update(_vet_payload(assessment))
        now = self.s.clock.now_ms()

        def op(conn: sqlite3.Connection) -> Decision:
            prior = conn.execute(
                "SELECT ok, code, simulated FROM decisions WHERE intent_id = ?",
                (intent.intent_id,),
            ).fetchone()
            if prior is None:
                before = _state_digest(conn)
                conn.execute(
                    "INSERT INTO intent_hits (intent_id, seen_ms) VALUES (?, ?)",
                    (intent.intent_id, now),
                )
                conn.execute(
                    "INSERT INTO decisions (intent_id, ok, code, simulated) VALUES (?, 0, ?, 1)",
                    (intent.intent_id, code),
                )
                stamped = dict(payload)
                stamped["state_sha256"] = before
                if _state_digest(conn) != before:
                    _add_halt(conn, "anchor_mismatch")
                event_payload = stamped
            else:
                event_payload = payload
            event_id = self._event(conn, "intent_refused", event_payload)
            return Decision(False, code, True, intent.intent_id, event_id)

        try:
            decision = self._run(op)
        except SecretInLog:
            return Decision(False, "SECRET_IN_LOG", False, intent.intent_id)
        self._sync_hud()
        return decision

    def _stored(self, intent_id: str) -> Decision | None:
        def op(conn: sqlite3.Connection) -> Decision | None:
            row = conn.execute(
                "SELECT ok, code, simulated FROM decisions WHERE intent_id = ?",
                (intent_id,),
            ).fetchone()
            if row is None:
                return None
            return Decision(bool(row["ok"]), str(row["code"]), bool(row["simulated"]), intent_id)

        return self._transact(op)

    def _transact(self, fn: Callable[[sqlite3.Connection], T]) -> T:
        def op(conn: sqlite3.Connection) -> T | object:
            db = _db(conn)
            if not self._state_event_matches(db):
                _add_halt(db, "anchor_mismatch")
                self._event(db, "halt", {"reason": "anchor_mismatch"})
                return _MISMATCH
            return fn(conn)

        result = transact(self.path, op)
        if result is _MISMATCH:
            raise AnchorMismatch()
        return result  # type: ignore[return-value]

    def _run(self, fn: Callable[[sqlite3.Connection], Decision]) -> Decision:
        try:
            return self._transact(fn)
        except AnchorMismatch:
            return Decision(False, "ANCHOR_MISMATCH", False)

    def _event(self, db: sqlite3.Connection, kind: str, payload: Payload) -> int:
        recorded = dict(payload)
        current = _state_digest(db)
        supplied = recorded.get("state_sha256")
        if isinstance(supplied, str):
            if supplied != current:
                _add_halt(db, "anchor_mismatch")
        else:
            recorded["state_sha256"] = current
        key = self._event_key()
        if key is None:
            _add_halt(db, "hash_chain")
            return 0
        return append_event(_db(db), kind, recorded, self.s.clock.now_ms(), self._needles(), key)

    def _event_key(self) -> bytes | None:
        getter = getattr(self.s.secrets, "get_event_hmac", None)
        if not callable(getter):
            return None
        found = getter()
        if isinstance(found, bytes) and len(found) >= HMAC_MIN_BYTES:
            return found
        return None

    def _verify(self, db: sqlite3.Connection) -> bool:
        key = self._event_key()
        if key is None:
            return False
        return verify_chain(db, key)

    def _devnet_in_live(self) -> bool:
        from urllib.parse import urlparse

        url = self.s.secrets.get_rpc_url()
        return isinstance(url, str) and urlparse(url).hostname == "devnet.helius-rpc.com"

    def _needles(self) -> tuple[str, ...]:
        from zoora_signer.secrets import secret_needles

        found: list[str] = []
        mac = self.s.secrets.get_hmac_key()
        if mac is not None:
            found.extend(secret_needles(mac))
        event_key = self._event_key()
        if event_key is not None:
            found.extend(secret_needles(event_key))
        url = self.s.secrets.get_rpc_url()
        if url and url.startswith("https://"):
            found.append(url)
        return tuple(item for item in found if len(item) >= 8)

    def _telegram_allow(self) -> set[str]:
        return set(self.s.telegram_allow or set())

    def _key_id(self) -> str:
        def op(conn: sqlite3.Connection) -> str:
            return str(int(_state(conn)["hmac_version"]))

        return query(self.path, op)

    def _hmac_ok(self, raw: bytes, signature: str) -> bool:
        key = self.s.secrets.get_hmac_key()
        if key is None or not signature:
            return False
        expected = hmac.new(key, INTENT_PREFIX + raw, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    def _whitelist(self) -> set[str]:
        def op(conn: sqlite3.Connection) -> set[str]:
            rows = _db(conn).execute("SELECT address FROM whitelist").fetchall()
            return {str(row["address"]) for row in rows}

        return self._transact(op)

    def _whitelisted(self, db: sqlite3.Connection, address: str) -> bool:
        row = _db(db).execute("SELECT 1 FROM whitelist WHERE address = ?", (address,)).fetchone()
        return row is not None

    def _sleep_jump(self) -> bool:
        wall, mono = self.s.probe.clocks()
        jumped = False
        if self._last_wall and self._last_mono:
            jumped = (wall - self._last_wall) - (mono - self._last_mono) > SLEEP_JUMP_MS
        self._last_wall, self._last_mono = wall, mono
        return jumped

    def _preflight_clear(self) -> bool:
        skew = self.s.probe.time_skew_ms()
        return (
            skew is not None
            and skew <= CLOCK_SKEW_MS
            and self.s.probe.defender_active()
            and not self.s.probe.elevated_or_admin()
            and self.s.probe.acl_owner_only()
        )

    def _anchor_path(self) -> Path:
        return Path(self.path).with_suffix(".anchor")

    def _chain_head(self, db: sqlite3.Connection) -> tuple[int, str]:
        row = db.execute("SELECT COUNT(*) AS n FROM events").fetchone()
        last = db.execute("SELECT hash FROM events ORDER BY id DESC LIMIT 1").fetchone()
        count = int(row["n"]) if row is not None else 0
        head = str(last["hash"]) if last is not None else "0" * 64
        return count, head

    def _anchor_matches(self, db: sqlite3.Connection) -> bool:
        path = self._anchor_path()
        try:
            row = db.execute("SELECT written FROM anchor_meta WHERE id = 1").fetchone()
        except sqlite3.OperationalError:
            row = None
        if row is None:
            return False
        written = int(row["written"] or 0)
        if not path.is_file():
            return written == 0
        lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line]
        if not lines:
            return True
        count, head = self._chain_head(db)
        return lines[-1] == f"{count}|{head}"

    def _state_event_matches(self, db: sqlite3.Connection) -> bool:
        row = db.execute("SELECT payload FROM events ORDER BY id DESC LIMIT 1").fetchone()
        if row is None:
            return True
        try:
            payload = json.loads(str(row["payload"]))
        except json.JSONDecodeError:
            return False
        if not isinstance(payload, dict) or "state_sha256" not in payload:
            return True
        return str(payload["state_sha256"]) == _state_digest(db)

    def _write_anchor(self) -> None:
        def op(conn: sqlite3.Connection) -> str:
            count, head = self._chain_head(_db(conn))
            return f"{count}|{head}"

        line = query(self.path, op)
        path = self._anchor_path()
        previous = ""
        if path.is_file():
            lines = [item for item in path.read_text(encoding="utf-8").splitlines() if item]
            previous = lines[-1] if lines else ""
        if previous == line:
            return
        with path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

        def mark(conn: sqlite3.Connection) -> None:
            _db(conn).execute("UPDATE anchor_meta SET written = 1 WHERE id = 1")

        self._transact(mark)
        if self.s.hud_path is not None:
            with self.s.hud_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"anchor": line}) + "\n")

    def _sync_hud(self) -> None:
        path = self.s.hud_path
        self._write_anchor()
        if path is None:
            return
        rows = self.read_events(self._hud_after)
        if not rows:
            return
        with path.open("a", encoding="utf-8") as handle:
            for row_id, kind, payload in rows:
                handle.write(json.dumps({"id": row_id, "kind": kind, "payload": payload}) + "\n")
        self._hud_after = rows[-1][0]


def _reject_non_finite(_value: str) -> None:
    raise ValueError("non-finite")


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    keys = [key for key, _value in pairs]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate key")
    return dict(pairs)


def _iso_date(value: str) -> bool:
    from datetime import date

    if len(value) != 10:
        return False
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        return False
    return parsed.isoformat() == value


def _telegram_update(
    message: dict[str, object] | str,
) -> tuple[str | None, str, str, str] | None:
    """Parse a Bot API Update. Returns (reject_code, chat, sender, text)."""

    if not isinstance(message, dict):
        return None
    if "edited_message" in message or "channel_post" in message or "edited_channel_post" in message:
        return ("TELEGRAM_REJECTED", "", "", "")
    inner = message.get("message")
    if not isinstance(inner, dict):
        return None
    if (
        "forward_origin" in inner
        or "is_automatic_forward" in inner
        or "forward_date" in inner
        or "sender_chat" in inner
        or "via_bot" in inner
        or "forward_from" in inner
        or "forward_from_chat" in inner
    ):
        return ("TELEGRAM_FORWARDED", "", "", "")
    chat = inner.get("chat")
    sender = inner.get("from")
    if not isinstance(chat, dict) or not isinstance(sender, dict):
        return None
    if sender.get("is_bot") is True:
        return ("TELEGRAM_REJECTED", "", "", "")
    chat_id = chat.get("id")
    sender_id = sender.get("id")
    if type(chat_id) is not int or type(sender_id) is not int:
        return None
    text = inner.get("text")
    return (None, str(chat_id), str(sender_id), str(text or "").strip().lower())


def _strict_int(value: object) -> int | None:
    if type(value) is not int:
        return None
    return value


def parse_intent(raw: dict[str, object]) -> Intent | None:
    side = raw.get("side")
    if not isinstance(side, str) or side not in {"buy", "sell"}:
        return None
    allowed = {
        "intent_id",
        "issued_at_ms",
        "key_id",
        "max_slippage_bps",
        "mint",
        "side",
    }
    if side == "buy":
        allowed.add("usd_stake_micro")
        if set(raw) != allowed:
            return None
    else:
        required = set(allowed)
        allowed.add("token_amount")
        if set(raw) != required and set(raw) != allowed:
            return None
    intent_id = raw.get("intent_id")
    mint = raw.get("mint")
    issued = _strict_int(raw.get("issued_at_ms"))
    slippage = _strict_int(raw.get("max_slippage_bps"))
    key_id = raw.get("key_id")
    if not isinstance(intent_id, str) or not isinstance(mint, str) or MINT_OK.fullmatch(mint) is None:
        return None
    if not isinstance(key_id, str) or not key_id:
        return None
    if issued is None or slippage is None or slippage < 0:
        return None
    cents: int | None = None
    tokens: int | None = None
    if side == "buy":
        micro = _strict_int(raw.get("usd_stake_micro"))
        if micro is None or micro <= 0:
            return None
        cents = (micro + 9_999) // 10_000
    elif "token_amount" in raw:
        tokens = _strict_int(raw.get("token_amount"))
        if tokens is None or tokens <= 0:
            return None
    return Intent(intent_id, side, mint, cents, tokens, slippage, issued, key_id)


def intent_wire(intent: Intent) -> dict[str, object]:
    raw: dict[str, object] = {
        "intent_id": intent.intent_id,
        "issued_at_ms": intent.issued_at_ms,
        "max_slippage_bps": intent.max_slippage_bps,
        "mint": intent.mint,
        "side": intent.side,
    }
    if intent.usd_stake_cents is not None:
        raw["usd_stake_cents"] = intent.usd_stake_cents
    if intent.token_amount is not None:
        raw["token_amount"] = intent.token_amount
    return raw


def _vet_payload(assessment: VetAssessment | None) -> Payload:
    if assessment is None:
        return {}
    return {
        "vet_code": assessment.code,
        "config_version": assessment.config_version,
        "code_version": assessment.code_version,
        "reason_codes": ",".join(assessment.reason_codes),
    }


def _db(conn: sqlite3.Connection) -> sqlite3.Connection:
    assert isinstance(conn, sqlite3.Connection)
    return conn


def _state(conn: sqlite3.Connection) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM signer_state WHERE id = 1").fetchone()
    assert isinstance(row, sqlite3.Row)
    return row
