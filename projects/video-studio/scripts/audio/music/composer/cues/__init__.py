"""The cue registry: every deliverable, its metadata and its builder."""

from __future__ import annotations

from composer.spec import Cue

from . import show_beds, show_cues, theme, zoora

SHOW = "zoora-security"


def _theme_cues() -> list:
    bar = 4 * theme.SPB
    return [
        Cue("theme-full", "The Zoo & Badger Show: main theme", SHOW, "theme", "confident, noir, dry wit", "D minor", theme.BPM, "standalone",
            lambda: theme.arrangement("theme-full", "full"), bars=28,
            hits=[(0.0, "motif (solo piano)"), (2.4, "Badger's reply"), (4.8, "band in (A)"), (24.0, "B: strings, lyrical line"),
                  (43.2, "A': full band, crash"), (62.4, "coda: motif in unison"), (63.6, "SHOW lands (crash)"), (64.8, "Badger: E-flat"),
                  (65.4, "Badger: D (the button)")],
            sections=[(0.0, "intro"), (4.8, "A"), (24.0, "B"), (43.2, "A'"), (62.4, "coda")],
            description="The full theme: intro, A, B, A', coda; Zoo's motif in every section and Badger's figure as the bookends.",
            usage="Cold opens, trailers, the channel trailer's music, end of season. -14 LUFS-I: plays on its own, not under narration.",
            instruments=["VCSL Kawai piano", "VCSL vibraphone", "VSCO 2 strings (MuseScore_General)", "plucked-string bass", "sine sub",
                         "synth kick + MuseScore kick", "VCSL drums", "FM tine piano", "analog pad", "pulse", "brass stab", "muted guitar model"]),
        Cue("theme-15s", "The Zoo & Badger Show: theme, 15 s", SHOW, "theme", "confident, noir, dry wit", "D minor", theme.BPM, "standalone",
            lambda: theme.arrangement("theme-15s", "15s"), bars=6,
            hits=[(0.0, "motif (solo piano)"), (2.4, "Badger's reply"), (4.8, "band in: motif on G"), (7.2, "turnaround hits"),
                  (9.6, "motif in unison"), (10.8, "SHOW lands (crash)"), (12.0, "Badger: E-flat"), (12.6, "Badger: D (the button)")],
            sections=[(0.0, "intro"), (4.8, "A"), (9.6, "coda")],
            description="A 15 s cut of the theme with the same bars: motif, Badger's reply, the band, the unison motif and Badger's button.",
            usage="Short opens and promos. -14 LUFS-I.",
            instruments=["VCSL Kawai piano", "VCSL vibraphone", "VSCO 2 strings", "plucked-string bass", "VCSL drums", "brass stab", "FM tine piano"]),
        Cue("theme-5s", "The Zoo & Badger Show: theme sting, 5 s", SHOW, "sting", "confident button", "D minor", theme.BPM, "sting",
            lambda: theme.arrangement("theme-5s", "5s"), bars=2,
            hits=[(0.0, "motif starts (band unison)"), (1.2, "SHOW lands (crash)"), (2.4, "Badger: E-flat"), (3.0, "Badger: D (the button)")],
            sections=[(0.0, "motif"), (2.4, "Badger")],
            description="The band plays the motif in unison and lands; Badger's two notes are the button.",
            usage="Logo sting, segment outs, Shorts endings. -16 LUFS-I, ends cleanly at 5.0 s.",
            instruments=["VCSL Kawai piano", "VCSL vibraphone", "VSCO 2 strings", "plucked-string bass", "VCSL drums", "brass stab"]),
    ]


