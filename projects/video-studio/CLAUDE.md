# Video Studio — 2D animated YouTube pipeline

> **Binding:** read `docs/PROJECT_INSTRUCTIONS.md` first. It holds the owner's permanent project instructions (Prompt 1, adopted 2026-11-24) and overrides anything below that conflicts with it.
> - Characters: **Zoo** and his dog **Badger**. Approved sheets are in `reference/model-sheets/`. The reusable assets live in `src/characters/` and are never redesigned per scene.
> - Per-episode prompt: `docs/prompts/03-episode.md`. Drift repair: `docs/prompts/04-fix-drift.md`. Character build spec: `docs/prompts/02-build-characters.md`.
> - Style: flat vector, near-black outlines, at most one flat shadow tone per colour, default background `#E6E8EB`, teal `#29B8AD` accent. No gradients, glow, texture or halftone.

Code-driven pipeline: topic → research → script → storyboard JSON → voice → Remotion render (long-form + Shorts) → thumbnails → `publish.md` → QA. All art is React/SVG drawn in code. No stock footage, no copyrighted assets.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Environment, Remotion + skills, 3 s test render, this file | **Done 2026-11-23** |
| 1 | `brand.json`, host character, 7 scene templates, transitions, lower third | Not started |
| 2 | Pilot: 60–90 s video, 1 Short, 3 thumbnails, `publish.md` | Inputs partly in (see Owner decisions) |
| 3 | One-command hardening, `channels.md` (10 niches), 4-week calendar | Not started |

Stop for owner review at the end of every phase.

## Owner decisions (2026-11-24)

- **Channel:** Zoora AI, @ZooraTechnologies. Profile in `content/zoora-ai/CHANNEL.md`.
- **Format:** second-person life-story videos, modelled on a reference the owner supplied (`content/zoora-ai/REFERENCE.md`). Genre only: we never copy that creator's character, art or scripts.
- **Voice:** Kokoro (free, local, via kokoro-onnx).
- **Dubbing launch languages (owner, 2026-11-24): Spanish and Brazilian Portuguese first** (largest reachable YouTube regions). Other supported languages: Hindi, Italian, Chinese (experimental). Japanese is blocked until a real G2P works. French is excluded: Kokoro has no male voice.
- **Zoo voice — DECIDED (owner, 2026-11-24): Kokoro `im_nicola` for EVERY language** (en, es, pt-br, hi, it, zh). The owner accepted the Italian accent in other languages. This is binding: the voice step and every episode use `--voice im_nicola` (the map lives in `content/zoora-ai/channel.json`). Do not use am_michael, em_alex or pm_alex for Zoo.
- **Host: Zoo + Badger (superseded by docs/PROJECT_INSTRUCTIONS.md and the approved sheets).** Earlier note: An original adult human guy, deadpan with dry humour, appearing in every video. The owner rejected the 3 concepts in `src/styleframes/` (keep them only as references). The drawing style is not chosen yet; the owner will follow up. His deadpan comes from timing and a flat mouth, **not** half-lidded eyes: that is the reference creator's protagonist trait.
- **Pilot story:** "POV: You become a top caller on Pump.fun". Cautionary, grounded in real on-chain investigations, fictional composite characters, no real names unless sources support it. Next video: "You created an autonomous AI trading agent hedge fund".
- **Pilot CTA:** subscribe only, no product pitch.

## Channel 2: crypto + AI security news (working slug `zoora-security`, display name TBD) — owner rules, 2026-11-24 (binding)

