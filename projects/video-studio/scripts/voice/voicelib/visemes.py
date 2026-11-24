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
  0. snap to the audio (2026-11-24, VCD fix; needs the take's 5 ms energy envelope): Kokoro gives the last phone
     before punctuation 300-400 ms although the voice stops about 250 ms earlier, so the phrase-final phone ends
     where the energy falls more than VOICED_DB (28 dB) under the phrase peak; a space or pause token before a phone
     also carries that phone's onset, so the phone starts where the energy rises (at most ONSET_REACH_S earlier).
     The timings were already moved 47 ms earlier (takes.TIMING_LAG_S: Kokoro's edges lag the sound);
  1. sample each frame 1 frame AHEAD of the audio (the mouth leads the sound by 1 f);
  2. every mbp phone of 15 ms or more gets at least one frame (a /p/ is never dropped);
  3. RMS gate: a run of 4+ frames whose audio RMS is more than 32 dB below the scene's loudest frame
     counts as a pause even if a phone is nominally there ("closed in silence"). It was 40 dB, which never
     fired: the residual after a phrase sits 34-39 dB under the peak (the mouth stayed open 5-10 frames).
     mbp frames inside such a run stay when they are the last 4 frames before the next sound (LP3's press ahead of
     a phrase-initial m/b/p; rule 2 placed them); a press after a phrase's end still closes;
  4. pauses: under 4 f hold the previous shape, 4-10 f relax to slightlyOpen, 11 f or more close;
     before the first and after the last phone the mouth is closed;
  5. ah -> closed/mbp gets a slightlyOpen in-between where there is room;
  6. every shape is held at least 2 frames: a 1-frame shape merges into its longer neighbour, except
     mbp, which is extended instead, and a 1-frame opening right after a closed run (a phrase onset), which
     takes the closed frame before it: the mouth opens a frame early rather than a frame late (2026-11-24: a
     50 ms first phone, "a" or "l", was dropped and the es demo opened 1 frame after the voice).
  7. (pipeline, after loudness normalization) fit_landmarks: a phrase onset or end that the lip-sync check
     (sync_landmarks, on the normalized audio) finds outside its tolerance is moved onto LP3's target.
Ties: a frame window split evenly between a pause and a phone shows the phone. Every take's first phone starts
exactly LEAD_KEEP_S = 150 ms = 4.5 frames in, so this tie came up at every scene start and was settled by float
rounding.
Decision (recorded): LP3's in-between is "1 f", but LP3, the QA checklist (ART_GUIDE 10.8) and the
task all forbid 1-frame shapes, so the in-between is 2 frames and only inserted when both sides keep
2 or more. Rule 4 also refines the task's "pauses give closed": short pauses relax rather than snap.
"""

import math
from collections.abc import Sequence

SHAPES = ("closed", "slightlyOpen", "ah", "ee", "oh", "mbp")
SILENCE_DB = -32.0  # RMS gate (rule 3), relative to the scene's loudest frame
VOICED_DB = 28.0  # rule 0 and the sync check: within this many dB of the phrase peak counts as voiced
HOP_S = 0.005  # energy envelope hop for rule 0
MIN_PHONE_S = 0.03  # a phrase-final phone keeps at least this much
END_PAD_S = 0.015  # a phrase-final phone ends this long after its last voiced hop (half a frame: frame RMS lags hops)
ONSET_REACH_S = 0.12  # how far back a phone may start to meet its onset
MBP_LEAD_MAX = 4  # LP3: mbp starts 1-4 frames before the release; the RMS gate keeps a press that close to a phrase
PHRASE_MARKS = frozenset(',.!?;:—…“”"()«»¡¿')  # punctuation ends a phrase; a space does not
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


def phrase_spans(tokens: Sequence[tuple[str, float, float]]) -> list[tuple[float, float]]:
    """(start s, end s) of every phrase: the tokens between punctuation marks (spaces join words inside a phrase)."""
    spans: list[tuple[float, float]] = []
    cur: list[float] | None = None
    for ch, a, b in tokens:
        if ch in PHRASE_MARKS:
            if cur:
                spans.append((cur[0], cur[1]))
            cur = None
            continue
        if ch.isspace():
            continue
        if cur is None:
            cur = [min(a, b), max(a, b)]
        else:
            cur[1] = max(cur[1], a, b)
    if cur:
        spans.append((cur[0], cur[1]))
    return spans


def refine(ivs: Sequence[Interval], spans: Sequence[tuple[float, float]], env_db: Sequence[float] | None, hop_s: float = HOP_S, voiced_db: float = VOICED_DB) -> list[Interval]:
    """Rule 0: snap phrase-final phone ends and phone onsets to the take's energy envelope (dB per `hop_s`).

    Pauses are rebuilt as the gaps between phones, so a trimmed phone leaves a pause behind it."""
    phones = sorted(([a, b, s] for a, b, s in ivs if s != PAUSE), key=lambda x: (x[0], x[1]))
    if not env_db or not phones:
        return list(ivs)
    n = len(env_db)

    def hop(t: float) -> int:
        return min(n, max(0, int(t / hop_s)))

    def hop_up(t: float) -> int:
        return min(n, max(0, int(math.ceil(t / hop_s - 1e-9))))

    def threshold(a: float, b: float) -> float | None:
        lo, hi = hop(a), max(hop(a) + 1, hop_up(b))
        seg = env_db[lo:hi]
        return (max(seg) - voiced_db) if seg else None

    phrase_thr = [(a, b, threshold(a, b)) for a, b in spans]

    def thr_at(t: float) -> float | None:
        for a, b, th in phrase_thr:
            if a - 1e-9 <= t <= b + 1e-9:
                return th
        return None

    # phrase ends: the last phone of each phrase stops where the voice does
    for a, b, th in phrase_thr:
        if th is None:
            continue
        inside = [p for p in phones if p[0] < b - 1e-9 and p[1] > a + 1e-9]
        if not inside:
            continue
        last = max(inside, key=lambda p: p[1])
        s0, e0 = last[0], last[1]
        voiced = [h for h in range(hop(s0), hop_up(e0)) if env_db[h] > th]
        end = (voiced[-1] + 1) * hop_s + END_PAD_S if voiced else s0
        end = max(end, s0 + min(MIN_PHONE_S, e0 - s0))
        if end < e0:
            last[1] = end
    # onsets: a phone after a pause starts where its sound starts (the space or mark token carried it)
    prev_end = 0.0
    for p in phones:
        s0 = p[0]
        if s0 - prev_end > hop_s:
            th = thr_at(s0)
            if th is not None:
                lo = max(prev_end, s0 - ONSET_REACH_S)
                for h in range(hop_up(lo), hop(s0)):
                    if env_db[h] > th and (h + 1 >= n or env_db[h + 1] > th):
                        p[0] = max(lo, h * hop_s)
                        break
        prev_end = max(prev_end, p[1])
    # pauses fill every gap, before the first phone and after the last too, so a frame that only grazes a phone
    # still shows the pause (raw_frames takes the shape with the largest overlap)
    out: list[Interval] = []
    t = 0.0
    for a, b, s in phones:
        if a > t + 1e-9:
            out.append((t, a, PAUSE))
        out.append((a, b, s))
        t = max(t, b)
    out.append((t, t + 3600.0, PAUSE))
    return out


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
            # overlaps equal to the microsecond are a tie, and a tie shows the phone (see the module docstring)
            best = max(overlap.items(), key=lambda kv: (round(kv[1] * 1e6), kv[0] != PAUSE))
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


def apply_rms_gate(track: list[str], rms: Sequence[float] | None, lead_frames: int = 1, silence_db: float = SILENCE_DB, min_run: int = 4) -> list[str]:
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
                # pressed lips just before a phrase are LP3's lead before m/b/p (1-4 frames ahead of the release), not
                # an open mouth: rule 2 placed them, so they stay (2026-11-24, final check: a fresh en build lost the
                # mbp of a phrase-initial "Most"). A press left over after a phrase ("subscribe.") still closes.
                if not (out[k] == "mbp" and g < len(out) and g - k <= MBP_LEAD_MAX):
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
        if shape != "closed" and left and left[0] == "closed" and left[2] - left[1] > min_hold:
            # a phrase onset: open one frame early (LP3 leads the sound) instead of dropping the opening
            out[a - 1] = shape
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
    silence_db: float = SILENCE_DB,
    env_db: Sequence[float] | None = None,
    hop_s: float = HOP_S,
) -> list[str]:
    """The full LP3 pipeline. `tokens` are scene-relative seconds; `rms` is one value per video frame; `env_db` is the
    take's energy envelope in dB, one value per `hop_s` (rule 0; without it the token timings are used as they are)."""
    if n_frames <= 0:
        return []
    ivs = intervals(tokens, lang)
    if env_db:
        ivs = refine(ivs, phrase_spans(tokens), env_db, hop_s)
    track = raw_frames(ivs, n_frames, fps, lead_frames)
    track = apply_rms_gate(track, rms, lead_frames, silence_db)
    track = resolve_pauses(track)
    track = add_tweens(track)
    track = enforce_min_hold(track)
    return track


def changes_per_second(track: Sequence[str], fps: int = 30) -> float:
    if len(track) < 2:
        return 0.0
    return sum(1 for a, b in zip(track, track[1:]) if a != b) / (len(track) / fps)


def voiced_phrases(frame_db: Sequence[float], voiced_db: float = VOICED_DB) -> list[list[int]]:
    """[start, end) frame spans of the audio's phrases: frames within `voiced_db` of the loudest frame, joined across
    gaps under 4 frames. Shared by sync_landmarks (the check) and fit_landmarks (rule 7), so both see the same phrases."""
    n = len(frame_db)
    if not n:
        return []
    peak = max(frame_db)
    voiced = [v > peak - voiced_db for v in frame_db]
    ph: list[list[int]] = []
    f = 0
    while f < n:
        if not voiced[f]:
            f += 1
            continue
        g = f
        while g < n and voiced[g]:
            g += 1
        if ph and f - ph[-1][1] < 4:
            ph[-1][1] = g
        else:
            ph.append([f, g])
        f = g
    return ph


def _onset(track: Sequence[str], a: int, n: int) -> int | None:
    """First non-closed frame around a phrase onset at frame a, if the mouth was closed before it (else None)."""
    if not all(m == "closed" for m in track[max(0, a - 6) : max(0, a - 3)]):
        return None
    return next((i for i in range(max(0, a - 6), min(n, a + 10)) if track[i] != "closed"), None)


def _close_start(track: Sequence[str], b: int, nxt: int, n: int) -> int | None:
    """First frame of the first 3-frame closed run after a phrase ending at frame b (the next phrase starts at nxt)."""
    return next((i for i in range(max(0, b - 8), min(n, nxt)) if all(m == "closed" for m in track[i : min(n, i + 3)])), None)


def sync_landmarks(track: Sequence[str], frame_db: Sequence[float], voiced_db: float = VOICED_DB) -> dict:
    """Phrase-level lip-sync check against the audio (frame_db: each video frame's RMS in dB).

    Voiced = within `voiced_db` of the scene's loudest frame; phrases are voiced runs, bridging gaps under 4 frames.
    onsets: mouth-open frame minus audio-onset frame, for phrases the mouth was closed before (LP3 wants -1).
    mbpOnsets: the same for phrases that start with m/b/p: the lips press (mbp) before the sound, and LP3 starts mbp
    1-4 frames before the release, so these are kept apart (the review's landmarks.py counted them as onsets).
    offsets: last open frame minus last voiced frame, for phrases followed by 11+ quiet frames (the mouth must close).
    The same measure the 2026-11-24 review used (review-audio/landmarks.py)."""
    n = min(len(track), len(frame_db))
    out: dict = {"onsets": [], "mbpOnsets": [], "offsets": []}
    if not n:
        return out
    ph = voiced_phrases(frame_db[:n], voiced_db)
    for k, (a, b) in enumerate(ph):
        mo = _onset(track, a, n)
        if mo is not None:
            out["mbpOnsets" if track[mo] == "mbp" else "onsets"].append(mo - a)
        nxt = ph[k + 1][0] if k + 1 < len(ph) else n
        if nxt - b >= 11:
            mc = _close_start(track, b, nxt, n)
            if mc is not None:
                out["offsets"].append((mc - 1) - (b - 1))
    return out


def fit_landmarks(
    track: Sequence[str],
    frame_db: Sequence[float],
    voiced_db: float = VOICED_DB,
    onset_range: tuple[int, int] = (-2, 0),
    mbp_onset_range: tuple[int, int] = (-4, 0),
    offset_tol: int = 2,
) -> list[str]:
    """Rule 7: move every phrase onset and end that sync_landmarks finds outside its tolerance onto LP3's target,
    measured on `frame_db` (the build passes the normalized audio the viewer hears). Onsets and ends inside the
    tolerance are left alone, so a track that already passes comes back unchanged.

    Why (2026-11-24, final check): Kokoro's ONNX graph samples noise (RandomNormalLike, RandomUniformLike), so two
    builds of the same text give the same lengths and word timings but not the same samples. Rules 0 and 3 judge
    quiet frames on the raw take against the phrase peak; the check judges the normalized audio against the scene
    peak. A fresh es build opened the mouth 3 frames before a phrase (allowed -2..0) where the previous build had -1.
      - an onset too early: the frames before the target turn closed (target: 1 frame ahead, LP3; mbp: 2 frames).
        Like the check, only onsets the mouth was closed 4-6 frames before are judged, so the earliest is -3;
      - an onset too late: the first shape starts 1 frame ahead of the sound;
      - a mouth still open more than `offset_tol` frames after a phrase's last voiced frame closes right after it
        (keeping that last shape 2 frames); one that closes more than `offset_tol` frames early holds its last shape
        until 1 frame before the end.
    No 1-frame shape is created: a 1-frame remnant at an onset takes the next shape."""
    out = list(track)
    n = min(len(out), len(frame_db))
    if not n:
        return out
    ph = voiced_phrases(frame_db[:n], voiced_db)
    for _ in range(4):  # each pass fixes what it finds; a fix may only reveal a later landmark
        changed = False
        for k, (a, b) in enumerate(ph):
            mo = _onset(out, a, n)
            if mo is not None:
                is_mbp = out[mo] == "mbp"
                lo, hi = mbp_onset_range if is_mbp else onset_range
                if mo - a < lo:
                    target = max(0, a - (2 if is_mbp else 1))
                    for i in range(mo, target):
                        out[i] = "closed"
                    end = target
                    while end < n and out[end] == out[target]:
                        end += 1
                    if end - target == 1 and end < n and out[end] != "closed":
                        out[target] = out[end]
                    changed = True
                elif mo - a > hi:
                    for i in range(max(0, a - 1), mo):
                        out[i] = out[mo]
                    changed = True
            nxt = ph[k + 1][0] if k + 1 < len(ph) else n
            if nxt - b < 11 or b < 1:
                continue
            mc = _close_start(out, b, nxt, n)
            if mc is None:
                continue
            if mc - b > offset_tol:
                start = b - 1
                while start > 0 and out[start - 1] == out[b - 1]:
                    start -= 1
                for i in range(max(b, start + 2), mc):
                    out[i] = "closed"
                changed = True
            elif mc - b < -offset_tol and mc > 0:
                last = out[mc - 1] if out[mc - 1] != "closed" else "slightlyOpen"
                for i in range(mc, b - 1):
                    out[i] = last
                changed = True
        if not changed:
            break
    if any(r[2] - r[1] < 2 for r in _runs(out)) and not any(r[2] - r[1] < 2 for r in _runs(track)):
        out = enforce_min_hold(out)  # a guard: the moves above are built not to leave 1-frame shapes
    return out
