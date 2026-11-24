"""Polite HTTP for the radar.

Rules enforced here:
  * one User-Agent for every request (see DEFAULT_USER_AGENT and README);
  * at most one request per second per host (more if robots.txt sets Crawl-delay);
  * robots.txt is fetched once per host per day and obeyed (RFC 9309; 4xx means
    "no rules", 5xx or unreachable means "do not crawl this run");
  * conditional GETs (ETag / Last-Modified) and a per-source TTL, so repeated runs
    do not re-download unchanged feeds;
  * 429 / 5xx / timeouts are retried twice with backoff (Retry-After honoured,
    capped); policy refusals (HTTP 403, proxy 403) are never retried;
  * responses are capped in size and gzip is decoded with a size cap.

The cache keeps only what the parsers extract (titles, URLs, dates and excerpts of
at most 280 characters) plus validators, never raw article bodies.
"""

import datetime as dt
import json
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

from . import robots as robots_mod
from .textutil import iso_z, parse_iso

DEFAULT_USER_AGENT = "NewsRadar/0.1"
PRODUCT_TOKEN_DEFAULT = "NewsRadar"
RETRY_STATUSES = {429, 500, 502, 503, 504}
ROBOTS_TTL = dt.timedelta(hours=24)
CACHE_VERSION = 1


class FetchError(Exception):
    def __init__(self, kind, message, status=None):
        super().__init__(message)
        self.kind = kind
        self.status = status


class Response:
    def __init__(self, status, headers, body, url):
        self.status = status
        self.headers = headers
        self.body = body
        self.url = url


def product_token(user_agent):
    token = (user_agent or "").split("/", 1)[0].split()[0] if user_agent else ""
    return token or PRODUCT_TOKEN_DEFAULT


class HttpClient:
    def __init__(self, user_agent=DEFAULT_USER_AGENT, min_interval=1.05, timeout=30,
                 max_bytes=8 * 1024 * 1024, retries=2, opener=None, clock=time.monotonic,
                 sleep=time.sleep, log=None):
        self.user_agent = user_agent
        self.min_interval = float(min_interval)
        self.timeout = timeout
        self.max_bytes = max_bytes
        self.retries = retries
        self.opener = opener or urllib.request.build_opener()
        self.clock = clock
        self.sleep = sleep
        self.log = log or (lambda msg: None)
        self._last = {}
        self.host_delay = {}
        self.requests = 0

    def _wait_turn(self, host):
        interval = max(self.min_interval, self.host_delay.get(host) or 0.0)
        last = self._last.get(host)
        if last is not None:
            wait = interval - (self.clock() - last)
            if wait > 0:
                self.sleep(wait)
        self._last[host] = self.clock()

    def get(self, url, headers=None, accept="*/*"):
        host = urllib.parse.urlsplit(url).netloc.lower()
        attempt = 0
        while True:
            self._wait_turn(host)
            request_headers = {"User-Agent": self.user_agent, "Accept": accept, "Accept-Encoding": "gzip"}
            request_headers.update(headers or {})
            request = urllib.request.Request(url, headers=request_headers, method="GET")
            self.requests += 1
            try:
                with self.opener.open(request, timeout=self.timeout) as resp:
                    raw = resp.read(self.max_bytes + 1)
                    if len(raw) > self.max_bytes:
                        raise FetchError("too-large", f"response larger than {self.max_bytes} bytes")
                    lowered = {k.lower(): v for k, v in resp.headers.items()}
                    body = _decode_body(raw, lowered.get("content-encoding", ""), self.max_bytes)
                    return Response(resp.status, lowered, body, resp.geturl())
            except urllib.error.HTTPError as err:
                status = err.code
                lowered = {k.lower(): v for k, v in (err.headers.items() if err.headers else [])}
                if status == 304:
                    return Response(304, lowered, b"", url)
                if status in RETRY_STATUSES and attempt < self.retries:
                    attempt += 1
                    self.sleep(_retry_after(lowered.get("retry-after"), attempt))
                    continue
                raise FetchError("http", f"HTTP {status}", status=status) from None
            except urllib.error.URLError as err:
                reason = str(getattr(err, "reason", err))
                if "Tunnel connection failed" in reason or "403" in reason and "proxy" in reason.lower():
                    raise FetchError("proxy-refused", f"network policy refused {host}: {reason}") from None
                if attempt < self.retries and _transient(err):
                    attempt += 1
                    self.sleep(_retry_after(None, attempt))
                    continue
                raise FetchError("network", reason) from None
            except (socket.timeout, TimeoutError, ConnectionError) as err:
                if attempt < self.retries:
                    attempt += 1
                    self.sleep(_retry_after(None, attempt))
                    continue
                raise FetchError("timeout", str(err) or "timed out") from None


