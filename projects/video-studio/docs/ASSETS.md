# One episode → 6+ assets (`scripts/assets`)

Built 2026-11-24. One rendered episode becomes:

| # | Asset | Files (under `out/assets/<channel>/<slug>/<lang>/`) |
| --- | --- | --- |
| 1 | Article for search (transcript, sources, video embed) | `article/index.html`, `article/meta.json` |
| 2 | Podcast episode | `podcast/episode.mp3` (ID3 chapters), `podcast/episode.m4a`, `podcast/show-notes.md` + `.html`, `podcast/chapters.json`, `podcast/transcript.vtt` + `.srt`, `podcast/item.json`, `podcast/master.wav` |
| 3 | X thread (3-6 posts) | `social/x-thread.txt`, `social/x-thread.json` |
| 4 | Telegram post | `social/telegram.html` (Bot API HTML mode), `social/telegram.txt` |
| 5 | LinkedIn post | `social/linkedin.txt` |
| 6 | Newsletter draft (creator-hub's tool) | `newsletter/<slug>.md` + `.html`, `newsletter/run.json` |
| | Everything above, with checks and character counts | `manifest.json` |

Plus two site-wide builders: the article site (`sitemap.xml`, `feed.xml`, an index page) and a self-hosted podcast
RSS feed. **Nothing is uploaded, posted, sent or published.** Every file is for the owner to review first
(`docs/PROJECT_INSTRUCTIONS.md`: publishing needs the owner's separate request).

## Commands

Run from `projects/video-studio`. Node 22 runs the `.ts` files directly; ffmpeg/ffprobe 6.x are needed for the podcast.

```bash
node scripts/assets/make.ts zoora-security/<slug>                       # every language that has a storyboard
node scripts/assets/make.ts zoora-security/<slug> --lang en,es,pt-br --youtube-id <id> --published 2026-11-30
node scripts/assets/make.ts zoora-ai/<slug> --only article,social       # a subset: article, podcast, social, newsletter
node scripts/assets/build-site.ts [--site hub|pages] [--include-drafts] # out/assets/_site/<site>/articles/
node scripts/assets/build-podcast-feed.ts zoora-security --lang en      # out/assets/_site/podcast/zoora-security/en/
node scripts/assets/cover.ts zoora-security                             # 3000x3000 cover from a PodcastCover still
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/assets/tests/*.test.ts   # 35 tests, about a minute
```

`make.ts` options: `--lang`, `--only`, `--site`, `--youtube-id`, `--published`, `--kit`, `--offers`, `--names`,
`--badger-cues`, `--cover`, `--podcast-min-sec`, `--out`, `--config`, `--content-root`, `--generated-root`,
`--publish-root`, `--hub-root`, `--now` (fixed build time for reproducible output). `--help` lists them.

Exit codes: `make.ts` 0 = every asset is ok, draft, pending or skipped; 1 = an asset is blocked or failed; 2 = usage or
input error. `build-podcast-feed.ts` 1 = owner inputs missing. `cover.ts` 3 = the cover composition does not exist yet.

### Statuses

| Status | Meaning |
| --- | --- |
| `ok` | Built and every check passed: ready for the owner's review and a manual publish |
| `draft` | Built, but waiting on something: no YouTube id or publish date yet, an unreviewed translation, a stale or missing timeline, a newsletter built from the adapter kit |
| `pending` | Waiting on an input before it can be built (the newsletter needs the YouTube id) |
| `blocked` | A lint or content error: fix it and re-run. Blocked assets never go into the site or the feed |
| `skipped` | Not applicable (e.g. no podcast for a daily Short; the email list is English only) |
| `error` | A tool failed |

## Inputs (file contracts, read only)

| Input | Path | Owner |
| --- | --- | --- |
| Storyboard | `content/<channel>/<slug>/storyboard.json` (+ `storyboard.<lang>.json`); `_dev` reads `src/episode/dev/fixtures/<slug>/` | episode workflow (`src/episode/types.ts`) |
| Timeline + narration | `public/generated/<channel>/<slug>/<lang>/timeline.json`, `narration.wav` | voice step (`scripts/voice`) |
| Publish kit | `out/publish/<channel>/<slug>/kit.json` (other languages: `<lang>/kit.json` or `kit.<lang>.json`; a dub without one borrows the source-language kit, see [Dubs and the publish kit](#dubs-and-the-publish-kit)) | publish kit (`scripts/publish-kit`, PublishKit in `creator-hub/src/types.ts`) |
| Corrections | `content/<channel>/corrections.json` (pinned ones are shown on the article; `languages.<lang>` holds the owner's translation of a correction) | news claim gate (`scripts/news`) |
| Developing label | `storyboard.news.developing` (or `storyboard.developing`) | news claim gate |
| Offer registry | `../creator-hub/config/offers.json` (gitignored) | creator-hub |
| Private names | `data/private/names.txt` (gitignored; one name per line) | owner |
| Channel settings | `scripts/assets/config/channels.json` | this tool |
| Sidecar (optional) | `content/<channel>/<slug>/assets.json` and `assets.<lang>.json` | this tool (fields below) |
| Badger sounds (optional) | `public/generated/<channel>/<slug>/<lang>/badger-cues.json` | this tool (format below) |

Where a dependency is not finished, the tool uses a thin adapter and says so in the manifest:

- **No publish kit yet** (scripts/publish-kit is being built): the title and summary come from the storyboard and the
  sidecar, and the newsletter runs on an adapter kit written to `newsletter/kit.assets.json` (status `draft`). A real
  kit always wins.
- **No announcer** (`creator-hub/tools/announcer` does not exist): social posts are plain text and JSON files. When the
  announcer lands, its input format still has to be wired in (the manifest warns).
- **Narration markup** is parsed by `lib/markup.ts`, a copy of the committed `src/episode/markup.ts`'s `displayText`;
  a test compares the two on every fixture so drift fails the tests.

Sidecar fields (all optional): `summary`, `takeaways[]`, `youtubeVideoId`, `publishedAt` (YYYY-MM-DD or an ISO
timestamp), `podcast.{skip, season, episode, title}`, `social.{hook, hashtags[]}`. Types are checked and anything else
is refused (exit 2): `podcast.skip` must be true or false, `podcast.season` and `podcast.episode` positive whole
numbers, `podcast.title` a string, and unknown keys are errors. On the security channel a script is drafted from
outside news text, so these values are treated as untrusted. Without a summary the tool uses the first two sentences of
the transcript and warns. Without takeaways it uses the on-screen steps and bullets, then chapter titles.

**Publish times.** `--published` or `publishedAt` should be the upload's full publish time (for a batch item, its
slot's `publishAt`). A date alone means that day at 00:00 in the owner's zone, America/Chicago (CST or CDT), never
midnight UTC (which is the evening before in Oklahoma); the manifest warns and asks for the full time. The feeds
(the RSS `pubDate`, the Atom `published`) get that timestamp; the page's `article:published_time`, schema.org's
`datePublished` and the VideoObject's `uploadDate` stay date-only when no time was given.

## Rules every asset follows

- **Lint over all generated text** (`lib/lint.ts`). Errors block: income, return or guarantee claims (the newsletter
  tool's list, plus Spanish and Portuguese equivalents), "ZOO" in capitals (the host is "Zoo"), any name from
  `data/private/names.txt` (the name is never printed or written to the manifest), placeholders, unverified sources, and
  an offer or hub link without its disclosure right before it. Softer money words are warnings. The transcript is what
  the approved video says, so a claim word there is a warning: fix the video, not the transcript.
- **Disclosures next to every link.** Each offer link carries its disclosure directly above it in the same block, post
  or message (X: in the post that holds the link). Pages use `rel="sponsored"`. The disclosure is in the page's
  language: FTC staff guidance says "The disclosure should be in the same language as the endorsement itself"
  (Disclosures 101 for Social Media Influencers). The registry has English only, so non-English assets use an offer
  only when `offerDisclosures.<offer>.<lang>` in `config/channels.json` holds an owner-approved translation.
- **Offers** are used only when the registry says live and allowed for an unknown country with no country lists, and
  never exchanges: a page, post or podcast cannot know the reader's country (the newsletter's rule). Links go through
  the hub (`/go/<id>?v=<slug>&s=site|x|other`), which re-checks the region at click time. The hub's source list has no
  telegram, linkedin or podcast value, so those use `s=other` (a creator-hub change would separate them).
- **Translations.** A storyboard whose `translation.status` is not `native-reviewed` gives a noindex article with a
  notice, draft posts, and a podcast item kept out of the feed. The es and pt-br interface text in `lib/i18n.ts` also
  needs a native speaker's review; other languages fall back to English headings with a warning.
- **Accuracy.** Unverified sources block. Fiction stories need the fiction disclaimer (`ui.fictionDisclaimer` for
  non-English). Developing stories get a banner and a "DEVELOPING:" prefix. A storyboard edited after the voice step
  (its narration no longer matches the timeline words) is flagged `timeline-stale` and nothing stays `ok`.
- **Corrections in the page's language.** A pinned correction shows in the page's language when
  `corrections.json` gives one (`"languages": {"es": "…"}`); otherwise it shows in its own language, marked with that
  language, and the asset warns (`correction-untranslated`) until the owner adds the translation.

### Dubs and the publish kit

The publish kit writes one kit per episode, in the source language. A dub (es, pt-br) without its own kit borrows that
kit for what is the same in every language: the YouTube video id (dubs are audio tracks on the same video), the chapter
times (when the dub was voiced with `--fit-to` the kit's language, so its timeline matches), and the offers (each with
its own localized disclosure rule, above). The kit's title and summary stay out: they are in the wrong language. Every
other disclosure line of the kit (for example "The messages and pages shown in this video are recreations with
fictional accounts", or an own-product "I built this") needs an owner-approved translation in
`config/channels.json` under `"disclosureTranslations": {"<the exact kit line>": {"es": "…", "pt-br": "…"}}`. Until it
has one, the asset is **blocked** (`disclosure-untranslated`): a disclosure is never dropped. The manifest names the
borrowed kit in its owner actions.

## (a) Article

A static, self-contained page: no scripts, no web fonts, no images loaded by the page, one inline stylesheet pinned by a
`Content-Security-Policy` meta hash, light and dark colour schemes, a skip link, landmarks, and visible focus outlines.

- Title, summary, the YouTube embed (`youtube-nocookie.com`, lazy, `referrerpolicy="strict-origin-when-cross-origin"`,
  which YouTube embeds need) or a "not published yet" placeholder, key takeaways, offer links, the full transcript (one
  paragraph per scene, a chapter heading where a chapter starts, a timestamp link per paragraph, source footnotes),
  pinned corrections, sources (title, link, access date), the subscribe call (`<hub>/subscribe?s=site&v=<slug>`), and
  every disclosure.
- Head: canonical URL `<articleBase>/<channel>/<slug>/<lang>/`, hreflang alternates for every reviewed language plus
  `x-default`, OpenGraph and Twitter cards, `article:published_time`, and JSON-LD with an `Article` and a
  `VideoObject` (name, description, thumbnailUrl, uploadDate, duration, embedUrl, transcript). The VideoObject is only
  written once the YouTube id and publish date are known; until then the page is `noindex`.
- `build-site.ts` collects the `ok` articles of one site into `out/assets/_site/<site>/articles/` with `sitemap.xml`
  (hreflang alternates included), `feed.xml` (Atom), `index.html`, and an index page per channel
  (`articles/<channel>/index.html`, listed in the sitemap: the podcast feed's `<link>` points there), and warns when an
  hreflang target is not in the build.

### Hosting the articles (owner decision; nothing is set up)

Pick one canonical home. Publishing the same article on two hosts as canonical splits search traffic.

1. **`go.zoora.ai/articles` via creator-hub (recommended for monetised articles).** The hub already serves the tracked
   `/go` links, `/subscribe`, `/disclosures` and `/privacy` that the pages link to, on the same host. Needed: (a) a
   small static route module in creator-hub that serves `out/assets/_site/hub/articles/` read-only (path checks,
   `Cache-Control`, the page's own CSP or a hub CSP that allows `frame-src https://www.youtube-nocookie.com` and the
   page's style hash, recorded as `styleSha256` in each `meta.json`); (b) copying the folder into the image or onto the
   volume at deploy; (c) deploying the hub, which is not deployed yet (`creator-hub/docs/link-hub.md`). Those files
   belong to the creator-hub workflow; this tool only produces the folder.
2. **Mirror to the zoora.ai GitHub Pages site.** Build with `--site pages` (canonical `https://zoora.ai/articles/...`,
   **no offer links**): `sites/zoora-newsletter/LAUNCH.md` says the zoora.ai copy offers no token purchase, wallet
   connection, price, profit or trade, and its Kit form promises "product and build updates" only. The owner would copy
   `out/assets/_site/pages/articles/` to `sites/zoora-newsletter/public/articles/`; the Pages workflow deploys `public/`
   on a push to `main`. Re-run `python -m unittest tests.test_zoora_newsletter_page` after adding files. This tool never
   writes into `sites/`.
3. Either way, add the sitemap to Google Search Console for that host and keep the article links in the YouTube
   descriptions (via the publish kit) pointing at the chosen host.

## (b) Podcast

- **Which episodes.** Daily Shorts are too short for podcast episodes: the podcast takes the weekly round-ups and long
  episodes. `news.format: "daily-short"`, anything shorter than `podcastMinSec` (180 s), or `podcast.skip` is skipped.
  The podcast is enabled for `zoora-security` (The Zoo & Badger Show) only; Zoora AI stories stay video-only unless the
  owner decides otherwise.
- **Master.** `narration.wav` (24 kHz mono, -14 LUFS from the voice step) plus Badger's recorded sounds when a cue file
  exists → 44.1 kHz dual-mono stereo → two-pass `loudnorm` in linear mode → **-16 LUFS integrated, true peak at or
  below -1 dBTP** (the master aims at -1.5 dBTP to leave room for the codec). Apple Podcasts' "Audio requirements"
  page: about -16 LKFS ±1 dB and a true peak at or below -1 dBFS, measured per ITU-R BS.1770, levelled before
  encoding. Spotify publishes no episode loudness number we could read; its podcast ad spec is -16 LUFS ±1.5
  (ads.spotify.com). Dual-mono stereo means the -16 LUFS is what a listener hears on both earbuds.
- **Encodes.** MP3 128 kbit/s CBR with an Xing/LAME header and an **ID3v2.3** tag written by `lib/id3.ts` (title,
  show, author, year, language, comment, copyright, episode link, optional 600 px cover, TLEN, and chapters as one CTOC
  frame plus CHAP frames per the ID3v2 Chapter Frame Addendum). M4A (AAC-LC 128 kbit/s) with iTunes tags and a
  QuickTime chapter track. Both are decoded and measured again (loudness, 44.1 kHz stereo, duration within 150 ms) and
  ffprobe must read back the same chapters. In the M4A's ffmetadata, `\ = ; #` and line feeds are escaped, and carriage
  returns and NUL become spaces, so a title can never add a tag or a chapter (ffmpeg ends a line at a carriage return).
- **Chapters** are the publish kit's chapters when there is a kit (the same list as the YouTube description and the
  newsletter), mapped onto the narration timeline. Without a kit, or when its chapters do not fit the timeline, they
  come from scene boundaries (a scene shorter than 10 s joins the chapter before it, so chapters match YouTube's
  minimum) and the manifest says so; a kit chapter under 10 s is a warning, because YouTube then ignores every
  chapter. The same chapters go into the ID3 tag, the M4A, `chapters.json` (Podcasting 2.0 JSON chapters 1.2.0), the
  RSS (`psc:chapters`, which Spotify reads for shows hosted elsewhere), the show notes (`MM:SS Title` lines, which
  Spotify and YouTube read when there are at least 3) and the article headings.
- **Show notes** (Markdown and HTML): summary, watch and article links, chapters, takeaways, offers with disclosures,
  sources with access dates, disclosures, the subscribe link. The HTML is under Apple's 4000-character description limit
  or the manifest warns.
- **Badger's sounds.** Optional cue file `public/generated/<channel>/<slug>/<lang>/badger-cues.json`:
  `{"version": 1, "cues": [{"clip": "clips/huff-01.wav", "atMs": 35400, "gainDb": -3, "label": "huff"}]}` (clip paths
  relative to the file; example in `scripts/assets/fixtures/badger-cues.example.json`). A cue that plays over any of
  Zoo's words (100 ms guard) blocks the podcast: CLAUDE.md says punchlines go after his lines, never over them. More
  than 3 cues a minute is a warning. Clips must be the owner's real dog recordings (CLAUDE.md rules).
- **Cover art.** A 3000x3000 still of Zoo and Badger at the show desk. The show set (`src/show`) and a cover
  composition do not exist yet, so `node scripts/assets/cover.ts zoora-security` prints the command and exits 3. Once a
  `<Still id="PodcastCover" width={3000} height={3000}/>` is registered, it renders
  `npx remotion still src/episode/index.ts PodcastCover <tmp>/cover.png --frame=0 --image-format=png`, checks the
  result (square, 1400-3000 px, JPEG/PNG, RGB without alpha: Apple's show-art rules) and writes a 3000 px JPEG. Look at
  it, then set `podcast.coverFile` in `config/channels.json` (or pass `--cover`).
- **Self-hosted RSS.** `build-podcast-feed.ts` writes `feed.xml` with the iTunes namespace (`itunes:image`,
  `itunes:category` Technology and News › Tech News, `itunes:explicit false`, `itunes:owner/email`, `itunes:type`,
  per-item duration, season, episode and episodeType) and the Podcasting 2.0 namespace (`podcast:guid` = UUIDv5 of the
  feed URL in the podcast namespace, checked against the spec's test vectors; `podcast:locked`, `podcast:medium`,
  `podcast:transcript` (VTT and SRT), `podcast:chapters`), and copies each episode's files next to it. It refuses to
  write until the owner has set `feedUrl`, `mediaBase`, `imageUrl` and `ownerEmail` (the email is public in the feed;
  directories send verification codes there). Once assigned, keep `podcast:guid` for life: record it in
  `podcast.shows.<lang>.guid`. Do not commit MP3s to git; host them on static file hosting.
- **Nothing reaches the feed unchecked.** Every value in `feed.xml` is escaped (`xml()`), wrapped in CDATA (`cdata()`,
  which also drops characters XML 1.0 forbids, such as a vertical tab pasted into a summary, and splits `]]>`), or
  checked to be a number or an enum value. `build-podcast-feed.ts` re-reads each episode's `item.json` and checks every
  field before use (types, the `episodeType` enum, positive whole season and episode numbers, https links, plain file
  names); one invalid item stops the feed ("never edit them by hand") instead of letting text close an `<item>` and add
  channel tags such as `itunes:new-feed-url` or `itunes:block`.

### Spotify for Creators (free hosting)

Checked 2026-11-24 from Spotify's support pages (seen as search-index extracts; support.spotify.com is blocked here).
**Correction to the plan: Spotify for Creators does not distribute your show to Apple Podcasts or other apps.** Spotify
says it will not distribute a podcast on your behalf: you enable the show's RSS feed and submit that feed to each
service yourself.

1. Sign in at creators.spotify.com with the owner's account. Create the show: title "The Zoo & Badger Show", the
   description from `config/channels.json`, the 3000x3000 cover, category Technology, not explicit, language English.
2. For each episode with podcast status `ok`: upload `podcast/episode.mp3` (MP3, M4A and WAV are accepted, mono or
   stereo, no size limit; keep embedded art and tags small, as ours are). Paste `podcast/show-notes.html` as the
   description: its `00:00 Title` lines become chapters (first at 00:00, at least 3, in order, plain text). Set the
   publish date and season/episode numbers from `item.json`. Publish only after the owner's go-ahead.
3. Settings → Availability → RSS distribution: enable the RSS feed (it appears after the first episode). Your account
   email is published in that feed.
4. Submit that RSS feed to Apple Podcasts (below), Amazon Music and others yourself. After Apple lists the show, paste
   its Apple Podcasts link back under Settings → Availability.

Self-hosting instead (our `feed.xml`): upload `out/assets/_site/podcast/zoora-security/en/` to `mediaBase`, serve
`feed.xml` at `feedUrl`, then add the feed to Spotify for Creators as an existing show and submit it to Apple and the
others. Use one host per show, never both.

### Apple Podcasts

Podcasts Connect (podcastsconnect.apple.com) → add a show with an RSS feed → paste the feed URL → Apple validates
`itunes:image` (1400-3000 px square JPEG/PNG, RGB), `itunes:category`, `itunes:explicit` (true/false) and `language`
→ submit for review. Apple reads MP3 chapters from ID3 tags and accepts publisher transcripts through
`podcast:transcript` (VTT preferred) after you opt in to your own transcripts in Podcasts Connect.

### YouTube Podcasts

- **Use the playlist route** (recommended): the full long-form episodes are already on YouTube as videos. In YouTube
  Studio go to Content → Playlists → ⋮ → Set as podcast (or Create → New podcast → Set an existing playlist as a
  podcast). Put only full episodes of this one show in that playlist, in order, add the square cover as the podcast
  thumbnail, and keep the playlist public. Shorts stay out of it.
- **Do not use RSS ingestion for this show.** RSS ingestion (Create → New podcast → Submit RSS feed; selected countries
  only; YouTube emails a code to the feed's `itunes:email`) turns each audio episode into a static-image video, which
  would duplicate the animated episodes on the same channel. Use it only for a separate, audio-only channel.

## Social and newsletter

- **X thread**: 3-6 posts; the opener is the hook plus as many whole sentences of the summary as fit; then takeaways;
  the last post holds the YouTube and article links, at most one offer with its disclosure, and hashtags. Every post is
  at most 280 weighted characters counted the way X does (twitter-text config v3: URLs 23, CJK and emoji 2).
- **Telegram**: one message in Bot API HTML (escaped) plus a plain copy; at most 4096 characters (1024 if sent as a
  photo caption; the manifest says when it is longer).
- **LinkedIn**: plain text, at most 3000 characters; the hook should fit in the ~210 characters shown before "see
  more" (warning only).
- **Newsletter**: for the languages in `newsletterLangs` (English) and once the YouTube id is known, the tool runs
  `npm run --silent newsletter -- draft <kit.json> --out <dir> --hub <origin> [--offers <registry>] --youtube-id <id>`
  in creator-hub and records the command, exit code and output in `newsletter/run.json`. It never passes
  `--kit-draft`, so nothing reaches Kit.

## Owner inputs still needed

- Host for the articles (hub route or Pages mirror) and the canonical base URL; deploy of the hub.
- Podcast: `ownerEmail`, `feedUrl`, `mediaBase`, `imageUrl` in `config/channels.json` (or hosting on Spotify for
  Creators instead), the approved 3000x3000 cover, and Badger's real recordings.
- Owner-approved Spanish and Portuguese disclosures for any offer (`offerDisclosures`), and a native review of the
  es/pt-br interface text.
- Per episode: the YouTube id and publish date after upload.

## Sources (checked 2026-11-24)

✅ read directly · ⚠️ official page blocked here, taken from search-index extracts or secondary reporting.

| Fact | Status | Source |
| --- | --- | --- |
| Podcasting 2.0 tags (guid UUIDv5 + namespace `ead4c236-…`, locked, medium, transcript, chapters JSON 1.2) | ✅ | github.com/Podcastindex-org/podcast-namespace (docs/1.0.md, docs/tags/*.md, docs/examples/chapters/jsonChapters.md) |
| Podlove Simple Chapters 1.2 | ✅ | github.com/podlove/podlove-specifications (podlove-simple-chapters.md) |
| X weights: limit 280, URLs 23, ranges with weight 1 | ✅ config / ⚠️ docs | raw.githubusercontent.com/twitter/twitter-text/master/config/v3.json; docs.x.com/fundamentals/counting-characters |
| Apple: -16 LKFS ±1 dB, true peak ≤ -1 dBFS, BS.1770, level before encoding | ⚠️ | podcasters.apple.com/support/audio-requirements |
| Apple: chapters for MP3 (ID3), MP4 and AAC | ⚠️ | podcasters.apple.com/support/2482-using-chapters-on-apple-podcasts |
| Apple: show art 1400-3000 px square, JPEG/PNG, RGB | ⚠️ | podcasters.apple.com/support/5514-show-cover-template; itunespartner.apple.com/podcasts/articles/artwork-3066 |
| Apple: required itunes:explicit, itunes:image, itunes:category, language | ⚠️ | podcasters.apple.com/support/829-validate-your-podcast |
| Apple: publisher transcripts via podcast:transcript (VTT/SRT) | ⚠️ | podcasters.apple.com/support/5316-transcripts-on-apple-podcasts |
| Spotify for Creators does not distribute to other apps; RSS under Settings → Availability | ⚠️ | support.spotify.com/us/creators/article/distributing-your-show-to-other-platforms/; …/submitting-your-show-to-apple-podcasts/ |
| Spotify: MP3/M4A/WAV, no size limit, keep ID3 small | ⚠️ | support.spotify.com/us/creators/article/publishing-audio-episodes/ |
| Spotify: chapters from description timestamps (00:00 first, ≥3, ordered) | ⚠️ | support.spotify.com/us/creators/article/episode-chapters/ |
| Spotify podcast ad loudness -16 LUFS ±1.5, TP ≤ -2 | ⚠️ | ads.spotify.com/en-US/guide-to-creating-audio-ads/podcast-ads-minimum-requirements/ |
| YouTube: set an existing playlist as a podcast; full episodes only | ⚠️ | support.google.com/youtube/answer/12751636 |
| YouTube: RSS ingestion, selected countries, Studio path | ⚠️ | support.google.com/youtube/answer/13525207 |
| Google: VideoObject properties (name, thumbnailUrl, uploadDate, description) | ⚠️ | developers.google.com/search/docs/appearance/structured-data/video |
| LinkedIn post limit 3000 characters | ⚠️ | linkedin.com/help/linkedin/answer/a528176 |
| Telegram: 4096-character messages, 1024-character bot captions | ⚠️ secondary | bugs.telegram.org/c/58359; docs.publora.com |
| FTC: disclosure in the same language as the endorsement | ⚠️ | ftc.gov "Disclosures 101 for Social Media Influencers" (1001a-influencer-guide-508_1.pdf) |
| ID3v2 Chapter Frame Addendum (CHAP/CTOC layout) | ⚠️ spec not reachable; verified by ffprobe reading our tags | id3.org/id3v2-chapters-1.0 |

Hosts to allow in the session network to promote the ⚠️ items: podcasters.apple.com, support.spotify.com,
support.google.com, developers.google.com, docs.x.com, www.linkedin.com, ftc.gov.

## Code map

| File | Role |
| --- | --- |
| `make.ts` | CLI: one episode, every language |
| `build-site.ts`, `build-podcast-feed.ts`, `cover.ts` | Site, feed and cover builders |
| `lib/build.ts` | Orchestration per language, statuses, manifest |
| `lib/episode.ts`, `lib/config.ts`, `lib/markup.ts` | Inputs, channel settings, narration markup |
| `lib/transcript.ts` | Paragraphs, chapters, caption cues (VTT/SRT) |
| `lib/article.ts`, `lib/site.ts`, `lib/html.ts` | Page, sitemap/feed/index, escaping |
| `lib/audio.ts`, `lib/id3.ts`, `lib/podcast.ts`, `lib/rss.ts` | ffmpeg, ID3v2.3 + chapters, podcast step, RSS |
| `lib/social.ts`, `lib/xcount.ts` | X, Telegram, LinkedIn; X character counting |
| `lib/newsletter.ts`, `lib/offers.ts`, `lib/lint.ts`, `lib/i18n.ts` | Newsletter bridge, offers, lint, interface text |
| `fixtures/` | Test episode `zoora-security/fixture-fake-support` (en + machine-translated es), kit, registry, names, test config |
| `tests/` | Unit, rendering and end-to-end tests (`node --test scripts/assets/tests/*.test.ts`) |

## Known limits

- The podcast loudness and chapters were verified on synthetic narration in the tests, not yet on a real Kokoro
  episode (none has been voiced yet). Real speech should land closer to -16 LUFS than the test tone.
- Article hosting, the podcast feed URLs, the cover and the announcer integration are not set up (owner inputs above).
- The transcript names no speaker and leaves Badger's sounds out; "[Badger: …]" captions need the owner's OK.
- The X counter treats every bare domain as a link (it may over-count, never under-count).
