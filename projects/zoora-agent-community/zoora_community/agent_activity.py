"""Private read-only projection of recorded work, worker check-ins and chain evidence.

No generated activity, external RPC calls, inferred income or continuous-runtime
claim. Host check-ins show contact with an authorized claimant, not model progress.
"""

import json

from .jobs import SIGNAL_FRESH_MS, latest_signal
from .validation import Problem, identifier

JOB_EVENTS = ("JOB_SUBMIT", "JOB_CLAIM", "JOB_HEARTBEAT", "JOB_STOP", "JOB_RETIRE", "JOB_COMPLETE")
STATES = ("QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED", "EXPIRED")


class AgentActivityMethods:
    def _agent_activity(self, connection, principal, agent_id, at, limit, after):
        if after:
            raise Problem(400, "INVALID_PAGINATION")
        agent = self._row(connection, "agents", identifier(agent_id))
        if principal["role"] != "OWNER":
            self._manage_agent(principal, agent)
        operator = self._row(connection, "operators", agent["operator_id"])
        enabled = bool(agent["active"] and operator["active"]
                       and not self._access_held(connection, "AGENT", agent["id"])
                       and not self._access_held(connection, "OPERATOR", operator["id"]))
        jobs = connection.execute("SELECT * FROM jobs WHERE agent_id=? ORDER BY created_ms DESC,id DESC",
                                  (agent_id,)).fetchall()
        counts = dict.fromkeys(STATES, 0)
        active, recent, last_seen = [], [], None
        for row in jobs:
            state, error = self._job_effective(connection, row, at)
            counts[state] += 1
            signal = latest_signal(connection, row["id"])
            if signal is not None:
                last_seen = max(last_seen or 0, signal["received_at_ms"])
            if state == "RUNNING":
                active.append((row, signal))
            if len(recent) < min(limit, 20):
                recent.append({**{key: row[key] for key in ("id", "title", "created_ms", "updated_ms",
                    "lease_expires_ms", "report_sha256", "artifact_id")}, "state": state,
                    "error_code": error, "stop_requested": bool(row["stop_requested"])})
        fresh = any(signal is not None and 0 <= at - signal["received_at_ms"] < SIGNAL_FRESH_MS
                    for _, signal in active)
        runtime = "IDLE"
        if counts["QUEUED"]:
            runtime = "WAITING_FOR_WORKER"
        if active:
            runtime = "WORKER_SEEN" if fresh else "RUNNING_UNCONFIRMED"
        if any(row["stop_requested"] for row, _ in active):
            runtime = "STOP_REQUESTED"
        if not enabled:
            runtime = "SUSPENDED"
        placeholders = ",".join("?" for _ in JOB_EVENTS)
        events = connection.execute("SELECT a.* FROM audit a JOIN jobs j ON j.id=a.resource_id "
            "WHERE j.agent_id=? AND a.action IN (" + placeholders + ") ORDER BY a.seq DESC LIMIT ?",
            (agent_id, *JOB_EVENTS, min(limit, 20))).fetchall()
        history = []
        for event in events:
            details = json.loads(event["details"])
            history.append({"audit_sequence": event["seq"], "at_ms": event["at_ms"],
                "action": event["action"], "job_id": event["resource_id"],
                **{key: details[key] for key in ("state", "error_code", "report_sha256", "sequence") if key in details}})
        observations = []
        for row in connection.execute("SELECT * FROM transactions WHERE agent_id=? ORDER BY updated_ms DESC,id DESC LIMIT 5", (agent_id,)):
            report = json.loads(row["report"])
            observations.append({"id": row["id"], "recorded_at_ms": row["updated_ms"],
                **{key: report.get(key) for key in ("network", "signature", "state", "slot", "commitment",
                    "observed_at_ms", "available_at_ms", "execution", "related_to_agent", "source")}})
        return 200, {"scope": "PRIVATE_AGENT_ACTIVITY", "observed_at_ms": at,
            "instance_id": connection.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()[0],
            "feed": {"state": "AVAILABLE", "poll_after_ms": 10_000, "fresh_for_ms": SIGNAL_FRESH_MS},
            "agent": {"id": agent_id, "handle": agent["handle"], "wallet": agent["wallet"], "access_active": enabled},
            "wallet_proof": self._proof_summary(connection, agent_id),
            "runtime": {"state": runtime, "counts": counts, "last_signal_at_ms": last_seen,
                "signal_age_ms": at - last_seen if last_seen is not None else None,
                "signal_fresh_for_ms": SIGNAL_FRESH_MS, "classification": "HOST_REPORTED_CHECK_IN",
                "continuous_runtime_verified": False, "check_ins_extend_lease": False},
            "jobs": recent, "events": history,
            "blockchain": {"work_storage": "SERVICE_DATABASE", "agent_execution": "HOST_WORKER",
                "rpc": "CONFIGURED" if self.rpc else "DISABLED", "rpc_health_checked": False,
                "observations": observations, "observations_are_historical": True,
                "membership": "NOT_CONFIGURED", "wallet_execution": "UNAVAILABLE"}}
