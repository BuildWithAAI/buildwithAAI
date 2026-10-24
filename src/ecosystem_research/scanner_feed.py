"""Point-in-time scanner observations, strict provenance projection and durable intake.

Scanner receipts are server declarations. Current facts are not historical risk
labels, executable quotes, model training outcomes or permission to transact.
"""

from __future__ import annotations

from collections import Counter
from contextlib import closing
from datetime import datetime
from decimal import Decimal, InvalidOperation
import re
import sqlite3

from .controller import FileLock, safe_path
from . import network as n
from ..multi_brain_research import training_lab as lab
from ..solana_research import coin_evidence as ev

PROTOCOL = "AAI_SCANNER_OBSERVATION_FEED_V1"
MAX_RAW = 2_000_000
MAX_RECORDS = 120
MAX_DATABASE = 16 * 1024**2
ROUTES = (
    ("health_before", "GET", "/api/health"),
    ("ready", "GET", "/api/ready"),
    ("scan", "POST", "/api/scan"),
    ("health_after", "GET", "/api/health"),
)
CORE = ("mint", "usd_price", "sol_price", "largest_token_accounts", "address_activity")


def address(value):
    lab.require(type(value) is str and 32 <= len(value) <= 44, "FEED_ADDRESS")
    lab.require(len(ev.b58decode(value, 32)) == 32, "FEED_ADDRESS")
    return value


def milliseconds(value):
    lab.require(type(value) is int and 0 <= value < 2**53, "FEED_MILLISECONDS")
    return value


def timestamp(value):
    lab.require(type(value) is str and len(value) <= 40, "FEED_TIMESTAMP")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        lab.require(parsed.tzinfo is not None, "FEED_TIMESTAMP_ZONE")
        return round(parsed.timestamp() * 1000)
    except (ValueError, OverflowError, OSError) as error:
        raise ValueError("FEED_TIMESTAMP") from error


def fresh(value, now, limit):
    try:
        return 0 <= now - timestamp(value) <= limit
    except ValueError:
        return False


def policy(mint, release, origin_sha256, rpc_hosts, authenticated=True):
    address(mint)
    lab.pin(release)
    lab.pin(origin_sha256)
    lab.require(type(authenticated) is bool, "FEED_AUTH_POLICY")
    lab.require(
        type(rpc_hosts) is list
        and 1 <= len(rpc_hosts) <= 3
        and all(
            type(h) is str and re.fullmatch(r"[a-z0-9.-]{1,253}", h) for h in rpc_hosts
        )
        and len(set(rpc_hosts)) == len(rpc_hosts),
        "FEED_RPC_HOSTS",
    )
    return {
        "protocol": PROTOCOL,
        "mint": mint,
        "scanner_release_sha256": release,
        "scanner_origin_sha256": origin_sha256,
        "rpc_hosts": sorted(rpc_hosts),
        "authenticated_scanner": authenticated,
        "max_retrieval_age_ms": 120000,
        "max_genesis_age_ms": 300000,
        "source_attestation": "SCANNER_SERVER_DECLARATIONS_NOT_INDEPENDENT",
        "live_execution_allowed": False,
    }


def source_issues(proof, rules, now, method, *, market=False):
    if type(proof) is list:
        if not market or not 1 <= len(proof) <= 3:
            return ["SOURCE_COLLECTION"]
        return sorted(
            set(
                issue
                for p in proof
                for issue in source_issues(p, rules, now, method, market=market)
            )
        )
    if type(proof) is not dict:
        return ["SOURCE_MISSING"]
    issues = []
    flags = proof.get("quality_flags")
    if (
        proof.get("classification") not in (None, "OBSERVED")
        or type(flags) is not list
        or any(type(flag) is not str or "SYNTHETIC" in flag for flag in flags)
    ):
        issues.append("NON_OBSERVED_SOURCE")
    if proof.get("status") != "AVAILABLE":
        issues.append("SOURCE_UNAVAILABLE")
    hosts = ["api.dexscreener.com"] if market else rules["rpc_hosts"]
    if proof.get("endpoint_host") not in hosts:
        issues.append("SOURCE_HOST")
    if proof.get("method") != method:
        issues.append("SOURCE_METHOD")
    limit = (
        rules["max_genesis_age_ms"]
        if method == "getGenesisHash"
        else rules["max_retrieval_age_ms"]
    )
    if not fresh(proof.get("available_at"), now, limit):
        issues.append("SOURCE_STALE_OR_FUTURE")
    digest = proof.get("raw_sha256")
    if type(digest) is not str or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
        issues.append("SOURCE_HASH")
    if not market:
        if method == "getGenesisHash":
            if proof.get("genesis_hash") != ev.MAINNET_GENESIS:
                issues.append("MAINNET_UNCONFIRMED")
        else:
            if (
                proof.get("commitment") != "finalized"
                or proof.get("commitment_basis") != "REQUESTED"
            ):
                issues.append("FINALITY_UNCONFIRMED")
            if method != "getSignaturesForAddress" and (
                type(proof.get("slot")) is not int or proof["slot"] < 0
            ):
                issues.append("SLOT_UNCONFIRMED")
            issues.extend(
                source_issues(
                    proof.get("network_evidence"), rules, now, "getGenesisHash"
                )
            )
    return sorted(set(issues))


