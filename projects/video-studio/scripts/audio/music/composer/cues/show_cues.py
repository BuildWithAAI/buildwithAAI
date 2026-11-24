"""The show's short cues: six segment bumpers, the channel intro sting (synced to ShowSting) and the
20 s end-screen bed. All in the theme's world (D minor, 100 BPM unless noted) and built with the
theme's writer, so the instruments, mix and motif are the same family.

Bumpers (sting profile, -16 LUFS-I, clean tails), each built from the motif:
    rekt-meter       the meter fills (taps, rising pizzicato, air), then the motif's tail falls: A, Ab, F
    red-flag         motif head (D D A), a deadpan rest, Badger's figure (Eb, D); room after for a dog huff
    one-fix          the major motif (D D A G# F#) on vibes and piano, a click and a harp lift into D6/9
    scam-of-the-week the motif low and sly over a cymbal scrape; lands on Bb7(b9); a tritone glint on vibes
    developing       the tonic becomes a 16th ticker under a tremolo swell; the head lands on Dsus4(add9), unresolved
    correction       a reversed piano swell ("rewind"), then the motif backwards, calm, resolving to D minor
"""

from __future__ import annotations

from composer import instruments as I
from composer import motif
from composer import synths as S
from composer.cues import common as C
from composer.cues.theme import BADGER_XSTICK, BADGER_XSTICK_DB, STING_FADERS, Theme
from composer.instruments import K
from composer.render import STING_CEILING_DBTP, Arrangement, swell

BUMPER_BUS = [C.PK(250, -1.0, 0.9), C.PK(1000, -1.0, 1.0), C.PK(4500, 2.0, 0.7), C.HS(9000, 1.5)]

# Critic round 2: the bumpers' first hit sat at sample 0 (only theme-5s had a pre-roll), so a fade-in or
# a trim a frame early ate the attack. Every bumper now starts with two video frames of silence; the
# file keeps its length and its metadata records the downbeat (downbeatSec, downbeatStartFrame()).
BUMPER_PRE_ROLL = 2 / 30.0
# The stings master at render.STING_CEILING_DBTP (-1.5 dBTP; the engine's sting preset says -1.0): at -1.0
# the show sting decoded at -1.0 dBTP from Opus 128k and Scam of the Week at -0.7 from AAC 128k (critic
# round 2). Scam of the Week, the densest landing, masters 0.5 dB lower again.
SCAM_CEILING_DBTP = -2.0


def _arr(cid: str, th: Theme, length: float, preset: str = "sting", fade: float = 0.5, faders: dict | None = None, swing: bool = True,
         pre_roll: float = BUMPER_PRE_ROLL, ceiling: float = STING_CEILING_DBTP) -> Arrangement:
    """A bumper (or the show sting with pre_roll=0): `length` is the delivered file's length, pre-roll included."""
    th.finish(cid, swing=swing)
    return Arrangement(cid, th.s, length - pre_roll, th.tracks({**STING_FADERS, **(faders or {})}), preset=preset, reverbs=C.reverbs(), fade_out=fade,
                       bus_eq=BUMPER_BUS, pre_roll=pre_roll, ceiling_dbtp=ceiling)


def _add_eq(arr: Arrangement, track: str, *bands) -> None:
    for t in arr.tracks:
        if t.name == track:
            t.eq = [*t.eq, *bands]


def _hits(th: Theme, beats, vel=(110,), snare: bool = True):
    for k, b in enumerate(beats):
        v = vel[k % len(vel)]
        th.p["kick"].hit(36, b, v)
        if snare:
            th.p["kit"].hit(K["snare"], b, v - 14)


# ------------------------------------------------------------------------------------------ bumpers

