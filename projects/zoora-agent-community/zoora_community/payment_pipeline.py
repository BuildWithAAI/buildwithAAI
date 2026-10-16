"""Connected sandbox purchase queue. No real-asset grant, signer or settlement credit."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from functools import lru_cache
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import time
import uuid

from .bridge_journal import BridgeJournal
from .bridge_sandbox import HOST, STATE, provider_id, sha, transfer_body
from .client import commerce_action
from .payment_contract import (
    MAX_ORDERS, checked_purchase, display, envelope_value, mandate_value, order_id,
    stamp, terms_value, units,
)
from .store import private_regular
from .validation import DIGEST, Problem, canonical, fields, identifier, matching

LEASE_MS = 120_000
MAX_CLAIMS = 32
PIPELINE_VERSION = 2
CODE = re.compile(r"[A-Z][A-Z0-9_]{0,95}\Z")
PHASES = {"PROVIDER_OBSERVED", "PROVIDER_UNKNOWN", "RECONCILIATION_REQUIRED", "PREFLIGHT_BLOCKED", "BLOCKED"}
LEGACY_DDL = """CREATE TABLE control (id INTEGER PRIMARY KEY CHECK(id=1), mandate_json TEXT NOT NULL,
 mandate_sha256 TEXT NOT NULL, initialized_ms INTEGER NOT NULL, revoked_ms INTEGER);
 CREATE TABLE orders (id TEXT PRIMARY KEY, terms_json TEXT NOT NULL, terms_sha256 TEXT NOT NULL,
 created_ms INTEGER NOT NULL);
 CREATE TABLE claims (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
 sequence INTEGER NOT NULL, started_ms INTEGER NOT NULL, dispatch_ms INTEGER,
 finished_ms INTEGER, result_json TEXT, UNIQUE(order_id,sequence));
 PRAGMA user_version=1;"""
RECOVERY_DDL = """CREATE TABLE pipeline_recovery (
 id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL,
 restored_from_sha256 TEXT, restored_at_ms INTEGER,
 migrated_from_sha256 TEXT, migrated_at_ms INTEGER);
 INSERT INTO pipeline_recovery VALUES (1,'ACTIVE',NULL,NULL,NULL,NULL);"""
DDL = LEGACY_DDL + RECOVERY_DDL + "PRAGMA user_version=2;"


def schema(connection):
    return [list(r) for r in connection.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name")]


@lru_cache(maxsize=2)
def expected_schema(version=PIPELINE_VERSION):
    with closing(sqlite3.connect(":memory:", autocommit=True)) as connection:
        connection.executescript(LEGACY_DDL if version == 1 else DDL)
        return schema(connection)


def result_value(value):
    fields(value, ("phase", "code", "transfer_id", "provider_state", "provider_body_sha256",
        "provider_attempts", "candidate_ids", "preflight_response_sha256"))
    if value["phase"] not in PHASES:
        raise ValueError("invalid phase")
    matching(value["code"], CODE, "PIPELINE_INVALID_RESULT")
    if value["transfer_id"] is not None:
        provider_id(value["transfer_id"])
    if value["provider_state"] is not None:
        matching(value["provider_state"], STATE, "PIPELINE_INVALID_RESULT")
    for key in ("provider_body_sha256", "preflight_response_sha256"):
        if value[key] is not None:
            matching(value[key], DIGEST, "PIPELINE_INVALID_RESULT")
    if type(value["provider_attempts"]) is not int or not 0 <= value["provider_attempts"] <= 32:
        raise ValueError("invalid provider attempts")
    candidates = value["candidate_ids"]
    if type(candidates) is not list or len(candidates) > 100 or len(set(candidates)) != len(candidates):
        raise ValueError("invalid candidates")
    for candidate in candidates:
        provider_id(candidate)
    return value


def result(phase, code, view=None, *, candidates=(), preflight=None):
    observed = (view or {}).get("observation") or {}
    return result_value({"phase": phase, "code": code, "transfer_id": observed.get("id"),
        "provider_state": observed.get("state"), "provider_body_sha256": (view or {}).get("body_sha256"),
        "provider_attempts": (view or {}).get("attempts", 0), "candidate_ids": list(candidates),
        "preflight_response_sha256": preflight})


def error_code(error):
    return error.code if isinstance(error, Problem) and type(error.code) is str and CODE.fullmatch(error.code) else "PIPELINE_DEPENDENCY_REJECTED"


class PaymentPipeline:
    def __init__(self, state, *, clock=None):
        self.state = Path(state).absolute()
        self.path = self.state / "payment-pipeline.sqlite3"
        self.clock = clock or (lambda: time.time_ns() // 1_000_000)
        self.bridge = BridgeJournal(self.state / "provider", clock=self.clock)

    @staticmethod
    def _identity(client, token, mandate, role):
        try:
            me = client.request("GET", "/v1/me", token=token)[1]
            status = client.request("GET", "/v1/status")[1]
            if type(me) is not dict or type(status) is not dict:
                raise ValueError("invalid identity response")
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            raise Problem(502, "PIPELINE_IDENTITY_RESPONSE_REJECTED") from None
        if status.get("instance_id") != mandate["instance_id"]:
            raise Problem(409, "PIPELINE_SOURCE_INSTANCE_CHANGED")
        if me.get("role") != role:
            raise Problem(403, "PIPELINE_WRONG_CREDENTIAL_ROLE")
        principal = identifier(me.get("principal_id"))
        if role == "OPERATOR" and principal != mandate["operator_id"]:
            raise Problem(403, "PIPELINE_OPERATOR_MISMATCH")
        if role == "AGENT" and principal not in mandate["agents"]:
            raise Problem(403, "PIPELINE_AGENT_NOT_AUTHORIZED")
        return principal

    def initialize(self, value, client, token):
        mandate = mandate_value(value)
        self._identity(client, token, mandate, "OPERATOR")
        for agent_id in mandate["agents"]:
            agent = client.request("GET", "/v1/agents/" + agent_id)[1]
            if agent.get("operator_id") != mandate["operator_id"] or not agent.get("active"):
                raise Problem(403, "PIPELINE_FOREIGN_OR_INACTIVE_AGENT")
        at = stamp(self.clock())
        self.state.mkdir(mode=0o700)
        created = False
        try:
            fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(fd)
            created = True
            with closing(sqlite3.connect(self.path, autocommit=True)) as connection:
                connection.executescript(DDL)
                connection.execute("PRAGMA synchronous=FULL")
                connection.execute("INSERT INTO control VALUES (1,?,?,?,NULL)", (canonical(mandate), sha(mandate), at))
            return self.show()
        except BaseException:
            if created:
                self.path.unlink()
            self.state.rmdir()
            raise

    def _load(self, connection, *, allow_legacy=False):
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version == 1 and not allow_legacy:
            raise Problem(503, "PIPELINE_MIGRATION_REQUIRED")
        try:
            if (version not in ({1, PIPELINE_VERSION} if allow_legacy else {PIPELINE_VERSION})
                    or schema(connection) != expected_schema(version)
                    or connection.execute("PRAGMA foreign_key_check").fetchall()):
                raise ValueError("invalid schema")
            controls = connection.execute("SELECT * FROM control").fetchall()
            if len(controls) != 1 or controls[0]["id"] != 1:
                raise ValueError("invalid control")
            control = dict(controls[0])
            control["pipeline_schema_version"] = version
            recovery = {"id": 1, "mode": "LEGACY_REQUIRES_MIGRATION", "restored_from_sha256": None,
                "restored_at_ms": None, "migrated_from_sha256": None, "migrated_at_ms": None}
            if version == PIPELINE_VERSION:
                rows = connection.execute("SELECT * FROM pipeline_recovery").fetchall()
                if len(rows) != 1:
                    raise ValueError("recovery control count")
                recovery = dict(rows[0])
                if recovery["id"] != 1 or recovery["mode"] not in {"ACTIVE", "RECOVERY_ONLY"}:
                    raise ValueError("recovery mode")
                for purpose in ("restored", "migrated"):
                    pin, at = recovery[purpose + "_from_sha256"], recovery[purpose + "_at_ms"]
                    if (pin is None) != (at is None):
                        raise ValueError("incomplete recovery provenance")
                    if pin is not None:
                        matching(pin, DIGEST, "PIPELINE_INVALID_RECOVERY_PIN")
                        stamp(at)
                if (recovery["mode"] == "RECOVERY_ONLY") != (recovery["restored_from_sha256"] is not None):
                    raise ValueError("recovery provenance")
            control["recovery"] = recovery
            mandate = mandate_value(json.loads(control["mandate_json"]))
            latest = stamp(control["initialized_ms"])
            if control["mandate_sha256"] != sha(mandate):
                raise ValueError("mandate changed")
            if control["revoked_ms"] is not None:
                if stamp(control["revoked_ms"]) < latest:
                    raise ValueError("invalid revocation time")
                latest = control["revoked_ms"]
            orders = [dict(r) for r in connection.execute("SELECT * FROM orders ORDER BY id")]
            claims = [dict(r) for r in connection.execute("SELECT * FROM claims ORDER BY order_id,sequence")]
            if len(orders) > MAX_ORDERS or len(claims) > MAX_ORDERS * MAX_CLAIMS:
                raise ValueError("capacity")
            total = 0
            for row in orders:
                terms = json.loads(row["terms_json"])
                fields(terms, ("envelope", "agent_id", "commerce_request", "intent"))
                expected = terms_value(mandate, terms["envelope"], terms["agent_id"], terms["commerce_request"])
                if (terms != expected or row["id"] != terms["intent"]["request_id"]
                        or sha(terms) != row["terms_sha256"] or stamp(row["created_ms"]) < control["initialized_ms"]
                        or not mandate["valid_from_ms"] <= row["created_ms"] < mandate["expires_ms"]
                        or control["revoked_ms"] is not None and row["created_ms"] > control["revoked_ms"]):
                    raise ValueError("order binding")
                total += units(terms["envelope"]["amount_usdc"])
                latest = max(latest, row["created_ms"])
                previous = None
                for sequence, claim in enumerate((c for c in claims if c["order_id"] == row["id"]), 1):
                    identifier(claim["id"])
                    if (sequence > MAX_CLAIMS or claim["sequence"] != sequence
                            or stamp(claim["started_ms"]) < ((previous["finished_ms"] or previous["started_ms"]) if previous else row["created_ms"])):
                        raise ValueError("claim ordering")
                    if previous and previous["finished_ms"] is None and claim["started_ms"] < previous["started_ms"] + LEASE_MS:
                        raise ValueError("overlapping claim")
                    if claim["dispatch_ms"] is not None and stamp(claim["dispatch_ms"]) < claim["started_ms"]:
                        raise ValueError("dispatch ordering")
                    if (claim["dispatch_ms"] is not None and control["revoked_ms"] is not None
                            and claim["dispatch_ms"] > control["revoked_ms"]):
                        raise ValueError("dispatch after revocation")
                    if claim["finished_ms"] is None:
                        if claim["result_json"] is not None:
                            raise ValueError("unfinished result")
                    else:
                        if stamp(claim["finished_ms"]) < max(claim["started_ms"], claim["dispatch_ms"] or 0):
                            raise ValueError("finish ordering")
                        result_value(json.loads(claim["result_json"]))
                    latest = max(latest, claim["started_ms"], claim["dispatch_ms"] or 0, claim["finished_ms"] or 0)
                    previous = claim
            if total > units(mandate["admission_budget_usdc"]):
                raise ValueError("admission budget")
            for purpose in ("restored", "migrated"):
                at = recovery[purpose + "_at_ms"]
                if at is not None:
                    if at < control["initialized_ms"]:
                        raise ValueError("recovery time")
                    latest = max(latest, at)
            return control, mandate, orders, claims, latest, total
        except (Problem, ValueError, TypeError, KeyError, UnicodeError, RecursionError):
            raise Problem(503, "PIPELINE_CONSISTENCY_FAILURE") from None

    @contextmanager
    def _connection(self, *, allow_legacy=False):
        info = self.state.lstat()
        if (not stat.S_ISDIR(info.st_mode) or os.name == "posix" and
                (stat.S_IMODE(info.st_mode) & 0o077 or info.st_uid != os.getuid())):
            raise Problem(400, "PIPELINE_PRIVATE_DIRECTORY_REQUIRED")
        private_regular(self.path, 16 * 1024 * 1024)
        try:
            with closing(sqlite3.connect(self.path.as_uri() + "?mode=rw", uri=True, timeout=5, autocommit=True)) as connection:
                connection.row_factory = sqlite3.Row
                connection.setconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE, True)
                connection.setconfig(sqlite3.SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, False)
                connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 65_536)
                connection.execute("PRAGMA trusted_schema=OFF")
                connection.execute("PRAGMA foreign_keys=ON")
                connection.execute("PRAGMA synchronous=FULL")
                connection.execute("BEGIN IMMEDIATE")
                try:
                    self._load(connection, allow_legacy=allow_legacy)
                    yield connection
                    self._load(connection, allow_legacy=allow_legacy)
                    connection.execute("COMMIT")
                except BaseException:
                    connection.execute("ROLLBACK")
                    raise
        except sqlite3.Error:
            raise Problem(503, "PIPELINE_STORAGE_UNAVAILABLE") from None

    def _time(self, loaded):
        at = stamp(self.clock())
        if at < loaded[4]:
            raise Problem(409, "PIPELINE_CLOCK_REGRESSION")
        return at

    @staticmethod
    def _active(loaded):
        if loaded[0]["recovery"]["mode"] != "ACTIVE":
            raise Problem(409, "PIPELINE_RESTORED_READ_ONLY")

    @staticmethod
    def _grant(loaded, at):
        PaymentPipeline._active(loaded)
        if loaded[0]["revoked_ms"] is not None:
            raise Problem(409, "PIPELINE_MANDATE_REVOKED")
        if not loaded[1]["valid_from_ms"] <= at < loaded[1]["expires_ms"]:
            raise Problem(409, "PIPELINE_MANDATE_EXPIRED")

    def _config(self, *, active=False):
        with self._connection() as connection:
            loaded = self._load(connection)
            if active:
                self._active(loaded)
            return loaded[1]

    def stage(self, value, client, token):
        envelope = envelope_value(value)
        mandate = self._config(active=True)
        agent_id = self._identity(client, token, mandate, "AGENT")
        key = order_id(mandate, envelope)
        with self._connection() as connection:
            old = connection.execute("SELECT * FROM orders WHERE id=?", (key,)).fetchone()
            if old:
                saved = json.loads(old["terms_json"])
                if saved["envelope"] != envelope or saved["agent_id"] != agent_id:
                    raise Problem(409, "PIPELINE_ORDER_CONFLICT")
                return {"order_id": key, "replayed": True, "terms_sha256": old["terms_sha256"]}
        book = client.request("GET", "/v1/commerce/books/" + envelope["book_id"], token=token)[1]
        terms, state = checked_purchase(book, envelope, agent_id, mandate)
        if state != "AUTHORIZED":
            raise Problem(409, "PIPELINE_COMMERCE_ALREADY_SUBMITTED")
        with self._connection() as connection:
            loaded = self._load(connection)
            at = self._time(loaded)
            old = connection.execute("SELECT * FROM orders WHERE id=?", (key,)).fetchone()
            if old:
                if old["terms_sha256"] != sha(terms):
                    raise Problem(409, "PIPELINE_ORDER_CONFLICT")
                return {"order_id": key, "replayed": True, "terms_sha256": old["terms_sha256"]}
            self._grant(loaded, at)
            if len(loaded[2]) >= MAX_ORDERS:
                raise Problem(409, "PIPELINE_ORDER_LIMIT")
            if loaded[5] + units(envelope["amount_usdc"]) > units(mandate["admission_budget_usdc"]):
                raise Problem(409, "PIPELINE_ADMISSION_BUDGET")
            connection.execute("INSERT INTO orders VALUES (?,?,?,?)", (key, canonical(terms), sha(terms), at))
            return {"order_id": key, "replayed": False, "terms_sha256": sha(terms)}

    def _claim(self, key, *, recovery_only=False):
        with self._connection() as connection:
            loaded = self._load(connection)
            if not recovery_only:
                self._active(loaded)
            at = self._time(loaded)
            order = next((r for r in loaded[2] if r["id"] == identifier(key)), None)
            if order is None:
                raise Problem(404, "PIPELINE_ORDER_NOT_FOUND")
            claims = [c for c in loaded[3] if c["order_id"] == key]
            if claims and claims[-1]["finished_ms"] is None and at < claims[-1]["started_ms"] + LEASE_MS:
                raise Problem(409, "PIPELINE_ORDER_BUSY")
            if len(claims) >= MAX_CLAIMS:
                raise Problem(409, "PIPELINE_CLAIM_LIMIT")
            claim = uuid.uuid4().hex
            connection.execute("INSERT INTO claims VALUES (?,?,?,?,NULL,NULL,NULL)", (claim, key, len(claims) + 1, at))
            return claim, json.loads(order["terms_json"]), loaded[1]

    def _fence(self, key, claim):
        with self._connection() as connection:
            loaded = self._load(connection)
            at = self._time(loaded)
            latest = [c for c in loaded[3] if c["order_id"] == key][-1]
            if latest["id"] != claim or latest["finished_ms"] is not None or at >= latest["started_ms"] + LEASE_MS:
                raise Problem(409, "PIPELINE_STALE_CLAIM")
            self._grant(loaded, at)
            connection.execute("UPDATE claims SET dispatch_ms=? WHERE id=?", (at, claim))

    def _finish(self, key, claim, value):
        result_value(value)
        with self._connection() as connection:
            loaded = self._load(connection)
            at = self._time(loaded)
            latest = [c for c in loaded[3] if c["order_id"] == key][-1]
            if latest["id"] != claim or latest["finished_ms"] is not None:
                raise Problem(409, "PIPELINE_STALE_CLAIM")
            connection.execute("UPDATE claims SET finished_ms=?,result_json=? WHERE id=?", (at, canonical(value), claim))
        return {"order_id": key, **value, "settlement_accounting": "UNAVAILABLE", "wallet_execution": False}

    @staticmethod
    def _read_existing(bridge, key, provider, view, transfer_id=None):
        if not view["attempts"]:
            raise Problem(409, "PIPELINE_RECOVERY_REQUIRES_ATTEMPT")
        if transfer_id:
            view = bridge.reconcile(key, provider, transfer_id)
        elif view["observation"]:
            view = bridge.advance(key, provider)
        else:
            discovery = bridge.discover(key, provider)
            return result("RECONCILIATION_REQUIRED", discovery["status"], view, candidates=discovery["candidate_ids"])
        return result("PROVIDER_OBSERVED" if view["state"] == "OBSERVED" else "PROVIDER_UNKNOWN",
                      "SETTLEMENT_NOT_VERIFIED", view)

    def run_one(self, key, client, token, provider, *, transfer_id=None, recovery_only=False):
        key = identifier(key)
        # Ownership is checked before a claim; private-host recovery is GET-only.
        if not recovery_only:
            mandate = self._config(active=True)
            agent = self._identity(client, token, mandate, "AGENT")
            with self._connection() as connection:
                row = connection.execute("SELECT terms_json FROM orders WHERE id=?", (key,)).fetchone()
                if row is None:
                    raise Problem(404, "PIPELINE_ORDER_NOT_FOUND")
                if json.loads(row["terms_json"])["agent_id"] != agent:
                    raise Problem(403, "PIPELINE_PURCHASE_AGENT_MISMATCH")
        claim, terms, mandate = self._claim(key, recovery_only=recovery_only)
        try:
            if recovery_only:
                if not self.bridge.path.exists():
                    raise Problem(409, "PIPELINE_RECOVERY_REQUIRES_ATTEMPT")
                try:
                    view = self.bridge.show(key)
                except Problem as error:
                    if error.code != "BRIDGE_INTENT_NOT_FOUND":
                        raise
                    raise Problem(409, "PIPELINE_RECOVERY_REQUIRES_ATTEMPT") from None
                if view["body"] != transfer_body(terms["intent"], view["idempotency_key"]):
                    raise Problem(409, "PIPELINE_PROVIDER_BINDING_MISMATCH")
            else:
                if not self.bridge.path.exists():
                    with self._connection() as connection:
                        if any(c["dispatch_ms"] is not None for c in self._load(connection)[3]):
                            raise Problem(409, "PIPELINE_PROVIDER_HISTORY_MISSING")
                view = self.bridge.prepare(terms["intent"])
            if view["attempts"] or recovery_only:
                value = self._read_existing(self.bridge, key, provider, view, transfer_id)
            else:
                with self._connection() as connection:
                    loaded = self._load(connection)
                    self._grant(loaded, self._time(loaded))
                preflight = provider.preflight(mandate["customer_id"])
                matching(preflight.get("response_sha256"), DIGEST, "PIPELINE_PREFLIGHT_REJECTED")
                if (preflight.get("customer_id") != mandate["customer_id"]
                        or preflight.get("credential_sha256") != provider.credential_fingerprint
                        or preflight.get("endpoint_host") != HOST or preflight.get("method") != "GET"
                        or preflight.get("path") != "/v0/customers/" + mandate["customer_id"]):
                    raise Problem(502, "PIPELINE_PREFLIGHT_REJECTED")
                if (preflight.get("assessment") != "CUSTOMER_SIGNALS_OBSERVED"
                        or preflight.get("customer_status") != "active" or preflight.get("terms_accepted") is not True
                        or preflight.get("base_endorsement_status") != "approved" or preflight.get("base_requirements_clear") is not True
                        or preflight.get("kyc_status") not in (None, "approved", "active")
                        or preflight.get("missing_fields") != [] or preflight.get("blocking_fields") != []):
                    value = result("PREFLIGHT_BLOCKED", "PIPELINE_CUSTOMER_SIGNALS_NOT_OBSERVED", view,
                                   preflight=preflight["response_sha256"])
                else:
                    route = "/v1/commerce/books/" + terms["envelope"]["book_id"]
                    book = client.request("GET", route, token=token)[1]
                    current, _ = checked_purchase(book, terms["envelope"], terms["agent_id"], mandate)
                    if current != terms:
                        raise Problem(409, "PIPELINE_COMMERCE_BINDING_MISMATCH")
                    command = {"request_id": sha({"domain": "PIPELINE_SUBMIT_V1", "order": key, "terms": sha(terms)})[:32],
                        "sandbox_dispatch": {"instance_id": mandate["instance_id"], "pipeline_terms_sha256": sha(terms)},
                        "command": {"kind": "SUBMIT", "purchase_id": terms["envelope"]["purchase_id"],
                                    "binding_sha256": terms["envelope"]["commerce_binding_sha256"]}}
                    submitted = commerce_action(client, terms["envelope"]["book_id"], command, token)[1]
                    if submitted.get("outcome") != "SIMULATED_SUBMISSION":
                        raise Problem(409, "PIPELINE_COMMERCE_SUBMISSION_REFUSED")
                    view = self.bridge.create_once(key, provider, before_create=lambda: self._fence(key, claim))
                    value = result("PROVIDER_OBSERVED" if view["state"] == "OBSERVED" else "PROVIDER_UNKNOWN",
                        "SETTLEMENT_NOT_VERIFIED", view, preflight=preflight["response_sha256"])
        except (Problem, OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            value = result("BLOCKED", error_code(error))
        return self._finish(key, claim, value)

    def run_batch(self, client_factory, token, provider, *, limit=8, workers=4):
        if type(limit) is not int or not 1 <= limit <= 8 or type(workers) is not int or not 1 <= workers <= 4:
            raise Problem(400, "PIPELINE_BATCH_LIMIT")
        agent = self._identity(client_factory(), token, self._config(active=True), "AGENT")
        with self._connection() as connection:
            loaded = self._load(connection)
            last = dict(connection.execute("SELECT order_id,MAX(rowid) FROM claims GROUP BY order_id"))
            owned = [r["id"] for r in loaded[2] if json.loads(r["terms_json"])["agent_id"] == agent]
            keys = sorted(owned, key=lambda key: (last.get(key, 0), key))[:limit]

        def run(key):
            try:
                return self.run_one(key, client_factory(), token, provider)
            except Problem as error:
                return {"order_id": key, "phase": "BLOCKED", "code": error_code(error)}

        with ThreadPoolExecutor(max_workers=workers) as pool:
            outcomes = list(pool.map(run, keys))
        return {"outcomes": outcomes, "orders_selected": len(keys), "workers": workers,
                "classification": "CONNECTED_SANDBOX_REHEARSAL", "wallet_execution": False,
                "settlement_accounting": "UNAVAILABLE"}

    def revoke(self, client, token):
        self._identity(client, token, self._config(active=True), "OPERATOR")
        with self._connection() as connection:
            loaded = self._load(connection)
            if loaded[0]["revoked_ms"] is None:
                connection.execute("UPDATE control SET revoked_ms=? WHERE id=1", (self._time(loaded),))
        return self.show()

    def show(self):
        with self._connection() as connection:
            control, mandate, orders, claims, _latest, total = self._load(connection)
            entries = []
            for row in orders:
                attempts = [c for c in claims if c["order_id"] == row["id"]]
                latest = attempts[-1] if attempts else None
                entries.append({"order_id": row["id"], "terms": json.loads(row["terms_json"]),
                    "terms_sha256": row["terms_sha256"], "claims": len(attempts),
                    "phase": "QUEUED" if not latest else "CLAIMED_UNKNOWN" if latest["finished_ms"] is None else json.loads(latest["result_json"])["phase"],
                    "last_result": json.loads(latest["result_json"]) if latest and latest["result_json"] else None})
            return {"pipeline_schema_version": PIPELINE_VERSION, "recovery": control["recovery"],
                "may_submit_purchases": control["recovery"]["mode"] == "ACTIVE",
                "mandate_sha256": control["mandate_sha256"],
                "mandate_id": mandate["mandate_id"], "instance_id": mandate["instance_id"],
                "operator_id": mandate["operator_id"], "revoked_ms": control["revoked_ms"],
                "orders": entries, "admitted_principal_usdc": display(total),
                "remaining_admission_usdc": display(units(mandate["admission_budget_usdc"]) - total),
                "budget_semantics": "LIFETIME_ADMISSION_CAP_NOT_WALLET_BALANCE",
                "automatic_exposure_release": False, "synthetic_unit_conversion": False,
                "real_funds_authorized": False, "wallet_execution": False,
                "settlement_accounting": "UNAVAILABLE", "classification": "CONNECTED_SANDBOX_REHEARSAL"}

    def audit(self):
        with self._connection() as connection:
            loaded = self._load(connection)
            if [r[0] for r in connection.execute("PRAGMA quick_check")] != ["ok"]:
                raise Problem(503, "PIPELINE_CONSISTENCY_FAILURE")
            return {"orders": len(loaded[2]), "claims": len(loaded[3]),
                "unfinished_claims": sum(c["finished_ms"] is None for c in loaded[3]),
                "dispatch_fences": sum(c["dispatch_ms"] is not None for c in loaded[3]),
                "logical_sha256": sha({"control": loaded[0], "orders": loaded[2], "claims": loaded[3]}),
                "admitted_principal_usdc": display(loaded[5]), "external_attestation": "UNAVAILABLE"}