def _show_cues() -> list:
    out = []
    for cid, (fn, title, mood, length, hits) in show_cues.BUMPERS.items():
        out.append(Cue(cid, f"Bumper: {title}", SHOW, "bumper", mood, "D minor" if cid != "bumper-one-fix" else "D major", theme.BPM, "sting", fn,
                       hits=hits, description=f"Segment bumper for {title}, built from Zoo's motif ({length:.1f} s).",
                       usage="Cut on the downbeat at the segment change; the music is finished before the file ends. -16 LUFS-I.",
                       instruments=["VCSL Kawai piano", "VCSL vibraphone", "VSCO 2 strings", "plucked-string bass", "VCSL drums", "brass stab", "FM tine piano"]))
    out.append(Cue("intro-sting-show", "The Zoo & Badger Show: channel intro sting", SHOW, "intro-sting", "confident, deadpan button", "D minor", 138.5, "sting",
                   show_cues.show_intro_sting,
                   hits=[(show_cues.STING_START, "motif starts (frame 4: the plate wipes in)"), (show_cues.STING_HIT1, "SHOW lands: ampersand turns teal, Zoo turns (frame 30)"),
                         (show_cues.STING_HIT2 - 0.433, "Badger: E-flat"), (show_cues.STING_HIT2, "Badger: D on his judging look (frame 58)")],
                   description="The jingle for src/branding ShowSting: the motif's SHOW lands on hit 1 and Badger's D on hit 2. Music is out by 4.0 s (the sting hard-cuts).",
                   usage="npx remotion render src/branding/index.ts ShowSting out/brand/zoora-security/sting.mp4 --props='{\"jingle\":\"audio/music/intro-sting-show.wav\"}'",
                   instruments=["VCSL Kawai piano", "VCSL vibraphone", "VSCO 2 strings", "plucked-string bass", "VCSL drums", "brass stab"]))
    out.append(Cue("endscreen-bed", "End-screen bed, 20 s", SHOW, "endscreen", "light, confident, wrapping up", "D minor", theme.BPM, "bed",
                   show_cues.end_screen, bars=None,
                   hits=[(16.8, "last motif"), (18.0, "SHOW lands on D minor"), (20.0, "end")],
                   sections=[(0.0, "groove"), (14.4, "turnaround"), (16.8, "motif and ring-out")],
                   description="The theme's groove, light, under the end screen; the motif lands on D minor at 18.0 s and the cue ends at exactly 20.0 s.",
                   usage="End-aligned: place it so it ends with the video; for a shorter end screen, start later and fade in. Bed level (-26 LUFS-S) for Zoo's voice-over; raise 6-8 dB if nobody speaks.",
                   instruments=["VCSL vibraphone", "FM tine piano", "plucked-string bass", "VCSL percussion", "pulse", "VSCO 2 celli"]))
    return out


def _show_beds() -> list:
    common = dict(bpm=show_beds.BPM, profile="bed", loop=True, bars=show_beds.BARS)
    secs = [(0.0, "base"), (8 * 4 * show_beds.SPB, "second colour + motif"), (16 * 4 * show_beds.SPB, "fullest; thins into the loop")]
    use = ("Loops seamlessly (sample 0 to the end). -26 LUFS-S with a 1-4 kHz pocket: run scripts/audio/duck.py under Zoo's narration. "
           "Same tempo and key family as the other show beds: cross-fade between them on a bar line (every 2.667 s).")
    return [
        Cue("bed-show-neutral", "Show bed: neutral", SHOW, "bed", "calm, curious, confident", "D dorian", builder=show_beds.neutral, sections=secs, usage=use,
            description="D dorian over a D pedal: EP, bass, soft kick, cross-stick and shaker; the motif on soft vibes from bar 8; a quiet string pad from bar 16.",
            instruments=["FM tine piano", "plucked-string bass", "VCSL percussion", "VCSL vibraphone", "pulse", "VSCO 2 celli and violas"], **common),
        Cue("bed-show-tension", "Show bed: tension", SHOW, "bed", "tense, investigative, restrained", "D minor (phrygian)", builder=show_beds.tension, sections=secs, usage=use,
            description="A muted 3-3-2 pulse, low strings with an E-flat neighbour, a half-time kit with ticking hats; the motif low and slow on piano every 8 bars.",
            instruments=["pulse", "plucked-string bass", "sine sub", "VCSL Kawai piano", "VSCO 2 strings (celli, violas tremolo, violins)", "VCSL drums", "FM tine piano"], **common),
        Cue("bed-show-light", "Show bed: light", SHOW, "bed", "light, witty, upbeat", "F major (lydian)", builder=show_beds.light, sections=secs, usage=use,
            description="Swung pizzicato, a two-feel bass, soft taps and hats; the major motif (F F C B A) on vibes every 8 bars.",
            instruments=["VSCO 2 pizzicato", "plucked-string bass", "VCSL drums", "VCSL vibraphone", "FM tine piano", "VSCO 2 celli"], **common),
    ]


