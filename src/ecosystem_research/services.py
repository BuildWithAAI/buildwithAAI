"""Identity-bound research service orders and nonmonetary work allowances.

Orders coordinate actual computations over pinned evidence. Work units are local
resource accounting, never coins, payments, revenue or independent work proofs.
"""

from __future__ import annotations

from copy import deepcopy
from contextlib import closing
import re
import sqlite3

from . import network as n, scanner_feed as f, service_evidence as evidence
from ..multi_brain_research import training_lab as lab
from ..solana_research import coin_evidence as ev

PROTOCOL = "AAI_RESEARCH_SERVICES_V1"
UNIT = "NONMONETARY_WORK_UNITS"
KINDS = ("scanner_replay_audit", "model_guard_audit")
MAX_EVENTS, MAX_ORDERS, MAX_LISTINGS, MAX_MANDATES = 256, 64, 32, 16
MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
FAILED_JOBS = ("FAILED", "CANCELLED", "EXPIRED", "INTERRUPTED")
ROOT_ROUTE = "/v1/services"
COMMAND_FIELDS = {
    "MANDATE": ("buyer_id", "limit", "expires_ms", "services"),
    "OFFER": (
        "community_offer_id",
        "service",
        "resource_sha256",
        "work_units",
        "expires_ms",
    ),
    "ORDER": ("mandate_id", "listing_id", "terms_sha256", "start_before_ms"),
    "START": ("order_id",),
    "DELIVER": ("order_id", "report_sha256"),
    "ACCEPT": ("order_id", "report_sha256"),
    "REJECT": ("order_id", "report_sha256"),
    "CANCEL": ("order_id",),
    "EXPIRE": ("order_id",),
    "ABORT_FAILED": ("order_id",),
    "REVOKE": ("mandate_id",),
    "CLOSE": ("listing_id",),
}


def integer(value, low=0, high=2**53 - 1):
    lab.require(type(value) is int and low <= value <= high, "SERVICE_INTEGER")
    return value


def exact(value, fields):
    lab.exact(value, fields)


def command_value(command):
    lab.require(
        type(command) is dict
        and type(command.get("kind")) is str
        and command["kind"] in COMMAND_FIELDS,
        "SERVICE_COMMAND_KIND",
    )
    fields = COMMAND_FIELDS[command["kind"]]
    exact(command, ("request_id", "kind", *fields))
    n.identity(command["request_id"])
    for key in fields:
        if key.endswith("_id"):
            n.identity(command[key])
        elif key.endswith("_sha256"):
            lab.pin(command[key])
    return deepcopy(command)


def terms(service, resource, units, expires):
    lab.require(service in KINDS, "SERVICE_KIND")
    return {
        "protocol": PROTOCOL,
        "service": service,
        "resource_sha256": lab.pin(resource),
        "work_units": integer(units, 1, 1000),
        "unit": UNIT,
        "expires_ms": integer(expires),
        "financial_settlement": False,
        "live_execution_allowed": False,
    }


class Resources:
    """Host-selected immutable model release and externally pinned journal head."""

    def __init__(
        self, bundle, controller_sha256, journal, expected_head, expected_policy
    ):
        n.validate_bundle(bundle, controller_sha256)
        self.bundle = deepcopy(bundle)
        self.controller = controller_sha256
        self.journal, self.head, self.policy = (
            journal,
            lab.pin(expected_head),
            lab.pin(expected_policy),
        )
        state = self.check()
        lab.require(state["events"], "SERVICE_EMPTY_FEED")
        self.as_of = state["last_ms"]
        self.results = {kind: self.compute(kind) for kind in KINDS}
        self.catalog = {
            "protocol": PROTOCOL,
            "unit": UNIT,
            "resources": {
                kind: {
                    "service": kind,
                    "result_sha256": ev.sha(n.raw(result)),
                    "result_bytes": len(n.raw(result)),
                    "source_scope": "HISTORICAL_CAPTURE_REPLAY"
                    if kind == KINDS[0]
                    else "PINNED_SYNTHETIC_MODEL_EXERCISE",
                    "controller_manifest_sha256": self.controller,
                    "bundle_sha256": ev.sha(n.raw(self.bundle)),
                    "feed_head_sha256": self.head if kind == KINDS[0] else None,
                    "feed_policy_sha256": self.policy if kind == KINDS[0] else None,
                    "as_of_ms": self.as_of if kind == KINDS[0] else None,
                }
                for kind, result in self.results.items()
            },
            "financial_settlement": False,
            "live_execution_allowed": False,
        }
        self.digest = lab.digest(self.catalog)
        self.evidence = evidence.Export(self.journal, self.head, self.policy)

    def check(self):
        lab.require(
            lab.digest(self.journal.rules) == self.policy, "SERVICE_FEED_POLICY_PIN"
        )
        return self.journal.snapshot(self.head)

    def compute(self, kind):
        lab.require(kind in KINDS, "SERVICE_KIND")
        self.check()
        if kind == KINDS[0]:
            return f.agent_report(
                self.journal, self.bundle, self.controller, self.head, self.as_of
            )
        return n.exercise(self.bundle, self.controller)

    def resource_id(self, kind):
        return lab.digest(self.catalog["resources"][kind])

    def report(self, order, listing, *, recompute=True):
        result = (
            self.compute(listing["service"])
            if recompute
            else self.results[listing["service"]]
        )
        lab.require(
            n.same(result, self.results[listing["service"]]), "SERVICE_RESOURCE_CHANGED"
        )
        report = {
            "protocol": "AAI_RESEARCH_SERVICE_DELIVERY_V1",
            "catalog_sha256": self.digest,
            "order_id": order["id"],
            "buyer_id": order["buyer_id"],
            "provider_id": order["provider_id"],
            "project_id": order["project_id"],
            "listing_id": order["listing_id"],
            "terms_sha256": listing["terms_sha256"],
            "service": listing["service"],
            "resource_sha256": listing["resource_sha256"],
            "result": result,
            "source_scope": self.catalog["resources"][listing["service"]][
                "source_scope"
            ],
            "current_market_claim": False,
            "unit": UNIT,
            "work_units": order["work_units"],
            "financial_settlement": False,
            "research_signal": "ABSTAIN",
            "live_execution_allowed": False,
        }
        lab.require(len(n.raw(report)) <= n.MAX_BYTES, "SERVICE_REPORT_BOUND")
        return report


