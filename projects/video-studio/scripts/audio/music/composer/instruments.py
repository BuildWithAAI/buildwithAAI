"""The palette (licences: docs/AUDIO_LICENSES.md). Samplers are cached singletons, so the converted
(pitch-shifted, 48 kHz) samples are reused across cues in one build.

VCSL (CC0), real recordings:
    piano("kawai" | "steinway" | "upright"), vibes("soft" | "hard"), vibes_bowed(), marimba(), glock(),
    harp(), bells(), kalimba(), drum pieces (snares, cross-stick, hi-hats, claps, shakers, tambourine,
    suspended cymbals and swells, toms, frame drum, concert bass drum, woodblock, triangle)
MuseScore_General (MIT; the strings are VSCO 2 CE samples, CC0), rendered by fluidsynth:
    strings(section, articulation, expressive=False) -> GM; CELESTA; GM_KICK
Our synthesis (composer.synths): electric piano, pad, pulse, brass stab, sub, kick, swells.

VCSL file names that do not follow the engine's v<N>/rr<N> convention (marimba "loud_01", glockenspiel
"medium_G5_01", harp "f1"/"mf1") are indexed with `bank(..., layer_words=...)`.
"""

from __future__ import annotations

import re
from functools import lru_cache

from audiolib import paths
from audiolib.core import note_number
from audiolib.midi import GM
from audiolib.sampler import Kit, SampleBank, Sampler, Zone, parse_name

# ------------------------------------------------------------------------------------------ banks

_NOTE = re.compile(r"^([A-Ga-g])(#|b)?(-?\d)$")


def bank(rel, include: str | None = None, exclude: str | None = None, layer_words: dict | None = None,
         keep_layers=None, octave: int = 0, tune: bool | str = False) -> SampleBank:
    """Index a VCSL folder. With `layer_words` ({"soft": 1, "med": 2, "loud": 3}), a word token sets
    the velocity layer and a bare number token is the round robin. `keep_layers` drops other layers
    (use it when only some layers cover every root, or the sampler would jump between distant roots).

    `octave` corrects the file-name convention: several VCSL sets name middle C "C3" (the Yamaha
    convention), so their samples sound an octave above the label. Measured here (harmonic product
    spectrum, every sample): Kawai grand +11.98, Yamaha upright +12.00, vibraphone +12.00, bowed
    vibraphone +12.00, marimba +11.99, glockenspiel +12.12, kalimba +12 (strongest partial) semitones;
    the Steinway B and the concert harp use the standard convention (0).

    `tune` measures each sample's actual pitch and uses that (fractional) root, for sets that are not
    tuned to A440 equal temperament (measured_root): True or "harmonic" for harmonic instruments
    (piano, harp: several partials, a +-1.5 semitone search, so a mislabelled sample is caught),
    "peak" for bars and tines (glockenspiel, kalimba: their overtones are not harmonic, so only the
    strongest peak within a semitone of the label is used)."""
    folder = paths.vcsl_dir(*rel) if isinstance(rel, (tuple, list)) else paths.vcsl_dir(rel)
    files = sorted(folder.rglob("*.wav"))
    if include:
        files = [f for f in files if re.search(include, f.name)]
    if exclude:
        files = [f for f in files if not re.search(exclude, f.name)]
    if not files:
        raise FileNotFoundError(f"no samples in {folder} for include={include!r} exclude={exclude!r}")
    zones = []
    for f in files:
        if not layer_words:
            zones.append(parse_name(f))
            continue
        root = None
        layer = 1
        rr = 1
        art = []
        for tok in f.stem.split("_"):
            m = _NOTE.match(tok)
            if m and root is None:
                root = note_number(m.group(1).upper() + (m.group(2) or "") + m.group(3))
                continue
            lw = re.match(r"^([a-z]+)(\d*)$", tok)
            if lw and lw.group(1) in layer_words:
                layer = layer_words[lw.group(1)]
                if lw.group(2):
                    rr = int(lw.group(2))
                continue
            if tok.isdigit():
                rr = int(tok)
                continue
            art.append(tok)
        zones.append(Zone(f, root, layer, rr, "_".join(art)))
    if keep_layers is not None:
        zones = [z for z in zones if z.layer in set(keep_layers)]
    if tune not in (False, True, "harmonic", "peak"):
        raise ValueError(f"tune must be False, True, 'harmonic' or 'peak', not {tune!r}")
    if octave or tune:
        method = "harmonic" if tune is True else tune
        fixed = []
        for z in zones:
            if z.root is None:
                fixed.append(z)
                continue
            root = z.root + octave
            if tune:
                root = measured_root(str(z.path), root, method)
            fixed.append(Zone(z.path, root, z.layer, z.rr, z.articulation))
        zones = fixed
    return SampleBank(zones)


