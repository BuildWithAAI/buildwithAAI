import unittest

from voicelib import timing as T


class SceneTiming(unittest.TestCase):
    def test_grid(self):
        self.assertEqual(T.grid(30), (100, 3))
        self.assertEqual(T.grid(25), (40, 1))
        self.assertEqual(T.grid(60), (50, 3))

    def test_duration_is_speech_plus_tail_on_the_grid(self):
        self.assertEqual(T.scene_duration_ms(7377, 350, None, 30), 7800)  # 7727 -> 7800
        self.assertEqual(T.scene_duration_ms(7400, 350, None, 30), 7800)  # 7750 -> 7800
        self.assertEqual(T.scene_duration_ms(7450, 350, None, 30), 7800)  # exactly on the grid
        self.assertEqual(T.scene_duration_ms(5483, 600, None, 30), 6100)  # last scene: 600 ms tail

    def test_min_duration(self):
        self.assertEqual(T.scene_duration_ms(1000, 350, 3, 30), 3000)
        self.assertEqual(T.scene_duration_ms(0, 350, 1.2, 30), 1200)
        self.assertEqual(T.scene_duration_ms(0, 350, None, 30), 400)  # silent scene: tail only, on the grid
        self.assertEqual(T.scene_duration_ms(4000, 350, 3, 30), 4400)

    def test_whole_frames_and_samples(self):
        for speech in range(0, 9000, 37):
            ms = T.scene_duration_ms(speech, 350, None, 30)
            self.assertEqual(ms % 100, 0)
            self.assertEqual(T.frames(ms, 30) * 1000, ms * 30)
            self.assertEqual(ms * 24000 % 1000, 0)  # whole samples at 24 kHz
        with self.assertRaises(ValueError):
            T.frames(1010, 30)

    def test_tail_and_starts(self):
        self.assertEqual([T.tail_for(i, 3) for i in range(3)], [350, 350, 600])
        self.assertEqual(T.starts([7800, 5900, 1200]), [0, 7800, 13700])


class FitMaths(unittest.TestCase):
    @staticmethod
    def kokoro(speed, a=5000.0, b=400.0):
        """Speech ms of a synthetic line: phoneme durations scale with 1/speed, inserted pauses do not."""
        return a / speed + b

    def test_target_is_master_speech_within_room(self):
        self.assertEqual(T.fit_target_ms(5000, 5400, 150), 5000)
        self.assertEqual(T.fit_target_ms(5300, 5400, 150), 5250)  # never more than duration - air
        self.assertEqual(T.fit_target_ms(0, 1200, 150), 1050)

    def test_secant_converges_inside_the_range(self):
        target = 4800.0  # needs speed ~1.136
        samples = [(1.0, self.kokoro(1.0))]
        for _ in range(T.FIT_MAX_ITERS):
            s = T.next_speed(samples, target)
            samples.append((s, self.kokoro(s)))
            if T.close_enough(samples[-1][1], target):
                break
        speed, ms = samples[-1]
        self.assertTrue(T.close_enough(ms, target), samples)
        self.assertTrue(T.SPEED_MIN <= speed <= T.SPEED_MAX)
        self.assertLessEqual(len(samples), 3)

    def test_clamped_to_range(self):
        self.assertEqual(T.next_speed([(1.0, 9000.0)], 4000.0), T.SPEED_MAX)
        self.assertEqual(T.next_speed([(1.0, 3000.0)], 6000.0), T.SPEED_MIN)

    def test_slower_when_the_dub_is_shorter(self):
        self.assertLess(T.next_speed([(1.0, 4000.0)], 4400.0), 1.0)

    def test_overflow(self):
        self.assertEqual(T.overflow_ms(5000, 5400, 150), 0)
        self.assertEqual(T.overflow_ms(5250, 5400, 150), 0)
        self.assertEqual(T.overflow_ms(5671.2, 5400, 150), 422)

    def test_choose_fit_prefers_fitting_takes(self):
        samples = [(1.0, 6000.0), (1.15, 5300.0), (1.1, 5500.0)]
        self.assertEqual(T.choose_fit(samples, 5000, 5400, 150), (1.15, 5300.0))
        # nothing fits: the shortest take, so the overflow is measured at the fastest speed
        self.assertEqual(T.choose_fit([(1.0, 7000.0), (1.15, 6100.0)], 5000, 5400, 150), (1.15, 6100.0))


