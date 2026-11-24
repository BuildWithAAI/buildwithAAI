"""The cue registry: every deliverable, its metadata and its builder."""

from __future__ import annotations

from composer.spec import Cue

from . import show_beds, show_cues, theme, zoora

SHOW = "zoora-security"


def _theme_cues() -> list:
    return [
        Cue("theme-full", "The Zoo & Badger Show: main theme", SHOW, "theme", "confident, noir, dry wit", "D minor", theme.BPM, "standalone",
            lambda: theme.arrangement("theme-full", "full"), bars=28,
            hits=[(0.0, "motif (solo piano)"), (2.4, "Badger's reply"), (4.8, "band in (A)"), (24.0, "B: strings, lyrical line"),
                  (43.2, "A': full band, crash"), (62.4, "coda: motif in unison"), (63.6, "SHOW lands (crash)"), (64.8, "Badger: E-flat"),
                  (65.4, "Badger: D (the button)")],
            sections=[(0.0, "intro"), (4.8, "A"), (24.0, "B"), (43.2, "A'"), (62.4, "coda")],
            description="The full theme: intro, A, B, A', coda; Zoo's motif in every section and Badger's figure as the bookends.",
            usage="Cold opens, trailers, the channel trailer's music, end of season. -14 LUFS-I: plays on its own, not under narration.",
            instruments=["VCSL Kawai piano", "VCSL vibraphone", "VSCO 2 strings (MuseScore_General)", "finger-plucked bass (our synthesis)", "sine sub",
                         "synth kick + MuseScore kick", "VCSL drums", "FM tine piano", "analog pad", "pulse", "brass stab", "muted guitar model"]),
        Cue("theme-15s", "The Zoo & Badger Show: theme, 15 s", SHOW, "theme", "confident, noir, dry wit", "D minor", theme.BPM, "standalone",
            lambda: theme.arrangement("theme-15s", "15s"), bars=6,
            hits=[(0.0, "motif (solo piano)"), (2.4, "Badger's reply"), (4.8, "band in: the vibes answer on G"), (7.2, "turnaround hits"),
                  (9.6, "motif in unison"), (10.8, "SHOW lands (crash)"), (12.0, "Badger: E-flat"), (12.6, "Badger: D (the button)")],
            sections=[(0.0, "intro"), (4.8, "A"), (9.6, "coda")],
            description="A 15 s cut of the theme with the same bars: motif, Badger's reply, the band with a vibes answer, the unison motif and Badger's button.",
            usage="Short opens and promos. -14 LUFS-I, -2.2 dBTP.",
            instruments=["VCSL Kawai piano", "VCSL vibraphone", "VSCO 2 strings", "finger-plucked bass", "VCSL drums", "brass stab", "FM tine piano"]),
        Cue("theme-5s", "The Zoo & Badger Show: theme sting, 5 s", SHOW, "sting", "confident button", "D minor", theme.BPM, "sting",
            lambda: theme.arrangement("theme-5s", "5s"), bars=2, downbeat_sec=theme.PRE_ROLL_5S,
            hits=[(theme.PRE_ROLL_5S + h, w) for h, w in ((0.0, "motif starts (band unison): the sync point"), (1.2, "SHOW lands (crash)"),
                                                          (2.4, "Badger: E-flat"), (3.0, "Badger: D (the button)"))],
            sections=[(theme.PRE_ROLL_5S, "motif"), (theme.PRE_ROLL_5S + 2.4, "Badger")],
            description="The band plays the motif in unison and lands; Badger's two notes are the button. Two frames of silence come before the downbeat.",
            usage="Logo sting, segment outs, Shorts endings. Sync: the downbeat is at downbeatSec (2 frames in), so start the file 2 frames before the cut. "
                  "-16 LUFS-I, ends cleanly at 5.0 s.",
            instruments=["VCSL Kawai piano", "VCSL vibraphone", "VSCO 2 strings", "finger-plucked bass", "VCSL drums", "brass stab"]),
    ]


