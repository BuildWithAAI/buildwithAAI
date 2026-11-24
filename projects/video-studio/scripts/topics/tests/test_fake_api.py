import unittest

from tests import helpers
from topiclib import contracts
from topiclib.fake_api import FakeError, FakeYouTube
from topiclib.http import ApiError


def fake(**kw):
    return FakeYouTube(helpers.db(), errors_dir=helpers.ERRORS, **kw)


class Validation(unittest.TestCase):
    """The fake rejects what the real API documents as errors, so client bugs fail tests."""

    def assert_kind(self, method, params, kind):
        with self.assertRaises(ApiError) as ctx:
            fake().get(method, params)
        self.assertEqual(ctx.exception.kind, kind, ctx.exception)
        return ctx.exception

    def test_documented_errors(self):
        self.assert_kind("search.list", {"q": "x"}, "bad-request")  # no part
        self.assert_kind("search.list", {"part": "snippet", "q": "x", "maxResults": "51"}, "bad-request")
        self.assert_kind("search.list", {"part": "snippet", "q": "x", "maxresults": "5"}, "bad-request")  # unknown param
        self.assert_kind("search.list", {"part": "snippet", "q": "x", "relevanceLanguage": "Spanish"}, "bad-request")
        self.assert_kind("search.list", {"part": "snippet", "q": "x", "videoDuration": "short"}, "bad-request")  # needs type=video
        self.assert_kind("videos.list", {"part": "snippet", "id": ",".join(f"v{i}" for i in range(51))}, "bad-request")
        self.assert_kind("videos.list", {"part": "snippet", "id": "a", "maxResults": "5"}, "bad-request")
        self.assert_kind("videos.list", {"part": "snipet", "id": "a"}, "bad-request")
        self.assert_kind("playlistItems.list", {"part": "contentDetails", "playlistId": "UUnope"}, "not-found")
        self.assert_kind("search.list", {"part": "snippet", "q": "x", "fields": "items(id"}, "bad-request")

    def test_the_key_must_not_travel_in_the_query(self):
        with self.assertRaises(FakeError):
            fake().get("videos.list", {"part": "id", "id": "a", "key": "secret"})


class Resources(unittest.TestCase):
    def test_counts_are_strings_and_player_size_needs_max_height(self):
        vid = helpers.fixture_video("clean long-form outlier")["id"]
        f = fake()
        plain = f.get("videos.list", {"part": "statistics,player", "id": vid})["items"][0]
        self.assertIsInstance(plain["statistics"]["viewCount"], str)
        self.assertNotIn("embedWidth", plain["player"])
        sized = f.get("videos.list", {"part": "player", "id": vid, "maxHeight": "360"})["items"][0]
        self.assertEqual((sized["player"]["embedWidth"], sized["player"]["embedHeight"]), ("640", "360"))

    def test_hidden_counts_are_omitted(self):
        vid = helpers.fixture_video("likes hidden")["id"]
        stats = fake().get("videos.list", {"part": "statistics", "id": vid})["items"][0]["statistics"]
        self.assertNotIn("likeCount", stats)
        hidden = [c for c in helpers.db()["channels"] if c.get("hiddenSubscriberCount")][0]
        ch = fake().get("channels.list", {"part": "statistics", "id": hidden["id"]})["items"][0]
        self.assertNotIn("subscriberCount", ch["statistics"])
        self.assertTrue(ch["statistics"]["hiddenSubscriberCount"])

    def test_unknown_ids_are_simply_absent(self):
        self.assertEqual(fake().get("videos.list", {"part": "id", "id": "doesnotexist"})["items"], [])

    def test_fields_are_applied(self):
        vid = helpers.fixture_video("clean long-form outlier")["id"]
        body = fake().get("videos.list", {"part": "snippet,statistics", "id": vid, "fields": "items(id,statistics(viewCount))"})
        self.assertEqual(set(body), {"items"})
        self.assertEqual(set(body["items"][0]), {"id", "statistics"})


class Search(unittest.TestCase):
    def search(self, **params):
        base = {"part": "snippet", "type": "video", "maxResults": "50"}
        base.update(params)
        return fake().get("search.list", base)

    def test_or_terms_window_language_and_order(self):
        body = self.search(q="wallet drainer|airdrop", order="viewCount", publishedAfter="2026-08-26T00:00:00Z", relevanceLanguage="en")
        ids = [i["id"].get("videoId") for i in body["items"] if i["id"]["kind"] == "youtube#video"]
        # the out-of-window upload must never appear
        self.assertNotIn(next(v["id"] for v in helpers.db()["videos"] if v["title"].startswith("Wallet drainer basics (old upload)")), ids)
        views = [next(v["viewCount"] for v in helpers.db()["videos"] if v["id"] == i) for i in ids]
        self.assertEqual(views, sorted(views, reverse=True))
        self.assertTrue(any(i["id"]["kind"] == "youtube#channel" for i in body["items"]), "the loosened type filter injects a channel result")

    def test_exclusion_and_language(self):
        es = self.search(q="estafa deepfake", relevanceLanguage="es")
        self.assertEqual(len([i for i in es["items"] if i["id"]["kind"] == "youtube#video"]), 1)
        none = self.search(q="estafa deepfake -sorteo", relevanceLanguage="es")
        self.assertEqual(none["items"], [])

    def test_pagination(self):
        first = self.search(q="crypto security|crypto scam|wallet security", maxResults="2", order="viewCount")
        self.assertIn("nextPageToken", first)
        second = self.search(q="crypto security|crypto scam|wallet security", maxResults="2", order="viewCount", pageToken=first["nextPageToken"])
        self.assertNotEqual(first["items"][0]["id"], second["items"][0]["id"])
        self.assertEqual(first["pageInfo"]["resultsPerPage"], 2)
        with self.assertRaises(ApiError):
            self.search(q="x", pageToken="garbage!")


class Failures(unittest.TestCase):
    def test_injected_failures_fire_after_n_calls(self):
        f = fake(failures=[{"method": "videos.list", "after": 1, "times": 1, "error": "quotaExceeded"}])
        f.get("videos.list", {"part": "id", "id": "a"})
        with self.assertRaises(ApiError) as ctx:
            f.get("videos.list", {"part": "id", "id": "a"})
        self.assertEqual(ctx.exception.kind, "quota")
        f.get("videos.list", {"part": "id", "id": "a"})
        self.assertEqual(f.counts["videos.list"], 3)

    def test_contract_parts_are_all_valid(self):
        vid = helpers.fixture_video("clean long-form outlier")["id"]
        for key in ("videos.list", "videos.list:baseline"):
            fake().get("videos.list", {"part": contracts.PARTS[key], "id": vid, "fields": contracts.FIELDS[key], "maxHeight": "360"})


if __name__ == "__main__":
    unittest.main()
