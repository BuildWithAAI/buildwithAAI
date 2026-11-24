"""Deterministic take finishing (added 2026-11-24, VCD fix).

kokoro-onnx 0.6.1 is called with trim=False, sentence_pause=0 and clause_pause=0 (synth.py). Its own trim and pause
insertion measure the waveform, and Kokoro's waveform is noise-driven: the same phonemes, voice and speed gave
6339, 6329 and 6419 ms on three runs, and its pause insertion spliced digital zeros in where the audio was still at
about -38 dBFS, which ticks. Everything here uses the model's token durations instead, which do not depend on the
noise, so the same input always gives the same take length and the same timings:

  1. Timing lag: Kokoro's token edges run behind the sound. Cross-correlating each scene's token openness with its
     5 ms energy envelope peaks at -45 to -55 ms (mean -49 ms en, measured on 7 untrimmed demo takes; a review of 21
     trimmed takes measured -47 ms). Every timing moves TIMING_LAG_S earlier (clamped at 0).
  2. Leading pad: an untrimmed take starts with about 300 ms of the model's pad (near-silence). The take keeps
     LEAD_KEEP_S before its first token; the audible onset sits 30-50 ms before that token, so nothing is cut.
  3. Pauses: after a sentence mark (. ! ? …) with more speech after it, the silence is topped up to SENTENCE_PAUSE_S;
     after a clause mark (, ; :) the model rendered as a stop (a token of CLAUSE_MIN_MARK_S or more), to
     CLAUSE_PAUSE_S. These are kokoro-onnx's own defaults (0.25 s / 0.1 s). The existing gap is the mark token plus
     any untimed gap after it (a batch join), never a waveform measurement. The silence goes in at the quietest
     millisecond inside the mark token, so only that token stretches and every phone keeps its timing.
  4. Fades: FADE_S raised-cosine fades on both sides of every inserted silence and at both ends of the take, so no
     step into or out of digital silence is louder than -50 dBFS (tests/test_takes.py).
"""

import math

SENTENCE_MARKS = ".!?…"
CLAUSE_MARKS = ",;:"
TIMING_LAG_S = 0.047
LEAD_KEEP_S = 0.15
SENTENCE_PAUSE_S = 0.25
CLAUSE_PAUSE_S = 0.10
CLAUSE_MIN_MARK_S = 0.05
FADE_S = 0.005
END_FADE_S = 0.010
STEP_LIMIT_DBFS = -50.0  # the loudest allowed sample next to digital silence

Token = tuple[str, float, float]


def ramp(n: int) -> list[float]:
    """Raised-cosine fade-in gains for n samples, from just above 0 to just below 1."""
    return [0.5 - 0.5 * math.cos(math.pi * (k + 1) / (n + 1)) for k in range(n)]


def shift_timings(tokens: list[Token], seconds: float) -> list[Token]:
    """Move every timing by `seconds` (negative = earlier), clamped at 0."""
    return [(ch, max(0.0, a + seconds), max(0.0, b + seconds)) for ch, a, b in tokens]


def is_phone(ch: str) -> bool:
    return not ch.isspace() and ch not in SENTENCE_MARKS and ch not in CLAUSE_MARKS and ch not in "—“”\"()«»¡¿-"


def pause_plan(tokens: list[Token]) -> list[tuple[int, float]]:
    """[(token index of the mark, seconds of silence to add)], from token durations only (deterministic)."""
    plan: list[tuple[int, float]] = []
    for i, (ch, a, b) in enumerate(tokens):
        if ch not in SENTENCE_MARKS and ch not in CLAUSE_MARKS:
            continue
        if not any(is_phone(c) for c, _, _ in tokens[i + 1 :]):
            continue  # the last mark of a take: the scene tail follows
        nxt_start = next((x for _, x, _ in tokens[i + 1 :]), b)
        existing = max(0.0, nxt_start - a)  # the mark token plus any untimed gap (a batch join)
        if ch in SENTENCE_MARKS:
            target = SENTENCE_PAUSE_S
        elif b - a >= CLAUSE_MIN_MARK_S:
            target = CLAUSE_PAUSE_S
        else:
            continue  # the model ran through this comma: a gap cut into sound would be audible
        missing = target - existing
        if missing > 0.001:
            plan.append((i, missing))
    return plan


