"""Shared application validation; transports own HTTP parsing and connection bounds."""

from urllib.parse import parse_qsl, urlsplit

from .validation import MAX_BODY, Problem, canonical, parse_json

ASSETS = {"/": ("index.html", "text/html; charset=utf-8"),
          "/app.js": ("app.js", "text/javascript; charset=utf-8"),
          "/style.css": ("style.css", "text/css; charset=utf-8")}
CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"


def response(status, result, content_type="application/json; charset=utf-8"):
    payload = result if type(result) is bytes else (canonical(result) + "\n").encode("utf-8")
    if len(payload) > 1_048_576:
        raise Problem(503, "RESPONSE_TOO_LARGE")
    headers = [("Content-Type", content_type), ("Content-Length", str(len(payload))),
               ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff"),
               ("Content-Security-Policy", CSP), ("Referrer-Policy", "no-referrer")]
    if status == 401:
        headers.append(("WWW-Authenticate", "Bearer"))
    if status == 429:
        headers.append(("Retry-After", "60"))
    return payload, headers


def dispatch(store, runtime, host, origin, method, target, headers, read_body, assets):
    if len(target) > 512 or not target.startswith("/") or target.startswith("//"):
        raise Problem(400, "INVALID_ROUTE")
    if sum(len(k) + len(v) for k, v in headers.items()) > 8192:
        raise Problem(431, "HEADERS_TOO_LARGE")
    if headers.get_all("Host", []) != [host]:
        raise Problem(403, "INVALID_HOST")
    origins = headers.get_all("Origin", [])
    if origins and origins != [origin]:
        raise Problem(403, "ORIGIN_REJECTED")
    fetch_sites = headers.get_all("Sec-Fetch-Site", [])
    if len(fetch_sites) > 1 or (fetch_sites and fetch_sites[0] not in ("same-origin", "none")):
        raise Problem(403, "ORIGIN_REJECTED")
    if headers.get_all("Transfer-Encoding") or headers.get_all("Expect"):
        raise Problem(400, "UNSUPPORTED_HTTP_FRAMING")
    lengths = headers.get_all("Content-Length", [])
    if len(lengths) > 1:
        raise Problem(400, "UNSUPPORTED_HTTP_FRAMING")
    authorization = headers.get_all("Authorization", [])
    if len(authorization) > 1:
        raise Problem(400, "INVALID_AUTH_HEADER")
    token = None
    if authorization:
        if not authorization[0].startswith("Bearer "):
            raise Problem(401, "UNAUTHORIZED")
        token = authorization[0][7:]
    parsed = urlsplit(target)
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
    if method in {"POST", "PATCH"}:
        if parsed.query:
            raise Problem(400, "INVALID_ROUTE")
        if not lengths:
            raise Problem(411, "LENGTH_REQUIRED")
        if not lengths[0].isascii() or not lengths[0].isdigit():
            raise Problem(400, "UNSUPPORTED_HTTP_FRAMING")
        length = int(lengths[0])
        if length > MAX_BODY:
            raise Problem(413, "BODY_TOO_LARGE")
        if headers.get_all("Content-Type", []) != ["application/json"] or headers.get_all("Content-Encoding"):
            raise Problem(415, "JSON_REQUIRED")
        data = read_body(length)
        if len(data) != length:
            raise Problem(400, "INCOMPLETE_BODY")
        body = parse_json(data)
    elif lengths and lengths != ["0"]:
        raise Problem(400, "UNEXPECTED_BODY")
    if method == "GET" and parsed.path in ("/healthz", "/v1/ready"):
        if parsed.query:
            raise Problem(400, "INVALID_ROUTE")
        if parsed.path == "/healthz":
            return 200, {"status": "AVAILABLE", "scope": "PROCESS_LIVENESS"}, "application/json; charset=utf-8"
        return 200, runtime.ready(token), "application/json; charset=utf-8"
    if method == "GET" and parsed.path in ASSETS:
        if parsed.query:
            raise Problem(400, "INVALID_ROUTE")
        _, mime = ASSETS[parsed.path]
        return 200, assets[parsed.path][0], mime
    status, result = store.call(method, parsed.path, body, token,
                                            limit=limit, after=args.get("after", ""))
    return status, result, "application/json; charset=utf-8"