def rekt_meter() -> Arrangement:
    th = Theme()
    P = th.p
    for k in range(8):  # the meter fills: 16th taps and a rising pizzicato arpeggio over two beats
        P["kit"].hit(K["tap"], 0.25 * k, 30 + 9 * k)
        P["pizz"].note(["D3", "F3", "A3", "D4", "F4", "A4", "D5", "F5"][k], 0.25 * k, 0.2, 58 + 5 * k)
    P["pulse"].note("D3", 0.0, 1.9, 40)
    th.clips.append(("air", S.noise_swell(1.2, seed="rekt"), -20.0, -14.0))
    # the fall: the motif's tail, stabbed by the band
    motif.place(P["piano"], 2.0, "D4", form="tail", vel=96, octaves=(0, 12, -12), staccato=0.7, last_dur=2.0)
    motif.place(P["bass"], 2.0, "D2", form="tail", vel=104, staccato=0.7, last_dur=1.8)
    motif.place(P["vibes"], 2.0, "D5", form="tail", vel=82, last_dur=2.0)
    for b, v in ((2.0, "Dm9"), (2.5, "Bb9")):
        th.chord("brass", 0, b, v, 0.35, 92)
        th.chord("violas_fast", 0, b, v, 0.35, 96)
        th.chord("ep", 0, b, v, 0.35, 80)
    th.chord("brass", 0, 3.0, "A3 D4 F4 A4", 1.6, 100)
    th.chord("violas_fast", 0, 3.0, "A3 D4 F4 A4", 1.0, 104)
    th.chord("ep", 0, 3.0, "A3 C4 F4", 1.8, 76)
    P["celli"].note("D3", 3.0, 1.8, 80)
    swell(P["celli"], 3.0, 3.05, 0, 90)
    swell(P["celli"], 3.4, 4.8, 90, 30)
    _hits(th, (2.0, 2.5, 3.0), (108, 100, 118))
    P["kit"].hit(K["crash"], 3.0, 104)
    # critic round 1: the landing's synth brass sat only 8.4 dB under the mix (an 80s-TV risk on the
    # payoff); it comes down to -9 dB and real violas (VSCO 2, fast bowing) double the stab
    return _arr("bumper-rekt-meter", th, 3.2 / 1.0, fade=0.5, faders={"brass": -9.0, "violas_fast": -6.0})


def red_flag() -> Arrangement:
    th = Theme()
    P = th.p
    motif.place(P["pizz"], 0.0, "D4", form="head", vel=86, staccato=0.6)
    motif.place(P["celli_pizz"], 0.0, "D3", form="head", vel=80, staccato=0.6)
    motif.place(P["piano"], 0.0, "D4", form="head", vel=78, octaves=(0, 12), staccato=0.5, last_dur=0.45)
    # the deadpan click after the head, on Badger's cross-stick track (critic round 2: alone on the kit's
    # snare track, gain staging made it a -3 dBFS spike that drove the master limiter to 8.8 dB)
    P["badger_xstick"].hit(K["xstick"], 1.0, 70)
    # a beat and a half of deadpan, then Badger
    th.badger(0, 2.5, vel=104)
    P["piano"].note("D2", 3.5, 1.0, 64)
    # the cross-stick track 2 dB under the theme's here: with the click on it, it drove the master limiter
    # to 3.1 dB on Badger's notes (critic round 2 accepts <= 3); at -2 dB it is 2.3 dB and Badger stays
    # 1.5 dB under the motif on the phone model (measured)
    return _arr("bumper-red-flag", th, 3.2, fade=0.7, faders={"badger_xstick": BADGER_XSTICK_DB - 2.0})


