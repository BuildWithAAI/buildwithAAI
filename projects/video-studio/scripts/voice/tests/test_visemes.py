import math
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

    def test_one_frame_onset_opens_early_not_late(self):
        # a 40 ms first phone after a long pause: one frame of 'slightlyOpen', then 'oh'. It used to merge into the
        # closed run, so the mouth opened a frame after the voice (es demo s03/s07, 2026-11-24)
        tr = V.enforce_min_hold(["closed"] * 6 + ["slightlyOpen"] + ["oh"] * 4 + ["closed"] * 6)
        self.assertEqual(tr[:11], ["closed"] * 5 + ["slightlyOpen"] * 2 + ["oh"] * 4)
        self.assertTrue(all(n >= 2 for _, n in runs(tr)), runs(tr))
        # a closed run that cannot spare a frame still merges as before
        tr2 = V.enforce_min_hold(["closed"] * 2 + ["ah"] + ["oh"] * 4)
        self.assertTrue(all(n >= 2 for _, n in runs(tr2)), runs(tr2))

    def test_tie_between_pause_and_phone_shows_the_phone(self):
        # a take's first phone starts at 150 ms = 4.5 frames: with the 1 f lead, frame 3's window is half pause,
        # half phone, and the phone wins (it used to depend on float rounding)
        toks = [(" ", 0.0, 0.15), ("a", 0.15, 0.40), (" ", 0.40, 1.2)]
        self.assertEqual(V.raw_frames(V.intervals(toks), 36, FPS, 1)[3], "ah")
        self.assertEqual(V.mouth_track(toks, 36, FPS).index("ah"), 3)

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


def envelope(spans, total_s, hop=V.HOP_S, loud=-8.0, residual=-44.0, silence=-180.0):
    """5 ms energy envelope (dB): `loud` inside the (start, end) voiced spans, a `residual` up to 300 ms after each
    span (Kokoro's tail after a phrase), digital silence elsewhere."""
    n = int(round(total_s / hop))
    env = [silence] * n
    for a, b in spans:
        for h in range(int(a / hop), min(n, int(b / hop))):
            env[h] = loud
        for h in range(int(b / hop), min(n, int((b + 0.3) / hop))):
            if env[h] == silence:
                env[h] = residual
    return env


def frame_db(env, fps=FPS, hop=V.HOP_S):
    """Per-frame RMS in dB from a 5 ms dB envelope (power mean, weighted by each hop's overlap with the frame)."""
    out = []
    n_frames = int(len(env) * hop * fps + 1e-9)
    for f in range(n_frames):
        a, b = f / fps, (f + 1) / fps
        p = w = 0.0
        for h in range(int(a / hop), min(len(env), int(math.ceil(b / hop)))):
            o = min(b, (h + 1) * hop) - max(a, h * hop)
            if o > 0:
                p += o * 10 ** (env[h] / 10)
                w += o
        p /= w or 1.0
        out.append(10 * math.log10(p) if p > 0 else -180.0)
    return out


