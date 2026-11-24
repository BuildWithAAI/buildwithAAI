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
from composer.targets import STANDALONE_LUFS

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
# The 15 s cut answers on the G bar instead of stating the motif a third time: Gm9 (D C Bb A), then
# Eb9 (G F Db); the D-flat is the next bar's C-sharp, the third of A7.
REPLY_ON_G = "r:.5 D6:.25 C6:.25 Bb5:.5 A5:.5 G5:.5 F5:.5 Db5:1"
A_VIOLINS = ["D6", "C#6", "G5", "G5", "D6", "D6", "D6", "C#6"]
A_CELLI = ["D3", "A2", "G2", "A2", "D3", "Bb2", "G2", "G2"]  # bar 7: G is in both Em7b5 and A7b13
# A': the pad and violas hold each chord (3-note pad voicings and 2-note violas, no semitone or minor-ninth
# rub against the EP's voicings, the strings or the motif; audited by test_no_unintended_clashes_in_the_theme)
A_PAD = {"Dm9": "F3 A3 E4", "Bb9": "F3 Ab3 D4", "A7b13": "G3 C#4 E4", "A7b9": "G3 C#4 E4", "Gm9": "G3 D4 F4", "Eb9": "G3 Db4 F4",
         "Em7b5": "G3 D4 E4", "Bbmaj7#11": "F3 A3 D4", "C13": "E3 G3 D4", "Em7b5low": "G3 D4 E4"}
A_VIOLAS = {"Dm9": "A4 C5", "Bb9": "F4 Ab4", "A7b13": "G4 C#5", "A7b9": "G4 C#5", "Gm9": "F4 D5", "Eb9": "G4 Db5",
            "Em7b5": "G4 D5", "Bbmaj7#11": "D4 A4", "C13": "E4 G4", "Em7b5low": "G4 D5"}

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

# Badger's cross-stick: its own track (BADGER_XSTICK_DB), velocities 96 and 88, a dry click a phone
# carries (round 1 brought it up: it sat 26-40 dB under the mix). Critic round 2: once his double came
# down, this click (17 dB peak-to-loudness) was the master limiter's main trigger on his notes, so it
# is 7 dB lower and low-passed at 5 kHz (BADGER_XSTICK_LP): the knock stays, the needle-sharp top goes.
BADGER_XSTICK = (96, 88)
BADGER_XSTICK_DB = -6.0
BADGER_XSTICK_LP = 5000.0
# Badger's octave-up pizzicato double (E-flat 4 to D4), its own track: fader dB. Critic round 2: at
# +11 dB with a 2 ms compressor its pluck peaked 6-7 dB over every other stem on his notes, so the
# master limiter took 8-10 dB off the whole mix there (theme-full 8.3 dB, theme-15s 9.9 dB). The
# compressor now holds the pluck (4:1, 0.5 ms attack, from -24 dB) and a 1.5 kHz lift
# (BADGER_MID_PRESENCE) carries him on a phone, so the level is set by the phone check (the critic's
# +5 dB left him 4-5 dB under the motif there): at +10 dB he is within 3 dB of the motif on the phone
# model in every cue with his figure (theme-full -2.9, theme-15s -2.8, theme-5s -2.9 dB, measured)
# and the master limiter stays under 4 dB on his notes.
BADGER_MID_DB = 10.0
BADGER_MID_COMP = dict(threshold_db=-24.0, ratio=4.0, attack_ms=0.5, release_ms=90.0, knee_db=6.0)
BADGER_MID_PRESENCE = (1500.0, 4.0, 1.0)  # PK: Hz, dB, Q
# the basses' pizzicato under his low notes (fader dB): it doubles the bass at the unison, adds peak and
# no phone presence
BADGER_BASSES_DB = -11.0
# Peak control on his two tracks (render.shave_peaks; the gain staging keeps their loudness). Measured
# on theme-full: his stacked transients (cross-stick 50 %, the double 29 % of the window's peak) drove
# the master limiter to 9.2 dB of gain reduction on his button, pulling everything down on his notes:
# he sat 6.1 dB under the coda motif on the phone model. Soft-clipping the click by 12 dB and
# limiting the double's attack by 8 dB leave the limiter less to do there.
BADGER_XSTICK_SHAVE = {"shave_db": 12.0, "kind": "clip"}
BADGER_MID_SHAVE = {"shave_db": 8.0, "kind": "limit", "release_ms": 60.0, "lookahead_ms": 3.0}
# (round 1 put a soft kick under each of his notes; critic round 2: its sub is inaudible on a phone but
# not to the limiter, and on a cue with no other kick the track's gain staging made it full-size: it is gone)

