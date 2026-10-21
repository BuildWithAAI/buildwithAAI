"""Run pinned scanner/community adapters locally; no external messaging or payments."""
from __future__ import annotations

import base64
from contextlib import closing
from pathlib import Path
import socket
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ecosystem_research import handoff, mint_capture  # noqa: E402
from src.ecosystem_research.checkout import lock, verify_checkout  # noqa: E402
from src.multi_brain_research import neural_features as neural  # noqa: E402
from src.multi_brain_research import trade_learning as trade  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402


def deny_network(*_args, **_kwargs):
    raise RuntimeError("ECOSYSTEM_OFFLINE_WORKER_NETWORK_BLOCKED")


def scanner_review(scanner_root, output, data):
    sys.path.insert(0, str(scanner_root / "src"))
    from aai_scanner.evidence import receipt
    from aai_scanner.mint import parse_mint
    result = []
    for mint, decimals, item, payload in mint_capture.read(output / "mint-capture", data):
        record = item["record"]
        proof = receipt("Solana RPC", item["endpoint"], "getAccountInfo",
                        slot=payload["result"]["context"]["slot"], commitment="finalized",
                        raw_hash=record["response_sha256"],
                        flags=["CURRENT_STATE_NOT_HISTORICAL_RISK"])
        proof.update(timestamp=record["received_at"], available_at=record["received_at"])
        payload["_evidence"] = proof
        parsed = parse_mint(mint, payload, item["endpoint"])
        result.append(handoff.inspection_projection(mint, parsed, decimals))
    return result


def inputs(output):
    trade.verify(output / "training")
    _, data = trade.load_sources(output / "target")
    model, plan = ev.read(output / "training/model.json"), ev.read(output / "training/plan.json")
    bundle = ev.read(output / "target-neural-features.json")
    neural.validate_bundle(bundle, data, trade.PIPELINE)
    lab.require(data["classification"] == "RPC_CAPTURE", "ECOSYSTEM_REAL_TARGET_REQUIRED")
    return data, model, plan, bundle


def enroll(store, owner, role):
    # Reproducible, public TEST keys only. Never fund or use these identities elsewhere.
    from nacl.signing import SigningKey
    key = SigningKey(bytes.fromhex(lab.digest(["AAI_ECOSYSTEM_TEST_IDENTITY_V1", role])))
    address = ev.b58encode(bytes(key.verify_key))
    _, operator = store.call("POST", "/v1/operators", {"handle": role + "_operator"}, owner)
    token = operator["credential"]["token"]
    _, challenge = store.call("POST", "/v1/wallet/challenges",
                              {"handle": role, "wallet": address, "capabilities": ["research"]}, token)
    signature = key.sign(challenge["message"].encode()).signature
    _, agent = store.call("POST", "/v1/agents",
                          {"challenge_id": challenge["challenge_id"],
                           "signature": base64.b64encode(signature).decode()}, token)
    return agent["agent"]["id"], agent["credential"]["token"]


def dispatch(store, token, project, role, study, output, handler):
    request = {"request_id": lab.digest([study, role])[:32], "title": role,
               "prompt": ev.canonical({"task": role, "research_input_sha256": study}),
               "project_id": project, "max_steps": 2, "timeout_seconds": 120}
    _, submitted = store.call("POST", "/v1/jobs", request, token)
    _, replay = store.call("POST", "/v1/jobs", request, token)
    lab.require(replay["replayed"] is True and submitted["job"]["id"] == replay["job"]["id"],
                "COMMUNITY_JOB_IDEMPOTENCE")
    _, claimed = store.call("POST", "/v1/jobs/claim", {"max_steps": 2, "timeout_seconds": 120}, token)
    job = claimed["job"]
    lab.require(job is not None and job["id"] == submitted["job"]["id"], "COMMUNITY_JOB_CLAIM")
    complete = {"attempt_id": job["attempt_id"], "claim_token": claimed["claim_token"],
                "state": "SUCCEEDED", "report_sha256": None, "report_bytes": None,
                "steps": 1, "error_code": None}
    try:
        report = handler()
        raw = (ev.canonical(report) + "\n").encode()
        lab.require(1 <= len(raw) <= 131_072, "COMMUNITY_REPORT_BOUND")
        ev.write(output / f"{role}.json", report)
        complete.update(report_sha256=ev.sha(raw), report_bytes=len(raw))
        _, finished = store.call("POST", f"/v1/jobs/{job['id']}/complete", complete, token)
        _, again = store.call("POST", f"/v1/jobs/{job['id']}/complete", complete, token)
        lab.require(finished["job"]["state"] == "SUCCEEDED" and again["replayed"] is True,
                    "COMMUNITY_COMPLETION_IDEMPOTENCE")
        return {"agent_id": job["agent_id"], "job_id": job["id"],
                "artifact_id": finished["job"]["artifact_id"],
                "report_sha256": complete["report_sha256"], "report_bytes": len(raw),
                "state": "SUCCEEDED", "request_replay_verified": True, "completion_replay_verified": True}
    except Exception:
        failure = {**complete, "state": "FAILED", "report_sha256": None,
                   "report_bytes": None, "steps": 0, "error_code": "RESEARCH_HANDLER_FAILED"}
        try:
            store.call("POST", f"/v1/jobs/{job['id']}/complete", failure, token)
        except Exception:
            pass  # Retain database for explicit audit; never overwrite a completed result.
        raise


