"""Pinned specialist sharing, persistent experience replay and Reef qualification."""
from __future__ import annotations

from contextlib import closing
from copy import deepcopy
from pathlib import Path
import socket
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ecosystem_research import behavior as b, experience as x, experience_tasks, reef_adapter  # noqa: E402
from src.ecosystem_research.checkout import verify_checkout  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402
from scripts import ecosystem_behavior_worker as previous  # noqa: E402

ROLES = previous.ROLES


def cases_for(curriculum, domain):
    return [row for stage in ("extension", "drift", "novelty") for row in curriculum["batches"][stage][domain]]


def reports_for(parent, curriculum):
    original = ev.read(parent / "tasks.json")
    reports = {}
    for domain, role in ROLES.items():
        before = ev.read(parent / (role + ".json"))["model"]
        old = original["cases"][domain]
        new = curriculum["batches"]["extension"][domain]
        training = [c for c in old + new if c["split"] == "train"]
        retention = [c for c in old if c["split"] == "holdout"]
        future = [c for c in new if c["split"] == "holdout"]
        candidate = b.fit(domain, training, 250000)
        evaluation = x.evaluate(before, candidate, training, retention, future)
        reports[domain] = {"protocol": "AAI_EXPERIENCE_DOMAIN_REPORT_V1", "domain": domain,
                           "model": candidate, "incumbent": before, "evaluation": evaluation,
                           "cases_sha256": lab.digest(cases_for(curriculum, domain)),
                           "scope": b.SCOPE, "actual_execution_authorized": False, "live_execution_allowed": False}
    return reports


def build_jobs(output, community, parent, curriculum, reports):
    sys.path.insert(0, str(community / "projects/zoora-agent-community"))
    from zoora_community.store import Store
    from zoora_community.validation import Problem
    from scripts.ecosystem_worker import dispatch, enroll
    credential = output / "owner.credential"
    store = Store.initialize(output / "agents", credential)
    owner = ev.read(credential)["token"]
    try:
        producers = {d: enroll(store, owner, role) for d, role in ROLES.items()}
        receiver, receiver_token = enroll(store, owner, "memory_reader")
        creator, token = producers[b.DOMAINS[0]]
        _, project = store.call("POST", "/v1/projects", {"title": "Verified specialist experience",
                               "summary": "Controlled task variants and advisory memory; local public test identities"}, token)
        for agent, _ in list(producers.values()) + [(receiver, receiver_token)]:
            if agent != creator:
                store.call("POST", f"/v1/projects/{project['id']}/members", {"agent_id": agent}, token)
        jobs = {}
        for domain, (_, producer_token) in producers.items():
            def handler(domain=domain):
                value = reports_for(parent, curriculum)[domain]
                lab.require(value == reports[domain], "EXPERIENCE_HANDLER_REPLAY")
                return value
            jobs[domain] = dispatch(store, producer_token, project["id"], ROLES[domain], lab.digest(curriculum), output, handler)
        _, artifacts = store.call("GET", f"/v1/projects/{project['id']}/artifacts", token=receiver_token)
        _, members = store.call("GET", f"/v1/projects/{project['id']}/members", token=receiver_token)
        lab.require(len(artifacts["items"]) == 4 and any(m["agent_id"] == receiver for m in members["items"]),
                    "EXPERIENCE_SHARED_PROJECT")
        for job in jobs.values():
            try:
                store.call("GET", "/v1/jobs/" + job["job_id"], token=receiver_token)
            except Problem as error:
                lab.require(error.code == "FORBIDDEN", "EXPERIENCE_PRIVATE_JOB_SCOPE")
            else:
                raise ValueError("EXPERIENCE_PRIVATE_JOB_VISIBLE")
        access = {"receiver_id": receiver, "project_id": project["id"],
                  "artifact_digests": sorted(a["digest"] for a in artifacts["items"]),
                  "membership_verified": True, "private_jobs_hidden": True, "live_execution_allowed": False}
        ev.write(output / "access.json", access)
        ev.write(output / "jobs.json", {"protocol": "AAI_BEHAVIOR_JOBS_V1", "jobs": jobs,
                 "project_id": project["id"], "audit": store.audit(), "cross_agent_reads_denied": True,
                 "identity_mode": "LOCAL_PUBLIC_TEST_KEYS", "live_execution_allowed": False})
    finally:
        credential.unlink(missing_ok=True)


