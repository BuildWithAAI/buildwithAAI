"""Pinned Waitress transport, explicitly loopback and independent of wallet execution."""

from email.message import Message
from http import HTTPStatus
from importlib.metadata import version
import os
import signal
import threading

from waitress import create_server, wasyncore
from waitress.channel import HTTPChannel
from waitress.parser import HTTPRequestParser, ParsingError

from .http_app import dispatch, response
from .operations import Runtime
from .solana_rpc import SolanaRPC
from .store import Store
from .validation import MAX_BODY, Problem, canonical
from .wallet_login import public_origin


class StrictParser(HTTPRequestParser):
    def parse_header(self, header_plus):
        # Use the pinned vendor parser, then disallow transports the API doesn't
        # need. No custom request-line/header/body parsing is introduced here.
        super().parse_header(header_plus)
        if self.chunked or "EXPECT" in self.headers:
            self.expect_continue = False
            raise ParsingError("Unsupported request framing")


class StrictChannel(HTTPChannel):
    parser_class = StrictParser


class Application:
    def __init__(self, store):
        self.store = store
        self.runtime = Runtime(store, "WAITRESS_3_0_2")
        self.host = self.origin = None

    def __call__(self, environ, start_response):
        started = self.runtime.begin()
        status = 503
        try:
            headers = Message()
            for key, value in environ.items():
                if key.startswith("HTTP_"):
                    headers[key[5:].replace("_", "-")] = value
            for key in ("CONTENT_TYPE", "CONTENT_LENGTH"):
                if key in environ:
                    headers[key.replace("_", "-")] = environ[key]
            # REQUEST_URI retains percent encoding and multiple leading slashes.
            status, result, mime = dispatch(self.store, self.runtime, self.host, self.origin,
                environ["REQUEST_METHOD"], environ["REQUEST_URI"], headers,
                environ["wsgi.input"].read, self.runtime.assets)
            payload, reply_headers = response(status, result, mime)
        except Problem as problem:
            status = problem.status
            payload, reply_headers = response(status, {"error": problem.code})
        except Exception:
            status = 503
            payload, reply_headers = response(status, {"error": "SERVICE_UNAVAILABLE"})
        finally:
            self.runtime.finish(started, status)
        start_response(str(status) + " " + HTTPStatus(status).phrase, reply_headers)
        return [payload]


class WSGIServer:
    def __init__(self, store, port=8765):
        if version("waitress") != "3.0.2":
            raise Problem(503, "UNSUPPORTED_WAITRESS_VERSION")
        self.application = Application(store)
        self.stopping = threading.Event()
        self.loop_finished = threading.Event()
        self.running = False
        self.channels = {}
        self.server = create_server(self.application, map=self.channels,
            host="127.0.0.1", port=port, ipv4=True, ipv6=False, threads=8,
            connection_limit=32, backlog=16, max_request_header_size=8192,
            # Waitress rejects at >= its byte limit; shared dispatch enforces
            # the API's inclusive 16 KiB bound after vendor parsing.
            max_request_body_size=MAX_BODY + 1, inbuf_overflow=MAX_BODY + 1,
            outbuf_overflow=1_048_577, outbuf_high_watermark=1_048_577,
            channel_timeout=5, cleanup_interval=1, asyncore_loop_timeout=0.1,
            channel_request_lookahead=0, clear_untrusted_proxy_headers=True,
            expose_tracebacks=False, log_socket_errors=False, ident="ZooraCommunity")
        self.server.channel_class = StrictChannel
        self.server_port = int(self.server.effective_port)
        self.server_address = ("127.0.0.1", self.server_port)
        configured_origin = os.environ.get("ZOORA_PUBLIC_ORIGIN")
        if configured_origin:
            self.origin = public_origin(configured_origin)
            self.host = self.origin.removeprefix("https://")
            self.store.public_origin = self.origin
        else:
            self.host = "127.0.0.1:" + str(self.server_port)
            self.origin = "http://" + self.host
        self.host = self.application.host = self.host
        self.origin = self.application.origin = self.origin

    def serve_forever(self):
        self.running = True
        try:
            while not self.stopping.is_set() and self.channels:
                wasyncore.loop(timeout=0.1, map=self.channels, count=1)
        finally:
            self.loop_finished.set()

    def shutdown(self):
        # End the event loop before closing descriptors; keep its wakeup trigger
        # alive until workers finish so completion cannot write a closed pipe.
        self.stopping.set()
        self.server.pull_trigger()
        if self.running:
            self.loop_finished.wait(timeout=2)
        self.server.task_dispatcher.shutdown(timeout=8)
        self.server.close()
        wasyncore.close_all(map=self.channels, ignore_all=True)


def serve_wsgi(state, port=8765, enable_solana=False):
    store = Store(state, rpc=SolanaRPC() if enable_solana else None)
    store.audit()
    server = WSGIServer(store, port)
    previous = signal.getsignal(signal.SIGTERM)

    def terminate(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, terminate)
    try:
        print(canonical({"mode": "PUBLIC_BEHIND_TRUSTED_TLS_PROXY" if store.public_origin else "LOCAL_ONLY", "url": server.origin,
                         "transport": "WAITRESS_3_0_2",
                         "package_digest": server.application.runtime.package_digest}), flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        signal.signal(signal.SIGTERM, previous)
        server.shutdown()
