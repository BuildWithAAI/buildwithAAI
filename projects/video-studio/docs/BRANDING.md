# Channel branding kit: Zoora AI and the security channel

Built 2026-11-24. Everything is drawn in code from the approved character rigs (`src/characters`, unchanged) and the binding palette. It uses no stock art, no AI-generated imagery and no third-party marks.

- Source: `src/branding/` (its own Remotion entry, `src/branding/index.ts`).
- Final files: `public/brand/`.
- Copy: `content/zoora-ai/channel-copy.md` and `content/zoora-security/channel-copy.md`.

## 1. What is in the kit

| File | Size | Goes to (YouTube Studio) |
| --- | --- | --- |
| `public/brand/<channel>/banner-2560x1440.png` | 2560x1440, ~0.2 MB | Customization > Profile > Banner image |
| `public/brand/<channel>/avatar-800.png` | 800x800, under 0.1 MB | Customization > Profile > Picture |
| `public/brand/<channel>/watermark-150.png` | 150x150, transparent corners, ~15 KB | Customization > Profile > Video watermark |
| `public/brand/<channel>/endscreen-1920x1080.png` | 1920x1080 frame | The last 20 s of a video you edit outside the pipeline |
| `public/brand/<channel>/badges/<series>-dark.png` / `-light.png` | 88 px tall, transparent | Thumbnails (top-left corner) |
| `out/brand/<channel>/sting-4s.mp4` (not committed; re-render) | 4.0 s, 1920x1080, 30 fps, silent AAC track | Episode intros |
| `out/brand/<channel>/endscreen-20s.mp4` (not committed) | 20.0 s moving hold | The last 20 s of the trailer and of hand-edited videos |

