"""Pinned community server and independent HTTP/TLS advisory-agent processes."""
from __future__ import annotations

import base64
from contextlib import closing
from importlib.metadata import version
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ecosystem_research import network as n  # noqa: E402
from src.ecosystem_research.checkout import verify_checkout, worker_environment  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402


def components(path):
    path = Path(path).resolve()
    verify_checkout(path, "community")
    lab.require(sys.version_info >= (3, 12), "NETWORK_COMMUNITY_PY312_REQUIRED")
    for name, expected in (("cffi", "2.1.1"), ("pycparser", "3.0"), ("PyNaCl", "1.6.2"), ("waitress", "3.0.2")):
        lab.require(version(name) == expected, "NETWORK_RUNTIME_VERSION:" + name)
    sys.path.insert(0, str(path / "projects/zoora-agent-community"))
    from zoora_community.client import Client, read_credential
    from zoora_community.store import Store
    from zoora_community.validation import Problem
    from zoora_community.wsgi_server import WSGIServer
    return Client, read_credential, Store, Problem, WSGIServer


def client_for(Client, cfg):
    return n.connect(Client, port=cfg.get("port", 8765), origin=cfg.get("origin"),
                     expected_instance=cfg["expected_instance"], expected_agent=cfg["expected_agent"],
                     ca_file=cfg.get("ca_file"))


def leaf(action, cfg):
    Client, read_credential, _, _, _ = components(cfg["community_source"])
    client, token = client_for(Client, cfg), read_credential(cfg["credential"])
    manifest, digest, project = cfg["controller_manifest_sha256"], cfg["bundle_sha256"], cfg["project_id"]
    if action == "publish":
        bundle = n.read_bundle(cfg["bundle_file"], manifest)
        lab.require(ev.sha(n.raw(bundle)) == digest, "NETWORK_PUBLISH_RELEASE")
        n.preflight(client, token, manifest, digest)

        def handler():
            return n.read_bundle(cfg["bundle_file"], manifest)

        receipt = n.dispatch(client, token, project, "publish", bundle, handler)
        files = {"publisher.json": bundle}
    else:
        bundle = n.receive(client, token, project, manifest, digest)
        if action == "consume":
            report = n.exercise(bundle, manifest)

            def handler():
                return n.exercise(n.receive(client, token, project, manifest, digest), manifest)

            receipt = n.dispatch(client, token, project, "consume", report, handler)
            files = {"received.json": bundle, "consumer.json": report}
        elif action == "observe":
            receipt, files = None, {"observer.json": bundle["controller_public"]}
        elif action == "predict":
            result = n.prediction(bundle, manifest, cfg["domain"], cfg["features"])
            receipt, files = None, {"prediction.json": result}
        else:
            raise ValueError("NETWORK_AGENT_ACTION")
    if cfg.get("output"):
        folder = Path(cfg["output"])
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        for name, value in files.items():
            ev.write(folder / name, value)
    result = {"protocol": "AAI_NETWORK_AGENT_RESULT_V1", "action": action,
              "connection_binding": client.binding(), "transport": "HTTPS_VERIFIED" if client.origin else "LOOPBACK_HTTP",
              "bundle_sha256": digest, "controller_manifest_sha256": manifest, "receipt": receipt,
              "live_execution_allowed": False}
    if action in ("observe", "predict"):
        result["result"] = next(iter(files.values()))
    return result


def child(action, cfg):
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "packet.json"
        ev.write(path, cfg)
        result = subprocess.run([sys.executable, "-I", "-B", str(Path(__file__).resolve()), action, str(path)],
                                capture_output=True, timeout=120, check=False, env=worker_environment())
    lab.require(len(result.stdout) + len(result.stderr) <= 1024**2, "NETWORK_WORKER_LOG_BOUND")
    if result.returncode:
        try:
            code = ev.parse(result.stdout).get("error", "INVALID_OUTPUT")
        except ValueError:
            code = "INVALID_OUTPUT"
        lab.require(False, "NETWORK_CHILD_FAILED:" + action + ":" + str(code)[:160])
    return ev.parse(result.stdout)