def verify_jobs(output, community):
    jobs = previous.verify_jobs(output, community)
    access = ev.read(output / "access.json")
    expected = {"receiver_id": access["receiver_id"], "project_id": jobs["project_id"],
                "artifact_digests": sorted(j["report_sha256"] for j in jobs["jobs"].values()),
                "membership_verified": True, "private_jobs_hidden": True, "live_execution_allowed": False}
    lab.require(access == expected, "EXPERIENCE_ACCESS_REPLAY")
    with closing(sqlite3.connect((output / "agents/community.sqlite3").as_uri() + "?mode=ro&immutable=1", uri=True)) as connection:
        lab.require(connection.execute("SELECT COUNT(*) FROM agents").fetchone()[0] == 5
                    and connection.execute("SELECT COUNT(*) FROM members WHERE project_id=? AND agent_id=?",
                                           (jobs["project_id"], access["receiver_id"])).fetchone()[0] == 1,
                    "EXPERIENCE_RECEIVER_MEMBERSHIP")
    return jobs, access


def registry_for(parent, curriculum, jobs, access):
    original, prior_jobs = ev.read(parent / "tasks.json"), ev.read(parent / "jobs.json")
    registry = {}
    for stage, domains, source_jobs, origin in (
            ("bootstrap", original["cases"], prior_jobs, ev.sha((parent / "manifest.json").read_bytes())),
            ("extension", {d: cases_for(curriculum, d) for d in b.DOMAINS}, jobs, lab.digest(curriculum))):
        for domain, rows in domains.items():
            job = source_jobs["jobs"][domain]
            receipt = {"origin_evidence_sha256": origin, "project_id": source_jobs["project_id"],
                       "agent_id": job["agent_id"], "job_id": job["job_id"], "artifact_id": job["artifact_id"],
                       "report_sha256": job["report_sha256"], "domain": domain}
            for case in rows:
                lab.require(case["id"] not in registry, "EXPERIENCE_REGISTRY_OVERLAP:" + stage)
                registry[case["id"]] = {"case_sha256": lab.digest(case), "receipt": receipt}
    return x.policy(registry, [access["receiver_id"]])


def journal_run(database, parent, curriculum, rules, reports):
    journal = x.ExperienceJournal(database, rules).initialize()
    original = ev.read(parent / "tasks.json")

    def request(case):
        return {"case": case, "receipt": rules["registry"][case["id"]]["receipt"], "receiver": rules["receivers"][0]}

    def training_from(domains):
        return [request(c) for rows in domains.values() for c in rows if c["split"] == "train"]

    bootstrap = journal.admit_many(training_from(original["cases"]), 150000)
    lab.require(all(r["status"] == "ACCEPTED" for r in bootstrap), "EXPERIENCE_BOOTSTRAP_ADMISSION")
    checkpoints = [{"stage": "BOOTSTRAP", "audit": journal.audit()}]
    journal = x.ExperienceJournal(database, rules)  # Reopen; no in-memory learning state survives this boundary.
    shared = journal.admit_many(training_from(curriculum["batches"]["extension"]), 250000)
    lab.require(all(r["status"] == "ACCEPTED" for r in shared), "EXPERIENCE_SHARED_ADMISSION")
    for domain, report in reports.items():
        lab.require(b.fit(domain, journal.training(domain, 250000), 250000) == report["model"],
                    "EXPERIENCE_RESTARTED_MODEL_REPLAY")
    checkpoints.append({"stage": "SHARED_TRAINING", "audit": journal.audit()})
    duplicate = training_from(curriculum["batches"]["extension"])[0]
    before = journal.audit()
    repeats = journal.admit_many([duplicate] * 100, 250000)
    lab.require(all(r["status"] == "DUPLICATE" and not r["appended"] for r in repeats)
                and journal.audit() == before, "EXPERIENCE_DUPLICATE_INFLATION")
    heldout = next(c for c in curriculum["batches"]["extension"][b.DOMAINS[0]] if c["split"] == "holdout")
    bad_label, bad_agent, bad_project = [deepcopy(duplicate) for _ in range(3)]
    bad_label["case"]["target"] ^= 1
    bad_agent["receipt"]["agent_id"] = "0" * 32
    bad_project["receipt"]["project_id"] = "0" * 32
    pending = curriculum["batches"]["drift"][b.DOMAINS[0]][0]
    refused = journal.admit_many([bad_label, bad_agent, bad_project, request(heldout), request(pending)], 350000)
    lab.require(all(r["status"] == "QUARANTINED" for r in refused), "EXPERIENCE_BAD_SHARE_ACCEPTED")
    lab.require(all(b.fit(d, journal.training(d, 250000), 250000) == reports[d]["model"] for d in b.DOMAINS),
                "EXPERIENCE_QUARANTINE_TRAINED")
    checkpoints.append({"stage": "POISON_AND_FUTURE_REJECTED", "audit": journal.audit()})
    journal = x.ExperienceJournal(database, rules)
    drift = journal.admit_many(training_from(curriculum["batches"]["drift"]), 450000)
    lab.require(all(r["status"] == "ACCEPTED" for r in drift), "EXPERIENCE_COUNTEREXAMPLE_ADMISSION")
    audit = journal.audit()
    checks = {"drift": {}, "novelty": {}}
    for stage in checks:
        for domain, rows in curriculum["batches"][stage].items():
            checks[stage][domain] = [{"case_id": c["id"], "raw": b.predict(reports[domain]["model"], c["features"]),
                                     "guarded": x.guarded_predict(reports[domain]["model"], c["features"], audit)} for c in rows]
            lab.require(all(c["guarded"]["action"] == "ABSTAIN" for c in checks[stage][domain]),
                        "EXPERIENCE_UNQUALIFIED_ADVISORY_SERVED")
    checkpoints.append({"stage": "COUNTEREXAMPLES_SUPPRESS_ADVISORIES", "audit": audit})
    return {"protocol": "AAI_EXPERIENCE_SESSIONS_V1", "checkpoints": checkpoints,
            "duplicate_messages_ignored": len(repeats), "rejected_shares": refused,
            "counterexamples_accepted": len(drift), "serving_checks": checks,
            "selected_versions_changed_after_drift": False, "live_execution_allowed": False}


