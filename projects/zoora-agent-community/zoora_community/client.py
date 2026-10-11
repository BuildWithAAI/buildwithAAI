"""Small local-only SDK. Credentials belong in private files, never command arguments."""

import http.client
from pathlib import Path

from .store import private_regular
from .validation import TOKEN, Problem, canonical, fields, matching, object_value, parse_json


def read_credential(filename):
    path = Path(filename)
    private_regular(path, 2048)
    with path.open("rb") as source:
        payload = parse_json(source.read(2049))
    fields(payload, ("token", "credential_id", "role", "principal_id", "expires_at_ms"))
    return matching(payload["token"], TOKEN, "INVALID_CREDENTIAL_FILE")


class Client:
    def __init__(self, port=8765):
        if type(port) is not int or not 1 <= port <= 65535:
            raise Problem(400, "INVALID_PORT")
        self.port = port

    def request(self, method, path, body=None, token=None):
        if not path.startswith("/v1/") or len(path) > 512:
            raise Problem(400, "INVALID_ROUTE")
        headers = {}
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
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=12)
        response = None
        try:
            connection.request(method, path, payload, headers)
            response = connection.getresponse()
            raw = response.read(1_048_577)
            if len(raw) > 1_048_576:
                raise Problem(502, "INVALID_RESPONSE")
            # Server list responses can exceed the request-size bound, but remain bounded.
            import json
            result = json.loads(raw)
            if response.status >= 400:
                raise Problem(response.status, result.get("error", "REQUEST_FAILED"))
            return response.status, result
        finally:
            if response is not None:
                response.close()
            connection.close()