def _show_cues() -> list:
    out = []
    pre = show_cues.BUMPER_PRE_ROLL
    for cid, (fn, title, mood, length, hits) in show_cues.BUMPERS.items():
        out.append(Cue(cid, f"Bumper: {title}", SHOW, "bumper", mood, "D minor" if cid != "bumper-one-fix" else "D major", theme.BPM, "sting", fn,
                       hits=[(pre + h, w) for h, w in hits], downbeat_sec=pre,
                       description=f"Segment bumper for {title}, built from Zoo's motif ({length:.1f} s).",
                       usage="Cut on the downbeat at the segment change: the file starts with two frames of silence, so start it at "
                             "downbeatStartFrame(cue, cutFrame) (2 frames early). The music is finished before the file ends. -16 LUFS-I.",
                       instruments=["VCSL Kawai piano", "VCSL vibraphone", "VSCO 2 strings", "finger-plucked bass", "VCSL drums", "brass stab", "FM tine piano"]))
    out.append(Cue("intro-sting-show", "The Zoo & Badger Show: channel intro sting", SHOW, "intro-sting", "confident, deadpan button", "D minor", 138.5, "sting",
                   show_cues.show_intro_sting,
                   hits=[(show_cues.STING_START, "motif starts (frame 4: the plate wipes in)"), (show_cues.STING_HIT1, "SHOW lands: ampersand turns teal, Zoo turns (frame 30)"),
                         (show_cues.STING_HIT2 - 0.433, "Badger: E-flat"), (show_cues.STING_HIT2, "Badger: D on his judging look (frame 58)")],
                   description="The jingle for src/branding ShowSting: the motif's SHOW lands on hit 1 and Badger's D on hit 2. Music is out by 4.0 s (the sting hard-cuts).",
                   usage="npx remotion render src/branding/index.ts ShowSting out/brand/zoora-security/sting.mp4 --props='{\"jingle\":\"audio/music/intro-sting-show.wav\"}'",
                   instruments=["VCSL Kawai piano", "VCSL vibraphone", "VSCO 2 strings", "finger-plucked bass", "VCSL drums", "brass stab"]))
    out.append(Cue("endscreen-bed", "End-screen bed, 20 s (under Zoo's voice-over)", SHOW, "endscreen", "light, confident, wrapping up", "D minor", theme.BPM, "bed",
                   show_cues.end_screen, bars=None,
                   hits=[(16.8, "last motif"), (18.0, "SHOW lands on D minor"), (20.0, "end")],
                   sections=[(0.0, "groove"), (14.4, "turnaround"), (16.8, "motif and ring-out")],
                   description="The theme's groove, light, under the end screen's voice-over: no vibes until the motif lands on D minor at 18.0 s; ends at exactly 20.0 s.",
                   usage="End-aligned, under Zoo's voice-over: place it so it ends with the video (for a shorter end screen, start later and fade in) and duck it "
                         "with scripts/audio/duck.py. Bed level (-26 LUFS-S). With nobody speaking, use endscreen-music.",
                   instruments=["VCSL vibraphone", "FM tine piano", "finger-plucked bass", "VCSL percussion", "pulse", "VSCO 2 celli"]))
    out.append(Cue("endscreen-music", "End-screen music, 20 s (no voice-over)", SHOW, "endscreen", "light, confident, wrapping up", "D minor", theme.BPM, "endscreen",
                   show_cues.end_screen_music, bars=None,
                   hits=[(16.8, "last motif"), (18.0, "SHOW lands on D minor"), (20.0, "end")],
                   sections=[(0.0, "groove with the motif and its answers"), (14.4, "turnaround"), (16.8, "motif and ring-out")],
                   description="The end-screen music for an end screen with nobody speaking: the same groove with the vibes motif and its answers, no voice pocket.",
                   usage="End-aligned, on its own: -18 LUFS-I (4 LU under -14 LUFS narration), -2 dBTP. Do not duck it; with a voice-over use endscreen-bed.",
                   instruments=["VCSL vibraphone", "VCSL Kawai piano", "FM tine piano", "finger-plucked bass", "VCSL percussion", "pulse", "VSCO 2 celli"]))
    return out


