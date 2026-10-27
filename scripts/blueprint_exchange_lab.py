"""Actual exchange exercises embedded in the existing service transport lab."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from pathlib import Path
import subprocess
import sys
import tempfile

from src.ecosystem_research import blueprints as b, network as n
from src.ecosystem_research.checkout import worker_environment
from src.multi_brain_research import training_lab as lab
from src.solana_research import coin_evidence as ev

ROOT = Path(__file__).resolve().parents[1]
CHECKS = {
    "blueprint_tls_protocol_probe_before_bearer",
    "blueprint_trial_commit_failure_rolls_back_both_ledgers",
    "blueprint_accept_commit_failure_rolls_back_both_ledgers",
    "blueprint_atomic_accept_consumes_once", "blueprint_distinct_requests_cannot_duplicate_trial",
    "blueprint_active_trial_blocks_retry", "blueprint_cancelled_trials_allow_explicit_bounded_retry",
    "blueprint_attempt_bound_enforced", "blueprint_status_is_read_only",
    "blueprint_status_exposes_reserved_and_consumed_work", "blueprint_status_denies_nonparty",
    "blueprint_old_attempt_retry_preserves_history", "blueprint_changed_trial_retry_conflicts",
    "blueprint_changed_request_id_payload_denied", "blueprint_nonmember_cannot_acquire",
    "blueprint_clock_rollback_does_not_corrupt_ledger",
    "blueprint_denies_owner", "blueprint_denies_operator", "blueprint_denies_outsider",
    "blueprint_delivery_denies_anonymous", "blueprint_delivery_denies_owner",
    "blueprint_delivery_denies_operator", "blueprint_delivery_denies_outsider",
    "blueprint_duplicate_acquisition", "blueprint_changed_terms",
    "blueprint_public_publish_discovery_and_terms", "blueprint_owner_operator_and_outsider_denied",
    "blueprint_duplicate_version_denied", "blueprint_paid_acquisition_blocked_without_mutation",
    "blueprint_four_process_acquire_retries_one_license", "blueprint_duplicate_and_changed_terms_denied",
    "blueprint_bound_delivery_only", "blueprint_public_fetch_verifies_external_pins",
    "blueprint_trial_reserves_existing_allowance_once", "blueprint_unaccepted_trial_denied",
    "blueprint_accept_replays_remote_trial_over_tls", "blueprint_accepted_trial_cannot_certify_another_version",
    "blueprint_rejection_retains_license", "blueprint_close_preserves_existing_delivery",
    "blueprint_tls_retries_do_not_duplicate_license_or_acceptance", "blueprint_wrong_pin_creates_no_output",
}


def public(verb, config):
    args = [sys.executable, "-I", "-B", str(ROOT / "scripts/run_research_services.py"), verb]
    shared = ("community_source", "port", "origin", "ca_file", "credential", "expected_instance", "expected_principal", "catalog_sha256")
    extras = {"blueprint-act": ("action_file",), "blueprint-observe": (), "blueprint-terms": ("listing_id",),
              "blueprint-fetch": ("license_id", "package_sha256", "terms_sha256", "output"),
              "blueprint-trial": ("license_id", "package_sha256", "terms_sha256", "mandate_id", "start_before_ms", "attempt"),
              "blueprint-status": ("license_id",),
              "blueprint-accept": ("license_id", "package_sha256", "terms_sha256", "trial_order_id", "bundle_sha256",
                                   "controller_manifest_sha256", "feed_head_sha256", "feed_policy_sha256")}
    with tempfile.TemporaryDirectory() as temporary:
        config = dict(config)
        if "action" in config:
            path = Path(temporary) / "action.json"
            ev.write(path, config["action"])
            config["action_file"] = str(path)
        for key in (*shared, *extras[verb]):
            if key in config:
                flag = "trusted-controller-sha256" if key == "controller_manifest_sha256" else key.replace("_", "-")
                args.extend(("--" + flag, str(config[key])))
        completed = subprocess.run(args, capture_output=True, timeout=180, env=worker_environment())
    lab.require(len(completed.stdout) + len(completed.stderr) <= 1024**2, "BLUEPRINT_PUBLIC_LOG_BOUND")
    result = ev.parse(completed.stdout)
    lab.require(completed.returncode == 0, "BLUEPRINT_PUBLIC_CLI:" + str(result.get("error")))
    return result


class Exchange:
    def __init__(self, resources, store, client, cli, buyer, seller, outsider, admin, owner, command, denied, checks, child):
        self.resources, self.store, self.client, self.cli = resources, store, client, cli
        self.buyer, self.seller, self.command = buyer, seller, command
        self.denied, self.checks, self.child = denied, checks, child
        self.package = {
            "protocol": b.PACKAGE, "slug": "guarded-model-review", "version": 1,
            "title": "Guarded research model review", "summary": "Repeat the catalog's bounded synthetic-model guard exercise.",
            "instructions": "Request the pinned model_guard_audit service using an existing work mandate. "
                            "Verify its remote models and evidence, replay the report, then accept the delivery. "
                            "This exercises synthetic model guards and does not establish market accuracy.",
            "license_text": "The acquiring agent may use and modify this research recipe. Redistribution is not included. "
                            "No support or future updates are included. No profitability is represented.",
            "recipe": {"service": seller["listing"]["service"], "resource_sha256": seller["listing"]["resource_sha256"],
                       "catalog_sha256": resources.digest}, "performance_claim": "NONE",
        }
        self.publish_command = command("PUBLISH", service_listing_id=seller["listing"]["id"], package=self.package, price_usd_cents=0)
        self.free = public("blueprint-act", {**cli(seller), "action": self.publish_command})["result"]
        self.paid = self.do(seller, command("PUBLISH", service_listing_id=seller["listing"]["id"],
                                          package={**self.package, "version": 2}, price_usd_cents=500000))["result"]
        self.other = self.do(seller, command("PUBLISH", service_listing_id=seller["listing"]["id"],
                                           package={**self.package, "version": 3}, price_usd_cents=0))["result"]
        view = public("blueprint-observe", cli(buyer))
        terms = public("blueprint-terms", {**cli(buyer), "listing_id": self.free["id"]})
        lab.require(len(view["listings"]) == 3 and all("package" not in v for v in view["listings"].values())
                    and terms["license_text"] == self.package["license_text"]
                    and terms["listing"]["terms_sha256"] == self.free["terms_sha256"], "BLUEPRINT_PUBLIC_DISCOVERY")
        checks["blueprint_public_publish_discovery_and_terms"] = True
        for role, token in (("owner", owner), ("operator", seller["operator"]), ("outsider", outsider["token"])):
            denied("blueprint_denies_" + role,
                   lambda auth=token: admin.request("POST", b.ROOT_ROUTE + "/actions", self.publish_command, auth))
        checks["blueprint_owner_operator_and_outsider_denied"] = True
        denied("blueprint_changed_request_id_payload_denied", lambda: self.do(seller, {
            **self.publish_command, "price_usd_cents": 100}), "BLUEPRINT_REQUEST_CONFLICT")
        denied("blueprint_duplicate_version_denied", lambda: self.do(seller, command(
            "PUBLISH", service_listing_id=seller["listing"]["id"], package=self.package, price_usd_cents=1)), "BLUEPRINT_VERSION_EXISTS")
        before = (store.audit(), store.service_audit(), store.blueprint_audit())
        denied("blueprint_paid_acquisition_blocked_without_mutation", lambda: self.do(buyer, command(
            "ACQUIRE", listing_id=self.paid["id"], terms_sha256=self.paid["terms_sha256"])), "BLUEPRINT_PAID_SETTLEMENT_UNAVAILABLE")
        lab.require(n.same(before, (store.audit(), store.service_audit(), store.blueprint_audit())), "BLUEPRINT_PAID_MUTATION")
        self.acquire_command = command("ACQUIRE", listing_id=self.free["id"], terms_sha256=self.free["terms_sha256"])
        with ThreadPoolExecutor(max_workers=4) as pool:
            retries = list(pool.map(lambda _: child("blueprint-act", {**cli(buyer), "action": self.acquire_command}), range(4)))
        lab.require(sum(not r["replayed"] for r in retries) == 1
                    and len({r["result"]["id"] for r in retries}) == 1, "BLUEPRINT_CONCURRENT_ACQUISITION")
        self.license = retries[0]["result"]
        checks["blueprint_four_process_acquire_retries_one_license"] = True
        denied("blueprint_nonmember_cannot_acquire", lambda: self.do(outsider, command(
            "ACQUIRE", listing_id=self.free["id"], terms_sha256=self.free["terms_sha256"])))
        denied("blueprint_duplicate_acquisition", lambda: self.do(buyer, command(
            "ACQUIRE", listing_id=self.free["id"], terms_sha256=self.free["terms_sha256"])), "BLUEPRINT_ALREADY_ACQUIRED")
        denied("blueprint_changed_terms", lambda: self.do(buyer, command(
            "ACQUIRE", listing_id=self.other["id"], terms_sha256="f" * 64)), "BLUEPRINT_TERMS_CHANGED")
        checks["blueprint_duplicate_and_changed_terms_denied"] = True
        self.other_license = self.do(buyer, command("ACQUIRE", listing_id=self.other["id"], terms_sha256=self.other["terms_sha256"]))["result"]
        before = (store.audit(), store.blueprint_audit())
        original_clock = store.clock
        try:
            store.clock = lambda: self.other_license["acquired_ms"] - 1
            denied("blueprint_clock_rollback_does_not_corrupt_ledger", lambda: store.call(
                "POST", b.ROOT_ROUTE + "/actions", command("CLOSE", listing_id=self.free["id"]), seller["token"]),
                "CLOCK_REGRESSION")
        finally:
            store.clock = original_clock
        lab.require(n.same(before, (store.audit(), store.blueprint_audit())), "BLUEPRINT_ROLLBACK_MUTATED_LEDGER")
        route = b.ROOT_ROUTE + "/licenses/" + self.license["id"] + "/delivery"
        for role, token in (("anonymous", None), ("owner", owner), ("operator", buyer["operator"]), ("outsider", outsider["token"])):
            denied("blueprint_delivery_denies_" + role, lambda auth=token: admin.request("GET", route, token=auth))
        checks["blueprint_bound_delivery_only"] = True
        self.receipt = public("blueprint-fetch", self.config())
        lab.require(self.receipt["instructions_executed"] is False and self.receipt["profit_verified"] is False,
                    "BLUEPRINT_RESEARCH_SCOPE")
        checks["blueprint_public_fetch_verifies_external_pins"] = True
        reverse = {**self.package, "slug": "scanner-replay-review", "title": "Historical scanner replay",
                   "summary": "Replay the pinned scanner journal with its source limitations.",
                   "instructions": "Run scanner_replay_audit and preserve missing and untrusted source classifications.",
                   "recipe": {"service": buyer["listing"]["service"], "resource_sha256": buyer["listing"]["resource_sha256"],
                              "catalog_sha256": resources.digest}}
        self.reverse_listing = self.do(buyer, command("PUBLISH", service_listing_id=buyer["listing"]["id"], package=reverse, price_usd_cents=0))["result"]
        self.reverse_license = self.do(seller, command("ACQUIRE", listing_id=self.reverse_listing["id"],
                                                     terms_sha256=self.reverse_listing["terms_sha256"]))["result"]

    def do(self, peer, command):
        return self.client(peer).request("POST", b.ROOT_ROUTE + "/actions", command, peer["token"])[1]

    def config(self):
        return {**self.cli(self.buyer), "license_id": self.license["id"],
                "package_sha256": self.license["package_sha256"], "terms_sha256": self.license["terms_sha256"]}

    def snapshot(self):
        return self.store.audit(), self.store.service_audit(), self.store.blueprint_audit()

    @contextmanager
    def fail_blueprint_commit(self):
        original = self.store._event

        def fault(*args):
            if args[2] == "BLUEPRINT_ACTION":
                raise ValueError("BLUEPRINT_INJECTED_COMMIT_FAILURE")
            return original(*args)

        self.store._event = fault
        try:
            yield
        finally:
            self.store._event = original

    def status(self, peer, license_, phase):
        before = self.snapshot()
        value = public("blueprint-status", {**self.cli(peer), "license_id": license_["id"]})
        lab.require(value["phase"] == phase and value["authorization_granted"] is False
                    and value["automatic_retry"] is False and value.get("verified") is True
                    and n.same(before, self.snapshot()), "BLUEPRINT_STATUS_MUTATION")
        self.checks["blueprint_status_is_read_only"] = True
        return {key: item for key, item in value.items() if key != "verified"}

    def reverse_config(self):
        license_ = self.reverse_license
        return {**self.cli(self.seller), "license_id": license_["id"], "package_sha256": license_["package_sha256"],
                "terms_sha256": license_["terms_sha256"]}

    def reverse_trial(self, deadline):
        return public("blueprint-trial", {**self.reverse_config(), "attempt": 1,
            "mandate_id": self.seller["mandate"]["id"], "start_before_ms": deadline})["order"]

    def accept_reverse(self, order):
        cfg = {**self.reverse_config(), "trial_order_id": order["id"]}
        before = self.snapshot()
        with self.fail_blueprint_commit():
            failed = self.child("blueprint-accept", cfg, allow_error=True)
        lab.require(failed.get("error") == "BLUEPRINT_INJECTED_COMMIT_FAILURE" and n.same(before, self.snapshot()),
                    "BLUEPRINT_ACCEPT_ROLLBACK")
        self.checks["blueprint_accept_commit_failure_rolls_back_both_ledgers"] = True
        self.status(self.seller, self.reverse_license, "READY_TO_VERIFY_AND_ACCEPT")
        accepted = public("blueprint-accept", cfg)
        lab.require(accepted["result"]["state"] == "ACCEPTED" and accepted["atomic_acceptance"] is True, "BLUEPRINT_ATOMIC_ACCEPT")
        before = self.snapshot()
        retried = self.child("blueprint-accept", cfg)
        lab.require(retried["replayed"] and n.same(before, self.snapshot()), "BLUEPRINT_DOUBLE_ACCEPT")
        self.checks["blueprint_atomic_accept_consumes_once"] = True
        value = self.status(self.seller, self.reverse_license, "ACCEPTED")
        lab.require(value["consumed_work_units"] == 3 and value["reserved_work_units"] == 0, "BLUEPRINT_STATUS_ACCOUNTING")
        self.checks["blueprint_status_exposes_reserved_and_consumed_work"] = True

    def trial(self, deadline):
        cfg = {**self.config(), "mandate_id": self.buyer["mandate"]["id"], "start_before_ms": deadline, "attempt": 1}
        self.status(self.buyer, self.license, "READY_TO_REQUEST")
        before = self.snapshot()
        with self.fail_blueprint_commit():
            failed = self.child("blueprint-trial", cfg, allow_error=True)
        lab.require(failed.get("error") == "BLUEPRINT_INJECTED_COMMIT_FAILURE" and n.same(before, self.snapshot()),
                    "BLUEPRINT_TRIAL_ROLLBACK")
        self.checks["blueprint_trial_commit_failure_rolls_back_both_ledgers"] = True
        result = public("blueprint-trial", cfg)
        before = (self.store.audit(), self.store.service_audit())
        retry = self.child("blueprint-trial", cfg)
        lab.require(retry["replayed"] and retry["result"]["id"] == result["result"]["id"]
                    and n.same(before, (self.store.audit(), self.store.service_audit())), "BLUEPRINT_DUPLICATE_TRIAL")
        self.checks["blueprint_trial_reserves_existing_allowance_once"] = True
        order = result["order"]
        value = self.status(self.buyer, self.license, "WAITING_FOR_PROVIDER")
        lab.require(value["reserved_work_units"] == 4 and value["consumed_work_units"] == 0, "BLUEPRINT_RESERVED_STATUS")
        self.denied("blueprint_status_denies_nonparty", lambda: self.client(self.buyer).request(
            "GET", b.ROOT_ROUTE + "/licenses/" + self.license["id"] + "/trials", token=None))
        duplicate = self.command("TRIAL", license_id=self.license["id"], package_sha256=self.license["package_sha256"],
                                 attempt=1, mandate_id=cfg["mandate_id"], start_before_ms=deadline)
        self.denied("blueprint_distinct_requests_cannot_duplicate_trial", lambda: self.do(self.buyer, duplicate), "BLUEPRINT_TRIAL_SEQUENCE")
        blocked = self.child("blueprint-trial", {**cfg, "attempt": 2}, allow_error=True)
        lab.require(blocked.get("error") == "BLUEPRINT_PRIOR_TRIAL_UNRESOLVED", "BLUEPRINT_PENDING_RETRY")
        self.checks["blueprint_active_trial_blocks_retry"] = True
        conflict = self.child("blueprint-trial", {**cfg, "start_before_ms": deadline - 1}, allow_error=True)
        lab.require(conflict.get("error") == "BLUEPRINT_REQUEST_CONFLICT", "BLUEPRINT_CHANGED_RETRY")
        self.checks["blueprint_changed_trial_retry_conflicts"] = True
        for attempt in (2, 3):
            self.client(self.buyer).request("POST", "/v1/services/actions", self.command("CANCEL", order_id=order["id"]), self.buyer["token"])
            self.status(self.buyer, self.license, "READY_TO_REQUEST")
            order = public("blueprint-trial", {**cfg, "attempt": attempt})["order"]
        self.checks["blueprint_cancelled_trials_allow_explicit_bounded_retry"] = True
        before = self.snapshot()
        old = self.child("blueprint-trial", cfg)
        lab.require(old["replayed"] and old["order"]["state"] == "CANCELLED"
                    and n.same(before, self.snapshot()), "BLUEPRINT_RETRY_HISTORY")
        self.checks["blueprint_old_attempt_retry_preserves_history"] = True
        bounded = self.child("blueprint-trial", {**cfg, "attempt": 4}, allow_error=True)
        lab.require(bounded.get("error") == "BLUEPRINT_INTEGER", "BLUEPRINT_ATTEMPT_LIMIT")
        self.checks["blueprint_attempt_bound_enforced"] = True
        self.denied("blueprint_unaccepted_trial_denied", lambda: self.do(self.buyer, self.command(
            "ACCEPT", license_id=self.license["id"], package_sha256=self.license["package_sha256"], trial_order_id=order["id"])),
            "BLUEPRINT_TRIAL_BINDING")
        return order

    def finish(self, order, output):
        cfg = {**self.config(), "trial_order_id": order["id"]}
        accepted = public("blueprint-accept", cfg)
        lab.require(accepted["result"]["state"] == "ACCEPTED" and accepted["atomic_acceptance"] is True
                    and accepted["trial"]["evidence"]["mode"] == "AUTHENTICATED_RECORD_TRANSFER", "BLUEPRINT_ACCEPTED_TRIAL")
        self.checks["blueprint_accept_replays_remote_trial_over_tls"] = True
        self.denied("blueprint_accepted_trial_cannot_certify_another_version", lambda: self.do(self.buyer, self.command(
            "ACCEPT", license_id=self.other_license["id"], package_sha256=self.other_license["package_sha256"], trial_order_id=order["id"])),
            "BLUEPRINT_TRIAL_NOT_REGISTERED")
        rejected = self.do(self.buyer, self.command("REJECT", license_id=self.other_license["id"]))
        lab.require(rejected["result"]["state"] == "REJECTED", "BLUEPRINT_REJECTION")
        self.checks["blueprint_rejection_retains_license"] = True
        self.do(self.seller, self.command("CLOSE", listing_id=self.free["id"]))
        # The first server is stopped here; use current TLS CLI configuration for all reads/writes.
        closed = self.child("blueprint-act", {**self.cli(self.buyer), "action": self.command(
            "ACQUIRE", listing_id=self.free["id"], terms_sha256=self.free["terms_sha256"])}, allow_error=True)
        lab.require(closed.get("error") == "BLUEPRINT_LISTING_CLOSED", "BLUEPRINT_CLOSED_ACQUISITION")
        public("blueprint-fetch", {**self.config(), "output": str(output / "blueprint-delivery.json")})
        self.checks["blueprint_close_preserves_existing_delivery"] = True
        before = (self.store.audit(), self.store.service_audit(), self.store.blueprint_audit())
        acquired = self.child("blueprint-act", {**self.cli(self.buyer), "action": self.acquire_command})
        retried = self.child("blueprint-accept", cfg)
        lab.require(acquired["replayed"] and retried["replayed"]
                    and n.same(before, (self.store.audit(), self.store.service_audit(), self.store.blueprint_audit())),
                    "BLUEPRINT_RESTART_DUPLICATE")
        self.checks["blueprint_tls_retries_do_not_duplicate_license_or_acceptance"] = True
        target = output / "must-not-exist.json"
        wrong = self.child("blueprint-fetch", {**self.config(), "package_sha256": "f" * 64, "output": str(target)}, allow_error=True)
        lab.require(wrong.get("error") == "BLUEPRINT_DELIVERY_HASH" and not target.exists(), "BLUEPRINT_BAD_PIN_OUTPUT")
        self.checks["blueprint_wrong_pin_creates_no_output"] = True
        ev.write(output / "blueprint-receipt.json", b.verify_delivery(
            ev.read(output / "blueprint-delivery.json"), self.license["id"], self.buyer["agent"],
            self.license["package_sha256"], self.license["terms_sha256"], self.resources.catalog))
        ev.write(output / "blueprint-trials.json", {"protocol": b.PROTOCOL, "statuses": [
            self.status(self.buyer, self.license, "ACCEPTED"),
            self.status(self.seller, self.reverse_license, "ACCEPTED"),
            self.status(self.buyer, self.other_license, "REJECTED"),
        ]})


def verify(store, resources, output):
    audit = store.blueprint_audit()
    lab.require(n.same(audit, ev.read(output / "blueprint-audit.json")), "BLUEPRINT_SAVED_AUDIT_CHANGED")
    delivery = ev.read(output / "blueprint-delivery.json")
    license_ = audit["state"]["licenses"].get(delivery["license"]["id"])
    lab.require(license_ is not None and n.same(license_, delivery["license"]), "BLUEPRINT_SAVED_LICENSE_CHANGED")
    listing = audit["state"]["listings"][license_["listing_id"]]
    lab.require(n.same(b.descriptor(listing), delivery["listing"]) and n.same(listing["package"], delivery["package"]),
                "BLUEPRINT_SAVED_PACKAGE_CHANGED")
    receipt = b.verify_delivery(delivery, license_["id"], license_["buyer_id"], license_["package_sha256"],
                                license_["terms_sha256"], resources.catalog)
    lab.require(n.same(receipt, ev.read(output / "blueprint-receipt.json")), "BLUEPRINT_SAVED_RECEIPT_CHANGED")
    trials = ev.read(output / "blueprint-trials.json")
    lab.exact(trials, ("protocol", "statuses"))
    lab.require(trials["protocol"] == b.PROTOCOL and type(trials["statuses"]) is list
                and len(trials["statuses"]) == len(audit["state"]["licenses"]), "BLUEPRINT_SAVED_TRIALS")
    service_state = store.service_audit()["state"]
    seen = set()
    with closing(store._connection()) as db:
        last = db.execute("SELECT MAX(at_ms) FROM audit").fetchone()[0]
        for value in trials["statuses"]:
            key = n.identity(value["license_id"])
            lab.require(key not in seen and key in audit["state"]["licenses"], "BLUEPRINT_SAVED_TRIALS")
            seen.add(key)
            at = b.integer(value["observed_at_ms"], last, 2**53 - 1)
            current = audit["state"]["licenses"][key]
            jobs = {}
            for order_id in current["trial_orders"]:
                order = service_state["orders"][order_id]
                if order["job_id"] is not None:
                    jobs[order_id] = store._job_effective(db, store._row(db, "jobs", order["job_id"]), at)[0]
            lab.require(n.same(value, b.trial_status(current, service_state, jobs, at)), "BLUEPRINT_TRIAL_STATUS_REPLAY")
    lab.require(len(audit["state"]["listings"]) == 4
                and sorted(v["terms"]["price_usd_cents"] for v in audit["state"]["listings"].values()) == [0, 0, 0, 500000]
                and sorted(v["state"] for v in audit["state"]["licenses"].values()) == ["ACCEPTED", "ACCEPTED", "REJECTED"]
                and sorted(len(v["trial_orders"]) for v in audit["state"]["licenses"].values()) == [0, 1, 3]
                and listing["active"] is False and audit["events"] == 15, "BLUEPRINT_LIFECYCLE_COUNTS")
    return {"blueprint_listings": 4, "blueprint_licenses": 3, "accepted_blueprint_licenses": 2,
            "blueprint_trial_orders": 4, "blueprint_atomic_transitions": True,
            "blueprint_ledger_events": audit["events"], "blueprint_paid_settlement": False,
            "blueprint_trial_scope": "REGISTERED_RECIPE_RESULT_CONSISTENCY"}
