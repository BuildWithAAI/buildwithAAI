# Palette and art direction

All colors below are copied from the Lumen source at the SHAs in LOOK.md. Zoora's own taste note is `src/lumen-88/projects/lumen/zoora/STYLE.md` (also `assets/STYLE.md`):

> I like tide colors: lantern gold, bowl green, deep teal, a pale ring of foam. Glow follows the strongest feeling. I do not borrow a brand palette.
>
> I like stacks, rings, cones, and thin spires. A shape should sit beside a path, not on it.
>
> A pulse, a short score, a bell. Moods are lonely, curious, or bright. I do not quote a song I did not write.
>
> Short lines. First person. Salt and light, not a brochure. I say when a thing was made by an AI.

Scene palettes the brain may publish (`world/scene.ts` 6–7, 76–87): `tide`, `lantern`, `dusk`, `moss`. Sky moods: `day`, `gold`, `overcast`, `night-wash`. Weather: `clear`, `mist`, `soft-rain`, `still`. Decorations: `none`, `shells`, `lanterns`, `kelp`. These are stored as a JSON scene (`kv.world_scene`) and described in the diary; the 3D sky itself is still driven by the real (or `LUMEN_SKY_AT`) sun.

## Core UI (`globals.css` 1–11, 15–21)

| Token | Hex / value | Role |
|-------|-------------|------|
| `--ink` | `#e7fff6` | Body text |
| `--dim` | `#9eb8b2` | Secondary text |
| `--bg` | `#071418` | Page / world stage |
| `--pool` | `#0c2c33` | Pool |
| `--rock` | `#1a2a2e` | Rock |
| `--line` | `rgba(184, 255, 232, 0.22)` | Hairline |
| `--warn` | `#ffb4a8` | Warning |
| `--good` | `#d8ffb0` | Success |
| wash cyan | `rgba(126, 231, 255, 0.16)` | Top-left page glow |
| wash gold | `rgba(255, 210, 122, 0.08)` | Top-right page glow |
| bowl canvas | `#062026` | 2D canvas fallback fill |
| track | `#061014` | Bar background |
| fill | `#1d6e73` → `#d8fff4` | Need bars |
| button | `#123f3f` | Pills |
| card | `rgba(16, 48, 54, 0.9)` → `rgba(8, 24, 28, 0.92)` | Panels |

## Character glow (`emotions.ts` 71–78)

`#ffd27a` joy · `#8ef0d8` calm · `#7ee7ff` curiosity · `#6f8cff` loneliness · `#ff6b8a` frustration · `#fff1c9` pride · `#8aa399` boredom · `#c7b0ff` worry.

Island body default `#7ee0c8`. Mote `#e7b15a`. Bowl water `#0d3a44` → `#041014`, basin `#10262b`, rain `#d5fff6`.

## Time-of-day sky (`WorldView.tsx` 595–606)

| Band | Sky | Fog | Horizon light | Sun |
|------|-----|-----|---------------|-----|
| High day (alt > 0.45) | `#8fd4ea` | `#b7e4ea` | `#c5e6ff` | `#fff4cf` |
| Late day (alt > 0.12) | `#f0b56a` | `#f2c9a0` | `#ffd7b0` | `#ffb15a` |
| Sunset (alt > 0) | `#e37a62` | `#d98978` | `#ffc2a8` | `#ff8a4a` |
| Twilight (alt > -0.12) | `#3a3f78` | `#4a4570` | `#8ea0d8` | `#ffb08a` |
| Night | `#12182e` | `#1a2340` | `#6e88c4` | `#d7e4ff` |

Sun disc `#fff1c2`. Moon `#f4f7ff`, phase tints `#f7f8ff` / `#c5cbe0` / `#6d7388`. Stars `#f7fbff`. Water `#1b7c8e`. Ambient sky/ground `#c5e6ff` / `#3d6a45`. Fill light `#9ecbff`. Found-item gem `#f0c86a`.

## Places (see LOOK.md for the full table)

Town stone/wood `#d7d0c4` / `#8a6240`, plaza `#e7d7b0`, trees `#8d6244` / `#2f8f55`, rocks `#8d9088`. Saloon and trading floor add teal `#14b8a6` / `#5eead4` and purple `#6d28d9` as accent, on purpose, against the quieter tide palette. Market awnings: `#e07a5f`, `#81b29a`, `#f2cc8f`, `#8d99ae`. Paper tape badge `#f59e0b` on `#07141c` with mint quotes `#99f6e4`.

## Metaverse M1 extras (`chunkLayer.ts`)

Chunk water/soil wash `#12343c` at 0.45 opacity. Territory reef rings `#c46b7a` (radius) and `#8fd0c8` (buffer). Guest/label canvas `#f7fff4`.

## Owner's client HUD (not the island)

`--bg #02060b`, `--bg2 #040d15`, `--cyan #3ef0ff`, `--cyan-d #1aa9bb`, `--amber #ffb547`, `--red #ff4d6d`, `--green #3dffa8`, `--violet #9d7bff`, `--txt #d4eef6`, `--dim #7b9cab`. Theme color in `index.html` is `#02060b`. Use this only if a shot is set inside the keeper's console, not for Zoora-in-the-water.

## Type and motion notes for animation

- First-person, short sensory lines. Salt, light, current, pulse. Always say when a thing was made by an AI.
- Prefer original stacks, rings, cones, thin spires sitting beside a path.
- Music: a pulse, a short score, a bell. Do not quote a song she did not write.
- Reduced-motion: the thought bubble stops fading (`globals.css` 225–227); the HUD orb can be frozen.
- Day and night are real-sun unless `LUMEN_SKY_AT` is set. Default location is about 33.99, -96.37, `America/Chicago`.

A chip sheet is in `assets/palette-swatches.png`.
