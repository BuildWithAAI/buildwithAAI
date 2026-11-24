import copy
import datetime as dt
import unittest

from tests import helpers
from tests.test_ideas import builder, cand
from topiclib import export

RUN = helpers.RUN_DATE


def make_ideas():
    cs = [
        cand("drainers", "permit-signatures", "zoora-security", "explainer", "drainers", 80, "vid00000001", title="Signature drain story, as told by a source"),
        cand("ai-security", "voice-clone", "zoora-security", "scam-of-the-week", "ai-security", 75, "vid00000002"),
        cand("rug-pulls", "honeypot", "zoora-ai", "pov-story", "rug-pulls", 70, "vid00000003", lang="pt"),
    ]
    return builder().build(cs)


class Exports(unittest.TestCase):
    def setUp(self):
        self.ideas = [i for i in make_ideas() if i["backlog"]["status"] != "duplicate"]
        self.exports = export.build_exports(self.ideas, ["zoora-ai", "zoora-security"], RUN, 30, 10, helpers.TEST_BACKLOGS, ["es", "pt-br"], "out/topics/2026-11-24.md")

    def test_one_export_per_channel_with_new_ideas_only(self):
        self.assertEqual(sorted(self.exports), ["zoora-ai", "zoora-security"])
        sec = self.exports["zoora-security"]
        self.assertEqual([i["id"] for i in sec["ideas"]], ["explainer-permit-signatures"], "the voice-clone duplicate stays out")
        self.assertEqual(sec["rules"], helpers.TEST_BACKLOGS["zoora-security"]["rules"])
        self.assertEqual(sec["ideas"][0]["priority"], 1)

    def test_exports_validate_like_the_batch_parser(self):
        slugs = {x["id"] for b in helpers.TEST_BACKLOGS.values() for x in b["ideas"]}
        for channel, data in self.exports.items():
            self.assertEqual(export.validate_backlog(data, helpers.FORMATS[channel], slugs), [], channel)

    def test_ideas_carry_no_youtube_data(self):
        for data in self.exports.values():
            self.assertEqual(export.find_api_data_leaks(data), [])
            for idea in data["ideas"]:
                self.assertNotIn("youtube.com", repr(idea))
            ev = data["evidence"][data["ideas"][0]["id"]]
            self.assertEqual(ev["expiresOn"], "2026-12-24")
            self.assertTrue(ev["videos"][0]["url"].startswith("https://www.youtube.com/watch?v="))

    def test_a_leak_is_caught(self):
        data = copy.deepcopy(self.exports["zoora-security"])
        data["ideas"][0]["notes"] += " see https://www.youtube.com/watch?v=vid00000001"
        self.assertEqual(export.find_api_data_leaks(data), ["explainer-permit-signatures"])
        data = copy.deepcopy(self.exports["zoora-security"])
        data["ideas"][0]["angle"] += " Signature drain story, as told by a source"
        self.assertEqual(export.find_api_data_leaks(data), ["explainer-permit-signatures"])

    def test_notes_point_at_the_expiring_report(self):
        notes = self.exports["zoora-ai"]["ideas"][0]["notes"]
        self.assertIn("out/topics/2026-11-24.md until 2026-12-24", notes)
        self.assertIn("30 days", notes)

    def test_merge_preview_appends_after_the_last_priority(self):
        merged = export.merge_preview(helpers.TEST_BACKLOGS["zoora-ai"], self.exports["zoora-ai"])
        self.assertEqual(len(merged["ideas"]), len(helpers.TEST_BACKLOGS["zoora-ai"]["ideas"]) + 1)
        self.assertEqual(merged["ideas"][-1]["priority"], 13)
        self.assertNotIn("evidence", merged)
        self.assertEqual(export.validate_backlog(merged, helpers.FORMATS["zoora-ai"]), [])
        self.assertEqual(len(helpers.TEST_BACKLOGS["zoora-ai"]["ideas"]), 3, "the source backlog is not modified")
        fresh = export.merge_preview(None, self.exports["zoora-ai"])
        self.assertEqual(fresh["ideas"][0]["priority"], 1)


class Validation(unittest.TestCase):
    def good(self):
        return copy.deepcopy(helpers.TEST_BACKLOGS["zoora-security"])

    def problems(self, mutate, formats=None):
        data = self.good()
        mutate(data)
        return export.validate_backlog(data, formats or helpers.FORMATS["zoora-security"])

    def test_each_rule(self):
        def first(d):
            return d["ideas"][0]
        checks = {
            "id must be lowercase": lambda d: first(d).update(id="Bad_ID"),
            "title must be 1-100": lambda d: first(d).update(title="<b>x</b>"),
            "is not one of": lambda d: first(d).update(format="vlog"),
            "priority must be": lambda d: first(d).update(priority=0),
            "week must be null": lambda d: first(d).update(week="next week"),
            "angle must say": lambda d: first(d).update(angle="short"),
            "evergreenTopic must": lambda d: first(d).update(evergreenTopic="Not A Topic"),
            "factTags must": lambda d: first(d).update(factTags=["Bad Tag"]),
            "research must be null": lambda d: first(d).update(research="notes.md"),
            "facts must list": lambda d: first(d).update(facts=[]),
            "needs {need": lambda d: first(d).update(facts=[{"need": "x", "status": "maybe"}]),
            "has status \"fact-bank\" but no factId": lambda d: first(d).update(facts=[{"need": "x", "factId": None, "status": "fact-bank"}]),
            "so its status must be": lambda d: first(d).update(facts=[{"need": "x", "factId": "f1", "status": "researched"}]),
            "risks must list": lambda d: first(d).update(risks=["  "]),
            "languages.master": lambda d: first(d).update(languages={"master": "es", "dubs": []}),
            "languages.dubs may only": lambda d: first(d).update(languages={"master": "en", "dubs": ["fr"]}),
            "is used twice": lambda d: d["ideas"].append(copy.deepcopy(first(d))),
            "\"updated\" must be a date": lambda d: d.update(updated="2026-02-30"),
            "\"ideas\" must hold": lambda d: d.update(ideas=[]),
        }
        for needle, mutate in checks.items():
            with self.subTest(rule=needle):
                problems = self.problems(mutate)
                self.assertTrue(any(needle in p for p in problems), problems)

    def test_valid_backlog_and_slug_clash(self):
        self.assertEqual(export.validate_backlog(self.good(), helpers.FORMATS["zoora-security"]), [])
        clash = export.validate_backlog(self.good(), helpers.FORMATS["zoora-security"], {"sotw-voice-clone"})
        self.assertTrue(any("already used" in p for p in clash))
        self.assertTrue(export.validate_backlog({"version": 2}, ["explainer"]))
        self.assertIsInstance(dt.date.today(), dt.date)


if __name__ == "__main__":
    unittest.main()
