"""Authenticated distribution of pinned, bounded advisory models through community HTTP.

No transport fallback, model fitting, external action or execution permission.
The supplied controller-manifest hash is a trust anchor, not self-attestation.
"""
from __future__ import annotations

from itertools import product
import re
import ssl
import time

from . import behavior as b, experience as x
from .controller import safe_path
from ..multi_brain_research import training_lab as lab
from ..solana_research import coin_evidence as ev

PROTOCOL = "AAI_NETWORK_BRAIN_BUNDLE_V1"
MAX_BYTES = 131072
ROLES = {"paper_trading": "paper_learner", "contract_review": "contract_learner",
         "code_review": "code_learner", "opsec_review": "opsec_learner"}
ARTIFACT_ROUTE = re.compile(r"/v1/ecosystem/projects/([0-9a-f]{32})/artifacts/([0-9a-f]{64})\Z")


def raw(value):
    return (ev.canonical(value) + "\n").encode("utf-8")


def same(left, right):
    return ev.canonical(left) == ev.canonical(right)


def identity(value):
    lab.require(type(value) is str and re.fullmatch(r"[0-9a-f]{32}", value) is not None, "NETWORK_ID")
    return value


def file_binding(manifest, name, value):
    lab.require(type(manifest) is dict and type(manifest.get("files")) is dict
                and name in manifest["files"], "NETWORK_FILE_NOT_REGISTERED")
    entry = manifest["files"][name]
    payload = raw(value)
    lab.require(same(entry, {"sha256": ev.sha(payload), "bytes": len(payload)}), "NETWORK_FILE_BINDING:" + name)


