# ART_GUIDE: code-drawn art and render quality (binding)

Version 1, 2026-11-24. Applies to every frame rendered from `src/`: characters, props, charts, UI, thumbnails.

- **Precedence:** `docs/PROJECT_INSTRUCTIONS.md` > this guide > anything else. The approved sheets in `reference/model-sheets/` define what ZOO and Badger look like. This guide defines how anything is drawn, moved, encoded and checked. Chart data, geometry and animation are specified in `docs/CHART_SPEC.md`.
- **Reading a rule:** every rule is testable. **(measured Ex)** marks a result from an experiment in the 2026-11-24 art-quality study (see Evidence at the end). "(search extract)" means the page was blocked in this session and the fact came from a search-result extract: re-check it in a browser before quoting it publicly.
- Output units: px on the 1920×1080 canvas unless stated. "Scale" means the character's placement scale (`Placement.scale`, ZOO = 900 px tall at scale 1).

---

## 1. Principles

- **P1 Smooth.** Every visible edge is the edge of a flat, opaque vector fill. No texture, blur, glow, gradient or pattern anywhere. *Why:* those are exactly what H.264 and YouTube turn into blotches and bands (measured E1–E3, N1). *Source:* PROJECT_INSTRUCTIONS "Style and palette".
- **P2 Professional means consistent.** One palette, one line system, one radius scale, one key-light direction per scene, one reusable asset per character. Nothing hand-tuned per shot. *Source:* PROJECT_INSTRUCTIONS; Valve, *Illustrative Rendering in TF2*, NPAR 2007 (search extract).
- **P3 Readable at thumbnail size.** Every character pose passes the silhouette test and the 64 px test (QA 5). Every frame reads in greyscale (CV4).
- **P4 Data is never art.** Charts and numbers come from validated data. Art never changes a colour, level or label (section 8).
- **P5 Restrained.** Limited animation: clear poses, small moves, holds that carry the joke. No bouncing, no frantic cuts. *Source:* PROJECT_INSTRUCTIONS "Animation and audio".

## 2. Shape and line

- **SL1 Size hierarchy.** Every character and prop has one dominant simple mass, a few medium masses and small details. Cluster the small details at the face. Big areas stay plain. *Why:* simple big shapes survive phones, thumbnails and compression. Detail spread evenly reads as noise and costs bits (measured E3). *Source:* Creative Bloq, "How to simplify figures for animation" (search extract).
- **SL2 Straights against curves.** On every limb and torso side, set a straighter contour against a curved one. Taper wrists, ankles and waist. Never build a limb from a constant-width stroke or from two parallel lines. Nothing mirror-symmetric except deliberate front views. *Why:* parallel tubes were the main amateur tell in the rejected flatbold arms and legs. *Source:* creativebloq.com/how-to/simplfy-figures-for-animation; animatedspirit.com/straights-curves (search extracts).
- **SL3 Few clean Béziers.** Build organic shapes from few cubic segments. Put on-curve points at the extremes of each bulge, with handles horizontal or vertical. Make every organic join smooth: collinear handles (`S`/`s`, or mirror the control point). No `L` segments or polygons on organic forms. *Why:* extra points and misplaced handles cause the wobbles and pinches that read as "not smooth". *Source:* Scannerlicker, "Bézier OCD" (search extract).
- **SL4 One line system: near-black outlines on everything.** Every character part, prop and diagram frame has a `#0B0C0F` outline. Draw it LAST, as the same path with `fill="none"` (for example `<use href="#part" fill="none" stroke=… />`). Never rely on `paint-order="stroke"`. Exceptions: chart data marks (candles, volume bars, grid) carry no outline (CHART_SPEC 4); text uses `paint-order="stroke fill"` only when it needs an outside outline. *Why:* an outline on top removed the shadow-side antialiasing fringe completely (0 px). `paint-order=stroke` left it (331 px against 333 with no outline) (measured E4). *Source:* PROJECT_INSTRUCTIONS; MDN `paint-order`.
- **SL5 Line weights in output px.** Outline = clamp(3.5 × scale, 3, 6) px. Internal lines (seams, folds, fingers) = clamp(2.25 × scale, 2, 4) px. Never under 2 px. Set `strokeWidth = px / scale` inside the scaled group. Lines DO scale with camera push-ins; never put `vectorEffect="non-scaling-stroke"` on characters. *Why:* `palette.ts` `LINE` (3.5 / 2.25 world units) gives only 2.1 / 1.35 px at scale 0.6. A 1 px line loses 48% of peak brightness at a half-pixel offset and shimmers in motion (measured E5). *Source:* `src/characters/palette.ts`; measured E5.
- **SL6 Joins and caps.** `strokeLinejoin="round"` and `strokeLinecap="round"` on every organic stroke. *Why:* the SVG defaults are miter and butt. A miter falls back to bevel once `stroke-miterlimit` is exceeded, which pops between frames as the angle changes. *Source:* MDN `stroke-linejoin`.
- **SL7 Tapered lines are filled paths.** Brows, hair strands, beard edges, smirk corners and fur-direction ticks on Badger's ears are filled outline paths: a centreline offset by ±w(t)/2 and closed with smooth cubics (`taperedStroke`, Appendix A), or `perfect-freehand` `getStroke` (MIT) with `simulatePressure: false`. *Why:* SVG has no variable-width stroke; the W3C proposal never shipped. *Source:* github.com/steveruizok/perfect-freehand (read); W3C SVG WG "Variable width stroke" proposal (search extract).
- **SL8 Chart and UI lines inside scaled groups** use `vectorEffect="non-scaling-stroke"`. *Source:* MDN `vector-effect`.
- **SL9 No butt joints between fills.** Never let two fills meet edge to edge. Tuck the lower shape 1–2 px under its neighbour, or merge same-colour pieces into one path. *Why:* two amber rects meeting at x = 1000.5 left a seam pixel 24% darker (measured E4).
- **SL10 Minimum feature sizes.** Measured through Remotion's own encoder chain (measured E8):
  - near-black or neutral lines: ≥ 2 px;
  - any coloured fill or line: ≥ 4 px in both directions, **or** a vertical coloured stroke of exactly 3 px centred on an even pixel column (x = 2k−1…2k+1);
  - never a 1 px coloured line (keeps 18–57% of its chroma). A 2 px coloured line keeps 76–81% wherever it sits;
  - dots and specks ≥ 4 px; on-screen text ≥ 24 px.

  Apply it to small brand details: the teal jellyfish pin and Badger's teal tag need ≥ 4 px of teal inside the outline at output size. Below that, draw the pin as one teal shape with no tentacle detail.
