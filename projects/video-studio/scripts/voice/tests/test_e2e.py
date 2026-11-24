"""Real Kokoro synthesis, one short storyboard per language (tests/fixtures/zoora-ai/voice-smoke), plus a
fit-to-master dub and a TypeScript check of the produced JSON against src/episode/types.ts.

Needs scripts/voice/setup.sh (the .venv-voice packages and .cache/kokoro model files) and ffmpeg.
"""

import json
import os
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FIXTURE = os.path.join(HERE, "fixtures", "zoora-ai", "voice-smoke")
MODEL_DIR = os.path.join(PROJECT, ".cache", "kokoro")
LANGS = ("en", "es", "pt-br", "hi", "it", "zh", "ja")


def _missing() -> str | None:
    if os.environ.get("VOICE_SKIP_E2E") == "1":
        return "VOICE_SKIP_E2E=1"
    try:
        import kokoro_onnx  # noqa: F401
        import numpy  # noqa: F401
        import soundfile  # noqa: F401
    except ImportError as e:
        return f"{e.name} not installed: run scripts/voice/setup.sh and use .venv-voice/bin/python"
    if not all(os.path.isfile(os.path.join(MODEL_DIR, f)) for f in ("kokoro-v1.0.int8.onnx", "voices-v1.0.bin")):
        return "Kokoro model files missing: run scripts/voice/setup.sh"
    if not shutil.which("ffmpeg"):
        return "ffmpeg not on PATH"
    return None


SKIP = _missing()


def runs(track):
    out = []
    for s in track:
        if out and out[-1][0] == s:
            out[-1][1] += 1
        else:
            out.append([s, 1])
    return out