def validate_bundle(value, expected_manifest):
    lab.pin(expected_manifest)
    lab.exact(value, ("protocol", "mode", "controller_manifest", "controller_upstream", "controller_public",
                      "experience_manifest", "experience_public", "reports", "sessions", "live_execution_allowed"))
    lab.require(value["protocol"] == PROTOCOL and value["mode"] == "PINNED_RESEARCH_REPLAY"
                and value["live_execution_allowed"] is False and len(raw(value)) <= MAX_BYTES, "NETWORK_BUNDLE_SCOPE")
    lab.require(all(type(value[k]) is dict for k in ("controller_manifest", "controller_upstream", "controller_public",
                "experience_manifest", "experience_public", "reports", "sessions")), "NETWORK_BUNDLE_OBJECTS")
    cm, em = value["controller_manifest"], value["experience_manifest"]
    lab.require(ev.sha(raw(cm)) == expected_manifest, "NETWORK_CONTROLLER_PIN")
    for manifest, protocol in ((cm, "AAI_CONTROLLER_PACKAGE_V1"), (em, "AAI_EXPERIENCE_PACKAGE_V1")):
        lab.require(manifest.get("protocol") == protocol and manifest.get("status") == "COMPLETE"
                    and manifest.get("live_execution_allowed") is False, "NETWORK_SOURCE_MANIFEST_SCOPE")
    file_binding(cm, "upstream.json", value["controller_upstream"])
    file_binding(cm, "public-snapshot.json", value["controller_public"])
    upstream = value["controller_upstream"]
    lab.require(upstream.get("protocol") == "AAI_CONTROLLER_UPSTREAM_V1"
                and upstream.get("live_execution_allowed") is False
                and upstream.get("experience_manifest_sha256") == ev.sha(raw(em)), "NETWORK_ANCESTRY")
    file_binding(em, "public-snapshot.json", value["experience_public"])
    file_binding(em, "sessions.json", value["sessions"])
    cp, ep, sessions = value["controller_public"], value["experience_public"], value["sessions"]
    lab.exact(cp, ("protocol", "mode", "experience_public_snapshot_sha256", "checkpoint_sha256", "journal_head_sha256",
                   "committed_batches", "active_models", "accepted_training_outcomes", "blocked_context_count",
                   "research_signal", "real_market_qualification", "live_execution_allowed"))
    public_sha = ev.sha(raw(ep))
    lab.require(cp["protocol"] == "AAI_CONTROLLER_PUBLIC_SNAPSHOT_V1" and cp["mode"] == "SANDBOX_BEHAVIOR_ADVISORY"
                and ep.get("protocol") == "AAI_EXPERIENCE_PUBLIC_SNAPSHOT_V1"
                and cp["live_execution_allowed"] is False and ep.get("live_execution_allowed") is False
                and cp["research_signal"] == ep.get("research_signal") == "ABSTAIN"
                and cp["real_market_qualification"] == ep.get("real_market_qualification")
                and type(cp["real_market_qualification"]) is str and cp["real_market_qualification"].startswith("BLOCKED_")
                and cp["experience_public_snapshot_sha256"] == upstream.get("experience_public_snapshot_sha256") == public_sha,
                "NETWORK_ADVISORY_AUTHORITY")
    lab.require(sessions.get("protocol") == "AAI_EXPERIENCE_SESSIONS_V1"
                and sessions.get("live_execution_allowed") is False
                and type(sessions.get("checkpoints")) is list and len(sessions["checkpoints"]) == 4,
                "NETWORK_GUARD_SESSIONS")
    audit = sessions["checkpoints"][-1]["audit"]
    lab.require(type(audit) is dict, "NETWORK_GUARD_OBJECT")
    lab.require(audit.get("protocol") == x.PROTOCOL and audit.get("live_execution_allowed") is False
                and audit.get("head_sha256") == cp["journal_head_sha256"]
                and type(audit.get("accepted")) is int
                and type(cp["accepted_training_outcomes"]) is int and type(cp["blocked_context_count"]) is int
                and cp["accepted_training_outcomes"] == ep.get("accepted_training_outcomes") == audit["accepted"]
                and type(audit.get("blocked_contexts")) is dict and set(audit["blocked_contexts"]) == set(b.DOMAINS),
                "NETWORK_GUARD_BINDING")
    for blocks in audit["blocked_contexts"].values():
        lab.require(type(blocks) is list and len(blocks) <= 256 and all(type(v) is str for v in blocks)
                    and blocks == sorted(set(blocks)),
                    "NETWORK_GUARD_CONTEXTS")
        for block in blocks:
            lab.pin(block)
    lab.require(cp["blocked_context_count"] == ep.get("blocked_context_count")
                == sum(len(v) for v in audit["blocked_contexts"].values()), "NETWORK_GUARD_COUNT")
    lab.require(type(value["reports"]) is dict and set(value["reports"]) == set(b.DOMAINS)
                and same(cp["active_models"], ep.get("active_models"))
                and type(cp["active_models"]) is dict and set(cp["active_models"]) == set(b.DOMAINS),
                "NETWORK_MODEL_SET")
    for domain, report in value["reports"].items():
        file_binding(em, ROLES[domain] + ".json", report)
        lab.require(report.get("protocol") == "AAI_EXPERIENCE_DOMAIN_REPORT_V1"
                    and report.get("domain") == domain and report.get("live_execution_allowed") is False,
                    "NETWORK_REPORT_SCOPE")
        b.validate_model(report["model"])
        lab.require(report["model"]["domain"] == domain
                    and lab.digest(report["model"]) == cp["active_models"][domain], "NETWORK_SELECTED_MODEL")
    return audit


def load_bundle(controller, experience, expected_manifest):
    """Load only anchored distribution files; never treat this as full source reexecution."""
    controller, experience = safe_path(controller), safe_path(experience)

    def read(folder, name):
        path = safe_path(folder / name)
        lab.require(path.is_file() and path.stat().st_nlink == 1 and path.stat().st_size <= MAX_BYTES,
                    "NETWORK_SOURCE_FILE")
        value = ev.read(path)
        lab.require(path.read_bytes() == raw(value), "NETWORK_SOURCE_NOT_CANONICAL")
        return value

    value = {"protocol": PROTOCOL, "mode": "PINNED_RESEARCH_REPLAY",
             "controller_manifest": read(controller, "manifest.json"),
             "controller_upstream": read(controller, "upstream.json"),
             "controller_public": read(controller, "public-snapshot.json"),
             "experience_manifest": read(experience, "manifest.json"),
             "experience_public": read(experience, "public-snapshot.json"),
             "reports": {d: read(experience, role + ".json") for d, role in ROLES.items()},
             "sessions": read(experience, "sessions.json"), "live_execution_allowed": False}
    validate_bundle(value, expected_manifest)
    return value


