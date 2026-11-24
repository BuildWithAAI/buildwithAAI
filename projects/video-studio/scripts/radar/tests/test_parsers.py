import unittest

from radarlib import parsers
from radarlib.parsers import PARSERS, ParseError
from radarlib.textutil import EXCERPT_MAX

from .helpers import CTX, fixture, source


def parse(sid, name):
    src = source(sid)
    return PARSERS[src["parser"]](fixture(name), src, CTX)


class StoragePolicy(unittest.TestCase):
    """Every parser keeps only short excerpts and a title, URL and dates."""

    CASES = (
        ("defillama-hacks", "defillama-hacks.json"), ("slowmist-hacked", "slowmist-hacked.html"),
        ("rekt-news", "rekt-news.html"), ("chainalysis-blog", "chainalysis-blog.xml"),
        ("certik-blog", "certik-blog.html"), ("trm-blog", "trm-blog.html"), ("coindesk", "coindesk.xml"),
        ("decrypt", "decrypt.xml"), ("cointelegraph", "cointelegraph.xml"), ("theblock", "theblock.xml"),
        ("thedefiant", "thedefiant.xml"), ("dlnews", "dlnews.xml"), ("web3isgoinggreat", "web3isgoinggreat.xml"),
        ("cryptonews", "cryptonews.xml"), ("coinedition", "coinedition.xml"),
    )

    def test_all_fixtures_parse_with_short_excerpts(self):
        for sid, name in self.CASES:
            with self.subTest(source=sid):
                items, _ = parse(sid, name)
                self.assertTrue(items)
                for item in items:
                    self.assertTrue(item["title"])
                    self.assertTrue(item["url"].startswith("http"))
                    self.assertLessEqual(len(item["excerpt"]), EXCERPT_MAX)
                    self.assertLessEqual(len(item.get("lead", "")), EXCERPT_MAX)
                    self.assertNotIn("utm_", item["url"])
                    self.assertNotIn("creator", item)


class DefiLlama(unittest.TestCase):
    def test_fields_window_and_malformed_records(self):
        items, warnings = parse("defillama-hacks", "defillama-hacks.json")
        names = {i["record"]["name"] for i in items}
        self.assertIn("Chainflip AMM", names)
        self.assertNotIn("Broken Date", names)
        self.assertTrue(all(i["eventDate"] >= "2026-07-27" for i in items), "120-day window")
        self.assertTrue(any("malformed" in w for w in warnings))
        chainflip = next(i for i in items if i["record"]["name"] == "Chainflip AMM")
        self.assertEqual(chainflip["eventDate"], "2026-11-21")
        self.assertEqual(chainflip["record"]["amount"], 11960000.0)
        self.assertEqual(chainflip["record"]["technique"], "Validator Key Compromised")
        self.assertIn("reported loss $11,960,000", chainflip["excerpt"])
        self.assertIn("Key Compromise / Validator Key Compromised", chainflip["excerpt"])
        self.assertTrue(chainflip["url"].startswith("https://api.llama.fi/hacks#Chainflip%20AMM%402026-11-21"))
        peapods = next(i for i in items if i["record"]["name"] == "Peapods Finance")
        self.assertIsNone(peapods["record"]["amount"])
        self.assertIn("loss not stated", peapods["excerpt"])

    def test_every_recorded_field_is_documented(self):
        import json
        raw = json.loads(fixture("defillama-hacks.json"))
        seen = set().union(*(r.keys() for r in raw if isinstance(r, dict)))
        self.assertLessEqual(seen, set(parsers.DEFILLAMA_FIELDS))

    def test_rejects_non_array(self):
        with self.assertRaises(ParseError):
            parse("defillama-hacks", "negative/defillama-object.json")
        with self.assertRaises(ParseError):
            PARSERS["defillama_hacks"](b"<html>", source("defillama-hacks"), CTX)


