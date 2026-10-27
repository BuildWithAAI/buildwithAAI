"""Ledger-derived experience and fail-closed qualification of research recipes.

An accepted research report is evidence of a recorded task, not proof that the
agent learned the recipe or that it works in a market. V1 recipes contain no
agent-derivation or held-out outcome contract and cannot qualify for that claim.
"""

from collections import Counter
from copy import deepcopy
import os
import tempfile

from . import blueprints as b, network as n, services as s, service_evidence as e
from ..multi_brain_research import training_lab as lab
from ..solana_research import coin_evidence as ev

PROTOCOL = "AAI_BLUEPRINT_EVIDENCE_V1"
POLICY = "AAI_BLUEPRINT_SUCCESS_POLICY_V1"
REPLAY = "AAI_BLUEPRINT_REPLAY_V1"
TRANSCRIPT = "AAI_AGENT_RESEARCH_TRANSCRIPT_V1"
MAX_REPLAY_BYTES = ev.MAX_FILE
STATES = ("OPEN", "STARTED", "DELIVERED", "ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED", "FAILED")
TRIAL_FIELDS = ("id", "state", "listing_id", "buyer_id", "provider_id", "project_id",
                "job_id", "artifact_id", "report_sha256", "work_units")


def declaration(catalog):
    return {"protocol": PROTOCOL, "policy": POLICY, "catalog_sha256": lab.pin(catalog),
            "default_discovery": "VERIFIED_AGENT_SUCCESS_ONLY", "portable_replay": REPLAY,
            "transcript": TRANSCRIPT,
            "financial_settlement": False, "live_execution_allowed": False}


def qualification(package, catalog):
    """Only a typed, implemented outcome verifier may qualify a future format.

    No seller flag, price, prose, accepted order count or source classification
    can upgrade the supported research-recipe format to a successful strategy.
    """
    package = b.validate_package(package, catalog)
    source = catalog["resources"][package["recipe"]["service"]]
    blockers = ["NO_AGENT_DERIVATION_RECORD", "NO_HELD_OUT_OUTCOME_CONTRACT",
                "RECIPE_VERIFIES_REPORT_CONSISTENCY_ONLY"]
    if source["source_scope"] == "PINNED_SYNTHETIC_MODEL_EXERCISE":
        blockers.append("SYNTHETIC_MODEL_EXERCISE")
    return {"policy": POLICY, "classification": "UNQUALIFIED_RESEARCH_CANDIDATE",
            "blockers": blockers, "agent_derivation_verified": False,
            "success_verified": False, "profit_verified": False, "marketplace_eligible": False}


def dossier(listing, license_, services, catalog, blueprint_head, service_head, operators):
    """All retained same-provider/project/recipe work, including other versions.

    Other buyers' IDs and reports are deliberately absent. Operators are local
    account relationships; distinct operators do not prove independent people.
    Callers must first replay the service ledger and its job/artifact bindings.
    """
    recipe = listing["recipe"]
    matching = []
    for order in services["orders"].values():
        source = services["listings"][order["listing_id"]]
        if (order["provider_id"] == listing["provider_id"] and order["project_id"] == listing["project_id"]
                and source["service"] == recipe["service"] and source["resource_sha256"] == recipe["resource_sha256"]):
            matching.append(order)
    counts = Counter(order["state"] for order in matching)
    accepted = [order for order in matching if order["state"] == "ACCEPTED"]
    completed = [order for order in matching if order["state"] in ("DELIVERED", "ACCEPTED", "REJECTED")]
    provider_operator = n.identity(operators[listing["provider_id"]])
    buyer_operators = {n.identity(operators[order["buyer_id"]]) for order in accepted}
    source = catalog["resources"][recipe["service"]]
    value = {
        "protocol": PROTOCOL, "catalog_sha256": lab.digest(catalog),
        "blueprint_head_sha256": lab.pin(blueprint_head), "service_head_sha256": lab.pin(service_head),
        "listing_id": listing["id"], "provider_id": listing["provider_id"], "project_id": listing["project_id"],
        "package_sha256": listing["terms"]["package_sha256"], "recipe": deepcopy(recipe),
        "qualification": qualification(listing["package"], catalog),
        "source_scope": source["source_scope"],
        "track_record": {
            "scope": "ALL_RETAINED_MATCHING_PROVIDER_PROJECT_RESOURCE_ORDERS",
            "orders": len(matching), "states": {state: counts[state] for state in STATES},
            "distinct_accepting_agents": len({order["buyer_id"] for order in accepted}),
            "distinct_accepting_operators": len(buyer_operators),
            "same_operator_acceptances": sum(operators[o["buyer_id"]] == provider_operator for o in accepted),
            # Every matching order runs the same immutable catalog resource.
            "distinct_completed_input_sets": int(bool(completed)),
            "distinct_completed_result_sets": int(bool(completed)),
            "result_sha256": source["result_sha256"] if completed else None,
            "consumed_work_units": sum(order["work_units"] for order in accepted), "unit": s.UNIT,
            "independent_people_verified": False, "lifetime_history_complete": False,
        },
        "license_id": None if license_ is None else license_["id"],
        "trials": [] if license_ is None else [
            {key: deepcopy(services["orders"][order_id][key]) for key in TRIAL_FIELDS}
            for order_id in license_["trial_orders"]],
        "verification_scope": "LOCAL_LEDGER_JOB_ARTIFACT_BINDINGS",
        "independent_execution_attestation": False, "financial_settlement": False, "live_execution_allowed": False,
    }
    value["sha256"] = lab.digest(value)
    return value