def numeric(value, *, positive=False):
    if type(value) not in (str, int, float) or len(str(value)) > 100:
        return None
    try:
        result = Decimal(str(value))
        if (
            not result.is_finite()
            or result < 0
            or positive
            and result <= 0
            or abs(result.adjusted()) > 100
        ):
            return None
        return format(result, "f")
    except (InvalidOperation, ValueError):
        return None


def metric(item, rules, now, classification, *, positive=False):
    if type(item) is not dict:
        return None, ["METRIC_MISSING"]
    issues = source_issues(
        item.get("source"), rules, now, "token-pairs/v1/solana", market=True
    )
    value = numeric(item.get("value"), positive=positive)
    if item.get("status") != "AVAILABLE" or value is None:
        issues.append("METRIC_UNAVAILABLE")
    if item.get("classification") != classification:
        issues.append("METRIC_CLASSIFICATION")
    return (value if not issues else None), sorted(set(issues))


def project_report(report, rules, now):
    """Project only supported current facts; missing values never become zero."""
    milliseconds(now)
    lab.require(
        type(report) is dict and report.get("mint") == rules["mint"],
        "FEED_REPORT_ADDRESS",
    )
    lab.require(
        all(
            type(report.get(k)) is dict
            for k in ("mint_info", "market", "holders", "activity", "coverage")
        ),
        "FEED_REPORT_SCHEMA",
    )
    mint, market, holders, activity = (
        report[k] for k in ("mint_info", "market", "holders", "activity")
    )
    lab.require(mint.get("mint") == rules["mint"], "FEED_MINT_ADDRESS")
    issues = {
        "network": source_issues(
            report.get("network_evidence"), rules, now, "getGenesisHash"
        )
    }
    if report.get("network") != "solana-mainnet":
        issues["network"].append("NETWORK_MISMATCH")
    issues["report"] = (
        []
        if fresh(report.get("available_at"), now, rules["max_retrieval_age_ms"])
        else ["REPORT_STALE_OR_FUTURE"]
    )
    if report.get("classification") not in (None, "OBSERVED"):
        issues["report"].append("NON_OBSERVED_REPORT")
    issues["mint"] = source_issues(mint.get("evidence"), rules, now, "getAccountInfo")
    if mint.get("status") != "AVAILABLE":
        issues["mint"].append("MINT_UNAVAILABLE")
    usd, issues["usd_price"] = metric(
        market.get("price_usd"), rules, now, "OBSERVED", positive=True
    )
    sol, issues["sol_price"] = metric(
        market.get("price_sol"), rules, now, "DERIVED", positive=True
    )
    liquidity, issues["liquidity"] = metric(
        market.get("liquidity_usd"), rules, now, "OBSERVED"
    )
    volume, issues["volume_24h"] = metric(
        market.get("volume_24h_usd"), rules, now, "OBSERVED"
    )
    issues["largest_token_accounts"] = source_issues(
        holders.get("source"), rules, now, "getTokenLargestAccounts"
    )
    if (
        holders.get("status") != "AVAILABLE"
        or type(holders.get("accounts")) is not list
        or len(holders["accounts"]) > 20
    ):
        issues["largest_token_accounts"].append("ACCOUNTS_UNAVAILABLE")
    issues["address_activity"] = source_issues(
        activity.get("source"), rules, now, "getSignaturesForAddress"
    )
    if (
        activity.get("status") != "AVAILABLE"
        or type(activity.get("records")) is not list
        or len(activity["records"]) > 20
    ):
        issues["address_activity"].append("ACTIVITY_UNAVAILABLE")

    def metric_status(name):
        value = market.get(name)
        return value.get("status") if type(value) is dict else None

    sections = {
        "mint": mint.get("status"),
        "usd_price": metric_status("price_usd"),
        "sol_price": metric_status("price_sol"),
        "largest_token_accounts": holders.get("status"),
        "address_activity": activity.get("status"),
    }
    missing = [key for key, value in sections.items() if value != "AVAILABLE"]
    coverage = report["coverage"]
    issues["coverage"] = (
        []
        if (
            coverage.get("scope") == "SELECTED_CORE_SECTIONS"
            and type(coverage.get("complete")) is bool
            and coverage["complete"] is (not missing)
            and n.same(coverage.get("sections"), sections)
            and coverage.get("missing_sections") == missing
        )
        else ["COVERAGE_MISMATCH"]
    )
    authority, freeze, extensions = None, None, None
    if not issues["mint"]:
        try:
            lab.require(
                type(mint.get("supply_raw")) is str
                and mint["supply_raw"].isdigit()
                and len(mint["supply_raw"]) <= 20
                and int(mint["supply_raw"]) <= 2**64 - 1
                and type(mint.get("decimals")) is int
                and 0 <= mint["decimals"] <= 255,
                "MINT_UNITS",
            )
            lab.require(
                mint.get("token_program_address")
                in (
                    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
                )
                and type(mint.get("evidence")) is dict
                and type(mint.get("slot")) is int
                and mint["slot"] == mint["evidence"].get("slot"),
                "MINT_PROGRAM_OR_SLOT",
            )
            for key in ("mint_authority", "freeze_authority"):
                lab.require(key in mint, "MINT_AUTHORITY_FIELD")
                if mint[key] is not None:
                    address(mint[key])
            values = mint.get("extension_type_ids")
            lab.require(
                type(values) is list
                and len(values) <= 128
                and all(type(v) is int and 0 <= v <= 65535 for v in values),
                "MINT_EXTENSIONS",
            )
            authority, freeze, extensions = (
                mint["mint_authority"] is not None,
                mint["freeze_authority"] is not None,
                bool(values),
            )
        except ValueError:
            issues["mint"].append("MINT_FACT_SCHEMA")
    # An unconfirmed network or report timestamp invalidates every purported current fact.
    if issues["network"] or issues["report"]:
        usd = sol = liquidity = volume = authority = freeze = extensions = None
    result = {
        "status": "CURRENT_CORE_DECLARED"
        if not any(issues.values())
        else "PARTIAL_OR_UNTRUSTED",
        "mint": rules["mint"],
        "as_of_ms": now,
        "retrieved_at": report.get("available_at"),
        "issues": {key: sorted(set(value)) for key, value in issues.items()},
        "facts": {
            "price_usd": usd,
            "price_sol": sol,
            "reported_liquidity_usd": liquidity,
            "reported_volume_24h_usd": volume,
            "mint_authority_active": authority,
            "freeze_authority_active": freeze,
            "extensions_present": extensions,
            "largest_token_accounts": len(holders["accounts"])
            if not (
                issues["largest_token_accounts"]
                or issues["network"]
                or issues["report"]
            )
            else None,
            "address_mentions": len(activity["records"])
            if not (issues["address_activity"] or issues["network"] or issues["report"])
            else None,
        },
        "source_attestation": rules["source_attestation"],
        "upstream_tick_freshness": "UNKNOWN",
        "historical_risk_labels": False,
        "execution_quotes": False,
        "research_signal": "ABSTAIN",
        "action": "NO_EXECUTION",
        "live_execution_allowed": False,
    }
    return result