def _transient(err):
    reason = getattr(err, "reason", None)
    return isinstance(reason, (socket.timeout, TimeoutError, ConnectionError))


def _retry_after(value, attempt):
    if value:
        try:
            return min(30.0, max(1.0, float(value)))
        except ValueError:
            pass
    return min(30.0, 2.0 ** attempt)


def _decode_body(raw, encoding, max_bytes):
    if encoding.lower() not in ("gzip", "x-gzip"):
        return raw
    decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
    body = decompressor.decompress(raw, max_bytes + 1)
    if len(body) > max_bytes or decompressor.unconsumed_tail:
        raise FetchError("too-large", f"decompressed response larger than {max_bytes} bytes")
    return body


class JsonStore:
    """Small JSON files under a cache directory (atomic writes)."""

    def __init__(self, root):
        self.root = root

    def _path(self, kind, key):
        safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in key)
        return os.path.join(self.root, kind, safe + ".json")

    def load(self, kind, key):
        path = self._path(kind, key)
        try:
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return None

    def save(self, kind, key, data):
        path = self._path(kind, key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1, sort_keys=True)
        os.replace(tmp, path)


class RobotsCache:
    def __init__(self, client, store, now):
        self.client = client
        self.store = store
        self.now = now
        self.memory = {}
        self.product = product_token(client.user_agent)

    def for_url(self, url):
        parts = urllib.parse.urlsplit(url)
        host = parts.netloc.lower()
        if host in self.memory:
            return self.memory[host]
        record = self.store.load("robots", host) if self.store else None
        fresh = False
        if record and record.get("v") == CACHE_VERSION:
            fetched = parse_iso(record.get("fetchedUtc"))
            fresh = fetched is not None and self.now - fetched < ROBOTS_TTL and record.get("mode") != "disallow-all"
        if not fresh:
            record = self._fetch(parts.scheme or "https", host)
            if self.store and record["mode"] != "disallow-all":
                self.store.save("robots", host, record)
        if record["mode"] == "parsed":
            rules = robots_mod.Robots.parse(record.get("text", ""))
        elif record["mode"] == "allow-all":
            rules = robots_mod.Robots.allow_all()
        else:
            rules = robots_mod.Robots.disallow_all()
        delay = rules.crawl_delay(self.product)
        if delay:
            self.client.host_delay[host] = min(delay, 30.0)
        result = (rules, record)
        self.memory[host] = result
        return result

    def _fetch(self, scheme, host):
        url = f"{scheme}://{host}/robots.txt"
        record = {"v": CACHE_VERSION, "host": host, "fetchedUtc": iso_z(self.now), "url": url}
        try:
            resp = self.client.get(url, accept="text/plain, */*")
        except FetchError as err:
            if err.kind == "http" and err.status and 400 <= err.status < 500:
                record.update(mode="allow-all", status=err.status, note=f"robots.txt HTTP {err.status}: no rules")
            else:
                record.update(mode="disallow-all", status=err.status, note=f"robots.txt unreachable ({err.kind}): {err}")
            return record
        text = resp.body[: 512 * 1024].decode("utf-8", errors="replace")
        record.update(mode="parsed", status=resp.status, text=text)
        return record

    def allowed(self, url):
        rules, record = self.for_url(url)
        return rules.allowed(url, self.product), record