- **SL11 Pixel-snap only what is static and axis-aligned.** UI, panels and chart geometry use integer coordinates (odd-width strokes centred on .5) and `shapeRendering="crispEdges"`. Characters keep default antialiasing. Animated positions stay floats: never `Math.round` a moving transform. *Why:* rounding a 3% push-in froze 73 of 89 frames and then jumped 1 px (measured M3). A 1 px line on a half pixel renders as two half-strength rows (measured N1). *Source:* MDN `shape-rendering`.
- **SL12 Corner radii.** Use one scale at 1080p: 4, 8, 16 px and fully round, divided by scale like strokes. No hand-tuned `rx`. *Why:* the rejected flatbold used 14 different radii (2 to 22). *Source:* Material corner-radius token scale as precedent (search extract).
- **SL13 Shape language.** ZOO is built from rectangles and rounded rectangles (overshirt, torso, trousers), with a few angles in the nose, jaw line and forelock and few circles. Badger is built from a lean wedge (deep chest, tucked waist), long straight legs and triangular ears. *Why:* squares read stable and calm, triangles sharp, circles childlike. That fits a calm, unimpressed adult. *Source:* creativebloq.com/art/digital-art/how-shape-can-make-or-break-your-character-art; 3dsense.net shape-language article (search extracts).
- **SL14 Silhouette mode.** Every character and prop component accepts `silhouette` (all fills `#000`, no strokes, on `#FFF`). *Why:* the silhouette is what survives distance, motion and thumbnails. *Source:* Valve TF2 paper (search extract).

## 3. Colour and value

- **CV1 Tokens only.** Use colours only from `BRAND`, `ZOO_COLORS` and `BADGER_COLORS` (`src/characters/palette.ts`), the chart tokens (CHART_SPEC 3) and the two additions below. No ad-hoc hex values. No opacity below 1 on art fills to make a new colour. Fading a whole layer in a transition is allowed. *Why:* an opacity tint over a varying background makes unplanned mid-tones. *Source:* PROJECT_INSTRUCTIONS (palette).
- **CV2 Additions to `palette.ts`** (owner sign-off needed, since the palette is a recorded continuity decision):
  - `BRAND.backgroundShadow = '#CFD3D8'` (L\* 84.4): contact shadows and the floor shadow on the default background.
  - `OUT = {outlineMin: 3, outlineMax: 6, detailMin: 2, detailMax: 4}` for SL5.
- **CV3 One shadow tone per colour,** 6–20 L\* darker than its base and in the same hue family. The approved palette steps are skin 80.9→71.4, hair 31.9→22.9, overshirt 23.7→17.7, coat 96.8→87.6 (measured P1). There are no highlight or rim tones. *Source:* PROJECT_INSTRUCTIONS.
- **CV4 Plan the values first.** Check every style frame and one frame per shot in greyscale: render a check-only composition that wraps the scene in `<AbsoluteFill style={{filter: 'grayscale(1)'}}>` (never in final renders). The frame must read as 3–5 value groups. Approved values (L\*, measured P1): background 91.9; off-white 96.8; sneakers 92.3; skin 80.9; teal 67.8; hair and beard 31.9; collar 26.3; overshirt 23.7; trousers 12.3; tee 9.4; spots 8.9. Consequences:
  - **CV4a** Badger's coat (ΔL\* 4.9 from the background) and ZOO's sneakers (ΔL\* 0.4) separate from `#E6E8EB` only by their outline. Every shot that shows feet or paws gets a flat contact shadow in `backgroundShadow`. Every thumbnail places Badger's head against a shape at least 15 L\* darker than his coat.
  - **CV4b** ZOO's clothes are L\* 9–24, so whatever sits directly behind his torso must be L\* ≥ 60. Show night through props (a dark window shape, a lit monitor), never by darkening the whole background behind him.
  - **CV4c** The face reads through its own features: beard and brows (L\* 23–32) on skin (80.9), ΔL\* ≥ 49. Keep a clear zone of one head-width around the head: no text, no high-contrast prop edges and no saturated colour.
  *Source:* Proko value-group studies (search extract); measured P1.
- **CV5 60-30-10 by area.** About 60% background (`#E6E8EB`); about 30% characters and props (near-black, slate, silver, overshirt grey); at most 10% accent and data colour together. Teal `#29B8AD` is decoration only (pin, tag, small brand marks): never data, never a large mass. Green and red mean price direction only. *Why:* the rejected flatbold used one amber for jacket, badge, up candles and burst, so it meant four things. *Source:* Behr 60-30-10 (search extract); PROJECT_INSTRUCTIONS ("teal used sparingly").
- **CV6 Large light areas** use off-white `#F4F6F8` or the background grey, never `#FFFFFF`. Pure white is allowed only for small accents such as eye whites and teeth (palette).
- **CV7 Never colour alone.** Any state shown by colour (up/down, good/bad, on/off) also carries a shape or text cue (▲/▼, a sign, a label). *Source:* WCAG 2.2 SC 1.4.1 (search extract).

## 4. Lighting and shading

