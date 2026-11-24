import copy
import unittest

from voicelib import schema


def good():
    return {
        "version": 1, "slug": "demo", "lang": "es", "mode": "fit-to-master", "masterLang": "en",
        "voice": "em_alex", "speed": 1.0, "model": {"file": "kokoro-v1.0.int8.onnx", "sha256": "a" * 64},
        "sampleRate": 24000, "fps": 30, "totalMs": 1500,
        "scenes": [
            {"id": "s01", "audio": "generated/c/demo/es/scenes/s01.wav", "startMs": 0, "durationMs": 1200, "speechMs": 900,
             "words": [{"text": "Hola", "startMs": 10, "endMs": 400}, {"text": "mundo.", "startMs": 450, "endMs": 900}],
             "mouth": ["closed"] * 36, "speed": 1.05},
            {"id": "s02", "audio": "generated/c/demo/es/scenes/s02.wav", "startMs": 1200, "durationMs": 300, "speechMs": 0,
             "words": [], "mouth": ["closed"] * 9},
        ],
        "loudness": {"integratedLufs": -14.1, "truePeakDb": -1.2}, "warnings": [], "narration": "generated/c/demo/es/narration.wav",
    }


class Schema(unittest.TestCase):
    def test_good(self):
        self.assertEqual(schema.validate(good()), [])

    def test_violations(self):
        def mutate(fn):
            t = good()
            fn(t)
            return schema.validate(t)

        cases = {
            "missing key": lambda t: t.pop("voice"),
            "unknown key": lambda t: t.update(extra=1),
            "bad lang": lambda t: t.update(lang="fr"),
            "bad mode": lambda t: t.update(mode="dub"),
            "fit without master": lambda t: t.pop("masterLang"),
            "bad sha": lambda t: t["model"].update(sha256="xyz"),
            "start not cumulative": lambda t: t["scenes"][1].update(startMs=1100),
            "total mismatch": lambda t: t.update(totalMs=1600),
            "not whole frames": lambda t: (t["scenes"][1].update(durationMs=310), t.update(totalMs=1510)),
            "mouth length": lambda t: t["scenes"][0]["mouth"].pop(),
            "mouth value": lambda t: t["scenes"][0]["mouth"].__setitem__(3, "wide"),
            "word overlap": lambda t: t["scenes"][0]["words"][1].update(startMs=300),
            "word outside scene": lambda t: t["scenes"][0]["words"][1].update(endMs=1300),
            "word extra key": lambda t: t["scenes"][0]["words"][0].update(confidence=1),
            "speech > duration": lambda t: t["scenes"][0].update(speechMs=1300),
            "scene unknown key": lambda t: t["scenes"][0].update(phonemes="x"),
            "absolute audio": lambda t: t["scenes"][0].update(audio="/abs.wav"),
            "nan": lambda t: t["scenes"][0].update(speechMs=float("nan")),
            "bool fps": lambda t: t.update(fps=True),
            "duplicate id": lambda t: t["scenes"][1].update(id="s01"),
            "stress outside word": lambda t: t["scenes"][0]["words"][0].update(stressMs=600),
            "mock not bool": lambda t: t.update(mock="yes"),
        }
        for name, fn in cases.items():
            with self.subTest(name=name):
                self.assertNotEqual(mutate(fn), [], name)

    def test_contract_optionals(self):
        t = good()
        t["scenes"][0]["words"][0]["stressMs"] = 200
        t["mock"] = False
        self.assertEqual(schema.validate(t), [])

    def test_additions_are_optional(self):
        t = good()
        t.pop("narration")
        t["scenes"][0].pop("speed")
        t.pop("loudness")
        t["mode"] = "native"
        t.pop("masterLang")
        self.assertEqual(schema.validate(t), [])

    def test_assert_valid_raises(self):
        t = copy.deepcopy(good())
        t["version"] = 2
        with self.assertRaises(ValueError):
            schema.assert_valid(t)


if __name__ == "__main__":
    unittest.main()
