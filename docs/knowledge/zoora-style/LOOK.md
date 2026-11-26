# Zoora's look

Source of truth: Lumen in https://github.com/BuildWithAAI/buildwithAAI.

- PR #88 (the island and the jellyfish): branch `cursor/lumen-jellyfish-9263`, deploy candidate `20ff0750a38868a6cfb4233e24e3966360722792`. Local clone: `src/lumen-88/`.
- PR #91 (Metaverse M1, same character and island plus endless chunks): branch `cursor/metaverse-m1`, SHA `746a4c91db6663d52b9573a35826162391410aaa`. Local clone: `src/metaverse-91/`.
- Line numbers below are from those SHAs. The character mesh, glow table, and 12 areas are the same in both.

Zoora is a bioluminescent jellyfish, not a humanoid. Owner-authored identity (`zoora/SOUL.md`, `zoora/STYLE.md`): she lives in the Glass Bowl, a tide pool with a lantern arch and an ink studio. Taste words: lantern gold, bowl green, deep teal, a pale ring of foam. Glow follows the strongest feeling. She does not borrow a brand palette.

There is no sprite sheet, no imported character model, and almost no image assets. She is drawn in two original recipes in the same app:

1. A 2D canvas portrait in the Glass Bowl (`Scene.tsx`).
2. A 3D Three.js jellyfish on the island (`makeJelly` in `WorldView.tsx`).

A third look, the cyan HUD orb, belongs to the owner's client (HoS-owned files under `/workspace/aai/aai/static/zoora/`). That is the Zoora system, not the citizen in the water. It is documented last so a series can tell them apart.

## 1. Glass Bowl portrait (2D canvas)

File: `projects/lumen/src/components/Scene.tsx` (lines 14–105).

The live home page is now the 3D island. This canvas is still the official close-up recipe for her body and mood. A faithful preview is in `assets/bowl-moods.html` and `screenshots/88-zoora-mood-*.png`.

**Shape.** An elliptical bell (full ellipse filled, a tighter inner ellipse stroked) plus seven swaying tentacles. The bell's half-width is `70 + pulse * 26 + mood * 8` CSS pixels; height is `0.72` of that. The inner ring is `0.72 × 0.48` of the bell. Tentacles start at `cy + bell * 0.35` and run 120px down, with 16px spacing around a 48px offset from center. She floats: `cy = height * 0.42 + sin(frame / 40) * 8`.

**Bowl.** Vertical gradient `#0d3a44` → `#041014`. An oval sand/basin at the bottom in `#10262b`. Eighteen drifting motes (radius 1.4, or 3 during a plankton bloom) in the glow color. Storm or calm-rain adds `#d5fff6` streaks. A fish-school event draws six small ellipses.

**Glow and animation.** Fill/stroke color, pulse period, and amplitude come from `glowFor()` in `projects/lumen/src/brain/emotions.ts` lines 66–83. Pulse = `sin((frame / max(pulseMs, 400)) * 16) * 0.5 + 0.5` times amplitude, unless she is asleep, when pulse is forced to `0.15`. Fill alpha is `0.22 + pulse * 0.35`; the rim is drawn at alpha `0.9`, line width 2. Tentacles sway with `sin(frame / 18 + i + y / 30) * (8 + pulse * 10)`.

## 2. Island body (3D jellyfish)

File: `projects/lumen/src/components/WorldView.tsx`, function `makeJelly` (lines 1017–1081). Same function in #91.

**Shape.** A translucent hemisphere bell (`SphereGeometry` radius 0.48, theta length `π * 0.58`, scaled Y = 0.72) with a thin torus rim (radius 0.4, tube 0.035) at `y = -0.08`. Five tentacles in low detail, eight otherwise: cylinders from radius 0.02 to 0.012, length 0.85, ringed 0.22 off the center and hanging at `y = -0.48`. A name/activity sprite sits at `y = 1.15`.

**Material.** `MeshStandardMaterial`: `transparent`, opacity `0.62`, roughness `0.18`, metalness `0.02`, emissive = body tint, emissiveIntensity `0.32`, double-sided. Tentacles are a custom shader: they sway with `sin(uTime * 1.7 + uPhase + p.y * 6.0)` and fade along their length; fragment alpha is `0.28 + vFade * 0.45`.

**Glow.** A `PointLight` at the tint color, intensity `0.6`, distance 6 (3.5 in low detail), sitting at `y = 0.1`. At night the light intensity is raised to 1.1; by day it is 0.45 (`WorldView.tsx` around 415–416).

