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
