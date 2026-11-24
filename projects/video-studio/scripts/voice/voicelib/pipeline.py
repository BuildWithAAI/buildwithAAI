"""The voice build: storyboard -> per-scene Kokoro takes -> narration.wav + timeline.json.

Outputs in public/generated/<channel>/<slug>/<lang>/:
  narration.wav     one continuous mono 24 kHz PCM-16 track, two-pass loudnorm -14 LUFS / -1 dBTP
  scenes/<id>.wav   each scene cut sample-exactly from narration.wav (TimelineScene.audio points here)
  timeline.json     the Timeline contract (src/episode/types.ts) + the recorded optional additions
  phonemes.json     debug: spoken text, phonemes, alignment method and speed per scene
"""

import json
import math
import os
import re
import shutil
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from . import audio, markup, schema, takes, timing, visemes
from . import g2p as g2p_mod
from .langs import spec
from .synth import MODEL_FILE, SAMPLE_RATE, Synth, Take, char_times
from .words import Word, build_words

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
# Lip-sync check on every built scene (visemes.sync_landmarks): the mouth closes within 2 frames of a phrase's last
# voiced frame and opens 0-2 frames before its first (LP3: 1 frame ahead). Outside that, the build warns.
SYNC_OFFSET_TOL = 2
SYNC_ONSET_RANGE = (-2, 0)
SYNC_MBP_ONSET_RANGE = (-4, 0)  # LP3: start mbp 1-4 frames before the plosive release


@dataclass
class Options:
    content_dir: str
    lang: str
    fit_to: str | None = None
    voice: str | None = None
    speed: float = 1.0
    out_root: str | None = None  # default <project>/public
    model_dir: str | None = None  # default <project>/.cache/kokoro
    fps: int = 30
    tail_ms: float = timing.DEFAULT_TAIL_MS
    last_tail_ms: float = timing.DEFAULT_LAST_TAIL_MS
    fit_min_tail_ms: float = timing.FIT_MIN_TAIL_MS
    lead_frames: int = 1
    log: Callable[[str], None] = print


@dataclass
class Result:
    timeline: dict
    out_dir: str
    warnings: list[str]
    overflow: bool
    seconds: float
    debug: dict = field(default_factory=dict)


class BuildError(Exception):
    pass


def storyboard_path(content_dir: str, lang: str) -> str:
    candidate = os.path.join(content_dir, f"storyboard.{lang}.json")
    if os.path.isfile(candidate):
        return candidate
    base = os.path.join(content_dir, "storyboard.json")
    if os.path.isfile(base):
        with open(base, encoding="utf-8") as fh:
            base_lang = json.load(fh).get("lang")
        if base_lang == lang:
            return base
        raise BuildError(f"{base} is lang {base_lang!r}; the {lang} translation belongs in storyboard.{lang}.json")
    raise BuildError(f"no storyboard for {lang} in {content_dir} (storyboard.json or storyboard.{lang}.json)")


