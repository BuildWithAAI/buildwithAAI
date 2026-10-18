"""Single-instance Railway adapter; the application remains loopback-only."""

import http.client
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from zoora_community import VERSION  # noqa: E402
from zoora_community.client import read_credential  # noqa: E402
from zoora_community.operations import doctor, package_snapshot  # noqa: E402
from zoora_community.store import Store  # noqa: E402
from zoora_community.wallet_login import public_origin  # noqa: E402


def check_volume(root):
    info = root.lstat()
    if (not stat.S_ISDIR(info.st_mode) or not os.path.ismount(root)
            or os.environ.get("RAILWAY_VOLUME_MOUNT_PATH") != str(root)):
        raise ValueError("persistent volume required")


def local_read(host, path, token=None):
    headers = {"Host": host}
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    connection = http.client.HTTPConnection("127.0.0.1", 8765, timeout=2)
    try:
        connection.request("GET", path, headers=headers)
        response = connection.getresponse()
        raw = response.read(1_048_577)
        if len(raw) > 1_048_576:
            raise ValueError("response bound")
        return response.status, json.loads(raw)
    finally:
        connection.close()


def run():
    os.umask(0o077)
    origin = public_origin(os.environ.get("ZOORA_PUBLIC_ORIGIN"))
    if origin is None or os.environ.get("ZOORA_PRIVATE_PILOT") != "1":
        raise ValueError("private HTTPS origin required")
    port = int(os.environ.get("PORT", "8080"))
    if not 1024 <= port <= 65535 or port == 8765:
        raise ValueError("invalid proxy port")
    os.environ["PORT"] = str(port)
    host = urlsplit(origin).netloc
    os.environ["ZOORA_PROXY_HOST"] = host
    root = Path("/data")
    check_volume(root)
    # Railway mounts the new volume as root. Only its top directory is adjusted;
    # existing state is never recursively repaired, reset or re-owned.
    if os.geteuid() == 0:
        os.chown(root, 10001, 10001)
        os.chmod(root, 0o700)
        os.setgroups([])
        os.setgid(10001)
        os.setuid(10001)
    if os.geteuid() != 10001:
        raise ValueError("unexpected runtime identity")
    state, owner = root / "community", root / "owner.credential.json"
    initialized = False
    if not state.exists() and not state.is_symlink():
        if owner.exists() or owner.is_symlink():
            raise ValueError("partial initialization requires inspection")
        Store.initialize(state, owner)
        initialized = True
    store = Store(state)
    store.audit()
    expected_instance = store.call("GET", "/v1/status")[1]["instance_id"]
    doctor(state)  # Privileged local storage check; never reissue credentials.
    expected_package = package_snapshot()[0]
    children = []
    stopping = False

    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        backend = subprocess.Popen([sys.executable, "-B", "-m", "zoora_community", "serve",
            "--state", str(state), "--port", "8765", "--solana-rpc"])
        children.append(backend)
        deadline = time.monotonic() + 25
        status = None
        while not stopping and time.monotonic() < deadline:
            if backend.poll() is not None:
                raise ValueError("backend exited")
            try:
                code, status = local_read(host, "/v1/status")
                if code == 200:
                    break
            except (OSError, http.client.HTTPException):
                pass
            time.sleep(0.1)
        if (stopping or status is None or status.get("instance_id") != expected_instance
                or status.get("service") != "zoora-agent-community/" + VERSION
                or status.get("visibility") != "PRIVATE_PILOT"):
            raise ValueError("backend identity not established")
        if initialized:
            code, ready = local_read(host, "/v1/ready", read_credential(owner))
            if code != 200 or ready.get("status") != "AVAILABLE" or ready.get("package_digest") != expected_package:
                raise ValueError("authenticated readiness failed")
        # The initial owner credential may later expire or be revoked. Existing
        # state still boots after its local audit; never rotate access on restart.
        if local_read(host, "/v1/ready")[0] != 401:
            raise ValueError("readiness authorization not established")
        if local_read(host, "/v1/agents?limit=1")[0] != 401:
            raise ValueError("private access not established")
        proxy = subprocess.Popen(["caddy", "run", "--config", "deploy/Caddyfile", "--adapter", "caddyfile"])
        children.append(proxy)
        print(json.dumps({"event": "PRIVATE_BACKEND_READY", "service_version": VERSION,
            "instance_id": expected_instance, "package_sha256": expected_package,
            "initialized_new_state": initialized, "authenticated_local_readiness": initialized,
            "runtime_uid": os.geteuid(), "owner_credential": "PRIVATE_VOLUME_ONLY",
            "physical_pc_acceptance": "UNVERIFIED", "wallet_execution": "UNAVAILABLE"}), flush=True)
        while not stopping:
            if any(child.poll() is not None for child in children):
                raise ValueError("service process exited")
            time.sleep(0.2)
    finally:
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
        deadline = time.monotonic() + 12
        for child in reversed(children):
            try:
                child.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=3)


if __name__ == "__main__":
    try:
        run()
    except Exception:
        # Never print a credential, request, private path, or arbitrary exception.
        print('{"event":"PRIVATE_BACKEND_STARTUP_FAILED"}', file=sys.stderr, flush=True)
        sys.exit(1)
