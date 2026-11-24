"""The show's beds: neutral, tension and light. 90 BPM (20 frames per beat), 24 bars = 64.0 s, seamless
loops, all in the D family so an editor can cross-fade between them on any bar line.

Shape of each bed (variation every 8 bars, the loop point returns to the opening level):
    bars 0-7    the base layer
    bars 8-15   + a second colour and the motif (soft, high, away from the voice's core)
    bars 16-23  + strings or a fuller groove; the last two bars thin out into bar 0

Voice pocket: soft mallets, sparse mids, `pocket=True` channel EQ (2-3 kHz dips) and the bed master's
broad dip; hats and air keep the top open so the 1-4 kHz dip reads as a pocket, not a dull mix.
"""

from __future__ import annotations

from audiolib.core import note_number
from composer import motif
from composer.cues import common as C
from composer.cues.theme import Theme
from composer.instruments import K
from composer.notation import line
from composer.render import Arrangement, swell

BPM = 90
BARS = 24
SPB = 60.0 / BPM
LENGTH = BARS * 4 * SPB  # 64.0 s


def _arr(cid: str, th: Theme, faders: dict, bus_eq=None, swing: bool = True) -> Arrangement:
    th.finish(cid, swing=swing)
    return Arrangement(cid, th.s, LENGTH, th.tracks(faders), preset="bed", loop=True, tail=8.0, wrap=8.0, reverbs=C.reverbs(),
                       bus_eq=bus_eq or [C.PK(250, -1.0, 0.9), C.HS(7000, 2.0)])


# ------------------------------------------------------------------------------------------ neutral

NEUTRAL_CHORDS = [  # two bars each: (EP voicing, bass root)
    ("F3 A3 C4 E4", "D2"), ("F3 B3 E4", "D2"), ("F3 A3 C4 E4", "D2"), ("F3 A3 D4 E4", "Bb1"),
]
NEUTRAL_BASS = {
    "D2": ["D2:1.5 r:1 A1:.5 r:.5 D2:.5", "D2:1 r:.5 D2:.5 r:1 F2:.5 E2:.5"],
    "Bb1": ["Bb1:1.5 r:1 F2:.5 r:.5 Bb1:.5", "C2:1.5 r:1 G1:.5 A1:.5 C#2:.5"],
}


def neutral() -> Arrangement:
    """D dorian over a D pedal: Dm9 | G13/D | Dm9 | Bbmaj7#11 - C6/9. EP, bass, soft kick, cross-stick and
    shaker; vibes motif fragments from bar 8; a quiet string pad from bar 16."""
    th = Theme(bpm=BPM, pocket=True)
    P = th.p
    for bar in range(BARS):
        t = th.b(bar)
        sec = bar // 8
        k = (bar % 8) // 2
        voicing, root = NEUTRAL_CHORDS[k]
        if k == 3 and bar % 2 == 1:
            voicing, root = "E3 A3 D4 G4", "Bb1"  # C6/9, bass line walks C -> C# -> D
        if bar in (12, 13, 20, 21) and k == 0:
            voicing = "F3 A3 C4"  # the motif lands on F here: no E (9th) a minor ninth under it
        # EP: a chord on 1, a lighter one on the "and" of 3; every fourth bar answers on 4
        C.chord(P["ep"], t, 1.3, voicing, 54, roll=0.03)
        C.chord(P["ep"], t + 2.5, 0.7, voicing, 44, roll=0.02)
        if bar % 4 == 3:
            C.chord(P["ep"], t + 3.5, 0.4, voicing, 40)
        pats = NEUTRAL_BASS[root]
        line(P["bass"], t, pats[bar % 2], vel=78, staccato=0.9)
        rows = {"kick": "X.........x....." if bar % 4 != 3 else "X.........x...x.", "xstick": "....x.......x..."}
        if sec < 2 or bar >= 22:
            rows["shaker"] = "x.x.x.x.x.x.x.x."
            rows["shaker2"] = ".o.o.o.o.o.o.o.o"
        else:
            rows["hat"] = "x.o.x.o.x.o.x.o." if bar % 2 == 0 else "x.o.x.o.x.o.x.oo"
        th.drums(bar, rows, vel={"X": 84, "x": 60, "o": 34})
        if sec >= 1 and bar < 22:
            r = note_number(root) + 12
            for j in range(8):
                P["pulse"].note(r + (7 if j % 4 == 2 else 0), t + 0.5 * j, 0.3, 40 + (8 if j % 2 == 0 else 0))
    # the motif, soft and high: the head at bar 8, the whole motif at bar 12, the tail at bar 20
    motif.place(P["vibes"], th.b(8), "D5", form="head", vel=60, last_dur=1.5)
    motif.place(P["vibes"], th.b(12), "D5", vel=62)
    motif.place(P["vibes"], th.b(20) + 1.0, "D5", form="tail", vel=58)
    # bars 16-21: strings pad (celli and violas, low and quiet)
    for bar, notes in ((16, ("D3", "A3")), (18, ("D3", "B3")), (20, ("D3", "A3"))):
        for n in notes:
            P["celli" if n == "D3" else "violas"].note(n, th.b(bar), 7.9, 56)
    swell(P["celli"], th.b(16), th.b(17), 0, 46)
    swell(P["violas"], th.b(16), th.b(17), 0, 42)
    swell(P["celli"], th.b(21), th.b(22), 46, 0)
    swell(P["violas"], th.b(21), th.b(22), 42, 0)
    return _arr("bed-show-neutral", th, {"ep": -4.0, "vibes": -9.0, "pulse": -14.0, "celli": -10.0, "violas": -11.0, "perc": -13.0, "hats": -10.0})


