"""Actual container/proxy/auth/restart checks against a disposable Docker volume."""

import http.client
import json
import os
import subprocess
import sys
import time
import uuid


def command(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise AssertionError("Container operation failed: " + args[1])
    return result.stdout.strip()


def run(image):
    name = "zoora-pilot-test-" + uuid.uuid4().hex
    volume, host = name + "-data", "pilot.example.invalid"
    command("docker", "volume", "create", volume)
    checks = []
    port = None

    def request(path, *, auth=None, hostname=host, headers=None, method="GET", body=None):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        values = {"Host": hostname, **(headers or {})}
        if auth:
            values["Authorization"] = "Bearer " + auth
        if body is not None:
            body = json.dumps(body).encode()
            values["Content-Type"] = "application/json"
        try:
            connection.request(method, path, body, values)
            response = connection.getresponse()
            raw = response.read(1_048_577)
            return response.status, json.loads(raw), dict(response.getheaders())
        finally:
            connection.close()

    def ready():
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            try:
                result = request("/v1/status")
                if result[0] == 200:
                    return result[1]
            except (OSError, ValueError, http.client.HTTPException):
                pass
            time.sleep(0.2)
        raise AssertionError("Container did not become ready")

    try:
        command("docker", "run", "--detach", "--name", name, "--publish", "127.0.0.1::8080",
                "--mount", "type=volume,src=" + volume + ",dst=/data",
                "--env", "RAILWAY_VOLUME_MOUNT_PATH=/data", "--env", "ZOORA_PRIVATE_PILOT=1",
                "--env", "ZOORA_PUBLIC_ORIGIN=https://" + host, image)
        binding = json.loads(command("docker", "inspect", "--format", "{{json .NetworkSettings.Ports}}", name))
        port = int(binding["8080/tcp"][0]["HostPort"])
        status = ready()
        assert status["visibility"] == "PRIVATE_PILOT" and status["schema_version"] == 8
        instance = status["instance_id"]
        checks.append("actual Python/Caddy/Waitress container boots on its persistent mount in private mode")
        for path in ("/v1/agents", "/v1/projects", "/v1/jobs", "/v1/ready"):
            assert request(path)[0] == 401
        checks.append("anonymous content and authenticated readiness remain denied through the actual proxy")
        for path in ("/v1/status", "/v1/ready"):
            headers = {key.lower(): value for key, value in request(path)[2].items()}
            assert headers["strict-transport-security"] == "max-age=31536000"
            assert headers["x-content-type-options"] == "nosniff"
            assert headers["referrer-policy"] == "no-referrer"
            assert "frame-ancestors 'none'" in headers["content-security-policy"]
        checks.append("HSTS and application security headers survive actual proxy success and denial responses")
        assert request("/v1/status?expected_instance=" + "0" * 32)[0] == 409
        assert request("/v1/status?expected_instance=" + instance)[1]["instance_id"] == instance
        assert request("/v1/status", hostname="wrong.example.invalid",
                       headers={"X-Forwarded-Host": host, "Forwarded": "host=" + host})[0] == 403
        assert request("/v1/status", headers={"Origin": "https://wrong.example.invalid"})[0] == 403
        checks.append("query identity preconditions and exact Host/Origin survive proxying; forwarded-host spoofing fails")
        assert request("/healthz", hostname="healthcheck.railway.app")[0] == 200
        assert request("/v1/status", hostname="healthcheck.railway.app")[0] == 403
        assert request("/healthz", hostname="wrong.example.invalid")[0] == 403
        checks.append("Railway health hostname exception applies only to GET /healthz")
        owner = json.loads(command("docker", "exec", name, "cat", "/data/owner.credential.json"))
        assert request("/v1/me", auth=owner["token"])[1]["role"] == "OWNER"
        probe = request("/v1/ready", auth=owner["token"])
        assert probe[0] == 200 and probe[1]["transport"] == "WAITRESS_3_0_2"
        package = probe[1]["package_digest"]
        checks.append("private generated owner credential authenticates through the proxy without entering logs")
        metadata = json.loads(command("docker", "exec", name, "python", "-c",
            "import os,json; from pathlib import Path; print(json.dumps({'uid':Path('/proc/1/status').read_text().split('Uid:')[1].split()[0], 'mode':os.stat('/data/community').st_mode & 0o777}))"))
        assert metadata == {"uid": "10001", "mode": 0o700}
        code, operator, _ = request("/v1/operators", auth=owner["token"], method="POST",
                                    body={"handle": "container_acceptance"})
        assert code == 201
        operator_id = operator["operator"]["id"]
        checks.append("application supervisor runs as uid 10001 and retains private state permissions")
        command("docker", "restart", "--time", "15", name)
        binding = json.loads(command("docker", "inspect", "--format", "{{json .NetworkSettings.Ports}}", name))
        port = int(binding["8080/tcp"][0]["HostPort"])
        assert ready()["instance_id"] == instance
        assert request("/v1/ready", auth=owner["token"])[1]["package_digest"] == package
        operators = request("/v1/operators", auth=owner["token"])[1]["items"]
        assert operator_id in [item["id"] for item in operators]
        captured = subprocess.run(["docker", "logs", name], capture_output=True, text=True, timeout=15)
        assert captured.returncode == 0
        logs = captured.stdout + captured.stderr
        for secret in (owner["token"], operator["credential"]["token"]):
            assert secret not in logs
        assert '"initialized_new_state": false' in logs
        checks.append("actual restart retains instance, records, original credential and package without reinitialization or secret logs")
        print(json.dumps({"classification": "DISPOSABLE_LOCAL_CONTAINER_ACCEPTANCE",
            "source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
            "checks": checks, "instance_id": instance, "package_sha256": package,
            "hosting_verified": False, "physical_pcs_verified": False, "wallet_execution": "UNAVAILABLE"}))
    finally:
        subprocess.run(["docker", "rm", "--force", name], capture_output=True, timeout=30)
        subprocess.run(["docker", "volume", "rm", volume], capture_output=True, timeout=30)


if __name__ == "__main__":
    run(sys.argv[1])
