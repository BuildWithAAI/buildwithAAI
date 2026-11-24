import datetime as dt
import json
import os
import tempfile
import unittest

from tests import helpers
from topiclib import quota


def table():
    return quota.QuotaTable.load(helpers.QUOTA)


class Table(unittest.TestCase):
    def test_committed_table_matches_the_verified_costs(self):
        t = table()
        self.assertEqual(t.cost("search.list"), ("search", 1))
        for method in ("videos.list", "channels.list", "playlistItems.list"):
            self.assertEqual(t.cost(method), ("default", 1))
        self.assertEqual(t.daily_limits, {"default": 10000, "search": 100})
        self.assertEqual(t.reset_time_zone, "America/Los_Angeles")

    def test_bad_tables_are_refused(self):
        good = helpers.load_json(helpers.QUOTA)
        broken = [
            dict(good, version=2),
            dict(good, dailyLimits={}),
            dict(good, methods={"search.list": {"bucket": "nope", "cost": 1}}),
            dict(good, methods={"search.list": {"bucket": "search", "cost": 0}}),
            dict(good, methods={"search.list": {"bucket": "search", "cost": True}}),
        ]
        for data in broken:
            with self.assertRaises(quota.QuotaConfigError):
                quota.QuotaTable(data)

    def test_unknown_method_has_no_cost(self):
        with self.assertRaises(quota.QuotaConfigError):
            table().cost("videos.insert")

    def test_legacy_accounting_is_a_table_edit(self):
        data = helpers.load_json(helpers.QUOTA)
        data["methods"]["search.list"] = {"bucket": "default", "cost": 100}
        b = quota.QuotaBudget(quota.QuotaTable(data), {"default": 250, "search": 0})
        b.charge("search.list")
        b.charge("search.list")
        with self.assertRaises(quota.BudgetExceeded):
            b.charge("search.list")
        self.assertEqual(b.spent["default"], 200)


class Budget(unittest.TestCase):
    def test_charges_before_sending_and_never_crosses_the_cap(self):
        b = quota.QuotaBudget(table(), {"default": 2, "search": 1})
        b.charge("videos.list")
        b.charge("channels.list")
        with self.assertRaises(quota.BudgetExceeded) as ctx:
            b.charge("playlistItems.list")
        self.assertEqual(ctx.exception.bucket, "default")
        b.charge("search.list")
        self.assertFalse(b.affordable("search.list"))
        self.assertEqual(b.spent, {"default": 2, "search": 1})
        self.assertEqual(b.refused["playlistItems.list"], 1)

    def test_every_bucket_needs_a_cap(self):
        with self.assertRaises(quota.QuotaConfigError):
            quota.QuotaBudget(table(), {"default": 10})

    def test_exhausted_bucket_refuses_everything(self):
        b = quota.QuotaBudget(table(), {"default": 100, "search": 100})
        b.mark_exhausted("search.list")
        self.assertFalse(b.affordable("search.list"))
        with self.assertRaises(quota.BudgetExceeded) as ctx:
            b.charge("search.list")
        self.assertEqual(ctx.exception.reason, "exhausted")
        self.assertTrue(b.affordable("videos.list"))

    def test_affordable_all_sums_within_a_bucket(self):
        b = quota.QuotaBudget(table(), {"default": 3, "search": 0})
        b.charge("videos.list")
        self.assertTrue(b.affordable_all([("playlistItems.list", 1), ("videos.list", 1)]))
        b.charge("videos.list")
        self.assertFalse(b.affordable_all([("playlistItems.list", 1), ("videos.list", 1)]))


class LedgerTests(unittest.TestCase):
    def test_days_follow_pacific_time(self):
        # 07:59 UTC on 2026-11-24 is still 2026-11-23 in Los Angeles (PST, UTC-8); 08:00 UTC is the new day.
        before = quota.Ledger(None, now_fn=lambda: dt.datetime(2026, 11, 24, 7, 59, tzinfo=dt.timezone.utc))
        after = quota.Ledger(None, now_fn=lambda: dt.datetime(2026, 11, 24, 8, 0, tzinfo=dt.timezone.utc))
        self.assertEqual(before.day_key(), "2026-11-23")
        self.assertEqual(after.day_key(), "2026-11-24")
        summer = quota.Ledger(None, now_fn=lambda: dt.datetime(2026, 7, 1, 7, 0, tzinfo=dt.timezone.utc))
        self.assertEqual(summer.day_key(), "2026-07-01", "PDT is UTC-7, so 07:00 UTC is midnight")

    def test_persists_and_feeds_the_caps(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "ledger.json")
            now = lambda: dt.datetime(2026, 11, 24, 12, tzinfo=dt.timezone.utc)  # noqa: E731
            led = quota.Ledger(path, now_fn=now)
            b = quota.QuotaBudget(table(), {"default": 10, "search": 10}, led)
            for _ in range(3):
                b.charge("search.list")
            again = quota.Ledger(path, now_fn=now)
            self.assertEqual(again.spent_today("search"), 3)
            caps, notes = quota.effective_caps(table(), {"default": 2000, "search": 100}, again)
            self.assertEqual(caps["search"], 97)
            self.assertEqual(caps["default"], 2000)
            self.assertTrue(any("search" in n for n in notes))
            with open(path, encoding="utf-8") as fh:
                self.assertEqual(json.load(fh)["timeZone"], "America/Los_Angeles")

    def test_unreadable_ledger_starts_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "ledger.json")
            with open(path, "w") as fh:
                fh.write("{not json")
            self.assertEqual(quota.Ledger(path).spent_today("search"), 0)


if __name__ == "__main__":
    unittest.main()
