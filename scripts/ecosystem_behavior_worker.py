"""Execute sandbox specialist jobs and pinned Reef selection in separate runtimes."""
from __future__ import annotations

from contextlib import closing
from dataclasses import replace
from pathlib import Path
import shutil
import socket
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ecosystem_research import behavior, behavior_tasks, reef_adapter  # noqa: E402
from src.ecosystem_research.checkout import verify_checkout  # noqa: E402
from src.multi_brain_research import trade_learning as trade, training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402

ROLES = dict(zip(behavior.DOMAINS, ("paper_learner", "contract_learner", "code_learner", "opsec_learner"), strict=True))


def deny_network(*_args, **_kwargs):
    raise RuntimeError("BEHAVIOR_WORKER_NETWORK_BLOCKED")


def source_feedback(connected):
    if connected is None:
        return {"protocol": "AAI_RECORDED_BEHAVIOR_FEEDBACK_V1", "classification": "SOURCE_NOT_PROVIDED",
                "observations": 0, "resolved_outcomes": 0, "pending_outcomes": 0,
                "real_market_qualification": "BLOCKED_SOURCE_NOT_PROVIDED", "live_execution_allowed": False}
    _, data = trade.load_sources(connected / "target")
    lab.require(data["classification"] == "RPC_CAPTURE", "BEHAVIOR_REAL_SOURCE_REQUIRED")
    return behavior.recorded_trade_feedback(data, ev.read(connected / "forecast_reviewer.json"),
                                           ev.read(connected / "training/plan.json"))


def generated(community, connected):
    tasks = behavior_tasks.build_tasks(community)
    reports = {domain: behavior.domain_report(domain, cases) for domain, cases in tasks["cases"].items()}
    traces = {domain: behavior.prequential(domain, cases) for domain, cases in tasks["cases"].items()}
    reviewed = {}
    for name, observation in tasks["observed_code"].items():
        reviewed[name] = {**observation, "advisory": behavior.predict(reports["code_review"]["model"], observation["features"])}
    code = {name: ev.sha((ROOT / name).read_bytes()) for name in (
        "src/ecosystem_research/behavior.py", "src/ecosystem_research/behavior_tasks.py",
        "scripts/ecosystem_behavior_worker.py", "scripts/run_ecosystem_behavior.py")}
    files = {"tasks.json": tasks, "replays.json": traces, "recorded-feedback.json": source_feedback(connected),
             "code-review.json": reviewed, "generator-code.json": code}
    files.update({ROLES[domain] + ".json": value for domain, value in reports.items()})
    return files, reports


def build_jobs(output, community, tasks, reports):
    sys.path.insert(0, str(community / "projects/zoora-agent-community"))
    from zoora_community.store import Store
    from zoora_community.validation import Problem
    from scripts.ecosystem_worker import dispatch, enroll

    credential = output / "owner.credential"
    store = Store.initialize(output / "agents", credential)
    owner = ev.read(credential)["token"]
    try:
        participants = {domain: enroll(store, owner, role) for domain, role in ROLES.items()}
        creator, token = participants[behavior.DOMAINS[0]]
        _, project = store.call("POST", "/v1/projects", {"title": "Sandbox behavior learning",
                               "summary": "Python research handlers; synthetic task outcomes; advisory policies"}, token)
        for agent, _ in participants.values():
            if agent != creator:
                store.call("POST", f"/v1/projects/{project['id']}/members", {"agent_id": agent}, token)
        study = lab.digest(tasks)
        jobs = {}
        for domain, (_, participant_token) in participants.items():
            def handler(domain=domain):
                # The actual claimed handler recomputes its model from declared task outcomes.
                value = behavior.domain_report(domain, tasks["cases"][domain])
                lab.require(value == reports[domain], "BEHAVIOR_HANDLER_REPLAY")
                return value
            jobs[domain] = dispatch(store, participant_token, project["id"], ROLES[domain], study, output, handler)
        for domain, (agent, participant_token) in participants.items():
            other = next(d for d in behavior.DOMAINS if d != domain)
            try:
                store.call("GET", "/v1/jobs/" + jobs[other]["job_id"], token=participant_token)
            except Problem as error:
                lab.require(error.code == "FORBIDDEN", "BEHAVIOR_PRIVATE_JOB_SCOPE")
            else:
                raise ValueError("BEHAVIOR_PRIVATE_JOB_VISIBLE")
            _, activity = store.call("GET", f"/v1/agents/{agent}/activity", token=participant_token)
            lab.require(activity["runtime"]["counts"]["SUCCEEDED"] == 1
                        and activity["runtime"]["continuous_runtime_verified"] is False
                        and activity["blockchain"]["wallet_execution"] == "UNAVAILABLE", "BEHAVIOR_JOB_ACTIVITY")
        ev.write(output / "jobs.json", {"protocol": "AAI_BEHAVIOR_JOBS_V1", "jobs": jobs,
                 "project_id": project["id"], "audit": store.audit(), "cross_agent_reads_denied": True,
                 "identity_mode": "LOCAL_PUBLIC_TEST_KEYS", "live_execution_allowed": False})
    finally:
        credential.unlink(missing_ok=True)


