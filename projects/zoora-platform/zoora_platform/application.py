"""One-origin web composition using existing strict HTTP and identity validation."""
import json
import os
from pathlib import Path
import threading
import time

from zoora_community.validation import Problem, fields

from . import VERSION
from .registry import KINDS
from .payments import Payments

WEB = Path(__file__).resolve().parents[1] / "web"


class Platform:
    def __init__(self, community, ledger, registry, workspace, env=None):
        self.community, self.ledger, self.registry = community, ledger, registry
        self.workspace = workspace
        self.env = os.environ if env is None else env
        self.payments = Payments(ledger, self.env)
        self.registry.model.reserve = self.ledger.reserve_model_request
        self.stop = threading.Event()
        self.thread = None
        self.heartbeat_thread = None

    def start(self):
        if self.thread is not None:
            raise RuntimeError("worker already started")
        self.thread = threading.Thread(target=self._work, name="zoora-registered-worker", daemon=True)
        self.thread.start()
        self.heartbeat_thread = threading.Thread(target=self._heartbeat, name="zoora-worker-observer", daemon=True)
        self.heartbeat_thread.start()

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=5)
        if self.heartbeat_thread:
            self.heartbeat_thread.join(timeout=3)

    def _heartbeat(self):
        while not self.stop.is_set() and self.thread.is_alive():
            try:
                self.ledger.heartbeat()
            except Exception:
                pass
            self.stop.wait(2)

    def _work(self):
        while not self.stop.is_set():
            try:
                self.ledger.tick(self.community.recorded_work_authority)
                self.work_once()
                self.payments.poll()
            except Exception:
                # No prompt, provider error text, bearer, or arbitrary model result in logs.
                pass
            self.stop.wait(0.5)

    def work_once(self):
        job = self.ledger.claim()
        if job is None:
            return False
        try:
            # Re-authenticate the original credential: suspension and expiry affect queued work too.
            payload = json.loads(job["payload"])
            envelope = payload.pop("_authority")
            principal = self.community.recorded_work_authority(envelope["credential_id"])
            expected = principal["role"] + ":" + principal["principal_id"]
            if expected != job["principal"]:
                raise Problem(403, "WORK_AUTHORITY_CHANGED")
            deadline = time.monotonic() + 110

            def guard():
                if time.monotonic() >= deadline:
                    raise Problem(504, "WORK_TIME_BUDGET_EXHAUSTED")
                current = self.community.recorded_work_authority(envelope["credential_id"])
                if current["role"] + ":" + current["principal_id"] != expected:
                    raise Problem(403, "WORK_AUTHORITY_CHANGED")
                if (job["kind"].startswith("agent.") and current["role"] != "OWNER"
                        and self.env.get("ZOORA_ALLOW_OPERATOR_COMPUTE") != "1"):
                    raise Problem(403, "HOST_COMPUTE_GRANT_REVOKED")

            result = self.registry.execute(job["kind"], payload, guard=guard)
            guard()
            result["job_id"] = job["id"]
            result["completed_at_ms"] = self.ledger.clock()
            result["input_sha256"] = job["fingerprint"]
            result["source_commit"] = self.source_commit()
            result["runtime_version"] = VERSION
            self.ledger.complete(job, result=result)
        except Problem as error:
            self.ledger.complete(job, error=error.code)
        except Exception:
            self.ledger.complete(job, error="REGISTERED_WORK_FAILED")
        return True

    def source_commit(self):
        code = self.env.get("RAILWAY_GIT_COMMIT_SHA", self.env.get("ZOORA_SOURCE_SHA", ""))
        if len(code) != 40 or any(c not in "0123456789abcdef" for c in code):
            code = None
        return code

    def status(self):
        return {"service": "zoora-platform/" + VERSION, "observed_at_ms": int(time.time() * 1000),
                "source_commit": self.source_commit(), "work": self.ledger.status(), "layers": self.registry.layers(),
                "model": {"configured": self.registry.model.configured,
                          "provider": self.registry.model.provider if self.registry.model.configured else None},
                "activation": {"price_usd": "30.00", "currency": "AAI", "allocation_bps": {"burn": 4000, "lock": 4000, "liquidity": 2000},
                  "status": "ALLOCATION_CONTRACT_AND_QUOTE_PROVIDER_REQUIRED", "message_signature_is_payment": False},
                "trading": {"status": "SIGNER_AND_VENUE_ADAPTER_REQUIRED"},
                "service_payments": {"configured": self.payments.configured,
                    "mint": self.payments.mint if self.payments.configured else None,
                    "recipient": self.payments.recipient if self.payments.configured else None,
                    "signing": "CLIENT_WALLET_ONLY", "activation_granted": False},
                "research": {"execution_authority": "RESEARCH_ONLY", "source_presence_is_runtime_readiness": False},
                "development_authority": "PRODUCTION_IMPLEMENTATION_AUTHORIZED_2026_10_29",
                "custody": "USER_CONTROLLED_WALLETS"}

    def route(self, method, path, body, token, args, expected_instance=None, expected_agent=None):
        assets = {"/": ("index.html", "text/html; charset=utf-8"),
                  "/platform.js": ("platform.js", "text/javascript; charset=utf-8"),
                  "/platform.css": ("platform.css", "text/css; charset=utf-8")}
        if method == "GET" and path in assets:
            filename, mime = assets[path]
            return 200, (WEB / filename).read_bytes(), mime
        if method == "GET" and path == "/workspace":
            return 200, self.workspace, "text/html; charset=utf-8"
        if not path.startswith("/api/platform/"):
            return None
        if expected_instance is not None:
            self.community.call("GET", "/v1/status", token=token,
                                expected_instance=expected_instance, expected_agent=expected_agent)
        if args:
            raise Problem(400, "INVALID_PLATFORM_PAGINATION")
        mime = "application/json; charset=utf-8"
        if method == "GET" and path == "/api/platform/status":
            return 200, self.status(), mime
        if method == "GET" and path == "/api/platform/kinds":
            items = []
            for key, value in KINDS.items():
                available = True
                reason = None
                if key.startswith("agent.") and not self.registry.model.configured:
                    available, reason = False, "MODEL_PROVIDER_NOT_CONFIGURED"
                if key == "research.archive_replay" and not (self.registry.data_root / "research-archive.json").is_file():
                    available, reason = False, "VERIFIED_RESEARCH_ARCHIVE_NOT_INSTALLED"
                items.append({"kind": key, **value, "available": available, "unavailable_reason": reason})
            return 200, {"items": items}, mime
        principal = self.community.call("GET", "/v1/me", token=token)[1]
        owner = principal["role"] == "OWNER"
        if principal["role"] not in ("OWNER", "OPERATOR", "AGENT"):
            raise Problem(403, "WORK_ROLE_REQUIRED")
        subject = principal["role"] + ":" + principal["principal_id"]
        if method == "GET" and path == "/api/platform/jobs":
            return 200, {"items": self.ledger.list(subject, owner)}, mime
        if method == "GET" and path == "/api/platform/schedules":
            return 200, {"items": self.ledger.schedules(subject, owner)}, mime
        if method == "POST" and path in ("/api/platform/jobs", "/api/platform/schedules"):
            scheduling = path.endswith("/schedules")
            fields(body, ("request_id", "kind", "payload", "interval_seconds", "max_runs") if scheduling else ("request_id", "kind", "payload"))
            if type(body["payload"]) is not dict:
                raise Problem(400, "INVALID_JOB_PAYLOAD")
            self.registry.validate(body["kind"], body["payload"])
            if (body["kind"].startswith("agent.") and not owner
                    and self.env.get("ZOORA_ALLOW_OPERATOR_COMPUTE") != "1"):
                raise Problem(403, "OWNER_COMPUTE_GRANT_REQUIRED")
            payload = {**body["payload"], "_authority": {"credential_id": principal["credential_id"]}}
            if scheduling:
                value = self.ledger.schedule(subject, body["request_id"], body["kind"], payload,
                                             body["interval_seconds"], body["max_runs"])
                return 201, {"schedule": value}, mime
            job, replayed = self.ledger.submit(subject, body["request_id"], body["kind"], payload)
            return 200 if replayed else 201, {"job": job, "replayed": replayed}, mime
        parts = path.split("/")
        if method == "POST" and len(parts) == 6 and parts[1:4] == ["api", "platform", "schedules"] and parts[-1] == "cancel":
            fields(body)
            return 200, {"schedule": self.ledger.cancel_schedule(parts[4], subject, owner)}, mime
        if method == "POST" and path == "/api/platform/payments":
            if not owner:
                raise Problem(403, "OWNER_INVOICE_REQUIRED")
            fields(body, ("request_id", "payer", "amount_raw"))
            return 201, {"payment": self.payments.create(**body)}, mime
        if len(parts) in (5, 6) and parts[1:4] == ["api", "platform", "payments"]:
            payer = None
            if not owner:
                if principal["role"] == "AGENT":
                    payer = self.community.call("GET", "/v1/agents/" + principal["principal_id"], token=token)[1]["wallet"]
                else:
                    binding = self.community.call("GET", "/v1/creator/wallet", token=token)[1]["binding"]
                    if binding is None:
                        raise Problem(403, "LINKED_PAYER_WALLET_REQUIRED")
                    payer = binding["wallet"]
            if method == "GET" and len(parts) == 5:
                return 200, {"payment": self.payments.get(parts[4], payer, owner)}, mime
            if method == "POST" and len(parts) == 6 and parts[5] == "submit":
                fields(body, ("signature",))
                return 202, {"payment": self.payments.submit(parts[4], body["signature"], payer, owner)}, mime
        if method == "GET" and len(parts) == 5 and parts[1:4] == ["api", "platform", "jobs"]:
            return 200, {"job": self.ledger.get(parts[4], subject, owner)}, mime
        if method == "POST" and len(parts) == 6 and parts[1:4] == ["api", "platform", "jobs"] and parts[-1] == "cancel":
            fields(body)
            return 200, {"job": self.ledger.cancel(parts[4], subject, owner)}, mime
        raise Problem(404, "PLATFORM_ROUTE_NOT_FOUND")
