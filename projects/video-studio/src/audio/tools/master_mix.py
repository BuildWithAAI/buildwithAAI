#!/usr/bin/env python3
"""Master a rendered mix for delivery: -14 LUFS integrated, true peak under -1 dBTP after the AAC encode.

    .venv-audio/bin/python src/audio/tools/master_mix.py --wav mix.wav --video render.mp4 --out final.mp4 [--wav-out mastered.wav]

Remotion sums its tracks with no bus processing, so a mix lands wherever its parts put it (a music-heavy
demo at -16 LUFS, a talk-heavy episode near -14) and nothing guarantees the delivery ceiling when peaks
coincide. This is the bus stage a broadcast mix ends with:

  1. the rendered mix (the same composition rendered losslessly: --codec=wav, or --separate-audio-to);
  2. one static gain to -14 LUFS-I (BS.1770-4, the audio engine's meter, which agrees with ffmpeg's ebur128
     within 0.02 LU), into the engine's true-peak limiter (pedalboard BrickwallLimiter in true-peak mode,
     5 ms lookahead, verified by the engine's 4x-oversampled meter) at -1.5 dBTP; the gain is re-aimed
     (secant steps) until the LIMITED result is within 0.05 LU of the target;
  3. AAC with the encoder Remotion itself uses (libfdk_aac, 320 kb/s, 18 kHz cutoff, via `npx remotion
     ffmpeg`), muxed with the render's video stream copied untouched;
  4. the delivered MP4 is decoded and measured again; if the codec pushed the true peak over -1 dBTP the
     ceiling drops by the overshoot and steps 2-4 repeat.

Nothing else is touched: no EQ, no compression. On a speech-led mix the voice never reaches the limiter
(it peaks near -4 dBTP after the stereo upmix), so only stingers' and effects' transients are caught.
Prints and writes a JSON report (--report). Exit codes: 0 delivered in spec, 1 not, 2 bad input.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

STUDIO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(STUDIO / "scripts" / "audio"))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

from audiolib import loudness  # noqa: E402
from audiolib.dynamics import limit  # noqa: E402

SR = 48000


def remotion_ffmpeg(args: list[str]) -> subprocess.CompletedProcess:
    p = subprocess.run(["npx", "remotion", "ffmpeg", "-hide_banner", "-v", "error", *args], cwd=STUDIO, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {' '.join(args)}\n{p.stderr[-2000:]}")
    return p


def master_audio(x: np.ndarray, target: float, ceiling: float, release_ms: float = 80.0, tol: float = 0.05) -> tuple[np.ndarray, dict]:
    i0 = loudness.integrated(x)
    if not math.isfinite(i0):
        raise ValueError("cannot master silence")
    g = target - i0
    tries = []
    out, rep = x, {}
    for _ in range(8):
        staged = x * 10 ** (g / 20)
        out, rep = limit(staged, ceiling, release_ms=release_ms, sr=SR)
        got = loudness.integrated(out)
        tries.append((round(g, 3), round(got, 3)))
        err = target - got
        if abs(err) <= tol:
            break
        slope = 1.0
        if len(tries) >= 2 and abs(tries[-1][0] - tries[-2][0]) > 1e-6:
            slope = min(1.0, max(0.25, (tries[-1][1] - tries[-2][1]) / (tries[-1][0] - tries[-2][0])))
        g += err / slope
    return out, {"inputIntegratedLufs": round(i0, 2), "inputTruePeakDbtp": round(loudness.true_peak(x), 2), "gainDb": round(g, 2), "gainSteps": tries,
                 "ceilingDbtp": ceiling, "limiter": rep, "integratedLufs": round(loudness.integrated(out), 2), "truePeakDbtp": round(loudness.true_peak(out), 2)}


def measure_mp4(path: Path, tmp: Path) -> dict:
    # decode with the system ffmpeg: Remotion's build has no float PCM encoder, and a 16-bit decode would round the peaks
    dec = tmp / "decoded.wav"
    p = subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-y", "-i", str(path), "-vn", "-c:a", "pcm_f32le", "-ar", str(SR), str(dec)], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"could not decode {path}: {p.stderr[-1000:]}")
    y, sr = sf.read(str(dec), always_2d=True, dtype="float64")
    y = y.T
    return {"integratedLufs": round(loudness.integrated(y), 2), "truePeakDbtp": round(loudness.true_peak(y), 2), "durationSec": round(y.shape[1] / SR, 3)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--wav", required=True, help="the rendered mix, lossless (Remotion --codec=wav)")
    ap.add_argument("--video", required=True, help="the rendered MP4 (its video stream is copied)")
    ap.add_argument("--out", required=True, help="the delivered MP4")
    ap.add_argument("--wav-out", help="also write the mastered mix here (48 kHz, 24-bit)")
    ap.add_argument("--target", type=float, default=-14.0)
    ap.add_argument("--ceiling", type=float, default=-1.5, help="limiter ceiling before the codec (dBTP)")
    ap.add_argument("--delivery-ceiling", type=float, default=-1.0, help="true peak the delivered MP4 must stay under (dBTP)")
    ap.add_argument("--bitrate", default="320k")
    ap.add_argument("--report", help="write the JSON report here")
    a = ap.parse_args(argv)
    try:
        x, sr = sf.read(a.wav, always_2d=True, dtype="float64")
    except (RuntimeError, OSError) as e:
        print(f"master: cannot read {a.wav}: {e}", file=sys.stderr)
        return 2
    if sr != SR:
        print(f"master: {a.wav} is {sr} Hz, expected {SR}", file=sys.stderr)
        return 2
    x = x.T
    if x.shape[0] == 1:
        x = np.vstack([x, x]) * math.sqrt(0.5)
    ceiling = a.ceiling
    rounds = []
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        for _ in range(4):
            y, rep = master_audio(x, a.target, ceiling)
            wav = tmp / "mastered.wav"
            sf.write(str(wav), y.T, SR, subtype="PCM_24")
            remotion_ffmpeg(["-y", "-i", a.video, "-i", str(wav), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "libfdk_aac", "-b:a", a.bitrate,
                             "-cutoff", "18000", "-movflags", "+faststart", a.out])
            got = measure_mp4(Path(a.out), tmp)
            rounds.append({"master": rep, "delivered": got})
            over = got["truePeakDbtp"] - a.delivery_ceiling
            if over <= -0.05:
                break
            ceiling -= over + 0.1  # the codec overshot: aim the limiter lower and redo
        if a.wav_out:
            sf.write(a.wav_out, y.T, SR, subtype="PCM_24")
    final = rounds[-1]["delivered"]
    ok = abs(final["integratedLufs"] - a.target) <= 0.5 and final["truePeakDbtp"] <= a.delivery_ceiling
    report = {"target": {"integratedLufs": a.target, "deliveryCeilingDbtp": a.delivery_ceiling, "codec": f"libfdk_aac {a.bitrate}"}, "rounds": rounds, "ok": ok}
    if a.report:
        Path(a.report).write_text(json.dumps(report, indent=1) + "\n")
    m = rounds[-1]["master"]
    lim = m["limiter"]
    print(f"master: {m['inputIntegratedLufs']} LUFS / {m['inputTruePeakDbtp']} dBTP in -> gain {m['gainDb']:+.2f} dB, limiter max {lim.get('grMaxDb', 0)} dB "
          f"(>1 dB on {lim.get('grOver1dBPct', 0)}% of 10 ms blocks) -> {final['integratedLufs']} LUFS / {final['truePeakDbtp']} dBTP delivered ({'ok' if ok else 'OUT OF SPEC'})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
