"""Zoora AI (POV stories): the channel intro sting and four story beds.

Story beds: 75 BPM (24 frames per beat), 20 bars = 64.0 s, seamless loops, cinematic but restrained.
Shape: bars 0-7 base, 8-15 a second layer and the motif, 16-19 fullest then thinning into bar 0.
Keys: curious F lydian, tension D minor, ominous D phrygian, resolve D major, so a story can move
tension -> resolve as a lift to the parallel major, and every bed sits next to the show's D family.

The motif appears in every bed: augmented on vibes (curious), its tail on vibes and violins
(tension), four times slower on piano at D4/D5 with the tritone exposed (ominous), and in the major
form on vibes and violins (resolve). Every bed also has an UNDERSCORE version (`underscore=True`:
the motif statements muted) for use under the narration.

Critic round 1 (2026-11-24, measured under Zoo's voice, Kokoro im_nicola, F0 68-119 Hz): the motif
statements moved out of his F0 range (they were on low piano and celli, D2-D3), the bowed vibes
came down 6 dB in curious, the widest stems were narrowed (curious, resolve), tension and ominous
got mid-range carriers so they survive a phone speaker, the ominous drones run through the loop
seam, and the bus pocket moved to 1.25 and 2 kHz. The MuseScore celesta is gone (weak sample
provenance and a slow attack): the Zoora sting's motif is on hard-mallet vibraphone doubled by the
harp, the curious bed's on soft vibes.
"""

from __future__ import annotations

import numpy as np

from audiolib.core import note_number
from audiolib.midi import Score
from composer import instruments as I
from composer import motif
from composer import synths as S
from composer.cues import common as C
from composer.instruments import K
from composer.notation import grid
from composer.render import Arrangement, humanize_part, swell

BPM = 75
BARS = 20
SPB = 60.0 / BPM
LENGTH = BARS * 4 * SPB  # 64.0 s

ZK = {"frame": K["frame"], "fmute": K["frame_mute"], "shaker": K["shaker_down"], "shaker2": K["shaker_up"], "wood": K["wood"],
      "bdrum": K["bdrum"], "swell": K["swell_short"], "swell_long": K["swell_long"], "tom_lo": K["tom_low"], "tom_hi": K["tom_high"],
      "sus": K["sus_soft"], "tri": K["tri"], "xstick": K["xstick"], "hat": K["hat"]}


