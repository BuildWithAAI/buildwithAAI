import unittest

from voicelib import visemes as V

FPS = 30
F = 1 / FPS


def runs(track):
    out = []
    for s in track:
        if out and out[-1][0] == s:
            out[-1][1] += 1
        else:
            out.append([s, 1])
    return out


def tokens(spec, t0=0.0):
    """'p:3 a:4 _:12' -> Kokoro-like tokens, durations in frames ('_' = space)."""
    out, t = [], t0
    for item in spec.split():
        ch, n = item.rsplit(":", 1)
        ch = " " if ch == "_" else ch
        out.append((ch, t, t + int(n) * F))
        t += int(n) * F
    return out


class Mapping(unittest.TestCase):
    def test_art_guide_lp2_table(self):
        table = {
            "mbp": "pbm", "oh": "wuʊoɔɚɜ", "ah": "ɑaæʌɛ", "ee": "iɪej",
            "slightlyOpen": "fvləɐɹtdnszθðʃʒkɡŋhɾ",
        }
        for shape, chars in table.items():
            for ch in chars:
                with self.subTest(ch=ch):
                    self.assertEqual(V.classify(ch, "en"), shape)

    def test_pauses_and_folds(self):
        for ch in " ,.!?;:—…“”":
            self.assertEqual(V.classify(ch), V.PAUSE)
        for ch in "ːʰʲ̃→↓↗↘":
            self.assertEqual(V.classify(ch), V.FOLD_PREV)
        for ch in "ˈˌʔ":
            self.assertEqual(V.classify(ch), V.FOLD_NEXT)

    def test_per_language_tables(self):
        self.assertEqual(V.classify("β", "es"), "mbp")  # lenited b
        self.assertEqual(V.classify("β", "ja"), "oh")  # Japanese w
        self.assertEqual(V.classify("ɯ", "ja"), "oh")
        self.assertEqual(V.classify("ɸ", "ja"), "oh")
        self.assertEqual(V.classify("ə", "hi"), "ah")  # inherent vowel
        self.assertEqual(V.classify("ə", "en"), "slightlyOpen")  # reduced schwa
        self.assertEqual(V.classify("y", "pt-br"), "ee")
        self.assertEqual(V.classify("ɨ", "zh"), "ee")
        self.assertEqual(V.classify("ɤ", "zh"), "slightlyOpen")
        self.assertEqual(V.classify("ꭧ", "zh"), "slightlyOpen")
        self.assertEqual(V.classify("ɥ", "zh"), "oh")

    def test_misaki_diphthong_letters_split(self):
        ivs = V.intervals([("I", 0.0, 0.2)])
        self.assertEqual([s for _, _, s in ivs], ["ah", "ee"])

    def test_folds(self):
        # length mark extends the previous vowel; stress mark gives its time to the next phone
        ivs = V.intervals([("ˈ", 0.0, 0.05), ("a", 0.05, 0.10), ("ː", 0.10, 0.20), (" ", 0.20, 0.25)])
        self.assertEqual(ivs[0], (0.0, 0.20, "ah"))
        # a tone arrow after a pause is dropped, not attached to the pause
        self.assertEqual(V.intervals([(",", 0, 0.1), ("↓", 0.1, 0.12)]), [(0, 0.1, V.PAUSE)])


