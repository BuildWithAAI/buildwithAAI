"""Zoora AI (POV stories): the channel intro sting and four story beds.

Story beds: 75 BPM (24 frames per beat), 20 bars = 64.0 s, seamless loops, cinematic but restrained.
Shape: bars 0-7 base, 8-15 a second layer and the motif, 16-19 fullest then thinning into bar 0.
Keys: curious F lydian, tension D minor, ominous D phrygian, resolve D major, so a story can move
tension -> resolve as a lift to the parallel major, and every bed sits next to the show's D family.

The motif appears in every bed: augmented on celesta (curious), its tail in the low strings and piano
(tension), four times slower on low piano with the tritone exposed (ominous), and in the major form on
piano and vibes (resolve).
"""

from __future__ import annotations

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
    PARTS = ("piano", "harp", "celesta", "kalimba", "marimba", "glock", "vibes", "bowed", "pizz", "pizz_lo", "celli", "violas",
             "violins", "basses", "basses_trem", "violins_trem", "violas_trem", "celli_fast", "pad", "sub", "pulse", "bass", "kick", "kit")

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
        humanize_part(P["piano"], s, timing_ms=8, drift_ms=4, velocity=4, seed=f"{seed}-piano", roll_ms=18)
        for n in ("harp", "celesta", "kalimba", "marimba", "glock", "vibes", "pizz", "pizz_lo", "bass", "celli_fast", "pulse"):
            humanize_part(P[n], s, timing_ms=7, drift_ms=4, velocity=5, seed=f"{seed}-{n}")
        for n in ("celli", "violas", "violins", "basses", "basses_trem", "violins_trem", "violas_trem", "bowed", "pad", "sub"):
            humanize_part(P[n], s, timing_ms=12, drift_ms=5, velocity=3, seed=f"{seed}-{n}")
        humanize_part(P["kit"], s, timing_ms=5, drift_ms=3, velocity=6, seed=f"{seed}-drums")
        humanize_part(P["kick"], s, timing_ms=4, drift_ms=3, velocity=4, seed=f"{seed}-drums")

    def tracks(self, faders: dict | None = None) -> list:
        pk = self.pocket
        tr = [
            C.piano(fader=-2.0, plate=None, hall=-10.0, bright=1.5, pocket=pk),
            C.mallets("harp", I.harp(), fader=-5.0, pan=-0.25, hall=-9.0, hp=80.0, pocket=pk),
            C.mallets("celesta", I.CELESTA, fader=-8.0, pan=0.2, hall=-8.0, hp=300.0, pocket=pk),
            C.mallets("kalimba", I.kalimba(), fader=-9.0, pan=0.35, hall=-10.0, hp=200.0, pocket=pk),
            C.mallets("marimba", I.marimba(), fader=-9.0, pan=-0.3, hall=-10.0, hp=120.0, pocket=pk),
            C.mallets("glock", I.glock(), fader=-16.0, pan=0.3, hall=-9.0, hp=500.0, pocket=pk),
            C.vibes("vibes", fader=-7.0, pan=0.25, hall=-8.0, pocket=pk),
            C.mallets("bowed", I.vibes_bowed(), fader=-10.0, pan=-0.15, hall=-8.0, hp=250.0, pocket=pk),
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
            C.pad(fader=-14.0, cutoff=900.0, pocket=pk),
            C.sub(fader=-16.0),
            C.pulse(fader=-15.0, cutoff_hi=1600.0, pocket=pk),
            C.bass(fader=-6.0, t60=2.0, drive=3.0),
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
        return out


def _bed(cid: str, st: Story, faders: dict, bus_eq=None) -> Arrangement:
    st.finish(cid)
    # story beds are warm by nature (harp, low strings, pad): the bus takes 2.5 dB out of 300 Hz (the first
    # renders read +6 dB mud), a little more pocket at 2.5 kHz, and air above 6 kHz so warm never reads muffled
    return Arrangement(cid, st.s, LENGTH, st.tracks(faders), preset="bed", loop=True, tail=10.0, wrap=8.0, reverbs=C.reverbs(),
                       bus_eq=bus_eq or [C.PK(300, -2.5, 0.8), C.PK(550, -2.5, 0.9), C.PK(2500, -4.0, 0.7), C.HS(6000, 3.0)])


def _arp(part, t: float, notes: str, step: float, vel: int, dur: float | None = None, accent: int = 6, transpose: int = 0):
    ns = notes.split()
    for i, n in enumerate(ns):
        part.note(note_number(n) + transpose, t + i * step, dur or step * 1.8, vel + (accent if i % 4 == 0 else 0))


# ------------------------------------------------------------------------------------------ curious

CURIOUS = [  # per 2 bars: harp arpeggio (8ths), bowed note, root
    ("F3 C4 G4 A4 B4 A4 G4 C4", "A4", "F2"),
    ("D3 A3 F4 C5 E5 C5 F4 A3", "C5", "D2"),
    ("Bb2 F3 C4 D4 E4 D4 C4 F3", "D5", "Bb1"),
    ("C3 G3 Bb3 D4 F4 D4 Bb3 G3", "D5", "C2"),
]


def curious() -> Arrangement:
    """F lydian: a harp ostinato, bowed-vibes sustains, the motif augmented on celesta (F F C B A: the
    lydian B is the motif's #4), kalimba and pizzicato from bar 8, marimba and shaker from bar 16."""
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
            for j, n in enumerate({"F2": "F4 C5 A5 C5", "C2": "C4 G4 Bb4 D5"}[root].split()):
                P["marimba"].note(n, t + j * 1.0 + 0.5, 0.8, 50)
    motif.place(P["celesta"], st.b(0), "F5", mode="major", vel=70, stretch=2.0, last_dur=4.0)
    motif.place(P["celesta"], st.b(8), "F5", mode="major", vel=72, stretch=2.0, last_dur=4.0)
    motif.place(P["vibes"], st.b(16), "F5", mode="major", vel=58, stretch=2.0, last_dur=3.0)
    P["glock"].note("A6", st.b(4), 2.0, 50)
    P["glock"].note("E6", st.b(12) + 2.0, 2.0, 46)
    return _bed("bed-story-curious", st, {})


# ------------------------------------------------------------------------------------------ tension

def tension() -> Arrangement:
    """D minor: a celli ostinato in 8ths, a ticking clock, low piano octaves; the pulse, violas tremolo
    and the motif's tail from bar 8; high violins, tom rolls and a bass-drum swell from bar 16."""
    st = Story()
    P = st.p
    prog = ["D", "D", "Bb", "Bb", "G", "G", "A", "A"]
    ost = {"D": "D3 D3 A2 D3 D3 A2 Eb3 D3", "Bb": "D3 D3 Bb2 D3 D3 Bb2 F3 D3", "G": "D3 D3 G2 D3 Bb2 G2 A2 Bb2", "A": "C#3 C#3 A2 C#3 E3 A2 Bb2 A2"}
    for bar in range(BARS):
        t = st.b(bar)
        sec = 0 if bar < 8 else (1 if bar < 16 else 2)
        root = prog[bar % 8] if bar < 16 else ["D", "D", "Bb", "A"][bar - 16]
        _arp(P["celli_fast"], t, ost[root], 0.5, 58, dur=0.35, accent=10)
        if bar % 2 == 0:
            P["basses"].note({"D": "D2", "Bb": "Bb1", "G": "G1", "A": "A1"}[root], t, 7.8, 60)
            P["piano"].note({"D": "D2", "Bb": "Bb1", "G": "G1", "A": "A1"}[root], t, 3.0, 62)
            P["piano"].note({"D": "D1", "Bb": "Bb0", "G": "G1", "A": "A1"}[root], t, 3.0, 56)
        st.drums(bar, {"wood": "x...o...x...o..."}, vel={"x": 40, "o": 30})
        if sec >= 1:
            r = {"D": "D3", "Bb": "Bb2", "G": "G2", "A": "A2"}[root]
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
    motif.place(P["piano"], st.b(1) + 2.0, "D3", form="tail", vel=64, octaves=(0, -12), last_dur=3.5)
    motif.place(P["piano"], st.b(9) + 2.0, "D3", form="tail", vel=66, octaves=(0, -12), last_dur=3.5)
    motif.place(P["celli"], st.b(8), "D3", vel=62, stretch=2.0, last_dur=6.0)
    swell(P["celli"], st.b(8), st.b(8.5), 0, 58)
    swell(P["celli"], st.b(11), st.b(12), 58, 0)
    return _bed("bed-story-tension", st, {"piano": -4.0, "celli_fast": -6.0})


# ------------------------------------------------------------------------------------------ ominous

def ominous() -> Arrangement:
    """D phrygian, dark and slow: bass drones, a heartbeat on the muted frame drum, low piano octaves with
    the tritone, bowed-vibes dissonances, the motif four times slower on low piano (bars 4-7 and 12-15),
    a long cymbal swell into each 8-bar section."""
    st = Story()
    P = st.p
    for bar in range(BARS):
        t = st.b(bar)
        sec = 0 if bar < 8 else (1 if bar < 16 else 2)
        st.drums(bar, {"fmute": "x..o............" if bar % 2 == 0 else "x..o........x..o"}, vel={"x": 52, "o": 36})
        if bar % 4 == 0:
            P["basses_trem"].note("D2", t, 15.8, 54)
            P["sub"].note("D1", t, 15.6, 50)
            P["pad"].note("D3", t, 15.6, 40)
            P["pad"].note("F3", t, 15.6, 34)  # no fifth: the tritone (A-flat) in the piano is the colour
        if bar % 4 == 2:
            P["piano"].note("Ab2", t + 2.0, 3.0, 50)
            P["piano"].note("Ab1", t + 2.0, 3.0, 52)
        if bar % 4 == 0:
            P["piano"].note("D2", t, 4.0, 58)
            P["piano"].note("D1", t, 4.0, 52)
        if sec >= 1 and bar % 4 == 1:
            P["bowed"].note("Eb5" if bar % 8 == 1 else "A4", t, 11.0, 54)
        if sec == 2:
            P["violins_trem"].note("D6" if bar < 18 else "Eb6", t, 3.9, 40)
    for b0 in (4, 12):
        motif.place(P["piano"], st.b(b0), "D3", vel=58, stretch=4.0, last_dur=6.0, octaves=(0, -12))
    P["kit"].hit(K["swell_long"], st.b(8) - 4.0 / SPB, 54)
    P["kit"].hit(K["swell_long"], st.b(16) - 4.0 / SPB, 58)
    P["kit"].hit(K["bdrum"], st.b(8), 50)
    P["kit"].hit(K["bdrum"], st.b(16), 54)
    P["glock"].note("Eb6", st.b(6) + 1.0, 3.0, 40)
    return _bed("bed-story-ominous", st, {"piano": -3.0, "bowed": -12.0, "violins_trem": -16.0, "pad": -15.0})


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


def resolve() -> Arrangement:
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
    motif.place(P["vibes"], st.b(0), "D5", mode="major", vel=62, stretch=1.5, last_dur=3.0)
    motif.place(P["vibes"], st.b(8), "D5", mode="major", vel=66, stretch=1.5, last_dur=3.0)
    motif.place(P["violins"], st.b(10), "D5", mode="major", vel=58, stretch=1.5, last_dur=2.5)  # over Bm9 (the G# is its dorian 6th)
    return _bed("bed-story-resolve", st, {"piano": -3.0, "vibes": -9.0, "bass": -8.0})


# ------------------------------------------------------------------------------------------ intro sting

ZOORA_HIT = 54 / 30.0  # src/branding ZooraSting: the nodes pop, the teal accent lands (frame 54)
ZOORA_WORD = 70 / 30.0  # the wordmark draws (frame 70)
ZOORA_TAG = 78 / 30.0  # the tag line (frame 78)


def zoora_intro_sting() -> Arrangement:
    """F lydian, 100 BPM (0.6 s a beat): a shimmer rises from frame 6 (the bell draws), the major motif
    lands on the logo hit at 1.80 s (beat 3), two soft celesta notes under the wordmark and tag, fades by 4.0 s."""
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
    # the motif (major, lydian #4 = B) on celesta and vibes: SHOW lands on the hit
    motif.place(P["celesta"], hit - 2.0, "F5", mode="major", vel=84, last_dur=2.2)
    motif.place(P["vibes"], hit - 2.0, "F5", mode="major", vel=70, last_dur=2.2)
    # the hit: Fmaj9#11 bloom
    for n in ("F2", "C3", "A3", "G4"):  # Fadd9: no E under the celesta's F6
        P["piano"].note(n, hit, 3.0, 72)
    P["piano"].sustain(hit + 0.03, hit + 3.6)
    for n in ("F2", "C3"):
        P["celli"].note(n, hit, 3.2, 70)
    for n in ("A3", "C4"):
        P["violas"].note(n, hit, 3.2, 64)
    P["violins"].note("A5", hit, 3.2, 60)
    swell(P["celli"], hit, hit + 0.05, 0, 72)
    swell(P["violas"], hit, hit + 0.05, 0, 64)
    swell(P["violins"], hit, hit + 0.3, 0, 58)
    for name in ("celli", "violas", "violins"):
        swell(P[name], hit + 1.2, hit + 3.2, 70, 0)
    P["sub"].note("F1", hit, 2.4, 70)
    P["kit"].hit(K["bdrum"], hit, 72)
    P["kit"].hit(K["sus_soft"], hit, 70)
    P["glock"].note("A6", hit, 1.5, 60)
    # under the wordmark and the tag line
    P["celesta"].note("C6", ZOORA_WORD / 0.6, 1.2, 64)
    P["celesta"].note("F6", ZOORA_TAG / 0.6, 1.6, 60)
    st.finish("intro-sting-zoora")
    return Arrangement("intro-sting-zoora", st.s, 4.0, st.tracks({"celesta": -3.0, "vibes": -7.0, "harp": -6.0}), preset="sting",
                       reverbs=C.reverbs(), fade_out=0.6, bus_eq=[C.PK(300, -1.0, 0.9), C.PK(4500, 1.5, 0.7), C.HS(9000, 1.5)])
