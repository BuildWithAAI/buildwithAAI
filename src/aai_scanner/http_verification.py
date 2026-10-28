"""Bounded checks of the configured running scanner; no signing or Telegram calls."""
import hashlib
import http.client
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import urlsplit
from .evidence import now, number, source_host
from .market import MARKET_URL, WRAPPED_SOL
from .mint import decode_address
from .operations import DATA_MAX_AGE
from .qualification import DEFAULT_WALLET
from .release import package_identity
from .service import report_coverage
from .transport import MAINNET_GENESIS, NoRedirect, ProviderError, bounded_body, reject_constant, retry_after_seconds

PATHS = frozenset({"/api/health", "/api/ready", "/api/scan", "/api/wallet"})


class HTTPProbe:
    def __init__(self, config):
        self.config = config.validate()
        self.deadline = time.monotonic() + 90
        self.blocked = False

    def request(self, path, body=None, authenticated=True):
        if path not in PATHS:
            raise ValueError("HTTP verification route is not allowed")
        timeout = min(35 if body is not None else 10, self.deadline - time.monotonic())
        if self.blocked or timeout <= 0:
            raise ProviderError("HTTP verification stopped", code="VERIFICATION_STOPPED")
        headers = {"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "AAI-HTTP-Verification"}
        if authenticated and self.config.api_token:
            headers["Authorization"] = "Bearer " + self.config.api_token
        request = urllib.request.Request(self.config.public_url.rstrip("/") + path,
                                         data=json.dumps(body).encode() if body is not None else None, headers=headers)
        deadline = time.monotonic() + timeout
        try:
            try:
                response = urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                code = response.status
                delay = retry_after_seconds(response.headers.get("Retry-After"))
                if code == 429 or code >= 500:
                    self.blocked = True
                if 300 <= code <= 399:
                    raise ProviderError("HTTP redirects are refused", code="REDIRECT_REFUSED", http_status=code)
                if response.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
                    raise ProviderError("HTTP response is not JSON", code="INVALID_HTTP_RESPONSE", http_status=code)
                raw = bounded_body(response, deadline, 2_000_000)
                payload = json.loads(raw, parse_float=Decimal, parse_constant=reject_constant)
                if not isinstance(payload, dict):
                    raise ProviderError("HTTP response is not an object", code="INVALID_HTTP_RESPONSE", http_status=code)
                proof = {"http_status": code, "raw_sha256": hashlib.sha256(raw).hexdigest(), "available_at": now(),
                         "retry_after_seconds": delay,
                         "no_store": "no-store" in {part.strip().lower() for part in response.headers.get("Cache-Control", "").split(",")}}
                return payload, proof
        except (urllib.error.URLError, OSError, TimeoutError, http.client.HTTPException):
            raise ProviderError("Application connection failed", code="CONNECTION_FAILED") from None
        except (ValueError, UnicodeError, RecursionError):
            raise ProviderError("Application JSON failed validation", code="INVALID_HTTP_RESPONSE") from None


def fresh(value, max_age=DATA_MAX_AGE):
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(value)).total_seconds()
        return 0 <= age <= max_age
    except (TypeError, ValueError, OverflowError):
        return False