# Band cues (theme, stings, bumpers, the end-screen music): drum and stab compressors fast enough to
# hold each hit's attack (critic round 2: the turnaround's and the coda button's stacked kick, snare,
# claps, EP, brass and piano hits drove the master limiter to 6-8 dB). Beds keep the softer, slower
# settings. Measured on theme-full at -15 LUFS-I: 5.96 dB of limiting without the claps compressor and
# the piano's peak control (BAND_PEAK_SHAVE), 4.84 dB with them; at the theme's -16 LUFS-I, 3.7 dB.
BAND_COMPS = {
    "snare": dict(threshold_db=-18.0, ratio=4.0, attack_ms=1.0, release_ms=80.0, knee_db=4.0),
    "kick": dict(threshold_db=-18.0, ratio=3.0, attack_ms=2.0, release_ms=80.0, knee_db=4.0),
    "hats": dict(threshold_db=-20.0, ratio=3.0, attack_ms=1.0, release_ms=60.0, knee_db=4.0),
    "claps": dict(threshold_db=-20.0, ratio=4.0, attack_ms=0.5, release_ms=80.0, knee_db=4.0),
    "ep": dict(threshold_db=-24.0, ratio=3.0, attack_ms=3.0, release_ms=120.0, knee_db=6.0),
    "brass": dict(threshold_db=-22.0, ratio=3.0, attack_ms=3.0, release_ms=120.0, knee_db=6.0),
}
# Band cues: the piano's hammer peaks held to 14 dB over its own loudness (render.shave_peaks with
# max_plr_db: a 2 ms look-ahead limiter on the stem, so only the hits that stick out are touched). The
# motif's three-octave piano on the coda button was the largest single peak under the limiter.
BAND_PEAK_SHAVE = {"piano": {"max_plr_db": 14.0, "kind": "limit", "release_ms": 80.0, "lookahead_ms": 2.0}}

DRUM_KEYS = {"snare": K["snare"], "ghost": K["tap"], "hat": K["hat"], "ohat": K["hat_open"], "pedal": K["hat_pedal"],
             "xstick": K["xstick"], "clap": K["clap"], "shaker": K["shaker_down"], "shaker2": K["shaker_up"], "tamb": K["tamb"],
             "crash": K["crash"], "tom_hi": K["tom_high"], "tom_lo": K["tom_low"], "roll": K["snare_roll"], "swell": K["swell_short"],
             "rim": K["rim"]}


def _badger_mid(pocket: bool):
    """Badger's octave-up pizzicato double: compressed hard and fast (4:1, 0.5 ms) so its body, not its
    pluck, carries, 3 dB lighter at 300 Hz (its fundamentals sit under a phone's range anyway) and
    lifted at 1.5 kHz, where a phone speaker is loudest (critic round 2)."""
    from composer.render import Track
    from audiolib.dynamics import Compressor

    t = C.strings("badger_mid", "celli", "pizz", fader=BADGER_MID_DB, pan=-0.1, width=0.4, hall=-12.0, pocket=pocket)
    t.eq = [*t.eq, C.PK(300, -3.0, 1.2), C.PK(*BADGER_MID_PRESENCE)]
    t.comp = Compressor(**BADGER_MID_COMP)  # make-up gain is in BADGER_MID_DB
    t.peak_shave = dict(BADGER_MID_SHAVE)
    assert isinstance(t, Track)
    return t


