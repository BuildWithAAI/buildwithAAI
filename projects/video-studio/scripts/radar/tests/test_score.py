import datetime as dt
import unittest

from radarlib import score

from .test_cluster import mention

RUN = dt.date(2026, 11, 24)
WINDOW_START = dt.date(2026, 11, 22)


def incident(**kw):
    base = {"type": "exploit", "dateUtc": "2026-11-23", "reportedLosses": [], "sources": [], "evergreenTopic": None,
            "status": "confirmed", "mechanismKnown": True}
    base.update(kw)
    return base


class Factors(unittest.TestCase):
    def test_loss_uses_lowest_figure_of_best_tier_and_never_averages(self):
        losses = [{"amountUsd": 5.7e6, "by": "slowmist-hacked", "tier": "A"},
                  {"amountUsd": 1.04e6, "by": "defillama-hacks", "tier": "A"},
                  {"amountUsd": 50e6, "by": "rumour-site", "tier": "C"}]
        value, reason = score.loss_factor(incident(reportedLosses=losses))
        self.assertAlmostEqual(value, score.log_scale(1.04e6))
        self.assertIn("lowest tier-A figure $1.04M (defillama-hacks)", reason)
        self.assertEqual(score.loss_factor(incident())[0], 0.0)
        only_c = [{"amountUsd": 2e6, "by": "agg", "tier": "C"}]
        self.assertIn("tier-C", score.loss_factor(incident(reportedLosses=only_c))[1])

    def test_recency_decays_after_24h_and_prefers_tier_ab(self):
        fresh = mention("b", "B", date=dt.date(2026, 11, 24))
        self.assertEqual(score.recency_factor([fresh], RUN)[0], 1.0)
        mid = mention("b", "B", date=dt.date(2026, 11, 21))   # 87 h before the end of the run date
        self.assertAlmostEqual(score.recency_factor([mid], RUN)[0], 1 - (87 - 24) / 72)
        old = mention("b", "B", date=dt.date(2026, 11, 20))
        self.assertEqual(score.recency_factor([old], RUN)[0], 0.0)
        newer_c = mention("c", "C", date=dt.date(2026, 11, 24))
        self.assertEqual(score.recency_factor([old, newer_c], RUN)[0], 0.0, "tier C alone cannot freshen an incident")

    def test_sources_weight_independent_publishers(self):
        value, reason = score.sources_factor([mention("a", "A"), mention("b", "B"), mention("b2", "B", publisher="b")])
        self.assertAlmostEqual(value, (1.0 + 0.6) / 2.5)
        self.assertIn("2 independent publisher(s)", reason)

    def test_novelty_branches(self):
        new = incident(dateUtc="2026-11-23")
        self.assertEqual(score.novelty_factor(new, None, RUN, WINDOW_START, {})[0], 1.0)
        recent = incident(dateUtc="2026-11-18")
        self.assertEqual(score.novelty_factor(recent, None, RUN, WINDOW_START, {})[0], 0.6)
        old = incident(dateUtc="2026-10-29")
        value, reason = score.novelty_factor(old, None, RUN, WINDOW_START, {"exploit": 3})
        self.assertEqual(value, 0.4)
        self.assertIn("3 other exploit incident(s)", reason)
        previous = {"radarDate": "2026-11-23", "top": True, "urls": {"https://a.test/1"}}
        same = incident(sources=[{"url": "https://a.test/1"}])
        self.assertEqual(score.novelty_factor(same, previous, RUN, WINDOW_START, {})[0], 0.1)
        more = incident(sources=[{"url": "https://a.test/1"}, {"url": "https://a.test/2"}])
        self.assertEqual(score.novelty_factor(more, previous, RUN, WINDOW_START, {})[0], 0.5)

    def test_evergreen_and_audience(self):
        self.assertEqual(score.evergreen_factor(incident(type="phishing", evergreenTopic="phishing"), [])[0], 1.0)
        self.assertEqual(score.evergreen_factor(incident(type="bridge", evergreenTopic="bridge-security"), [])[0], 0.7)
        self.assertEqual(score.evergreen_factor(incident(type="key-compromise", evergreenTopic="key-management"), [mention("a", "A")])[0], 0.4)
        self.assertEqual(score.evergreen_factor(incident(), [])[0], 0.0)
        value, _ = score.audience_factor(incident(type="phishing"), [mention("a", "A")])
        self.assertGreaterEqual(value, 0.85)

    def test_total_and_analysis_bar(self):
        members = [mention("a", "A", date=dt.date(2026, 11, 24)), mention("b", "B", date=dt.date(2026, 11, 24))]
        inc = incident(type="phishing", evergreenTopic="phishing",
                       reportedLosses=[{"amountUsd": 1e6, "by": "a", "tier": "A"}],
                       sources=[{"url": "https://a.test/x", "publisher": "a"}, {"url": "https://b.test/x", "publisher": "b"}])
        doc = score.score(inc, members, RUN, WINDOW_START, None, {})
        self.assertEqual(set(doc["factors"]), set(score.WEIGHTS))
        self.assertAlmostEqual(doc["total"], round(sum(f["value"] * f["weight"] for f in doc["factors"].values()), 1))
        self.assertTrue(all(f["reason"] for f in doc["factors"].values()))
        self.assertTrue(score.analysis_bar(inc, doc)["ready"])
        weak = dict(inc, status="developing", mechanismKnown=False, sources=[{"url": "x", "publisher": "a"}])
        missing = score.analysis_bar(weak, doc)["missing"]
        self.assertIn("not confirmed", missing)
        self.assertIn("fewer than 2 independent sources", missing)
        self.assertIn("mechanism not stated by any source", missing)


if __name__ == "__main__":
    unittest.main()
