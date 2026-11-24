"""Kokoro IPA phonemes -> ZOO's mouth library, one MouthShape per video frame.

Mapping (docs/ART_GUIDE.md LP2, binding; per-language overrides below):
  p b m                          mbp
  w u ʊ o ɔ ɚ ɜ (rounded)        oh
  ɑ a æ ʌ ɛ (open)               ah
  i ɪ e j (front/close)          ee
  every other phone              slightlyOpen
  space and punctuation          pause (see LP3 below)
Fold ː ʰ ʲ ̃ ᵝ and tone arrows into the previous phone, ˈ ˌ into the next. Diphthongs are two phones
(aɪ = ah, ee), which Kokoro's per-character tokens give automatically.

Track rules (LP3, binding), in this order:
  1. sample each frame 1 frame AHEAD of the audio (the mouth leads the sound by 1 f);
  2. every mbp phone of 15 ms or more gets at least one frame (a /p/ is never dropped);
  3. RMS gate: a run of 4+ frames whose audio RMS is more than 40 dB below the scene's loudest frame
     counts as a pause even if a phone is nominally there ("closed in silence");
  4. pauses: under 4 f hold the previous shape, 4-10 f relax to slightlyOpen, 11 f or more close;
     before the first and after the last phone the mouth is closed;
  5. ah -> closed/mbp gets a slightlyOpen in-between where there is room;
  6. every shape is held at least 2 frames: a 1-frame shape merges into its longer neighbour, except
     mbp, which is extended instead.
Decision (recorded): LP3's in-between is "1 f", but LP3, the QA checklist (ART_GUIDE 10.8) and the
task all forbid 1-frame shapes, so the in-between is 2 frames and only inserted when both sides keep
2 or more. Rule 4 also refines the task's "pauses give closed": short pauses relax rather than snap.
"""

import math
from collections.abc import Sequence

SHAPES = ("closed", "slightlyOpen", "ah", "ee", "oh", "mbp")
PAUSE = "pause"
FOLD_PREV = "fold_prev"
FOLD_NEXT = "fold_next"

PAUSE_CHARS = frozenset(' !"(),.:;?—“”…¡¿«»-')
BASE: dict[str, object] = {}
for ch in "pbm":
    BASE[ch] = "mbp"
for ch in "wuʊoɔɚɜɒøœyɥɵʉ":
    BASE[ch] = "oh"
for ch in "ɑaæʌɛɶ":
    BASE[ch] = "ah"
for ch in "iɪejɨᵻ":
    BASE[ch] = "ee"
for ch in "ːʰʲ̃ᵝ→↓↗↘":
    BASE[ch] = FOLD_PREV
for ch in "ˈˌʔ":
    BASE[ch] = FOLD_NEXT  # a glottal stop / Japanese sokuon takes the shape of what follows
# misaki's English diphthong letters (not produced by the espeak path, mapped for completeness)
BASE.update({"A": "ee", "I": ("ah", "ee"), "O": "oh", "W": ("ah", "oh"), "Y": ("oh", "ee"), "Q": ("slightlyOpen", "oh")})

OVERRIDES: dict[str, dict[str, object]] = {
    "en": {},
    # Spanish/Italian β is a lenited b/v: the lips nearly meet.
    "es": {"β": "mbp"},
    "it": {"β": "mbp"},
    # espeak pt-br writes unstressed final -e as 'y' and stressed open vowels with ɐ.
    "pt-br": {"β": "mbp", "y": "ee", "ɐ": "ah"},
    # Hindi's inherent vowel (espeak ə/ɐ) is a full open-mid vowel, not an English reduced schwa.
    "hi": {"ə": "ah", "ɐ": "ah"},
    # misaki zh: ɤ (的/了/格) is half-open; ɨ (是/四) spread.
    "zh": {"ɤ": "slightlyOpen", "ɨ": "ee"},
    # misaki ja: ɯ (う) and β (わ) are compressed, ɸ (ふ) is a near-closed bilabial: all read as oh.
    "ja": {"ɯ": "oh", "β": "oh", "ɸ": "oh", "ɴ": "slightlyOpen"},
}


