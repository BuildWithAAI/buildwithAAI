"""The composer's toolkit for The Zoo & Badger Show and Zoora AI music (scripts/audio/music).

Modules:
    notation     a small text notation for melodies, chords and 16th-note drum grids
    motif        Zoo's signature motif and Badger's figure, their transforms and the fingerprint check
    instruments  the palette: VCSL samplers, MuseScore VSCO 2 strings, drum kits (cached singletons)
    synths       our own voices: FM tine piano, analog pad, pulse arp, brass stab, sub, kick, swells
    render       stems -> (seamless loop folding) -> mix with several reverbs -> master -> export
    spec         cue metadata, the manifest, file naming and export rules
    cues         one module per cue family; `cues.REGISTRY` maps cue ids to builders

Everything is deterministic: the same code renders the same audio, sample for sample.
"""

__version__ = "1.0.0"