class SnapToAudio(unittest.TestCase):
    """VCD fix 2026-11-24: Kokoro stretches the phrase-final phone (300-400 ms) while the voice stops ~250 ms
    earlier; the residual after it sits 34-39 dB under the peak, so the old -40 dB gate never fired and the mouth
    stayed open 5-10 frames after the voice."""

    # "a mee" + comma pause + "ba" ; the final 'i' token runs to 1.20 s, the voice stops at 0.90 s
    TOKENS = [(" ", 0.0, 0.30), ("m", 0.30, 0.40), ("i", 0.40, 1.20), (",", 1.20, 1.25), (" ", 1.25, 1.90), ("b", 1.90, 2.00), ("a", 2.00, 2.40), (".", 2.40, 2.50)]
    VOICE = [(0.30, 0.90), (1.86, 2.30)]  # the second onset comes 40 ms before its 'b' token (the space carried it)
    TOTAL = 3.2

    def track(self, with_env=True, silence_db=V.SILENCE_DB):
        env = envelope(self.VOICE, self.TOTAL)
        fdb = frame_db(env)
        rms = [10 ** (v / 20) for v in fdb]
        n = len(fdb)
        return V.mouth_track(self.TOKENS, n, FPS, rms=rms, env_db=env if with_env else None, silence_db=silence_db), fdb

    def test_phrase_end_closes_within_two_frames(self):
        tr, fdb = self.track()
        sync = V.sync_landmarks(tr, fdb)
        self.assertTrue(sync["offsets"], sync)
        self.assertTrue(all(abs(x) <= 2 for x in sync["offsets"]), (sync, runs(tr)))
        self.assertTrue(all(-2 <= x <= 0 for x in sync["onsets"]) and all(-4 <= x <= 0 for x in sync["mbpOnsets"]), (sync, runs(tr)))
        self.assertTrue(all(n >= 2 for _, n in runs(tr)))

    def test_the_old_track_stayed_open(self):
        # timings alone and the old -40 dB gate: the residual (-36 dB under the peak) keeps the vowel up
        tr, fdb = self.track(with_env=False, silence_db=-40.0)
        late = V.sync_landmarks(tr, fdb)["offsets"]
        self.assertTrue(any(x > 2 for x in late), (late, runs(tr)))

    def test_the_gate_alone_closes_at_minus_32(self):
        tr, fdb = self.track(with_env=False)
        self.assertTrue(all(abs(x) <= 3 for x in V.sync_landmarks(tr, fdb)["offsets"]), runs(tr))

    def test_refine_moves_ends_and_onsets(self):
        env = envelope(self.VOICE, self.TOTAL)
        ivs = V.refine(V.intervals(self.TOKENS), V.phrase_spans(self.TOKENS), env)
        phones = [(round(a, 3), round(b, 3), s) for a, b, s in ivs if s != V.PAUSE]
        self.assertEqual(phones[1][2], "ee")
        self.assertAlmostEqual(phones[1][1], 0.90 + V.END_PAD_S, places=3)  # the stretched 'i' ends with the voice
        self.assertEqual(phones[2][2], "mbp")
        self.assertAlmostEqual(phones[2][0], 1.86, places=3)  # 'b' starts where its sound does
        self.assertEqual(V.phrase_spans(self.TOKENS), [(0.30, 1.20), (1.90, 2.40)])

    def test_voiced_space_inside_a_phrase_folds_into_the_next_phone(self):
        toks = [("a", 0.0, 0.2), (" ", 0.2, 0.28), ("o", 0.28, 0.5), (".", 0.5, 0.6)]
        env = envelope([(0.0, 0.5)], 1.2)
        ivs = V.refine(V.intervals(toks), V.phrase_spans(toks), env)
        self.assertEqual([(round(a, 3), round(b, 3), s) for a, b, s in ivs if s != V.PAUSE], [(0.0, 0.2, "ah"), (0.2, 0.5, "oh")])


class SyncLandmarks(unittest.TestCase):
    def test_measures_onset_and_offset(self):
        fdb = [-90.0] * 10 + [-5.0] * 20 + [-90.0] * 20
        track = ["closed"] * 9 + ["ah"] * 20 + ["closed"] * 21
        self.assertEqual(V.sync_landmarks(track, fdb), {"onsets": [-1], "mbpOnsets": [], "offsets": [-1]})
        lips = ["closed"] * 7 + ["mbp"] * 3 + ["ah"] * 19 + ["closed"] * 21
        self.assertEqual(V.sync_landmarks(lips, fdb)["mbpOnsets"], [-3])  # LP3: mbp 1-4 frames before the release
        late = ["closed"] * 9 + ["ah"] * 27 + ["closed"] * 14
        self.assertEqual(V.sync_landmarks(late, fdb)["offsets"], [6])