def classify(ch: str, lang: str = "en") -> object:
    """A shape, a tuple of shapes (split evenly), PAUSE, FOLD_PREV or FOLD_NEXT."""
    if ch in PAUSE_CHARS or ch.isspace():
        return PAUSE
    table = OVERRIDES.get(lang, {})
    if ch in table:
        return table[ch]
    return BASE.get(ch, "slightlyOpen")


Interval = tuple[float, float, str]  # start s, end s, shape or PAUSE


def intervals(tokens: Sequence[tuple[str, float, float]], lang: str = "en") -> list[Interval]:
    """(phoneme char, start s, end s) per Kokoro token -> shape intervals with folds applied."""
    out: list[list] = []
    pending_start: float | None = None
    for ch, start, end in tokens:
        if end < start:
            start, end = end, start
        kind = classify(ch, lang)
        if kind == FOLD_PREV:
            if out and out[-1][2] != PAUSE:
                out[-1][1] = max(out[-1][1], end)
            continue
        if kind == FOLD_NEXT:
            pending_start = start if pending_start is None else pending_start
            continue
        if kind == PAUSE:
            pending_start = None
            out.append([start, end, PAUSE])
            continue
        if pending_start is not None:
            start = min(start, pending_start)
            pending_start = None
        if isinstance(kind, tuple):
            step = (end - start) / len(kind)
            for k, shape in enumerate(kind):
                out.append([start + k * step, start + (k + 1) * step, shape])
        else:
            out.append([start, end, kind])
    return [(a, b, s) for a, b, s in out if b > a or s != PAUSE]


def _runs(track: Sequence[str]) -> list[list]:
    runs: list[list] = []
    for i, s in enumerate(track):
        if runs and runs[-1][0] == s:
            runs[-1][2] = i + 1
        else:
            runs.append([s, i, i + 1])
    return runs


def _expand(runs: list[list], n: int) -> list[str]:
    out = [""] * n
    for s, a, b in runs:
        for i in range(a, b):
            out[i] = s
    return out


def raw_frames(ivs: Sequence[Interval], n_frames: int, fps: int, lead_frames: int = 1) -> list[str]:
    """Shape (or PAUSE) with the largest overlap in each frame window, sampled `lead_frames` ahead."""
    frame_s = 1.0 / fps
    track = [PAUSE] * n_frames
    sorted_ivs = sorted(ivs, key=lambda x: x[0])
    j0 = 0
    for f in range(n_frames):
        a = (f + lead_frames) * frame_s
        b = a + frame_s
        while j0 < len(sorted_ivs) and sorted_ivs[j0][1] <= a:
            j0 += 1
        overlap: dict[str, float] = {}
        j = j0
        while j < len(sorted_ivs) and sorted_ivs[j][0] < b:
            s0, s1, shape = sorted_ivs[j]
            o = min(b, s1) - max(a, s0)
            if o > 0:
                overlap[shape] = overlap.get(shape, 0.0) + o
            j += 1
        if overlap:
            best = max(overlap.items(), key=lambda kv: (kv[1], kv[0] != PAUSE))
            track[f] = best[0]
    # every mbp of 15 ms+ gets a frame
    for s0, s1, shape in sorted_ivs:
        if shape != "mbp" or s1 - s0 < 0.015:
            continue
        lo = max(0, math.floor(s0 * fps) - lead_frames)
        hi = min(n_frames - 1, math.ceil(s1 * fps) - lead_frames)
        frames = range(lo, hi + 1)
        if any(track[f] == "mbp" for f in frames):
            continue
        best_f, best_o = None, 0.0
        for f in frames:
            a = (f + lead_frames) * frame_s
            o = min(a + frame_s, s1) - max(a, s0)
            if o > best_o:
                best_f, best_o = f, o
        if best_f is not None:
            track[best_f] = "mbp"
    return track