def empty():
    return {"mandates": {}, "listings": {}, "orders": {}}


def balance(state, mandate):
    orders = [o for o in state["orders"].values() if o["mandate_id"] == mandate["id"]]
    reserved = sum(
        o["work_units"]
        for o in orders
        if o["state"] in ("OPEN", "STARTED", "DELIVERED")
    )
    consumed = sum(o["work_units"] for o in orders if o["state"] == "ACCEPTED")
    return {
        "limit": mandate["limit"],
        "reserved": reserved,
        "consumed": consumed,
        "available": mandate["limit"] - reserved - consumed,
        "unit": UNIT,
        "financial_settlement": False,
    }


def apply(state, actor, command, at, facts, catalog):
    """Replay one authorized domain transition; database facts are checked separately."""
    state = deepcopy(state)
    exact(actor, ("role", "principal_id", "credential_id"))
    role, who = actor["role"], actor["principal_id"]
    lab.require(role in ("OWNER", "OPERATOR", "AGENT"), "SERVICE_ROLE")
    if role != "OWNER":
        n.identity(who)
    else:
        lab.require(who == "owner", "SERVICE_OWNER")
    n.identity(actor["credential_id"])
    integer(at)
    command = command_value(command)
    kind = command["kind"]
    request_id = n.identity(command["request_id"])
    record_id = lab.digest([lab.digest(catalog), role, who, request_id, kind])[:32]

    def agent(expected=None):
        lab.require(
            role == "AGENT" and (expected is None or who == expected),
            "SERVICE_ACTOR_FORBIDDEN",
        )

    def get(table, key):
        lab.require(key in state[table], "SERVICE_NOT_FOUND")
        return state[table][key]

    if kind == "MANDATE":
        exact(facts, ("operator_id",))
        lab.require(
            role == "OPERATOR" and who == facts["operator_id"],
            "SERVICE_ACTOR_FORBIDDEN",
        )
        allowed = command["services"]
        lab.require(
            type(allowed) is list
            and allowed
            and all(type(k) is str and k in KINDS for k in allowed)
            and allowed == sorted(set(allowed)),
            "SERVICE_MANDATE_SCOPE",
        )
        expires = integer(command["expires_ms"])
        lab.require(at < expires <= at + MAX_LIFETIME_MS, "SERVICE_EXPIRY")
        lab.require(len(state["mandates"]) < MAX_MANDATES, "SERVICE_MANDATE_BOUND")
        value = {
            "id": record_id,
            "buyer_id": command["buyer_id"],
            "operator_id": who,
            "limit": integer(command["limit"], 1, 10000),
            "services": allowed,
            "expires_ms": expires,
            "revoked": False,
        }
        state["mandates"][record_id] = value
    elif kind == "OFFER":
        agent()
        exact(facts, ("provider_id", "project_id"))
        lab.require(facts["provider_id"] == who, "SERVICE_ACTOR_FORBIDDEN")
        n.identity(facts["project_id"])
        offer_terms = terms(
            command["service"],
            command["resource_sha256"],
            command["work_units"],
            command["expires_ms"],
        )
        lab.require(
            command["resource_sha256"]
            == lab.digest(catalog["resources"][command["service"]]),
            "SERVICE_RESOURCE_PIN",
        )
        lab.require(
            at < command["expires_ms"] <= at + MAX_LIFETIME_MS, "SERVICE_EXPIRY"
        )
        lab.require(
            len(state["listings"]) < MAX_LISTINGS
            and not any(
                existing["community_offer_id"] == command["community_offer_id"]
                for existing in state["listings"].values()
            ),
            "SERVICE_LISTING_BOUND_OR_DUPLICATE",
        )
        value = {
            "id": record_id,
            **offer_terms,
            "provider_id": who,
            "project_id": facts["project_id"],
            "community_offer_id": command["community_offer_id"],
            "terms_sha256": lab.digest(offer_terms),
            "active": True,
        }
        state["listings"][record_id] = value
    elif kind == "ORDER":
        agent()
        exact(facts, ())
        mandate, listing = (
            get("mandates", command["mandate_id"]),
            get("listings", command["listing_id"]),
        )
        lab.require(
            who == mandate["buyer_id"] and who != listing["provider_id"],
            "SERVICE_BUYER_OR_SELF_ORDER",
        )
        lab.require(
            not mandate["revoked"]
            and listing["active"]
            and at < min(mandate["expires_ms"], listing["expires_ms"]),
            "SERVICE_AUTHORIZATION_EXPIRED_OR_REVOKED",
        )
        lab.require(
            listing["service"] in mandate["services"]
            and command["terms_sha256"] == listing["terms_sha256"],
            "SERVICE_TERMS_OR_SCOPE",
        )
        deadline = integer(command["start_before_ms"])
        lab.require(
            at < deadline <= min(mandate["expires_ms"], listing["expires_ms"]),
            "SERVICE_START_WINDOW",
        )
        lab.require(
            len(state["orders"]) < MAX_ORDERS
            and sum(o["mandate_id"] == mandate["id"] for o in state["orders"].values())
            < 8,
            "SERVICE_ORDER_BOUND",
        )
        lab.require(
            balance(state, mandate)["available"] >= listing["work_units"],
            "SERVICE_ALLOWANCE_EXHAUSTED",
        )
        value = {
            "id": record_id,
            "mandate_id": mandate["id"],
            "listing_id": listing["id"],
            "buyer_id": who,
            "provider_id": listing["provider_id"],
            "project_id": listing["project_id"],
            "work_units": listing["work_units"],
            "start_before_ms": deadline,
            "state": "OPEN",
            "job_id": None,
            "report_sha256": None,
            "artifact_id": None,
        }
        state["orders"][record_id] = value
    elif kind in ("REVOKE", "CLOSE"):
        exact(facts, ())
        if kind == "REVOKE":
            value = get("mandates", command["mandate_id"])
            lab.require(
                role == "OWNER" or role == "OPERATOR" and who == value["operator_id"],
                "SERVICE_ACTOR_FORBIDDEN",
            )
            lab.require(not value["revoked"], "SERVICE_ALREADY_REVOKED")
            value["revoked"] = True
        else:
            value = get("listings", command["listing_id"])
            agent(value["provider_id"])
            lab.require(value["active"], "SERVICE_ALREADY_CLOSED")
            value["active"] = False
    else:
        value = get("orders", command["order_id"])
        if kind == "START":
            agent(value["provider_id"])
            exact(facts, ("job_id",))
            n.identity(facts["job_id"])
            mandate, listing = (
                state["mandates"][value["mandate_id"]],
                state["listings"][value["listing_id"]],
            )
            lab.require(
                value["state"] == "OPEN"
                and listing["active"]
                and not mandate["revoked"]
                and at
                < min(
                    value["start_before_ms"],
                    mandate["expires_ms"],
                    listing["expires_ms"],
                ),
                "SERVICE_START_NOT_AUTHORIZED",
            )
            lab.require(
                not any(
                    o["job_id"] == facts["job_id"] for o in state["orders"].values()
                ),
                "SERVICE_JOB_REUSED",
            )
            value.update(state="STARTED", job_id=facts["job_id"])
        elif kind == "DELIVER":
            agent(value["provider_id"])
            exact(facts, ("artifact_id",))
            n.identity(facts["artifact_id"])
            lab.require(value["state"] == "STARTED", "SERVICE_STATE")
            value.update(
                state="DELIVERED",
                artifact_id=facts["artifact_id"],
                report_sha256=command["report_sha256"],
            )
        elif kind in ("ACCEPT", "REJECT"):
            agent(value["buyer_id"])
            exact(facts, ())
            lab.require(
                value["state"] == "DELIVERED"
                and value["report_sha256"] == command["report_sha256"],
                "SERVICE_ACCEPTANCE_BINDING",
            )
            value["state"] = "ACCEPTED" if kind == "ACCEPT" else "REJECTED"
        elif kind == "CANCEL":
            agent(value["buyer_id"])
            exact(facts, ())
            lab.require(value["state"] == "OPEN", "SERVICE_STARTED_RESERVATION_HELD")
            value["state"] = "CANCELLED"
        elif kind == "EXPIRE":
            mandate = state["mandates"][value["mandate_id"]]
            lab.require(
                (role == "AGENT" and who in (value["buyer_id"], value["provider_id"]))
                or (role == "OPERATOR" and who == mandate["operator_id"]),
                "SERVICE_ACTOR_FORBIDDEN",
            )
            exact(facts, ())
            lab.require(
                value["state"] == "OPEN"
                and value["job_id"] is None
                and at >= value["start_before_ms"],
                "SERVICE_EXPIRY_NOT_AUTHORIZED",
            )
            value["state"] = "EXPIRED"
        else:
            mandate = state["mandates"][value["mandate_id"]]
            lab.require(
                (role == "AGENT" and who in (value["buyer_id"], value["provider_id"]))
                or role == "OPERATOR"
                and who == mandate["operator_id"],
                "SERVICE_ACTOR_FORBIDDEN",
            )
            exact(facts, ("terminal_job_state",))
            lab.require(
                value["state"] == "STARTED"
                and facts["terminal_job_state"] in FAILED_JOBS,
                "SERVICE_UNCERTAIN_RESERVATION_HELD",
            )
            value.update(state="FAILED", terminal_job_state=facts["terminal_job_state"])
    lab.require(
        all(balance(state, m)["available"] >= 0 for m in state["mandates"].values()),
        "SERVICE_ACCOUNTING",
    )
    return state, deepcopy(value)


