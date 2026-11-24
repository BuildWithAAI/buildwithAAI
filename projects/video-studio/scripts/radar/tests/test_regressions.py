"""Regression tests for the review findings, each one a scenario that failed before the fix:

  * clustering: a news report of a NEW attack never merges into an older database record; news-only items do not
    chain incidents days apart; near-names (Prisma/Prism, Sonne/Sonnet) stay apart; a headline's figure about an
    earlier incident is not this incident's figure;
  * history: sources that rotated out of their feeds still count for the status (no false "status change"), and
    an incident keeps its id from one day to the next;
  * the fetcher: redirects to ftp:, file:, plain http or an unlisted host are refused (with a real local server),
    a slow-drip response stops at the wall-clock budget, and a rate-limited robots.txt means "do not crawl now";
  * parsing: XML entity declarations are refused in any encoding; hostile HTML cannot exhaust the DOM builder;
  * output: lone surnames and pseudonyms are redacted; mechanism status, user-side titles, qualifiers and dates.
"""

import datetime as dt
import http.server
import json
import os
import shutil
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest import mock

from radarlib import classify, fetch, htmldom, pipeline, safety, score
from radarlib.parsers import ParseError, parse_feed

from .helpers import CTX, SOURCES, source

with open(SOURCES, encoding="utf-8") as _fh:
    REAL = json.load(_fh)
BYID = {s["id"]: s for s in REAL["sources"]}


def ts(day):
    d = dt.date.fromisoformat(day)
    return int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp())


def _x(text):
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def rss(items):
    out = ['<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title>'
           '<link>https://example.com/</link>']
    for it in items:
        out.append(f"<item><title>{_x(it['title'])}</title><link>{_x(it['url'])}</link>"
                   f"<pubDate>{it['pub']}</pubDate><description>{_x(it.get('desc', ''))}</description></item>")
    out.append("</channel></rss>")
    return "".join(out)


def llama(day, name, amount, classification="Protocol Logic", technique="Logic Error", target="DeFi Protocol",
          description=None):
    return {"date": ts(day), "name": name, "classification": classification, "technique": technique,
            "amount": amount, "chain": ["Ethereum"], "bridgeHack": False, "targetType": target, "source": "",
            "returnedFunds": None, "description": description or f"{name} was exploited."}


