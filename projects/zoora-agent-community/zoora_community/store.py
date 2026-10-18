"""Transactional records and scoped bearer credentials in a trusted local directory."""

import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import stat
import time
import uuid
from contextlib import closing

from . import VERSION
from .validation import (
    DIGEST, MAX_BODY, TOKEN, Problem, boolean, canonical, capabilities, fields,
    handle, identifier, matching, object_value, text,
)
from .wallet_proof import WalletProofMethods, profile
from .observations import ObservationMethods
from .jobs import JobMethods
from .pilot_access import PilotAccessMethods
from .research_identity import ResearchIdentityMethods
from .task_capacity import TaskCapacityMethods
from .commerce_store import CommerceMethods
from .wallet_login import WalletLoginMethods
from .agent_activity import AgentActivityMethods

APPLICATION_ID = 0x5A414136
SCHEMA_VERSION = 7
MAX_DATABASE_BYTES = 64 * 1024 * 1024
LIMITS = {"operators": 200, "agents": 2000, "handles": 64000, "projects": 1000,
          "members": 10000, "artifacts": 10000, "posts": 10000, "offers": 2000,
          "credentials": 20000, "audit": 50000, "wallet_challenges": 20000,
          "wallet_proofs": 10000, "transactions": 5000, "jobs": 2000,
          "invitations": 1000, "access_holds": 2200, "operator_task_capacity": 200,
          "commerce_books": 64, "commerce_actions": 16384,
          "wallet_login_challenges": 20000}
AUTH_DOMAIN = b"ZOORA_AE006_CREDENTIAL_V1\0"
AUDIT_DOMAIN = b"ZOORA_AE006_AUDIT_V1\0"
ZERO_HASH = "0" * 64
DAY_MS = 86_400_000


def now_ms():
    return time.time_ns() // 1_000_000


def new_id():
    return uuid.uuid4().hex


def credential_digest(token):
    return hashlib.sha256(AUTH_DOMAIN + token.encode("ascii")).hexdigest()


def private_regular(path, maximum):
    try:
        info = path.lstat()
    except OSError:
        raise Problem(503, "STATE_UNAVAILABLE") from None
    if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
        raise Problem(503, "UNSAFE_STATE_FILE")
    if os.name == "posix" and (stat.S_IMODE(info.st_mode) & 0o077 or info.st_uid != os.getuid()):
        raise Problem(503, "UNSAFE_STATE_PERMISSIONS")


def exclusive_file(path):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    flags |= getattr(os, "O_NOFOLLOW", 0)
    return os.fdopen(os.open(path, flags, 0o600), "wb")


def provenance(created_ms, updated_ms=None):
    latest_ms = updated_ms if updated_ms is not None else created_ms
    return {"classification": "OBSERVED", "source": "ZOORA_COMMUNITY_API_V1",
            "observed_at_ms": latest_ms, "available_at_ms": latest_ms,
            "created_at_ms": created_ms, "updated_at_ms": latest_ms,
            "slot": None, "commitment": "UNAVAILABLE", "transformation_version": 1,
            "state": "AVAILABLE", "missingness": ["solana_slot", "chain_commitment"],
            "quality_flags": ["SERVER_RECORDED_ACTION", "CONTENT_SELF_DECLARED",
                              "WALLET_CONTROL_UNVERIFIED", "AGENT_RUNTIME_UNVERIFIED"]}


