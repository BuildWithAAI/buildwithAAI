"""WSGI API and static application. Bind locally unless remote mode is configured."""
import hmac
import json
import logging
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from .config import Config
from .evidence import now
from .operations import readiness
from .service import BusyError, Limiter, Scanner
from .storage import Store
from .transport import ProviderError, reject_constant

STATIC = Path(__file__).parent / "static"
LOG = logging.getLogger("aai_scanner")


class AccessPolicy:
    """Replaceable product-access boundary; no AAI payment operations."""
    def __init__(self, token):
        self.token = token

    def allows(self, environ):
        if not self.token:
            return True
        supplied = environ.get("HTTP_AUTHORIZATION", "")
        expected = "Bearer " + self.token
        return hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))


class Application:
    def __init__(self, config=None, store=None, scanner=None, access=None):
        self.config = (config or Config.from_env()).validate()
        self.store = store or Store(self.config.database)
        self.scanner = scanner or Scanner(self.config, self.store)
        self.access = access or AccessPolicy(self.config.api_token)
        self.limiter = Limiter()
        self.started_at = now()
        origin = urlsplit(self.config.public_url)
        self.hosts = {origin.netloc}
        self.origins = {self.config.public_url.rstrip("/")}
        if not self.config.public_mode:
            port = origin.port or self.config.port
            self.hosts.update({f"127.0.0.1:{port}", f"localhost:{port}"})
            self.origins.update({f"http://127.0.0.1:{port}", f"http://localhost:{port}"})

    def _body(self, environ):
        if environ.get("CONTENT_TYPE", "").split(";")[0].lower() != "application/json":
            raise ValueError("Request body must be application/json")
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
        except ValueError:
            raise ValueError("Invalid request length") from None
        if not 0 < length <= 4096:
            raise ValueError("Request body limit is 4096 bytes")
        raw = environ["wsgi.input"].read(length)
        if len(raw) != length:
            raise ValueError("Incomplete request body")
        try:
            data = json.loads(raw, parse_constant=reject_constant)
        except (ValueError, UnicodeError, RecursionError):
            raise ValueError("Invalid JSON body") from None
        if not isinstance(data, dict):
            raise ValueError("Request body must be a JSON object")
        return data

    def __call__(self, environ, start_response):
        code, result, kind = 200, {}, "application/json; charset=utf-8"
        path = environ.get("PATH_INFO", "/")
        method = environ.get("REQUEST_METHOD", "GET")
        query = environ.get("QUERY_STRING", "")
        peer = environ.get("REMOTE_ADDR", "unknown")
        try:
            if environ.get("HTTP_HOST", "") not in self.hosts:
                code, result = 403, {"error": "Host is not permitted"}
            elif len(query) > 512 or len(path) > 200:
                code, result = 400, {"error": "Request URL is too long"}
            elif path in ("/", "/report", "/app.js", "/app.css") and method == "GET":
                filename = {"/": "index.html", "/report": "index.html", "/app.js": "app.js", "/app.css": "app.css"}[path]
                kind = {"index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8",
                        "app.css": "text/css; charset=utf-8"}[filename]
                result = (STATIC / filename).read_bytes()
            elif path == "/api/health" and method == "GET":
                result = {"status": "AVAILABLE", "scope": "PROCESS_ONLY", "timestamp": now(),
                          "read_only": True, "access_required": bool(self.config.api_token)}
            elif not path.startswith("/api/"):
                code, result = 404, {"error": "Route not found"}
            elif not self.access.allows(environ):
                code, result = 401, {"error": "Access token required"}
            elif (environ.get("HTTP_ORIGIN") and environ["HTTP_ORIGIN"] not in self.origins) or environ.get("HTTP_SEC_FETCH_SITE") == "cross-site":
                code, result = 403, {"error": "Cross-origin requests are not permitted"}
            elif not self.limiter.allow("global", 120) or not self.limiter.allow(peer, 60):
                code, result = 429, {"error": "Request rate limit reached"}
            elif path == "/api/ready" and method == "GET":
                result = readiness(self.config, self.store, self.scanner.last_coverage)
                code = 200 if result["application_ready"] else 503
            elif path == "/api/status" and method == "GET":
                result = {
                    "status": "AVAILABLE", "scope": "PROCESS_ONLY", "started_at": self.started_at,
                    "timestamp": now(), "read_only": True, "storage": self.store.counts(),
                    "provider_sources": self.scanner.last_sources,
                    "provider_status_note": "Last observed results, not continuous health checks",
                    "rpc_providers": self.scanner.rpc.diagnostics() if hasattr(self.scanner.rpc, "diagnostics") else [],
                    "last_report_coverage": self.scanner.last_coverage,
                    "readiness": readiness(self.config, self.store, self.scanner.last_coverage),
                    "refresh": {"normal_cache_seconds": 30, "minimum_refresh_seconds": 5},
                    "execution": "DISABLED", "payments": "NOT_IMPLEMENTED",
                }
            elif path == "/api/watchlist" and method == "GET":
                result = {"watches": self.store.watches()}
            elif path == "/api/watchlist" and method in ("POST", "DELETE"):
                body = self._body(environ)
                if method == "POST":
                    self.store.add_watch(body.get("mint"))
                else:
                    self.store.delete_watch(body.get("mint"))
                result = {"watches": self.store.watches()}
            elif path == "/api/history" and method == "GET":
                args = parse_qs(query, max_num_fields=3)
                result = {"observations": self.store.history(args.get("mint", [None])[0]),
                          "coverage": "Locally collected observations; not exchange candles"}
            elif path in ("/api/scan", "/api/wallet") and method == "POST":
                if not self.limiter.allow(peer + ":provider", 12):
                    code, result = 429, {"error": "Scan rate limit reached"}
                else:
                    body = self._body(environ)
                    if path == "/api/scan":
                        refresh = body.get("refresh", False)
                        if type(refresh) is not bool:
                            raise ValueError("Refresh must be a boolean")
                        result = self.scanner.scan(body.get("mint"), refresh=refresh)
                    else:
                        result = self.scanner.wallet(body.get("address"))
            elif path in ("/api/scan", "/api/wallet", "/api/status", "/api/ready", "/api/watchlist", "/api/history"):
                code, result = 405, {"error": "Method not allowed"}
            else:
                code, result = 404, {"error": "Route not found"}
        except BusyError:
            code, result = 429, {"error": "Scanner busy or at capacity; retry shortly"}
        except ValueError as error:
            code, result = 400, {"error": str(error)}
        except ProviderError:
            code, result = 502, {"error": "Provider data could not be verified"}
        except Exception as error:
            # Only a type name is logged: provider exception messages can contain credentials.
            LOG.error("Request failed: %s", type(error).__name__)
            code, result = 500, {"error": "Internal service error"}
        payload = result if isinstance(result, bytes) else json.dumps(result, allow_nan=False).encode()
        headers = [
            ("Content-Type", kind), ("Content-Length", str(len(payload))),
            ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff"),
            ("X-Frame-Options", "DENY"), ("Referrer-Policy", "no-referrer"),
            ("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; "
             "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"),
        ]
        if code == 429:
            headers.append(("Retry-After", "5"))
        start_response(f"{code} {HTTPStatus(code).phrase}", headers)
        return [payload]


def create_app():
    return Application()