class Theme:
    """Writes the theme's sections into one Score; the full theme and its cuts reuse the same bars."""

    PARTS = ("piano", "vibes", "ep", "pad", "pulse", "brass", "gtr", "bass", "sub", "kick", "kit",
             "pizz", "celli", "violas", "violins", "basses_pizz", "celli_pizz", "harp", "glock", "violins_trem", "violas_trem",
             "violas_fast", "vibes_bowed", "badger_mid", "badger_xstick")

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

    def badger(self, bar: float, beat: float = 0.0, vel: int = 100, spacing: float = 1.0):
        """Badger's figure (Eb then D, `spacing` beats apart): plucked bass, celli and basses pizzicato
        and a dry cross-stick under each note. The celli also double it an octave up (Eb4-D4) at
        velocity 84 (critic round 1: in the low octaves alone the figure fell 2.6-5.0 dB under the
        motif on a phone speaker), on its own track so its level is set by measurement. Critic round
        2: no kick under his notes any more (see BADGER_XSTICK_DB and BADGER_MID_DB for the levels)."""
        t = self.b(bar) + beat
        motif.place_badger(self.p["bass"], t, "D2", vel=vel, spacing=spacing)
        motif.place_badger(self.p["celli_pizz"], t, "D3", vel=vel - 4, spacing=spacing)
        motif.place_badger(self.p["badger_mid"], t, "D4", vel=84, spacing=spacing)
        motif.place_badger(self.p["basses_pizz"], t, "D2", vel=vel - 10, spacing=spacing)
        for k in range(2):
            self.p["badger_xstick"].hit(K["xstick"], t + k * spacing, BADGER_XSTICK[k])

    def pulse_bar(self, tb: int, root: str, vel: int, beats: int = 4, octave: int = 0):
        """A bar of 16th pulse on the root, root, fifth, octave. `octave` (semitones) lifts it: under the
        voice the pulse sits an octave up, out of Zoo's F0 and second harmonic (68-240 Hz)."""
        t = self.b(tb)
        lo = {"D": "D3", "A": "A2", "G": "G2", "E": "E3", "Bb": "Bb2"}[root]
        from audiolib.core import note_number
        r = note_number(lo) + octave
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
    def a_section(self, bar: int, full: bool = False, bars=range(8), last_fill: bool = True, at: dict | None = None,
                  motif_bars=(0, 2, 4), extra_replies: dict | None = None):
        """Write A-section bars `bars` (0-7) at bar + i, or at at[i] when given (for the cuts).
        `motif_bars`: the A bars that state the motif; `extra_replies`: {A bar: vibes line} added answers."""
        P = self.p
        replies = {**REPLIES, **(extra_replies or {})}
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
            if i in (0, 4) and i in motif_bars:
                motif.place(P["piano"], t, "D4", vel=88 if full else 84, octaves=(0, 12))
                C.chord(P["piano"], t, 1.4, "D3", 60)
                if full:
                    motif.place(P["vibes"], t, "D5", vel=74)
                    motif.place(P["pizz"], t, "D4", vel=86, staccato=0.6)
                    self.chord("brass", tb, 1.5, "Bb9", 0.5, 84)
            elif i == 2 and i in motif_bars:
                motif.place(P["piano"], t, "G3", vel=86 if full else 82, octaves=(0, 12))
                if full:
                    motif.place(P["vibes"], t, "G4", vel=72)
                    motif.place(P["pizz"], t, "G3", vel=84, staccato=0.6)
                    self.chord("brass", tb, 1.5, "Eb9", 0.5, 82)
            if i in replies:
                line(P["vibes"], t, replies[i], vel=78 if full else 74, staccato=0.95)
                if full:
                    line(P["piano"], t, replies[i], vel=62, transpose=-12, staccato=0.9)
            # drums
            if i < 7:
                rows = {"kick": "X......x..X....." if i % 2 == 0 else "X.....x...X..x..",
                        "snare": "....X......oX..." if i % 2 == 0 else "....X..o....X.o.",
                        "hat": "x.xox.xox.xox.xo" if not full else "x.xox.xox.xox.x."}
                if full:
                    rows["clap"] = "....x.......x..."
                    if i % 2 == 1:
                        rows["ohat"] = "..............x."
                self.drums(tb, rows, vel={"X": 110, "x": 86, "o": 42} if full else {"X": 108, "x": 84, "o": 40})
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
                self.pulse_bar(tb, A_ROOTS[i], 46 if not full else 64, beats=2 if i == 7 else 4)
            # A': muted guitar chops on 3rd/7th shells
            if full and i < 7:
                pat = "x.xx.x.xx.x.xx.x" if i % 2 == 0 else "x.x..xx.x.x..x.x"
                for k, c in enumerate(pat):
                    if c == "x":
                        C.chord(P["gtr"], t + 0.25 * k, 0.12, A_GTR[i], 72 if k % 4 == 0 else 56)
        if full:  # A': the pad and violas hold the harmony (more body, no new transients for the limiter)
            for i in range(8):
                ch = [(beat, c) for bb, beat, c in A_CHORDS if bb == i]
                for j, (beat, c) in enumerate(ch):
                    span = (ch[j + 1][0] if j + 1 < len(ch) else 4.0) - beat
                    C.chord(P["pad"], self.b(bar + i) + beat, span - 0.05, A_PAD[c], 76)
                    C.chord(P["violas"], self.b(bar + i) + beat, span - 0.05, A_VIOLAS[c], 72)
            swell(P["violas"], self.b(bar), self.b(bar) + 1.0, 40, 70)
            P["kit"].hit(K["crash"], self.b(bar), 104)
            for i, n in enumerate(A_CELLI):
                P["celli"].note(n, self.b(bar + i), 3.9, 74)
            swell(P["celli"], self.b(bar), self.b(bar) + 1.0, 50, 82)
            for i, n in enumerate(A_VIOLINS):
                P["violins"].note(n, self.b(bar + i), 3.9, 76)
            swell(P["violins"], self.b(bar), self.b(bar) + 2.0, 46, 84)
            swell(P["violins"], self.b(bar + 7), self.b(bar + 8), 84, 96)

    # ---------------------------------------------------------------- B section
    def b_section(self, bar: int):
        P = self.p
        for i in range(8):
            t = self.b(bar + i)
            C.chord(P["ep"], t, 1.6, B_EP[i], 42, roll=0.03)
            C.chord(P["ep"], t + 2.5, 1.2, B_EP[i], 30, roll=0.02)
            C.chord(P["pad"], t, 4.0, B_PAD[i], 52)
            line(P["bass"], t, B_BASS[i], vel=64, staccato=0.92)
            line(P["piano"], t, B_MELODY[i], vel=46 + (4 if i >= 4 else 0), staccato=0.96)
            P["piano"].sustain(t + 0.05, t + 3.9)
            if i < 6:
                root, mode = B_TAILS[i]
                motif.place(P["pizz"], t + 1.0, root, mode=mode, form="tail", vel=52, staccato=0.6, last_dur=0.5)
            P["celli"].note(B_CELLI[i], t, 3.95, 66)
            for n in B_VIOLAS[i].split():
                P["violas"].note(n, t, 3.95, 60)
            if i in B_VIOLINS:
                P["violins"].note(B_VIOLINS[i], t, 3.95, 60)
            # drums: cross-stick and shaker only (critic round 1: the backbeat with snare and hats in
            # bars 5-7 made B louder than A); bars 5-7 only push the kick and lift the shaker a little,
            # and bar 8 builds into A'
            if i < 4:
                rows = {"kick": "X.........x.....", "xstick": "....x.......x...", "shaker": "x.x.x.x.x.x.x.x.", "shaker2": ".x.x.x.x.x.x.x.x"}
                vel = {"X": 62, "x": 44, "o": 26}
            elif i < 7:
                rows = {"kick": "X.........x..x..", "xstick": "....x.......x...", "shaker": "x.x.x.x.x.x.x.x.", "shaker2": ".x.x.x.x.x.x.x.x"}
                vel = {"X": 66, "x": 46, "o": 28}
            else:
                rows = {"kick": "X...X...X...X...", "roll": "x...............", "tom_hi": "............x.x.", "tom_lo": ".............x.x"}
                vel = {"X": 72, "x": 54, "o": 34}
            self.drums(bar + i, rows, vel=vel)
        # B is the quiet contrast (critic round 1: it measured louder than A); the strings still swell into A'
        swell(P["celli"], self.b(bar), self.b(bar + 1), 30, 52)
        swell(P["violas"], self.b(bar), self.b(bar + 1), 26, 48)
        swell(P["violins"], self.b(bar + 4), self.b(bar + 5), 14, 46)
        swell(P["celli"], self.b(bar + 6), self.b(bar + 8), 58, 86, shape=1.8)
        swell(P["violas"], self.b(bar + 6), self.b(bar + 8), 54, 82, shape=1.8)
        swell(P["violins"], self.b(bar + 6), self.b(bar + 8), 52, 86, shape=1.8)
        P["kit"].hit(K["swell_short"], self.b(bar + 8) - 2.5 / SPB, 50)  # into A': it was B's loudest element

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
        C.chord(P["brass"], t + 2.0, 1.6, "A3 D4 F4 A4", 90)
        C.chord(P["ep"], t + 2.0, 1.9, "A3 C4 F4", 76, roll=0.015)
        C.chord(P["piano"], t + 2.0, 1.9, "D2 A2", 84)
        P["kit"].hit(K["crash"], t + 2.0, 110)
        P["piano"].sustain(t + 2.05, t + 3.6)
        # Badger has the last word
        self.badger(bar + 1, 0.0, vel=104)
        C.chord(P["piano"], self.b(bar + 1) + 1.0, 2.5, "D1 D2", 70)
        P["piano"].sustain(self.b(bar + 1) + 1.05, self.b(bar + 1) + 3.5)

    # ---------------------------------------------------------------- humanise and mix
    def finish(self, seed: str, swing: bool = True, comp_velocity: float = 4.0):
        """Humanise every part (after tuning the kicks to the bass). swing=False for cues timed in
        absolute seconds (the intro sting). comp_velocity: the EP's and bass's velocity spread (beds
        use 8: their comping repeats for a minute, and a spread of 4 measured a flat 4-7 standard
        deviation)."""
        from composer import synths as S

        s, P = self.s, self.p
        S.kick_tuning(s)
        sw = 0.55 if swing else None
        sw_keys = 0.54 if swing else None
        humanize_part(P["piano"], s, timing_ms=6, drift_ms=3, velocity=4, seed=f"{seed}-piano", roll_ms=14)
        humanize_part(P["vibes"], s, timing_ms=6, drift_ms=3, velocity=5, seed=f"{seed}-vibes")
        humanize_part(P["ep"], s, timing_ms=7, drift_ms=4, velocity=comp_velocity, seed=f"{seed}-ep", swing=sw_keys, swing_grid=0.25)
        humanize_part(P["bass"], s, timing_ms=4, drift_ms=3, velocity=comp_velocity, seed=f"{seed}-bass", swing=sw_keys, swing_grid=0.25, lay_back_ms=7)
        # one drummer: kick and kit share the slow drift (same seed); each hit gets its own jitter
        humanize_part(P["kit"], s, timing_ms=3.5, drift_ms=2.5, velocity=6, seed=f"{seed}-drums", swing=sw, swing_grid=0.25)
        humanize_part(P["kick"], s, timing_ms=2.5, drift_ms=2.5, velocity=4, seed=f"{seed}-drums", swing=sw, swing_grid=0.25)
        humanize_part(P["badger_xstick"], s, timing_ms=2.5, drift_ms=2.5, velocity=3, seed=f"{seed}-drums", swing=sw, swing_grid=0.25)
        humanize_part(P["gtr"], s, timing_ms=4, drift_ms=2, velocity=7, seed=f"{seed}-gtr", swing=sw, swing_grid=0.25)
        humanize_part(P["pulse"], s, timing_ms=1.0, drift_ms=0.5, velocity=3, seed=f"{seed}-pulse")
        for name in ("pizz", "celli_pizz", "basses_pizz", "brass", "harp", "glock", "violas_fast", "badger_mid"):
            humanize_part(P[name], s, timing_ms=5, drift_ms=3, velocity=4, seed=f"{seed}-{name}")
        for name in ("celli", "violas", "violins", "pad", "violins_trem", "violas_trem", "vibes_bowed"):
            humanize_part(P[name], s, timing_ms=10, drift_ms=4, velocity=3, seed=f"{seed}-{name}")

    def tracks(self, faders: dict | None = None) -> list:
        """Mixer channels for every part that has notes. `faders` overrides fader dB by track name."""
        from composer import instruments as I

        pk = self.pocket
        gtr = C.guitar(fader=-14.0, pan=0.45, pocket=pk)
        gtr.eq = [*gtr.eq, C.LP(2500, 4)]  # critic round 1: the muted-guitar model's 4-12 kHz read as ticks
        tr = [
            C.piano(fader=0.0, plate=-11.0, pocket=pk),
            C.vibes(fader=-6.5, pan=0.3, hall=-9.0, pocket=pk),
            C.ep(fader=-5.0, pan=-0.25, pocket=pk),
            C.pad(fader=-13.0, cutoff=1000.0, pocket=pk),
            C.pulse(fader=-11.0, pocket=pk),
            C.brass(fader=-5.5, pocket=pk),
            gtr,
            C.bass(fader=-5.0 if pk else -2.0, lp=C.BASS_LP_BED if pk else C.BASS_LP_BAND),
            C.sub(fader=-18.0 if pk else -10.0),
            # beds keep the beater 9 dB under the kick (stings and the theme: 5 dB, KICK-FIX), so its click
            # does not tick under Zoo's consonants
            *C.kick(fader=-7.0 if pk else -4.5, f_end=55.0, gm_layer_db=-9.0 if pk else -5.0, pocket=pk),
            *C.kit_tracks(toms=-10.0, claps=-9.5, hats=-8.0, pocket=pk),
            C.strings("pizz", "violas", "pizz", fader=-7.0, pan=-0.35, width=0.6, hall=-10.0, pocket=pk),
            C.strings("celli_pizz", "celli", "pizz", fader=-6.0, pan=-0.1, width=0.5, hall=-12.0, pocket=pk),
            C.strings("basses_pizz", "basses", "pizz", fader=BADGER_BASSES_DB, width=0.3, hall=-14.0, pocket=pk),
            C.strings("celli", "celli", "slow", expressive=True, fader=-7.0, pan=-0.15, width=0.7, pocket=pk),
            C.strings("violas", "violas", "slow", expressive=True, fader=-8.0, pan=0.2, width=0.7, pocket=pk),
            C.strings("violins", "violins", "slow", expressive=True, fader=-10.0, pan=-0.05, width=0.5, pocket=pk),
            C.strings("violins_trem", "violins", "trem", fader=-12.0, pan=-0.1, width=0.5, pocket=pk),
            C.strings("violas_trem", "violas", "trem", fader=-12.0, pan=0.15, width=0.5, pocket=pk),
            C.mallets("harp", I.harp(), fader=-6.0, pan=-0.3, hall=-9.0, hp=80.0, pocket=pk),
            C.mallets("glock", I.glock(), fader=-14.0, pan=0.35, hall=-10.0, hp=400.0, pocket=pk),
            C.strings("violas_fast", "violas", "fast", fader=-6.0, pan=0.1, width=0.6, hall=-11.0, pocket=pk),
            _badger_mid(pk),
            C.Track("badger_xstick", I.kit("tight"), part="badger_xstick", only={K["xstick"]}, fader_db=BADGER_XSTICK_DB, pan=0.1,
                    eq=[C.HP(150), C.PK(650, -2.0, 1.4), C.LP(BADGER_XSTICK_LP, 2)], width=0.4, sends={"room": -16.0},
                    peak_shave=dict(BADGER_XSTICK_SHAVE)),
            C.mallets("vibes_bowed", I.vibes_bowed(), fader=-14.0, pan=-0.15, hall=-8.0, hp=250.0, pocket=pk),
        ]
        used = {n for n, p in self.p.items() if p.notes}
        out = [t for t in tr if (t.part or t.name) in used]
        for name, clip, fader, hall in self.clips:
            out.append(C.audio(name, clip, fader=fader, hall=hall))
        if not pk:  # band cues: hold the drum, stab and piano attacks (BAND_COMPS, BAND_PEAK_SHAVE)
            from audiolib.dynamics import Compressor

            for t in out:
                if t.name in BAND_COMPS:
                    t.comp = Compressor(**BAND_COMPS[t.name])
                if t.name in BAND_PEAK_SHAVE:
                    t.peak_shave = dict(BAND_PEAK_SHAVE[t.name])
        for t in out:
            if faders and t.name in faders:
                t.fader_db = faders[t.name]
        return out


