import copy
import unittest

from tests import helpers
from topiclib import ideas


def cand(topic, sub, channel, fmt, evergreen, score, vid, ch="UC1", title="A source title about something", lang="en", flags=(), src_flags=(), views=100000, description=""):
    fit = {"channel": channel, "format": fmt, "evergreenTopic": evergreen, "fit": 1.0, "raw": 1.0, "baseWeight": 1.0, "boostedBy": [], "cueMultiplier": 1.0}
    return {
        "videoId": vid, "url": f"https://www.youtube.com/watch?v={vid}", "title": title, "description": description, "channelId": ch, "channelTitle": "Chan",
        "topic": topic, "subtopic": sub, "fit": fit, "fitOptions": [fit], "score": score, "views": views, "lang": lang, "format": "long",
        "flags": list(flags), "classification": {"flags": list(src_flags), "cues": {}, "otherTopics": []},
        "publishedAt": "2026-11-01T16:00:00Z", "fetchedAt": "2026-11-24T12:00:00Z", "outlier": 12.0, "why": "Test evidence.",
    }


def builder(backlogs=None):
    return ideas.IdeaBuilder(helpers.taxonomy(), helpers.config(), copy.deepcopy(helpers.TEST_BACKLOGS if backlogs is None else backlogs))


class Grouping(unittest.TestCase):
    def test_groups_by_channel_format_topic_subtopic_with_breadth_bonus(self):
        cs = [
            cand("drainers", "fake-airdrop", "zoora-security", "explainer", "drainers", 70, "v1", ch="UC1"),
            cand("drainers", "fake-airdrop", "zoora-security", "explainer", "drainers", 60, "v2", ch="UC2"),
            cand("drainers", "fake-airdrop", "zoora-security", "explainer", "drainers", 50, "v3", ch="UC2"),
            cand("drainers", "permit-signatures", "zoora-security", "explainer", "drainers", 65, "v4"),
        ]
        out = builder().build(cs)
        self.assertEqual([i["id"] for i in out], ["explainer-fake-airdrop", "explainer-permit-signatures"])
        airdrop = out[0]
        self.assertEqual([e["videoId"] for e in airdrop["evidence"]], ["v1", "v2", "v3"])
        self.assertEqual((airdrop["evidenceChannels"], airdrop["breadthBonus"], airdrop["score"]), (2, 3, 73.0))
        self.assertEqual([i["rank"] for i in out], [1, 2])

    def test_ids_never_collide_with_backlog_slugs(self):
        backlogs = copy.deepcopy(helpers.TEST_BACKLOGS)
        backlogs["zoora-security"]["ideas"].append(helpers.idea("explainer-honeypot", "Something else entirely", "scam-of-the-week", "phishing", 30))
        out = builder(backlogs).build([cand("rug-pulls", "honeypot", "zoora-security", "explainer", "rug-pulls", 50, "v1")])
        self.assertEqual(out[0]["id"], "explainer-honeypot-tf")


class Pitch(unittest.TestCase):
    def test_angle_follows_the_channel_format_template_and_never_quotes_the_source(self):
        source = "I Signed One Message and Lost Everything (wallet drainer explained)"
        out = builder().build([cand("drainers", "permit-signatures", "zoora-security", "explainer", "drainers", 70, "v1", title=source)])[0]
        angle = out["pitch"]["angle"]
        self.assertIn("Badger's Red Flag:", angle)
        self.assertIn("Zoo's One Fix:", angle)
        self.assertNotIn(source, angle)
        self.assertTrue(out["copyGuard"]["title"]["ok"])
        self.assertTrue(out["copyGuard"]["angle"]["ok"])
        self.assertGreaterEqual(len(angle), 40)

    def test_copy_guard_skips_a_title_too_close_to_the_source(self):
        first_option = "The signature that empties a wallet without a transaction"
        out = builder().build([cand("drainers", "permit-signatures", "zoora-security", "explainer", "drainers", 70, "v1", title=first_option)])[0]
        self.assertNotEqual(out["pitch"]["workingTitle"], first_option)
        self.assertTrue(out["copyGuard"]["title"]["ok"])

    def test_copy_guard_flags_when_every_option_is_too_close(self):
        tax = helpers.taxonomy()
        options = tax.subtopic("drainers", "permit-signatures")["titles"]["explainer"] + tax.topic("drainers")["general"]["titles"]["explainer"]
        evidence = [cand("drainers", "permit-signatures", "zoora-security", "explainer", "drainers", 70 - n, f"v{n}", title=t) for n, t in enumerate(options)]
        out = builder().build(evidence)[0]
        self.assertFalse(out["copyGuard"]["title"]["ok"])
        self.assertIn("rewrite", out["copyGuard"]["title"]["note"])

    def test_pov_and_scam_of_the_week_templates(self):
        pov = builder().build([cand("rug-pulls", "honeypot", "zoora-ai", "pov-story", "rug-pulls", 60, "v1")])[0]
        self.assertTrue(pov["pitch"]["angle"].startswith("Second person, fiction card on:"))
        self.assertTrue(pov["pitch"]["workingTitle"].startswith("POV:"))
        sotw = builder().build([cand("phishing", "search-ads", "zoora-security", "scam-of-the-week", "phishing", 60, "v1")])[0]
        self.assertTrue(sotw["pitch"]["angle"].startswith("Case file:"))
        self.assertTrue(sotw["pitch"]["workingTitle"].startswith("Scam of the Week:"))