# ------------------------------------------------------------------------------------------ tension

def tension() -> Arrangement:
    """D minor, phrygian edges: a muted 3-3-2 pulse, low strings with an Eb neighbour, a half-time kit with
    ticking hats, the motif low on piano at bars 0, 8 and 16 (dark, not loud)."""
    th = Theme(bpm=BPM, pocket=True)
    P = th.p
    harm = ["D", "D", "D", "Eb", "Bb", "Bb", "G", "A"]  # bass roots, one per bar, repeating every 8 bars
    ep = {"D": "F3 A3 E4", "Eb": "G3 Bb3 D4", "Bb": "F3 A3 D4", "G": "F3 Bb3 D4", "A": "G3 C#4 E4"}
    for bar in range(BARS):
        t = th.b(bar)
        sec = bar // 8
        root = harm[bar % 8]
        rn = {"D": "D2", "Eb": "Eb2", "Bb": "Bb1", "G": "G1", "A": "A1"}[root]
        # pulse: 16ths, accents in 3-3-2
        for j in range(16):
            acc = j in (0, 3, 6, 8, 11, 14)
            P["pulse"].note(note_number(rn) + 12, t + 0.25 * j, 0.14, 50 if acc else 34)
        P["bass"].note(rn, t, 3.6, 76)
        P["sub"].note(rn, t, 3.8, 64)
        C.chord(P["ep"], t + 1.5, 1.0, ep[root], 44, roll=0.03)
        rows = {"kick": "X.......X.x....." if bar % 2 == 0 else "X.........x.....", "rim": "........x.......",
                "hat": "o.x.o.x.o.x.o.x." if sec != 1 else "x.o.x.o.x.o.x.o."}
        if bar % 8 == 7:
            rows["tom_lo"] = "............x.x."
            rows["tom_hi"] = "..........x.x..."
        th.drums(bar, rows, vel={"X": 86, "x": 54, "o": 34})
        if bar % 4 == 3:
            P["kit"].hit(K["swell_short"], th.b(bar + 1) - 2.5 / SPB, 58)
    for b0 in (0, 8, 16):  # the motif, low and slow on piano
        motif.place(P["piano"], th.b(b0), "D3", vel=66, octaves=(0, -12), stretch=1.5, last_dur=3.0)
    # strings: celli tremolo on D (all), violas tremolo from bar 8, violins high pedal in bars 16-21
    for bar in range(8, BARS, 4):
        P["violas_trem"].note("D3" if bar < 16 else "F3", th.b(bar), 15.8, 52)
    for bar in range(0, BARS, 2):
        P["celli"].note("D3" if harm[bar % 8] != "Eb" else "Eb3", th.b(bar), 7.8, 54)
    swell(P["celli"], th.b(0), th.b(1), 30, 50)
    for bar in range(16, 22):
        P["violins"].note("A5", th.b(bar), 3.9, 50)
    swell(P["violins"], th.b(16), th.b(18), 0, 40)
    swell(P["violins"], th.b(20), th.b(22), 40, 0)
    return _arr("bed-show-tension", th, {"pulse": -11.0, "ep": -10.0, "piano": -5.0, "celli": -9.0, "violas_trem": -13.0, "violins": -14.0,
                                         "hats": -12.0, "sub": -12.0}, swing=False)


