""""The Zoo & Badger Show" theme: D minor, 100 BPM (18 frames per beat), plus its 15 s and 5 s cuts.

Form of the full theme (28 bars, 67.2 s, plus ring-out to 68.4 s):
    Intro (bars 0-1)   solo piano states the motif over a low D; Badger's figure replies; drum pickup
    A     (2-9)        the band: the motif on D and on G, vibes replies, turnaround hits
    B     (10-17)      contrast: a lyrical piano line over a descending bass (Bbmaj9 .. Ebmaj7#11 .. A7b9),
                       string swells, pizzicato statements of the motif's tail on every chord
    A'    (18-25)      full: motif in octaves (piano, vibes, pizzicato), brass stabs, muted guitar, claps
    Coda  (26-27)      the band plays the motif in unison and lands on SHOW; Badger has the last word

A-section harmony. The chord moves under the motif's blue note, and the voicing moves with it
(Dm9 F-A-C-E to Bb9 F-Ab-C-D: the A slides to Ab like the melody):
    | Dm9 . Bb9 | A7b13 . A7b9 | Gm9 . Eb9 | Em7b5 . A7b9 | Dm9 . Bb9 | Bbmaj7#11 | Gm9 . C13 | Em7b5 . A7b13 |

Voicing rules from the score audit (composer/audit.py): no semitone clusters in sustained pads,
strings or brass (they beat); no minor ninth between the strings' top line and the comping; nothing
a semitone from the motif's landing note while it is held.
"""

from __future__ import annotations

from audiolib.midi import Score
from composer import motif
from composer.cues import common as C
from composer.instruments import K
from composer.notation import grid, line
from composer.render import Arrangement, humanize_part, swell

BPM = 100
BAR = 4.0
SPB = 60.0 / BPM  # seconds per beat

V = {  # hand-voiced, voice-led comping chords (EP / piano / brass stabs)
    "Dm9": "F3 A3 C4 E4", "Bb9": "F3 Ab3 C4 D4", "A7b13": "F3 G3 C#4 E4", "A7b9": "G3 Bb3 C#4 E4",
    "Gm9": "F3 A3 Bb3 D4", "Eb9": "F3 G3 Bb3 Db4", "Em7b5": "G3 Bb3 D4 E4", "Bbmaj7#11": "F3 A3 D4 G4",
    "C13": "E3 A3 Bb3 D4", "Em7b5low": "E3 G3 Bb3 D4",
}

A_CHORDS = [  # (bar, beat, chord)
    (0, 0.0, "Dm9"), (0, 1.5, "Bb9"), (1, 0.0, "A7b13"), (1, 2.0, "A7b9"),
    (2, 0.0, "Gm9"), (2, 1.5, "Eb9"), (3, 0.0, "Em7b5"), (3, 2.0, "A7b9"),
    (4, 0.0, "Dm9"), (4, 1.5, "Bb9"), (5, 0.0, "Bbmaj7#11"), (6, 0.0, "Gm9"), (6, 2.0, "C13"),
    (7, 0.0, "Em7b5low"), (7, 1.5, "A7b13"),
]
A_ROOTS = ["D", "A", "G", "E", "D", "Bb", "G", "E"]  # for the pulse
A_GTR = {0: "F3 C4", 1: "G3 C#4", 2: "F3 Bb3", 3: "G3 D4", 4: "F3 C4", 5: "A3 D4", 6: "F3 Bb3"}  # 3rd/7th shells

A_BASS = [
    "D2:.75 D2:.75 Bb1:1 F2:.5 Ab2:.5 Bb1:.5",
    "A1:1.25 A1:.25 E2:.5 r:.5 G2:.5 E2:.5 C#2:.5",
    "G1:.75 G1:.75 Eb2:1 Bb1:.5 Db2:.5 Eb2:.5",
    "E2:1 Bb1:.5 E2:.5 A1:1 G1:.5 A1:.25 C#2:.25",
    "D2:.75 D2:.75 Bb1:1 F2:.5 Ab1:.5 Bb1:.5",
    "Bb1:1.5 F2:.5 Bb2:.5 A2:.5 F2:.5 E2:.5",
    "G1:1 D2:.5 G2:.5 C2:1 E2:.5 Bb1:.5",
    "E2:.5@+8 r:1 A1:.5@+10 r:1.5 C2:.25 C#2:.25",
]

