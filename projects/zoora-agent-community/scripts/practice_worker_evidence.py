"""Actual local HTTP/SQLite paper integration; synthetic by default, strict real-model opt-in."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import threading
import uuid
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from helpers import Fixture  # noqa: E402
from model_fixture import ModelFixture  # noqa: E402
from zoora_community.client import Client  # noqa: E402
from zoora_community.practice_journal import review_practice  # noqa: E402
from zoora_community.practice_worker import run_practice  # noqa: E402
from zoora_community.store import exclusive_file, now_ms  # noqa: E402
from zoora_community.validation import canonical  # noqa: E402
from zoora_community.wsgi_server import WSGIServer  # noqa: E402


def require(condition, label, checks):
    if not condition:
        raise AssertionError(label)
    checks.append(label)


def save(path, value):
    with exclusive_file(path) as output:
        output.write((canonical(value) + "\n").encode())
        output.flush()
        os.fsync(output.fileno())


def run(real_model=None):
    fixture = Fixture(real_time=True)
    server = thread = model_fixture = None
    checks = []
    mode = "REAL_LOCAL_MODEL" if real_model else "SYNTHETIC_PROTOCOL_FIXTURE"
    destination = ROOT / "evidence-output" / ("practice-worker-real-model" if real_model else "practice-worker")
    destination.mkdir(parents=True, exist_ok=False)
    try:
        _, operator = fixture.operator("worker_evidence_operator")
        enrolled = fixture.store.call("POST", "/v1/agents",
                                     fixture.enrollment(operator, "worker_evidence_agent"), operator)[1]
        credential = fixture.root / "agent.json"
        save(credential, enrolled["credential"])
        agent_id, token = enrolled["agent"]["id"], enrolled["credential"]["token"]
        episode = fixture.store.call("POST", "/v1/practice/episodes",
                                     {"request_id": uuid.uuid4().hex}, fixture.owner)[1]["id"]
        base = "/v1/practice/episodes/" + episode
        pipeline = hashlib.sha256(("HOST_DECLARED_TEST_PIPELINE:" + (real_model or "fixture")).encode()).hexdigest()
        fixture.store.call("POST", base + "/accounts",
                           {"request_id": uuid.uuid4().hex, "agent_id": agent_id,
                            "model_pipeline_sha256": pipeline}, operator)
        scope = {"version": 1, "experiment_id": uuid.uuid4().hex, "episode_id": episode, "agent_id": agent_id,
                 "instance_id": fixture.store.call("GET", "/v1/status")[1]["instance_id"],
                 "model": real_model or "synthetic-fixture", "model_pipeline_sha256": pipeline,
                 "created_at_ms": now_ms() - 1000, "expires_at_ms": now_ms() + 600_000,
                 "max_decisions": 1, "max_buy_micro": 1_000_000}
        scope_path = fixture.root / "scope.json"
        save(scope_path, scope)
        server = WSGIServer(fixture.store, 0)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        model_port = 11434
        if not real_model:
            coin = fixture.store.call("GET", base, token=token)[1]["market"]["coins"][0]["id"]
            model_fixture = ModelFixture(actions=[{"action": "paper_decision", "arguments": {
                "side": "BUY", "coin_id": coin, "amount": 1_000_000, "min_output": 1,
                "note": "Synthetic delivery recovery check, not a trading forecast."}}]).start()
            model_port = model_fixture.port
        journal = fixture.root / "experiment"

        def invoke():
            return run_practice(credential, scope_path, journal, model=scope["model"], port=server.server_port,
                                model_port=model_port, timeout=120)

        if real_model:
            first = invoke()
            require(first["state"] in {"HOLD_RECORDED", "ORDER_ACCEPTED_PENDING"},
                    "installed CPU model returns a validated structured paper decision", checks)
        else:
            original = Client.request

            def lose_ack(client, method, route, body=None, token=None):
                result = original(client, method, route, body, token)
                if method == "POST" and route.endswith("/orders"):
                    raise ConnectionResetError("synthetic lost response after durable acceptance")
                return result

            with patch.object(Client, "request", lose_ack):
                first = invoke()
            require(first["state"] == "DELIVERY_UNCERTAIN", "lost HTTP acknowledgment remains uncertain", checks)
        resumed = invoke()
        expected = "ALREADY_OBSERVED_NO_NEW_INFERENCE" if first["state"] == "HOLD_RECORDED" else "WAITING_FOR_OWNER_TICK"
        require(resumed["state"] == expected, "restart reconciles without another model decision", checks)
        fixture.store.call("POST", base + "/step",
                           {"request_id": uuid.uuid4().hex, "expected_tick": 0}, fixture.owner)
        require(invoke()["state"] == "EXPERIMENT_DECISION_LIMIT", "frozen decision budget stops further inference", checks)
        reviewed = review_practice(journal, destination / "review.json")
        report = json.loads((destination / "review.json").read_bytes())
        require(reviewed["report_sha256"] == hashlib.sha256((destination / "review.json").read_bytes()).hexdigest(),
                "offline review digest matches actual saved bytes", checks)
        require(report["counts"]["UNRESOLVED"] == 0, "all submitted paper orders have terminal receipts", checks)
        account = fixture.store.call("GET", base + "/accounts/" + agent_id, token=token)[1]
        require(account["order_count"] in (0, 1) and account["gas_micro"] == account["order_count"] * 1000,
                "server charges one demo gas debit per accepted order", checks)
        if model_fixture is not None:
            require(len(model_fixture.requests) == 2, "synthetic provider receives exactly one inspect and one decision", checks)
        require(fixture.store.audit()["database_integrity"] == "OK", "server ledger independently replays", checks)
        exported = {}
        for path in sorted(journal.glob("*.json")):
            raw = path.read_bytes()
            require(all(secret not in raw.decode() for secret in (token, operator, fixture.owner)),
                    "retained " + path.name + " contains no bearer credential", checks)
            (destination / path.name).write_bytes(raw)
            exported[path.name] = hashlib.sha256(raw).hexdigest()
        source_files = {name: hashlib.sha256((ROOT / "zoora_community" / name).read_bytes()).hexdigest()
                        for name in ("practice_worker.py", "practice_journal.py")}
        evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                    "source_files_sha256": source_files, "activity": "AUTOMATED_SYNTHETIC_MARKET_TEST",
                    "model_kind": mode, "model": scope["model"], "biological_model_verified": False,
                    "model_training": "NOT_PERFORMED", "live_execution_allowed": False,
                    "first": first, "resumed": resumed, "review": reviewed, "exported_files": exported,
                    "checks": checks, "performance_evaluation": "NOT_ESTABLISHED"}
        save(destination / "evidence.json", evidence)
        print(canonical(evidence))
    finally:
        if model_fixture is not None:
            model_fixture.stop()
        if server is not None:
            server.shutdown()
        if thread is not None:
            thread.join(10)
        fixture.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--real-model", help="Require an already installed local model; no synthetic fallback")
    run(parser.parse_args().real_model)