def response_value(item, method, path, body):
    lab.exact(
        item,
        (
            "method",
            "path",
            "body",
            "status",
            "content_type",
            "no_store",
            "retry_after_seconds",
            "raw_base64",
            "raw_sha256",
            "bytes",
        ),
    )
    lab.require(
        item["method"] == method
        and item["path"] == path
        and n.same(item["body"], body),
        "FEED_HTTP_REQUEST",
    )
    payload = ev.unbase64(item["raw_base64"], MAX_RAW)
    lab.require(
        type(item["bytes"]) is int
        and item["bytes"] == len(payload)
        and item["raw_sha256"] == ev.sha(payload),
        "FEED_HTTP_BYTES",
    )
    lab.require(
        type(item["status"]) is int and 100 <= item["status"] <= 599, "FEED_HTTP_STATUS"
    )
    if item["status"] != 200:
        raise ValueError("FEED_HTTP_" + str(item["status"]))
    lab.require(
        item["content_type"] == "application/json" and item["no_store"] is True,
        "FEED_HTTP_HEADERS",
    )
    return ev.parse(payload)


def health(value, rules, now):
    lab.require(
        type(value) is dict
        and value.get("status") == "AVAILABLE"
        and value.get("scope") == "PROCESS_ONLY"
        and value.get("read_only") is True
        and fresh(value.get("timestamp"), now, 120000)
        and value.get("access_required") is rules["authenticated_scanner"],
        "FEED_HEALTH_SCHEMA",
    )
    release = value.get("release")
    lab.require(
        type(release) is dict
        and release.get("scope") == "SCANNER_PACKAGE_CONTENTS"
        and release.get("status") == "AVAILABLE"
        and release.get("sha256") == rules["scanner_release_sha256"],
        "FEED_RELEASE_MISMATCH",
    )