REPLIES = {  # vibes answers to the motif (A-section bar -> line)
    1: "r:.5 G5:.25 F5:.25 E5:.5 Bb4:.5 C#5:2",
    3: "r:.5 Bb5:.25 A5:.25 G5:.5 E5:.5 Bb5:.5 G5:.5 C#5:1",
    5: "r:.5 D5:.25 E5:.25 F5:.5 A5:.5 E5:2",
    6: "r:1 D5:.5 F5:.5 A5:1 G5:.5 E5:.5",
}
A_VIOLINS = ["D6", "C#6", "G5", "G5", "D6", "D6", "D6", "C#6"]
A_CELLI = ["D3", "A2", "G2", "A2", "D3", "Bb2", "G2", "E3"]

B_EP = ["F3 A3 C4 D4", "E3 G3 C4", "G3 Bb3 D4 F4", "E3 A3 C4 G4", "G3 Bb3 D4 F4", "F3 A3 C4", "G3 Bb3 D4 E4", "G3 Bb3 C#4 E4"]
B_PAD = ["F3 A3 D4", "E3 G3 C4", "Bb3 D4 F4", "E3 A3 C4", "G3 Bb3 D4", "F3 A3 C4", "G3 Bb3 D4", "G3 C#4 E4"]
B_BASS = [
    "Bb1:1.5 r:1 F2:.5 r:.5 E2:.5",
    "A1:1.5 r:1 E2:.5 r:.5 Ab1:.5",
    "G1:1.5 r:1 D2:.5 r:.5 Gb1:.5",
    "F1:1.5 r:1 C2:.5 r:.5 E2:.5",
    "Eb2:1.5 r:1 Bb1:.5 C2:.5 Eb2:.5",
    "D2:1.5 r:1 A1:.5 C2:.5 D#2:.5",
    "E2:1.5 r:1 Bb1:.5 G1:.5 Bb1:.5",
    "A1:.5 A1:.5 A1:.5 A1:.5 A2:.5 G2:.5 E2:.5 C#2:.5",
]
B_MELODY = [
    "D5:1.5 C5:.5 D5:.5 F5:1.5",
    "E5:1.5 C5:.5 A4:2",
    "Bb4:1 A4:.5 Bb4:.5 D5:1 F5:1",
    "E5:3 r:1",
    "G5:1 F5:.5 D5:.5 Bb4:1 A4:1",
    "F4:1.5 E4:.5 F4:.5 A4:1.5",
    "Bb4:1.5 A4:.5 G4:1 E4:1",
    "C#5:.5 E5:.5 G5:.5 Bb5:.5 A5:2",
]
B_TAILS = [("Bb3", "major"), ("A3", "minor"), ("G3", "minor"), ("F3", "major"), ("Eb3", "major"), ("D3", "minor")]  # roots: tail starts on each 5th
B_CELLI = ["Bb2", "A2", "G2", "F2", "Eb3", "D3", "E3", "A2"]
B_VIOLAS = ["D4 A4", "C4 G4", "Bb3 F4", "A3 E4", "G3 D4", "F3 C4", "G3 D4", "G3 C#4"]
B_VIOLINS = {4: "G5", 5: "A5", 6: "Bb5", 7: "C#6"}