def one_fix() -> Arrangement:
    th = Theme()
    P = th.p
    motif.place(P["vibes"], 0.0, "D5", mode="major", vel=84)
    motif.place(P["piano"], 0.0, "D5", mode="major", vel=74, octaves=(0, -12))
    th.chord("ep", 0, 0.0, "F#3 A3 B3 E4", 1.4, 62, roll=0.02)   # D6/9: no major 7th under the tonic
    th.chord("ep", 0, 1.5, "E3 G#3 B3", 0.45, 56)
    th.chord("ep", 0, 2.0, "F#3 A3 B3 E4", 2.6, 66, roll=0.03)
    P["bass"].note("D2", 0.0, 1.9, 72)
    P["bass"].note("D2", 2.0, 2.4, 80)
    for n in ("D3", "A3"):
        P["celli"].note(n, 2.0, 2.6, 70)
    swell(P["celli"], 2.0, 2.05, 0, 76)
    swell(P["celli"], 3.0, 4.6, 76, 20)
    for k, n in enumerate(("D4", "E4", "F#4", "A4", "B4", "D5", "E5", "F#5", "A5")):  # the harp lifts the fix into place
        P["harp"].note(n, 2.0 + 0.06 * k, 1.6, 70 + 2 * k)
    P["kick"].hit(36, 0.0, 72)
    P["kick"].hit(36, 2.0, 88)
    P["kit"].hit(K["rim"], 2.0, 92)
    P["kit"].hit(K["sus_soft"], 2.0, 70)
    arr = _arr("bumper-one-fix", th, 3.0, fade=0.5)
    _add_eq(arr, "ep", C.PK(400, -2.0, 1.0))  # the exposed 2.6-beat FM-EP chord: less box under the D6/9
    return arr


def scam_of_the_week() -> Arrangement:
    th = Theme()
    P = th.p
    motif.place(P["piano"], 0.0, "D3", vel=84, octaves=(0, 12))
    motif.place(P["celli_pizz"], 0.0, "D3", vel=84, staccato=0.6)
    motif.place(P["basses_pizz"], 0.0, "D2", vel=80, staccato=0.6)
    th.chord("ep", 0, 0.0, "F3 A3 C4", 1.4, 58)
    th.chord("ep", 0, 2.0, "Ab3 B3 D4", 2.0, 64, roll=0.03)   # Bb7(b9) under the landing F: unresolved, suspicious
    P["bass"].note("D2", 0.0, 1.4, 84)
    P["bass"].note("Bb1", 2.0, 2.2, 90)
    P["kit"].hit(K["scrape"], 0.0, 70)
    for k in range(6):
        P["kit"].hit(K["tap"], 0.5 * k + 0.25, 30 + 3 * k)
    P["kit"].hit(K["sus_soft"], 2.0, 66)
    P["kick"].hit(36, 2.0, 80)
    line_t = 2.0 + 1.25
    P["vibes"].note("E5", line_t, 0.45, 76)       # the glint: a tritone fall
    P["vibes"].note("Bb4", line_t + 0.5, 1.4, 70)
    return _arr("bumper-scam-of-the-week", th, 3.4, fade=0.5, ceiling=SCAM_CEILING_DBTP)


def developing() -> Arrangement:
    th = Theme()
    P = th.p
    for k in range(12):  # the ticker: three beats of 16ths, rising (pulse and hats; the piano only states the head)
        v = 44 + 4 * k
        P["pulse"].note("D5" if k % 4 else "D4", 0.25 * k, 0.15, v)
        P["kit"].hit(K["hat"], 0.25 * k, 50 + (16 if k % 4 == 0 else 0) + 2 * k)
    for n in ("D4", "A4"):
        P["violins_trem"].note(n, 0.0, 4.6, 70)
    P["violas_trem"].note("D4", 0.0, 4.6, 66)
    for k in range(6):
        P["bass"].note("D2", 0.5 * k, 0.4, 70 + 4 * k)
    motif.place(P["piano"], 3.0, "D5", form="head", vel=90, octaves=(0, -12), last_dur=1.6)
    motif.place(P["vibes"], 3.0, "D5", form="head", vel=80, last_dur=1.6)
    th.chord("ep", 0, 4.0, "G3 A3 D4 E4", 1.6, 72, roll=0.02)   # Dsus4(add9): left open, it is still developing
    th.chord("brass", 0, 4.0, "G3 D4 A4", 1.0, 80)
    P["bass"].note("D2", 4.0, 1.4, 96)
    P["kick"].hit(36, 0.0, 84)
    P["kick"].hit(36, 1.5, 76)
    P["kick"].hit(36, 3.0, 92)
    _hits(th, (4.0,), (112,))
    P["kit"].hit(K["crash"], 4.0, 88)
    return _arr("bumper-developing", th, 3.4, fade=0.5, faders={"brass": -8.5})  # brass 3 dB under the theme's