# measured_root(method="harmonic"): the partials that set the pitch. Under C3 a piano's or harp's
# fundamental is weak (the Kawai's C1 and C2 strings: 25-40 dB under their 2nd-4th partials), so the
# pitch comes from partials 2-4, as the ear hears it (critic round 2); from C3 up, from partials 1-3.
LOW_REGISTER_MIDI = 48
PARTIALS_LOW = (2, 3, 4)
PARTIALS_HIGH = (1, 2, 3)
PARTIAL_RANGE_DB = 15.0  # partials more than this under the strongest one are not used
SEARCH_CENTS = 150.0  # coarse search half-width: a sample a semitone off its label is still found


def _spectrum(path: str, start_s: float = 0.03, dur_s: float = 1.0, min_s: float = 0.25):
    """Magnitude spectrum (zero-padded to about 0.05 Hz bins) of `dur_s` from just after the onset."""
    import numpy as np
    import soundfile as sf

    x, sr = sf.read(path, always_2d=True)
    m = x.mean(axis=1)
    if not np.any(m):
        return None
    i = int(np.argmax(np.abs(m) > 0.05 * np.abs(m).max()))
    seg = m[i + int(start_s * sr): i + int((start_s + dur_s) * sr)]
    if seg.size < int(min_s * sr):
        return None
    n = 1 << int(np.ceil(np.log2(sr / 0.05)))
    return np.fft.rfftfreq(n, 1.0 / sr), np.abs(np.fft.rfft(seg * np.hanning(seg.size), n))


def _peak(f, spec, fc: float, half_cents: float):
    """(frequency, dB) of the strongest bin within +-half_cents of fc, with parabolic interpolation."""
    import numpy as np

    a = int(np.searchsorted(f, fc * 2 ** (-half_cents / 1200)))
    b = int(np.searchsorted(f, fc * 2 ** (half_cents / 1200)))
    if b - a < 3 or b >= spec.size - 1:
        return None
    j = a + int(np.argmax(spec[a:b]))
    y0, y1, y2 = 20 * np.log10(spec[j - 1: j + 2] + 1e-20)
    d = y0 - 2 * y1 + y2
    p = 0.5 * (y0 - y2) / d if d != 0 else 0.0
    return (j + p) * (f[1] - f[0]), y1 - 0.25 * (y0 - y2) * p


def harmonic_cents(path: str, nominal: float):
    """The sample's pitch in cents relative to `nominal` (MIDI), or None. Two stages:
    1. coarse: the f0 within +-SEARCH_CENTS whose first eight harmonics (each within +-20 cents, so a
       piano's stretched partials still count) carry the most level (dB above a -60 dB floor);
    2. fine: partials 2-4 (under C3) or 1-3 at that f0, each located to a fraction of a cent; those
       within PARTIAL_RANGE_DB of the strongest are averaged, weighted by power."""
    import numpy as np

    sp = _spectrum(path)
    if sp is None:
        return None
    f, spec = sp
    db = 20 * np.log10(spec + 1e-20)
    level = np.maximum(db - (float(db.max()) - 60.0), 0.0)
    f_nom = 440.0 * 2 ** ((nominal - 69) / 12)
    df = f[1] - f[0]
    best = None
    for c in np.arange(-SEARCH_CENTS, SEARCH_CENTS + 0.5, 1.0):
        f0 = f_nom * 2 ** (c / 1200)
        score = 0.0
        for k in range(1, 9):
            a = int(k * f0 * 2 ** (-20 / 1200) / df)
            b = int(k * f0 * 2 ** (20 / 1200) / df) + 1
            if b >= spec.size:
                break
            score += float(level[a:b].max())
        if best is None or score > best[0]:
            best = (score, c)
    f0 = f_nom * 2 ** (best[1] / 1200)
    ks = PARTIALS_LOW if nominal < LOW_REGISTER_MIDI else PARTIALS_HIGH
    found = []
    for k in ks:
        pk = _peak(f, spec, k * f0, 25.0)
        if pk is not None:
            found.append((1200 * np.log2(pk[0] / (k * f_nom)), pk[1]))
    if not found:
        return float(best[1])
    strongest = max(lv for _, lv in found)
    use = [(c, 10 ** ((lv - strongest) / 10)) for c, lv in found if lv >= strongest - PARTIAL_RANGE_DB]
    return float(sum(c * w for c, w in use) / sum(w for _, w in use))


