"""Restartable, oracle-bound experience admission and conservative advisory serving."""
from __future__ import annotations

from collections import Counter
from contextlib import closing
from pathlib import Path
import sqlite3

from . import behavior as b
from ..multi_brain_research import training_lab as lab
from ..solana_research import coin_evidence as ev

MAX_EVENTS = 2048
PROTOCOL = "AAI_VERIFIED_EXPERIENCE_JOURNAL_V1"
RECEIPT_FIELDS = ("origin_evidence_sha256", "project_id", "agent_id", "job_id", "artifact_id", "report_sha256", "domain")


def policy(registry, receivers):
    lab.require(type(registry) is dict and 1 <= len(registry) <= MAX_EVENTS
                and type(receivers) is list and 1 <= len(receivers) <= 32
                and all(type(x) is str and 1 <= len(x) <= 80 for x in receivers)
                and len(set(receivers)) == len(receivers), "EXPERIENCE_POLICY_BOUND")
    for identity, item in registry.items():
        lab.exact(item, ("case_sha256", "receipt"))
        lab.exact(item["receipt"], RECEIPT_FIELDS)
        lab.require(type(identity) is str and 1 <= len(identity) <= 80
                    and item["receipt"]["domain"] in b.DOMAINS, "EXPERIENCE_REGISTRY_IDENTITY")
        for key, value in item["receipt"].items():
            lab.require(type(value) is str and 1 <= len(value) <= 80, "EXPERIENCE_RECEIPT_VALUE")
            if key.endswith("sha256"):
                lab.pin(value)
        lab.pin(item["case_sha256"])
    return {"protocol": PROTOCOL, "registry": registry, "receivers": sorted(receivers),
            "trust": "LOCAL_ORACLE_REPLAY_AND_AUDITED_JOB_BINDING", "live_execution_allowed": False}


def empty():
    return {"cases": {}, "available_at": {}, "events": [], "requests": {}, "head": "0" * 64, "clock": 0}


def admission(request, clock, rules, state):
    try:
        lab.exact(request, ("case", "receipt", "receiver"))
        case = request["case"]
        lab.require(type(case) is dict and case.get("domain") in b.DOMAINS, "INVALID_CASE")
        b.validate_cases(case["domain"], [case])
    except (ValueError, KeyError, TypeError):
        return "QUARANTINED", "INVALID_CASE"
    if request["receiver"] not in rules["receivers"]:
        return "QUARANTINED", "RECEIVER_NOT_AUTHORIZED"
    expected = rules["registry"].get(case["id"])
    if expected is None or expected["case_sha256"] != lab.digest(case):
        return "QUARANTINED", "ORACLE_REPLAY_MISMATCH"
    if request["receipt"] != expected["receipt"] or request["receipt"]["domain"] != case["domain"]:
        return "QUARANTINED", "RECEIPT_BINDING_MISMATCH"
    if case["split"] != "train":
        return "QUARANTINED", "HOLDOUT_NOT_TRAINABLE"
    if case["resolved_at"] > clock:
        return "QUARANTINED", "OUTCOME_NOT_RESOLVED"
    source = (case["domain"], case["source_sha256"])
    if source in state["cases"]:
        return ("DUPLICATE", "SOURCE_ALREADY_ADMITTED") if state["cases"][source] == case else (
            "QUARANTINED", "CONFLICTING_SOURCE")
    if sum(key[0] == case["domain"] for key in state["cases"]) >= b.MAX_CASES:
        return "QUARANTINED", "MEMORY_BOUND"
    return "ACCEPTED", "VERIFIED_RESOLVED_TRAINING_OUTCOME"


def advance(state, event, rules):
    lab.exact(event, ("sequence", "previous_sha256", "clock", "request", "status", "reason", "sha256"))
    clock = event["clock"]
    lab.require(type(clock) is int and state["clock"] <= clock <= 10**9
                and type(event["sequence"]) is int and event["sequence"] == len(state["events"])
                and event["previous_sha256"] == state["head"], "EXPERIENCE_CHAIN_ORDER")
    body = {k: v for k, v in event.items() if k != "sha256"}
    lab.require(lab.digest(body) == event["sha256"], "EXPERIENCE_CHAIN_HASH")
    status, reason = admission(event["request"], clock, rules, state)
    lab.require(status != "DUPLICATE" and (event["status"], event["reason"]) == (status, reason),
                "EXPERIENCE_ADMISSION_REPLAY")
    identity = lab.digest([clock, event["request"]])
    lab.require(identity not in state["requests"], "EXPERIENCE_EVENT_REPLAY")
    state["requests"][identity] = event
    if status == "ACCEPTED":
        case = event["request"]["case"]
        state["cases"][(case["domain"], case["source_sha256"])] = case
        state["available_at"][(case["domain"], case["source_sha256"])] = clock
    state["events"].append(event)
    state["clock"], state["head"] = clock, event["sha256"]