class Story:
    PARTS = ("piano", "harp", "celesta", "kalimba", "marimba", "glock", "vibes", "vibes_hard", "bowed", "bowed_drone", "pizz", "pizz_lo",
             "celli", "violas", "violins", "basses", "basses_trem", "violins_trem", "violas_trem", "celli_fast", "violas_fast", "pad", "sub",
             "pulse", "bass", "kick", "kit")

    def __init__(self, bpm: float = BPM, pocket: bool = True):
        self.s = Score(bpm=bpm, time_sig=(4, 4))
        for n in self.PARTS:
            self.s.part(n)
        self.p = self.s.parts
        self.pocket = pocket
        self.clips = []

    def b(self, bar: float) -> float:
        return bar * 4.0

    def drums(self, bar: float, rows: dict, vel=None):
        grid(self.p["kit"], self.b(bar), rows, {k: ZK[k] for k in rows}, vel)

    def finish(self, seed: str):
        s, P = self.s, self.p
        S.kick_tuning(s)
        humanize_part(P["piano"], s, timing_ms=8, drift_ms=4, velocity=4, seed=f"{seed}-piano", roll_ms=18)
        for n in ("harp", "celesta", "kalimba", "marimba", "glock", "vibes", "vibes_hard", "pizz", "pizz_lo", "celli_fast", "violas_fast", "pulse"):
            humanize_part(P[n], s, timing_ms=7, drift_ms=4, velocity=5, seed=f"{seed}-{n}")
        humanize_part(P["bass"], s, timing_ms=7, drift_ms=4, velocity=8, seed=f"{seed}-bass")
        for n in ("celli", "violas", "violins", "basses", "basses_trem", "violins_trem", "violas_trem", "bowed", "bowed_drone", "pad", "sub"):
            humanize_part(P[n], s, timing_ms=12, drift_ms=5, velocity=3, seed=f"{seed}-{n}")
        humanize_part(P["kit"], s, timing_ms=5, drift_ms=3, velocity=6, seed=f"{seed}-drums")
        humanize_part(P["kick"], s, timing_ms=4, drift_ms=3, velocity=4, seed=f"{seed}-drums")

    def tracks(self, faders: dict | None = None, widths: dict | None = None) -> list:
        """Mixer channels for every part with notes. `faders` / `widths` override by track name."""
        pk = self.pocket
        tr = [
            C.piano(fader=-2.0, plate=None, hall=-10.0, bright=1.5, pocket=pk),
            C.mallets("harp", I.harp(), fader=-5.0, pan=-0.25, hall=-9.0, hp=80.0, pocket=pk),
            C.mallets("celesta", I.CELESTA, fader=-8.0, pan=0.2, hall=-8.0, hp=300.0, pocket=pk),
            C.mallets("kalimba", I.kalimba(), fader=-9.0, pan=0.35, hall=-10.0, hp=200.0, pocket=pk),
            C.mallets("marimba", I.marimba(), fader=-9.0, pan=-0.3, hall=-10.0, hp=120.0, pocket=pk),
            C.mallets("glock", I.glock(), fader=-16.0, pan=0.3, hall=-9.0, hp=500.0, pocket=pk),
            C.vibes("vibes", fader=-7.0, pan=0.25, hall=-8.0, pocket=pk),
            C.vibes("vibes_hard", mallet="hard", fader=-6.0, pan=0.2, hall=-8.0, pocket=pk),
            C.mallets("bowed", I.vibes_bowed(), fader=-10.0, pan=-0.15, hall=-8.0, hp=250.0, pocket=pk),
            C.mallets("bowed_drone", I.vibes_bowed(), fader=-14.0, pan=0.1, hall=-8.0, hp=200.0, pocket=pk, width=0.6),
            C.strings("pizz", "violins", "pizz", fader=-9.0, pan=0.3, width=0.5, hall=-9.0, pocket=pk),
            C.strings("pizz_lo", "celli", "pizz", fader=-6.0, pan=-0.1, width=0.4, hall=-11.0, pocket=pk),
            C.strings("celli", "celli", "slow", expressive=True, fader=-8.0, pan=-0.15, width=0.7, pocket=pk),
            C.strings("violas", "violas", "slow", expressive=True, fader=-9.0, pan=0.2, width=0.7, pocket=pk),
            C.strings("violins", "violins", "slow", expressive=True, fader=-11.0, pan=-0.05, width=0.5, pocket=pk),
            C.strings("basses", "basses", "slow", expressive=True, fader=-9.0, width=0.3, pocket=pk),
            C.strings("basses_trem", "basses", "trem", fader=-11.0, width=0.3, pocket=pk),
            C.strings("violins_trem", "violins", "trem", fader=-14.0, pan=-0.1, width=0.5, pocket=pk),
            C.strings("violas_trem", "violas", "trem", fader=-13.0, pan=0.15, width=0.5, pocket=pk),
            C.strings("celli_fast", "celli", "fast", fader=-7.0, pan=-0.1, width=0.6, hall=-11.0, pocket=pk),
            C.strings("violas_fast", "violas", "fast", fader=-8.0, pan=0.15, width=0.6, hall=-10.0, pocket=pk),
            C.pad(fader=-14.0, cutoff=900.0, pocket=pk),
            C.sub(fader=-16.0),
            C.pulse(fader=-15.0, cutoff_hi=1600.0, pocket=pk),
            C.bass(fader=-6.0, t60=2.0, lp=C.BASS_LP_BED if pk else C.BASS_LP_BAND),
            *C.kick(fader=-9.0, f_end=50.0, gm_layer_db=None),
            *C.kit_tracks(perc=-15.0, toms=-11.0, bdrum=-8.0, cymbals=-13.0, hats=-14.0, pocket=pk),
        ]
        used = {n for n, p in self.p.items() if p.notes}
        out = [t for t in tr if (t.part or t.name) in used]
        for name, clip, fader, hall in self.clips:
            out.append(C.audio(name, clip, fader=fader, hall=hall))
        for t in out:
            if faders and t.name in faders:
                t.fader_db = faders[t.name]
            if widths and t.name in widths:
                t.width = widths[t.name]
        return out


# story beds are warm by nature (harp, low strings, pad): the bus takes 3.5 dB out of 300 Hz (the first
# renders read +6 dB mud), the voice pocket at 1.25 and 2 kHz (POCKET-FIX), and air above 6 kHz so warm
# never reads muffled
STORY_BUS = [C.PK(300, -3.5, 0.8), C.PK(550, -2.5, 0.9), *C.VOICE_POCKET, C.HS(6000, 3.0)]


def _cid(base: str, underscore: bool) -> str:
    return f"{base}-underscore" if underscore else base