@lru_cache(maxsize=None)
def measured_root(path: str, nominal: float, method: str = "peak") -> float:
    """The sample's actual pitch as a fractional MIDI root (`nominal` when nothing is found):
    "harmonic" (harmonic_cents: pianos and harps) or "peak" (peak_cents: bars and tines)."""
    if method == "harmonic":
        c = harmonic_cents(path, nominal)
    elif method == "peak":
        c = peak_cents(path, nominal)
    else:
        raise ValueError(f"unknown method {method!r}")
    return float(nominal) if c is None else round(float(nominal) + c / 100.0, 3)


def peak_cents(path: str, nominal: float, search_semitones: float = 1.0):
    """Cents from `nominal` of the strongest spectral bin within +-search_semitones, over 1 s after
    the onset (a 2^17-point FFT), or None: for bars and tines, whose overtones are not harmonic. This
    is the round-1 measurement, unchanged, so the glockenspiel's and kalimba's roots (and their
    cached stems) stay the same."""
    import numpy as np
    import soundfile as sf

    x, sr = sf.read(path, always_2d=True)
    m = x.mean(axis=1)
    if not np.any(m):
        return None
    i = int(np.argmax(np.abs(m) > 0.05 * np.abs(m).max()))
    seg = m[i + int(0.03 * sr): i + int(1.03 * sr)]
    if seg.size < sr // 4:
        return None
    n = 1 << 17
    spec = np.abs(np.fft.rfft(seg * np.hanning(seg.size), n))
    f = np.fft.rfftfreq(n, 1.0 / sr)
    f0 = 440.0 * 2 ** ((nominal - 69) / 12)
    band = (f >= f0 * 2 ** (-search_semitones / 12)) & (f <= f0 * 2 ** (search_semitones / 12))
    if not band.any() or spec[band].max() <= 0:
        return None
    fp = float(f[band][np.argmax(spec[band])])
    return 100.0 * (69 + 12 * np.log2(fp / 440.0) - nominal)


ZITH = ("Chordophones", "Zithers")
STRUCK = ("Idiophones", "Struck Idiophones")
MEMB = ("Membranophones", "Struck Membranophones")


# ------------------------------------------------------------------------------------------ pitched

@lru_cache(maxsize=None)
def piano(kind: str = "kawai") -> Sampler:
    if kind == "kawai":
        root = (*ZITH, "Grand Piano, Kawai")
        # tune=True (critic round 2): the recording's bass is stretch-tuned (C1-D#2 strings 10-26 cents flat,
        # D4 13 cents flat), which beats against the exactly tuned bass and sub; and the file labelled
        # A#-1 sounds A0 (27.4 Hz), so a written B-flat 0 played a semitone low. Every sustain sample now
        # gets its measured root (harmonic_cents); the release noises keep their labels.
        return Sampler(bank((*root, "Sustains"), octave=12, tune=True), release_bank=bank((*root, "Releases"), octave=12), normalize_layers="per_zone",
                       velocity_power=1.6, release_gain_db=-22.0, damper=(0.5, 0.12, 88), seed="kawai")
    if kind == "steinway":
        root = (*ZITH, "Grand Piano, Steinway B")
        return Sampler(bank((*root, "NoSus")), pedal_bank=bank((*root, "Sus")), release_bank=bank((*root, "Rel")),
                       normalize_layers="per_zone", velocity_power=1.6, release_gain_db=-24.0, damper=(0.55, 0.12, 88), seed="steinway")
    if kind == "upright":
        root = (*ZITH, "Upright Piano, Yamaha")
        return Sampler(bank((*root, "Sustains"), octave=12), release_bank=bank((*root, "Releases"), octave=12), normalize_layers="per_zone",
                       velocity_power=1.5, release_gain_db=-20.0, damper=(0.4, 0.1, 88), seed="upright")
    raise ValueError(f"unknown piano {kind!r}")


@lru_cache(maxsize=None)
def vibes(mallet: str = "soft") -> Sampler:
    folder = {"soft": "Soft Mallets", "hard": "Hard Mallets"}[mallet]
    # motor off (VCSL "Main" mic); a long natural ring, so a short damper release keeps lines clean
    return Sampler(bank((*STRUCK, "Vibraphone", folder), octave=12), normalize_layers="per_zone", velocity_power=1.5,
                   damper=(0.35, 0.25, 127), seed=f"vibes-{mallet}")


