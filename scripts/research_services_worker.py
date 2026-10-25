"""Actual community HTTP service orders and separately executed research work."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
import os
from pathlib import Path
import signal
import sqlite3
import ssl
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ecosystem_research import network as n, scanner_feed as f, services as s, service_evidence as evidence  # noqa: E402
from src.ecosystem_research.checkout import worker_environment  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402

sys.path.insert(0, str(ROOT / "scripts"))
import ecosystem_network_worker as nw  # noqa: E402


def resources_for(cfg, bundle=None):
    bundle = (
        n.read_bundle(cfg["bundle_file"], cfg["controller_manifest_sha256"])
        if bundle is None
        else bundle
    )
    directory = n.safe_path(cfg["feed_directory"])
    journal = f.ObservationJournal(
        directory / "observations.sqlite3", ev.read(directory / "policy.json")
    )
    return s.Resources(
        bundle,
        cfg["controller_manifest_sha256"],
        journal,
        cfg["feed_head_sha256"],
        cfg["feed_policy_sha256"],
    )


def connection(cfg):
    Client, read_credential, _, _, _ = nw.components(cfg["community_source"])
    role = cfg.get("expected_role", "AGENT")
    lab.require(role in ("AGENT", "OPERATOR", "OWNER"), "SERVICE_CLIENT_ROLE")
    instance, principal = (
        n.identity(cfg["expected_instance"]),
        cfg["expected_principal"],
    )
    if role != "OWNER":
        n.identity(principal)
    else:
        lab.require(principal == "owner", "SERVICE_CLIENT_OWNER")
    client = Client(
        port=cfg.get("port", 8765),
        origin=cfg.get("origin"),
        expected_instance=instance,
        expected_agent=principal if role == "AGENT" else None,
    )
    if cfg.get("ca_file"):
        lab.require(cfg.get("origin"), "SERVICE_CA_REQUIRES_TLS")
        path = n.safe_path(cfg["ca_file"])
        lab.require(path.is_file() and path.stat().st_size <= 65536, "SERVICE_CA_FILE")
        client._tls_context = ssl.create_default_context(cafile=str(path))
    client.deadline = time.monotonic() + 90
    token = read_credential(cfg["credential"])
    _, status = client.request("GET", "/v1/status")
    lab.require(
        n.same(
            status.get("research_services"),
            {
                "protocol": s.PROTOCOL,
                "catalog_sha256": lab.pin(cfg["catalog_sha256"]),
                "unit": s.UNIT,
                "financial_settlement": False,
                "live_execution_allowed": False,
            },
        ),
        "SERVICE_REMOTE_CATALOG_PIN",
    )
    _, me = client.request("GET", "/v1/me", token=token)
    lab.require(
        me["role"] == role and me["principal_id"] == principal,
        "SERVICE_CLIENT_IDENTITY",
    )
    return client, token


def action(client, token, command):
    s.command_value(command)
    return client.request("POST", s.ROOT_ROUTE + "/actions", command, token)[1]


def automatic(kind, record_id, **fields):
    return {
        "request_id": lab.digest([s.PROTOCOL, kind, record_id])[:32],
        "kind": kind,
        **fields,
    }


@contextmanager
def agent_resources(client, token, cfg, order):
    bundle = n.receive(client, token, order["project_id"],
                       cfg["controller_manifest_sha256"], cfg["bundle_sha256"])
    if cfg.get("feed_directory"):
        resources = resources_for(cfg, bundle)
        receipt = {"mode": "EXPLICIT_LOCAL_JOURNAL", "feed_head_sha256": resources.head,
                   "feed_policy_sha256": resources.policy, "independent_source_attestation": False}
        lab.require(resources.digest == cfg["catalog_sha256"], "SERVICE_LOCAL_CATALOG_PIN")
        yield resources, receipt
    else:
        with evidence.receive(client, token, cfg["catalog_sha256"], order["id"],
                              cfg["feed_head_sha256"], cfg["feed_policy_sha256"]) as (journal, receipt):
            resources = s.Resources(bundle, cfg["controller_manifest_sha256"], journal,
                                    cfg["feed_head_sha256"], cfg["feed_policy_sha256"])
            lab.require(resources.digest == cfg["catalog_sha256"], "SERVICE_LOCAL_CATALOG_PIN")
            yield resources, receipt


def preflight(client, token, cfg, order, listing, resources, receipt):
    action_name = cfg["for_action"]
    lab.require(action_name in ("fulfill", "accept"), "SERVICE_PREFLIGHT_ACTION")
    report = resources.report(order, listing)
    _, ready = client.request("GET", s.ROOT_ROUTE + "/orders/" + order["id"] + "/readiness", token=token)
    lab.exact(ready, ("protocol", "catalog_sha256", "order_id", "order_state", "job_state",
                      "observed_at_ms", "head_sha256", "blockers", "scope", "authorization_granted",
                      "financial_settlement", "live_execution_allowed"))
    lab.require(ready["protocol"] == "AAI_SERVICE_READINESS_V1"
                and ready["catalog_sha256"] == resources.digest and ready["order_id"] == order["id"]
                and ready["scope"] == "POINT_IN_TIME_RESEARCH_ACTION"
                and ready["authorization_granted"] is False and ready["financial_settlement"] is False
                and ready["live_execution_allowed"] is False, "SERVICE_PREFLIGHT_BINDING")
    lab.exact(ready["blockers"], ("fulfill", "accept"))
    allowed = {"PROVIDER_REQUIRED", "BUYER_REQUIRED", "DELIVERY_REQUIRED", "ORDER_NOT_WORKABLE",
               "OFFER_UNAVAILABLE", "MANDATE_REVOKED", "START_WINDOW_EXPIRED", "DEDICATED_QUEUE_REQUIRED",
               "OPERATOR_RECOVERY_REQUIRED", "BUYER_MEMBERSHIP_REQUIRED"}
    for codes in ready["blockers"].values():
        lab.require(type(codes) is list and len(codes) <= len(allowed)
                    and all(type(c) is str and c in allowed for c in codes), "SERVICE_PREFLIGHT_REASONS")
    return {
        "protocol": "AAI_SERVICE_PREFLIGHT_V1", "status": "BLOCKED" if ready["blockers"][action_name]
        else "READY_FOR_BOUNDED_RESEARCH_ACTION", "action": action_name,
        "connection_binding": client.binding(), "transport": "HTTPS_VERIFIED" if client.origin else "LOOPBACK_HTTP",
        "catalog_sha256": resources.digest, "order_id": order["id"],
        "model_bundle_sha256": ev.sha(n.raw(resources.bundle)), "evidence": receipt,
        "expected_report_sha256": ev.sha(n.raw(report)), "server_readiness": ready,
        "physical_host_commissioned": False, "financial_settlement": False, "live_execution_allowed": False,
    }


def leaf(verb, cfg):
    client, token = connection(cfg)
    if verb == "act":
        command = (
            ev.read(n.safe_path(cfg["action_file"]))
            if cfg.get("action_file")
            else cfg["action"]
        )
        return action(client, token, command)
    _, view = client.request("GET", s.ROOT_ROUTE + "/view", token=token)
    if verb == "observe":
        return view
    if verb == "work-once":
        lab.require(cfg.get("expected_role", "AGENT") == "AGENT", "SERVICE_AGENT_REQUIRED")
        outcomes = []
        selected = s.assignments(view, cfg["expected_principal"], cfg["work_mode"], cfg["max_orders"])
        for item in selected:
            try:
                result = for_order("work", {**cfg, "order_id": item["order_id"], "for_action": item["action"]},
                                   client, token, view)
                outcomes.append({**item, **result})
            except Exception as error:
                code = getattr(error, "code", None)
                if code is None:
                    code = str(error)[:100] if isinstance(error, ValueError) else type(error).__name__
                outcomes.append({**item, "status": "STOPPED_FOR_REVIEW", "error": code,
                                 "automatic_retry": False})
                break
        status = "NO_ELIGIBLE_ORDERS" if not selected else "COMPLETE"
        if any(o["status"] == "STOPPED_FOR_REVIEW" for o in outcomes):
            status = "STOPPED_FOR_REVIEW"
        elif outcomes and all(o["status"] == "BLOCKED" for o in outcomes):
            status = "BLOCKED"
        return {"protocol": "AAI_SERVICE_WORK_CYCLE_V1", "status": status, "outcomes": outcomes,
                "candidate_limit": cfg["max_orders"], "work_mode": cfg["work_mode"],
                "unit": s.UNIT, "financial_settlement": False, "live_execution_allowed": False}
    return for_order(verb, cfg, client, token, view)


def for_order(verb, cfg, client, token, view):
    order = view["orders"].get(n.identity(cfg["order_id"]))
    lab.require(order is not None, "SERVICE_ORDER_NOT_VISIBLE")
    listing = view["listings"].get(order["listing_id"])
    lab.require(listing is not None, "SERVICE_LISTING_NOT_VISIBLE")
    with agent_resources(client, token, cfg, order) as (resources, receipt):
        if verb == "preflight":
            return preflight(client, token, cfg, order, listing, resources, receipt)
        if verb == "work":
            ready = preflight(client, token, cfg, order, listing, resources, receipt)
            if ready["status"] == "BLOCKED":
                return {"status": "BLOCKED", "preflight": ready}
            result = perform(cfg["for_action"], cfg, client, token, order, listing, resources)
            return {"status": "COMPLETED", "preflight": ready, "result": result, "evidence": receipt}
        return {**perform(verb, cfg, client, token, order, listing, resources), "evidence": receipt}


def perform(verb, cfg, client, token, order, listing, resources):
    if verb == "accept":
        lab.require(
            order["buyer_id"] == cfg["expected_principal"], "SERVICE_BUYER_REQUIRED"
        )
        _, delivery = client.request(
            "GET", s.ROOT_ROUTE + "/orders/" + order["id"] + "/delivery", token=token
        )
        report = resources.report(order, listing)
        lab.require(
            n.same(delivery["report"], report)
            and delivery["content_sha256"] == ev.sha(n.raw(report)),
            "SERVICE_BUYER_REPORT_REPLAY",
        )
        return action(
            client,
            token,
            automatic(
                "ACCEPT",
                order["id"],
                order_id=order["id"],
                report_sha256=delivery["content_sha256"],
            ),
        )
    lab.require(
        verb == "fulfill" and order["provider_id"] == cfg["expected_principal"],
        "SERVICE_PROVIDER_REQUIRED",
    )
    if order["state"] == "OPEN":
        order = action(
            client, token, automatic("START", order["id"], order_id=order["id"])
        )["result"]
    lab.require(
        order["state"] in ("STARTED", "DELIVERED", "ACCEPTED"),
        "SERVICE_ORDER_NOT_WORKABLE",
    )
    _, job = client.request("GET", "/v1/jobs/" + order["job_id"], token=token)
    job_reused = job["state"] == "SUCCEEDED"
    if job["state"] != "SUCCEEDED":
        lab.require(job["state"] == "QUEUED", "SERVICE_JOB_REQUIRES_OPERATOR_RECOVERY")
        active = n.active_jobs(client, token, order["project_id"])
        lab.require(
            len(active) == 1 and active[0]["id"] == job["id"],
            "SERVICE_DEDICATED_QUEUE_REQUIRED",
        )
        _, claimed = client.request(
            "POST",
            "/v1/jobs/claim",
            {"project_id": order["project_id"], "max_steps": 2, "timeout_seconds": 120},
            token,
        )
        work = claimed["job"]
        lab.require(
            work is not None and work["id"] == order["job_id"], "SERVICE_CLAIM_TARGET"
        )
        completion = {
            "attempt_id": work["attempt_id"],
            "claim_token": claimed["claim_token"],
            "state": "SUCCEEDED",
            "report_sha256": None,
            "report_bytes": None,
            "steps": 1,
            "error_code": None,
        }
        try:
            report = resources.report(order, listing)
            payload = n.raw(report)
            completion.update(report_sha256=ev.sha(payload), report_bytes=len(payload))
            if cfg.get("lab_completion_denial"):
                lab.require(
                    cfg.get("lab_scope") == "DISPOSABLE_SERVICE_LAB",
                    "SERVICE_TEST_SCOPE",
                )
                try:
                    client.request(
                        "POST",
                        "/v1/jobs/" + work["id"] + "/complete",
                        {**completion, "report_bytes": len(payload) + 1},
                        token,
                    )
                except Exception as error:
                    lab.require(
                        getattr(error, "code", None)
                        == "SERVICE_COMPLETION_CONTENT_MISMATCH",
                        "SERVICE_WRONG_COMPLETION_DENIAL",
                    )
                else:
                    raise ValueError("SERVICE_BAD_COMPLETION_ACCEPTED")
        except Exception:
            try:
                client.request(
                    "POST",
                    "/v1/jobs/" + work["id"] + "/complete",
                    {
                        **completion,
                        "state": "FAILED",
                        "report_sha256": None,
                        "report_bytes": None,
                        "steps": 0,
                        "error_code": "SERVICE_COMPUTATION_FAILED",
                    },
                    token,
                )
            except Exception:
                pass
            raise
        _, done = client.request(
            "POST", "/v1/jobs/" + work["id"] + "/complete", completion, token
        )
        job = done["job"]
        if cfg.get("lab_exit_after_complete"):
            lab.require(
                cfg.get("lab_scope") == "DISPOSABLE_SERVICE_LAB", "SERVICE_TEST_SCOPE"
            )
            os._exit(88)
    report = resources.report(order, listing)
    lab.require(
        job["state"] == "SUCCEEDED"
        and job["report_sha256"] == ev.sha(n.raw(report))
        and job["report_bytes"] == len(n.raw(report)),
        "SERVICE_WORKER_JOB_BINDING",
    )
    if order["state"] == "STARTED":
        result = action(
            client,
            token,
            automatic(
                "DELIVER",
                order["id"],
                order_id=order["id"],
                report_sha256=job["report_sha256"],
            ),
        )
    else:
        result = {"result": order, "replayed": True}
    if cfg.get("output"):
        target = n.safe_path(cfg["output"])
        if target.exists():
            lab.require(
                target.is_file()
                and target.stat().st_nlink == 1
                and target.stat().st_size <= n.MAX_BYTES
                and target.read_bytes() == n.raw(report),
                "SERVICE_OUTPUT_CONFLICT",
            )
        else:
            ev.write(target, report)
    return {
        **result,
        "job_reused": job_reused,
        "job_id": job["id"],
        "report_sha256": job["report_sha256"],
        "financial_settlement": False,
        "live_execution_allowed": False,
    }


def serve(cfg):
    _, _, Store, Problem, Server = nw.components(cfg["community_source"])
    resources = resources_for(cfg)
    ServiceStore = s.store_type(Store, Problem, resources)
    store = (
        ServiceStore.initialize(cfg["state"], cfg["owner_file"])
        if cfg.get("initialize")
        else ServiceStore(cfg["state"])
    )
    store.audit()
    store.service_audit()
    os.environ.pop("ZOORA_PUBLIC_ORIGIN", None)
    os.environ.pop("ZOORA_PRIVATE_PILOT", None)
    if cfg.get("public_origin"):
        os.environ["ZOORA_PUBLIC_ORIGIN"] = cfg["public_origin"]
    server = Server(store, cfg.get("port", 8765))
    _, status = store.call("GET", "/v1/status")
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        print(
            ev.canonical(
                {
                    "protocol": s.PROTOCOL,
                    "url": server.origin,
                    "instance_id": status["instance_id"],
                    "catalog_sha256": resources.digest,
                    "bundle_sha256": ev.sha(n.raw(resources.bundle)),
                    "controller_manifest_sha256": resources.controller,
                    "feed_head_sha256": resources.head,
                    "feed_policy_sha256": resources.policy,
                    "agent_source_transport": "AUTHENTICATED_RECORD_TRANSFER",
                    "physical_host_commissioned": False,
                    "unit": s.UNIT,
                    "financial_settlement": False,
                    "live_execution_allowed": False,
                }
            ),
            flush=True,
        )
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
    return {
        "status": "STOPPED",
        "financial_settlement": False,
        "live_execution_allowed": False,
    }


def child(verb, cfg, allow_error=False):
    with tempfile.TemporaryDirectory() as folder:
        packet = Path(folder) / "packet.json"
        ev.write(packet, cfg)
        completed = subprocess.run(
            [
                sys.executable,
                "-I",
                "-B",
                str(Path(__file__).resolve()),
                verb,
                str(packet),
            ],
            capture_output=True,
            timeout=120,
            check=False,
            env=worker_environment(),
        )
    lab.require(
        len(completed.stdout) + len(completed.stderr) <= 1024**2,
        "SERVICE_WORKER_LOG_BOUND",
    )
    if completed.returncode == 88 and allow_error:
        return {"exit_code": 88}
    value = ev.parse(completed.stdout)
    if completed.returncode and not allow_error:
        raise ValueError("SERVICE_CHILD_REJECTED:" + str(value.get("error"))[:200])
    return value


def run_lab(output, cfg):
    Client, _, Store, Problem, Server = nw.components(cfg["community_source"])
    resources = resources_for(cfg)
    ServiceStore = s.store_type(Store, Problem, resources)
    with tempfile.TemporaryDirectory() as temporary:
        private = Path(temporary)
        store = ServiceStore.initialize(output / "agents", private / "owner.json")
        owner = ev.read(private / "owner.json")["token"]
        os.environ.pop("ZOORA_PUBLIC_ORIGIN", None)
        os.environ.pop("ZOORA_PRIVATE_PILOT", None)
        server = Server(store, 0)
        proxy = None
        transport = {"port": server.server_port}
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        checks, peers, secrets, connections = {}, {}, [owner], []
        serial = 0

        def command(kind, **fields):
            nonlocal serial
            serial += 1
            return {"kind": kind, "request_id": format(serial, "032x"), **fields}

        def denied(name, operation, expected=None):
            try:
                operation()
            except Problem as error:
                lab.require(
                    expected is None or error.code == expected,
                    "SERVICE_UNEXPECTED_DENIAL:" + name + ":" + error.code,
                )
                checks[name] = True
            else:
                raise ValueError("SERVICE_DENIAL_MISSING:" + name)

        try:
            _, status = Client(port=server.server_port).request("GET", "/v1/status")
            instance = status["instance_id"]
            admin = Client(port=server.server_port, expected_instance=instance)
            for role in ("service_alpha", "service_beta", "service_outsider"):
                agent, credential, operator = nw.enroll(admin, owner, role)
                ev.write(private / (role + ".json"), credential)
                _, op_me = admin.request("GET", "/v1/me", token=operator)
                ev.write(
                    private / (role + "-operator.json"), {"token": operator, **op_me}
                )
                peers[role] = {
                    "agent": agent,
                    "token": credential["token"],
                    "operator": operator,
                    "operator_id": op_me["principal_id"],
                    "credential": str(private / (role + ".json")),
                    "operator_credential": str(private / (role + "-operator.json")),
                }
                secrets += [credential["token"], operator]
            alpha, beta, outsider = (
                peers[k] for k in ("service_alpha", "service_beta", "service_outsider")
            )

            def cli(peer):
                return {
                    **{key: value for key, value in cfg.items()
                       if key not in ("output", "feed_directory", "bundle_file")},
                    **transport,
                    "expected_instance": instance,
                    "expected_principal": peer["agent"],
                    "expected_role": "AGENT",
                    "credential": peer["credential"],
                    "catalog_sha256": resources.digest,
                    "bundle_sha256": ev.sha(n.raw(resources.bundle)),
                }

            def client(peer):
                return nw.client_for(
                    Client,
                    {
                        "port": server.server_port,
                        "expected_instance": instance,
                        "expected_agent": peer["agent"],
                    },
                )

            def do(peer, body):
                return action(client(peer), peer["token"], body)

            def probe(peer, order, action_name, expected):
                config = {**cli(peer), "order_id": order["id"], "for_action": action_name}
                args = [sys.executable, "-I", "-B", str(ROOT / "scripts/run_research_services.py"), "preflight"]
                for key in ("community_source", "port", "origin", "ca_file", "credential", "expected_instance",
                            "expected_principal", "catalog_sha256", "bundle_sha256", "controller_manifest_sha256",
                            "feed_head_sha256", "feed_policy_sha256", "order_id", "for_action"):
                    if key in config:
                        flag = "trusted-controller-sha256" if key == "controller_manifest_sha256" else key.replace("_", "-")
                        args.extend(("--" + flag, str(config[key])))
                before = (store.audit(), store.service_audit())
                completed = subprocess.run(args, capture_output=True, timeout=120, env=worker_environment())
                lab.require(len(completed.stdout) + len(completed.stderr) <= 1024**2, "SERVICE_PREFLIGHT_LOG_BOUND")
                result = ev.parse(completed.stdout)
                lab.require(completed.returncode == (3 if expected == "BLOCKED" else 0)
                            and result.get("status") == expected
                            and result["evidence"]["mode"] == "AUTHENTICATED_RECORD_TRANSFER",
                            "SERVICE_PUBLIC_PREFLIGHT")
                lab.require(n.same(before, (store.audit(), store.service_audit())), "SERVICE_PREFLIGHT_MUTATED_STATE")
                connections.append(result)
                return result

            for peer in (alpha, beta):
                c = client(peer)
                _, project = c.request(
                    "POST",
                    "/v1/projects",
                    {
                        "title": "Research service exchange",
                        "summary": "Verified research work; no monetary settlement",
                    },
                    peer["token"],
                )
                peer["project"] = project["id"]
                for member in (alpha, beta):
                    if member is not peer:
                        c.request(
                            "POST",
                            "/v1/projects/" + project["id"] + "/members",
                            {"agent_id": member["agent"]},
                            peer["token"],
                        )
                nw.child(
                    "publish",
                    {
                        "community_source": cfg["community_source"],
                        "port": server.server_port,
                        "expected_instance": instance,
                        "expected_agent": peer["agent"],
                        "credential": peer["credential"],
                        "project_id": peer["project"],
                        "bundle_sha256": ev.sha(n.raw(resources.bundle)),
                        "controller_manifest_sha256": resources.controller,
                        "bundle_file": cfg["bundle_file"],
                    },
                )
            expiry = time.time_ns() // 1000000 + 600000
            for peer, limit in ((alpha, 6), (beta, 8)):
                body = command(
                    "MANDATE",
                    buyer_id=peer["agent"],
                    limit=limit,
                    expires_ms=expiry,
                    services=sorted(s.KINDS),
                )
                value = child(
                    "act",
                    {
                        **cli(peer),
                        "expected_principal": peer["operator_id"],
                        "expected_role": "OPERATOR",
                        "credential": peer["operator_credential"],
                        "action": body,
                    },
                )
                peer["mandate"] = value["result"]
            for peer, kind, units in ((alpha, s.KINDS[0], 3), (beta, s.KINDS[1], 4)):
                offer_terms = s.terms(kind, resources.resource_id(kind), units, expiry)
                _, base_offer = client(peer).request(
                    "POST",
                    "/v1/offers",
                    {
                        "project_id": peer["project"],
                        "title": "Registered research work",
                        "criteria_digest": lab.digest(offer_terms),
                        "quote": str(units) + " " + s.UNIT,
                        "delivery_terms": s.PROTOCOL + ":" + kind,
                    },
                    peer["token"],
                )
                peer["listing"] = do(
                    peer,
                    command(
                        "OFFER",
                        community_offer_id=base_offer["id"],
                        service=kind,
                        resource_sha256=resources.resource_id(kind),
                        work_units=units,
                        expires_ms=expiry,
                    ),
                )["result"]

            def order_body(buyer, provider):
                return command(
                    "ORDER",
                    mandate_id=buyer["mandate"]["id"],
                    listing_id=provider["listing"]["id"],
                    terms_sha256=provider["listing"]["terms_sha256"],
                    start_before_ms=expiry - 1000,
                )

            first = do(alpha, order_body(alpha, beta))["result"]
            second = do(beta, order_body(beta, alpha))["result"]
            probe(beta, first, "fulfill", "READY_FOR_BOUNDED_RESEARCH_ACTION")
            probe(alpha, first, "accept", "BLOCKED")
            checks["public_preflight_cli_exit_codes"] = True
            checks["preflight_does_not_create_jobs_or_audit_events"] = True
            source_route = s.ROOT_ROUTE + "/orders/" + first["id"] + "/evidence"
            for label, denied_token in (("anonymous", None), ("foreign_agent", outsider["token"]),
                                        ("owner", owner), ("operator", alpha["operator"])):
                denied("evidence_denies_" + label,
                       lambda auth=denied_token: admin.request("GET", source_route, token=auth))
            _, manifest = client(beta).request("GET", source_route, token=beta["token"])
            for label, suffix in (("wrong_export", "/" + "f" * 64 + "/0"),
                                  ("out_of_range", "/" + manifest["payload_sha256"] + "/99")):
                denied("evidence_denies_" + label,
                       lambda tail=suffix: client(beta).request("GET", source_route + tail, token=beta["token"]))
            before = (store.audit(), store.service_audit())
            failed = child("fulfill", {**cli(beta), "order_id": first["id"], "feed_head_sha256": "f" * 64}, allow_error=True)
            lab.require(failed.get("error") == "EVIDENCE_MANIFEST_BINDING"
                        and n.same(before, (store.audit(), store.service_audit())), "SERVICE_SOURCE_FAILURE_STARTED_WORK")
            checks["wrong_remote_source_pin_before_job_creation"] = True
            stopped = child("work-once", {**cli(beta), "work_mode": "provide", "max_orders": 2,
                                           "feed_head_sha256": "f" * 64})
            lab.require(stopped["status"] == "STOPPED_FOR_REVIEW"
                        and len(stopped["outcomes"]) == 1
                        and stopped["outcomes"][0]["automatic_retry"] is False
                        and n.same(before, (store.audit(), store.service_audit())), "SERVICE_WORK_CYCLE_UNSAFE_RETRY")
            checks["bounded_worker_stops_on_source_failure_without_job"] = True
            protected = ev.sha(n.raw(resources.report(first, beta["listing"])))
            denied(
                "bare_service_declaration",
                lambda: client(beta).request(
                    "POST",
                    "/v1/projects/" + beta["project"] + "/artifacts",
                    {"digest": protected, "title": "Forbidden bare service digest"},
                    beta["token"],
                ),
                "SERVICE_JOB_PUBLICATION_REQUIRED",
            )
            denied(
                "anonymous_catalog",
                lambda: Client(port=server.server_port).request(
                    "GET", s.ROOT_ROUTE + "/catalog"
                ),
                "UNAUTHORIZED",
            )
            denied(
                "foreign_operator_allowance",
                lambda: admin.request(
                    "POST",
                    s.ROOT_ROUTE + "/actions",
                    command(
                        "MANDATE",
                        buyer_id=alpha["agent"],
                        limit=1,
                        expires_ms=expiry,
                        services=sorted(s.KINDS),
                    ),
                    beta["operator"],
                ),
                "SERVICE_FOREIGN_BUYER",
            )
            denied(
                "self_order",
                lambda: do(beta, order_body(beta, beta)),
                "SERVICE_BUYER_OR_SELF_ORDER",
            )
            denied(
                "accept_before_delivery",
                lambda: do(
                    alpha,
                    command("ACCEPT", order_id=first["id"], report_sha256="f" * 64),
                ),
                "SERVICE_ACCEPTANCE_BINDING",
            )
            denied(
                "uncertain_open_abort",
                lambda: do(alpha, command("CANCEL", order_id=second["id"])),
                "SERVICE_ACTOR_FORBIDDEN",
            )
            bad_pin = child(
                "observe", {**cli(alpha), "catalog_sha256": "f" * 64}, allow_error=True
            )
            lab.require(
                bad_pin.get("error") == "SERVICE_REMOTE_CATALOG_PIN",
                "SERVICE_CATALOG_PROBE",
            )
            checks["wrong_catalog_before_agent_operation"] = True
            crash = child(
                "fulfill",
                {
                    **cli(beta),
                    "order_id": first["id"],
                    "lab_scope": "DISPOSABLE_SERVICE_LAB",
                    "lab_exit_after_complete": True,
                    "lab_completion_denial": True,
                },
                allow_error=True,
            )
            lab.require(crash.get("exit_code") == 88, "SERVICE_CRASH_POINT")
            checks["actual_process_exit_after_job_commit"] = True
            checks["wrong_completion_bytes_rejected"] = True
            uncertain = child("work-once", {**cli(beta), "work_mode": "provide", "max_orders": 2})
            lab.require(uncertain["status"] == "NO_ELIGIBLE_ORDERS", "SERVICE_WORK_CYCLE_UNCERTAIN_RETRY")
            checks["bounded_worker_leaves_started_recovery_explicit"] = True
            recovered = child(
                "fulfill",
                {
                    **cli(beta),
                    "order_id": first["id"],
                    "output": str(output / "alpha-delivery.json"),
                },
            )
            lab.require(recovered["job_reused"] and recovered["evidence"]["mode"] == "AUTHENTICATED_RECORD_TRANSFER",
                        "SERVICE_LOST_COMPLETION_CREATED_JOB")
            checks["provider_uses_remote_evidence_without_shared_path"] = True
            provisioned = child("work-once", {**cli(alpha), "work_mode": "provide", "max_orders": 2})
            lab.require(provisioned["status"] == "COMPLETE" and len(provisioned["outcomes"]) == 1
                        and provisioned["outcomes"][0]["order_id"] == second["id"]
                        and provisioned["outcomes"][0]["status"] == "COMPLETED", "SERVICE_PROVIDER_WORK_CYCLE")
            # Retain the report through the same authenticated delivery endpoint.
            _, published = client(alpha).request("GET", s.ROOT_ROUTE + "/orders/" + second["id"] + "/delivery", token=alpha["token"])
            ev.write(output / "beta-delivery.json", published["report"])
            checks["bounded_worker_provides_eligible_order"] = True
            denied(
                "foreign_delivery",
                lambda: client(outsider).request(
                    "GET",
                    s.ROOT_ROUTE + "/orders/" + first["id"] + "/delivery",
                    token=outsider["token"],
                ),
                "SERVICE_ORDER_ACCESS",
            )
            denied(
                "provider_cannot_accept",
                lambda: do(
                    beta,
                    command(
                        "ACCEPT",
                        order_id=first["id"],
                        report_sha256=recovered["report_sha256"],
                    ),
                ),
                "SERVICE_ACTOR_FORBIDDEN",
            )
            denied(
                "changed_acceptance_digest",
                lambda: do(
                    alpha,
                    command("ACCEPT", order_id=first["id"], report_sha256="f" * 64),
                ),
                "SERVICE_ACCEPTANCE_BINDING",
            )
            denied(
                "owner_cannot_accept",
                lambda: admin.request(
                    "POST",
                    s.ROOT_ROUTE + "/actions",
                    command(
                        "ACCEPT",
                        order_id=first["id"],
                        report_sha256=recovered["report_sha256"],
                    ),
                    owner,
                ),
                "SERVICE_ACTOR_FORBIDDEN",
            )
            accepted_cycle = child("work-once", {**cli(alpha), "work_mode": "accept", "max_orders": 2})
            lab.require(accepted_cycle["status"] == "COMPLETE" and len(accepted_cycle["outcomes"]) == 1,
                        "SERVICE_BUYER_WORK_CYCLE")
            accepted = accepted_cycle["outcomes"][0]
            lab.require(accepted["evidence"]["mode"] == "AUTHENTICATED_RECORD_TRANSFER", "SERVICE_BUYER_REMOTE_SOURCE")
            checks["bounded_worker_accepts_verified_delivery"] = True
            checks["buyer_reconstructs_remote_evidence_before_acceptance"] = True
            child("accept", {**cli(beta), "order_id": second["id"]})
            idle = child("work-once", {**cli(alpha), "work_mode": "both", "max_orders": 2})
            lab.require(idle["status"] == "NO_ELIGIBLE_ORDERS" and not idle["outcomes"], "SERVICE_WORK_CYCLE_DUPLICATE")
            checks["bounded_worker_does_not_repeat_completed_orders"] = True
            replay = child("accept", {**cli(alpha), "order_id": first["id"]})
            lab.require(replay["replayed"], "SERVICE_ACCEPT_REPLAY")
            checks["acceptance_replay_without_second_charge"] = True

            race_commands = [order_body(beta, alpha) for _ in range(6)]
            with ThreadPoolExecutor(max_workers=6) as pool:
                raced = list(
                    pool.map(
                        lambda body: child(
                            "act", {**cli(beta), "action": body}, allow_error=True
                        ),
                        race_commands,
                    )
                )
            winners = [v for v in raced if "result" in v]
            lab.require(
                len(winners) == 1
                and sum(v.get("error") == "SERVICE_ALLOWANCE_EXHAUSTED" for v in raced)
                == 5,
                "SERVICE_RACE_OVERSUBSCRIBED",
            )
            checks["six_process_shared_allowance_race"] = True
            do(beta, command("CANCEL", order_id=winners[0]["result"]["id"]))
            expiry_order_body = order_body(beta, alpha)
            expiry_order_body["start_before_ms"] = time.time_ns() // 1000000 + 2000
            expiring = do(beta, expiry_order_body)["result"]
            denied(
                "early_expiry_holds_allowance",
                lambda: do(alpha, command("EXPIRE", order_id=expiring["id"])),
                "SERVICE_EXPIRY_NOT_AUTHORIZED",
            )
            denied(
                "foreign_operator_cannot_expire",
                lambda: admin.request(
                    "POST", s.ROOT_ROUTE + "/actions",
                    command("EXPIRE", order_id=expiring["id"]),
                    outsider["operator"],
                ),
                "SERVICE_ACTOR_FORBIDDEN",
            )
            # This bounded wait exercises the production clock and HTTP route;
            # no test clock or client-supplied action time enters the service.
            while time.time_ns() // 1000000 < expiring["start_before_ms"]:
                time.sleep(0.05)
            expiry_action = command("EXPIRE", order_id=expiring["id"])
            expiry_cfg = {
                **cli(beta),
                "expected_principal": beta["operator_id"],
                "expected_role": "OPERATOR",
                "credential": beta["operator_credential"],
                "action": expiry_action,
            }
            expired = child("act", expiry_cfg)
            lab.require(
                expired["result"]["state"] == "EXPIRED"
                and expired["result"]["job_id"] is None,
                "SERVICE_EXPIRED_ORDER_HAS_JOB",
            )
            checks["operator_expiry_releases_unused_allowance"] = True
            lab.require(child("act", expiry_cfg)["replayed"], "SERVICE_EXPIRY_REPLAY")
            checks["expiry_retry_without_second_release"] = True
            denied(
                "expired_order_cannot_start",
                lambda: do(alpha, command("START", order_id=expiring["id"])),
                "SERVICE_START_NOT_AUTHORIZED",
            )
            reserved = do(beta, order_body(beta, alpha))["result"]
            started = do(
                alpha, automatic("START", reserved["id"], order_id=reserved["id"])
            )["result"]
            denied(
                "started_order_cannot_expire",
                lambda: do(beta, command("EXPIRE", order_id=reserved["id"])),
                "SERVICE_EXPIRY_NOT_AUTHORIZED",
            )
            denied(
                "running_or_queued_reservation_held",
                lambda: do(beta, command("ABORT_FAILED", order_id=reserved["id"])),
                "SERVICE_UNCERTAIN_RESERVATION_HELD",
            )
            admin.request(
                "POST",
                s.ROOT_ROUTE + "/actions",
                command("REVOKE", mandate_id=beta["mandate"]["id"]),
                beta["operator"],
            )
            denied(
                "revoked_task_cannot_claim",
                lambda: client(alpha).request(
                    "POST",
                    "/v1/jobs/claim",
                    {
                        "project_id": alpha["project"],
                        "max_steps": 2,
                        "timeout_seconds": 120,
                    },
                    alpha["token"],
                ),
                "SERVICE_START_NOT_AUTHORIZED",
            )
            _, queued = client(alpha).request(
                "GET", "/v1/jobs/" + started["job_id"], token=alpha["token"]
            )
            lab.require(
                queued["state"] == "QUEUED", "SERVICE_REJECTED_CLAIM_MUTATED_JOB"
            )
            checks["claim_and_audit_rollback"] = True
            client(alpha).request(
                "POST", "/v1/jobs/" + started["job_id"] + "/stop", {}, alpha["token"]
            )
            do(beta, command("ABORT_FAILED", order_id=reserved["id"]))
            do(alpha, command("CLOSE", listing_id=alpha["listing"]["id"]))
            checks["verified_terminal_abort_releases_allowance"] = True

            server.shutdown()
            thread.join(10)
            store = ServiceStore(output / "agents")
            sys.path.insert(
                0,
                str(
                    Path(cfg["community_source"])
                    / "projects/zoora-agent-community/tests"
                ),
            )
            from test_private_pilot import TLSCommunity, FIXTURES

            proxy = TLSCommunity(store)
            transport = {
                "port": 8765,
                "origin": proxy.origin,
                "ca_file": str(FIXTURES / "bridge-localhost-cert.pem"),
            }
            probe(alpha, first, "accept", "READY_FOR_BOUNDED_RESEARCH_ACTION")
            checks["preflight_with_remote_evidence_over_verified_tls"] = True
            for provider, order, filename in (
                (beta, first, "alpha-delivery.json"),
                (alpha, second, "beta-delivery.json"),
            ):
                result = child(
                    "fulfill",
                    {
                        **cli(provider),
                        "order_id": order["id"],
                        "output": str(output / filename),
                    },
                )
                lab.require(
                    result["job_reused"] and result["replayed"],
                    "SERVICE_RESTART_CREATED_JOB",
                )
            lab.require(
                child("accept", {**cli(alpha), "order_id": first["id"]})["replayed"],
                "SERVICE_RESTART_SECOND_CHARGE",
            )
            checks["service_restart_without_duplicate_jobs_or_charges"] = True
            checks["verified_tls_after_restart"] = True
            lab.require(
                child("act", {**expiry_cfg, **transport})["replayed"],
                "SERVICE_EXPIRY_RESTART_REPLAY",
            )
            checks["expiry_replay_after_tls_restart"] = True
            before = len(proxy.exchanges)
            wrong_catalog = child(
                "observe", {**cli(alpha), "catalog_sha256": "f" * 64}, allow_error=True
            )
            lab.require(
                wrong_catalog.get("error") == "SERVICE_REMOTE_CATALOG_PIN"
                and len(proxy.exchanges) > before
                and all(not item[2] for item in proxy.exchanges[before:]),
                "SERVICE_TLS_CATALOG_BEARER_LEAK",
            )
            checks["tls_catalog_probe_before_bearer"] = True
            before = len(proxy.exchanges)
            untrusted = child(
                "observe",
                {k: v for k, v in cli(alpha).items() if k != "ca_file"},
                allow_error=True,
            )
            lab.require(
                untrusted.get("error") == "COMMUNITY_IDENTITY_UNCONFIRMED"
                and len(proxy.exchanges) == before,
                "SERVICE_UNTRUSTED_TLS_HTTP",
            )
            checks["untrusted_tls_before_http"] = True
            proxy.redirect = True
            redirect = child("observe", cli(alpha), allow_error=True)
            lab.require(
                redirect.get("error") == "COMMUNITY_REDIRECT_REJECTED",
                "SERVICE_REDIRECT_FOLLOWED",
            )
            proxy.redirect = False
            checks["redirect_rejected"] = True
            ev.write(output / "catalog.json", resources.catalog)
            ev.write(output / "connections.json", {
                "protocol": "AAI_SERVICE_CONNECTIONS_V1", "preflights": connections,
                "work_cycles": [provisioned, accepted_cycle, idle],
                "shared_source_directory_required": False, "physical_host_commissioned": False,
                "financial_settlement": False, "live_execution_allowed": False,
            })
            ev.write(
                output / "exercise.json",
                {
                    "protocol": s.PROTOCOL,
                    "checks": checks,
                    "instance_id": instance,
                    "alpha_id": alpha["agent"],
                    "beta_id": beta["agent"],
                    "first_order": first["id"],
                    "second_order": second["id"],
                    "expired_order": expiring["id"],
                    "catalog_sha256": resources.digest,
                    "financial_settlement": False,
                    "live_execution_allowed": False,
                },
            )
            for path in output.rglob("*"):
                if path.is_file():
                    payload = path.read_bytes()
                    lab.require(
                        not any(token.encode() in payload for token in secrets),
                        "SERVICE_CREDENTIAL_LEAK",
                    )
        finally:
            if proxy is not None:
                proxy.stop()
            else:
                server.shutdown()
                thread.join(10)
        ev.write(output / "community-audit.json", store.audit())
        ev.write(output / "service-audit.json", store.service_audit())
    return verify_lab(output, cfg)


def verify_lab(output, cfg):
    _, _, Store, Problem, _ = nw.components(cfg["community_source"])
    resources = resources_for(cfg)
    ServiceStore = s.store_type(Store, Problem, resources)
    store = ServiceStore(output / "agents")
    community, audit = store.audit(), store.service_audit()
    lab.require(
        n.same(community, ev.read(output / "community-audit.json"))
        and n.same(audit, ev.read(output / "service-audit.json")),
        "SERVICE_SAVED_AUDIT_CHANGED",
    )
    lab.require(
        n.same(resources.catalog, ev.read(output / "catalog.json")),
        "SERVICE_SAVED_CATALOG_CHANGED",
    )
    exercise = ev.read(output / "exercise.json")
    lab.require(
        exercise["protocol"] == s.PROTOCOL
        and exercise["catalog_sha256"] == resources.digest
        and exercise["financial_settlement"] is False
        and exercise["live_execution_allowed"] is False,
        "SERVICE_EXERCISE_AUTHORITY",
    )
    required = {
        "bounded_worker_provides_eligible_order", "bounded_worker_accepts_verified_delivery",
        "bounded_worker_does_not_repeat_completed_orders",
        "bounded_worker_stops_on_source_failure_without_job", "bounded_worker_leaves_started_recovery_explicit",
        "public_preflight_cli_exit_codes",
        "preflight_does_not_create_jobs_or_audit_events",
        "evidence_denies_anonymous", "evidence_denies_foreign_agent",
        "evidence_denies_owner", "evidence_denies_operator",
        "evidence_denies_wrong_export", "evidence_denies_out_of_range",
        "wrong_remote_source_pin_before_job_creation",
        "provider_uses_remote_evidence_without_shared_path",
        "buyer_reconstructs_remote_evidence_before_acceptance",
        "preflight_with_remote_evidence_over_verified_tls",
        "bare_service_declaration",
        "anonymous_catalog",
        "foreign_operator_allowance",
        "self_order",
        "accept_before_delivery",
        "uncertain_open_abort",
        "wrong_catalog_before_agent_operation",
        "actual_process_exit_after_job_commit",
        "wrong_completion_bytes_rejected",
        "foreign_delivery",
        "provider_cannot_accept",
        "changed_acceptance_digest",
        "owner_cannot_accept",
        "acceptance_replay_without_second_charge",
        "six_process_shared_allowance_race",
        "early_expiry_holds_allowance",
        "foreign_operator_cannot_expire",
        "operator_expiry_releases_unused_allowance",
        "expiry_retry_without_second_release",
        "expired_order_cannot_start",
        "started_order_cannot_expire",
        "expiry_replay_after_tls_restart",
        "running_or_queued_reservation_held",
        "revoked_task_cannot_claim",
        "claim_and_audit_rollback",
        "verified_terminal_abort_releases_allowance",
        "service_restart_without_duplicate_jobs_or_charges",
        "verified_tls_after_restart",
        "tls_catalog_probe_before_bearer",
        "untrusted_tls_before_http",
        "redirect_rejected",
    }
    lab.require(
        set(exercise["checks"]) == required
        and all(v is True for v in exercise["checks"].values()),
        "SERVICE_EXERCISE_CHECKS",
    )
    state = audit["state"]
    states_by_head, recorded_results = {resources.digest: (s.empty(), 0)}, {}
    replayed = s.empty()
    with closing(sqlite3.connect(output / "agents/community.sqlite3")) as db:
        for (body,) in db.execute("SELECT body FROM service_events ORDER BY sequence"):
            event = ev.parse(body.encode())
            replayed, _ = s.apply(replayed, event["actor"], event["command"], event["at_ms"], event["facts"], resources.catalog)
            states_by_head[event["sha256"]] = (replayed, event["at_ms"])
            recorded_results[(event["command"]["kind"], event["result"]["id"])] = event["result"]
    connections = ev.read(output / "connections.json")
    lab.exact(connections, ("protocol", "preflights", "work_cycles", "shared_source_directory_required", "physical_host_commissioned",
                           "financial_settlement", "live_execution_allowed"))
    lab.require(connections["protocol"] == "AAI_SERVICE_CONNECTIONS_V1"
                and all(connections[k] is False for k in ("shared_source_directory_required", "physical_host_commissioned",
                                                          "financial_settlement", "live_execution_allowed"))
                and len(connections["preflights"]) == 3, "SERVICE_CONNECTION_SCOPE")
    for result, action_name, status, transport in zip(
        connections["preflights"], ("fulfill", "accept", "accept"),
        ("READY_FOR_BOUNDED_RESEARCH_ACTION", "BLOCKED", "READY_FOR_BOUNDED_RESEARCH_ACTION"),
        ("LOOPBACK_HTTP", "LOOPBACK_HTTP", "HTTPS_VERIFIED"), strict=True,
    ):
        order = state["orders"][result["order_id"]]
        source = result["evidence"]
        ready = result["server_readiness"]
        principal = order["provider_id"] if action_name == "fulfill" else order["buyer_id"]
        lab.require(ready["head_sha256"] in states_by_head, "SERVICE_PREFLIGHT_HISTORY")
        prior_state, at = states_by_head[ready["head_sha256"]]
        prior_order = prior_state["orders"][order["id"]]
        lab.require(ready["protocol"] == "AAI_SERVICE_READINESS_V1"
                    and ready["catalog_sha256"] == resources.digest and ready["order_id"] == order["id"]
                    and ready["order_state"] == prior_order["state"]
                    and ready["job_state"] == (None if prior_order["state"] == "OPEN" else "SUCCEEDED")
                    and s.integer(ready["observed_at_ms"]) >= at
                    and n.same(ready["blockers"], s.readiness(prior_state, prior_order, principal, ready["observed_at_ms"],
                                                           ready["job_state"], True, True))
                    and ready["scope"] == "POINT_IN_TIME_RESEARCH_ACTION"
                    and all(ready[k] is False for k in ("authorization_granted", "financial_settlement", "live_execution_allowed"))
                    and n.same(result["connection_binding"], {"enforced": True, "expected_instance_id": exercise["instance_id"],
                                                              "expected_agent_id": principal}), "SERVICE_PREFLIGHT_REPLAY")
        lab.require(result["protocol"] == "AAI_SERVICE_PREFLIGHT_V1"
                    and result["status"] == status and result["action"] == action_name and result["transport"] == transport
                    and result["catalog_sha256"] == resources.digest
                    and result["model_bundle_sha256"] == ev.sha(n.raw(resources.bundle))
                    and result["expected_report_sha256"] == ev.sha(n.raw(resources.report(order, state["listings"][order["listing_id"]])))
                    and source["mode"] == "AUTHENTICATED_RECORD_TRANSFER"
                    and source["payload_sha256"] == resources.evidence.sha
                    and source["bytes"] == len(resources.evidence.payload)
                    and source["records"] == resources.evidence.count
                    and source["chunks"] == len(resources.evidence.chunks)
                    and source["independent_source_attestation"] is False
                    and source["feed_head_sha256"] == resources.head
                    and source["feed_policy_sha256"] == resources.policy
                    and all(result[k] is False for k in ("physical_host_commissioned", "financial_settlement", "live_execution_allowed")),
                    "SERVICE_CONNECTION_REPLAY")
    cycles = connections["work_cycles"]
    lab.require(type(cycles) is list and len(cycles) == 3, "SERVICE_WORK_CYCLES")
    for cycle, mode, action_name, order_id, transition in zip(
        cycles, ("provide", "accept", "both"), ("fulfill", "accept", None),
        (exercise["second_order"], exercise["first_order"], None), ("DELIVER", "ACCEPT", None), strict=True,
    ):
        lab.require(cycle["protocol"] == "AAI_SERVICE_WORK_CYCLE_V1" and cycle["candidate_limit"] == 2
                    and cycle["work_mode"] == mode and cycle["unit"] == s.UNIT
                    and cycle["financial_settlement"] is False and cycle["live_execution_allowed"] is False,
                    "SERVICE_WORK_CYCLE_SCOPE")
        if action_name is None:
            lab.require(cycle["status"] == "NO_ELIGIBLE_ORDERS" and cycle["outcomes"] == [], "SERVICE_WORK_CYCLE_IDLE")
            continue
        lab.require(cycle["status"] == "COMPLETE" and len(cycle["outcomes"]) == 1, "SERVICE_WORK_CYCLE_RESULT")
        outcome = cycle["outcomes"][0]
        lab.require(outcome["order_id"] == order_id and outcome["action"] == action_name
                    and outcome["status"] == "COMPLETED"
                    and n.same(outcome["result"]["result"], recorded_results[(transition, order_id)])
                    and outcome["evidence"]["mode"] == "AUTHENTICATED_RECORD_TRANSFER"
                    and outcome["evidence"]["payload_sha256"] == resources.evidence.sha
                    and outcome["preflight"]["status"] == "READY_FOR_BOUNDED_RESEARCH_ACTION"
                    and outcome["preflight"]["server_readiness"]["authorization_granted"] is False
                    and outcome["preflight"]["financial_settlement"] is False
                    and outcome["preflight"]["live_execution_allowed"] is False, "SERVICE_WORK_CYCLE_REPLAY")
    for name, key in (
        ("alpha-delivery.json", "first_order"),
        ("beta-delivery.json", "second_order"),
    ):
        order = state["orders"][exercise[key]]
        lab.require(
            order["state"] == "ACCEPTED"
            and n.same(
                ev.read(output / name),
                resources.report(order, state["listings"][order["listing_id"]]),
            ),
            "SERVICE_DELIVERY_REPLAY",
        )
    orders = list(state["orders"].values())
    lab.require(
        len(orders) == 5
        and sorted(o["state"] for o in orders)
        == ["ACCEPTED", "ACCEPTED", "CANCELLED", "EXPIRED", "FAILED"],
        "SERVICE_ORDER_STATES",
    )
    expired = state["orders"][exercise["expired_order"]]
    lab.require(
        expired["state"] == "EXPIRED"
        and all(expired[k] is None for k in ("job_id", "artifact_id", "report_sha256")),
        "SERVICE_EXPIRED_ORDER_BINDING",
    )
    lab.require(
        sorted(
            (v["limit"], v["consumed"], v["reserved"], v["available"])
            for v in audit["accounting"].values()
        )
        == [(6, 4, 0, 2), (8, 3, 0, 5)],
        "SERVICE_ALLOWANCE_ACCOUNTING",
    )
    with closing(
        sqlite3.connect(
            (output / "agents/community.sqlite3").as_uri() + "?mode=ro", uri=True
        )
    ) as db:
        counts = dict(
            db.execute("SELECT state,COUNT(*) FROM jobs GROUP BY state").fetchall()
        )
        artifacts = db.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0]
    lab.require(
        counts == {"CANCELLED": 1, "SUCCEEDED": 4} and artifacts == 4,
        "SERVICE_JOB_COUNTS",
    )
    return {
        "protocol": "AAI_RESEARCH_SERVICES_SUMMARY_V1",
        "agents_exchanging_work": 2,
        "supported_services": len(s.KINDS),
        "orders": 5,
        "accepted_orders": 2,
        "cancelled_orders": 1,
        "failed_orders": 1,
        "expired_orders": 1,
        "completed_jobs": 4,
        "job_artifacts": 4,
        "ledger_events": audit["events"],
        "reserved_work_units": 0,
        "consumed_work_units": 7,
        "remaining_work_units": 7,
        "race_processes": 6,
        "race_admitted": 1,
        "observed_checks": len(required),
        "remote_evidence_replayed": True,
        "public_preflight_checks": 3,
        "shared_source_directory_required": False,
        "physical_host_commissioned": False,
        "verified_tls": True,
        "unit": s.UNIT,
        "source_scope": "PINNED_RESEARCH_REPLAY",
        "financial_settlement": False,
        "research_signal": "ABSTAIN",
        "live_execution_allowed": False,
    }


def main():
    verb, packet = sys.argv[1], n.safe_path(sys.argv[2])
    try:
        lab.require(
            packet.is_file() and packet.stat().st_size <= 16384, "SERVICE_PACKET_BOUND"
        )
        cfg = ev.read(packet)
        if verb in ("act", "observe", "accept", "fulfill", "preflight", "work-once"):
            result = leaf(verb, cfg)
        elif verb == "serve":
            result = serve(cfg)
        elif verb == "lab-build":
            result = run_lab(n.safe_path(cfg["output"]), cfg)
        elif verb == "lab-verify":
            result = verify_lab(n.safe_path(cfg["output"]), cfg)
        else:
            raise ValueError("SERVICE_WORKER_ACTION")
        print(ev.canonical({"verified": True, **result}))
        return 0
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        code = getattr(error, "code", None)
        if code is None:
            if isinstance(error, ValueError):
                code = str(error)
            else:
                frames, trace = [], error.__traceback__
                while trace is not None:
                    frames.append(
                        Path(trace.tb_frame.f_code.co_filename).name
                        + ":"
                        + str(trace.tb_lineno)
                    )
                    trace = trace.tb_next
                code = type(error).__name__ + ":" + "/".join(frames[-3:])
        print(
            ev.canonical(
                {
                    "status": "SERVICE_REJECTED",
                    "error": str(code)[:250],
                    "financial_settlement": False,
                    "live_execution_allowed": False,
                }
            )
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