def verify_jobs(output, community):
    sys.path.insert(0, str(community / "projects/zoora-agent-community"))
    from zoora_community.store import Store
    value = ev.read(output / "jobs.json")
    lab.exact(value, ("protocol", "jobs", "project_id", "audit", "cross_agent_reads_denied", "identity_mode",
                      "live_execution_allowed"))
    lab.require(value["protocol"] == "AAI_BEHAVIOR_JOBS_V1" and value["cross_agent_reads_denied"] is True
                and value["identity_mode"] == "LOCAL_PUBLIC_TEST_KEYS" and value["live_execution_allowed"] is False
                and set(value["jobs"]) == set(behavior.DOMAINS)
                and Store(output / "agents").audit() == value["audit"], "BEHAVIOR_JOB_AUDIT")
    with closing(sqlite3.connect((output / "agents/community.sqlite3").as_uri() + "?mode=ro", uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        lab.require(connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 4
                    and connection.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 4, "BEHAVIOR_JOB_COUNTS")
        for domain, item in value["jobs"].items():
            job = connection.execute("SELECT * FROM jobs WHERE id=?", (item["job_id"],)).fetchone()
            artifact = connection.execute("SELECT * FROM artifacts WHERE id=?", (item["artifact_id"],)).fetchone()
            raw = (output / (ROLES[domain] + ".json")).read_bytes()
            lab.require(job is not None and artifact is not None and job["state"] == "SUCCEEDED"
                        and job["agent_id"] == artifact["author_id"] == item["agent_id"]
                        and job["artifact_id"] == artifact["id"]
                        and job["project_id"] == artifact["project_id"] == value["project_id"]
                        and job["report_sha256"] == artifact["digest"] == item["report_sha256"] == ev.sha(raw)
                        and job["report_bytes"] == item["report_bytes"] == len(raw), "BEHAVIOR_JOB_REPORT_BINDING")
    return value


def data_phase(phase, output, community, connected):
    verify_checkout(community, "community")
    files, reports = generated(community, connected)
    if phase == "data-build":
        for name, value in files.items():
            if not name.endswith("_learner.json"):
                ev.write(output / name, value)
        build_jobs(output, community, files["tasks.json"], reports)
    for name, value in files.items():
        lab.require(ev.read(output / name) == value, "BEHAVIOR_DATA_REPLAY:" + name)
    jobs = verify_jobs(output, community)
    verify_checkout(community, "community")
    return {"verified": True, "phase": phase, "cases": sum(len(rows) for rows in files["tasks.json"]["cases"].values()),
            "completed_jobs": len(jobs["jobs"]), "audit_events": jobs["audit"]["audit_events"], "live_execution_allowed": False}


def reef_selection(reports, tasks):
    from reef.core.evaluation import EvaluationResult, SelectionDecision, UpdateCandidate
    from reef.evaluation import RegressionCheckMixin

    class Selector(RegressionCheckMixin):
        def __init__(self, report, cases):
            super().__init__(metric="balanced_accuracy_ppm", margin=0)
            self.report, self.cases = report, cases

        def evaluate(self, candidate):
            lab.require(candidate.candidate_id == lab.digest(candidate.metadata), "BEHAVIOR_REEF_CANDIDATE")
            if candidate.metadata["kind"] == "baseline":
                metrics = self.report["evaluation"]["baseline"]
                eligible = False
            else:
                measured = behavior.evaluate(candidate.metadata["model"], self.cases)
                metrics, eligible = measured["candidate"], measured["eligible"]
            return EvaluationResult("aai-behavior-outcomes", "1", metrics,
                                    {"eligible": eligible, "cases_sha256": lab.digest(self.cases), "scope": behavior.SCOPE})

        def decide(self, candidate, evaluation):
            lab.require(evaluation.to_dict() == self.evaluate(candidate).to_dict(), "BEHAVIOR_REEF_MEASUREMENT")
            if not evaluation.metadata["eligible"]:
                return SelectionDecision(False, "aai-behavior-qualified", "sandbox qualification requirements failed", evaluation)
            return super().decide(candidate, evaluation)

    results = {}
    for domain in behavior.DOMAINS:
        report, cases = reports[domain], tasks["cases"][domain]
        model = report["model"]
        flipped = ev.parse(ev.canonical(model).encode())
        for row in flipped["contexts"].values():
            row["zero"], row["one"] = row["one"], row["zero"]

        selector = Selector(report, cases)
        baseline_body = {"kind": "baseline", "domain": domain}
        baseline = UpdateCandidate(lab.digest(baseline_body), baseline_body)
        RegressionCheckMixin.decide(selector, baseline, selector.evaluate(baseline))
        proposal_body = {"kind": "model", "model": model}
        proposed = UpdateCandidate(lab.digest(proposal_body), proposal_body)
        accepted = selector.decide(proposed, selector.evaluate(proposed)).to_dict()
        regression_body = {"kind": "model", "model": flipped}
        regression = UpdateCandidate(lab.digest(regression_body), regression_body)
        rejected = selector.decide(regression, selector.evaluate(regression)).to_dict()
        active = lab.digest(model) if accepted["selected"] else None
        events, previous = [], "0" * 64
        for kind, selected_model in (("REFERENCE", None), ("SELECTED" if active else "REJECTED", active),
                                      ("REGRESSION_REJECTED", active)):
            entry = {"sequence": len(events), "type": kind, "active_model_sha256": selected_model,
                     "previous_sha256": previous, "scope": behavior.SCOPE}
            previous = lab.digest(entry)
            events.append({**entry, "sha256": previous})
        lab.require(not rejected["selected"], "BEHAVIOR_REGRESSION_ACCEPTED")
        results[domain] = {"selected": accepted, "regression": rejected, "active_model_sha256": active,
                           "release_events": events, "release_head_sha256": previous,
                           "live_execution_allowed": False}
    return results


def reef_records(output, reports, tasks, selections, *, build):
    from reef.core import AgentRecord, RequestType
    from reef.core.reports import ScoredRolloutReport
    from reef.storage.records import RecordConflict
    from reef.storage.sqlite import SQLiteRecordStore

    jobs = ev.read(output / "jobs.json")
    database = output / "reef/records.sqlite3"
    temporary = tempfile.TemporaryDirectory()
    try:
        path = database if build else Path(temporary.name) / "records.sqlite3"
        if not build:
            shutil.copyfile(database, path)
        identities = {}
        with SQLiteRecordStore(path) as store:
            for domain, report in reports.items():
                job = jobs["jobs"][domain]
                scenario = "aai-behavior-" + domain
                source_id = lab.digest([domain, job["job_id"], job["report_sha256"]])
                artifact = AgentRecord.create(agent_record_id=source_id, scenario=scenario, request_type=RequestType.REPORT,
                            payload={"metadata": {"kind": "VERIFIED_SANDBOX_BEHAVIOR_JOB", "domain": domain,
                            "job_id": job["job_id"], "artifact_id": job["artifact_id"], "report_sha256": job["report_sha256"],
                            "cases_sha256": report["cases_sha256"], "classification": "SYNTHETIC_BEHAVIOR_TASK"}})
                payload = ScoredRolloutReport(score=report["evaluation"]["candidate"]["balanced_accuracy_ppm"] / 1_000_000).to_dict(references=[source_id])
                payload["metadata"] = {"quality_target": "CONTROLLED_TASK_OUTCOMES", "scope": behavior.SCOPE,
                                       "oracle_reexecution_required": True, "market_advantage_established": False}
                feedback = AgentRecord.create(agent_record_id=lab.digest([source_id, "outcomes-v1"]), scenario=scenario,
                                              request_type=RequestType.REPORT, payload=payload)
                metadata = {"model_sha256": lab.digest(report["model"]), "cases_sha256": lab.digest(tasks["cases"][domain]),
                            "scope": behavior.SCOPE}
                receipt_id = lab.digest([source_id, "behavior-consumption-v1"])
                ids = frozenset((artifact.agent_record_id, feedback.agent_record_id))
                if build:
                    lab.require(all(x.inserted for x in store.append_many((artifact, feedback))), "BEHAVIOR_REEF_NEW_RECORDS")
                    lab.require(not any(x.inserted for x in store.append_many((artifact, feedback))), "BEHAVIOR_REEF_RETRY")
                    try:
                        store.append(replace(feedback, payload={**payload, "score": 0.125}))
                    except RecordConflict:
                        pass
                    else:
                        raise ValueError("BEHAVIOR_REEF_CONFLICT_ACCEPTED")
                    store.record_consumption(scenario, ids, receipt_id=receipt_id, metadata=metadata)
                actual = store.replay(scenario)
                lab.require(len(actual) == 2, "BEHAVIOR_REEF_RECORD_COUNT")
                for saved, expected in zip(actual, (artifact, feedback), strict=True):
                    lab.require(saved.agent_record_id == expected.agent_record_id and saved.scenario == expected.scenario
                                and saved.request_type == expected.request_type and saved.payload == expected.payload
                                and saved.references == expected.references and saved.artifact_ref == expected.artifact_ref,
                                "BEHAVIOR_REEF_RECORD_REPLAY")
                    lab.require(store.existing_receipt(expected) is not None, "BEHAVIOR_REEF_RETRY_STATE")
                consumed = store.consumption_receipts(scenario)
                lab.require(len(consumed) == 1 and consumed[0]["receipt_id"] == receipt_id
                            and set(consumed[0]["consumed_ids"]) == set(ids) and consumed[0]["metadata"] == metadata,
                            "BEHAVIOR_REEF_CONSUMPTION")
                other = next(d for d in behavior.DOMAINS if d != domain)
                lab.require(store.get("aai-behavior-" + other, source_id) is None, "BEHAVIOR_REEF_SCENARIO_SCOPE")
                identities[domain] = {"artifact_record_id": source_id, "feedback_record_id": feedback.agent_record_id,
                                      "consumption_receipt_id": receipt_id, "selected": selections[domain]["selected"]["selected"]}
        lab.require(not Path(str(path) + "-wal").exists(), "BEHAVIOR_REEF_OPEN_WAL")
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)) as connection:
            lab.require(connection.execute("SELECT COUNT(*) FROM agent_record").fetchone()[0] == 8,
                        "BEHAVIOR_REEF_TOTAL_RECORDS")
        return identities
    finally:
        temporary.cleanup()