def validate_dossier(value, delivery, catalog):
    """Validate a server assertion; this is not an independent ledger proof."""
    lab.exact(value, ("protocol", "catalog_sha256", "blueprint_head_sha256", "service_head_sha256",
                      "listing_id", "provider_id", "project_id", "package_sha256", "recipe", "qualification",
                      "source_scope", "track_record", "license_id", "trials", "verification_scope",
                      "independent_execution_attestation", "financial_settlement", "live_execution_allowed", "sha256"))
    license_, listing, package = delivery["license"], delivery["listing"], delivery["package"]
    lab.require(value["protocol"] == PROTOCOL and value["catalog_sha256"] == lab.digest(catalog)
                and value["license_id"] == license_["id"] and value["listing_id"] == listing["id"]
                and all(value[key] == license_[key] for key in ("provider_id", "project_id", "package_sha256"))
                and n.same(value["recipe"], package["recipe"])
                and n.same(value["qualification"], qualification(package, catalog))
                and value["source_scope"] == catalog["resources"][package["recipe"]["service"]]["source_scope"]
                and value["verification_scope"] == "LOCAL_LEDGER_JOB_ARTIFACT_BINDINGS"
                and value["independent_execution_attestation"] is False and value["financial_settlement"] is False
                and value["live_execution_allowed"] is False, "BLUEPRINT_EVIDENCE_BINDING")
    for key in ("blueprint_head_sha256", "service_head_sha256", "sha256"):
        lab.pin(value[key])
    lab.require(value["sha256"] == lab.digest({k: v for k, v in value.items() if k != "sha256"}),
                "BLUEPRINT_EVIDENCE_HASH")
    track = value["track_record"]
    lab.exact(track, ("scope", "orders", "states", "distinct_accepting_agents", "distinct_accepting_operators",
                      "same_operator_acceptances", "distinct_completed_input_sets", "distinct_completed_result_sets",
                      "result_sha256", "consumed_work_units", "unit", "independent_people_verified", "lifetime_history_complete"))
    lab.exact(track["states"], STATES)
    total = b.integer(track["orders"], 0, s.MAX_ORDERS)
    for count in track["states"].values():
        b.integer(count, 0, total)
    accepted = track["states"]["ACCEPTED"]
    completed = sum(track["states"][state] for state in ("DELIVERED", "ACCEPTED", "REJECTED"))
    buyers = b.integer(track["distinct_accepting_agents"], int(bool(accepted)), accepted)
    b.integer(track["distinct_accepting_operators"], int(bool(accepted)), buyers)
    b.integer(track["same_operator_acceptances"], 0, accepted)
    b.integer(track["consumed_work_units"], accepted, accepted * 1000)
    for key in ("distinct_completed_input_sets", "distinct_completed_result_sets"):
        lab.require(type(track[key]) is int and track[key] == int(bool(completed)), "BLUEPRINT_EVIDENCE_REPETITIONS")
    lab.require(sum(track["states"].values()) == total
                and track["scope"] == "ALL_RETAINED_MATCHING_PROVIDER_PROJECT_RESOURCE_ORDERS"
                and track["unit"] == s.UNIT and track["independent_people_verified"] is False
                and track["lifetime_history_complete"] is False
                and track["result_sha256"] == (catalog["resources"][package["recipe"]["service"]]["result_sha256"]
                                               if completed else None), "BLUEPRINT_EVIDENCE_TRACK_RECORD")
    trials = value["trials"]
    lab.require(type(trials) is list and len(trials) == len(license_["trial_orders"]), "BLUEPRINT_EVIDENCE_TRIALS")
    for order_id, trial in zip(license_["trial_orders"], trials, strict=True):
        lab.exact(trial, TRIAL_FIELDS)
        lab.require(trial["id"] == order_id and trial["listing_id"] == listing["service_listing_id"]
                    and trial["state"] in STATES
                    and all(trial[key] == license_[key] for key in ("buyer_id", "provider_id", "project_id")),
                    "BLUEPRINT_EVIDENCE_TRIAL_BINDING")
        for key in ("job_id", "artifact_id"):
            if trial[key] is not None:
                n.identity(trial[key])
        if trial["report_sha256"] is not None:
            lab.pin(trial["report_sha256"])
        b.integer(trial["work_units"], 1, 1000)
    trial_counts = Counter(t["state"] for t in trials)
    lab.require(all(count <= track["states"][state] for state, count in trial_counts.items()), "BLUEPRINT_EVIDENCE_TRIALS")
    return deepcopy(value)


