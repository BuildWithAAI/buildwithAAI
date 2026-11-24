import math
import tempfile
import unittest
from pathlib import Path

import numpy as np

from audiolib import humanize, synth, theory
from audiolib.core import SR
from audiolib.midi import GM, GM_PROGRAMS, TPB, Score, drum_key, gm_program

from .helpers import cents, partial_hz


def alias_db(x: np.ndarray, f0: float) -> float:
    w = np.blackman(len(x))
    spec = np.abs(np.fft.rfft(x * w))
    fr = np.fft.rfftfreq(len(x), 1 / SR)
    harm = np.zeros_like(spec, bool)
    for k in range(1, int(SR / 2 / f0) + 1):
        harm |= np.abs(fr - k * f0) < 8
    band = (fr > 20) & (fr < 20000)
    return 10 * math.log10((spec[(~harm) & band] ** 2).sum() / (spec[harm & band] ** 2).sum())


class OscillatorTest(unittest.TestCase):
    def test_polyblep_reduces_aliasing(self):
        for f0 in (440.0, 1661.2, 3520.0):
            naive = synth.naive_saw(f0, SR)
            bl = synth.osc("saw", f0, SR)
            self.assertLess(alias_db(bl, f0), alias_db(naive, f0) - 15, msg=f"saw {f0}")
            self.assertLess(alias_db(synth.osc("saw", f0, SR, oversample=2), f0), -50, msg=f"saw 2x {f0}")
            ph = synth.phase(f0, SR)
            naive_sq = np.where(ph < 0.5, 1.0, -1.0)
            self.assertLess(alias_db(synth.osc("square", f0, SR), f0), alias_db(naive_sq, f0) - 15)
            naive_tri = 1 - 4 * np.abs(ph - 0.5)
            tri = synth.osc("triangle", f0, SR)
            self.assertLess(alias_db(tri, f0), alias_db(naive_tri, f0) - 12)
            self.assertLess(abs(tri.mean()), 1e-3)

    def test_pitch_and_glide(self):
        x = synth.osc("saw", 220.0, SR * 2)
        self.assertAlmostEqual(cents(partial_hz(x, 220.0), 220.0), 0.0, delta=0.05)
        sweep = synth.osc("sine", np.linspace(100, 200, SR), SR)
        self.assertEqual(sweep.shape, (SR,))
        with self.assertRaises(ValueError):
            synth.osc("sine", 30000.0, 100)
        with self.assertRaises(ValueError):
            synth.osc("wobble", 100.0, 100)

    def test_supersaw_is_stereo_and_decorrelated(self):
        s = synth.supersaw(110.0, SR, voices=7, detune_cents=20)
        self.assertEqual(s.shape, (2, SR))
        c = np.corrcoef(s[0], s[1])[0, 1]
        self.assertLess(c, 0.95)
        self.assertGreater(c, 0.0)


