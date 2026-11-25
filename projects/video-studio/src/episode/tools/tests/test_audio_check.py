"""Tests for the Episode's audio gate (stdlib unittest; run with the audio engine's venv):

    .venv-audio/bin/python -m unittest discover -s src/episode/tools/tests -t src/episode/tools

The gain-law port against the TypeScript (through the audio-plan CLI's gainProbe), and the null test's sensitivity to the
render faults critic F1 named (a bed off its clock, a wrong level). The demo tests need the _engine-demo voice output
(public/generated is gitignored) and skip without it.
"""

from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
STUDIO = TOOLS.parents[2]
sys.path.insert(0, str(TOOLS))

import numpy as np  # noqa: E402

import audio_check as ac  # noqa: E402

DEMO = STUDIO / "public" / "generated" / "zoora-ai" / "_engine-demo" / "en" / "timeline.json"
_plans: dict = {}


def demo_plan(lang: str = "en", short: str | None = None) -> dict:
    """The demo's plan from the audio-plan CLI (the TypeScript planner and its gainProbe), cached per test run."""
    key = (lang, short)
    if key not in _plans:
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "plan.json"
            cmd = ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "src/episode/dev/audioPlan.ts", "zoora-ai/_engine-demo", "--lang", lang, "--out", str(out)]
            if short:
                cmd += ["--short", short]
            subprocess.run(cmd, cwd=STUDIO, check=True, capture_output=True, text=True)
            _plans[key] = json.loads(out.read_text())
    return copy.deepcopy(_plans[key])


class GainLawTests(unittest.TestCase):
    def test_fade_shapes(self):
        u = np.linspace(0, 1, 101)
        self.assertEqual(ac.rcos(np.array([0.0]))[0], 0.0)
        self.assertAlmostEqual(ac.rcos(np.array([1.0]))[0], 1.0)
        # an equal-power crossfade keeps the summed power constant
        a, b = ac.fade_shape(u, "equalPower"), ac.fade_shape(1 - u, "equalPower")
        self.assertLess(float(np.abs(a ** 2 + b ** 2 - 1).max()), 1e-12)
        # a raised-cosine pair keeps the summed amplitude constant instead
        self.assertLess(float(np.abs(ac.fade_shape(u, "raisedCosine") + ac.fade_shape(1 - u, "raisedCosine") - 1).max()), 1e-12)

    def test_duck_holds_short_pauses_and_releases_long_ones(self):
        duck = {"attackMs": 120, "releaseMs": 1200, "lookaheadMs": 120, "minGapMs": 2000, "depthsDb": [2, 12, 4]}
        t = np.array([0.0, 0.5, 1.6, 2.4, 5.0, 6.7])
        d = ac.duck_amount(t, duck, [{"start": 0.5, "end": 1.0}, {"start": 2.5, "end": 3.0}, {"start": 6.5, "end": 7.0}])
        self.assertEqual(d[0], 0.0)  # before the lookahead
        self.assertEqual(d[1], 1.0)  # the first word: fully down (lookahead = attack)
        self.assertEqual(d[2], 1.0)  # a 1.5 s pause stays ducked (minGap 2 s)
        self.assertEqual(d[3], 1.0)
        self.assertEqual(d[4], 0.0)  # 3.5 s of pause: released after 1.2 s
        self.assertEqual(d[5], 1.0)

    def test_rest_dips_to_its_floor(self):
        bed = {"from": 0, "durationInFrames": 300, "fadeInFrames": 0, "fadeOutFrames": 0, "fadeInCurve": "raisedCosine", "fadeOutCurve": "raisedCosine",
               "rests": [{"start": 4.0, "end": 6.0, "fadeOutMs": 500, "fadeInMs": 500, "floorDb": -18}]}
        a = ac.bed_amplitude(np.array([1.0, 3.75, 5.0, 9.0]), bed, 30)
        self.assertEqual(a[0], 1.0)
        self.assertAlmostEqual(a[2], 10 ** (-18 / 20))
        self.assertTrue(10 ** (-18 / 20) < a[1] < 1.0)
        self.assertEqual(a[3], 1.0)


@unittest.skipUnless(DEMO.exists(), "needs the _engine-demo voice output (public/generated)")
class DemoPlanTests(unittest.TestCase):
    def test_port_matches_the_typescript_and_catches_a_drift(self):
        for lang, short in (("en", None), ("es", None), ("en", "short1")):
            plan = demo_plan(lang, short)
            self.assertTrue(plan["gainProbe"], "the CLI writes the probe")
            self.assertLess(ac.check_gain_port(plan), 1e-6, f"{lang} {short}")
        # a plan edited after the probe was taken (here: one bed 1 dB louder) no longer matches it
        plan = demo_plan()
        plan["beds"][0]["levelDb"] += 1
        self.assertGreater(ac.check_gain_port(plan), 0.05)

    def test_null_test_catches_a_bed_off_its_clock_or_level(self):
        plan = demo_plan()
        n = plan["durationInFrames"] * ac.SPF
        want = ac.rebuild_music(plan, n)
        self.assertEqual(float(np.abs(ac.rebuild_music(plan, n) - want).max()), 0.0)  # deterministic
        for name, edit in (("one frame late on the clock", lambda b: b.update(startAtSample=b["startAtSample"] + ac.SPF)),
                           ("0.5 dB louder", lambda b: b.update(levelDb=b["levelDb"] + 0.5))):
            bad = copy.deepcopy(plan)
            edit(bad["beds"][0])
            res = float(np.abs(ac.rebuild_music(bad, n) - want).max())
            self.assertGreater(ac.db(res), plan["gate"]["nullResidualMaxDbfs"], name)

    def test_the_plan_carries_the_calibrated_lines(self):
        g = demo_plan()["gate"]
        self.assertEqual(g["duckCoverageMin"], 0.98)
        self.assertEqual(g["worstPhraseSnrMinDb"], 12.5)
        self.assertEqual(g["nullResidualMaxDbfs"], -60)
        self.assertFalse(g["phone"])
        self.assertTrue(demo_plan("en", "short1")["gate"]["phone"])


if __name__ == "__main__":
    unittest.main()
