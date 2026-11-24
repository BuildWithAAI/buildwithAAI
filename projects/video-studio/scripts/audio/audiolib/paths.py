"""Where things live, and the pinned soundfonts.

Every soundfont the engine may load is listed here with its Debian package, size and sha256
(verified by scripts/audio/setup.sh; `verify_soundfont` re-checks on demand) and its licence.
Licence evidence: docs/AUDIO_LICENSES.md.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path

AUDIO_DIR = Path(__file__).resolve().parents[1]  # scripts/audio
STUDIO = AUDIO_DIR.parents[1]  # projects/video-studio
CACHE = STUDIO / ".cache"
VCSL = Path(os.environ.get("AUDIO_VCSL_DIR", str(CACHE / "vcsl")))
OUT = STUDIO / "out" / "audio"
PUBLIC_AUDIO = STUDIO / "public" / "audio"
TARGETS = AUDIO_DIR / "targets.json"

VCSL_COMMIT = "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e"


@dataclass(frozen=True)
class SoundFont:
    key: str
    path: Path
    sha256: str
    size: int
    package: str
    licence: str
    note: str = ""


SOUNDFONTS = {
    "musescore-lossless": SoundFont(
        "musescore-lossless", Path("/usr/share/sounds/sf2/MuseScore_General_Full.sf2"),
        "59287cbb0f424ec76d1bc269eee40dfe0b02252588d72eb016b5d2382e710a8f", 489519900,
        "musescore-general-soundfont-lossless 0.2.1-1", "MIT (parts public domain / CC0)",
        "uncompressed MuseScore_General HQ 0.2.1"),
    "musescore-sf3": SoundFont(
        "musescore-sf3", Path("/usr/share/sounds/sf3/MuseScore_General_Full.sf3"),
        "f9a37b36655f23e167c66ec91bef6097c8e99be29286219a54062919eb41aeae", 85967114,
        "musescore-general-soundfont 0.2.1-1", "MIT (parts public domain / CC0)",
        "same instruments, Ogg Vorbis compressed samples"),
    "fluidr3": SoundFont(
        "fluidr3", Path("/usr/share/sounds/sf2/FluidR3_GM.sf2"),
        "74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0", 148398306,
        "fluid-soundfont-gm 3.1-5.3", "MIT", "FluidR3 GM by Frank Wen"),
}


def soundfont(key: str = "musescore") -> SoundFont:
    """'musescore' resolves to the lossless .sf2 when it is installed, else the .sf3."""
    if key == "musescore":
        key = "musescore-lossless" if SOUNDFONTS["musescore-lossless"].path.exists() else "musescore-sf3"
    try:
        sf = SOUNDFONTS[key]
    except KeyError:
        raise ValueError(f"unknown soundfont {key!r}; known: musescore, {', '.join(SOUNDFONTS)}") from None
    if not sf.path.exists():
        raise FileNotFoundError(f"{sf.path} is missing: run scripts/audio/setup.sh ({sf.package})")
    if sf.path.stat().st_size != sf.size:
        raise RuntimeError(f"{sf.path} is {sf.path.stat().st_size} bytes, pinned {sf.size}: run scripts/audio/setup.sh")
    return sf


def verify_soundfont(sf: SoundFont) -> bool:
    h = hashlib.sha256()
    with open(sf.path, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest() == sf.sha256


def vcsl_dir(*parts) -> Path:
    p = VCSL.joinpath(*parts)
    if not VCSL.exists():
        raise FileNotFoundError(f"VCSL is not at {VCSL}: run scripts/audio/setup.sh")
    if not p.exists():
        raise FileNotFoundError(f"{p} not found in VCSL {VCSL_COMMIT[:12]}")
    return p
