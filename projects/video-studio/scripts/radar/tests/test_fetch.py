"""HTTP politeness, robots handling and the source cache, with a fake opener (no network)."""

import datetime as dt
import email.message
import gzip
import io
import tempfile
import unittest
import urllib.error

from radarlib import fetch

NOW = dt.datetime(2026, 11, 24, 6, 0, tzinfo=dt.timezone.utc)


def _headers(values):
    msg = email.message.Message()
    for key, value in (values or {}).items():
        msg[key] = value
    return msg


class FakeResponse:
    """Reads consume the body, like a real socket response (the client reads in chunks)."""

    def __init__(self, url, status=200, body=b"", headers=None):
        self.url, self.status, self.headers = url, status, _headers(headers)
        self._stream = io.BytesIO(body)

    def read(self, n=-1):
        return self._stream.read(n if n is not None and n >= 0 else -1)

    def geturl(self):
        return self.url

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeOpener:
    """routes: url -> list of responses/exceptions consumed in order (last one repeats)."""

    def __init__(self, routes):
        self.routes = {k: list(v) for k, v in routes.items()}
        self.requests = []

    def open(self, request, timeout=None):
        self.requests.append(request)
        queue = self.routes.get(request.full_url)
        if not queue:
            raise urllib.error.HTTPError(request.full_url, 404, "Not Found", _headers({}), io.BytesIO(b""))
        item = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(item, Exception):
            raise item
        return item


def http_error(url, code, headers=None):
    return urllib.error.HTTPError(url, code, "err", _headers(headers or {}), io.BytesIO(b""))


