"""Capped signer. Boots DRY_RUN and PAUSED. This build does not broadcast."""

from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from zoora_signer.caps import CapView, evaluate_buy, evaluate_sell
from zoora_signer.constants import (
    CLOCK_SKEW_MS,
    CT_ZONE,
    INTENT_TTL_MS,
    PREFLIGHT_INTERVAL_MS,
    RPC_PROVIDER_NAME,
    SLEEP_JUMP_MS,
    UNCONFIRMED_MS,
    WALLET_CAP_CENTS,
)
from zoora_signer.db import SecretInLog, append_event, init_db, read_events, transact, verify_chain
from zoora_signer.models import Decision, Intent, OracleReading, Payload, sol_usd_cents
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
from zoora_signer.signing import public_key, sign_message
from zoora_signer.txbuild import (
    AllowlistError,
    Instruction,
    assert_allowlisted,
    build_buy,
    build_sweep,
)
from zoora_signer.vet import VetAssessment, assess_vet

MINT_OK = __import__("re").compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")


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
    time_stop_ms: int = 6 * 60 * 60 * 1000
    hard_stop_bps: int = 5_000


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

    @classmethod
    def open(cls, services: Services) -> Signer:
        signer = cls(services)
        signer.boot()
        return signer

    def boot(self) -> None:
        reject_key_material_in_env()
        init_db(self.path, self.s.provider_name)
        boot_id = uuid.uuid4().hex
        opening = self.s.chain.sol_lamports()

        def op(conn: sqlite3.Connection) -> None:
            from sqlite3 import Connection

            db = conn if isinstance(conn, Connection) else None
            assert isinstance(db, Connection)
            row = db.execute("SELECT * FROM signer_state WHERE id = 1").fetchone()
            assert row is not None
            mode = "DRY_RUN" if int(row["route_approved"]) != 1 else str(row["execution_mode"])
            ledger = row["ledger_sol_lamports"]
            if ledger is None:
                ledger = opening
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
            if not verify_chain(db):
                db.execute(
                    "UPDATE signer_state SET activity = 'HALTED', halt_reason = 'hash_chain' WHERE id = 1"
                )
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
            status = "unreachable"
        if status == "clear":
            return "clear"
        reason = "agent_guard" if status == "killed" else "agent_guard_unreachable"
        self._halt(reason)
        return status

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

    def handle_intent(self, raw: dict[str, object], signature: str) -> Decision:
        reject_key_material_in_env()
        if not self._hmac_ok(raw, signature):
            return self._note("intent_refused", {"code": "BAD_HMAC", "provider": self.s.provider_name})
        intent = parse_intent(raw)
        if intent is None:
            return self._note("intent_refused", {"code": "BAD_INTENT"})
        stored = self._stored(intent.intent_id)
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
            if self._preview_allows(intent, reading):
                assessment = self._vet_fresh(intent.mint, now)
                if not assessment.ok:
                    if assessment.service_error:
                        self._halt("vetting_service")
                    return self._refuse(intent, assessment.code, reading, assessment)
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
        for intent, signature in batch.intents:
            raw = intent_wire(intent)
            decisions.append(self.handle_intent(raw, signature))
            self._feed_cursor = intent.intent_id
        try:
            rows = self.read_events(0)
            feed.push_events(
                [{"id": row_id, "kind": kind, "payload": payload} for row_id, kind, payload in rows]
            )
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
            row = _state(db)
            if str(row["activity"]) == "HALTED" and str(row["halt_reason"] or "").startswith("agent_guard"):
                return Decision(False, "KILL_HOLD", False)
            db.execute("UPDATE signer_state SET activity = 'ACTIVE', halt_reason = NULL WHERE id = 1")
            if reading.ok:
                self._ensure_snapshot(db, now, sol_usd_cents(reading))
                self._refresh_buy_halt(db, now, sol_usd_cents(reading))
            event_id = self._event(db, "owner_resume", {"provider": self.s.provider_name})
            simulated = str(row["execution_mode"]) != "LIVE"
            return Decision(True, "RESUMED", simulated, event_id=event_id)

        decision = transact(self.path, op)
        self._sync_hud()
        return decision

    def halt(self, reason: str = "owner") -> Decision:
        self._halt(reason)
        return Decision(True, "HALTED", False)

    def telegram(self, text: str) -> Decision:
        if text.strip().lower() in {"halt", "/halt", "kill"}:
            return self.halt("telegram")
        self._note("telegram_rejected", {"code": "TELEGRAM_HALT_ONLY"})
        return Decision(False, "TELEGRAM_HALT_ONLY", False)

    def set_route(self, source: str, source_date: str) -> Decision:
        if not source.strip() or not source_date.strip():
            return Decision(False, "ROUTE_SOURCE_REQUIRED", False)

        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            db.execute(
                """
                UPDATE signer_state
                SET route_approved = 1, route_source = ?, route_source_date = ?
                WHERE id = 1
                """,
                (source, source_date),
            )
            event_id = self._event(
                db,
                "route_approved",
                {"source": source, "source_date": source_date, "provider": self.s.provider_name},
            )
            return Decision(True, "ROUTE_APPROVED", False, event_id=event_id)

        decision = transact(self.path, op)
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
            db.execute("UPDATE signer_state SET execution_mode = ? WHERE id = 1", (mode,))
            self._event(db, "mode", {"mode": mode})
            return Decision(True, "MODE", mode != "LIVE")

        decision = transact(self.path, op)
        self._sync_hud()
        return decision

    def rotate_hmac(self, new_key: bytes) -> Decision:
        if len(new_key) < 16:
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

        decision = transact(self.path, op)
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

        return transact(self.path, op)

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

        decision = transact(self.path, op)
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
            db.execute(
                "UPDATE signer_state SET activity = 'HALTED', halt_reason = 'unexpected_sol' WHERE id = 1"
            )
            self._event(db, "halt", {"reason": "unexpected_sol"})
            return Decision(False, "UNEXPECTED_SOL", False)

        decision = transact(self.path, op)
        self._sync_hud()
        return decision

    def sweep(self, dest: str, lamports: int) -> Decision:
        try:
            ixs = build_sweep(
                payer=self._payer(),
                dest=dest,
                lamports=lamports,
                whitelist=self._whitelist(),
            )
            assert_allowlisted(ixs, self._whitelist())
        except AllowlistError as exc:
            return Decision(False, str(exc), False)
        if self.activity() == "HALTED" or self.activity() == "PAUSED":
            pass
        now = self.s.clock.now_ms()

        def op(conn: sqlite3.Connection) -> Decision:
            db = _db(conn)
            current = int(_state(db)["ledger_sol_lamports"] or 0)
            if lamports <= 0 or lamports > current:
                return Decision(False, "BAD_SWEEP", False)
            db.execute(
                "UPDATE signer_state SET ledger_sol_lamports = ? WHERE id = 1",
                (current - lamports,),
            )
            reading = self.s.oracle.quote(now)
            cents = 0
            if reading.ok:
                cents = lamports * sol_usd_cents(reading) // 1_000_000_000
            db.execute(
                """
                UPDATE equity_day SET withdrawals_cents = withdrawals_cents + ?
                WHERE ct_day = ?
                """,
                (cents, ct_day(now)),
            )
            self._event(db, "sweep", {"dest": dest, "lamports": lamports, "dry_run": True})
            return Decision(True, "SWEEP", True)

        if self.mode() == "LIVE" and self.s.broadcaster.enabled:
            return Decision(False, "BROADCAST_DISABLED", False)
        decision = transact(self.path, op)
        self._sync_hud()
        return decision

    def owner_sell(self, mint: str, token_amount: int | None = None) -> Decision:
        return self._sell(mint, token_amount, owner=True, intent_id=None)

    def sell_all(self) -> list[Decision]:
        def op(conn: sqlite3.Connection) -> list[str]:
            db = _db(conn)
            rows = db.execute(
                "SELECT mint FROM trades WHERE status IN ('open', 'moon')"
            ).fetchall()
            return [str(row["mint"]) for row in rows]

        return [self.owner_sell(mint) for mint in transact(self.path, op)]

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

        due = transact(self.path, op)
        return [self._sell(mint, amount, owner=False, intent_id=None) for mint, amount in due]

    def activity(self) -> str:
        def op(conn: sqlite3.Connection) -> str:
            return str(_state(_db(conn))["activity"])

        return transact(self.path, op)

    def mode(self) -> str:
        def op(conn: sqlite3.Connection) -> str:
            return str(_state(_db(conn))["execution_mode"])

        return transact(self.path, op)

    def route_approved(self) -> bool:
        def op(conn: sqlite3.Connection) -> bool:
            return int(_state(_db(conn))["route_approved"]) == 1

        return transact(self.path, op)

    def read_events(self, after: int) -> list[tuple[int, str, str]]:
        def op(conn: sqlite3.Connection) -> list[tuple[int, str, str]]:
            return read_events(_db(conn), after)

        return transact(self.path, op)

    def open_trade_count(self) -> int:
        def op(conn: sqlite3.Connection) -> int:
            row = _db(conn).execute("SELECT COUNT(*) AS n FROM trades WHERE status = 'open'").fetchone()
            assert row is not None
            return int(row["n"])

        return transact(self.path, op)

    def _buy(self, intent: Intent, reading: OracleReading, assessment: VetAssessment | None) -> Decision:
        now = self.s.clock.now_ms()
        price = sol_usd_cents(reading)
        stake = intent.usd_stake_cents or 0
        vet_payload = _vet_payload(assessment)

        def op(conn: sqlite3.Connection) -> tuple[Decision, int | None]:
            db = _db(conn)
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
            self._ensure_snapshot(db, now, price)
            self._refresh_buy_halt(db, now, price)
            prior_hits = self._prior_hits(db, now)
            db.execute(
                "INSERT INTO intent_hits (intent_id, seen_ms) VALUES (?, ?)",
                (intent.intent_id, now),
            )
            view = self._view(db, now, price, prior_hits)
            result = evaluate_buy(view, stake, intent.max_slippage_bps)
            if result.halt:
                db.execute(
                    "UPDATE signer_state SET activity = 'HALTED', halt_reason = ? WHERE id = 1",
                    (result.code,),
                )
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
                (intent.intent_id, intent.mint, stake, ct_day(now), now),
            )
            reservation_id = int(db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            event_id = self._event(db, "reserved", payload)
            return (Decision(True, "RESERVED", True, intent.intent_id, event_id), reservation_id)

        try:
            decision, reservation_id = transact(self.path, op)
        except SecretInLog:
            self._halt("secret_in_log")
            return Decision(False, "SECRET_IN_LOG", False, intent.intent_id)
        self._sync_hud()
        if reservation_id is None or self.s.defer_settle:
            return decision
        return self._settle_buy(intent, reading, reservation_id, stake)

    def _settle_buy(
        self,
        intent: Intent,
        reading: OracleReading,
        reservation_id: int,
        stake: int,
    ) -> Decision:
        price = sol_usd_cents(reading)
        lamports = lamports_for_cents(stake, price)
        if lamports is None:
            return self._release(reservation_id, "UNPRICEABLE", intent.intent_id)
        try:
            ixs = build_buy(
                payer=self._payer(),
                mint=intent.mint,
                stake_cents=stake,
                sol_usd_cents=price,
                slippage_bps=intent.max_slippage_bps,
                token_out=1_000_000,
                fee_lamports=self.s.fee_lamports,
                ata_rent_lamports=self.s.ata_rent_lamports,
            )
            assert_allowlisted(ixs, self._whitelist())
        except AllowlistError as exc:
            return self._release(reservation_id, str(exc), intent.intent_id)
        live = self.mode() == "LIVE" and self.route_approved() and self.activity() == "ACTIVE"
        if live:
            if not self._preflight_clear() or not self.s.secrets.has_signing_key():
                return self._release(reservation_id, "LIVE_BLOCKED", intent.intent_id)
            if not self.s.broadcaster.enabled:
                return self._release(reservation_id, "BROADCAST_DISABLED", intent.intent_id)
            secret = self.s.secrets.get_signing_key()
            if secret is None:
                return self._release(reservation_id, "NO_KEY", intent.intent_id)
            message = _message(ixs)
            signature = sign_message(secret, message).hex()
            try:
                self.s.broadcaster.submit(message)
            except Exception:
                return self._release(reservation_id, "BROADCAST_DISABLED", intent.intent_id)
            return self._fill(intent, reservation_id, stake, lamports, signature, simulated=False)
        digest = hashlib.sha256(_message(ixs)).hexdigest()
        return self._fill(intent, reservation_id, stake, lamports, f"dry-run:{digest}", simulated=True)

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

        decision = transact(self.path, op)
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
            prior_hits = self._prior_hits(db, now)
            if intent_id is not None:
                db.execute(
                    "INSERT INTO intent_hits (intent_id, seen_ms) VALUES (?, ?)",
                    (intent_id, now),
                )
            view = self._view(db, now, price, prior_hits)
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
            if mark is None:
                return Decision(False, "UNPRICEABLE", True, intent_id)
            proceeds = mark * sold // tokens
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
                },
            )
            return Decision(True, status.upper(), True, intent_id)

        decision = transact(self.path, op)
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

        decision = transact(self.path, op)
        self._sync_hud()
        return decision

    def _preview_allows(self, intent: Intent, reading: OracleReading) -> bool:
        price = sol_usd_cents(reading)
        now = self.s.clock.now_ms()

        def op(conn: sqlite3.Connection) -> bool:
            db = _db(conn)
            view = self._view(db, now, price, self._prior_hits(db, now))
            return evaluate_buy(view, intent.usd_stake_cents or 0, intent.max_slippage_bps).accept

        return transact(self.path, op)

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

    def _view(self, conn: sqlite3.Connection, now_ms: int, sol_cents: int, prior_hits: int) -> CapView:
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
        wallet, exposure = self._wallet_exposure(db, sol_cents)
        exposure += int(flight["stake"])
        loss = self._loss(db, day, wallet)
        buy_halt = state["buy_halt_reason"]
        return CapView(
            open_slots=int(open_row["n"]) + int(flight["n"]),
            buys_today=int(buys["n"]),
            daily_loss_cents=loss,
            reserved_loss_cents=int(flight["stake"]),
            exposure_cents=exposure,
            wallet_cents=wallet,
            intents_this_hour=prior_hits,
            activity=str(state["activity"]),
            buy_halt=str(buy_halt) if buy_halt else None,
        )

    def _wallet_exposure(self, db: sqlite3.Connection, sol_cents: int) -> tuple[int, int]:
        conn = _db(db)
        state = _state(conn)
        lamports = int(state["ledger_sol_lamports"] or 0)
        wallet = lamports * sol_cents // 1_000_000_000 if sol_cents > 0 else 0
        exposure = 0
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
            if str(row["status"]) == "open":
                exposure += unrecovered if mark is None else max(unrecovered, mark)
                if mark is not None:
                    wallet += mark
            elif mark is None:
                exposure += unrecovered
            else:
                exposure += mark
                wallet += mark
        return wallet, exposure

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
        wallet, _exposure = self._wallet_exposure(conn, sol_cents)
        conn.execute(
            """
            INSERT INTO equity_day (ct_day, start_equity_cents, withdrawals_cents, deposits_cents)
            VALUES (?, ?, 0, 0)
            """,
            (day, wallet),
        )

    def _refresh_buy_halt(self, db: sqlite3.Connection, now_ms: int, sol_cents: int) -> None:
        conn = _db(db)
        wallet, _exposure = self._wallet_exposure(conn, sol_cents)
        loss = self._loss(conn, ct_day(now_ms), wallet)
        if loss >= 600:
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
            if int(row["reached_signing"]) == 0:
                conn.execute(
                    "UPDATE reservations SET status = 'released', release_reason = 'reboot' WHERE id = ?",
                    (int(row["id"]),),
                )
                continue
            status = "absent"
            if self.s.chain.authoritative:
                status = self.s.chain.signature_status(str(row["signature"] or ""))
            if status == "confirmed":
                conn.execute("UPDATE reservations SET status = 'confirmed' WHERE id = ?", (int(row["id"]),))
            elif status == "unknown":
                conn.execute(
                    "UPDATE signer_state SET activity = 'HALTED', halt_reason = 'reconcile_unknown' WHERE id = 1"
                )
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
            db.execute(
                "UPDATE signer_state SET activity = 'HALTED', halt_reason = 'unconfirmed' WHERE id = 1"
            )
            self._event(db, "halt", {"reason": "unconfirmed"})
            return True

        if transact(self.path, op):
            self._sync_hud()

    def _pause(self, reason: str, failures: list[str]) -> None:
        def op(conn: sqlite3.Connection) -> None:
            db = _db(conn)
            if str(_state(db)["activity"]) != "HALTED":
                db.execute("UPDATE signer_state SET activity = 'PAUSED' WHERE id = 1")
            self._event(db, "preflight_failed", {"reason": reason, "checks": ",".join(failures)})

        transact(self.path, op)
        self._sync_hud()

    def _halt(self, reason: str) -> None:
        def op(conn: sqlite3.Connection) -> None:
            db = _db(conn)
            db.execute(
                "UPDATE signer_state SET activity = 'HALTED', halt_reason = ? WHERE id = 1",
                (reason,),
            )
            self._event(db, "halt", {"reason": reason, "provider": self.s.provider_name})

        transact(self.path, op)
        self._sync_hud()

    def _note(self, kind: str, payload: Payload) -> Decision:
        code = str(payload.get("code") or kind)

        def op(conn: sqlite3.Connection) -> Decision:
            event_id = self._event(_db(conn), kind, payload)
            return Decision(False, code, True, event_id=event_id)

        try:
            decision = transact(self.path, op)
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
                conn.execute(
                    "INSERT INTO intent_hits (intent_id, seen_ms) VALUES (?, ?)",
                    (intent.intent_id, now),
                )
                conn.execute(
                    "INSERT INTO decisions (intent_id, ok, code, simulated) VALUES (?, 0, ?, 1)",
                    (intent.intent_id, code),
                )
            event_id = self._event(conn, "intent_refused", payload)
            return Decision(False, code, True, intent.intent_id, event_id)

        try:
            decision = transact(self.path, op)
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

        return transact(self.path, op)

    def _event(self, db: sqlite3.Connection, kind: str, payload: Payload) -> int:
        return append_event(_db(db), kind, payload, self.s.clock.now_ms(), self._needles())

    def _needles(self) -> tuple[str, ...]:
        found: list[str] = []
        signing = self.s.secrets.get_signing_key()
        if signing is not None:
            found.append(signing.hex())
        mac = self.s.secrets.get_hmac_key()
        if mac is not None:
            found.append(mac.hex())
        url = self.s.secrets.get_rpc_url()
        if url:
            found.append(url)
        return tuple(item for item in found if len(item) >= 8)

    def _hmac_ok(self, raw: dict[str, object], signature: str) -> bool:
        key = self.s.secrets.get_hmac_key()
        if key is None or not signature:
            return False
        expected = sign_intent(raw, key)
        return hmac.compare_digest(expected, signature)

    def _payer(self) -> str:
        secret = self.s.secrets.get_signing_key()
        if secret is None:
            return "11111111111111111111111111111111"
        return public_key(secret)

    def _whitelist(self) -> set[str]:
        def op(conn: sqlite3.Connection) -> set[str]:
            rows = _db(conn).execute("SELECT address FROM whitelist").fetchall()
            return {str(row["address"]) for row in rows}

        return transact(self.path, op)

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

    def _sync_hud(self) -> None:
        path = self.s.hud_path
        if path is None:
            return
        rows = self.read_events(0)
        lines = [json.dumps({"id": row_id, "kind": kind, "payload": payload}) for row_id, kind, payload in rows]
        path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def parse_intent(raw: dict[str, object]) -> Intent | None:
    intent_id = raw.get("intent_id")
    side = raw.get("side")
    mint = raw.get("mint")
    issued = raw.get("issued_at_ms")
    slippage = raw.get("max_slippage_bps")
    if not isinstance(intent_id, str) or not isinstance(side, str) or side not in {"buy", "sell"}:
        return None
    if not isinstance(mint, str) or MINT_OK.fullmatch(mint) is None:
        return None
    if isinstance(issued, bool) or not isinstance(issued, int):
        return None
    if isinstance(slippage, bool) or not isinstance(slippage, int) or slippage < 0:
        return None
    cents: int | None
    if "usd_stake_cents" in raw and isinstance(raw["usd_stake_cents"], int):
        cents = raw["usd_stake_cents"]
    elif "usd_stake" in raw and isinstance(raw["usd_stake"], int | float) and not isinstance(raw["usd_stake"], bool):
        cents = int(round(float(raw["usd_stake"]) * 100))
    else:
        cents = None
    token_amount = raw.get("token_amount")
    tokens = token_amount if isinstance(token_amount, int) else None
    if side == "buy" and (cents is None or cents < 0):
        return None
    return Intent(intent_id, side, mint, cents, tokens, slippage, issued)


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


def _message(ixs: list[Instruction]) -> bytes:
    return b"".join(ix.program_id.encode() + ix.data for ix in ixs)


def _db(conn: sqlite3.Connection) -> sqlite3.Connection:
    assert isinstance(conn, sqlite3.Connection)
    return conn


def _state(conn: sqlite3.Connection) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM signer_state WHERE id = 1").fetchone()
    assert isinstance(row, sqlite3.Row)
    return row
