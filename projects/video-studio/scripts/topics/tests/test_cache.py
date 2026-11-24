import datetime as dt
import json
import os
import tempfile
import unittest

from tests import helpers  # noqa: F401
from topiclib import cache

T0 = dt.datetime(2026, 11, 24, 12, tzinfo=dt.timezone.utc)


class Clock:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t


class DiskCacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.clock = Clock(T0)
        self.c = cache.DiskCache(self.tmp.name, {"search.list": 24, "videos.list": 48}, self.clock)

    def tearDown(self):
        self.tmp.cleanup()

    def test_round_trip_and_ttl(self):
        self.c.put("search.list", {"q": "a"}, {"videoIds": ["x"]})
        self.assertEqual(self.c.get("search.list", {"q": "a"}), {"videoIds": ["x"]})
        self.assertIsNone(self.c.get("search.list", {"q": "b"}))
        self.clock.t = T0 + dt.timedelta(hours=25)
        self.assertIsNone(self.c.get("search.list", {"q": "a"}), "expired after its 24 h TTL")
        self.assertEqual(self.c.stats()["hits"], 1)

    def test_ttl_never_exceeds_thirty_days(self):
        c = cache.DiskCache(self.tmp.name, {"videos.list": 24 * 365}, self.clock)
        c.put("videos.list", {"id": "v"}, {"views": 1})
        self.clock.t = T0 + dt.timedelta(days=29)
        self.assertIsNotNone(c.get("videos.list", {"id": "v"}))
        self.clock.t = T0 + dt.timedelta(days=31)
        self.assertIsNone(c.get("videos.list", {"id": "v"}))

    def test_key_never_depends_on_the_api_key(self):
        self.assertEqual(cache.DiskCache.key("search.list", {"q": "a", "key": "secret"}), cache.DiskCache.key("search.list", {"q": "a"}))
        self.c.put("search.list", {"q": "a", "key": "secret"}, {"ok": True})
        for root, _dirs, files in os.walk(self.tmp.name):
            for name in files:
                with open(os.path.join(root, name), encoding="utf-8") as fh:
                    self.assertNotIn("secret", fh.read())

    def test_corrupt_or_foreign_entries_are_misses(self):
        self.c.put("search.list", {"q": "a"}, {"ok": True})
        path = self.c._path("search.list", cache.DiskCache.key("search.list", {"q": "a"}))
        with open(path, "w") as fh:
            fh.write("{broken")
        self.assertIsNone(self.c.get("search.list", {"q": "a"}))

    def test_disabled_cache_reads_and_writes_nothing(self):
        c = cache.DiskCache(None, {}, self.clock)
        c.put("search.list", {"q": "a"}, {"x": 1})
        self.assertIsNone(c.get("search.list", {"q": "a"}))
        self.assertFalse(c.stats()["enabled"])


class Retention(unittest.TestCase):
    def test_prune_cache_deletes_entries_older_than_thirty_days(self):
        with tempfile.TemporaryDirectory() as tmp:
            clock = Clock(T0 - dt.timedelta(days=31))
            old = cache.DiskCache(tmp, {}, clock)
            old.put("videos.list", {"id": "old"}, {"v": 1})
            clock.t = T0 - dt.timedelta(days=2)
            old.put("videos.list", {"id": "new"}, {"v": 2})
            with open(os.path.join(tmp, "stray.json"), "w") as fh:
                fh.write("not json")
            deleted = cache.prune_cache(tmp, T0)
            self.assertEqual(deleted, 2, "the 31-day entry and the unreadable file")
            fresh = cache.DiskCache(tmp, {"videos.list": 24 * 30}, Clock(T0))
            self.assertIsNotNone(fresh.get("videos.list", {"id": "new"}))

    def test_retention_can_only_go_down(self):
        self.assertEqual(cache.clamp_days(90), 30)
        self.assertEqual(cache.clamp_days(7), 7)
        self.assertEqual(cache.clamp_days("nonsense"), 30)

    def test_prune_reports_by_run_date(self):
        with tempfile.TemporaryDirectory() as tmp:
            names = ["2026-10-20.json", "2026-10-20.md", "2026-10-20.backlog.zoora-ai.json", "2026-11-20.json", "notes.txt", "2026-13-40.json"]
            for n in names:
                with open(os.path.join(tmp, n), "w") as fh:
                    json.dump({}, fh)
            removed = cache.prune_reports(tmp, dt.date(2026, 11, 24))
            self.assertEqual(sorted(removed), ["2026-10-20.backlog.zoora-ai.json", "2026-10-20.json", "2026-10-20.md"])
            self.assertEqual(sorted(os.listdir(tmp)), ["2026-11-20.json", "2026-13-40.json", "notes.txt"])


if __name__ == "__main__":
    unittest.main()
