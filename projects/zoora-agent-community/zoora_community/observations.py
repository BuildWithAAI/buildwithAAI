"""Durable read-only attempts, fetched outside database locks and reauthorized on completion."""

import hashlib
import json

from .solana_rpc import NETWORKS, empty_report, network, summarize, transaction_signature
from .validation import Problem, canonical, fields, identifier, parse_json


class ObservationMethods:
    def _begin_observation(self, connection, principal, agent_id, body, at):
        from .store import new_id
        self._role(principal, "AGENT")
        if principal["principal_id"] != agent_id:
            raise Problem(403, "FORBIDDEN")
        if self.rpc is None:
            raise Problem(503, "RPC_DISABLED")
        fields(body, ("network", "signature"))
        cluster, signature = network(body["network"]), transaction_signature(body["signature"])
        if self._proof_summary(connection, agent_id)["status"] != "SIGNATURE_VERIFIED":
            raise Problem(409, "WALLET_PROOF_REQUIRED")
        local = connection.execute("SELECT COUNT(*) FROM transactions WHERE agent_id=? AND created_ms>?",
                                   (agent_id, at - 60_000)).fetchone()[0]
        total = connection.execute("SELECT COUNT(*) FROM transactions WHERE created_ms>?", (at - 60_000,)).fetchone()[0]
        if local >= 3 or total >= 30:
            raise Problem(429, "OBSERVATION_RATE_LIMIT")
        self._capacity(connection, "transactions")
        record_id = new_id()
        report = empty_report(cluster, signature, "UNVERIFIED", ["REQUEST_PENDING_NOT_CHAIN_OBSERVATION"])
        report["available_at_ms"] = None
        connection.execute("INSERT INTO transactions VALUES (?,?,?,?,?,?,'UNVERIFIED',?,NULL)",
                           (record_id, agent_id, cluster, signature, at, at, canonical(report)))
        self._event(connection, principal, "TRANSACTION_OBSERVE_REQUEST", record_id,
                    {"network": cluster, "signature": signature}, at)
        return 201, self._transaction_public(self._row(connection, "transactions", record_id))

    @staticmethod
    def _transaction_public(row, include_raw=False):
        result = {key: row[key] for key in ("id", "agent_id", "created_ms", "updated_ms")}
        result["report"] = json.loads(row["report"])
        if not include_raw and len(result["report"]["native_transfer_instructions"]) > 10:
            result["report"]["native_transfer_instructions"] = result["report"]["native_transfer_instructions"][:10]
            result["report"]["quality_flags"].append("TRANSFER_INSTRUCTIONS_TRUNCATED_IN_LIST")
        result["provenance"] = {key: result["report"][key] for key in ("classification", "source",
            "observed_at_ms", "available_at_ms", "slot", "commitment", "transformation_version",
            "quality_flags", "missingness", "state")}
        if include_raw:
            # Preserve provider integer lexemes rather than forcing a browser to
            # parse u64 account balances through IEEE-754 numbers.
            result["raw_rpc_json"] = row["raw_rpc"]
        return result

    def _observations_read(self, connection, route, limit, after):
        parts = route.strip("/").split("/")
        if parts == ["v1", "transactions"]:
            rows = connection.execute("SELECT * FROM transactions WHERE id>? ORDER BY id LIMIT ?", (after, limit + 1)).fetchall()
        elif len(parts) == 3 and parts[:2] == ["v1", "transactions"]:
            return 200, self._transaction_public(self._row(connection, "transactions", identifier(parts[2])), True)
        elif len(parts) == 4 and parts[:2] == ["v1", "agents"] and parts[3] == "transactions":
            agent_id = identifier(parts[2])
            self._row(connection, "agents", agent_id)
            rows = connection.execute("SELECT * FROM transactions WHERE agent_id=? AND id>? ORDER BY id LIMIT ?",
                                      (agent_id, after, limit + 1)).fetchall()
        else:
            raise Problem(404, "NOT_FOUND")
        items = [self._transaction_public(row) for row in rows[:limit]]
        return 200, {"items": items, "next_after": items[-1]["id"] if len(rows) > limit else None}

    def _complete_observation(self, pending, token):
        row = pending[1]
        # The request and its quota charge were committed before the network call.
        connection = self._connection()
        try:
            agent = self._row(connection, "agents", row["agent_id"])
        finally:
            connection.close()
        report, raw = self.rpc.observe(row["report"]["network"], row["report"]["signature"], agent["wallet"])
        connection = self._connection()
        try:
            self._check_schema(connection)
            connection.execute("BEGIN IMMEDIATE")
            at = self.clock()
            principal = self._authenticate(connection, token, at)
            self._role(principal, "AGENT")
            if principal["principal_id"] != row["agent_id"]:
                raise Problem(403, "FORBIDDEN")
            report["available_at_ms"] = at
            connection.execute("UPDATE transactions SET state=?,report=?,raw_rpc=?,updated_ms=? WHERE id=?",
                               (report["state"], canonical(report), raw, at, row["id"]))
            self._event(connection, principal, "TRANSACTION_OBSERVE_RESULT", row["id"],
                        {"state": report["state"], "response_sha256": report["response_sha256"]}, at)
            result = self._transaction_public(self._row(connection, "transactions", row["id"]))
            connection.execute("COMMIT")
            return 201, result
        finally:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            connection.close()

    def _audit_observations(self, connection):
        for row in connection.execute("SELECT t.*,a.wallet FROM transactions t JOIN agents a ON t.agent_id=a.id"):
            report = json.loads(row["report"])
            if (report["network"] != row["network"] or report["signature"] != row["signature"]
                    or report["state"] != row["state"] or row["updated_ms"] < row["created_ms"]):
                raise Problem(503, "OBSERVATION_CONSISTENCY_FAILURE")
            if row["raw_rpc"] is not None:
                raw = row["raw_rpc"].encode("utf-8")
                envelope = parse_json(raw, maximum=262_144)
                expected = summarize(envelope["result"], row["network"], row["signature"], row["wallet"])
                if (any(report.get(key) != value for key, value in expected.items() if key != "response_sha256")
                        or hashlib.sha256(raw).hexdigest() != report["response_sha256"]
                        or report["genesis_hash"] != NETWORKS[row["network"]][1]
                        or report["available_at_ms"] != row["updated_ms"]):
                    raise Problem(503, "OBSERVATION_CONSISTENCY_FAILURE")
            elif row["state"] == "AVAILABLE":
                raise Problem(503, "OBSERVATION_CONSISTENCY_FAILURE")