@lru_cache(maxsize=None)
def vibes_bowed() -> Sampler:
    return Sampler(bank((*STRUCK, "Vibraphone", "Bowed"), octave=12), velocity_power=1.2, damper=(1.2, 1.0, 127), seed="vibes-bowed")


@lru_cache(maxsize=None)
def marimba() -> Sampler:
    return Sampler(bank((*STRUCK, "Marimba"), layer_words={"soft": 1, "med": 2, "loud": 3}, octave=12), normalize_layers="per_zone",
                   velocity_power=1.5, damper=(0.6, 0.4, 127), seed="marimba")


@lru_cache(maxsize=None)
def glock() -> Sampler:
    return Sampler(bank((*STRUCK, "Glockenspiel"), layer_words={"soft": 1, "medium": 2, "loud": 3}, octave=12, tune="peak"), normalize_layers="per_zone",
                   velocity_power=1.5, damper=(1.5, 1.5, 0), seed="glock")


@lru_cache(maxsize=None)
def harp() -> Sampler:
    # only the mf and f layers cover every root (p/mp exist for a few notes only). tune=True (critic round 2):
    # the samples are 1-30 cents flat (median -8 to -11 cents in the cues), and the harp doubles the vibes
    # (0 cents) in the Zoora jingle's motif, the One Fix lift and the curious ostinato: 3-7 Hz beating
    return Sampler(bank(("Chordophones", "Composite Chordophones", "Concert Harp"), layer_words={"p": 1, "mp": 2, "mf": 3, "f": 4},
                        keep_layers=(3, 4), tune=True), normalize_layers="per_zone", velocity_power=1.6, damper=(1.4, 0.8, 127), seed="harp")


@lru_cache(maxsize=None)
def bells() -> Sampler:
    return Sampler(bank((*STRUCK, "Tubular Bells 2"), octave=12), normalize_layers="per_zone", velocity_power=1.4, damper=(3.0, 3.0, 0), seed="bells")


@lru_cache(maxsize=None)
def kalimba() -> Sampler:
    return Sampler(bank(("Idiophones", "Plucked Idiophones", "Kalimba, Kenya"), octave=12, tune="peak"), velocity_power=1.5, damper=(0.8, 0.6, 127), seed="kalimba")


# ------------------------------------------------------------------------------------------ MuseScore (fluidsynth)

STRING_BANKS = {"violins": 20, "violins2": 25, "violas": 30, "celli": 40, "basses": 50, "ensemble": 0}
ARTICULATIONS = {"trem": 44, "pizz": 45, "fast": 48, "slow": 49}


def strings(section: str, articulation: str = "slow", expressive: bool = False) -> GM:
    """A VSCO 2 string section. expressive=True selects the CC2 bank (dynamics follow CC2, not velocity;
    use composer.render.cc_swell to write the curve). Pizzicato and tremolo have no CC2 variant for 'ensemble'."""
    b = STRING_BANKS[section]
    if expressive:
        b = 17 if b == 0 else b + 1
    return GM(ARTICULATIONS[articulation], bank=b, soundfont="musescore")


CELESTA = GM(8, soundfont="musescore")
GM_KIT = GM(0, bank=128, soundfont="musescore", drums=True)
BRUSH_KIT = GM(40, bank=128, soundfont="musescore", drums=True)


# ------------------------------------------------------------------------------------------ drums (VCSL)

# Kit keys (GM numbers where one exists, so MIDI exports read sensibly)
K = {
    "kick": 36, "xstick": 37, "snare": 38, "clap": 39, "tap": 40, "hat": 42, "hat_pedal": 44, "hat_open": 46,
    "hat_loose": 23, "tom_low": 45, "tom_high": 48, "crash": 49, "ride_bell": 53, "tamb": 54, "sus_soft": 55,
    "rim": 57, "shaker_down": 70, "shaker_up": 82, "wood": 76, "tri": 81, "frame": 60, "frame_mute": 61,
    "bdrum": 35, "swell_short": 90, "swell_long": 91, "snare_roll": 92, "solo_clap": 93, "cym_roll": 94, "scrape": 52,
}


def _one(rel, include=None, exclude=None, vp=1.3, norm=None, gain_db=0.0, **kw) -> Sampler:
    return Sampler(bank(rel, include=include, exclude=exclude, **kw), one_shot=True, velocity_power=vp, normalize_layers=norm, gain_db=gain_db)