@unittest.skipIf(SKIP, SKIP or "")
class EndToEnd(unittest.TestCase):
    out_root: str
    results: dict

    @classmethod
    def setUpClass(cls):
        from voicelib import pipeline

        cls.out_root = tempfile.mkdtemp(prefix="voice-e2e-")
        cls.results = {}
        for lang in LANGS:
            cls.results[lang] = pipeline.build(pipeline.Options(FIXTURE, lang, out_root=cls.out_root, model_dir=MODEL_DIR, log=lambda _m: None))
        cls.fit = pipeline.build(pipeline.Options(FIXTURE, "es", fit_to="en", out_root=cls.out_root, model_dir=MODEL_DIR, log=lambda _m: None))
        samples = os.environ.get("VOICE_SAMPLES_DIR")
        if samples:
            os.makedirs(samples, exist_ok=True)
            for lang, res in cls.results.items():
                shutil.copyfile(os.path.join(res.out_dir, "narration.wav"), os.path.join(samples, f"{lang}.wav"))
                shutil.copyfile(os.path.join(res.out_dir, "timeline.json"), os.path.join(samples, f"{lang}.timeline.json"))
            shutil.copyfile(os.path.join(cls.fit.out_dir, "narration.wav"), os.path.join(samples, "es-fit-to-en.wav"))
            shutil.copyfile(os.path.join(cls.fit.out_dir, "timeline.json"), os.path.join(samples, "es-fit-to-en.timeline.json"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.out_root, ignore_errors=True)

    def test_schema_and_files(self):
        import soundfile as sf

        from voicelib import schema

        for lang, res in self.results.items():
            with self.subTest(lang=lang):
                t = res.timeline
                self.assertEqual(schema.validate(t), [])
                with open(os.path.join(res.out_dir, "timeline.json"), encoding="utf-8") as fh:
                    self.assertEqual(json.load(fh), t)
                info = sf.info(os.path.join(self.out_root, t["narration"]))
                self.assertEqual((info.samplerate, info.channels, info.subtype), (24000, 1, "PCM_16"))
                self.assertEqual(info.frames, t["totalMs"] * 24)
                total = 0
                for sc in t["scenes"]:
                    scene_info = sf.info(os.path.join(self.out_root, sc["audio"]))
                    self.assertEqual(scene_info.frames, sc["durationMs"] * 24)
                    total += scene_info.frames
                self.assertEqual(total, info.frames)

    def test_scene_cuts_equal_the_narration(self):
        import numpy as np
        import soundfile as sf

        t = self.results["en"].timeline
        full, _ = sf.read(os.path.join(self.out_root, t["narration"]), dtype="int16")
        parts = [sf.read(os.path.join(self.out_root, sc["audio"]), dtype="int16")[0] for sc in t["scenes"]]
        self.assertTrue(np.array_equal(full, np.concatenate(parts)))

    def test_durations_are_plausible(self):
        for lang, res in self.results.items():
            with self.subTest(lang=lang):
                s01, s02, s03 = res.timeline["scenes"]
                # ~12-20 syllables per line: 1.5-12 s. Catches espeak's "Japanese letter" reading (24 s).
                for sc in (s01, s02):
                    self.assertGreater(sc["speechMs"], 1500)
                    self.assertLess(sc["speechMs"], 12000)
                    self.assertGreaterEqual(sc["durationMs"], sc["speechMs"] + 350)
                    self.assertLess(sc["durationMs"], sc["speechMs"] + 350 + 100)
                self.assertGreaterEqual(s02["durationMs"], 3000)  # minDurationSec 3
                self.assertEqual(s03["speechMs"], 0)
                self.assertEqual(s03["durationMs"], 1200)  # silent end screen: minDurationSec 1.2
                self.assertEqual(s03["words"], [])
                self.assertEqual(set(s03["mouth"]), {"closed"})

    def test_words(self):
        expected_first = {"en": "The", "es": "El", "pt-br": "O", "it": "Il", "hi": "कीमत", "zh": "价格", "ja": "価格"}
        for lang, res in self.results.items():
            with self.subTest(lang=lang):
                s01 = res.timeline["scenes"][0]
                texts = [w["text"] for w in s01["words"]]
                self.assertEqual(texts[0], expected_first[lang])
                self.assertFalse(any("[src:" in x or "{" in x for x in texts))
                self.assertTrue(any("40" in x for x in texts), texts)  # "$40,000" shown as written
                self.assertLessEqual(s01["words"][-1]["endMs"], s01["speechMs"] + 1)
                self.assertGreater(s01["words"][-1]["endMs"], s01["speechMs"] * 0.6)
        self.assertNotIn("proportional", json.dumps([r.debug for r in self.results.values()]))

    def test_mouth(self):
        for lang, res in self.results.items():
            with self.subTest(lang=lang):
                for sc in res.timeline["scenes"]:
                    m = sc["mouth"]
                    self.assertEqual(len(m), sc["durationMs"] * 30 // 1000)
                    self.assertEqual(m[-1], "closed")
                    self.assertTrue(all(n >= 2 for _, n in runs(m)), (sc["id"], runs(m)))
                s01 = res.timeline["scenes"][0]["mouth"]
                self.assertGreaterEqual(len(set(s01)), 4, set(s01))  # a real line uses most of the library
                self.assertIn("mbp", s01 + res.timeline["scenes"][1]["mouth"])

    def test_loudness(self):
        for lang, res in self.results.items():
            with self.subTest(lang=lang):
                ld = res.timeline["loudness"]
                self.assertAlmostEqual(ld["integratedLufs"], -14.0, delta=0.5)
                self.assertLessEqual(ld["truePeakDb"], -1.0)

    def test_warnings(self):
        self.assertEqual(self.results["en"].warnings, [])
        for lang in ("es", "pt-br", "hi", "it", "zh", "ja"):
            with self.subTest(lang=lang):
                self.assertTrue(any(w.startswith("machine translation: needs native review") for w in self.results[lang].warnings))

    def test_fit_to_master(self):
        from voicelib import timing

        t, master = self.fit.timeline, self.results["en"].timeline
        self.assertEqual((t["mode"], t["masterLang"]), ("fit-to-master", "en"))
        for sc, msc in zip(t["scenes"], master["scenes"]):
            with self.subTest(scene=sc["id"]):
                self.assertTrue(timing.SPEED_MIN <= sc["speed"] <= timing.SPEED_MAX)
                if "overflowMs" in sc:
                    self.assertGreater(sc["durationMs"], msc["durationMs"])
                    self.assertTrue(any(w.startswith(f"{sc['id']}: overflows") for w in t["warnings"]))
                else:
                    self.assertEqual(sc["durationMs"], msc["durationMs"])
                    self.assertLessEqual(sc["speechMs"] + timing.FIT_MIN_TAIL_MS, sc["durationMs"])
        if not self.fit.overflow:
            self.assertEqual(t["totalMs"], master["totalMs"])

    def test_typescript_contract(self):
        tsc = os.path.join(PROJECT, "node_modules", ".bin", "tsc")
        if not os.path.exists(tsc):
            self.skipTest("node_modules/.bin/tsc missing (npm ci)")
        work = tempfile.mkdtemp(prefix="voice-ts-")
        try:
            types = os.path.join(PROJECT, "src", "episode", "types").replace("\\", "/")
            extras = os.path.join(PROJECT, "scripts", "voice", "timeline-additions").replace("\\", "/")
            lines = [f"import type {{Timeline}} from '{types}';", f"import type {{VoiceTimeline}} from '{extras}';"]
            for name, res in [*self.results.items(), ("fit", self.fit)]:
                ident = "t_" + name.replace("-", "_")
                lines.append(f"const {ident} = {json.dumps(res.timeline, ensure_ascii=False)} satisfies VoiceTimeline;")
                lines.append(f"export const {ident}_plain: Timeline = {ident};")
            path = os.path.join(work, "check.ts")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("\n".join(lines) + "\n")
            proc = subprocess.run(
                [tsc, "--noEmit", "--strict", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "bundler", "--skipLibCheck", "--types", "", path],
                capture_output=True, text=True, timeout=300,
            )
            self.assertEqual(proc.returncode, 0, proc.stdout[-3000:] + proc.stderr[-1000:])
        finally:
            shutil.rmtree(work, ignore_errors=True)


@unittest.skipIf(SKIP, SKIP or "")
class Japanese(unittest.TestCase):
    def test_kanji_are_read_not_spelled(self):
        """espeak read kanji as "Japanese letter" (a 24 s take for one sentence); misaki must not."""
        from voicelib import g2p
        from voicelib.words import build_words

        gp = g2p.make("ja", g2p.load_vocab())
        ph = gp.phonemize(build_words("暗号資産のセキュリティは大切です。", "ja"))
        self.assertIn("aŋɡoː", ph.phonemes)  # 暗号 = あんごう
        self.assertNotIn("letter", ph.phonemes)
        self.assertEqual(ph.method, "exact")


if __name__ == "__main__":
    unittest.main()