def data_phase(phase, output, community, parent):
    verify_checkout(community, "community")
    curriculum = experience_tasks.build_tasks(ev.read(parent / "tasks.json"), community)
    reports = reports_for(parent, curriculum)
    if phase == "data-build":
        build_jobs(output, community, parent, curriculum, reports)
    jobs, access = verify_jobs(output, community)
    rules = registry_for(parent, curriculum, jobs, access)
    journal = output / "experience/journal.sqlite3"
    with tempfile.TemporaryDirectory() as temporary:
        replay = journal_run(journal if phase == "data-build" else Path(temporary) / "journal.sqlite3",
                             parent, curriculum, rules, reports)
        if phase != "data-build":
            expected = x.ExperienceJournal(Path(temporary) / "journal.sqlite3", rules).state()
            actual = x.ExperienceJournal(journal, rules).state()
            lab.require(actual == expected, "EXPERIENCE_DATABASE_REPLAY")
    code = {name: ev.sha((ROOT / name).read_bytes()) for name in (
        "src/ecosystem_research/experience.py", "src/ecosystem_research/experience_tasks.py",
        "scripts/ecosystem_experience_worker.py", "scripts/run_ecosystem_experience.py")}
    files = {"curriculum.json": curriculum, "admission-policy.json": rules, "sessions.json": replay,
             "generator-code.json": code}
    files.update({ROLES[d] + ".json": r for d, r in reports.items()})
    for name, value in files.items():
        if phase == "data-build" and not name.endswith("_learner.json"):
            ev.write(output / name, value)
        lab.require(ev.read(output / name) == value, "EXPERIENCE_DERIVED_REPLAY:" + name)
    verify_checkout(community, "community")
    return {"verified": True, "phase": phase, "completed_jobs": 4, "audit": replay["checkpoints"][-1]["audit"],
            "live_execution_allowed": False}