def transcript(license_, blueprint_head, service_head, blueprint_events, service_events):
    """Project only this license's retained events, preserving server timestamps."""
    entries = []
    for ledger, events in (("BLUEPRINT", blueprint_events), ("SERVICE", service_events)):
        for event in events:
            target = event["result"]["id"]
            selected = (target in (license_["id"], license_["listing_id"]) if ledger == "BLUEPRINT"
                        else target in license_["trial_orders"])
            if selected:
                entries.append({"ledger": ledger, "sequence": event["sequence"],
                    "audit_sequence": event["audit_sequence"], "at_ms": event["at_ms"],
                    "actor_role": event["actor"]["role"], "actor_id": event["actor"]["principal_id"],
                    "credential_id": event["actor"]["credential_id"],
                    "action": event["command"]["kind"], "request_id": event["command"]["request_id"],
                    "resource_id": target, "event_sha256": event["sha256"],
                    "result_sha256": lab.digest(event["result"])})
    entries.sort(key=lambda entry: entry["audit_sequence"])
    value = {"protocol": TRANSCRIPT, "license_id": license_["id"], "project_id": license_["project_id"],
             "buyer_id": license_["buyer_id"], "provider_id": license_["provider_id"],
             "blueprint_head_sha256": lab.pin(blueprint_head), "service_head_sha256": lab.pin(service_head),
             "entries": entries, "scope": "LICENSE_AND_REGISTERED_TRIAL_EVENTS",
             "timestamp_source": "COMMUNITY_SERVER_CLOCK", "storage": "LOCAL_AUDITED_SQLITE",
             "onchain_recorded": False, "independent_execution_attestation": False,
             "financial_settlement": False, "live_execution_allowed": False}
    value["sha256"] = lab.digest(value)
    return value


