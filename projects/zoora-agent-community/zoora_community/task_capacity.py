"""Owner-selected local queue allowance shared by an operator's known agents.

This is resource admission, not earned trust, payment accounting or proof that
separate operator accounts belong to separate people.
"""

import json

from .jobs import ACTIVE, GLOBAL_PENDING, PER_AGENT_PENDING, bounded
from .validation import Problem, fields, identifier, text


def capacity_value(body):
    fields(body, ("expected_revision", "max_pending", "reason"))
    revision = bounded(body["expected_revision"], 0, 49999, "INVALID_CAPACITY_REVISION")
    maximum = body["max_pending"]
    if maximum is not None:
        bounded(maximum, 0, GLOBAL_PENDING, "INVALID_TASK_CAPACITY")
    return revision, maximum, text(body["reason"], 512)


class TaskCapacityMethods:
    def _task_operator(self, connection, principal, operator_id=None):
        if operator_id is None:
            if principal["role"] == "OWNER":
                raise Problem(400, "OPERATOR_ID_REQUIRED")
            operator_id = (principal["principal_id"] if principal["role"] == "OPERATOR" else
                           self._row(connection, "agents", principal["principal_id"])["operator_id"])
        else:
            operator_id = identifier(operator_id)
        if principal["role"] != "OWNER":
            own = (principal["principal_id"] if principal["role"] == "OPERATOR" else
                   self._row(connection, "agents", principal["principal_id"])["operator_id"])
            if own != operator_id:
                raise Problem(403, "FORBIDDEN")
        self._row(connection, "operators", operator_id)
        return operator_id

    def _task_capacity_view(self, connection, operator_id, at, agent_id=None):
        policy = connection.execute("SELECT * FROM operator_task_capacity WHERE operator_id=?",
                                    (operator_id,)).fetchone()
        pending = agent_pending = 0
        for row in connection.execute("SELECT j.* FROM jobs j JOIN agents a ON a.id=j.agent_id "
                                      "WHERE a.operator_id=? AND j.state IN ('QUEUED','RUNNING')", (operator_id,)):
            if self._job_effective(connection, row, at)[0] in ACTIVE:
                pending += 1
                agent_pending += row["agent_id"] == agent_id
        maximum = policy["max_pending"] if policy else None
        ceiling = GLOBAL_PENDING if maximum is None else maximum
        return {"operator_id": operator_id, "max_pending": maximum,
                "revision": policy["revision"] if policy else 0,
                "reason": policy["reason"] if policy else None,
                "pending": pending, "agent_pending": agent_pending if agent_id else None,
                "remaining_operator_allowance": max(0, ceiling - pending),
                "over_limit": pending > ceiling,
                "policy_source": "OWNER_CONFIGURED" if maximum is not None else "PLATFORM_ONLY",
                "per_agent_pending_limit": PER_AGENT_PENDING, "global_pending_limit": GLOBAL_PENDING,
                "counted_states": ["QUEUED", "RUNNING"], "observed_at_ms": at,
                "scope": "PRIVATE_OPERATOR_TASK_CAPACITY", "classification": "DERIVED",
                "trust_verification": "UNAVAILABLE", "wallet_execution": "UNAVAILABLE"}

    def _task_capacity_read(self, connection, principal, operator_id, at):
        operator_id = self._task_operator(connection, principal, operator_id)
        agent_id = principal["principal_id"] if principal["role"] == "AGENT" else None
        return 200, self._task_capacity_view(connection, operator_id, at, agent_id)

    def _task_capacity_write(self, connection, principal, method, operator_id, body, at):
        self._role(principal, "OWNER")
        if method != "PATCH":
            raise Problem(405, "METHOD_NOT_ALLOWED")
        operator_id = self._task_operator(connection, principal, operator_id)
        revision, maximum, reason = capacity_value(body)
        old = connection.execute("SELECT * FROM operator_task_capacity WHERE operator_id=?", (operator_id,)).fetchone()
        if revision != (old["revision"] if old else 0):
            raise Problem(409, "TASK_CAPACITY_CONFLICT")
        if old and (old["max_pending"], old["reason"]) == (maximum, reason):
            return 200, {"capacity": self._task_capacity_view(connection, operator_id, at), "changed": False}
        if old is None:
            self._capacity(connection, "operator_task_capacity")
        connection.execute("INSERT INTO operator_task_capacity VALUES (?,?,?,?,?,?) "
                           "ON CONFLICT(operator_id) DO UPDATE SET max_pending=excluded.max_pending,"
                           "revision=excluded.revision,reason=excluded.reason,updated_ms=excluded.updated_ms",
                           (operator_id, maximum, revision + 1, reason, at, at))
        self._event(connection, principal, "OPERATOR_TASK_CAPACITY_SET", operator_id,
                    {"from_revision": revision, "revision": revision + 1, "max_pending": maximum, "reason": reason}, at)
        return 200, {"capacity": self._task_capacity_view(connection, operator_id, at), "changed": True}

    def _task_admission(self, connection, agent_id, at):
        # The caller holds BEGIN IMMEDIATE: policy changes and submissions across
        # processes cannot race a read of this shared allowance.
        operator_id = self._row(connection, "agents", agent_id)["operator_id"]
        view = self._task_capacity_view(connection, operator_id, at)
        if view["max_pending"] is not None and view["pending"] >= view["max_pending"]:
            raise Problem(409, "OPERATOR_TASK_LIMIT")
        return {"operator_id": operator_id, "revision": view["revision"],
                "max_pending": view["max_pending"], "pending_before": view["pending"]}

    def _audit_task_capacity(self, connection):
        policies = {}
        enabled = False
        events = connection.execute("SELECT * FROM audit WHERE action IN "
                                    "('INITIALIZE','SCHEMA_MIGRATE','OPERATOR_TASK_CAPACITY_SET','JOB_SUBMIT') ORDER BY seq")
        for event in events:
            detail = json.loads(event["details"])
            if event["action"] in {"INITIALIZE", "SCHEMA_MIGRATE"}:
                if detail.get("schema_version", detail.get("to", 0)) >= 5:
                    enabled = True
                continue
            if event["action"] == "OPERATOR_TASK_CAPACITY_SET":
                if not enabled or event["actor_role"] != "OWNER" or event["actor_id"] != "owner":
                    raise ValueError("invalid capacity controller")
                fields(detail, ("from_revision", "revision", "max_pending", "reason"))
                previous, maximum, reason = capacity_value({"expected_revision": detail["from_revision"],
                                                           "max_pending": detail["max_pending"], "reason": detail["reason"]})
                operator_id = identifier(event["resource_id"])
                self._row(connection, "operators", operator_id)
                old = policies.get(operator_id)
                if (type(detail["revision"]) is not int or detail["revision"] != previous + 1
                        or previous != (old["revision"] if old else 0)):
                    raise ValueError("capacity revision history")
                policies[operator_id] = {"operator_id": operator_id, "max_pending": maximum,
                                         "revision": previous + 1, "reason": reason,
                                         "created_ms": old["created_ms"] if old else event["at_ms"],
                                         "updated_ms": event["at_ms"]}
            elif enabled:
                admission = detail["operator_task_capacity"]
                fields(admission, ("operator_id", "revision", "max_pending", "pending_before"))
                job = self._row(connection, "jobs", event["resource_id"])
                operator_id = self._row(connection, "agents", job["agent_id"])["operator_id"]
                policy = policies.get(operator_id)
                if (admission["operator_id"] != operator_id or type(admission["revision"]) is not int
                        or admission["revision"] != (policy["revision"] if policy else 0)
                        or type(admission["max_pending"]) is not type(policy["max_pending"] if policy else None)
                        or admission["max_pending"] != (policy["max_pending"] if policy else None)):
                    raise ValueError("admission policy mismatch")
                pending = bounded(admission["pending_before"], 0, GLOBAL_PENDING - 1, "INVALID_TASK_CAPACITY")
                if admission["max_pending"] is not None and pending >= admission["max_pending"]:
                    raise ValueError("admission above configured limit")
        if not enabled:
            raise ValueError("capacity schema checkpoint missing")
        rows = {row["operator_id"]: dict(row) for row in connection.execute("SELECT * FROM operator_task_capacity")}
        if rows != policies:
            raise ValueError("capacity records differ from audit history")
