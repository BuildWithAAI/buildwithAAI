"""Exact units and explicit observation provenance."""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
from urllib.parse import urlsplit

TRANSFORMATION_VERSION = "aai-scanner/0.1.1"


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def source_host(url):
    return urlsplit(url).hostname


def units(amount, decimals):
    if type(amount) is not int or amount < 0 or type(decimals) is not int or not 0 <= decimals <= 255:
        raise ValueError("Invalid token amount or decimals")
    digits = str(amount).zfill(decimals + 1)
    return digits if not decimals else digits[:-decimals] + "." + digits[-decimals:]


def number(value, positive=False):
    if value is None or isinstance(value, bool):
        return None
    try:
        if len(str(value)) > 100:
            return None
        result = Decimal(str(value))
        if not result.is_finite() or result < 0 or (positive and result <= 0) or abs(result.adjusted()) > 100:
            return None
        return result
    except (InvalidOperation, ValueError, TypeError):
        return None


def ratio(a, b):
    with localcontext() as context:
        context.prec = 40
        return format(a / b, "f") if b else None


def receipt(provider, endpoint, method, *, slot=None, commitment=None, raw_hash=None, flags=None):
    timestamp = now()
    return {
        "provider": provider, "endpoint_host": source_host(endpoint), "method": method,
        "timestamp": timestamp, "available_at": timestamp, "timestamp_basis": "RETRIEVAL_TIME",
        "upstream_observed_at": None, "slot": slot, "commitment": commitment,
        "transformation_version": TRANSFORMATION_VERSION, "raw_sha256": raw_hash,
        "status": "AVAILABLE", "quality_flags": list(flags or []),
    }


def measurement(value, source, classification="OBSERVED", missingness="NOT_PROVIDED", flags=None):
    return {
        "value": value, "status": "AVAILABLE" if value is not None else "UNAVAILABLE",
        "classification": classification, "missingness": None if value is not None else missingness,
        "source": source, "transformation_version": TRANSFORMATION_VERSION,
        "quality_flags": list(flags or []),
    }


def failed_source(provider, endpoint, method, reason, status="FAILED"):
    result = receipt(provider, endpoint, method)
    result.update(status=status, reason=reason, quality_flags=["SOURCE_GAP"])
    return result