# ------------------------------------------------------------------------------------------ light

LIGHT_CHORDS = [  # one per bar: EP voicing, bass root, pizz arpeggio (8ths)
    ("A3 C4 E4 G4", "F2", "F4 A4 C5 A4 E5 C5 A4 C5"),
    ("A3 C4 E4 G4", "F2", "F4 A4 C5 E5 G5 E5 C5 A4"),
    ("F3 B3 E4", "G2", "G4 B4 D5 B4 F5 D5 B4 D5"),
    ("F3 B3 E4", "G2", "G4 B4 D5 F5 E5 D5 B4 G4"),
    ("E3 G3 C4", "A2", "A4 C5 E5 C5 G5 E5 C5 E5"),
    ("F3 A3 C4 E4", "D2", "D4 F4 A4 C5 E5 C5 A4 F4"),
    ("F3 A3 D4 G4", "Bb1", "Bb4 D5 F5 D5 A5 F5 D5 F5"),
    ("F3 Bb3 D4 G4", "C2", "C5 F5 G5 Bb4 C5 D5 E5 G5"),
]


def light() -> Arrangement:
    """F major with a lydian wink: bouncy swung pizzicato, a two-feel bass, soft taps and hats, the major
    motif on vibes (F F C B A) every 8 bars. | Fmaj9 | Fmaj9 | G13 | G13 | Am7 | Dm9 | Bbmaj13 | C9sus4 |"""
    th = Theme(bpm=BPM, pocket=True)
    P = th.p
    for bar in range(BARS):
        t = th.b(bar)
        sec = bar // 8
        voicing, root, arp = LIGHT_CHORDS[bar % 8]
        if bar in (0, 8, 16):
            voicing = "A3 D4 G4"  # F6/9 under the motif's F: no major 7th a minor ninth below it
        r = note_number(root)
        C.chord(P["ep"], t + 0.5, 0.6, voicing, 48, roll=0.02)
        C.chord(P["ep"], t + 2.5, 0.6, voicing, 44, roll=0.02)
        line(P["bass"], t, f"{root}:1 r:1 {_n(r + 7)}:1 r:.5 {_n(r + (11 if bar % 8 == 7 else 12))}:.5", vel=74, staccato=0.5)
        line(P["pizz"], t, " ".join(f"{p}:.5" for p in arp.split()), vel=60 if sec != 1 else 64, staccato=0.5)
        rows = {"kick": "X.......X.......", "ghost": "....x.......x...", "hat": "x.x.x.x.x.x.x.x."}
        if sec == 2:
            rows["clap"] = "....o.......o..."
        if bar % 8 == 7:
            rows["ghost"] = "....x.......xox."
            rows["ohat"] = "..............x."
            nxt = "A3 D4 G4" if bar + 1 in (8, 16, 24) else LIGHT_CHORDS[(bar + 1) % 8][0]
            C.chord(P["ep"], t + 3.5, 1.0, nxt, 46, roll=0.02)  # anticipates the next downbeat, rings over the bar line
        th.drums(bar, rows, vel={"X": 78, "x": 58, "o": 36})
    for b0, tonic in ((0, "F5"), (8, "F5"), (16, "F5")):
        motif.place(P["vibes"], th.b(b0), tonic, mode="major", vel=64)
    line(P["vibes"], th.b(9), "r:.5 A5:.25 G5:.25 F5:.5 D5:.5 E5:2", vel=56)
    line(P["vibes"], th.b(17), "r:.5 C6:.25 B5:.25 A5:.5 G5:.5 F5:2", vel=56)
    celli_line = {0: "F3", 1: "F3", 2: "G3", 3: "G3", 4: "A3", 5: "D3"}  # bars 16-21: a warm cello line under the pizzicato
    for bar in range(16, 22):
        P["celli"].note(celli_line[bar % 8], th.b(bar), 3.9, 52)
    swell(P["celli"], th.b(16), th.b(17), 0, 44)
    swell(P["celli"], th.b(21), th.b(22), 44, 0)
    return _arr("bed-show-light", th, {"ep": -6.0, "vibes": -9.0, "pizz": -6.0, "celli": -11.0, "hats": -11.0, "claps": -13.0})


def _n(m: int) -> str:
    from audiolib.core import note_name

    return note_name(m)