**Allowed**
- **LS1 One key light per scene,** default from screen-left above. The shadow tone sits on the screen-right and lower side of every form, the same for all characters and props in the scene.
- **LS2 Form-following cel shadows.** Each local colour gets at most one hard-edged shadow shape: a curved terminator that wraps the volume, plus cast shadows under the forelock, under the beard on the neck, under the collar, under the arms and inside pockets. Never a straight stripe parallel to the silhouette. *Why:* value patterns that describe internal shape are what make flat art look designed, not coloured in. *Source:* Valve TF2 SIGGRAPH 2007 notes (search extract).
- **LS3 Construction order inside one part.** (1) Base fill = the part's silhouette path. (2) Shadow shape clipped to that same path with `<clipPath>`. (3) Outline = the same path with `fill="none"`, drawn last. A shadow never crosses its outline. *Why:* a clipped shade alone leaves a lit fringe on the shadow-side edge (up to 184 ΣΔRGB on about 410 px); the top-layer outline removes it (0 px) (measured E4). Unclipped shadows spilled past the outline (measured N1).
- **LS4 Contact shadows:** one flat ellipse in `backgroundShadow` under feet and paws. No blur, no opacity.
- **LS5 Light pools** (desk lamp, monitor light): 2–3 concentric flat bands with hard edges. *Why:* flat stepped bands had 0.0% flattened blocks against 47–64% for gradients at CRF 28 (measured E2).

**Banned**

| Technique | Why |
| --- | --- |
| Linear or radial gradients (SVG or CSS), vignettes, sky gradients | PROJECT_INSTRUCTIONS. At CRF 28, 47–64% of textured 8×8 blocks flatten into a staircase (E2). A dark radial gradient ends with 20–45 px bands after VP9 or AV1, even from a lossless upload (N2). |
| Halftone, dot, hatch or mesh `<pattern>`, noise, grain, `feTurbulence`, fur strokes | PROJECT_INSTRUCTIONS. Halftone cost 6.2× the bits of flat cel (1160 vs 188 kbps) and fell to SSIM 0.982 vs 0.999 at CRF 28 (E3). A grain overlay made files 2.7× larger, and VP9 stripped it anyway (N2). |
| `feGaussianBlur`, `feMorphology`, CSS `filter: blur()` / `drop-shadow()`, `box-shadow` glows, bloom | PROJECT_INSTRUCTIONS. 2.1–2.2× the bits and about 9 dB worse through the AV1 proxy (E3, N2). Linework rendered 3–9× slower than flatbold. Remotion warns these effects need a GPU. *Source:* remotion.dev/docs/performance. |
| Highlight or rim tones (including flat rim masks) | Not in the approved style: one shadow tone per colour. |
| Opacity tints and `mix-blend-mode` on art | Unplanned mid-tones (CV1). |
| CSS `perspective`, `rotateX/Y`, SVG `skewX/Y` on anything that shows data or text | Distorts levels: the rejected inknoir tilted every price line by `skewY(-3)` (C3). |
| 3D, photorealism, painterly or comic shading | PROJECT_INSTRUCTIONS. |

## 5. Character construction and appeal

- **CH1 One asset per character.** ZOO and Badger are built once in `src/characters/` from the approved sheets and reused in every shot. Never redraw them per scene, and never mirror an asymmetric character to make a view (ZOO's forelock and LEFT-chest pin; Badger's LEFT-ear cap and spots). *Source:* PROJECT_INSTRUCTIONS.
- **CH2 Adult proportions.** ZOO measures about 5.3 heads on the approved front view (top of hair to beard chin: hair top row 6, chin about row 125, soles about row 638 of `reference/crops/zoo_turn_front.png`) (measured P2). At 900 units tall, one head is about 170 units. Do not enlarge his head for thumbnails or close-ups. *Why:* the three rejected concepts measured 4.0–4.8 heads and read young. Animators give younger characters larger heads and rounder, larger eyes. *Source:* Toon Boom Learn, character proportions; Disney Research IDC'16 (search extracts).
- **CH3 Adult face cues.** Brown irises always visible. Small or no catchlights. Defined jaw under the beard. Prominent, softly angular nose. Brows low and straight. Eyes open between blinks and **never half-lidded** (owner decision). Neutral = flat straight mouth + subtle brow lift. *Why:* round eyes, big catchlights and small noses are baby-schema cues. *Source:* PROJECT_INSTRUCTIONS; Glocker et al. 2009, *Ethology* 115:257 (search extract); CLAUDE.md owner decision.
- **CH4 Parts and pivots.** ZOO: body, head, hair, facial features, mouth, upper arm, forearm, hand, legs. Badger: body, head, folded ears, eyes, muzzle, legs, tail. Each part has its pivot recorded in the manifest. Animate joint angles around pivots and interpolate the angles, never a hand's x/y. *Why:* interpolated angles make arcs automatically; interpolated positions make straight, mechanical paths. *Source:* PROJECT_INSTRUCTIONS / prompt 02; Lasseter 1987 (search extract).
- **CH5 Numeric rig channels.** `headTilt`, `lookX`, `lookY`, `blink`, `browLift` and `poseAmount` already exist in `types.ts`. Add `headNod`, `shoulderLift` and per-arm joint angles. `expression` is an enum, so switch it only on a cut, on a fully closed blink frame, or inside a head turn of 8 frames or more; never mid-hold. *Why:* an enum swap pops in one frame. Hiding it in a blink or turn removes the pop.
- **CH6 Badger's markings** have fixed IDs and are bound to their body part. They move with it and never slide, multiply or switch sides. Act with ears, brow line, head angle and tail at small amplitudes. *Source:* PROJECT_INSTRUCTIONS.
- **CH7 Appeal through restraint.** The appeal comes from an asymmetric smirk (one mouth corner), weight shifts, head angle and well-timed holds, not from bounce or squash. ZOO's body never overshoots (MO4).
- **CH8 Silhouette and 64 px tests** (QA 5) on every new pose. ZOO's identity comes from the forelock and the overshirt shape; Badger's from the outward-folded ears and the dark back patch. A pointing arm must be separated from the torso by negative space.

## 6. Motion and timing (30 fps; 1 f = 33.3 ms)

All motion is a pure function of `useCurrentFrame()`. Timelines (visemes, blinks, breaths, accents) are precomputed into props. Randomness comes only from `random(seed)`; never `Math.random`, never state. *Why:* Remotion renders frames in parallel tabs that share no state. *Source:* remotion.dev/docs/flickering, /docs/random (read from the docs source).

