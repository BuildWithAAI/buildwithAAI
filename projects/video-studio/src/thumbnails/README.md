# Thumbnails (episode engine)

Three 1280×720 PNG thumbnails per episode and language, built for YouTube **Test & Compare** (up to 3 thumbnails; the
winner is picked by watch time; anything under 1280×720 drops every variant to 854×480 — `docs/research/dubbing-and-regions-2026-11-24.md` §1.10).

## Commands

```bash
# render v0, v1, v2 and check them (size, contrast, legibility at 168x94 and 320x180)
node scripts/thumbnails.ts zoora-ai/<slug> --lang en
node scripts/thumbnails.ts zoora-ai/<slug> --lang es,pt-br     # several languages, one bundle
node scripts/thumbnails.ts zoora-ai/<slug> --lang all          # every language that has a storyboard file
node scripts/thumbnails.ts _dev/thumb-demo --lang all          # the dev fixtures in src/thumbnails/dev/fixtures

# one variant through the Remotion CLI (no checks)
npx remotion still src/episode/index.ts Thumbnail out/x.png --image-format=png \
  --props='{"channel":"zoora-ai","slug":"<slug>","lang":"en","variant":0}'

# unit tests
node --test src/thumbnails/test/thumbnails.test.ts
```

Node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning for any `.ts` script in this repo; add
`--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` to silence it.

Output: `out/thumbnails/<slug>/<lang>/v0.png … v2.png`, `check/` (each variant at 320×180 and 168×94, plus `sheet.png`:
640×360, 320×180, 168×94 at 1:1 and 168×94 enlarged ×3) and `report.json`. `--out <dir>` replaces `out/thumbnails/<slug>`.

**Claim gate first (2026-11-24).** For a real channel, `scripts/thumbnails.ts` renders a language only when the claim
gate has passed on the current text: `out/claims/<slug>.<lang>.json` exists, says `pass` with 0 errors, names this
channel/slug/lang, and was written after the last change to that storyboard, `storyboard.json` (for a translation) and
`research.md` (`src/episode/node/claimGate.ts`). Otherwise it prints why and the command to run
(`node scripts/claims/check.ts content/<channel>/<slug> [--lang <lang>]`), renders nothing for that language and exits 1.
Thumbnail text is part of what the gate checks. Dev fixtures (`_dev`) are exempt.

## Storyboard fields

`storyboard.json` (the master, English) carries the A/B set; each translation carries only the text:

```json
"thumbnails": [
  {"id": "a", "text": "TOP CALLER?", "expression": "neutral", "badger": true},
  {"id": "b", "text": "THE FLOOR VANISHED", "expression": "worried", "badger": true},
  {"id": "c", "text": "WHO SOLD FIRST", "expression": "shocked", "badger": false}
]
```

`storyboard.es.json`: `"thumbnails": [{"id": "a", "text": "¿EL MEJOR CALLER?"}, …]` (matched by `id`). Expression and
Badger always come from the master, so every language tests the same design. A missing translated text fails the render:
English text never appears in another language's thumbnail.

Contract additions (thumbnail builder, 2026-11-24, all optional; also recorded in `src/episode/types.ts`):

- `thumbnails[].badgerReaction`: `neutral | happy | worried | shocked | judge`. Badger's face when `badger` is true.
  Default: `worried` when Zoo is worried, otherwise `judge` (his quietly judging look).
- A newline in `text` is the writer's line break (at most 3 lines), e.g. `"顶级\n喊单人？"`. Use it for zh/ja, where
  the layout cannot know word boundaries, and wherever the automatic break reads badly.
- Composition prop `variant` also accepts the entry id (`"a"`), as well as 0|1|2.

## Text rules (checked before anything is drawn)

- 4 words or fewer; zh/ja: 10 characters or fewer (a Latin or digit run counts as one).
- No emoji, no arrows (Unicode arrows or `->`), no `!!`, `??` or `?!`.
- Nothing that implies profit: no currency signs, multipliers (`100x`), percentages or signed figures, and none of the
  core return/income terms from `docs/research/platform-facts-2026-11-23.md` (en, es, pt-br, it, hi, zh lists in
  `spec.ts`). Ambiguous words (`safe`, `early`, `free`) are warnings. The claim checker stays the full gate.
