import unittest

from tests import helpers  # noqa: F401
from topiclib import score


class Outlier(unittest.TestCase):
    def test_ratio_and_floor(self):
        self.assertEqual(score.outlier_ratio(100000, 10000, 1000), (10.0, False))
        ratio, floored = score.outlier_ratio(14000, 40, 1000)
        self.assertEqual((ratio, floored), (14.0, True), "a 40-view median never yields a 350x outlier")
        self.assertEqual(score.outlier_ratio(5000, None, 1000), (5.0, True))
        self.assertEqual(score.outlier_ratio(None, 10, 1000), (None, False))

    def test_component_is_log_scaled_and_clamped(self):
        self.assertEqual(score.outlier_component(1.0, 32), 0.0)
        self.assertAlmostEqual(score.outlier_component(4.0, 32), 0.4)
        self.assertEqual(score.outlier_component(32.0, 32), 1.0)
        self.assertEqual(score.outlier_component(500.0, 32), 1.0)
        self.assertEqual(score.outlier_component(None, 32), 0.0)


class Components(unittest.TestCase):
    def test_recency_halves_every_half_life(self):
        self.assertEqual(score.recency_component(0, 30), 1.0)
        self.assertAlmostEqual(score.recency_component(30, 30), 0.5)
        self.assertAlmostEqual(score.recency_component(60, 30), 0.25)
        self.assertEqual(score.recency_component(None, 30), 0.0)

    def test_engagement(self):
        self.assertIsNone(score.engagement_rate(None, 5, 100), "hidden likes")
        self.assertIsNone(score.engagement_rate(5, 5, 0))
        self.assertAlmostEqual(score.engagement_rate(40, 10, 1000), 0.05)
        self.assertAlmostEqual(score.engagement_rate(40, None, 1000), 0.04, msg="disabled comments count as zero")
        self.assertEqual(score.engagement_component(None, 0.05), 0.5)
        self.assertEqual(score.engagement_component(0.05, 0.05), 0.5)
        self.assertEqual(score.engagement_component(0.10, 0.05), 1.0)
        self.assertEqual(score.engagement_component(0.025, 0.05), 0.0)

    def test_median_rates_per_format(self):
        cands = [{"format": "long", "engagementRate": r} for r in (0.02, 0.04, 0.06)] + [{"format": "short", "engagementRate": 0.01}, {"format": "short", "engagementRate": None}]
        self.assertEqual(score.median_rates(cands), {"long": 0.04, "short": 0.01})


class Rank(unittest.TestCase):
    def test_confidence_multiplies_each_flag_once(self):
        table = {"estimated-baseline": 0.6, "young-video": 0.9}
        self.assertAlmostEqual(score.confidence(["estimated-baseline", "young-video", "young-video", "unknown"], table), 0.54)

    def test_rank_bounds(self):
        weights = helpers.config()["scoring"]["weights"]
        self.assertAlmostEqual(sum(weights.values()), 1.0)
        top = score.rank({"outlier": 1, "recency": 1, "engagement": 1, "fit": 1}, weights, 1.0)
        self.assertEqual(top, 100.0)
        self.assertEqual(score.rank({}, weights, 1.0), 0.0)
        self.assertEqual(score.rank({"outlier": 1, "recency": 1, "engagement": 1, "fit": 1}, weights, 0.6), 60.0)


if __name__ == "__main__":
    unittest.main()