def ready(value):
    lab.require(
        type(value) is dict
        and value.get("status") == "AVAILABLE"
        and value.get("scope") == "LOCAL_APPLICATION"
        and value.get("application_ready") is True
        and value.get("read_only") is True
        and value.get("execution") == "DISABLED"
        and type(value.get("checks")) is dict
        and value["checks"]
        and all(
            type(v) is dict and v.get("status") == "AVAILABLE"
            for v in value["checks"].values()
        ),
        "FEED_SCANNER_NOT_READY",
    )


def assess(record, rules):
    lab.exact(
        record,
        (
            "protocol",
            "policy_sha256",
            "captured_ms",
            "responses",
            "io_error",
            "live_execution_allowed",
        ),
    )
    lab.require(
        record["protocol"] == PROTOCOL
        and record["policy_sha256"] == lab.digest(rules)
        and record["live_execution_allowed"] is False
        and type(record["responses"]) is dict
        and set(record["responses"]) <= {r[0] for r in ROUTES},
        "FEED_RECORD_SCOPE",
    )
    now = milliseconds(record["captured_ms"])
    report = None
    failed = None
    visited = set()
    for name, method, path in ROUTES:
        visited.add(name)
        try:
            if name not in record["responses"]:
                lab.require(
                    type(record["io_error"]) is dict
                    and record["io_error"].get("stage") == name
                    and record["io_error"].get("code")
                    in ("CONNECTION_FAILED", "DEADLINE", "CREDENTIAL_ECHO"),
                    "FEED_MISSING_RESPONSE",
                )
                failed = record["io_error"]["code"]
                break
            value = response_value(
                record["responses"][name],
                method,
                path,
                {"mint": rules["mint"], "refresh": False} if name == "scan" else None,
            )
            if name.startswith("health"):
                health(value, rules, now)
            elif name == "ready":
                ready(value)
            else:
                project_report(value, rules, now)
                report = value
        except ValueError as error:
            # Only local, bounded codes are projected; untrusted bodies are never error text.
            code = str(error)
            failed = (
                code
                if re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", code)
                else "FEED_SCHEMA_INVALID"
            )
            break
    lab.require(set(record["responses"]) <= visited, "FEED_REQUEST_AFTER_REJECTION")
    if failed:
        return {
            "protocol": PROTOCOL,
            "status": "INTAKE_REJECTED",
            "error": failed,
            "captured_ms": now,
            "report_identity": None,
            "projection": None,
            "live_execution_allowed": False,
        }
    lab.require(record["io_error"] is None, "FEED_SPURIOUS_IO_ERROR")
    projection = project_report(report, rules, now)
    identity = lab.digest({k: v for k, v in report.items() if k != "cached"})
    return {
        "protocol": PROTOCOL,
        "status": projection["status"],
        "error": None,
        "captured_ms": now,
        "report_identity": identity,
        "projection": projection,
        "live_execution_allowed": False,
    }


