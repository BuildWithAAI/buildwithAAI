"""WAV I/O, per-frame RMS and loudness normalization (ffmpeg two-pass loudnorm, EBU R128).

Target: -14 LUFS integrated, -1 dBTP true-peak ceiling (CLAUDE.md; YouTube publishes no official
target). Chain, measured on real Kokoro output (2026-11-24):
  1. pass 1: loudnorm measures the raw track.
  2. pre-limiter, only when a linear gain to -14 LUFS would push the true peak past the ceiling:
     Kokoro's raw narration sits near -25..-28 LUFS with an 18-20 dB crest factor, and loudnorm alone
     then falls back to its dynamic mode and plateaus 1.5-2.3 LU short (zh -16.2 LUFS even when
     asked for -9). A look-ahead limiter (alimiter, latency-compensated, -2 dBFS) with a gain solved
     toward the target shaves the peaks first. Its gain may exceed the linear-safe gain by at most
     LIMITER_BUDGET_DB (6 dB), so it never takes more than about 6 dB off a peak (measured: p99
     4.4-5.4 dB per 10 ms frame, 0% of frames over 6 dB on en, pt-br and zh).
  3. pass 2: loudnorm with the measured values and linear=true; when the peaks still do not allow a
     linear gain, ffmpeg uses its dynamic mode, and the target is re-aimed by a secant step on the
     measured error (at most twice).
  4. a final measurement goes into timeline.loudness; build.py warns when it is more than 1 LU off.
The limiter aims at -1.2 dBTP inside loudnorm so resampling to 24 kHz cannot creep over -1.0.
loudnorm works at 192 kHz internally; output is resampled to 24 kHz. The whole chain was verified to
keep the exact sample count and alignment (a click at sample n stays at sample n), so per-scene cuts
stay sample-exact.
"""

import json
import os
import re
import shutil
import subprocess

TARGET_I = -14.0
TARGET_TP = -1.0  # the ceiling recorded and checked
LIMIT_TP = -1.2  # what loudnorm is asked for: 0.2 dB of room for overs from resampling
TARGET_LRA = 20.0  # permissive, so the linear mode is used whenever the true peak allows it
TOLERANCE_LU = 0.3
MAX_CORRECTIONS = 2
LIMITER_CEILING_DB = -2.0  # sample peak out of the pre-limiter
LIMITER_BUDGET_DB = 6.0  # most gain the pre-limiter may add beyond the linear-safe gain
WARN_LU = 1.0


def need_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg not found on PATH (needed for loudness normalization)")
    return exe


def frame_rms(samples, sample_rate: int, fps: int) -> list[float]:
    """RMS of each video frame's window of samples (numpy array in, list out)."""
    import numpy as np

    per = sample_rate // fps
    n = len(samples) // per
    if n == 0:
        return []
    block = np.asarray(samples[: n * per], dtype=np.float64).reshape(n, per)
    return [float(v) for v in np.sqrt((block**2).mean(axis=1))]


def hop_db(samples, sample_rate: int, hop_s: float) -> list[float]:
    """RMS in dB of consecutive `hop_s` windows (the energy envelope visemes.refine snaps phrase edges to)."""
    import numpy as np

    per = max(1, int(round(sample_rate * hop_s)))
    n = len(samples) // per
    if n == 0:
        return []
    block = np.asarray(samples[: n * per], dtype=np.float64).reshape(n, per)
    rms = np.sqrt((block**2).mean(axis=1))
    return [float(v) for v in 20 * np.log10(np.maximum(rms, 1e-9))]


def to_db(values) -> list[float]:
    import math

    return [20 * math.log10(v) if v > 1e-9 else -180.0 for v in values]


def write_wav(path: str, samples, sample_rate: int, subtype: str = "PCM_16") -> None:
    import soundfile as sf

    sf.write(path, samples, sample_rate, subtype=subtype)


def read_wav(path: str):
    import soundfile as sf

    data, sr = sf.read(path, dtype="float32", always_2d=False)
    return data, sr


def _loudnorm_json(stderr: str) -> dict:
    blocks = re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", stderr)
    if not blocks:
        raise RuntimeError("ffmpeg loudnorm printed no measurement:\n" + stderr[-2000:])
    return json.loads(blocks[-1])