class Feeds(unittest.TestCase):
    def test_rss_cdata_namespaces_and_dates(self):
        items, _ = parse("coindesk", "coindesk.xml")
        first = items[0]
        self.assertEqual(first["title"], "Binance hackers push $247 million through transactions designed to cloud the source")
        self.assertEqual(first["publishedUtc"], "2026-11-23T15:29:01Z")
        self.assertIn("Elliptic found", first["excerpt"])
        self.assertNotIn("<p>", first["excerpt"])
        self.assertIn("Binance", first["categories"])

    def test_html_description_and_utm_stripping(self):
        items, _ = parse("cointelegraph", "cointelegraph.xml")
        chainflip = next(i for i in items if "Chainflip" in i["title"])
        self.assertTrue(chainflip["url"].endswith("chainflip-12m-crypto-hack-10-percent-bounty"))
        self.assertNotIn("<", chainflip["excerpt"])

    def test_content_encoded_fallback_and_gmt_dates(self):
        items, _ = parse("thedefiant", "thedefiant.xml")
        self.assertEqual(len(items), 5)
        self.assertTrue(all(i["publishedUtc"].endswith("Z") for i in items))

    def test_atom_xhtml_content(self):
        items, _ = parse("web3isgoinggreat", "web3isgoinggreat.xml")
        fusionist = next(i for i in items if i["title"].startswith("Fusionist"))
        self.assertEqual(fusionist["url"], "https://web3isgoinggreat.com/single/fusionist-exploit")
        self.assertEqual(fusionist["publishedUtc"], "2026-11-22T21:54:09Z")
        self.assertIn("Fusionist blockchain gaming project", fusionist["excerpt"])

    def test_unsafe_and_broken_documents_are_refused(self):
        src = source("coindesk")
        for name in ("negative/entity-bomb.xml", "negative/not-a-feed.xml", "negative/broken.xml"):
            with self.subTest(name=name):
                with self.assertRaises(ParseError):
                    PARSERS["rss"](fixture(name), src, CTX)


class HtmlSources(unittest.TestCase):
    def test_rekt(self):
        items, _ = parse("rekt-news", "rekt-news.html")
        self.assertEqual(len(items), 5)
        lighter = items[0]
        self.assertEqual((lighter["title"], lighter["subject"]), ("Lighter - Rekt", "Lighter"))
        self.assertEqual(lighter["url"], "https://rekt.news/lighter-rekt")
        self.assertEqual(lighter["publishedUtc"], "2026-11-23T00:00:00Z")
        self.assertIn("$10.39 million", lighter["excerpt"])
        essay = next(i for i in items if "Internet" in i["title"])
        self.assertIsNone(essay["subject"])

    def test_slowmist(self):
        items, _ = parse("slowmist-hacked", "slowmist-hacked.html")
        self.assertEqual(len(items), 6)
        bridge = items[0]
        self.assertEqual(bridge["record"]["name"], "Endurance Bridge")
        self.assertEqual(bridge["eventDate"], "2026-11-22")
        self.assertEqual(bridge["record"]["amount"], 5700000.0)
        self.assertEqual(bridge["record"]["method"], "Private Key Leakage")
        self.assertTrue(bridge["referenceUrl"].startswith("https://x.com/"))
        self.assertIn("Fusionist", bridge["lead"])

    def test_blog_cards(self):
        items, _ = parse("certik-blog", "certik-blog.html")
        self.assertEqual([i["title"] for i in items][0], "Arcus Incident Analysis")
        self.assertEqual(items[0]["categories"], ["Research reports"])
        self.assertEqual(items[0]["publishedUtc"], "2026-11-12T23:00:00Z")
        self.assertFalse(any(i["url"].endswith("/blog/all") for i in items))
        items, _ = parse("trm-blog", "trm-blog.html")
        self.assertEqual(items[0]["categories"], ["Company News"])

    def test_layout_changes_raise_parse_error(self):
        with self.assertRaises(ParseError):
            parse("rekt-news", "negative/rekt-redesigned.html")
        with self.assertRaises(ParseError):
            parse("slowmist-hacked", "negative/slowmist-redesigned.html")
        with self.assertRaises(ParseError):
            parse("certik-blog", "negative/rekt-redesigned.html")


if __name__ == "__main__":
    unittest.main()
