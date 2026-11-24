#!/usr/bin/env python3
"""Listening aids for the owner's review (nobody could listen in the session that made the music).

    python3 scripts/audio/music/review.py            # -> out/audio/music/review/

Writes:
- review-reel.m4a: every cue in order with 1.5 s gaps, each lifted to -16 LUFS-I so beds and
  stings can be compared on one volume setting (beds play 10 dB louder than they will in a video);
  review-reel.txt lists the start time of each cue;
- under-voice/<bed>.m4a: each bed looped under the engine demo narration (Kokoro im_nicola,
  public/generated/_dev/engine-demo/en/narration.wav), ducked with scripts/audio/duck.py's defaults
  (-6 dB under speech) and mixed and mastered at -14 LUFS-I, as it would sit in an episode;
  under-voice/summary.json: the voice-over-bed gap under speech for each bed.
Reads the 24-bit masters in out/audio/music/<id>/<id>.wav (run build.py first).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from audiolib.venv import ensure_venv  # noqa: E402

ensure_venv()

import numpy as np  # noqa: E402

from audiolib import io, loudness, master, paths  # noqa: E402
from audiolib.core import SR, as_stereo, db_to_lin  # noqa: E402
from composer.cues import REGISTRY  # noqa: E402

OUT = paths.OUT / "music"
VOICE = paths.STUDIO / "public" / "generated" / "_dev" / "engine-demo" / "en" / "narration.wav"
ORDER = ["theme-full", "theme-15s", "theme-5s", "intro-sting-show", "intro-sting-zoora", "bumper-rekt-meter", "bumper-red-flag",
         "bumper-one-fix", "bumper-scam-of-the-week", "bumper-developing", "bumper-correction", "endscreen-bed",
         "bed-show-neutral", "bed-show-tension", "bed-show-light", "bed-story-curious", "bed-story-tension", "bed-story-ominous", "bed-story-resolve"]


def _m4a(wav: Path, m4a: Path) -> None:
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", str(m4a)],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-500:])


def reel(out: Path) -> Path:
    parts, lines, t = [], [], 0.0
    gap = np.zeros((2, int(1.5 * SR)))
    for cid in ORDER:
        wav = OUT / cid / f"{cid}.wav"
        if not wav.exists():
            continue
        a = io.read(wav)
        if REGISTRY[cid].loop:
            a = a[:, : int(30 * SR)].copy()  # the first 30 s of each loop, faded out
            k = int(1.0 * SR)
            a[:, -k:] *= np.linspace(1, 0, k)
        i = loudness.integrated(a)
        a = a * float(db_to_lin(-16.0 - i))
        pk = float(np.max(np.abs(a)))
        if pk > 0.89:
            a *= 0.89 / pk
        lines.append(f"{int(t // 60)}:{t % 60:05.2f}  {cid}  ({REGISTRY[cid].title})")
        parts += [a, gap]
        t += (a.shape[1] + gap.shape[1]) / SR
    allv = np.concatenate(parts, axis=1)
    wav = out / "review-reel.wav"
    io.write(wav, allv)
    _m4a(wav, out / "review-reel.m4a")
    wav.unlink()
    (out / "review-reel.txt").write_text("Every cue at -16 LUFS-I for comparison (beds are 10 dB quieter in a video).\n" + "\n".join(lines) + "\n", encoding="utf-8")
    return out / "review-reel.m4a"


def under_voice(out: Path) -> dict:
    sys.path.insert(0, str(HERE.parent))
    import duck as duck_cli

    raw = io.read(VOICE)
    # a mono narration goes to both sides at -3 dB (ffmpeg's upmix), the convention duck.py measures with
    voice = as_stereo(raw) * (0.7071 if raw.shape[0] == 1 else 1.0)
    summary = {}
    d = out / "under-voice"
    d.mkdir(parents=True, exist_ok=True)
    for cid in ORDER:
        cue = REGISTRY[cid]
        if not (cue.loop or cue.cue_type == "endscreen"):
            continue
        bed = OUT / cid / f"{cid}.wav"
        if not bed.exists():
            continue
        ducked = d / f"{cid}.ducked.wav"
        rep = duck_cli.run(bed, VOICE, ducked, frames_path=None)
        b = io.read(ducked)
        n = min(b.shape[1], voice.shape[1])
        mixed = voice[:, :n] + b[:, :n]
        res, mrep = master.master(mixed, "standalone")
        wav = d / f"{cid}.wav"
        io.write(wav, res)
        _m4a(wav, d / f"{cid}.m4a")
        wav.unlink()
        ducked.unlink()
        summary[cid] = {k: rep.get(k) for k in rep if k not in ("out", "frames")}
    (d / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def main() -> int:
    out = OUT / "review"
    out.mkdir(parents=True, exist_ok=True)
    print(reel(out))
    if VOICE.exists():
        s = under_voice(out)
        for cid, r in s.items():
            print(cid, json.dumps(r))
    else:
        print(f"no demo narration at {VOICE}; skipped the under-voice mixes", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
