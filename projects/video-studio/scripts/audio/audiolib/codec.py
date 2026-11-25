"""Lossy-codec checks: the true peak a file reaches after YouTube-style re-encoding.

    st = aac_true_peak_stats("cue.wav")       # {"worst", "median", "values"} in dBTP, or None without ffmpeg

ffmpeg's AAC encoder at 128 kb/s is chaotic on dense, bright material: copies of one master that
differ only in their last-bit dither read up to 2 dB apart after encoding (music package, critic
rounds 1 and 2). So the check encodes the file itself plus `variants` dither copies (same format and
bit depth) and reports the worst. metrics.py computes it when a profile's targets ask for
`aac.truePeak128k`.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

AAC_BITRATE = "128k"
AAC_VARIANTS = 9  # dither copies on top of the file itself: 10 encodes (5 were seed-dependent, critic round 2)


def _encode_peak(exe: str, wav: Path, bitrate: str) -> float | None:
    with tempfile.TemporaryDirectory() as d:
        m4a = Path(d) / "x.m4a"
        enc = subprocess.run([exe, "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-c:a", "aac", "-b:a", bitrate, str(m4a)],
                             capture_output=True, text=True)
        if enc.returncode != 0:
            return None
        r = subprocess.run([exe, "-hide_banner", "-nostats", "-i", str(m4a), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True)
    peak = None
    for line in r.stderr.splitlines():
        s = line.strip()
        if s.startswith("Peak:"):
            try:
                peak = float(s.split()[1])
            except (IndexError, ValueError):
                peak = None
    return peak


def aac_true_peak_stats(wav, bitrate: str = AAC_BITRATE, variants: int = AAC_VARIANTS) -> dict | None:
    """True peak (dBTP, ebur128) after an ffmpeg AAC encode at `bitrate`, for the file itself and
    `variants` copies with fresh TPDF dither in their last bit (same format and bit depth).
    Returns {"worst", "median", "values"}, or None without ffmpeg."""
    import numpy as np
    import soundfile as sf

    exe = shutil.which("ffmpeg")
    if not exe:
        return None
    wav = Path(wav)
    vals = [_encode_peak(exe, wav, bitrate)]
    if variants > 0:
        info = sf.info(str(wav))
        bits = {"PCM_16": 16, "PCM_24": 24}.get(info.subtype, 24)
        x, sr = sf.read(str(wav), always_2d=True, dtype="float64")
        lsb = 2.0 ** (1 - bits)
        with tempfile.TemporaryDirectory() as d:
            for k in range(1, variants + 1):
                g = np.random.default_rng(1000 + k)
                y = np.clip(x + (g.random(x.shape) - g.random(x.shape)) * lsb, -1.0, 1.0 - lsb)
                v = Path(d) / f"v{k}.wav"
                sf.write(str(v), y, sr, subtype=f"PCM_{bits}")
                vals.append(_encode_peak(exe, v, bitrate))
                v.unlink()  # one copy on disk at a time (a 68 s 24-bit master is 20 MB)
    ok = [v for v in vals if v is not None]
    if not ok:
        return None
    return {"worst": max(ok), "median": float(np.median(ok)), "values": ok}


def aac_true_peak(wav, bitrate: str = AAC_BITRATE, variants: int = AAC_VARIANTS) -> float | None:
    """The worst true peak (dBTP) over the AAC encodes of aac_true_peak_stats."""
    st = aac_true_peak_stats(wav, bitrate, variants)
    return None if st is None else st["worst"]
