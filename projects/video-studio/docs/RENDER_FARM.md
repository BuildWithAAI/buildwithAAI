# Render farm (GitHub Actions)

Renders run in parallel on free GitHub-hosted runners instead of one 4-core container in sequence. Every language and
every format is its own job: English, Spanish and Portuguese, long-form and Shorts, all at once, 8 at a time. Each
language's narration is voiced in parallel too (Kokoro, Zoo = `im_nicola`).

| Piece | Path |
| --- | --- |
| Workflow | `.github/workflows/video-render.yml` (repository root) |
| Requests | `projects/video-studio/render-requests/<id>.json` |
| Farm CLI | `projects/video-studio/scripts/farm/farm.ts` (each workflow step runs one subcommand) |
| Decrypt helper | `projects/video-studio/scripts/farm/decrypt.sh` |
| Example request | `projects/video-studio/scripts/farm/examples/episode-en-es-ptbr.json` |
| Tests | `node --test scripts/farm/tests/*.test.ts` (from `projects/video-studio`) |

> **The repository is public.** Anyone signed in to GitHub can read the run logs and download the artifacts
> ("People who are signed into GitHub and have read access to a repository can download workflow artifacts").
> So renders are **encrypted by default**, and nothing is uploaded until the owner has set the key
> (see [Set the key](#set-the-key-owner-once)). Do not upload or publish any video from here: this farm only produces
> files for the owner to review (docs/PROJECT_INSTRUCTIONS.md).

## How a run works

```
push render-requests/<id>.json ──► plan ──► voice (1 job per language) ──► render (1 job per output, 8 at a time) ──► summary
                                    │        Kokoro im_nicola, models      npm ci, narration unpacked,                one table:
                                    │        cached by sha256              npx remotion render|still, ffprobe,        resolution,
                                    │                                      encrypt, upload                            duration, size
                                    └─ validates every changed request; any problem stops the whole run
```

1. **plan** reads the request files the push added or changed (`git diff` of the push; deleted files are skipped),
   validates them strictly, and emits the job matrices. Props never enter the matrix, so they never reach job names
   or logs. Any invalid request, or an encrypted request while the key is missing, fails the plan and nothing renders.
2. **voice** runs `scripts/voice/setup.sh` and `scripts/voice/build.py` once per voice entry (one language each), on
   Python 3.13. The Kokoro model files are cached with `actions/cache`, keyed by the two model sha256s pinned in
   `setup.sh` (`kokoro-models-ae315a79…-bca610b8…`), so after the first run every voice job starts with the models
   already there; pip wheels are cached by `actions/setup-python`. ffmpeg (the voice step's loudness normalization)
   comes from a sha256-pinned PyPI wheel, `imageio-ffmpeg` 0.8.1 (a static ffmpeg 9.0.2 build with `loudnorm`), listed
   in `scripts/farm/ci-tools.txt`: the Ubuntu 24.04 image has no ffmpeg, and in the first live run `apt-get install
   ffmpeg` hung for over 4 minutes on 2 of 3 runners. The job packs `public/generated/<channel>/<slug>/<lang>/` into
   an artifact that lives for 1 day, and reports each narration's duration from its WAV header.
3. **render** runs one job per request job: `npm ci`, the narration it needs (only its own language when its props
   name `channel`, `slug` and `lang`, otherwise all of the request's), `npx remotion browser ensure` (Remotion downloads
   its own Chrome Headless Shell; `remotion.config.ts` only uses `/opt/pw-browsers` where that exists), then
   `npx remotion render` or `npx remotion still`, ffprobe (Remotion's bundled one), encryption, upload.
4. **summary** combines every job's probe record into one table on the run page.

The runner is Ubuntu 24.04, pinned on purpose: GitHub moves the `ubuntu-latest` label to Ubuntu 26.04 in November 2026
(actions/runner-images announcement), and a silent OS change is not wanted mid-production.

## Request a render

1. Write `projects/video-studio/render-requests/<id>.json`. The id is the file name: 1-64 lowercase letters, digits
   and dashes.
2. Check it locally: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/farm/farm.ts validate render-requests/<id>.json`
   (from `projects/video-studio`; with no file names it checks every request).
3. Commit and push it, on any branch. The push starts the workflow ("Video render farm" in the Actions tab).
   To render the same request again, change something in it (for example `retentionDays`) and push again.
4. Once the workflow file is on the default branch, it can also be started by hand: Actions → Video render farm →
   Run workflow, with the request id (or `gh workflow run video-render.yml --ref <branch> -f request=<id>`). GitHub
   only offers `workflow_dispatch` for workflows on the default branch.

Pushes that create a new branch are compared with the head commit's parent only (GitHub gives no base for them), so
push requests on a branch that already exists, or put them in the branch's last commit.

### Request format

```json
{
  "id": "episode-en-es-ptbr",
  "entry": "src/episode/index.ts",
  "encrypt": true,
  "retentionDays": 7,
  "voice": [
    {"channel": "zoora-ai", "slug": "pumpfun-top-caller", "lang": "en", "voice": "im_nicola"},
    {"channel": "zoora-ai", "slug": "pumpfun-top-caller", "lang": "es", "voice": "im_nicola"},
    {"channel": "zoora-ai", "slug": "pumpfun-top-caller", "lang": "pt-br", "voice": "im_nicola"}
  ],
  "jobs": [
    {"composition": "Episode", "kind": "video", "output": "out/episodes/pumpfun-top-caller/es/episode.mp4",
     "props": {"channel": "zoora-ai", "slug": "pumpfun-top-caller", "lang": "es"}},
    {"composition": "EpisodeShort", "kind": "video", "output": "out/episodes/pumpfun-top-caller/es/short-1.mp4",
     "props": {"channel": "zoora-ai", "slug": "pumpfun-top-caller", "lang": "es", "shortId": "short-1"}}
  ]
}
```

The full three-language example (3 voice jobs, 6 render jobs) is `scripts/farm/examples/episode-en-es-ptbr.json`.

| Field | Rules |
| --- | --- |
| `id` | Required. Must equal the file name without `.json`. |
| `entry` | Required. `src/index.ts` (TestCard, character sheets), `src/episode/index.ts` (Episode, EpisodeShort, thumbnails), `src/show/index.ts` (The Zoo & Badger Show, once it lands), `src/charts/dev/index.ts` (chart demos). |
| `jobs` | Required, 1-32. One render job each. |
| `jobs[].composition` | Required. Composition id, `[A-Za-z0-9-]`, 1-64 characters. |
| `jobs[].props` | Required JSON object (`{}` for none), at most 256 KiB. Written to a file and passed as `--props=<file>`; never printed. |
| `jobs[].output` | Required. A path under `out/` (letters, digits, `.`, `_`, `-`, `/`; no segment may start with `.`), at most 200 characters. `.mp4` for videos; `.png`, `.jpg` or `.jpeg` for stills. Unique within the request. |
| `jobs[].kind` | Required. `video` (`npx remotion render`) or `still` (`npx remotion still`). |
| `jobs[].frame` | Optional, stills only. Frame number, default 0. |
| `jobs[].entry` | Optional. Overrides `entry` for this job (same allowlist). |
| `voice` | Optional, 0-12. One voice job each. `channel` (lowercase, digits, dashes), `slug`, `lang` (`en`, `es`, `pt-br`, `hi`, `it`, `zh`; Japanese is blocked until a real G2P works, French has no male voice), `voice` (must be `im_nicola`: Zoo's voice in every language, owner decision 2026-11-24). Storyboards are read from `content/<channel>/<slug>/` (`storyboard.json` or `storyboard.<lang>.json`); the farm's own self-test uses `scripts/farm/fixtures/_farm/<slug>/`. |
| `encrypt` | Optional, default `true`. `false` is accepted only for test renders: every job from `src/index.ts` or `src/charts/dev/index.ts` and every voice entry on the `_farm` fixture channel. Episode, show and thumbnail renders are always encrypted. |
| `retentionDays` | Optional, 1-90, default 7. How long GitHub keeps the render artifacts. Narration and probe artifacts are kept 1 day. |

Unknown keys and wrong types are errors. Error messages name the field and the rule, never the value.
Per run: at most 16 changed request files, 128 render jobs and 48 voice jobs.

## Set the key (owner, once)

The farm encrypts with a passphrase stored as the repository secret `RENDER_ARTIFACT_KEY`.

1. Generate it on your own computer: `openssl rand -base64 48` (64 characters; at least 32 are required).
2. Save a copy in your password manager. Without it the artifacts cannot be decrypted, and GitHub never shows a
   secret again after it is saved.
3. On GitHub: the repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
   Name: `RENDER_ARTIFACT_KEY`. Value: the generated string, with no spaces or line breaks. **Add secret**.

Never commit the key, paste it into chat, or put it in a request. To rotate it, replace the secret; artifacts made
before the change still need the old key (they expire after `retentionDays` anyway).

If the secret is missing, shorter than 32 characters, or padded with spaces or line breaks, a push that holds an
encrypted request fails at the plan, before anything renders ("the repository secret RENDER_ARTIFACT_KEY is not set",
"RENDER_ARTIFACT_KEY is shorter than 32 characters"); the render and voice jobs check again before they start and
before they upload. The key is never printed. Plaintext of an encrypted
request is never uploaded: the upload folder is checked file by file (`.enc` name and openssl's `Salted__` header),
and a folder holding anything else is deleted and the job fails.

## Download and decrypt

From the run page (Actions → the run → **Artifacts**), download `render_<id>_<job>_<composition>[_<lang>]` (a .zip), or
with the GitHub CLI:

```bash
gh run download <run-id> --repo BuildWithAAI/buildwithAAI --pattern 'render_<id>_*' --dir ~/renders/<id>
```

Then, from `projects/video-studio`:

```bash
export RENDER_ARTIFACT_KEY='…'            # or --key-file ~/path/to/key.txt, or leave both out to be asked
scripts/farm/decrypt.sh ~/renders/<id> --out ~/renders/<id>/decrypted
scripts/farm/decrypt.sh ~/Downloads/render_ep_0_Episode_es.zip --out ~/renders/ep
```

Each artifact holds the encrypted output (`out/…/episode.mp4.enc`), an encrypted `<artifact>.sha256` checksum, and, for
encrypted requests, the encrypted tool log (`logs/<artifact>.log.enc`). decrypt.sh decrypts every `.enc` file, keeps
the folder layout, refuses to overwrite without `--force`, and verifies the checksums; a wrong key or a damaged file
fails without leaving output. The same files decrypt by hand with
`openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -in X.enc -out X -pass env:RENDER_ARTIFACT_KEY`
(`-md sha256` is OpenSSL 3's default; it is spelled out for LibreSSL on macOS).

Test requests (`encrypt: false`) upload plain files plus a plain checksum file.

## What reaches the public log

- Request ids, job numbers, composition ids, languages, output paths and the planned matrix.
- Per output: resolution, duration, frame rate, codecs, file size, render time (the summary tables).
- For encrypted requests, only a heartbeat while the tool runs, with frame counts parsed from Remotion's progress
  lines (numbers only). Everything Remotion or the voice build prints goes to a log file that is encrypted into the
  artifact.
- For test requests (`encrypt: false`), the tool output itself, wrapped in `::stop-commands::` so it cannot act as a
  workflow command.

Never printed: props, narration, storyboard text, the key. Remember that the request files and storyboards are
committed to a public repository, so they are public anyway; encryption protects the rendered media and the logs.

Other protections: the workflow token is read-only (`permissions: contents: read`); checkouts do not keep git
credentials; every action is pinned to a commit SHA (tag in a comment); values from files, the dispatch input and
the event reach scripts only through environment variables and are validated in `farm.ts`, never interpolated into
`run:` scripts; the key is given only to the steps that encrypt or decrypt, never to npm, Remotion or the voice
build; the workflow has no `pull_request` trigger, so forks cannot run it with the secret.

## Costs

- **Minutes: free.** GitHub: "Use of the standard GitHub-hosted runners is free and unlimited on public
  repositories", and the billing page lists standard GitHub-hosted runners "in public repositories" as free usage that
  does not reduce the included compute (docs.github.com, Actions billing and GitHub-hosted runners reference; source
  read from github/docs `main` at commit `e0b0c900`, 2026-11-24). Larger runners are billed even in public
  repositories; the farm uses only the standard `ubuntu-24.04` runner. If the repository ever becomes private, the
  same minutes are billed against the plan (standard Linux 2-core: $0.006 per minute).
  Measured: GitHub's usage API reports 0 billable milliseconds for every job of the self-test runs.
- **Runner size (public repositories):** 4 vCPU, 16 GB RAM, 14 GB SSD, x64. The farm renders with
  `REMOTION_CONCURRENCY=3`, the repo's tested setting, leaving a core for the encoder.
- **Storage.** GitHub's billing page measures artifact and cache storage against the plan for private repositories;
  it states no storage charge for public ones. The farm keeps artifacts short-lived anyway: renders 7 days by default
  (`retentionDays`), narration and probe records 1 day. The Actions cache is limited to 10 GB per repository and
  entries unused for 7 days are evicted; the Kokoro models (about 136 MiB) and the npm and pip caches fit well inside it.
- **Remotion licence:** unchanged by where the render runs. Free for individuals and companies of up to 3 people
  (CLAUDE.md, platform facts).

## Limits

| Limit | Value | What the farm does |
| --- | --- | --- |
| Job execution time (GitHub-hosted) | 6 hours, then the job fails | Render jobs stop at 340 minutes, leaving time to upload; voice jobs at 60. The summary's render time per output shows how close a long episode comes. |
| Matrix size | 256 jobs per workflow run | At most 128 render and 48 voice jobs per run. |
| Concurrent jobs (standard runners) | Free 20, Pro 40, Team 60, Enterprise 500 | `max-parallel: 8` per job type; the rest queue. |
| Artifact and log retention, public repositories | 1-90 days (default 90) | Renders `retentionDays` (default 7); narration and probes 1 day. |
| Workflow run time | 35 days | Not a concern. |
| Cache | 10 GB per repository; evicted after 7 days unused | Kokoro models, npm and pip caches. |
| Runner disk | 14 GB SSD | Each job renders one output; the encrypted copy needs as much space again. |
| Request files per push | 16 (farm limit) | Split bigger batches across pushes. |

Sources (all read 2026-11-24 from github/docs `main`, commit `e0b0c900`): Actions limits
(https://docs.github.com/en/actions/reference/limits), GitHub-hosted runners
(https://docs.github.com/en/actions/reference/runners/github-hosted-runners), Actions billing
(https://docs.github.com/en/billing/concepts/product-billing/github-actions), downloading artifacts
(https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts), artifact and log
retention, manually running a workflow, using secrets (secrets cannot be read in `if:` conditions and an unset secret
evaluates to an empty string), and the `paths` filter's diff rules. Runner image contents (no ffmpeg on Ubuntu 24.04,
the 26.04 move): actions/runner-images `images/ubuntu/Ubuntu2404-Readme.md`, image 20261116.376.1.

## Pinned actions

Resolved with `git ls-remote https://github.com/actions/<name>` on 2026-11-24; all are lightweight tags pointing at
commits at least a month old.

| Action | Tag | Commit |
| --- | --- | --- |
| actions/checkout | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` (the repo's existing pin) |
| actions/setup-node | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| actions/setup-python | v7.1.0 | `6d4fd22b20465ccc0f7354476588e8df7c9ca0e0` |
| actions/cache (restore, save) | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| actions/upload-artifact | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` (the repo's existing pin) |
| actions/download-artifact | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` |

## Self-test

- `render-requests/farm-selftest.json`: TestCard video and still, ChartTest still (PNG), ChartLight still (JPEG),
  ChartShort 1080x1920 video. Unencrypted.
- `render-requests/farm-selftest-voice.json`: Zoo's voice-check line voiced in en, es and pt-br in parallel from
  `scripts/farm/fixtures/_farm/voice-selftest/`; one TestCard job names the es narration in its props and receives
  only that track, the other receives all three. Unencrypted.
- `render-requests/farm-selftest-encrypted.json`: the same path with encryption on (one es narration, one TestCard
  video): the narration travels encrypted between jobs, and the artifact holds only ciphertext. It needs
  `RENDER_ARTIFACT_KEY`.

All are fast and non-sensitive. Push a change to any of them to run them. The Spanish and Portuguese fixture lines are
machine translations (`translation.status: "machine"`), so the voice step warns about them; they are test audio only.

## Measured on GitHub (2026-11-24)

Run [45344567383](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/45344567383): all 12 jobs passed, 2 min 27 s
from push to summary.

| Job | Time |
| --- | --- |
| plan | 16 s |
| 3 voice jobs (en, es, pt-br), in parallel | 45-49 s each: narration build 10-17 s; Kokoro models, pip wheels and ffmpeg all from cache |
| 7 render jobs, in parallel | 32-51 s each: `npm ci` 6 s (npm cache hit), browser download 2 s, a 3-second 1080p TestCard render 13 s |
| summary | 20 s |

- GitHub's usage API reports 0 billable milliseconds for all 12 jobs (public repository).
- ChartShort rendered at 1080x1920, 30 fps (the Shorts format).
- Narration hand-off: the job whose props name the es narration downloaded 1 artifact ("unpacked 1 narration track(s):
  es"); the job without them downloaded all 3 ("en, es, pt-br").
- Earlier runs: [45342983546](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/45342983546) was cancelled
  after `apt-get install ffmpeg` hung on 2 of 3 voice runners (replaced by the pinned wheel);
  [45344153170](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/45344153170) failed by design: its 6 test
  renders and 3 voice jobs passed, and the encrypted self-test was refused because the repository's
  `RENDER_ARTIFACT_KEY` is shorter than 32 characters. Nothing was uploaded for it.
- Episode render speed is not measured yet: no voiced storyboard exists in `content/` so far. The summary's render
  time per output will show it on the first episode.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Plan: "The plan failed; nothing was rendered" | The run summary lists each problem by file and field. Fix the request and push again. |
| "RENDER_ARTIFACT_KEY is not set" | Set the key (above). Test requests do not need it. |
| "RENDER_ARTIFACT_KEY is shorter than 32 characters" | Replace the secret with the output of `openssl rand -base64 48`, then push a change to `render-requests/farm-selftest-encrypted.json` to check the encrypted path. |
| "the entry src/show/index.ts does not exist in this commit" | The show entry has not landed on this branch yet. |
| "the narration voice_<id>_<n> is missing" | That voice job failed; open it in the same run. Encrypted voice logs are in its artifact under `logs/`. |
| Render failed | For test requests the log is in the job. For encrypted requests, download the artifact and decrypt `logs/<artifact>.log.enc`. |
| A job failed for an outside reason (network) | "Re-run failed jobs" on the run page works: artifacts are uploaded with `overwrite: true` and narration artifacts live for a day. |
| Nothing ran after a push | Only pushes that change `projects/video-studio/render-requests/**` start the workflow. |
| `gh run download` fails with "Forbidden" in a cloud session | Artifact downloads redirect to `*.blob.core.windows.net` (for example `productionresultssa0.blob.core.windows.net`), which a restricted session network blocks. Download on your own computer, or have the host allowed. |