- **MO1 Body moves ease in and out.** Use minimum-jerk `t => t*t*t*(t*(6*t-15)+10)`, or `Easing.bezier(0.5, 0, 0.5, 1)` (within 0.9% of it), or `Easing.inOut(Easing.sin)` for softer moves. Never linear on a character. Note: Remotion's `Easing.ease` is ease-IN (bezier 0.42, 0, 1, 1); it is only 31.5% done at mid-time. *Source:* Flash & Hogan 1985 (search extract); measured M1.
- **MO2 Decelerate-only curves** (`bezier(0.16,1,0.3,1)`, M3 emphasized-decelerate `0.05,0.7,0.1,1`) are only for text, UI and props entering from off-screen or right after a cut. *Why:* they cover 19.5% and 34.9% of the move in the first frame, which reads as a jerk from a visible pose (measured M1).
- **MO3 Springs.** Remotion ignores damping above critical (damping ≥ 2·√(stiffness·mass)): damping 20 = 200 = 1000 at stiffness 100. Slow a no-bounce spring with stiffness or mass instead. `Easing.spring` inside `interpolate` is front-loaded (0.895 done at mid-segment): use it for arrivals only. *Source:* `remotion/dist/cjs/spring/spring-utils.js`; measured M1.

  | Preset | Config | Use | Measured (M1) |
  | --- | --- | --- | --- |
  | settle | `{stiffness:100, damping:20}` | head turns, camera, UI | 90% at f12, settled f23, 0% overshoot |
  | snappy | `{stiffness:300, damping:35}` | fast no-bounce moves | 90% at f7, settled f13 |
  | heavy | `{stiffness:40, damping:13}` | slow camera, weight | 90% at f19, settled f36 |
  | limb | `{stiffness:150, damping:17}` | trailing parts, gesture ends | 4.6% overshoot, settled f18 |
  | pop | `{stiffness:200, damping:14}` | props and stickers only | 16.1% overshoot |
  | default `{damping:10}` | **never on characters** | | 16.3% overshoot, 28 f of wobble |