class ExperienceJournal:
    def __init__(self, path, rules):
        self.path = Path(path).resolve()
        lab.require(rules == policy(rules["registry"], rules["receivers"]), "EXPERIENCE_POLICY_SCOPE")
        # Freeze caller-owned dictionaries so later mutation cannot change admission authority.
        self.rules = ev.parse(ev.canonical(rules).encode())

    def initialize(self):
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with self.path.open("xb"):
            pass
        self.path.chmod(0o600)
        with closing(sqlite3.connect(self.path)) as connection:
            connection.executescript("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; "
                "CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); "
                "CREATE TABLE events (sequence INTEGER PRIMARY KEY, body TEXT NOT NULL);")
            connection.execute("INSERT INTO metadata VALUES ('policy_sha256', ?)", (lab.digest(self.rules),))
            connection.commit()
        return self

    def _connect(self, *, readonly):
        lab.require(self.path.is_file() and not self.path.is_symlink()
                    and self.path.stat().st_size <= 8 * 1024**2, "EXPERIENCE_DATABASE_FILE")
        # DELETE-mode journals need normal SQLite locks when a different process can write.
        uri = self.path.as_uri() + ("?mode=ro" if readonly else "?mode=rw")
        connection = sqlite3.connect(uri, uri=True, timeout=10)
        connection.execute("PRAGMA trusted_schema=OFF")
        if not readonly:
            connection.execute("PRAGMA synchronous=FULL")
        return connection

    def _replay(self, connection):
        lab.require(connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "EXPERIENCE_SQLITE_INTEGRITY")
        lab.require(connection.execute("PRAGMA journal_mode").fetchone()[0] == "delete", "EXPERIENCE_JOURNAL_MODE")
        lab.require(connection.execute("SELECT key,value FROM metadata").fetchall()
                    == [("policy_sha256", lab.digest(self.rules))], "EXPERIENCE_POLICY_BINDING")
        rows = connection.execute("SELECT sequence,body FROM events ORDER BY sequence").fetchall()
        lab.require(len(rows) <= MAX_EVENTS, "EXPERIENCE_EVENT_BOUND")
        state = empty()
        for sequence, raw in rows:
            event = ev.parse(raw.encode())
            lab.require(sequence == event["sequence"], "EXPERIENCE_SQL_SEQUENCE")
            advance(state, event, self.rules)
        return state

    def admit_many(self, requests, clock):
        lab.require(type(requests) is list and 1 <= len(requests) <= MAX_EVENTS
                    and type(clock) is int and 0 <= clock <= 10**9, "EXPERIENCE_BATCH_BOUND")
        lab.require(len(ev.canonical(requests).encode()) <= 4 * 1024**2, "EXPERIENCE_REQUEST_BOUND")
        with closing(self._connect(readonly=False)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            state, results = self._replay(connection), []
            lab.require(clock >= state["clock"], "EXPERIENCE_CLOCK_REWIND")
            for request in requests:
                identity = lab.digest([clock, request])
                status, reason = admission(request, clock, self.rules, state)
                if identity in state["requests"] or status == "DUPLICATE":
                    results.append({"status": "DUPLICATE", "reason": reason, "appended": False})
                    continue
                lab.require(len(state["events"]) < MAX_EVENTS, "EXPERIENCE_EVENT_BOUND")
                body = {"sequence": len(state["events"]), "previous_sha256": state["head"], "clock": clock,
                        "request": request, "status": status, "reason": reason}
                event = {**body, "sha256": lab.digest(body)}
                advance(state, event, self.rules)
                connection.execute("INSERT INTO events VALUES (?, ?)", (event["sequence"], ev.canonical(event)))
                results.append({"status": status, "reason": reason, "appended": True})
            connection.commit()
        return results

    def state(self):
        with closing(self._connect(readonly=True)) as connection:
            connection.execute("BEGIN")
            return self._replay(connection)

    def training(self, domain, cutoff):
        lab.require(domain in b.DOMAINS and type(cutoff) is int and 0 <= cutoff <= 10**9, "EXPERIENCE_TRAINING_SCOPE")
        state = self.state()
        lab.require(cutoff <= state["clock"], "EXPERIENCE_UNOBSERVED_CLOCK")
        return [row for key, row in state["cases"].items() if key[0] == domain
                and row["resolved_at"] <= cutoff and state["available_at"][key] <= cutoff]

    def audit(self):
        state = self.state()
        contexts = {domain: {} for domain in b.DOMAINS}
        for (domain, _), case in state["cases"].items():
            key = lab.digest(case["features"])
            contexts[domain].setdefault(key, set()).add(case["target"])
        return {"protocol": PROTOCOL, "events": len(state["events"]), "head_sha256": state["head"],
                "clock": state["clock"], "policy_sha256": lab.digest(self.rules),
                "accepted": len(state["cases"]),
                "quarantined": dict(Counter(e["reason"] for e in state["events"] if e["status"] == "QUARANTINED")),
                "blocked_contexts": {d: sorted(k for k, labels in values.items() if len(labels) > 1)
                                     for d, values in contexts.items()}, "live_execution_allowed": False}


def guarded_predict(model, features, audit):
    lab.require(audit["protocol"] == PROTOCOL and audit["live_execution_allowed"] is False, "EXPERIENCE_GUARD_SCOPE")
    result = b.predict(model, features)
    if lab.digest(features) in audit["blocked_contexts"][model["domain"]]:
        return {**result, "prediction": None, "probability_ppm": None, "action": "ABSTAIN",
                "reason": "CONTRADICTORY_VERIFIED_OUTCOMES", "advisory_model_sha256": lab.digest(model)}
    return {**result, "reason": "UNKNOWN_OR_UNDERSUPPORTED_PATTERN" if result["prediction"] is None else "QUALIFIED_ADVISORY",
            "advisory_model_sha256": lab.digest(model)}


def evaluate(incumbent, candidate, training, retention, future):
    domain = incumbent["domain"]
    for rows in (training, retention, future):
        b.validate_cases(domain, rows)
    b.validate_model(incumbent)
    b.validate_model(candidate)
    lab.require(candidate == b.fit(domain, training, candidate["cutoff"]), "EXPERIENCE_MODEL_RECONSTRUCTION")
    lab.require(all(c["split"] == "train" for c in training)
                and all(c["split"] == "holdout" for c in retention + future)
                and all(candidate["cutoff"] < c["observed_at"] for c in future), "EXPERIENCE_EVALUATION_TIME")
    train_sources = {c["source_sha256"] for c in training}
    held_sources = [c["source_sha256"] for c in retention + future]
    lab.require(not train_sources & set(held_sources) and len(held_sources) == len(set(held_sources))
                and not {c["group"] for c in training} & {c["group"] for c in retention + future}
                and not {c["group"] for c in retention} & {c["group"] for c in future},
                "EXPERIENCE_EVALUATION_LEAKAGE")
    scores = {}
    for name, model in (("baseline", incumbent), ("candidate", candidate)):
        scores[name] = {label: b.measure(domain, [b.predict(model, c["features"])["prediction"] for c in rows], rows)
                        for label, rows in (("retention", retention), ("future", future))}
    new, old = scores["candidate"], scores["baseline"]
    reasons = []
    for failed, reason in ((len(training) < 32 or min(len(retention), len(future)) < 16, "COHORT_TOO_SMALL"),
            (min(new["future"]["zero_examples"], new["future"]["one_examples"]) < 4, "FUTURE_CLASS_SUPPORT"),
            (new["future"]["coverage_ppm"] < 750000 or new["future"]["balanced_accuracy_ppm"] < 750000, "FUTURE_QUALITY"),
            (new["future"]["balanced_accuracy_ppm"] < old["future"]["balanced_accuracy_ppm"] + 50000, "NO_NEW_TASK_IMPROVEMENT"),
            (new["retention"]["balanced_accuracy_ppm"] < old["retention"]["balanced_accuracy_ppm"], "RETENTION_REGRESSION"),
            (new["future"]["critical_errors"] + new["retention"]["critical_errors"] > 0, "CRITICAL_ADVISORY_ERRORS")):
        if failed:
            reasons.append(reason)
    return {"protocol": "AAI_EXPERIENCE_EVALUATION_V1", "domain": domain, "scores": scores,
            "candidate": new["future"], "eligible": not reasons, "reasons": reasons,
            "training_sha256": lab.digest(training), "retention_sha256": lab.digest(retention),
            "future_sha256": lab.digest(future), "scope": b.SCOPE, "live_execution_allowed": False}
