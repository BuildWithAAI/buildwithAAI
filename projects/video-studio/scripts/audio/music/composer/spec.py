"""Cue specs, metadata, delivery formats and the manifest.

Delivery (public/audio/music/, committed; the repository rule is "no file over 10 MB"):
- a cue whose 48 kHz 24-bit WAV fits in MAX_BYTES ships as that WAV (the master itself);
- a longer cue ships as lossless FLAC: 24-bit when it fits, else 16-bit with TPDF dither. FLAC is
  sample-exact, so loop points stay exact (AAC/Opus would add encoder priming and break loops).
The 24-bit WAV master, an AAC preview, the pre-master, MIDI, metrics and pictures stay in
out/audio/music/<id>/ (not committed).

Each cue gets <id>.json next to its audio (the metadata) and a line in manifest.json.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from audiolib.core import SR

MAX_BYTES = 10_000_000
CHANNELS = ("zoora-security", "zoora-ai", "both")
CUE_TYPES = ("theme", "sting", "bumper", "bed", "endscreen", "intro-sting")
PROFILES = ("standalone", "sting", "bed")
SCHEMA_VERSION = 1


@dataclass
class Cue:
    id: str
    title: str
    channel: str
    cue_type: str
    mood: str
    key: str
    bpm: float
    profile: str
    build: Callable | None = None
    loop: bool = False
    bars: int | None = None
    time_sig: tuple = (4, 4)
    hits: list = field(default_factory=list)  # [(seconds, what)]
    sections: list = field(default_factory=list)  # [(seconds, name)]
    description: str = ""
    usage: str = ""
    instruments: list = field(default_factory=list)
    builder: Callable | None = None

    def __post_init__(self):
        if self.build is None:
            self.build = self.builder
        if self.build is None:
            raise ValueError(f"{self.id}: no builder")
        if self.channel not in CHANNELS:
            raise ValueError(f"{self.id}: channel must be one of {CHANNELS}")
        if self.cue_type not in CUE_TYPES:
            raise ValueError(f"{self.id}: cue_type must be one of {CUE_TYPES}")
        if self.profile not in PROFILES:
            raise ValueError(f"{self.id}: profile must be one of {PROFILES}")
        if self.loop and self.profile != "bed":
            raise ValueError(f"{self.id}: only beds loop")


def wav_bytes(frames: int, bits: int = 24, channels: int = 2) -> int:
    return 44 + frames * channels * bits // 8


def delivery_format(frames: int) -> str:
    """'wav24' when the 24-bit WAV fits in MAX_BYTES, else 'flac' (the exporter picks 24 or 16 bits)."""
    return "wav24" if wav_bytes(frames) <= MAX_BYTES else "flac"


def frames_per_beat(bpm: float, fps: int = 30) -> float:
    return fps * 60.0 / bpm


def metadata(cue: Cue, rendered, delivered: dict, metrics: dict | None, statements: list, badger: list, review: str | None) -> dict:
    a = rendered.master
    n = a.shape[1]
    rep = rendered.master_report["result"]
    loop = None
    if cue.loop:
        loop = {"seamless": True, "startSample": 0, "endSample": n, "startSec": 0.0, "endSec": round(n / SR, 6),
                "frames30": round(n / SR * 30, 3)}
    m = (metrics or {}).get("metrics", {})
    spec = m.get("spectrum", {}) if m else {}
    lou = m.get("loudness", {}) if m else {}
    return {
        "schema": SCHEMA_VERSION,
        "id": cue.id,
        "title": cue.title,
        "channel": cue.channel,
        "cueType": cue.cue_type,
        "mood": cue.mood,
        "key": cue.key,
        "bpm": cue.bpm,
        "timeSignature": f"{cue.time_sig[0]}/{cue.time_sig[1]}",
        "framesPerBeat30": round(frames_per_beat(cue.bpm), 4),
        "bars": cue.bars,
        "durationSec": round(n / SR, 6),
        "durationSamples": n,
        "sampleRate": SR,
        "loop": loop,
        "hits": [{"sec": round(s, 3), "frame30": int(round(s * 30)), "what": w} for s, w in cue.hits],
        "sections": [{"sec": round(s, 3), "name": w} for s, w in cue.sections],
        "motif": {
            "zoo": [{"form": s["form"], "mode": s["mode"], "part": s["part"], "startSec": s.get("startSec"), "pitches": s["pitches"], "ok": s["ok"]} for s in statements],
            "badger": [{"part": s["part"], "startSec": s.get("startSec"), "pitches": s["pitches"], "ok": s["ok"]} for s in badger],
        },
        "loudness": {
            "profile": cue.profile,
            "integratedLufs": lou.get("integrated", rep.get("integrated")),
            "shortTermMedianLufs": lou.get("shortTermMedian", rep.get("shortTermMedian")),
            "shortTermMaxLufs": lou.get("shortTermMax", rep.get("shortTermMax")),
            "lraLu": lou.get("lra", rep.get("lra")),
            "truePeakDbtp": lou.get("truePeak", rep.get("truePeak")),
        },
        "spectrum": {k: spec.get(k) for k in ("slopeDbPerOct", "harshnessDb", "mudDb", "boxinessDb", "voicePocketDb", "centroidHz")} if spec else None,
        "checks": {"pass": metrics.get("pass"), "failures": metrics.get("failures"), "warnings": metrics.get("warnings"),
                   "failed": [c["id"] for c in metrics.get("checks", []) if not c["pass"]]} if metrics else None,
        "file": delivered["file"],
        "format": delivered["format"],
        "bytes": delivered["bytes"],
        "description": cue.description,
        "usage": cue.usage,
        "instruments": cue.instruments,
        "selfReview": review,
        "licence": "Original composition (Zoora). Rendered from our own synthesis, VCSL (CC0) and MuseScore_General / FluidR3 (MIT) samples; see docs/AUDIO_LICENSES.md.",
    }


def manifest_entry(meta: dict) -> dict:
    keys = ("id", "title", "channel", "cueType", "mood", "key", "bpm", "durationSec", "durationSamples", "loop", "hits", "file", "format")
    out = {k: meta[k] for k in keys}
    out["integratedLufs"] = meta["loudness"]["integratedLufs"]
    out["shortTermMedianLufs"] = meta["loudness"]["shortTermMedianLufs"]
    out["truePeakDbtp"] = meta["loudness"]["truePeakDbtp"]
    out["profile"] = meta["loudness"]["profile"]
    out["metadata"] = meta["file"].rsplit(".", 1)[0] + ".json"
    return out


def write_manifest(path: Path, entries: dict) -> dict:
    """entries: {id: manifest_entry}. Existing entries for cues not rebuilt are kept."""
    path = Path(path)
    old = {}
    if path.exists():
        try:
            old = {e["id"]: e for e in json.loads(path.read_text(encoding="utf-8")).get("cues", [])}
        except (ValueError, KeyError):
            old = {}
    old.update(entries)
    doc = {
        "schema": SCHEMA_VERSION,
        "about": "Original music for The Zoo & Badger Show and Zoora AI. Paths are relative to public/ (use staticFile). "
                 "Beds loop seamlessly from loop.startSample to loop.endSample. Generated by scripts/audio/music/build.py.",
        "sampleRate": SR,
        "cues": [old[k] for k in sorted(old)],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    return doc
