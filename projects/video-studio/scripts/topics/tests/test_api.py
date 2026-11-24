import datetime as dt
import tempfile
import unittest

from tests import helpers
from topiclib import cache as cache_mod
from topiclib import contracts, quota
from topiclib.api import BudgetExceeded, YouTubeClient, normalize_channel, normalize_video, to_int
from topiclib.fake_api import FakeYouTube
from topiclib.http import ApiError, classify_error
import json

AFTER = dt.datetime(2026, 8, 26, tzinfo=dt.timezone.utc)


def table():
    return quota.QuotaTable.load(helpers.QUOTA)


def client(caps=None, failures=None, cache=None, page_size=50, script=None):
    fake = FakeYouTube(helpers.db(), failures=failures, errors_dir=helpers.ERRORS)
    transport = helpers.RecordingTransport(fake, script)
    budget = quota.QuotaBudget(table(), caps or {"default": 2000, "search": 30})
    sleeps = []
    c = YouTubeClient(transport, budget, cache, sleep=sleeps.append, rng=lambda: 0.5, page_size=page_size)
    return c, transport, budget, sleeps


def api_error(name, method="videos.list"):
    body = helpers.error_body(name)
    return classify_error(method, body["error"]["code"], json.dumps(body).encode())


class Search(unittest.TestCase):
    def test_parameters_follow_the_contract(self):
        c, t, b, _ = client()
        res = c.search("wallet drainer|airdrop", AFTER, order="viewCount", relevance_language="en")
        method, params = t.calls[0]
        self.assertEqual(method, "search.list")
        self.assertEqual(params["type"], "video")
        self.assertEqual(params["order"], "viewCount")
        self.assertEqual(params["publishedAfter"], "2026-08-26T00:00:00Z")
        self.assertEqual(params["maxResults"], "50")
        self.assertEqual(params["fields"], contracts.FIELDS["search.list"])
        self.assertEqual(params["relevanceLanguage"], "en")
        self.assertNotIn("key", params)
        self.assertGreater(len(res["ids"]), 3)
        self.assertEqual(res["nonVideo"], 1, "the injected channel result is filtered out")
        self.assertEqual(b.spent, {"default": 0, "search": 1})

    def test_pages_follow_next_page_token_and_each_costs_a_call(self):
        c, t, b, _ = client(page_size=2)
        res = c.search("crypto security|crypto scam|wallet security", AFTER, pages=3)
        self.assertEqual(res["pages"], 3)
        self.assertEqual(b.spent["search"], 3)
        self.assertEqual(len(res["ids"]), len(set(res["ids"])))
        self.assertIn("pageToken", t.calls[1][1])

    def test_cache_hit_costs_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = cache_mod.DiskCache(tmp, {"search.list": 24}, lambda: helpers.NOW)
            c1, _t1, b1, _ = client(cache=store)
            first = c1.search("rug pull", AFTER)
            c2, t2, b2, _ = client(cache=store)
            second = c2.search("rug pull", AFTER)
            self.assertEqual(first["ids"], second["ids"])
            self.assertEqual((b1.spent["search"], b2.spent["search"], len(t2.calls)), (1, 0, 0))

    def test_budget_refuses_before_sending(self):
        c, t, b, _ = client(caps={"default": 10, "search": 0})
        with self.assertRaises(BudgetExceeded):
            c.search("rug pull", AFTER)
        self.assertEqual(t.calls, [])

    def test_later_pages_stop_at_the_cap_but_keep_page_one(self):
        c, t, b, _ = client(caps={"default": 10, "search": 1}, page_size=2)
        res = c.search("crypto security|crypto scam|wallet security", AFTER, pages=3)
        self.assertEqual((res["pages"], len(res["ids"])), (1, 2))
        self.assertEqual(c.stopped[0]["method"], "search.list")


