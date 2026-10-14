"""Local process checks and bounded polling, never a public-launch attestation."""

from contextlib import closing
import hashlib
import os
from pathlib import Path
import stat
import threading
import time
import uuid

from . import VERSION
from .client import Client, read_credential
from .http_app import ASSETS
from .store import Store, exclusive_file
from .validation import Problem, canonical

ROOT = Path(__file__).resolve().parent.parent


def package_snapshot(root=ROOT):
    """Pin module/schema/lock/static bytes at startup; not a signed release hash."""
    paths = sorted([*root.joinpath("zoora_community").glob("*.py"),
                    root / "zoora_community/schema.sql", root / "zoora_community/migration_002.sql",
                    root / "zoora_community/migration_003.sql",
                    root / "zoora_community/migration_004.sql",
                    root / "requirements.lock", *(root / "web" / name for name, _ in ASSETS.values())])
    digest = hashlib.sha256(b"ZOORA_AE008_LOCAL_PACKAGE_V1\0")
    blobs = {}
    total = 0
    for path in paths:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > 1_048_576:
            raise Problem(503, "UNSAFE_PACKAGE_FILE")
        data = path.read_bytes()
        total += len(data)
        if total > 1_048_576:
            raise Problem(503, "PACKAGE_TOO_LARGE")
        name = path.relative_to(root).as_posix()
        digest.update(name.encode("utf-8") + b"\0" + len(data).to_bytes(8, "big") + data)
        blobs[name] = data
    assets = {route: (blobs["web/" + name], mime) for route, (name, mime) in ASSETS.items()}
    return digest.hexdigest(), assets


class Runtime:
    def __init__(self, store, transport):
        self.store = store
        self.transport = transport
        self.package_digest, self.assets = package_snapshot()
        self.process_id = uuid.uuid4().hex
        self.started = time.monotonic()
        self.lock = threading.Lock()
        self.active = self.peak = self.completed = 0
        self.status_counts = {"2xx": 0, "4xx": 0, "5xx": 0}
        self.total_ms = self.maximum_ms = 0

    def begin(self):
        with self.lock:
            self.active += 1
            self.peak = max(self.peak, self.active)
        return time.monotonic()

    def finish(self, started, status):
        elapsed = max(0, int((time.monotonic() - started) * 1000))
        with self.lock:
            self.active -= 1
            self.completed += 1
            group = str(status // 100) + "xx"
            if group in self.status_counts:
                self.status_counts[group] += 1
            self.total_ms += elapsed
            self.maximum_ms = max(self.maximum_ms, elapsed)

    def ready(self, token=None, *, local=False):
        checks = self.store.storage_probe(token, local=local)
        with self.lock:
            metrics = {"active": self.active, "peak_active": self.peak,
                       "completed": self.completed, "status_counts": dict(self.status_counts),
                       "total_application_ms": self.total_ms, "max_application_ms": self.maximum_ms}
        return {"status": "AVAILABLE", "scope": "LOCAL_APPLICATION", "mode": "LOCAL_ONLY",
                "version": VERSION, "process_id": self.process_id,
                "package_digest": self.package_digest, "digest_scope": "LOCAL_PACKAGE_BYTES",
                "transport": self.transport, "uptime_ms": max(0, int((time.monotonic() - self.started) * 1000)),
                "checks": checks, "metrics": metrics, "metrics_classification": "OBSERVED",
                "metrics_scope": "APPLICATION_HANDLED_REQUESTS_CURRENT_PROCESS",
                "parser_rejections_counted": False, "external_rpc": "UNVERIFIED",
                "public_launch": "UNVERIFIED", "wallet_execution": "UNAVAILABLE",
                "host_patch_audit": "UNVERIFIED", "windows_acl_audit": "UNVERIFIED"}


def doctor(state):
    store = Store(state)
    audit = store.audit()
    result = Runtime(store, "OFFLINE_DOCTOR").ready(local=True)
    result["audit"] = audit
    return result


def monitor(state, port, credential_file, *, samples=1, interval=1.0, out=None):
    if type(samples) is not int or not 1 <= samples <= 60 or not 0.1 <= interval <= 60:
        raise Problem(400, "INVALID_MONITOR_LIMITS")
    store = Store(state)
    with closing(store._connection()) as connection:
        expected_instance = connection.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()[0]
    expected_digest, _ = package_snapshot()
    token = read_credential(credential_file)
    client = Client(port)
    output = exclusive_file(out) if out else None
    completed = 0
    try:
        for index in range(samples):
            try:
                _, report = client.request("GET", "/v1/ready", token=token)
            except Problem as problem:
                # A different local service must not reflect an arbitrary error
                # string (including a submitted token) into monitoring output.
                code = "UNAUTHORIZED" if problem.status == 401 else "MONITOR_REQUEST_FAILED"
                raise Problem(problem.status, code) from None
            if (report.get("status") != "AVAILABLE" or report.get("scope") != "LOCAL_APPLICATION"
                    or report.get("package_digest") != expected_digest
                    or report.get("checks", {}).get("instance_id") != expected_instance
                    or report.get("transport") != "WAITRESS_3_0_2"):
                raise Problem(503, "MONITOR_IDENTITY_MISMATCH")
            record = {"status": "AVAILABLE", "scope": "LOCAL_APPLICATION",
                      "observed_at_ms": report["checks"]["observed_at_ms"],
                      "process_id": report["process_id"], "package_digest": expected_digest,
                      "uptime_ms": report["uptime_ms"], "metrics": report["metrics"],
                      "public_launch": "UNVERIFIED", "external_rpc": "UNVERIFIED"}
            if output:
                output.write((canonical(record) + "\n").encode("utf-8"))
                output.flush()
                os.fsync(output.fileno())
            completed += 1
            if index + 1 < samples:
                time.sleep(interval)
    finally:
        if output:
            output.close()
    return {"status": "AVAILABLE", "scope": "BOUNDED_LOCAL_POLLING", "samples": completed,
            "public_launch": "UNVERIFIED", "notifications": "UNAVAILABLE"}