class FactsAndRisks(unittest.TestCase):
    def test_facts_cover_subtopic_topic_sources_incidents_and_dub_languages(self):
        cs = [
            cand("drainers", "fake-airdrop", "zoora-security", "explainer", "drainers", 70, "v1", title="Hack drained $3 million in airdrop claims"),
            cand("drainers", "fake-airdrop", "zoora-security", "explainer", "drainers", 60, "v2", lang="pt"),
        ]
        facts = builder().build(cs)[0]["facts"]
        joined = " | ".join(facts)
        self.assertIn("fake-airdrop claim pages", joined)
        self.assertIn("revoke token approvals", joined)
        self.assertIn("leads, never sources", joined)
        self.assertIn("primary report", joined)
        self.assertIn("Portuguese-language", joined)
        self.assertNotIn("Spanish-language", joined)

    def test_risks_from_source_flags(self):
        c = cand("rug-pulls", "bundled-supply", "zoora-ai", "pov-story", "rug-pulls", 60, "v1", src_flags=["income-claims", "how-to"])
        risks = " | ".join(builder().build([c])[0]["risks"])
        self.assertIn("income or profit claims", risks)
        self.assertIn("concept level", risks)
        self.assertIn("Original work only", risks)


class BacklogMatching(unittest.TestCase):
    def status(self, *args, **kw):
        out = builder(kw.pop("backlogs", None)).build([cand(*args, **kw)])[0]
        return out["backlog"]["status"], [(m["id"], m["relation"]) for m in out["backlog"]["matches"]]

    def test_duplicate_needs_same_channel_format_evergreen_and_scope(self):
        status, matches = self.status("ai-security", "voice-clone", "zoora-security", "scam-of-the-week", "ai-security", 70, "v1")
        self.assertEqual(status, "duplicate")
        self.assertEqual(matches[0], ("sotw-voice-clone", "duplicate"))

    def test_fact_tags_define_scope(self):
        self.assertEqual(self.status("drainers", "approvals", "zoora-security", "explainer", "drainers", 70, "v1")[0], "duplicate")
        self.assertEqual(self.status("drainers", "permit-signatures", "zoora-security", "explainer", "drainers", 70, "v1")[0], "related")

    def test_general_idea_duplicates_a_general_existing_one(self):
        self.assertEqual(self.status("fake-job-malware", None, "zoora-security", "explainer", "fake-job-malware", 70, "v1")[0], "duplicate")
        self.assertEqual(self.status("key-management", "seed-phrase", "zoora-security", "explainer", "key-management", 70, "v1")[0], "related")

    def test_other_channel_same_scope_is_related_never_duplicate(self):
        status, matches = self.status("address-poisoning", None, "zoora-security", "explainer", "address-poisoning", 70, "v1")
        self.assertEqual(status, "related")
        self.assertIn(("pov-address-poisoning", "related"), matches)

    def test_topic_mapped_into_another_bucket_needs_a_mention(self):
        # A SIM-swap explainer files under social-engineering on the security channel but is no copy of the general
        # social-engineering ideas, which never mention SIM swaps.
        backlogs = copy.deepcopy(helpers.TEST_BACKLOGS)
        backlogs["zoora-security"]["ideas"].append(helpers.idea("explainer-social-engineering", "Social engineering: the hack that targets people", "explainer", "social-engineering", 3, ["social-engineering"]))
        status, matches = self.status("sim-swap", None, "zoora-security", "explainer", "social-engineering", 70, "v1", backlogs=backlogs)
        self.assertEqual(status, "related")
        self.assertIn(("explainer-social-engineering", "related"), matches)

    def test_no_backlogs_means_new(self):
        self.assertEqual(self.status("drainers", None, "zoora-security", "explainer", "drainers", 70, "v1", backlogs={})[0], "new")


if __name__ == "__main__":
    unittest.main()