class Clock:
    def __init__(self):
        self.now = 1000.0
        self.sleeps = []

    def time(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


def client_for(routes, **kw):
    clock = Clock()
    opener = FakeOpener(routes)
    client = fetch.HttpClient(user_agent="NewsRadar/0.1", opener=opener, clock=clock.time, sleep=clock.sleep, **kw)
    return client, opener, clock


class HttpClientTests(unittest.TestCase):
    def test_user_agent_and_per_host_spacing(self):
        url_a, url_b = "https://a.test/feed", "https://b.test/feed"
        client, opener, clock = client_for({url_a: [FakeResponse(url_a, body=b"x")], url_b: [FakeResponse(url_b, body=b"y")]})
        client.get(url_a)
        client.get(url_b)      # other host: no wait
        client.get(url_a)      # same host: waits ~1.05 s
        self.assertEqual(len(clock.sleeps), 1)
        self.assertAlmostEqual(clock.sleeps[0], 1.05, places=2)
        self.assertEqual(opener.requests[0].get_header("User-agent"), "NewsRadar/0.1")
        self.assertEqual(opener.requests[0].get_header("Accept-encoding"), "gzip")

    def test_crawl_delay_raises_spacing(self):
        url = "https://a.test/feed"
        client, _, clock = client_for({url: [FakeResponse(url, body=b"x")]})
        client.host_delay["a.test"] = 5.0
        client.get(url)
        client.get(url)
        self.assertAlmostEqual(clock.sleeps[-1], 5.0, places=2)

    def test_gzip_is_decoded_and_size_capped(self):
        url = "https://a.test/feed"
        body = b"<rss>" + b"a" * 1000 + b"</rss>"
        client, _, _ = client_for({url: [FakeResponse(url, body=gzip.compress(body), headers={"Content-Encoding": "gzip"})]})
        self.assertEqual(client.get(url).body, body)
        client, _, _ = client_for({url: [FakeResponse(url, body=gzip.compress(b"a" * 5000), headers={"Content-Encoding": "gzip"})]},
                                  max_bytes=1000)
        with self.assertRaises(fetch.FetchError) as ctx:
            client.get(url)
        self.assertEqual(ctx.exception.kind, "too-large")
        client, _, _ = client_for({url: [FakeResponse(url, body=b"b" * 2000)]}, max_bytes=1000)
        with self.assertRaises(fetch.FetchError):
            client.get(url)

    def test_retries_on_503_honouring_retry_after_then_succeeds(self):
        url = "https://a.test/feed"
        client, opener, clock = client_for({url: [http_error(url, 503, {"Retry-After": "7"}), FakeResponse(url, body=b"ok")]})
        self.assertEqual(client.get(url).body, b"ok")
        self.assertIn(7.0, clock.sleeps)
        self.assertEqual(len(opener.requests), 2)

    def test_no_retry_on_403_and_proxy_refusal(self):
        url = "https://a.test/feed"
        client, opener, _ = client_for({url: [http_error(url, 403)]})
        with self.assertRaises(fetch.FetchError) as ctx:
            client.get(url)
        self.assertEqual((ctx.exception.kind, ctx.exception.status), ("http", 403))
        self.assertEqual(len(opener.requests), 1)
        refusal = urllib.error.URLError(OSError("Tunnel connection failed: 403 Forbidden (agent proxy: no rule allows this host)"))
        client, opener, _ = client_for({url: [refusal]})
        with self.assertRaises(fetch.FetchError) as ctx:
            client.get(url)
        self.assertEqual(ctx.exception.kind, "proxy-refused")
        self.assertEqual(len(opener.requests), 1)

    def test_retries_are_bounded(self):
        url = "https://a.test/feed"
        client, opener, _ = client_for({url: [http_error(url, 500)]}, retries=2)
        with self.assertRaises(fetch.FetchError):
            client.get(url)
        self.assertEqual(len(opener.requests), 3)

    def test_304_is_returned_not_raised(self):
        url = "https://a.test/feed"
        client, _, _ = client_for({url: [http_error(url, 304)]})
        self.assertEqual(client.get(url, headers={"If-None-Match": '"x"'}).status, 304)


def parse_ok(body, source):
    return [{"title": body.decode(), "url": source["url"], "excerpt": "e"}], []


def parse_boom(body, source):
    raise ValueError("layout changed")


SOURCE = {"id": "a-feed", "url": "https://a.test/feed", "minRefetchMinutes": 30}
ROBOTS = "https://a.test/robots.txt"


class CollectTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = fetch.JsonStore(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def run_collect(self, routes, parse=parse_ok, now=NOW, extra=()):
        client, opener, _ = client_for(routes)
        robots = fetch.RobotsCache(client, self.store, now, extra_tokens=extra)
        cache = fetch.SourceCache(self.store)
        result = fetch.collect_source(SOURCE, parse, client, robots, cache, now, "v1")
        return result, opener

    def test_fetch_then_ttl_then_conditional_304(self):
        url = SOURCE["url"]
        routes = {ROBOTS: [FakeResponse(ROBOTS, body=b"User-agent: *\nDisallow: /private\n")],
                  url: [FakeResponse(url, body=b"first", headers={"ETag": '"abc"'})]}
        result, _ = self.run_collect(routes)
        self.assertEqual((result["status"], result["items"][0]["title"]), ("ok", "first"))
        result, opener = self.run_collect(routes, now=NOW + dt.timedelta(minutes=10))
        self.assertEqual(result["status"], "cached")
        self.assertEqual(opener.requests, [])  # robots cached too: nothing sent
        later = NOW + dt.timedelta(hours=2)
        result, opener = self.run_collect({url: [http_error(url, 304)]}, now=later)
        self.assertEqual(result["status"], "not-modified")
        self.assertEqual(result["items"][0]["title"], "first")
        self.assertEqual(opener.requests[-1].get_header("If-none-match"), '"abc"')

    def test_robots_disallow_skips(self):
        url = SOURCE["url"]
        routes = {ROBOTS: [FakeResponse(ROBOTS, body=b"User-agent: *\nDisallow: /feed\n")], url: [FakeResponse(url, body=b"x")]}
        result, opener = self.run_collect(routes)
        self.assertEqual(result["status"], "skipped")
        self.assertTrue(all(r.full_url != url for r in opener.requests))

    def test_extra_token_disallow_skips(self):
        url = SOURCE["url"]
        body = b"User-agent: *\nAllow: /\n\nUser-agent: Claude-User\nDisallow: /\n"
        routes = {ROBOTS: [FakeResponse(ROBOTS, body=body)], url: [FakeResponse(url, body=b"x")]}
        result, _ = self.run_collect(routes, extra=("Claude-User",))
        self.assertEqual(result["status"], "skipped")
        self.assertIn("Claude-User", result["error"])

    def test_robots_404_allows_and_500_blocks(self):
        url = SOURCE["url"]
        result, _ = self.run_collect({ROBOTS: [http_error(ROBOTS, 404)], url: [FakeResponse(url, body=b"x")]})
        self.assertEqual(result["status"], "ok")
        self.tearDown()
        self.setUp()
        result, opener = self.run_collect({ROBOTS: [http_error(ROBOTS, 500)], url: [FakeResponse(url, body=b"x")]})
        self.assertEqual(result["status"], "skipped")
        self.assertTrue(all(r.full_url != url for r in opener.requests))

    def test_parse_failure_is_an_error_not_a_crash_and_stale_cache_is_used(self):
        url = SOURCE["url"]
        result, _ = self.run_collect({ROBOTS: [http_error(ROBOTS, 404)], url: [FakeResponse(url, body=b"x")]}, parse=parse_boom)
        self.assertEqual(result["status"], "error")
        self.assertIn("layout changed", result["error"])
        self.run_collect({url: [FakeResponse(url, body=b"good")]}, now=NOW + dt.timedelta(hours=1))
        result, _ = self.run_collect({url: [http_error(url, 502)]}, now=NOW + dt.timedelta(hours=3))
        self.assertEqual(result["status"], "stale-cache")
        self.assertEqual(result["items"][0]["title"], "good")

    def test_proxy_refusal_is_skipped_and_not_retried_for_6_hours(self):
        url = SOURCE["url"]
        refusal = urllib.error.URLError(OSError("Tunnel connection failed: 403 Forbidden"))
        result, opener = self.run_collect({ROBOTS: [refusal], url: [refusal]})
        self.assertEqual(result["status"], "skipped")
        self.assertIn("robots", result["error"])
        self.assertEqual(len(opener.requests), 1)
        result, opener = self.run_collect({ROBOTS: [refusal], url: [refusal]}, now=NOW + dt.timedelta(hours=2))
        self.assertEqual((result["status"], len(opener.requests)), ("skipped", 0))
        result, opener = self.run_collect({ROBOTS: [refusal], url: [refusal]}, now=NOW + dt.timedelta(hours=7))
        self.assertEqual(len(opener.requests), 1)


if __name__ == "__main__":
    unittest.main()