- **MO4 No overshoot on ZOO's body.** Use zeta-1 springs (settle, snappy, heavy) or eased interpolation. `limb` is allowed only on trailing parts (forelock, collar, Badger's ears and tail). *Why:* bounce reads as excitable, not deadpan. *Source:* PROJECT_INSTRUCTIONS.
- **MO5 Timing ladder.** Reaction or snap 2–4 f. Head turn or gesture 8–12 f. Deliberate move 15–24 f. Expression change 4–8 f. Pose change 8–15 f. *Source:* Thomas & Johnston's in-between chart via Lasseter 1987 (search extract), converted to 30 fps.
- **MO6 Moving holds.** Never freeze the rig. Breathing keeps running, blinks follow the scheduler, the eyes stay alive, and 0.5–1 px of slow drift is allowed. *Source:* animationmentor.com, "moving hold" (practitioner).
- **MO7 Anticipation.** Before a point, lean or turn of more than 20°, add a 3–6 f counter-move at 10–20% of the amplitude. For ZOO use ≤ 10%, and none on micro-moves. *Source:* Lasseter 1987 (search extract); amplitudes are starting values.
- **MO8 Overlap.** Drive every part from the same key with a frame lag: torso +0, head +1–2 f, arms +2 f, forelock, collar, Badger's ears and tail +3–4 f. Use `spring({frame: frame - key - lag, fps, config})`. *Source:* rebusfarm.net follow-through article (practitioner).
- **MO9 Secondary action.** At most one at a time (mug steam, monitor flicker, Badger's tail), smaller than the primary action, and paused during punchline holds. *Source:* Lasseter 1987 (search extract).
- **MO10 Breathing.** At rest: a 4–5 s cycle (120–150 f), 40% inhale and 60% exhale, eased at both ends. The chest moves 2–4 px at full-body 1080p and the head follows 1–2 f later. While ZOO talks, drop the cycle: add a 6–12 f inhale in pauses of 350 ms or more before a new phrase. Badger: the same helper with a 2–3 s period (taste; tune by eye). *Source:* OpenStax respiration; ASHA JSLHR 2023 speech breathing (search extracts).
- **MO11 Head accents.** Put the apex on the stressed-vowel onset (Kokoro's `ˈ` marker): rise 3 f, settle 8–10 f, 1–2° for ZOO. Accent at most the last primary stress of a phrase, and skip most of those. *Why:* Kokoro lines have 1.7 primary stresses/s (measured M2), so accenting all of them is busy. *Source:* Munhall et al. 2004; Krahmer & Swerts 2007 (search extracts).
- **MO12 Eye darts.** 2 f: 80% of the travel on frame 1, settle on frame 2, then hold. Gaze (`lookX`, `lookY`) is a separate channel from `headTilt`. Never pan the eyes slowly. *Source:* animationapprentice.org eye darts (practitioner).
- **MO13 Camera push-in.** Scale 1.00→1.03–1.08 over 90–180 f with `Easing.inOut(Easing.sin)`, anchored on the eyes, at most one per shot. Apply it as a float CSS `scale` or SVG `transform` on a wrapper. No `will-change`, no rounding. *Why:* float transforms stepped 0.172–0.202 px/frame (ideal 0.182) and stayed smooth after CRF 18. `will-change` gave uneven steps and blurred a 2 px line (peak 223→174) (measured M3). *Source:* studiobinder.com push-in (practitioner).
- **MO14 Pans and parallax.** Detailed layers move ≤ 4–6 px/frame, hard limit 9.1 px/frame (one frame width per 7 s). Parallax factors: far 0.1–0.2, mid 0.4–0.6, subject 1.0, foreground 1.2–1.5. *Source:* red.com/red-101/camera-panning-speed; Adobe Animate layer depth (search extract). The 4–6 px margin is derived: Remotion frames have no motion blur.
- **MO15 Punch-ins.** For deadpan, hard-cut to a 1.25–1.5× framing. A 2–4 f snap-zoom is allowed at most about once a minute. *Source:* morphic.com snap zoom (practitioner).
- **MO16 Transitions.** Hard cuts inside a sequence. `fade()` over 10–15 f for time jumps. For chapter changes, slide or wipe with `springTiming({config: {damping: 200}, durationInFrames: 15–20})` plus `motionBlur={{shutterAngle: 180, samples: 16}}` on the `TransitionSeries.Transition`. Subtract the overlap from the total length. *Source:* `.claude/skills/remotion-markup/transitions.md`.
- **MO17 Reaction beat** after a punchline: (a) moving hold on ZOO 12–24 f (breathing only, no blink); (b) one small action: an 18 f long blink, a 2 f eye dart to camera, or a Badger ear or head reaction; (c) hold 8–15 f; (d) cut. Do not add a pause before the punchline in the voice line. *Source:* Attardo & Pickering 2011; Hömke et al. 2018 (search extracts). Frame counts are starting values.
- **MO18 Shot margins.** Faces, hands, dog ears and captions stay ≥ 96 px from the left and right edges and ≥ 54 px from the top and bottom (the 90% title-safe convention). For Shorts (1080×1920) the margins are ≥ 54 px left/right and ≥ 96 px top/bottom. *Source:* PROJECT_INSTRUCTIONS ("clear of frame edges").

## 7. Lip-sync and blinks

- **LP1 Phonemes, not amplitude.** Drive the mouth from Kokoro `create_timed` phoneme timings. *Why:* an amplitude-driven mouth stayed more than 30% open on 100% of M/B/P frames and jumped 18 times by over 40% of its range on a 10.5 s line (measured M2). *Source:* Rhubarb Lip Sync README (read).
- **LP2 IPA → owner mouth library** (`MouthShape` in `types.ts`). First fold `ː` into the previous phone and `ˈ ˌ` into the next.

  | Phones | Shape |
  | --- | --- |
  | p b m | `mbp` |
  | w u ʊ o ɔ ɚ ɜ | `oh` |
  | ɑ a æ ʌ ɛ | `ah` |
  | i ɪ e j | `ee` |
  | f v l ə ɐ ɹ t d n s z θ ð ʃ ʒ k g ŋ h ɾ (all other phones) | `slightlyOpen` |
  | space and punctuation | pause rules below |

  Diphthongs are two phones: aɪ = `ah` then `ee`; aʊ = `ah` then `oh`; oʊ = `oh`; eɪ = `ee`; ɔɪ = `oh` then `ee`. *Source:* adapted from Rhubarb `animationRules.cpp` (read) to the owner's six shapes.
- **LP3 Timing.** Hold every shape ≥ 2 f; merge shorter ones into the longer neighbour, but extend a 1 f `mbp` instead of dropping it. Pauses under 4 f hold the previous shape; 4–10 f relax to `slightlyOpen`; 11 f or more close to `closed`. Between `ah` and `closed`/`mbp`, insert 1 f of `slightlyOpen` when there is room. Start `mbp` 1–4 f before the plosive release. Shift the whole track **1 f earlier** than the audio. *Why:* the raw per-frame track changed 9.1×/s with 28% one-frame shapes (flicker). After these rules it changed 5.1×/s with no one-frame shapes and a median hold of 4 f (measured M2). *Source:* Rhubarb `timingOptimization.cpp`, `pauseAnimation.cpp`, `tweening.cpp` (read).
- **LP4 Swap whole drawings.** No morphing or scaling between mouth shapes. Each shape is anchored to the same face point in every head view, and the beard and jaw stay coherent. ZOO's resting mouth is `closed` (flat, straight). *Source:* PROJECT_INSTRUCTIONS.
- **LP5 No audio, no lip-sync claim.** Silent previews are labelled silent. *Source:* PROJECT_INSTRUCTIONS.
- **LP6 Blink shape.** Standard blink 7 f: close over 2 f (ease-in), shut 1 f, open over 4 f (ease-out). Usable range 6–10 f, never symmetric. Long deadpan blink 18 f: 4 close, 6 shut, 8 open. *Why:* real blinks close 40–47% faster than they open; conversational blinks are about 208 ms short and 607 ms long. *Source:* PubMed 18565090; Disney Research blink model (search extracts); render check M4.
- **LP7 Blink schedule.** Seeded intervals of 45–150 f (mean about 97 f, about 18.5 blinks/min), from `random(seed)`. Force blinks at the start of head turns over 30° and in phrase-end pauses of 11 f or more. Never blink on a stressed syllable or inside a punchline hold, except the long blink. Badger blinks on his own seed. *Why:* the mean blink rate is 17/min at rest and 26/min in conversation; lid closure accompanies 97% of gaze shifts over 33°. *Source:* Bentivoglio et al. 1997; Evinger et al. 1994 (search extracts).

## 8. Charts and trading data (binding)

Full specification: `docs/CHART_SPEC.md`. These rules override any composition or storyboard.

- **CD1 Colour comes only from the data.** close > open → up colour; close < open → down colour; close = open → neutral. The wick uses the body colour. Never colour a candle for emphasis, and never draw a "hero" candle outside the validated series. *Why:* the owner's rule ("green candles go up, red candles go down"). All three rejected frames broke it (amber, cyan and silver candles, and a red candle going up) (C3). *Source:* CLAUDE.md art rules; lightweight-charts 5.0.8 source (read).
- **CD2 Colour tokens** (measured E7). The default chart surface is a slate panel.

  | Surface | Up | Down | Neutral | Up/down vs surface | Deutan / protan ΔE76 up↔down |
  | --- | --- | --- | --- | --- | --- |
  | Slate panel `#161A21` (default) | `#45E08F` | `#F0443A` | `#8B949E` | 10.2:1 / 4.7:1 | 31.9 / 37.8 |
  | Light card `#F4F6F8` (small inline diagrams only) | `#17914F` | `#B71C1C` | `#5B6470` | 3.7:1 / 6.1:1 | 24.6 / 25.1 |

  - **Banned:** teal-family greens (`#089981`, `#26A69A`, `#00AA95`), which sit only ΔE 7–14 from the brand teal; the Tailwind pair `#22C55E`/`#EF4444` (deutan ΔE 12.7); and amber, cyan, silver or accent-coloured candles.
  - **Why a true green:** with a teal up colour, the brand accent would read as "price up".
  - **Why dark by default:** with green and red that are true hues, the best colour-blind separation on a light surface is ΔE about 28, against about 52 on slate.
- **CD3 Validate before render, and throw.** Every price is finite and > 0. high ≥ max(open, close); low ≤ min(open, close). Constant interval. For synthetic 24/7 data, open = previous close exactly. Story checks must pass. Fictional data is seeded synthetic data labelled "Illustrative · fictional token". *Source:* CLAUDE.md; PROJECT_INSTRUCTIONS ("fictional market examples must be clearly identified").
- **CD4 One data-driven scale per chart.** Every tick, label, tag and percentage is computed from the series with the same `y()`. No hand-typed numbers. Use a log axis when max/min > 10. *Why:* the rejected linework labels were off by up to 15.6 px and its "+38.4%" matched no span of its data (C3).
- **CD5 Pixel geometry.** Wick 3 px centred on an even column. Body of odd width ≈ 0.78 × an even slot. Minimum body 3 px, anchored on the open. Integer y. No outlines on data marks. *Why:* a 3 px wick on an even column keeps 100% of its chroma; 2 px keeps 76–81% (measured E8). The geometry was swept over 1.16M candles (measured E9).
- **CD6 Face-on.** No perspective, rotate or skew on any element that shows prices. Camera moves use a float transform on the parent group; the chart's own geometry stays snapped.
- **CD7 Accessibility.** Every move is labelled with a ▲ or ▼ glyph in the direction colour plus a signed number in the ink colour (`+402%`, `−84%`). Coloured text is ≥ 24 px semibold; anything smaller goes on a solid up or down pill. Marks are ≥ 3:1 against their surface. *Why:* about 8% of men of European ancestry have red-green colour deficiency, and in mainland China, Japan and Korea red means up. *Source:* WCAG 2.2 SC 1.4.1; PubMed 22472762 (search extracts).
- **CD8 Animation.** Candles appear left to right. Only the rightmost candle forms: its open is fixed, its close moves along its stored ticks, and its high and low only expand. Never squash history to fit a spike: rescale smoothly, or cut to a log view. *Source:* CHART_SPEC 6; measured C1, E9.

## 9. Encoding and render settings (measured)

Apply in `remotion.config.ts`. Not applied yet: the config still sets `'jpeg'` frames.

```ts
Config.setVideoImageFormat('png'); // was 'jpeg' (default quality 80)
Config.setCrf(12);                 // near-lossless master for YouTube's re-encode (Remotion default 18)
Config.setX264Preset('slow');      // free: Chrome capture is the bottleneck
Config.setPixelFormat('yuv420p');  // keep
Config.setColorSpace('bt709');     // keep
```

- **EN1 PNG frames.** With the preinstalled headless shell, Remotion's shared-memory capture is unavailable ("Page.remotionCreateFramePool wasn't found"). Every frame therefore goes to x264 as a JPEG at quality 80. Measured results:
  - Flat art: 24.5% of pixels near edges were off by 3+ levels, against 2.4% with PNG. The file was 2.7× larger (N1).
  - Dark gradients: 50% perfectly flat 16×16 blocks, against 5.6% (N1).
  - After CRF 18: 35.69 dB against 40.00 dB (E1).
  - JPEG q100 still loses chroma (V-plane PSNR 40.6 against 60.8 dB).
  - Cost on flat art: 0–27% more wall time (E1: 5.8 vs 5.7 s; N3: +7%; chart test card including bundling: +27%).
- **EN2 CRF 12, preset slow.** On flat art, CRF 12 slow gave 63.6 dB with 2.4% halo pixels (lossless 4:2:0 floor: 1.2%; CRF 18: 6.9%) at about 0.28 Mbps. The slow preset took 58.9 s against 58.8 s per 600 frames. Uploading at CRF 14 instead of CRF 23 cut band length after the YouTube proxies from about 70 px to 15–39 px. CRF 10 adds almost nothing (64.8 dB) (N1, N2).
- **EN3 Keep `yuv420p` and BT.709.** YouTube asks for 4:2:0 and BT.709, and delivers 4:2:0, so 4:4:4 and 10-bit buy nothing for SDR. *Source:* support.google.com/youtube/answer/1722171 (read).
- **EN4 Do not tune the encoder.** No `-tune animation`: it flattened more blocks (26.0% against 7.9%, N1; 71.3% against 64.2%, E2). No `aq-mode=3` (no gain). Leave GOP unset: YouTube recommends a closed GOP of half the frame rate, but `--gop=15` with 2 B-frames made files 3.1× larger for 63.2 against 63.6 dB (N1). No grain or dither overlays. Fix banding in the art, not the encoder.
- **EN5 Resolution.** 1080p by default. For final long-form only, 1440p via `Config.setScale(4/3)` (+40% render time) after one A/B test: upload the same 60 s unlisted at both, then compare the codec in "Stats for nerds" and the crops. Never pass `--scale=1.3333333` on the CLI on 4.0.541: it throws "height … 1439.999964 must be an integer" (N1). The VP9-for-1440p benefit is a forum report only.
- **EN6 Supersampling is not needed** when LS3 and SL9 are followed (fringe 0 px). For reference: `--scale=2` plus an `area` downscale cut the fringe from 184 to 73, at 3.3× render time (E4).
- **EN7 Stills and thumbnails** are rendered as PNG (`npx remotion still … --image-format=png`), 1280×720, under 2 MB (CLAUDE.md).
- **EN8 Judge quality by eye, not by SSIM.** Every encode scored SSIM ≥ 0.993 even when banding was 6–12× worse than the source (N2). *Source:* Netflix CAMBI doc (read).

## 10. QA checklist (every shot: first, middle and last frame, plus every frame that shows a chart)

1. **Static scan** of scene and asset code returns 0 hits: `grep -rnE "Gradient|<pattern|feGaussianBlur|feTurbulence|feMorphology|drop-shadow|box-shadow|blur\(|mix-blend|perspective|rotateY|skewX|skewY|Math\.random|will-change" src/ --include=*.tsx --include=*.ts --exclude-dir=styleframes`. The rejected `src/styleframes/` are excluded from the scan and must never be imported.
2. **Config:** `remotion.config.ts` has `png`, CRF 12 and `slow`. `ffprobe` on the output shows h264 High, yuv420p, bt709, tv range, 1920×1080 (or 1080×1920), 30 fps.
3. **Charts:** the validator passed for this exact data. Every candle's colour matches close vs open. ▲/▼ and signed numbers are present. The header states pair, interval, unit and scale. "Illustrative · fictional token" appears on fictional data. Every on-screen number has been recomputed from the series.
4. **Greyscale:** the check composition reads as 3–5 value groups; the face clear zone is respected; Badger and sneakers have contact shadows (CV4).
5. **Silhouette and 64 px:** render each new pose in silhouette mode, scaled so the figure is 64 px tall. Identity and action read.
6. **Lines:** at 400% zoom, outlines measure 3–6 px, internal lines ≥ 2 px, coloured details ≥ 4 px (or 3 px on an even column). No seams at part joins. No shadow crosses an outline.
7. **Identity against the sheet:** ZOO's forelock, beard, open eyes with brown irises, LEFT-chest pin and outfit. Badger's LEFT-ear cap, back patch, spot IDs, collar and one teal tag. Relative scale matches the size-comparison panel.
8. **Performance:** blinks happen at scheduled frames and none fall on stressed syllables. Eyes are open between blinks. The mouth track leads the audio by 1 f, with no one-frame shapes. ZOO's body never overshoots. Holds are moving holds.
9. **Encoded output, not stills:** extract the start, middle and end frames from the final MP4 (`ffmpeg -ss T -i out.mp4 -frames:v 1 x.png`). Inspect contrast-stretched crops of flat areas and 200% crops of charts and coloured text against the PNG still. No blocks, rings or grey wicks.
10. **Text and margins:** all text ≥ 24 px; captions away from faces; faces, hands, ears and captions inside the MO18 margins.

---

## Evidence

Experiment files are in the session scratchpad `/tmp/claude-0/-home-user/d14b9cbc-8f04-5cb9-b106-b97226bf2b37/scratchpad/study/`, which may be cleared. The results are recorded here.

| ID | Experiment | Key result |
| --- | --- | --- |
| E1 | FlatboldScene rendered with JPEG q80 vs PNG frames, then H.264 CRF 18 (`exp/e1/`) | 35.69 vs 40.00 dB; near-edge pixels off by more than 8 levels 34.4% vs 9.5%; same wall time |
| E2 | 45-frame moving subject over 4 backgrounds; x264 CRF 18/28 and variants (`exp/e2/`) | Textured blocks flattened at CRF 28: 64.2 / 58.1 / 47.4 / 0.0% (dark gradient / +grain / light gradient / stepped bands) |
| E3 | Same head as flat cel, halftone, glow and gradient (`exp/e3/`) | kbps at CRF 18: 188 / 1160 / 395 / 548; SSIM at CRF 28: 0.999 / 0.982 / 0.998 / 0.995 |
| E4 | Antialiasing conflation tests (`exp/e4/`) | Clipped-shade fringe 184; with a top outline 0; `paint-order` no help; abutting-edge seam 24% darker; 2× supersampling 73 |
| E5 | 1–12 px lines through generic 4:2:0 (`exp/e5/`) | 1 px loses 50% chroma and 48% peak luma at a half-pixel offset. Superseded for colour by E8 |
| E6 | CVD simulation of candle pairs (Machado 2009, ΔE76) | Tailwind green/red collapses to 13 under deuteranopia |
| E7 | Candle colours against the house palette and both surfaces; grid search (`ad/colors.py`, `ad/search*.py`) | Teal-family greens ΔE 7–14 from the brand teal. Chosen pairs in CD2. Best possible on a light surface about 28 vs about 52 on slate |
| E8 | Bars 1–10 px at even/odd x, and horizontal bars, through **Remotion's bundled ffmpeg n7.1 with its exact `zscale … range=limited` → yuv420p chain**, lossless and CRF 12/18, decoded with zscale bilinear (`ad/e8*`) | Vertical: 1 px 18–57%; 2 px 76–81%; 3 px on an even column 100%; ≥ 4 px 100% chroma kept. Horizontal: 2 px 50–81%; 3 px about 89%; 4 px 88–100%. The pattern fits chroma sited on even columns with a [¼ ½ ¼] filter |
| E9 | Pixel geometry and spec code swept over 10,000 seeds (`ad/geom`, `ad/spec`); reference render and deuteranopia check (`ad/spec/chart.png`, `chart_deutan.png`) | 0 failures over 1.16M candles, 1.08M forming frames and 1.13M reveal frames; validator catches 9/9 injected faults; `tsc` passes with the project options |
| P1 | L\* of every approved palette colour | Values in CV4 |
| P2 | ZOO height in heads on `reference/crops/zoo_turn_front.png` | About 5.3 heads |
| M1 | Remotion 4.0.541 `spring`, `Easing` and `interpolate` measured at 30 fps (`motion/exp/springs.cjs`, `overdamp.cjs`, `minjerk.cjs`) | Numbers in MO1–MO3 |
| M2 | Kokoro line (10.54 s) mapped to Rhubarb shapes with Rhubarb timing rules, vs an RMS mouth (`motion/exp/lipsync.py`) | 5.1 changes/s, no one-frame shapes, all bilabials closed |
| M3 | 3% push-in in 5 variants, sub-pixel centroid tracking (`motion/rem`) | Float transforms smooth; rounding 73/89 frames frozen |
| M4 | 7 f blink rendered on a rig | Reads cleanly |
| N1 | Encoder sweep (CRF, preset, tune, aq, GOP, 10-bit, 4:4:4, grain, scale) with Remotion's ffmpeg; verbose Remotion render (`enc/`) | Numbers in EN1–EN5 |
| N2 | YouTube re-encode proxies (AVC 1 Mbps, VP9 0.8 Mbps, SVT-AV1 0.47 Mbps) | Upload artefacts survive the re-encode; gradients band after VP9 and AV1 |
| N3 | Render timing per 60 and 600 frames | Flat art fastest; filters and gradients 3–9× slower |
| C1 | OHLC generator and validator sweep (`charts/validate.ts`) | 10,000 seeds, 1.16M candles, 0 violations |
| C2 | Linear vs log axis over 10,000 stories | Pre-pump candles get 21.5% of the plot height on linear vs 63.5% on log |
| C3 | Audit of the three rejected style-frame charts (`audit/audit.mjs`) | Colour, label, tag and scale faults (CD1, CD4) |

### Decisions that differ from an individual study

- **Line system:** outlines everywhere, not outline-free (PROJECT_INSTRUCTIONS).
- **Wick width:** 3 px on an even column, not 2 px (E8). The earlier "2 px on an even column is lossless" result came from a different ffmpeg chroma filter, not Remotion's.
- **Candle colours:** true greens instead of the teal-family `#089981`/`#00AA95`/`#26A69A` or mint `#35E9B0`, because of the brand teal (E7).
- **Encoder:** CRF 12 + slow and no GOP change (N1), instead of CRF 16–18 + `--gop=15`.
- **Gradients:** banned outright (PROJECT_INSTRUCTIONS), rather than "small gradients allowed".

### Research limits

- WebFetch could not reach most documentation hosts in this session. YouTube Help was read via curl; MDN, Remotion, Netflix, Rhubarb and x264 were read from GitHub sources. Facts marked "(search extract)" were not read in full.
- The Exa search connector is configured but must be authorised in claude.ai connector settings before it can be used.
- No connector or MCP that does animation work itself (rigging, lip-sync) was found, so Rhubarb's rules were reimplemented.
- The permission system blocked Netflix's `vmaf`/CAMBI binary, so banding was measured with proxy metrics.

## Appendix A: reference helpers (tested in E4 and M4)

```ts
// art-kit.ts — tapered filled stroke (SL7). Pure function; deterministic per input.
type Pt = [number, number];
const r2 = (n: number) => Math.round(n * 100) / 100;
const cubic = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt => {
	const u = 1 - t;
	return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
		u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
};
const smoothThrough = (pts: Pt[]) => pts.slice(0, -1).map((p1, i) => { // Catmull-Rom -> C1 cubics
	const p0 = pts[i - 1] ?? p1, p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
	const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
	const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
	return ` C ${r2(c1[0])} ${r2(c1[1])} ${r2(c2[0])} ${r2(c2[1])} ${r2(p2[0])} ${r2(p2[1])}`;
}).join('');
/** width(t) in output px divided by the placement scale. */
export const taperedStroke = ([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], width: (t: number) => number, n = 24) => {
	const L: Pt[] = [], R: Pt[] = [];
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		const a = cubic(p0, p1, p2, p3, Math.max(0, t - 0.001)), b = cubic(p0, p1, p2, p3, Math.min(1, t + 0.001));
		const p = cubic(p0, p1, p2, p3, t);
		let nx = -(b[1] - a[1]), ny = b[0] - a[0];
		const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
		const w = width(t) / 2;
		L.push([p[0] + nx * w, p[1] + ny * w]); R.push([p[0] - nx * w, p[1] - ny * w]);
	}
	R.reverse();
	return `M ${r2(L[0][0])} ${r2(L[0][1])}${smoothThrough(L)} L ${r2(R[0][0])} ${r2(R[0][1])}${smoothThrough(R)} Z`;
};
```

```ts
// motion.ts — pure functions of frame (30 fps). Measured in M1/M4.
import {Easing, interpolate, random, spring} from 'remotion';
export const SPRINGS = {
	settle: {stiffness: 100, damping: 20}, snappy: {stiffness: 300, damping: 35}, heavy: {stiffness: 40, damping: 13},
	limb: {stiffness: 150, damping: 17}, pop: {stiffness: 200, damping: 14},
} as const;
export const minJerk = (t: number) => t * t * t * (t * (6 * t - 15) + 10);
export const follow = (frame: number, fps: number, key: number, lag: number, cfg = SPRINGS.settle) =>
	spring({frame: frame - key - lag, fps, config: cfg});
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
export const blink = (t: number) => interpolate(t, [0, 2, 3, 7], [0, 1, 1, 0],
	{...clamp, easing: [Easing.in(Easing.quad), Easing.linear, Easing.out(Easing.quad)]});
export const longBlink = (t: number) => interpolate(t, [0, 4, 10, 18], [0, 1, 1, 0],
	{...clamp, easing: [Easing.inOut(Easing.sin), Easing.linear, Easing.inOut(Easing.sin)]});
export const blinkStarts = (seed: string, total: number, minGap = 45, maxGap = 150) => {
	const out: number[] = [];
	let f = Math.round(20 + random(`${seed}-0`) * 40), i = 1;
	while (f < total) { out.push(f); f += Math.round(minGap + random(`${seed}-${i++}`) * (maxGap - minGap)); }
	return out; // merge with forced blinks at head turns > 30° and phrase-end pauses >= 11 f
};
export const breathRest = (frame: number, fps: number, periodS = 4.2) => { // 0..1, scale to 2-4 px
	const p = ((frame / fps) % periodS) / periodS;
	return p < 0.4 ? Easing.inOut(Easing.sin)(p / 0.4) : 1 - Easing.inOut(Easing.sin)((p - 0.4) / 0.6);
};
export const accent = (frame: number, onsets: number[], deg = 1.5) =>
	Math.min(1, onsets.reduce((v, o) => v + interpolate(frame - o, [-3, 0, 9], [0, 1, 0],
		{...clamp, easing: [Easing.out(Easing.quad), Easing.inOut(Easing.sin)]}), 0)) * deg;
```
