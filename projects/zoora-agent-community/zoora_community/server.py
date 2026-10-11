"""Loopback-only development transport, deliberately unsuitable for public deployment."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

from .store import Store
from .validation import Problem, canonical

from .http_app import dispatch, response
from .operations import Runtime


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = True
    request_queue_size = 16
    allow_reuse_address = False

    def __init__(self, store, port=8765):
        self.store = store
        self.runtime = Runtime(store, "DEVELOPMENT_HTTP")
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
        payload, headers = response(status, result, content_type)
        self.close_connection = True
        self.send_response(status)
        for key, value in headers:
            self.send_header(key, value)
        self.send_header("Connection", "close")
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
        status, result, mime = dispatch(self.server.store, self.server.runtime,
            self.server.host, self.server.origin, self.command, self.path,
            self.headers, self.rfile.read, self.server.runtime.assets)
        self._reply(status, result, mime)

    do_GET = _request
    do_POST = _request
    do_PATCH = _request
    do_PUT = _request
    do_DELETE = _request
    do_OPTIONS = _request
    do_HEAD = _request


def serve(state, port=8765, enable_solana=False, transport="waitress"):
    if transport == "waitress":
        from .wsgi_server import serve_wsgi
        return serve_wsgi(state, port, enable_solana)
    from .solana_rpc import SolanaRPC
    store = Store(state, rpc=SolanaRPC() if enable_solana else None)
    store.audit()
    with LocalServer(store, port) as server:
        print(canonical({"mode": "LOCAL_ONLY", "url": server.origin}), flush=True)
        try:
            server.serve_forever(poll_interval=0.2)
        except KeyboardInterrupt:
            pass