# Critic round 2: on a phone speaker the curious bed lost 2.7-5.3 dB less than Zoo's voice does (its harp,
# kalimba and mallets sit where a phone is loudest; his voice's weight is under 300 Hz), so there it played
# 3-5 dB more forward against him than on headphones. It masters 1.5 LU under the other beds.
QUIET_BED_LUFS = -27.5
# Bus dips at 500 and 700 Hz for the beds whose low mids crowd Zoo's 630-800 Hz bands (critic round 2:
# the tension beds' 630/800 Hz SNR was 3.0-4.4 dB; with these the band-audibility index rose 0.023)
LOW_MID_DIP = (C.PK(700, -4.5, 1.0), C.PK(500, -2.0, 1.2))


def _bed(cid: str, st: Story, faders: dict, bus_eq=None, widths: dict | None = None, post_finish=None, tail: float = 10.0,
         target_lufs: float | None = None) -> Arrangement:
    st.finish(cid)
    if post_finish is not None:
        post_finish(st)
    return Arrangement(cid, st.s, LENGTH, st.tracks(faders, widths), preset="bed", loop=True, tail=tail, wrap=8.0, reverbs=C.reverbs(),
                       bus_eq=bus_eq or STORY_BUS, target_lufs=target_lufs)


def _arp(part, t: float, notes: str, step: float, vel: int, dur: float | None = None, accent: int = 6, transpose: int = 0):
    ns = notes.split()
    for i, n in enumerate(ns):
        part.note(note_number(n) + transpose, t + i * step, dur or step * 1.8, vel + (accent if i % 4 == 0 else 0))


# ------------------------------------------------------------------------------------------ curious

CURIOUS = [  # per 2 bars: harp arpeggio (8ths, played an octave up), bowed note, root
    ("F3 C4 G4 A4 B4 A4 G4 C4", "A5", "F2"),
    ("D3 A3 F4 C5 E5 C5 F4 A3", "C6", "D2"),
    ("Bb2 F3 C4 D4 E4 D4 C4 F3", "D6", "Bb1"),
    ("C3 G3 Bb3 D4 F4 D4 Bb3 G3", "D6", "C2"),
]  # bowed vibes sit high and glassy, clear of the narration's body


