#!/usr/bin/env python3
"""Fast end-to-end check of the audio toolchain (run by setup.sh; about 5-10 s).

1. fluidsynth renders an A4 from every installed pinned soundfont: 48 kHz, fundamental within 5 cents.
2. VCSL (if present): a Steinway B sample shifted up a semitone lands within 0.5 cent of 100 cents.
3. The loudness meter reads a -23 dBFS 1 kHz stereo sine as -23.0 LUFS (EBU Tech 3341 case 1).
4. The limiter holds a hot signal under -1 dBTP.
Exit 0 when everything passes, 1 otherwise.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audiolib.venv import ensure_venv  # noqa: E402

ensure_venv()

import numpy as np  # noqa: E402

from audiolib import dynamics, fluid, loudness, paths  # noqa: E402
from audiolib.core import SR, hz_to_midi  # noqa: E402
from audiolib.midi import GM, Score  # noqa: E402


def partial_hz(mono: np.ndarray, f_expect: float, sr: int = SR) -> float:
    """Frequency of the spectral peak within 3 % of `f_expect` (the fundamental partial), from a
    Hann-windowed 1 s segment, zero-padded FFT and parabolic interpolation on the log magnitude.
    (Autocorrelation would read piano tones a few cents sharp: their upper partials are stretched.)"""
    seg = mono[int(0.1 * sr) : int(1.1 * sr)]
    seg = seg * np.hanning(len(seg))
    nfft = 1 << 22
    mag = np.abs(np.fft.rfft(seg, nfft))
    fr = np.fft.rfftfreq(nfft, 1 / sr)
    band = (fr > f_expect * 0.97) & (fr < f_expect * 1.03)
    k = int(np.argmax(np.where(band, mag, 0)))
    a, b, c = np.log(mag[k - 1 : k + 2] + 1e-30)
    return (k + 0.5 * (a - c) / (a - 2 * b + c)) * sr / nfft


def main() -> int:
    fails = []
    with tempfile.TemporaryDirectory() as tmp:
        for key in ("musescore-lossless", "musescore-sf3", "fluidr3"):
            sf = paths.SOUNDFONTS[key]
            if not sf.path.exists():
                print(f"[selfcheck] skip {key}: not installed")
                continue
            score = Score(bpm=120)
            p = score.part("tone", GM("Acoustic Grand Piano", soundfont=key))
            p.note("A4", 0, 2, 100)
            audio = fluid.render_part(score, "tone", 1.5, tail=0.5, workdir=Path(tmp) / key)
            f = partial_hz(audio.mean(axis=0), 440.0)
            cents = 100 * (hz_to_midi(f) - 69)
            ok = audio.shape == (2, int(1.5 * SR)) and abs(cents) < 5
            print(f"[selfcheck] fluidsynth {key}: {f:.2f} Hz ({cents:+.2f} cents) {'ok' if ok else 'FAIL'}")
            if not ok:
                fails.append(key)
        if paths.VCSL.exists():
            from audiolib.sampler import SampleBank, Sampler

            bank = SampleBank.from_folder(paths.vcsl_dir("Chordophones", "Zithers", "Grand Piano, Steinway B", "NoSus"))
            piano = Sampler(bank)
            # G#4 is a sampled root; A4 is the same sample shifted +1 semitone, so the ratio of the
            # two measures the engine (pitch shift + 44.1 -> 48 kHz) independently of the tuning
            root = partial_hz(piano.render_events([(68, 0.0, 1.3, 100)], 1.5).mean(axis=0), 415.3)
            shifted = partial_hz(piano.render_events([(69, 0.0, 1.3, 100)], 1.5).mean(axis=0), 440.0)
            err = 1200 * np.log2(shifted / root) - 100
            ok = abs(err) < 0.5
            print(f"[selfcheck] VCSL Steinway B: G#4 {root:.2f} Hz, A4 {shifted:.2f} Hz, shift error {err:+.3f} cents {'ok' if ok else 'FAIL'}")
            if not ok:
                fails.append("vcsl")
        else:
            print("[selfcheck] skip VCSL: not installed")
    t = np.arange(SR * 5) / SR
    sine = np.vstack([10 ** (-23 / 20) * np.sin(2 * np.pi * 1000 * t)] * 2)
    lufs = loudness.integrated(sine)
    ok = abs(lufs + 23.0) < 0.1
    print(f"[selfcheck] loudness of the EBU 3341 case-1 sine: {lufs:.2f} LUFS {'ok' if ok else 'FAIL'}")
    if not ok:
        fails.append("loudness")
    rng = np.random.default_rng(0)
    hot = np.vstack([rng.standard_normal(SR * 2) * 0.5] * 2)
    out, rep = dynamics.limit(hot, -1.0)
    ok = rep["truePeak"] <= -1.0
    print(f"[selfcheck] limiter: true peak {rep['truePeak']:.2f} dBTP (ceiling -1.0) {'ok' if ok else 'FAIL'}")
    if not ok:
        fails.append("limiter")
    if fails:
        print(f"[selfcheck] FAILED: {', '.join(fails)}", file=sys.stderr)
        return 1
    print("[selfcheck] all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