# theme-full: mix automation on the bus (dB per section, ramped over the beat before each section).
# Critic round 1 asked for B at least 2 LU under A and A' at least 1.5 LU over it; the master limiter
# keeps about 40 % of the B contrast and 60 % of the A' contrast that the arrangement writes, so the
# arrangement does most of it and this ride the rest (measured, see the README). Critic round 2: A'
# sat on a +-0.5 LU plateau for 19 s, so its second phrase (bars 22-24) lifts 1 dB and the
# turnaround bar before the coda (bar 25) comes back down 1 dB.
FULL_RIDE_DB = (("intro", 0, 0.0), ("A", 2, -0.4), ("B", 10, -1.1), ("A'", 18, 0.2), ("A' lift", 22, 1.2), ("turnaround", 25, 0.2),
                ("coda", 26, 0.0))


def full_ride() -> list:
    """(seconds, dB) breakpoints for Arrangement.bus_ride: each gain is reached on its bar's first
    downbeat, ramping over the beat before it."""
    spb = 60.0 / BPM
    pts = [(0.0, FULL_RIDE_DB[0][2])]
    for (_, _, g0), (_, bar, g1) in zip(FULL_RIDE_DB, FULL_RIDE_DB[1:]):
        t = bar * BAR * spb
        pts += [(t - spb, g0), (t, g1)]
    return pts


