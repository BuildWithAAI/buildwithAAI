"""HTTP transport for the YouTube Data API (urllib, standard library only).

One get() is one HTTP request; retries, quota charging and caching live in api.YouTubeClient so every attempt is
charged. The API key travels in the x-goog-api-key header (never in the URL, so it cannot leak through URLs, logs or
cache keys) unless key_in_query is set. Every error message is scrubbed of the key before it is raised."""

import gzip
import http.client
import json
import re
import socket
import urllib.error
import urllib.parse
import urllib.request

from . import contracts

USER_AGENT = "zoora-topic-finder/1.0 (gzip)"


class ApiError(Exception):
    """kind: quota | rate | server | network | auth | not-found | bad-request | blocked | invalid-response"""

    RETRIABLE = {"rate", "server", "network"}

    def __init__(self, method, kind, message, status=None, reason=None, retry_after=None):
        self.method = method
        self.kind = kind
        self.status = status
        self.reason = reason
        self.retry_after = retry_after
        self.retriable = kind in self.RETRIABLE
        bits = [method, kind]
        if status:
            bits.append(str(status))
        if reason:
            bits.append(reason)
        super().__init__(f"{' / '.join(bits)}: {message}")
        self.detail = message

    def to_dict(self):
        return {"method": self.method, "kind": self.kind, "status": self.status, "reason": self.reason, "message": self.detail}


def scrub(message, secret):
    message = str(message)
    if secret:
        message = message.replace(secret, "[redacted]")
        quoted = urllib.parse.quote(secret, safe="")
        if quoted != secret:
            message = message.replace(quoted, "[redacted]")
    return message


def _decode(body, encoding):
    if body and (encoding or "").lower() == "gzip":
        try:
            return gzip.decompress(body)
        except OSError:
            return body
    return body


def classify_error(method, status, body, secret=None, retry_after=None):
    """Google error envelope -> ApiError. A non-JSON 403/407 is the network proxy refusing the host ('blocked')."""
    envelope = None
    try:
        data = json.loads(body.decode("utf-8", "replace")) if body else None
        if isinstance(data, dict) and isinstance(data.get("error"), dict):
            envelope = data["error"]
    except ValueError:
        envelope = None
    if envelope is None:
        snippet = scrub((body or b"")[:160].decode("utf-8", "replace").strip(), secret) or "(no body)"
        if status in (403, 407):
            return ApiError(method, "blocked", f"refused before reaching YouTube (not a Google error body): {snippet}", status, None, retry_after)
        if status in contracts.RETRIABLE_STATUS or status == 429:
            return ApiError(method, "server" if status != 429 else "rate", f"HTTP {status}: {snippet}", status, None, retry_after)
        return ApiError(method, "bad-request", f"HTTP {status}: {snippet}", status, None, retry_after)
    reasons = []
    for err in envelope.get("errors") or []:
        if isinstance(err, dict) and err.get("reason"):
            reasons.append(str(err["reason"]))
    for detail in envelope.get("details") or []:
        if isinstance(detail, dict) and str(detail.get("@type", "")).endswith("google.rpc.ErrorInfo") and detail.get("reason"):
            reasons.append(str(detail["reason"]))
    message = scrub(re.sub(r"<[^>]+>", "", str(envelope.get("message") or envelope.get("status") or "error")), secret)
    reason = reasons[0] if reasons else envelope.get("status")
    code = envelope.get("code") if isinstance(envelope.get("code"), int) else status
    rs = set(reasons)
    if rs & contracts.QUOTA_REASONS:
        kind = "quota"
    elif code == 429 or rs & contracts.RATE_REASONS:
        kind = "rate"
    elif code in contracts.RETRIABLE_STATUS or rs & contracts.SERVER_REASONS:
        kind = "server"
    elif code == 404 or rs & contracts.NOT_FOUND_REASONS:
        kind = "not-found"
    elif rs & contracts.AUTH_REASONS or code in (401, 403):
        kind = "auth"
    else:
        kind = "bad-request"
    return ApiError(method, kind, message, code, reason, retry_after)


def _retry_after(headers):
    value = headers.get("Retry-After") if headers else None
    try:
        return max(0.0, float(value)) if value is not None else None
    except ValueError:
        return None


class UrllibTransport:
    def __init__(self, api_key, root=contracts.API_ROOT, timeout=30.0, key_in_query=False, user_agent=USER_AGENT, opener=None):
        if not api_key:
            raise ValueError(f"{contracts.KEY_ENV} is empty")
        self._key = api_key
        self.root = root.rstrip("/")
        self.timeout = timeout
        self.key_in_query = key_in_query
        self.user_agent = user_agent
        self.opener = opener or urllib.request.build_opener()
        self.requests = 0

    def url(self, method, params):
        if method not in contracts.ENDPOINTS:
            raise ValueError(f"unknown API method {method}")
        query = dict(params)
        query["prettyPrint"] = "false"
        if self.key_in_query:
            query["key"] = self._key
        return f"{self.root}/{contracts.ENDPOINTS[method]}?{urllib.parse.urlencode(query)}"

    def get(self, method, params):
        req = urllib.request.Request(self.url(method, params), method="GET")
        req.add_header("Accept", "application/json")
        req.add_header("Accept-Encoding", "gzip")
        req.add_header("User-Agent", self.user_agent)
        if not self.key_in_query:
            req.add_header(contracts.KEY_HEADER, self._key)
        self.requests += 1
        try:
            with self.opener.open(req, timeout=self.timeout) as resp:
                body = _decode(resp.read(), resp.headers.get("Content-Encoding"))
        except urllib.error.HTTPError as err:
            try:
                body = _decode(err.read(), err.headers.get("Content-Encoding") if err.headers else None)
            except (OSError, http.client.HTTPException):
                body = b""
            raise classify_error(method, err.code, body, self._key, _retry_after(err.headers)) from None
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, http.client.HTTPException, OSError) as err:
            reason = getattr(err, "reason", err)
            raise ApiError(method, "network", scrub(f"{type(err).__name__}: {reason}", self._key)) from None
        try:
            data = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ApiError(method, "invalid-response", "the response is not JSON") from None
        if not isinstance(data, dict):
            raise ApiError(method, "invalid-response", "the response is not a JSON object")
        return data
