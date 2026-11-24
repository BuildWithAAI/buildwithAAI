import math
import tempfile
import unittest
from pathlib import Path

import numpy as np

from audiolib import analysis, fluid, io, loudness, master, reverb
from audiolib.core import SR, midi_to_hz
from audiolib.dynamics import Compressor
from audiolib.midi import GM, Score
from audiolib.mix import Mix, Strip
from audiolib.sampler import Kit, SampleBank, Sampler, parse_name

from .helpers import cents, have_fluidsynth, have_vcsl, partial_hz, sine


def write_tone(path: Path, midi: int, amp: float, seconds: float = 2.0, sr: int = 44100, lead_silence: float = 0.0, decay: float = 1.5):
    t = np.arange(int(seconds * sr)) / sr
    x = amp * np.sin(2 * math.pi * float(midi_to_hz(midi)) * t) * np.exp(-t / decay)
    x = np.concatenate([np.zeros(int(lead_silence * sr)), x])
    import soundfile as sf

    sf.write(str(path), np.vstack([x, x]).T, sr, subtype="PCM_24")


class ParseNameTest(unittest.TestCase):
    def test_vcsl_patterns(self):
        z = parse_name("JHPiano_Sus_Close_C4_vl2_rr1.wav")
        self.assertEqual((z.root, z.layer, z.rr, z.articulation), (60, 2, 1, "JHPiano_Sus_Close"))
        z = parse_name("GPiano_sus_F#0_v1_rr1_Player.wav")
        self.assertEqual((z.root, z.layer, z.rr, z.articulation), (18, 1, 1, "GPiano_sus_Player"))
        z = parse_name("Snare2_HitSN_v5_rr2_Mid.wav")
        self.assertEqual((z.root, z.layer, z.rr, z.articulation), (None, 5, 2, "Snare2_HitSN_Mid"))
        z = parse_name("susCymb1_hit_stick_mp1.wav")
        self.assertEqual((z.root, z.layer, z.rr), (None, 1, 1))


class SamplerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        # whole-tone roots C4 and D4, two layers (the soft one 20 dB quieter), two round robins
        for root, name in ((60, "C4"), (62, "D4")):
            for layer, amp in ((1, 0.05), (2, 0.5)):
                for rr in (1, 2):
                    write_tone(d / f"Test_sus_{name}_v{layer}_rr{rr}_Mic.wav", root, amp * (1.0 if rr == 1 else 0.9), lead_silence=0.02)
        cls.bank = SampleBank.from_folder(d)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_bank_index(self):
        self.assertEqual(self.bank.roots(), [60, 62])
        self.assertEqual(self.bank.layers(), [1, 2])
        self.assertEqual(self.bank.articulations(), ["Test_sus_Mic"])
        with self.assertRaises(ValueError):
            self.bank.select("nothing")

    def test_pitch_shift_from_the_root_below(self):
        s = Sampler(self.bank)
        z, shift = s.pick(self.bank, 61, 100, {})
        self.assertEqual((z.root, shift), (60, 1.0))
        out = s.render_events([(61, 0.0, 1.5, 100)], 1.6)
        self.assertAlmostEqual(cents(partial_hz(out[0], 277.18), 277.1826), 0.0, delta=0.1)

    def test_measured_fractional_roots(self):
        # a sample measured 4 cents sharp (root 62.04) still plays its own key, shifted down 4 cents,
        # instead of the root below shifted up two semitones; a flat one (59.9) plays C4 shifted up
        from audiolib.sampler import Zone

        zones = [Zone(z.path, {60: 59.9, 62: 62.04}[z.root], z.layer, z.rr, z.articulation) for z in self.bank.zones]
        tuned = SampleBank(zones)
        s = Sampler(tuned)
        z, shift = s.pick(tuned, 62, 100, {})
        self.assertEqual(z.root, 62.04)
        self.assertAlmostEqual(shift, -0.04, places=9)
        z, shift = s.pick(tuned, 61, 100, {})
        self.assertEqual(z.root, 59.9)
        self.assertAlmostEqual(shift, 1.1, places=9)
        z, shift = s.pick(tuned, 59, 100, {})  # nothing at or below: the lowest root, shifted down
        self.assertEqual(z.root, 59.9)

    def test_onset_trim_puts_the_note_on_time(self):
        s = Sampler(self.bank)
        out = s.render_events([(60, 0.5, 1.0, 100)], 1.6)
        first = int(np.argmax(np.abs(out[0]) > 1e-4))
        self.assertLess(abs(first - int(0.5 * SR)), int(0.0015 * SR))  # within 1.5 ms (1 ms pre-roll kept)

    def test_round_robin_rotates(self):
        s = Sampler(self.bank)
        counter = {}
        picks = [s.pick(self.bank, 60, 120, counter)[0].rr for _ in range(4)]
        self.assertEqual(picks, [1, 2, 1, 2])

    def test_layer_normalisation_levels_the_layers(self):
        raw = Sampler(self.bank, velocity_power=0.0)
        lo = loudness.integrated(raw.render_events([(60, 0.0, 1.0, 30)], 1.2))
        hi = loudness.integrated(raw.render_events([(60, 0.0, 1.0, 120)], 1.2))
        self.assertAlmostEqual(hi - lo, 20.0, delta=0.5)  # the fixture's natural layer gap
        norm = Sampler(self.bank, velocity_power=0.0, normalize_layers="per_zone")
        lo = loudness.integrated(norm.render_events([(60, 0.0, 1.0, 30)], 1.2))
        hi = loudness.integrated(norm.render_events([(60, 0.0, 1.0, 120)], 1.2))
        self.assertAlmostEqual(hi - lo, 0.0, delta=0.3)

    def test_velocity_curve(self):
        s = Sampler(self.bank, velocity_power=1.7, normalize_layers="per_zone")
        a = loudness.integrated(s.render_events([(60, 0.0, 1.0, 127)], 1.2))
        b = loudness.integrated(s.render_events([(60, 0.0, 1.0, 64)], 1.2))
        self.assertAlmostEqual(a - b, 20 * 1.7 * math.log10(127 / 64), delta=0.3)

    def test_note_off_release_and_pedal(self):
        s = Sampler(self.bank, damper=(0.1, 0.1, 108))
        short = s.render_events([(60, 0.0, 0.3, 100)], 1.5)
        self.assertLess(np.max(np.abs(short[0, int(0.5 * SR) :])), 1e-3)
        held = s.render_events([(60, 0.0, 0.3, 100)], 1.5, pedal=[(0.0, 1.2)])
        self.assertGreater(np.max(np.abs(held[0, int(0.5 * SR) : int(1.0 * SR)])), 0.05)

    def test_retrigger_chokes_the_old_voice(self):
        rr1 = SampleBank([z for z in self.bank.zones if z.rr == 1])  # no round-robin change between strikes
        s = Sampler(rr1, damper=(4.0, 4.0, 108))
        two = s.render_events([(60, 0.0, 1.5, 100), (60, 0.5, 1.0, 100)], 1.5)
        one = s.render_events([(60, 0.5, 1.0, 100)], 1.5)
        late = slice(int(0.6 * SR), int(1.0 * SR))
        self.assertLess(np.max(np.abs(two[0, late] - one[0, late])), 1e-6)  # only the new voice remains

    def test_kit_chokes_open_hat(self):
        d = Path(self.tmp.name) / "kit"
        d.mkdir()
        write_tone(d / "Hat_open_v1_rr1.wav", 100, 0.3, seconds=1.5, decay=5.0)
        write_tone(d / "Hat_closed_v1_rr1.wav", 104, 0.3, seconds=0.2, decay=0.05)
        open_s = Sampler(SampleBank.from_folder(d, include="open"), one_shot=True)
        closed_s = Sampler(SampleBank.from_folder(d, include="closed"), one_shot=True)
        kit = Kit({46: open_s, 42: closed_s}, chokes=[[42, 46]])
        score = Score(bpm=60)
        part = score.part("hats")
        part.hit(46, 0.0)
        part.hit(42, 0.5)
        out = kit.render(part, score, 1.5)
        self.assertLess(np.max(np.abs(out[0, int(0.8 * SR) :])), 1e-3)


