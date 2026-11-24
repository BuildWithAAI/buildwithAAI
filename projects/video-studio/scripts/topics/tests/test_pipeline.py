import datetime as dt
import json
import os
import unittest

from tests import helpers
from topiclib import fake_api, pipeline
from topiclib.http import ApiError, classify_error


def scenario_video(prefix):
    return helpers.by_scenario(prefix)["id"]


def evidence_for(doc, video_id):
    for idea in doc["ideas"]:
        for e in idea["evidence"]:
            if e["videoId"] == video_id:
                return idea, e
    return None, None


class EndToEnd(unittest.TestCase):
    """One fixture run, checked scenario by scenario (fixtures/api/db.json says what each candidate exercises)."""

    @classmethod
    def setUpClass(cls):
        cls.studio = helpers.Studio()
        cls.doc, cls.written = helpers.run_fixtures(cls.studio)

    @classmethod
    def tearDownClass(cls):
        cls.studio.cleanup()

    def test_outputs_are_written(self):
        names = sorted(os.path.basename(p) for p in self.written)
        self.assertEqual(names, ["2026-11-24.backlog.zoora-ai.json", "2026-11-24.backlog.zoora-security.json", "2026-11-24.json", "2026-11-24.md"])
        with open(os.path.join(self.studio.out, "2026-11-24.json"), encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["runDate"], "2026-11-24")

    def test_quota_matches_the_calls_sent(self):
        q = self.doc["quota"]
        self.assertEqual(q["spent"]["search"], q["calls"]["search.list"])
        self.assertEqual(q["spent"]["default"], sum(n for m, n in q["calls"].items() if m != "search.list"))
        self.assertEqual(q["calls"]["search.list"], 21)
        self.assertLessEqual(q["spent"]["default"], 2000)

    def test_exclusions(self):
        self.assertEqual(self.doc["rejected"], {"not-outlier": 7, "below-floor": 3, "attack-tutorial": 1, "live-or-upcoming": 1, "off-niche": 1, "own-channel": 1, "price-content": 1})
        for prefix in ("attack tutorial", "our own channel", "upcoming broadcast", "price content", "off-niche", "below the view floor", "big channel"):
            idea, _ = evidence_for(self.doc, scenario_video(prefix))
            self.assertIsNone(idea, prefix)

    def test_clean_outlier_and_merged_queries(self):
        idea, e = evidence_for(self.doc, scenario_video("clean long-form outlier"))
        self.assertEqual((idea["channel"], idea["format"], idea["subtopic"]), ("zoora-security", "explainer", "permit-signatures"))
        self.assertEqual(sorted(e["queries"]), ["en-crypto-security", "en-wallet-drainers"])
        self.assertEqual(e["baseline"]["method"], "median-same-format")
        self.assertEqual(e["flags"], [])
        self.assertLessEqual(idea["rank"], 3)

    def test_per_format_baseline_finds_the_long_form_outlier(self):
        _idea, e = evidence_for(self.doc, scenario_video("per-format baseline"))
        self.assertEqual(e["baseline"]["format"], "long")
        self.assertGreater(e["outlier"], 8)
        _idea, short = evidence_for(self.doc, scenario_video("Short above the Shorts floor"))
        self.assertEqual((short["format"], short["baseline"]["format"]), ("short", "short"))

    def test_floor_estimates_and_flags(self):
        _i, tiny = evidence_for(self.doc, scenario_video("baseline floor"))
        self.assertIn("floor-applied", tiny["flags"])
        self.assertIn("format-assumed", tiny["flags"])
        self.assertAlmostEqual(tiny["outlier"], 14.0)
        _i, new = evidence_for(self.doc, scenario_video("estimated baseline (lifetime"))
        self.assertEqual((new["baseline"]["method"], new["baseline"]["median"]), ("lifetime-average", 3000.0))
        _i, gone = evidence_for(self.doc, scenario_video("uploads playlist 404"))
        self.assertIn("estimated-baseline", gone["flags"])
        self.assertTrue(any("uploads playlist" in n for n in gone["baseline"]["notes"]))
        _i, epoch = evidence_for(self.doc, scenario_video("baseline spans"))
        self.assertIn("baseline-spans-view-count-change", epoch["flags"])
        _i, young = evidence_for(self.doc, scenario_video("young video"))
        self.assertIn("young-video", young["flags"])
        _i, hidden = evidence_for(self.doc, scenario_video("likes hidden"))
        self.assertEqual(hidden["components"]["engagement"], 0.5)

    def test_grouping_languages_and_income_flag(self):
        seed, _ = evidence_for(self.doc, scenario_video("Spanish; groups with N1"))
        self.assertEqual(sorted(seed["languages"]), ["en", "es"])
        self.assertEqual(seed["breadthBonus"], 3)
        honeypot, _ = evidence_for(self.doc, scenario_video("Portuguese; new POV idea"))
        self.assertEqual((honeypot["channel"], honeypot["format"], honeypot["backlog"]["status"]), ("zoora-ai", "pov-story", "related"))
        sniping, _ = evidence_for(self.doc, scenario_video("income-claim flag"))
        self.assertIn("income-claims", sniping["sourceFlags"])
        self.assertTrue(any("income or profit claims" in r for r in sniping["risks"]))

    def test_duplicates_become_evidence_for_existing_ideas(self):
        dups = {i["backlog"]["matches"][0]["id"] for i in self.doc["ideas"] if i["backlog"]["status"] == "duplicate"}
        self.assertEqual(dups, {"sotw-voice-clone", "sotw-deepfake-livestream", "explainer-wallet-drainers", "pov-address-poisoning", "explainer-fake-job-malware"})
        voice = [i for i in self.doc["ideas"] if i["backlog"]["status"] == "duplicate" and i["subtopic"] == "voice-clone"][0]
        self.assertEqual(len(voice["evidence"]), 2, "the English and Portuguese voice-clone outliers group together")
        self.assertIsNone(voice["rank"])

    def test_every_listed_idea_has_link_why_angle_facts_and_fit(self):
        listed = [i for i in self.doc["ideas"] if i["rank"]]
        self.assertEqual([i["rank"] for i in listed], list(range(1, len(listed) + 1)))
        with open(os.path.join(self.studio.out, "2026-11-24.md"), encoding="utf-8") as fh:
            md = fh.read()
        for i in listed:
            top = i["evidence"][0]
            self.assertTrue(top["url"].startswith("https://www.youtube.com/watch?v="))
            self.assertTrue(top["why"])
            self.assertGreater(len(i["pitch"]["angle"]), 40)
            self.assertTrue(i["facts"])
            self.assertIn(i["fit"]["channelName"], ("Zoora AI", "The Zoo & Badger Show"))
            self.assertIn(top["url"], md)
            self.assertIn(i["pitch"]["angle"], md)
        for heading in ("**Original video (YouTube):**", "**Why it is an outlier:**", "**Our original angle:**", "**Facts to verify before scripting:**", "**Channel fit:**"):
            self.assertEqual(md.count(heading), len(listed), heading)
        self.assertIn("Fixture run", md)
        self.assertIn("deleted on 2026-12-24", md)

    def test_exports_are_valid_and_clean(self):
        from topiclib import export
        slugs = {x["id"] for b in helpers.TEST_BACKLOGS.values() for x in b["ideas"]}
        for channel in ("zoora-ai", "zoora-security"):
            with open(os.path.join(self.studio.out, f"2026-11-24.backlog.{channel}.json"), encoding="utf-8") as fh:
                data = json.load(fh)
            self.assertEqual(export.validate_backlog(data, helpers.FORMATS[channel], slugs), [])
            self.assertEqual(export.find_api_data_leaks(data), [])

    def test_runs_are_deterministic(self):
        doc2, _ = helpers.run_fixtures(self.studio)
        strip = lambda d: json.dumps({k: v for k, v in d.items() if k not in ("retention",)}, sort_keys=True)  # noqa: E731
        self.assertEqual(strip(self.doc), strip(doc2))