- **Format:** "The Zoo & Badger Show", a talk-show / podcast set. Zoo hosts and talks. Badger is the nonverbal co-host (PROJECT_INSTRUCTIONS): his reactions carry the jokes. Recurring segments: Rekt Meter, Badger's Red Flag, Zoo's One Fix, Scam of the Week.
- **Scope (owner, 2026-11-24): crypto security AND AI security.** That includes AI-agent exploits and prompt injection incidents, malicious AI tools, plugins and skills, deepfake and voice-clone scams, AI-powered phishing, and AI-washing frauds. The same rules apply. The radar gets AI-security sources added after its first build lands.
- **Not planned:** a games channel (owner, 2026-11-24). **Proposed, pending the owner's go-ahead:** a Markets (stocks) channel: news and analysis only, no recommendations, SEC-filings data, and dubbing limited until each region's adviser rules are checked.
- **Name:** the host is **"Zoo"** (title case; owner, 2026-11-24). On-screen text, the show logo ("The Zoo & Badger Show") and docs use "Zoo". A full sweep of code comments and labels is pending until the running workflows finish.
- **Badger vocalizations (owner request, 2026-11-24):** Badger may make REAL dog sounds recorded from the owner's actual dog (Snapchat clips the owner will supply), such as huffs, grumbles, whines and "talking". He stays nonverbal: no words, no synthesized dog voice. Clips must contain no background music, no Snapchat sounds, lenses or voice filters, and no other people's voices. Use them sparingly (1-3 per Short), as punchlines AFTER Zoo's lines, never over his speech. Badger's mouth and ears are animated from the clip's amplitude (a small rig extension: a mouth-open control, with no redesign). Joke captions such as "[Badger: absolutely not]" are optional and need the owner's OK.
- **Cadence:** a daily Short (one incident, how it worked, one fix), "what we know" Shorts for major incidents, a weekly long-form round-up with fund-flow analysis, and evergreen explainers that every news video links to.
- **Pipeline:**
  1. The news radar drafts with sources.
  2. The claim gate runs: confirmed facts only, attributed, no naming of suspects, no exploit how-tos.
  3. The owner approves on his phone (about 5 minutes per video).
  4. Render, publish kit, auto-announcer and the daily "Threat Brief" email.
- **Rules:**
  - Label developing stories "developing" and pin corrections.
  - Don't redraw or speculate about others' material; attribute every fact.
  - Don't publish daily unless each video adds real analysis.
  - A strike on either channel endangers both, so accuracy comes first.
- **Zoora AI channel cadence:** 2 long story episodes a week plus daily Shorts cut from them. The best security stories later become Zoora AI "POV" episodes, so the two channels feed each other.

## Art quality rules (owner, 2026-11-24) — binding

- **Charts must be accurate.** Green candles go **up** (close > open); red candles go **down** (close < open). Wicks run to high/low. Every OHLC series must pass validation (high ≥ max(open, close), low ≤ min(open, close), positive prices). No amber, cyan or red-going-up candles. All 3 current style frames break this rule.
- **Smooth and professional, nothing blotchy.** No halftone dot patterns, no heavy SVG glow/blur filters, no muddy dark gradients that band after compression.
- The full guide is `docs/ART_GUIDE.md` and the chart spec is `docs/CHART_SPEC.md` (being written by the art-quality study).
- **Real market data:** this session blocks GeckoTerminal, DEX Screener, CoinGecko, Binance and the Crypto.com API. The Crypto.com connector is installed but not connected. Fictional stories use validated synthetic OHLC data.

## Commands (exist now)

Run from `projects/video-studio/`.

| Command | What it does |
| --- | --- |
| `npm ci` | Install pinned dependencies |
| `npm run studio` | Remotion Studio preview (needs a forwarded port; not useful in a headless cloud session) |
| `npm run test-render` | Render `TestCard` → `out/test.mp4` (3 s, 1920×1080, 30 fps) |
| `npm run test-still` | Render frame 45 of `TestCard` → `out/test.png` |
| `npm run typecheck` | `tsc --noEmit` |
| `npx remotion compositions` | List composition IDs |
| `npx remotion render <id> out/x.mp4 --props=path.json` | Render any composition with storyboard props |
| `npx remotion still <id> out/x.png --frame=N` | Render one frame (thumbnails) |

Always pass the composition ID; without it Remotion opens an interactive picker.

