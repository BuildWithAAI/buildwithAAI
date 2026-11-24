#!/usr/bin/env python3
"""The engine's 20 s reference render: a piano + bass + drums trio, mixed, mastered and measured.

    python3 scripts/audio/render_reference.py                 # -> out/audio/reference/
    python3 scripts/audio/render_reference.py --out /tmp/ref --no-metrics

Music: 96 BPM, 4/4, D major, 8 bars (exactly 20.0 s). | Gmaj9 | F#m7 | Em9 | A9sus4 A13 |
Gmaj9 | F#m7 Bm9 | Em9 A9sus4 | Dmaj9 |. Bars 1-4 cross-stick and comping; bars 5-8 snare,
a right-hand melody, cymbal at the section change and on the final chord.

Sources (all verified licences, docs/AUDIO_LICENSES.md):
- piano: VCSL "Grand Piano, Kawai" (CC0), 4 velocity layers levelled per zone, release samples,
  sustain pedal, pitch-dependent dampers;
- bass: the engine's plucked-string model (synth.PluckString, extended Karplus-Strong): the GM
  finger-bass samples were measured with loop-splice sidebands on held notes (see docs/AUDIO.md);
- kick: MuseScore_General Standard kit (MIT) through fluidsynth;
- snare, cross-stick, hi-hats, cymbal: VCSL (CC0) one-shots with velocity layers and round robins.

Writes stems (pre-fader and post-fader), the MIDI, the pre-master mix, the standalone (-14 LUFS)
and bed (-26 LUFS-S) masters with AAC previews, metrics JSON and spectrogram/waveform PNGs.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audiolib.venv import ensure_venv  # noqa: E402

ensure_venv()

import numpy as np  # noqa: E402

from audiolib import fluid, humanize, io, master, paths  # noqa: E402
from audiolib.core import SR  # noqa: E402
from audiolib.dynamics import Compressor  # noqa: E402
from audiolib.midi import GM, Score  # noqa: E402
from audiolib.mix import Mix, Strip  # noqa: E402
from audiolib.sampler import Kit, SampleBank, Sampler  # noqa: E402
from audiolib.synth import PluckString  # noqa: E402

BPM = 96
BARS = 8
LENGTH = 20.0  # 8 bars of 2.5 s
TAIL = 0.0  # the piece ends inside the 20 s: the final chord rings out under a fade

# piano voicings (MIDI) and the bar/beat where each chord starts (beats are 1-based in comments)
CHORDS = [
    # bar, beat, symbol, left-hand voicing
    (0, 0.0, "Gmaj9", [59, 62, 66, 69]),  # B3 D4 F#4 A4
    (1, 0.0, "F#m7", [57, 61, 64, 69]),  # A3 C#4 E4 A4
    (2, 0.0, "Em9", [55, 59, 62, 66]),  # G3 B3 D4 F#4
    (3, 0.0, "A9sus4", [55, 59, 62, 64]),  # G3 B3 D4 E4
    (3, 2.0, "A13", [55, 59, 61, 66]),  # G3 B3 C#4 F#4
    (4, 0.0, "Gmaj9", [54, 57, 59, 62]),  # F#3 A3 B3 D4
    (5, 0.0, "F#m7", [52, 57, 61, 66]),  # E3 A3 C#4 F#4
    (5, 2.0, "Bm9", [54, 57, 61, 62]),  # F#3 A3 C#4 D4
    (6, 0.0, "Em9", [55, 59, 62, 66]),  # G3 B3 D4 F#4
    (6, 2.0, "A9sus4", [55, 59, 62, 64]),  # G3 B3 D4 E4
    (7, 0.0, "Dmaj9", [54, 57, 61, 64]),  # F#3 A3 C#4 E4
]

MELODY = [  # bar, beat, note, beats, velocity
    (4, 0.0, "F#5", 1.0, 78), (4, 1.5, "E5", 0.5, 66), (4, 2.0, "D5", 1.5, 72),
    (5, 0.0, "C#5", 1.5, 74), (5, 1.5, "A4", 0.5, 62), (5, 2.0, "B4", 1.5, 70),
    (6, 0.0, "B4", 1.0, 70), (6, 1.0, "D5", 0.5, 64), (6, 1.5, "E5", 2.0, 76),
    (7, 0.0, "F#5", 4.0, 74),
]

BASS = [  # bar, beat, note, beats, velocity
    (0, 0.0, "G2", 1.5, 100), (0, 1.5, "G3", 0.4, 78), (0, 2.0, "D3", 0.9, 90), (0, 3.0, "A2", 0.45, 80), (0, 3.5, "G2", 0.45, 84),
    (1, 0.0, "F#2", 1.5, 98), (1, 1.5, "F#3", 0.4, 76), (1, 2.0, "C#3", 0.9, 88), (1, 3.0, "A2", 0.45, 80), (1, 3.5, "F2", 0.45, 78),
    (2, 0.0, "E2", 1.5, 100), (2, 1.5, "E3", 0.4, 78), (2, 2.0, "B2", 0.9, 88), (2, 3.0, "D3", 0.45, 80), (2, 3.5, "A#2", 0.45, 80),
    (3, 0.0, "A2", 1.5, 98), (3, 1.5, "A3", 0.4, 76), (3, 2.0, "E3", 0.9, 90), (3, 3.0, "G3", 0.45, 80), (3, 3.5, "G#2", 0.45, 84),
    (4, 0.0, "G2", 1.5, 102), (4, 1.5, "D3", 0.4, 80), (4, 2.0, "G2", 0.9, 90), (4, 3.0, "A2", 0.45, 82), (4, 3.5, "G2", 0.45, 84),
    (5, 0.0, "F#2", 1.0, 100), (5, 1.0, "C#3", 0.4, 80), (5, 2.0, "B2", 1.0, 96), (5, 3.0, "C#3", 0.45, 80), (5, 3.5, "D#2", 0.45, 84),
    (6, 0.0, "E2", 1.0, 100), (6, 1.0, "B2", 0.4, 80), (6, 2.0, "A2", 1.0, 96), (6, 3.0, "E3", 0.45, 80), (6, 3.5, "C#3", 0.45, 86),
    (7, 0.0, "D2", 3.6, 104),
]

# GM keys used for the VCSL kit parts
XSTICK, SNARE, TAP, HAT_C, HAT_P, HAT_O, CRASH = 37, 38, 40, 42, 44, 46, 49


def compose() -> Score:
    s = Score(bpm=BPM, time_sig=(4, 4), key="D")
    bar = s.bar
    piano = s.part("piano")
    for i, (b, beat, _sym, voicing) in enumerate(CHORDS):
        start = bar(b) + beat
        nxt = (bar(CHORDS[i + 1][0]) + CHORDS[i + 1][1]) if i + 1 < len(CHORDS) else bar(BARS)
        span = nxt - start
        final = i == len(CHORDS) - 1
        v = 62 if b < 4 else 58
        if final:
            piano.chord(voicing, start, 4.0, 60)
            continue
        # neo-soul comp: the chord on the downbeat, a lighter push on the "and" of 2 when the chord
        # lasts a full bar, and the top three notes again on beat 4 as a pickup
        piano.chord(voicing, start, min(1.4, span - 0.05), v)
        if span >= 4:
            piano.chord(voicing[1:], start + 1.5, 0.45, v - 12)
            piano.chord(voicing[1:], start + 3.0, 0.4, v - 16)
        else:
            piano.chord(voicing[1:], start + 1.5, 0.4, v - 12)
    for b, beat, note, dur, vel in MELODY:
        piano.note(note, bar(b) + beat, dur, vel)
    # pedal: down just after each chord change (syncopated pedalling), up just before the next
    changes = [bar(b) + beat for b, beat, _, _ in CHORDS] + [bar(BARS)]
    for a, z in zip(changes, changes[1:]):
        piano.sustain(a + 0.08, z - 0.04 if z < bar(BARS) else z + 1.0)

    bass = s.part("bass")
    for b, beat, note, dur, vel in BASS:
        bass.note(note, bar(b) + beat, dur, vel)

    kick = s.part("kick", GM(0, bank=128, soundfont="musescore", drums=True))
    kick_a = [(0.0, 100), (1.75, 78), (2.5, 88)]
    kick_b = [(0.0, 100), (1.5, 82), (2.75, 80)]
    for b in range(7):
        for beat, vel in (kick_a if b % 2 == 0 else kick_b):
            kick.hit("kick", bar(b) + beat, vel)
    kick.hit("kick", bar(7), 108)

    drums = s.part("kit")
    for b in range(7):
        back = XSTICK if b < 4 else SNARE
        for beat in (1.0, 3.0):
            drums.hit(back, bar(b) + beat, 92 if back == XSTICK else 104)
        # hats: 8ths, open hat on the last "and" of every second bar from bar 5
        for k in range(8):
            beat = k * 0.5
            if b >= 4 and b % 2 == 1 and k == 7:
                drums.hit(HAT_O, bar(b) + beat, 70)
            else:
                drums.hit(HAT_C, bar(b) + beat, 74 if k % 2 == 0 else 52)
        if b >= 4:
            for beat in (2.75,):
                drums.hit(TAP, bar(b) + beat, 34)
    # fill into bar 5: soft 16th taps rising
    for k, vel in enumerate((38, 46, 56, 68)):
        drums.hit(TAP, bar(3) + 3.0 + k * 0.25, vel)
    drums.hit(CRASH, bar(4), 84)
    drums.hit(CRASH, bar(7), 92)
    drums.hit(HAT_P, bar(7) + 1.0, 50)
    return s


def humanize_score(s: Score) -> None:
    p = s.parts["piano"]
    p.notes = humanize.roll(p.notes, 16.0, s)
    p.notes = humanize.humanize(p.notes, s, timing_ms=5.0, drift_ms=3.0, velocity=4.0, seed="ref-piano")
    b = s.parts["bass"]
    b.notes = humanize.humanize(b.notes, s, timing_ms=5.0, drift_ms=3.0, velocity=4.0, seed="ref-bass")
    lay_back = s.ms_to_beats(8.0, 0)  # the bass sits a hair behind the beat
    for n in b.notes:
        n.start += lay_back
    for name, seed in (("kick", "ref-kick"), ("kit", "ref-kit")):
        part = s.parts[name]
        part.notes = humanize.swing(part.notes, amount=0.56, grid=0.5)
        part.notes = humanize.humanize(part.notes, s, timing_ms=3.5, drift_ms=2.5, velocity=5.0, seed=seed)
    p.notes = humanize.swing(p.notes, amount=0.56, grid=0.5)
    b.notes = humanize.swing(b.notes, amount=0.56, grid=0.5)


def vcsl(*parts):
    return paths.vcsl_dir(*parts)


def instruments():
    zith = ("Chordophones", "Zithers", "Grand Piano, Kawai")
    piano = Sampler(
        SampleBank.from_folder(vcsl(*zith, "Sustains")),
        release_bank=SampleBank.from_folder(vcsl(*zith, "Releases")),
        normalize_layers="per_zone", velocity_power=1.6, release_gain_db=-22.0, damper=(0.5, 0.12, 88), seed="kawai",
    )
    mem = ("Membranophones", "Struck Membranophones")
    idio = ("Idiophones", "Struck Idiophones")
    snare = Sampler(SampleBank.from_folder(vcsl(*mem, "Snare Drum, Modern 1"), include="HitSN"), one_shot=True, normalize_layers="per_zone", velocity_power=1.3)
    taps = Sampler(SampleBank.from_folder(vcsl(*mem, "Snare Drum, Modern 1"), include="taps"), one_shot=True, velocity_power=1.4)
    xstick = Sampler(SampleBank.from_folder(vcsl(*mem, "Snare Drum, Modern 3"), include="Xstick"), one_shot=True, velocity_power=1.2)
    hat_c = Sampler(SampleBank.from_folder(vcsl(*idio, "Hi-Hat Cymbal"), include="HitC"), one_shot=True, normalize_layers="per_zone", velocity_power=1.4)
    hat_o = Sampler(SampleBank.from_folder(vcsl(*idio, "Hi-Hat Cymbal"), include="HitO_"), one_shot=True, velocity_power=1.3)
    hat_p = Sampler(SampleBank.from_folder(vcsl(*idio, "Hi-Hat Cymbal"), include="Close"), one_shot=True, velocity_power=1.3)
    crash = Sampler(SampleBank.from_folder(vcsl(*idio, "Suspended Cymbal 1"), include="hit_stick_mp1"), one_shot=True, velocity_power=1.2)
    kit = Kit({XSTICK: xstick, SNARE: snare, TAP: taps, HAT_C: hat_c, HAT_P: hat_p, HAT_O: hat_o, CRASH: crash}, chokes=[[HAT_C, HAT_P, HAT_O]])
    # fingered electric bass: plucked a fifth of the way from the bridge, long sustain, dark tone
    bass = PluckString(t60=4.0, damping=0.55, brightness=0.45, pick_pos=0.22, release=0.06, tone_hz=2800, body=(100.0, 2.0), mono=True, seed="ref-bass")
    return piano, kit, bass


def render_stems(s: Score, workdir: Path) -> dict:
    piano, kit, bass = instruments()
    kit_part = s.parts["kit"]
    return {
        "piano": piano.render(s.parts["piano"], s, LENGTH),
        "bass": bass.render(s.parts["bass"], s, LENGTH),
        "kick": fluid.render_part(s, "kick", LENGTH, tail=2.0, workdir=workdir / "fluid"),
        "snare": kit.render(kit_part, s, LENGTH, only={SNARE, TAP, XSTICK}),
        "hats": kit.render(kit_part, s, LENGTH, only={HAT_C, HAT_P, HAT_O}),
        "cymbal": kit.render(kit_part, s, LENGTH, only={CRASH}),
    }


def build_mix(stems: dict) -> Mix:
    # the reverb return loses the 300-700 Hz build-up of the pedalled piano
    mix = Mix(length=LENGTH, room="plate", return_db=0.0, return_eq=[{"kind": "peak", "f": 520, "q": 0.8, "db": -3.0}],
              # bus: a broad touch less 650 Hz build-up and a little air (the trio reads warm and dark)
              bus_eq=[{"kind": "peak", "f": 650, "q": 0.7, "db": -1.5}, {"kind": "highshelf", "f": 7000, "q": 0.7, "db": 1.5}])
    mix.add(Strip("piano", stems["piano"], fader_db=0.0,
                  eq=[{"kind": "highpass", "f": 45, "order": 2}, {"kind": "peak", "f": 280, "q": 1.0, "db": -1.5},
                      {"kind": "peak", "f": 580, "q": 0.9, "db": -3.5}, {"kind": "highshelf", "f": 6000, "q": 0.7, "db": 2.5}],
                  comp=Compressor(threshold_db=-26, ratio=2.0, attack_ms=18, release_ms=160, knee_db=6, detector="rms", rms_ms=15),
                  width=1.1, bass_mono_hz=140, send_db=-8.0))
    mix.add(Strip("bass", stems["bass"], fader_db=-1.5,
                  eq=[{"kind": "highpass", "f": 32, "order": 4}, {"kind": "peak", "f": 75, "q": 1.0, "db": 1.5},
                      {"kind": "peak", "f": 250, "q": 1.2, "db": -2.5}, {"kind": "peak", "f": 900, "q": 1.0, "db": 1.5},
                      {"kind": "lowpass", "f": 5000, "order": 2}],
                  comp=Compressor(threshold_db=-20, ratio=3.0, attack_ms=15, release_ms=120, knee_db=6),
                  sat={"drive_db": 6.0, "kind": "asym", "mix": 0.5}, width=0.0))
    mix.add(Strip("kick", stems["kick"], fader_db=-2.0,
                  eq=[{"kind": "highpass", "f": 30, "order": 4}, {"kind": "peak", "f": 58, "q": 1.2, "db": 2.0},
                      {"kind": "peak", "f": 330, "q": 1.4, "db": -3.5}, {"kind": "peak", "f": 3200, "q": 1.0, "db": 2.0}],
                  comp=Compressor(threshold_db=-18, ratio=3.0, attack_ms=15, release_ms=90, knee_db=4),
                  sat={"drive_db": 3.0, "kind": "tanh"}, width=0.0))
    mix.add(Strip("snare", stems["snare"], fader_db=-3.0,
                  eq=[{"kind": "highpass", "f": 90, "order": 2}, {"kind": "peak", "f": 200, "q": 1.2, "db": 1.5},
                      {"kind": "peak", "f": 650, "q": 1.4, "db": -2.0}, {"kind": "peak", "f": 4500, "q": 1.2, "db": 1.5}],
                  comp=Compressor(threshold_db=-18, ratio=3.0, attack_ms=10, release_ms=100, knee_db=4),
                  width=0.6, send_db=-7.0))
    mix.add(Strip("hats", stems["hats"], fader_db=-7.5, pan=0.3,
                  eq=[{"kind": "highpass", "f": 320, "order": 2}, {"kind": "highshelf", "f": 9000, "q": 0.7, "db": -1.0}],
                  width=0.7, send_db=-14.0))
    mix.add(Strip("cymbal", stems["cymbal"], fader_db=-11.0, pan=-0.3,
                  eq=[{"kind": "highpass", "f": 280, "order": 2}, {"kind": "highshelf", "f": 8000, "q": 0.7, "db": -2.0}],
                  send_db=-12.0))
    return mix


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=str(paths.OUT / "reference"))
    ap.add_argument("--no-metrics", action="store_true")
    args = ap.parse_args(argv)
    out = Path(args.out)
    (out / "stems").mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    score = compose()
    humanize_score(score)
    score.save_midi(out / "reference.mid")
    stems = render_stems(score, out)
    t_stems = time.time() - t0
    for name, a in stems.items():
        io.write(out / "stems" / f"{name}.raw.wav", a / max(1e-9, np.abs(a).max()) * 0.5, subtype="PCM_24")
    mix = build_mix(stems)
    premaster, mix_report, post = mix.render(return_stems=True)
    for name, a in post.items():
        peak = np.abs(a).max()
        io.write(out / "stems" / f"{name}.post.wav", a * (0.9 / peak if peak > 0.9 else 1.0), subtype="FLOAT")
    # the final chord rings out: a 1.4 s fade ends the piece at exactly 20.0 s (before mastering,
    # so the loudness loop measures the finished shape)
    fade = int(1.4 * SR)
    premaster[:, -fade:] *= np.cos(np.linspace(0, np.pi / 2, fade)) ** 1.5
    io.write(out / "reference_premaster.wav", premaster, subtype="FLOAT")
    results = {"timings": {"stemsS": round(t_stems, 1)}, "mix": mix_report, "masters": {}}
    for preset in ("standalone", "bed"):
        audio, rep = master.master(premaster, preset)
        paths_out = master.export(out / f"reference_{preset}.wav", audio, rep)
        results["masters"][preset] = {"files": paths_out, "report": rep}
    results["timings"]["totalS"] = round(time.time() - t0, 1)
    if not args.no_metrics:
        import metrics

        for preset in ("standalone", "bed"):
            wav = out / f"reference_{preset}.wav"
            res = metrics.run(wav, preset, False, out / f"reference_{preset}")
            (out / f"reference_{preset}.metrics.json").write_text(json.dumps(res, indent=2) + "\n")
            print(metrics.summary_text(res), file=sys.stderr)
            results["masters"][preset]["metricsPass"] = res["pass"]
    (out / "report.json").write_text(json.dumps(results, indent=2, default=str) + "\n")
    print(json.dumps({"out": str(out), "timings": results["timings"], "pass": {k: v.get("metricsPass") for k, v in results["masters"].items()}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
