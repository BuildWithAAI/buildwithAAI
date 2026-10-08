"""Local application checks and last-report freshness, without external requests."""
import sqlite3
import sys
from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path
from urllib.parse import urlsplit
from .evidence import now

STATIC = Path(__file__).parent / "static"
DATA_MAX_AGE = 120


def application_checks(config, store, integrity=False):
    checks = {}
    try:
        config.validate()
        checks["configuration"] = {"status": "AVAILABLE"}
    except (ValueError, TypeError):
        checks["configuration"] = {"status": "FAILED", "code": "INVALID_CONFIGURATION"}
    supported = (3, 11) <= sys.version_info[:2] <= (3, 12)
    checks["python"] = {"status": "AVAILABLE" if supported else "FAILED", "supported": "3.11–3.12"}
    try:
        pinned = metadata.version("waitress") == "3.0.2"
    except metadata.PackageNotFoundError:
        pinned = False
    checks["server_dependency"] = {"status": "AVAILABLE" if pinned else "FAILED", "required": "waitress==3.0.2"}
    try:
        assets = all((STATIC / name).read_bytes() for name in ("index.html", "app.js", "app.css"))
        checks["interface_assets"] = {"status": "AVAILABLE" if assets else "FAILED"}
    except OSError:
        checks["interface_assets"] = {"status": "FAILED", "code": "ASSETS_UNREADABLE"}
    try:
        checks["storage"] = store.probe(integrity=integrity)
    except (sqlite3.Error, OSError, ValueError):
        checks["storage"] = {"status": "FAILED", "code": "STORAGE_CHECK_FAILED"}
    return checks


def data_readiness(coverage, current=None):
    result = {"status": "UNVERIFIED", "scope": "LAST_REPORT_CORE_SECTIONS", "max_age_seconds": DATA_MAX_AGE,
              "available_at": None, "age_seconds": None, "complete": False, "missing_sections": []}
    if not coverage:
        return result
    result.update(available_at=coverage.get("available_at"), complete=coverage.get("complete") is True,
                  missing_sections=coverage.get("missing_sections", []))
    try:
        collected = datetime.fromisoformat(result["available_at"])
        if collected.tzinfo is None:
            return result
        age = ((current or datetime.now(timezone.utc)) - collected).total_seconds()
        if age < 0:
            return result
    except (ValueError, TypeError):
        return result
    result["age_seconds"] = round(age, 3)
    result["status"] = "STALE" if age > DATA_MAX_AGE else "AVAILABLE" if result["complete"] else "UNAVAILABLE"
    return result


def readiness(config, store, coverage=None, integrity=False, deployment=False):
    checks = application_checks(config, store, integrity)
    if deployment:
        origin = urlsplit(config.public_url)
        prepared = (config.public_mode and config.host == "127.0.0.1" and config.port == 8787
                    and origin.scheme == "https" and origin.hostname not in ("localhost", "127.0.0.1", "::1")
                    and bool(config.api_token) and Path(config.database).is_absolute())
        checks["deployment_configuration"] = {"status": "AVAILABLE" if prepared else "FAILED",
                                               "code": "LOOPBACK_HTTPS_AUTH_PERSISTENCE"}
    passed = all(item["status"] == "AVAILABLE" for item in checks.values())
    return {"status": "AVAILABLE" if passed else "FAILED", "scope": "LOCAL_APPLICATION", "timestamp": now(),
            "application_ready": passed, "checks": checks, "data": data_readiness(coverage),
            "read_only": True, "execution": "DISABLED", "public_launch": "UNVERIFIED",
            "note": "Application readiness is local configuration, runtime, assets and SQLite access. "
                    "Data is last-report coverage with retrieval freshness, not an upstream health probe. "
                    "TLS, provider capacity, Telegram, monitoring and public launch require separate verification."}