def _ffmpeg(args: list[str]) -> subprocess.CompletedProcess:
    proc = subprocess.run([need_ffmpeg(), "-hide_banner", "-nostats", "-nostdin", "-y", *args], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed ({' '.join(args[:6])} ...):\n{proc.stderr[-2000:]}")
    return proc


def measure(path: str) -> dict:
    """EBU R128 measurement via loudnorm: {'input_i', 'input_tp', 'input_lra', 'input_thresh', ...} as strings."""
    proc = _ffmpeg(["-i", path, "-af", f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json", "-f", "null", "-"])
    return _loudnorm_json(proc.stderr)


def prelimit(src: str, dst: str, first: dict) -> dict | None:
    """Gain + look-ahead limiter when linear normalization is impossible. None when it is not needed."""
    safe = LIMIT_TP - float(first["input_tp"])  # the gain that puts the true peak at LIMIT_TP
    need = TARGET_I - float(first["input_i"])
    if need <= safe:
        return None
    cap = safe + LIMITER_BUDGET_DB
    gain = min(need, cap)
    steps = []
    for _ in range(3):
        af = f"volume={gain:.3f}dB,alimiter=limit={10 ** (LIMITER_CEILING_DB / 20):.5f}:attack=4:release=60:level=0:latency=1"
        _ffmpeg(["-i", src, "-af", af, "-c:a", "pcm_f32le", dst])
        got = measure(dst)
        steps.append({"gainDb": round(gain, 2), "lufs": float(got["input_i"]), "truePeakDb": float(got["input_tp"])})
        deficit = TARGET_I - float(got["input_i"])
        if deficit <= 0.2 or gain >= cap - 1e-6:
            break
        gain = min(cap, gain + deficit / 0.7)  # the limiter eats part of every extra dB
    return {"safeGainDb": round(safe, 2), "budgetDb": LIMITER_BUDGET_DB, "ceilingDb": LIMITER_CEILING_DB, "steps": steps}


def loudnorm(src: str, dst: str, sample_rate: int) -> dict:
    """Pre-limiter (when needed) + two-pass loudnorm src -> dst (PCM 16-bit, `sample_rate`)."""
    first = measure(src)
    if first["input_i"] in ("-inf", "inf") or float(first["input_i"]) < -70:
        # silence: nothing to normalize
        shutil.copyfile(src, dst)
        return {"pass1": first, "type": "silent", "result": first, "targets": [], "limiter": None}
    limited = dst + ".limited.wav"
    limiter = prelimit(src, limited, first)
    if limiter:
        src = limited
        first = measure(src)
    try:
        out = _two_pass(src, dst, sample_rate, first)
    finally:
        if limiter and os.path.exists(limited):
            os.remove(limited)
    out["limiter"] = limiter
    return out


def _two_pass(src: str, dst: str, sample_rate: int, first: dict) -> dict:
    target = TARGET_I
    tried: list[tuple[float, float]] = []  # (loudnorm target, measured result)
    for _ in range(1 + MAX_CORRECTIONS):
        af = (
            f"loudnorm=I={target:.2f}:TP={LIMIT_TP}:LRA={TARGET_LRA}"
            f":measured_I={first['input_i']}:measured_TP={first['input_tp']}"
            f":measured_LRA={first['input_lra']}:measured_thresh={first['input_thresh']}"
            f":offset={first['target_offset']}:linear=true:print_format=json"
        )
        proc = _ffmpeg(["-i", src, "-af", af, "-ar", str(sample_rate), "-ac", "1", "-c:a", "pcm_s16le", dst])
        second = _loudnorm_json(proc.stderr)
        result = measure(dst)
        got = float(result["input_i"])
        tried.append((round(target, 2), got))
        if abs(TARGET_I - got) <= TOLERANCE_LU:
            break
        target = next_target(tried)
    return {"pass1": first, "pass2": second, "type": second.get("normalization_type", "?"), "result": result, "targets": [t for t, _ in tried]}


def next_target(tried: list[tuple[float, float]]) -> float:
    """Secant step on loudnorm's target: in dynamic mode the output moves less than the target
    (the limiter eats part of each extra LU), so plain error feedback converges slowly."""
    t2, r2 = tried[-1]
    slope = 1.0
    if len(tried) >= 2:
        t1, r1 = tried[-2]
        if abs(t2 - t1) > 1e-6 and (r2 - r1) / (t2 - t1) > 0.1:
            slope = (r2 - r1) / (t2 - t1)
    nxt = t2 + (TARGET_I - r2) / slope
    return max(TARGET_I - 6.0, min(TARGET_I + 5.0, nxt))