def job_request(order, listing, resources):
    report = resources.report(order, listing, recompute=False)
    return {
        "request_id": lab.digest([PROTOCOL, order["id"]])[:32],
        "title": "Research service " + listing["service"],
        "prompt": ev.canonical(
            {
                "protocol": PROTOCOL,
                "order_id": order["id"],
                "catalog_sha256": resources.digest,
                "expected_report_sha256": ev.sha(n.raw(report)),
            }
        ),
        "project_id": order["project_id"],
        "max_steps": 2,
        "timeout_seconds": 120,
    }


def readiness(state, order, principal, at, job_state, offer_available, queue_clear):
    """A server-time observation, not an authorization or reserved job claim."""
    listing = state["listings"][order["listing_id"]]
    mandate = state["mandates"][order["mandate_id"]]
    fulfill, accept = [], []
    if principal != order["provider_id"]:
        fulfill.append("PROVIDER_REQUIRED")
    if principal != order["buyer_id"]:
        accept.append("BUYER_REQUIRED")
    if order["state"] not in ("DELIVERED", "ACCEPTED"):
        accept.append("DELIVERY_REQUIRED")
    if order["state"] not in ("OPEN", "STARTED", "DELIVERED", "ACCEPTED"):
        fulfill.append("ORDER_NOT_WORKABLE")
    if order["state"] == "OPEN" or job_state == "QUEUED":
        if not listing["active"] or not offer_available:
            fulfill.append("OFFER_UNAVAILABLE")
        if mandate["revoked"]:
            fulfill.append("MANDATE_REVOKED")
        if at >= min(order["start_before_ms"], mandate["expires_ms"], listing["expires_ms"]):
            fulfill.append("START_WINDOW_EXPIRED")
        if not queue_clear:
            fulfill.append("DEDICATED_QUEUE_REQUIRED")
    if order["state"] == "STARTED" and job_state not in ("QUEUED", "SUCCEEDED"):
        fulfill.append("OPERATOR_RECOVERY_REQUIRED")
    return {"fulfill": fulfill, "accept": accept}