class Track(unittest.TestCase):
    def test_lead_one_frame(self):
        # 'a' starts at frame 10; with the 1 f lead the mouth opens on frame 9
        toks = tokens("_:10 a:6 _:20")
        tr = V.mouth_track(toks, 40, FPS)
        self.assertEqual(tr.index("ah"), 9)
        tr0 = V.mouth_track(toks, 40, FPS, lead_frames=0)
        self.assertEqual(tr0.index("ah"), 10)

    def test_min_hold_two_frames(self):
        toks = tokens("a:1 i:1 o:1 a:1 i:1 o:1 a:1 i:1 o:1 _:15")
        tr = V.mouth_track(toks, 30, FPS)
        self.assertTrue(all(n >= 2 for _, n in runs(tr)), runs(tr))

    def test_short_mbp_is_extended_not_dropped(self):
        # a 20 ms /p/ between vowels: less than a frame, still shown, for 2+ frames
        toks = [("a", 0.0, 0.2), ("p", 0.2, 0.22), ("a", 0.22, 0.42), (" ", 0.42, 1.0)]
        tr = V.mouth_track(toks, 30, FPS)
        r = runs(tr)
        self.assertIn("mbp", tr)
        self.assertTrue(all(n >= 2 for s, n in r if s == "mbp"))
        self.assertTrue(all(n >= 2 for _, n in r))

    def test_pause_rules(self):
        def middle(gap_frames):
            toks = tokens(f"_:5 i:6 _:{gap_frames} i:6 _:15")
            tr = V.mouth_track(toks, 5 + 6 + gap_frames + 6 + 15, FPS, lead_frames=0)
            return tr[11 : 11 + gap_frames]

        self.assertEqual(set(middle(3)), {"ee"})  # < 4 f: hold
        self.assertEqual(set(middle(6)), {"slightlyOpen"})  # 4-10 f: relax
        self.assertEqual(set(middle(10)), {"slightlyOpen"})
        self.assertEqual(set(middle(11)), {"closed"})  # >= 11 f: close
        self.assertEqual(set(middle(20)), {"closed"})

    def test_closed_before_and_after_speech(self):
        tr = V.mouth_track(tokens("_:2 o:6 _:3"), 20, FPS, lead_frames=0)
        self.assertEqual(tr[0], "closed")
        self.assertEqual(tr[-1], "closed")
        self.assertEqual(V.mouth_track([], 12, FPS), ["closed"] * 12)

    def test_rms_gate_closes_silence(self):
        # timings claim a long vowel, but the audio is silent from frame 10: the mouth closes
        toks = [("a", 0.0, 1.0)]
        rms = [0.3] * 10 + [0.0] * 20
        tr = V.mouth_track(toks, 30, FPS, rms=rms, lead_frames=0)
        self.assertEqual(set(tr[:10]) - {"slightlyOpen"}, {"ah"})
        self.assertEqual(set(tr[12:]), {"closed"})
        # a short dip (stop closure, < 4 frames) does not open a pause
        rms2 = [0.3] * 10 + [0.0] * 2 + [0.3] * 18
        self.assertNotIn("closed", V.mouth_track(toks, 30, FPS, rms=rms2, lead_frames=0)[:28])

    def test_silent_audio_is_all_closed(self):
        self.assertEqual(V.mouth_track(tokens("a:10"), 10, FPS, rms=[0.0] * 10), ["closed"] * 10)

    def test_ah_to_closed_inbetween(self):
        tr = V.mouth_track(tokens("a:8 _:15"), 23, FPS, lead_frames=0)
        r = runs(tr)
        self.assertEqual([s for s, _ in r], ["ah", "slightlyOpen", "closed"])
        self.assertEqual(r[1][1], 2)

    def test_length_and_values(self):
        tr = V.mouth_track(tokens("h:2 ɛ:3 l:2 oʊ:0 o:5 _:10"), 25, FPS)
        self.assertEqual(len(tr), 25)
        self.assertTrue(set(tr) <= set(V.SHAPES))

    def test_jitter_rate_on_a_real_kokoro_line(self):
        # Kokoro timings for "The price hit forty thousand dollars" (en, am_michael), abridged
        line = "ðə pɹˈaɪs hˈɪt fˈɔːɹɾi θˈaʊzənd dˈɑːlɚz"
        t, toks = 0.0, []
        for ch in line:
            d = 0.025 if ch in "ˈ " else 0.075
            toks.append((ch, t, t + d))
            t += d
        n = int((t + 0.4) * FPS)
        tr = V.mouth_track(toks, n, FPS)
        self.assertTrue(all(k >= 2 for _, k in runs(tr)))
        self.assertLess(V.changes_per_second(tr), 9.1)  # the raw per-frame rate measured in ART_GUIDE M2


if __name__ == "__main__":
    unittest.main()
