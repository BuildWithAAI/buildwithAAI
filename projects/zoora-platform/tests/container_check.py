"""Run inside a disposable CI container; never print its access credential."""
import json
from pathlib import Path
import time
import urllib.error
import urllib.request

root = Path("/data")
deadline = time.monotonic() + 25
while True:
    try:
        if (root / "owner.credential.json").is_file():
            break
    except PermissionError:
        # The application first claims the freshly mounted private volume.
        pass
    if time.monotonic() > deadline:
        raise RuntimeError("platform did not initialize its private owner record")
    time.sleep(0.1)
owner_raw = (root / "owner.credential.json").read_bytes()
owner = json.loads(owner_raw)["token"]


def request(path, data=None, authenticated=True):
    headers = {"Host": "platform.example", "Accept": "application/json"}
    if authenticated:
        headers["Authorization"] = "Bearer " + owner
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request("http://127.0.0.1:8765" + path, data=None if data is None else json.dumps(data).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.load(response)


while True:
    try:
        status = request("/api/platform/status", authenticated=False)
        if status["work"]["worker"] == "ONLINE":
            break
    except (OSError, ValueError):
        pass
    if time.monotonic() > deadline:
        raise RuntimeError("platform did not become ready")
    time.sleep(0.1)

instance = request("/v1/status")["instance_id"]
try:
    request("/api/platform/jobs", authenticated=False)
except urllib.error.HTTPError as error:
    assert error.code == 401
else:
    raise RuntimeError("unauthenticated work access")

job = request("/api/platform/jobs", {"request_id": "container_acceptance_001", "kind": "community.snapshot", "payload": {}})["job"]
while time.monotonic() < deadline:
    result = request("/api/platform/jobs/" + job["id"])["job"]
    if result["state"] == "SUCCEEDED":
        break
    time.sleep(0.1)
assert result["state"] == "SUCCEEDED"
assert result["result"]["output"]["instance_id"] == instance
assert (root / "owner.credential.json").read_bytes() == owner_raw
record = {"instance_id": instance, "job_id": job["id"], "worker": status["work"]["worker"], "source_sha": status["source_commit"], "classification": "DISPOSABLE_CI_STATE_NO_FUNDED_EXECUTION"}
previous = root / "container-acceptance.json"
if previous.exists():
    assert json.loads(previous.read_text())["instance_id"] == instance
    assert json.loads(previous.read_text())["job_id"] == job["id"]
else:
    previous.write_text(json.dumps(record))
print(json.dumps(record))
