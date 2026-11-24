import datetime as dt
import unittest

from radarlib import cluster, pipeline

from .helpers import FIXTURES, RUN_DATE, SOURCES

STATE = {}


def setUpModule():
    config = pipeline.load_sources(SOURCES)
    now = dt.datetime(2026, 11, 24, 12, tzinfo=dt.timezone.utc)
    results, _ = pipeline.gather(config, RUN_DATE, True, FIXTURES, None, now, "NewsRadar/0.1", log=lambda m: None)
    by_id = {s["id"]: s for s in config["sources"]}
    mentions, counts = cluster.build_mentions(results, by_id, RUN_DATE)
    clusters, unclustered = cluster.cluster_mentions(mentions)
    STATE.update(mentions=mentions, clusters=clusters, unclustered=unclustered, counts=counts)


def find(protocol_core, date=None):
    for members in STATE["clusters"]:
        names = {cluster.core_name(m.subject) for m in members if m.subject}
        dates = {m.event_date for m in members if m.event_kind == "structured"}
        if protocol_core in names and (date is None or date in dates):
            return members
    raise AssertionError(f"no cluster for {protocol_core} {date}")


def sids(members):
    return {m.sid for m in members}


class RealClusters(unittest.TestCase):
    def test_chainflip_merges_databases_and_news(self):
        members = find("chainflip", dt.date(2026, 11, 21))
        self.assertTrue({"defillama-hacks", "slowmist-hacked", "cointelegraph", "thedefiant", "web3isgoinggreat",
                         "coinedition"} <= sids(members))
        incident = cluster.build_incident(members, RUN_DATE)
        self.assertEqual((incident["protocol"], incident["type"], incident["status"]), ("Chainflip", "key-compromise", "confirmed"))
        self.assertEqual(incident["dateUtc"], "2026-11-21")

    def test_aliases_from_possessives_link_fusionist_and_cyber(self):
        endurance = find("endurance", dt.date(2026, 11, 22))
        self.assertIn("web3isgoinggreat", sids(endurance))
        cyber = find("cyber", dt.date(2026, 11, 21))
        self.assertTrue({"defillama-hacks", "slowmist-hacked", "cointelegraph", "thedefiant", "web3isgoinggreat"} <= sids(cyber))
        incident = cluster.build_incident(cyber, RUN_DATE)
        self.assertEqual(incident["protocol"], "Cyber Bridge")
        self.assertIn("CyberConnect", " ".join(incident["notes"]))

    def test_follow_ups_attach_to_an_older_incident(self):
        members = find("binance", dt.date(2026, 10, 29))
        self.assertTrue({"theblock", "cointelegraph", "decrypt", "dlnews", "coindesk", "chainalysis-blog", "rekt-news",
                         "thedefiant", "coinedition"} <= sids(members))
        incident = cluster.build_incident(members, RUN_DATE)
        self.assertEqual(incident["evergreenTopic"], "fake-job-malware")
        self.assertEqual(incident["postMortemUrl"], "https://rekt.news/binance-rekt")
        figures = {(e["by"], e["amountUsd"]) for e in incident["reportedLosses"]}
        self.assertIn(("defillama-hacks", 6360000000.0), figures)
        self.assertFalse(any(e["amountUsd"] in (1.17e9, 1.1e9, 247e6, 6.5e9) for e in incident["reportedLosses"]),
                         "recoveries, freezes and laundering flows are not losses")

    def test_figure_agreement_picks_the_right_same_name_incident(self):
        first = find("initia", dt.date(2026, 10, 23))
        second = find("initia", dt.date(2026, 11, 10))
        self.assertIn("web3isgoinggreat", sids(first))
        self.assertNotIn("web3isgoinggreat", sids(second))

    def test_old_and_unrelated_items_stay_out_of_incidents(self):
        unclustered_titles = {m.title for m in STATE["unclustered"]}
        self.assertIn("Pump.fun draws criticism over private key imports as it retires external wallet sign-in on web", unclustered_titles)
        all_titles = {m.title for m in STATE["mentions"]}
        self.assertNotIn("Kalshi halts operations in Utah while dodging immediate ban in New York", all_titles)
        self.assertNotIn("Wiz Says Attacker Mined AI Coding Histories for Logins", all_titles)

    def test_facts_quote_stored_text(self):
        for members in STATE["clusters"]:
            incident = cluster.build_incident(members, RUN_DATE)
            by_url = {(s["id"], s["url"]): s for s in incident["sources"]}
            for fact in incident["facts"]:
                src = by_url[(fact["sourceId"], fact["url"])]
                haystack = src["title"] if fact["field"] == "title" else src.get("qualifier", "") if fact["field"] == "qualifier" else src["excerpt"]
                self.assertIn(fact["quote"], haystack)
            for loss in incident["reportedLosses"]:
                src = by_url[(loss["by"], loss["url"])]
                self.assertIn(loss["quote"], src["title"] + " " + src["excerpt"])