- Latin scripts are set in capitals (Anton); hi/zh/ja use Noto Sans Devanagari/SC/JP Black after the brand stack.

## The three variants

| | v0 `light-right` | v1 `dark-left` | v2 `plate-tight` |
| --- | --- | --- | --- |
| Background | flat `#E6E8EB` | brand slate `#161A21`, Zoo in a light-grey window | flat `#E6E8EB` |
| Zoo | right, scale 2.5, looks at the text | left, scale 2.4, looks at the text | right, scale 3.1 (tightest), 3° head tilt |
| Headline | near-black, left column | off-white, right column | off-white in a slate plate bleeding off the left edge |
| Teal accent | bar under the text | bar over the text | side bar inside the plate |

With `badger: true` the scale drops to 2.15–2.2 and Badger's head sits in front of Zoo's chest at the **same scale**
(their relative size stays exact). That puts his off-white head on Zoo's dark overshirt (ART_GUIDE CV4a: ≥ 15 L\* darker
than the coat) while Zoo's torso stays on light grey (CV4b), in every layout. The headline is fitted to its box with the
real glyph metrics: every line break is tried and the biggest legible size wins, with a mild penalty for a very short
line. Sizes: Latin 96–180 px, hi 96–170 px, zh/ja 104–180 px. Text that does not fit at the floor fails the render.

An unreviewed translation (`translation.status` not `native-reviewed`) gets an owner-facing
"MACHINE TRANSLATION · needs native review" badge in the corner: do not upload it until a native speaker has checked it.
Localized thumbnails are a manual Studio step for long-form videos (no API); add them only after the Test & Compare run
on the default thumbnail has ended, because changing a thumbnail stops a running test (`docs/research/dubbing-and-regions-2026-11-24.md` §1.7, §1.10).

## Checks (scripts/thumbnails.ts, exit 1 on failure)

- PNG opaque, 1280×720, under 2,000,000 bytes (YouTube's mobile limit; desktop allows more).
- Headline contrast measured on the rendered pixels ≥ 4.5:1 (WCAG); designed pairs are 15.9:1 and 16.1:1.
- At 320×180 and 168×94 (area downscale) the stroke cores still reach ≥ 4.5:1 and the letters stay ≥ 14 px / ≥ 8 px tall.
- Headline and plate clear of every head (hair and ears included); no headline or face under the duration stamp
  (bottom right); no foreign colour inside the headline block.

## Files

`spec.ts` (types, text rules, master/translation resolution), `layout.ts` (the three layouts, rig boxes, safe zones),
`fit.ts` (headline fit), `compose.ts` (final geometry, logged during renders for the script), `measure.ts` (canvas ink
metrics), `contrast.ts` (WCAG), `Thumbnail.tsx` + `compositions.tsx` (the still), `load.ts` (storyboards via
`require.context`), `node/png.ts` (PNG codec and downscaler for the script), `dev/fixtures/` (temporary storyboards:
`thumb-demo` in en/es/pt-br/hi/it/zh/ja, `thumb-demo-alt` with the opposite Badger flags), `dev/probe/` (measures the rig boxes
behind `RIG` in `layout.ts` and prints them on the image; re-run after a character change:
`npx remotion still src/thumbnails/dev/probe/index.ts ThumbProbe out/thumbnails/_probe.png --props='{"expression":"shocked"}'`).

## Known limits

- ART_GUIDE CV4c asks for a clear zone of one head-width around a face. A close-up face plus readable text cannot fit
  that in 1280×720, so thumbnails keep ≥ 72 px between the text box and the head box (hair included) instead.
- Zoo's outlines scale with the close-up (about 8–11 px), like a camera push-in; the 3–6 px rule is for placement scale.
- Rig boxes in `layout.ts` were measured on the v1.0.0 rigs; a rig change needs a probe re-run.
- Machine translations in the fixtures were written by an agent and are marked as such; they are test data, not copy.
