import datetime as dt
import unittest

from tests import helpers
from topiclib import baseline

NOW = helpers.NOW
CFG = helpers.config()["baseline"]
FMT = helpers.config()["format"]


def iso(days_ago):
    return (NOW - dt.timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")


def up(i, days, views, fmt="long", live="none"):
    w, h, dur = (640, 360, 600) if fmt == "long" else (203, 360, 40)
    return {"id": f"u{i}", "publishedAt": iso(days), "views": views, "durationSec": dur, "embedWidth": w, "embedHeight": h, "liveBroadcastContent": live}


def candidate(days=20, views=100000, fmt="long", vid="cand"):
    return {"id": vid, "publishedAt": iso(days), "views": views, "format": fmt}


class SameFormat(unittest.TestCase):
    def test_median_of_recent_same_format_uploads(self):
        uploads = [up(i, 10 + i * 5, 1000 * (i + 1)) for i in range(9)]  # 1k..9k long-form, all after 2026-08-27
        uploads += [up(100 + i, 12 + i * 5, 500000, fmt="short") for i in range(9)]
        b = baseline.compute(candidate(), uploads, None, NOW, CFG, FMT)
        self.assertEqual((b["method"], b["median"], b["n"], b["format"]), ("median-same-format", 5000.0, 9, "long"))
        self.assertEqual(b["flags"], [])
        self.assertIsNotNone(b["p25"])

    def test_excludes_candidate_young_old_and_live(self):
        uploads = [up(i, 10 + i * 4, 4000) for i in range(6)]
        uploads += [
            dict(up(90, 20, 10 ** 7), id="cand"),  # the candidate itself
            up(91, 3, 10 ** 7),  # younger than 7 days
            up(92, 400, 10 ** 7),  # older than 365 days
            up(93, 15, 10 ** 7, live="upcoming"),
            dict(up(94, 15, 0), views=None),
        ]
        b = baseline.compute(candidate(), uploads, None, NOW, CFG, FMT)
        self.assertEqual((b["median"], b["n"]), (4000.0, 6))

    def test_caps_the_sample_at_max_videos_most_recent_first(self):
        uploads = [up(i, 8 + i, 1000 if i < 30 else 99999) for i in range(40)]
        b = baseline.compute(candidate(), uploads, None, NOW, dict(CFG, maxVideos=30), FMT)
        self.assertEqual((b["n"], b["median"]), (30, 1000.0))


class Epochs(unittest.TestCase):
    def test_prefers_uploads_under_the_same_view_counting_rules(self):
        new = [up(i, 10 + i * 10, 9000) for i in range(5)]  # after 2026-08-27
        old = [up(50 + i, 100 + i * 5, 3000) for i in range(20)]  # before it
        b = baseline.compute(candidate(days=5), new + old, None, NOW, CFG, FMT)
        self.assertEqual((b["median"], b["n"], b["epoch"]), (9000.0, 5, "2026-08-27"))
        self.assertNotIn("baseline-spans-view-count-change", b["flags"])

    def test_flags_a_baseline_that_spans_the_change(self):
        new = [up(i, 20 + i * 20, 9000) for i in range(3)]
        old = [up(50 + i, 100 + i * 5, 3000) for i in range(20)]
        b = baseline.compute(candidate(days=5), new + old, None, NOW, CFG, FMT)
        self.assertIn("baseline-spans-view-count-change", b["flags"])
        self.assertEqual(b["median"], 3000.0)

    def test_epoch_start_per_format(self):
        pub = dt.datetime(2026, 1, 10, tzinfo=dt.timezone.utc)
        self.assertEqual(baseline.epoch_start("short", pub).date().isoformat(), "2025-03-31")
        self.assertIsNone(baseline.epoch_start("long", pub))


class Fallbacks(unittest.TestCase):
    def test_thin_then_mixed(self):
        thin = [up(i, 10 + i * 5, 2000) for i in range(3)]
        b = baseline.compute(candidate(), thin, None, NOW, CFG, FMT)
        self.assertEqual((b["method"], b["flags"]), ("median-same-format", ["thin-baseline"]))
        mixed = [up(i, 10 + i * 5, 2000) for i in range(2)] + [up(10 + i, 12 + i * 5, 80000, fmt="short") for i in range(6)]
        b = baseline.compute(candidate(), mixed, None, NOW, CFG, FMT)
        self.assertEqual((b["method"], b["format"]), ("median-mixed-format", "mixed"))
        self.assertIn("mixed-format-baseline", b["flags"])

    def test_lifetime_average_leaves_the_candidate_out(self):
        channel = {"viewCount": 38000, "videoCount": 2}
        b = baseline.compute(candidate(views=35000), [], channel, NOW, CFG, FMT)
        self.assertEqual((b["method"], b["median"]), ("lifetime-average", 3000.0))
        self.assertIn("estimated-baseline", b["flags"])

    def test_no_baseline_at_all(self):
        b = baseline.compute(candidate(), None, {"viewCount": 10, "videoCount": 1}, NOW, CFG, FMT, uploads_note="the uploads playlist could not be read")
        self.assertEqual((b["method"], b["median"]), ("none", None))
        self.assertIn("the uploads playlist could not be read", b["notes"])
        self.assertEqual(baseline.lifetime_estimate(None, 5), (None, "no channel statistics"))
        self.assertEqual(baseline.lifetime_estimate({"viewCount": None, "videoCount": 4}, 5)[0], None)


if __name__ == "__main__":
    unittest.main()
