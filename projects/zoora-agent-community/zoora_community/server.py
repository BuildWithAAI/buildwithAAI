"""Loopback-only development transport, deliberately unsuitable for public deployment."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
from urllib.parse import parse_qsl, urlsplit

from .store import Store
from .validation import MAX_BODY, Problem, canonical, parse_json

WEB = Path(__file__).resolve().parent.parent / "web"
ASSETS = {"/": ("index.html", "text/html; charset=utf-8"),
          "/app.js": ("app.js", "text/javascript; charset=utf-8"),
          "/style.css": ("style.css", "text/css; charset=utf-8")}
CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = True
    request_queue_size = 16
    allow_reuse_address = False

    def __init__(self, store, port=8765):
        self.store = store
        self.workers = threading.BoundedSemaphore(16)
        super().__init__(("127.0.0.1", port), Handler)
        self.origin = "http://127.0.0.1:" + str(self.server_port)
        self.host = "127.0.0.1:" + str(self.server_port)

    def get_request(self):
        request, address = super().get_request()
        request.settimeout(5)
        return request, address

    def process_request(self, request, client_address):
        if not self.workers.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.workers.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.workers.release()

    def handle_error(self, request, client_address):
        # Request data and bearer values must never be included in stderr logs.
        pass


class Handler(BaseHTTPRequestHandler):
    server_version = "ZooraLocal/0.1"
    sys_version = ""
    protocol_version = "HTTP/1.0"

    def log_message(self, format, *args):
        pass

    def send_error(self, code, message=None, explain=None):
        # Base parser errors must also avoid echoing attacker input or HTML.
        self._reply(code, {"error": "INVALID_HTTP_REQUEST"})

    def _reply(self, status, result, content_type="application/json; charset=utf-8"):
        payload = result if type(result) is bytes else (canonical(result) + "\n").encode("utf-8")
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Connection", "close")
        if status == 401:
            self.send_header("WWW-Authenticate", "Bearer")
        if status == 429:
            self.send_header("Retry-After", "60")
        self.end_headers()
        self.wfile.write(payload)

    def _request(self):
        try:
            self._dispatch()
        except Problem as problem:
            self._reply(problem.status, {"error": problem.code})
        except TimeoutError:
            self._reply(408, {"error": "REQUEST_TIMEOUT"})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._reply(503, {"error": "SERVICE_UNAVAILABLE"})

    def _dispatch(self):
        if len(self.path) > 512 or not self.path.startswith("/") or self.path.startswith("//"):
            raise Problem(400, "INVALID_ROUTE")
        if sum(len(k) + len(v) for k, v in self.headers.items()) > 8192:
            raise Problem(431, "HEADERS_TOO_LARGE")
        if self.headers.get_all("Host", []) != [self.server.host]:
            raise Problem(403, "INVALID_HOST")
        origins = self.headers.get_all("Origin", [])
        if origins and origins != [self.server.origin]:
            raise Problem(403, "ORIGIN_REJECTED")
        if self.headers.get("Sec-Fetch-Site") not in (None, "same-origin", "none"):
            raise Problem(403, "ORIGIN_REJECTED")
        if self.headers.get_all("Transfer-Encoding") or self.headers.get_all("Expect"):
            raise Problem(400, "UNSUPPORTED_HTTP_FRAMING")
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) > 1:
            raise Problem(400, "UNSUPPORTED_HTTP_FRAMING")
        authorization = self.headers.get_all("Authorization", [])
        if len(authorization) > 1:
            raise Problem(400, "INVALID_AUTH_HEADER")
        token = None
        if authorization:
            if not authorization[0].startswith("Bearer "):
                raise Problem(401, "UNAUTHORIZED")
            token = authorization[0][7:]
        parsed = urlsplit(self.path)
        if parsed.scheme or parsed.netloc or parsed.fragment or "%" in parsed.path:
            raise Problem(400, "INVALID_ROUTE")
        try:
            arguments = parse_qsl(parsed.query, strict_parsing=True, max_num_fields=2)
        except ValueError:
            raise Problem(400, "INVALID_PAGINATION") from None
        if len(dict(arguments)) != len(arguments) or any(key not in ("limit", "after") for key, _ in arguments):
            raise Problem(400, "INVALID_PAGINATION")
        args = dict(arguments)
        try:
            limit = int(args.get("limit", "50"))
        except ValueError:
            raise Problem(400, "INVALID_PAGINATION") from None
        body = {}
        if self.command in {"POST", "PATCH"}:
            if parsed.query:
                raise Problem(400, "INVALID_ROUTE")
            if not lengths:
                raise Problem(411, "LENGTH_REQUIRED")
            if not lengths[0].isascii() or not lengths[0].isdigit():
                raise Problem(400, "UNSUPPORTED_HTTP_FRAMING")
            length = int(lengths[0])
            if length > MAX_BODY:
                raise Problem(413, "BODY_TOO_LARGE")
            if self.headers.get_all("Content-Type", []) != ["application/json"] or self.headers.get_all("Content-Encoding"):
                raise Problem(415, "JSON_REQUIRED")
            data = self.rfile.read(length)
            if len(data) != length:
                raise Problem(400, "INCOMPLETE_BODY")
            body = parse_json(data)
        elif lengths and lengths != ["0"]:
            raise Problem(400, "UNEXPECTED_BODY")
        if self.command == "GET" and parsed.path in ASSETS:
            if parsed.query:
                raise Problem(400, "INVALID_ROUTE")
            filename, mime = ASSETS[parsed.path]
            self._reply(200, (WEB / filename).read_bytes(), mime)
            return
        status, result = self.server.store.call(self.command, parsed.path, body, token,
                                                limit=limit, after=args.get("after", ""))
        self._reply(status, result)

    do_GET = _request
    do_POST = _request
    do_PATCH = _request
    do_PUT = _request
    do_DELETE = _request
    do_OPTIONS = _request
    do_HEAD = _request


def serve(state, port=8765, enable_solana=False):
    from .solana_rpc import SolanaRPC
    store = Store(state, rpc=SolanaRPC() if enable_solana else None)
    store.audit()
    with LocalServer(store, port) as server:
        print(canonical({"mode": "LOCAL_ONLY", "url": server.origin}), flush=True)
        try:
            server.serve_forever(poll_interval=0.2)
        except KeyboardInterrupt:
            pass
