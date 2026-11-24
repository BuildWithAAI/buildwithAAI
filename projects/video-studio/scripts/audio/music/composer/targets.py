"""The music package's pass/fail targets: the engine's (scripts/audio/targets.json) plus these changes.

- bed: the voice-referenced gate replaces `spectrum.voicePocketDb` as the fail check (critic round 1:
  the pocket was measured against the bed's own tilt and passed beds that masked Zoo's voice more than
  speech-shaped noise does). `voice.index` (>= 0.75, the minimum over several narrations since critic
  round 2) comes from composer/voicegate.py; `voice.indexMinusSsn` is reported (severity "info") and
  the pocket number stays as a warning. The bed loudness window opens to -28 LUFS-S for the beds that
  master 1.5 LU under the others (phone balance).
- endscreen: the end-screen music with nobody speaking, -18 LUFS-I (the standalone checks, at -18).
- standalone and endscreen: `aac.truePeak128k` <= -1.0 dBTP after an AAC 128 kb/s encode (critic round
  1: the theme mastered at -1.3 dBTP read -0.3 after AAC); stings report it as a warning (-0.5).
  The value is the worst of several encodes: ffmpeg's AAC encoder at 128 kb/s is chaotic on dense,
  bright material. Measured on theme-15s, copies that differ only in their last-bit dither read from
  -1.9 to +0.2 dBTP (its quantisation noise, not the master's peaks; Opus 128k read -1.5 on all of
  them), so one encode can pass a file that the next would fail.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

from audiolib import paths
# the AAC check lives in the engine (audiolib/codec.py; metrics.py computes it when a profile asks for
# aac.truePeak128k): these names stay for the music package's callers
from audiolib.codec import AAC_VARIANTS, aac_true_peak, aac_true_peak_stats  # noqa: F401

VOICE_CHECKS = [
    {"id": "voice.index", "min": 0.75, "severity": "fail",
     "why": "band-audibility index of Zoo's narration over the bed with the planned band-split duck: the minimum over the narrations in "
            "voiceref/ (composer/voicegate.py)"},
    {"id": "voice.indexMinusSsn", "min": 0.0, "severity": "info",
     "why": "information only: against speech-shaped noise at the same loudness (critic round 2: structurally easy with a split duck)"},
]
QUIET_BED_MIN_LUFS = -28.0  # the engine's bed window is -27 to -25 LUFS-S; the curious bed masters at -27.5 (phone balance)
AAC_FAIL = {"id": "aac.truePeak128k", "max": -1.0, "severity": "fail", "why": "true peak after AAC 128 kb/s (YouTube re-encodes): lossy overshoot must stay under -1 dBTP"}
AAC_WARN = {"id": "aac.truePeak128k", "max": -0.5, "severity": "warn", "why": "true peak after AAC 128 kb/s (YouTube re-encodes)"}


def music_targets(engine: dict | None = None) -> dict:
    """The engine's targets with the music package's changes applied (a new dict)."""
    if engine is None:
        engine = json.loads(Path(paths.TARGETS).read_text(encoding="utf-8"))
    t = copy.deepcopy(engine)
    prof = t["profiles"]
    for c in prof["bed"]["checks"]:
        if c["id"] == "spectrum.voicePocketDb":
            c["severity"] = "warn"
            c["why"] = "1-4 kHz against the bed's own tilt; reported only: the voice gate (voice.index) is the fail check"
    prof["bed"]["checks"] += copy.deepcopy(VOICE_CHECKS)
    for c in prof["bed"]["checks"]:
        if c["id"] == "loudness.shortTermMedian":
            c["min"] = QUIET_BED_MIN_LUFS
            c["why"] = "-26 LUFS-S, or -27.5 for a bed that a phone speaker would otherwise push forward (composer/cues/zoora.py QUIET_BED_LUFS)"
    end = copy.deepcopy(prof["standalone"])
    end["description"] = "end-screen music with nobody speaking (-18 LUFS-I)"
    for c in end["checks"]:
        if c["id"] == "loudness.integrated":
            c.update({"min": -18.5, "max": -17.5, "why": "-18 LUFS-I: 4 LU under -14 LUFS narration, music on its own under an end screen"})
    end["checks"].append({"id": "silence.tailEndDbfs", "max": -60.0, "severity": "fail", "why": "it ends with the video: a clean ending, not a cut"})
    prof["endscreen"] = end
    prof["standalone"]["checks"].append(dict(AAC_FAIL))
    prof["endscreen"]["checks"].append(dict(AAC_FAIL))
    prof["sting"]["checks"].append(dict(AAC_WARN))
    return t


def write_targets(path: Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(music_targets(), indent=2) + "\n", encoding="utf-8")
    return path