def assignments(view, principal, mode, limit):
    """Bounded existing work only; never grant mandates or retry uncertain jobs."""
    n.identity(principal)
    integer(limit, 1, 4)
    lab.require(mode in ("provide", "accept", "both"), "SERVICE_WORK_MODE")
    lab.require(type(view.get("orders")) is dict and len(view["orders"]) <= MAX_ORDERS,
                "SERVICE_WORK_VIEW")
    selected = []
    for key, order in sorted(view["orders"].items()):
        lab.require(n.identity(key) == order["id"], "SERVICE_WORK_ORDER_ID")
        action = None
        if mode in ("provide", "both") and order["state"] == "OPEN" and order["provider_id"] == principal:
            action = "fulfill"
        elif mode in ("accept", "both") and order["state"] == "DELIVERED" and order["buyer_id"] == principal:
            action = "accept"
        if action:
            selected.append({"order_id": key, "action": action})
            if len(selected) == limit:
                break
    return selected


def store_type(base, Problem, resources):
    """Extend the actual pinned transactional Store; do not patch its checkout."""
    base = n.store_type(base, Problem, resources.bundle, resources.controller)

    class ServiceStore(base):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            with closing(self._connection()) as db:
                self._service_configuration(db)

        @classmethod
        def initialize(cls, state, owner_file, clock=None):
            original = base.initialize(
                state, owner_file, **({"clock": clock} if clock else {})
            )
            with closing(original._connection()) as db:
                db.executescript(
                    "BEGIN IMMEDIATE; CREATE TABLE service_configuration (value TEXT NOT NULL) STRICT; "
                    "CREATE TABLE service_events (sequence INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT;"
                )
                at = original.clock()
                actor = original._authenticate(db, ev.read(owner_file)["token"], at)
                original._event(
                    db,
                    actor,
                    "SERVICE_INSTALL",
                    resources.digest,
                    {"catalog_sha256": resources.digest, "protocol": PROTOCOL},
                    at,
                )
                audit_seq = db.execute("SELECT MAX(seq) FROM audit").fetchone()[0]
                db.execute(
                    "INSERT INTO service_configuration VALUES (?)",
                    (
                        ev.canonical(
                            {
                                "protocol": PROTOCOL,
                                "catalog_sha256": resources.digest,
                                "catalog": resources.catalog,
                                "install_audit_sequence": audit_seq,
                                "unit": UNIT,
                                "financial_settlement": False,
                            }
                        ),
                    ),
                )
                db.execute("COMMIT")
            return cls(state, **({"clock": clock} if clock else {}))

        def _service_configuration(self, db):
            try:
                rows = db.execute("SELECT value FROM service_configuration").fetchall()
                lab.require(len(rows) == 1, "SERVICE_CONFIGURATION")
                config = ev.parse(rows[0][0].encode())
                exact(
                    config,
                    (
                        "protocol",
                        "catalog_sha256",
                        "catalog",
                        "install_audit_sequence",
                        "unit",
                        "financial_settlement",
                    ),
                )
                lab.require(
                    config["protocol"] == PROTOCOL
                    and config["catalog_sha256"] == resources.digest
                    and n.same(config["catalog"], resources.catalog)
                    and lab.digest(resources.catalog) == resources.digest
                    and config["unit"] == UNIT
                    and config["financial_settlement"] is False,
                    "SERVICE_CATALOG_CHANGED",
                )
                install = db.execute(
                    "SELECT action,resource_id,details,actor_role,actor_id FROM audit WHERE seq=?",
                    (integer(config["install_audit_sequence"], 1),),
                ).fetchone()
                lab.require(
                    install is not None
                    and install["action"] == "SERVICE_INSTALL"
                    and install["resource_id"] == resources.digest
                    and install["actor_role"] == "OWNER"
                    and install["actor_id"] == "owner"
                    and n.same(
                        ev.parse(install["details"].encode()),
                        {"catalog_sha256": resources.digest, "protocol": PROTOCOL},
                    ),
                    "SERVICE_INSTALL_AUDIT",
                )
                return config
            except sqlite3.Error as error:
                raise Problem(503, "SERVICE_STORE_NOT_INSTALLED") from error

        def _service_links(self, db, state):
            for mandate in state["mandates"].values():
                agent = self._row(db, "agents", mandate["buyer_id"])
                lab.require(
                    agent["operator_id"] == mandate["operator_id"],
                    "SERVICE_MANDATE_IDENTITY_CHANGED",
                )
            for listing in state["listings"].values():
                offer = self._row(db, "offers", listing["community_offer_id"])
                expected = terms(
                    listing["service"],
                    listing["resource_sha256"],
                    listing["work_units"],
                    listing["expires_ms"],
                )
                lab.require(
                    offer["provider_id"] == listing["provider_id"]
                    and offer["project_id"] == listing["project_id"]
                    and offer["criteria_digest"]
                    == listing["terms_sha256"]
                    == lab.digest(expected)
                    and offer["quote"] == str(listing["work_units"]) + " " + UNIT
                    and offer["delivery_terms"] == PROTOCOL + ":" + listing["service"],
                    "SERVICE_OFFER_CHANGED",
                )
            for order in state["orders"].values():
                if order["job_id"] is None:
                    continue
                job = self._row(db, "jobs", order["job_id"])
                listing = state["listings"][order["listing_id"]]
                expected = job_request(order, listing, resources)
                lab.require(
                    job["agent_id"] == order["provider_id"]
                    and all(job[k] == v for k, v in expected.items()),
                    "SERVICE_JOB_CHANGED",
                )
                if order["state"] in ("DELIVERED", "ACCEPTED", "REJECTED"):
                    self._service_completed_job(
                        db, order, listing, order["report_sha256"]
                    )
                    lab.require(
                        job["artifact_id"] == order["artifact_id"],
                        "SERVICE_ARTIFACT_CHANGED",
                    )
                if order["state"] == "FAILED":
                    lab.require(
                        job["state"] == order["terminal_job_state"] in FAILED_JOBS
                        and job["artifact_id"] is None,
                        "SERVICE_FAILURE_CHANGED",
                    )

        def _service_load(self, db):
            self._service_configuration(db)
            resources.check()
            rows = db.execute(
                "SELECT sequence,body FROM service_events ORDER BY sequence"
            ).fetchall()
            lab.require(len(rows) <= MAX_EVENTS, "SERVICE_EVENT_BOUND")
            audits = db.execute(
                "SELECT * FROM audit WHERE action='SERVICE_ACTION' ORDER BY seq"
            ).fetchall()
            lab.require(len(audits) == len(rows), "SERVICE_EVENT_DELETED_OR_ORPHANED")
            state, head, last, requests = empty(), resources.digest, 0, {}
            for index, ((sequence, body), audit) in enumerate(
                zip(rows, audits, strict=True)
            ):
                event = ev.parse(body.encode())
                exact(
                    event,
                    (
                        "sequence",
                        "previous_sha256",
                        "actor",
                        "command",
                        "at_ms",
                        "facts",
                        "result",
                        "state_sha256",
                        "audit_sequence",
                        "sha256",
                    ),
                )
                lab.require(
                    type(sequence) is int
                    and sequence == index == event["sequence"]
                    and event["previous_sha256"] == head
                    and event["at_ms"] >= last
                    and event["sha256"]
                    == lab.digest({k: v for k, v in event.items() if k != "sha256"}),
                    "SERVICE_CHAIN_CHANGED",
                )
                actor = event["actor"]
                credential = db.execute(
                    "SELECT role,principal_id FROM credentials WHERE id=?",
                    (actor["credential_id"],),
                ).fetchone()
                lab.require(
                    credential is not None
                    and credential["role"] == actor["role"]
                    and credential["principal_id"] == actor["principal_id"],
                    "SERVICE_CREDENTIAL_BINDING",
                )
                key = (
                    actor["role"],
                    actor["principal_id"],
                    event["command"]["request_id"],
                )
                lab.require(key not in requests, "SERVICE_DUPLICATE_REQUEST")
                state, result = apply(
                    state,
                    actor,
                    event["command"],
                    event["at_ms"],
                    event["facts"],
                    resources.catalog,
                )
                lab.require(
                    n.same(result, event["result"])
                    and lab.digest(state) == event["state_sha256"],
                    "SERVICE_STATE_REPLAY",
                )
                details = {
                    "protocol": PROTOCOL,
                    "sequence": index,
                    "event_sha256": event["sha256"],
                    "state_sha256": event["state_sha256"],
                    "credential_id": actor["credential_id"],
                }
                lab.require(
                    audit["seq"] == event["audit_sequence"]
                    and audit["at_ms"] == event["at_ms"]
                    and audit["actor_role"] == actor["role"]
                    and audit["actor_id"] == actor["principal_id"]
                    and audit["resource_id"] == result["id"]
                    and n.same(ev.parse(audit["details"].encode()), details),
                    "SERVICE_AUDIT_BINDING",
                )
                requests[key] = event
                head, last = event["sha256"], event["at_ms"]
            self._service_links(db, state)
            return state, head, requests

        def _service_completed_job(self, db, order, listing, expected_sha):
            job = self._row(db, "jobs", order["job_id"])
            payload = n.raw(resources.report(order, listing, recompute=False))
            lab.require(
                job["state"] == "SUCCEEDED"
                and job["agent_id"] == order["provider_id"]
                and job["project_id"] == order["project_id"]
                and job["report_sha256"] == expected_sha == ev.sha(payload)
                and job["report_bytes"] == len(payload)
                and job["artifact_id"] is not None,
                "SERVICE_JOB_NOT_VERIFIED",
            )
            artifact = self._row(db, "artifacts", job["artifact_id"])
            lab.require(
                artifact["project_id"] == order["project_id"]
                and artifact["author_id"] == order["provider_id"]
                and artifact["digest"] == expected_sha,
                "SERVICE_JOB_ARTIFACT_BINDING",
            )
            return job

        def _service_member(self, db, agent, project):
            self._active_agent(db, agent)
            self._membership(db, project, agent)

        def _service_action(self, db, principal, command, at):
            state, head, requests = self._service_load(db)
            command = command_value(command)
            key = (principal["role"], principal["principal_id"], command["request_id"])
            if key in requests:
                old = requests[key]
                lab.require(n.same(old["command"], command), "SERVICE_REQUEST_CONFLICT")
                return 200, {
                    "result": old["result"],
                    "replayed": True,
                    "head_sha256": head,
                    "unit": UNIT,
                }
            lab.require(len(requests) < MAX_EVENTS, "SERVICE_EVENT_BOUND")
            actor = {
                "role": principal["role"],
                "principal_id": principal["principal_id"],
                "credential_id": principal["id"],
            }
            kind, facts = command.get("kind"), {}
            if kind == "MANDATE":
                self._role(principal, "OPERATOR")
                buyer = self._active_agent(db, n.identity(command.get("buyer_id")))
                lab.require(
                    buyer["operator_id"] == principal["principal_id"],
                    "SERVICE_FOREIGN_BUYER",
                )
                facts = {"operator_id": buyer["operator_id"]}
            elif kind == "OFFER":
                self._role(principal, "AGENT")
                offer = self._row(
                    db, "offers", n.identity(command.get("community_offer_id"))
                )
                self._service_member(db, principal["principal_id"], offer["project_id"])
                lab.require(
                    self._offer_available(db, offer), "SERVICE_OFFER_UNAVAILABLE"
                )
                facts = {
                    "provider_id": offer["provider_id"],
                    "project_id": offer["project_id"],
                }
            elif kind == "ORDER":
                listing = state["listings"].get(command.get("listing_id"))
                lab.require(listing is not None, "SERVICE_NOT_FOUND")
                self._role(principal, "AGENT")
                self._service_member(
                    db, principal["principal_id"], listing["project_id"]
                )
                lab.require(
                    self._offer_available(
                        db, self._row(db, "offers", listing["community_offer_id"])
                    ),
                    "SERVICE_OFFER_UNAVAILABLE",
                )
            elif kind in (
                "START",
                "DELIVER",
                "ACCEPT",
                "REJECT",
                "CANCEL",
                "EXPIRE",
                "ABORT_FAILED",
            ):
                order = state["orders"].get(command.get("order_id"))
                lab.require(order is not None, "SERVICE_NOT_FOUND")
                listing = state["listings"][order["listing_id"]]
                # Recovery cannot start work or read reports. Allow the bound
                # parties to release unused work even after membership removal.
                if principal["role"] == "AGENT" and kind != "EXPIRE":
                    self._service_member(
                        db, principal["principal_id"], order["project_id"]
                    )
                if kind == "START":
                    # Validate the transition before the actual atomic job submission.
                    apply(
                        state,
                        actor,
                        command,
                        at,
                        {"job_id": "e" * 32},
                        resources.catalog,
                    )
                    self._service_member(db, order["buyer_id"], order["project_id"])
                    lab.require(
                        self._offer_available(
                            db, self._row(db, "offers", listing["community_offer_id"])
                        ),
                        "SERVICE_OFFER_UNAVAILABLE",
                    )
                    _, submitted = super()._jobs_write(
                        db,
                        principal,
                        "POST",
                        "/v1/jobs",
                        job_request(order, listing, resources),
                        at,
                    )
                    lab.require(
                        submitted["job"]["state"] == "QUEUED"
                        and not submitted["replayed"],
                        "SERVICE_JOB_ALREADY_EXISTS",
                    )
                    facts = {"job_id": submitted["job"]["id"]}
                elif kind == "DELIVER":
                    job = self._service_completed_job(
                        db, order, listing, command.get("report_sha256")
                    )
                    resources.report(order, listing)
                    facts = {"artifact_id": job["artifact_id"]}
                elif kind == "ABORT_FAILED":
                    self._jobs_sweep(db, at)
                    job = self._row(db, "jobs", order["job_id"])
                    lab.require(
                        job["state"] in FAILED_JOBS and job["artifact_id"] is None,
                        "SERVICE_UNCERTAIN_RESERVATION_HELD",
                    )
                    facts = {"terminal_job_state": job["state"]}
            state, result = apply(state, actor, command, at, facts, resources.catalog)
            if kind == "CLOSE":
                super()._write(
                    db,
                    principal,
                    "PATCH",
                    "/v1/offers/" + result["community_offer_id"],
                    {"active": False},
                    at,
                )
            sequence = len(requests)
            audit_sequence = db.execute("SELECT MAX(seq) FROM audit").fetchone()[0] + 1
            event = {
                "sequence": sequence,
                "previous_sha256": head,
                "actor": actor,
                "command": command,
                "at_ms": at,
                "facts": facts,
                "result": result,
                "state_sha256": lab.digest(state),
                "audit_sequence": audit_sequence,
            }
            event["sha256"] = lab.digest(event)
            self._event(
                db,
                principal,
                "SERVICE_ACTION",
                result["id"],
                {
                    "protocol": PROTOCOL,
                    "sequence": sequence,
                    "event_sha256": event["sha256"],
                    "state_sha256": event["state_sha256"],
                    "credential_id": principal["id"],
                },
                at,
            )
            db.execute(
                "INSERT INTO service_events VALUES (?,?)",
                (sequence, ev.canonical(event)),
            )
            self._service_links(db, state)
            return 201, {
                "result": result,
                "replayed": False,
                "head_sha256": event["sha256"],
                "unit": UNIT,
            }

        def _write(self, db, principal, method, route, body, at, audience=None):
            try:
                if route == ROOT_ROUTE + "/actions" and method == "POST":
                    return self._service_action(db, principal, body, at)
                if method == "POST" and re.fullmatch(
                    r"/v1/projects/[0-9a-f]{32}/artifacts", route
                ):
                    state, _, _ = self._service_load(db)
                    protected = {
                        ev.sha(
                            n.raw(
                                resources.report(
                                    order,
                                    state["listings"][order["listing_id"]],
                                    recompute=False,
                                )
                            )
                        )
                        for order in state["orders"].values()
                    }
                    lab.require(
                        body.get("digest") not in protected,
                        "SERVICE_JOB_PUBLICATION_REQUIRED",
                    )
                return super()._write(db, principal, method, route, body, at, audience)
            except ValueError as error:
                raise Problem(409, str(error)[:100]) from error

        def _jobs_write(self, db, principal, method, route, body, at):
            response = super()._jobs_write(db, principal, method, route, body, at)
            if route == "/v1/jobs/claim" and response[1].get("job") is not None:
                job = response[1]["job"]
                try:
                    prompt = ev.parse(job["prompt"].encode())
                except ValueError:
                    prompt = {}
                if type(prompt) is dict and prompt.get("protocol") == PROTOCOL:
                    state, _, _ = self._service_load(db)
                    order = state["orders"].get(prompt.get("order_id"))
                    lab.require(
                        order is not None
                        and order["state"] == "STARTED"
                        and order["job_id"] == job["id"],
                        "SERVICE_UNBOUND_JOB",
                    )
                    mandate, listing = (
                        state["mandates"][order["mandate_id"]],
                        state["listings"][order["listing_id"]],
                    )
                    lab.require(
                        not mandate["revoked"]
                        and listing["active"]
                        and at
                        < min(
                            order["start_before_ms"],
                            mandate["expires_ms"],
                            listing["expires_ms"],
                        ),
                        "SERVICE_START_NOT_AUTHORIZED",
                    )
                    self._service_member(db, order["buyer_id"], order["project_id"])
                    lab.require(
                        self._offer_available(
                            db, self._row(db, "offers", listing["community_offer_id"])
                        ),
                        "SERVICE_OFFER_UNAVAILABLE",
                    )
            return response

        def _job_complete(self, db, principal, job, body, at):
            state, _, _ = self._service_load(db)
            for candidate in state["orders"].values():
                candidate_report = resources.report(
                    candidate,
                    state["listings"][candidate["listing_id"]],
                    recompute=False,
                )
                if body.get("report_sha256") == ev.sha(n.raw(candidate_report)):
                    lab.require(
                        candidate["job_id"] == job["id"], "SERVICE_ORDER_JOB_REQUIRED"
                    )
            order = next(
                (o for o in state["orders"].values() if o["job_id"] == job["id"]), None
            )
            if order is not None and body.get("state") == "SUCCEEDED":
                report = resources.report(order, state["listings"][order["listing_id"]])
                lab.require(
                    body.get("report_sha256") == ev.sha(n.raw(report))
                    and type(body.get("report_bytes")) is int
                    and body["report_bytes"] == len(n.raw(report)),
                    "SERVICE_COMPLETION_CONTENT_MISMATCH",
                )
            return super()._job_complete(db, principal, job, body, at)

        def _read(self, db, route, token, at, limit, after):
            if route == "/v1/status":
                status, value = super()._read(db, route, token, at, limit, after)
                return status, {
                    **value,
                    "research_services": {
                        "protocol": PROTOCOL,
                        "catalog_sha256": resources.digest,
                        "unit": UNIT,
                        "financial_settlement": False,
                        "live_execution_allowed": False,
                    },
                }
            if not route.startswith(ROOT_ROUTE):
                return super()._read(db, route, token, at, limit, after)
            try:
                principal = self._authenticate(db, token, at)
                lab.require(not after, "SERVICE_CURSOR_NOT_SUPPORTED")
                state, head, _ = self._service_load(db)
                if route == ROOT_ROUTE + "/catalog":
                    self._role(principal, "AGENT")
                    return 200, deepcopy(resources.catalog)
                if route == ROOT_ROUTE + "/view":
                    who, role = principal["principal_id"], principal["role"]
                    mandates = {
                        k: v
                        for k, v in state["mandates"].items()
                        if role == "OWNER"
                        or role == "OPERATOR"
                        and v["operator_id"] == who
                        or role == "AGENT"
                        and v["buyer_id"] == who
                    }
                    orders = {
                        k: v
                        for k, v in state["orders"].items()
                        if v["mandate_id"] in mandates
                        or role == "AGENT"
                        and v["provider_id"] == who
                    }
                    listings = {
                        k: v
                        for k, v in state["listings"].items()
                        if role == "AGENT"
                        and db.execute(
                            "SELECT 1 FROM members WHERE project_id=? AND agent_id=?",
                            (v["project_id"], who),
                        ).fetchone()
                    }
                    return 200, {
                        "protocol": PROTOCOL,
                        "catalog_sha256": resources.digest,
                        "head_sha256": head,
                        "mandates": {
                            k: {**v, "accounting": balance(state, v)}
                            for k, v in mandates.items()
                        },
                        "listings": listings,
                        "orders": orders,
                        "unit": UNIT,
                        "financial_settlement": False,
                        "live_execution_allowed": False,
                    }
                match = re.fullmatch(
                    ROOT_ROUTE + r"/orders/([0-9a-f]{32})/(delivery|readiness|evidence)(?:/([0-9a-f]{64})/(0|[1-9][0-9]?))?", route
                )
                if match:
                    self._role(principal, "AGENT")
                    order = state["orders"].get(match.group(1))
                    lab.require(
                        order is not None
                        and principal["principal_id"]
                        in (order["buyer_id"], order["provider_id"]),
                        "SERVICE_ORDER_ACCESS",
                    )
                    self._service_member(
                        db, principal["principal_id"], order["project_id"]
                    )
                    kind, digest, index = match.group(2, 3, 4)
                    lab.require(digest is None or kind == "evidence", "SERVICE_ROUTE_NOT_FOUND")
                    listing = state["listings"][order["listing_id"]]
                    if kind == "evidence":
                        if digest is None:
                            return 200, resources.evidence.manifest(resources.digest, order["id"])
                        return 200, resources.evidence.chunk(resources.digest, order["id"], digest, int(index))
                    if kind == "readiness":
                        job = None if order["job_id"] is None else self._row(db, "jobs", order["job_id"])
                        queued = db.execute(
                            "SELECT * FROM jobs WHERE agent_id=? AND project_id=? AND state IN ('QUEUED','RUNNING')",
                            (order["provider_id"], order["project_id"]),
                        ).fetchall()
                        queue_clear = all(row["id"] == order["job_id"] for row in queued
                                          if self._job_effective(db, row, at)[0] in ("QUEUED", "RUNNING"))
                        job_state = None if job is None else self._job_effective(db, job, at)[0]
                        gates = readiness(state, order, principal["principal_id"], at,
                                          job_state,
                                          self._offer_available(db, self._row(db, "offers", listing["community_offer_id"])),
                                          queue_clear)
                        # A provider's membership alone does not authorize work
                        # for a buyer who is no longer an active project member.
                        try:
                            self._service_member(db, order["buyer_id"], order["project_id"])
                        except Problem:
                            gates["fulfill"].append("BUYER_MEMBERSHIP_REQUIRED")
                        return 200, {
                            "protocol": "AAI_SERVICE_READINESS_V1", "catalog_sha256": resources.digest,
                            "order_id": order["id"], "order_state": order["state"],
                            "job_state": job_state,
                            "observed_at_ms": at, "head_sha256": head, "blockers": gates,
                            "scope": "POINT_IN_TIME_RESEARCH_ACTION", "authorization_granted": False,
                            "financial_settlement": False, "live_execution_allowed": False,
                        }
                    lab.require(
                        order["state"] in ("DELIVERED", "ACCEPTED", "REJECTED"),
                        "SERVICE_NOT_DELIVERED",
                    )
                    self._service_completed_job(
                        db, order, listing, order["report_sha256"]
                    )
                    return 200, {
                        "order": order,
                        "report": resources.report(order, listing),
                        "head_sha256": head,
                        "content_sha256": order["report_sha256"],
                        "verification_scope": "PINNED_RESULT_AND_JOB_CONSISTENCY",
                        "independent_execution_attestation": False,
                        "financial_settlement": False,
                    }
                raise Problem(404, "SERVICE_ROUTE_NOT_FOUND")
            except ValueError as error:
                raise Problem(409, str(error)[:100]) from error

        def service_audit(self):
            with closing(self._connection()) as db:
                db.execute("BEGIN")
                state, head, requests = self._service_load(db)
                return {
                    "protocol": PROTOCOL,
                    "catalog_sha256": resources.digest,
                    "head_sha256": head,
                    "events": len(requests),
                    "state": state,
                    "accounting": {
                        k: balance(state, m) for k, m in state["mandates"].items()
                    },
                    "unit": UNIT,
                    "financial_settlement": False,
                    "live_execution_allowed": False,
                }

    from .blueprint_store import store_type as blueprint_store_type

    return blueprint_store_type(ServiceStore, Problem, resources)
