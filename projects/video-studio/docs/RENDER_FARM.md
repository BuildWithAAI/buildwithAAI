# Render farm (GitHub Actions)

Renders run in parallel on free GitHub-hosted runners instead of one 4-core container in sequence. Every language and
every format is its own job: English, Spanish and Portuguese, long-form and Shorts, all at once, 8 at a time. Each
language's narration is voiced in parallel too (Kokoro, Zoo = `im_nicola`). Dubs are voiced into the English
timeline (`--fit-to en`) and exported as audio-only tracks, ready to add to the English video as multi-language audio.

| Piece | Path |
| --- | --- |
| Workflow | `.github/workflows/video-render.yml` (repository root) |
| Requests | `projects/video-studio/render-requests/<id>.json` |
| Gate receipts | `projects/video-studio/render-requests/receipts/<id>.json` (written by `farm.ts validate`, committed with the request, checked by `farm.ts check` before the push; `scripts/farm/receipt.ts`, the names search in `scripts/farm/privacy.ts`) |
| Farm CLI | `projects/video-studio/scripts/farm/farm.ts` (each workflow step runs one subcommand) |
| Gate before push | `projects/video-studio/scripts/farm/gates.ts` (runs the claim gate and the news gate) |
| Encryption | `projects/video-studio/scripts/farm/crypto.ts` (node:crypto only) |
| Public keys | `projects/video-studio/scripts/farm/keys/<recipient>.pub.pem` (see its `README.md`) |
| Decrypt tool | `projects/video-studio/scripts/farm/decrypt.sh` (unzips artifacts, then runs `decrypt.ts`) |
| Voice package locks | `projects/video-studio/scripts/farm/voice-lock.txt`, `voice-lock-cjk.txt` (made by `mklock.py`), `ci-tools.txt` |
| Example requests | `projects/video-studio/scripts/farm/examples/` |
| Tests | `node --test scripts/farm/tests/*.test.ts` (from `projects/video-studio`) |