if __name__ == "__main__":
    unittest.main()


class FitScene(unittest.TestCase):
    """pipeline._fit_scene with a fake Kokoro whose speech is a / speed + b ms."""

    class FakeSynth:
        def __init__(self, a, b=400.0):
            self.a, self.b, self.calls = a, b, []

        def speak(self, phonemes, voice, speed):
            from voicelib.synth import Take

            self.calls.append(speed)
            ms = self.a / speed + self.b
            return Take(audio=[0.0] * int(ms * 24), timings=[], speed=speed)

    def fit(self, synth, master):
        from voicelib.pipeline import _fit_scene

        return _fit_scene(synth, "x", "em_alex", 1.0, master, T.FIT_MIN_TAIL_MS)

    def test_speeds_up_to_fit(self):
        synth = self.FakeSynth(5000)  # 5400 ms at 1.0; the master scene has room for 5050
        take, over, tries = self.fit(synth, {"speechMs": 4800, "durationMs": 5200})
        self.assertEqual(over, 0)
        self.assertGreater(take.speed, 1.0)
        self.assertLessEqual(take.ms + T.FIT_MIN_TAIL_MS, 5200)
        self.assertTrue(T.close_enough(take.ms, 4800))
        self.assertLessEqual(len(synth.calls), 3)

    def test_slows_down_to_match_the_master_pacing(self):
        take, over, _ = self.fit(self.FakeSynth(3500), {"speechMs": 4400, "durationMs": 4800})
        self.assertEqual(over, 0)
        self.assertLess(take.speed, 1.0)
        self.assertGreaterEqual(take.speed, T.SPEED_MIN)

    def test_overflow_is_measured_at_max_speed(self):
        synth = self.FakeSynth(9000)  # even at 1.15: 8226 ms
        take, over, _ = self.fit(synth, {"speechMs": 4800, "durationMs": 5200})
        self.assertIn(T.SPEED_MAX, synth.calls)
        self.assertEqual(take.speed, T.SPEED_MAX)
        self.assertEqual(over, T.overflow_ms(9000 / 1.15 + 400, 5200))
        self.assertGreater(over, 3000)