def source_issues(proof, config, method=None, rpc=False):
    """Validate declared receipts; a response hash is not independent upstream attestation."""
    if isinstance(proof, list):
        if not 1 <= len(proof) <= 3 or any(not isinstance(source, dict) for source in proof):
            return ["INVALID_SOURCE_COLLECTION"]
        return sorted(set(issue for source in proof for issue in source_issues(source, config, method, rpc)))
    if not isinstance(proof, dict):
        return ["SOURCE_MISSING"]
    issues = []
    flags = proof.get("quality_flags", [])
    if (proof.get("classification") not in (None, "OBSERVED") or not isinstance(flags, list)
            or any(not isinstance(flag, str) or "SYNTHETIC" in flag for flag in flags)):
        issues.append("NON_OBSERVED_SOURCE")
    if proof.get("status") != "AVAILABLE":
        issues.append("SOURCE_UNAVAILABLE")
    if not fresh(proof.get("available_at"), 300 if method == "getGenesisHash" else DATA_MAX_AGE):
        issues.append("SOURCE_NOT_FRESH")
    if not isinstance(proof.get("raw_sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", proof["raw_sha256"]):
        issues.append("SOURCE_HASH_UNVERIFIED")
    approved = {source_host(endpoint) for endpoint in (config.rpc_url,) + config.rpc_fallback_urls} if rpc else {source_host(MARKET_URL)}
    if proof.get("endpoint_host") not in approved:
        issues.append("UNEXPECTED_SOURCE_HOST")
    if method and proof.get("method") != method:
        issues.append("SOURCE_METHOD_MISMATCH")
    if rpc:
        if method == "getGenesisHash":
            if proof.get("genesis_hash") != MAINNET_GENESIS:
                issues.append("MAINNET_UNVERIFIED")
        else:
            if proof.get("commitment") != "finalized" or proof.get("commitment_basis") != "REQUESTED":
                issues.append("FINALITY_REQUEST_UNVERIFIED")
            if method != "getSignaturesForAddress" and (type(proof.get("slot")) is not int or proof["slot"] < 0):
                issues.append("SLOT_UNVERIFIED")
            issues.extend(source_issues(proof.get("network_evidence"), config, "getGenesisHash", True))
    return sorted(set(issues))


def metric_issues(item, config, classification, method=None, rpc=False, positive=False):
    if not isinstance(item, dict):
        return ["MEASUREMENT_MISSING"]
    issues = source_issues(item.get("source"), config, method, rpc)
    if item.get("status") != "AVAILABLE" or number(item.get("value"), positive) is None:
        issues.append("VALUE_UNAVAILABLE_OR_INVALID")
    if item.get("classification") != classification:
        issues.append("CLASSIFICATION_MISMATCH")
    return sorted(set(issues))


def source_failures(proof, config):
    """Retain only approved hosts and typed failure metadata; never reason/body/URL."""
    if not isinstance(proof, dict) or not isinstance(proof.get("error"), dict):
        return []
    error = proof["error"]
    attempts = error.get("attempts")
    attempts = attempts if isinstance(attempts, list) and 1 <= len(attempts) <= 3 else [dict(error, endpoint_host=proof.get("endpoint_host"))]
    approved = {source_host(url) for url in (config.rpc_url,) + config.rpc_fallback_urls} | {source_host(MARKET_URL)}
    result = []
    for attempt in attempts:
        if not isinstance(attempt, dict) or not isinstance(attempt.get("endpoint_host"), str) or attempt["endpoint_host"] not in approved:
            continue
        code, status, delay = attempt.get("code"), attempt.get("http_status"), attempt.get("retry_after_seconds")
        code = code if code in ("HTTP_ERROR", "CONNECTION_FAILED", "COOLDOWN", "DEADLINE_EXCEEDED", "NETWORK_MISMATCH",
                               "RPC_ERROR", "VALIDATION_FAILED") else "UNVERIFIED_ERROR"
        result.append({"endpoint_host": attempt["endpoint_host"], "code": code,
                       "http_status": status if type(status) is int and 400 <= status <= 599 else None,
                       "retry_after_seconds": delay if type(delay) is int and 0 <= delay <= 2**31 - 1 else None})
    return result


def scan_checks(report, mint, config):
    if report.get("mint") != mint or not isinstance(report.get("mint_info"), dict) or report["mint_info"].get("mint") != mint:
        raise ValueError("REPORT_ADDRESS_MISMATCH")
    issues = {}
    mint_info, market, holders, activity = report["mint_info"], report["market"], report["holders"], report["activity"]
    issues["mint"] = source_issues(mint_info.get("evidence"), config, "getAccountInfo", True)
    if mint_info.get("status") != "AVAILABLE":
        issues["mint"].append("MINT_UNAVAILABLE")
    issues["usd_price"] = metric_issues(market.get("price_usd"), config, "OBSERVED", positive=True)
    issues["sol_price"] = metric_issues(market.get("price_sol"), config, "DERIVED", positive=True)
    issues["largest_token_accounts"] = source_issues(holders.get("source"), config, "getTokenLargestAccounts", True)
    if holders.get("status") != "AVAILABLE" or not isinstance(holders.get("accounts"), list):
        issues["largest_token_accounts"].append("HOLDERS_UNAVAILABLE")
    issues["address_activity"] = source_issues(activity.get("source"), config, "getSignaturesForAddress", True)
    if activity.get("status") != "AVAILABLE" or not isinstance(activity.get("records"), list):
        issues["address_activity"].append("ACTIVITY_UNAVAILABLE")
    issues["network"] = source_issues(report.get("network_evidence"), config, "getGenesisHash", True)
    if report.get("network") != "solana-mainnet":
        issues["network"].append("MAINNET_UNVERIFIED")
    issues["report_freshness"] = [] if fresh(report.get("available_at")) else ["REPORT_NOT_FRESH"]
    computed = report_coverage(report)
    if any(status not in ("AVAILABLE", "STALE", "UNAVAILABLE", "FAILED", "UNVERIFIED") for status in computed["sections"].values()):
        raise ValueError("Invalid section status")
    declared = report.get("coverage")
    issues["coverage_contract"] = [] if isinstance(declared, dict) and all(declared.get(key) == computed[key]
                                     for key in ("scope", "sections", "missing_sections")) and declared.get("complete") is computed["complete"] else ["COVERAGE_MISMATCH"]
    if report.get("classification") not in (None, "OBSERVED"):
        issues["report_freshness"].append("NON_OBSERVED_REPORT")
    checks = {name: {"status": "PASSED" if not gaps else "FAILED", "issues": sorted(set(gaps))} for name, gaps in issues.items()}
    for name, proof in (("mint", mint_info.get("evidence")), ("largest_token_accounts", holders.get("source")),
                        ("address_activity", activity.get("source"))):
        checks[name]["provider_failures"] = source_failures(proof, config)
    return checks, computed


def verify_http(config, mint=WRAPPED_SOL, wallet=DEFAULT_WALLET):
    config.validate()
    decode_address(mint)
    decode_address(wallet)
    expected = package_identity()
    result = {"verification_type": "RUNNING_SCANNER_HTTP_CHECK", "scope": "SELECTED_CORE_HTTP_AND_DECLARED_SOURCE_RECEIPTS",
              "status": "FAILED", "available_at": now(), "target_host": urlsplit(config.public_url).netloc,
              "transport": "HTTPS" if config.public_url.startswith("https:") else "LOOPBACK_HTTP",
              "expected_release": expected, "mint": mint, "wallet": wallet, "checks": {}, "execution": "DISABLED",
              "public_launch": "UNVERIFIED", "telegram_commands": "UNVERIFIED",
              "note": "One attempt per route, no redirects or signing. The scan can save an observation on the target server. "
                      "Server-declared source receipts are validated, not independently attested. "
                      "This does not verify Telegram, sustained capacity, monitoring, host supervision or public launch."}
    checks, probe = result["checks"], HTTPProbe(config)

    def request(name, path, body=None, authenticated=True, expected_status=200):
        data, proof = probe.request(path, body, authenticated)
        checks[name] = {"status": "PASSED", "http": proof}
        if proof["http_status"] != expected_status or not proof["no_store"]:
            checks[name]["status"] = "FAILED"
            raise ProviderError("HTTP contract failed", code="HTTP_CONTRACT_FAILED", http_status=proof["http_status"],
                                retry_after=proof["retry_after_seconds"])
        return data

    current = "process"
    try:
        if expected["status"] != "AVAILABLE":
            raise ValueError("CLIENT_PACKAGE_UNVERIFIED")
        health = request(current, "/api/health", authenticated=False)
        release = health.get("release")
        if (health.get("status") != "AVAILABLE" or health.get("scope") != "PROCESS_ONLY" or health.get("read_only") is not True
                or health.get("access_required") is not bool(config.api_token) or not fresh(health.get("timestamp"))):
            raise ValueError("HEALTH_CONTRACT_MISMATCH")
        if not isinstance(release, dict) or any(release.get(key) != expected[key] for key in ("version", "scope", "status", "sha256")):
            raise ValueError("RELEASE_MISMATCH")
        checks["release_identity"] = {"status": "PASSED", "scope": expected["scope"], "sha256": expected["sha256"]}
        current = "authentication"
        if config.api_token:
            request(current, "/api/ready", authenticated=False, expected_status=401)
        else:
            checks[current] = {"status": "PASSED", "scope": "CONFIGURED_LOCAL_NO_TOKEN"}
        current = "application"
        ready = request(current, "/api/ready")
        if (ready.get("status") != "AVAILABLE" or ready.get("application_ready") is not True or ready.get("scope") != "LOCAL_APPLICATION"
                or ready.get("execution") != "DISABLED" or ready.get("read_only") is not True
                or not isinstance(ready.get("checks"), dict) or not ready["checks"]
                or any(not isinstance(check, dict) or check.get("status") != "AVAILABLE" for check in ready["checks"].values())):
            raise ValueError("APPLICATION_NOT_READY")
        current = "token_report"
        report = request(current, "/api/scan", {"mint": mint, "refresh": True})
        sections, coverage = scan_checks(report, mint, config)
        checks[current].update(status="PASSED" if all(v["status"] == "PASSED" for v in sections.values()) else "FAILED",
                               sections=sections, coverage=coverage,
                               server_report_available_at=report.get("available_at") if fresh(report.get("available_at")) else None)
        current = "wallet_report"
        report = request(current, "/api/wallet", {"address": wallet})
        if report.get("wallet") != wallet:
            raise ValueError("WALLET_ADDRESS_MISMATCH")
        gaps = metric_issues(report.get("balance_sol"), config, "OBSERVED", "getBalance", True)
        if not fresh(report.get("available_at")):
            gaps.append("WALLET_REPORT_NOT_FRESH")
        checks[current].update(status="PASSED" if not gaps else "FAILED", issues=sorted(set(gaps)),
                               provider_failures=source_failures((report.get("balance_sol") or {}).get("source"), config))
        result["status"] = "PASSED" if all(check["status"] == "PASSED" for check in checks.values()) else "FAILED"
    except (ProviderError, ValueError, TypeError, KeyError, IndexError, AttributeError) as error:
        safe_codes = {"CLIENT_PACKAGE_UNVERIFIED", "HEALTH_CONTRACT_MISMATCH", "RELEASE_MISMATCH", "APPLICATION_NOT_READY",
                      "REPORT_ADDRESS_MISMATCH", "WALLET_ADDRESS_MISMATCH"}
        code = str(error) if isinstance(error, ValueError) and str(error) in safe_codes else "HTTP_SCHEMA_INVALID"
        checks.setdefault(current, {})["status"] = "FAILED"
        checks[current]["error"] = error.details() if isinstance(error, ProviderError) else {"code": code}
    result["completed_at"] = now()
    return result