class Budgets(unittest.TestCase):
    def setUp(self):
        self.studio = helpers.Studio()

    def tearDown(self):
        self.studio.cleanup()

    def test_small_unit_cap_estimates_the_remaining_baselines(self):
        doc, _ = helpers.run_fixtures(self.studio, max_units=12)
        self.assertLessEqual(doc["quota"]["spent"]["default"], 12)
        self.assertTrue(any("estimated because this run's unit cap" in w for w in doc["warnings"]))
        estimated = [e for i in doc["ideas"] for e in i["evidence"] if "estimated-baseline" in e["flags"]]
        self.assertTrue(estimated)

    def test_search_cap_skips_low_priority_queries(self):
        doc, _ = helpers.run_fixtures(self.studio, max_searches=5)
        statuses = [r["status"] for r in doc["queries"]]
        self.assertEqual(statuses.count("ok"), 5)
        self.assertEqual(statuses.count("skipped: search cap reached"), 16)
        self.assertEqual({r["id"][:2] for r in doc["queries"] if r["status"] == "ok"}, {"en"}, "priority-1 English queries go first")

    def test_quota_exceeded_mid_run(self):
        doc, _ = helpers.run_fixtures(self.studio, failures=[{"method": "search.list", "after": 3, "times": 1, "error": "quotaExceeded"}])
        statuses = [r["status"] for r in doc["queries"]]
        self.assertEqual(statuses[:3], ["ok"] * 3)
        self.assertEqual(statuses[3], "quotaExceeded")
        self.assertTrue(all(s == "skipped: quota exhausted" for s in statuses[4:]))
        self.assertIn("search", doc["quota"]["exhausted"])

    def test_auth_failure_stops_the_run(self):
        with self.assertRaises(pipeline.RunFailed):
            helpers.run_fixtures(self.studio, failures=[{"method": "search.list", "times": 1, "error": "keyInvalid"}])

    def test_cache_makes_a_rerun_free(self):
        cache_dir = os.path.join(self.studio.root, ".cache", "topics")
        first, _ = helpers.run_fixtures(self.studio, cache_dir=cache_dir)
        second, _ = helpers.run_fixtures(self.studio, cache_dir=cache_dir)
        self.assertEqual(second["quota"]["spent"], {"default": 0, "search": 0})
        self.assertGreater(second["cache"]["hits"], 0)
        self.assertEqual([i["id"] for i in first["ideas"]], [i["id"] for i in second["ideas"]])

    def test_ledger_lowers_the_caps(self):
        ledger = os.path.join(self.studio.root, "ledger.json")
        with open(ledger, "w") as fh:
            json.dump({"version": 1, "days": {"2026-11-24": {"search": 95, "default": 0}}}, fh)
        doc, _ = helpers.run_fixtures(self.studio, ledger_path=ledger)
        self.assertEqual(doc["quota"]["caps"]["search"], 5)
        self.assertTrue(doc["quota"]["notes"])


