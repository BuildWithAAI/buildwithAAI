"""Bounded, no-proxy scanner HTTP intake; credentials follow a checked release probe."""

from __future__ import annotations

import base64
import http.client
import re
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit

from . import scanner_feed as f
from .controller import safe_path
from ..multi_brain_research import training_lab as lab
from ..solana_research import coin_evidence as ev


def token_file(filename):
    path = safe_path(filename)
    lab.require(
        path.is_file() and path.stat().st_nlink == 1 and path.stat().st_size <= 256,
        "FEED_TOKEN_FILE",
    )
    import os

    lab.require(
        os.name == "nt" or path.stat().st_mode & 0o077 == 0, "FEED_TOKEN_PERMISSIONS"
    )
    value = ev.read(path)
    lab.exact(value, ("token",))
    token = value["token"]
    lab.require(
        type(token) is str and re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token),
        "FEED_TOKEN",
    )
    return token


class ScannerClient:
    def __init__(
        self, *, origin, release_sha256, mint, rpc_hosts, token=None, ca_file=None
    ):
        lab.require(
            type(origin) is str
            and origin.isascii()
            and len(origin) <= 255
            and not any(ord(c) <= 32 or ord(c) == 127 for c in origin),
            "FEED_ORIGIN",
        )
        try:
            target = urlsplit(origin)
            port = target.port
        except ValueError as error:
            raise ValueError("FEED_ORIGIN") from error
        lab.require(
            target.path == target.query == target.fragment == ""
            and target.username is None
            and target.password is None
            and target.hostname
            and not target.hostname.endswith("."),
            "FEED_ORIGIN",
        )
        local = target.scheme == "http" and target.hostname == "127.0.0.1"
        lab.require(
            local
            or target.scheme == "https"
            and re.fullmatch(r"[a-z0-9.-]{1,253}", target.hostname),
            "FEED_TLS_REQUIRED",
        )
        self.port = port if port is not None else (80 if local else 443)
        lab.require(
            type(self.port) is int
            and 1 <= self.port <= 65535
            and origin == target.scheme + "://" + target.netloc,
            "FEED_ORIGIN",
        )
        lab.require(
            token is None
            or type(token) is str
            and re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token),
            "FEED_TOKEN",
        )
        lab.require(local or token is not None, "FEED_REMOTE_AUTH_REQUIRED")
        self.origin, self.host, self.token, self.local = (
            origin,
            target.hostname,
            token,
            local,
        )
        self.context = None
        if not local:
            path = safe_path(ca_file) if ca_file is not None else None
            if path is not None:
                lab.require(
                    path.is_file() and 0 < path.stat().st_size <= 65536, "FEED_CA_FILE"
                )
            self.context = ssl.create_default_context(
                cafile=str(path) if path is not None else None
            )
        else:
            lab.require(ca_file is None, "FEED_CA_REQUIRES_TLS")
        self.rules = f.policy(
            mint, release_sha256, lab.digest(origin), rpc_hosts, token is not None
        )

    @staticmethod
    def abort(channel):
        try:
            channel.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def request(self, method, path, body, deadline, *, authenticated):
        lab.require(
            (method, path) in {(m, p) for _, m, p in f.ROUTES}, "FEED_ROUTE_NOT_ALLOWED"
        )
        lab.require(
            body
            == (
                {"mint": self.rules["mint"], "refresh": False}
                if path == "/api/scan"
                else None
            )
            and authenticated is (path != "/api/health"),
            "FEED_REQUEST_SCOPE",
        )
        remaining = min(20, deadline - time.monotonic())
        if remaining <= 0:
            raise TimeoutError("DEADLINE")
        connection = (
            http.client.HTTPConnection(self.host, self.port, timeout=remaining)
            if self.local
            else http.client.HTTPSConnection(
                self.host, self.port, timeout=remaining, context=self.context
            )
        )
        timer = response = None
        try:
            connection.connect()
            remaining = min(20, deadline - time.monotonic())
            if remaining <= 0:
                raise TimeoutError("DEADLINE")
            timer = threading.Timer(remaining, self.abort, args=(connection.sock,))
            timer.daemon = True
            timer.start()
            headers = {
                "Accept": "application/json",
                "Host": urlsplit(self.origin).netloc,
            }
            if authenticated and self.token is not None:
                headers["Authorization"] = "Bearer " + self.token
            payload = None
            if body is not None:
                payload = ev.canonical(body).encode()
                headers["Content-Type"] = "application/json"
            connection.request(method, path, payload, headers)
            response = connection.getresponse()
            data = response.read(f.MAX_RAW + 1)
            lab.require(len(data) <= f.MAX_RAW, "FEED_RESPONSE_BOUND")
            # Never retain a compromised server's credential echo in an evidence file.
            if self.token is not None and self.token.encode() in data:
                raise PermissionError("CREDENTIAL_ECHO")
            delay = response.getheader("Retry-After", "")
            retry = min(int(delay), 300) if re.fullmatch(r"[0-9]{1,6}", delay) else None
            return {
                "method": method,
                "path": path,
                "body": body,
                "status": response.status,
                # Retain a category, never arbitrary server header text. An invalid
                # header can otherwise copy a reflected credential into evidence.
                "content_type": "application/json"
                if response.getheader("Content-Type", "").split(";")[0].strip().lower()
                == "application/json"
                else "UNSUPPORTED",
                "no_store": "no-store"
                in [
                    v.strip().lower()
                    for v in response.getheader("Cache-Control", "").split(",")
                ],
                "retry_after_seconds": retry,
                "raw_base64": base64.b64encode(data).decode(),
                "raw_sha256": ev.sha(data),
                "bytes": len(data),
            }
        finally:
            if timer is not None:
                timer.cancel()
                timer.join()
            if response is not None:
                response.close()
            connection.close()

    def capture(self):
        record = {
            "protocol": f.PROTOCOL,
            "policy_sha256": lab.digest(self.rules),
            "captured_ms": 0,
            "responses": {},
            "io_error": None,
            "live_execution_allowed": False,
        }
        deadline = time.monotonic() + 60
        for name, method, path in f.ROUTES:
            try:
                body = (
                    {"mint": self.rules["mint"], "refresh": False}
                    if name == "scan"
                    else None
                )
                item = self.request(
                    method,
                    path,
                    body,
                    deadline,
                    authenticated=not name.startswith("health"),
                )
                record["responses"][name] = item
                value = f.response_value(item, method, path, body)
                if name.startswith("health"):
                    f.health(value, self.rules, time.time_ns() // 1000000)
                elif name == "ready":
                    f.ready(value)
                else:
                    f.project_report(value, self.rules, time.time_ns() // 1000000)
            except PermissionError:
                record["io_error"] = {"stage": name, "code": "CREDENTIAL_ECHO"}
                break
            except (OSError, http.client.HTTPException):
                record["io_error"] = {"stage": name, "code": "CONNECTION_FAILED"}
                break
            except ValueError:
                # The retained response explains the local schema/release failure.
                break
        record["captured_ms"] = time.time_ns() // 1000000
        # Structural input errors never become fabricated partial observations.
        f.assess(record, self.rules)
        return record