def read_bundle(filename, expected_manifest):
    path = safe_path(filename)
    lab.require(path.is_file() and path.stat().st_nlink == 1 and 0 < path.stat().st_size <= MAX_BYTES,
                "NETWORK_BUNDLE_FILE")
    value = ev.read(path)
    lab.require(path.read_bytes() == raw(value), "NETWORK_BUNDLE_NOT_CANONICAL")
    validate_bundle(value, expected_manifest)
    return value


def store_type(base, Problem, bundle, expected_manifest):
    """Extend the pinned Store's transactional read dispatch; reuse its auth and HTTP parser."""
    validate_bundle(bundle, expected_manifest)
    payload, digest = raw(bundle), ev.sha(raw(bundle))

    class NetworkStore(base):
        def _write(self, connection, principal, method, route, body, at, audience=None):
            if (method == "POST" and re.fullmatch(r"/v1/projects/[0-9a-f]{32}/artifacts", route)
                    and body.get("digest") == digest):
                self._role(principal, "AGENT")
                raise Problem(409, "NETWORK_JOB_PUBLICATION_REQUIRED")
            match = re.fullmatch(r"/v1/jobs/([0-9a-f]{32})/complete", route)
            if method == "POST" and match and body.get("report_sha256") == digest:
                job = self._row(connection, "jobs", match.group(1))
                self._job_allowed(connection, principal, job)
                self._role(principal, "AGENT")
                project = self._row(connection, "projects", job["project_id"]) if job["project_id"] else None
                if project is None or project["owner_id"] != job["agent_id"]:
                    raise Problem(403, "NETWORK_PROJECT_PUBLISHER_REQUIRED")
                if type(body.get("report_bytes")) is not int or body["report_bytes"] != len(payload):
                    raise Problem(409, "NETWORK_PUBLICATION_BYTES")
            return super()._write(connection, principal, method, route, body, at, audience)

        def _read(self, connection, route, token, at, limit, after):
            if route == "/v1/status":
                status, result = super()._read(connection, route, token, at, limit, after)
                return status, {**result, "ecosystem": {"protocol": PROTOCOL, "bundle_sha256": digest,
                    "controller_manifest_sha256": expected_manifest, "mode": "PINNED_RESEARCH_REPLAY",
                    "live_execution_allowed": False}}
            if route.startswith("/v1/ecosystem/"):
                match = ARTIFACT_ROUTE.fullmatch(route)
                if match is None or after:
                    raise Problem(404, "NETWORK_ROUTE_NOT_FOUND")
                principal = self._authenticate(connection, token, at)
                self._role(principal, "AGENT")
                project, requested = match.groups()
                self._membership(connection, project, principal["principal_id"])
                if requested != digest:
                    raise Problem(404, "NETWORK_ARTIFACT_NOT_FOUND")
                found = connection.execute("SELECT 1 FROM jobs j JOIN artifacts a ON j.artifact_id=a.id "
                    "JOIN projects p ON p.id=j.project_id AND p.owner_id=j.agent_id "
                    "WHERE j.state='SUCCEEDED' AND j.report_sha256=? AND j.report_bytes=? "
                    "AND j.project_id=? AND a.project_id=j.project_id AND a.author_id=j.agent_id "
                    "AND a.digest=j.report_sha256 LIMIT 1", (digest, len(payload), project)).fetchone()
                if found is None:
                    raise Problem(409, "NETWORK_ARTIFACT_NOT_PUBLISHED")
                return 200, ev.parse(payload)
            return super()._read(connection, route, token, at, limit, after)

    return NetworkStore