def correction() -> Arrangement:
    th = Theme()
    P = th.p
    src = S.sampled_chord(I.piano("kawai"), ["D3", "A3", "C4", "F4", "E5"], 1.5, vel=80, length_s=4.0)
    rev = S.reverse_swell(src, 0.93, room="hall", curve=1.8)  # ends 30 ms into the first note: no gap before the hit
    th.clips.append(("rewind", rev, -10.0, None))  # width 0.7 below (the reversed hall tail was decorrelated)
    # the motif backwards (F Ab A D D), calm and even, resolving on D
    motif.place(P["piano"], 1.5, "D5", form="retro", vel=70, rhythm=[(0, 0.5), (0.5, 0.5), (1.0, 0.5), (1.5, 0.5), (2.0, 2.2)], staccato=0.98)
    # light voicings above the celli's roots: the low-mid stays clear (the first mix read boxy)
    th.chord("piano", 0, 1.5, "A3 D4", 0.5, 50)
    th.chord("piano", 0, 2.0, "Ab3 D4", 0.5, 48)
    th.chord("piano", 0, 2.5, "G3 D4", 0.5, 48)
    th.chord("piano", 0, 3.0, "C4 F4", 2.0, 52, roll=0.03)
    P["piano"].sustain(3.05, 5.0)
    for n, (s, d) in (("Bb2", (1.5, 1.0)), ("A2", (2.5, 0.5)), ("D3", (3.0, 2.2))):
        P["celli"].note(n, s, d, 64)
    swell(P["celli"], 1.5, 1.6, 0, 56)
    swell(P["celli"], 3.2, 5.0, 60, 24)
    P["bass"].note("D2", 3.0, 1.6, 64)
    arr = _arr("bumper-correction", th, 3.4, fade=0.7, faders={"piano": -1.0})
    arr.bus_eq = [*BUMPER_BUS, C.PK(650, -4.5, 1.2)]  # soft piano in the 4th octave reads boxy (critic round 1: 3.43 dB at 500-1000 Hz)
    for t in arr.tracks:
        if t.name == "rewind":
            t.width = 0.7
    return arr


# ------------------------------------------------------------------------------------------ intro sting

STING_HIT1 = 30 / 30.0  # ShowSting: the ampersand turns teal, Zoo turns to camera (frame 30)
STING_HIT2 = 58 / 30.0  # Badger's judging look (frame 58)
STING_START = 4 / 30.0  # the plate starts wiping in (frame 4)


def show_intro_sting() -> Arrangement:
    """At 60 BPM a beat is a second, so positions below are seconds. The motif is timed so SHOW lands on
    hit 1 and Badger's D on hit 2 (src/branding/layout.ts SHOW_STING_BEATS)."""
    th = Theme(bpm=60.0)
    P = th.p
    t0 = STING_START
    stretch = (STING_HIT1 - t0) / 2.0  # ZOO -> SHOW is two motif beats
    motif.place(P["piano"], t0, "D4", vel=94, octaves=(0, 12, -12), stretch=stretch, last_dur=0.45)
    for n in P["piano"].notes:  # the piano octaves on SHOW 2 dB firmer (velocity x1.155 through the Kawai's 1.6 curve)
        if abs(n.start - STING_HIT1) < 1e-6:
            n.vel = min(127, round(n.vel * 1.155))
    motif.place(P["vibes"], t0, "D5", vel=80, stretch=stretch, last_dur=0.8)
    motif.place(P["bass"], t0, "D2", vel=104, stretch=stretch, staccato=0.8, last_dur=0.4)
    motif.place(P["pizz"], t0, "D4", vel=88, stretch=stretch, staccato=0.6, last_dur=0.3)
    for k, (onset, vel) in enumerate(zip(motif.ONSETS, (112, 84, 110, 96, 118))):
        tt = t0 + onset * stretch
        P["kick"].hit(36, tt, vel)
        P["kit"].hit(K["snare"], tt, vel - 14)
    th.chord("brass", 0, STING_HIT1, "A3 D4 F4 A4", 0.42, 102)
    th.chord("ep", 0, STING_HIT1, "A3 C4 F4", 0.45, 78)
    P["kit"].hit(K["crash"], STING_HIT1, 108)
    P["piano"].note("D2", STING_HIT1, 0.4, 84)
    # Badger: Eb, then D on his look
    spacing = 0.433
    motif.place_badger(P["bass"], STING_HIT2 - spacing, "D2", vel=104, spacing=spacing)
    motif.place_badger(P["celli_pizz"], STING_HIT2 - spacing, "D3", vel=98, spacing=spacing)
    motif.place_badger(P["badger_mid"], STING_HIT2 - spacing, "D4", vel=84, spacing=spacing)  # the mid-register double (as in the theme)
    motif.place_badger(P["basses_pizz"], STING_HIT2 - spacing, "D2", vel=92, spacing=spacing)
    for k, tt in enumerate((STING_HIT2 - spacing, STING_HIT2)):
        P["badger_xstick"].hit(K["xstick"], tt, BADGER_XSTICK[k])  # his own cross-stick track (see theme.BADGER_XSTICK)
    P["piano"].note("D1", STING_HIT2, 1.6, 66)
    P["piano"].note("D2", STING_HIT2, 1.6, 66)
    P["piano"].sustain(STING_HIT2 + 0.02, 3.6)
    return _arr("intro-sting-show", th, 4.0, fade=0.6, swing=False, pre_roll=0.0)  # timed to the sting's frames from sample 0


