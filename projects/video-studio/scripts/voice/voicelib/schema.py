"""Validator for the Timeline contract in src/episode/types.ts (plus the recorded optional additions).

Contract keys are required exactly; extra keys are errors unless listed in ADDITIONS. Beyond the
types it checks the invariants the compositions rely on: cumulative startMs, totalMs, whole frames,
mouth length = frames, words ordered inside the scene.
"""

import math
import re

LANGS = ("en", "es", "pt-br", "hi", "it", "zh", "ja")
MOUTHS = frozenset(("closed", "slightlyOpen", "ah", "ee", "oh", "mbp"))
TOP_REQUIRED = ("version", "slug", "lang", "mode", "voice", "speed", "model", "sampleRate", "fps", "totalMs", "scenes", "warnings")
TOP_OPTIONAL = ("masterLang", "loudness", "mock")  # mock: added by the episode builder (dev previews)
SCENE_REQUIRED = ("id", "audio", "startMs", "durationMs", "speechMs", "words", "mouth")
# Optional fields the voice step adds (recorded in scripts/voice/timeline-additions.ts and README.md).
ADDITIONS = {
    "timeline": ("narration",),
    "scene": ("speed", "overflowMs"),
}


def _num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def validate(t) -> list[str]:
    errs: list[str] = []

    def err(msg: str) -> None:
        errs.append(msg)

    if not isinstance(t, dict):
        return ["timeline is not an object"]
    for k in TOP_REQUIRED:
        if k not in t:
            err(f"missing {k}")
    for k in t:
        if k not in TOP_REQUIRED and k not in TOP_OPTIONAL and k not in ADDITIONS["timeline"]:
            err(f"unknown key {k}")
    if errs:
        return errs
    if t["version"] != 1:
        err("version must be 1")
    if not isinstance(t["slug"], str) or not t["slug"]:
        err("slug must be a non-empty string")
    if t["lang"] not in LANGS:
        err(f"lang {t['lang']!r} not in {LANGS}")
    if t["mode"] not in ("native", "fit-to-master"):
        err(f"mode {t['mode']!r}")
    if "masterLang" in t and t["masterLang"] not in LANGS:
        err("masterLang invalid")
    if t["mode"] == "fit-to-master" and "masterLang" not in t:
        err("fit-to-master needs masterLang")
    if not isinstance(t["voice"], str) or not t["voice"]:
        err("voice must be a non-empty string")
    if not _num(t["speed"]) or not 0.5 <= t["speed"] <= 2.0:
        err("speed must be a number in [0.5, 2]")
    model = t["model"]
    if not isinstance(model, dict) or set(model) != {"file", "sha256"} or not isinstance(model.get("file"), str) or not re.fullmatch(r"[0-9a-f]{64}", str(model.get("sha256", ""))):
        err("model must be {file, sha256 (64 hex)}")
    for k in ("sampleRate", "fps"):
        if not isinstance(t[k], int) or isinstance(t[k], bool) or t[k] <= 0:
            err(f"{k} must be a positive integer")
    if not _num(t["totalMs"]) or t["totalMs"] < 0:
        err("totalMs must be a number >= 0")
    if not isinstance(t["warnings"], list) or not all(isinstance(w, str) for w in t["warnings"]):
        err("warnings must be a list of strings")
    if "loudness" in t:
        ld = t["loudness"]
        if not isinstance(ld, dict) or set(ld) != {"integratedLufs", "truePeakDb"} or not all(_num(ld.get(k)) for k in ("integratedLufs", "truePeakDb")):
            err("loudness must be {integratedLufs, truePeakDb} numbers")
    if "mock" in t and not isinstance(t["mock"], bool):
        err("mock must be a boolean")
    if "narration" in t and (not isinstance(t["narration"], str) or t["narration"].startswith("/")):
        err("narration must be a path relative to public/")
    if not isinstance(t["scenes"], list):
        err("scenes must be a list")
        return errs
    fps = t["fps"] if isinstance(t["fps"], int) else 30
    expected_start = 0.0
    ids = set()
    for i, s in enumerate(t["scenes"]):
        where = f"scenes[{i}]"
        if not isinstance(s, dict):
            err(f"{where} is not an object")
            continue
        for k in SCENE_REQUIRED:
            if k not in s:
                err(f"{where} missing {k}")
        for k in s:
            if k not in SCENE_REQUIRED and k not in ADDITIONS["scene"]:
                err(f"{where} unknown key {k}")
        if any(k not in s for k in SCENE_REQUIRED):
            continue
        where = f"scenes[{i}] ({s['id']})"
        if not isinstance(s["id"], str) or not s["id"]:
            err(f"{where} id must be a non-empty string")
        if s["id"] in ids:
            err(f"{where} duplicate id")
        ids.add(s["id"])
        if not isinstance(s["audio"], str) or not s["audio"] or s["audio"].startswith("/"):
            err(f"{where} audio must be a path relative to public/")
        for k in ("startMs", "durationMs", "speechMs"):
            if not _num(s[k]) or s[k] < 0:
                err(f"{where} {k} must be a number >= 0")
        if not all(_num(s[k]) for k in ("startMs", "durationMs", "speechMs")):
            continue
        if abs(s["startMs"] - expected_start) > 1e-6:
            err(f"{where} startMs {s['startMs']} != cumulative {expected_start}")
        expected_start += s["durationMs"]
        if s["speechMs"] > s["durationMs"] + 1e-6:
            err(f"{where} speechMs > durationMs")
        n_frames = s["durationMs"] * fps / 1000
        if abs(n_frames - round(n_frames)) > 1e-6:
            err(f"{where} durationMs {s['durationMs']} is not a whole number of frames")
        if not isinstance(s["mouth"], list) or len(s["mouth"]) != round(n_frames):
            err(f"{where} mouth must have {round(n_frames)} entries (one per frame), has {len(s['mouth']) if isinstance(s['mouth'], list) else '?'}")
        elif any(m not in MOUTHS for m in s["mouth"]):
            err(f"{where} mouth has values outside {sorted(MOUTHS)}")
        if not isinstance(s["words"], list):
            err(f"{where} words must be a list")
            continue
        prev_end = 0.0
        for j, w in enumerate(s["words"]):
            ww = f"{where} words[{j}]"
            if not isinstance(w, dict) or not {"text", "startMs", "endMs"} <= set(w) <= {"text", "startMs", "endMs", "stressMs"}:
                err(f"{ww} must be {{text, startMs, endMs, stressMs?}}")
                continue
            if not isinstance(w["text"], str) or not w["text"]:
                err(f"{ww} text must be a non-empty string")
            if not (_num(w["startMs"]) and _num(w["endMs"])):
                err(f"{ww} times must be numbers")
                continue
            if not 0 <= w["startMs"] <= w["endMs"] <= s["durationMs"]:
                err(f"{ww} times out of order or outside the scene: {w['startMs']}..{w['endMs']}")
            if w["startMs"] + 1e-6 < prev_end:
                err(f"{ww} overlaps the previous word")
            if "stressMs" in w and (not _num(w["stressMs"]) or not w["startMs"] - 1 <= w["stressMs"] <= w["endMs"] + 1):
                err(f"{ww} stressMs must lie inside the word")
            prev_end = w["endMs"]
        if "speed" in s and (not _num(s["speed"]) or not 0.5 <= s["speed"] <= 2.0):
            err(f"{where} speed invalid")
        if "overflowMs" in s and (not _num(s["overflowMs"]) or s["overflowMs"] < 0):
            err(f"{where} overflowMs invalid")
    if _num(t["totalMs"]) and abs(t["totalMs"] - expected_start) > 1e-6:
        err(f"totalMs {t['totalMs']} != sum of durationMs {expected_start}")
    return errs


def assert_valid(t) -> None:
    errs = validate(t)
    if errs:
        raise ValueError("invalid timeline:\n  " + "\n  ".join(errs[:20]))