class Scenario(unittest.TestCase):
    """Runs the offline pipeline on tiny fixtures written to a temp dir."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="radar-regress-")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def run_radar(self, run_date, records, feeds, history=None, name="run"):
        root = os.path.join(self.tmp, name)
        fixtures = os.path.join(root, "fixtures")
        os.makedirs(fixtures)
        sources = []
        if records is not None:
            with open(os.path.join(fixtures, "defillama-hacks.json"), "w", encoding="utf-8") as fh:
                json.dump(records, fh)
            sources.append(dict(BYID["defillama-hacks"]))
        for sid, items in feeds.items():
            with open(os.path.join(fixtures, f"{sid}.xml"), "w", encoding="utf-8") as fh:
                fh.write(rss(items))
            sources.append(dict(BYID[sid], fixture=f"{sid}.xml"))
        config = dict(REAL, sources=sources)
        sources_path = os.path.join(root, "sources.json")
        with open(sources_path, "w", encoding="utf-8") as fh:
            json.dump(config, fh)
        hist = None
        if history:
            hist = os.path.join(root, "history")
            os.makedirs(hist)
            for fname, doc in history.items():
                with open(os.path.join(hist, fname), "w", encoding="utf-8") as fh:
                    json.dump(doc, fh)
        doc, _, _ = pipeline.run_collect(dt.date.fromisoformat(run_date), offline=True, out_dir=os.path.join(root, "out"),
                                         cache_dir=None, sources_path=sources_path, fixtures_dir=fixtures,
                                         history_dir=hist, log=lambda msg: None)
        return doc

    @staticmethod
    def incidents(doc):
        return doc["top"] + doc["alsoSeen"]

    def only(self, doc, protocol):
        found = [i for i in self.incidents(doc) if i["protocol"].lower() == protocol.lower()]
        self.assertTrue(found, f"no incident for {protocol}: {[i['title'] for i in self.incidents(doc)]}")
        return found


FOOBAR_OLD = llama("2026-11-15", "Foobar Finance", 3_000_000, "Access Control", "Private Key Compromised",
                   description="An attacker drained Foobar Finance's vault on November 15, 2026.")
FOOBAR_NEWS = {
    "coindesk": [{"title": "DeFi protocol Foobar Finance exploited for $800,000 in a new attack",
                  "url": "https://www.coindesk.com/tech/2026/11/23/foobar-finance-exploited",
                  "pub": "Mon, 23 Nov 2026 10:00:00 +0000",
                  "desc": "The crypto lending protocol Foobar Finance was exploited on Nov. 22 for $800,000, the team said."}],
    "cointelegraph": [{"title": "Foobar Finance suspected of new exploit, users told to revoke approvals",
                       "url": "https://cointelegraph.com/news/foobar-finance-suspected-exploit",
                       "pub": "Mon, 23 Nov 2026 12:00:00 +0000",
                       "desc": "Security firms are investigating a suspected exploit of the DeFi protocol Foobar Finance on Nov. 22."}],
}


class Clustering(Scenario):
    def test_new_attack_never_merges_into_an_older_record(self):
        # s1a: the database has only the Nov 15 incident; the news reports a new Nov 22 one
        doc = self.run_radar("2026-11-24", [FOOBAR_OLD], FOOBAR_NEWS)
        fresh = self.only(doc, "Foobar Finance")
        self.assertEqual(len(fresh), 1)
        inc = fresh[0]
        self.assertEqual(inc["dateUtc"], "2026-11-22")
        self.assertNotIn("defillama-hacks", {s["id"] for s in inc["sources"]})
        # the old record's $3M is not this incident's figure; the outlet's own $800,000 is
        self.assertEqual({(e["by"], e["amountUsd"]) for e in inc["reportedLosses"]}, {("coindesk", 800000.0)})
        self.assertEqual(inc["status"], "developing")  # one unhedged outlet, one hedged
        # advice to users is not a user-side incident
        self.assertFalse(inc["userSide"])
        self.assertNotIn("users", inc["title"])

    def test_same_day_record_and_new_attack_wording_do_merge(self):
        # s1b: the database also lists the Nov 22 incident; "new attack" is about the Nov 15 one, so they merge
        records = [FOOBAR_OLD, llama("2026-11-22", "Foobar Finance", 800_000, technique="Price Manipulation")]
        doc = self.run_radar("2026-11-24", records, FOOBAR_NEWS)
        fresh = [i for i in self.only(doc, "Foobar Finance") if i["dateUtc"] == "2026-11-22"]
        self.assertEqual(len(fresh), 1)
        self.assertEqual({s["id"] for s in fresh[0]["sources"]}, {"defillama-hacks", "coindesk", "cointelegraph"})
        ids = [i["id"] for i in self.incidents(doc)]
        self.assertEqual(len(ids), len(set(ids)), "incident ids must be unique within a run")

    def test_undated_new_report_is_not_attached_to_an_old_record(self):
        # s1c: no date in the text; published 8 days after the only record
        feeds = {"coindesk": [{"title": "Foobar Finance drained of $800,000",
                               "url": "https://www.coindesk.com/tech/2026/11/23/foobar-finance-drained",
                               "pub": "Mon, 23 Nov 2026 10:00:00 +0000",
                               "desc": "The crypto protocol Foobar Finance lost $800,000 to an attacker, the team said."}]}
        doc = self.run_radar("2026-11-24", [FOOBAR_OLD], feeds)
        inc = self.only(doc, "Foobar Finance")[0]
        self.assertNotIn("defillama-hacks", {s["id"] for s in inc["sources"]})
        self.assertIsNone(inc["dateUtc"])  # never guessed from the publication date
        self.assertEqual(inc["firstSeenUtc"], "2026-11-23")
        self.assertIn("dateNote", inc)

    def test_news_only_items_days_apart_do_not_chain(self):
        # s3: Nov 15 - Nov 19 - Nov 23 items about the same protocol are two incidents, not one
        feeds = {
            "coindesk": [{"title": "Crypto lender Quuxly exploited for $1.2 million", "url": "https://www.coindesk.com/tech/2026/11/15/quuxly",
                          "pub": "Sun, 15 Nov 2026 10:00:00 +0000", "desc": "DeFi protocol Quuxly was exploited for $1.2 million."}],
            "decrypt": [{"title": "Quuxly hack: team offers bounty to exploiter", "url": "https://decrypt.co/2/quuxly-bounty",
                         "pub": "Thu, 19 Nov 2026 10:00:00 +0000", "desc": "The DeFi protocol Quuxly offered a bounty after the crypto exploit."}],
            "cointelegraph": [{"title": "Quuxly exploited for $400,000 in fresh attack", "url": "https://cointelegraph.com/news/quuxly-fresh",
                               "pub": "Mon, 23 Nov 2026 09:00:00 +0000", "desc": "DeFi protocol Quuxly was hit again, losing $400,000 in a crypto exploit."}],
            "theblock": [{"title": "Quuxly drained of $400,000 in second exploit", "url": "https://www.theblock.co/post/3/quuxly",
                          "pub": "Mon, 23 Nov 2026 11:00:00 +0000", "desc": "DeFi protocol Quuxly lost $400,000 in a crypto exploit."}],
        }
        doc = self.run_radar("2026-11-24", None, feeds)
        for inc in self.only(doc, "Quuxly"):
            urls = {s["url"] for s in inc["sources"]}
            self.assertNotIn("https://www.coindesk.com/tech/2026/11/15/quuxly", urls)
            self.assertNotIn(1_200_000.0, [e["amountUsd"] for e in inc["reportedLosses"]])

    def test_near_names_stay_apart(self):
        # s6: "Prism" (a wallet, phishing) is not "Prisma Finance" (an older protocol exploit)
        records = [llama("2026-11-10", "Prisma Finance", 11_000_000, technique="Flash Loan")]
        feeds = {"coindesk": [{"title": "Crypto wallet Prism hit by phishing attack, users lose $2 million",
                               "url": "https://www.coindesk.com/tech/2026/11/23/prism-wallet",
                               "pub": "Mon, 23 Nov 2026 10:00:00 +0000",
                               "desc": "Users of the crypto wallet Prism lost $2 million to a phishing campaign, the company said."}]}
        doc = self.run_radar("2026-11-24", records, feeds)
        prism = self.only(doc, "Prism")[0]
        self.assertNotIn("defillama-hacks", {s["id"] for s in prism["sources"]})
        self.assertNotIn(11_000_000.0, [e["amountUsd"] for e in prism["reportedLosses"]])
        # s2c: Sonne and Sonnet, adjacent days, two incidents
        records = [llama("2026-11-22", "Sonne", 4_000_000, technique="Donation Attack"),
                   llama("2026-11-23", "Sonnet", 90_000, "Key Compromise", "Private Key Compromised", "Wallet")]
        doc = self.run_radar("2026-11-24", records, {}, name="sonne")
        self.assertEqual(sorted(i["protocol"] for i in self.incidents(doc)), ["Sonne", "Sonnet"])

    def test_headline_figure_about_an_earlier_incident_is_not_taken(self):
        # s7: "..., months after a $1 million exploit"
        records = [llama("2026-11-23", "Quibble", 2_500_000, "Access Control", "Private Key Compromised")]
        feeds = {"coindesk": [{"title": "DeFi protocol Quibble hacked for $2.5 million, months after a $1 million exploit",
                               "url": "https://www.coindesk.com/tech/2026/11/23/quibble",
                               "pub": "Mon, 23 Nov 2026 10:00:00 +0000", "desc": "Crypto protocol Quibble lost funds again on Nov. 23."}]}
        doc = self.run_radar("2026-11-24", records, feeds)
        inc = self.only(doc, "Quibble")[0]
        self.assertEqual(sorted({e["amountUsd"] for e in inc["reportedLosses"]}), [2_500_000.0])
        # a figure with thousands separators survives the clause split
        self.assertEqual(classify.title_amounts("Protocol X loses $1,200,000, weeks after a $300,000 hack"),
                         [(1_200_000.0, "$1,200,000")])


ZORBLEX_DAY1 = {
    "coindesk": [{"title": "DeFi lender Zorblex exploited for $3.2 million", "url": "https://www.coindesk.com/tech/2026/11/23/zorblex",
                  "pub": "Mon, 23 Nov 2026 09:00:00 +0000", "desc": "Crypto lending protocol Zorblex lost $3.2 million to an attacker."}],
    "cointelegraph": [{"title": "Zorblex drained of $3.2 million in DeFi exploit", "url": "https://cointelegraph.com/news/zorblex",
                       "pub": "Mon, 23 Nov 2026 11:00:00 +0000", "desc": "Crypto protocol Zorblex lost $3.2 million."}],
}


class History(Scenario):
    def day1(self, feeds=ZORBLEX_DAY1, records=None, run_date="2026-11-23"):
        doc = self.run_radar(run_date, records, feeds, name="day1")
        doc["mode"] = "live"  # history only reads live runs
        return doc

    def test_rotated_sources_keep_the_status_and_report_no_change(self):
        # s8: day 2 still has the incident, but the two confirming items left their feeds
        d1 = self.day1()
        self.assertEqual(self.only(d1, "Zorblex")[0]["status"], "confirmed")
        day2 = {
            "coindesk": [{"title": "Unrelated market wrap", "url": "https://www.coindesk.com/markets/2026/11/24/wrap",
                          "pub": "Tue, 24 Nov 2026 09:00:00 +0000", "desc": "Bitcoin traded sideways."}],
            "decrypt": [{"title": "Zorblex team investigating suspected cause of $3.2 million exploit",
                         "url": "https://decrypt.co/9/zorblex-update", "pub": "Tue, 24 Nov 2026 08:00:00 +0000",
                         "desc": "The DeFi protocol Zorblex said it is investigating the crypto exploit."}],
        }
        d2 = self.run_radar("2026-11-24", None, day2, history={"2026-11-23.json": d1}, name="day2")
        inc = self.only(d2, "Zorblex")[0]
        self.assertEqual(inc["status"], "confirmed")
        self.assertEqual(inc["id"], self.only(d1, "Zorblex")[0]["id"])
        carried = [s for s in inc["sources"] if s.get("carried")]
        self.assertEqual({s["id"] for s in carried}, {"coindesk", "cointelegraph"})
        self.assertEqual(d2["corrections"], [])

    def test_a_retraction_drops_the_carried_sources(self):
        d1 = self.day1()
        day2 = {"decrypt": [{"title": "Zorblex says reported $3.2 million exploit was a false alarm",
                             "url": "https://decrypt.co/9/zorblex-false-alarm", "pub": "Tue, 24 Nov 2026 08:00:00 +0000",
                             "desc": "The DeFi protocol Zorblex said no funds were lost; the crypto exploit report was a false alarm."}]}
        d2 = self.run_radar("2026-11-24", None, day2, history={"2026-11-23.json": d1}, name="day2")
        inc = self.only(d2, "Zorblex")[0]
        self.assertFalse([s for s in inc["sources"] if s.get("carried")])
        self.assertEqual(inc["status"], "developing")
        self.assertTrue(any("status confirmed -> developing" in c for corr in d2["corrections"] for c in corr["changes"]))

    def test_id_is_stable_when_a_database_record_adds_an_earlier_date(self):
        # s5b: day 1 news only (no date stated); day 2 DefiLlama dates it a day earlier
        news = {
            "coindesk": [{"title": "DeFi lender Plonkfi exploited for $3.2 million", "url": "https://www.coindesk.com/tech/2026/11/22/plonkfi",
                          "pub": "Sun, 22 Nov 2026 15:00:00 +0000", "desc": "Crypto lending protocol Plonkfi lost $3.2 million to an attacker, the team said."}],
            "cointelegraph": [{"title": "Plonkfi drained of $3.2 million in DeFi exploit", "url": "https://cointelegraph.com/news/plonkfi-drained",
                               "pub": "Sun, 22 Nov 2026 18:00:00 +0000", "desc": "Crypto protocol Plonkfi lost $3.2 million."}],
        }
        d1 = self.day1(news, records=[])
        d2 = self.run_radar("2026-11-24", [llama("2026-11-21", "Plonkfi", 3_200_000)], news,
                            history={"2026-11-23.json": d1}, name="day2")
        self.assertEqual(self.only(d2, "Plonkfi")[0]["id"], self.only(d1, "Plonkfi")[0]["id"])

    def test_only_same_source_figure_changes_are_corrections(self):
        d1 = self.day1()
        day2 = dict(ZORBLEX_DAY1)
        day2["coindesk"] = [dict(ZORBLEX_DAY1["coindesk"][0], title="DeFi lender Zorblex exploited for $4.1 million",
                                 desc="Crypto lending protocol Zorblex lost $4.1 million to an attacker.")]
        day2["decrypt"] = [{"title": "Zorblex drained of $3.2 million", "url": "https://decrypt.co/9/zorblex",
                            "pub": "Tue, 24 Nov 2026 08:00:00 +0000", "desc": "Crypto protocol Zorblex lost $3.2 million."}]
        d2 = self.run_radar("2026-11-24", None, day2, history={"2026-11-23.json": d1}, name="day2")
        changes = [c for corr in d2["corrections"] for c in corr["changes"]]
        self.assertTrue(any(c.startswith("coindesk now states 4,100,000 USD (previously 3,200,000 USD)") for c in changes), changes)
        # Decrypt repeating the known $3.2M figure is not a change
        self.assertFalse(any("decrypt" in c for c in changes), changes)


# ---------------------------------------------------------------- the fetcher, against a real local server

class _Handler(http.server.BaseHTTPRequestHandler):
    routes = {}

    def do_GET(self):  # noqa: N802 (stdlib naming)
        action = self.routes.get(self.path)
        if action is None:
            self.send_response(404)
            self.end_headers()
            return
        kind, value = action
        if kind == "redirect":
            self.send_response(302)
            self.send_header("Location", value)
            self.end_headers()
        elif kind == "drip":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            try:
                for _ in range(value):
                    self.wfile.write(b"x")
                    self.wfile.flush()
                    time.sleep(0.2)
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            body = value.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, *args):
        pass


class LocalServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.server.daemon_threads = True
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def client(self, **kw):
        # no proxy for the loopback server
        with mock.patch.dict(os.environ, {"no_proxy": "*", "NO_PROXY": "*"}):
            opener = fetch.build_opener()
        return fetch.HttpClient(opener=opener, min_interval=0, retries=0, timeout=5, **kw)

    def test_redirects_off_https_or_to_unlisted_hosts_are_refused(self):
        _Handler.routes = {
            "/ftp": ("redirect", "ftp://127.0.0.1/secret"),
            "/file": ("redirect", "file:///etc/passwd"),
            "/data": ("redirect", "data:text/plain,hello"),
            "/meta": ("redirect", "http://169.254.169.254/latest/meta-data/"),
            "/http-same": ("redirect", "/ok"),
            "/other": ("redirect", "https://attacker.example/x"),
            "/creds": ("redirect", "https://user:pw@attacker.example/"),
            "/ok": ("body", "fine"),
        }
        client = self.client(allowed_hosts={"www.coindesk.com"})
        for path in ("/ftp", "/file", "/data", "/meta", "/http-same", "/other", "/creds"):
            with self.assertRaises(fetch.FetchError, msg=path) as caught:
                client.get(self.base + path)
            self.assertEqual(caught.exception.kind, "redirect-refused", path)
        self.assertEqual(client.get(self.base + "/ok").body, b"fine")

    def test_opener_has_no_ftp_file_or_data_handlers(self):
        opener = fetch.build_opener()
        for url in ("file:///etc/passwd", "ftp://127.0.0.1/x", "data:text/plain,hello"):
            with self.assertRaises(urllib.error.URLError, msg=url):
                opener.open(urllib.request.Request(url), timeout=2)

    def test_slow_drip_stops_at_the_wall_clock_budget(self):
        _Handler.routes = {"/drip": ("drip", 50)}
        client = self.client(deadline=1.0)
        started = time.monotonic()
        with self.assertRaises(fetch.FetchError) as caught:
            client.get(self.base + "/drip")
        self.assertEqual(caught.exception.kind, "timeout")
        self.assertLess(time.monotonic() - started, 5.0)


class RedirectRules(unittest.TestCase):
    def test_same_host_and_listed_host_redirects_are_followed_with_robots_rechecked(self):
        from .test_fetch import FakeOpener, FakeResponse, http_error
        a, b = "https://feeds.example/rss", "https://cdn.listed.example/rss.xml"
        opener = FakeOpener({a: [http_error(a, 301, {"Location": b})], b: [FakeResponse(b, body=b"<rss/>")]})
        checked = []
        client = fetch.HttpClient(opener=opener, min_interval=0, retries=0, allowed_hosts={"cdn.listed.example"},
                                  sleep=lambda s: None)
        client.redirect_check = lambda url: (checked.append(url) or True, "allowed")
        self.assertEqual(client.get(a).body, b"<rss/>")
        self.assertEqual(checked, [b])
        # the new host's robots.txt can veto it
        opener = FakeOpener({a: [http_error(a, 301, {"Location": b})], b: [FakeResponse(b, body=b"<rss/>")]})
        client = fetch.HttpClient(opener=opener, min_interval=0, retries=0, allowed_hosts={"cdn.listed.example"},
                                  sleep=lambda s: None)
        client.redirect_check = lambda url: (False, "disallowed")
        with self.assertRaises(fetch.FetchError) as caught:
            client.get(a)
        self.assertEqual(caught.exception.kind, "robots")

    def test_rate_limited_robots_means_do_not_crawl_now(self):
        from .test_fetch import FakeOpener, http_error
        robots_url = "https://feeds.example/robots.txt"
        for status in (429, 401, 403):
            opener = FakeOpener({robots_url: [http_error(robots_url, status)]})
            client = fetch.HttpClient(opener=opener, min_interval=0, retries=0, sleep=lambda s: None)
            cache = fetch.RobotsCache(client, None, dt.datetime(2026, 11, 24, tzinfo=dt.timezone.utc))
            allowed, record = cache.allowed("https://feeds.example/rss")
            self.assertFalse(allowed, status)
            self.assertEqual(record["mode"], "disallow-all")
        # a plain 404 still means "no rules"
        opener = FakeOpener({})
        client = fetch.HttpClient(opener=opener, min_interval=0, retries=0, sleep=lambda s: None)
        cache = fetch.RobotsCache(client, None, dt.datetime(2026, 11, 24, tzinfo=dt.timezone.utc))
        self.assertTrue(cache.allowed("https://feeds.example/rss")[0])


# ---------------------------------------------------------------- parsing hardening

BOMB = ('<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">'
        '<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]><rss version="2.0"><channel><title>&c;</title></channel></rss>')


class ParsingHardening(unittest.TestCase):
    def test_entity_declarations_are_refused_in_any_encoding_or_padding(self):
        src = source("coindesk")
        variants = {
            "utf-8": BOMB.encode("utf-8"),
            "utf-16": BOMB.replace('<?xml version="1.0"?>', '<?xml version="1.0" encoding="UTF-16"?>').encode("utf-16"),
            "comment-padded": BOMB.replace("<!DOCTYPE", "<!--" + "x" * 5000 + "--><!DOCTYPE").encode("utf-8"),
            "external": b'<?xml version="1.0"?><!DOCTYPE rss SYSTEM "file:///etc/passwd" [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>',
        }
        for name, body in variants.items():
            with self.assertRaises(ParseError, msg=name):
                parse_feed(body, src, CTX)

    def test_hostile_html_is_bounded(self):
        started = time.monotonic()
        deep = htmldom.parse_html("<div>" * 100_000 + "deep text")
        self.assertIn("deep text", deep.text())  # iterative traversal, no RecursionError
        self.assertEqual(len(list(deep.iter())), 100_000)
        htmldom.parse_html("<p>a</p>" + "</span>" * 200_000)  # stray end tags: constant time each
        with self.assertRaises(htmldom.HtmlBudgetError):
            htmldom.parse_html("<i>" * (htmldom.MAX_NODES + 10))
        with self.assertRaises(htmldom.HtmlBudgetError):
            htmldom.parse_html("<p>x</p>" * 20_000, seconds=0.0)
        self.assertLess(time.monotonic() - started, 20.0)


# ---------------------------------------------------------------- what the radar writes

class OutputRules(unittest.TestCase):
    def test_lone_surnames_and_pseudonyms_are_redacted(self):
        cases = {
            "Saylor says Strategy will keep buying": "[named person] says Strategy will keep buying",
            "according to Saylor, the firm holds": "according to [named person], the firm holds",
            "the laundering was coordinated by Kruw, an entity": "the laundering was coordinated by [named person], an entity",
            "an entity called Kruw moved the funds": "an entity called [named person] moved the funds",
        }
        for text, expected in cases.items():
            self.assertEqual(safety.redact_people(text)[0], expected)
        # organisations seen in the run (and well-known firms) are not surnames
        for text in ("Binance said the hack was contained", "Chainflip said users were safe", "Police said nothing",
                     "according to Chainalysis, the funds", "A malicious ad campaign known as MoldyRoost spread"):
            self.assertEqual(safety.redact_people(text, known={"chainflip"})[1], 0, text)

    def test_mechanism_status_reads_the_full_text(self):
        self.assertEqual(classify.mechanism_qualifier("The attack method remains unknown. Funds moved.")[0], "unknown")
        self.assertEqual(classify.mechanism_qualifier("The team suspects a compromised signing key.")[0], "suspected")
        # a hedge on whether there was an incident at all is the status hedge, not the mechanism
        self.assertIsNone(classify.mechanism_qualifier("Foobar Finance suspected of new exploit.")[0])

    def test_key_management_explainer_needs_a_user_facing_key(self):
        class M:  # minimal member
            def __init__(self, target, institutional=(), retail=()):
                self.record = {"targetType": target}
                self.institutional, self.retail = institutional, retail
        protocol = {"type": "key-compromise", "evergreenTopic": "key-management", "userSide": False}
        value, _ = score.evergreen_factor(protocol, [M("DeFi Protocol", retail=("users",))])
        self.assertLess(value, 0.6)  # a protocol's signing key, whatever "users" cue the text has
        value, _ = score.evergreen_factor(protocol, [M("CEX", institutional=("market maker",))])
        self.assertLess(value, 0.6)
        value, _ = score.evergreen_factor(dict(protocol, userSide=True), [M("DeFi Protocol")])
        self.assertGreaterEqual(value, 0.6)
        self.assertIs(score.analysis_bar, score.sourcing_bar)


if __name__ == "__main__":
    unittest.main()