def curious(underscore: bool = False) -> Arrangement:
    """F lydian: a harp ostinato, bowed-vibes sustains, the motif augmented on soft vibes (F F C B A: the
    lydian B is the motif's #4; not in the underscore), kalimba and pizzicato from bar 8, marimba and
    shaker from bar 16. Critic round 1: the bowed vibes held a constant line at about 1 kHz under the
    voice (-6 dB now), and the stems were very wide (marimba, harp and pad narrowed)."""
    st = Story()
    P = st.p
    for bar in range(BARS):
        t = st.b(bar)
        sec = 0 if bar < 8 else (1 if bar < 16 else 2)
        arp, bowed, root = CURIOUS[(bar // 2) % 4] if bar < 16 else (CURIOUS[0] if bar < 18 else CURIOUS[3])
        if bar in (0, 1, 8, 9, 16, 17):
            arp = arp.replace("B4", "D5")  # the motif's C6 sounds here: no lydian B a minor ninth under it
        _arp(P["harp"], t, arp, 0.5, 52 if sec == 0 else 56, transpose=12)  # an octave up, out of the voice's body (first mix: +9 dB at 250-1000 Hz)
        if bar % 2 == 0:
            P["bowed"].note(bowed, t, 7.6, 60)
            P["pizz_lo"].note(root, t, 0.5, 70)
            P["pad"].note(note_number(root) + 12, t, 7.8, 40)
        if sec >= 1:
            # kalimba: sparse off-beat plucks, chord tones only (no 9ths or #11s against the harp)
            top = {"F2": ["A4", "C5", "F4"], "D2": ["A4", "D5", "F4"], "Bb1": ["D5", "F4", "Bb4"], "C2": ["G4", "C5", "F4"]}[root]
            for j, beat in enumerate((0.5, 1.75, 3.0) if bar % 2 == 0 else (1.0, 2.5)):
                P["kalimba"].note(top[j % len(top)], t + beat, 0.6, 58)
            P["pizz"].note(note_number(arp.split()[4]) + 12, t + 1.0, 0.3, 54)
            P["pizz"].note(note_number(arp.split()[6]) + 12, t + 3.0, 0.3, 50)
            st.drums(bar, {"fmute": "x.......o.o....." if bar % 2 == 0 else "x.....o.........", "shaker": "....x.......x..." if sec == 2 else "................"},
                     vel={"x": 54, "o": 38})
        if sec == 2 and bar < 19:
            for j, n in enumerate({"F2": "F5 A5 F5 A5", "C2": "C5 G5 Bb5 D6"}[root].split()):  # no C6 near the motif's B5
                P["marimba"].note(n, t + j * 1.0 + 0.5, 0.8, 50)
    if not underscore:
        motif.place(P["vibes"], st.b(0), "F5", mode="major", vel=62, stretch=2.0, last_dur=4.0)
        motif.place(P["vibes"], st.b(8), "F5", mode="major", vel=64, stretch=2.0, last_dur=4.0)
        motif.place(P["vibes"], st.b(16), "F5", mode="major", vel=58, stretch=2.0, last_dur=3.0)
    else:
        # critic round 2: the underscore kept the bowed-vibes A5-D6 sustains, 70 % of their note-time at
        # 1-4 kHz, under the voice (the weakest voice margin of all beds); the pad carries the sustain alone
        P["bowed"].notes = []
    P["glock"].note("A6", st.b(4), 2.0, 50)
    P["glock"].note("E6", st.b(12) + 2.0, 2.0, 46)
    # the harp narrowed (critic round 2: its A5 and G5 samples are decorrelated, 0.01-0.12 L/R correlation,
    # the motif version reached -0.26 in a 200 ms window) and, under speech, 3 dB quieter
    faders = {"bowed": -16.0, **({"harp": -8.0} if underscore else {})}
    return _bed(_cid("bed-story-curious", underscore), st, faders, widths={"marimba": 0.5, "harp": 0.3, "pad": 0.8},
                bus_eq=[C.PK(300, -3.5, 0.8), C.PK(550, -2.5, 0.9), C.PK(700, -2.0, 1.0), *C.VOICE_POCKET, C.HS(6000, 3.0)],
                target_lufs=QUIET_BED_LUFS)


# ------------------------------------------------------------------------------------------ tension

def tension(underscore: bool = False) -> Arrangement:
    """D minor: a celli ostinato in 8ths doubled an octave up by violas (fast bowing, so the tension
    survives a phone speaker), a ticking clock, low piano octaves; the pulse, violas tremolo and the
    motif's tail (on vibes, then violins; not in the underscore) from bar 8; high violins, tom rolls and a
    bass-drum swell from bar 16."""
    st = Story()
    P = st.p
    prog = ["D", "D", "Bb", "Bb", "G", "G", "A", "A"]
    ost = {"D": "D3 D3 A2 D3 D3 A2 Eb3 D3", "Bb": "D3 D3 Bb2 D3 D3 Bb2 F3 D3", "G": "D3 D3 G2 D3 Bb2 G2 A2 Bb2", "A": "C#3 C#3 A2 C#3 E3 A2 Bb2 A2"}
    for bar in range(BARS):
        t = st.b(bar)
        sec = 0 if bar < 8 else (1 if bar < 16 else 2)
        root = prog[bar % 8] if bar < 16 else ["D", "D", "Bb", "A"][bar - 16]
        if underscore:
            # critic round 2: the celli's G2-F3 eighths sat in Zoo's F0 band (39 % of their note-time in
            # 68-119 Hz, all of it in 85-180 Hz) for the whole loop; under speech the celli take the
            # ostinato an octave up (G3-F4), where the violas doubled it, and the violas rest
            _arp(P["celli_fast"], t, ost[root], 0.5, 56, dur=0.35, accent=10, transpose=12)
        else:
            _arp(P["celli_fast"], t, ost[root], 0.5, 58, dur=0.35, accent=10)
            _arp(P["violas_fast"], t, ost[root], 0.5, 50, dur=0.3, accent=8, transpose=12)  # the upper ostinato: phone presence
        if bar % 2 == 0:
            P["basses"].note({"D": "D2", "Bb": "Bb1", "G": "G1", "A": "A1"}[root], t, 7.8, 60)
            P["piano"].note({"D": "D2", "Bb": "Bb1", "G": "G1", "A": "A1"}[root], t, 3.0, 62)
            P["piano"].note({"D": "D1", "Bb": "Bb0", "G": "G1", "A": "A1"}[root], t, 3.0, 56)
        st.drums(bar, {"wood": "x...o...x...o..."}, vel={"x": 32, "o": 24})  # softer ticks (27 % of the bed's 1-4 kHz)
        if sec >= 1:  # the pulse an octave above its first writing: 196-294 Hz, out of Zoo's F0 band
            r = {"D": "D4", "Bb": "Bb3", "G": "G3", "A": "A3"}[root]
            for j in range(16):
                P["pulse"].note(note_number(r) + (12 if j % 8 == 4 else 0), t + 0.25 * j, 0.12, 44 if j % 4 == 0 else 32)
        if bar % 8 == 7:
            P["kit"].hit(K["swell_long"], st.b(bar + 1) - 4.0 / SPB, 60)
        if sec == 2:
            st.drums(bar, {"tom_lo": "x.......x...o.o." if bar % 2 else "x...............", "bdrum": "x..............."}, vel={"x": 56, "o": 40})
    trem = {"D": "F3 D4", "Bb": "F3 D4", "G": "G3 D4", "A": "E3 C#4"}  # violas tremolo follows the harmony, two bars at a time
    for b0 in range(8, 16, 2):
        for n in trem[prog[b0 % 8]].split():
            P["violas_trem"].note(n, st.b(b0), 7.8, 50)
    for b0, n in ((16, "A5"), (18, "Bb5")):
        P["violins"].note(n, st.b(b0), 7.8, 54)
    swell(P["violins"], st.b(16), st.b(17), 0, 50)
    swell(P["violins"], st.b(18), st.b(19.5), 50, 64)
    swell(P["violins"], st.b(19.5), st.b(20), 64, 0)
    swell(P["basses"], 0.0, 1.0, 40, 56)
    if not underscore:  # the motif out of Zoo's register (it was on piano D3 + D2 and celli D3)
        motif.place(P["vibes"], st.b(1) + 2.0, "D5", form="tail", vel=60, last_dur=3.5)
        motif.place(P["vibes"], st.b(9) + 2.0, "D5", form="tail", vel=62, last_dur=3.5)
        motif.place(P["violins"], st.b(8), "D5", vel=56, stretch=2.0, last_dur=6.0)
        swell(P["violins"], st.b(8), st.b(8.5), 0, 52)
        swell(P["violins"], st.b(11), st.b(12), 52, 0)
    return _bed(_cid("bed-story-tension", underscore), st, {"piano": -4.0, "celli_fast": -6.0, "violas_fast": -8.0, "vibes": -10.0},
                bus_eq=[*STORY_BUS, *LOW_MID_DIP])


# ------------------------------------------------------------------------------------------ ominous

def ominous(underscore: bool = False) -> Arrangement:
    """D phrygian, dark and slow: bass drones, a heartbeat on the muted frame drum (with a 600-900 Hz skin
    click), low piano octaves with the tritone, bowed-vibes dissonances over a soft bowed D4/A4 drone,
    the motif four times slower on piano at D4/D5 (bars 4-7 and 12-15; not in the underscore), a long
    cymbal swell into each 8-bar section.

    Critic round 1: its centroid was 164 Hz, so it lost 9.2 LU on a phone (the drones and heartbeat
    vanished): the bowed drone, the saturated tremolo basses and the skin click carry it into the
    phone's range. The drones are re-bowed on bars 4, 8 and 12, and the bar-16 drones last 8 bars,
    through the loop seam, so nothing re-attacks at bar 0 (the seam was the loop's largest step)."""
    st = Story()
    P = st.p
    for bar in range(BARS):
        t = st.b(bar)
        sec = 0 if bar < 8 else (1 if bar < 16 else 2)
        st.drums(bar, {"fmute": "x..o............" if bar % 2 == 0 else "x..o........x..o"}, vel={"x": 52, "o": 36})
        if bar % 4 == 0 and bar > 0:
            span = 31.8 if bar == 16 else 15.8  # bar 16 rings through the seam into bars 0-3
            P["basses_trem"].note("D2", t, span, 54)
            P["sub"].note("D1", t, span - 0.2, 50)
            P["pad"].note("D3", t, span - 0.2, 40)
            P["pad"].note("F3", t, span - 0.2, 34)  # no fifth: the tritone (A-flat) in the piano is the colour
        if bar % 4 == 2:  # the bowed drone is re-bowed mid-phrase (bars 2, 6, ... 18), overlapping, never on bar 0
            for n, v in (("D4", 44), ("A4", 38)):
                P["bowed_drone"].note(n, t, 16.4, v)
        if bar % 4 == 2:
            P["piano"].note("Ab2", t + 2.0, 3.0, 50)
            P["piano"].note("Ab1", t + 2.0, 3.0, 52)
        if bar % 4 == 0 and bar > 0:
            P["piano"].note("D2", t, 4.0, 58)
            P["piano"].note("D1", t, 4.0, 52)
        if sec >= 1 and bar % 4 == 1:
            P["bowed"].note("Eb5" if bar % 8 == 1 else "A4", t, 11.0, 54)
        if sec == 2:
            P["violins_trem"].note("D6" if bar < 18 else "Eb6", t, 3.9, 40)
    if not underscore:  # the motif up at D4 + D5 (it was D3 + D2, inside Zoo's F0 range)
        for b0 in (4, 12):
            motif.place(P["piano"], st.b(b0), "D4", vel=56, stretch=4.0, last_dur=6.0, octaves=(0, 12))
    P["kit"].hit(K["swell_long"], st.b(8) - 4.0 / SPB, 54)
    P["kit"].hit(K["swell_long"], st.b(16) - 4.0 / SPB, 58)
    P["kit"].hit(K["bdrum"], st.b(8), 50)
    P["kit"].hit(K["bdrum"], st.b(16), 54)
    P["glock"].note("Eb6", st.b(6) + 1.0, 3.0, 40)

    def skin_clicks(story):
        """A short 600-900 Hz skin click under each heartbeat hit (after humanising, so it lands on them)."""
        hits = [n for n in story.p["kit"].notes if n.pitch == K["frame_mute"]]
        story.clips.append(("heart_skin", heartbeat_skin([(story.s.seconds(n.start), n.vel) for n in hits], LENGTH + 10.0), -11.0, None))

    # phone balance (measured after the first round-1 render: still 8.4 LU lost against the critic's 6):
    # the parts a phone cannot play come down (the concert bass drum -6 dB, toms -4, the low piano
    # octaves -2, the tremolo basses -2), the mid-range carriers come up (the bowed drone and the skin
    # click +4), and the bus takes 3 dB off below 150 Hz, which also leaves Zoo's F0 band clearer
    arr = _bed(_cid("bed-story-ominous", underscore), st, {"piano": -5.0, "bowed": -12.0, "violins_trem": -16.0, "pad": -15.0, "bdrum": -14.0,
                                                           "toms": -15.0, "bowed_drone": -10.0, "basses_trem": -13.0},
               bus_eq=[*STORY_BUS, C.LS(150, -3.0)], post_finish=skin_clicks, tail=16.0)
    for t in arr.tracks:
        if t.name == "basses_trem":  # some upper partials from the drone (phone speakers start around 350 Hz)
            t.sat = {"drive_db": 6.0, "kind": "tanh", "mix": 0.3}
        if t.name == "heart_skin":
            t.eq = [C.HP(450, 2), C.LP(1400, 2)]
            t.width = 0.3
    return arr


def heartbeat_skin(hits, length: float) -> np.ndarray:
    """Stereo clip: for each (seconds, velocity) a 600-900 Hz skin click, a band-passed noise tick
    with a damped 750 Hz partial, about 25 ms long, scaled by velocity. Seeded, deterministic."""
    from audiolib import synth
    from audiolib.core import SR

    n = int(round(length * SR))
    out = np.zeros(n)
    k = int(0.04 * SR)
    tt = np.arange(k) / SR
    for i, (sec, vel) in enumerate(hits):
        s0 = int(round(sec * SR))
        if s0 >= n:
            continue
        nz = synth.svf(synth.noise(k, "white", f"skin-{i}"), 750.0, 1.4, "bandpass")
        tone = np.sin(2 * np.pi * 750.0 * tt) * 0.6
        click = (nz + tone) * np.exp(-tt / 0.008) * np.minimum(1.0, tt / 0.0008)
        m = min(k, n - s0)
        out[s0 : s0 + m] += click[:m] * (vel / 127.0) ** 1.4
    pk = float(np.max(np.abs(out))) or 1.0
    out /= pk
    return np.vstack([out, out])


# ------------------------------------------------------------------------------------------ resolve

RESOLVE = [  # one bar each: piano arpeggio (8ths), bass root, string voicing (violas, celli)
    ("D3 A3 E4 F#4 A4 F#4 E4 A3", "D2", ("F#3 A3", "D3")),
    ("C#3 A3 E4 A4 C#5 A4 E4 A3", "C#2", ("E3 A3", "A2")),
    ("B2 F#3 D4 A4 C#5 A4 D4 F#3", "B1", ("D3 F#3", "B2")),
    ("G2 D3 A3 B3 F#4 B3 A3 D3", "G1", ("D3 B3", "G2")),
    ("E2 B2 G3 D4 F#4 D4 G3 B2", "E2", ("G3 B3", "E3")),
    ("A2 E3 G3 B3 D4 B3 G3 E3", "A1", ("G3 D4", "A2")),
    ("F#2 D3 A3 D4 F#4 D4 A3 D3", "F#2", ("A3 D4", "D3")),
    ("G2 D3 A3 B3 F#4 B3 A3 D3", "G1", ("B3 D4", "G2")),
]


def resolve(underscore: bool = False) -> Arrangement:
    """D major, a lift: piano arpeggios, the major motif (D D A G# F#) on piano and vibes, strings from bar 8,
    a gentle kick-and-shaker pulse, violins and a harp lift in bars 16-19, which turn back towards bar 0.
    | Dmaj9 | A/C# | Bm9 | Gmaj7#11 | Em9 | A7sus4 | D/F# | Gmaj9 |"""
    st = Story()
    P = st.p
    for bar in range(BARS):
        t = st.b(bar)
        sec = 0 if bar < 8 else (1 if bar < 16 else 2)
        idx = bar % 8 if bar < 16 else [7, 4, 5, 5][bar - 16]
        arp, root, (va, vc) = RESOLVE[idx]
        if bar in (0, 8):
            arp = "D3 A3 E4 F#4 B4 F#4 E4 A3"  # the motif's G#5 sounds here: B instead of A on top
        elif bar == 10:
            arp = "B2 F#3 D4 B4 C#5 B4 D4 F#3"
        _arp(P["piano"], t, arp, 0.5, 54 if sec == 0 else 58, dur=0.9, transpose=12)  # an octave up, clear of the narration's body
        P["piano"].sustain(t + 0.05, t + 3.9)
        P["bass"].note(root, t, 3.6, 66 if sec else 58)
        if sec >= 1:
            for n in va.split():
                P["violas"].note(n, t, 3.95, 56)
            P["celli"].note(vc, t, 3.95, 58)
            st.drums(bar, {"shaker": "x.x.x.x.x.x.x.x."}, vel={"x": 40})
            P["kick"].hit(36, t, 60)
            P["kick"].hit(36, t + 2.0, 48)
        for n in va.split():  # the pad doubles the violas' voicing, chord by chord
            P["pad"].note(n, t, 3.95, 34)
    swell(P["celli"], st.b(8), st.b(9), 0, 54)
    swell(P["violas"], st.b(8), st.b(9), 0, 50)
    swell(P["celli"], st.b(19), st.b(20), 60, 30)
    swell(P["violas"], st.b(19), st.b(20), 56, 28)
    for bar, n in ((16, "B5"), (17, "B5"), (18, "C#6"), (19, "A5")):
        P["violins"].note(n, st.b(bar), 3.95, 56)
    swell(P["violins"], st.b(16), st.b(17), 0, 56)
    swell(P["violins"], st.b(19), st.b(20), 60, 0)
    for k, n in enumerate(("D4", "E4", "F#4", "A4", "B4", "D5", "E5", "F#5", "A5", "B5")):
        P["harp"].note(n, st.b(16) + 0.05 * k, 2.0, 60 + k)
    if not underscore:
        motif.place(P["vibes"], st.b(0), "D5", mode="major", vel=62, stretch=1.5, last_dur=3.0)
        motif.place(P["vibes"], st.b(8), "D5", mode="major", vel=66, stretch=1.5, last_dur=3.0)
        motif.place(P["violins"], st.b(10), "D5", mode="major", vel=58, stretch=1.5, last_dur=2.5)  # over Bm9 (the G# is its dorian 6th)
    # critic round 1: mono correlation 0.43 with anti-phase windows (the piano stem's L/R correlation was 0.01)
    return _bed(_cid("bed-story-resolve", underscore), st, {"piano": -3.0, "vibes": -9.0, "bass": -8.0}, widths={"piano": 0.6, "harp": 0.7})


# ------------------------------------------------------------------------------------------ intro sting

ZOORA_HIT = 54 / 30.0  # src/branding ZooraSting: the nodes pop, the teal accent lands (frame 54)
ZOORA_WORD = 70 / 30.0  # the wordmark draws (frame 70)
ZOORA_TAG = 78 / 30.0  # the tag line (frame 78)
ZOORA_STING_SEC = 4.5  # the jingle's length (the sting's duration follows it, 3-5 s)
# the hand damp on the bass drum and cymbal: (seconds, dB), 45 dB down over 0.9 s from 3.2 s
ZOORA_DAMP = ((3.2, 0.0), (4.1, -45.0))


def zoora_intro_sting() -> Arrangement:
    """F lydian, 100 BPM (0.6 s a beat): a shimmer rises from frame 6 (the bell draws), the major motif
    lands on the logo hit at 1.80 s (beat 3), two soft notes under the wordmark and tag, fades by 4.0 s.
    The motif is on hard-mallet vibraphone doubled by the harp, over the soft vibes (critic round 1: the
    MuseScore celesta peaked 34 ms late, a frame behind frame 78, and its sample credit is weak)."""
    st = Story(bpm=100.0, pocket=False)
    P = st.p
    hit = ZOORA_HIT / 0.6  # beats
    # rising shimmer: harp from frame 6, tremolo violins swelling into the hit, a reversed piano bloom
    for k, n in enumerate(("F3", "A3", "C4", "G4", "A4", "C5", "G5", "A5")):  # Fadd9 rising: nothing rubs against the motif's F and C
        P["harp"].note(n, 0.33 + 0.18 * k, 1.0, 46 + 3 * k)
    for n in ("A4", "C5"):
        P["violins_trem"].note(n, 0.2, hit - 0.2 + 1.2, 60)
    src = S.sampled_chord(I.piano("kawai"), ["F2", "C3", "A3", "E4", "G4", "B4"], 1.6, vel=74, length_s=5.0)
    st.clips.append(("bloom", S.reverse_swell(src, ZOORA_HIT + 0.03, room="hall", curve=2.2), -12.0, -12.0))
    # the motif (major, lydian #4 = B) on hard vibes, the harp and soft vibes: it lands on the hit
    motif.place(P["vibes_hard"], hit - 2.0, "F5", mode="major", vel=80, last_dur=2.2)
    motif.place(P["harp"], hit - 2.0, "F5", mode="major", vel=72, last_dur=2.2, statement="sting-harp")
    motif.place(P["vibes"], hit - 2.0, "F5", mode="major", vel=70, last_dur=2.2)
    # the hit: Fmaj9#11 bloom. Critic round 2: at 4.0 s every band was still at -25 to -35 dB and the last
    # 0.25 s faded it out (a truncation), so the bloom is released by 3.3 s (pedal, strings, sub) and the
    # file runs 4.5 s (the sting allows 3-5 s; its picture holds and fades to black with the jingle)
    for n in ("F2", "C3", "A3", "G4"):  # Fadd9: no E under the celesta's F6
        P["piano"].note(n, hit, 2.4, 72)
    P["piano"].sustain(hit + 0.03, hit + 2.5)
    for n in ("F2", "C3"):
        P["celli"].note(n, hit, 2.6, 70)
    for n in ("A3", "C4"):
        P["violas"].note(n, hit, 2.6, 64)
    P["violins"].note("A5", hit, 2.6, 60)
    swell(P["celli"], hit, hit + 0.05, 0, 72)
    swell(P["violas"], hit, hit + 0.05, 0, 64)
    swell(P["violins"], hit, hit + 0.3, 0, 58)
    for name in ("celli", "violas", "violins"):
        swell(P[name], hit + 1.0, hit + 2.5, 70, 0)
    P["sub"].note("F1", hit, 2.2, 70)
    P["kit"].hit(K["bdrum"], hit, 72)
    P["kit"].hit(K["sus_soft"], hit, 70)
    P["glock"].note("A6", hit, 1.5, 60)
    # under the wordmark and the tag line (hard vibes and harp: instant attacks, on frames 70 and 78). The
    # frame-70 C6 is 12 velocity firmer (critic round 2: it did not rise in its own band, -1.4 dB at
    # 0.9-1.6 kHz, while frame 78's F6 rose 11.5 dB)
    for n, at, d, v in (("C6", ZOORA_WORD, 1.2, 76), ("F6", ZOORA_TAG, 1.2, 60)):
        P["vibes_hard"].note(n, at / 0.6, d, v)
        P["harp"].note(n, at / 0.6, d, v - 6)
    st.finish("intro-sting-zoora")
    from composer.render import STING_CEILING_DBTP

    # the harp at width 0.3 (critic round 2: its A5 and F6 samples are decorrelated, 0.09 and 0.03 L/R
    # correlation, and lost up to 3.7 dB in mono)
    arr = Arrangement("intro-sting-zoora", st.s, ZOORA_STING_SEC, st.tracks({"vibes_hard": -5.0, "vibes": -8.0, "harp": -6.0}, widths={"harp": 0.3}),
                      preset="sting", reverbs=C.reverbs(), fade_out=0.3, bus_eq=[C.PK(300, -1.0, 0.9), C.PK(4500, 1.5, 0.7), C.HS(9000, 1.5)],
                      ceiling_dbtp=STING_CEILING_DBTP)
    # the concert bass drum and the suspended cymbal are one-shot samples that ring for seconds: with the
    # bloom released they were all that sounded at 4.2 s (bass drum -39 dBFS, cymbal -43, 11-17 dB under
    # their hit), so the final fade still cut them. A player damps both by hand: ZOORA_DAMP
    for t in arr.tracks:
        if t.name in ("bdrum", "cymbals"):
            t.ride = list(ZOORA_DAMP)
    return arr