def reef_phase(phase, output, reef):
    pin = reef_adapter.load_reef(reef)
    tasks = ev.read(output / "tasks.json")
    reports = {domain: ev.read(output / (role + ".json")) for domain, role in ROLES.items()}
    for domain, report in reports.items():
        lab.require(report == behavior.domain_report(domain, tasks["cases"][domain]), "BEHAVIOR_REEF_REPORT_REPLAY")
    selections = reef_selection(reports, tasks)
    ids = reef_records(output, reports, tasks, selections, build=phase == "reef-build")
    recorded = ev.read(output / "recorded-feedback.json")
    jobs = ev.read(output / "jobs.json")
    domains = {domain: {"model_sha256": lab.digest(reports[domain]["model"]),
                        "training_examples": reports[domain]["model"]["training_examples"],
                        "holdout_examples": reports[domain]["evaluation"]["candidate"]["examples"],
                        "contexts": len(reports[domain]["model"]["contexts"]),
                        "selected": selections[domain]["selected"]["selected"], "scope": behavior.SCOPE,
                        "regression_rejected": not selections[domain]["regression"]["selected"]}
               for domain in behavior.DOMAINS}
    summary = {"protocol": "AAI_BEHAVIOR_INTEGRATION_SUMMARY_V1", "domains": domains,
               "classification": "SYNTHETIC_BEHAVIOR_TASK", "completed_jobs": 4, "job_artifacts": 4,
               "community_audit_events": jobs["audit"]["audit_events"], "reef_records": 8, "consumption_receipts": 4,
               "cases": sum(len(v) for v in tasks["cases"].values()),
               "recorded_source_classification": recorded["classification"],
               "recorded_observations": recorded["observations"], "recorded_resolved_outcomes": recorded["resolved_outcomes"],
               "recorded_pending_outcomes": recorded["pending_outcomes"], "real_market_qualification": recorded["real_market_qualification"],
               "model_weights_updated": False, "capability_authority_changed": False,
               "live_execution_allowed": False, "payments_performed": False, "reef_commit": pin["commit"]}
    upstream = ev.read(output / "upstream.json")
    public = {"protocol": "AAI_BEHAVIOR_PUBLIC_SNAPSHOT_V1", "mode": behavior.SCOPE, "domains": domains,
              "learning_public_snapshot_sha256": upstream.get("learning_public_snapshot_sha256"),
              "completed_jobs": 4, "reef_records": 8, "recorded_source_classification": recorded["classification"],
              "resolved_price_feedback": recorded["resolved_outcomes"], "pending_price_feedback": recorded["pending_outcomes"],
              "real_market_qualification": recorded["real_market_qualification"], "research_signal": "ABSTAIN",
              "model_weights_updated": False, "payments_performed": False, "live_execution_allowed": False}
    files = {"selection.json": selections, "behavior-records.json": ids, "summary.json": summary,
             "public-snapshot.json": public, "reef-component.json": pin}
    for name, value in files.items():
        if phase == "reef-build":
            ev.write(output / name, value)
        else:
            lab.require(ev.read(output / name) == value, "BEHAVIOR_REEF_DERIVED_REPLAY:" + name)
    reef_adapter.verify_reef(reef)
    return {"verified": True, "phase": phase, **summary}


def main():
    phase, output, community, reef, connected = sys.argv[1:]
    output, community, reef = [Path(p).resolve() for p in (output, community, reef)]
    connected = None if connected == "-" else Path(connected).resolve()
    socket.create_connection = deny_network
    socket.socket.connect = deny_network
    if phase in ("data-build", "data-verify"):
        result = data_phase(phase, output, community, connected)
    else:
        lab.require(phase in ("reef-build", "reef-verify"), "BEHAVIOR_WORKER_PHASE")
        result = reef_phase(phase, output, reef)
    print(ev.canonical(result), flush=True)


if __name__ == "__main__":
    main()