# ------------------------------------------------------------------------------------------ end screen

def end_screen(voice: bool = True) -> Arrangement:
    """20 s, end-aligned: 6 bars of light groove, a turnaround, the motif lands on D minor at 18.0 s and
    rings out to exactly 20.0 s.

    voice=True (`endscreen-bed`): mastered as a bed for Zoo's voice-over. Critic round 1 measured it the
    worst bed under his voice, so the vibes sit out bars 0-5 (the motif lands only in bar 7), the
    hats and pulse come down (-10 and -15 dB), the bass is low-passed for the voice, and the bus
    carries the voice pocket.
    voice=False (`endscreen-music`): the same music for an end screen with nobody speaking: the vibes
    motif and its answers in bars 0-5, no pocket EQ, mastered at -18 LUFS-I."""
    from composer.cues.theme import A_BASS, A_CHORDS, REPLIES
    from composer.notation import line

    th = Theme(pocket=voice)
    P = th.p
    for i in range(7):
        t = th.b(i)
        src = i if i < 6 else 1  # bar 6 replays the A7 bar as the turnaround
        ch = [(beat, c) for bb, beat, c in A_CHORDS if bb == src]
        for j, (beat, c) in enumerate(ch):
            span = (ch[j + 1][0] if j + 1 < len(ch) else 4.0) - beat
            th.chord("ep", i, beat, c, min(span - 0.1, 1.4), 58, roll=0.02)
        line(P["bass"], t, A_BASS[src], vel=82, staccato=0.85)
        if not voice:
            if src in (0, 4):
                motif.place(P["vibes"], t, "D5", vel=72)
            elif src == 2:
                motif.place(P["vibes"], t, "G4", vel=70)
            if src in REPLIES and i != 6:
                line(P["vibes"], t, REPLIES[src], vel=64, staccato=0.95)
        th.drums(i, {"kick": "X.........x.....", "xstick": "....x.......x...", "hat": "x.o.x.o.x.o.x.o." if i % 2 == 0 else "x.o.x.o.x.o.x.oo",
                     "shaker": "x...x...x...x..."}, vel={"X": 86, "x": 62, "o": 40})
        if i < 6:
            th.pulse_bar(i, ["D", "A", "G", "E", "D", "Bb"][i], 38, octave=12 if voice else 0)
    # bar 7: the motif lands on D minor, the band stops, a soft cymbal and the ring-out
    t = th.b(7)
    motif.place(P["vibes"], t, "D5", vel=76, last_dur=3.0)
    motif.place(P["piano"], t, "D4", vel=66, octaves=(0, 12), last_dur=3.0)
    th.chord("ep", 7, 0.0, "F3 A3 C4 E4", 1.4, 56)
    th.chord("ep", 7, 2.0, "A3 C4 F4", 3.0, 60, roll=0.03)
    P["bass"].note("D2", t, 1.4, 80)
    P["bass"].note("D2", t + 2.0, 3.0, 84)
    P["kick"].hit(36, t, 80)
    P["kit"].hit(K["sus_soft"], t + 2.0, 58)
    for n in ("D3", "A3"):
        P["celli"].note(n, t + 2.0, 3.2, 64)
    swell(P["celli"], t + 2.0, t + 2.1, 0, 60)
    swell(P["celli"], t + 3.0, t + 5.2, 60, 10)
    if voice:
        th.finish("endscreen", comp_velocity=8.0)
        # hats -13 dB (critic round 2: 117-137 bed onsets per speech-minute within 15 dB of the voice, the hats
        # at 6.3 and 8 kHz as loud as his sibilants)
        return Arrangement("endscreen-bed", th.s, 20.0, th.tracks({"vibes": -10.0, "ep": -5.0, "piano": -6.0, "hats": -13.0, "perc": -16.0, "pulse": -15.0}),
                           preset="bed", reverbs=C.reverbs(), fade_in=0.4, fade_out=1.4,
                           bus_eq=[C.PK(250, -1.0, 0.9), *C.VOICE_POCKET, C.HS(7000, 3.0), C.LS(150, -2.5)])  # the shelf: as the show beds (show_beds.BED_BUS_LOW)
    th.finish("endscreen-music", comp_velocity=8.0)
    # the bass 1.5 dB under the theme's (critic round 2: with nobody speaking it was the loudest stem, -4.0 dB
    # of the mix, and its static timbre was exposed for 20 s; FingerBass now decays like a plucked string)
    return Arrangement("endscreen-music", th.s, 20.0, th.tracks({"vibes": -8.0, "ep": -5.0, "piano": -6.0, "hats": -8.0, "perc": -14.0, "pulse": -12.0,
                                                                  "bass": -3.5}),
                       preset="endscreen", reverbs=C.reverbs(), fade_in=0.4, fade_out=1.4,
                       bus_eq=[C.PK(250, -1.0, 0.9), C.PK(1000, -1.0, 1.0), C.HS(7000, 2.0)])