class LiveMode(unittest.TestCase):
    def setUp(self):
        self.studio = helpers.Studio()

    def tearDown(self):
        self.studio.cleanup()

    def live_config(self, accepted):
        cfg = helpers.config()
        cfg["compliance"]["derivedMetricsAmendment"].update(accepted=accepted, acceptedOn="2026-11-30" if accepted else None)
        path = os.path.join(self.studio.root, "config.json")
        with open(path, "w") as fh:
            json.dump(cfg, fh)
        return path

    def test_policy_gate_blocks_live_runs_without_the_amendment(self):
        with self.assertRaises(pipeline.PolicyBlocked) as ctx:
            helpers.run_fixtures(self.studio, mode="live", api_key=helpers.FAKE_KEY, config_path=self.live_config(False))
        self.assertIn("Analytics & Reporting", str(ctx.exception))
        self.assertFalse(os.path.exists(self.studio.out), "nothing is written when blocked")

    def test_missing_key_blocks(self):
        with self.assertRaises(pipeline.PolicyBlocked):
            helpers.run_fixtures(self.studio, mode="live", api_key="", config_path=self.live_config(True))

    def test_live_run_with_a_transport_never_leaks_the_key(self):
        fake = fake_api.FakeYouTube(helpers.db(), errors_dir=helpers.ERRORS)
        doc, written = helpers.run_fixtures(self.studio, mode="live", api_key=helpers.FAKE_KEY, transport=fake, config_path=self.live_config(True),
                                            cache_dir=os.path.join(self.studio.root, ".cache"), ledger_path=os.path.join(self.studio.root, "ledger.json"))
        self.assertEqual(doc["mode"], "live")
        self.assertTrue(doc["ideas"])
        for root, _dirs, files in os.walk(self.studio.root):
            for name in files:
                with open(os.path.join(root, name), encoding="utf-8", errors="replace") as fh:
                    self.assertNotIn(helpers.FAKE_KEY, fh.read(), name)
        with open(os.path.join(self.studio.out, "2026-11-24.md"), encoding="utf-8") as fh:
            self.assertNotIn("Fixture run", fh.read())

    def test_no_successful_search_fails_a_live_run(self):
        class Down:
            def get(self, method, params):
                raise classify_error(method, 503, json.dumps(helpers.error_body("backendError")).encode())
        with self.assertRaises(pipeline.RunFailed):
            helpers.run_fixtures(self.studio, mode="live", api_key=helpers.FAKE_KEY, transport=Down(), config_path=self.live_config(True))


class Retention(unittest.TestCase):
    def test_old_reports_are_pruned_on_every_run(self):
        studio = helpers.Studio()
        try:
            os.makedirs(studio.out, exist_ok=True)
            old = os.path.join(studio.out, "2026-10-01.md")
            with open(old, "w") as fh:
                fh.write("old report")
            doc, _ = helpers.run_fixtures(studio)
            self.assertFalse(os.path.exists(old))
            self.assertEqual(doc["retention"]["prunedReports"], ["2026-10-01.md"])
        finally:
            studio.cleanup()


class Selection(unittest.TestCase):
    def test_only_and_langs(self):
        cfg = helpers.config()
        self.assertEqual([q["id"] for q in pipeline._select_queries(cfg, only=["wallet drainers"], langs=["es"])], ["es-wallet-drainers"])
        with self.assertRaises(pipeline.UsageError):
            pipeline._select_queries(dict(cfg, queries=[{"id": "x", "q": "y", "lang": "fr"}]))

    def test_window_starts_at_utc_midnight(self):
        self.assertEqual(pipeline.window_start(dt.date(2026, 11, 24), 90), dt.datetime(2026, 8, 26, tzinfo=dt.timezone.utc))

    def test_plan_bounds(self):
        ctx = pipeline.load_context(helpers.STUDIO)
        p = pipeline.plan(ctx["config"], ctx["quota"], {"max_units": 2000, "max_searches": 30})
        self.assertEqual((p["searchCalls"], p["maxResults"], p["videosListCalls"]), (21, 1050, 21))
        self.assertEqual(p["unitsPerBaseline"], 2)


if __name__ == "__main__":
    unittest.main()