def community_build(community_root, output, data, model, plan, bundle):
    sys.path.insert(0, str(community_root / "projects/zoora-agent-community"))
    from zoora_community.store import Store
    from zoora_community.validation import Problem
    owner_path = output / "owner.credential"
    store = Store.initialize(output / "state", owner_path)
    owner = ev.read(owner_path)["token"]
    try:
        auditor, token_a = enroll(store, owner, "source_auditor")
        reviewer, token_b = enroll(store, owner, "forecast_reviewer")
        _, project = store.call("POST", "/v1/projects",
                                {"title": "AAI.fun research", "summary": "Verified source and uncalibrated forecasts"}, token_a)
        store.call("POST", f"/v1/projects/{project['id']}/members", {"agent_id": reviewer}, token_a)
        study = lab.digest([lab.digest(data), lab.digest(model)])

        def source_handler():
            _, reconstructed = trade.load_sources(output / "target")
            lab.require(lab.digest(reconstructed) == lab.digest(data), "WORKER_SOURCE_CHANGED")
            return handoff.source_projection(reconstructed)

        jobs = {"source_auditor": dispatch(store, token_a, project["id"], "source_auditor",
                                           study, output, source_handler),
                "forecast_reviewer": dispatch(store, token_b, project["id"], "forecast_reviewer",
                                              study, output, lambda: handoff.forecasts(data, model, plan, bundle))}
        try:
            store.call("GET", "/v1/jobs/" + jobs["source_auditor"]["job_id"], token=token_b)
        except Problem as error:
            lab.require(error.code == "FORBIDDEN", "COMMUNITY_CROSS_AGENT_SCOPE")
        else:
            raise ValueError("COMMUNITY_CROSS_AGENT_READ_ALLOWED")
        for role, agent, token in (("source_auditor", auditor, token_a), ("forecast_reviewer", reviewer, token_b)):
            _, activity = store.call("GET", f"/v1/agents/{agent}/activity", token=token)
            lab.require(activity["runtime"]["counts"]["SUCCEEDED"] == 1
                        and activity["runtime"]["continuous_runtime_verified"] is False
                        and activity["blockchain"]["wallet_execution"] == "UNAVAILABLE",
                        "COMMUNITY_ACTIVITY_SCOPE")
            jobs[role]["activity_verified"] = True
        audit = store.audit()
        ev.write(output / "jobs.json", {"protocol": "AAI_ECOSYSTEM_COMMUNITY_JOBS_V1",
                                       "project_id": project["id"], "jobs": jobs, "audit": audit,
                                       "cross_agent_read_denied": True, "identity_mode": "LOCAL_PUBLIC_TEST_KEYS",
                                       "payments_performed": False, "live_execution_allowed": False})
    finally:
        owner_path.unlink(missing_ok=True)


def community_verify(community_root, output):
    sys.path.insert(0, str(community_root / "projects/zoora-agent-community"))
    from zoora_community.store import Store
    saved = ev.read(output / "jobs.json")
    lab.require(ev.canonical(Store(output / "state").audit()) == ev.canonical(saved["audit"]),
                "COMMUNITY_AUDIT_REPLAY")
    database = output / "state/community.sqlite3"
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        lab.require(connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 2
                    and connection.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 2,
                    "COMMUNITY_RESEARCH_JOB_COUNT")
        for role, item in saved["jobs"].items():
            lab.require(role in ("source_auditor", "forecast_reviewer"), "COMMUNITY_ROLE")
            job = connection.execute("SELECT * FROM jobs WHERE id=?", (item["job_id"],)).fetchone()
            artifact = connection.execute("SELECT * FROM artifacts WHERE id=?", (item["artifact_id"],)).fetchone()
            raw = (output / f"{role}.json").read_bytes()
            lab.require(job is not None and artifact is not None and job["state"] == "SUCCEEDED"
                        and job["agent_id"] == artifact["author_id"] == item["agent_id"]
                        and job["artifact_id"] == artifact["id"]
                        and job["project_id"] == artifact["project_id"] == saved["project_id"]
                        and job["report_sha256"] == artifact["digest"] == item["report_sha256"] == ev.sha(raw)
                        and job["report_bytes"] == item["report_bytes"] == len(raw), "COMMUNITY_ARTIFACT_BINDING")
    return saved


