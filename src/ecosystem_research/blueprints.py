"""Versioned research recipes with explicit terms and measured trial references.

Packages are bounded data, never executable plugins. Only the catalog's existing
research handlers can be trialed. Dollar quotes are declarations, not settlement.
"""

from __future__ import annotations

from copy import deepcopy
import re

from . import network as n
from ..multi_brain_research import training_lab as lab
from ..solana_research import coin_evidence as ev

PROTOCOL = "AAI_BLUEPRINT_EXCHANGE_V1"
PACKAGE = "AAI_RESEARCH_BLUEPRINT_V1"
ROOT_ROUTE = "/v1/blueprints"
MAX_PACKAGE_BYTES = 10000
MAX_EVENTS, MAX_LISTINGS, MAX_LICENSES = 256, 32, 64
FIELDS = {
    "PUBLISH": ("service_listing_id", "package", "price_usd_cents"),
    "CLOSE": ("listing_id",),
    "ACQUIRE": ("listing_id", "terms_sha256"),
    "ACCEPT": ("license_id", "package_sha256", "trial_order_id"),
    "REJECT": ("license_id",),
}


def integer(value, low=0, high=10**12):
    lab.require(type(value) is int and low <= value <= high, "BLUEPRINT_INTEGER")
    return value


def text(value, maximum):
    lab.require(type(value) is str and 0 < len(value.encode("utf-8")) <= maximum
                and value.strip() == value
                and all(c in "\n\t" or ord(c) >= 32 for c in value), "BLUEPRINT_TEXT")
    return value


def validate_package(value, catalog):
    lab.exact(value, ("protocol", "slug", "version", "title", "summary", "instructions",
                      "license_text", "recipe", "performance_claim"))
    lab.require(value["protocol"] == PACKAGE
                and value["performance_claim"] == "NONE", "BLUEPRINT_PACKAGE_SCOPE")
    lab.require(type(value["slug"]) is str
                and re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", value["slug"])
                and len(value["slug"]) <= 64, "BLUEPRINT_SLUG")
    integer(value["version"], 1, 1000000)
    for field, bound in (("title", 120), ("summary", 500), ("instructions", 5000), ("license_text", 2000)):
        text(value[field], bound)
    recipe = value["recipe"]
    lab.exact(recipe, ("service", "resource_sha256", "catalog_sha256"))
    lab.require(type(recipe["service"]) is str and recipe["service"] in catalog["resources"],
                "BLUEPRINT_UNSUPPORTED_RECIPE")
    lab.require(recipe["catalog_sha256"] == lab.digest(catalog)
                and recipe["resource_sha256"] == lab.digest(catalog["resources"][recipe["service"]]),
                "BLUEPRINT_RECIPE_PIN")
    lab.require(len(n.raw(value)) <= MAX_PACKAGE_BYTES, "BLUEPRINT_PACKAGE_BOUND")
    return deepcopy(value)


def command_value(command):
    lab.require(type(command) is dict and type(command.get("kind")) is str
                and command["kind"] in FIELDS, "BLUEPRINT_COMMAND")
    lab.exact(command, ("request_id", "kind", *FIELDS[command["kind"]]))
    n.identity(command["request_id"])
    for key in FIELDS[command["kind"]]:
        if key.endswith("_id"):
            n.identity(command[key])
        elif key.endswith("_sha256"):
            lab.pin(command[key])
    lab.require(len(n.raw(command)) <= 12000, "BLUEPRINT_COMMAND_BOUND")
    return deepcopy(command)


def terms(package, provider, project, service_listing, price):
    return {
        "protocol": PROTOCOL, "package_sha256": ev.sha(n.raw(package)),
        "license_sha256": ev.sha(package["license_text"].encode("utf-8")),
        "provider_id": n.identity(provider), "project_id": n.identity(project),
        "service_listing_id": n.identity(service_listing),
        "price_usd_cents": integer(price), "currency": "USD",
        "settlement": "FREE" if price == 0 else "UNAVAILABLE",
        "financial_settlement": False, "live_execution_allowed": False,
    }


def descriptor(listing):
    """Discovery excludes the licensed instruction and license bodies."""
    return {k: deepcopy(v) for k, v in listing.items() if k != "package"}


def empty():
    return {"listings": {}, "licenses": {}}


def facts_for(command, service_state):
    if command["kind"] == "PUBLISH":
        listing = service_state["listings"].get(command["service_listing_id"])
        lab.require(listing is not None, "BLUEPRINT_SERVICE_LISTING_REQUIRED")
        return {"service_listing": deepcopy(listing)}
    if command["kind"] == "ACCEPT":
        order = service_state["orders"].get(command["trial_order_id"])
        lab.require(order is not None, "BLUEPRINT_TRIAL_REQUIRED")
        return {"order": deepcopy(order),
                "service_listing": deepcopy(service_state["listings"][order["listing_id"]])}
    return {}