class ObservationJournal:
    def __init__(self, path, rules):
        self.path = safe_path(path)
        lab.require(
            n.same(
                rules,
                policy(
                    rules["mint"],
                    rules["scanner_release_sha256"],
                    rules["scanner_origin_sha256"],
                    rules["rpc_hosts"],
                    rules["authenticated_scanner"],
                ),
            ),
            "FEED_POLICY_SCOPE",
        )
        self.rules = ev.parse(n.raw(rules))

    def initialize(self):
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with self.path.open("xb"):
            pass
        self.path.chmod(0o600)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.executescript(
                "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; "
                "CREATE TABLE metadata (value TEXT NOT NULL); CREATE TABLE events (sequence INTEGER PRIMARY KEY, body TEXT NOT NULL);"
            )
            db.execute("INSERT INTO metadata VALUES (?)", (lab.digest(self.rules),))
        return self

    def connect(self, readonly=False):
        safe_path(self.path)
        lab.require(
            self.path.is_file()
            and self.path.stat().st_nlink == 1
            and self.path.stat().st_size <= MAX_DATABASE,
            "FEED_DATABASE_FILE",
        )
        db = sqlite3.connect(
            self.path.as_uri() + ("?mode=ro" if readonly else "?mode=rw"),
            uri=True,
            timeout=1,
        )
        db.execute("PRAGMA trusted_schema=OFF")
        if not readonly:
            db.execute("PRAGMA synchronous=FULL")
        return db

    def replay(self, db):
        lab.require(
            db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
            and db.execute("PRAGMA journal_mode").fetchone()[0] == "delete",
            "FEED_DATABASE_INTEGRITY",
        )
        lab.require(
            db.execute("SELECT value FROM metadata").fetchall()
            == [(lab.digest(self.rules),)],
            "FEED_POLICY_BINDING",
        )
        rows = db.execute(
            "SELECT sequence,body FROM events ORDER BY sequence"
        ).fetchall()
        lab.require(len(rows) <= MAX_RECORDS, "FEED_EVENT_BOUND")
        head, last, seen, events = lab.digest(self.rules), 0, set(), []
        for index, raw in rows:
            event = ev.parse(raw.encode())
            lab.exact(
                event,
                (
                    "sequence",
                    "previous_sha256",
                    "record",
                    "assessment",
                    "unique_report",
                    "sha256",
                ),
            )
            lab.require(
                type(index) is int
                and index == len(events)
                and type(event["sequence"]) is int
                and index == event["sequence"]
                and event["previous_sha256"] == head,
                "FEED_CHAIN_ORDER",
            )
            expected = assess(event["record"], self.rules)
            current = event["record"]["captured_ms"]
            identity = expected["report_identity"]
            unique = identity is not None and identity not in seen
            body = {k: v for k, v in event.items() if k != "sha256"}
            lab.require(
                current >= last
                and n.same(event["assessment"], expected)
                and event["unique_report"] is unique
                and event["sha256"] == lab.digest(body),
                "FEED_EVENT_REPLAY",
            )
            if identity:
                seen.add(identity)
            head, last = event["sha256"], current
            events.append(event)
        return {
            "head_sha256": head,
            "events": events,
            "unique_reports": len(seen),
            "last_ms": last,
            "live_execution_allowed": False,
        }

    def snapshot(self, expected_head=None):
        with closing(self.connect(readonly=True)) as db:
            db.execute("BEGIN")
            state = self.replay(db)
            if expected_head is not None:
                lab.require(state["head_sha256"] == expected_head, "FEED_EXPECTED_HEAD")
            return state

    def append(self, record, expected_head):
        lock = FileLock(str(self.path) + ".lock").acquire()
        try:
            with closing(self.connect()) as db:
                db.execute("BEGIN IMMEDIATE")
                state = self.replay(db)
                lab.require(
                    expected_head == state["head_sha256"], "FEED_COMPARE_AND_SWAP"
                )
                # A process may retry a completed delivery after losing its acknowledgement.
                for old in state["events"]:
                    if n.same(old["record"], record):
                        return {
                            "event": old,
                            "replayed": True,
                            "head_sha256": state["head_sha256"],
                        }
                lab.require(len(state["events"]) < MAX_RECORDS, "FEED_EVENT_BOUND")
                value = assess(record, self.rules)
                lab.require(
                    record["captured_ms"] >= state["last_ms"], "FEED_CLOCK_REWIND"
                )
                identity = value["report_identity"]
                unique = identity is not None and identity not in {
                    e["assessment"]["report_identity"] for e in state["events"]
                }
                body = {
                    "sequence": len(state["events"]),
                    "previous_sha256": expected_head,
                    "record": record,
                    "assessment": value,
                    "unique_report": unique,
                }
                event = {**body, "sha256": lab.digest(body)}
                db.execute(
                    "INSERT INTO events VALUES (?,?)",
                    (event["sequence"], ev.canonical(event)),
                )
                lab.require(
                    db.execute("PRAGMA page_count").fetchone()[0]
                    * db.execute("PRAGMA page_size").fetchone()[0]
                    <= MAX_DATABASE,
                    "FEED_DATABASE_BOUND",
                )
                lock.check()
                db.commit()
                return {
                    "event": event,
                    "replayed": False,
                    "head_sha256": event["sha256"],
                }
        finally:
            lock.close()

    def status(self, now):
        milliseconds(now)
        state = self.snapshot()
        latest = state["events"][-1] if state["events"] else None
        value = None if latest is None else latest["assessment"]
        age = None if latest is None else now - latest["record"]["captured_ms"]
        current = latest is not None and 0 <= age <= self.rules["max_retrieval_age_ms"]
        report_fresh = (
            value is not None
            and value["projection"] is not None
            and fresh(
                value["projection"]["retrieved_at"],
                now,
                self.rules["max_retrieval_age_ms"],
            )
        )
        projection = None
        if (
            value is not None
            and value["projection"] is not None
            and current
            and report_fresh
        ):
            record = latest["record"]["responses"]["scan"]
            report = response_value(
                record,
                "POST",
                "/api/scan",
                {"mint": self.rules["mint"], "refresh": False},
            )
            projection = project_report(report, self.rules, now)
        return {
            "protocol": PROTOCOL,
            "head_sha256": state["head_sha256"],
            "attempts": len(state["events"]),
            "unique_reports": state["unique_reports"],
            "statuses": dict(
                Counter(e["assessment"]["status"] for e in state["events"])
            ),
            "latest_capture_age_ms": age,
            "current_retrieval": current and report_fresh,
            "current_core_declared": projection is not None
            and projection["status"] == "CURRENT_CORE_DECLARED",
            "latest_status": None if value is None else value["status"],
            "source_attestation": self.rules["source_attestation"],
            "research_signal": "ABSTAIN",
            "action": "NO_EXECUTION",
            "live_execution_allowed": False,
        }


