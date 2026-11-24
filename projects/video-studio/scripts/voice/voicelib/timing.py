"""Scene timing and the fit-to-master speed maths (pure functions, unit-tested).

Scene length: durationMs = speechMs + tail padding (350 ms, 600 ms on the last scene), at least
minDurationSec, rounded UP to the grid where milliseconds and video frames are both whole numbers:
100 ms = 3 frames at 30 fps (= 2400 samples at 24 kHz). So startMs, durationMs and totalMs are
integers, frames = ms * fps / 1000 exactly, and Remotion's frame maths agree however they round.

Fit to master: each dubbed scene must fit the master scene's durationMs. Kokoro divides its predicted
phoneme durations by `speed`, while the pauses kokoro-onnx adds after punctuation do not scale, so
speech(speed) ~= a / speed + b. The next speed is a secant step in 1/speed, clamped to [0.85, 1.15].
"""

import math

SPEED_MIN = 0.85
SPEED_MAX = 1.15
DEFAULT_TAIL_MS = 350
DEFAULT_LAST_TAIL_MS = 600
FIT_MIN_TAIL_MS = 150  # in fit mode, at least this much air before the next scene
FIT_MAX_ITERS = 5


def grid(fps: int) -> tuple[int, int]:
    """(ms, frames) of the smallest step that is whole in both. 30 fps -> (100, 3); 25 fps -> (40, 1)."""
    g = math.gcd(1000, fps)
    return 1000 // g, fps // g


def quantize_up(ms: float, fps: int) -> int:
    step, _ = grid(fps)
    return int(math.ceil(ms / step - 1e-9)) * step


def scene_duration_ms(speech_ms: float, pad_ms: float, min_duration_sec: float | None, fps: int) -> int:
    raw = max(speech_ms + pad_ms, (min_duration_sec or 0.0) * 1000.0)
    return max(grid(fps)[0], quantize_up(raw, fps))


def frames(ms: int, fps: int) -> int:
    n = ms * fps / 1000
    if n != int(n):
        raise ValueError(f"{ms} ms is not a whole number of frames at {fps} fps")
    return int(n)


def starts(durations: list[int]) -> list[int]:
    out, t = [], 0
    for d in durations:
        out.append(t)
        t += d
    return out


def tail_for(index: int, count: int, tail_ms: float = DEFAULT_TAIL_MS, last_tail_ms: float = DEFAULT_LAST_TAIL_MS) -> float:
    return last_tail_ms if index == count - 1 else tail_ms


def clamp_speed(speed: float) -> float:
    return min(SPEED_MAX, max(SPEED_MIN, speed))


def fit_target_ms(master_speech_ms: float, master_duration_ms: float, min_tail_ms: float = FIT_MIN_TAIL_MS) -> float:
    """Aim for the master's speech length (keeps the pacing), never more than the room available."""
    room = master_duration_ms - min_tail_ms
    return max(1.0, min(master_speech_ms, room)) if master_speech_ms > 0 else max(1.0, room)


def next_speed(samples: list[tuple[float, float]], target_ms: float) -> float:
    """Next speed to try given [(speed, speech_ms), ...] so far."""
    s2, d2 = samples[-1]
    guess = s2 * d2 / target_ms  # speech ~ 1/speed
    if len(samples) >= 2:
        s1, d1 = samples[-2]
        x1, x2 = 1.0 / s1, 1.0 / s2
        if abs(x2 - x1) > 1e-9:
            a = (d2 - d1) / (x2 - x1)
            b = d2 - a * x2
            if a > 0:
                x = (target_ms - b) / a
                guess = 1.0 / x if x > 0 else SPEED_MAX
    return round(clamp_speed(guess), 3)


def overflow_ms(speech_ms: float, master_duration_ms: float, min_tail_ms: float = FIT_MIN_TAIL_MS) -> int:
    """How much too long the dubbed speech is for the master scene (0 if it fits)."""
    return max(0, math.ceil(speech_ms + min_tail_ms - master_duration_ms))


def choose_fit(samples: list[tuple[float, float]], target_ms: float, master_duration_ms: float, min_tail_ms: float = FIT_MIN_TAIL_MS) -> tuple[float, float]:
    """Best (speed, speech_ms): among takes that fit, the closest to the target; else the shortest."""
    fitting = [s for s in samples if s[1] + min_tail_ms <= master_duration_ms]
    if fitting:
        return min(fitting, key=lambda s: (abs(s[1] - target_ms), abs(s[0] - 1.0)))
    return min(samples, key=lambda s: s[1])


def close_tolerance(target_ms: float) -> float:
    return max(50.0, 0.02 * target_ms)


def close_enough(speech_ms: float, target_ms: float) -> bool:
    return abs(speech_ms - target_ms) <= close_tolerance(target_ms)