def apply(state, actor, command, at, facts, catalog):
    state = deepcopy(state)
    lab.exact(actor, ("role", "principal_id", "credential_id"))
    lab.require(actor["role"] == "AGENT", "BLUEPRINT_AGENT_REQUIRED")
    who = n.identity(actor["principal_id"])
    n.identity(actor["credential_id"])
    integer(at, 0, 2**53 - 1)
    command = command_value(command)
    kind = command["kind"]
    record_id = lab.digest([PROTOCOL, lab.digest(catalog), who, command["request_id"], kind])[:32]
    if kind == "PUBLISH":
        lab.exact(facts, ("service_listing",))
        source = facts["service_listing"]
        lab.require(source["provider_id"] == who and source["active"]
                    and at < source["expires_ms"], "BLUEPRINT_PROVIDER_REQUIRED")
        package = validate_package(command["package"], catalog)
        lab.require(source["id"] == command["service_listing_id"]
                    and package["recipe"]["service"] == source["service"]
                    and package["recipe"]["resource_sha256"] == source["resource_sha256"],
                    "BLUEPRINT_SERVICE_BINDING")
        lab.require(len(state["listings"]) < MAX_LISTINGS, "BLUEPRINT_LISTING_BOUND")
        lab.require(not any(item["provider_id"] == who and item["slug"] == package["slug"]
                            and item["version"] == package["version"] for item in state["listings"].values()),
                    "BLUEPRINT_VERSION_EXISTS")
        sale = terms(package, who, source["project_id"], source["id"], command["price_usd_cents"])
        listing = {"id": record_id, "provider_id": who, "project_id": source["project_id"],
                   "service_listing_id": source["id"], "package": package,
                   **{k: package[k] for k in ("slug", "version", "title", "summary", "recipe")},
                   "terms": sale, "terms_sha256": lab.digest(sale),
                   "active": True, "published_ms": at, "performance_claim": "NONE"}
        state["listings"][record_id] = listing
        return state, descriptor(listing)
    if kind in ("ACQUIRE", "CLOSE"):
        lab.exact(facts, ())
        listing = state["listings"].get(command["listing_id"])
        lab.require(listing is not None, "BLUEPRINT_NOT_FOUND")
        if kind == "CLOSE":
            lab.require(who == listing["provider_id"], "BLUEPRINT_PROVIDER_REQUIRED")
            lab.require(listing["active"], "BLUEPRINT_ALREADY_CLOSED")
            listing["active"] = False
            return state, descriptor(listing)
        lab.require(listing["active"], "BLUEPRINT_LISTING_CLOSED")
        lab.require(who != listing["provider_id"], "BLUEPRINT_SELF_ACQUISITION")
        lab.require(command["terms_sha256"] == listing["terms_sha256"], "BLUEPRINT_TERMS_CHANGED")
        lab.require(listing["terms"]["price_usd_cents"] == 0, "BLUEPRINT_PAID_SETTLEMENT_UNAVAILABLE")
        lab.require(not any(v["listing_id"] == listing["id"] and v["buyer_id"] == who
                            for v in state["licenses"].values()), "BLUEPRINT_ALREADY_ACQUIRED")
        lab.require(len(state["licenses"]) < MAX_LICENSES, "BLUEPRINT_LICENSE_BOUND")
        result = {"id": record_id, "listing_id": listing["id"], "buyer_id": who,
                  "provider_id": listing["provider_id"], "project_id": listing["project_id"],
                  "package_sha256": listing["terms"]["package_sha256"],
                  "terms_sha256": listing["terms_sha256"], "state": "ACQUIRED",
                  "acquired_ms": at, "decided_ms": None, "trial_order_id": None,
                  "trial_report_sha256": None, "financial_settlement": False,
                  "live_execution_allowed": False}
        state["licenses"][record_id] = result
        return state, deepcopy(result)
    license_ = state["licenses"].get(command["license_id"])
    lab.require(license_ is not None, "BLUEPRINT_NOT_FOUND")
    lab.require(who == license_["buyer_id"], "BLUEPRINT_BUYER_REQUIRED")
    lab.require(license_["state"] == "ACQUIRED", "BLUEPRINT_ALREADY_DECIDED")
    if kind == "ACCEPT":
        lab.exact(facts, ("order", "service_listing"))
        order, source = facts["order"], facts["service_listing"]
        listing = state["listings"][license_["listing_id"]]
        lab.require(command["package_sha256"] == license_["package_sha256"], "BLUEPRINT_PACKAGE_CHANGED")
        lab.require(order["id"] == command["trial_order_id"] and order["state"] == "ACCEPTED"
                    and all(order[k] == license_[k] for k in ("buyer_id", "provider_id", "project_id"))
                    and order["listing_id"] == source["id"] == listing["service_listing_id"]
                    and source["service"] == listing["recipe"]["service"]
                    and source["resource_sha256"] == listing["recipe"]["resource_sha256"],
                    "BLUEPRINT_TRIAL_BINDING")
        lab.require(not any(v["trial_order_id"] == order["id"] for v in state["licenses"].values()),
                    "BLUEPRINT_TRIAL_ALREADY_USED")
        license_["trial_order_id"] = order["id"]
        license_["trial_report_sha256"] = lab.pin(order["report_sha256"])
    else:
        lab.exact(facts, ())
    license_["state"] = "ACCEPTED" if kind == "ACCEPT" else "REJECTED"
    license_["decided_ms"] = at
    return state, deepcopy(license_)