def enroll(client, owner, role):
    from nacl.signing import SigningKey
    # Ephemeral random, unfunded proof keys, used only by this disposable integration.
    key = SigningKey.generate()
    _, operator = client.request("POST", "/v1/operators", {"handle": role + "_operator"}, owner)
    operator_token = operator["credential"]["token"]
    _, challenge = client.request("POST", "/v1/wallet/challenges", {"handle": role,
        "wallet": ev.b58encode(bytes(key.verify_key)), "capabilities": ["research"]}, operator_token)
    _, result = client.request("POST", "/v1/agents", {"challenge_id": challenge["challenge_id"],
        "signature": base64.b64encode(key.sign(challenge["message"].encode()).signature).decode()}, operator_token)
    return result["agent"]["id"], result["credential"], operator_token


def expect_problem(Problem, action, code):
    try:
        action()
    except Problem as error:
        lab.require(error.code == code, "NETWORK_UNEXPECTED_DENIAL:" + error.code)
        return
    raise ValueError("NETWORK_ACCESS_NOT_DENIED:" + code)


def run_lab(output, cfg):
    Client, _, Store, Problem, WSGIServer = components(cfg["community_source"])
    bundle, manifest = ev.read(output / "bundle.json"), cfg["controller_manifest_sha256"]
    n.validate_bundle(bundle, manifest)
    digest = ev.sha(n.raw(bundle))
    NetworkStore = n.store_type(Store, Problem, bundle, manifest)
    with tempfile.TemporaryDirectory() as temporary:
        private = Path(temporary)
        owner_path = private / "owner.json"
        store = NetworkStore.initialize(output / "agents", owner_path)
        owner = ev.read(owner_path)["token"]
        os.environ.pop("ZOORA_PUBLIC_ORIGIN", None)
        os.environ.pop("ZOORA_PRIVATE_PILOT", None)
        server = WSGIServer(store, 0)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        secrets, peers = [owner], {}
        try:
            unbound = Client(port=server.server_port)
            _, status = unbound.request("GET", "/v1/status")
            instance = status["instance_id"]
            admin = Client(port=server.server_port, expected_instance=instance)
            for role in ("network_publisher", "network_receiver", "network_outsider"):
                agent, credential, operator_token = enroll(admin, owner, role)
                peers[role] = (agent, credential)
                secrets.extend((credential["token"], operator_token))
                ev.write(private / (role + ".json"), credential)
                (private / (role + ".json")).chmod(0o600)
            publisher, producer_credential = peers["network_publisher"]
            receiver, receiver_credential = peers["network_receiver"]
            publisher_client = n.connect(Client, port=server.server_port, expected_instance=instance, expected_agent=publisher)
            receiver_client = n.connect(Client, port=server.server_port, expected_instance=instance, expected_agent=receiver)
            _, project = publisher_client.request("POST", "/v1/projects", {"title": "Pinned brain network",
                "summary": "Authenticated advisory model transfer; research replay, no execution"}, producer_credential["token"])
            project = project["id"]
            publisher_client.request("POST", f"/v1/projects/{project}/members", {"agent_id": receiver}, producer_credential["token"])
            route = f"/v1/ecosystem/projects/{project}/artifacts/{digest}"
            expect_problem(Problem, lambda: receiver_client.request("GET", route, token=receiver_credential["token"]),
                           "NETWORK_ARTIFACT_NOT_PUBLISHED")
            expect_problem(Problem, lambda: publisher_client.request("POST", f"/v1/projects/{project}/artifacts", {"digest": digest,
                "title": "Negative probe: declaration without completed job"}, producer_credential["token"]),
                "NETWORK_JOB_PUBLICATION_REQUIRED")
            expect_problem(Problem, lambda: receiver_client.request("GET", route, token=receiver_credential["token"]),
                           "NETWORK_ARTIFACT_NOT_PUBLISHED")

            def publication_probe(client, token, label, byte_count, error):
                _, submitted = client.request("POST", "/v1/jobs", {"request_id": lab.digest([instance, label])[:32],
                    "title": "Negative publication probe " + label, "prompt": "Check protected publication policy",
                    "project_id": project, "max_steps": 1, "timeout_seconds": 120}, token)
                _, attempt = client.request("POST", "/v1/jobs/claim", {"max_steps": 1, "timeout_seconds": 120,
                                             "project_id": project}, token)
                lab.require(attempt["job"]["id"] == submitted["job"]["id"], "NETWORK_PROBE_CLAIM")
                finish = {"attempt_id": attempt["job"]["attempt_id"], "claim_token": attempt["claim_token"],
                    "state": "SUCCEEDED", "report_sha256": digest, "report_bytes": byte_count, "steps": 1, "error_code": None}
                expect_problem(Problem, lambda: client.request("POST", f"/v1/jobs/{submitted['job']['id']}/complete",
                    finish, token), error)
                client.request("POST", f"/v1/jobs/{submitted['job']['id']}/complete", {**finish, "state": "FAILED",
                    "report_sha256": None, "report_bytes": None, "steps": 0, "error_code": "NETWORK_POLICY_PROBE_REJECTED"}, token)

            publication_probe(receiver_client, receiver_credential["token"], "nonowner", len(n.raw(bundle)),
                              "NETWORK_PROJECT_PUBLISHER_REQUIRED")
            publication_probe(publisher_client, producer_credential["token"], "bytecount", 1, "NETWORK_PUBLICATION_BYTES")

            def packet(role):
                return {"community_source": cfg["community_source"], "port": server.server_port,
                        "expected_instance": instance, "expected_agent": peers[role][0],
                        "credential": str(private / (role + ".json")), "project_id": project,
                        "controller_manifest_sha256": manifest, "bundle_sha256": digest}

            producer = {**packet("network_publisher"), "bundle_file": str(output / "bundle.json"), "output": str(output)}
            published = child("publish", producer)
            consumer = {**packet("network_receiver"), "output": str(output)}
            consumed = child("consume", consumer)
            ev.write(output / "publish-result.json", published)
            ev.write(output / "consume-result.json", consumed)
        finally:
            server.shutdown()
            thread.join(10)
        lab.require(not thread.is_alive(), "NETWORK_SERVER_DID_NOT_STOP")

        # Reuse the pinned component's actual TLS/Waitress test proxy. Its public
        # TEST certificate is trusted explicitly only by these loopback probes.
        sys.path.insert(0, str(Path(cfg["community_source"]) / "projects/zoora-agent-community/tests"))
        from test_private_pilot import TLSCommunity, FIXTURES
        restarted = NetworkStore(output / "agents")
        proxy = TLSCommunity(restarted)
        try:
            def tls_packet(role):
                return {**packet(role), "port": 8765, "origin": proxy.origin,
                        "ca_file": str(FIXTURES / "bridge-localhost-cert.pem")}

            tls_producer = {**tls_packet("network_publisher"), "bundle_file": str(output / "bundle.json")}
            publish_replay = child("publish", tls_producer)
            consume_replay = child("consume", tls_packet("network_receiver"))
            observed = child("observe", {**tls_packet("network_receiver"), "output": str(output)})
            lab.require(publish_replay["receipt"]["replayed"] is True and consume_replay["receipt"]["replayed"] is True,
                        "NETWORK_RESTART_RETRY_DUPLICATED")
            lab.require(n.same({k: v for k, v in publish_replay["receipt"].items() if k != "replayed"},
                               {k: v for k, v in published["receipt"].items() if k != "replayed"})
                        and n.same({k: v for k, v in consume_replay["receipt"].items() if k != "replayed"},
                                   {k: v for k, v in consumed["receipt"].items() if k != "replayed"}), "NETWORK_REPLAY_CHANGED")
            target = client_for(Client, tls_packet("network_receiver"))
            unknown = client_for(Client, tls_packet("network_outsider"))
            expect_problem(Problem, lambda: unknown.request("GET", route, token=peers["network_outsider"][1]["token"]),
                           "PROJECT_MEMBERSHIP_REQUIRED")
            expect_problem(Problem, lambda: target.request("GET", route), "UNAUTHORIZED")
            wrong_agent = client_for(Client, {**tls_packet("network_receiver"), "expected_agent": publisher})
            expect_problem(Problem, lambda: wrong_agent.request("GET", route, token=receiver_credential["token"]),
                           "COMMUNITY_AGENT_MISMATCH")
            before = len(proxy.exchanges)
            wrong_instance = client_for(Client, {**tls_packet("network_receiver"), "expected_instance": "1" * 32})
            expect_problem(Problem, lambda: wrong_instance.request("GET", route, token=receiver_credential["token"]),
                           "COMMUNITY_INSTANCE_MISMATCH")
            lab.require(len(proxy.exchanges) == before + 1 and not proxy.exchanges[-1][2], "NETWORK_BEARER_SENT_TO_WRONG_INSTANCE")
            before = len(proxy.exchanges)
            untrusted = client_for(Client, {k: v for k, v in tls_packet("network_receiver").items() if k != "ca_file"})
            try:
                untrusted.request("GET", route, token=receiver_credential["token"])
            except Problem as error:
                lab.require(error.code == "COMMUNITY_IDENTITY_UNCONFIRMED", "NETWORK_TLS_UNEXPECTED_ERROR")
            except OSError:
                pass
            else:
                raise ValueError("NETWORK_UNTRUSTED_TLS_ACCEPTED")
            lab.require(len(proxy.exchanges) == before, "NETWORK_UNTRUSTED_TLS_SENT_HTTP")
            proxy.redirect = True
            expect_problem(Problem, lambda: target.request("GET", route, token=receiver_credential["token"]),
                           "COMMUNITY_REDIRECT_REJECTED")
            proxy.redirect = False
            lab.require(observed["result"] == bundle["controller_public"], "NETWORK_OBSERVER_CHANGED")
            denied = {"unpublished": True, "declaration_without_job": True, "nonowner_publication": True,
                      "wrong_publication_bytecount": True, "anonymous": True, "outsider": True,
                      "wrong_agent": True, "wrong_instance_before_bearer": True, "untrusted_tls_before_http": True,
                      "redirect": True}
            transport = {"protocol": "AAI_NETWORK_TRANSPORT_EVIDENCE_V1", "instance_id": instance,
                         "project_id": project, "producer_agent_id": publisher, "receiver_agent_id": receiver,
                         "outsider_agent_id": peers["network_outsider"][0], "http": published["transport"],
                         "tls": observed["transport"], "tls_certificate": "PINNED_COMPONENT_PUBLIC_TEST_FIXTURE",
                         "service_restarted": True, "publish_replayed": True, "consume_replayed": True,
                         "denied": denied, "tls_exchanges": len(proxy.exchanges),
                         "all_tls_requests_instance_bound": all("expected_instance=" + instance in path
                             for _, path, _ in proxy.exchanges if "expected_instance=" + "1" * 32 not in path),
                         "credentials_retained": False, "live_execution_allowed": False}
            ev.write(output / "transport.json", transport)
        finally:
            proxy.stop()
        # Credentials/claim secrets are never retained in evidence, including SQLite.
        for path in output.rglob("*"):
            if path.is_file():
                data = path.read_bytes()
                lab.require(not any(secret.encode() in data for secret in secrets), "NETWORK_CREDENTIAL_LEAK")
        ev.write(output / "audit.json", restarted.audit())
    verify_checkout(cfg["community_source"], "community")
    return verify_lab(output, cfg)


