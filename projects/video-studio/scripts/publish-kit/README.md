# Publish kit: one video in, every platform out

One episode's `episode.json` in; out comes everything needed to publish it on YouTube, Shorts, TikTok,
Instagram Reels, Instagram and X. That includes post text with tracked links and disclosures, captions,
the render plan (long-form, Shorts, thumbnails, loudness), a checklist and `kit.json`.

The kit makes no network calls and uploads nothing. It never runs a render. It writes the commands, and you
run them.

```sh
cd projects/video-studio
node scripts/publish-kit/cli.ts zoora-ai/_example          # writes out/publish/zoora-ai/_example/
node --test scripts/publish-kit/*.test.ts                   # tests
npx tsc --noEmit -p scripts/publish-kit/tsconfig.json       # strict typecheck (erasable TS only)
```

| Option | Meaning |
| --- | --- |
| `--youtube-id <id>` | The video's id once uploaded. X posts then link the video, and `kit.json` carries the id for the newsletter and dashboard |
| `--offers <file>` | Offer registry. Default: `../creator-hub/config/offers.json`, else `offers.example.json` (placeholders, all inactive) |
| `--captions <file>`, `--timeline <file>` | Override the episode folder's `captions.json` and the voice step's `timeline.json` |
| `--hub <url>` | Hub origin. Default: `$HUB_BASE_URL`, else `https://go.zoora.ai` |
| `--out <dir>` | Output folder. Default: `out/publish/<channel>/<slug>/` (gitignored) |

Exit codes:

- `0`: every check passes.
- `1`: the kit was written but at least one check fails. `checklist.md` lists the failures first.
- `2`: bad input. Nothing is written, and every problem is listed.

The fictional example exits `1` until `creator-hub/config/offers.json` holds an active `hardware-wallet` offer.
That failure is correct: placeholder links must not be published.

## Inputs

`content/<channel>/<slug>/episode.json` (`EpisodeFile` in `types.ts`):

| Field | Required | Meaning and rules |
| --- | --- | --- |
| `version` | yes | `1` |
| `channel`, `slug` | yes | Must match the folder. Lowercase `a-z`, `0-9`, `-`; a leading `_` marks examples |
| `lang` | no | Default `en` |
| `titleOptions` | yes | 1–5 titles, each ≤ 100 characters, no `<` `>` |
| `title` | no | The chosen title; must be one of `titleOptions` (default: the first) |
| `summary` | yes | 1–3 sentences, ≤ 600 characters (also the newsletter teaser) |
| `youtubeVideoId` | no | 11-character id, or null until uploaded |
| `scenes` | yes | `{id, chapter?, durationSec?, start?, offers?}` in video order. A scene with `chapter` starts a YouTube chapter; scenes without one continue the chapter before them. Times come from `start` (seconds or `"1:05"`) or the previous scene's `durationSec`, and the last scene needs `durationSec`. `offers` lists the offer ids the scene mentions or shows, so the kit can check the spoken disclosure and carry it into the Shorts made from that scene |
| `sources` | no | `{title, url}` (http/https), listed in the description |
| `offers` | no | Offer ids from the registry. Names, links and disclosures all come from the registry |
| `hashtags` | no | ≤ 10 single words, with or without `#`. YouTube uses the first 3, X 2, TikTok and Instagram 5 |
| `tags` | no | YouTube tags; ≤ 500 characters by YouTube's count (commas count, and so do the quotes around tags with spaces) |
| `cta` | yes | One line, e.g. "Subscribe for the next scam breakdown." |
| `disclosures` | no | Extra lines shown in the description and the checklist, e.g. "Fictional story: …" |
| `madeForKids` | no | `{value, reason}`. Default `false` with the studio reason: adult crypto and AI security content. Set on every video (COPPA) |
| `containsSyntheticMedia` | no | `{value, reason}`. Default `false`: clearly animated content with a generic synthetic voice for a fictional host needs no YouTube AI label (facts doc 2026-11-23, Help 14328491). Set `true` for photorealistic AI images or video, AI-altered real footage, or a voice resembling a real person |
| `paidPromotion` | no | `{value: true, reason}` for a material connection that has no offer (e.g. a free product). It cannot be `false` while the episode has offers |
| `shortCuts` | yes | ≥ 1 `{id?, from, to, title, hook?}`: an inclusive scene range per vertical Short. `title` ≤ 100 characters. `id` is the engine's `shortId` (default `short-<n>`) |
| `render` | no | `{entry, composition, shortComposition?, thumbnailComposition, thumbnails?}`. Defaults: `src/episode/index.ts`, `Episode`, none, `Thumbnail`, 3. Thumbnail text and art come from the storyboard (or your own composition), not from this file |