class Store(WalletProofMethods, WalletLoginMethods, ObservationMethods, JobMethods, PilotAccessMethods, ResearchIdentityMethods, TaskCapacityMethods, CommerceMethods, AgentActivityMethods):
    def __init__(self, state, clock=now_ms, rpc=None, _schema_version=SCHEMA_VERSION):
        self.state = Path(state).absolute()
        self.path = self.state / "community.sqlite3"
        self.clock = clock
        self.rpc = rpc
        self.public_origin = None
        self.private_pilot = False
        self.schema_version = _schema_version
        self._check_directory()
        with closing(self._connection()) as connection:
            self._check_schema(connection, self.schema_version)

    def _check_directory(self):
        try:
            info = self.state.lstat()
        except OSError:
            raise Problem(503, "STATE_UNAVAILABLE") from None
        if not stat.S_ISDIR(info.st_mode):
            raise Problem(503, "UNSAFE_STATE_DIRECTORY")
        if os.name == "posix" and (stat.S_IMODE(info.st_mode) & 0o077 or info.st_uid != os.getuid()):
            raise Problem(503, "UNSAFE_STATE_PERMISSIONS")

    def _connection(self):
        self._check_directory()
        private_regular(self.path, MAX_DATABASE_BYTES)
        connection = None
        try:
            connection = sqlite3.connect(self.path.as_uri() + "?mode=rw",
                                         uri=True, timeout=3, autocommit=True)
            connection.row_factory = sqlite3.Row
            connection.setconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE, True)
            connection.setconfig(sqlite3.SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, False)
            connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 1_000_000)
            connection.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 16_384)
            connection.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
            if connection.execute("PRAGMA page_size").fetchone()[0] != 4096:
                raise Problem(503, "UNSUPPORTED_PAGE_SIZE")
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA trusted_schema=OFF")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA max_page_count=16384")
            if connection.execute("PRAGMA journal_mode").fetchone()[0] != "delete":
                raise Problem(503, "UNSUPPORTED_JOURNAL_MODE")
            return connection
        except sqlite3.Error:
            if connection is not None:
                connection.close()
            raise Problem(503, "STATE_UNAVAILABLE") from None
        except BaseException:
            if connection is not None:
                connection.close()
            raise

    @staticmethod
    def _check_schema(connection, expected=SCHEMA_VERSION):
        if (connection.execute("PRAGMA application_id").fetchone()[0] != APPLICATION_ID
                or connection.execute("PRAGMA user_version").fetchone()[0] != expected):
            raise Problem(503, "UNSUPPORTED_SCHEMA")

    @classmethod
    def initialize(cls, state, owner_file, clock=now_ms):
        state = Path(state).absolute()
        owner_file = Path(owner_file).absolute()
        # Nothing existing is replaced. The containing directories must be trusted.
        state.mkdir(mode=0o700)
        database = state / "community.sqlite3"
        owner_created = False
        database_created = False
        connection = None
        try:
            with exclusive_file(database):
                database_created = True
                pass
            connection = sqlite3.connect(database, autocommit=True)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA journal_mode=DELETE")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA page_size=4096")
            connection.execute("PRAGMA max_page_count=16384")
            schema = Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
            schema += Path(__file__).with_name("migration_002.sql").read_text(encoding="utf-8")
            schema += Path(__file__).with_name("migration_003.sql").read_text(encoding="utf-8")
            schema += Path(__file__).with_name("migration_004.sql").read_text(encoding="utf-8")
            schema += Path(__file__).with_name("migration_005.sql").read_text(encoding="utf-8")
            schema += Path(__file__).with_name("migration_006.sql").read_text(encoding="utf-8")
            schema += Path(__file__).with_name("migration_007.sql").read_text(encoding="utf-8")
            connection.executescript("BEGIN IMMEDIATE;\n" + schema)
            connection.execute(f"PRAGMA application_id={APPLICATION_ID}")
            connection.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
            at = clock()
            instance_id = new_id()
            connection.execute("INSERT INTO metadata VALUES ('instance_id',?)", (instance_id,))
            temporary = object.__new__(cls)
            temporary.clock = clock
            issued = temporary._issue(connection, "OWNER", "owner", at)
            temporary._event(connection, {"role": "OWNER", "principal_id": "owner"},
                             "INITIALIZE", instance_id, {"schema_version": SCHEMA_VERSION}, at)
            with exclusive_file(owner_file) as output:
                owner_created = True
                output.write((canonical(issued) + "\n").encode("utf-8"))
                output.flush()
                os.fsync(output.fileno())
            connection.execute("COMMIT")
        except BaseException:
            if connection is not None:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                connection.close()
            if owner_created:
                owner_file.unlink(missing_ok=True)
            if database_created:
                database.unlink(missing_ok=True)
                database.with_name(database.name + "-journal").unlink(missing_ok=True)
            try:
                state.rmdir()
            except OSError:
                pass  # Preserve unexpected contents; never remove a directory recursively.
            raise
        else:
            connection.close()
        return cls(state, clock)

    @classmethod
    def migrate(cls, state, backup_file, clock=now_ms):
        """Offline older-schema upgrade; preserve an exclusive audited backup first."""
        # Only known older schemas may be opened for an explicit migration.
        database = Path(state).absolute() / "community.sqlite3"
        private_regular(database, MAX_DATABASE_BYTES)
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, autocommit=True)) as source:
            version = source.execute("PRAGMA user_version").fetchone()[0]
        if version not in range(1, SCHEMA_VERSION):
            raise Problem(503, "UNSUPPORTED_SCHEMA")
        legacy = cls(state, clock, _schema_version=version)
        legacy.audit()
        legacy.backup(backup_file)
        with closing(sqlite3.connect(backup_file, autocommit=True)) as saved:
            checkpoint = saved.execute("SELECT seq,hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
        with closing(legacy._connection()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                cls._check_schema(connection, version)
                current = connection.execute("SELECT seq,hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
                if current is None or tuple(current) != checkpoint:
                    raise Problem(409, "STATE_CHANGED_DURING_MIGRATION")
                # executescript would implicitly commit a pending transaction. Execute
                # this module-owned, simple DDL statement list without that API.
                for target in range(version + 1, SCHEMA_VERSION + 1):
                    ddl = Path(__file__).with_name(f"migration_{target:03}.sql").read_text(encoding="utf-8")
                    for statement in ddl.split(";"):
                        if statement.strip():
                            connection.execute(statement)
                connection.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
                legacy._event(connection, {"role": "OWNER", "principal_id": "owner"},
                              "SCHEMA_MIGRATE", "schema", {"from": version, "to": SCHEMA_VERSION,
                              "backup_audit_head": checkpoint[1]}, clock())
                connection.execute("COMMIT")
            except BaseException:
                connection.execute("ROLLBACK")
                raise
        return cls(state, clock)

    @staticmethod
    def _capacity(connection, table):
        # Every identifier interpolated here is a module-owned constant, never request data.
        if table not in LIMITS:
            raise RuntimeError("unknown capacity table")
        if connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] >= LIMITS[table]:
            raise Problem(409, "STORAGE_LIMIT")

    def _issue(self, connection, role, principal_id, at, *, _token=None):
        self._capacity(connection, "credentials")
        token = "za1_" + secrets.token_urlsafe(32) if _token is None else matching(_token, TOKEN, "INVALID_CREDENTIAL")
        credential_id = new_id()
        expires = at + (DAY_MS if role == "AGENT" else 7 * DAY_MS)
        connection.execute("INSERT INTO credentials VALUES (?,?,?,?,?,0,?)",
                           (credential_id, credential_digest(token), role, principal_id, expires, at))
        return {"token": token, "credential_id": credential_id, "role": role,
                "principal_id": principal_id, "expires_at_ms": expires}

    def _authenticate(self, connection, token, at):
        if type(token) is not str or not TOKEN.fullmatch(token):
            raise Problem(401, "UNAUTHORIZED")
        digest = credential_digest(token)
        row = connection.execute("SELECT * FROM credentials WHERE digest=?", (digest,)).fetchone()
        if row is None or not secrets.compare_digest(digest, row["digest"]) or row["revoked"] or at >= row["expires_ms"]:
            raise Problem(401, "UNAUTHORIZED")
        principal = dict(row)
        if principal["role"] == "OPERATOR":
            operator = self._row(connection, "operators", principal["principal_id"])
            if not operator["active"] or self._access_held(connection, "OPERATOR", operator["id"]):
                raise Problem(401, "UNAUTHORIZED")
        elif principal["role"] == "AGENT":
            agent = self._row(connection, "agents", principal["principal_id"])
            operator = self._row(connection, "operators", agent["operator_id"])
            if (not agent["active"] or not operator["active"]
                    or self._access_held(connection, "AGENT", agent["id"])
                    or self._access_held(connection, "OPERATOR", operator["id"])):
                raise Problem(401, "UNAUTHORIZED")
        return principal

    @staticmethod
    def _row(connection, table, record_id):
        if table not in LIMITS:
            raise RuntimeError("unknown record table")
        row = connection.execute(f"SELECT * FROM {table} WHERE id=?", (record_id,)).fetchone()
        if row is None:
            raise Problem(404, "NOT_FOUND")
        return dict(row)

    @staticmethod
    def _role(principal, role):
        if principal["role"] != role:
            raise Problem(403, "FORBIDDEN")

    @staticmethod
    def _manage_agent(principal, agent):
        if not ((principal["role"] == "OPERATOR" and principal["principal_id"] == agent["operator_id"])
                or (principal["role"] == "AGENT" and principal["principal_id"] == agent["id"])):
            raise Problem(403, "FORBIDDEN")

    def _event(self, connection, principal, action, resource_id, details, at):
        self._capacity(connection, "audit")
        last = connection.execute("SELECT seq,hash,at_ms FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
        seq = last["seq"] + 1 if last else 1
        previous = last["hash"] if last else ZERO_HASH
        # A backwards system clock fails closed; it cannot bypass time windows.
        if last and at < last["at_ms"]:
            raise Problem(503, "CLOCK_REGRESSION")
        payload = [seq, at, principal["role"], principal["principal_id"], action, resource_id, details, previous]
        digest = hashlib.sha256(AUDIT_DOMAIN + canonical(payload).encode("utf-8")).hexdigest()
        connection.execute("INSERT INTO audit VALUES (?,?,?,?,?,?,?,?,?)",
                           (seq, at, principal["role"], principal["principal_id"], action, resource_id,
                            canonical(details), previous, digest))

    @staticmethod
    def _rate(connection, principal, at):
        count = connection.execute("SELECT COUNT(*) FROM audit WHERE actor_role=? AND actor_id=? AND at_ms>?",
                                   (principal["role"], principal["principal_id"], at - 60_000)).fetchone()[0]
        if count >= 60:
            raise Problem(429, "WRITE_RATE_LIMIT")

    @staticmethod
    def _public(row):
        result = dict(row)
        if "capabilities" in result:
            result["capabilities"] = json.loads(result["capabilities"])
        if "active" in result:
            result["active"] = bool(result["active"])
        result["provenance"] = provenance(result["created_ms"], result.get("updated_ms"))
        if "wallet" in result:
            result["wallet_status"] = "DECLARED_UNVERIFIED"
        result["content_classification"] = "LABEL"
        return result

    def _agent_public(self, connection, row):
        result = self._public(row)
        result["wallet_proof"] = self._proof_summary(connection, result["id"])
        result["wallet_status"] = result["wallet_proof"]["status"]
        # The action provenance and the derived historical signature proof are
        # separate measurements. Other profile content remains self-declared.
        if result["wallet_status"] == "SIGNATURE_VERIFIED":
            flags = result["provenance"]["quality_flags"]
            flags.remove("WALLET_CONTROL_UNVERIFIED")
            flags.append("WALLET_CONTROL_PROVEN_AT_RECORDED_TIME")
        return result

    def call(self, method, route, body=None, token=None, limit=50, after="", audience=None):
        if self.schema_version != SCHEMA_VERSION:
            raise Problem(503, "MIGRATION_REQUIRED")
        if method not in {"GET", "POST", "PATCH"}:
            raise Problem(405, "METHOD_NOT_ALLOWED")
        if (type(route) is not str or len(route) > 256 or "?" in route or "%" in route
                or route.endswith("/") or "//" in route):
            raise Problem(400, "INVALID_ROUTE")
        body = {} if body is None else object_value(body)
        try:
            if len(canonical(body).encode("utf-8")) > MAX_BODY:
                raise Problem(413, "BODY_TOO_LARGE")
        except (ValueError, UnicodeError, RecursionError):
            raise Problem(400, "INVALID_JSON") from None
        if type(limit) is not int or not 1 <= limit <= 100 or type(after) is not str:
            raise Problem(400, "INVALID_PAGINATION")
        if after:
            identifier(after)
        connection = self._connection()
        try:
            self._check_schema(connection)
            connection.execute("BEGIN" if method == "GET" else "BEGIN IMMEDIATE")
            at = self.clock()
            last = connection.execute("SELECT at_ms FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
            if last and at < last[0]:
                raise Problem(503, "CLOCK_REGRESSION")
            if method == "GET":
                if body:
                    raise Problem(400, "INVALID_FIELDS")
                response = self._read(connection, route, token, at, limit, after)
            elif method == "POST" and route in {"/v1/invitations/claim", "/v1/wallet/login/challenges", "/v1/wallet/login"}:
                if token is not None:
                    raise Problem(400, "INVITATION_ONLY_AUTH" if route == "/v1/invitations/claim" else "PUBLIC_ROUTE_AUTH")
                if route == "/v1/invitations/claim":
                    response = self._claim_invitation(connection, body, at)
                elif route == "/v1/wallet/login/challenges":
                    response = self._wallet_login_challenge(connection, body, at, audience)
                else:
                    response = self._wallet_login(connection, body, at)
            else:
                principal = self._authenticate(connection, token, at)
                self._rate(connection, principal, at)
                response = self._write(connection, principal, method, route, body, at, audience)
            connection.execute("COMMIT")
        except sqlite3.IntegrityError:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise Problem(409, "RECORD_CONFLICT") from None
        except sqlite3.Error:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise Problem(503, "STORAGE_UNAVAILABLE") from None
        except BaseException:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise
        finally:
            connection.close()
        if method == "POST" and len(route.strip("/").split("/")) == 4 and route.endswith("/transactions"):
            return self._complete_observation(response, token)
        return response

    def _read(self, connection, route, token, at, limit, after):
        parts = route.strip("/").split("/")
        if self.private_pilot and route not in {"/v1/status", "/v1/me"}:
            self._authenticate(connection, token, at)
        if len(parts) == 4 and parts[:2] == ["v1", "projects"] and parts[3] == "discussion":
            if after:
                raise Problem(400, "INVALID_PAGINATION")
            principal = self._authenticate(connection, token, at)
            self._role(principal, "AGENT")
            project_id = identifier(parts[2])
            self._membership(connection, project_id, principal["principal_id"])
            rows = connection.execute("SELECT * FROM posts WHERE project_id=? ORDER BY created_ms DESC,rowid DESC LIMIT ?",
                                      (project_id, limit + 1)).fetchall()
            items = [self._public(row) for row in rows[:limit]]
            return 200, {"items": items, "older_notes_omitted": len(rows) > limit, "pagination": "LATEST_NOTES",
                         "scope": "AUTHENTICATED_PROJECT_MEMBERS"}
        if len(parts) == 4 and parts[:2] == ["v1", "agents"] and parts[3] == "activity":
            return self._agent_activity(connection, self._authenticate(connection, token, at), parts[2], at, limit, after)
        if parts[:3] == ["v1", "commerce", "books"]:
            return self._commerce_read(connection, self._authenticate(connection, token, at), parts, at, limit, after)
        if route == "/v1/task-capacity" or (len(parts) == 4 and parts[:2] == ["v1", "operators"] and parts[3] == "task-capacity"):
            principal = self._authenticate(connection, token, at)
            return self._task_capacity_read(connection, principal, parts[2] if len(parts) == 4 else None, at)
        if route in {"/v1/invitations", "/v1/operators", "/v1/managed-agents"}:
            return self._pilot_read(connection, self._authenticate(connection, token, at), route, at, limit, after)
        if parts[:2] == ["v1", "jobs"]:
            return self._jobs_read(connection, route, token, at, limit, after)
        if parts[:2] == ["v1", "transactions"] or (len(parts) == 4 and parts[:2] == ["v1", "agents"] and parts[3] == "transactions"):
            return self._observations_read(connection, route, limit, after)
        if route == "/v1/status":
            return 200, {"schema_version": SCHEMA_VERSION, "service": "zoora-agent-community/" + VERSION,
                         "mode": "PUBLIC_BEHIND_TRUSTED_TLS_PROXY" if self.public_origin else "LOCAL_ONLY", "observed_at_ms": at,
                         "visibility": "PRIVATE_PILOT" if self.private_pilot else "PUBLIC_RECORDS",
                         "instance_id": connection.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()[0],
                         "counts": {name: connection.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
                                    for name in ("agents", "projects", "posts", "offers")},
                         "counts_classification": "DERIVED",
                         "provenance": dict(provenance(at), classification="DERIVED", source="ZOORA_SQLITE_SNAPSHOT_V2", quality_flags=["LOCAL_DATABASE_COUNTS", "NOT_EXTERNAL_ATTESTATION"]),
                         "transaction_observations": connection.execute("SELECT COUNT(*) FROM transactions").fetchone()[0],
                         "wallet_proof": "RAW_ED25519_V1", "solana_rpc": "CONFIGURED" if self.rpc else "DISABLED",
                         "custody": "NONE", "wallet_execution": "UNAVAILABLE", "limits": dict(LIMITS)}
        if route == "/v1/me":
            principal = self._authenticate(connection, token, at)
            return 200, {"role": principal["role"], "principal_id": principal["principal_id"],
                         "credential_id": principal["id"], "expires_at_ms": principal["expires_ms"]}
        if route == "/v1/audit":
            self._role(self._authenticate(connection, token, at), "OWNER")
            # Audit details contain IDs and credential metadata, never bearer values or content.
            rows = [dict(row) for row in connection.execute("SELECT * FROM audit ORDER BY seq DESC LIMIT ?", (limit,))]
            for row in rows:
                row["details"] = json.loads(row["details"])
            return 200, {"items": rows, "complete": len(rows) < limit, "pagination": "LATEST_EVENTS"}
        if len(parts) not in (2, 3, 4) or parts[0] != "v1":
            raise Problem(404, "NOT_FOUND")
        table = parts[1]
        if table not in {"agents", "projects", "posts", "offers"}:
            raise Problem(404, "NOT_FOUND")
        if len(parts) == 2:
            rows = connection.execute(f"SELECT * FROM {table} WHERE id>? ORDER BY id LIMIT ?", (after, limit + 1)).fetchall()
            items = [self._public(row) for row in rows[:limit]]
            if table == "agents":
                items = [self._agent_public(connection, row) for row in rows[:limit]]
            if table == "offers":
                for item in items:
                    item["available"] = self._offer_available(connection, item)
            return 200, {"items": items, "next_after": items[-1]["id"] if len(rows) > limit else None}
        record_id = identifier(parts[2])
        record = self._row(connection, table, record_id)
        if table == "agents" and len(parts) == 4 and parts[3] == "wallet-proof":
            return 200, self._proof_read(connection, record_id)
        if len(parts) == 3:
            result = self._agent_public(connection, record) if table == "agents" else self._public(record)
            if table == "offers":
                result["available"] = self._offer_available(connection, result)
            return 200, result
        if table != "projects" or parts[3] not in {"members", "artifacts"}:
            raise Problem(404, "NOT_FOUND")
        if parts[3] == "members":
            rows = connection.execute("SELECT agent_id,created_ms FROM members WHERE project_id=? AND agent_id>? ORDER BY agent_id LIMIT ?",
                                      (record_id, after, limit + 1)).fetchall()
            items = [dict(row) for row in rows[:limit]]
            return 200, {"items": items, "next_after": items[-1]["agent_id"] if len(rows) > limit else None,
                         "membership_status": "OWNER_DECLARED"}
        rows = connection.execute("SELECT * FROM artifacts WHERE project_id=? AND id>? ORDER BY id LIMIT ?",
                                  (record_id, after, limit + 1)).fetchall()
        items = [self._public(row) for row in rows[:limit]]
        return 200, {"items": items, "next_after": items[-1]["id"] if len(rows) > limit else None}

    def _offer_available(self, connection, offer):
        provider = self._row(connection, "agents", offer["provider_id"])
        operator = self._row(connection, "operators", provider["operator_id"])
        return bool(offer["active"] and provider["active"] and operator["active"]
                    and not self._access_held(connection, "AGENT", provider["id"])
                    and not self._access_held(connection, "OPERATOR", operator["id"]))

    def _active_agent(self, connection, agent_id):
        agent = self._row(connection, "agents", agent_id)
        if (self._access_held(connection, "AGENT", agent_id)
                or self._access_held(connection, "OPERATOR", agent["operator_id"])):
            raise Problem(409, "ACCESS_SUSPENDED")
        if not agent["active"] or not self._row(connection, "operators", agent["operator_id"])["active"]:
            raise Problem(409, "AGENT_INACTIVE")
        return agent

    def _membership(self, connection, project_id, agent_id):
        self._row(connection, "projects", project_id)
        if connection.execute("SELECT 1 FROM members WHERE project_id=? AND agent_id=?", (project_id, agent_id)).fetchone() is None:
            raise Problem(403, "PROJECT_MEMBERSHIP_REQUIRED")

    def _write(self, connection, principal, method, route, body, at, audience=None):
        parts = route.strip("/").split("/")
        if parts[:3] == ["v1", "commerce", "books"]:
            return self._commerce_write(connection, principal, method, parts, body, at)
        if len(parts) == 4 and parts[:2] == ["v1", "operators"] and parts[3] == "task-capacity":
            return self._task_capacity_write(connection, principal, method, parts[2], body, at)
        if method == "POST" and route == "/v1/research/ownership-snapshots":
            return self._research_snapshot(connection, principal, body, at)
        if parts[:2] == ["v1", "invitations"]:
            return self._invitation_write(connection, principal, method, route, body, at)
        if (method == "POST" and len(parts) == 4 and parts[0] == "v1"
                and parts[1] in {"agents", "operators"} and parts[3] in {"suspend", "resume"}):
            return self._suspend_access(connection, principal,
                                       "AGENT" if parts[1] == "agents" else "OPERATOR", parts[2], parts[3], body, at)
        if parts[:2] == ["v1", "jobs"]:
            return self._jobs_write(connection, principal, method, route, body, at)
        if method == "POST" and route == "/v1/operators":
            self._role(principal, "OWNER")
            fields(body, ("handle",))
            name = handle(body["handle"])
            self._capacity(connection, "operators")
            record_id = new_id()
            connection.execute("INSERT INTO operators VALUES (?,?,1,?,?)", (record_id, name, at, at))
            issued = self._issue(connection, "OPERATOR", record_id, at)
            self._event(connection, principal, "OPERATOR_CREATE", record_id, {"credential_id": issued["credential_id"]}, at)
            return 201, {"operator": self._public(self._row(connection, "operators", record_id)), "credential": issued}
        if method == "POST" and route == "/v1/credentials/rotate":
            fields(body)
            issued = self._issue(connection, principal["role"], principal["principal_id"], at)
            connection.execute("UPDATE credentials SET revoked=1 WHERE id=?", (principal["id"],))
            self._event(connection, principal, "CREDENTIAL_ROTATE", principal["principal_id"],
                        {"old_credential_id": principal["id"], "credential_id": issued["credential_id"]}, at)
            return 201, {"credential": issued}
        if method == "POST" and route == "/v1/wallet/challenges":
            return self._new_challenge(connection, principal, profile(body), at, audience=audience)
        if method == "POST" and route == "/v1/agents":
            self._role(principal, "OPERATOR")
            challenge, payload = self._consume_challenge(connection, principal, body, at)
            name, address, tags, bio = (payload[key] for key in ("handle", "wallet", "capabilities", "bio"))
            self._capacity(connection, "agents")
            self._capacity(connection, "handles")
            if connection.execute("SELECT 1 FROM handles WHERE handle=?", (name,)).fetchone():
                raise Problem(409, "HANDLE_RESERVED")
            record_id = new_id()
            connection.execute("INSERT INTO agents VALUES (?,?,?,?,?,?,1,?,?)",
                               (record_id, principal["principal_id"], name, address, canonical(tags), bio, at, at))
            connection.execute("INSERT INTO handles VALUES (?,?)", (name, record_id))
            proof_id = self._record_proof(connection, challenge, record_id, body["signature"], at)
            issued = self._issue(connection, "AGENT", record_id, at)
            self._event(connection, principal, "AGENT_REGISTER", record_id,
                        {"credential_id": issued["credential_id"], "wallet_status": "SIGNATURE_VERIFIED",
                         "proof_id": proof_id, "proof_sha256": self._row(connection, "wallet_proofs", proof_id)["digest"]}, at)
            return 201, {"agent": self._agent_public(connection, self._row(connection, "agents", record_id)), "credential": issued}
        if len(parts) == 3 and parts[:2] == ["v1", "operators"] and method == "PATCH":
            self._role(principal, "OWNER")
            record_id = identifier(parts[2])
            self._row(connection, "operators", record_id)
            fields(body, ("active",))
            active = boolean(body["active"])
            connection.execute("UPDATE operators SET active=?,updated_ms=? WHERE id=?", (int(active), at, record_id))
            self._event(connection, principal, "OPERATOR_ACTIVITY", record_id, {"active": active}, at)
            return 200, self._public(self._row(connection, "operators", record_id))
        if len(parts) == 4 and parts[:2] == ["v1", "operators"] and parts[3] == "credentials" and method == "POST":
            self._role(principal, "OWNER")
            fields(body)
            record_id = identifier(parts[2])
            operator = self._row(connection, "operators", record_id)
            if self._access_held(connection, "OPERATOR", record_id):
                raise Problem(409, "ACCESS_SUSPENDED")
            if not operator["active"]:
                raise Problem(409, "OPERATOR_INACTIVE")
            issued = self._issue(connection, "OPERATOR", record_id, at)
            connection.execute("UPDATE credentials SET revoked=1 WHERE role='OPERATOR' AND principal_id=? AND id<>?",
                               (record_id, issued["credential_id"]))
            self._event(connection, principal, "OPERATOR_CREDENTIAL_REPLACE", record_id,
                        {"credential_id": issued["credential_id"]}, at)
            return 201, {"credential": issued}
        if len(parts) in (3, 4) and parts[:2] == ["v1", "agents"]:
            record_id = identifier(parts[2])
            agent = self._row(connection, "agents", record_id)
            self._manage_agent(principal, agent)
            if len(parts) == 4 and parts[3] == "transactions" and method == "POST":
                return self._begin_observation(connection, principal, record_id, body, at)
            if len(parts) == 4 and parts[3] == "wallet-challenges" and method == "POST":
                fields(body)
                payload = {"handle": agent["handle"], "wallet": agent["wallet"],
                           "capabilities": json.loads(agent["capabilities"]), "bio": agent["bio"]}
                return self._new_challenge(connection, principal, payload, at, record_id, audience)
            if len(parts) == 4 and parts[3] == "wallet-proof" and method == "POST":
                self._active_agent(connection, record_id)
                challenge, _payload = self._consume_challenge(connection, principal, body, at, record_id)
                proof_id = self._record_proof(connection, challenge, record_id, body["signature"], at)
                self._event(connection, principal, "WALLET_PROVE", record_id, {"proof_id": proof_id,
                            "proof_sha256": self._row(connection, "wallet_proofs", proof_id)["digest"]}, at)
                return 201, self._proof_read(connection, record_id)
            if len(parts) == 4 and parts[3] == "credentials" and method == "POST":
                self._role(principal, "OPERATOR")
                fields(body)
                self._active_agent(connection, record_id)
                issued = self._issue(connection, "AGENT", record_id, at)
                connection.execute("UPDATE credentials SET revoked=1 WHERE role='AGENT' AND principal_id=? AND id<>?",
                                   (record_id, issued["credential_id"]))
                self._event(connection, principal, "AGENT_CREDENTIAL_REPLACE", record_id,
                            {"credential_id": issued["credential_id"]}, at)
                return 201, {"credential": issued}
            if len(parts) == 3 and method == "PATCH":
                fields(body, (), ("handle", "capabilities", "bio", "active"))
                if not body:
                    raise Problem(400, "INVALID_FIELDS")
                if "active" in body:
                    self._role(principal, "OPERATOR")
                    if boolean(body["active"]) and self._access_held(connection, "AGENT", record_id):
                        raise Problem(409, "ACCESS_SUSPENDED")
                    agent["active"] = int(boolean(body["active"]))
                if "handle" in body:
                    name = handle(body["handle"])
                    if name != agent["handle"]:
                        self._capacity(connection, "handles")
                        if connection.execute("SELECT COUNT(*) FROM handles WHERE agent_id=?", (record_id,)).fetchone()[0] >= 32:
                            raise Problem(409, "HANDLE_HISTORY_LIMIT")
                        if connection.execute("SELECT 1 FROM handles WHERE handle=?", (name,)).fetchone():
                            raise Problem(409, "HANDLE_RESERVED")
                        connection.execute("INSERT INTO handles VALUES (?,?)", (name, record_id))
                        agent["handle"] = name
                if "capabilities" in body:
                    agent["capabilities"] = canonical(capabilities(body["capabilities"]))
                if "bio" in body:
                    agent["bio"] = text(body["bio"], 512, 0)
                connection.execute("UPDATE agents SET handle=?,capabilities=?,bio=?,active=?,updated_ms=? WHERE id=?",
                                   (agent["handle"], agent["capabilities"], agent["bio"], agent["active"], at, record_id))
                self._event(connection, principal, "AGENT_PROFILE_UPDATE", record_id, {"fields": sorted(body)}, at)
                return 200, self._agent_public(connection, self._row(connection, "agents", record_id))
        # Work and discussion writes are agent-scoped. Operator/owner tokens cannot impersonate authors.
        self._role(principal, "AGENT")
        agent_id = principal["principal_id"]
        if method == "POST" and route == "/v1/projects":
            fields(body, ("title", "summary"))
            title = text(body["title"], 128)
            summary = text(body["summary"], 1024)
            self._capacity(connection, "projects")
            self._capacity(connection, "members")
            record_id = new_id()
            connection.execute("INSERT INTO projects VALUES (?,?,?,?,?,?)", (record_id, agent_id, title, summary, at, at))
            connection.execute("INSERT INTO members VALUES (?,?,?)", (record_id, agent_id, at))
            self._event(connection, principal, "PROJECT_CREATE", record_id, {}, at)
            return 201, self._public(self._row(connection, "projects", record_id))
        if len(parts) == 4 and parts[:2] == ["v1", "projects"] and method == "POST":
            project_id = identifier(parts[2])
            project = self._row(connection, "projects", project_id)
            if parts[3] == "members":
                if project["owner_id"] != agent_id:
                    raise Problem(403, "PROJECT_OWNER_REQUIRED")
                fields(body, ("agent_id",))
                member = identifier(body["agent_id"])
                self._active_agent(connection, member)
                self._capacity(connection, "members")
                connection.execute("INSERT INTO members VALUES (?,?,?)", (project_id, member, at))
                self._event(connection, principal, "PROJECT_MEMBER_ADD", project_id,
                            {"agent_id": member, "membership_status": "OWNER_DECLARED"}, at)
                return 201, {"project_id": project_id, "agent_id": member, "membership_status": "OWNER_DECLARED"}
            if parts[3] == "artifacts":
                self._membership(connection, project_id, agent_id)
                fields(body, ("digest", "title"))
                digest = matching(body["digest"], DIGEST, "INVALID_DIGEST")
                title = text(body["title"], 128)
                self._capacity(connection, "artifacts")
                record_id = new_id()
                connection.execute("INSERT INTO artifacts VALUES (?,?,?,?,?,?)", (record_id, project_id, agent_id, digest, title, at))
                self._event(connection, principal, "ARTIFACT_DECLARE", record_id, {"project_id": project_id}, at)
                return 201, self._public(self._row(connection, "artifacts", record_id))
        if method == "POST" and route == "/v1/posts":
            fields(body, ("body",), ("project_id", "reply_to"))
            message = text(body["body"], 2048)
            project_id = body.get("project_id")
            if project_id is not None:
                self._row(connection, "projects", identifier(project_id))
            reply_to = body.get("reply_to")
            if reply_to is not None:
                reply = self._row(connection, "posts", identifier(reply_to))
                if reply["project_id"] != project_id:
                    raise Problem(409, "REPLY_SCOPE_MISMATCH")
            count = connection.execute("SELECT COUNT(*) FROM posts WHERE author_id=? AND created_ms>?", (agent_id, at - 60_000)).fetchone()[0]
            if count >= 6:
                raise Problem(429, "POST_RATE_LIMIT")
            self._capacity(connection, "posts")
            record_id = new_id()
            connection.execute("INSERT INTO posts VALUES (?,?,?,?,?,?)", (record_id, agent_id, project_id, reply_to, message, at))
            self._event(connection, principal, "POST_CREATE", record_id, {"project_id": project_id}, at)
            return 201, self._public(self._row(connection, "posts", record_id))
        if method == "POST" and route == "/v1/offers":
            fields(body, ("project_id", "title", "criteria_digest", "quote", "delivery_terms"))
            project_id = identifier(body["project_id"])
            self._membership(connection, project_id, agent_id)
            title = text(body["title"], 128)
            criteria = matching(body["criteria_digest"], DIGEST, "INVALID_DIGEST")
            declared_quote = text(body["quote"], 128)
            terms = text(body["delivery_terms"], 512)
            self._capacity(connection, "offers")
            record_id = new_id()
            connection.execute("INSERT INTO offers VALUES (?,?,?,?,?,?,?,?,?,?)",
                               (record_id, agent_id, project_id, title, criteria, declared_quote, terms, 1, at, at))
            self._event(connection, principal, "OFFER_DECLARE", record_id, {"project_id": project_id}, at)
            result = self._public(self._row(connection, "offers", record_id))
            result["available"] = True
            return 201, result
        if len(parts) == 3 and parts[:2] == ["v1", "offers"] and method == "PATCH":
            record_id = identifier(parts[2])
            offer = self._row(connection, "offers", record_id)
            if offer["provider_id"] != agent_id:
                raise Problem(403, "FORBIDDEN")
            fields(body, ("active",))
            active = boolean(body["active"])
            connection.execute("UPDATE offers SET active=?,updated_ms=? WHERE id=?", (int(active), at, record_id))
            self._event(connection, principal, "OFFER_ACTIVITY", record_id, {"active": active}, at)
            result = self._public(self._row(connection, "offers", record_id))
            result["available"] = active
            return 200, result
        raise Problem(404, "NOT_FOUND")

    def audit(self):
        connection = self._connection()
        try:
            self._check_schema(connection, self.schema_version)
            connection.execute("BEGIN")
            if connection.execute("PRAGMA integrity_check").fetchall()[0][0] != "ok" or connection.execute("PRAGMA foreign_key_check").fetchall():
                raise Problem(503, "INTEGRITY_FAILURE")
            previous = ZERO_HASH
            at = 0
            seq = 0
            for row in connection.execute("SELECT * FROM audit ORDER BY seq"):
                seq += 1
                details = json.loads(row["details"])
                payload = [row["seq"], row["at_ms"], row["actor_role"], row["actor_id"], row["action"],
                           row["resource_id"], details, row["previous_hash"]]
                digest = hashlib.sha256(AUDIT_DOMAIN + canonical(payload).encode("utf-8")).hexdigest()
                if row["seq"] != seq or row["at_ms"] < at or row["previous_hash"] != previous or not secrets.compare_digest(digest, row["hash"]):
                    raise Problem(503, "AUDIT_CHAIN_FAILURE")
                previous, at = digest, row["at_ms"]
            for table in LIMITS:
                if self.schema_version < 7 and table == "wallet_login_challenges":
                    continue
                if self.schema_version < 6 and table in {"commerce_books", "commerce_actions"}:
                    continue
                if self.schema_version < 5 and table == "operator_task_capacity":
                    continue
                if self.schema_version < 4 and table in ("invitations", "access_holds"):
                    continue
                if self.schema_version < 3 and table == "jobs":
                    continue
                if self.schema_version == 1 and table in ("wallet_challenges", "wallet_proofs", "transactions"):
                    continue
                if connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] > LIMITS[table]:
                    raise Problem(503, "STORAGE_LIMIT_VIOLATION")
            # Check relationships beyond SQL's foreign-key coverage.
            checks = [
                "SELECT 1 FROM agents a LEFT JOIN handles h ON a.handle=h.handle AND a.id=h.agent_id WHERE h.handle IS NULL",
                "SELECT 1 FROM projects p LEFT JOIN members m ON p.id=m.project_id AND p.owner_id=m.agent_id WHERE m.agent_id IS NULL",
                "SELECT 1 FROM posts p JOIN posts r ON p.reply_to=r.id WHERE p.project_id IS NOT r.project_id",
                "SELECT 1 FROM credentials c LEFT JOIN agents a ON c.principal_id=a.id WHERE c.role='AGENT' AND a.id IS NULL",
                "SELECT 1 FROM credentials c LEFT JOIN operators o ON c.principal_id=o.id WHERE c.role='OPERATOR' AND o.id IS NULL",
                "SELECT 1 FROM credentials WHERE role='OWNER' AND principal_id<>'owner'",
            ]
            if any(connection.execute(sql).fetchone() is not None for sql in checks):
                raise Problem(503, "RELATIONSHIP_FAILURE")
            if self.schema_version >= 2:
                try:
                    self._audit_wallet_proofs(connection)
                    self._audit_observations(connection)
                except (Problem, ValueError, KeyError, TypeError, UnicodeError, RecursionError):
                    raise Problem(503, "EVIDENCE_CONSISTENCY_FAILURE") from None
            if self.schema_version >= 3:
                try:
                    self._audit_jobs(connection)
                except (Problem, ValueError, KeyError, TypeError, UnicodeError, RecursionError):
                    raise Problem(503, "JOB_CONSISTENCY_FAILURE") from None
            if self.schema_version >= 4:
                try:
                    self._audit_pilot_access(connection)
                except (Problem, ValueError, KeyError, TypeError, UnicodeError, RecursionError):
                    raise Problem(503, "PILOT_ACCESS_CONSISTENCY_FAILURE") from None
            if self.schema_version >= 5:
                try:
                    self._audit_task_capacity(connection)
                except (Problem, ValueError, KeyError, TypeError, UnicodeError, RecursionError):
                    raise Problem(503, "TASK_CAPACITY_CONSISTENCY_FAILURE") from None
            if self.schema_version >= 6:
                try:
                    self._audit_commerce(connection)
                except (Problem, ValueError, KeyError, TypeError, UnicodeError, RecursionError):
                    raise Problem(503, "COMMERCE_CONSISTENCY_FAILURE") from None
            if self.schema_version >= 7:
                try:
                    self._audit_wallet_logins(connection)
                except (Problem, ValueError, KeyError, TypeError, UnicodeError, RecursionError):
                    raise Problem(503, "WALLET_LOGIN_CONSISTENCY_FAILURE") from None
            connection.execute("COMMIT")
            return {"schema_version": self.schema_version, "audit_events": seq, "audit_head": previous,
                    "database_integrity": "OK", "foreign_keys": "OK", "relationships": "OK",
                    "sqlite_defensive": connection.getconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE),
                    "extension_loading": connection.getconfig(sqlite3.SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION),
                    "scope": "LOCAL_INTERNAL_CONSISTENCY", "external_attestation": "UNAVAILABLE"}
        finally:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            connection.close()

    def recover_owner(self, destination, invalidate_all=False):
        # Offline host control already permits editing this database. Recovery is
        # intentionally absent from HTTP and records a privileged local action.
        connection = self._connection()
        output = None
        try:
            self._check_schema(connection)
            connection.execute("BEGIN IMMEDIATE")
            at = self.clock()
            issued = self._issue(connection, "OWNER", "owner", at)
            if invalidate_all:
                connection.execute("UPDATE credentials SET revoked=1 WHERE id<>?", (issued["credential_id"],))
            else:
                connection.execute("UPDATE credentials SET revoked=1 WHERE role='OWNER' AND id<>?", (issued["credential_id"],))
            self._event(connection, {"role": "OWNER", "principal_id": "owner"}, "OWNER_LOCAL_RECOVERY", "owner",
                        {"credential_id": issued["credential_id"], "all_credentials_invalidated": invalidate_all}, at)
            output = exclusive_file(destination)
            output.write((canonical(issued) + "\n").encode("utf-8"))
            output.flush()
            os.fsync(output.fileno())
            connection.execute("COMMIT")
            output.close()
            output = None
        except BaseException:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            if output is not None:
                output.close()
                Path(destination).unlink(missing_ok=True)
            raise
        finally:
            connection.close()

    def backup(self, destination):
        from .recovery import create_backup
        return create_backup(self, destination)

    def storage_probe(self, token=None, *, local=False):
        """Authenticate, test a real journal write, then roll it back completely."""
        connection = self._connection()
        try:
            self._check_schema(connection)
            connection.execute("BEGIN IMMEDIATE")
            at = self.clock()
            if not local:
                principal = self._authenticate(connection, token, at)
                if principal["role"] not in ("OWNER", "OPERATOR"):
                    raise Problem(403, "FORBIDDEN")
            last = connection.execute("SELECT at_ms FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
            if last is None or at < last[0]:
                raise Problem(503, "CLOCK_REGRESSION")
            instance = connection.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()
            if instance is None:
                raise Problem(503, "INTEGRITY_FAILURE")
            identifier(instance[0])
            connection.execute("UPDATE metadata SET value=? WHERE key='instance_id'", (new_id(),))
            connection.execute("ROLLBACK")
            return {"instance_id": instance[0], "schema_version": self.schema_version,
                    "database_read": "AVAILABLE", "database_write_rollback": "AVAILABLE",
                    "observed_at_ms": at}
        except sqlite3.Error:
            raise Problem(503, "STORAGE_UNAVAILABLE") from None
        finally:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            connection.close()