def connect(Client, *, port=8765, origin=None, expected_instance, expected_agent, ca_file=None):
    identity(expected_instance)
    identity(expected_agent)
    client = Client(port=port, origin=origin, expected_instance=expected_instance, expected_agent=expected_agent)
    if ca_file is not None:
        lab.require(origin is not None, "NETWORK_CA_REQUIRES_TLS")
        path = safe_path(ca_file)
        lab.require(path.is_file() and 0 < path.stat().st_size <= 65536, "NETWORK_CA_FILE")
        client._tls_context = ssl.create_default_context(cafile=str(path))
    client.deadline = time.monotonic() + 90
    return client


def preflight(client, token, expected_manifest, expected_bundle):
    lab.pin(expected_manifest)
    lab.pin(expected_bundle)
    _, status = client.request("GET", "/v1/status")
    lab.require(same(status.get("ecosystem"), {"protocol": PROTOCOL, "bundle_sha256": expected_bundle,
                "controller_manifest_sha256": expected_manifest, "mode": "PINNED_RESEARCH_REPLAY",
                "live_execution_allowed": False}), "NETWORK_CAPABILITY_OR_RELEASE_MISMATCH")
    _, principal = client.request("GET", "/v1/me", token=token)
    lab.require(principal.get("role") == "AGENT" and principal.get("principal_id") == client.expected_agent,
                "NETWORK_AGENT_REQUIRED")
    return status


def receive(client, token, project, expected_manifest, expected_bundle):
    identity(project)
    preflight(client, token, expected_manifest, expected_bundle)
    _, value = client.request("GET", f"/v1/ecosystem/projects/{project}/artifacts/{expected_bundle}", token=token)
    lab.require(ev.sha(raw(value)) == expected_bundle, "NETWORK_TRANSFER_HASH")
    validate_bundle(value, expected_manifest)
    return value


def prediction(bundle, expected_manifest, domain, features):
    audit = validate_bundle(bundle, expected_manifest)
    lab.require(domain in b.DOMAINS, "NETWORK_DOMAIN")
    result = x.guarded_predict(bundle["reports"][domain]["model"], features, audit)
    return {"protocol": "AAI_NETWORK_ADVISORY_V1", "domain": domain, "advisory": result,
            "source_mode": "PINNED_RESEARCH_REPLAY", "controller_manifest_sha256": expected_manifest,
            "research_signal": "ABSTAIN", "execution": "DISABLED", "live_execution_allowed": False}


def exercise(bundle, expected_manifest):
    """Exercise binary vectors and all published contexts, not market performance."""
    audit = validate_bundle(bundle, expected_manifest)
    domains = {}
    for domain in b.DOMAINS:
        model = bundle["reports"][domain]["model"]
        vectors = set(product((0, 1), repeat=b.WIDTH[domain]))
        vectors.update(tuple(v["features"]) for v in model["contexts"].values())
        outputs = [x.guarded_predict(model, list(bits), audit) for bits in sorted(vectors)]
        domains[domain] = {"queries": len(outputs), "outputs_sha256": lab.digest(outputs),
                           "advisories": sum(v["prediction"] is not None for v in outputs),
                           "abstentions": sum(v["prediction"] is None for v in outputs),
                           "blocked_contexts_suppressed": sum(v["reason"] == "CONTRADICTORY_VERIFIED_OUTCOMES" for v in outputs)}
    return {"protocol": "AAI_NETWORK_CONSUMPTION_REPORT_V1", "source_mode": "PINNED_RESEARCH_REPLAY",
            "controller_manifest_sha256": expected_manifest, "bundle_sha256": ev.sha(raw(bundle)),
            "domains": domains, "queries": sum(v["queries"] for v in domains.values()),
            "model_versions": bundle["controller_public"]["active_models"],
            "research_signal": "ABSTAIN", "execution": "DISABLED", "live_execution_allowed": False}