`<channel>` is `zoora-ai` or `zoora-security` (the security channel's working slug).

The badges per channel:

| Channel | Badges |
| --- | --- |
| Zoora AI | `pov` |
| Security channel | `rekt-meter`, `red-flag` (Badger's Red Flag), `one-fix` (Zoo's One Fix), `scam-of-the-week`, `what-we-know`, `developing`, `weekly-roundup` |

Alternates (for comparison only, in `out/brand/alt/`):
- the security avatar on teal;
- the security avatar with Zoo's head;
- 600 px watermark masters.

### The two looks

**Zoora AI**:
- The jellyfish brand: silver line art on near-black.
- The mark is a dome with a scalloped rim and a highlight line, and three tentacles drawn as circuit traces ending in ring nodes. It is the same creature as Zoo's teal pin ("a small dome with three short tentacles"), and it keeps the existing avatar's silver line art and circuit nodes, flat with no gradient.
- Zoo and Badger stand in a light porthole: Zoo's clothes need a light area behind them (ART_GUIDE CV4b).

**The Zoo & Badger Show**:
- The light talk-show set, a slate logo plate, and the teal ampersand as the single accent.
- On the banner, Zoo stands behind the show desk and Badger sits beside him on a seat the desk hides. That puts both faces in the 423 px safe band at a readable size.
- A slate studio monitor sits behind Badger's head, so his white coat reads (CV4a).

**Both**:
- Flat fills, near-black outlines and one radius scale. No gradients, glows, blurs or opacity tints (ART_GUIDE P1).
- The host's name is always "Zoo", never "ZOO". No asset uses uppercase styling on text that contains it.

## 2. YouTube Studio setup, step by step (owner)

Do this per channel, signed in to the right channel (studio.youtube.com, channel switcher at the top right). Steps follow YouTube Help as read on 2026-11-24 (answers 10456525, 2657964, 3219384, 6388789).

### A. Profile (Customization > Profile)

1. **Picture.** Click Change and upload `avatar-800.png`. Keep the crop at the full square: the artwork is already framed for the circle. Click Done, then Publish. It can take a few minutes to update everywhere.
2. **Banner image.** Click Change and upload `banner-2560x1440.png`. In the preview, do not move the crop: all text and faces are already inside the 1546x423 safe area. Check the TV, desktop and mobile previews, click Done, then Publish.
3. **Video watermark.** Click Change and upload `watermark-150.png`.
   - For display time, choose **Entire video**.
   - Not "End of video": that shows it only in the last 15 s, and YouTube hides watermarks during end screens, which cover our last 20 s. It would never be seen.
   - Watermarks do not show on videos set as made for kids.
4. **Name and handle.**
   - Zoora AI: unchanged.
   - Security channel: pick the name from the options in `content/zoora-security/channel-copy.md`. A name can be changed twice in 14 days, and a change removes a verification badge.
5. **Description.** Paste the `description` block from the channel's `channel-copy.md`. For Zoora AI this replaces the old forex "trading robot" text. That must happen before the first upload.
6. **Links and contact.** Add only domains the owner controls (up to 14 links; the first shows next to Subscribe). Contact email is optional.
7. Click **Publish**.

### B. Channel settings (Settings > Channel)

8. **Basic info.**
   - Keywords: type the lines from the `keywords` block, one per line.
   - Country: United States.
9. **Advanced settings.** Audience: **No, set this channel as not made for kids** (CLAUDE.md default; animated characters are a child-directed factor, so declare it).
10. **Upload defaults** (Settings > Upload defaults), suggested:

    | Field | Zoora AI | Security channel |
    | --- | --- | --- |
    | Category | Film & Animation | Science & Technology |
    | Altered or synthetic content | No | No |

    Synthetic content is "No" for both because the videos are clearly animated and narrated by a generic TTS voice (platform-facts, AI label). Set it to **Yes** for any video in which a real person appears to say or do something.

### C. Playlists (Content > Playlists > New playlist)

11. Create each playlist from the `playlists` block: title, description, visibility Public. Order as listed (Playlist settings > Ordering).
12. Make "Start Here" the first playlist. Add the trailer to it once it is uploaded.

### D. Home tab (Customization > Home tab)

13. **Channel trailer.** Add section > Channel trailer, then select the uploaded trailer.
    - Viewers who are not subscribed see it once.
    - It shows no ads unless it holds third-party claimed content.
14. **Spotlight for returning subscribers.** Add section > Spotlight, then choose the latest flagship episode.
15. **Sections.**
    - Zoora AI order: Start Here, POV Stories, POV Shorts, then the topic playlists.
    - Security order: Start Here, What We Know, Weekly Roundup, then the segment playlists.
    - Up to 12 sections.
16. Click **Publish**, then open the channel on a phone, a desktop browser and a TV app and look at the banner and avatar there.

### E. End screens (per video: Content > the video > Editor > End screen)

The pipeline's end screen and this kit's template share one layout. Place the elements on the drawn zones (1920x1080 frame; percentages for Studio's grid):

| Element | Zone (px) | As % of the frame |
| --- | --- | --- |
| Video (most recent or best for viewer) | x 1088-1824, y 150-564 | left 56.7%, top 13.9%, width 38.3% |
| Video or playlist | x 1088-1824, y 594-1008 | left 56.7%, top 55.0%, width 38.3% |
| Subscribe | circle at (900, 540), radius 120 | centre 46.9% / 50.0% |

After the first video, use **Import from video** to copy this layout to every later upload. YouTube shows end screens in the last 5-20 s of videos of 25 s or more, never on made-for-kids videos or mobile web. YouTube may move elements on some devices. The zones are drawn as finished frames, so the video still looks complete where elements do not show.

### F. Translations (later)

17. Customization > Profile > Add language. Paste the `description-es` / `description-pt-br` drafts only after the back-translation check and a native speaker's review.

## 3. The intro stings and the jingle hook

The stings ship **silent** with an empty AAC track, so they concatenate cleanly. The audio workflow supplies the jingle.

- **Plug in a jingle:**
  ```bash
  npx remotion render src/branding/index.ts ZooraSting out/brand/zoora-ai/sting.mp4 --props='{"jingle":"audio/zoora-ai/sting.wav"}'
  ```
  `jingle` is a path under `public/`. Optional props:
  - `jingleOffsetSec` (negative skips a lead-in);
  - `jingleVolume` (0-1; default 1, because the jingle should arrive mastered).
- **Duration:** follows the jingle, clamped to 3-5 s (`calculateMetadata`). Only the final hold stretches, so the visual hits stay put.
- **Hits to score to** (30 fps; also exported as `STING_HITS` from `src/branding/kit.ts`):

  | Sting | Frame | Time | What happens |
  | --- | --- | --- | --- |
  | `ZooraSting` | 54 | 1.80 s | The nodes pop and the teal accent lands (the logo hit) |
  | `ShowSting` | 30 | 1.00 s | The ampersand turns teal; Zoo turns to camera |
  | `ShowSting` | 58 | 1.93 s | Badger's judging look (the button) |

  The Zoora sting fades to black over its last 15 frames. The show sting ends on a hard cut into the episode.
- **In an episode:** import `ZooraSting` / `ShowSting` from `src/branding/kit.ts` and play them in a `<Sequence>`. That stays vector and avoids a second encode.

## 4. Re-render and check

Run from `projects/video-studio/`:

```bash
node src/branding/render.ts                  # every asset (~4 min), then the QA run
node src/branding/render.ts --only=banner    # a subset; --skip-video for stills only; --no-qa to skip checks
node src/branding/qa/run.ts                  # QA only: report + previews in out/brand/qa/
node src/branding/tests/run.ts               # unit tests (pure modules, no browser)
npx tsc --noEmit                             # typecheck
```

Prefix the `node` commands with `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` to silence Node's module warning.

### What QA checks automatically (`src/branding/qa/run.ts`)

The run on 2026-11-24 passed 115 of 115 checks.

- **Banners:**
  - exact size; file size at most 6 MB; fully opaque;
  - all key content (logo, tagline, both heads) inside the 1546x423 safe area with a 12 px margin, measured on a rendered key-only layer, not assumed.
- **Avatars:**
  - size, file size and opacity;
  - the mark stays within 86% of the circle's radius;
  - mark contrast at 98, 48 and 36 px: 10.1:1, 9.1:1 and 7.7:1 (WCAG non-text contrast asks 3:1);
  - Badger at 98 px: dark ear L* 15.7 against the ground's 82.6, face 96.8 against 82.6, head within the circle.
- **Watermarks:** 150x150, under 1 MB, transparent corners.
- **End-screen frames:** size and opacity.
- **Badges:** 88 px tall, transparent corners, trimmed widths.
- **Videos (ffprobe):**
  - H.264 High, 1920x1080, 30 fps, yuv420p, BT.709;
  - 3-5 s for stings and up to 20 s for end screens;
  - audio track present and silent (-91 dB).
- **Drift guards:**
  - the rigs' head boxes are re-measured against the constants the layouts use;
  - the wordmark's ink width (4.41 em) is re-measured against the value the sting's centring uses.

The previews (`out/brand/qa/previews/`) show:
- each banner at TV, desktop (1284 px), tablet (800 px), phone (390 px) and phone at 3x;
- each avatar at 160, 98, 48, 36 and 24 px on light and dark UI;
- each watermark over a video frame at 48 and 64 px.

Every one was looked at; the changes they forced are listed in section 7.

## 5. Specs used (verified 2026-11-24)

| Item | Value | Source |
| --- | --- | --- |
| Banner | Minimum 2048x1152 (16:9); safe area 1235x338 at that size; 2560x1440 recommended; at most 6 MB; no borders, shadows or frames | support.google.com/youtube/answer/10456525 (read) |
| Banner safe area at 2560x1440 | 1546x423, centred (1235x338 x1.25 = 1543.75x422.5, rounded by YouTube's template) | Derived from the above |
| Device crops | TV 2560x1440, desktop 2560x423, tablet 1855x423, phone 1546x423 | Secondary guides only: not on the current Help pages. Used as design checks; the binding rule is the safe area |
| Profile picture | JPG, GIF (not animated), BMP or PNG; at most 15 MB; renders at 98x98 | answer/10456525 (read) |
| Watermark | At least 150x150, square, under 1 MB; "End of video" = last 15 s; not on made-for-kids videos | answer/10456525 (read) |
| End screens | Last 5-20 s; video at least 25 s; up to 4 elements; watermarks suppressed during them; custom images at least 300x300 | answer/6388789 (read) |
| Channel trailer, sections | Trailer for non-subscribers, no ads unless claimed content; Spotlight for returning subscribers; up to 12 sections | answer/3219384 (read) |
| Description, keywords, title | Description at most 1,000 characters; keywords at most 500 characters in total (space-separated, quoted phrases); API title at most 30 characters | developers.google.com/youtube/v3/docs/channels (read) |
| Profile links | Up to 14; the first shows next to Subscribe | answer/2657964 (read) |

## 6. Licences

| Asset | Licence | Where the text is |
| --- | --- | --- |
| Montserrat 700-900 (@fontsource/montserrat 5.3.0) | SIL OFL 1.1 | `node_modules/@fontsource/montserrat/LICENSE` |
| Inter 600-800 (@fontsource/inter 5.3.0) | SIL OFL 1.1 | `node_modules/@fontsource/inter/LICENSE` |
| Zoo, Badger, the jellyfish mark, icons, sets | Original work drawn in code for this project | `src/characters`, `src/branding` |

OFL fonts may be used to render images and video for commercial use; the output is not the font software. The fonts are bundled from npm and loaded locally (`src/brand/fonts.ts`), and nothing is fetched at render time.

The kit uses no other third-party asset. The kit contains no logos of exchanges, chains or apps; the only marks are our own. The stings contain no audio; the jingle's licence is the audio workflow's (`docs/AUDIO_LICENSES.md`).

## 7. Decisions, iterations and honest limits

### What looking at the renders changed

| Asset | Problem found | Fix |
| --- | --- | --- |
| Jellyfish mark | v1 read as an umbrella or a "rainbow" icon | Added a scalloped rim with tentacles at its cusps, and an asymmetric highlight line |
| Zoora banner | The silver "AI" ran into the light porthole | Moved the porthole right and shrank the lockup |
| Zoora banner | Badger's chin sat on the band's edge | Lifted the pair to scale 0.6 |
| Show banner (TV) | Empty wall and a blank desk front | Added hanging wall slats, a floor and a desk emblem |
| Show banner (phone) | The monitor's bug was cut off | Moved it to the monitor's left |
| Badges | The hook icon read as a "J" | Added an eye and a barb |
| Zoora sting | The moving mark crossed the wordmark | The mark now settles first |
| Show sting | The cast sat in the far corners | Recomposed like the banner |
| Show sting | Zoo's eye dart is about 2 px at this scale (the rig keeps eyes subtle) | The beat now also uses a 3-degree head turn and the brow |
| Avatar | The line was 1.15 px at 36 px | The avatar uses a one-notch bolder cut: 4.1 px at 98 px, 1.5 px at 36 px |

### Choices for the owner

- **Security avatar.** Badger's head on silver is the default.
  - Teal is more striking, but it turns the "sparingly used" accent into a large mass, so it is kept only as an alternate (`out/brand/alt/zoora-security-avatar-teal-800.png`).
  - Slate was rejected: it hides Badger's dark ear, an identity marker.
- **Security channel name.** It is not decided. The kit carries the show's name, so nothing needs re-rendering when the name is chosen. Options with notes are in `content/zoora-security/channel-copy.md`.
- **Jellyfish on the show.** The show banner carries the Zoora jellyfish as a small network bug, on the studio monitor and on the desk emblem. Remove the `JellyfishMark` uses in `src/branding/stills/BannerShow.tsx` if the security channel should stand apart from Zoora.

### Limits (stated plainly)

- **The existing avatar was not viewed.** The image host (yt3.googleusercontent.com) is blocked in this session. The new mark follows the recorded description ("silver line-art jellyfish with circuit nodes, on a black circle"), drawn flat because gradients are banned. Compare it with the current avatar before replacing it.
- **Device crop sizes are secondary-source figures.** Everything a viewer must read is inside the official safe area regardless. Check Studio's banner preview when uploading.
- **Character outlines come from the shared rig.** At the banner's character scale (0.6 to 0.8) they are 2.1 to 2.8 px, below ART_GUIDE SL5's 3 px minimum. The rig draws a fixed `LINE.width` (src/characters, not editable here), so on phones the characters read softer than the logos.
- **The trailers are scripted and timed but not rendered.** They need the voice step and the show or episode scenes. The narration was synthesized with Kokoro `im_nicola` to measure it: 41.4 s (Zoora AI) and 40.0 s (security) of speech, so about 53 s and 51 s with the sting and Badger's beats.
- **The Spanish and Portuguese descriptions are drafts.** Run the back-translation check and get a native review before publishing.
- **The general claim gate (`scripts/claims`) was still being built.** Its checks existed but its CLI did not. Its income and factual-claim checks (`incomeHits`, `factualSignals`) were run directly on every prose block of both files (English, Spanish and Portuguese).
  - They flagged two problems, both fixed. "What this channel is not: financial advice ...": the gate reads a colon as a sentence end, so the negation did not carry. Portuguese "casos reais": "reais" is also Brazil's currency.
  - The final copy has 0 hits. It also passes this kit's own copy lint (`src/branding/copy.ts`: limits, banned promises, "Zoo" casing, cryptophishing phrasing).
  - Run the gate's CLI on both `channel-copy.md` files once it lands.
- **The stings are silent until the jingle exists.** The hook and hit points are ready.