class SourceCache:
    def __init__(self, store):
        self.store = store

    def load(self, source_id):
        record = self.store.load("sources", source_id) if self.store else None
        if record and record.get("v") == CACHE_VERSION:
            return record
        return None

    def save(self, source_id, record):
        if self.store:
            record = dict(record, v=CACHE_VERSION)
            self.store.save("sources", source_id, record)


def collect_source(source, parse, client, robots_cache, source_cache, now, parser_version, log=None):
    """Fetch and parse one source with cache, robots and politeness.

    Returns a dict: {status, httpStatus, fetchedUtc, items, warnings, error}.
    status is one of ok | cached | not-modified | stale-cache | skipped | error.
    """
    log = log or (lambda msg: None)
    sid = source["id"]
    url = source["url"]
    ttl = dt.timedelta(minutes=float(source.get("minRefetchMinutes", 30)))
    result = {"status": None, "httpStatus": None, "fetchedUtc": None, "items": [], "warnings": [], "error": None}
    cached = source_cache.load(sid) if source_cache else None
    if cached and cached.get("parserVersion") != parser_version:
        cached = None
    if cached:
        fetched = parse_iso(cached.get("fetchedUtc"))
        if fetched is not None and now - fetched < ttl:
            result.update(status="cached", fetchedUtc=cached["fetchedUtc"], items=cached.get("items", []),
                          httpStatus=cached.get("httpStatus"))
            return result

    allowed, robots_record = robots_cache.allowed(url)
    if not allowed:
        note = robots_record.get("note") or "robots.txt disallows this path for our user agent"
        return _fallback(result, cached, "skipped", f"robots: {note}", log, sid)

    headers = {}
    if cached:
        if cached.get("etag"):
            headers["If-None-Match"] = cached["etag"]
        if cached.get("lastModified"):
            headers["If-Modified-Since"] = cached["lastModified"]
    try:
        resp = client.get(url, headers=headers, accept=source.get("accept", "*/*"))
    except FetchError as err:
        status = "skipped" if err.kind == "proxy-refused" else "error"
        return _fallback(result, cached, status, f"{err.kind}: {err}", log, sid, http_status=err.status)

    if resp.status == 304 and cached:
        record = dict(cached, fetchedUtc=iso_z(now), httpStatus=304)
        source_cache.save(sid, record)
        result.update(status="not-modified", httpStatus=304, fetchedUtc=record["fetchedUtc"],
                      items=cached.get("items", []))
        return result

    try:
        items, warnings = parse(resp.body, source)
    except Exception as err:  # a parser failure must never crash the run
        return _fallback(result, cached, "error", f"parse failed: {type(err).__name__}: {err}", log, sid,
                         http_status=resp.status)
    record = {
        "sourceId": sid,
        "url": url,
        "fetchedUtc": iso_z(now),
        "httpStatus": resp.status,
        "etag": resp.headers.get("etag"),
        "lastModified": resp.headers.get("last-modified"),
        "parserVersion": parser_version,
        "items": items,
    }
    if source_cache:
        source_cache.save(sid, record)
    result.update(status="ok", httpStatus=resp.status, fetchedUtc=record["fetchedUtc"], items=items,
                  warnings=list(warnings))
    return result


def _fallback(result, cached, status, message, log, sid, http_status=None):
    log(f"[radar] {sid}: {message}")
    result["httpStatus"] = http_status
    if cached:
        result.update(status="stale-cache", fetchedUtc=cached.get("fetchedUtc"), items=cached.get("items", []))
        result["warnings"].append(f"{message}; using cached items from {cached.get('fetchedUtc')}")
        result["error"] = message
        return result
    result.update(status=status, error=message)
    result["warnings"].append(message)
    return result