def validate_transcript(value, delivery, record):
    lab.exact(value, ("protocol", "license_id", "project_id", "buyer_id", "provider_id", "blueprint_head_sha256",
                      "service_head_sha256", "entries", "scope", "timestamp_source", "storage", "onchain_recorded",
                      "independent_execution_attestation", "financial_settlement", "live_execution_allowed", "sha256"))
    license_ = delivery["license"]
    lab.require(value["protocol"] == TRANSCRIPT and value["license_id"] == license_["id"]
                and all(value[key] == license_[key] for key in ("project_id", "buyer_id", "provider_id"))
                and all(value[key] == record[key] for key in ("blueprint_head_sha256", "service_head_sha256"))
                and value["scope"] == "LICENSE_AND_REGISTERED_TRIAL_EVENTS"
                and value["timestamp_source"] == "COMMUNITY_SERVER_CLOCK" and value["storage"] == "LOCAL_AUDITED_SQLITE"
                and all(value[key] is False for key in ("onchain_recorded", "independent_execution_attestation",
                                                       "financial_settlement", "live_execution_allowed"))
                and value["sha256"] == lab.digest({k: v for k, v in value.items() if k != "sha256"}),
                "BLUEPRINT_TRANSCRIPT_BINDING")
    entries = value["entries"]
    lab.require(type(entries) is list and 2 <= len(entries) <= b.MAX_EVENTS + s.MAX_EVENTS, "BLUEPRINT_TRANSCRIPT_BOUND")
    audit, at, sequences = 0, 0, {"BLUEPRINT": -1, "SERVICE": -1}
    published, acquired = False, False
    for entry in entries:
        lab.exact(entry, ("ledger", "sequence", "audit_sequence", "at_ms", "actor_role", "actor_id", "credential_id", "action",
                          "request_id", "resource_id", "event_sha256", "result_sha256"))
        ledger = entry["ledger"]
        lab.require(type(ledger) is str and ledger in sequences, "BLUEPRINT_TRANSCRIPT_LEDGER")
        sequences[ledger] = b.integer(entry["sequence"], sequences[ledger] + 1, b.MAX_EVENTS + s.MAX_EVENTS)
        audit = b.integer(entry["audit_sequence"], audit + 1, 2**53 - 1)
        at = b.integer(entry["at_ms"], at, 2**53 - 1)
        for key in ("actor_id", "credential_id", "request_id", "resource_id"):
            n.identity(entry[key])
        lab.require((entry["actor_role"] == "AGENT" and entry["actor_id"] in (license_["buyer_id"], license_["provider_id"]))
                    or (entry["actor_role"] == "OPERATOR" and ledger == "SERVICE" and entry["action"] in ("EXPIRE", "ABORT_FAILED")),
                    "BLUEPRINT_TRANSCRIPT_ACTOR")
        for key in ("event_sha256", "result_sha256"):
            lab.pin(entry[key])
        lab.require(type(entry["action"]) is str and entry["action"] in (b.FIELDS if ledger == "BLUEPRINT" else s.COMMAND_FIELDS),
                    "BLUEPRINT_TRANSCRIPT_ACTION")
        targets = (license_["id"], license_["listing_id"]) if ledger == "BLUEPRINT" else license_["trial_orders"]
        lab.require(entry["resource_id"] in targets, "BLUEPRINT_TRANSCRIPT_RESOURCE")
        if ledger == "BLUEPRINT" and entry["action"] == "PUBLISH":
            lab.require(not published and entry["resource_id"] == license_["listing_id"]
                        and entry["actor_id"] == license_["provider_id"], "BLUEPRINT_TRANSCRIPT_PUBLISH")
            published = True
        if ledger == "BLUEPRINT" and entry["action"] == "ACQUIRE":
            lab.require(published and not acquired and entry["resource_id"] == license_["id"]
                        and entry["actor_id"] == license_["buyer_id"] and at == license_["acquired_ms"], "BLUEPRINT_TRANSCRIPT_ACQUIRE")
            acquired = True
    lab.require(published and acquired, "BLUEPRINT_TRANSCRIPT_ORIGIN")
    return deepcopy(value)


def replay_package(delivery, record, history, order, source, resources):
    value = {"protocol": REPLAY, "delivery": deepcopy(delivery), "evidence": deepcopy(record),
             "transcript": deepcopy(history),
             "order": deepcopy(order), "service_listing": deepcopy(source),
             "catalog": deepcopy(resources.catalog), "bundle": deepcopy(resources.bundle),
             "input_manifest": resources.evidence.manifest(resources.digest, order["id"]),
             "input_data": ev.parse(resources.evidence.payload), "report": resources.report(order, source)}
    lab.require(len(n.raw(value)) <= MAX_REPLAY_BYTES, "BLUEPRINT_REPLAY_BOUND")
    return value