# theme-full and theme-15s master at -16 LUFS-I, the stings' level (composer/targets.py STANDALONE_LUFS,
# which also sets their check window). Critic round 2 accepts the theme when the master limiter takes
# at most 4 dB and works over 1 dB for at most 8 % of the cue, with -15 as its fallback: at -14 the
# limiter took 7-9 dB off the turnaround hits and Badger's notes, at -15 still 4.8 dB off theme-full's
# coda button (10.6 % over 1 dB in theme-15s); at -16 it takes 3.7 dB (theme-full) and 3.2 dB
# (theme-15s, 6.3 %). A -16 upload plays 2 LU under -14 programme on YouTube (it turns loud uploads
# down, never quiet ones up); inside an episode the renderer sets the level.
THEME_LUFS = STANDALONE_LUFS

# theme-5s: two video frames of silence before the downbeat, so a placement a frame early never
# clips the attack (critic round 1: it started with a full-band hit at sample 0)
PRE_ROLL_5S = 2 / 30.0

# KICK-FIX for stings and bumpers (critic round 1): on every landing the 55 Hz kick was the loudest or
# second-loudest element, which a phone speaker drops. The synth kick comes down 3 dB, its beater
# layer sits 5 dB under it (was 9), and the snare comes up 2 dB.
STING_FADERS = {"kick": -7.5, "kick_beater": -12.5, "snare": -1.0}

