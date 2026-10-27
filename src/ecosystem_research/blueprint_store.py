"""Blueprint exchange on the existing community transaction and audit boundary."""

from contextlib import closing
from copy import deepcopy
import re
import sqlite3

from . import blueprints as b, services as s, network as n
from ..multi_brain_research import training_lab as lab
from ..solana_research import coin_evidence as ev


def store_type(base, Problem, resources):
    class BlueprintStore(base):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            with closing(self._connection()) as db:
                self._blueprint_configuration(db)

        @classmethod
        def initialize(cls, state, owner_file, clock=None):
            options = {"clock": clock} if clock else {}
            original = base.initialize(state, owner_file, **options)
            with closing(original._connection()) as db:
                db.executescript(
                    "BEGIN IMMEDIATE; CREATE TABLE blueprint_configuration (value TEXT NOT NULL) STRICT; "
                    "CREATE TABLE blueprint_events (sequence INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT;"
                )
                at = original.clock()
                actor = original._authenticate(db, ev.read(owner_file)["token"], at)
                details = {"protocol": b.PROTOCOL, "catalog_sha256": resources.digest,
                           "financial_settlement": False}
                original._event(db, actor, "BLUEPRINT_INSTALL", resources.digest, details, at)
                sequence = db.execute("SELECT MAX(seq) FROM audit").fetchone()[0]
                db.execute("INSERT INTO blueprint_configuration VALUES (?)",
                           (ev.canonical({**details, "install_audit_sequence": sequence}),))
                db.execute("COMMIT")
            return cls(state, **options)

        def _blueprint_configuration(self, db):
            try:
                rows = db.execute("SELECT value FROM blueprint_configuration").fetchall()
                lab.require(len(rows) == 1, "BLUEPRINT_CONFIGURATION")
                value = ev.parse(rows[0][0].encode())
                lab.exact(value, ("protocol", "catalog_sha256", "financial_settlement", "install_audit_sequence"))
                lab.require(value["protocol"] == b.PROTOCOL, "BLUEPRINT_PROTOCOL_MIGRATION_REQUIRED")
                details = {"protocol": b.PROTOCOL, "catalog_sha256": resources.digest, "financial_settlement": False}
                lab.require(n.same({k: v for k, v in value.items() if k != "install_audit_sequence"}, details),
                            "BLUEPRINT_CONFIGURATION_CHANGED")
                row = db.execute("SELECT * FROM audit WHERE seq=?",
                                 (b.integer(value["install_audit_sequence"], 1),)).fetchone()
                lab.require(row is not None and row["actor_role"] == "OWNER" and row["actor_id"] == "owner"
                            and row["action"] == "BLUEPRINT_INSTALL" and row["resource_id"] == resources.digest
                            and n.same(ev.parse(row["details"].encode()), details), "BLUEPRINT_INSTALL_AUDIT")
                return value
            except sqlite3.Error as error:
                raise Problem(503, "BLUEPRINT_STORE_NOT_INSTALLED") from error

        def _blueprint_load(self, db):
            config = self._blueprint_configuration(db)
            service_state, service_head, service_requests = self._service_load(db)
            snapshots = {resources.digest: (s.empty(), 0)}
            ordered = sorted(service_requests.values(), key=lambda event: event["sequence"])
            replay = s.empty()
            for event in ordered:
                replay, _ = s.apply(replay, event["actor"], event["command"], event["at_ms"],
                                    event["facts"], resources.catalog)
                snapshots[event["sha256"]] = (replay, event["audit_sequence"])
            rows = db.execute("SELECT sequence,body FROM blueprint_events ORDER BY sequence").fetchall()
            audits = db.execute("SELECT * FROM audit WHERE action='BLUEPRINT_ACTION' ORDER BY seq").fetchall()
            lab.require(len(rows) <= b.MAX_EVENTS and len(rows) == len(audits), "BLUEPRINT_EVENT_COUNT")
            state, head, last, requests = b.empty(), lab.digest(config), 0, {}
            for index, ((sequence, body), audit) in enumerate(zip(rows, audits, strict=True)):
                event = ev.parse(body.encode())
                lab.exact(event, ("sequence", "previous_sha256", "actor", "command", "at_ms", "facts",
                                  "service_head_sha256", "result", "state_sha256", "audit_sequence", "sha256"))
                lab.require(sequence == index == event["sequence"] and event["previous_sha256"] == head
                            and event["at_ms"] >= last and event["sha256"] == lab.digest(
                                {k: v for k, v in event.items() if k != "sha256"}), "BLUEPRINT_CHAIN_CHANGED")
                actor = event["actor"]
                credential = db.execute("SELECT role,principal_id FROM credentials WHERE id=?",
                                        (actor["credential_id"],)).fetchone()
                lab.require(credential is not None and credential["role"] == actor["role"]
                            and credential["principal_id"] == actor["principal_id"], "BLUEPRINT_CREDENTIAL_BINDING")
                prior = [e for e in ordered if e["audit_sequence"] < audit["seq"]]
                expected_head = prior[-1]["sha256"] if prior else resources.digest
                lab.require(event["service_head_sha256"] == expected_head, "BLUEPRINT_SERVICE_HISTORY_BINDING")
                historical, _ = snapshots[expected_head]
                prior_services = None
                if event["command"]["kind"] == "WITHDRAW":
                    lab.require(prior and prior[-1]["audit_sequence"] + 1 == audit["seq"]
                                and prior[-1]["at_ms"] == event["at_ms"]
                                and n.same(prior[-1]["actor"], actor), "BLUEPRINT_WITHDRAWAL_TRANSACTION")
                    prior_services, _ = snapshots[prior[-1]["previous_sha256"]]
                    expected = b.withdrawal_request(state, actor["principal_id"], event["command"], prior_services)
                    lab.require(n.same(expected, prior[-1]["command"]), "BLUEPRINT_WITHDRAWAL_SERVICE_BINDING")
                lab.require(n.same(event["facts"], b.facts_for(event["command"], historical, state, prior_services)),
                            "BLUEPRINT_SERVICE_FACTS_CHANGED")
                key = (actor["principal_id"], event["command"]["request_id"])
                lab.require(key not in requests, "BLUEPRINT_DUPLICATE_REQUEST")
                state, result = b.apply(state, actor, event["command"], event["at_ms"], event["facts"], resources.catalog)
                lab.require(n.same(result, event["result"]) and lab.digest(state) == event["state_sha256"],
                            "BLUEPRINT_STATE_REPLAY")
                details = {"protocol": b.PROTOCOL, "sequence": index, "event_sha256": event["sha256"],
                           "state_sha256": event["state_sha256"], "credential_id": actor["credential_id"]}
                lab.require(audit["seq"] == event["audit_sequence"] and audit["at_ms"] == event["at_ms"]
                            and audit["actor_role"] == actor["role"] and audit["actor_id"] == actor["principal_id"]
                            and audit["resource_id"] == result["id"]
                            and n.same(ev.parse(audit["details"].encode()), details), "BLUEPRINT_AUDIT_BINDING")
                requests[key] = event
                head, last = event["sha256"], event["at_ms"]
            return state, head, requests, service_state, service_head

        def _blueprint_action(self, db, principal, command, at):
            self._role(principal, "AGENT")
            who = principal["principal_id"]
            self._active_agent(db, who)
            command = b.command_value(command)
            state, head, requests, services, service_head = self._blueprint_load(db)
            key = (who, command["request_id"])
            if key in requests:
                old = requests[key]
                lab.require(n.same(command, old["command"]), "BLUEPRINT_REQUEST_CONFLICT")
                self._service_member(db, who, old["result"]["project_id"])
                return 200, {"result": old["result"], "replayed": True, "head_sha256": head}
            lab.require(len(requests) < b.MAX_EVENTS, "BLUEPRINT_EVENT_BOUND")
            prior_services = None
            if command["kind"] in ("TRIAL", "ACCEPT", "WITHDRAW"):
                license_ = state["licenses"].get(command["license_id"])
                lab.require(license_ is not None and license_["buyer_id"] == who, "BLUEPRINT_BUYER_REQUIRED")
                self._service_member(db, who, license_["project_id"])
                if command["kind"] == "TRIAL":
                    request = b.trial_request(state, who, command, services)
                    _, ordered = self._service_action(db, principal, request, at)
                    lab.require(not ordered["replayed"], "BLUEPRINT_UNBOUND_TRIAL_ORDER")
                elif command["kind"] == "WITHDRAW":
                    prior_services = services
                    request = b.withdrawal_request(state, who, command, services)
                    _, released = self._service_action(db, principal, request, at)
                    lab.require(not released["replayed"], "BLUEPRINT_WITHDRAWAL_ALREADY_RELEASED")
                else:
                    listing = state["listings"][license_["listing_id"]]
                    current = b.facts_for(command, services, state)
                    order = current["order"]
                    b.acceptance_gate(license_, listing, command, order, current["service_listing"])
                    if order["state"] == "DELIVERED":
                        self._service_action(db, principal, {
                            "kind": "ACCEPT", "request_id": lab.digest([b.PROTOCOL, "ACCEPT_SERVICE", license_["id"], order["id"]])[:32],
                            "order_id": order["id"], "report_sha256": order["report_sha256"],
                        }, at)
                # Both ledgers commit or roll back under the caller's BEGIN IMMEDIATE.
                services, service_head, _ = self._service_load(db)
            facts = b.facts_for(command, services, state, prior_services)
            actor = {"role": principal["role"], "principal_id": who, "credential_id": principal["id"]}
            updated, result = b.apply(state, actor, command, at, facts, resources.catalog)
            self._service_member(db, who, result["project_id"])
            if command["kind"] in ("PUBLISH", "ACQUIRE"):
                listing = updated["listings"][result["id"] if command["kind"] == "PUBLISH" else result["listing_id"]]
                source = services["listings"][listing["service_listing_id"]]
                lab.require(source["active"] and at < source["expires_ms"]
                            and self._offer_available(db, self._row(db, "offers", source["community_offer_id"])),
                            "BLUEPRINT_TRIAL_UNAVAILABLE")
            sequence = len(requests)
            audit_sequence = db.execute("SELECT MAX(seq) FROM audit").fetchone()[0] + 1
            event = {"sequence": sequence, "previous_sha256": head, "actor": actor, "command": command,
                     "at_ms": at, "facts": facts, "service_head_sha256": service_head, "result": result,
                     "state_sha256": lab.digest(updated), "audit_sequence": audit_sequence}
            event["sha256"] = lab.digest(event)
            self._event(db, principal, "BLUEPRINT_ACTION", result["id"],
                        {"protocol": b.PROTOCOL, "sequence": sequence, "event_sha256": event["sha256"],
                         "state_sha256": event["state_sha256"], "credential_id": principal["id"]}, at)
            db.execute("INSERT INTO blueprint_events VALUES (?,?)", (sequence, ev.canonical(event)))
            return 201, {"result": result, "replayed": False, "head_sha256": event["sha256"]}

        def _write(self, db, principal, method, route, body, at, audience=None):
            if method == "POST" and route == b.ROOT_ROUTE + "/actions":
                try:
                    return self._blueprint_action(db, principal, body, at)
                except ValueError as error:
                    raise Problem(409, str(error)[:100]) from error
            return super()._write(db, principal, method, route, body, at, audience)

        def _read(self, db, route, token, at, limit, after):
            if route == "/v1/status":
                status, value = super()._read(db, route, token, at, limit, after)
                return status, {**value, "blueprints": {"protocol": b.PROTOCOL,
                    "catalog_sha256": resources.digest, "paid_acquisition": False,
                    "arbitrary_code_execution": False, "live_execution_allowed": False},
                    "blueprint_withdrawal": b.withdrawal_declaration(resources.digest)}
            if not route.startswith(b.ROOT_ROUTE):
                return super()._read(db, route, token, at, limit, after)
            try:
                principal = self._authenticate(db, token, at)
                self._role(principal, "AGENT")
                who = principal["principal_id"]
                self._active_agent(db, who)
                lab.require(not after, "BLUEPRINT_CURSOR_NOT_SUPPORTED")
                state, head, _, services, _ = self._blueprint_load(db)
                if route == b.ROOT_ROUTE + "/view":
                    visible = {k: v for k, v in state["listings"].items() if db.execute(
                        "SELECT 1 FROM members WHERE project_id=? AND agent_id=?", (v["project_id"], who)).fetchone()}
                    return 200, {"protocol": b.PROTOCOL, "head_sha256": head,
                                 "catalog_sha256": resources.digest,
                                 "listings": {k: b.descriptor(v) for k, v in visible.items()},
                                 "licenses": {k: v for k, v in state["licenses"].items()
                                              if v["listing_id"] in visible and who in (v["buyer_id"], v["provider_id"])},
                                 "financial_settlement": False, "live_execution_allowed": False}
                match = re.fullmatch(b.ROOT_ROUTE + r"/listings/([0-9a-f]{32})/terms", route)
                if match:
                    listing = state["listings"].get(match.group(1))
                    lab.require(listing is not None, "BLUEPRINT_NOT_FOUND")
                    self._service_member(db, who, listing["project_id"])
                    return 200, {"listing": b.descriptor(listing), "license_text": listing["package"]["license_text"]}
                match = re.fullmatch(b.ROOT_ROUTE + r"/licenses/([0-9a-f]{32})/(delivery|trials)", route)
                if match:
                    license_ = state["licenses"].get(match.group(1))
                    lab.require(license_ is not None and who in (license_["buyer_id"], license_["provider_id"]),
                                "BLUEPRINT_LICENSE_ACCESS")
                    self._service_member(db, who, license_["project_id"])
                    if match.group(2) == "trials":
                        jobs = {}
                        for order_id in license_["trial_orders"]:
                            order = services["orders"][order_id]
                            if order["job_id"] is not None:
                                job = self._row(db, "jobs", order["job_id"])
                                jobs[order_id] = self._job_effective(db, job, at)[0]
                        return 200, b.trial_status(license_, services, jobs, at)
                    listing = state["listings"][license_["listing_id"]]
                    return 200, {"protocol": b.PROTOCOL, "license": deepcopy(license_),
                                 "listing": b.descriptor(listing), "package": deepcopy(listing["package"]),
                                 "verification_scope": "PACKAGE_INTEGRITY_AND_REGISTERED_RECIPE",
                                 "financial_settlement": False, "live_execution_allowed": False}
                raise Problem(404, "BLUEPRINT_ROUTE_NOT_FOUND")
            except ValueError as error:
                raise Problem(409, str(error)[:100]) from error

        def blueprint_audit(self):
            with closing(self._connection()) as db:
                db.execute("BEGIN")
                state, head, requests, _, service_head = self._blueprint_load(db)
                return {"protocol": b.PROTOCOL, "catalog_sha256": resources.digest, "head_sha256": head,
                        "service_head_sha256": service_head, "events": len(requests), "state": state,
                        "financial_settlement": False, "live_execution_allowed": False}

    return BlueprintStore