@unittest.skipUnless(have_fluidsynth(), "fluidsynth or soundfonts not installed")
class FluidTest(unittest.TestCase):
    def test_render_part_is_exact_length_and_in_tune(self):
        s = Score(bpm=120)
        p = s.part("lead", GM("Flute"))
        p.note("A4", 0, 2, 100)
        a = fluid.render_part(s, "lead", 1.25, tail=0.5)
        self.assertEqual(a.shape, (2, int(1.25 * SR)))
        self.assertAlmostEqual(cents(partial_hz(a.mean(axis=0), 440.0, t0=0.2, dur=0.9), 440.0), 0.0, delta=10)

    def test_split_drums(self):
        s = Score(bpm=120)
        d = s.part("drums", GM(0, bank=128, drums=True))
        d.hit("kick", 0)
        d.hit("snare", 1)
        d.hit("hat_closed", 0.5)
        made = fluid.split_drums(s, "drums", {"kick": [36], "snare": [38]})
        self.assertEqual(made, ["drums_kick", "drums_snare", "drums_rest"])
        self.assertEqual([n.pitch for n in s.parts["drums_rest"].notes], [42])
        stems = {m: fluid.render_part(s, m, 1.0, tail=0.3) for m in made}
        self.assertTrue(all(np.max(np.abs(a)) > 0 for a in stems.values()))


@unittest.skipUnless(have_vcsl(), "VCSL not installed")
class VcslTest(unittest.TestCase):
    def test_steinway_shift_is_exact(self):
        from audiolib import paths

        bank = SampleBank.from_folder(paths.vcsl_dir("Chordophones", "Zithers", "Grand Piano, Steinway B", "NoSus"))
        s = Sampler(bank)
        root = partial_hz(s.render_events([(68, 0.0, 1.3, 100)], 1.5).mean(axis=0), 415.3)
        up = partial_hz(s.render_events([(69, 0.0, 1.3, 100)], 1.5).mean(axis=0), 440.0)
        self.assertAlmostEqual(cents(up, root), 100.0, delta=0.5)


class ReverbTest(unittest.TestCase):
    def test_impulse_response(self):
        for name in ("room", "plate", "hall"):
            room = reverb.PRESETS[name]
            ir = reverb.impulse_response(room)
            self.assertEqual(ir.shape[0], 2)
            np.testing.assert_allclose(np.sum(ir**2, axis=1), [1.0, 1.0], rtol=1e-9)
            pre = int(room.predelay_ms * SR / 1000)
            self.assertEqual(np.max(np.abs(ir[:, : max(1, pre - 200)])), 0.0) if pre > 400 else None
            rt = reverb.rt60_estimate(ir[0])
            self.assertAlmostEqual(rt, room.rt60, delta=0.35 * room.rt60, msg=name)
            self.assertLess(abs(np.corrcoef(ir[0], ir[1])[0, 1]), 0.3, msg=name)

    def test_convolve_length(self):
        ir = reverb.impulse_response("room")
        out = reverb.convolve(np.ones((1, 100)), ir)
        self.assertEqual(out.shape, (2, 100 + ir.shape[1] - 1))


class MixTest(unittest.TestCase):
    def test_strips_sum_to_the_bus(self):
        a = np.vstack([sine(220, 2.0, 0.3), sine(220, 2.0, 0.2)])
        b = np.vstack([sine(330, 2.0, 0.2)] * 2)
        mix = Mix(length=2.0, room="room", glue=None)
        mix.add(Strip("a", a, fader_db=-3, eq=[{"kind": "highpass", "f": 80, "order": 2}], comp=Compressor(threshold_db=-30), send_db=-10))
        mix.add(Strip("b", b, pan=0.5, width=0.0, sat={"drive_db": 3.0}))
        bus, rep, stems = mix.render(return_stems=True)
        self.assertEqual(bus.shape, (2, 2 * SR))
        np.testing.assert_allclose(bus, stems["a"] + stems["b"] + stems["reverb"], atol=1e-9)
        self.assertAlmostEqual(rep["strips"][0]["stageGainDb"] + loudness.integrated(a), -20.0, delta=0.05)
        self.assertIn("reverb", rep)
        with self.assertRaises(ValueError):
            mix.add(Strip("a", a))

    def test_glue_compressor_reports(self):
        rng = np.random.default_rng(2)
        x = rng.standard_normal((2, 3 * SR)) * 0.2
        mix = Mix(length=3.0, room=None)
        mix.add(Strip("noise", x))
        _, rep = mix.render()
        self.assertGreater(rep["glue"]["grMeanDb"], 0.0)
        self.assertIn("busLufs", rep)


class MasterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # a music-like test signal: two chords of decaying tones, drum-like noise bursts, 12 s
        rng = np.random.default_rng(11)
        n = 12 * SR
        t = np.arange(n) / SR
        x = np.zeros(n)
        for k, start in enumerate(np.arange(0, 12, 0.5)):
            i0 = int(start * SR)
            seg = t[: n - i0]
            f = (110, 147, 165, 196)[k % 4]
            x[i0:] += 0.3 * np.sin(2 * math.pi * f * seg) * np.exp(-seg / 0.6)
            burst = rng.standard_normal(min(2400, n - i0)) * np.exp(-np.arange(min(2400, n - i0)) / 300)
            x[i0 : i0 + burst.size] += 0.4 * burst
        cls.music = np.vstack([x, np.roll(x, 37)]) * 0.5

    def test_presets_hit_targets(self):
        for name in ("standalone", "sting", "bed"):
            out, rep = master.master(self.music, name)
            p = master.PRESETS[name]
            self.assertTrue(rep["ok"], msg=f"{name}: {rep['measured']} vs {p.target}")
            self.assertAlmostEqual(master.measure(out, p.measure), p.target, delta=0.15, msg=name)
            self.assertLessEqual(loudness.true_peak(out), p.ceiling_dbtp, msg=name)
            self.assertEqual(out.shape, self.music.shape)
            self.assertLess(np.max(np.abs(out[:, 0])), 0.01)  # 2 ms fade-in: the first sample is at 0.8 % gain
            self.assertLess(np.max(np.abs(out[:, -1])), 0.001)  # 10 ms fade-out

    def test_bed_eq_cuts_the_voice_band(self):
        from audiolib import dsp

        sos = dsp.eq_sos(list(master.PRESETS["bed"].eq))
        r = dsp.sos_response_db(sos, [100.0, 1000.0, 2000.0, 4000.0, 6000.0])
        self.assertLess(r[2], -3.0)  # the pocket is centred on 2 kHz
        self.assertLess(r[1], -1.0)
        self.assertLess(r[3], -1.0)
        self.assertGreater(r[0], -1.0)  # the body of the music stays
        self.assertGreater(r[4], -2.0)

    def test_loop_mode_keeps_the_seam(self):
        # a truly periodic 6 s loop: every event's tail wraps around to the start
        n = 6 * SR
        x = np.zeros(n)
        t = np.arange(n) / SR
        rng = np.random.default_rng(4)
        for k, start in enumerate(np.arange(0, 6, 0.5)):
            i0 = int(start * SR)
            tone = 0.3 * np.sin(2 * math.pi * (110, 147, 165, 196)[k % 4] * t) * np.exp(-t / 0.6)
            x += np.roll(tone, i0)
            burst = np.zeros(n)
            burst[:2400] = rng.standard_normal(2400) * np.exp(-np.arange(2400) / 300) * 0.4
            x += np.roll(burst, i0)
        loop = np.vstack([x, x]) * 0.5
        self.assertLess(analysis.loop_seam(loop)["clickRatio"], 2.0)  # seamless, with a hit on the seam
        between_hits = np.roll(loop, -int(0.25 * SR), axis=1)  # still seamless: the seam is between hits
        self.assertLess(analysis.loop_seam(between_hits)["clickRatio"], 2.0)
        broken = between_hits[:, :-137]  # the same loop cut 137 samples short: a click in the tones
        self.assertGreater(analysis.loop_seam(broken)["clickRatio"], 2.0)
        out, rep = master.master(between_hits, "bed", loop=True)
        self.assertLess(analysis.loop_seam(out)["clickRatio"], 2.0)
        self.assertTrue(rep["loop"])
        cut, _ = master.master(between_hits, "bed", loop=False)  # end fades break the loop
        self.assertGreater(analysis.loop_seam(cut)["clickRatio"], 2.0)

    def test_export_writes_wav_preview_and_report(self):
        out, rep = master.master(self.music, "sting")
        with tempfile.TemporaryDirectory() as d:
            files = master.export(Path(d) / "sting.wav", out, rep)
            info = io.info(files["wav"])
            self.assertEqual((info["samplerate"], info["subtype"]), (SR, "PCM_24"))
            self.assertTrue(Path(files["m4a"]).stat().st_size > 1000)
            self.assertTrue(Path(files["report"]).read_text().startswith("{"))

    def test_silence_is_refused(self):
        with self.assertRaises(ValueError):
            master.master(np.zeros((2, SR)), "standalone")


if __name__ == "__main__":
    unittest.main()