Optional companions:

- `content/<channel>/<slug>/captions.json`: Remotion `Caption[]` (`text` with its leading space, `startMs`,
  `endMs`, `timestampMs`, `confidence`, optional `pageBreakAfter`).
- `content/<channel>/channel.json`: `displayName` and `handle`, used in the safety line, "Full episode on YouTube" and
  the checklist's "switch to <channel> before uploading" step.
- `public/generated/<channel>/<slug>/<lang>/timeline.json`: the voice step's measured scene times. When it
  covers every scene, it replaces the `episode.json` durations. Mock (silent-preview) timelines are ignored.

## Outputs: `out/publish/<channel>/<slug>/`

| File | Content |
| --- | --- |
| `kit.json` | Exactly the `PublishKit` contract (`creator-hub/src/types.ts`), read by the newsletter and the dashboard |
| `youtube-description.txt` | Disclosure first, then summary, CTA, offer links each followed by its disclosure, chapters, sources, safety line and 3 hashtags |
| `pinned-comment.txt` | Disclosure, the offer links with disclosures, and the anti-impersonation line |
| `shorts-<n>.txt` | Each Short's title and description. There are no links, because Shorts descriptions are not clickable |
| `tiktok.txt`, `reels.txt`, `x.txt` | One caption or post per clip (`media/short-<n>.mp4`). The `===` lines are labels |
| `instagram.txt` | Feed post for the episode |
| `captions.srt`, `captions.vtt` | When `captions.json` exists: cues of ≤ 2 lines × 42 characters and ≤ 7 s |
| `render-plan.sh` | Render commands plus the loudness step (see below) |
| `checklist.md` | Failing checks first, then each manual step in upload order, the offers and every check |

In `kit.json`, `posts.<platform>` holds clip 1 for the clip platforms. Its `notes` name the per-clip files.
`charCount` uses the platform's own unit:

- YouTube: UTF-8 bytes.
- X: weighted characters.
- TikTok and Instagram: UTF-16 code units.

`captions.srt` and `captions.vtt` hold the full file text (or null). `renders[].output` paths are relative to
`projects/video-studio`. `settings.reasons` gives the reason for `madeForKids`, `containsSyntheticMedia` and
`paidPromotion`, in that order.

`disclosures` holds only self-contained lines that stay true wherever they are reused (the newsletter and the
article leave region-restricted offers out): the general line for the offers shown everywhere, each of their
disclosures, the episode's own lines and "Education only, not financial advice." The region-filtered page line and
its disclosure appear only in the description and pinned comment. A restricted offer's disclosure stays in
`offers[]`, for the hub page.

## Rules applied

- **Links.** Every offer link has the form `${HUB_BASE_URL || 'https://go.zoora.ai'}/go/<offerId>?v=<slug>&s=<source>`,
  where `s` is the hub's `Source` value: YouTube `yt`, X `x`, and so on. Registry destination URLs never
  appear in any output. TikTok, Reels and Instagram captions say `Link in bio: <hub host>`. The hub's `/` page
  is the bio link, and it is region-filtered. The checklist gives the bio URLs (`/?s=tiktok`, `/?s=reels`).