### Planned (not built yet — do not document as working)

- `npm run make -- <channel>/<slug>` — full pipeline, one command (Phase 3).
- `npm run voice -- <slug>`, `npm run qa -- <slug>`, `npm run shorts -- <slug>` (Phase 2–3).

## Environment facts (verified in this cloud session, 2026-11-23)

| Item | Value |
| --- | --- |
| Node / npm | v22.23.5 / 10.9.9 |
| ffmpeg / ffprobe | 6.1.1 (`/usr/bin`) |
| CPU / RAM | 4 cores / 15 GB |
| Remotion | 4.0.541 (pinned; all `@remotion/*` must share one exact version) |
| React / TypeScript | 19.2.0 / 5.9.3 |
| Browser | `/opt/pw-browsers/chromium_headless_shell-<N>/chrome-headless-shell-linux64/chrome-headless-shell` — auto-detected in `remotion.config.ts` (highest `<N>` wins); override with `REMOTION_BROWSER_EXECUTABLE` |
| Test render | 90 frames in ~18 s wall clock at concurrency 3; H.264 High, yuv420p, BT.709, 3.000 s |

### Network (probed with curl through the session proxy)

| Host | Reachable | Needed for |
| --- | --- | --- |
| registry.npmjs.org, pypi.org | Yes | Packages, `@fontsource/*` fonts |
| raw.githubusercontent.com | Yes | Reading Remotion docs source when remotion.dev is blocked |
| remotion.media | **No (403)** | Remotion's own browser download → we use the preinstalled one |
| www.remotion.dev | **No** | Docs → read `.claude/skills/*` or raw.githubusercontent.com instead |
| api.elevenlabs.io | **No** | ElevenLabs voice (needs allowlist + key) |
| huggingface.co | **No** | Piper voices, `kokoro` (PyTorch) package. Not needed: use kokoro-onnx below |
| github.com `/<owner>/<repo>/releases/download/...` | **Yes** (302 → release-assets.githubusercontent.com) | Kokoro ONNX model + voices |
| github.com web pages / api.github.com for repos outside this org | **No (403)** | Nothing required |
| support.google.com, developers.google.com, youtube.com, elevenlabs.io, sec.gov, ftc.gov | **No** | Policy re-checks: do them in a browser (see `docs/research/`) |
| fonts.googleapis.com | Yes, but don't rely on it | Use `@fontsource/*` from npm so renders never fetch fonts |

Never widen network access silently: propose the exact host through the environment tools and let the owner approve. Never put API keys in files, env vars committed to git, or chat — use the secure credential form.

## Remotion rules for this repo

- `remotion.config.ts` sets: preinstalled browser, JPEG frames, `yuv420p`, BT.709, overwrite, concurrency 3 (`REMOTION_CONCURRENCY` overrides).
- The installed `remotion-render` skill says to use Remotion's bundled browser. That is impossible here (remotion.media blocked); the owner explicitly asked for the preinstalled browser, so keep `setBrowserExecutable`. On a machine with open network, unset it by removing `/opt/pw-browsers`-detection or setting `REMOTION_BROWSER_EXECUTABLE`.
- Every composition is driven by props (storyboard JSON). No hard-coded copy in templates.
- Durations come from voice audio (`calculateMetadata`), never guessed.
- Agent skills live in `.claude/skills/`: the 13 skills from `remotion-dev/skills` at commit `89c8afa`, recorded in `skills-lock.json`. They were installed with `npx skills@1.9.0 add remotion-dev/skills --skill '*' --agent claude-code --copy -y`. Remotion's docs prefer `npx remotion skills add` inside a Remotion project; it installs the same skills via `skills@1.7.0`. Update with `npx skills update -p`. Read `remotion-best-practices` before writing compositions.
- Upgrades: keep every `remotion` / `@remotion/*` package on one exact version, and use the `remotion-upgrade` skill. We pinned 4.0.541 (2026-11-05), not the same-day 4.0.546. Remotion 5 is not released yet.