class FitSentences(unittest.TestCase):
    """pipeline._fit_sentences: each dubbed sentence fitted to its master sentence and placed where it starts, an
    overlong one centred on it, the pauses shortened before the scene overflows (2026-11-24, VCD fix: the scene-level fit
    let sentence pauses fall at other times than in the master picture)."""

    class FakeSynth:
        """A take of one sentence: 150 ms lead, then phones lasting a / speed ms (a per sentence, by its first
        character), then a mark; numpy audio of that length."""

        def __init__(self, a_by_first):
            self.a_by_first, self.calls = a_by_first, []

        def speak(self, phonemes, voice, speed):
            import numpy as np

            from voicelib.synth import Take

            self.calls.append((phonemes, speed))
            d = self.a_by_first[phonemes[0]] / speed / 1000.0
            timings = [(phonemes[0], 0.15, 0.15 + d), (".", 0.15 + d, 0.2 + d)]
            return Take(audio=np.zeros(int((0.25 + d) * 24000), dtype=np.float32), timings=timings, speed=speed)

    MASTER = {"durationMs": 9000, "speechMs": 8000, "sentences": [{"startMs": 150, "endMs": 2650}, {"startMs": 3150, "endMs": 7150}]}

    def fit(self, synth, master=None):
        from voicelib.pipeline import _fit_sentences

        return _fit_sentences(synth, "a. b.", "im_nicola", 1.0, master or self.MASTER, T.FIT_MIN_TAIL_MS)

    @unittest.skipUnless(__import__("importlib").util.find_spec("numpy"), "numpy not installed")
    def test_each_sentence_starts_with_its_master_sentence(self):
        take, over, _, detail = self.fit(self.FakeSynth({"a": 2700, "b": 3800}))  # 2.7 s vs 2.5 s, 3.8 s vs 4.0 s
        self.assertEqual(over, 0)
        self.assertEqual([d["startMs"] for d in detail], [150, 3150])  # the second sentence waits for its master start
        self.assertGreater(detail[0]["speed"], 1.0)
        self.assertLess(detail[1]["speed"], 1.0)
        for d in detail:
            self.assertLessEqual(abs((d["endMs"] - d["startMs"]) - (d["masterEndMs"] - d["masterStartMs"])), 100)
        starts = [a for ch, a, _ in take.timings if ch in "ab"]
        self.assertAlmostEqual(starts[1], 3.15, places=2)

    @unittest.skipUnless(__import__("importlib").util.find_spec("numpy"), "numpy not installed")
    def test_an_overlong_sentence_is_reported_even_when_the_scene_fits(self):
        take, over, _, detail = self.fit(self.FakeSynth({"a": 3500, "b": 2000}))  # 3.5 s even at 1.15 > 2.5 s
        self.assertEqual(over, 0)  # the scene still fits
        self.assertEqual(detail[0]["speed"], T.SPEED_MAX)
        self.assertGreater(detail[0]["overrunMs"], 100)
        self.assertGreater(detail[0]["longerMs"], 100)

    @unittest.skipUnless(__import__("importlib").util.find_spec("numpy"), "numpy not installed")
    def test_an_overlong_sentence_spills_evenly_around_its_master_sentence(self):
        """2026-11-24 re-check: starting an overlong sentence on time put its whole excess after the master's mouth closed
        (the A/B on the demo: 14 frames closed while the dub spoke in s04) and pushed every later sentence back."""
        _, over, _, detail = self.fit(self.FakeSynth({"a": 2700, "b": 5000}))  # b: 4348 ms at 1.15 vs 4000 ms
        self.assertEqual(over, 0)
        b = detail[1]
        self.assertEqual(b["speed"], T.SPEED_MAX)
        self.assertAlmostEqual(b["longerMs"], 348, delta=5)
        self.assertAlmostEqual(b["earlyMs"], b["overrunMs"], delta=2)  # half before, half after
        self.assertAlmostEqual(b["earlyMs"], 174, delta=5)

    @unittest.skipUnless(__import__("importlib").util.find_spec("numpy"), "numpy not installed")
    def test_pauses_shrink_before_the_scene_overflows(self):
        master = {"durationMs": 6900, "speechMs": 6700, "sentences": [{"startMs": 150, "endMs": 2650}, {"startMs": 3150, "endMs": 6650}]}
        take, over, _, detail = self.fit(self.FakeSynth({"a": 2700, "b": 4300}), master)  # b: 3739 ms at 1.15 vs 3500 ms
        self.assertEqual(over, 0, detail)  # 120 ms of excess spill + the pause shortened by about 120 ms
        self.assertGreater(detail[1]["earlyMs"], 200)
        self.assertGreaterEqual(detail[1]["startMs"] - detail[0]["endMs"], round(1000 * __import__("voicelib.pipeline", fromlist=["x"]).SENTENCE_GAP_S) - 1)
        self.assertLessEqual(take.ms + T.FIT_MIN_TAIL_MS, master["durationMs"])

    @unittest.skipUnless(__import__("importlib").util.find_spec("numpy"), "numpy not installed")
    def test_the_master_mouth_decides_where_an_overlong_sentence_spills(self):
        """A short master pause shows a slightly open mouth (talking there is invisible); after the last phrase the mouth
        closes. So an overlong last sentence moves into the pause before it rather than past the phrase end."""
        mouth = ["closed"] * 5 + ["ah"] * 75 + ["slightlyOpen"] * 9 + ["ah"] * 45 + ["closed"] * 46  # 180 frames, 6 s
        master = {"durationMs": 6000, "speechMs": 4700, "sentences": [{"startMs": 150, "endMs": 2650}, {"startMs": 2950, "endMs": 4450}], "mouth": mouth}
        _, over, _, detail = self.fit(self.FakeSynth({"a": 2700, "b": 2000}), master)  # b: 1739 ms at 1.15 vs 1500 ms
        self.assertEqual(over, 0)
        b = detail[1]
        self.assertEqual(b["speed"], T.SPEED_MAX)
        self.assertGreater(b["earlyMs"], b["overrunMs"])  # spilled into the pause, not past the phrase end
        self.assertLessEqual(b["startMs"] - detail[0]["endMs"], 130)  # as early as the 120 ms gap allows
        # without a mouth track the same sentence is centred
        _, _, _, centred = self.fit(self.FakeSynth({"a": 2700, "b": 2000}), {k: v for k, v in master.items() if k != "mouth"})
        self.assertAlmostEqual(centred[1]["earlyMs"], centred[1]["overrunMs"], delta=2)

    def test_a_different_sentence_count_falls_back(self):
        from voicelib.pipeline import _fit_sentences

        self.assertIsNone(_fit_sentences(self.FakeSynth({"a": 1}), "a. b. a.", "v", 1.0, self.MASTER, T.FIT_MIN_TAIL_MS))
        self.assertIsNone(_fit_sentences(self.FakeSynth({"a": 1}), "a. b.", "v", 1.0, {"durationMs": 9000, "speechMs": 1}, T.FIT_MIN_TAIL_MS))