def active_jobs(client, token, project):
    """Read the bounded community job history without confusing old jobs with a busy queue."""
    active, after = [], ""
    for _ in range(20):  # Pinned community cap: 2,000 jobs, 100 per page.
        path = "/v1/jobs?limit=100" + ("&after=" + after if after else "")
        _, page = client.request("GET", path, token=token)
        lab.require(type(page.get("items")) is list and len(page["items"]) <= 100, "NETWORK_JOB_PAGE")
        ids = [identity(job["id"]) for job in page["items"]]
        lab.require(ids == sorted(set(ids)) and all(value > after for value in ids), "NETWORK_JOB_PAGE_ORDER")
        active.extend(job for job in page["items"] if job["project_id"] == project and job["state"] in ("QUEUED", "RUNNING"))
        next_after = page.get("next_after")
        if next_after is None:
            return active
        lab.require(ids and identity(next_after) == ids[-1], "NETWORK_JOB_CURSOR")
        after = next_after
    raise ValueError("NETWORK_JOB_HISTORY_BOUND")


def dispatch(client, token, project, kind, expected_report, handler):
    """One dedicated agent queue; successful retries reuse its existing job and artifact."""
    identity(project)
    lab.require(kind in ("publish", "consume"), "NETWORK_TASK_KIND")
    payload = raw(expected_report)
    lab.require(0 < len(payload) <= MAX_BYTES, "NETWORK_REPORT_BYTES")
    report_sha = ev.sha(payload)
    request = {"request_id": lab.digest([client.expected_instance, client.expected_agent, project, kind, report_sha])[:32],
               "title": "Network advisory " + kind, "prompt": ev.canonical({"protocol": PROTOCOL,
               "task": kind, "expected_report_sha256": report_sha}), "project_id": project,
               "max_steps": 2, "timeout_seconds": 120}
    _, submitted = client.request("POST", "/v1/jobs", request, token)
    job = submitted["job"]
    if job["state"] != "SUCCEEDED":
        lab.require(job["state"] == "QUEUED", "NETWORK_JOB_REQUIRES_OPERATOR_RECOVERY")
        active = active_jobs(client, token, project)
        lab.require(len(active) == 1 and active[0]["id"] == job["id"],
                    "NETWORK_DEDICATED_QUEUE_REQUIRED")
        _, claimed = client.request("POST", "/v1/jobs/claim", {"max_steps": 2, "timeout_seconds": 120,
                                    "project_id": project}, token)
        work = claimed["job"]
        lab.require(work is not None and work["id"] == job["id"], "NETWORK_CLAIM_TARGET")
        completion = {"attempt_id": work["attempt_id"], "claim_token": claimed["claim_token"], "state": "SUCCEEDED",
                      "report_sha256": report_sha, "report_bytes": len(payload), "steps": 1, "error_code": None}
        try:
            lab.require(raw(handler()) == payload, "NETWORK_HANDLER_RESULT")
        except Exception:
            try:
                client.request("POST", f"/v1/jobs/{work['id']}/complete", {**completion, "state": "FAILED",
                    "report_sha256": None, "report_bytes": None, "steps": 0, "error_code": "NETWORK_HANDLER_FAILED"}, token)
            except Exception:
                pass  # Preserve an uncertain lease; never guess successful execution.
            raise
        _, finished = client.request("POST", f"/v1/jobs/{work['id']}/complete", completion, token)
        job = finished["job"]
    lab.require(job["state"] == "SUCCEEDED" and job["agent_id"] == client.expected_agent
                and job["project_id"] == project and job["report_sha256"] == report_sha
                and job["report_bytes"] == len(payload) and type(job["artifact_id"]) is str, "NETWORK_JOB_BINDING")
    return {"job_id": job["id"], "agent_id": job["agent_id"], "project_id": project, "artifact_id": job["artifact_id"],
            "report_sha256": report_sha, "report_bytes": len(payload), "replayed": submitted["replayed"],
            "state": "SUCCEEDED", "live_execution_allowed": False}
