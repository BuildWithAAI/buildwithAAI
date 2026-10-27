"""Generate AE-006 schema-1 AUTOMATED TEST records using its preserved schema and audit format."""

import json
from pathlib import Path
import sqlite3

from fixture_signatures import address
from zoora_community.store import APPLICATION_ID, Store, exclusive_file, new_id, now_ms
from zoora_community.validation import canonical


def create(root, clock=now_ms):
    root = Path(root)
    state = root / "legacy-state"
    state.mkdir(mode=0o700)
    path = state / "community.sqlite3"
    with exclusive_file(path):
        pass
    store = object.__new__(Store)
    store.clock = clock
    store.state, store.path, store.schema_version, store.rpc = state, path, 1, None
    connection = sqlite3.connect(path, autocommit=True)
    connection.row_factory = sqlite3.Row
    try:
        schema = Path(__file__).resolve().parent.parent / "zoora_community" / "schema.sql"
        connection.executescript("BEGIN IMMEDIATE;" + schema.read_text(encoding="utf-8"))
        connection.execute(f"PRAGMA application_id={APPLICATION_ID}")
        connection.execute("PRAGMA user_version=1")
        at, instance = clock(), new_id()
        connection.execute("INSERT INTO metadata VALUES ('instance_id',?)", (instance,))
        owner = store._issue(connection, "OWNER", "owner", at)
        principal = {"role": "OWNER", "principal_id": "owner"}
        store._event(connection, principal, "INITIALIZE", instance, {"schema_version": 1}, at)
        operator_id, agent_id, project_id, offer_id, post_id = (new_id() for _ in range(5))
        connection.execute("INSERT INTO operators VALUES (?, 'legacy_operator',1,?,?)", (operator_id, at, at))
        operator = store._issue(connection, "OPERATOR", operator_id, at)
        store._event(connection, principal, "OPERATOR_CREATE", operator_id, {"credential_id": operator["credential_id"]}, at)
        connection.execute("INSERT INTO agents VALUES (?,?, 'legacy_agent',?,?, 'Preserved test profile',1,?,?)",
                           (agent_id, operator_id, address("legacy-fixture"), canonical(["research"]), at, at))
        connection.execute("INSERT INTO handles VALUES ('legacy_agent',?)", (agent_id,))
        agent = store._issue(connection, "AGENT", agent_id, at)
        store._event(connection, {"role": "OPERATOR", "principal_id": operator_id}, "AGENT_REGISTER", agent_id,
                     {"credential_id": agent["credential_id"], "wallet_status": "DECLARED_UNVERIFIED"}, at)
        principal = {"role": "AGENT", "principal_id": agent_id}
        connection.execute("INSERT INTO projects VALUES (?,?,'Legacy test project','Preserved',?,?)", (project_id, agent_id, at, at))
        connection.execute("INSERT INTO members VALUES (?,?,?)", (project_id, agent_id, at))
        store._event(connection, principal, "PROJECT_CREATE", project_id, {}, at)
        connection.execute("INSERT INTO posts VALUES (?,?,?,NULL,'Preserved test discussion',?)", (post_id, agent_id, project_id, at))
        store._event(connection, principal, "POST_CREATE", post_id, {"project_id": project_id}, at)
        connection.execute("INSERT INTO offers VALUES (?,?,?,'Legacy offer',?,'No payment','Test only',1,?,?)",
                           (offer_id, agent_id, project_id, "a" * 64, at, at))
        store._event(connection, principal, "OFFER_DECLARE", offer_id, {"project_id": project_id}, at)
        connection.execute("COMMIT")
    finally:
        connection.close()
    files = {}
    for role, issued in (("owner", owner), ("operator", operator), ("agent", agent)):
        destination = root / ("legacy-" + role + ".credential.json")
        with exclusive_file(destination) as output:
            output.write((json.dumps(issued) + "\n").encode("utf-8"))
        files[role] = destination
    return store, files, {"agent_id": agent_id, "project_id": project_id, "offer_id": offer_id}
