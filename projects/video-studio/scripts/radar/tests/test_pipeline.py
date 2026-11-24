"""End-to-end offline runs: fixtures -> JSON + Markdown, the CLI, history, redaction."""

import contextlib
import io
import json
import os
import re
import tempfile
import unittest

import radar
from radarlib import classify, history, pipeline, safety

from .helpers import FIXTURES, RUN_DATE, SOURCES

INCIDENT_KEYS = {"id", "title", "protocol", "chains", "type", "dateUtc", "reportedLosses", "status", "sources",
                 "postMortemUrl", "evergreenTopic", "notes", "score", "facts", "statusReason", "shortReady"}
SOURCE_KEYS = {"id", "url", "title", "excerpt", "publishedUtc", "tier"}


class OfflineRun(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.doc, cls.json_path, cls.md_path = pipeline.run_collect(
            RUN_DATE, offline=True, out_dir=cls.tmp.name, cache_dir=None, sources_path=SOURCES,
            fixtures_dir=FIXTURES, log=lambda m: None)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def incidents(self):
        return self.doc["top"] + self.doc["alsoSeen"]

    def test_files_and_top_five(self):
        self.assertTrue(self.json_path.endswith("2026-11-24.json"))
        with open(self.json_path, encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["runDate"], "2026-11-24")
        self.assertEqual(self.doc["mode"], "offline-fixtures")
        self.assertEqual(len(self.doc["top"]), 5)
        protocols = [i["protocol"] for i in self.doc["top"]]
        self.assertEqual(protocols[0], "Binance")
        self.assertIn("Chainflip", protocols)
        scores = [i["score"]["total"] for i in self.incidents()]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_incident_schema(self):
        for inc in self.incidents():
            with self.subTest(incident=inc["id"]):
                self.assertLessEqual(INCIDENT_KEYS, set(inc))
                self.assertIn(inc["type"], classify.TYPES)
                self.assertIn(inc["status"], ("developing", "confirmed"))
                self.assertTrue(inc["evergreenTopic"] is None or inc["evergreenTopic"] in classify.EVERGREEN)
                # an incident date only when a source gives one; otherwise null with a note and the first coverage date
                if inc["dateUtc"] is None:
                    self.assertRegex(inc["firstSeenUtc"], r"^\d{4}-\d{2}-\d{2}$")
                    self.assertIn("incident date not stated", inc["dateNote"])
                else:
                    self.assertRegex(inc["dateUtc"], r"^\d{4}-\d{2}-\d{2}$")
                for src in inc["sources"]:
                    self.assertLessEqual(SOURCE_KEYS, set(src))
                    self.assertIn(src["tier"], ("A", "B", "C"))
                    self.assertLessEqual(len(src["excerpt"]), 280)
                for loss in inc["reportedLosses"]:
                    self.assertLessEqual({"amountUsd", "by", "url"}, set(loss))

    def test_status_rule_holds(self):
        # confirmed: an unhedged tier-A source that is not an incident database (a tracker never confirms alone), a
        # tier-B outlet relaying the project's own statement, or two unhedged tier-B outlets with different origins
        for inc in self.incidents():
            sources = [s for s in inc["sources"] if not s.get("roundup")]
            primary = [s for s in sources if s["tier"] == "A" and not s.get("tracker") and not s.get("hedge")]
            outlets = {}
            for s in sources:
                if s["tier"] == "B" and not s.get("hedge"):
                    outlets.setdefault(s["publisher"].lower(), s.get("origin") or s["publisher"].lower())
            own = inc["protocol"].lower()
            relayed = [o for o in outlets.values() if o == own or own in o or o in own]
            expected = "confirmed" if primary or relayed or len(set(outlets.values())) >= 2 else "developing"
            self.assertEqual(inc["status"], expected, inc["id"])
            if expected == "developing":
                self.assertIn("developing", inc["title"])
            self.assertFalse(any(s.get("tracker") for s in primary))

    def test_every_fact_and_figure_is_in_a_stored_excerpt(self):
        for inc in self.incidents():
            sources = {(s["id"], s["url"]): s for s in inc["sources"]}
            for fact in inc["facts"]:
                src = sources[(fact["sourceId"], fact["url"])]
                stored = {"title": src["title"], "qualifier": src.get("qualifier", "")}.get(fact["field"], src["excerpt"])
                self.assertIn(fact["quote"], stored)
            for loss in inc["reportedLosses"]:
                src = sources[(loss["by"], loss["url"])]
                self.assertIn(loss["quote"], src["title"] + " " + src["excerpt"])

    def test_generated_text_is_clean(self):
        for inc in self.incidents():
            self.assertEqual(safety.check_generated(inc["title"]), [], inc["title"])
            for fact in inc["facts"]:
                self.assertEqual(safety.check_generated(fact["text"].split(":")[0]), [], fact["text"])
            for factor in inc["score"]["factors"].values():
                self.assertFalse(safety.price_talk(factor["reason"]), factor["reason"])

    def test_no_names_or_code_in_output(self):
        text = json.dumps(self.doc, ensure_ascii=False)
        for inc in self.incidents():
            for src in inc["sources"]:
                self.assertEqual(safety.redact_people(src["title"])[1], 0, src["title"])
                self.assertEqual(safety.redact_people(src["excerpt"])[1], 0, src["excerpt"])
                self.assertEqual(safety.redact_code(src["excerpt"])[1], 0, src["excerpt"])
        self.assertNotIn("totalAssets", text)

    def test_window_and_unclustered(self):
        for entry in self.doc["unclustered"]:
            self.assertGreaterEqual(entry["publishedUtc"], "2026-11-22")
        ids = {i["id"] for i in self.incidents()}
        self.assertFalse(any("drift" in i for i in ids), "a May item is not a candidate")
        self.assertFalse(any(i.startswith("2026-11-14-kava") for i in ids), "old incident with only stale coverage")

    def test_markdown(self):
        with open(self.md_path, encoding="utf-8") as fh:
            md = fh.read()
        self.assertTrue(md.startswith("# Security radar: 2026-11-24"))
        for heading in ("## Top 5", "## Also seen", "## Unclustered security items", "## Source health", "## Method"):
            self.assertIn(heading, md)
        for inc in self.doc["top"]:
            self.assertIn(inc["title"].split(" (")[0], md)
        self.assertIn("never averaged", md)
        self.assertNotRegex(md, r"\]\((?!https?://)")

    def test_source_rows(self):
        rows = {r["id"]: r for r in self.doc["sources"]}
        self.assertEqual(rows["blockworks"]["status"], "skipped")
        self.assertEqual(rows["defillama-hacks"]["status"], "ok")
        self.assertTrue(all(r["status"] for r in rows.values()))
        self.assertEqual(self.doc["counts"]["sourcesOk"], len(rows) - 1)

    def test_deterministic(self):
        with tempfile.TemporaryDirectory() as other:
            doc, _, _ = pipeline.run_collect(RUN_DATE, offline=True, out_dir=other, cache_dir=None, sources_path=SOURCES,
                                             fixtures_dir=FIXTURES, log=lambda m: None)
        self.assertEqual(json.dumps(doc, sort_keys=True), json.dumps(self.doc, sort_keys=True))


class HistoryRun(unittest.TestCase):
    def test_novelty_corrections_and_offline_files_ignored(self):
        hist = history.load_history(os.path.join(FIXTURES, "history"), RUN_DATE)
        self.assertEqual(hist["files"], ["2026-11-23.json"], "offline-mode outputs are not history")
        with tempfile.TemporaryDirectory() as out:
            doc, _, _ = pipeline.run_collect(RUN_DATE, offline=True, out_dir=out, cache_dir=None, sources_path=SOURCES,
                                             fixtures_dir=FIXTURES, history_dir=os.path.join(FIXTURES, "history"),
                                             log=lambda m: None)
        chainflip = next(i for i in doc["top"] + doc["alsoSeen"] if i["protocol"] == "Chainflip")
        self.assertEqual(chainflip["score"]["factors"]["novelty"]["value"], 0.5)
        correction = next(c for c in doc["corrections"] if c["protocol"] == "Chainflip")
        self.assertIn("status developing -> confirmed", correction["changes"])
        self.assertIn("slowmist-hacked now states 12,000,000 USD (previously 11,500,000 USD)", correction["changes"])
        self.assertTrue(any("Changed since the 2026-11-23 radar" in n for n in chainflip["notes"]))

    def test_newly_surfaced_records_count_as_fresh(self):
        with tempfile.TemporaryDirectory() as out:
            doc, _, _ = pipeline.run_collect(RUN_DATE, offline=True, out_dir=out, cache_dir=None, sources_path=SOURCES,
                                             fixtures_dir=FIXTURES, history_dir=os.path.join(FIXTURES, "history"),
                                             log=lambda m: None)
        ids = {i["id"] for i in doc["top"] + doc["alsoSeen"]}
        # Wagyu (Nov 20) was never in a previous run, so it surfaced since: fresh today.
        self.assertTrue(any("wagyu" in i for i in ids))
        # Lighter's database records were seen on Nov 23 and are not refreshed by them.
        lighter = [i for i in doc["top"] + doc["alsoSeen"] if i["protocol"] == "Lighter"]
        self.assertEqual(len(lighter), 1)
        self.assertIn("(rekt-news)", lighter[0]["score"]["factors"]["recency"]["reason"])


class SyntheticRedaction(unittest.TestCase):
    def test_names_handles_addresses_and_functions_never_reach_output(self):
        with tempfile.TemporaryDirectory() as out:
            doc, json_path, md_path = pipeline.run_collect(
                RUN_DATE, offline=True, out_dir=out, cache_dir=None,
                sources_path=os.path.join(FIXTURES, "synthetic", "sources.json"), fixtures_dir=FIXTURES,
                log=lambda m: None)
            with open(json_path, encoding="utf-8") as fh:
                raw = fh.read()
            with open(md_path, encoding="utf-8") as fh:
                raw += fh.read()
        for secret in ("Jane Example", "ExampleSleuth", "John Doe", "Jane Reporter", "withdrawFunds",
                       "0x1111111111111111111111111111111111111111", "utm_source"):
            self.assertNotIn(secret, raw)
        self.assertIn("[named person]", raw)
        acme = [i for i in doc["top"] + doc["alsoSeen"] if i["protocol"] == "Acme Finance"]
        self.assertEqual(len(acme), 1)
        inc = acme[0]
        self.assertEqual(inc["status"], "developing")
        self.assertIn("developing", inc["title"])
        self.assertTrue(any("Legal matter" in n for n in inc["notes"]))
        self.assertEqual([e["amountUsd"] for e in inc["reportedLosses"]], [2.5e6])
        self.assertFalse(any("price" in i["title"].lower() for i in doc["unclustered"]), "price stories are not listed")


class Cli(unittest.TestCase):
    def test_collect_offline(self):
        with tempfile.TemporaryDirectory() as out:
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                code = radar.main(["collect", "--date", "2026-11-24", "--offline-fixtures", "--out-dir", out, "--quiet"])
            self.assertEqual(code, 0)
            self.assertTrue(os.path.exists(os.path.join(out, "2026-11-24.json")))
            self.assertTrue(os.path.exists(os.path.join(out, "2026-11-24.md")))
            self.assertRegex(stdout.getvalue(), r"#1 +\d")

    def test_bad_date_and_window(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            radar.main(["collect", "--date", "24-11-2026"])
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            radar.main(["collect", "--offline-fixtures", "--window-days", "0"])

    def test_sources_config_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "sources.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"sources": [{"id": "x", "name": "X", "kind": "rss", "url": "https://x.test", "parser": "nope", "tier": "A"}]}, fh)
            with self.assertRaises(ValueError):
                pipeline.load_sources(path)
        config = pipeline.load_sources(SOURCES)
        ids = [s["id"] for s in config["sources"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(s.get("terms") for s in config["sources"]))
        self.assertTrue(re.match(r"^[A-Za-z]+/\d", config["policy"]["userAgent"]))


if __name__ == "__main__":
    unittest.main()
