"""Redacted customer observations only; never a payment or credential-rotation grant."""

from .bridge_sandbox import provider_id
from .validation import Problem

CUSTOMER_STATES = frozenset({"active", "awaiting_questionnaire", "awaiting_ubo", "deposits_restricted",
    "incomplete", "not_started", "offboarded", "paused", "rejected", "under_review"})
KYC_STATES = CUSTOMER_STATES | {"approved"}
ENDORSEMENT_STATES = frozenset({"approved", "incomplete", "pending", "under_review", "rejected",
    "revoked", "not_started", "paused"})
MAX_ENDORSEMENTS = 32
MAX_REQUIREMENTS = 256


def status(value, known):
    if value is None:
        return None
    if type(value) is not str or not 1 <= len(value) <= 64:
        raise ValueError("invalid status")
    # Unknown provider strings may contain personal details; never reflect them.
    return value if value in known else "UNRECOGNIZED"


def requirements_clear(value):
    if value is None:
        return None
    if type(value) is not dict:
        raise ValueError("invalid requirements")
    for name in ("pending", "issues"):
        if name in value and (type(value[name]) is not list or len(value[name]) > MAX_REQUIREMENTS):
            raise ValueError("invalid requirements list")
    if "missing" in value and value["missing"] is not None and type(value["missing"]) is not dict:
        raise ValueError("invalid missing requirements")
    if value.get("pending") or value.get("issues") or value.get("missing"):
        return False
    return True if all(name in value for name in ("pending", "issues", "missing")) else None


def customer_observation(value, customer_id):
    """Project fixed fields, preserving absence and contradictory approval signals."""
    customer_id = provider_id(customer_id)
    try:
        if type(value) is not dict or provider_id(value.get("id")) != customer_id:
            raise ValueError("wrong customer")
        customer = status(value.get("status"), CUSTOMER_STATES)
        kyc = status(value.get("kyc_status"), KYC_STATES)
        terms = value.get("has_accepted_terms_of_service")
        if terms is not None and type(terms) is not bool:
            raise ValueError("invalid terms")
        endorsements = value.get("endorsements")
        base, clear = None, None
        if endorsements is not None:
            if type(endorsements) is not list or len(endorsements) > MAX_ENDORSEMENTS:
                raise ValueError("invalid endorsements")
            seen = set()
            for item in endorsements:
                if (type(item) is not dict or type(item.get("name")) is not str
                        or not 1 <= len(item["name"]) <= 64 or item["name"] in seen):
                    raise ValueError("ambiguous endorsements")
                seen.add(item["name"])
                if item["name"] == "base":
                    base = status(item.get("status"), ENDORSEMENT_STATES)
                    clear = requirements_clear(item.get("requirements"))
        missing, blockers = [], []
        for name, actual, expected in (("customer_status", customer, "active"), ("terms_accepted", terms, True),
                ("base_endorsement_status", base, "approved"), ("base_requirements_clear", clear, True)):
            if actual is None:
                missing.append(name)
            elif actual != expected:
                blockers.append(name)
        if kyc is not None and kyc not in {"approved", "active"}:
            blockers.append("kyc_status")
    except (Problem, ValueError, TypeError, AttributeError, KeyError):
        raise Problem(502, "BRIDGE_CUSTOMER_RESPONSE_REJECTED") from None
    return {"customer_id": customer_id, "customer_status": customer, "kyc_status": kyc,
            "terms_accepted": terms, "base_endorsement_status": base, "base_requirements_clear": clear,
            "missing_fields": missing, "blocking_fields": blockers,
            "assessment": "CUSTOMER_SIGNALS_BLOCKED" if blockers else "CUSTOMER_SIGNALS_INCOMPLETE" if missing else "CUSTOMER_SIGNALS_OBSERVED",
            "classification": "READ_ONLY_CUSTOMER_OBSERVATION", "scope": "BASE_CUSTOMER_ONBOARDING_ONLY",
            "may_authorize_new_post": False, "credential_rotation_authorized": False,
            "provider_account_continuity_verified": False, "solana_usdc_route_verified": False,
            "wallet_execution": False, "settlement_accounting": "UNAVAILABLE"}
