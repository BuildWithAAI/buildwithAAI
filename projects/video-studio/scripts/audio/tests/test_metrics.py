import io as _io
import json
import math
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import numpy as np

import metrics
from audiolib import analysis, dsp, io, master, paths, synth
from audiolib.core import SR

from .helpers import have_ffmpeg, sine

DOC = paths.STUDIO / "docs" / "AUDIO.md"


def white_at(dbfs: float, seconds: float = 10.0, seed: int = 0) -> np.ndarray:
    """Stereo white noise whose 40 Hz-16 kHz power is `dbfs` (AES17: re a full-scale sine)."""
    g = np.random.default_rng(seed)
    frac = (16000 - 40) / (SR / 2)
    return g.standard_normal((2, int(seconds * SR))) * math.sqrt(0.5 * 10 ** (dbfs / 10) / frac)


class AnalysisTest(unittest.TestCase):
    def test_dc_and_clipping(self):
        x = np.vstack([sine(100, 1.0, 0.5) + 0.01, sine(100, 1.0, 0.5)])
        dc = analysis.dc_offset(x)
        self.assertAlmostEqual(dc["max"], 0.01, places=4)
        clip = np.clip(sine(100, 1.0, 1.5), -1, 1)
        c = analysis.clipping(np.vstack([clip, clip]))
        self.assertGreater(c["runs"], 50)
        self.assertEqual(analysis.clipping(np.vstack([sine(100, 1.0, 0.9)] * 2))["samples"], 0)

    def test_stereo(self):
        m = sine(300, 3.0, 0.3)
        s = analysis.stereo(np.vstack([m, m]))
        self.assertEqual((s["correlation"], s["monoLossDb"]), (1.0, 0.0))
        inv = analysis.stereo(np.vstack([m, -m]))
        self.assertAlmostEqual(inv["correlation"], -1.0, places=3)
        self.assertIsNone(inv["monoLossDb"])  # the fold-down is silent
        g = np.random.default_rng(1)
        wide = analysis.stereo(g.standard_normal((2, 5 * SR)) * 0.1)
        self.assertAlmostEqual(wide["correlation"], 0.0, delta=0.02)
        self.assertAlmostEqual(wide["monoLossDb"], -3.0, delta=0.15)
        bass_wide = np.vstack([sine(60, 3.0, 0.3), sine(60, 3.0, 0.3, phase=math.pi / 2)])
        self.assertLess(analysis.stereo(bass_wide)["lowCorrelation"], 0.1)

    def test_spectrum_tilt_and_indicators(self):
        pink = synth.noise(SR * 20, "pink") * 0.1
        sp = analysis.spectrum(np.vstack([pink, pink]))
        self.assertAlmostEqual(sp["slopeDbPerOct"], -3.0, delta=0.3)
        for key in ("harshnessDb", "mudDb", "boxinessDb", "presenceDb"):
            self.assertAlmostEqual(sp[key], 0.0, delta=0.6, msg=key)
        for f, key in ((3200.0, "harshnessDb"), (320.0, "mudDb"), (700.0, "boxinessDb")):
            bumped = dsp.eq(pink, [{"kind": "peak", "f": f, "q": 0.8, "db": 8.0}])
            self.assertGreater(analysis.spectrum(np.vstack([bumped[0]] * 2))[key], 3.0, msg=key)
        dipped = dsp.eq(pink, list(master.PRESETS["bed"].eq))
        self.assertLess(analysis.spectrum(np.vstack([dipped[0]] * 2))["voicePocketDb"], -1.5)

    def test_noise_floor_reads_true_levels(self):
        for level in (-60.0, -80.0):
            self.assertAlmostEqual(analysis.noise_floor(white_at(level))["floorDbfs"], level, delta=1.0)
        nf = analysis.noise_floor(white_at(-70.0))
        self.assertAlmostEqual(nf["hfFloorDbfs"], -70.0 + 10 * math.log10(8000 / 15960), delta=1.0)
        self.assertEqual(analysis.noise_floor(np.zeros((2, 10 * SR)))["floorDbfs"], -200.0)

    def test_hum(self):
        t = np.arange(10 * SR) / SR
        hum = 10 ** (-50 / 20) * (np.sin(2 * math.pi * 60 * t) + 0.5 * np.sin(2 * math.pi * 120 * t))
        noisy = white_at(-60.0) + np.vstack([hum, hum])
        h = analysis.hum(noisy)
        self.assertEqual(h["mainsHz"], 60.0)
        self.assertGreater(h["humDb"], 20)
        self.assertAlmostEqual(h["humLevelDbfs"], -50.0, delta=1.0)
        self.assertEqual(analysis.hum(white_at(-60.0))["humDb"], 0.0)

    def test_silence_and_onset(self):
        x = np.zeros((2, SR))
        x[:, 480:960] = 0.5
        s = analysis.silence(x)
        self.assertAlmostEqual(s["leadingSilenceMs"], 10.0)
        self.assertAlmostEqual(s["onsetMs"], 10.0)
        self.assertEqual(s["tailEndDbfs"], -200.0)

    def test_psr_drops_when_squashed(self):
        g = np.random.default_rng(3)
        hits = np.zeros(10 * SR)
        for i in range(0, 10 * SR, SR // 4):
            hits[i : i + 2400] += g.standard_normal(2400) * np.exp(-np.arange(2400) / 300)
        x = np.vstack([hits, hits]) * 0.2 + np.vstack([sine(110, 10.0, 0.05)] * 2)
        loud, _ = master.master(x, "standalone")
        squashed, _ = master.master(x * 1.0, master.Preset("hot", -8.0, "integrated", -1.0))
        self.assertGreater(analysis.psr(loud)["medianDb"], analysis.psr(squashed)["medianDb"] + 3)


@unittest.skipUnless(have_ffmpeg(), "ffmpeg not installed")
class CliTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        g = np.random.default_rng(5)
        n = 12 * SR
        t = np.arange(n) / SR
        x = np.zeros(n)
        for k, start in enumerate(np.arange(0, 12, 0.5)):
            i0 = int(start * SR)
            seg = t[: n - i0]
            x[i0:] += 0.3 * np.sin(2 * math.pi * (110, 147, 165, 196)[k % 4] * seg) * np.exp(-seg / 0.6)
            b = g.standard_normal(min(2400, n - i0)) * np.exp(-np.arange(min(2400, n - i0)) / 300)
            x[i0 : i0 + b.size] += 0.4 * b
        music = np.vstack([x, np.roll(x, 31)]) * 0.5
        cls.good, _ = master.master(music, "standalone")
        io.write(d / "good.wav", cls.good)
        io.write(d / "quiet.wav", music * 0.1)
        cls.dir = d

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_cli(self, *args):
        out, err = _io.StringIO(), _io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = metrics.main(list(args))
        return code, out.getvalue(), err.getvalue()

    def test_pass_fail_and_usage_codes(self):
        code, out, err = self.run_cli(str(self.dir / "good.wav"), "--profile", "standalone", "--no-png")
        res = json.loads(out)
        self.assertEqual(code, 0, msg=err)
        self.assertTrue(res["pass"])
        self.assertAlmostEqual(res["metrics"]["loudness"]["integrated"], -14.0, delta=0.2)
        self.assertLessEqual(res["metrics"]["loudness"]["truePeak"], -1.0)
        self.assertIn("PASS", err)
        code, out, _ = self.run_cli(str(self.dir / "quiet.wav"), "--profile", "standalone", "--no-png", "-q")
        self.assertEqual(code, 1)
        failed = {c["id"] for c in json.loads(out)["checks"] if not c["pass"]}
        self.assertIn("loudness.integrated", failed)
        self.assertEqual(self.run_cli(str(self.dir / "missing.wav"))[0], 2)
        self.assertEqual(self.run_cli(str(self.dir / "good.wav"), "--profile", "nope", "--no-png")[0], 2)
        self.assertEqual(self.run_cli()[0], 2)

    def test_json_file_pictures_and_loop(self):
        js = self.dir / "r" / "good.metrics.json"
        code, _, err = self.run_cli(str(self.dir / "good.wav"), "--profile", "bed", "--loop", "--json", str(js), "-q")
        res = json.loads(js.read_text())
        self.assertEqual(code, 1)  # a -14 LUFS master is far too loud for a bed
        self.assertIn("loop", res["metrics"])
        self.assertTrue(any(c["id"] == "loop.clickRatio" for c in res["checks"]))
        for p in res["pictures"].values():
            self.assertGreater(Path(p).stat().st_size, 10000)

    def test_missing_metric_fails_its_check(self):
        t = {"version": 1, "common": [], "profiles": {"x": {"description": "", "checks": [{"id": "nope.value", "max": 1, "severity": "fail", "why": "test"}]}}}
        checks = metrics.evaluate({"a": 1}, t, "x")
        self.assertFalse(checks[0]["pass"])
        self.assertEqual(checks[0]["note"], "metric not available")


class TargetsDocTest(unittest.TestCase):
    def test_audio_md_table_matches_targets_json(self):
        text = DOC.read_text(encoding="utf-8")
        begin, end = "<!-- targets:begin -->", "<!-- targets:end -->"
        self.assertIn(begin, text)
        table = text.split(begin, 1)[1].split(end, 1)[0].strip()
        self.assertEqual(table, metrics.targets_table(metrics.load_targets()).strip(), "docs/AUDIO.md targets table is stale: regenerate it with metrics.py --targets-table")

    def test_every_target_metric_exists(self):
        """Every id in targets.json resolves in a real metrics result (no typos in the table)."""
        t = metrics.load_targets()
        with tempfile.TemporaryDirectory() as d:
            x, _ = master.master(np.vstack([sine(220, 12.0, 0.3), sine(330, 12.0, 0.3)]), "standalone")
            p = Path(d) / "x.wav"
            io.write(p, x)
            m = analysis.analyse(p, loop=True)
        ids = [c["id"] for c in t["common"]] + [c["id"] for prof in t["profiles"].values() for c in prof["checks"]]
        for cid in ids:
            head = cid.split(".")[0]
            self.assertIn(head, m, cid)
            v = metrics.get_path(m, cid)
            self.assertTrue(v is not None or cid.endswith(("Median", "Max", "P10")), cid)


if __name__ == "__main__":
    unittest.main()