# theme-full's arc (critic round 1: B measured louder than A and A' only +0.9 LU over it): B lost
# its snare and hats, the pad and the EP's second hit came down; A' gets more brass and claps; the
# glue compresses less (threshold -18 dB, 1.5:1; was -22 dB, 2:1, up to 4.6 dB of reduction). The
# kick is 1 dB under the other cues': its sum with the tuned bass made the one AAC overshoot that
# reached -0.95 dBTP (bar 21), and the master limiter works less on it.
FULL_FADERS = {"brass": -3.0, "claps": -7.5, "pad": -12.0, "violas": -11.0, "kick": -5.5, "kick_beater": -10.5}
FULL_GLUE = {"threshold_db": -18.0, "ratio": 1.5}


def arrangement(cue_id: str, kind: str) -> Arrangement:
    from composer.render import DEFAULT_GLUE, STANDALONE_CEILING_DBTP, STING_CEILING_DBTP, SafeCompressor

    th = Theme()
    faders, glue, ceiling, pre_roll, target = None, None, None, 0.0, None
    if kind == "full":
        th.intro(0)
        th.a_section(2)
        th.b_section(10)
        th.a_section(18, full=True)
        th.coda(26)
        length, preset, fade = 28 * BAR * SPB + 1.2, "standalone", 1.0
        faders, glue, ceiling, target = FULL_FADERS, SafeCompressor(**{**DEFAULT_GLUE, **FULL_GLUE}), STANDALONE_CEILING_DBTP, THEME_LUFS
    elif kind == "15s":
        # | motif solo | Badger + pickup | the band: a vibes answer (no third motif) | turnaround hits | motif in unison | Badger |
        th.intro(0)
        th.a_section(0, bars=[2, 7], at={2: 2, 7: 3}, motif_bars=(), extra_replies={2: REPLY_ON_G})
        th.coda(4)
        length, preset, fade = 15.0, "standalone", 0.8
        ceiling, target = STANDALONE_CEILING_DBTP, THEME_LUFS
    elif kind == "5s":
        th.coda(0)
        length, preset, fade = 5.0 - PRE_ROLL_5S, "sting", 0.6
        pre_roll = PRE_ROLL_5S
        faders, ceiling = STING_FADERS, STING_CEILING_DBTP
    else:
        raise ValueError(kind)
    th.finish(cue_id)
    # the standalone cuts take 2 dB less air (HS 9 kHz -0.5 instead of +1.5): their hats and cymbals made
    # ffmpeg's AAC 128k encoder overshoot by up to 2.5 dB (measured over dither variants); with the
    # shelf every variant stayed at -1.1 dBTP or under
    air = -0.5 if preset == "standalone" else 1.5
    arr = Arrangement(cue_id, th.s, length, th.tracks(faders), preset=preset, reverbs=C.reverbs(), fade_out=fade,
                      bus_eq=[C.PK(250, -1.0, 0.9), C.PK(1000, -1.0, 1.0), C.PK(4500, 2.0, 0.7), C.HS(9000, air)],
                      ceiling_dbtp=ceiling, pre_roll=pre_roll, target_lufs=target)
    if glue is not None:
        arr.glue = glue
    if kind == "full":
        arr.bus_ride = full_ride()
    return arr
