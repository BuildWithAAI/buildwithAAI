"""Real local HTTP and SQLite with an explicitly synthetic model protocol fixture."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch

from helpers import Fixture
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from model_fixture import ModelFixture  # noqa: E402
from zoora_community.agent_runner import LocalModel, run_agent, run_tool  # noqa: E402
from zoora_community.client import Client  # noqa: E402
from zoora_community.validation import Problem, canonical  # noqa: E402
from zoora_community.wsgi_server import WSGIServer  # noqa: E402


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(real_time=True)
        self.addCleanup(self.f.close)
        self.operator_id, self.operator = self.f.operator()
        body = self.f.enrollment(self.operator, "runtime_agent")
        result = self.f.store.call("POST", "/v1/agents", body, self.operator)[1]
        self.agent_id, self.agent = result["agent"]["id"], result["credential"]["token"]
        self.credential = self.f.root / "agent.json"
        self.credential.write_text(canonical(result["credential"]))
        self.credential.chmod(0o600)
        self.task = self.f.root / "task.json"
        self.task.write_text(canonical({"prompt": "Measure Zoora builds then write a note."}))
        self.out = self.f.root / "run.json"
        self.project = self.f.project(self.agent)
        self.server = WSGIServer(self.f.store, 0)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.client = Client(self.server.server_port)

    def stop_server(self):
        self.server.shutdown()
        self.thread.join(10)
        self.assertFalse(self.thread.is_alive())

    def model(self, **kwargs):
        fixture = ModelFixture(**kwargs).start()
        self.addCleanup(fixture.stop)
        return fixture

    def run_agent(self, fixture, **kwargs):
        return run_agent(self.credential, self.task, self.out, model="synthetic-fixture",
                         port=self.server.server_port, model_port=fixture.port, **kwargs)

    def test_tool_loop_persisted_report_actual_artifact_digest_and_no_credential_leak(self):
        fixture = self.model()
        result = self.run_agent(fixture, project_id=self.project)
        raw = self.out.read_bytes()
        report = json.loads(raw)
        self.assertEqual(result["state"], "AVAILABLE")
        self.assertEqual(result["steps"], 2)
        self.assertEqual(report["steps"][0]["tool_result"]["words"], 2)
        self.assertEqual(report["steps"][0]["tool_result"]["sha256"], hashlib.sha256(b"Zoora builds").hexdigest())
        self.assertEqual(report["output_classification"], "LEARNED")
        self.assertEqual(result["report_sha256"], hashlib.sha256(raw).hexdigest())
        artifacts = self.client.request("GET", "/v1/projects/" + self.project + "/artifacts")[1]
        self.assertEqual(artifacts["items"][0]["digest"], result["report_sha256"])
        self.assertNotIn(self.agent, raw.decode())
        self.assertNotIn(self.agent, canonical(fixture.requests))
        self.assertNotIn(self.operator, canonical(fixture.requests))
        if sys.platform != "win32":
            self.assertEqual(self.out.stat().st_mode & 0o077, 0)
        self.assertEqual(self.f.store.audit()["database_integrity"], "OK")

    def test_actual_cli_output_redacts_content_and_credentials(self):
        fixture = self.model()
        completed = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community", "run-agent",
                                    "--credential-file", str(self.credential), "--task-file", str(self.task),
                                    "--out", str(self.out), "--model", "synthetic-fixture", "--port", str(self.server.server_port),
                                    "--model-port", str(fixture.port), "--project", self.project], capture_output=True, text=True, timeout=20)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertTrue(json.loads(completed.stdout)["artifact_declared"])
        self.assertNotIn(self.agent, completed.stdout + completed.stderr)
        self.assertNotIn("SYNTHETIC fixture output", completed.stdout + completed.stderr)

    def test_unknown_tool_and_code_execution_are_rejected_and_failure_is_retained(self):
        fixture = self.model(actions=[{"action": "shell", "arguments": {"command": "echo should-not-run"}}])
        with self.assertRaises(Problem) as denied:
            self.run_agent(fixture, project_id=self.project)
        self.assertEqual(denied.exception.code, "TOOL_NOT_ALLOWED")
        report = json.loads(self.out.read_bytes())
        self.assertEqual(report["state"], "FAILED")
        self.assertIsNone(report["output"])
        self.assertEqual(self.client.request("GET", "/v1/projects/" + self.project + "/artifacts")[1]["items"], [])

    def test_remote_alias_and_cloud_model_names_are_rejected(self):
        for name in ("qwen:cloud", "http://evil.example/model", "../../model", ""):
            with self.assertRaises(Problem):
                LocalModel(name)
        fixture = self.model(remote=True)
        with self.assertRaises(Problem) as denied:
            self.run_agent(fixture)
        self.assertEqual(denied.exception.code, "LOCAL_MODEL_REQUIRED")
        self.assertEqual(len(fixture.requests), 1)

    def test_step_exhaustion_has_no_publication(self):
        fixture = self.model(actions=[{"action": "community_status", "arguments": {}}])
        with self.assertRaises(Problem) as denied:
            self.run_agent(fixture, max_steps=2)
        self.assertEqual(denied.exception.code, "RUN_STEP_LIMIT")
        self.assertEqual(len(json.loads(self.out.read_bytes())["steps"]), 1)
        self.assertNotIn("tools", fixture.requests[-1][1])

    def test_slow_response_body_cannot_extend_model_deadline(self):
        fixture = self.model(slow=True)
        start = time.monotonic()
        with self.assertRaises(Problem) as denied:
            self.run_agent(fixture, timeout=1)
        self.assertEqual(denied.exception.code, "RUN_DEADLINE")
        self.assertLess(time.monotonic() - start, 2)
        self.assertEqual(json.loads(self.out.read_bytes())["state"], "FAILED")

    def test_existing_output_and_owner_role_fail_before_model_access(self):
        fixture = self.model()
        self.out.write_text("preserved")
        with self.assertRaises(FileExistsError):
            self.run_agent(fixture)
        self.assertEqual(self.out.read_text(), "preserved")
        self.assertEqual(fixture.requests, [])
        with self.assertRaises(Problem) as denied:
            run_agent(self.f.owner_path, self.task, self.f.root / "other.json", model="synthetic-fixture",
                      port=self.server.server_port, model_port=fixture.port)
        self.assertEqual(denied.exception.code, "AGENT_REQUIRED")
        self.assertFalse((self.f.root / "other.json").exists())

    def test_credential_revocation_between_steps_stops_inference(self):
        fixture = self.model()
        original = run_tool

        def revoke(action, client):
            result = original(action, client)
            self.f.store.call("POST", "/v1/agents/" + self.agent_id + "/credentials", {}, self.operator)
            return result

        with patch("zoora_community.agent_runner.run_tool", side_effect=revoke), self.assertRaises(Problem) as denied:
            self.run_agent(fixture)
        self.assertEqual(denied.exception.code, "UNAUTHORIZED")
        self.assertEqual(len(fixture.requests), 2)  # show + first chat only

    def test_strict_tool_arguments_and_actual_public_project_read(self):
        project = run_tool({"action": "community_project", "arguments": {"project_id": self.project}}, self.client)
        self.assertEqual(project["project"]["owner_id"], self.agent_id)
        for action in ({"action": "text_metrics", "arguments": {"text": "ok", "seed": "no"}},
                       {"action": "review_json", "arguments": {"text": '{"a":1,"a":2}'}},
                       {"action": "community_project", "arguments": {"project_id": "http://evil.example"}},
                       {"action": "community_status", "arguments": {"url": "https://evil.example"}}):
            with self.assertRaises(Problem):
                run_tool(action, self.client)

    def test_oversized_task_and_invalid_limits_do_not_invoke_model(self):
        fixture = self.model()
        for kwargs in ({"max_steps": 7}, {"max_steps": True}, {"timeout": 121}):
            with self.assertRaises(Problem):
                self.run_agent(fixture, **kwargs)
        self.task.write_text(canonical({"prompt": "x" * 4097}))
        with self.assertRaises(Problem):
            self.run_agent(fixture)
        self.assertEqual(fixture.requests, [])

    def test_incomplete_generation_and_malformed_tool_calls_fail_closed(self):
        provider = LocalModel("synthetic-fixture")
        responses = [
            {"done": False, "done_reason": "stop", "message": {"role": "assistant", "content": "partial"}},
            {"done": True, "done_reason": "length", "message": {"role": "assistant", "content": "truncated"}},
            {"done": True, "done_reason": "stop", "message": {"role": "assistant", "tool_calls": "invalid"}},
            {"done": True, "done_reason": "stop", "message": {"role": "assistant", "tool_calls": [
                {"function": {"name": "community_status", "arguments": {}}},
                {"function": {"name": "community_status", "arguments": {}}}]}}
        ]
        for response in responses:
            with patch.object(provider, "_request", return_value=(response, "f" * 64)), self.assertRaises(Problem) as denied:
                provider.next_action([], time.monotonic() + 5)
            self.assertEqual(denied.exception.code, "MODEL_OUTPUT_REJECTED")

    def test_oversized_generated_output_never_becomes_an_artifact(self):
        fixture = self.model(actions=[{"action": "finish", "arguments": {"output": "x" * 8193}}])
        with self.assertRaises(Problem):
            self.run_agent(fixture, project_id=self.project)
        self.assertEqual(json.loads(self.out.read_bytes())["state"], "FAILED")
        self.assertEqual(self.client.request("GET", "/v1/projects/" + self.project + "/artifacts")[1]["items"], [])