## Repository layout

```
projects/video-studio/
  CLAUDE.md               this file
  remotion.config.ts      render config (browser, pixel format, colour space)
  src/index.ts            registerRoot
  src/Root.tsx            composition registry
  src/compositions/       compositions (TestCard now; templates in Phase 1)
  .claude/skills/         Remotion agent skills (copied, locked)
  out/                    renders — gitignored, never commit
  content/<channel>/<slug>/   research.md, script.md, storyboard.json, publish.md (Phase 2)
```

Commit sources, templates, scripts, and content text. Never commit renders (`out/`), generated audio (`public/generated/`), or secrets.

## Voice (TTS)

| Option | State | Facts |
| --- | --- | --- |
| **Kokoro via `kokoro-onnx`** (free, local) | **Works here, tested 2026-11-23** | `pip install kokoro-onnx==0.6.1 soundfile` (PyPI). Model files: `https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx` (114,119,327 B, sha256 `ae315a79…ee9c`) and `voices-v1.0.bin` (28,214,398 B, sha256 `bca610b8…f7d`). `Kokoro.create_timed(text, voice, speed, lang='en-us')` → `(audio, 24000, [Timing(phoneme,start,end)])`: **phoneme-level** timings, so word boundaries come from space phonemes. Speed test: 5.47 s of audio in 4.69 s on 4 CPUs (int8). Weights are Apache-2.0; kokoro-onnx is MIT; its `phonemizer` dependency is GPL-3.0 (a tool dependency, not a licence on the audio it produces). |
| **ElevenLabs** (paid, best quality) | Blocked until the owner approves host `api.elevenlabs.io` and adds a key through the credential form | `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps`, header `xi-api-key`. Response: `audio_base64` plus `alignment`/`normalized_alignment` {`characters`, `character_start_times_seconds`, `character_end_times_seconds`}, i.e. **character-level**, not word-level. Recommended model `eleven_v4` (stability + similarity_boost only, no SSML); not yet tested whether it returns non-null alignment. Free plan: non-commercial, attribution required (unverified). Cheapest commercial plan: Starter, ~$6/mo, 30k credits (conflicting sources). |
| Piper | Not used | Voices are on huggingface.co (blocked). Engine is now GPL-3.0 (`OHF-Voice/piper1-gpl`). Phoneme alignment is experimental only. |

Never clone or imitate a real person's voice.

## Platform rules the pipeline must follow

Full evidence, sources and dates: `docs/research/platform-facts-2026-11-23.md`. ✅ = primary source read. ⚠️ = official page blocked here; fact taken from search-index extracts or secondary sources. Re-check ⚠️ items in a browser before relying on them.

**Remotion licence ✅.** Free for individuals and for-profit organisations with ≤3 employees. Remotion 5 (not yet released) will count **all people** sharing the codebase, contractors included. If more than 3 people work on this studio, a licence is needed: "Creators" $25/seat/month, or "Automators" $0.01/render with a $100/month minimum. Remotion 5 will also need Node 22 and `licenseKey` (`free-license` for free users).

**Fonts ✅.** Use `@fontsource/*` npm packages (OFL-1.1, files bundled) loaded with `@remotion/fonts` + `staticFile`, or the package CSS. Do **not** use `@remotion/google-fonts`: it fetches from fonts.gstatic.com at render time. Candidates: Anton (thumbnail headlines), Montserrat, Inter (captions). All three are OFL with no Reserved Font Name.

**Monetisation ⚠️.**
- Ads today: 1,000 subscribers + 4,000 valid public watch hours in 12 months, or 1,000 subscribers + 10M Shorts views in 90 days.
- Reported change for new applicants from **2027-02-01**: 1,000 subscribers + 8,000 watch hours in 365 days, or 20M Shorts views in 90 days (YouTube blog 2026-08-10, read via secondary outlets only).
- Expanded tier (fan funding, Shopping): 500 subscribers + 3 uploads in 90 days + 3,000 watch hours, or 3M Shorts views.