**Default body color.** Zoora is seeded as agent `zoora` with color `#7ee0c8` in `projects/lumen/src/world/registry.ts` line 128. That teal does **not** currently follow the emotion glow table; the 3D body stays `#7ee0c8` unless the row is changed. Mote, a demo companion, is `#e7b15a` (line 129). Other visitor colors in the same file: `#e07a8a`, `#8aa6e0`, `#d2e08a`, `#c08ae0`, `#e0a07a`.

**Label.** Name, activity, and the feeling sentence (`WorldView.tsx` / `world/labels.ts`). Thought bubble: HTML `.world-bubble` over her head (`globals.css` 113–134; placement in `labels.ts` 54–65). Lines come from `thoughtLines()` in `world/bubble.ts`.

## Expressions and moods

Emotions are a code model, not blend-shape faces. There is no mouth or eye rig. Mood is visible as glow color, pulse speed, and amplitude (bowl), and as the label/thought text (island).

From `emotions.ts` 68–83 and `docs/EMOTIONS.md`:

| Emotion       | Glow color | Pulse     | Amplitude | Typical acts (docs)        |
|---------------|------------|-----------|-----------|----------------------------|
| joy           | `#ffd27a`  | 1600 ms   | 0.85      | dance, paint, light show   |
| calm          | `#8ef0d8`  | 3200 ms   | 0.35      | (default / quiet water)    |
| curiosity     | `#7ee7ff`  | 1400 ms   | 0.60      | explore, inspect, research |
| loneliness    | `#6f8cff`  | 2800 ms   | 0.28      | call out, approach notes   |
| frustration   | `#ff6b8a`  | 700 ms    | 0.95      | scrap and redo, sulk       |
| pride         | `#fff1c9`  | 2000 ms   | 0.70      | show the gallery, paint    |
| boredom       | `#8aa399`  | 2400 ms   | 0.22      | explore, inspect, read     |
| worry         | `#c7b0ff`  | 900 ms    | 0.55      | rest, dim lights, sleep    |

If mood < -0.4, amplitude is cut to `max(0.15, amplitude * 0.6)`. Asleep: pulse forced to 0.15 in the bowl. Diary tone follows mood and stress: bright, steady, sparse, or fragmented (`docs/EMOTIONS.md` line 49).

Scene palettes also follow the dominant emotion (`world/scene.ts` 76–87): joy/pride → `lantern`; calm/loneliness → `tide`; curiosity/frustration → `dusk`; boredom/worry → `moss`. Those names are stored on the world scene; the 3D renderer still uses the time-of-day sky in `skyColors()` plus decorations (shells, lanterns, kelp) and weather. They are taste labels, not a second texture set.

## The 12 island areas

Canonical list: `projects/lumen/src/world/areas.ts` lines 98–111. Built in `WorldView.tsx` (town, art, music, coding basement) and `islandAreas.ts` (the rest). Camera rigs: `WorldView.tsx` 14–34. Open `/?cam=<name>`.

| # | id | Label | Camera | What you see |
|---|----|-------|--------|--------------|
| 1 | `town-center` | Town Center | `town` | Stone plaza `#e7d7b0`, fountain pool `#7ec8d4`, lanterns `#ffd9a0` / `#ffb15a`, notice boards |
| 2 | `art-studio` | Art Studio | `art` | Stucco `#f0d2b4`, terracotta roof `#c45c3e`, glass `#b7e4ff`, easel |
| 3 | `music-studio` | Music Studio | `music` | Timber `#a87445`, warm glass `#ffe7c4`, hanging strings `#f6edd4` |
| 4 | `coding-basement` | Coding Basement | `code` | Plaster `#d9c7ae`, slate roof `#4d6a78`, mint glass `#d7fff0` / `#8ef0c4`, diary and log boards |
| 5 | `beach-dock` | Beach and dock | `beach` | Wood `#c4a36a`, pale hull `#f2efe6`, shells `#f4d7c4` |
| 6 | `forest-trail` | Forest trail | `forest` | Trunks `#6d4a30`, leaves `#246b3e`, fireflies `#d6ff9a` |
| 7 | `garden-greenhouse` | Garden greenhouse | `garden` | Glass `#d7fff4`, frame `#f4f7f2`, plants `#3c9a55`, pots `#c47b5a` |
| 8 | `market-row` | Market row | `market` | Awning colors `#e07a5f`, `#81b29a`, `#f2cc8f`, `#8d99ae`; stall boards `#f6e7d4` |
| 9 | `lighthouse-hill` | Lighthouse hill | `lighthouse` | Stone `#e7e1d6`, red stripe `#c4564a`, lamp `#fff6d0` / `#ffe08a`, beam `#fff3c4` |
| 10 | `research-station` | Research Station | `research` | Stone `#d7d2c8`, timber `#8d5a3c`, dome `#b9d7e8`, screen `#16304a` |
| 11 | `solana-saloon` | Solana Saloon | `saloon`, `saloon-in` | Wood `#8a4b2f`, teal trim `#14b8a6`, purple `#6d28d9`, glow panes `#2dd4bf` |
| 12 | `trading-floor` | Trading Floor | `floor`, `floor-in` | Shell `#1e293b` / `#0f172a`, purple roof `#6d28d9`, mint glass `#99f6e4` / `#5eead4`, PAPER/LIVE tape |

