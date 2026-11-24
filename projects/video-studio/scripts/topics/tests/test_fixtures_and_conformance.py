"""The fixture database is synthetic and current, and the exports satisfy the weekly batch's own TypeScript parser
(scripts/batch/lib/backlog.ts, another workflow's code) whenever node and that file are present."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from tests import helpers

BATCH_PARSER = os.path.join(helpers.STUDIO, "scripts", "batch", "lib", "backlog.ts")
BATCH_CONFIG = os.path.join(helpers.STUDIO, "scripts", "batch", "config.json")
NODE = shutil.which("node")

CHECK = r"""
import {readFileSync} from 'node:fs';
const [parserPath, configPath, ...files] = process.argv.slice(2);
const {parseBacklog, crossBacklogProblems} = await import(parserPath);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const parsed = [];
const problems = [];
for (const f of files) {
  const data = JSON.parse(readFileSync(f, 'utf8'));
  const channel = config.channels.find((c) => c.channel === data.channel);
  try { parsed.push(parseBacklog(data, f, channel, 'sha')); }
  catch (err) { problems.push(...(err.reasons ?? [String(err.message)])); }
}
problems.push(...crossBacklogProblems(parsed));
console.log(JSON.stringify({parsed: parsed.map((b) => [b.channel, b.ideas.length]), problems}));
"""


class FixtureDatabase(unittest.TestCase):
    def test_database_is_synthetic(self):
        db = helpers.db()
        self.assertIn("SYNTHETIC", db["note"])
        for ch in db["channels"]:
            if ch["id"] != "UCjNibXSaZqeXSD36V6dyIVQ":
                self.assertTrue(ch["title"].endswith("(synthetic)"), ch["title"])
        for v in db["videos"]:
            self.assertRegex(v["id"], r"^[A-Za-z0-9_-]{11}$")

    def test_database_matches_its_builder(self):
        res = subprocess.run([sys.executable, os.path.join(helpers.TOPICS, "tools", "build_fixtures.py"), "--check"], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_recorded_error_is_googles_shape(self):
        body = helpers.error_body("forbidden-no-key-recorded-2026-11-24")
        self.assertEqual(body["error"]["code"], 403)
        self.assertEqual(body["error"]["status"], "PERMISSION_DENIED")


@unittest.skipUnless(NODE and os.path.exists(BATCH_PARSER) and os.path.exists(BATCH_CONFIG), "node or scripts/batch (the weekly batch workflow) is not available")
class BatchConformance(unittest.TestCase):
    def node_check(self, files):
        script_dir = tempfile.mkdtemp(prefix="topics-node-")
        try:
            script = os.path.join(script_dir, "check.mjs")
            with open(script, "w") as fh:
                fh.write(CHECK)
            res = subprocess.run([NODE, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning", script, BATCH_PARSER, BATCH_CONFIG, *files],
                                 capture_output=True, text=True, timeout=120)
        finally:
            shutil.rmtree(script_dir, ignore_errors=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        return json.loads(res.stdout.strip().splitlines()[-1])

    def test_exports_and_merged_previews_parse(self):
        studio = helpers.Studio()
        try:
            _doc, written = helpers.run_fixtures(studio, merge_preview=True)
            exports = [p for p in written if ".backlog." in p]
            merged = [p for p in written if ".merged." in p]
            self.assertEqual(len(exports), 2)
            self.assertEqual(self.node_check(exports)["problems"], [])
            self.assertEqual(self.node_check(merged)["problems"], [])
        finally:
            studio.cleanup()

    def test_against_the_real_channel_backlogs_when_present(self):
        real = [os.path.join(helpers.STUDIO, "content", ch, "backlog.json") for ch in ("zoora-ai", "zoora-security")]
        if not all(os.path.exists(p) for p in real):
            self.skipTest("the channel backlogs are not in this checkout")
        out = tempfile.mkdtemp(prefix="topics-real-")
        try:
            from topiclib import pipeline
            _doc, written = pipeline.run_find({
                "mode": "fixtures", "studio": helpers.STUDIO, "out_dir": out, "now": helpers.NOW, "run_date": helpers.RUN_DATE,
                "fixtures_dir": helpers.FIXTURES, "cache_dir": None, "ledger_path": None, "merge_preview": True,
            })
            merged = [p for p in written if ".merged." in p]
            result = self.node_check(merged)
            self.assertEqual(result["problems"], [])
        finally:
            shutil.rmtree(out, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