def end_screen_music() -> Arrangement:
    return end_screen(voice=False)


BUMPERS = {
    "bumper-rekt-meter": (rekt_meter, "Headline / Rekt Meter", "the meter fills, then the motif's tail falls", 3.2,
                          [(0.0, "meter starts filling"), (1.2, "A: the fall begins"), (1.5, "A-flat"), (1.8, "F lands (crash)")]),
    "bumper-red-flag": (red_flag, "Badger's Red Flag", "deadpan: motif head, a rest, Badger's two notes", 3.2,
                        [(0.0, "motif head"), (1.5, "Badger: E-flat"), (2.1, "Badger: D (the button)")]),
    "bumper-one-fix": (one_fix, "Zoo's One Fix", "helpful, resolved: the major motif clicks into D6/9", 3.0,
                       [(0.0, "major motif"), (1.2, "the fix clicks into place (D6/9, harp lift)")]),
    "bumper-scam-of-the-week": (scam_of_the_week, "Scam of the Week", "sly and low; lands unresolved on Bb7(b9)", 3.4,
                                [(0.0, "motif, low"), (1.2, "lands on Bb7(b9)"), (1.95, "vibes glint: E"), (2.25, "B-flat")]),
    "bumper-developing": (developing, "DEVELOPING", "news alert, not alarm: a ticker, the motif head, left open (Dsus4)", 3.4,
                          [(0.0, "ticker starts"), (1.8, "motif head"), (2.4, "Dsus4(add9), unresolved (crash)")]),
    "bumper-correction": (correction, "Correction", "sober: a rewind, then the motif backwards, resolving calmly", 3.4,
                          [(0.0, "rewind swell"), (0.9, "motif backwards: F"), (2.1, "D: resolved")]),
}