def apply_rms_gate(track: list[str], rms: Sequence[float] | None, lead_frames: int = 1, silence_db: float = -40.0, min_run: int = 4) -> list[str]:
    if not rms:
        return track
    peak = max(rms) if rms else 0.0
    if peak <= 0:
        return [PAUSE] * len(track)
    thresh = peak * 10 ** (silence_db / 20)
    quiet = [(rms[f + lead_frames] if f + lead_frames < len(rms) else 0.0) <= thresh for f in range(len(track))]
    out = list(track)
    f = 0
    while f < len(out):
        if not quiet[f]:
            f += 1
            continue
        g = f
        while g < len(out) and quiet[g]:
            g += 1
        if g - f >= min_run:
            for k in range(f, g):
                out[k] = PAUSE
        f = g
    return out


def resolve_pauses(track: list[str]) -> list[str]:
    runs = _runs(track)
    phones = [k for k, r in enumerate(runs) if r[0] != PAUSE]
    if not phones:
        return ["closed"] * len(track)
    first, last = phones[0], phones[-1]
    for k, r in enumerate(runs):
        if r[0] != PAUSE:
            continue
        length = r[2] - r[1]
        if k < first or k > last:
            r[0] = "closed"
        elif length < 4:
            r[0] = runs[k - 1][0]
        elif length <= 10:
            r[0] = "slightlyOpen"
        else:
            r[0] = "closed"
    return _expand(runs, len(track))


def add_tweens(track: list[str]) -> list[str]:
    """ah -> closed/mbp: 2 frames of slightlyOpen where both sides keep 2+ frames."""
    runs = _runs(track)
    k = 0
    while k < len(runs) - 1:
        cur, nxt = runs[k], runs[k + 1]
        if cur[0] == "ah" and nxt[0] in ("closed", "mbp"):
            if nxt[0] == "closed" and nxt[2] - nxt[1] >= 4:
                runs.insert(k + 1, ["slightlyOpen", nxt[1], nxt[1] + 2])
                nxt[1] += 2
                k += 1
            elif cur[2] - cur[1] >= 4:
                runs.insert(k + 1, ["slightlyOpen", cur[2] - 2, cur[2]])
                cur[2] -= 2
                k += 1
        k += 1
    return _expand(runs, len(track))


def enforce_min_hold(track: list[str], min_hold: int = 2) -> list[str]:
    out = list(track)
    for _ in range(4 * len(out) + 4):
        runs = _runs(out)
        short = [k for k, r in enumerate(runs) if r[2] - r[1] < min_hold]
        if not short or len(runs) == 1:
            break
        k = short[0]
        shape, a, b = runs[k]
        left = runs[k - 1] if k > 0 else None
        right = runs[k + 1] if k + 1 < len(runs) else None
        if shape == "mbp":
            # extend into the longer neighbour (it keeps its own 2 frames if it can)
            donor = max((r for r in (left, right) if r), key=lambda r: r[2] - r[1])
            f = a - 1 if donor is left else b
            out[f] = "mbp"
            continue
        target = max((r for r in (left, right) if r), key=lambda r: r[2] - r[1])
        for f in range(a, b):
            out[f] = target[0]
    return out


def mouth_track(
    tokens: Sequence[tuple[str, float, float]],
    n_frames: int,
    fps: int = 30,
    rms: Sequence[float] | None = None,
    lang: str = "en",
    lead_frames: int = 1,
    silence_db: float = -40.0,
) -> list[str]:
    """The full LP3 pipeline. `tokens` are scene-relative seconds; `rms` is one value per video frame."""
    if n_frames <= 0:
        return []
    track = raw_frames(intervals(tokens, lang), n_frames, fps, lead_frames)
    track = apply_rms_gate(track, rms, lead_frames, silence_db)
    track = resolve_pauses(track)
    track = add_tweens(track)
    track = enforce_min_hold(track)
    return track


def changes_per_second(track: Sequence[str], fps: int = 30) -> float:
    if len(track) < 2:
        return 0.0
    return sum(1 for a, b in zip(track, track[1:]) if a != b) / (len(track) / fps)