def verify_lab(output, cfg):
    _, _, Store, _, _ = components(cfg["community_source"])
    bundle = ev.read(output / "bundle.json")
    expected = cfg["controller_manifest_sha256"]
    n.validate_bundle(bundle, expected)
    lab.require(n.same(ev.read(output / "publisher.json"), bundle)
                and n.same(ev.read(output / "received.json"), bundle), "NETWORK_TRANSFER_REPLAY")
    report = n.exercise(bundle, expected)
    lab.require(n.same(ev.read(output / "consumer.json"), report)
                and n.same(ev.read(output / "observer.json"), bundle["controller_public"]), "NETWORK_CONSUMER_REPLAY")
    audit = Store(output / "agents").audit()
    lab.require(n.same(ev.read(output / "audit.json"), audit), "NETWORK_DATABASE_AUDIT")
    results = [ev.read(output / name) for name in ("publish-result.json", "consume-result.json")]
    transport = ev.read(output / "transport.json")
    with closing(sqlite3.connect((output / "agents/community.sqlite3").as_uri() + "?mode=ro", uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        lab.require(connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 4
                    and connection.execute("SELECT COUNT(*) FROM jobs WHERE state='FAILED' AND error_code='NETWORK_POLICY_PROBE_REJECTED'").fetchone()[0] == 2
                    and connection.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 2,
                    "NETWORK_DATABASE_COUNTS")
        lab.require(connection.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()[0]
                    == transport["instance_id"], "NETWORK_INSTANCE_BINDING")
        for result, value, agent_key in zip(results, (bundle, report), ("producer_agent_id", "receiver_agent_id"), strict=True):
            receipt = result["receipt"]
            job = connection.execute("SELECT * FROM jobs WHERE id=?", (receipt["job_id"],)).fetchone()
            artifact = connection.execute("SELECT * FROM artifacts WHERE id=?", (receipt["artifact_id"],)).fetchone()
            lab.require(job is not None and artifact is not None and job["state"] == receipt["state"] == "SUCCEEDED"
                        and job["agent_id"] == receipt["agent_id"] == artifact["author_id"] == transport[agent_key]
                        and job["artifact_id"] == artifact["id"] == receipt["artifact_id"]
                        and job["project_id"] == artifact["project_id"] == receipt["project_id"] == transport["project_id"]
                        and job["report_sha256"] == artifact["digest"] == receipt["report_sha256"] == ev.sha(n.raw(value))
                        and job["report_bytes"] == receipt["report_bytes"] == len(n.raw(value)), "NETWORK_JOB_AUDIT_BINDING")
    lab.require(transport["protocol"] == "AAI_NETWORK_TRANSPORT_EVIDENCE_V1"
                and transport["http"] == "LOOPBACK_HTTP" and transport["tls"] == "HTTPS_VERIFIED"
                and transport["service_restarted"] is True and transport["publish_replayed"] is True
                and transport["consume_replayed"] is True and transport["credentials_retained"] is False
                and transport["all_tls_requests_instance_bound"] is True and transport["live_execution_allowed"] is False
                and set(transport["denied"]) == {"unpublished", "declaration_without_job", "nonowner_publication",
                    "wrong_publication_bytecount", "anonymous", "outsider",
                    "wrong_agent", "wrong_instance_before_bearer", "untrusted_tls_before_http", "redirect"}
                and all(v is True for v in transport["denied"].values()), "NETWORK_TRANSPORT_CONTRACT")
    return {"protocol": "AAI_NETWORK_SUMMARY_V1", "bundle_bytes": len(n.raw(bundle)), "models_transferred": 4,
            "completed_jobs": 2, "job_bound_artifacts": 2, "failed_publication_probes": 2, "unbound_declaration_rejected": True,
            "participants": 3, "advisory_queries": report["queries"],
            "blocked_contexts_suppressed": sum(v["blocked_contexts_suppressed"] for v in report["domains"].values()),
            "access_and_transport_rejections": 10, "service_restart_replayed_without_new_jobs": True,
            "transport": ["LOOPBACK_HTTP", "HTTPS_VERIFIED"], "source_mode": "PINNED_RESEARCH_REPLAY",
            "live_execution_allowed": False}


def serve(cfg):
    _, _, Store, Problem, WSGIServer = components(cfg["community_source"])
    bundle = n.read_bundle(cfg["bundle_file"], cfg["controller_manifest_sha256"])
    NetworkStore = n.store_type(Store, Problem, bundle, cfg["controller_manifest_sha256"])
    store = NetworkStore(cfg["state"])
    store.audit()
    os.environ.pop("ZOORA_PUBLIC_ORIGIN", None)
    os.environ.pop("ZOORA_PRIVATE_PILOT", None)
    if cfg.get("public_origin"):
        os.environ["ZOORA_PUBLIC_ORIGIN"] = cfg["public_origin"]
    server = WSGIServer(store, cfg.get("port", 8765))

    def stop(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        print(ev.canonical({"protocol": n.PROTOCOL, "mode": "PINNED_RESEARCH_REPLAY", "url": server.origin,
              "bundle_sha256": ev.sha(n.raw(bundle)), "controller_manifest_sha256": cfg["controller_manifest_sha256"],
              "public_tls_proxy_required": bool(cfg.get("public_origin")), "live_execution_allowed": False}), flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()


def main():
    action, path = sys.argv[1], Path(sys.argv[2])
    lab.require(path.stat().st_size <= 16384, "NETWORK_PACKET_BOUND")
    cfg = ev.read(path)
    try:
        if action == "serve":
            serve(cfg)
            return 0
        if action == "lab-build":
            result = run_lab(Path(cfg["output"]), cfg)
        elif action == "lab-verify":
            result = verify_lab(Path(cfg["output"]), cfg)
        else:
            result = leaf(action, cfg)
        print(ev.canonical({"verified": True, **result}))
        return 0
    except Exception as error:
        # Error codes only: never include bearer values, task content or remote bodies.
        code = getattr(error, "code", None)
        if not isinstance(code, str):
            code = str(error) if isinstance(error, ValueError) else type(error).__name__
        if not isinstance(code, str) or len(code) > 256 or any(ord(c) < 32 for c in code):
            code = "NETWORK_FAILURE"
        print(ev.canonical({"status": "NETWORK_REJECTED", "error": code, "live_execution_allowed": False}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