- **Disclosures (FTC 16 CFR 255).** With any offer:
  - The YouTube description and the pinned comment open with a disclosure line.
  - Each link's registry disclosure sits on the next line.
  - Exchange offers whose disclosure omits risk get the hub's risk line.
  - A clip carries an offer's disclosure in every platform's caption when one of its scenes promotes the offer,
    or when its title, hook or hashtags name it.
  - The Instagram feed caption opens, above Instagram's "more" fold, with a disclosure of the bio links
    ("Disclosure: some links in my bio are affiliate links. ..."), plus the disclosure of any offer the title or
    summary names.
  - The registry disclosure must name the relationship (affiliate, referral, sponsored or paid; for an own
    product, that it is yours) and the benefit (earn, commission, fee, paid...). The kit prints it word for word,
    so a registry that breaks this rule, or carries a claim in an offer's name, disclosure or `restrictedReason`,
    is refused (exit 2).
  - `spoken-disclosure` reads each promoting scene's narration in `captions.json`. It accepts the registry
    sentence read out, or a phrase that states the relationship ("this is an affiliate link", "I may earn a
    commission", "sponsored by", and for own products "I built this", "my own product"). A phrase after a
    negation in the same clause ("this is not sponsored", "no affiliate deal") does not count. It recognises
    English wording only.

  The checklist then covers the parts the kit cannot do for you:
  - Say the disclosure out loud and show it on screen in the video itself.
  - Tick YouTube's paid-promotion box. `settings.paidPromotion` is true with the reason.
  - Use TikTok's content disclosure setting, and Instagram's Paid partnership label where it applies.
- **Region-restricted offers.** These are offers with blocked or allow-listed countries, or with
  `unknownCountry: "block"`. They are never named (case-insensitive, whole words, `Demo Exchange` also matches
  `demo-exchange` and `#DemoExchange`) in post text, titles, Short titles and hooks, chapters, tags or the
  narration, because all of them are seen in every country. They are reachable only through the hub's
  region-filtered page. A scene that promotes one fails the `restricted-offers` check, because a video is visible
  in every country too. Memecoin launchpads are refused as offers.
- **Claims.** `income-claims` lints every title, Short title and hook, chapter, tag, post and the full narration
  (`captions.json`), with the rules in `lint.ts`: guarantees, earnings figures in any currency or coin, percentage
  returns and APY, price predictions ("could hit $500", "BTC to $250k by December"), "can't lose", "turn $100
  into...", "100% safe", sign-up and deposit bonuses, and buy calls. A narration hit names its scene.
- **Audience.** Both channels are for adults (`docs/PROJECT_INSTRUCTIONS.md`), so `madeForKids: true` fails the
  `made-for-kids` check. YouTube would also turn off comments, cards and end screens, so the pinned comment could
  not be posted.

### Platform limits

Checked 2026-11-24, sources in `limits.ts`. Most official pages are blocked from this session, so most
limits come from search-index extracts. Re-check them in a browser.

| Platform | Limits used |
| --- | --- |
| YouTube | Title ≤ 100 characters. Description ≤ 5,000 bytes. No `<` or `>`. Tags ≤ 500 characters. More than 60 hashtags makes YouTube ignore all of them. Chapters start at 00:00, need at least 3, each ≥ 10 s |
| Shorts | ≤ 3:00. Description links are not clickable, so set the Related video |
| X | 280 weighted characters (twitter-text v3: every URL counts 23, emoji and CJK count 2). Videos ≤ 2:20 without Premium |
| Instagram and Reels | Captions ≤ 2,200 characters. **5 hashtags**, the cap Instagram announced in December 2025; Meta's API reference still says 30. Reels ≤ 3:00 |

The X count never comes out lower than X's own, so a post that passes `x-post` fits. URLs with a well-known TLD
(`com`, `ai`, `be`, `cash`, `link`, `us`... see `KNOWN_TLDS` in `limits.ts`) count exactly 23, with or without
`https://`. A URL ends where X ends it, so an emoji, `…`, `»` or CJK text glued to it counts as text. Anything else
shaped like a domain (`Node.js`, a Unicode TLD) counts as the most X could make of it, so it may count a little
more than X. A table of strings with their twitter-text 3.1.0 counts in `limits.test.ts` keeps this checked; a
fuzz run of 120,000 mixed strings against twitter-text 3.1.0 on 2026-11-24 found no under-count.

Hashtags are counted as twitter-text finds them: `#` or `＃` not glued to a letter, digit, `_` or `&`, with at
least one letter (`scams:#airdrop` counts, `#1` does not), and none inside URLs.
| TikTok | Captions ≤ 2,200 UTF-16 units, the Content Posting API limit (the app allows 4,000). Captions have no clickable links. Its Branded Content Policy prohibits paid promotion of financial services, including crypto |

### Checks in `kit.json`

| Area | Checks |
| --- | --- |
| Platform limits | `youtube-title`, `youtube-description`, `youtube-tags`, `shorts-text`, `tiktok-caption`, `reels-caption`, `instagram-caption`, `x-post`, `hashtags` |
| Timing | `chapters`, `short-durations`, `x-video-length` |
| Disclosures | `disclosures` (description, pinned comment, every clip that promotes or names an offer, Instagram), `spoken-disclosure` (from captions, per promoting scene; negations do not count) |
| Text | `income-claims` (lint list in `lint.ts`; metadata, posts and narration), `placeholders` |
| Links and offers | `links-via-hub` (no raw affiliate URLs), `restricted-offers` (never named anywhere seen worldwide), `offers-live` |
| Settings and captions | `made-for-kids` (fails when true), `synthetic-media`, `captions` |

## Render plan

`bash out/publish/<channel>/<slug>/render-plan.sh [all|long|shorts|thumbnails|loudnorm <file>...]` writes to
`out/publish/<channel>/<slug>/media/`.

- **Long-form.** `npx remotion render <entry> <composition>`, 16:9.
- **Shorts.** 9:16, re-composed rather than cropped. By default each Short has its own composition,
  `<composition>-Short-<n>`. The episode engine (`src/episode`) instead registers one `EpisodeShort`
  composition that picks the Short by its `shortId` prop. Set `render.shortComposition: "EpisodeShort"` for
  engine episodes, as the example does.
- **Thumbnails.** Engine episodes use the thumbnail builder:
  `node scripts/thumbnails.ts <channel>/<slug> --lang <lang> --out …/media/thumbnails` renders `v0`–`v2`
  (1280×720 PNG for Test & Compare). It fails on size, contrast or legibility problems. Other entry points get one
  `npx remotion still <entry> <thumbnailComposition> --image-format=png` per variant, with `props.variant` 0–2.
- **Loudness.** Two-pass ffmpeg `loudnorm` to −14 LUFS integrated, −1 dBTP true peak and LRA 11, in place,
  with AAC 192k at 48 kHz. YouTube publishes no loudness target; −14 LUFS is community practice.
  - The function was tested here on synthetic tones. A level-varying signal took the linear path:
    −33.8 → −14.2 LUFS, true peak −8.3 dBTP.
  - Pass 2 falls back to dynamic mode when the input's loudness range exceeds 11 LU, or is exactly 0
    (a steady test tone).
- **Guard.** For the engine entry, the script stops before rendering if `content/<channel>/<slug>/storyboard.json`
  is missing. The fictional example has none, so it never renders.

## Not covered yet

- Short-only episodes (channel 2's daily Shorts) are not modelled: every episode has a long-form render.
- No per-Short caption files are cut. Shorts use YouTube's auto-captions or burned-in captions.
- No uploads and no API calls. YouTube upload settings (`selfDeclaredMadeForKids`, `containsSyntheticMedia`)
  come from `kit.json` when an uploader exists.
- `spoken-disclosure` and the claim rules recognise English only. A dubbed episode's captions fail the spoken
  check until someone confirms the disclosure by ear.
- `lint.ts` imports nothing, so other tools can share it. creator-hub's newsletter lint and the hub's own registry
  check still keep their own, older rules.