class Videos(unittest.TestCase):
    def test_chunks_of_at_most_fifty_and_per_id_cache(self):
        ids = [v["id"] for v in helpers.db()["videos"]][:120]
        with tempfile.TemporaryDirectory() as tmp:
            store = cache_mod.DiskCache(tmp, {"videos.list": 24}, lambda: helpers.NOW)
            c, t, b, _ = client(cache=store)
            out = c.videos(ids)
            self.assertEqual(len(out), 120)
            self.assertEqual([len(p["id"].split(",")) for _m, p in t.calls], [50, 50, 20])
            self.assertEqual(b.spent["default"], 3)
            for _m, p in t.calls:
                self.assertEqual(p["maxHeight"], str(contracts.PLAYER_MAX_HEIGHT))
                self.assertNotIn("maxResults", p)
            c2, t2, b2, _ = client(cache=store)
            c2.videos(ids[:60] + ["unknownvid01"])
            self.assertEqual([p["id"] for _m, p in t2.calls], ["unknownvid01"], "only the uncached id is fetched")

    def test_baseline_records_never_satisfy_a_full_request(self):
        vid = helpers.fixture_video("clean long-form outlier")["id"]
        with tempfile.TemporaryDirectory() as tmp:
            store = cache_mod.DiskCache(tmp, {"videos.list": 24}, lambda: helpers.NOW)
            c, t, _b, _ = client(cache=store)
            base = c.videos([vid], detail="baseline")[vid]
            self.assertNotIn("title", base)
            full = c.videos([vid], detail="full")[vid]
            self.assertTrue(full["title"])
            self.assertEqual(len(t.calls), 2)
            self.assertEqual(t.calls[0][1]["fields"], contracts.FIELDS["videos.list:baseline"])
            c.videos([vid], detail="baseline")
            self.assertEqual(len(t.calls), 2, "a cached full record also serves a baseline request")

    def test_retries_charge_every_attempt_and_back_off(self):
        vid = helpers.fixture_video("clean long-form outlier")["id"]
        c, t, b, sleeps = client(script=[{"method": "videos.list", "error": api_error("backendError")}, {"method": "videos.list", "error": api_error("rateLimitExceeded")}])
        out = c.videos([vid])
        self.assertIn(vid, out)
        self.assertEqual(len(t.calls), 3)
        self.assertEqual(b.spent["default"], 3, "Google counts failed requests too")
        self.assertEqual(len(sleeps), 2)

    def test_quota_exceeded_stops_the_bucket(self):
        ids = [v["id"] for v in helpers.db()["videos"]][:120]
        c, t, b, _ = client(failures=[{"method": "videos.list", "after": 1, "times": 1, "error": "quotaExceeded"}])
        out = c.videos(ids)
        self.assertEqual(len(out), 50, "the first chunk survives; the rest stop")
        self.assertIn("default", b.exhausted)
        sent = len(t.calls)
        self.assertEqual(c.channels(["UCany"]), {}, "later calls in the exhausted bucket are never sent")
        self.assertEqual(len(t.calls), sent)
        self.assertEqual(c.stopped[-1]["method"], "channels.list")

    def test_cap_mid_way_keeps_partial_results(self):
        ids = [v["id"] for v in helpers.db()["videos"]][:120]
        c, t, b, _ = client(caps={"default": 2, "search": 0})
        out = c.videos(ids)
        self.assertEqual(len(out), 100)
        self.assertEqual(c.stopped[0]["unfetched"], 20)

    def test_auth_errors_propagate(self):
        c, _t, _b, _ = client(script=[{"method": "videos.list", "error": api_error("keyInvalid")}])
        with self.assertRaises(ApiError) as ctx:
            c.videos(["x"])
        self.assertEqual(ctx.exception.kind, "auth")


class ChannelsAndUploads(unittest.TestCase):
    def test_channels_normalized(self):
        hidden = [ch for ch in helpers.db()["channels"] if ch.get("hiddenSubscriberCount")][0]
        c, t, _b, _ = client()
        rec = c.channels([hidden["id"]])[hidden["id"]]
        self.assertIsNone(rec["subscriberCount"])
        self.assertEqual(rec["uploadsPlaylistId"], "UU" + hidden["id"][2:])
        self.assertNotIn("maxResults", t.calls[0][1])

    def test_uploads_and_missing_playlist(self):
        chans = {ch["key"]: ch for ch in helpers.db()["channels"]}
        c, t, b, _ = client()
        items = c.uploads(chans["ChainSafetyLab"]["uploadsPlaylistId"])
        self.assertEqual(len(items), 38)
        self.assertTrue(all(i["videoPublishedAt"] for i in items))
        gone = chans["PlaylistGone"]["uploadsPlaylistId"]
        self.assertIsNone(c.uploads(gone))
        self.assertEqual(c.errors[-1]["reason"], "playlistNotFound")

    def test_missing_playlist_is_cached(self):
        gone = [ch for ch in helpers.db()["channels"] if ch.get("uploadsMissing")][0]["uploadsPlaylistId"]
        with tempfile.TemporaryDirectory() as tmp:
            store = cache_mod.DiskCache(tmp, {"playlistItems.list": 24}, lambda: helpers.NOW)
            c, _t, _b, _ = client(cache=store)
            self.assertIsNone(c.uploads(gone))
            c2, t2, b2, _ = client(cache=store)
            self.assertIsNone(c2.uploads(gone))
            self.assertEqual((len(t2.calls), b2.spent["default"]), (0, 0))


class Normalize(unittest.TestCase):
    def test_to_int(self):
        self.assertEqual(to_int("123"), 123)
        self.assertIsNone(to_int(None))
        self.assertIsNone(to_int(True))
        self.assertIsNone(to_int("1e3"))

    def test_records(self):
        self.assertIsNone(normalize_video({}))
        v = normalize_video({"id": "a", "snippet": {"title": "t", "tags": ["x"] * 40, "description": "d" * 900}, "statistics": {"viewCount": "9"}, "contentDetails": {"duration": "PT1M"}})
        self.assertEqual((v["views"], v["durationSec"], len(v["tags"]), len(v["description"])), (9, 60, 25, 600))
        self.assertIsNone(normalize_channel({"snippet": {}}))


if __name__ == "__main__":
    unittest.main()
