# Video Studio — 2D animated YouTube pipeline

Code-driven pipeline: topic → research → script → storyboard JSON → voice → Remotion render (long-form + Shorts) → thumbnails → `publish.md` → QA. All art is React/SVG drawn in code. No stock footage, no copyrighted assets.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Environment, Remotion + skills, 3 s test render, this file | **Done 2026-11-23** |
| 1 | `brand.json`, host character, 7 scene templates, transitions, lower third | Not started |
| 2 | Pilot: 60–90 s video, 1 Short, 3 thumbnails, `publish.md` | Blocked on owner inputs (see below) |
| 3 | One-command hardening, `channels.md` (10 niches), 4-week calendar | Not started |

Stop for owner review at the end of every phase.

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
| huggingface.co | **No** | Kokoro / Piper voice models (needs allowlist; HF downloads also redirect to CDN hosts) |
| github.com web/API for other repos, release assets | **No (403)** | Kokoro-onnx GitHub release assets are not a workaround |
| fonts.googleapis.com | Yes, but don't rely on it | Use `@fontsource/*` from npm so renders never fetch fonts |

Never widen network access silently: propose the exact host through the environment tools and let the owner approve. Never put API keys in files, env vars committed to git, or chat — use the secure credential form.

## Remotion rules for this repo

- `remotion.config.ts` sets: preinstalled browser, JPEG frames, `yuv420p`, BT.709, overwrite, concurrency 3 (`REMOTION_CONCURRENCY` overrides).
- The installed `remotion-render` skill says to use Remotion's bundled browser. That is impossible here (remotion.media blocked); the owner explicitly asked for the preinstalled browser, so keep `setBrowserExecutable`. On a machine with open network, unset it by removing `/opt/pw-browsers`-detection or setting `REMOTION_BROWSER_EXECUTABLE`.
- Every composition is driven by props (storyboard JSON). No hard-coded copy in templates.
- Durations come from voice audio (`calculateMetadata`), never guessed.
- Agent skills live in `.claude/skills/` (13 skills from `remotion-dev/skills`, commit pinned in `skills-lock.json`). Update with `npx skills update -p`. Read `remotion-best-practices` before writing compositions.

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

<!-- VERIFIED-FACTS -->