USE_MOTIF = ("The motif version: for intros, outros and gaps between lines. Under speech prefer the -underscore version. ")
USE_UNDER = ("The UNDERSCORE: the same bed with the motif and lead lines muted, for use under narration. ")


def _with_underscore(base: Cue) -> list:
    """The bed and its UNDERSCORE (critic round 1: the motif was baked into every bed, every 21-26 s)."""
    under = Cue(f"{base.id}-underscore", f"{base.title} (underscore)", base.channel, base.cue_type, base.mood, base.key, base.bpm, base.profile,
                lambda b=base.build: b(underscore=True), loop=base.loop, bars=base.bars, hits=base.hits, sections=base.sections,
                description=base.description + " Underscore: the motif statements and lead lines are muted.",
                usage=USE_UNDER + base.usage, instruments=[i for i in base.instruments if "celesta" not in i])
    base.usage = USE_MOTIF + base.usage
    return [base, under]


def _show_beds() -> list:
    common = dict(bpm=show_beds.BPM, profile="bed", loop=True, bars=show_beds.BARS)
    secs = [(0.0, "base"), (8 * 4 * show_beds.SPB, "second colour + motif"), (16 * 4 * show_beds.SPB, "fullest; thins into the loop")]
    use = ("Loops seamlessly (sample 0 to the end). -26 LUFS-S with a voice pocket at 1.25-2 kHz: duck it under Zoo's narration with "
           "scripts/audio/duck.py (the band-split duck, its default). Same tempo and key family as the other show beds: cross-fade between them on a "
           "bar line (every 2.667 s).")
    beds = [
        Cue("bed-show-neutral", "Show bed: neutral", SHOW, "bed", "calm, curious, confident", "D dorian", builder=show_beds.neutral, sections=secs, usage=use,
            description="D dorian over a D pedal: EP, bass, soft kick, cross-stick and shaker; the motif on soft vibes from bar 8; a quiet string pad from bar 16.",
            instruments=["FM tine piano", "finger-plucked bass", "VCSL percussion", "VCSL vibraphone", "pulse", "VSCO 2 celli and violas"], **common),
        Cue("bed-show-tension", "Show bed: tension", SHOW, "bed", "tense, investigative, restrained", "D minor (phrygian)", builder=show_beds.tension, sections=secs, usage=use,
            description="A muted 3-3-2 pulse, low strings with an E-flat neighbour, a half-time kit with ticking hats; the motif slow on soft vibes at D5 every 8 bars.",
            instruments=["pulse", "finger-plucked bass", "sine sub", "VCSL vibraphone", "VSCO 2 strings (celli, violas tremolo, violins)", "VCSL drums", "FM tine piano"], **common),
        Cue("bed-show-light", "Show bed: light", SHOW, "bed", "light, witty, upbeat", "F major (lydian)", builder=show_beds.light, sections=secs, usage=use,
            description="Swung pizzicato in quarter notes (eighths in bars 16-21), a two-feel bass, soft taps and quarter-note hats; the major motif (F F C B A) on vibes every 8 bars.",
            instruments=["VSCO 2 pizzicato", "finger-plucked bass", "VCSL drums", "VCSL vibraphone", "FM tine piano", "VSCO 2 celli"], **common),
    ]
    return [c for b in beds for c in _with_underscore(b)]


ZOORA = "zoora-ai"