class FitLandmarks(unittest.TestCase):
    """Rule 7 (2026-11-24, final check). Kokoro's ONNX graph samples noise, so a fresh build of the demo opened the
    mouth 3 frames before an es phrase (allowed -2..0) where the previous build of the same text had -1, and the en
    build lost the mbp of its first word. fit_landmarks moves only what the check finds outside its tolerance."""

    FDB = [-90.0] * 10 + [-5.0] * 20 + [-90.0] * 20  # one phrase: voiced frames 10-29

    def check(self, track):
        fitted = V.fit_landmarks(track, self.FDB)
        self.assertEqual(len(fitted), len(track))
        self.assertTrue(all(n >= 2 for _, n in runs(fitted)), runs(fitted))
        return fitted, V.sync_landmarks(fitted, self.FDB)

    def test_in_tolerance_is_unchanged(self):
        track = ["closed"] * 9 + ["ah"] * 20 + ["closed"] * 21
        self.assertEqual(V.fit_landmarks(track, self.FDB), track)
        lips = ["closed"] * 7 + ["mbp"] * 3 + ["ah"] * 19 + ["closed"] * 21  # mbp 3 frames ahead: LP3 allows 1-4
        self.assertEqual(V.fit_landmarks(lips, self.FDB), lips)

    def test_early_onset_moves_to_one_frame_ahead(self):
        # the es s04 case: slightlyOpen 3 frames ahead of the vowel (two frames of a quiet /k/)
        track = ["closed"] * 7 + ["slightlyOpen"] * 2 + ["ee"] * 20 + ["closed"] * 21
        fitted, sync = self.check(track)
        self.assertEqual(sync["onsets"], [-1])
        self.assertEqual(fitted[:9], ["closed"] * 9)
        self.assertEqual(fitted[9:], track[9:])

    def test_early_onset_leaves_no_one_frame_shape(self):
        track = ["closed"] * 7 + ["slightlyOpen"] * 3 + ["ee"] * 19 + ["closed"] * 21
        fitted, sync = self.check(track)
        self.assertEqual(sync["onsets"], [-1])
        self.assertEqual(fitted[7:11], ["closed", "closed", "ee", "ee"])  # the 1-frame remnant takes the next shape

    def test_late_onset_starts_one_frame_ahead(self):
        track = ["closed"] * 12 + ["ah"] * 17 + ["closed"] * 21
        fitted, sync = self.check(track)
        self.assertEqual(sync["onsets"], [-1])
        self.assertEqual(fitted[9:12], ["ah"] * 3)

    def test_late_close_closes_after_the_voice(self):
        track = ["closed"] * 9 + ["ah"] * 27 + ["closed"] * 14  # 6 frames late
        fitted, sync = self.check(track)
        self.assertTrue(all(abs(x) <= 2 for x in sync["offsets"]), sync)
        self.assertEqual(fitted[30:], ["closed"] * 20)

    def test_early_close_holds_the_shape(self):
        track = ["closed"] * 9 + ["ah"] * 14 + ["closed"] * 27  # closes 7 frames before the voice ends
        fitted, sync = self.check(track)
        self.assertTrue(all(abs(x) <= 2 for x in sync["offsets"]), sync)

    def test_rms_gate_keeps_mbp(self):
        # a phrase-initial "Most": the quiet /m/ hum sits inside a 4-frame quiet run; the press stays, the rest closes
        toks = [(" ", 0.0, 2 * F), ("m", 2 * F, 4 * F), ("o", 4 * F, 12 * F), (".", 12 * F, 13 * F), (" ", 13 * F, 30 * F)]
        rms = [0.0] * 2 + [0.002] * 3 + [0.3] * 7 + [0.0] * 18
        tr = V.mouth_track(toks, 30, FPS, rms=rms)
        self.assertIn("mbp", tr[:4], runs(tr))
        P = V.PAUSE
        before = V.apply_rms_gate(["closed"] * 2 + ["mbp"] * 2 + ["oh"] * 4, [0.3] + [0.0] * 4 + [0.3] * 4, lead_frames=1)
        self.assertEqual(before, [P, P, "mbp", "mbp", "oh", "oh", "oh", "oh"])
        # a press left after the last sound ("subscribe.") is not a lead: it closes like the rest of the quiet run
        after = V.apply_rms_gate(["oh"] * 4 + ["mbp"] * 2 + ["closed"] * 4, [0.3] * 4 + [0.0] * 7, lead_frames=1)
        self.assertEqual(after, ["oh"] * 3 + [P] * 7)


if __name__ == "__main__":
    unittest.main()
