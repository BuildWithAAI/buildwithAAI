"""The music package's pass/fail targets: the engine's (scripts/audio/targets.json) plus these changes.

- bed: the voice-referenced gate replaces `spectrum.voicePocketDb` as the fail check (critic round 1:
  the pocket was measured against the bed's own tilt and passed beds that masked Zoo's voice more than
  speech-shaped noise does). `voice.index` (>= 0.75) and `voice.indexMinusSsn` (>= 0) come from
  composer/voicegate.py; the pocket number stays as a warning.
- endscreen: the end-screen music with nobody speaking, -18 LUFS-I (the standalone checks, at -18).
- standalone and endscreen: `aac.truePeak128k` <= -1.0 dBTP after an AAC 128 kb/s encode (critic round
  1: the theme mastered at -1.3 dBTP read -0.3 after AAC); stings report it as a warning (-0.5).
  The value is the worst of several encodes: ffmpeg's AAC encoder at 128 kb/s is chaotic on dense,
  bright material. Measured on theme-15s, copies that differ only in their last-bit dither read from
  -1.9 to +0.2 dBTP (its quantisation noise, not the master's peaks; Opus 128k read -1.5 on all of
  them), so one encode can pass a file that the next would fail.
"""

from __future__ import annotations

import copy
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from audiolib import paths

VOICE_CHECKS = [
    {"id": "voice.index", "min": 0.75, "severity": "fail",
     "why": "band-audibility index of Zoo's reference narration over the bed with the planned band-split duck (composer/voicegate.py)"},
    {"id": "voice.indexMinusSsn", "min": 0.0, "severity": "fail",
     "why": "the bed must not mask the voice more than speech-shaped noise at the same loudness"},
]
AAC_FAIL = {"id": "aac.truePeak128k", "max": -1.0, "severity": "fail", "why": "true peak after AAC 128 kb/s (YouTube re-encodes): lossy overshoot must stay under -1 dBTP"}
AAC_WARN = {"id": "aac.truePeak128k", "max": -0.5, "severity": "warn", "why": "true peak after AAC 128 kb/s (YouTube re-encodes)"}


def music_targets(engine: dict | None = None) -> dict:
    """The engine's targets with the music package's changes applied (a new dict)."""
    if engine is None:
        engine = json.loads(Path(paths.TARGETS).read_text(encoding="utf-8"))
    t = copy.deepcopy(engine)
    prof = t["profiles"]
    for c in prof["bed"]["checks"]:
        if c["id"] == "spectrum.voicePocketDb":
            c["severity"] = "warn"
            c["why"] = "1-4 kHz against the bed's own tilt; reported only: the voice gate (voice.index) is the fail check"
    prof["bed"]["checks"] += copy.deepcopy(VOICE_CHECKS)
    end = copy.deepcopy(prof["standalone"])
    end["description"] = "end-screen music with nobody speaking (-18 LUFS-I)"
    for c in end["checks"]:
        if c["id"] == "loudness.integrated":
            c.update({"min": -18.5, "max": -17.5, "why": "-18 LUFS-I: 4 LU under -14 LUFS narration, music on its own under an end screen"})
    end["checks"].append({"id": "silence.tailEndDbfs", "max": -60.0, "severity": "fail", "why": "it ends with the video: a clean ending, not a cut"})
    prof["endscreen"] = end
    prof["standalone"]["checks"].append(dict(AAC_FAIL))
    prof["endscreen"]["checks"].append(dict(AAC_FAIL))
    prof["sting"]["checks"].append(dict(AAC_WARN))
    return t


def write_targets(path: Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(music_targets(), indent=2) + "\n", encoding="utf-8")
    return path


AAC_VARIANTS = 4  # extra encodes of last-bit dither variants, on top of the file itself


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


def aac_true_peak_stats(wav: Path, bitrate: str = "128k", variants: int = AAC_VARIANTS) -> dict | None:
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
    ok = [v for v in vals if v is not None]
    if not ok:
        return None
    return {"worst": max(ok), "median": float(np.median(ok)), "values": ok}


def aac_true_peak(wav: Path, bitrate: str = "128k", variants: int = AAC_VARIANTS) -> float | None:
    """The worst true peak (dBTP) over the AAC encodes of aac_true_peak_stats."""
    st = aac_true_peak_stats(wav, bitrate, variants)
    return None if st is None else st["worst"]
