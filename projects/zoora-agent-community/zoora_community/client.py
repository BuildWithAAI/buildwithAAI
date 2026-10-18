"""Explicit loopback or TLS community SDK; no proxies or redirect following."""

import http.client
import re
import socket
import ssl
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from . import CONNECTION_BINDING, VERSION
from .store import private_regular
from .validation import TOKEN, Problem, canonical, fields, identifier, matching, object_value, parse_json


def commerce_action(client, book_id, body, token, *, attempts=3):
    """Retry only this idempotent endpoint with an immutable command identity/body."""
    identifier(book_id)
    fields(body, ("request_id", "command"), ("sandbox_dispatch",))
    identifier(body["request_id"])
    object_value(body["command"])
    if type(attempts) is not int or not 1 <= attempts <= 3:
        raise Problem(400, "INVALID_COMMERCE_DELIVERY_BOUND")
    try:
        payload = canonical(body).encode("utf-8")
        parse_json(payload)
    except (ValueError, UnicodeError, RecursionError):
        raise Problem(400, "INVALID_COMMERCE_COMMAND") from None
    for attempt in range(attempts):
        try:
            return client.request("POST", "/v1/commerce/books/" + book_id + "/actions", parse_json(payload), token)
        except Problem as error:
            if error.code != "STORAGE_UNAVAILABLE":
                raise
            failure = error
        except (OSError, http.client.HTTPException):
            failure = Problem(502, "COMMERCE_DELIVERY_UNCERTAIN")
        if attempt + 1 == attempts:
            raise failure from None
        time.sleep(0.025 * 2**attempt)


def read_credential(filename):
    path = Path(filename)
    private_regular(path, 2048)
    with path.open("rb") as source:
        payload = parse_json(source.read(2049))
    fields(payload, ("token", "credential_id", "role", "principal_id", "expires_at_ms"))
    return matching(payload["token"], TOKEN, "INVALID_CREDENTIAL_FILE")


def agent_client(port=8765, *, origin=None, expected_instance=None, expected_agent=None):
    """Remote runners require both independently obtained pins before any I/O."""
    if ((origin is not None or expected_instance is not None or expected_agent is not None)
            and (expected_instance is None or expected_agent is None)):
        raise Problem(400, "WORKER_CONNECTION_PINS_REQUIRED")
    return Client(port, origin=origin, expected_instance=expected_instance, expected_agent=expected_agent)