**Inauthentic content ⚠️** (renamed from "repetitious" on 2025-07-15). These cannot be monetised: templated storylines, image slideshows, scrolling text with little narrative, and the same situation with the same outcome. Every video needs its own structure, real commentary, and owner review.

**Format specs ⚠️.**
- Shorts: ≤3 min, vertical or square.
- End screens: last 5–20 s of a video ≥25 s long. Not available on made-for-kids videos.
- Chapters: start at `00:00`, ≥3 timestamps, each chapter ≥10 s.
- Thumbnails: the current Help page says up to 3840×2160 (minimum width 640), 2 MB on mobile and 50 MB on desktop. The API takes JPEG/PNG up to 50 MiB since July 2026. **We render 1280×720 PNG and keep files under 2 MB.**
- Loudness: YouTube publishes no official target. Normalise to −14 LUFS integrated with a −1 dBTP true-peak ceiling (community consensus).

**AI label ✅.** Not required for clearly animated content narrated by a generic TTS voice. Required if a real person appears to say or do something they did not, or if a real person's voice is synthesised.

**Disclosures ✅ (FTC 16 CFR 255, revised 2023-07-26).**
- Material connections (ownership, payment, free product, affiliate links) must be disclosed in the video, both spoken **and** on screen, and in the description near the links.
- Own product: say "I built this" / "This is my project" unless that is already obvious.
- Fake or AI-generated testimonials are banned (16 CFR 465), with civil penalties.
- YouTube paid-promotion box: tick it whenever a third party gives value. Default to ticking it for own-product promotion too, because YouTube's page counts own-brand endorsements when the relationship isn't clear ⚠️.

**Made for kids ✅.** The audience must be set on every video. Animated characters are a child-directed factor. The FTC penalty is up to $53,088 per violation (2025 level, not adjusted in 2026). Default for this studio is **"No, not made for kids"** (tech and crypto content for adults). Avoid kid-appeal styling: nursery palettes, toys, simple songs.

**Crypto ✅/⚠️.** YouTube bans cryptophishing (requests for wallet details), scams, and links to uncertified gambling, which since 2025-11-17 includes NFTs/items with monetary value ⚠️. SEC §17(b) requires disclosing compensation when touting a security. SEC/CFTC Release 33-11412 (2026-03-17) treats meme coins as "digital collectibles" ⚠️ (text not read). The FTC Act §5 bars deceptive claims. The UK FCA promotions regime applies to UK viewers wherever the creator is (criminal offence). **Script rules:**
- No price predictions, return or income claims, or "buy" calls.
- Disclose holdings.
- No giveaways or airdrops tied to buying.
- No third-party logos (Solana, Telegram, Pump.fun) without checking their brand rules.
- Synthetic demo data only: no real users' handles, wallets or messages.
- Any video that promotes the AAI coin itself needs legal review first.

**Music ⚠️.** YouTube Audio Library terms could not be verified here. Until the owner checks them: use only tracks marked "Attribution not required", or CC BY tracks with exact credit in the description. Don't reuse them off YouTube. Or use no music.

**Upload automation ⚠️ — manual upload for now.**
- Quota: 10,000 units/day plus a separate videos.insert bucket. The insert reference says 1 unit per call, 100 calls/day; the quota calculator still says 1,600 (conflict).
- Other costs: thumbnails.set 50, videos.update 50, captions.insert 400.
- Since 2026-11-02 ✅, uploads from unverified projects are no longer forced private, and **omitted `privacyStatus` defaults to public**. Always send `privacyStatus: private`.
- API-settable fields ✅: `status.selfDeclaredMadeForKids`, `status.containsSyntheticMedia`. `paidProductPlacementDetails` exists, but whether it can be written is unconfirmed. Keep that Studio step manual.
- OAuth refresh tokens expire after 7 days while the consent screen is in "Testing".