Extra cameras (not areas): `overview`, `island` (top-down), `together`, `zoora` (close-up), `follow`.

`docs/WORLD.md` in #88 still lists the first ten places and not the saloon or trading floor. Trust `areas.ts`.

## Type, motion, UI chrome

Site CSS: `projects/lumen/src/app/globals.css`.

- Page background `#071418` with radial washes of `rgba(126, 231, 255, 0.16)` and `rgba(255, 210, 122, 0.08)`.
- Ink `#e7fff6`, dim `#9eb8b2`, line `rgba(184, 255, 232, 0.22)`.
- Body font: `"Avenir Next", "Segoe UI", sans-serif`. Headings: Palatino / Iowan Old Style / Georgia.
- Thought bubble: dark glass `rgba(6, 18, 22, 0.88)`, 16px radius, fade animation 14s (disabled when `prefers-reduced-motion`).
- Buttons and chips: pill radius 999px, fill `#123f3f`.

Sky (day to night) in `WorldView.tsx` 595–600: `#8fd4ea` / `#b7e4ea` (high sun) → gold `#f0b56a` → sunset `#e37a62` → twilight `#3a3f78` → night `#12182e`. Water `#1b7c8e`. Grass / sand / soil are terrain lerps in `buildTerrain` (~741–784).

## Image assets that actually exist

Almost everything is procedural. Copied into `assets/`:

- `assets/lumen-favicon.svg` — rounded `#14161c` square, pale ring `#f0e2c0` (not a jellyfish).
- `assets/STYLE.md` — owner-authored taste note.
- `assets/palette-swatches.png` — chips sampled from the code tables above.
- `assets/bowl-moods.html` — runnable bowl portraits.
- `assets/hud/` — HUD favicon and icons only (see below). Gallery SVGs are made at runtime and stored in SQLite `creations.svg`, not in the repo.

## 3. Owner's client HUD (separate look)

HoS-owned, read-only, from the shared tree `/workspace/aai/aai/static/zoora/` (not part of PR #88 / #91). Do not treat this as the island character.

The HUD orb (`zoora.js` 186–265) is a circular instrument: tick ring, amber/cyan arcs, 80 particles, a three-layer waveform, and a glowing core. Idle color is cyan `rgba(62, 240, 255, …)` (`#3ef0ff`). Thinking/speaking shifts to amber `rgba(255, 190, 90, …)` / `#ffb547`. Alarm idle is `rgba(255, 96, 120, …)`. Modes: idle, listening, thinking, speaking (plus a wake-word label). Background `#02060b` / `#040d15`. Fonts: Orbitron, Rajdhani, JetBrains Mono (files live in `fonts/`, licensed there; not copied here). Icons copied to `assets/hud/`.

## What is missing or easy to miss

- No character turnaround, no face shapes, no walk cycle beyond bob/tentacle sway and path-following.
- The 3D body does not yet recolor with `glowFor()`; use the bowl portraits for mood color.
- Daylight screenshots used the official `LUMEN_SKY_AT` hook set to noon America/Chicago on 2026-11-17, plus one authentic night overview taken at about 19:06 that evening. The live site follows the real sun at default `33.99, -96.37`.
- The built-in `/?cam=zoora` rig is a fixed seat at Town Center. If she is not there it can look empty or underground. The close-ups in `screenshots/` were taken with the `follow` camera and a zoom, plus a clean crop with the HUD chrome hidden.
- Metaverse M1 adds terrain chunks, a territory ring, and guest markers around the same island (`chunkLayer.ts`); Zoora's mesh is unchanged.