def finish(audio, tokens: list[Token], sample_rate: int):
    """An untrimmed, unpaused Kokoro take -> (audio float32 numpy array, tokens). See the module docstring."""
    import numpy as np

    x = np.asarray(audio, dtype=np.float32).copy()
    t = shift_timings(list(tokens), -TIMING_LAG_S)
    first = next((a for ch, a, _ in t if is_phone(ch)), None)
    if first is not None:
        cut = max(0, int(round((first - LEAD_KEEP_S) * sample_rate)))
        cut = min(cut, len(x))
        if cut:
            x = x[cut:]
            t = shift_timings(t, -cut / sample_rate)
    plan = pause_plan(t)
    if plan:
        parts = []
        moved: list[Token] = []
        cursor = 0  # samples of x already copied
        shift = 0.0
        fade = max(1, int(FADE_S * sample_rate))
        up = np.asarray(ramp(fade), dtype=np.float32)
        todo = dict(plan)
        for i, (ch, a, b) in enumerate(t):
            if i in todo:
                lo = int(math.floor(a * sample_rate))
                hi = max(lo + 1, int(math.ceil(b * sample_rate)))
                lo, hi = min(lo, len(x)), min(hi, len(x))
                at = lo
                if hi - lo > 1:  # the quietest millisecond inside the mark token
                    win = max(1, sample_rate // 1000)
                    best = None
                    for p in range(lo, hi, win):
                        e = float(np.abs(x[max(0, p - win // 2) : p + win // 2 + 1]).max(initial=0.0))
                        if best is None or e < best[0]:
                            best = (e, p)
                    at = best[1]
                at = max(at, cursor)
                seg = x[cursor:at].copy()
                k = min(fade, len(seg))
                if k:
                    seg[len(seg) - k :] *= up[::-1][fade - k :]
                parts.append(seg)
                parts.append(np.zeros(int(round(todo[i] * sample_rate)), dtype=np.float32))
                k2 = min(fade, len(x) - at)
                if k2:
                    x[at : at + k2] *= up[:k2]
                cursor = at
                # the mark token stretches over the silence; later tokens move
                moved.append((ch, a + shift, b + shift + todo[i]))
                shift += int(round(todo[i] * sample_rate)) / sample_rate
                continue
            moved.append((ch, a + shift, b + shift))
        parts.append(x[cursor:])
        x = np.concatenate(parts)
        t = moved
    # fades at both ends of the take
    n_in = min(len(x), max(1, int(FADE_S * sample_rate)))
    n_out = min(len(x), max(1, int(END_FADE_S * sample_rate)))
    if len(x):
        x[:n_in] *= np.asarray(ramp(n_in), dtype=np.float32)
        x[len(x) - n_out :] *= np.asarray(ramp(n_out)[::-1], dtype=np.float32)
    end = len(x) / sample_rate
    t = [(ch, min(a, end), min(b, end)) for ch, a, b in t]
    return x, t


def silence_edge_steps(samples, sample_rate: int, min_zero_s: float = 0.001) -> list[tuple[float, float]]:
    """[(time s, dBFS)] of the sample right next to every run of digital silence (exact zeros) of at least
    `min_zero_s`. A sound that stops dead into silence (or starts out of it) ticks; a faded edge is far below -50 dBFS."""
    import numpy as np

    x = np.asarray(samples, dtype=np.float64)
    zero = x == 0.0
    out: list[tuple[float, float]] = []
    n = len(x)
    min_run = max(1, int(min_zero_s * sample_rate))
    idx = np.flatnonzero(np.diff(np.concatenate([[0], zero.astype(np.int8), [0]])))
    for a, b in zip(idx[::2], idx[1::2]):
        if b - a < min_run:
            continue
        for edge in (a - 1, b):
            if 0 <= edge < n and x[edge] != 0.0:
                out.append((edge / sample_rate, 20 * math.log10(abs(float(x[edge])))))
    return out
