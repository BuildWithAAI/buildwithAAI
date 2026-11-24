import unittest

from radarlib.robots import Robots

# Excerpt of the CoinDesk robots.txt read on 2026-11-24 (structure preserved).
COINDESK = """User-agent: *
Allow:
Disallow: /pf/api/v3/*
Disallow: /api/
Disallow: /*/amp

# AI Allow/Disallow Rules
User-agent: anthropic-ai
Allow: /price/
Disallow: /

User-agent: ClaudeBot
Allow: /price/
Disallow: /
"""

DEFIANT = """User-Agent: *
Allow: /
Disallow: /*.json$
Disallow: /api/*

User-Agent: python-requests
Disallow: /
"""


class RobotsRules(unittest.TestCase):
    def test_star_group_applies_to_unlisted_agents(self):
        robots = Robots.parse(COINDESK)
        url = "https://www.coindesk.com/arc/outboundfeeds/rss/"
        self.assertTrue(robots.allowed(url, "NewsRadar"))
        self.assertTrue(robots.allowed(url, "Claude-User"))
        self.assertFalse(robots.allowed(url, "ClaudeBot"))
        self.assertTrue(robots.allowed("https://www.coindesk.com/price/bitcoin", "ClaudeBot"))
        self.assertFalse(robots.allowed("https://www.coindesk.com/api/x", "NewsRadar"))

    def test_empty_allow_does_not_allow_everything(self):
        robots = Robots.parse(COINDESK)
        self.assertFalse(robots.allowed("https://www.coindesk.com/markets/2026/11/23/x/amp", "NewsRadar"))

    def test_wildcards_anchor_and_longest_match(self):
        robots = Robots.parse(DEFIANT)
        self.assertTrue(robots.allowed("https://thedefiant.io/feed", "NewsRadar"))
        self.assertFalse(robots.allowed("https://thedefiant.io/data.json", "NewsRadar"))
        self.assertTrue(robots.allowed("https://thedefiant.io/data.json?x=1", "NewsRadar"))
        self.assertFalse(robots.allowed("https://thedefiant.io/api/feed", "NewsRadar"))
        self.assertFalse(robots.allowed("https://thedefiant.io/feed", "python-requests"))

    def test_allow_wins_ties_and_case_insensitive_agent(self):
        robots = Robots.parse("User-agent: NEWSRADAR\nDisallow: /a\nAllow: /a\n")
        self.assertTrue(robots.allowed("https://x.test/a", "NewsRadar"))
        robots = Robots.parse("User-agent: *\nDisallow: /\nAllow: /feed\n")
        self.assertTrue(robots.allowed("https://x.test/feed", "Anything"))
        self.assertFalse(robots.allowed("https://x.test/other", "Anything"))
        self.assertTrue(robots.allowed("https://x.test/robots.txt", "Anything"))

    def test_modes_and_crawl_delay(self):
        self.assertTrue(Robots.allow_all().allowed("https://x.test/a", "NewsRadar"))
        self.assertFalse(Robots.disallow_all().allowed("https://x.test/a", "NewsRadar"))
        robots = Robots.parse("User-agent: *\nCrawl-delay: 5\nDisallow:\n")
        self.assertEqual(robots.crawl_delay("NewsRadar"), 5.0)
        self.assertTrue(robots.allowed("https://x.test/anything", "NewsRadar"))
        self.assertTrue(Robots.parse("").allowed("https://x.test/a", "NewsRadar"))


if __name__ == "__main__":
    unittest.main()
