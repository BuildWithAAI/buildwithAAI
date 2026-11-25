"""Polite HTTP for the radar.

Rules enforced here:
  * one User-Agent for every request (see DEFAULT_USER_AGENT and README);
  * at most one request per second per host, or the full Crawl-delay robots.txt sets; a host whose Crawl-delay is
    above MAX_CRAWL_DELAY (120 s) is not crawled at all (the radar never shortens a site's delay);
  * robots.txt is fetched once per host per day and obeyed (RFC 9309; 4xx means
    "no rules", 5xx or unreachable means "do not crawl this run");
  * conditional GETs (ETag / Last-Modified) and a per-source TTL, so repeated runs
    do not re-download unchanged feeds;
  * 429 / 5xx / timeouts are retried twice with backoff (Retry-After honoured,
    capped); policy refusals (HTTP 403, proxy 403) are never retried;
  * responses are capped in size, read in chunks within a wall-clock budget, and
    gzip is decoded with a size cap;
  * only http and https are ever opened (no ftp:, file: or data: handlers), and
    redirects are followed by hand: https only, to the same host or to a host
    listed in sources.json, at most 5, with robots.txt and the per-host spacing
    checked again for a new host.

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
# the longest robots.txt Crawl-delay the radar waits for; a host asking for more is skipped, never crawled faster
MAX_CRAWL_DELAY = 120.0
PRODUCT_TOKEN_DEFAULT = "NewsRadar"
RETRY_STATUSES = {429, 500, 502, 503, 504}
REDIRECT_STATUSES = {301, 302, 303, 307, 308}
MAX_REDIRECTS = 5
READ_CHUNK = 64 * 1024
REQUEST_SECONDS = 60.0
# robots.txt answers that mean "do not crawl now" rather than "no rules" (RFC 9309 leaves these to the crawler)
ROBOTS_DENY_STATUSES = {401, 403, 429}
ROBOTS_TTL = dt.timedelta(hours=24)
UNREACHABLE_TTL = dt.timedelta(hours=6)
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


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Hand every 3xx back to the caller as an HTTPError: redirects are checked and followed by HttpClient."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def build_opener():
    """An opener that can only speak http and https (through the environment's proxy), never ftp:, file: or data:,
    and that never follows a redirect on its own."""
    opener = urllib.request.OpenerDirector()
    for handler in (urllib.request.ProxyHandler(), urllib.request.UnknownHandler(), urllib.request.HTTPHandler(),
                    urllib.request.HTTPDefaultErrorHandler(), _NoRedirect(), urllib.request.HTTPErrorProcessor(),
                    urllib.request.HTTPSHandler()):
        opener.add_handler(handler)
    return opener


def product_token(user_agent):
    token = (user_agent or "").split("/", 1)[0].split()[0] if user_agent else ""
    return token or PRODUCT_TOKEN_DEFAULT


class HttpClient:
    def __init__(self, user_agent=DEFAULT_USER_AGENT, min_interval=1.05, timeout=30,
                 max_bytes=8 * 1024 * 1024, retries=2, opener=None, clock=time.monotonic,
                 sleep=time.sleep, log=None, allowed_hosts=(), deadline=REQUEST_SECONDS):
        self.user_agent = user_agent
        self.min_interval = float(min_interval)
        self.timeout = timeout
        self.max_bytes = max_bytes
        self.retries = retries
        self.opener = opener or build_opener()
        self.clock = clock
        self.sleep = sleep
        self.log = log or (lambda msg: None)
        self._last = {}
        self.host_delay = {}
        self.requests = 0
        # hosts a redirect may lead to besides the requested host (the hosts of sources.json)
        self.allowed_hosts = {h.lower() for h in allowed_hosts if h}
        self.deadline = float(deadline)
        # callable(url) -> (allowed, note): robots.txt for a redirect target on a new host (set by RobotsCache)
        self.redirect_check = None

    def _wait_turn(self, host):
        interval = max(self.min_interval, self.host_delay.get(host) or 0.0)
        last = self._last.get(host)
        if last is not None:
            wait = interval - (self.clock() - last)
            if wait > 0:
                self.sleep(wait)
        self._last[host] = self.clock()

    def _redirect_target(self, current, location):
        """The URL a redirect leads to, or FetchError when it is not https, not on the same host and not on a
        listed host, or carries credentials or an unusual port."""
        if not location:
            raise FetchError("redirect-refused", "redirect without a Location header")
        target = urllib.parse.urljoin(current, location.strip())
        parts = urllib.parse.urlsplit(target)
        try:
            port = parts.port
        except ValueError:
            raise FetchError("redirect-refused", "redirect to a malformed URL") from None
        if parts.scheme != "https":
            raise FetchError("redirect-refused", f"redirect to a non-https URL refused ({parts.scheme or 'no scheme'})")
        if parts.username or parts.password or port not in (None, 443):
            raise FetchError("redirect-refused", "redirect to a URL with credentials or a non-standard port refused")
        host = (parts.hostname or "").lower()
        if host != (urllib.parse.urlsplit(current).hostname or "").lower() and host not in self.allowed_hosts:
            raise FetchError("redirect-refused", f"redirect to an unlisted host refused: {host}")
        return target

    def _read(self, resp, started):
        """The body in chunks, within the size cap and the wall-clock budget."""
        reader = getattr(resp, "read1", None) or resp.read
        chunks, size = [], 0
        while True:
            if self.clock() - started > self.deadline:
                raise FetchError("timeout", f"response took longer than {self.deadline:g} s")
            chunk = reader(READ_CHUNK)
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > self.max_bytes:
                raise FetchError("too-large", f"response larger than {self.max_bytes} bytes")
        return b"".join(chunks)

    def get(self, url, headers=None, accept="*/*", robots_request=False):
        current = url
        host = (urllib.parse.urlsplit(current).hostname or "").lower()
        attempt = 0
        redirects = 0
        while True:
            self._wait_turn(host)
            request_headers = {"User-Agent": self.user_agent, "Accept": accept, "Accept-Encoding": "gzip"}
            request_headers.update(headers or {})
            request = urllib.request.Request(current, headers=request_headers, method="GET")
            self.requests += 1
            started = self.clock()
            try:
                with self.opener.open(request, timeout=self.timeout) as resp:
                    final = (urllib.parse.urlsplit(resp.geturl() or current).hostname or "").lower()
                    if final != host:
                        raise FetchError("redirect-refused", f"response came from another host: {final}")
                    raw = self._read(resp, started)
                    lowered = {k.lower(): v for k, v in resp.headers.items()}
                    body = _decode_body(raw, lowered.get("content-encoding", ""), self.max_bytes)
                    return Response(resp.status, lowered, body, resp.geturl() or current)
            except urllib.error.HTTPError as err:
                status = err.code
                lowered = {k.lower(): v for k, v in (err.headers.items() if err.headers else [])}
                try:
                    err.close()
                except Exception:  # noqa: BLE001 - closing a finished error response must never fail a fetch
                    pass
                if status in REDIRECT_STATUSES:
                    if redirects >= MAX_REDIRECTS:
                        raise FetchError("redirect-refused", f"more than {MAX_REDIRECTS} redirects") from None
                    target = self._redirect_target(current, lowered.get("location"))
                    new_host = (urllib.parse.urlsplit(target).hostname or "").lower()
                    if new_host != host and self.redirect_check and not robots_request:
                        allowed, note = self.redirect_check(target)
                        if not allowed:
                            raise FetchError("robots", f"redirect target disallowed by robots.txt: {note}") from None
                    current, host, redirects, attempt = target, new_host, redirects + 1, 0
                    continue
                if status == 304:
                    return Response(304, lowered, b"", current)
                if status in RETRY_STATUSES and attempt < self.retries:
                    attempt += 1
                    self.sleep(_retry_after(lowered.get("retry-after"), attempt))
                    continue
                raise FetchError("http", f"HTTP {status}", status=status) from None
            except urllib.error.URLError as err:
                reason = str(getattr(err, "reason", err))
                if "Tunnel connection failed" in reason or ("403" in reason and "proxy" in reason.lower()):
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
    def __init__(self, client, store, now, extra_tokens=()):
        self.client = client
        self.store = store
        self.now = now
        self.memory = {}
        self.product = product_token(client.user_agent)
        self.extra_tokens = tuple(t for t in extra_tokens if t and t.lower() != self.product.lower())
        if getattr(client, "redirect_check", "absent") is None:
            client.redirect_check = self.check_redirect

    def for_url(self, url):
        parts = urllib.parse.urlsplit(url)
        host = parts.netloc.lower()
        if host in self.memory:
            return self.memory[host]
        record = self.store.load("robots", host) if self.store else None
        fresh = False
        if record and record.get("v") == CACHE_VERSION:
            fetched = parse_iso(record.get("fetchedUtc"))
            # an unreachable host is retried after 6 hours, never sooner
            ttl = UNREACHABLE_TTL if record.get("mode") == "disallow-all" else ROBOTS_TTL
            fresh = fetched is not None and self.now - fetched < ttl
        if not fresh:
            record = self._fetch(parts.scheme or "https", host)
            if self.store:
                self.store.save("robots", host, record)
        if record["mode"] == "parsed":
            rules = robots_mod.Robots.parse(record.get("text", ""))
        elif record["mode"] == "allow-all":
            rules = robots_mod.Robots.allow_all()
        else:
            rules = robots_mod.Robots.disallow_all()
        delay = rules.crawl_delay(self.product)
        if delay and delay > MAX_CRAWL_DELAY:
            # never shorten a site's Crawl-delay: a host that asks for more than the radar can wait is not crawled
            rules = robots_mod.Robots.disallow_all()
            record = dict(record, note=f"robots.txt Crawl-delay {delay:g} s is above the radar's {MAX_CRAWL_DELAY:g} s "
                                       "ceiling: not crawling this host")
        elif delay:
            self.client.host_delay[host] = delay
        result = (rules, record)
        self.memory[host] = result
        return result

    def _fetch(self, scheme, host):
        url = f"{scheme}://{host}/robots.txt"
        record = {"v": CACHE_VERSION, "host": host, "fetchedUtc": iso_z(self.now), "url": url}
        try:
            resp = self.client.get(url, accept="text/plain, */*", robots_request=True)
        except FetchError as err:
            if err.kind == "http" and err.status and 400 <= err.status < 500 and err.status not in ROBOTS_DENY_STATUSES:
                record.update(mode="allow-all", status=err.status, note=f"robots.txt HTTP {err.status}: no rules")
            elif err.kind == "http" and err.status in ROBOTS_DENY_STATUSES:
                # rate limited or refused: treat as "do not crawl now" and ask again after the short TTL
                record.update(mode="disallow-all", status=err.status, note=f"robots.txt HTTP {err.status}: not crawling this host for now")
            else:
                record.update(mode="disallow-all", status=err.status, note=f"robots.txt unreachable ({err.kind}): {err}")
            return record
        text = resp.body[: 512 * 1024].decode("utf-8", errors="replace")
        record.update(mode="parsed", status=resp.status, text=text)
        return record

    def check_redirect(self, url):
        """(allowed, note) for a redirect target on a new host: that host's robots.txt is fetched and obeyed too."""
        allowed, record = self.allowed(url)
        return allowed, record.get("note") or ("allowed" if allowed else "robots.txt disallows this path")

    def allowed(self, url):
        """(allowed, record): allowed only if our token and every extra token may fetch url."""
        rules, record = self.for_url(url)
        if not rules.allowed(url, self.product):
            return False, record
        for token in self.extra_tokens:
            if not rules.allowed(url, token):
                record = dict(record, note=f"robots.txt disallows this path for {token}")
                return False, record
        return True, record


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
