"""Actual exchange exercises embedded in the existing service transport lab."""

from concurrent.futures import ThreadPoolExecutor
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
              "blueprint-trial": ("license_id", "package_sha256", "terms_sha256", "mandate_id", "start_before_ms"),
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

    def do(self, peer, command):
        return self.client(peer).request("POST", b.ROOT_ROUTE + "/actions", command, peer["token"])[1]

    def config(self):
        return {**self.cli(self.buyer), "license_id": self.license["id"],
                "package_sha256": self.license["package_sha256"], "terms_sha256": self.license["terms_sha256"]}

    def trial(self, deadline):
        cfg = {**self.config(), "mandate_id": self.buyer["mandate"]["id"], "start_before_ms": deadline}
        result = public("blueprint-trial", cfg)
        before = (self.store.audit(), self.store.service_audit())
        retry = self.child("blueprint-trial", cfg)
        lab.require(retry["replayed"] and retry["result"]["id"] == result["result"]["id"]
                    and n.same(before, (self.store.audit(), self.store.service_audit())), "BLUEPRINT_DUPLICATE_TRIAL")
        self.checks["blueprint_trial_reserves_existing_allowance_once"] = True
        order = result["result"]
        self.denied("blueprint_unaccepted_trial_denied", lambda: self.do(self.buyer, self.command(
            "ACCEPT", license_id=self.license["id"], package_sha256=self.license["package_sha256"], trial_order_id=order["id"])),
            "BLUEPRINT_TRIAL_BINDING")
        return order

    def finish(self, order, output):
        cfg = {**self.config(), "trial_order_id": order["id"]}
        accepted = public("blueprint-accept", cfg)
        lab.require(accepted["result"]["state"] == "ACCEPTED" and accepted["trial"]["replayed"]
                    and accepted["trial"]["evidence"]["mode"] == "AUTHENTICATED_RECORD_TRANSFER", "BLUEPRINT_ACCEPTED_TRIAL")
        self.checks["blueprint_accept_replays_remote_trial_over_tls"] = True
        self.denied("blueprint_accepted_trial_cannot_certify_another_version", lambda: self.do(self.buyer, self.command(
            "ACCEPT", license_id=self.other_license["id"], package_sha256=self.other_license["package_sha256"], trial_order_id=order["id"])),
            "BLUEPRINT_TRIAL_ALREADY_USED")
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
    lab.require(len(audit["state"]["listings"]) == 3
                and sorted(v["terms"]["price_usd_cents"] for v in audit["state"]["listings"].values()) == [0, 0, 500000]
                and sorted(v["state"] for v in audit["state"]["licenses"].values()) == ["ACCEPTED", "REJECTED"]
                and listing["active"] is False and audit["events"] == 8, "BLUEPRINT_LIFECYCLE_COUNTS")
    return {"blueprint_listings": 3, "blueprint_licenses": 2, "accepted_blueprint_licenses": 1,
            "blueprint_ledger_events": audit["events"], "blueprint_paid_settlement": False,
            "blueprint_trial_scope": "REGISTERED_RECIPE_RESULT_CONSISTENCY"}
