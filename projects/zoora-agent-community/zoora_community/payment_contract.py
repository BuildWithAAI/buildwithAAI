"""Explicit sandbox instruction limits, separate from synthetic commerce units."""

from .bridge_sandbox import amount, intent_value, provider_id, sha
from .commerce import PURCHASE_ACTIVITIES, fingerprint, request_value
from .spending import label
from .validation import DIGEST, Problem, fields, identifier, matching, wallet

ENVIRONMENT = "BRIDGE_SANDBOX"
MAX_ORDERS = 64


def stamp(value):
    if type(value) is not int or not 0 <= value < 2**63:
        raise Problem(400, "PIPELINE_CLOCK_REJECTED")
    return value


def units(value):
    return int(amount(value).replace(".", ""))


def display(value):
    return f"{value // 1_000_000}.{value % 1_000_000:06d}"


def mandate_value(value):
    fields(value, ("mandate_id", "environment", "real_funds_authorized", "instance_id", "operator_id",
        "agents", "customer_id", "source_address", "merchants", "payment_limit_usdc", "admission_budget_usdc",
        "valid_from_ms", "expires_ms"))
    if value["environment"] != ENVIRONMENT or value["real_funds_authorized"] is not False:
        raise Problem(400, "PIPELINE_SANDBOX_ONLY")
    agents, merchants = value["agents"], value["merchants"]
    if (type(agents) is not list or not 1 <= len(agents) <= 32
            or type(merchants) is not list or not 1 <= len(merchants) <= 32):
        raise Problem(400, "PIPELINE_INVALID_MANDATE")
    agent_ids = [identifier(item) for item in agents]
    payees = []
    for item in merchants:
        fields(item, ("merchant", "destination_address", "activities"))
        activities = item["activities"]
        if (type(activities) is not list or not 1 <= len(activities) <= len(PURCHASE_ACTIVITIES)
                or any(type(a) is not str or a not in PURCHASE_ACTIVITIES for a in activities)
                or len(set(activities)) != len(activities)):
            raise Problem(400, "PIPELINE_ACTIVITY_NOT_SUPPORTED")
        payees.append({"merchant": label(item["merchant"]), "destination_address": wallet(item["destination_address"]),
                       "activities": sorted(activities)})
    result = {**value, "mandate_id": identifier(value["mandate_id"]),
        "instance_id": identifier(value["instance_id"]), "operator_id": identifier(value["operator_id"]),
        "agents": sorted(agent_ids), "customer_id": provider_id(value["customer_id"]),
        "source_address": wallet(value["source_address"]), "merchants": sorted(payees, key=lambda p: p["merchant"]),
        "payment_limit_usdc": amount(value["payment_limit_usdc"]),
        "admission_budget_usdc": amount(value["admission_budget_usdc"]),
        "valid_from_ms": stamp(value["valid_from_ms"]), "expires_ms": stamp(value["expires_ms"])}
    if (len(set(agent_ids)) != len(agent_ids) or len({p["merchant"] for p in payees}) != len(payees)
            or result["expires_ms"] <= result["valid_from_ms"]
            or units(result["payment_limit_usdc"]) > units(result["admission_budget_usdc"])
            or any(p["destination_address"] == result["source_address"] for p in payees)):
        raise Problem(400, "PIPELINE_INVALID_MANDATE")
    return result


def envelope_value(value):
    fields(value, ("book_id", "purchase_id", "commerce_binding_sha256", "amount_usdc"))
    return {"book_id": identifier(value["book_id"]), "purchase_id": identifier(value["purchase_id"]),
        "commerce_binding_sha256": matching(value["commerce_binding_sha256"], DIGEST, "INVALID_DIGEST"),
        "amount_usdc": amount(value["amount_usdc"])}


def order_id(mandate, envelope):
    # Independent of amount/mandate ID: changing those cannot create another identity
    # for the same source purchase inside the shared provider journal.
    return sha({"domain": "ZOORA_SANDBOX_PURCHASE_V1", "instance_id": mandate["instance_id"],
                "book_id": envelope["book_id"], "purchase_id": envelope["purchase_id"]})[:32]


def terms_value(mandate, envelope, agent_id, request):
    envelope, request = envelope_value(envelope), request_value(request)
    agent_id = identifier(agent_id)
    if agent_id not in mandate["agents"]:
        raise Problem(403, "PIPELINE_AGENT_NOT_AUTHORIZED")
    if (request["quote"]["purchase_id"] != envelope["purchase_id"]
            or fingerprint(request) != envelope["commerce_binding_sha256"]):
        raise Problem(409, "PIPELINE_COMMERCE_BINDING_MISMATCH")
    merchant = next((p for p in mandate["merchants"] if p["merchant"] == request["quote"]["payee"]), None)
    if merchant is None or request["activity"] not in merchant["activities"]:
        raise Problem(403, "PIPELINE_MERCHANT_OR_ACTIVITY_NOT_AUTHORIZED")
    if units(envelope["amount_usdc"]) > units(mandate["payment_limit_usdc"]):
        raise Problem(409, "PIPELINE_PAYMENT_LIMIT")
    intent = intent_value({"request_id": order_id(mandate, envelope), "customer_id": mandate["customer_id"],
        "source_address": mandate["source_address"], "destination_address": merchant["destination_address"],
        "amount_usdc": envelope["amount_usdc"]})
    return {"envelope": envelope, "agent_id": agent_id, "commerce_request": request, "intent": intent}


def checked_purchase(book, envelope, agent_id, mandate):
    """Check a live local API view; SUBMIT remains the final serialized commerce gate."""
    try:
        if book["id"] != envelope["book_id"] or book["operator_id"] != mandate["operator_id"]:
            raise Problem(403, "PIPELINE_COMMERCE_OWNER_MISMATCH")
        record = next((r for r in book["state"]["purchases"] if r["request"]["quote"]["purchase_id"] == envelope["purchase_id"]), None)
        if record is None:
            raise Problem(404, "PIPELINE_PURCHASE_NOT_FOUND")
        binding = next((b for b in book["bindings"] if b["agent_id"] == agent_id), None)
        if binding is None or binding["alias"] != record["request"]["quote"]["payer"]:
            raise Problem(403, "PIPELINE_PURCHASE_AGENT_MISMATCH")
        terms = terms_value(mandate, envelope, agent_id, record["request"])
        paid = next(p for p in book["state"]["authority"]["payments"] if p["quote"]["purchase_id"] == envelope["purchase_id"])
        if book["state"]["authority"]["revoked"]:
            raise Problem(409, "PIPELINE_COMMERCE_REVOKED")
        if paid["state"] not in {"AUTHORIZED", "IN_FLIGHT"}:
            raise Problem(409, "PIPELINE_COMMERCE_NOT_AUTHORIZED")
        tick, policy = book["current_elapsed_ms"], book["policy"]["authority"]
        if not policy["valid_from"] <= tick < min(policy["expires"], record["request"]["quote"]["expires"]):
            raise Problem(409, "PIPELINE_COMMERCE_EXPIRED")
        return terms, paid["state"]
    except (KeyError, TypeError, StopIteration):
        raise Problem(502, "PIPELINE_COMMERCE_RESPONSE_REJECTED") from None