DRUM_KEYS = {"snare": K["snare"], "ghost": K["tap"], "hat": K["hat"], "ohat": K["hat_open"], "pedal": K["hat_pedal"],
             "xstick": K["xstick"], "clap": K["clap"], "shaker": K["shaker_down"], "shaker2": K["shaker_up"], "tamb": K["tamb"],
             "crash": K["crash"], "tom_hi": K["tom_high"], "tom_lo": K["tom_low"], "roll": K["snare_roll"], "swell": K["swell_short"],
             "rim": K["rim"]}


class Theme:
    """Writes the theme's sections into one Score; the full theme and its cuts reuse the same bars."""

    PARTS = ("piano", "vibes", "ep", "pad", "pulse", "brass", "gtr", "bass", "sub", "kick", "kit",
             "pizz", "celli", "violas", "violins", "basses_pizz", "celli_pizz", "harp", "glock", "violins_trem", "violas_trem")

    def __init__(self, bpm: float = BPM, pocket: bool = False):
        self.s = Score(bpm=bpm, time_sig=(4, 4), key="Dm")
        for name in self.PARTS:
            self.s.part(name)
        self.p = self.s.parts
        self.clips = []  # (name, stereo audio, fader dB, hall send dB or None)
        self.pocket = pocket

    def b(self, bar: float) -> float:
        return bar * BAR

    # ---------------------------------------------------------------- shared gestures
    def chord(self, part: str, bar: float, beat: float, voicing: str, dur: float, vel: int, roll: float = 0.0):
        C.chord(self.p[part], self.b(bar) + beat, dur, V.get(voicing, voicing), vel, roll=roll)

    def drums(self, bar: float, rows: dict, vel=None):
        kick = rows.pop("kick", None)
        if rows:
            grid(self.p["kit"], self.b(bar), rows, {k: DRUM_KEYS[k] for k in rows}, vel)
        if kick:
            grid(self.p["kick"], self.b(bar), {"kick": kick}, {"kick": 36}, vel)

    def badger(self, bar: float, beat: float = 0.0, vel: int = 100):
        """Badger's figure (Eb then D, a beat apart): plucked bass, celli and basses pizzicato, a muted
        kick and a dry cross-stick under each note."""
        t = self.b(bar) + beat
        motif.place_badger(self.p["bass"], t, "D2", vel=vel)
        motif.place_badger(self.p["celli_pizz"], t, "D3", vel=vel - 4)
        motif.place_badger(self.p["basses_pizz"], t, "D2", vel=vel - 10)
        for k in range(2):
            self.p["kick"].hit(36, t + k * 1.0, 72 - 8 * k)
            self.p["kit"].hit(K["xstick"], t + k * 1.0, 64 - 6 * k)

    def pulse_bar(self, tb: int, root: str, vel: int, beats: int = 4):
        t = self.b(tb)
        lo = {"D": "D3", "A": "A2", "G": "G2", "E": "E3", "Bb": "Bb2"}[root]
        from audiolib.core import note_number
        r = note_number(lo)
        pat = (0, 0, 7, 12)
        for k in range(4 * beats):
            self.p["pulse"].note(r + pat[k % 4], t + 0.25 * k, 0.18, vel + (10 if k % 4 == 0 else 0))

    # ---------------------------------------------------------------- intro
    def intro(self, bar: int):
        t = self.b(bar)
        P = self.p
        motif.place(P["piano"], t, "D4", vel=82, octaves=(0, 12))
        C.chord(P["piano"], t, 3.9, "D2 A2", 74)
        P["piano"].sustain(t + 0.05, t + 3.85)
        P["sub"].note("D1", t, 3.4, 70)
        P["celli"].note("D3", t + 2.0, 2.0, 60)
        swell(P["celli"], t + 1.9, t + 4.0, 30, 64, shape=1.4)
        swell(P["celli"], t + 4.0, t + 4.2, 64, 0)
        # bar 2: Badger's reply, then the drum pickup into the band
        self.badger(bar + 1, 0.0, vel=98)
        self.drums(bar + 1, {"ghost": "........oooxoxXX"}, vel={"o": 34, "x": 58, "X": 84})
        self.drums(bar + 1, {"kick": "..............x."}, vel={"x": 82})
        for k in range(8):
            P["pulse"].note("D3" if k % 4 else "D4", self.b(bar + 1) + 2.0 + 0.25 * k, 0.18, 40 + 5 * k)
        P["kit"].hit(K["swell_short"], self.b(bar + 2) - 2.5 / SPB, 70)

    # ---------------------------------------------------------------- A sections
    def a_section(self, bar: int, full: bool = False, bars=range(8), last_fill: bool = True, at: dict | None = None):
        """Write A-section bars `bars` (0-7) at bar + i, or at at[i] when given (for the cuts)."""
        P = self.p
        for i in bars:
            tb = at[i] if at else bar + i
            t = self.b(tb)
            ch = [(beat, c) for bb, beat, c in A_CHORDS if bb == i]
            for j, (beat, c) in enumerate(ch):
                span = (ch[j + 1][0] if j + 1 < len(ch) else 4.0) - beat
                if i == 7:  # turnaround hits: EP and brass together
                    self.chord("ep", tb, beat, c, 0.45 if beat == 0 else 0.6, 82 if full else 76)
                    self.chord("brass", tb, beat, c, 0.38 if beat == 0 else 0.55, 88 if full else 82)
                    continue
                if span >= 2.0:
                    self.chord("ep", tb, beat, c, 0.9, 68 if full else 64, roll=0.02)
                    self.chord("ep", tb, beat + (1.5 if span >= 2.5 else 1.0), c, 0.4, 52, roll=0.015)
                else:
                    self.chord("ep", tb, beat, c, span - 0.1, 66 if full else 60, roll=0.02)
            line(P["bass"], t, A_BASS[i], vel=96 if full else 92, staccato=0.88)
            # the motif and its answers
            if i in (0, 4):
                motif.place(P["piano"], t, "D4", vel=88 if full else 84, octaves=(0, 12))
                C.chord(P["piano"], t, 1.4, "D3", 60)
                if full:
                    motif.place(P["vibes"], t, "D5", vel=74)
                    motif.place(P["pizz"], t, "D4", vel=86, staccato=0.6)
                    self.chord("brass", tb, 1.5, "Bb9", 0.5, 84)
            elif i == 2:
                motif.place(P["piano"], t, "G3", vel=86 if full else 82, octaves=(0, 12))
                if full:
                    motif.place(P["vibes"], t, "G4", vel=72)
                    motif.place(P["pizz"], t, "G3", vel=84, staccato=0.6)
                    self.chord("brass", tb, 1.5, "Eb9", 0.5, 82)
            if i in REPLIES:
                line(P["vibes"], t, REPLIES[i], vel=78 if full else 74, staccato=0.95)
                if full:
                    line(P["piano"], t, REPLIES[i], vel=62, transpose=-12, staccato=0.9)
            # drums
            if i < 7:
                rows = {"kick": "X......x..X....." if i % 2 == 0 else "X.....x...X..x..",
                        "snare": "....X......oX..." if i % 2 == 0 else "....X..o....X.o.",
                        "hat": "x.xox.xox.xox.xo" if not full else "x.xox.xox.xox.x."}
                if full:
                    rows["clap"] = "....x.......x..."
                    if i % 2 == 1:
                        rows["ohat"] = "..............x."
                self.drums(tb, rows, vel={"X": 108, "x": 84, "o": 40})
            else:
                rows = {"kick": "X.....X.........", "snare": "x.....X.........", "hat": "x.....x........."}
                if last_fill:
                    rows["snare"] = "x.....X.....oxxX"
                    rows["tom_lo"] = "..............x."
                self.drums(tb, rows, vel={"X": 110, "x": 86, "o": 50})
                if full:
                    self.drums(tb, {"crash": "......x........."}, vel={"x": 72})
            # tech pulse: every other bar in A, every bar in A' (half a bar on the turnaround)
            if full or i % 2 == 0:
                self.pulse_bar(tb, A_ROOTS[i], 46 if not full else 52, beats=2 if i == 7 else 4)
            # A': muted guitar chops on 3rd/7th shells
            if full and i < 7:
                pat = "x.xx.x.xx.x.xx.x" if i % 2 == 0 else "x.x..xx.x.x..x.x"
                for k, c in enumerate(pat):
                    if c == "x":
                        C.chord(P["gtr"], t + 0.25 * k, 0.12, A_GTR[i], 72 if k % 4 == 0 else 56)
        if full:
            P["kit"].hit(K["crash"], self.b(bar), 96)
            for i, n in enumerate(A_CELLI):
                P["celli"].note(n, self.b(bar + i), 3.9, 70)
            swell(P["celli"], self.b(bar), self.b(bar) + 1.0, 40, 72)
            for i, n in enumerate(A_VIOLINS):
                P["violins"].note(n, self.b(bar + i), 3.9, 64)
            swell(P["violins"], self.b(bar), self.b(bar) + 2.0, 30, 64)
            swell(P["violins"], self.b(bar + 7), self.b(bar + 8), 64, 78)

    # ---------------------------------------------------------------- B section
    def b_section(self, bar: int):
        P = self.p
        for i in range(8):
            t = self.b(bar + i)
            C.chord(P["ep"], t, 1.6, B_EP[i], 58, roll=0.03)
            C.chord(P["ep"], t + 2.5, 1.2, B_EP[i], 48, roll=0.02)
            C.chord(P["pad"], t, 4.0, B_PAD[i], 52)
            line(P["bass"], t, B_BASS[i], vel=90, staccato=0.92)
            line(P["piano"], t, B_MELODY[i], vel=76 + (4 if i >= 4 else 0), staccato=0.96)
            P["piano"].sustain(t + 0.05, t + 3.9)
            if i < 6:
                root, mode = B_TAILS[i]
                motif.place(P["pizz"], t + 1.0, root, mode=mode, form="tail", vel=74, staccato=0.6, last_dur=0.5)
            P["celli"].note(B_CELLI[i], t, 3.95, 66)
            for n in B_VIOLAS[i].split():
                P["violas"].note(n, t, 3.95, 60)
            if i in B_VIOLINS:
                P["violins"].note(B_VIOLINS[i], t, 3.95, 60)
            # drums: light first half (cross-stick, shaker), backbeat from bar 5, build on bar 8
            if i < 4:
                rows = {"kick": "X.........x.....", "xstick": "....x.......x...", "shaker": "x.x.x.x.x.x.x.x.", "shaker2": ".x.x.x.x.x.x.x.x"}
                vel = {"X": 96, "x": 66, "o": 34}
            elif i < 7:
                rows = {"kick": "X.........x..x..", "snare": "....x.......x...", "hat": "x.x.x.x.x.x.x.x.", "shaker": "x...x...x...x..."}
                vel = {"X": 100, "x": 72, "o": 36}
            else:
                rows = {"kick": "X...X...X...X...", "roll": "x...............", "tom_hi": "............x.x.", "tom_lo": ".............x.x"}
                vel = {"X": 96, "x": 74, "o": 40}
            self.drums(bar + i, rows, vel=vel)
        swell(P["celli"], self.b(bar), self.b(bar + 1), 40, 70)
        swell(P["violas"], self.b(bar), self.b(bar + 1), 36, 64)
        swell(P["violins"], self.b(bar + 4), self.b(bar + 5), 20, 62)
        swell(P["celli"], self.b(bar + 6), self.b(bar + 8), 70, 92, shape=1.6)
        swell(P["violas"], self.b(bar + 6), self.b(bar + 8), 64, 88, shape=1.6)
        swell(P["violins"], self.b(bar + 6), self.b(bar + 8), 62, 92, shape=1.6)
        P["kit"].hit(K["swell_short"], self.b(bar + 8) - 2.5 / SPB, 92)

    # ---------------------------------------------------------------- coda
    def coda(self, bar: int):
        P = self.p
        t = self.b(bar)
        motif.place(P["piano"], t, "D4", vel=94, octaves=(0, 12, -12))
        motif.place(P["vibes"], t, "D5", vel=80)
        motif.place(P["bass"], t, "D2", vel=104, staccato=0.8)
        motif.place(P["pizz"], t, "D4", vel=90, staccato=0.6)
        motif.place(P["celli"], t, "D3", vel=88, staccato=0.9)
        swell(P["celli"], t, t + 0.1, 0, 96)
        swell(P["celli"], t + 3.6, t + 4.0, 96, 0)
        for beat, vel in zip(motif.ONSETS, (112, 84, 110, 96, 118)):
            P["kick"].hit(36, t + beat, vel)
            P["kit"].hit(K["snare"], t + beat, vel - 12)
        C.chord(P["brass"], t + 2.0, 1.6, "A3 D4 F4 A4", 100)
        C.chord(P["ep"], t + 2.0, 1.9, "A3 C4 F4", 76, roll=0.015)
        C.chord(P["piano"], t + 2.0, 1.9, "D2 A2", 84)
        P["kit"].hit(K["crash"], t + 2.0, 110)
        P["piano"].sustain(t + 2.05, t + 3.6)
        # Badger has the last word
        self.badger(bar + 1, 0.0, vel=104)
        C.chord(P["piano"], self.b(bar + 1) + 1.0, 2.5, "D1 D2", 70)
        P["piano"].sustain(self.b(bar + 1) + 1.05, self.b(bar + 1) + 3.5)

    # ---------------------------------------------------------------- humanise and mix
    def finish(self, seed: str, swing: bool = True):
        """Humanise every part. swing=False for cues timed in absolute seconds (the intro sting)."""
        s, P = self.s, self.p
        sw = 0.55 if swing else None
        sw_keys = 0.54 if swing else None
        humanize_part(P["piano"], s, timing_ms=6, drift_ms=3, velocity=4, seed=f"{seed}-piano", roll_ms=14)
        humanize_part(P["vibes"], s, timing_ms=6, drift_ms=3, velocity=5, seed=f"{seed}-vibes")
        humanize_part(P["ep"], s, timing_ms=7, drift_ms=4, velocity=4, seed=f"{seed}-ep", swing=sw_keys, swing_grid=0.25)
        humanize_part(P["bass"], s, timing_ms=4, drift_ms=3, velocity=4, seed=f"{seed}-bass", swing=sw_keys, swing_grid=0.25, lay_back_ms=7)
        # one drummer: kick and kit share the slow drift (same seed); each hit gets its own jitter
        humanize_part(P["kit"], s, timing_ms=3.5, drift_ms=2.5, velocity=6, seed=f"{seed}-drums", swing=sw, swing_grid=0.25)
        humanize_part(P["kick"], s, timing_ms=2.5, drift_ms=2.5, velocity=4, seed=f"{seed}-drums", swing=sw, swing_grid=0.25)
        humanize_part(P["gtr"], s, timing_ms=4, drift_ms=2, velocity=7, seed=f"{seed}-gtr", swing=sw, swing_grid=0.25)
        humanize_part(P["pulse"], s, timing_ms=1.0, drift_ms=0.5, velocity=3, seed=f"{seed}-pulse")
        for name in ("pizz", "celli_pizz", "basses_pizz", "brass", "harp", "glock"):
            humanize_part(P[name], s, timing_ms=5, drift_ms=3, velocity=4, seed=f"{seed}-{name}")
        for name in ("celli", "violas", "violins", "pad", "violins_trem", "violas_trem"):
            humanize_part(P[name], s, timing_ms=10, drift_ms=4, velocity=3, seed=f"{seed}-{name}")

    def tracks(self, faders: dict | None = None) -> list:
        """Mixer channels for every part that has notes. `faders` overrides fader dB by track name."""
        from composer import instruments as I

        pk = self.pocket
        tr = [
            C.piano(fader=0.0, plate=-11.0, pocket=pk),
            C.vibes(fader=-6.5, pan=0.3, hall=-9.0, pocket=pk),
            C.ep(fader=-5.0, pan=-0.25, pocket=pk),
            C.pad(fader=-13.0, cutoff=1000.0, pocket=pk),
            C.pulse(fader=-11.0, pocket=pk),
            C.brass(fader=-5.5, pocket=pk),
            C.guitar(fader=-8.0, pan=0.45, pocket=pk),
            C.bass(fader=-5.0 if pk else -2.0),
            C.sub(fader=-18.0 if pk else -10.0),
            *C.kick(fader=-7.0 if pk else -4.5, f_end=55.0),
            *C.kit_tracks(toms=-10.0, claps=-9.5, hats=-8.0, pocket=pk),
            C.strings("pizz", "violas", "pizz", fader=-7.0, pan=-0.35, width=0.6, hall=-10.0, pocket=pk),
            C.strings("celli_pizz", "celli", "pizz", fader=-6.0, pan=-0.1, width=0.5, hall=-12.0, pocket=pk),
            C.strings("basses_pizz", "basses", "pizz", fader=-8.0, width=0.3, hall=-14.0, pocket=pk),
            C.strings("celli", "celli", "slow", expressive=True, fader=-7.0, pan=-0.15, width=0.7, pocket=pk),
            C.strings("violas", "violas", "slow", expressive=True, fader=-8.0, pan=0.2, width=0.7, pocket=pk),
            C.strings("violins", "violins", "slow", expressive=True, fader=-10.0, pan=-0.05, width=0.5, pocket=pk),
            C.strings("violins_trem", "violins", "trem", fader=-12.0, pan=-0.1, width=0.5, pocket=pk),
            C.strings("violas_trem", "violas", "trem", fader=-12.0, pan=0.15, width=0.5, pocket=pk),
            C.mallets("harp", I.harp(), fader=-6.0, pan=-0.3, hall=-9.0, hp=80.0, pocket=pk),
            C.mallets("glock", I.glock(), fader=-14.0, pan=0.35, hall=-10.0, hp=400.0, pocket=pk),
        ]
        used = {n for n, p in self.p.items() if p.notes}
        out = [t for t in tr if (t.part or t.name) in used]
        for name, clip, fader, hall in self.clips:
            out.append(C.audio(name, clip, fader=fader, hall=hall))
        for t in out:
            if faders and t.name in faders:
                t.fader_db = faders[t.name]
        return out


def arrangement(cue_id: str, kind: str) -> Arrangement:
    th = Theme()
    if kind == "full":
        th.intro(0)
        th.a_section(2)
        th.b_section(10)
        th.a_section(18, full=True)
        th.coda(26)
        length, preset, fade = 28 * BAR * SPB + 1.2, "standalone", 1.0
    elif kind == "15s":
        # | motif solo | Badger + pickup | motif on G (band) | turnaround hits | motif in unison | Badger |
        th.intro(0)
        th.a_section(0, bars=[2, 7], at={2: 2, 7: 3})
        th.coda(4)
        length, preset, fade = 15.0, "standalone", 0.8
    elif kind == "5s":
        th.coda(0)
        length, preset, fade = 5.0, "sting", 0.6
    else:
        raise ValueError(kind)
    th.finish(cue_id)
    return Arrangement(cue_id, th.s, length, th.tracks(), preset=preset, reverbs=C.reverbs(), fade_out=fade,
                       bus_eq=[C.PK(250, -1.0, 0.9), C.PK(1000, -1.0, 1.0), C.PK(4500, 2.0, 0.7), C.HS(9000, 1.5)])
