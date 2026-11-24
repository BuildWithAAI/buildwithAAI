import email.message
import gzip
import io
import json
import socket
import unittest
import urllib.error
import urllib.parse

from tests import helpers
from topiclib import contracts
from topiclib.http import ApiError, UrllibTransport, classify_error, scrub


def headers(**kv):
    h = email.message.Message()
    for k, v in kv.items():
        h[k.replace("_", "-")] = v
    return h


class FakeResponse:
    def __init__(self, body, hdrs=None):
        self.body = body
        self.headers = hdrs or headers()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeOpener:
    def __init__(self, outcome):
        self.outcome = outcome
        self.requests = []

    def open(self, req, timeout=None):
        self.requests.append(req)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def http_error(code, body, hdrs=None):
    return urllib.error.HTTPError("https://youtube.googleapis.com/youtube/v3/search", code, "error", hdrs or headers(), io.BytesIO(body))


class Requests(unittest.TestCase):
    def test_key_goes_in_the_header_never_the_url(self):
        opener = FakeOpener(FakeResponse(b'{"items": []}'))
        t = UrllibTransport(helpers.FAKE_KEY, opener=opener)
        self.assertEqual(t.get("search.list", {"part": "snippet", "q": "rug pull|drainer"}), {"items": []})
        req = opener.requests[0]
        self.assertTrue(req.full_url.startswith(contracts.API_ROOT + "/search?"))
        self.assertNotIn(helpers.FAKE_KEY, req.full_url)
        self.assertEqual(req.get_header("X-goog-api-key"), helpers.FAKE_KEY)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(req.full_url).query)
        self.assertEqual(query["q"], ["rug pull|drainer"])
        self.assertIn("%7C", req.full_url, "the OR pipe is sent URL-escaped, as the search.list docs require")
        self.assertEqual(query["prettyPrint"], ["false"])
        self.assertEqual(req.get_header("Accept-encoding"), "gzip")

    def test_key_in_query_fallback(self):
        opener = FakeOpener(FakeResponse(b"{}"))
        UrllibTransport(helpers.FAKE_KEY, opener=opener, key_in_query=True).get("videos.list", {"part": "id", "id": "x"})
        req = opener.requests[0]
        self.assertIn("key=", req.full_url)
        self.assertIsNone(req.get_header("X-goog-api-key"))

    def test_gzip_bodies_are_decoded(self):
        body = gzip.compress(json.dumps({"items": [1]}).encode())
        opener = FakeOpener(FakeResponse(body, headers(Content_Encoding="gzip")))
        self.assertEqual(UrllibTransport("k", opener=opener).get("videos.list", {}), {"items": [1]})

    def test_empty_key_is_refused(self):
        with self.assertRaises(ValueError):
            UrllibTransport("")

    def test_non_json_success_is_invalid(self):
        with self.assertRaises(ApiError) as ctx:
            UrllibTransport("k", opener=FakeOpener(FakeResponse(b"<html>"))).get("videos.list", {})
        self.assertEqual(ctx.exception.kind, "invalid-response")

    def test_network_errors_are_retriable_and_scrubbed(self):
        err = urllib.error.URLError(f"tunnel failed for key={helpers.FAKE_KEY}")
        with self.assertRaises(ApiError) as ctx:
            UrllibTransport(helpers.FAKE_KEY, opener=FakeOpener(err)).get("search.list", {})
        self.assertEqual(ctx.exception.kind, "network")
        self.assertTrue(ctx.exception.retriable)
        self.assertNotIn(helpers.FAKE_KEY, str(ctx.exception))
        with self.assertRaises(ApiError) as ctx:
            UrllibTransport("k", opener=FakeOpener(socket.timeout("timed out"))).get("search.list", {})
        self.assertEqual(ctx.exception.kind, "network")


class Errors(unittest.TestCase):
    def kind(self, name, status=None):
        body = helpers.error_body(name)
        return classify_error("search.list", status or body["error"]["code"], json.dumps(body).encode())

    def test_fixture_envelopes(self):
        expected = {
            "quotaExceeded": ("quota", False),
            "keyInvalid": ("auth", False),
            "accessNotConfigured": ("auth", False),
            "backendError": ("server", True),
            "rateLimitExceeded": ("rate", True),
            "playlistNotFound": ("not-found", False),
            "forbidden-no-key-recorded-2026-11-24": ("auth", False),
        }
        for name, (kind, retriable) in expected.items():
            with self.subTest(name=name):
                err = self.kind(name)
                self.assertEqual((err.kind, err.retriable), (kind, retriable))

    def test_html_is_stripped_from_messages(self):
        self.assertNotIn("<a", self.kind("quotaExceeded").detail)

    def test_proxy_refusal_is_blocked_not_auth(self):
        err = classify_error("search.list", 403, b"request blocked: no rule allows host youtube.googleapis.com")
        self.assertEqual(err.kind, "blocked")
        self.assertEqual(classify_error("search.list", 502, b"Bad gateway").kind, "server")
        self.assertEqual(classify_error("search.list", 400, b"").kind, "bad-request")

    def test_http_error_path_and_retry_after(self):
        body = json.dumps(helpers.error_body("rateLimitExceeded")).encode()
        opener = FakeOpener(http_error(429, body, headers(Retry_After="7")))
        with self.assertRaises(ApiError) as ctx:
            UrllibTransport("k", opener=opener).get("search.list", {})
        self.assertEqual((ctx.exception.kind, ctx.exception.retry_after), ("rate", 7.0))

    def test_scrub_removes_plain_and_quoted_keys(self):
        secret = "ab/c+d"
        self.assertEqual(scrub(f"x {secret} y {urllib.parse.quote(secret, safe='')}", secret), "x [redacted] y [redacted]")


if __name__ == "__main__":
    unittest.main()