def agent_report(journal, bundle, trusted_controller, expected_head, as_of_ms):
    """Bind current observations to known models without inventing a feature adapter."""
    n.validate_bundle(bundle, trusted_controller)
    state = journal.snapshot(expected_head)
    status = journal.status(as_of_ms)
    lab.require(status["head_sha256"] == expected_head, "FEED_AGENT_SNAPSHOT_MOVED")
    last = state["events"][-1] if state["events"] else None
    return {
        "protocol": "AAI_SCANNER_AGENT_REPORT_V1",
        "feed_head_sha256": expected_head,
        "feed_policy_sha256": lab.digest(journal.rules),
        "evaluated_as_of_ms": milliseconds(as_of_ms),
        "mint": journal.rules["mint"],
        "intake_status": status,
        "last_observation": None if last is None else last["assessment"],
        "controller_manifest_sha256": trusted_controller,
        "model_bundle_sha256": ev.sha(n.raw(bundle)),
        "available_advisory_models": bundle["controller_public"]["active_models"],
        "model_input_contract": "BLOCKED_NO_QUALIFIED_SCANNER_TO_SYNTHETIC_MODEL_ADAPTER",
        "model_inference_performed": False,
        "training_performed": False,
        "current_facts_are_historical_training_labels": False,
        "research_signal": "ABSTAIN",
        "action": "NO_EXECUTION",
        "live_execution_allowed": False,
    }
