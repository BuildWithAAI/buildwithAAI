"""WAV I/O, per-frame RMS and ffmpeg two-pass loudnorm (EBU R128).

Target: -14 LUFS integrated, -1 dBTP true-peak ceiling (CLAUDE.md; YouTube publishes no official
target). Pass 1 measures, pass 2 applies loudnorm with the measured values and linear=true. When the
gain needed would push the true peak over the ceiling, ffmpeg itself switches to its dynamic mode (a
look-ahead limiter), which can land a few tenths of a LU off on spiky TTS audio; then pass 2 is
repeated with the target shifted by the measured error (at most twice), which lands within 0.3 LU.
The limiter aims at -1.2 dBTP so that resampling back to 24 kHz cannot creep over -1.0. A final
measurement goes into timeline.loudness. loudnorm works at 192 kHz internally; the output is resampled to 24 kHz and was
verified to keep the exact sample count and alignment (a click at sample n stays at sample n), so
per-scene cuts stay sample-exact.
"""

import json
import re
import shutil
import subprocess

TARGET_I = -14.0
TARGET_TP = -1.0  # the ceiling recorded and checked
LIMIT_TP = -1.2  # what loudnorm is asked for: 0.2 dB of room for overs from resampling
TARGET_LRA = 20.0  # permissive, so the linear mode is used whenever the true peak allows it
TOLERANCE_LU = 0.3
MAX_CORRECTIONS = 2


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


def loudnorm(src: str, dst: str, sample_rate: int) -> dict:
    """Two-pass loudnorm src -> dst (PCM 16-bit, `sample_rate`). Returns pass-1, pass-2 and result data."""
    first = measure(src)
    if first["input_i"] in ("-inf", "inf") or float(first["input_i"]) < -70:
        # silence: nothing to normalize
        shutil.copyfile(src, dst)
        return {"pass1": first, "type": "silent", "result": first, "targets": []}
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