class AudioTrackRefusal(unittest.TestCase):
    """--fit-to plays a dub over the master picture: its fiction card and disclosure are the master's (English)."""

    def test_fiction_and_offers_must_be_spoken(self):
        from voicelib.pipeline import audio_track_problems

        sb = {"fiction": True, "offers": ["hardware-wallet"], "scenes": [{"narration": "Te despiertas como caller."}, {"narration": "Este video no está patrocinado y no recibo ninguna comisión."}]}
        self.assertEqual(len(audio_track_problems(sb, "es")), 2)
        ok = {"fiction": True, "offers": ["x"], "scenes": [{"narration": "Una historia ficticia: te despiertas como caller."}, {"narration": "Enlace de afiliado: puedo ganar una comisión."}]}
        self.assertEqual(audio_track_problems(ok, "es"), [])
        self.assertEqual(audio_track_problems({"fiction": False, "scenes": [{"narration": "Hola."}]}, "es"), [])

    def test_a_dub_that_dropped_the_flags_is_still_refused(self):
        """The master's fiction flag and offers count even when the translation lost them (2026-11-24 re-check)."""
        import json
        import os
        import tempfile

        from voicelib.pipeline import audio_track_problems, with_master_flags

        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "storyboard.json"), "w", encoding="utf-8") as fh:
                json.dump({"lang": "en", "fiction": True, "offers": ["hardware-wallet"], "scenes": []}, fh)
            dub = {"lang": "es", "fiction": False, "scenes": [{"narration": "Te despiertas como caller."}]}
            merged = with_master_flags(dub, d)
            self.assertEqual((merged["fiction"], merged["offers"]), (True, ["hardware-wallet"]))
            self.assertEqual(len(audio_track_problems(merged, "es")), 2)
            self.assertIs(with_master_flags(dub, os.path.join(d, "missing")), dub)

    def test_sentences(self):
        from voicelib.pipeline import sentence_chunks, sentence_spans

        self.assertEqual(sentence_chunks("ab cd. ef? gh"), ["ab cd.", "ef?", "gh"])
        toks = [("a", 0.1, 0.2), (" ", 0.2, 0.25), ("b", 0.25, 0.4), (".", 0.4, 0.5), (" ", 0.5, 0.6), ("c", 0.6, 0.9), ("?", 0.9, 1.0)]
        self.assertEqual(sentence_spans(toks), [(0.1, 0.4), (0.6, 0.9)])
