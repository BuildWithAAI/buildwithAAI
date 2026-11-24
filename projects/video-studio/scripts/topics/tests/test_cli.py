import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from tests import helpers

CLI = os.path.join(helpers.TOPICS, "topics.py")


def run(*args, env=None):
    full_env = dict(os.environ)
    full_env.pop("YOUTUBE_API_KEY", None)
    full_env.update(env or {})
    return subprocess.run([sys.executable, CLI, *args], capture_output=True, text=True, env=full_env, cwd=helpers.STUDIO, timeout=120)


class Cli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="topics-cli-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_fixture_run(self):
        res = run("find", "--fixtures", "--out-dir", self.tmp, "--quiet", "--merge-preview")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("(fixtures)", res.stdout)
        files = sorted(os.listdir(self.tmp))
        self.assertIn("2026-11-24.md", files)
        self.assertIn("2026-11-24.merged.zoora-security.json", files)

    def test_live_run_without_go_ahead_is_blocked(self):
        res = run("find", "--out-dir", self.tmp, env={"YOUTUBE_API_KEY": helpers.FAKE_KEY})
        self.assertEqual(res.returncode, 3)
        self.assertIn("derived metrics", res.stderr)
        self.assertNotIn(helpers.FAKE_KEY, res.stderr + res.stdout)
        self.assertEqual(os.listdir(self.tmp), [])

    def test_plan(self):
        res = run("plan")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("21 search.list calls", res.stdout)

    def test_bad_input(self):
        self.assertEqual(run("find", "--fixtures", "--max-units", "-5").returncode, 2)
        self.assertEqual(run("find", "--fixtures", "--date", "2026-02-30").returncode, 2)
        res = run("find", "--fixtures", "--out-dir", self.tmp, "--orders", "popularity")
        self.assertEqual(res.returncode, 2)

    def test_prune_and_quota(self):
        out = os.path.join(self.tmp, "out")
        os.makedirs(out)
        with open(os.path.join(out, "2020-01-01.json"), "w") as fh:
            json.dump({}, fh)
        res = run("prune", "--out-dir", out, "--cache-dir", os.path.join(self.tmp, "cache"))
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(os.listdir(out), [])
        ledger = os.path.join(self.tmp, "ledger.json")
        res = run("quota", "--ledger", ledger)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("search", res.stdout)

    def test_main_in_process(self):
        sys.path.insert(0, helpers.TOPICS)
        import topics  # noqa: E402
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(io.StringIO()):
            code = topics.main(["find", "--fixtures", "--out-dir", self.tmp, "--quiet", "--top", "3", "--export-top", "1"])
        self.assertEqual(code, 0)
        with open(os.path.join(self.tmp, "2026-11-24.json"), encoding="utf-8") as fh:
            doc = json.load(fh)
        self.assertLessEqual(doc["counts"]["listed"], 3)
        for name in os.listdir(self.tmp):
            if ".backlog." in name:
                with open(os.path.join(self.tmp, name), encoding="utf-8") as fh:
                    self.assertEqual(len(json.load(fh)["ideas"]), 1)


if __name__ == "__main__":
    unittest.main()