class Client:
    def __init__(self, port=8765, *, origin=None, expected_instance=None, expected_agent=None):
        if type(port) is not int or not 1 <= port <= 65535:
            raise Problem(400, "INVALID_PORT")
        self.port = port
        self.origin = None
        self.host = "127.0.0.1"
        self.authority = None
        if origin is not None:
            if (port != 8765 or type(origin) is not str or not origin.isascii() or len(origin) > 255
                    or any(ord(char) <= 32 or ord(char) == 127 for char in origin)):
                raise Problem(400, "INVALID_COMMUNITY_ORIGIN")
            try:
                parsed = urlsplit(origin)
                remote_port = 443 if parsed.port is None else parsed.port
            except ValueError:
                raise Problem(400, "INVALID_COMMUNITY_ORIGIN") from None
            if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
                    or parsed.password is not None or parsed.path or parsed.query or parsed.fragment
                    or origin != "https://" + str(parsed.hostname) + (":" + str(parsed.port) if parsed.port is not None else "")
                    or not 1 <= remote_port <= 65535
                    or parsed.hostname.endswith(".") or any(char not in "abcdefghijklmnopqrstuvwxyz0123456789.-" for char in parsed.hostname)
                    or any(not label or len(label) > 63 or label.startswith("-") or label.endswith("-") for label in parsed.hostname.split("."))):
                raise Problem(400, "INVALID_COMMUNITY_ORIGIN")
            self.origin, self.host, self.port, self.authority = origin, parsed.hostname, remote_port, parsed.netloc
        self.expected_instance = identifier(expected_instance) if expected_instance is not None else None
        self.expected_agent = identifier(expected_agent) if expected_agent is not None else None
        if self.expected_agent is not None and self.expected_instance is None:
            raise Problem(400, "WORKER_CONNECTION_PINS_REQUIRED")
        self.deadline = None

    def binding(self):
        return {"enforced": self.expected_instance is not None,
                "expected_instance_id": self.expected_instance, "expected_agent_id": self.expected_agent}

    def _bound_path(self, path, *, authenticated=False):
        if self.expected_instance is None:
            return path
        # Query preconditions survive ordinary proxies and older services reject
        # these unknown parameters, rather than silently ignoring a new header.
        path += ("&" if "?" in path else "?") + "expected_instance=" + self.expected_instance
        if authenticated and self.expected_agent is not None:
            path += "&expected_agent=" + self.expected_agent
        return path

    def request(self, method, path, body=None, token=None):
        if self.expected_instance is None:
            return self._request(method, path, body, token, deadline=self.deadline)
        # Share one finite budget across the anonymous probe and actual request.
        deadline = min(time.monotonic() + 12, self.deadline) if self.deadline is not None else time.monotonic() + 12
        try:
            _, status = self._request("GET", self._bound_path("/v1/status"), deadline=deadline)
        except Problem as error:
            if type(error.code) is str and error.code in {"RUN_DEADLINE", "COMMUNITY_REDIRECT_REJECTED", "COMMUNITY_INSTANCE_MISMATCH"}:
                raise
            raise Problem(502, "COMMUNITY_IDENTITY_UNCONFIRMED") from None
        except (ValueError, TypeError):
            raise Problem(502, "COMMUNITY_IDENTITY_UNCONFIRMED") from None
        if type(status) is not dict or status.get("instance_id") != self.expected_instance:
            raise Problem(409, "COMMUNITY_INSTANCE_MISMATCH")
        if (status.get("service") != "zoora-agent-community/" + VERSION
                or status.get("connection_binding") != CONNECTION_BINDING):
            raise Problem(409, "COMMUNITY_BINDING_UNSUPPORTED")
        return self._request(method, self._bound_path(path, authenticated=token is not None), body, token, deadline=deadline)

    def _request(self, method, path, body=None, token=None, *, deadline=None):
        if (not path.startswith("/v1/") or len(path) > 512 or not path.isascii()
                or any(ord(char) <= 32 or ord(char) == 127 for char in path)
                or "#" in path or "\\" in path or "//" in path):
            raise Problem(400, "INVALID_ROUTE")
        headers = {}
        if self.authority is not None:
            headers["Host"] = self.authority
        if token is not None:
            matching(token, TOKEN, "INVALID_CREDENTIAL_FILE")
            headers["Authorization"] = "Bearer " + token
        payload = None
        if body is not None:
            object_value(body)
            payload = canonical(body).encode("utf-8")
            if len(payload) > 16384:
                raise Problem(413, "BODY_TOO_LARGE")
            headers["Content-Type"] = "application/json"
        remaining = 12 if deadline is None else min(12, deadline - time.monotonic())
        if remaining <= 0:
            raise Problem(504, "RUN_DEADLINE")
        connection = (http.client.HTTPSConnection(self.host, self.port, timeout=remaining,
                      context=ssl.create_default_context()) if self.origin is not None else
                      http.client.HTTPConnection("127.0.0.1", self.port, timeout=remaining))
        response = None
        timer = None
        try:
            if deadline is not None:
                connection.connect()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise Problem(504, "RUN_DEADLINE")
                timer = threading.Timer(remaining, self._abort, args=(connection.sock,))
                timer.daemon = True
                timer.start()
            connection.request(method, path, payload, headers)
            response = connection.getresponse()
            if 300 <= response.status < 400:
                raise Problem(502, "COMMUNITY_REDIRECT_REJECTED")
            raw = response.read(1_048_577)
            if deadline is not None and time.monotonic() >= deadline:
                raise Problem(504, "RUN_DEADLINE")
            if len(raw) > 1_048_576:
                raise Problem(502, "INVALID_RESPONSE")
            # Server list responses can exceed the request-size bound, but remain bounded.
            import json
            result = json.loads(raw)
            if type(result) is not dict:
                raise Problem(502, "INVALID_RESPONSE")
            if response.status >= 400:
                code = result.get("error", "REQUEST_FAILED")
                if type(code) is not str or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,95}", code):
                    raise Problem(502, "INVALID_RESPONSE")
                raise Problem(response.status, code)
            return response.status, result
        except (OSError, http.client.HTTPException):
            if deadline is not None and time.monotonic() >= deadline:
                raise Problem(504, "RUN_DEADLINE") from None
            raise
        finally:
            if timer is not None:
                timer.cancel()
                timer.join()
            if response is not None:
                response.close()
            connection.close()

    @staticmethod
    def _abort(channel):
        try:
            channel.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