class NoiseEnvLfoTest(unittest.TestCase):
    def slope(self, x):
        from scipy.signal import welch

        f, p = welch(x, SR, nperseg=8192)
        m = (f > 100) & (f < 10000)
        return np.polyfit(np.log2(f[m]), 10 * np.log10(p[m]), 1)[0]

    def test_noise_colours(self):
        self.assertAlmostEqual(self.slope(synth.noise(SR * 10, "white")), 0.0, delta=0.3)
        self.assertAlmostEqual(self.slope(synth.noise(SR * 10, "pink")), -3.0, delta=0.3)
        self.assertAlmostEqual(self.slope(synth.noise(SR * 10, "brown")), -6.0, delta=0.4)
        self.assertAlmostEqual(float(np.sqrt(np.mean(synth.noise(SR, "pink") ** 2))), 1.0, places=6)
        self.assertTrue(np.array_equal(synth.noise(100, seed="a"), synth.noise(100, seed="a")))

    def test_adsr_shape(self):
        env = synth.adsr(SR, SR // 2, attack=0.01, decay=0.1, sustain=0.6, release=0.2)
        self.assertEqual(env[0], 0.0)
        self.assertAlmostEqual(env[int(0.01 * SR)], 1.0, delta=0.01)
        self.assertAlmostEqual(env[SR // 2 - 1], 0.6, delta=0.01)
        self.assertEqual(env[-1], 0.0)
        self.assertTrue(np.all(np.diff(env[SR // 2 :]) <= 1e-12))  # release only falls
        early = synth.adsr(SR, int(0.005 * SR), attack=0.05, release=0.1)  # gate off mid-attack
        self.assertLess(early.max(), 0.2)
        self.assertEqual(early[-1], 0.0)

    def test_lfo_range_and_delay(self):
        for shape in ("sine", "triangle", "square", "saw", "sh", "smooth"):
            v = synth.lfo(SR, 3.0, shape, depth=0.5)
            self.assertLessEqual(np.max(np.abs(v)), 0.5 + 1e-9, msg=shape)
        v = synth.lfo(SR, 5.0, "sine", 1.0, delay=0.5)
        self.assertEqual(np.max(np.abs(v[: SR // 2])), 0.0)


class FilterTest(unittest.TestCase):
    def test_svf_modes(self):
        rng = np.random.default_rng(3)
        x = rng.standard_normal(SR // 2)
        from scipy.signal import welch

        def gain(y, f):
            fr, px = welch(x, SR, nperseg=4096)
            _, py = welch(y, SR, nperseg=4096)
            k = np.argmin(np.abs(fr - f))
            return 10 * np.log10(py[k] / px[k])

        lp = synth.svf(x, 1000.0, 0.7071, "lowpass")
        self.assertAlmostEqual(gain(lp, 1000), -3.0, delta=1.0)
        self.assertLess(gain(lp, 8000), -30)
        hp = synth.svf(x, 1000.0, 0.7071, "highpass")
        self.assertLess(gain(hp, 125), -30)
        bp = synth.svf(x, 2000.0, 2.0, "bandpass")
        self.assertAlmostEqual(gain(bp, 2000), 0.0, delta=1.0)
        swept = synth.svf(x, np.linspace(200, 8000, x.shape[0]), 1.0)
        self.assertTrue(np.all(np.isfinite(swept)))

    def test_ladder_runs_with_modulation(self):
        x = synth.noise(SR // 2, "white") * 0.1
        y = synth.ladder(np.vstack([x, x]), np.linspace(300, 3000, SR // 2))
        self.assertEqual(y.shape, (2, SR // 2))
        self.assertTrue(np.all(np.isfinite(y)))


class VoiceTest(unittest.TestCase):
    def test_pluck_is_in_tune_and_decays(self):
        for midi in (28, 40, 57, 69):
            x = synth.pluck(midi, 1.5, 0.8)
            f0 = 440 * 2 ** ((midi - 69) / 12)
            self.assertAlmostEqual(cents(partial_hz(x, f0), f0), 0.0, delta=0.3, msg=str(midi))
        x = synth.pluck(45, 1.0, 0.8, t60=2.0, release=0.05)
        self.assertEqual(x.shape[0], int(round((1.0 + 0.05 + 0.25) * SR)))
        self.assertLess(np.max(np.abs(x[int(1.2 * SR) :])), 1e-3)  # muted after the note (-60 dB at 1.05 s)
        self.assertTrue(np.array_equal(x, synth.pluck(45, 1.0, 0.8, t60=2.0, release=0.05)))

    def test_pluck_string_instrument_is_monophonic(self):
        ps = synth.PluckString(mono=True)
        a = ps.render_events([(40, 0.0, 2.0, 100), (45, 0.5, 1.0, 100)], 2.0)
        self.assertEqual(a.shape, (2, 2 * SR))
        late = a[0, int(0.75 * SR) : int(0.95 * SR)]
        f_late = partial_hz(late, 110.0, t0=0.0, dur=0.19)
        self.assertAlmostEqual(cents(f_late, 110.0), 0.0, delta=20)  # the first note was muted

    def test_voices_render(self):
        pad = synth.supersaw_pad([(62, 0.0, 1.0, 0.8), (66, 0.0, 1.0, 0.8)], 2.0)
        self.assertEqual(pad.shape, (2, 2 * SR))
        self.assertTrue(np.all(np.isfinite(pad)))
        sub = synth.sub_bass([(38, 0.0, 0.5, 1.0), (43, 0.5, 0.5, 1.0)], 1.2)
        self.assertAlmostEqual(cents(partial_hz(sub[0], 73.42, t0=0.05, dur=0.4), 73.416), 0.0, delta=5)
        r = synth.riser(1.0)
        self.assertLessEqual(np.max(np.abs(r)), 0.5 + 1e-9)
        self.assertGreater(np.sqrt(np.mean(r[:, -SR // 10 :] ** 2)), np.sqrt(np.mean(r[:, : SR // 10] ** 2)))
        k = synth.kick()
        self.assertAlmostEqual(float(np.max(np.abs(k))), 1.0, places=6)
        self.assertEqual(k[0, -1], 0.0)


class ScoreMidiTest(unittest.TestCase):
    def test_tempo_map(self):
        s = Score(bpm=120, tempo_changes=[(8, 60)])
        self.assertAlmostEqual(s.seconds(4), 2.0)
        self.assertAlmostEqual(s.seconds(10), 4.0 + 2.0)
        self.assertAlmostEqual(s.beat_at(6.0), 10.0)
        self.assertAlmostEqual(s.ms_to_beats(500, 0), 1.0)
        self.assertAlmostEqual(s.ms_to_beats(500, 9), 0.5)
        self.assertEqual(s.bar(2), 8.0)

    def test_gm_lookup(self):
        self.assertEqual(len(GM_PROGRAMS), 128)
        self.assertEqual(gm_program("Acoustic Grand Piano"), 0)
        self.assertEqual(gm_program("electric bass (finger)"), 33)
        with self.assertRaises(ValueError):
            gm_program("Bass")  # ambiguous
        self.assertEqual(drum_key("snare"), 38)
        self.assertEqual(GM("Fretless Bass").program_number, 35)

    def test_midi_export(self):
        import mido

        s = Score(bpm=100, key="D")
        p = s.part("keys", GM(0))
        p.note("C4", 0, 1, 90)
        p.note("C4", 1, 1, 80)  # repeated note: the off must come before the next on
        p.note("E4", 0.5, 2, 70)
        p.note("E4", 1.0, 1, 70)  # overlap on the same key: the first E4 is cut at beat 1
        p.sustain(0, 3)
        d = s.part("drums", GM(0, bank=128, drums=True))
        d.hit("kick", 0)
        with tempfile.TemporaryDirectory() as tmp:
            path = s.save_midi(Path(tmp) / "t.mid", tail_seconds=1.0)
            mf = mido.MidiFile(str(path))
        self.assertEqual(mf.ticks_per_beat, TPB)
        self.assertEqual(len(mf.tracks), 3)
        tempo = [m for m in mf.tracks[0] if m.type == "set_tempo"][0]
        self.assertAlmostEqual(mido.tempo2bpm(tempo.tempo), 100.0, places=3)

        def events(track):
            t = 0
            out = []
            for m in track:
                t += m.time
                out.append((t, m))
            return out

        keys = events(mf.tracks[1])
        c4 = [(t, m.type) for t, m in keys if getattr(m, "note", None) == 60]
        self.assertEqual(c4, [(0, "note_on"), (960, "note_off"), (960, "note_on"), (1920, "note_off")])
        e4 = [(t, m.type) for t, m in keys if getattr(m, "note", None) == 64]
        self.assertEqual(e4, [(480, "note_on"), (960, "note_off"), (960, "note_on"), (1920, "note_off")])
        self.assertTrue(any(m.type == "program_change" and m.program == 0 for _, m in keys))
        drums = events(mf.tracks[2])
        self.assertTrue(all(getattr(m, "channel", 9) == 9 for _, m in drums))
        end = [t for t, m in events(mf.tracks[0]) if m.type == "end_of_track"][0]
        self.assertGreaterEqual(end, int(round(s.beat_at(s.length_seconds() + 1.0) * TPB)) - 1)

    def test_pedal_intervals(self):
        s = Score()
        p = s.part("p")
        p.sustain(1, 2)
        p.cc(64, 127, 3)
        self.assertEqual(p.pedal_intervals(), [(1.0, 2.0), (3.0, float("inf"))])
        with self.assertRaises(ValueError):
            p.sustain(2, 1)


class HumanizeTest(unittest.TestCase):
    def setUp(self):
        self.score = Score(bpm=120)
        p = self.score.part("x")
        for i in range(32):
            p.note(60, i * 0.5, 0.4, 90)
        self.notes = p.notes

    def test_deterministic_and_bounded(self):
        a = humanize.humanize(self.notes, self.score, timing_ms=8, drift_ms=4, max_ms=12, seed="s")
        b = humanize.humanize(self.notes, self.score, timing_ms=8, drift_ms=4, max_ms=12, seed="s")
        self.assertEqual([(n.start, n.vel) for n in a], [(n.start, n.vel) for n in b])
        offs = [(h.start - o.start) * 500 for h, o in zip(a, self.notes)]  # ms at 120 BPM
        self.assertLessEqual(max(abs(x) for x in offs), 12 + 1e-6)
        self.assertEqual(a[0].start, 0.0)  # keep_first
        self.assertGreater(np.std(offs), 1.0)
        self.assertTrue(all(1 <= n.vel <= 127 for n in a))
        self.assertTrue(all(n.start == o.start for n, o in zip(self.notes, sorted(self.notes, key=lambda n: n.start))))

    def test_swing(self):
        sw = humanize.swing(self.notes, amount=2 / 3, grid=0.5)
        self.assertAlmostEqual(sw[1].start, 0.5 + (2 / 3 - 0.5) * 1.0)
        self.assertEqual(sw[2].start, 1.0)
        with self.assertRaises(ValueError):
            humanize.swing(self.notes, amount=0.9)

    def test_accent_and_roll(self):
        acc = humanize.accent(self.notes, {0.0: 10, 0.5: -10}, period=1.0)
        self.assertEqual(acc[0].vel, 100)
        self.assertEqual(acc[1].vel, 80)
        s = Score(bpm=60)
        p = s.part("c")
        p.chord(["C4", "E4", "G4"], 0, 1)
        rolled = humanize.roll(p.notes, 30.0, s)
        self.assertEqual([n.pitch for n in rolled], [60, 64, 67])
        self.assertAlmostEqual(rolled[2].start, 0.030)


class TheoryTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(theory.parse_chord("F#m7b5/C"), (6, (0, 3, 6, 10), 0))
        self.assertEqual(theory.chord_pcs("Dmaj9"), (2, (0, 4, 7, 11, 14)))
        self.assertEqual(theory.scale("D", "major"), [2, 4, 6, 7, 9, 11, 1])
        for bad in ("H7", "Cblah"):
            with self.assertRaises(ValueError):
                theory.parse_chord(bad)
        self.assertEqual(theory.bass_note("G/B"), 35)  # the lowest B in the default range 33..52
        self.assertEqual(theory.bass_note("G/B", low=40, high=55), 47)

    def test_voicing_rules_and_voice_leading(self):
        prev = None
        for sym in ("Dmaj9", "Bm9", "Em9", "A13sus4", "Gmaj7"):
            v = theory.voicing(sym, 50, 74, prev)
            root, ivs = theory.chord_pcs(sym)
            pcs = {(root + i) % 12 for i in ivs}
            self.assertTrue(all(50 <= n <= 74 for n in v), sym)
            self.assertTrue({n % 12 for n in v} <= pcs, sym)
            self.assertTrue(theory._ok_low_intervals(v))
            if prev:
                self.assertLessEqual(sum(min(abs(x - y) for y in prev) for x in v), 12, sym)
            prev = v
        self.assertEqual(len(theory.progression(["C", "F", "G", "C"])), 4)


if __name__ == "__main__":
    unittest.main()
