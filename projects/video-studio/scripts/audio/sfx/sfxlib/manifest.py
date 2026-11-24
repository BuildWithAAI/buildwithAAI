"""Manifest entries and the public manifest (public/audio/sfx/manifest.json).

One entry per file: id, file (relative to public/, ready for Remotion's staticFile), group and
variation, tags, duration, onset / transient / peak / sync times in ms with the sync frame at
30 fps, the suggested gain (and the linear volume for <Audio volume>), the loudness numbers behind
it, timed events (keys, steps, thumps), provenance and licence of every source, and a sha256.
"""

from __future__ import annotations

import hashlib
import re

from audiolib.core import SR

from .core import BIT_DEPTH, FPS, FRAME, PEAK_DBFS, ROLES, Sound

SCHEMA_VERSION = 1
ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*_(\d{2})$")


def variation_of(sound_id: str) -> int:
    m = ID_RE.match(sound_id)
    if not m:
        raise ValueError(f"id {sound_id!r} must be snake_case and end in a two-digit variation number")
    return int(m.group(1))


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def entry(sound: Sound, m: dict, rel_file: str, sha: str) -> dict:
    gain = m["suggestedGainDb"]
    events = []
    for ev in sound.events:
        e = {"ms": round(ev["t"] * 1000, 2), "frame": int(round(ev["t"] * FPS)), "kind": ev.get("kind", "hit")}
        for k, v in ev.items():
            if k not in ("t", "kind"):
                e[k] = v
        events.append(e)
    out = {
        "id": sound.id,
        "file": rel_file,
        "group": sound.group,
        "variation": variation_of(sound.id),
        "category": sound.category,
        "role": sound.role,
        "tags": list(sound.tags),
        "description": sound.description,
        "durationMs": m["durationMs"],
        "onsetMs": m["onsetMs"],
        "transientMs": m["transientMs"],
        "peakMs": m["peakMs"],
        "loudPeakMs": m["loudPeakMs"],
        "syncKind": sound.sync,
        "syncMs": m["syncMs"],
        "syncFrame30": m["syncFrame30"],
        "suggestedGainDb": gain,
        "suggestedVolume": round(10 ** (gain / 20.0), 4),
        "loudness": {
            "samplePeakDbfs": m["samplePeakDbfs"],
            "truePeakDbtp": m["truePeakDbtp"],
            "lufs200Max": m["lufs200Max"],
            "lufsMomentaryMax": m["lufsMomentaryMax"],
            "lufs100Max": m["lufs100Max"],
            "targetLufs": m["targetLufs"],
            "gainCapped": m["gainCapped"],
        },
        "pitch": sound.pitch,
        "loop": sound.loop,
        "events": events,
        "sources": list(sound.sources),
        "sha256": sha,
    }
    if sound.rig:
        out["rig"] = sound.rig
    if sound.extra:
        out["extra"] = sound.extra
    return out


def build(entries: list, generated: str) -> dict:
    groups = {}
    for e in entries:
        g = groups.setdefault(e["group"], {"category": e["category"], "role": e["role"], "ids": []})
        g["ids"].append(e["id"])
    return {
        "version": SCHEMA_VERSION,
        "generated": generated,
        "generator": "scripts/audio/sfx/build.py",
        "format": {"sampleRate": SR, "bitDepth": BIT_DEPTH, "channels": 2, "container": "WAV (PCM, TPDF dither)", "samplePeakDbfs": PEAK_DBFS},
        "fps": FPS,
        "frameSamples": FRAME,
        "loudness": {
            "measure": "lufs200Max: BS.1770 K-weighted loudness in a 200 ms window, maximised over every sample position with silence around the file. Loudness integrates over about the first 200 ms of a sound, so this window rates clicks and swells alike; the EBU momentary 400 ms window (lufsMomentaryMax, also given) under-reads very short sounds by about 3 dB more.",
            "suggestedGain": "suggestedGainDb = role target - lufs200Max, capped so the true peak after the gain stays at or under -6 dBTP (gainCapped); suggestedVolume = 10^(gain/20) for <Audio volume>",
            "roles": ROLES,
            "narration": "-14 LUFS-I (scripts/voice); beds about -26 LUFS-S, ducked 6 dB under speech (docs/AUDIO.md)",
        },
        "sync": "Every syncMs and event time is a multiple of 1000/30 ms (1600 samples). Place a file at frame F - syncFrame30 to land its sync point on frame F. Impacts (syncKind 'transient') start their attack within 3 ms of the file start.",
        "groups": groups,
        "sounds": entries,
    }


def validate(man: dict) -> list:
    """Schema problems in a manifest (empty list = valid)."""
    errs = []
    need = ["id", "file", "group", "variation", "category", "role", "tags", "durationMs", "transientMs", "peakMs", "syncMs", "syncFrame30", "suggestedGainDb", "sha256"]
    ids = set()
    for e in man.get("sounds", []):
        for k in need:
            if k not in e:
                errs.append(f"{e.get('id', '?')}: missing {k}")
        if e.get("id") in ids:
            errs.append(f"duplicate id {e.get('id')}")
        ids.add(e.get("id"))
        if e.get("role") not in ROLES:
            errs.append(f"{e.get('id')}: unknown role {e.get('role')}")
        if not e.get("tags"):
            errs.append(f"{e.get('id')}: no tags")
        sm = e.get("syncMs")
        if sm is not None and int(round(sm * SR / 1000)) % FRAME != 0:
            errs.append(f"{e.get('id')}: syncMs {sm} is not on a frame boundary")
    for g, info in man.get("groups", {}).items():
        if len(info["ids"]) < 3:
            errs.append(f"group {g} has {len(info['ids'])} variations (< 3)")
    return errs