@lru_cache(maxsize=None)
def kit(style: str = "tight") -> Kit:
    """VCSL drum kit (no kick: the kick is composer.synths.SynthKick, optionally layered with GM_KIT).
    style 'tight' = Modern 2 snare (main), 'warm' = Modern 1 snare."""
    snare_dir = (*MEMB, "Snare Drum, Modern 2") if style == "tight" else (*MEMB, "Snare Drum, Modern 1")
    prefix = "Snare3M" if style == "tight" else "Snare2"
    hh = (*STRUCK, "Hi-Hat Cymbal")
    pieces = {
        K["snare"]: _one(snare_dir, include=f"{prefix}_HitSN", vp=1.3, norm="per_zone"),
        K["tap"]: _one(snare_dir, include="taps", vp=1.4),
        K["xstick"]: _one((*MEMB, "Snare Drum, Modern 2"), include="Xstick", vp=1.2),
        K["rim"]: _one((*MEMB, "Snare Drum, Modern 3"), include="rimshot", vp=1.2),
        K["snare_roll"]: _one(snare_dir, include=f"{prefix}_rollSN", vp=1.2),
        K["hat"]: _one(hh, include="HitC", vp=1.4, norm="per_zone"),
        K["hat_pedal"]: _one(hh, include="Close", vp=1.3),
        K["hat_open"]: _one(hh, include="HitO_", vp=1.3),
        K["hat_loose"]: _one(hh, include="HitLoose", vp=1.3),
        K["clap"]: _one((*STRUCK, "Claps"), include=r"^Clap_rr", vp=1.2),
        K["solo_clap"]: _one((*STRUCK, "Claps"), include="SoloClap", vp=1.2),
        K["shaker_down"]: _one((*STRUCK, "Shaker, Small"), include="ShakerDouble_Down", vp=1.3),
        K["shaker_up"]: _one((*STRUCK, "Shaker, Small"), include="ShakerDouble_Up", vp=1.3),
        K["tamb"]: _one((*STRUCK, "Tambourine 1"), include="Hit", vp=1.3),
        K["crash"]: _one((*STRUCK, "Suspended Cymbal 1"), include=r"hit_stick_(mp|f)1", vp=1.2),
        K["sus_soft"]: _one((*STRUCK, "Suspended Cymbal 2"), include=r"hit_(pp|mp)1", vp=1.1),
        K["ride_bell"]: _one((*STRUCK, "Suspended Cymbal 2"), include=r"hit_bell_(p|f)1", vp=1.3),
        K["swell_short"]: _one((*STRUCK, "Suspended Cymbal 2"), include=r"cresc_2\.5s", vp=1.0),
        K["swell_long"]: _one((*STRUCK, "Suspended Cymbal 2"), include=r"cresc_4s", vp=1.0),
        K["cym_roll"]: _one((*STRUCK, "Suspended Cymbal 1"), include=r"roll_mp1_nloop", vp=1.0),
        K["scrape"]: _one((*STRUCK, "Suspended Cymbal 1"), include=r"scrape_1", vp=1.0),
        K["tom_low"]: _one((*MEMB, "Tom 2", "Stick"), include="HitS", vp=1.3, norm="per_zone"),
        K["tom_high"]: _one((*MEMB, "Tom 1", "Stick"), include="HitS", vp=1.3, norm="per_zone"),
        K["wood"]: _one((*STRUCK, "Woodblock"), include=r"wood_click_(pp|mp|f)", vp=1.3),
        K["tri"]: _one((*STRUCK, "Triangles"), include=r"Triangle1_Hit_v", vp=1.3),
        K["frame"]: _one((*MEMB, "Frame Drum"), include="HDrumL_Hit_", vp=1.4),
        K["frame_mute"]: _one((*MEMB, "Frame Drum"), include="HDrumL_HitMuted", vp=1.4),
        K["bdrum"]: _one((*MEMB, "Bass Drum 2"), include=r"bassdrum_hit_(pp|mp|mf|f)", vp=1.3),
    }
    return Kit(pieces, chokes=[[K["hat"], K["hat_pedal"], K["hat_open"], K["hat_loose"]]])


KIT_GROUPS = {
    "snare": {K["snare"], K["tap"], K["xstick"], K["rim"], K["snare_roll"]},
    "hats": {K["hat"], K["hat_pedal"], K["hat_open"], K["hat_loose"]},
    "claps": {K["clap"], K["solo_clap"]},
    "perc": {K["shaker_down"], K["shaker_up"], K["tamb"], K["wood"], K["tri"]},
    "cymbals": {K["crash"], K["sus_soft"], K["ride_bell"], K["swell_short"], K["swell_long"], K["cym_roll"], K["scrape"]},
    "toms": {K["tom_low"], K["tom_high"], K["frame"], K["frame_mute"]},
    "bdrum": {K["bdrum"]},
}