def verify_delivery(value, license_id, buyer, expected_package, expected_terms, catalog):
    """Verify received data without writing files or interpreting instructions."""
    lab.exact(value, ("protocol", "license", "listing", "package", "financial_settlement",
                      "live_execution_allowed", "verification_scope"))
    lab.require(value["protocol"] == PROTOCOL and value["financial_settlement"] is False
                and value["live_execution_allowed"] is False
                and value["verification_scope"] == "PACKAGE_INTEGRITY_AND_REGISTERED_RECIPE",
                "BLUEPRINT_DELIVERY_SCOPE")
    license_, listing = value["license"], value["listing"]
    lab.exact(license_, ("id", "listing_id", "buyer_id", "provider_id", "project_id", "package_sha256",
                         "terms_sha256", "state", "acquired_ms", "decided_ms", "trial_order_id",
                         "trial_report_sha256", "financial_settlement", "live_execution_allowed"))
    lab.exact(listing, ("id", "provider_id", "project_id", "service_listing_id", "slug", "version", "title",
                       "summary", "recipe", "terms", "terms_sha256", "active", "published_ms", "performance_claim"))
    for key in ("id", "provider_id", "project_id", "service_listing_id"):
        n.identity(listing[key])
    lab.require(type(listing["active"]) is bool and listing["performance_claim"] == "NONE", "BLUEPRINT_DELIVERY_SCOPE")
    integer(listing["published_ms"], 0, 2**53 - 1)
    integer(license_["acquired_ms"], 0, 2**53 - 1)
    if license_["state"] == "ACQUIRED":
        lab.require(all(license_[k] is None for k in ("decided_ms", "trial_order_id", "trial_report_sha256")),
                    "BLUEPRINT_DELIVERY_STATE")
    else:
        integer(license_["decided_ms"], license_["acquired_ms"], 2**53 - 1)
        if license_["state"] == "ACCEPTED":
            n.identity(license_["trial_order_id"])
            lab.pin(license_["trial_report_sha256"])
        else:
            lab.require(license_["trial_order_id"] is None and license_["trial_report_sha256"] is None,
                        "BLUEPRINT_DELIVERY_STATE")
    package = validate_package(value["package"], catalog)
    lab.require(license_["id"] == n.identity(license_id) and license_["buyer_id"] == n.identity(buyer)
                and license_["state"] in ("ACQUIRED", "ACCEPTED", "REJECTED")
                and license_["listing_id"] == listing["id"]
                and all(license_[k] == listing[k] for k in ("project_id", "provider_id"))
                and license_["financial_settlement"] is False and license_["live_execution_allowed"] is False,
                "BLUEPRINT_DELIVERY_PARTIES")
    expected = terms(package, listing["provider_id"], listing["project_id"], listing["service_listing_id"], 0)
    lab.require(n.same(expected, listing["terms"])
                and ev.sha(n.raw(package)) == license_["package_sha256"] == lab.pin(expected_package)
                and lab.digest(expected) == license_["terms_sha256"] == listing["terms_sha256"] == lab.pin(expected_terms)
                and all(n.same(listing[k], package[k]) for k in ("slug", "version", "title", "summary", "recipe")),
                "BLUEPRINT_DELIVERY_HASH")
    return {"protocol": "AAI_BLUEPRINT_RECEIPT_V1", "license_id": license_id,
            "buyer_id": buyer, "package_sha256": expected_package, "terms_sha256": expected_terms,
            "bytes": len(n.raw(package)), "recipe": package["recipe"],
            "verification_scope": "PACKAGE_INTEGRITY_AND_REGISTERED_RECIPE",
            "instructions_executed": False, "profit_verified": False,
            "financial_settlement": False, "live_execution_allowed": False}