def mention(sid, tier, publisher=None, hedge=None, kind="news", subject="Acme", date=dt.date(2026, 11, 23)):
    published = dt.datetime(date.year, date.month, date.day, 9, tzinfo=dt.timezone.utc)
    return cluster.Mention(
        source={"id": sid, "name": sid, "parser": "rss"}, item={"publishedUtc": None}, sid=sid, name=sid, tier=tier,
        publisher=publisher or sid, kind=kind, title=f"{subject} exploited", excerpt="", lead="", url=f"https://{sid}.test/x",
        published=published, event_date=None, event_kind=None, fresh=published, subject=subject, subject_method="test",
        aliases=cluster.aliases_for(subject), surfaces=cluster.surfaces_for(subject), amounts=[], chains=[],
        type_vote=("exploit", None, "test"), hedge=hedge,
        legal=[], price=False, retail=[], institutional=[], follow_up=None, incident=True, security=True,
        redactions={"names": 0, "code": 0}, record=None, reference_url=None, key=None, relevance_reason="test")


class Status(unittest.TestCase):
    def status(self, members):
        return cluster._status(members)[0]

    def test_rules(self):
        self.assertEqual(self.status([mention("a", "A")]), "confirmed")
        self.assertEqual(self.status([mention("a", "A", hedge="suspected")]), "developing")
        self.assertEqual(self.status([mention("b1", "B"), mention("b2", "B")]), "confirmed")
        self.assertEqual(self.status([mention("b1", "B", publisher="Same"), mention("b2", "B", publisher="Same")]), "developing")
        self.assertEqual(self.status([mention("b1", "B"), mention("b2", "B", hedge="apparent")]), "developing")
        self.assertEqual(self.status([mention("c1", "C"), mention("c2", "C"), mention("c3", "C")]), "developing")
        reason = cluster._status([mention("b1", "B"), mention("c1", "C")])[1]
        self.assertIn("tier-C sources do not count", reason)

    def test_developing_title_and_note(self):
        incident = cluster.build_incident([mention("b1", "B")], RUN_DATE)
        self.assertEqual(incident["title"], "Acme: reported exploit (developing)")
        self.assertIn("Label as developing. Attribute every line to its source.", incident["notes"])


class Names(unittest.TestCase):
    def test_aliases_and_matching(self):
        aliases = cluster.aliases_for("Endurance Bridge", "Fusionist’s Endurance Bridge (ACE cross-chain bridge) was exploited")
        self.assertIn("fusionist", aliases)
        aliases = cluster.aliases_for("CyberConnect", "An attacker exploited a flaw affecting Cyber's cross-chain token bridge")
        self.assertIn("cyber", aliases)
        self.assertIn("xmr1", cluster.aliases_for("Wagyu (XMR1)"))
        self.assertNotIn("supply chain", cluster.aliases_for("Ledger (Supply Chain)"))
        self.assertTrue(cluster.names_match(cluster.aliases_for("Chainflip AMM"), cluster.aliases_for("Chainflip")))
        self.assertTrue(cluster.names_match(cluster.aliases_for("The Moats"), cluster.aliases_for("Moats App")))
        self.assertFalse(cluster.names_match(cluster.aliases_for("Kava Lend"), cluster.aliases_for("K3 Capital")))
        self.assertEqual(cluster.alias_hit({"Binance"}, "DOJ seeks $1.17 billion tied to Binance hack", ""), 2)
        self.assertEqual(cluster.alias_hit({"MoldyRoost"}, "Crypto thieves use ads", "A campaign known as MoldyRoost"), 1)
        self.assertEqual(cluster.alias_hit({"Lighter"}, "Rates", "a lighter touch on rules"), 0)
        more = cluster.surfaces_for("MORE Markets")
        self.assertEqual(more, {"MORE Markets", "MORE"})
        self.assertEqual(cluster.alias_hit(more, "DOJ moves to recover $1.17 billion from Binance hack, and more", ""), 0)
        self.assertEqual(cluster.alias_hit({"Kava Lend"}, "KAVA LEND EXPLOITED", ""), 2)
        self.assertIn("Fusionist", cluster.surfaces_for("Endurance Bridge", "Fusionist’s Endurance Bridge (ACE cross-chain bridge) was exploited"))
        self.assertIn("XMR1", cluster.surfaces_for("Wagyu (XMR1)"))


if __name__ == "__main__":
    unittest.main()