def reef_phase(phase, output, reef, parent):
    pin = reef_adapter.load_reef(reef)
    from reef.core.evaluation import EvaluationResult, SelectionDecision, UpdateCandidate
    from reef.evaluation import RegressionCheckMixin
    curriculum = ev.read(output / "curriculum.json")
    reports = reports_for(parent, curriculum)

    class Selector(RegressionCheckMixin):
        def __init__(self, report):
            super().__init__(metric="balanced_accuracy_ppm", margin=0)
            self.report = report

        def evaluate(self, candidate):
            lab.require(candidate.candidate_id == lab.digest(candidate.metadata), "EXPERIENCE_REEF_CANDIDATE")
            evaluation = self.report["evaluation"]
            reference = candidate.metadata["kind"] == "reference"
            score = evaluation["scores"]["baseline" if reference else "candidate"]["future"]
            eligible = not reference and candidate.metadata["model"] == self.report["model"] and evaluation["eligible"]
            return EvaluationResult("aai-experience-retention", "1", score,
                                    {"eligible": eligible, "evaluation_sha256": lab.digest(evaluation), "scope": b.SCOPE})

        def decide(self, candidate, evaluation):
            lab.require(evaluation.to_dict() == self.evaluate(candidate).to_dict(), "EXPERIENCE_REEF_SCORE_REPLAY")
            if not evaluation.metadata["eligible"]:
                return SelectionDecision(False, "experience-retention", "qualification or retention requirements failed", evaluation)
            return super().decide(candidate, evaluation)

    selections = {}
    for domain, report in reports.items():
        lab.require(ev.read(output / (ROLES[domain] + ".json")) == report, "EXPERIENCE_REEF_REPORT_REPLAY")
        selector = Selector(report)
        reference = {"kind": "reference", "model": report["incumbent"]}
        old = UpdateCandidate(lab.digest(reference), reference)
        RegressionCheckMixin.decide(selector, old, selector.evaluate(old))
        proposed = {"kind": "candidate", "model": report["model"]}
        new = UpdateCandidate(lab.digest(proposed), proposed)
        accepted = selector.decide(new, selector.evaluate(new)).to_dict()
        rejected = selector.decide(old, selector.evaluate(old)).to_dict()
        lab.require(accepted["selected"] and not rejected["selected"], "EXPERIENCE_REEF_QUALIFICATION")
        selections[domain] = {"selected": accepted, "regression": rejected,
                              "active_model_sha256": lab.digest(report["model"]), "live_execution_allowed": False}
    ids = previous.reef_records(output, reports, {"cases": {d: cases_for(curriculum, d) for d in b.DOMAINS}},
                                selections, build=phase == "reef-build")
    sessions, source = ev.read(output / "sessions.json"), ev.read(parent / "summary.json")
    audit, jobs = sessions["checkpoints"][-1]["audit"], ev.read(output / "jobs.json")
    summary = {"protocol": "AAI_EXPERIENCE_INTEGRATION_SUMMARY_V1", "classification": "SYNTHETIC_BEHAVIOR_TASK",
               "new_cases": sum(len(cases_for(curriculum, d)) for d in b.DOMAINS),
               "completed_jobs": 4, "job_artifacts": 4, "participants": 5,
               "community_audit_events": jobs["audit"]["audit_events"], "reef_records": 8, "consumption_receipts": 4,
               "journal_events": audit["events"], "accepted_training_outcomes": audit["accepted"],
               "duplicate_messages_ignored": sessions["duplicate_messages_ignored"],
               "quarantined_shares": sum(audit["quarantined"].values()),
               "blocked_contexts": sum(len(v) for v in audit["blocked_contexts"].values()),
               "selected_advisory_versions": len(selections), "retention_regressions": 0,
               "novelty_queries_abstained": sum(len(v) for v in sessions["serving_checks"]["novelty"].values()),
               "drift_queries_suppressed": sum(len(v) for v in sessions["serving_checks"]["drift"].values()),
               "recorded_observations": source["recorded_observations"],
               "recorded_resolved_outcomes": source["recorded_resolved_outcomes"],
               "recorded_pending_outcomes": source["recorded_pending_outcomes"],
               "real_market_qualification": source["real_market_qualification"],
               "llm_or_neural_weights_updated": False, "capability_authority_changed": False,
               "live_execution_allowed": False, "payments_performed": False}
    upstream = ev.read(output / "upstream.json")
    public = {"protocol": "AAI_EXPERIENCE_PUBLIC_SNAPSHOT_V1", "mode": b.SCOPE,
              "behavior_public_snapshot_sha256": upstream["behavior_public_snapshot_sha256"],
              "active_models": {d: lab.digest(r["model"]) for d, r in reports.items()},
              "blocked_context_count": summary["blocked_contexts"], "accepted_training_outcomes": audit["accepted"],
              "research_signal": "ABSTAIN", "real_market_qualification": source["real_market_qualification"],
              "llm_or_neural_weights_updated": False, "live_execution_allowed": False, "payments_performed": False}
    files = {"selection.json": selections, "reef-records.json": ids, "reef-component.json": pin,
             "summary.json": summary, "public-snapshot.json": public}
    for name, value in files.items():
        if phase == "reef-build":
            ev.write(output / name, value)
        else:
            lab.require(ev.read(output / name) == value, "EXPERIENCE_REEF_DERIVED_REPLAY:" + name)
    reef_adapter.verify_reef(reef)
    return {"verified": True, **summary}


def main():
    phase, output, community, reef, parent = sys.argv[1:]
    output, community, reef, parent = [Path(p).resolve() for p in (output, community, reef, parent)]
    socket.create_connection = previous.deny_network
    socket.socket.connect = previous.deny_network
    if phase in ("data-build", "data-verify"):
        result = data_phase(phase, output, community, parent)
    else:
        lab.require(phase in ("reef-build", "reef-verify"), "EXPERIENCE_WORKER_PHASE")
        result = reef_phase(phase, output, reef, parent)
    print(ev.canonical(result), flush=True)


if __name__ == "__main__":
    main()