def _zoora_cues() -> list:
    common = dict(bpm=zoora.BPM, profile="bed", loop=True, bars=zoora.BARS)
    secs = [(0.0, "base"), (8 * 4 * zoora.SPB, "second layer + motif"), (16 * 4 * zoora.SPB, "fullest; thins into the loop")]
    use = ("Loops seamlessly. -26 LUFS-S with a voice pocket at 1.25-2 kHz for the narration; duck it with scripts/audio/duck.py (the band-split "
           "duck, its default). All four story beds share 75 BPM, so they can be switched on a bar line (every 3.2 s).")
    beds = [
        Cue("bed-story-curious", "Story bed: curious", ZOORA, "bed", "curious, wondering, light", "F lydian", builder=zoora.curious, sections=secs, usage=use,
            description="A harp ostinato, soft bowed-vibes sustains and the motif augmented on soft vibes; kalimba, pizzicato and a muted frame drum from bar 8; marimba from bar 16.",
            instruments=["VCSL concert harp", "VCSL bowed vibraphone", "VCSL vibraphone", "VCSL kalimba", "VSCO 2 pizzicato", "VCSL marimba", "VCSL frame drum, shaker", "analog pad"], **common),
        Cue("bed-story-tension", "Story bed: tension", ZOORA, "bed", "tense, pressing, restrained", "D minor", builder=zoora.tension, sections=secs, usage=use,
            description="A celli ostinato doubled an octave up by violas, a ticking woodblock and low piano octaves; the pulse, violas tremolo and the motif's tail (vibes, violins) from bar 8; high violins, tom rolls and a swell from bar 16.",
            instruments=["VSCO 2 celli and violas (fast), basses, violas tremolo, violins", "VCSL Kawai piano", "VCSL vibraphone", "pulse", "VCSL woodblock, toms, bass drum, cymbal swell"], **common),
        Cue("bed-story-ominous", "Story bed: ominous", ZOORA, "bed", "ominous, dark, slow", "D phrygian", builder=zoora.ominous, sections=secs, usage=use,
            description="Bass drones through the loop seam, a muted frame-drum heartbeat with a skin click, low piano octaves with the tritone, a soft bowed-vibes drone and dissonances, the motif four times slower on piano at D4/D5.",
            instruments=["VSCO 2 basses (tremolo), violins tremolo", "sine sub", "analog pad", "VCSL Kawai piano", "VCSL bowed vibraphone", "VCSL frame drum, bass drum, cymbal swell", "skin click (our synthesis)"], **common),
        Cue("bed-story-resolve", "Story bed: resolve / uplift", ZOORA, "bed", "warm, hopeful, resolved", "D major", builder=zoora.resolve, sections=secs, usage=use,
            description="Piano arpeggios and the major motif; strings, a soft kick and shaker from bar 8; violins and a harp lift in bars 16-19.",
            instruments=["VCSL Kawai piano", "VCSL vibraphone", "VSCO 2 strings", "finger-plucked bass", "synth kick", "VCSL shaker", "VCSL harp", "analog pad"], **common),
    ]
    sting = Cue("intro-sting-zoora", "Zoora AI: channel intro sting", ZOORA, "intro-sting", "curious, luminous, cinematic", "F lydian", 100, "sting",
                zoora.zoora_intro_sting,
                hits=[(0.2, "shimmer starts (the bell draws, frame 6)"), (0.6, "the motif starts"), (zoora.ZOORA_HIT, "the motif lands on the logo hit (frame 54)"),
                      (zoora.ZOORA_WORD, "vibes and harp C under the wordmark (frame 70)"), (zoora.ZOORA_TAG, "vibes and harp F under the tag line (frame 78)")],
                description="The jingle for src/branding ZooraSting: a harp and string shimmer, the lydian motif on vibes and harp landing on the logo hit, two notes under the wordmark and tag line; fades out by 4.0 s with the picture.",
                usage="npx remotion render src/branding/index.ts ZooraSting out/brand/zoora-ai/sting.mp4 --props='{\"jingle\":\"audio/music/intro-sting-zoora.wav\"}'",
                instruments=["VCSL concert harp", "VCSL vibraphone (hard and soft mallets)", "VCSL Kawai piano (and a reversed bloom)", "VSCO 2 strings", "VCSL bass drum, cymbal, glockenspiel"])
    return [sting] + [c for b in beds for c in _with_underscore(b)]


REGISTRY = {c.id: c for c in _theme_cues() + _show_cues() + _show_beds() + _zoora_cues()}