def load_storyboard(path: str, lang: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        sb = json.load(fh)
    problems = []
    if sb.get("version") != 1:
        problems.append("version must be 1")
    for k in ("channel", "slug"):
        if not isinstance(sb.get(k), str) or not sb.get(k):
            problems.append(f"{k} must be a non-empty string")
    if sb.get("lang") != lang:
        problems.append(f"lang is {sb.get('lang')!r}, expected {lang!r}")
    scenes = sb.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        problems.append("scenes must be a non-empty list")
        scenes = []
    seen = set()
    for i, sc in enumerate(scenes):
        if not isinstance(sc, dict) or not isinstance(sc.get("id"), str) or not sc.get("id"):
            problems.append(f"scenes[{i}] needs an id")
            continue
        if sc["id"] in seen:
            problems.append(f"duplicate scene id {sc['id']}")
        seen.add(sc["id"])
        if not isinstance(sc.get("narration"), str):
            problems.append(f"{sc['id']}: narration must be a string")
        md = sc.get("minDurationSec")
        if md is not None and (not isinstance(md, (int, float)) or isinstance(md, bool) or md < 0):
            problems.append(f"{sc['id']}: minDurationSec must be a number >= 0")
    if problems:
        raise BuildError(f"{path}: " + "; ".join(problems))
    return sb


def stress_onset(phonemes: str, span: tuple[int, int], ct: list[tuple[float, float] | None]) -> float | None:
    """Scene-relative ms of the LAST primary-stressed vowel in a span (espeak writes ˈ right before the
    vowel). A display word spoken as several words ("$40,000" -> forty thousand DOLLARS) takes the last,
    which is where the phrase accent falls (ART_GUIDE MO11). None when there is no ˈ (zh, ja, clitics)."""
    a, b = span
    for i in range(min(b, len(phonemes)) - 1, a - 1, -1):
        if phonemes[i] != "ˈ":
            continue
        for j in range(i + 1, min(b, len(ct))):
            if ct[j] is not None and phonemes[j] not in "ˈˌ ":
                return ct[j][0] * 1000.0
        return None
    return None


def translation_warning(sb: dict, lang: str) -> str | None:
    """types.ts: a storyboard whose lang differs from sourceLang counts as machine translation until the owner has
    recorded a native review. Since 2026-11-24 (review) that needs the whole record, as dub validate and the claim gate
    require: status 'native-reviewed', reviewed true, a reviewer (initials or a role) and a date. A half-set record
    (e.g. status native-reviewed with reviewed false) still warns."""
    tr = sb.get("translation") if isinstance(sb.get("translation"), dict) else {}
    reviewed = tr.get("status") == "native-reviewed" and tr.get("reviewed") is True and bool(tr.get("reviewer")) and bool(tr.get("date"))
    if not sb.get("sourceLang") or sb["sourceLang"] == lang or reviewed:
        return None
    if tr.get("status") == "native-reviewed":
        return (
            f"machine translation: needs native review ({lang}): the translation record says native-reviewed but is incomplete; "
            "the owner sets reviewed: true, reviewer (initials or a role) and date together with the status"
        )
    return (
        f"machine translation: needs native review ({lang}, translated from {sb['sourceLang']}; once a native speaker has "
        "checked it, the owner sets translation {status: 'native-reviewed', reviewed: true, reviewer, date} in the storyboard)"
    )


def timeline_words(
    words: list[Word],
    spans: list[tuple[int, int] | None],
    ct: list[tuple[float, float] | None],
    spaced: bool,
    duration_ms: int,
    phonemes: str = "",
) -> list[dict]:
    """Display words with scene-relative ms (and stressMs where the phonemes mark a primary stress).
    Display-only tokens (punctuation, {text|}) join the previous word; a multi-word display shares its
    spoken span in proportion to character length."""
    sep = " " if spaced else ""
    out: list[dict] = []
    prefix: list[str] = []
    for w, sp in zip(words, spans):
        if not w.display:
            continue
        times = None
        stress = None
        if sp is not None:
            ts = [ct[i] for i in range(sp[0], min(sp[1], len(ct))) if ct[i] is not None]
            if ts:
                times = (min(a for a, _ in ts) * 1000.0, max(b for _, b in ts) * 1000.0)
                stress = stress_onset(phonemes, sp, ct) if phonemes else None
        if times is None:
            if out:
                out[-1]["text"] += sep + sep.join(w.display) if spaced else "".join(w.display)
            else:
                prefix.extend(w.display)
            continue
        start, end = times
        tokens = list(w.display)
        if prefix:
            tokens[0] = sep.join(prefix) + sep + tokens[0] if spaced else "".join(prefix) + tokens[0]
            prefix = []
        weights = [max(1, len(t)) for t in tokens]
        total = sum(weights)
        acc = 0
        for t, wgt in zip(tokens, weights):
            a = start + (end - start) * acc / total
            acc += wgt
            b = start + (end - start) * acc / total
            item = {"text": t, "startMs": a, "endMs": b}
            if stress is not None and a <= stress <= b:
                item["stressMs"] = stress
            out.append(item)
    prev_end = 0
    for item in out:
        a = min(max(round(item["startMs"]), prev_end), duration_ms)
        b = min(max(round(item["endMs"]), a), duration_ms)
        item["startMs"], item["endMs"] = a, b
        if "stressMs" in item:
            item["stressMs"] = min(max(round(item["stressMs"]), a), b)
        prev_end = b
    return out


def _fit_scene(synth: Synth, phonemes: str, voice: str, base_speed: float, master_scene: dict, min_tail: float) -> tuple[Take, int, list[tuple[float, float]]]:
    target = timing.fit_target_ms(master_scene["speechMs"], master_scene["durationMs"], min_tail)
    takes: dict[float, Take] = {}
    samples: list[tuple[float, float]] = []
    speed = round(timing.clamp_speed(base_speed), 3)
    for _ in range(timing.FIT_MAX_ITERS):
        take = synth.speak(phonemes, voice, speed)
        takes[speed] = take
        samples.append((speed, take.ms))
        if timing.close_enough(take.ms, target) and take.ms + min_tail <= master_scene["durationMs"]:
            break
        nxt = timing.next_speed(samples, target)
        if any(abs(nxt - s) < 0.004 for s, _ in samples):
            break
        speed = nxt
    best_speed, _ = timing.choose_fit(samples, target, master_scene["durationMs"], min_tail)
    over = timing.overflow_ms(takes[best_speed].ms, master_scene["durationMs"], min_tail)
    if over and timing.SPEED_MAX not in takes:  # the verdict must come from the fastest allowed take
        takes[timing.SPEED_MAX] = synth.speak(phonemes, voice, timing.SPEED_MAX)
        samples.append((timing.SPEED_MAX, takes[timing.SPEED_MAX].ms))
        best_speed, _ = timing.choose_fit(samples, target, master_scene["durationMs"], min_tail)
        over = timing.overflow_ms(takes[best_speed].ms, master_scene["durationMs"], min_tail)
    return takes[best_speed], over, samples


SENTENCE_BREAK = re.compile(r"(?<=[.!?…])\s+")
SENTENCE_GAP_S = 0.12  # a dubbed sentence never starts closer than this to the end of the previous one
SENTENCE_WARN_MS = 100  # warn when a dubbed sentence is this much longer than its master sentence, or starts or ends this far off it


def sentence_spans(tokens: list[tuple[str, float, float]]) -> list[tuple[float, float]]:
    """(first phone start, last phone end) in seconds of each sentence of a take (split at . ! ? …)."""
    out: list[tuple[float, float]] = []
    cur: list[float] | None = None
    for ch, a, b in tokens:
        if ch in takes.SENTENCE_MARKS:
            if cur:
                out.append((cur[0], cur[1]))
            cur = None
            continue
        if not takes.is_phone(ch):
            continue
        if cur is None:
            cur = [a, b]
        else:
            cur[1] = max(cur[1], b)
    if cur:
        out.append((cur[0], cur[1]))
    return out


def sentence_chunks(phonemes: str) -> list[str]:
    return [c for c in SENTENCE_BREAK.split(phonemes) if any(takes.is_phone(ch) for ch in c)]


def _phone_span(take: Take) -> tuple[float, float]:
    spans = sentence_spans(take.timings)
    return (spans[0][0], spans[-1][1]) if spans else (0.0, take.ms / 1000.0)


def _fit_sentences(synth: Synth, phonemes: str, voice: str, base_speed: float, master_scene: dict, min_tail: float) -> tuple[Take, int, list, list[dict]] | None:
    """Fit a dubbed scene sentence by sentence (an audio track plays over the master picture, so talking vs closed mouth
    must line up per sentence, not just in the scene's total length; docs/research/dubbing-and-regions-2026-11-24.md).

    1. Each sentence is synthesized on its own, at the Kokoro speed (0.85-1.15) that makes its speech as long as the
       master sentence's (secant search, at most FIT_MAX_ITERS takes, plus a 1.15 take when none fits).
    2. Placement: a sentence that fits starts where its master sentence starts. One still longer at 1.15 starts where
       its excess shows least against the master mouth track (talking into a short master pause is invisible, past a
       phrase end it is not); without a mouth track, half its excess goes each side. (2026-11-24 re-check: starting it on
       time put the whole excess after the master's mouth had closed and pushed every later sentence back.) A sentence
       never starts closer than SENTENCE_GAP_S to the previous one's end, and the first keeps its take's lead pad.
    3. If the scene would overflow, the pauses are shortened from the end backwards (down to SENTENCE_GAP_S) before the
       caller lengthens the scene: an overflow shifts every later scene against the master video.
    None when the sentence count differs from the master's (the caller then fits the whole scene)."""
    import numpy as np

    chunks = sentence_chunks(phonemes)
    master = master_scene.get("sentences")
    if not master or len(master) != len(chunks):
        return None
    chosen: list[tuple[Take, tuple[float, float], float]] = []  # (take, phone span s, speed)
    tries: list[tuple[float, float]] = []
    for chunk, m in zip(chunks, master):
        target = float(m["endMs"] - m["startMs"])
        cands: dict[float, tuple[Take, tuple[float, float]]] = {}
        samples: list[tuple[float, float]] = []

        def speak(sp: float) -> None:
            t = synth.speak(chunk, voice, sp)
            span = _phone_span(t)
            cands[sp] = (t, span)
            samples.append((sp, (span[1] - span[0]) * 1000.0))

        speed = round(timing.clamp_speed(base_speed), 3)
        for _ in range(timing.FIT_MAX_ITERS):
            speak(speed)
            if timing.close_enough(samples[-1][1], target):
                break
            nxt = timing.next_speed(samples, target)
            if any(abs(nxt - sp) < 0.004 for sp, _ in samples):
                break
            speed = nxt
        fitting = [x for x in samples if x[1] <= target + timing.close_tolerance(target)]
        if not fitting and timing.SPEED_MAX not in cands:
            speak(timing.SPEED_MAX)
            fitting = [x for x in samples if x[1] <= target + timing.close_tolerance(target)]
        pool = fitting or samples
        best = min(pool, key=lambda x: (abs(x[1] - target), abs(x[0] - 1.0))) if fitting else min(pool, key=lambda x: x[1])
        take, span = cands[best[0]]
        tries.extend(samples)
        chosen.append((take, span, best[0]))

    def length(k: int) -> float:
        return chosen[k][1][1] - chosen[k][1][0]

    def lowest_start(k: int, starts: list[float]) -> float:
        return chosen[0][1][0] if k == 0 else starts[k - 1] + length(k - 1) + SENTENCE_GAP_S

    # 2. placement. The master mouth track, when present, decides where an overlong sentence spills: talking into a
    # short master pause costs nothing (pauses under 11 frames show a slightly open mouth), talking past a phrase end
    # (the mouth closes) is visible. Each candidate start is scored by the frames where the dub's talking or silence
    # disagrees with the master mouth; ties go to the centred start.
    mouth = master_scene.get("mouth") or []
    fps = len(mouth) * 1000.0 / master_scene["durationMs"] if mouth and master_scene.get("durationMs") else 0.0
    is_open = [sh != "closed" for sh in mouth]

    def mismatch(t: float, ln: float, w0: float, w1: float) -> int:
        f0, f1 = max(0, int(w0 * fps)), min(len(is_open), int(math.ceil(w1 * fps)))
        return sum(1 for f in range(f0, f1) if (t <= (f + 0.5) / fps < t + ln) != is_open[f])

    starts: list[float] = []
    for k, m in enumerate(master):
        m_start, m_end = m["startMs"] / 1000.0, m["endMs"] / 1000.0
        lo = lowest_start(k, starts)
        excess = length(k) - (m_end - m_start)
        centred = max(m_start - max(0.0, excess) / 2.0, lo)
        if excess <= timing.close_tolerance(m_end * 1000.0 - m_start * 1000.0) / 1000.0 or not fps or lo >= m_start:
            starts.append(centred)
            continue
        nxt = master[k + 1]["startMs"] / 1000.0 if k + 1 < len(master) else master_scene["durationMs"] / 1000.0
        w0 = starts[-1] + length(k - 1) if k else 0.0
        w1 = max(nxt, m_start + length(k))
        cands = [lo + i * 0.01 for i in range(int((m_start - lo) / 0.01) + 1)]
        starts.append(min(cands, key=lambda t: (mismatch(t, length(k), w0, w1), abs(t - centred))))
    # 3. the scene must fit: shorten pauses from the end backwards (a 5 ms margin keeps sample rounding inside the room)
    room = (master_scene["durationMs"] - min_tail) / 1000.0
    last_take, last_span, _ = chosen[-1]
    need = starts[-1] - last_span[0] + len(last_take.audio) / SAMPLE_RATE + 0.005 - room
    for k in range(len(chosen) - 1, -1, -1):
        if need <= 0:
            break
        d = min(need, max(0.0, starts[k] - lowest_start(k, starts)))
        for j in range(k, len(chosen)):
            starts[j] -= d
        need -= d
    parts: list[tuple[Take, float, tuple[float, float]]] = []
    detail: list[dict] = []
    for k, ((take, span, sp), m, start) in enumerate(zip(chosen, master, starts)):
        offset = start - span[0]
        if offset < 0:
            offset, start = 0.0, span[0]
        end = start + length(k)
        m_start, m_end = m["startMs"] / 1000.0, m["endMs"] / 1000.0
        detail.append(
            {
                "sentence": k + 1,
                "speed": sp,
                "masterStartMs": m["startMs"],
                "masterEndMs": m["endMs"],
                "startMs": round(start * 1000),
                "endMs": round(end * 1000),
                "earlyMs": max(0, round((m_start - start) * 1000)),
                "lateMs": max(0, round((start - m_start) * 1000)),
                "overrunMs": max(0, round((end - m_end) * 1000)),
                "longerMs": max(0, round((length(k) - (m_end - m_start)) * 1000)),
                "shortMs": max(0, round((m_end - end) * 1000)),
            }
        )
        parts.append((take, offset, span))
    total = max(int(round(off * SAMPLE_RATE)) + len(t.audio) for t, off, _ in parts)
    buf = np.zeros(total, dtype=np.float32)
    timings_out: list[tuple[str, float, float]] = []
    for i, (t, off, _) in enumerate(parts):
        at = int(round(off * SAMPLE_RATE))
        buf[at : at + len(t.audio)] += t.audio
        limit = parts[i + 1][1] + parts[i + 1][2][0] if i + 1 < len(parts) else total / SAMPLE_RATE
        for ch, a, b in t.timings:
            timings_out.append((ch, min(a + off, limit), min(b + off, limit)))
    weights = [max(1e-6, d["endMs"] - d["startMs"]) for d in detail]
    speed = round(sum(d["speed"] * w for d, w in zip(detail, weights)) / sum(weights), 3)
    take = Take(buf, timings_out, speed)
    over = timing.overflow_ms(take.ms, master_scene["durationMs"], min_tail)
    return take, over, tries, detail


def _dump(timeline: dict) -> str:
    """Indented JSON with each mouth array on one line (they hold one entry per frame)."""
    mouths = []
    for sc in timeline["scenes"]:
        mouths.append(sc["mouth"])
        sc["mouth"] = f"@@MOUTH{len(mouths) - 1}@@"
    text = json.dumps(timeline, ensure_ascii=False, indent=2)
    for i, m in enumerate(mouths):
        text = text.replace(f'"@@MOUTH{i}@@"', json.dumps(m, separators=(",", ":")))
        timeline["scenes"][i]["mouth"] = m
    return text + "\n"


# An audio-track (--fit-to) dub plays over the master picture, so its viewer sees only the master's English fiction card
# and disclosure. Such a dub must SAY them in its own language (research §1.11, §4.9; added 2026-11-24, VCD fix).
# Machine-made word lists, mirrored from scripts/claims/lib/lexicon.ts FICTION and DISCLOSURE.
_FICTION_SAID = {
    "en": r"fiction|fictional|fictitious|composite|made[- ]up|not real|dramati[sz]ed",
    "es": r"ficción|ficcion|ficticia|ficticio|ficticios|ficticias|inventad[oa]s?|compuest[oa]s?",
    "pt-br": r"ficção|ficcao|fictíci[oa]s?|ficticio|inventad[oa]s?|compost[oa]s?",
    "it": r"finzione|fittizi[oaie]|immaginari[oaie]|inventat[oaie]|di fantasia",
    "hi": r"काल्पनिक|कल्पना|मनगढ़ंत",
    "zh": r"虚构|杜撰|改编",
    "ja": r"フィクション|架空",
}
_DISCLOSURE_SAID = {
    "en": r"affiliate|referral|commission|sponsor(?:ed|ship)?|paid (?:partnership|promotion)|i built this|my own (?:product|project|tool|checklist)",
    "es": r"afiliad[oa]s?|referid[oa]s?|comisión|comision|patrocinad[oa]s?|patrocinio|colaboración pagada|promoción pagada|mi propi[oa] (?:producto|proyecto|lista)|lo creé yo",
    "pt-br": r"afiliad[oa]s?|indicação|comissão|comissao|patrocinad[oa]s?|patrocínio|parceria paga|(?:meu|minha) própri[oa] (?:produto|projeto|lista)|eu criei",
    "it": r"affiliazione|affiliat[oaie]|commissione|sponsorizzat[oaie]|collaborazione retribuita|(?:il mio|la mia) (?:prodotto|progetto|lista)",
    "hi": r"एफिलिएट|एफ़िलिएट|रेफरल|रेफ़रल|कमीशन|प्रायोजित|स्पॉन्सर|पेड पार्टनरशिप",
    "zh": r"联盟链接|推广链接|返佣|佣金|赞助|付费合作|自家产品",
    "ja": r"アフィリエイト|紹介リンク|スポンサー|有料プロモーション",
}
_NEGATORS = {
    "en": r"no|not|never|nothing|none|without|zero",
    "es": r"no|nunca|nada|ningún|ninguna|ninguno|sin|jamás",
    "pt-br": r"não|nunca|nada|nenhum|nenhuma|sem|jamais",
    "it": r"non|mai|niente|nessun|nessuna|nessuno|senza",
    "hi": r"नहीं|न|मत|बिना",
    "zh": r"不|没|没有|无|非",
    "ja": r"ない|ません",
}


def says_unnegated(pattern: str, text: str, lang: str) -> bool:
    """A match of `pattern` in `text` with no negation in the 3 words before it in the same clause."""
    t = text.lower()
    spaced = lang not in ("zh", "ja")
    word = r"(?<![\w])(?:{})(?![\w])".format(pattern) if spaced else pattern
    neg = re.compile(r"(?<![\w])(?:{})(?![\w])".format(_NEGATORS[lang]) if spaced else _NEGATORS[lang])
    for m in re.finditer(word, t):
        clause = re.split(r"[.,;:!?¡¿。，；：！？।]", t[: m.start()])[-1]
        before = clause.split()[-3:] if spaced else [clause[-4:]]
        if not any(neg.search(w) for w in before):
            return True
    return False


def with_master_flags(sb: dict, content_dir: str) -> dict:
    """The dub with the video's fiction flag and offers taken from the master storyboard too (storyboard.json), so a
    translation that dropped them cannot pass the audio-track refusal (2026-11-24 re-check)."""
    path = os.path.join(content_dir, "storyboard.json")
    try:
        with open(path, encoding="utf-8") as fh:
            master = json.load(fh)
    except (OSError, ValueError):
        return sb
    if not isinstance(master, dict) or master.get("lang") == sb.get("lang"):
        return sb
    offers = [o for o in (sb.get("offers") or []) + (master.get("offers") or []) if isinstance(o, str)]
    return {**sb, "fiction": sb.get("fiction") is True or master.get("fiction") is True, "offers": list(dict.fromkeys(offers))}


def audio_track_problems(sb: dict, lang: str) -> list[str]:
    """Why a --fit-to dub of this storyboard would leave its viewer without a disclosure or fiction notice."""
    out: list[str] = []
    spoken = []
    for sc in sb.get("scenes", []):
        try:
            spoken.append(markup.spoken_text(sc.get("narration", "")))
        except markup.MarkupError:
            spoken.append("")
    if sb.get("fiction") is True and not (spoken and says_unnegated(_FICTION_SAID[lang], spoken[0], lang)):
        out.append(
            f"fiction is true, and the {lang} track plays over the master picture, whose fiction card is not in {lang}: "
            f"have the opening scene SAY in {lang} that the story is fictional"
        )
    if sb.get("offers") and not any(says_unnegated(_DISCLOSURE_SAID[lang], t, lang) for t in spoken):
        out.append(
            f"offers {', '.join(sb['offers'])} are set, and the master picture shows the disclosure in English only: "
            f"the {lang} narration must SAY the disclosure (affiliate link / sponsored / my own product) in {lang}"
        )
    return out


def leftover_symbols(words: list[Word], lang: str) -> list[str]:
    """Spoken tokens that still hold a digit or one of $ % # € £ ¥ ₹ / after normalization (ja keeps digits on
    purpose: misaki reads integers itself)."""
    from .normalize.common import UNSPOKEN

    out: list[str] = []
    for w in words:
        for tok in (w.spoken or "").split():
            hit = UNSPOKEN.findall(tok)
            if lang == "ja":
                hit = [c for c in hit if not c.isdigit()]
            if hit and tok not in out:
                out.append(tok)
    return out


def channel_voice(content_dir: str, lang: str) -> str | None:
    """Zoo's voice from content/<channel>/channel.json: zooVoice.byLang[lang], else zooVoice.default.

    That map is the owner's binding choice (CLAUDE.md, 2026-11-24: im_nicola for every language), so a build without
    --voice follows it instead of the per-language Kokoro default in langs.py. None when the channel has no channel.json
    (e.g. test fixtures) or the file has no zooVoice entry.
    """
    path = os.path.join(os.path.dirname(os.path.abspath(content_dir)), "channel.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            zoo = json.load(fh).get("zooVoice") or {}
    except (OSError, ValueError, AttributeError):
        return None
    if not isinstance(zoo, dict):
        return None
    by_lang = zoo.get("byLang") if isinstance(zoo.get("byLang"), dict) else {}
    voice = by_lang.get(lang) or zoo.get("default")
    return voice if isinstance(voice, str) and voice.strip() else None


def build(opts: Options) -> Result:
    import numpy as np

    t0 = time.time()
    log = opts.log
    s = spec(opts.lang)
    if opts.fps <= 0 or not 0.5 <= opts.speed <= 2.0:
        raise BuildError("fps must be positive and speed within [0.5, 2.0]")
    content_dir = os.path.abspath(opts.content_dir)
    channel, slug = os.path.basename(os.path.dirname(content_dir)), os.path.basename(content_dir)
    sb_path = storyboard_path(content_dir, opts.lang)
    sb = load_storyboard(sb_path, opts.lang)
    if sb["channel"] != channel or sb["slug"] != slug:
        raise BuildError(f"{sb_path} says {sb['channel']}/{sb['slug']} but lives in {channel}/{slug}")
    out_root = os.path.abspath(opts.out_root or os.path.join(PROJECT_ROOT, "public"))
    rel_dir = f"generated/{channel}/{slug}/{opts.lang}"
    out_dir = os.path.join(out_root, rel_dir)
    voice = opts.voice or channel_voice(content_dir, opts.lang) or s.voice
    warnings: list[str] = []

    master = None
    mscenes: dict[str, dict] = {}
    if opts.fit_to:
        spec(opts.fit_to)
        if opts.fit_to == opts.lang:
            raise BuildError("--fit-to must name a different language than --lang")
        mpath = os.path.join(out_root, f"generated/{channel}/{slug}/{opts.fit_to}/timeline.json")
        if not os.path.isfile(mpath):
            raise BuildError(f"master timeline {mpath} not found: build --lang {opts.fit_to} first")
        with open(mpath, encoding="utf-8") as fh:
            master = json.load(fh)
        schema.assert_valid(master)
        if master["fps"] != opts.fps:
            raise BuildError(f"master timeline is {master['fps']} fps, this build is {opts.fps}")
        mscenes = {sc["id"]: sc for sc in master["scenes"]}
        ids, mids = [sc["id"] for sc in sb["scenes"]], [sc["id"] for sc in master["scenes"]]
        if ids != mids:
            raise BuildError(f"scene ids differ from the {opts.fit_to} master: {ids} vs {mids}")
        refused = audio_track_problems(with_master_flags(sb, content_dir), opts.lang)
        if refused:
            raise BuildError(
                "refusing --fit-to (an audio track over the master picture): "
                + "; ".join(refused)
                + ". Or build a native upload (no --fit-to), whose picture carries the card and disclosure in this language"
            )
    note = translation_warning(sb, opts.lang)
    if note:
        warnings.append(note)
    if s.g2p == "misaki":
        warnings.append(f"{opts.lang}: pronunciation comes from misaki 0.7.4 G2P and has not been checked by a native speaker")

    # Parse and normalize every scene before any synthesis, so a markup error fails fast.
    scene_words: list[list[Word]] = []
    for sc in sb["scenes"]:
        try:
            scene_words.append(build_words(sc["narration"], opts.lang))
        except markup.MarkupError as e:
            raise BuildError(f"{sb_path} scene {sc['id']}: {e}") from None
        left = leftover_symbols(scene_words[-1], opts.lang)
        if left:
            warnings.append(
                f"{sc['id']}: after normalization the voice would still read {', '.join(repr(x) for x in left)} as written "
                "(digits or $ % # € £ / reach espeak, which misreads them: '5-10%' as 'five minus ten'). "
                "Write it as {display|spoken}, e.g. {5-10%|five to ten percent}"
            )

    model_dir = opts.model_dir or os.path.join(PROJECT_ROOT, ".cache", "kokoro")
    log(f"voice: {channel}/{slug} {opts.lang} voice={voice} speed={opts.speed}" + (f" fit-to={opts.fit_to}" if master else ""))
    synth = Synth(model_dir)
    synth.check_voice(voice)
    g = g2p_mod.make(opts.lang, g2p_mod.load_vocab(), cache_dir=os.path.join(PROJECT_ROOT, ".cache", "jieba"))

    scenes: list[dict] = []
    buffers = []
    debug: dict = {}
    overflow_any = False
    n = len(sb["scenes"])
    for idx, sc in enumerate(sb["scenes"]):
        sid = sc["id"]
        ph = g.phonemize(scene_words[idx])
        words = ph.words
        if ph.method == "proportional":
            warnings.append(f"{sid}: word timing is approximate (proportional by phoneme length): espeak's phoneme words could not be matched to the spoken words")
        lost = sorted({c for c in ph.dropped if c.isalnum()})
        if lost:
            warnings.append(f"{sid}: characters Kokoro cannot speak were dropped: {' '.join(lost)}")
        take: Take | None = None
        over = 0
        tries: list[tuple[float, float]] = []
        fit_detail: list[dict] = []
        if ph.phonemes:
            if master is None:
                take = synth.speak(ph.phonemes, voice, opts.speed)
            else:
                by_sentence = _fit_sentences(synth, ph.phonemes, voice, opts.speed, mscenes[sid], opts.fit_min_tail_ms)
                if by_sentence is not None:
                    take, over, tries, fit_detail = by_sentence
                    for d in fit_detail:
                        own = d["longerMs"]
                        if own > SENTENCE_WARN_MS:
                            warnings.append(
                                f"{sid}: sentence {d['sentence']} is {own} ms longer than the {opts.fit_to} sentence even at speed {d['speed']}: "
                                f"it starts {d['earlyMs']} ms before and ends {d['overrunMs']} ms after it, while the {opts.fit_to} picture's "
                                f"mouth is closed. Shorten it by about {max(1, round(100 * own / max(1, d['endMs'] - d['startMs'])))}%, even if the scene fits"
                            )
                        elif d["overrunMs"] > SENTENCE_WARN_MS or d["lateMs"] > SENTENCE_WARN_MS:
                            warnings.append(
                                f"{sid}: sentence {d['sentence']} starts {d['lateMs']} ms late and ends {d['overrunMs']} ms after the {opts.fit_to} "
                                "sentence because an earlier sentence ran over: shorten that one"
                            )
                        elif d["earlyMs"] > SENTENCE_WARN_MS:
                            warnings.append(
                                f"{sid}: sentence {d['sentence']} starts {d['earlyMs']} ms before the {opts.fit_to} sentence: the pauses were "
                                "shortened so the scene fits; shorten the sentences after it"
                            )
                else:
                    msent = mscenes[sid].get("sentences")
                    warnings.append(
                        f"{sid}: sentence-by-sentence alignment skipped: "
                        + (
                            f"{len(sentence_chunks(ph.phonemes))} sentences against {len(msent)} in the {opts.fit_to} scene; keep the master's sentences one for one"
                            if msent
                            else f"the {opts.fit_to} timeline has no sentence spans (built before 2026-11-24): rebuild it, then this dub"
                        )
                        + ". Only the scene length was fitted, so pauses fall at different times than in the master picture"
                    )
                    take, over, tries = _fit_scene(synth, ph.phonemes, voice, opts.speed, mscenes[sid], opts.fit_min_tail_ms)
        speech_ms = take.ms if take else 0.0
        if master is None:
            dur = timing.scene_duration_ms(speech_ms, timing.tail_for(idx, n, opts.tail_ms, opts.last_tail_ms), sc.get("minDurationSec"), opts.fps)
        else:
            dur = mscenes[sid]["durationMs"]
            if over:
                overflow_any = True
                new_dur = timing.quantize_up(speech_ms + opts.fit_min_tail_ms, opts.fps)
                warnings.append(
                    f"{sid}: overflows the {opts.fit_to} scene by {over} ms even at speed {timing.SPEED_MAX} "
                    f"(speech {round(speech_ms)} ms + {round(opts.fit_min_tail_ms)} ms air > {dur} ms). Shorten the {opts.lang} "
                    f"translation by about {max(1, round(100 * over / max(1.0, speech_ms)))}%. The scene was lengthened to {new_dur} ms, so this "
                    "track no longer lines up with the master video"
                )
                dur = new_dur
        n_frames = timing.frames(dur, opts.fps)
        buf = np.zeros(dur * SAMPLE_RATE // 1000, dtype=np.float32)
        ct: list = []
        tokens: list[tuple[str, float, float]] = []
        if take is not None:
            if len(take.audio) > len(buf):
                raise BuildError(f"{sid}: internal error, speech longer than the scene")
            buf[: len(take.audio)] = take.audio
            ct = char_times(ph.phonemes, take.timings)
            tokens = [(ph.phonemes[i], t[0], t[1]) for i, t in enumerate(ct) if t is not None]
        frame_rms = audio.frame_rms(buf, SAMPLE_RATE, opts.fps)
        mouth = visemes.mouth_track(
            tokens, n_frames, opts.fps, frame_rms, opts.lang, opts.lead_frames, env_db=audio.hop_db(buf, SAMPLE_RATE, visemes.HOP_S) if take is not None else None
        )
        scene = {
            "id": sid,
            "audio": f"{rel_dir}/scenes/{sid}.wav",
            "startMs": 0,
            "durationMs": dur,
            "speechMs": round(speech_ms),
            "words": timeline_words(words, ph.word_spans, ct, s.spaced, dur, ph.phonemes),
            "mouth": mouth,
        }
        if tokens:
            scene["sentences"] = [{"startMs": round(a * 1000), "endMs": round(b * 1000)} for a, b in sentence_spans(tokens)]
        if master is not None:
            scene["speed"] = take.speed if take else round(timing.clamp_speed(opts.speed), 3)
            if over:
                scene["overflowMs"] = over
        scenes.append(scene)
        buffers.append(buf)
        debug[sid] = {
            "spoken": " ".join(w.spoken for w in words if w.spoken) if s.spaced else "".join(w.spoken for w in words),
            "phonemes": ph.phonemes,
            "alignment": ph.method,
            "speed": take.speed if take else None,
            "speechMs": round(speech_ms),
            "fitTries": [[sp, round(ms)] for sp, ms in tries],
            "fitSentences": fit_detail,
            "mouthChangesPerSecond": round(visemes.changes_per_second(mouth, opts.fps), 2),
        }
        log(f"  {sid}: speech {speech_ms / 1000:.2f}s -> scene {dur / 1000:.1f}s, {len(scene['words'])} words, align {ph.method}" + (f", speed {take.speed}" if master is not None and take else "") + (f", OVERFLOW {over} ms" if over else ""))

    for sc, st in zip(scenes, timing.starts([sc["durationMs"] for sc in scenes])):
        sc["startMs"] = st
    total_ms = sum(sc["durationMs"] for sc in scenes)

    gen_root = os.path.join(out_root, "generated")  # gitignored, same filesystem as the outputs
    os.makedirs(gen_root, exist_ok=True)
    stage = tempfile.mkdtemp(prefix=".voice-", dir=gen_root)
    try:
        raw = os.path.join(stage, "raw.wav")
        audio.write_wav(raw, np.concatenate(buffers) if buffers else np.zeros(0, np.float32), SAMPLE_RATE, subtype="FLOAT")
        narration = os.path.join(stage, "narration.wav")
        ln = audio.loudnorm(raw, narration, SAMPLE_RATE)
        norm, sr = audio.read_wav(narration)
        expected = total_ms * SAMPLE_RATE // 1000
        if len(norm) != expected:  # loudnorm keeps the length; guard anyway
            norm = np.pad(norm, (0, max(0, expected - len(norm))))[:expected]
            audio.write_wav(narration, norm, SAMPLE_RATE)
        loudness = None
        if ln["type"] != "silent":
            loudness = {"integratedLufs": round(float(ln["result"]["input_i"]), 2), "truePeakDb": round(float(ln["result"]["input_tp"]), 2)}
            if abs(loudness["integratedLufs"] - audio.TARGET_I) > audio.WARN_LU or loudness["truePeakDb"] > audio.TARGET_TP:
                warnings.append(f"loudness {loudness['integratedLufs']} LUFS / {loudness['truePeakDb']} dBTP is off the -14 LUFS / -1 dBTP target")
        os.makedirs(os.path.join(stage, "scenes"))
        for sc in scenes:
            a = sc["startMs"] * SAMPLE_RATE // 1000
            b = a + sc["durationMs"] * SAMPLE_RATE // 1000
            audio.write_wav(os.path.join(stage, "scenes", f"{sc['id']}.wav"), norm[a:b], SAMPLE_RATE)
            # lip-sync check on what the viewer hears (the normalized scene audio)
            sync = visemes.sync_landmarks(sc["mouth"], audio.to_db(audio.frame_rms(norm[a:b], SAMPLE_RATE, opts.fps)))
            debug[sc["id"]]["sync"] = sync
            late = [x for x in sync["offsets"] if abs(x) > SYNC_OFFSET_TOL]
            early = [x for x in sync["onsets"] if not SYNC_ONSET_RANGE[0] <= x <= SYNC_ONSET_RANGE[1]]
            early += [x for x in sync["mbpOnsets"] if not SYNC_MBP_ONSET_RANGE[0] <= x <= SYNC_MBP_ONSET_RANGE[1]]
            if late or early:
                warnings.append(
                    f"{sc['id']}: lip-sync check: "
                    + "; ".join(
                        ([f"the mouth closes {late} frames off the end of a phrase (allowed ±{SYNC_OFFSET_TOL})"] if late else [])
                        + ([f"the mouth opens {early} frames off a phrase onset (allowed {SYNC_ONSET_RANGE[0]} to {SYNC_ONSET_RANGE[1]})"] if early else [])
                    )
                )

        timeline: dict = {"version": 1, "slug": slug, "lang": opts.lang, "mode": "fit-to-master" if master else "native"}
        if master:
            timeline["masterLang"] = opts.fit_to
        timeline.update(
            {
                "voice": voice,
                "speed": opts.speed,
                "model": {"file": MODEL_FILE, "sha256": synth.digests[MODEL_FILE]},
                "sampleRate": SAMPLE_RATE,
                "fps": opts.fps,
                "totalMs": total_ms,
                "scenes": scenes,
            }
        )
        if loudness:
            timeline["loudness"] = loudness
        timeline["warnings"] = warnings
        timeline["narration"] = f"{rel_dir}/narration.wav"
        schema.assert_valid(timeline)
        debug_doc = {
            "g2p": s.g2p,
            "loudness": {"limiter": ln.get("limiter"), "loudnormType": ln["type"], "loudnormTargets": ln.get("targets"), "pass1": ln.get("pass1"), "result": ln.get("result")},
            "scenes": debug,
        }
        with open(os.path.join(stage, "timeline.json"), "w", encoding="utf-8") as fh:
            fh.write(_dump(timeline))
        with open(os.path.join(stage, "phonemes.json"), "w", encoding="utf-8") as fh:
            json.dump(debug_doc, fh, ensure_ascii=False, indent=2)
        os.remove(raw)
        # publish: replace the language folder's contents
        os.makedirs(out_dir, exist_ok=True)
        shutil.rmtree(os.path.join(out_dir, "scenes"), ignore_errors=True)
        for name in ("narration.wav", "timeline.json", "phonemes.json", "scenes"):
            target = os.path.join(out_dir, name)
            if os.path.isfile(target):
                os.remove(target)
            shutil.move(os.path.join(stage, name), target)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    secs = time.time() - t0
    log(f"  total {total_ms / 1000:.1f}s, loudness {loudness}, {len(warnings)} warning(s), built in {secs:.1f}s -> {out_dir}")
    return Result(timeline, out_dir, warnings, overflow_any, secs, debug)