> **The repository is public.** Anyone signed in to GitHub can read the run logs and download the artifacts
> ("People who are signed into GitHub and have read access to a repository can download workflow artifacts").
> So requests are **encrypted by default**, to the owner's **public** key: no step of the workflow holds a key that can
> decrypt an output, and nothing encrypted runs until the owner has committed that public key
> (see [Keys and secrets](#keys-and-secrets-owner-once)). Do not upload or publish any video from here: this farm only
> produces files for the owner to review (docs/PROJECT_INSTRUCTIONS.md).

## How a run works

```
push render-requests/<id>.json
  │
  ├─► plan ─────► voice ───────────────► voice-dub ─────────────────► render ──────────────────────► summary
  │   validate,   masters, 1 job per     dubs, after their master:   1 job per output, 8 at a       one table:
  │   gate every  language: Kokoro       master narration unpacked,  time: video, still or audio;   resolution,
  │   script      im_nicola, hash-locked  build.py --fit-to <master>  ffprobe; encrypt to the        duration, size
  │               packages, models                                    public key; upload
  │               cached by sha256
  └─ any problem in plan stops the whole run before a runner starts
```

1. **plan** reads the request files the push added or changed (`git diff` of the push; deleted files are skipped),
   validates them strictly, checks the checkout (entry files, storyboards, the recipient's public key), runs the claim
   gate on every script the requests voice or render with `--no-names` ([gate before push](#gate-before-push)),
   requires each request's [gate receipt](#gate-receipts-the-private-names-check) to match it, and emits the job
   matrices. Props never enter the matrix, so they never reach job names or logs. Any invalid request, failed gate,
   missing or stale receipt, missing public key, or (for an encrypted request that hands narration over) missing
   hand-off secret fails the plan, and nothing runs.
2. **voice** voices every native narration (the masters) in parallel, on Python 3.13. Before anything else runs, the
   voice packages install from the farm's hash lock (`scripts/farm/voice-lock.txt`: `--require-hashes
   --only-binary :all:`, so no package builds or runs code at install time; zh jobs add `voice-lock-cjk.txt`, see
   [Security](#security)). Then `scripts/voice/setup.sh` checks the Kokoro model files against their pinned sha256,
   and `scripts/voice/build.py` builds the narration. The model files are cached with `actions/cache`, keyed by the
   two model sha256s pinned in `setup.sh` (`kokoro-models-ae315a79…-bca610b8…`); pip wheels are cached by
   `actions/setup-python`. ffmpeg (the voice step's loudness normalization) comes from a sha256-pinned PyPI wheel,
   `imageio-ffmpeg` 0.8.1 (a static ffmpeg 9.0.2 build with `loudnorm`), listed in `scripts/farm/ci-tools.txt`: the
   Ubuntu 24.04 image has no ffmpeg, and in the first live run `apt-get install ffmpeg` hung for over 4 minutes on 2 of
   3 runners. The job packs `public/generated/<channel>/<slug>/<lang>/` into an artifact that lives for 1 day, and
   reports the narration's duration from its WAV header.
3. **voice-dub** runs after the masters, one job per dub (a voice entry with `fitTo`). It downloads its master's
   narration, unpacks it into `public/generated/<channel>/<slug>/<master>/`, and runs `build.py --fit-to <master>`, so
   every sentence of the dub lines up with the master's picture ([dubs](#multi-language-audio-tracks-dubs)). A dub that
   cannot fit (build.py exit 3) fails its job with a message to shorten the scenes it names.
4. **render** runs one job per request job: the narration it needs (only its own language when its props name
   `channel`, `slug` and `lang`, otherwise all of the request's), `npm ci`, `npx remotion browser ensure` (Remotion
   downloads its own Chrome Headless Shell; `remotion.config.ts` only uses `/opt/pw-browsers` where that exists), then
   `npx remotion render` (video), `npx remotion still` (still) or an audio-only render (audio), ffprobe (Remotion's
   bundled one), encryption, upload. In this job every step that reads the hand-off secret runs before `npm ci`.
5. **summary** combines every job's probe record into one table on the run page.

The runner is Ubuntu 24.04, pinned on purpose: GitHub moves the `ubuntu-latest` label to Ubuntu 26.04 in November 2026
(actions/runner-images announcement), and a silent OS change is not wanted mid-production.

## Request a render

1. Write `projects/video-studio/render-requests/<id>.json`. The id is the file name: 1-64 lowercase letters, digits
   and dashes. The weekly batch writes a draft per episode (`out/batch/<week>/<item>/render-request.json`,
   docs/WEEKLY_BATCH.md): copy it to `render-requests/<its id>.json` first (validate checks that the id equals the
   file name, and writes receipts only for files in `render-requests/`).
2. On the computer that has the private names list `data/private/names.txt` (normally the owner's: a fresh cloud
   checkout never has it, and an empty or made-up list is refused), from `projects/video-studio`, after the last edit
   to the request and to every script folder it names: add them to git, validate last, commit them with the receipt
   validate writes, check the commit, and push, on any branch the `render-farm` environment allows. Name every
   `content/<channel>/<slug>` the request voices or renders; `git status` first, because everything it lists goes
   public with the commit:

   ```bash
   git status --short --untracked-files=all -- render-requests/<id>.json content/<channel>/<slug>
   git add render-requests/<id>.json content/<channel>/<slug>
   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/farm/farm.ts validate render-requests/<id>.json \
     && git add render-requests/receipts/<id>.json \
     && git commit -m "Render <id>" -- render-requests/<id>.json render-requests/receipts/<id>.json content/<channel>/<slug> \
     && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/farm/farm.ts check render-requests/<id>.json \
     && git push
   ```

   `validate` (with no file names it checks every request) validates the request, checks the checkout, requires the
   request and its script folders to be added to git with no unstaged change, runs the claim gate WITH the names list
   on every script the request voices or renders, searches every file of those folders and the request itself for the
   names, and writes the request's [gate receipt](#gate-receipts-the-private-names-check),
   `render-requests/receipts/<id>.json` ("gate receipt … written"; "unchanged" when the one there still matches).
   Push nothing it refuses: a pushed storyboard is public for good. A request that fails loses its receipt. `check`
   (no names list needed) runs the plan's receipt check on the committed files, so a stale receipt is never pushed.
   The `&&` chain stops at the first step that fails: if validate refuses, nothing is committed; if check refuses,
   nothing is pushed (fix it and amend the commit first).
3. The push starts the workflow ("Video render farm" in the Actions tab). Any edit after validate makes the receipt
   stale and the plan refuses the request. To render the same request again, change something in it (for example
   `retentionDays`) and run step 2 again: a push that changes only receipts or script folders starts no run.
4. Once the workflow file is on the default branch, it can also be started by hand: Actions → Video render farm →
   Run workflow, with the request id (or `gh workflow run video-render.yml --ref <branch> -f request=<id>`). GitHub
   only offers `workflow_dispatch` for workflows on the default branch. The plan checks the receipt the same way.

Pushes that create a new branch are compared with the head commit's parent only (GitHub gives no base for them), so
push requests on a branch that already exists, or put each request with its receipt and its script folders in the
branch's last commit (step 2 makes them one commit). A run that sees a receipt change without its request warns that
the request was not rendered. Tag pushes never start a run: the trigger names branches only.

### Request format

The three-language episode example, `scripts/farm/examples/episode-en-es-ptbr.json` (3 voice jobs, 6 render jobs):

```json
{
  "id": "episode-en-es-ptbr",
  "entry": "src/episode/index.ts",
  "encrypt": true,
  "retentionDays": 7,
  "voice": [
    {"channel": "zoora-ai", "slug": "pumpfun-top-caller", "lang": "en", "voice": "im_nicola"},
    {"channel": "zoora-ai", "slug": "pumpfun-top-caller", "lang": "es", "voice": "im_nicola", "fitTo": "en"},
    {"channel": "zoora-ai", "slug": "pumpfun-top-caller", "lang": "pt-br", "voice": "im_nicola", "fitTo": "en"}
  ],
  "jobs": [
    {"composition": "Episode", "kind": "video", "output": "out/publish/zoora-ai/pumpfun-top-caller/media/long.mp4",
     "props": {"channel": "zoora-ai", "slug": "pumpfun-top-caller", "lang": "en"}},
    {"composition": "EpisodeShort", "kind": "video", "output": "out/publish/zoora-ai/pumpfun-top-caller/media/short-1.mp4",
     "props": {"channel": "zoora-ai", "slug": "pumpfun-top-caller", "lang": "en", "shortId": "short-1"}},
    {"composition": "Episode", "kind": "audio", "output": "out/publish/zoora-ai/pumpfun-top-caller/media/dubs/es/long.wav",
     "props": {"channel": "zoora-ai", "slug": "pumpfun-top-caller", "lang": "es"}}
  ]
}
```

(The example file also exports the pt-br long-form track and the Short's es and pt-br tracks.)

| Field | Rules |
| --- | --- |
| `id` | Required. Must equal the file name without `.json`. |
| `entry` | Required. `src/index.ts` (TestCard, character sheets), `src/episode/index.ts` (Episode, EpisodeShort, thumbnails), `src/show/index.ts` (The Zoo & Badger Show), `src/charts/dev/index.ts` (chart demos). |
| `jobs` | Required, 1-32. One render job each. |
| `jobs[].composition` | Required. Composition id, `[A-Za-z0-9-]`, 1-64 characters. |
| `jobs[].props` | Required JSON object (`{}` for none), at most 256 KiB. Written to a file and passed as `--props=<file>`; never printed. Jobs from `src/episode/index.ts` or `src/show/index.ts` must name `channel` and `slug` (the farm gates that script). |
| `jobs[].kind` | Required. `video` (`npx remotion render`), `still` (`npx remotion still`) or `audio` (`npx remotion render --codec=wav\|aac\|mp3`: the composition's full sound mix and no picture, with the farm's audio config `scripts/farm/remotion.audio.config.ts`, because the studio config's x264 settings are refused with an audio codec). |
| `jobs[].output` | Required. A path under `out/` (letters, digits, `.`, `_`, `-`, `/`; no segment may start with `.`), at most 200 characters. `.mp4` for videos; `.png`, `.jpg` or `.jpeg` for stills; `.wav`, `.m4a` (AAC) or `.mp3` for audio. Unique within the request. |
| `jobs[].frame` | Optional, stills only. Frame number, default 0. |
| `jobs[].entry` | Optional. Overrides `entry` for this job (same allowlist). |
| `voice` | Optional, 0-12. One voice job each. `channel` (lowercase, digits, dashes), `slug`, `lang` (`en`, `es`, `pt-br`, `hi`, `it`, `zh`; Japanese is blocked until a real G2P works, French has no male voice), `voice` (must be `im_nicola`: Zoo's voice in every language, owner decision 2026-11-24). Storyboards are read from `content/<channel>/<slug>/` (`storyboard.json` or `storyboard.<lang>.json`); the farm's own self-test uses `scripts/farm/fixtures/_farm/<slug>/`. |
| `voice[].fitTo` | Optional. Makes the entry a dub for a multi-language audio track: it is voiced into the timeline of the named master language (`scripts/voice/build.py --fit-to`). The master must be a native entry (no `fitTo`) of the same channel and slug in the same request, and must differ from `lang`. The farm voices masters first and dubs after. |
| `encrypt` | Optional, default `true`. `false` is accepted only when every job renders one of the listed test compositions and every voice entry is on the `_farm` fixture channel. The list is by composition **and** entry (`TEST_COMPOSITIONS` in `scripts/farm/request.ts`): TestCard, ZooSheet, BadgerSheet, MouthDemo and Preview10s from `src/index.ts`; ChartTest, ChartLight, ChartShort and ChartReveal from `src/charts/dev/index.ts`. A new composition, even in `src/index.ts`, is encrypted until someone adds it to that list on purpose. Episode, show and thumbnail renders are always encrypted. |
| `recipient` | Optional, default `owner`: whose public key (`scripts/farm/keys/<recipient>.pub.pem`) encrypts the outputs. `selftest` is accepted only for the test compositions. |
| `retentionDays` | Optional, 1-90, default 7. How long GitHub keeps the render artifacts. At most **7** for an unencrypted request, whose files anyone can download. Narration and probe artifacts are kept 1 day. |

Unknown keys and wrong types are errors. Error messages name the field and the rule, never the value.
Per run: at most 16 changed request files, 128 render jobs and 48 voice jobs (masters and dubs together).

## Gate before push

A request renders storyboards that are committed to this public repository, so the script is public the moment the
request is pushed, and history is never rewritten. The claim gate (CLAUDE.md, Channel 2 pipeline step 2) must therefore
pass **before** the push. `farm.ts validate` (locally) and the `plan` job (on GitHub) both run, for every episode or
show the request voices or renders, as the storyboard is in that commit:

| Gate | When |
| --- | --- |
| `node scripts/claims/check.ts content/<channel>/<slug> --lang <lang>` | Every voice entry and every job from `src/episode/index.ts` or `src/show/index.ts` (one run per channel, slug and language) |
| `node scripts/news/gate.ts <slug>` | Also, for a `zoora-security` item that has a `brief.json` (the daily news) |

A failing gate refuses the request ("the claim gate FAILS. Fix the script before pushing it"), as does a gate that is
missing from the checkout or could not check the script (it crashed, or could not read the storyboard: FAILS is said
only when the gate's own report says so). The gates run as child processes with their output captured and never
printed: a gate report quotes the script, and the CI log is public. Each run's report goes to a private folder (mode
0700, a unique name, in the system temp folder) that is deleted right after, so neither another user of the machine
nor a second validate running at the same time can read, swap or delete it. Only the channel, slug, language and the
verdict are reported. Test renders and the `_farm` fixtures are not gated.

A script folder that holds `storyboard.en.json` is refused, by validate and by the plan: English lives in
`storyboard.json`, which the episode, show and thumbnail renderers always read for en, while the claim gate and the
voice build would read `storyboard.en.json` first, so the file that renders would go unchecked.

The plan's check is the backstop: once the plan runs, the push has already published the script. Run `validate` first.

### Gate receipts (the private names check)

The claim gate also checks every script against the private names list, `data/private/names.txt`: the real names and
handles behind every `[named person]` in the research. That list is gitignored and must never reach the repository or
CI, so the two runs differ:

| Where | Claim gate | Then |
| --- | --- | --- |
| `farm.ts validate` (wherever the list exists, normally the owner's computer) | With the list (`--names data/private/names.txt`). The farm reads the gate's own report back (never printed) to confirm the names were checked, and itself searches every file the receipt will bind, and every string of the request, for the names. Without the list ("data/private/names.txt is not on this computer"), or with a list that has no usable entries, a request with scripts fails and no receipt changes. Refused inside GitHub Actions. | Writes `render-requests/receipts/<id>.json` |
| `plan` (GitHub) | `--no-names`: every other rule still runs on the pushed commit | Requires that receipt to match |

The receipt binds "every claim gate of this request passed with the private names checked" to what git commits:

- `requestBlob`: the git blob id of the request file (`git hash-object`: what `git add` stores);
- per gate target (`channel`, `slug`, `lang`; `null` = the storyboard's own language): `claims: "pass"`,
  `names: "checked"` and `contentSha256`, a sha256 over every file in `content/<channel>/<slug>/` that git does not
  ignore (sorted relative paths, each with its git blob id), so any edit, added, removed or renamed file makes it
  stale. Files git ignores are left out (they are never committed, so CI never has them); a symbolic link in a script
  folder is refused;
- `claimGate`: `codeSha256`, the same kind of hash over the claim gate's code (`scripts/claims/check.ts` and every file
  it imports at run time, `src/episode/markup.ts` and `scripts/dub/lib` included), and `commit`, the last commit that
  touched that code. The plan refuses a receipt whose gate code differs from the pushed commit's, so a receipt written
  by a locally edited gate, or by a gate that changed since, does not pass;
- `kind`, `schema` (2), `validatedAt` (ISO time) and `digest`, a sha256 over the rest, so a hand edit shows. Key order
  and whitespace do not matter.

The hashes are git's, so line endings do not matter: a checkout that turns LF into CRLF (`core.autocrlf`, the Git for
Windows default) or a file an editor saved with CRLF hashes the same as CI's LF checkout.

Before the gates run, validate refuses, and writes no receipt, when:

- a file of the request or of a script folder is **not added to git** (an untracked note, a Finder `.DS_Store`): the
  receipt would bind it, CI has only what is committed, and once committed it is public. Add what may be public;
  delete or gitignore the rest (`git status --short --untracked-files=all content/<channel>/<slug>` lists them);
- a file has **changes git has not staged**: add them (or undo them), so the receipt binds what you commit;
- the **claim gate's code** has uncommitted changes (not a verdict on the request: receipts are left as they are);
- a **private name** is in any file of a script folder, its name or its text (research.md, notes, storyboards of
  languages the request does not render, back-translations), or in any string of the request, props included. The
  claim gate looks for the names only in what a script says or shows, in the languages the request targets; the commit
  publishes everything. The message names the file or JSON path and the entry number, never the name;
- a script folder holds `storyboard.en.json` ([gate before push](#gate-before-push)).

After the gates, validate hashes everything again and refuses if anything changed while they ran (an editor autosave,
a dub import, another session): "… changed while validate ran (after the claim gate read it)". Nothing may write to
the request's script folders while validate runs.

It holds **no private data**: no names, no hash, size or line count of the names list (a hash of a short list can be
found by trying names), no gate report text. Everything in it is a request id, a channel, slug or language that the
request names anyway, or a git blob id of a file that is committed with the request, and so public once pushed. A
receipt pushed while it is stale still publishes the blob ids of the files as validate saw them, which can confirm a
guess at text that was edited out before the commit: that is why `farm.ts check` runs before every push.

The plan refuses the request, in one line that ends with the fix ("CI checks scripts without the private names list:
on your computer (it needs data/private/names.txt) change the request (for example retentionDays), git add it and its
script folders, run "node scripts/farm/farm.ts validate render-requests/<id>.json", then commit the request, its
receipt and those folders together (a push of receipts or content/ alone starts no run)"), when the receipt is
missing, is not valid JSON or not one validate writes, was changed after validate wrote it (digest), is for another
request, is stale (the request file or a script folder changed, or holds a file that was never committed), does not
cover every gate target of the request (or lists one the request does not gate), or was written by other claim gate
code.

- **No diff when nothing changed.** Validating again leaves a receipt that still proves the same thing untouched; it is
  rewritten when the request, a script folder or the claim gate's code changes.
- **A failing request loses its receipt, in the working tree only.** When validate refuses a request in
  `render-requests/` on a computer that has the names list (a script fails, a new name in the list matches it, a
  storyboard is missing), it deletes `render-requests/receipts/<id>.json`. It does not touch git: a receipt you already
  staged or committed is still in the index or in that commit, `git push` sends it, and the plan accepts it, because
  the request and its script folders in that commit are unchanged (validate says so when this happens). So after a
  failing validate, push nothing: fix the script, validate again, and amend the unpushed commit (`git commit --amend`,
  or `git reset` and commit again) so that no commit you push holds the failing script or its old receipt. A pushed
  commit is public for good, even when a later commit fixes it. After adding names to the list, run `farm.ts
  validate` (every request) again before any push. A computer without the list never removes a receipt: it could not
  make it again.
- **A receipt is never a request.** The plan lists receipts apart from request files, and the workflow's push trigger
  leaves `render-requests/receipts/**` out: a push that changes only receipts (or only script folders) starts no run,
  and a run that sees a receipt change without its request warns that the request was not rendered. To render after
  fixing a receipt, change something in the request (for example `retentionDays`), validate again, and push the
  request with its receipt. Once the workflow is on the default branch (step 4), you can instead push the receipt and
  run the workflow by hand with the request id.
- **An empty names list** (an empty file, only comments, or only entries shorter than 3 characters) passes the claim
  gate (its own rule) but compares nothing, so validate refuses it and writes no receipt. Never create the list to get
  past "is not on this computer": only the owner fills it, with the real names.

## Multi-language audio tracks (dubs)

The studio publishes Spanish and Portuguese as **dub tracks on the English video** (YouTube Studio → Languages → Add
language → Dub, a manual Studio step; docs/research/dubbing-and-regions-2026-11-24.md and docs/WEEKLY_BATCH.md). A dub
track must line up with the English picture, so:

1. The request voices the English master natively and each dub with `"fitTo": "en"`. The `voice-dub` job downloads
   the English narration and voices the dub into its timeline (`build.py --fit-to en`). The voice step's own fit rules
   apply: it speeds a sentence up within its limits and warns when a dub sentence still ends after the English one.
2. An `audio` job per video exports the dub's full mix (narration, music and effects, as the composition plays them) as
   WAV, for example `out/publish/<channel>/<slug>/media/dubs/es/long.wav`, next to the publish kit's media.
3. After decrypting, the owner adds each reviewed track in Studio. The weekly batch's farm drafts already contain the
   dub voice entries and audio jobs, and the weekly page lists the tracks that are ready.

The farm's own self-test (`render-requests/farm-selftest-voice.json`) voices an English master and es and pt-br dubs
fitted to it, and exports the pt-br dub as a WAV track.

## Keys and secrets (owner, once)

Two separate keys, for two separate jobs:

| Key | Encrypts | Who can decrypt | Where it lives |
| --- | --- | --- | --- |
| The owner's RSA key pair | Every output of an encrypted request: renders, checksums, tool logs | Only the private key, on the owner's computer | Public half committed at `scripts/farm/keys/owner.pub.pem`; private half never leaves the owner's computer |
| `RENDER_HANDOFF_KEY` | Only the narration the voice jobs hand to the dub and render jobs (artifacts kept 1 day) | The workflow, to unpack narration | A secret of the GitHub Environment `render-farm` |

### 1. The owner's key pair (outputs)

On the owner's computer, from `projects/video-studio` (the same steps are in `scripts/farm/keys/README.md`):

```bash
mkdir -p ~/.zoora && chmod 700 ~/.zoora
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -aes-256-cbc -out ~/.zoora/farm-owner.key
openssl pkey -in ~/.zoora/farm-owner.key -pubout -out scripts/farm/keys/owner.pub.pem
git add scripts/farm/keys/owner.pub.pem && git commit -m "Render farm: the owner's public key"
```

`-aes-256-cbc` protects the private key file with a passphrase. Keep a backup of `~/.zoora/farm-owner.key` and its
passphrase in a password manager: without them, encrypted artifacts cannot be opened. Never commit, paste or upload the
private key. The farm refuses public keys that are not RSA or are shorter than 3072 bits. To rotate, commit a new
public key; artifacts made before still need the old private key (they expire after `retentionDays` anyway).

Until `owner.pub.pem` is committed, the plan refuses every encrypted request ("scripts/farm/keys/owner.pub.pem is not in
this commit. The owner creates his key pair once and commits only the public key…"). Only test requests run.

### 2. The narration hand-off secret

```bash
openssl rand -base64 48 | gh secret set RENDER_HANDOFF_KEY --env render-farm --repo BuildWithAAI/buildwithAAI
```

Or on GitHub: the repository → **Settings** → **Environments** → `render-farm` → **Environment secrets** → **Add
secret**, name `RENDER_HANDOFF_KEY`, value the output of `openssl rand -base64 48` (64 characters, no spaces or line
breaks; at least 32 are required). Nobody needs to know or keep the value: it only protects narration inside one run.

Store it **only** as an environment secret, never as a repository secret: a repository secret is readable by a
workflow on any branch.

If an encrypted request hands narration over (it has voice entries) and the secret is missing, shorter than 32
characters, or padded with spaces or line breaks, the plan fails before anything runs ("the secret RENDER_HANDOFF_KEY is
not set", "RENDER_HANDOFF_KEY is shorter than 32 characters"). The secret is never printed.

### 3. Protect the environment

The workflow's jobs that read the secret run in the GitHub Environment `render-farm`. GitHub created it on the first
run that named it, and "the newly created environment will not have any protection rules or secrets configured"
(GitHub docs, deployments and environments). Settings → Environments → `render-farm` → **Deployment branches and
tags** → **Selected branches and tags** → add the branch patterns that may render (for example the owner's working
branch). A job on any other branch then cannot start, so a workflow edit pushed there cannot read the secret.

### 4. Remove the old secret

The farm no longer reads the repository secret `RENDER_ARTIFACT_KEY` (it was the symmetric key of the first version,
and it was too short). Delete it: Settings → Secrets and variables → Actions → `RENDER_ARTIFACT_KEY` → Remove.

## Download and decrypt

From the run page (Actions → the run → **Artifacts**), download `render_<id>_<job>_<composition>[_<lang>]` (a .zip), or
with the GitHub CLI:

```bash
gh run download <run-id> --repo BuildWithAAI/buildwithAAI --pattern 'render_<id>_*' --dir ~/renders/<id>
```

Then, from `projects/video-studio` (Node 22 or later):

```bash
export FARM_KEY_PASSPHRASE='…'   # the private key's passphrase (or leave it out on a key without one)
scripts/farm/decrypt.sh --key ~/.zoora/farm-owner.key --out ~/renders/<id>/decrypted ~/renders/<id>
scripts/farm/decrypt.sh --key ~/.zoora/farm-owner.key --out ~/renders/ep ~/Downloads/render_ep_0_Episode_es.zip
```

Each artifact holds the encrypted output (`out/…/long.mp4.enc`), an encrypted `<artifact>.sha256` checksum, and the
encrypted tool log (`logs/<artifact>.log.enc`). `decrypt.sh` unzips, decrypts every `.enc` file, keeps the folder
layout, refuses to overwrite without `--force`, and verifies the checksums. A wrong key, another recipient's file, or
a changed or truncated file fails without leaving output. Exit codes: 0 all decrypted and verified, 1 a file failed,
2 bad usage.

The format (`scripts/farm/crypto.ts`): each file gets a random 256-bit key and a random 96-bit IV for AES-256-GCM; the
file key is wrapped with RSA-OAEP (SHA-256) to the recipient's public key. The header (magic `ZFARMPK1`, the sha256 of
the recipient's public key, the wrapped key, the IV) is authenticated with the data, so no part can be swapped. There
is no openssl one-liner for it; use `decrypt.ts`.

Test requests (`encrypt: false`) upload plain files plus a plain checksum file.

## What reaches the public log

- Request ids, job numbers, composition ids, languages, output paths and the planned matrix.
- Per output: resolution, duration, frame rate, codecs, file size, render time (the summary tables).
- Gate failures: the channel, slug and language that failed, and the command to run locally (never the report).
- Gate receipts: whether each matches (with the time validate wrote it), or what is wrong with it, by file and target;
  a warning naming a request whose receipt changed without it (it was not rendered).
- For encrypted requests, only a heartbeat while the tool runs, with frame counts parsed from Remotion's progress
  lines (numbers only). Everything Remotion or the voice build prints goes to a log file that is encrypted into the
  artifact.
- For test requests (`encrypt: false`), the tool output itself, wrapped in `::stop-commands::` so it cannot act as a
  workflow command.

Never printed: props, narration, storyboard text, gate reports, keys. Remember that the request files and storyboards
are committed to a public repository, so they are public anyway (hence the gate before push); encryption protects the
rendered media and the logs.

## Security

- **Outputs:** encrypted to a public key; no CI step holds a key that can decrypt them. The upload folder of an
  encrypted request is checked file by file (`.enc` name and the farm's header) before upload, and a folder holding
  anything else is deleted and the job fails.
- **Encryption runs inside Node** (`node:crypto`): no step that holds a key runs an encryption tool looked up through
  `PATH`.
- **The hand-off secret** is read only by the steps that pack or unpack narration. In the dub and render jobs, every
  step that unpacks runs before any third-party package is installed. It decrypts only narration, kept 1 day, of scripts
  that are already public in the repository.
- **Voice packages** install from the farm's hash lock, binary wheels only, before `setup.sh`, so `setup.sh`'s own
  `pip install` finds everything satisfied and fetches nothing. `lock.test.ts` fails when the lock and
  `scripts/voice/requirements*.txt` disagree.
- **Token and actions:** the workflow token is read-only (`permissions: contents: read`); checkouts do not keep git
  credentials; every action is pinned to a commit SHA (tag in a comment); values from files, the dispatch input and the
  event reach scripts only through environment variables and are validated in `farm.ts`, never interpolated into
  `run:` scripts; the workflow has no `pull_request` trigger, so forks cannot run it with the secret.

Known residual risks (accepted, stated plainly):

- Steps of one job share one runner user, so a step that runs after third-party code can be tampered with by it
  (`GITHUB_PATH`, `GITHUB_ENV`, the node binary). The voice and dub jobs' **pack** step reads `RENDER_HANDOFF_KEY`
  after the voice build has run the hash-pinned Python packages. A malicious pinned package could therefore read the
  hand-off secret, which opens only 1-day narration of public scripts; it can never open an output.
- zh voice jobs also install `voice-lock-cjk.txt` without `--only-binary`: three of its packages (jieba, unidic-lite,
  mojimoji) ship only as source, so their exact archives are hash-pinned but built on the runner, and pip fetches their
  build tools (setuptools, Cython) without hash checks.
- Anyone who can push to a branch the `render-farm` environment allows can change the workflow and read the hand-off
  secret. Keep that branch list short (step 3 above).
- A gate receipt is evidence, not a signature: anyone who can push can write one with the farm's own code without
  having the names list, and nothing in it proves where validate ran or that the list held the real names (a
  placeholder list cannot be told from the real one without reading it; only a signed receipt would close that, and
  none is built). It stops the accidents (a request pushed without validate, a script edited after it, a hand-edited
  or half-merged receipt, a claim gate edited locally), not a malicious pusher, who could as well change the workflow.
  The names check is only as current as the last `validate` against the current list.

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
- **Environments:** environment secrets and deployment-branch rules are available for public repositories on every
  plan (GitHub docs, deployments and environments).
- **Remotion licence:** unchanged by where the render runs. Free for individuals and companies of up to 3 people
  (CLAUDE.md, platform facts).

## Limits

| Limit | Value | What the farm does |
| --- | --- | --- |
| Job execution time (GitHub-hosted) | 6 hours, then the job fails | Render jobs stop at 340 minutes, leaving time to upload; voice and dub jobs at 60. The summary's render time per output shows how close a long episode comes. |
| Matrix size | 256 jobs per workflow run | At most 128 render and 48 voice jobs per run. |
| Concurrent jobs (standard runners) | Free 20, Pro 40, Team 60, Enterprise 500 | `max-parallel: 8` per job type; the rest queue. |
| Artifact and log retention, public repositories | 1-90 days (default 90) | Renders `retentionDays` (default 7, at most 7 unencrypted); narration and probes 1 day. |
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
evaluates to an empty string), and the `paths` filter's diff rules. Environments (read the same day from github/docs
`main`): https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments ("Running a
workflow that references an environment that does not exist will create an environment with the referenced name";
"Secrets stored in an environment are only available to workflow jobs that reference the environment") and
https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments. Runner image
contents (no ffmpeg on Ubuntu 24.04, the 26.04 move): actions/runner-images `images/ubuntu/Ubuntu2404-Readme.md`, image
20261116.376.1.

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
- `render-requests/farm-selftest-voice.json`: Zoo's voice-check line voiced in en, then es and pt-br as dubs fitted to
  the en timeline, from `scripts/farm/fixtures/_farm/voice-selftest/`. One TestCard video names the es dub in its
  props and receives only that track; an audio job exports the pt-br dub's mix as WAV; a still receives all three.
  Unencrypted.
- `render-requests/farm-selftest-encrypted.json`: a TestCard video and an audio-only M4A, encrypted to the `selftest`
  public key (`scripts/farm/keys/selftest.pub.pem`): the artifacts hold only ciphertext. No narration, so no hand-off
  secret is needed.
- `scripts/farm/examples/farm-selftest-handoff.json`: the full encrypted path with narration (hand-off secret, then
  outputs to the owner's key). Copy it into `render-requests/` once the owner's public key and `RENDER_HANDOFF_KEY` are
  set, push, then download and decrypt its artifacts with the owner's private key.

All are fast and non-sensitive, and render no script, so they need no gate receipt. Push a change to any request file
in `render-requests/` to run it. The Spanish and Portuguese
fixture lines are machine translations (`translation.status: "machine"`), so the voice step warns about them; they are
test audio only.

## Measured on GitHub (2026-11-24)

Run [45436420098](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/45436420098) (commit `dfc964d`, all three
self-tests on the farm code before gate receipts): all 15 jobs passed, 4 min 8 s from push to summary: plan 21 s; the en master 41 s;
the es and pt-br dubs 75 s and 52 s; 10 render jobs 27-52 s each (TestCard video and still, ChartTest and ChartLight
stills, ChartShort at 1080x1920, the es dub video, the pt-br dub WAV track at 48 kHz stereo, and the encrypted MP4 and
M4A, each "3 file(s) staged, all encrypted to the "selftest" public key"); summary 21 s.

Run [45430445337](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/45430445337) (commit `5f7e796`, the first
run of the public-key and dub version, voice and encrypted self-tests only): all 10 jobs passed, 2 min 53 s from push
to summary.

| Job | Time |
| --- | --- |
| plan | 13 s |
| voice: en master | 29 s (narration build 5.9 s; packages, models and ffmpeg from cache) |
| voice-dub: es and pt-br, fitted to en, in parallel | 57-59 s each (master narration unpacked; es built in 13.7 s with `fit-to=en`) |
| 5 render jobs, in parallel | 37-48 s each: a 3-second 1080p TestCard video 18.2-18.9 s, an audio-only render 10.5-13.4 s |
| summary | 7 s |

- Encrypted self-test: "pack: 3 file(s) staged, all encrypted to the "selftest" public key" for the MP4 and for the
  M4A (3.008 s, 122,462 bytes before encryption), with no secret in the step.
- Dubs: each dub job unpacked the en master and voiced with `fit-to=en`. The es fixture's second sentence still ends
  125 ms after the English one, and the voice step says so in a warning (machine-translated test line).
- Narration hand-off: the es video job downloaded 1 track ("unpacked 1 narration track(s): es"); the still downloaded
  all 3 ("en, es, pt-br"); the pt-br audio job exported a 3 s WAV (576,078 bytes).
- Not yet run on GitHub: the hand-off of **encrypted** narration and outputs to the owner's key. Both need the owner's
  steps above; `scripts/farm/examples/farm-selftest-handoff.json` is the request that proves them. The same code path
  (hand-off cipher, public-key outputs, decrypt.sh with the private key, checksums) is covered by
  `scripts/farm/tests/crypto.test.ts` and `farm.test.ts`, and it was run end to end in the build session on
  2026-11-24, each job in its own folder as on GitHub: `validate`, `plan`, an encrypted en master, an es dub fitted to
  it after unpacking the encrypted master, and an es video and an es WAV track rendered from the encrypted dub. Every
  staged file was ciphertext (`ZFARMHO1` narration, `ZFARMPK1` outputs and logs); `decrypt.sh` with the self-test
  private key restored the MP4 (h264 1920x1080, 3.0 s) and the WAV (48 kHz stereo, 3.0 s), and the checksums matched.
  A direct render of the same encrypted self-test decrypted byte-identical to the file Remotion wrote. (The self-test
  private key was made for that check only; it is not in the repository or on GitHub.)
- Not yet run on GitHub: gate receipts (2026-11-24). The self-tests have no gate targets, so the plan's `--no-names`
  claim gate and the receipt check run only for a real episode or show request; such a request is encrypted to the
  owner, so none can run before `owner.pub.pem` is committed (and one with voice needs `RENDER_HANDOFF_KEY`). The push
  filter's `!…/receipts/**` and the branches-only trigger have not been seen on GitHub yet. Covered locally by
  `scripts/farm/tests/receipt.test.ts` (validate, plan and check in throwaway git projects, a CRLF owner clone with a
  clean CI clone, and the real claim gate on its fixture with an invented names list), `gates.test.ts`, `plan.test.ts`
  and `workflow.test.ts`. The first real request is the live test: its plan summary must say the gate receipts match.
- Earlier runs: [45344567383](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/45344567383) (12 jobs, 2 min
  27 s, the first version); [45342983546](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/45342983546) was
  cancelled after `apt-get install ffmpeg` hung on 2 of 3 voice runners (replaced by the pinned wheel);
  [45344153170](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/45344153170) refused the first version's
  encrypted self-test because the old `RENDER_ARTIFACT_KEY` was shorter than 32 characters (nothing was uploaded).
- Episode render speed is not measured yet: no voiced storyboard exists in `content/` so far. The summary's render
  time per output will show it on the first episode.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Plan: "The plan failed; nothing was rendered" | The run summary lists each problem by file and field. Fix the request and push again. |
| "scripts/farm/keys/owner.pub.pem is not in this commit" | The owner's key pair is not set up yet (step 1 above). Test requests do not need it. |
| "the secret RENDER_HANDOFF_KEY is not set" / "is shorter than 32 characters" | Set the environment secret (step 2 above), then push a change to the request. Requests without voice entries do not need it. |
| "the claim gate FAILS" / "could not check it" | Run the printed `node scripts/claims/check.ts …` command locally, fix the script, validate again. Never push a script that fails. |
| "no gate receipt (render-requests/receipts/<id>.json)" | The request was pushed without its receipt. On the computer with `data/private/names.txt`, change something in the request (for example `retentionDays`), then run step 2 of [Request a render](#request-a-render) once: add, validate, commit the request and its receipt together, check, push. Once the workflow is on the default branch (step 4), you can instead push the receipt alone and run the workflow by hand with the request id. |
| "the gate receipt … is stale: content/<channel>/<slug> changed … or holds a file never committed" / "the request file changed" | Something changed after validate, or a file validate bound was never committed. Commit such a file only if it may be public; otherwise delete or gitignore it. A push that changes only receipts or script folders starts no run, so also change something in the request (for example `retentionDays`), validate again, commit the request, its receipt and the script folders together, and push (or run the workflow by hand once it is on the default branch). |
| "the gate receipt … does not cover …" / "lists scripts this request does not gate" / "is for another request" / "was changed after validate wrote it" / "is not one validate writes" / "is not valid JSON" | The receipt was edited, merged by hand or made for another version of the request. Change something in the request, validate again (it overwrites the receipt), commit the request and the new receipt together, and push. |
| "was written by claim gate code that differs from this commit's" | The claim gate (`scripts/claims` or a file it imports, such as `src/episode/markup.ts`) changed after validate, or had uncommitted changes then. Change something in the request, validate again with the committed gate, commit both, push. |
| validate: "data/private/names.txt is not on this computer" | Validate only where the private names list exists (the owner's computer). Never create an empty or made-up list to get past it. Receipts are left as they are. |
| validate: "data/private/names.txt lists no usable names" | The list compares nothing. Only the owner fills it, with the real names and handles behind every "[named person]". Receipts are left as they are. |
| validate: "not added to git: …" / "changed since git add: …" | The receipt binds what you will commit. `git add` what may be public (it is public once pushed), delete or gitignore the rest, then validate again. |
| validate: "the claim gate's code has uncommitted changes (…)" | Commit or stash the gate change, then validate again. Receipts are left as they are. |
| validate: "… holds private name #N" / "a file name in … holds private name #N" | That file (or JSON path of the request) holds a name from the list. Replace it with "[named person]" or rename the file, then validate again. The file is bound by the receipt and published by the commit even when no gate reads it. |
| validate: "… changed while validate ran (after the claim gate read it)" | Something wrote to the request or its script folders during the run (an editor autosave, a dub import, another session). Wait until nothing writes to them and validate again. |
| validate or plan: "… holds storyboard.en.json, but English lives in storyboard.json" | Merge it into `storyboard.json` and delete it: the renderers read only `storyboard.json` for English. |
| validate: "removed render-requests/receipts/<id>.json" | The request no longer passes (for example a name added to the list now matches its script). Fix it and validate again before any push. If validate adds that the old receipt "is still in git", unstage it or amend the commit that holds it first. |
| check: "not committed: …" / "is stale: …" | The commit does not hold what validate checked. Validate again, commit, check again; push only after check says ok. |
| Plan warning: "render-requests/<id>.json was NOT rendered: this run saw only its gate receipt change" | Only the receipt changed in what the run read (on a new branch, only its last commit is read). Push a change to the request, validated again, in one commit with its receipt, or run the workflow by hand once it is on the default branch. |
| "a tag push renders nothing" | Tags never render; push request files on a branch. |
| "jobs[n] renders an episode or show … its props must name channel and slug" | Add `channel` and `slug` to the job's props so the farm knows which script to gate. |
| "voice[n].fitTo is "en", but the request has no voice entry for en" | Add the native master entry of the same channel and slug to the request. |
| "the es dub does not fit the en timeline (build.py exit 3)" | Shorten the translation of the scenes named in the (encrypted) voice log, then push again. |
| "encrypt: false is only for the test compositions" | Remove `encrypt: false` (and `recipient: selftest`), or, for a real new test composition, add it to `TEST_COMPOSITIONS` in `scripts/farm/request.ts`. |
| "the entry src/show/index.ts does not exist in this commit" | The show entry has not landed on this branch yet. |
| "the narration voice_<id>_<n> is missing" | That voice job failed; open it in the same run. Encrypted voice logs are in its artifact under `logs/`. |
| A job fails at once with a message that the branch is not allowed to deploy to `render-farm` | The push came from a branch the environment does not allow (step 3 above). |
| Render failed | For test requests the log is in the job. For encrypted requests, download the artifact and decrypt `logs/<artifact>.log.enc`. |
| A job failed for an outside reason (network) | "Re-run failed jobs" on the run page works: artifacts are uploaded with `overwrite: true` and narration artifacts live for a day. |
| Nothing ran after a push | Only branch pushes that change `projects/video-studio/render-requests/**` start the workflow; `render-requests/receipts/**` does not count, nor does `content/`, nor any tag: change the request too. |
| `gh run download` fails with "Forbidden" in a cloud session | Artifact downloads redirect to `*.blob.core.windows.net` (for example `productionresultssa6.blob.core.windows.net`), which a restricted session network blocks. Download on your own computer, or have the host allowed. |