def derived(output, scanner_root, community_root):
    data, model, plan, bundle = inputs(output)
    source = handoff.source_projection(data)
    forecast = handoff.forecasts(data, model, plan, bundle)
    inspections = scanner_review(scanner_root, output, data)
    decision = handoff.gate(forecast, model)
    jobs = community_verify(community_root, output)
    snapshot = handoff.public_snapshot(source, forecast, decision, inspections,
                                       {role: item["state"] for role, item in jobs["jobs"].items()})
    result = {"source_auditor.json": source, "forecast_reviewer.json": forecast,
              "inspections.json": inspections, "gate.json": decision,
              "public-snapshot.json": snapshot, "public-events.json": handoff.public_events(snapshot)}
    return result, jobs


def main():
    phase, output, scanner_root, community_root = sys.argv[1:]
    output, scanner_root, community_root = [Path(p).resolve() for p in (output, scanner_root, community_root)]
    components = {name: verify_checkout(path, name)
                  for name, path in (("scanner", scanner_root), ("community", community_root))}
    socket.create_connection = deny_network
    socket.socket.connect = deny_network
    data, model, plan, bundle = inputs(output)
    if phase == "build":
        inspections = scanner_review(scanner_root, output, data)
        community_build(community_root, output, data, model, plan, bundle)
        forecast = ev.read(output / "forecast_reviewer.json")
        decision = handoff.gate(forecast, model)
        snapshot = handoff.public_snapshot(ev.read(output / "source_auditor.json"), forecast, decision,
                                           inspections, {"source_auditor": "SUCCEEDED", "forecast_reviewer": "SUCCEEDED"})
        for name, value in (("inspections.json", inspections), ("gate.json", decision),
                            ("public-snapshot.json", snapshot), ("public-events.json", handoff.public_events(snapshot))):
            ev.write(output / name, value)
    else:
        lab.require(phase in ("verify", "recheck"), "ECOSYSTEM_WORKER_PHASE")
    recomputed, jobs = derived(output, scanner_root, community_root)
    for name, value in recomputed.items():
        lab.require(ev.canonical(value) == ev.canonical(ev.read(output / name)), "ECOSYSTEM_DERIVED_REPLAY")
    lab.require(ev.canonical(ev.read(output / "components.json")) == ev.canonical(lock()), "ECOSYSTEM_LOCK_CHANGED")
    for name, path in (("scanner", scanner_root), ("community", community_root)):
        verify_checkout(path, name)
    summary = {"protocol": "AAI_ECOSYSTEM_INTEGRATION_SUMMARY_V1", "components": components,
               "source_classification": data["classification"],
               "training_classification": ev.read(output / "training/report.json")["classification"],
               "observations": len(recomputed["forecast_reviewer.json"]["rows"]),
               "mint_inspections": len(recomputed["inspections.json"]), "completed_jobs": len(jobs["jobs"]),
               "audit_events": jobs["audit"]["audit_events"], "audit_head": jobs["audit"]["audit_head"],
               "cross_agent_read_denied": jobs["cross_agent_read_denied"],
               "public_events": len(recomputed["public-events.json"]["events"]),
               "gate": recomputed["gate.json"]["research_signal"], "live_execution_allowed": False,
               "native_inference_reexecuted_by_this_worker": False,
               "feature_execution_attestation": "NOT_ESTABLISHED",
               "target_training_performed": False, "payments_performed": False,
               "identity_mode": "LOCAL_PUBLIC_TEST_KEYS",
               "observer_and_assistant": "READ_ONLY_JSON_HANDOFF_NO_HOSTED_CLIENT",
               "legacy_coordinator": recomputed["gate.json"]["legacy_coordinator"]}
    if phase == "build":
        ev.write(output / "summary.json", summary)
    else:
        lab.require(ev.canonical(summary) == ev.canonical(ev.read(output / "summary.json")), "ECOSYSTEM_SUMMARY_REPLAY")
    print(ev.canonical({"phase": phase, "verified": True, **summary}), flush=True)


if __name__ == "__main__":
    main()
