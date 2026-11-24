"""The voice build: storyboard -> per-scene Kokoro takes -> narration.wav + timeline.json.

Outputs in public/generated/<channel>/<slug>/<lang>/:
  narration.wav     one continuous mono 24 kHz PCM-16 track, two-pass loudnorm -14 LUFS / -1 dBTP
  scenes/<id>.wav   each scene cut sample-exactly from narration.wav (TimelineScene.audio points here)
  timeline.json     the Timeline contract (src/episode/types.ts) + the recorded optional additions
  phonemes.json     debug: spoken text, phonemes, alignment method and speed per scene
"""

import json
import os
import shutil
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from . import audio, markup, schema, timing, visemes
from . import g2p as g2p_mod
from .langs import spec
from .synth import MODEL_FILE, SAMPLE_RATE, Synth, Take, char_times
from .words import Word, build_words

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


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
    """types.ts: a storyboard whose lang differs from sourceLang counts as machine translation unless
    translation.status is 'native-reviewed'."""
    reviewed = isinstance(sb.get("translation"), dict) and sb["translation"].get("status") == "native-reviewed"
    if not sb.get("sourceLang") or sb["sourceLang"] == lang or reviewed:
        return None
    return (
        f"machine translation: needs native review ({lang}, translated from {sb['sourceLang']}; "
        "set translation.status to 'native-reviewed' in the storyboard once a native speaker has checked it)"
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
    voice = opts.voice or s.voice
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
        if ph.phonemes:
            if master is None:
                take = synth.speak(ph.phonemes, voice, opts.speed)
            else:
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
        mouth = visemes.mouth_track(tokens, n_frames, opts.fps, audio.frame_rms(buf, SAMPLE_RATE, opts.fps), opts.lang, opts.lead_frames)
        scene = {
            "id": sid,
            "audio": f"{rel_dir}/scenes/{sid}.wav",
            "startMs": 0,
            "durationMs": dur,
            "speechMs": round(speech_ms),
            "words": timeline_words(words, ph.word_spans, ct, s.spaced, dur, ph.phonemes),
            "mouth": mouth,
        }
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