def replay(value, expected_sha256, trusted_controller):
    """Reproduce retained inputs/results offline, never execute seller text.

    The external file hash anchors the received snapshot. Its ledger/identity
    assertions still depend on the issuing server; hashes are not attestations.
    """
    payload = n.raw(value)
    lab.require(0 < len(payload) <= MAX_REPLAY_BYTES and ev.sha(payload) == lab.pin(expected_sha256),
                "BLUEPRINT_REPLAY_PIN")
    lab.exact(value, ("protocol", "delivery", "evidence", "transcript", "order", "service_listing", "catalog", "bundle",
                      "input_manifest", "input_data", "report"))
    lab.require(value["protocol"] == REPLAY, "BLUEPRINT_REPLAY_PROTOCOL")
    delivery, order, source, catalog = (value[key] for key in ("delivery", "order", "service_listing", "catalog"))
    license_ = delivery["license"]
    b.verify_delivery(delivery, license_["id"], license_["buyer_id"], license_["package_sha256"], license_["terms_sha256"], catalog)
    record = validate_dossier(value["evidence"], delivery, catalog)
    history = validate_transcript(value["transcript"], delivery, record)
    trials = {trial["id"]: trial for trial in record["trials"]}
    lab.require(order["id"] in trials and order["state"] in ("DELIVERED", "ACCEPTED", "REJECTED")
                and n.same(trials[order["id"]], {key: order[key] for key in TRIAL_FIELDS})
                and order["job_id"] is not None and order["artifact_id"] is not None,
                "BLUEPRINT_REPLAY_TRIAL_BINDING")
    recipe = delivery["package"]["recipe"]
    lab.exact(order, (*TRIAL_FIELDS, "mandate_id", "start_before_ms"))
    n.identity(order["mandate_id"])
    b.integer(order["start_before_ms"], 0, 2**53 - 1)
    expected_terms = s.terms(source["service"], source["resource_sha256"], source["work_units"], source["expires_ms"])
    lab.exact(source, (*expected_terms, "id", "provider_id", "project_id", "community_offer_id", "terms_sha256", "active"))
    lab.require(source["id"] == order["listing_id"]
                and all(source[key] == order[key] for key in ("provider_id", "project_id"))
                and all(source[key] == recipe[key] for key in ("service", "resource_sha256"))
                and n.same({key: source[key] for key in expected_terms}, expected_terms)
                and source["terms_sha256"] == lab.digest(expected_terms)
                and type(source["active"]) is bool and source["work_units"] == order["work_units"],
                "BLUEPRINT_REPLAY_SERVICE_BINDING")
    n.identity(source["community_offer_id"])
    manifest = value["input_manifest"]
    # Model exercises also retain the complete feed dependency used by Resources.
    inputs = value["input_data"]
    e.validate_manifest(manifest, lab.digest(catalog), order["id"],
                        lab.pin(inputs["feed_head_sha256"]), lab.pin(inputs["feed_policy_sha256"]))
    with tempfile.TemporaryDirectory(prefix="aai-blueprint-replay-") as temporary:
        journal = e.restore(n.raw(inputs), manifest, temporary)
        resources = s.Resources(value["bundle"], lab.pin(trusted_controller), journal,
                                manifest["feed_head_sha256"], manifest["feed_policy_sha256"])
        lab.require(n.same(resources.catalog, catalog), "BLUEPRINT_REPLAY_CATALOG")
        report = resources.report(order, source)
        lab.require(n.same(report, value["report"]) and ev.sha(n.raw(report)) == order["report_sha256"],
                    "BLUEPRINT_REPLAY_REPORT")
        intake = resources.results["scanner_replay_audit"]["intake_status"]
    return {"protocol": REPLAY, "snapshot_sha256": expected_sha256, "license_id": license_["id"],
            "transcript_sha256": history["sha256"], "recorded_events": len(history["entries"]),
            "order_id": order["id"], "provider_id": order["provider_id"], "package_sha256": license_["package_sha256"],
            "report_sha256": order["report_sha256"], "input_payload_sha256": manifest["payload_sha256"],
            "records": manifest["records"], "source_statuses": intake["statuses"],
            "source_attestation": intake["source_attestation"], "source_scope": record["source_scope"],
            "report_reproduced": True, "qualification": record["qualification"],
            "ledger_verification": "ISSUING_SERVER_ASSERTION_NOT_PORTABLE_ATTESTATION",
            "agent_derivation_verified": False, "success_verified": False, "profit_verified": False,
            "instructions_executed": False, "financial_settlement": False, "live_execution_allowed": False}


def save(path, value):
    """Exclusive bounded output; a retry can reuse identical bytes only."""
    path = n.safe_path(path)
    payload = n.raw(value)
    lab.require(len(payload) <= MAX_REPLAY_BYTES, "BLUEPRINT_REPLAY_BOUND")
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            lab.require(stream.write(payload) == len(payload), "BLUEPRINT_EVIDENCE_SHORT_WRITE")
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError:
        lab.require(path.is_file() and path.stat().st_nlink == 1 and path.stat().st_size == len(payload)
                    and path.read_bytes() == payload, "BLUEPRINT_EVIDENCE_OUTPUT_CONFLICT")


def replay_file(path, expected_sha256, trusted_controller):
    path = n.safe_path(path)
    lab.require(path.is_file() and path.stat().st_nlink == 1 and 0 < path.stat().st_size <= MAX_REPLAY_BYTES,
                "BLUEPRINT_REPLAY_BOUND")
    payload = path.read_bytes()
    lab.require(ev.sha(payload) == lab.pin(expected_sha256), "BLUEPRINT_REPLAY_PIN")
    value = ev.parse(payload)
    lab.require(payload == n.raw(value), "BLUEPRINT_REPLAY_CANONICAL")
    return replay(value, expected_sha256, trusted_controller)