ZOORA = "zoora-ai"


def _zoora_cues() -> list:
    common = dict(bpm=zoora.BPM, profile="bed", loop=True, bars=zoora.BARS)
    secs = [(0.0, "base"), (8 * 4 * zoora.SPB, "second layer + motif"), (16 * 4 * zoora.SPB, "fullest; thins into the loop")]
    use = ("Loops seamlessly. -26 LUFS-S with a 1-4 kHz pocket for the narration; duck it with scripts/audio/duck.py. "
           "All four story beds share 75 BPM, so they can be switched on a bar line (every 3.2 s).")
    return [
        Cue("intro-sting-zoora", "Zoora AI: channel intro sting", ZOORA, "intro-sting", "curious, luminous, cinematic", "F lydian", 100, "sting",
            zoora.zoora_intro_sting,
            hits=[(0.2, "shimmer starts (the bell draws, frame 6)"), (0.6, "motif starts"), (zoora.ZOORA_HIT, "SHOW lands on the logo hit (frame 54)"),
                  (zoora.ZOORA_WORD, "celesta C under the wordmark (frame 70)"), (zoora.ZOORA_TAG, "celesta F under the tag line (frame 78)")],
            description="The jingle for src/branding ZooraSting: a harp and string shimmer, the lydian motif landing on the logo hit, two notes under the wordmark; fades out by 4.0 s with the picture.",
            usage="npx remotion render src/branding/index.ts ZooraSting out/brand/zoora-ai/sting.mp4 --props='{\"jingle\":\"audio/music/intro-sting-zoora.wav\"}'",
            instruments=["VCSL concert harp", "MuseScore celesta", "VCSL vibraphone", "VCSL Kawai piano (and a reversed bloom)", "VSCO 2 strings", "VCSL bass drum, cymbal, glockenspiel"]),
        Cue("bed-story-curious", "Story bed: curious", ZOORA, "bed", "curious, wondering, light", "F lydian", builder=zoora.curious, sections=secs, usage=use,
            description="A harp ostinato, bowed-vibes sustains and the motif augmented on celesta; kalimba, pizzicato and a muted frame drum from bar 8; marimba from bar 16.",
            instruments=["VCSL concert harp", "VCSL bowed vibraphone", "MuseScore celesta", "VCSL kalimba", "VSCO 2 pizzicato", "VCSL marimba", "VCSL frame drum, shaker", "analog pad"], **common),
        Cue("bed-story-tension", "Story bed: tension", ZOORA, "bed", "tense, pressing, restrained", "D minor", builder=zoora.tension, sections=secs, usage=use,
            description="A celli ostinato, a ticking woodblock and low piano octaves; the pulse, violas tremolo and the motif's tail from bar 8; high violins, tom rolls and a swell from bar 16.",
            instruments=["VSCO 2 celli (fast), basses, violas tremolo, violins", "VCSL Kawai piano", "pulse", "VCSL woodblock, toms, bass drum, cymbal swell"], **common),
        Cue("bed-story-ominous", "Story bed: ominous", ZOORA, "bed", "ominous, dark, slow", "D phrygian", builder=zoora.ominous, sections=secs, usage=use,
            description="Bass drones and a muted frame-drum heartbeat, low piano octaves with the tritone, bowed-vibes dissonances, the motif four times slower on low piano.",
            instruments=["VSCO 2 basses (tremolo), violins tremolo", "sine sub", "analog pad", "VCSL Kawai piano", "VCSL bowed vibraphone", "VCSL frame drum, bass drum, cymbal swell"], **common),
        Cue("bed-story-resolve", "Story bed: resolve / uplift", ZOORA, "bed", "warm, hopeful, resolved", "D major", builder=zoora.resolve, sections=secs, usage=use,
            description="Piano arpeggios and the major motif; strings, a soft kick and shaker from bar 8; violins and a harp lift in bars 16-19.",
            instruments=["VCSL Kawai piano", "VCSL vibraphone", "VSCO 2 strings", "plucked-string bass", "synth kick", "VCSL shaker", "VCSL harp", "analog pad"], **common),
    ]


REGISTRY = {c.id: c for c in _theme_cues() + _show_cues() + _show_beds() + _zoora_cues()}
