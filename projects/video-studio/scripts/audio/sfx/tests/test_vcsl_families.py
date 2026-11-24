"""VCSL pitch convention, and the behaviour of the families (pitches, sync, determinism)."""

import math
import unittest

import numpy as np

from audiolib import paths
from audiolib.core import SR, midi_to_hz, note_number
from sfxlib import core, finish, measure, prims, rig, vcsl
from sfxlib.families import desk, keyboard, notify, rekt, ui


def have_vcsl() -> bool:
    return (paths.VCSL / "LICENSE").exists()


def cents(f, ref):
    return 1200 * math.log2(f / ref)


@unittest.skipUnless(have_vcsl(), "VCSL not installed (scripts/audio/setup.sh)")
class VcslPitch(unittest.TestCase):
    def test_labels_sound_an_octave_up(self):
        self.assertEqual(vcsl.sounding_midi("D4"), 74)
        x = vcsl.load("Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_D4_v2_rr1_Main.wav")
        f = vcsl.strongest_partial_hz(x, lo=200, hi=1500)
        self.assertLess(abs(cents(f, float(midi_to_hz(74)))), 15)  # D5, not D4 (293.7 Hz)

    def test_mallet_notes_land_on_their_pitch(self):
        for kind, note in (("vibes", "D5"), ("vibes", "A5"), ("vibes", "A4"), ("marimba", "D5"), ("marimba", "A5"), ("marimba", "G5")):
            x, rel, d = notify.mallet_note(kind, note)
            f = vcsl.strongest_partial_hz(x, lo=200, hi=2000)
            self.assertLess(abs(cents(f, float(midi_to_hz(note_number(note))))), 20, f"{kind} {note} from {rel} ({d:+} st) reads {f:.1f} Hz")
        self.assertEqual(notify.mallet_note("vibes", "D5")[2], 0)  # the D4-labelled file needs no shift

    def test_varispeed_halves_the_frequency(self):
        t = np.arange(SR) / SR
        x = prims.dual(np.sin(2 * np.pi * 1000 * t))
        y = vcsl.varispeed(x, np.full(SR // 2, 0.5))
        self.assertAlmostEqual(vcsl.strongest_partial_hz(y, 0.05, 0.4), 500.0, delta=1.0)

    def test_provenance_is_cc0_and_pinned(self):
        p = vcsl.provenance("x.wav")
        self.assertEqual(p["licence"], "CC0-1.0")
        self.assertEqual(p["commit"], paths.VCSL_COMMIT)


class Families(unittest.TestCase):
    def test_pops_are_in_tune(self):
        for note in ("D5", "G5", "A5", "D6"):
            s = ui.pop("p_01", note, "t")
            x = s.audio.mean(axis=0)
            seg = x[int(0.012 * SR) : int(0.1 * SR)]
            spec = np.abs(np.fft.rfft(seg * np.hanning(seg.size), 1 << 18))
            fr = np.fft.rfftfreq(1 << 18, 1 / SR)
            band = (fr > 300) & (fr < 1500)
            f = fr[band][int(np.argmax(spec[band]))]
            self.assertLess(abs(cents(f, float(midi_to_hz(note_number(note))))), 15, note)

    def test_keystroke_is_deterministic_and_frame_locked(self):
        a, lead = keyboard.keystroke("alpha", 3, 0.8, 3, "x")
        b, _ = keyboard.keystroke("alpha", 3, 0.8, 3, "x")
        self.assertTrue(np.array_equal(a, b))
        self.assertAlmostEqual(lead, keyboard.CONTACT_LEAD_S)
        plan = rig.typing_plan("t", 3, rig_phase=1)
        st = keyboard.render_events(plan, (plan[-1]["frame"] + 6) / 30, "t")
        errs = measure.event_onset_errors_ms(st, [{"t": e["frame"] / 30} for e in plan])
        self.assertLessEqual(max(abs(e) for e in errs), 2.0)

    def test_the_same_key_position_keeps_its_timbre(self):
        c1, _ = keyboard._modes_for("alpha", 5, "strike-a")
        c2, _ = keyboard._modes_for("alpha", 5, "strike-b")
        c3, _ = keyboard._modes_for("alpha", 9, "strike-a")
        f1, f2, f3 = c1[0][0], c2[0][0], c3[0][0]
        self.assertLess(abs(f1 / f2 - 1), 0.02)  # same key: within the per-strike jitter
        self.assertGreater(abs(f1 / f3 - 1), 0.0)

    def test_needle_detents_follow_the_reading(self):
        for i, reading in enumerate((0.25, 0.5, 1.0)):
            s = rekt.needle(f"rekt_needle_0{i + 1}", reading, f"n{i}", "")
            self.assertEqual(s.extra["detents"], int(round(reading * rekt.DETENTS)))
            ms = s.extra["detentsMs"]
            self.assertEqual(ms[-1], 800.0)  # the last detent arrives with the stop on frame 24
            gaps = np.diff(ms)
            self.assertGreater(gaps[0], gaps[len(gaps) // 2])  # slow start, fast middle (the ease)

    def test_alarm_tops_out_on_its_frame(self):
        s = rekt.alarm("rekt_alarm_01", 24, "D3", "A3", "a", "")
        self.assertEqual(s.sync, "end")
        self.assertTrue(core.on_frame(s.sync_s))
        x = s.audio.mean(axis=0)
        k = prims.n_samples(s.sync_s)
        w = prims.n_samples(0.05)
        late = np.sqrt(np.mean(x[k - w : k] ** 2))
        early = np.sqrt(np.mean(x[prims.n_samples(0.1) : prims.n_samples(0.1) + w] ** 2))
        self.assertGreater(20 * math.log10(late / early), 6.0)  # it rises into the top

    def test_error_buzz_falls_a_semitone(self):
        s = notify.error("error_02", [(0, "Eb3", "D3", 0.24, 1.0)], "")
        x = s.audio.mean(axis=0)

        def f0(seg):
            ac = np.correlate(seg, seg, "full")[seg.size - 1 :]
            lo, hi = int(SR / 200), int(SR / 120)
            return SR / (lo + int(np.argmax(ac[lo:hi])))

        start = f0(x[prims.n_samples(0.01) : prims.n_samples(0.06)])
        end = f0(x[prims.n_samples(0.18) : prims.n_samples(0.23)])
        self.assertLess(abs(cents(start, float(midi_to_hz(note_number("Eb3"))))), 30)
        self.assertLess(abs(cents(end, float(midi_to_hz(note_number("D3"))))), 30)

    def test_mug_slide_lands_on_its_frame(self):
        s = desk.mug("mug_03", "m3", 0.85, 0.0, 3, 0.12, 0.6, "")
        self.assertEqual(s.sync, "hit")
        y = finish.finalize(s)
        m = measure.analyse(y, s)
        self.assertTrue(0 <= m["syncAttackErrorMs"] <= 5.0)


if __name__ == "__main__":
    unittest.main()
