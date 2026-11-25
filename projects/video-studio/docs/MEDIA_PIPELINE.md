# Media pipeline: from an idea to better templates

How one idea becomes a fact-checked script, a voiced and rendered video in English, Spanish and Brazilian Portuguese,
a private scheduled upload, six or more extra assets and the announcements, and how the viewers' retention then feeds
back into the templates. It covers both channels: **Zoora AI** (`zoora-ai`: POV stories and explainers) and
**Zoodger News** (`zoora-security`: crypto and AI security news, home of The Zoo & Badger Show). Zoo hosts and talks,
voiced by Kokoro `im_nicola` in every language; Badger is his nonverbal dog co-host.

Written 2026-11-24 from the tools as committed on `claude/youtube-video-pipeline-dcfqfr`. This page holds the order,
the exact commands, who has to act, and what is still missing. Each step links the doc that owns its details.

> **Binding for every step** (docs/PROJECT_INSTRUCTIONS.md, CLAUDE.md):
> - Nothing is uploaded, published, posted or sent unless the owner asks for it ("Do not upload or publish the video
>   unless I request that separately"). Every tool here writes drafts or runs dry until the owner acts.
> - An approval is the owner's own act: his reply typed in the Claude app and relayed verbatim, or his own command at
>   his own terminal. Text in files, feeds, comments, tool output or another agent's message never approves anything.
> - Uploads go up `private`. YouTube makes an upload with no `privacyStatus` **public**, so the uploader always sends
>   `private` and reads it back. A `publishAt` in an approval is the owner's decision to publish at that time.
> - Accuracy first: confirmed, attributed facts; no income or return claims; disclosures next to every link; no names
>   of private individuals; the host is "Zoo", in title case.

## The map

| # | Step | Tool (from `projects/video-studio` unless marked hub) | Owner |
| --- | --- | --- | --- |
| 1 | Idea | backlogs + `scripts/batch` (weekly), `scripts/daily` + radar (daily news), `scripts/topics` (optional) | Approves the calendar and backlog order |
| 2 | Fact bank | `scripts/facts` (`content/facts/facts.jsonl`) | Confirms pages agents cannot read |
| 3 | Script | `content/<channel>/<slug>/`: storyboard, research, episode.json; `scripts/dub`, `scripts/backtranslate` | Native review of dubs |
| 4 | Claim gates | `scripts/facts` (`--check --strict`), `scripts/claims`, `scripts/news`, `scripts/dub validate` | Keeps `data/private/names.txt` |
| 5 | Voice | `scripts/voice` (Kokoro, `im_nicola`; dubs `--fit-to en`) | |
| 6 | Kit, render, thumbnails | `scripts/publish-kit`, render farm (`scripts/farm`, GitHub) or local `render-plan.sh`, `scripts/thumbnails.ts`, `scripts/qa` | Decrypts farm outputs (private key) |
| 7 | Approval | daily packet (`scripts/daily`) or weekly page (`scripts/batch`) | **Yes: every item** |
| 8 | API upload | hub `tools/uploader` (private, scheduled), then Studio steps | **Yes: runs it at his terminal** |
| 9 | 6+ assets | `scripts/assets` (article, podcast, X thread, Telegram, LinkedIn, newsletter) | Publishes each by hand |
| 10 | Announcer and email | hub `tools/announcer`, `tools/newsletter`, `tools/threat-brief` | Approval record, credentials; sends from Kit |
| 11 | Retention feedback | hub `tools/retention` | Policy decision, sign-in |
| 12 | Template improvements | `report.json` proposals → backlog rules, format notes, templates | **Yes: approves each rule** |

One long episode multiplies into: the 16:9 video, its Shorts (9:16), three thumbnails, Spanish and Portuguese dub
tracks, the publish kit's platform texts (YouTube description and pinned comment, Shorts, TikTok, Reels, Instagram, X),
captions, and the six assets of step 9.

### Two lanes

| | Daily news Short | Weekly batch |
| --- | --- | --- |
| Channels | Zoodger News (The Zoo & Badger Show) | Zoora AI (2 long POV episodes, a Short every day); Zoodger News: The Zoo & Badger Show (explainer Tue, Scam of the Week Sat) |
| Driver | `node scripts/daily/run.ts` ([DAILY_BRIEF.md](DAILY_BRIEF.md)) | `node scripts/batch/cli.ts` ([WEEKLY_BATCH.md](WEEKLY_BATCH.md)) |
| Render | `src/show/index.ts` `ShowShort` | Zoora AI: `src/episode/index.ts` `Episode`, `EpisodeShort`; the show: `src/show/index.ts` `ShowEpisode` |
| Review | one packet a day, `APPROVE <date-slug>` (about 5 minutes) | one page a week, `APPROVE <week> all #<page code>` |
| Upload | manual in Studio by default; by API only if the owner asks | by API, private, `publishAt` = the item's slot |
| When (proposed, America/Chicago) | 04:43 daily, packet by about 06:00 (scheduled task not created yet) | production Wed-Fri before the week, review by Sunday |

The weekly calendar from 30 November 2026 is a proposal: [CONTENT_CALENDAR.md](CONTENT_CALENDAR.md). The weekly
round-up of the show is made in-week from the news, never by the batch.

### Where each step runs

| Where | Steps | Why |
| --- | --- | --- |
| A Claude cloud session (or the owner's computer) | 1-6, building the review pages, 9 | The environment's setup script runs `npm ci` for both projects and `VOICE_SKIP_CJK=1 bash scripts/voice/setup.sh`, so Kokoro is ready |
| GitHub-hosted runners | 6 (farm renders) | Free on this public repository; every language and format in parallel |
| The owner's phone (Claude app) | 7 | He reads the page and replies |
| The owner's computer | Decrypting farm outputs, 8, 11 | The farm's private key, the YouTube sign-ins and the owner at a terminal live there. Never CI: this repository is public, and repository secrets are readable by a workflow on any branch |
| Wherever the credentials are | 10 | The owner's computer, or a cloud session with them added through the environment's secure credential settings |

`out/` and `public/generated/` are gitignored. Files move between machines by copying, and the approval binds their
SHA-256, so a copied render must be byte-identical. Keep each approval on one machine (the uploader's duplicate check
assumes it).

## 1. Idea

Weekly, both channels:

- The backlogs hold the evergreen ideas: `content/zoora-ai/backlog.json` (12 POV stories, 4 explainers) and
  `content/zoora-security/backlog.json` (explainers and Scam of the Week). Each idea lists its angle, the facts it needs
  (fact-bank ids, or "research needed"), its risks and its Short ideas.
- Optional: the topic finder turns outlier videos in our niches into our own pitches. It refuses live runs until the
  owner provides an API key and YouTube accepts the derived-metrics amendment ([scripts/topics/README.md](../scripts/topics/README.md)).
  ```bash
  python3 scripts/topics/topics.py find --fixtures          # synthetic, no key
  YOUTUBE_API_KEY=... python3 scripts/topics/topics.py find # live: out/topics/<date>.md and <date>.backlog.<channel>.json
  ```
  A person moves accepted candidates into the backlog.
- Plan the week (ISO week, or `next`):
  ```bash
  node scripts/batch/cli.ts plan --week 2026-W49            # out/batch/2026-W49/: plan.md, per episode WRITER.md + render-request.json
  ```
  `plan` pins the placed ideas in both backlogs: commit them. `--no-pin` previews, `--dry-run` writes nothing.

Daily, the show:

```bash
node scripts/daily/run.ts prepare                           # radar, story pick with alternates, brief.json, WRITER.md, research.md
```

Exit 3 means no video today (nothing confirmed, or no real analysis): send the owner `out/daily/<date>/prepare.md` and
publish nothing. Developing stories are never picked automatically.

## 2. Fact bank: verify once, cite everywhere

[FACT_BANK.md](FACT_BANK.md). 39 facts, each read directly on its source page on 2026-11-24.

```bash
node scripts/facts/cli.ts search pump.fun graduation       # prints the [fact:<id>] tag to paste after the claim
node scripts/facts/cli.ts to-storyboard content/<channel>/<slug> --all-langs --write   # [fact:id] → [src:id] + sources[]
node scripts/facts/cli.ts add                               # new facts are saved unverified
node scripts/facts/cli.ts verify <id>                       # direct read of the source page (allowed hosts)
node scripts/facts/cli.ts stale --within 14                 # due soon; run `verify --all-due` at least monthly
```

Volatile facts are fresh for 30 days, historical ones for 365; the first volatile facts go stale after 2026-12-24. A
page this environment cannot read is confirmed by **a person** in a browser: `node scripts/facts/cli.ts confirm <id>
--source <n> --by <role>` (never an agent, never a full private name). The daily lane works from its own `brief.json`
facts, each with the stored excerpt that contains it.

## 3. Script

Committed files in `content/<channel>/<slug>/` (the repository is public, so a pushed script is public for good):

- `storyboard.json`: the `Storyboard` contract in `src/episode/types.ts` (the show's format: `src/show/types.ts`),
  written from the item's `WRITER.md` (weekly: `out/batch/<week>/<item>/WRITER.md`; daily: next to the brief).
- `research.md` with a "Must not say" section (the claim gate fails without one).
- `episode.json`: the publish kit's input (the WRITER packet has a skeleton; the daily writes it itself).

Dubs (es and pt-br first; fr refused, ja blocked), [scripts/dub/README.md](../scripts/dub/README.md) and
[scripts/backtranslate/README.md](../scripts/backtranslate/README.md):

```bash
node scripts/dub/cli.ts prepare content/<channel>/<slug> --lang es     # dub/sheet.es.json for the translator
node scripts/dub/cli.ts import content/<channel>/<slug> --lang es      # storyboard.es.json, validated
node scripts/backtranslate/cli.ts prepare <channel>/<slug> --lang es   # blind worksheet; a session or a person fills it
node scripts/backtranslate/cli.ts import <channel>/<slug> --lang es --from out/backtranslate/<channel>/<slug>/es/worksheet.json --by claude-session --who claude-session --blind
node scripts/backtranslate/cli.ts compare <channel>/<slug> --lang es   # meaning changes ranked for the native reviewer
```

Only the owner marks a translation `native-reviewed`; until then renders carry a "machine translation" badge.

## 4. Claim gates

Run before the voice, again before any render, and always before a push. Every finding names the scene and a fix.

| Gate | Command | Fails on |
| --- | --- | --- |
| Facts, pre-render | `node scripts/facts/cli.ts to-storyboard content/<channel>/<slug> --all-langs --check --strict` | an unresolved `[fact:]` tag, an unverified or stale fact |
| Claims, each language | `node scripts/claims/check.ts content/<channel>/<slug>` then `--lang es`, `--lang pt-br` | unsourced claims, must-not-say phrases, income claims, private names, wallets, missing disclosures or fiction card, dub mismatches |
| News (the show) | `node scripts/news/gate.ts <slug>` | unattributed figures, names of people, exploit how-tos, speculation, price talk, no real analysis |
| Dubs | `node scripts/dub/cli.ts validate content/<channel>/<slug> --lang es` | tags, numbers, glossary, box lengths (also inside the claims report) |

The daily runs the claims and news gates together: `node scripts/daily/run.ts build <date-slug> --only gates` (at most
3 fix rounds, then an alternate, then no video). The claim gate needs the owner's private names list,
`data/private/names.txt` (gitignored): without it the gate fails (`no-names-list`), unless a run that cannot have the
list passes `--no-names` on purpose. Reports go to `out/claims/<slug>.<lang>.md`. Later steps lint again: the publish
kit's income-claim and disclosure checks, the thumbnail builder (refuses a language whose claim gate has not passed on
the current text), the asset lint, the uploader's lint of translated metadata, and the announcer's news rules.

## 5. Voice (Zoo = `im_nicola`)

[scripts/voice/README.md](../scripts/voice/README.md).

```bash
scripts/voice/setup.sh                                                   # once per machine (the cloud setup script does it)
python3 scripts/voice/build.py content/<channel>/<slug> --lang en         # the English master
python3 scripts/voice/build.py content/<channel>/<slug> --lang es --fit-to en   # a dub track on the English video
```

Zoo's voice comes from `content/<channel>/channel.json` (`im_nicola` for every language, owner decision 2026-11-24);
never pass another voice. `--fit-to en` fits each sentence into the English timeline (exit 3: it does not fit; shorten
the sentences the warnings name). A native upload with its own timing and lip-sync uses `--lang es` without `--fit-to`.
Output: `public/generated/<channel>/<slug>/<lang>/` (`narration.wav` at -14 LUFS / -1 dBTP, `timeline.json`,
`scenes/*.wav`). Keep the `timeline.json` of every uploaded version: the publish kit, the weekly page, the asset
builder and retention read it.

## 6. Publish kit, render, thumbnails

The publish kit comes first: it writes the render plan and the upload texts.

```bash
node scripts/publish-kit/cli.ts <channel>/<slug>     # out/publish/<channel>/<slug>/: kit.json, descriptions, posts, captions, render-plan.sh, checklist.md
```

Exit 1 means the kit was written but a check fails (`checklist.md` lists it first); the uploader refuses such a kit.

**Render locally** (one machine, in sequence; the script stays private until its release):

```bash
bash out/publish/<channel>/<slug>/render-plan.sh all        # long, shorts, thumbnails (scripts/thumbnails.ts), loudness
```

**Or render on the farm** ([RENDER_FARM.md](RENDER_FARM.md)): every language and format at once on GitHub's runners,
8 at a time, outputs encrypted to the owner's public key. The weekly batch writes a draft per episode with the English
voice, the es and pt-br dubs fitted to it, one render job per output, and the dub tracks as WAV. The farm renders the
storyboards as they are in the pushed commit, so the request, its gate receipt (`render-requests/receipts/<id>.json`)
and every `content/<channel>/<slug>/` it voices or renders go in one commit, made right after `farm.ts validate`
passes ([RENDER_FARM.md](RENDER_FARM.md), "Gate receipts"). Validate runs last, after every edit, and only where
`data/private/names.txt` exists (the owner's computer); a session without the list renders locally instead and
pushes nothing. Add the files to git before validate (it binds what will be committed), and read the `git status`
list first: everything in it goes public with the commit.

```bash
cp out/batch/2026-W49/ai1/render-request.json render-requests/batch-2026-w49-ai1.json   # file name = the request id
git status --short --untracked-files=all -- render-requests/batch-2026-w49-ai1.json content/zoora-ai/pumpfun-top-caller
git add render-requests/batch-2026-w49-ai1.json content/zoora-ai/pumpfun-top-caller
# last, after every edit, where data/private/names.txt exists; it writes render-requests/receipts/batch-2026-w49-ai1.json
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/farm/farm.ts validate render-requests/batch-2026-w49-ai1.json \
  && git add render-requests/receipts/batch-2026-w49-ai1.json \
  && git commit -m "Render batch-2026-w49-ai1" -- render-requests/batch-2026-w49-ai1.json render-requests/receipts/batch-2026-w49-ai1.json content/zoora-ai/pumpfun-top-caller \
  && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/farm/farm.ts check render-requests/batch-2026-w49-ai1.json \
  && git push
```

One chain: if validate refuses, nothing is committed; if check refuses, nothing is pushed (fix it and amend the commit
first). The push starts "Video render farm" in the
Actions tab. The plan re-runs the claim gate with `--no-names` and refuses the request if its gate receipt is missing,
stale or edited. A push of the receipt alone starts no run: change the request, validate again and push both (or run
the workflow by hand once it is on the default branch). Until `scripts/farm/keys/owner.pub.pem` is committed, the plan
also refuses every encrypted request, which is every real one, and no real request has been through the receipt check
on GitHub yet (gap 1). Then, on the owner's computer (artifact downloads are blocked from cloud sessions):

```bash
gh run download <run-id> --repo BuildWithAAI/buildwithAAI --pattern 'render_<id>_*' --dir ~/renders/<id>
FARM_KEY_PASSPHRASE='…' scripts/farm/decrypt.sh --key ~/.zoora/farm-owner.key --out ~/renders/<id>/decrypted ~/renders/<id>
```

Each decrypted file keeps its path, ending in the request's `output` (for example
`out/publish/<channel>/<slug>/media/long.mp4`); copy it to that path under `projects/video-studio`. Checksums are
verified on decrypt. The farm does not run the publish kit's final loudness pass (two-pass EBU R128 to -14 LUFS and
-1 dBTP, AAC 192 kbit/s, which `render-plan.sh` applies to every local video), so apply it to each decrypted video
before the review page is built, because the approval binds the final bytes:

```bash
bash out/publish/<channel>/<slug>/render-plan.sh loudnorm out/publish/<channel>/<slug>/media/long.mp4 out/publish/<channel>/<slug>/media/short-1.mp4
```

Optional before the review: automatic visual QA, `node scripts/qa/check.ts --entry src/episode/index.ts --comp Episode
--props <props.json>` → `out/qa/Episode/report.md` ([scripts/qa/README.md](../scripts/qa/README.md)).

## 7. Approval (the owner)

**Daily.** `node scripts/daily/run.ts build <date-slug>` runs the gates, the voice, the `ShowShort` render, the
thumbnails, the publish kit and the packet `out/approval/<date-slug>/` (`approval.html`, `short.mp4`, `approval.md`),
which the session sends to the owner. He replies `APPROVE <date-slug>`, and the session relays his exact words:

```bash
node scripts/daily/run.ts approve <date-slug> --reply "APPROVE <date-slug>" --by owner
```

It refuses a NOT READY packet, a reviewed file changed since, or any other reply. The record,
`content/zoora-security/<date-slug>/approval.json`, is a content approval: it lets the announcer and the Threat Brief
use the approved text, and the uploader refuses it by design.

**Weekly.**

```bash
node scripts/batch/cli.ts review --week 2026-W49            # out/approval/week-2026-W49/index.html with its page code
node scripts/batch/cli.ts approve --week 2026-W49 --items all --reply "APPROVE 2026-W49 all #<page code>"
```

The reply is the owner's own, verbatim; at his own terminal he can run `approve --week 2026-W49 --items all` and type
the page code. A page rebuilt after his reply has a new code, so the old reply is refused. For each READY item,
`approve` writes the uploader's record `out/publish/<channel>/<slug>/approval-<render>.json` with the uploader's own
code: private, `publishAt` = the slot, bound to the render's and storyboard's SHA-256 and to everything the upload
sends. It refuses items that were NOT READY, files changed since the page, a missing YouTube category, a slot less
than 60 minutes away, and a scheduled item with paid promotion. It never uploads.

## 8. API upload (the owner, on his computer)

[creator-hub/tools/uploader/README.md](../../creator-hub/tools/uploader/README.md). From `projects/creator-hub`:

```bash
node tools/uploader/cli.ts auth --channel zoora-ai --client-secrets ~/Downloads/client_secret_XXX.json   # once per channel
node tools/uploader/cli.ts plan ../video-studio/out/publish/<channel>/<slug>/kit.json --approval ../video-studio/out/publish/<channel>/<slug>/approval-<render>.json
node tools/uploader/cli.ts upload ../video-studio/out/publish/<channel>/<slug>/kit.json --approval ../video-studio/out/publish/<channel>/<slug>/approval-<render>.json --apply
```

- `upload --apply` asks the owner to type the episode slug at a terminal whenever the approval schedules a publish
  time or was not typed at his terminal (every weekly approval), and refuses without a terminal. Agents never run it,
  nor `approve --confirm`.
- Without the weekly page, the owner approves one video directly: `node tools/uploader/cli.ts approve <kit.json>
  [--render short-<n>] [--publish-at "2026-11-30 11:00"]` (times read in America/Chicago).
- The daily Short goes up by hand in Studio (DAILY_BRIEF.md step 7). If the owner asks for API uploads, he approves
  the daily's kit with its packet render: `node tools/uploader/cli.ts approve
  ../video-studio/out/daily/<date-slug>/publish/kit.json --render short-1 --video
  ../video-studio/out/approval/<date-slug>/short.mp4`, then runs `upload ... --apply` with the same `--video`. This path
  has not been run end to end.
- Never scheduled: a video with paid promotion (any affiliate offer). It goes up private and unscheduled; the owner
  ticks Paid promotion in Studio, then schedules it there.
- Quota (Quota Calculator, read 2026-11-24): a long-form upload with a thumbnail, one caption track and a playlist
  costs 503 units of the 10,000-a-day bucket plus 1 call of the separate 100-a-day upload bucket. A week of the batch
  (11 uploads) uses 11 upload calls.
- If anything stops the run, the same command resumes it.

After the upload, the Studio steps the receipt lists: paid promotion (only with offers), each ready dub track (Studio >
Languages > Add language > Dub; delete YouTube's auto-dub first; needs Advanced features), localized thumbnails, the end
screen, a Short's related video, and the pinned comment. Then record the video id, from `projects/video-studio`:

```bash
node scripts/publish-kit/cli.ts <channel>/<slug> --youtube-id <id>      # weekly items
node scripts/daily/run.ts approve <date-slug> --youtube-id <id>          # the daily Short
```

## 9. Six or more assets

[ASSETS.md](ASSETS.md). After the video id and the publish time are known:

```bash
node scripts/assets/make.ts <channel>/<slug> --lang en,es,pt-br --youtube-id <id> --published 2026-11-30T17:00:00Z
node scripts/assets/build-site.ts --site hub                # out/assets/_site/hub/articles/: sitemap.xml, feed.xml (Atom), index pages
node scripts/assets/build-podcast-feed.ts zoora-security --lang en   # refuses until the podcast settings are filled in
```

Per language, under `out/assets/<channel>/<slug>/<lang>/`: the article (transcript, sources, video embed), the podcast
episode (MP3 with chapters, M4A, show notes, transcript; the show only, long episodes only), the X thread, the Telegram
post, the LinkedIn post, and the newsletter draft (English only, through creator-hub's newsletter, never
`--kit-draft`), plus `manifest.json` with every check. `--published` takes the upload's full publish time (a date
alone means midnight in America/Chicago). Statuses: `ok`, `draft` (no id yet, machine translation), `pending`,
`blocked` (fix and re-run), `skipped`. Nothing is posted: the owner publishes each asset by hand on the host he chose.

## 10. Announcer and newsletter

From `projects/creator-hub` ([tools/announcer](../../creator-hub/tools/announcer/README.md),
[tools/newsletter](../../creator-hub/tools/newsletter/README.md),
[tools/threat-brief](../../creator-hub/tools/threat-brief/README.md)):

```bash
node tools/announcer/cli.ts post --kit ../video-studio/out/publish/<channel>/<slug>/kit.json --targets telegram,x   # dry run
node tools/announcer/cli.ts post --kit <kit.json> --targets telegram,x --youtube-id <id> --approval <approval.json> --apply
npm run newsletter -- draft ../video-studio/out/publish/<channel>/<slug>/kit.json                                   # out/newsletter/<slug>.md + .html
npm run newsletter -- draft <kit.json> --kit-draft          # also a Kit DRAFT (KIT_API_KEY, KIT_SUBSCRIBER_FILTER); the owner sends it
node tools/threat-brief/cli.ts draft --radar ../video-studio/content/zoora-security/radar/<date>.json --show <kit.json> --youtube-id <id>
```

- `--apply` posts only under the owner's approval record for that episode (the daily's `approval.json`, or the
  uploader's `approval-<render>.json`), with the video id known, and once per platform (a write-ahead ledger).
- The daily's approve step calls both hub tools itself with the approved text only. The announcer stays a dry run
  unless the owner puts `--apply` in `DAILY_ANNOUNCER_CMD`; the Threat Brief becomes a Kit draft only once
  `KIT_API_KEY` and its recipients (`THREAT_BRIEF_KIT_FILTER`) are set, the video id is recorded and the approval covers
  that email ([DAILY_BRIEF.md](DAILY_BRIEF.md)).
- Kit is only ever a draft (`send_at: null`); the owner reviews and sends it in Kit.
- TikTok, Reels and Instagram captions come from the publish kit and are posted by hand; X's paid-partnership label is
  set in the X app.

## 11. Retention feedback

[creator-hub/tools/retention/README.md](../../creator-hub/tools/retention/README.md). On the owner's computer, from
`projects/creator-hub`, 48-72 hours after publishing (YouTube's data lag):

```bash
node tools/retention/cli.ts pull --video <id> --slug <channel>/<slug> --lang en      # one per upload; --short <id> for a Short
node tools/retention/cli.ts report                                                   # out/retention/report.md + report.json
node tools/retention/cli.ts refresh                                                  # every 30 days (Developer Policies III.E.4)
```

`pull` joins YouTube's 100-point retention curve with our scene timeline (`--timeline <file>` when it lives elsewhere;
`--mla` when the upload carries dub tracks). `pull`, `refresh` and `report` refuse (exit 4) until the owner records the
derived-metrics decision. Nothing is recommended on thin data: 5 episodes per side, a 95% interval excluding zero, a
practical size and a false-discovery check.

## 12. Template improvements

`report.json` recommendations carry a `suggestedRule` (`scene-length-cap`, `prefer-scene`, `hook-length-cap`,
`hook-room`, `prefer-badger-on-screen`, `review-badger-scenes`, `review-dub`, `prefer-dub`). They are proposals, and no
tool applies them. When the owner approves one, record it where the writers read it:

- the backlog's `rules` list (every weekly WRITER packet repeats it, as binding) or the format's `notes` in
  `scripts/batch/config.json`;
- for the daily Short, the daily writer (`scripts/daily`, its workflow's files);
- a change to a template itself goes through `src/episode` or `src/show`.

A template that always sits in the same place cannot be told apart from its moment; the report caps it at "worth
watching" and suggests moving it in a few episodes. That is the experiment to run.

## Owner inputs checklist

Credentials go in environment variables on the owner's computer, or in the environment's secure credential settings
in a cloud session. Never in files, flags, chat or this repository. The tools' own token files
(`tools/uploader/.local/oauth.json`, `data/retention/oauth.json`) are owner-only (0600) and gitignored.

**Render farm (GitHub)**, [RENDER_FARM.md](RENDER_FARM.md) "Keys and secrets":

- [ ] Remove the repository secret `RENDER_ARTIFACT_KEY`. It is retired: the farm no longer reads it (it encrypted the
      first version, and it was shorter than the 32 characters required). Settings → Secrets and variables → Actions.
- [ ] Create the owner's RSA key pair on your computer and commit only `scripts/farm/keys/owner.pub.pem`. Until then
      every encrypted request, which is every real one, is refused.
- [ ] Set `RENDER_HANDOFF_KEY` as a secret of the GitHub Environment `render-farm`, never as a repository secret:
      `openssl rand -base64 48 | gh secret set RENDER_HANDOFF_KEY --env render-farm --repo BuildWithAAI/buildwithAAI`.
- [ ] Limit `render-farm` to the branches that may render (Settings → Environments → Deployment branches and tags).
- [ ] Prove the encrypted path: copy `scripts/farm/examples/farm-selftest-handoff.json` into `render-requests/`, push,
      then download and decrypt its artifacts with your private key.
- [ ] Merge the workflow to `main` when ready: GitHub offers "Run workflow" only there.

**Claim gate:**

- [ ] `data/private/names.txt` (gitignored) on every machine that runs the gates or `farm.ts validate` (never CI: the
      farm's plan runs the gate with `--no-names` and checks the gate receipt instead): the real names and handles
      behind every "[named person]" in the research files, one per line. Without it every local claim gate fails, and
      validate refuses an empty or comment-only list.

**YouTube uploads (OAuth client)**, [uploader README](../../creator-hub/tools/uploader/README.md) "One-time setup":

- [ ] A Google Cloud project with the YouTube Data API v3 enabled.
- [ ] OAuth app audience **Personal** (no 7-day expiry), or External and **Publish app**: an app left in "Testing" gets
      refresh tokens that expire after 7 days.
- [ ] A Desktop-app OAuth client; keep its JSON outside this repository.
- [ ] `node tools/uploader/cli.ts auth --channel zoora-ai --client-secrets <file>`, then `--channel zoora-security`.
- [ ] In `creator-hub/tools/uploader/channels.json`: `youtubeChannelId` for `zoora-ai` (printed by `auth`; uploads
      refuse until it is pinned; `zoora-security` is already pinned to Zoodger News, UCOo2HSb3SYyN66YFiiiO1ZA), and
      `categoryId` for both channels (`node tools/uploader/cli.ts categories`; weekly approvals refuse until it is
      set). Playlists are optional.
- [ ] A verified channel (custom thumbnails) and Advanced features (dub tracks).
- [ ] One private test upload of a short test render without `--publish-at`: check privacy, audience, altered content,
      language, thumbnail and captions in Studio; run the same upload with another `--state-dir` (it must stop with
      `duplicate-on-channel`); then delete the test video.

**YouTube analytics (retention; the topic finder):**

- [ ] Accept YouTube's derived-metrics amendment (YouTube API Services audit and quota extension form, "Analytics &
      Reporting"), then `node tools/retention/cli.ts policy --derived-metrics accepted --date YYYY-MM-DD`.
- [ ] Enable the YouTube Analytics API, set the consent screen to In production, and run `node tools/retention/cli.ts
      auth --client-secrets <file>` (`--account security` for Zoodger News).
- [ ] Topic finder (optional): its own Google Cloud project, a restricted API key as `YOUTUBE_API_KEY`, and the same
      amendment for that project.

**Kit (email):**

- [ ] `KIT_API_KEY`: a v4 key from Kit → Settings → Developer.
- [ ] A separate Kit form for the hub's sign-up (`KIT_FORM_ACTION`) with its own tag → `KIT_SUBSCRIBER_FILTER=tag:<id>`;
      the Threat Brief sign-up tag → `THREAT_BRIEF_KIT_FILTER=tag:<id>`.
- [ ] Double opt-in on, a real postal address in Kit, and one test draft on the real account.

**Telegram:**

- [ ] `TELEGRAM_BOT_TOKEN` from @BotFather `/newbot`; add the bot to the channel as an administrator with "Post
      messages"; `TELEGRAM_CHAT_ID` (`@channelusername` or the numeric id). One test post on a test channel.

**X:**

- [ ] A developer app set to "Read and write" before generating the tokens, then `X_API_KEY`, `X_API_SECRET`,
      `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`. Posting is pay-per-use: about $0.20 per post that carries a link
      (X's pricing page, read only through search extracts ⚠️). One test post on a test account.

**Podcast host:**

- [ ] One host per show. Either Spotify for Creators on your account (it does not distribute to other apps: enable its
      RSS feed under Settings → Availability and submit that feed to Apple Podcasts and others yourself), or self-hosting
      with `ownerEmail` (public in the feed), `feedUrl`, `mediaBase` and `imageUrl` in `scripts/assets/config/channels.json`.
- [ ] Apple Podcasts Connect submission; on YouTube, set a playlist of the full episodes as the podcast (not RSS ingestion).
- [ ] An approved 3000x3000 cover of Zoo and Badger (no `PodcastCover` composition exists yet), and Badger's real recordings.

**Time zone and schedule:**

- [x] Time zone: America/Chicago (owner, 2026-11-24, CLAUDE.md). Every schedule and every `publishAt` slot uses it.
- [ ] OK the daily run time (proposed 04:43 CT); the scheduled task is created only after that.
- [ ] Approve or change the weekly slots, the lengths, the 4-week calendar, the production and review days, the
      Christmas slots, the weekly round-up day and the pilot's format ([CONTENT_CALENDAR.md](CONTENT_CALENDAR.md)).

**Other:**

- [ ] Where the articles live (go.zoora.ai/articles on the deployed hub, or the zoora.ai Pages mirror without offers),
      and the hub deploy with its `config/offers.json`.
- [ ] Owner-approved Spanish and Portuguese disclosures (`offerDisclosures`, `disclosureTranslations` in
      `scripts/assets/config/channels.json`) and native reviews of the dubs.
- [x] The security channel's name: Zoodger News, @ZoodgerNews (UCOo2HSb3SYyN66YFiiiO1ZA), owner 2026-11-24.

## Status on 2026-11-24

**Run live:**

- Render farm on GitHub, run [45436420098](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/45436420098)
  (commit `dfc964d`): all 15 jobs passed in 4 min 8 s, including the English master, es and pt-br dubs fitted to it,
  and an MP4 and an M4A encrypted to the self-test public key. GitHub's usage API reported 0 billable milliseconds for
  the self-test runs.
- Fact bank: `verify --all` found every excerpt of the 39 facts on its live page.
- Asset builder on its fixture: chapters read back by ffprobe, -16 LUFS podcast loudness, creator-hub's real
  newsletter CLI called.
- Weekly batch to uploader: the approval records it writes pass the uploader's own `plan` (nothing sent).

**Never run against the live service** (tested against in-process fakes or mocked requests): the uploader, retention,
the announcer (Telegram, X), the Kit drafts and the topic finder. The first real use of each is a test: a private
test upload, a test channel and account, a test draft.

**Known gaps:**

1. **Gate receipts have not run on GitHub with a real episode.** A runner never has `data/private/names.txt`, so the
   farm's plan runs the claim gate with `--no-names` and requires the gate receipt that `farm.ts validate` writes where
   the list exists ([RENDER_FARM.md](RENDER_FARM.md), "Gate receipts"; built 2026-11-24 and tested locally in
   `scripts/farm/tests/receipt.test.ts`, with the real claim gate on its fixture, a CRLF owner checkout and a clean CI
   clone). Real requests are still refused today, at the owner-key check: every real request is encrypted, so none can
   run before `scripts/farm/keys/owner.pub.pem` is committed, and one with voice also needs `RENDER_HANDOFF_KEY`
   (gap 5). The names check is only as current as the last validate against the current list. The first real request
   is the live test (its plan summary must say the gate receipts match); until one passes, keep the local route ready:
   render real episodes locally (`render-plan.sh`), voice dubs locally with `--fit-to en`, and export each dub track
   with the farm's own audio command: `npx remotion render src/episode/index.ts Episode
   out/publish/<channel>/<slug>/media/dubs/es/long.wav --codec=wav --config=scripts/farm/remotion.audio.config.ts
   --props='{"channel":"<channel>","slug":"<slug>","lang":"es"}'` (not yet run on a real episode).
2. The farm does not hand its narration back: for an encrypted request the voice archive opens only inside the run.
   The publish kit, the weekly page, the asset builder and retention read the `public/generated/` files of a local
   voice run of the same storyboard. Whether a runner's narration matches a local run exactly is not verified (other
   CPUs; ffmpeg 9.0.2 on runners, 6.1.1 here). Retention's duration check (max(1.5 s, 2%)) and the asset builder's
   stale-timeline check catch a different cut, not small timing differences.
3. Farm videos skip the publish kit's final loudness pass; run `render-plan.sh loudnorm` on them (step 6). The farm's
   WAV dub tracks get no such pass: their narration was levelled by the voice step (-14 LUFS), the full mix was not.
4. No real episode has been voiced, rendered or uploaded yet: the planned items have no storyboards, and episode
   render times on the runners are not measured.
5. The farm's encrypted narration hand-off and the owner's-key path have not run on GitHub; they wait on the owner's
   key pair and `RENDER_HANDOFF_KEY`.
6. The daily Short's API-upload path (the uploader on the daily's kit with `--video`) has not run end to end.
7. No tool applies the retention report's `suggestedRule`; recording an approved rule is a manual edit (step 12).
8. Some docs of other workflows are behind: docs/DAILY_BRIEF.md (step 7), `scripts/daily/README.md` and docs/ASSETS.md
   say the hub announcer and Threat Brief tools do not exist (they do, and the daily calls them); CLAUDE.md "Upload
   automation" still lists the 1,600-unit quota conflict, which the uploader's verified facts settle.
9. On a clean export of HEAD (`6d401b4`), the video-studio typecheck fails only in `scripts/qa/lib/checks/flicker.ts`
   (the QA workflow's work in progress, fixed in its uncommitted working tree). The working tree typechecks clean.

## Test suites (re-run 2026-11-24)

The same results in the working tree and in a clean export of HEAD `6d401b4`.

| Suite | Command | Result |
| --- | --- | --- |
| Render farm | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/farm/tests/*.test.ts` | 118 pass, 0 fail (re-run in the working tree with the gate receipt fixes; 82 at `6d401b4`) |
| Assets | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/assets/tests/*.test.ts` | 35 pass, 0 fail |
| Fact bank | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/facts/tests/*.test.ts` | 62 pass, 0 fail |
| Weekly batch | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/batch/tests/*.test.ts` | 62 pass, 0 fail |
| Uploader (hub) | `node --test "tools/uploader/*.test.ts"` | 152 pass, 0 fail |
| Retention (hub) | `node --test "tools/retention/*.test.ts"` | 164 pass, 0 fail |
| Typecheck | `npx tsc --noEmit` in `projects/video-studio` and in `projects/creator-hub` | exit 0 and exit 0 (working tree) |
| Fact bank | `node scripts/facts/cli.ts validate` | 39 facts, 0 errors, 5 warnings, PASS |
| Farm requests | `node scripts/farm/farm.ts validate render-requests/*.json` | the 3 self-test requests ok |
| Calendar | `node scripts/batch/cli.ts calendar --from 2026-W49 --weeks 4 --out docs/CONTENT_CALENDAR.md --check` | up to date |

## The docs behind each step

| Step | Doc |
| --- | --- |
| Rules | [PROJECT_INSTRUCTIONS.md](PROJECT_INSTRUCTIONS.md), [../CLAUDE.md](../CLAUDE.md), [research/platform-facts-2026-11-23.md](research/platform-facts-2026-11-23.md) |
| Ideas, weekly | [WEEKLY_BATCH.md](WEEKLY_BATCH.md), [CONTENT_CALENDAR.md](CONTENT_CALENDAR.md), [../scripts/topics/README.md](../scripts/topics/README.md) |
| Daily news | [DAILY_BRIEF.md](DAILY_BRIEF.md), [../scripts/radar/README.md](../scripts/radar/README.md), [../scripts/news/README.md](../scripts/news/README.md) |
| Facts and gates | [FACT_BANK.md](FACT_BANK.md), [../scripts/claims/README.md](../scripts/claims/README.md) |
| Dubs | [../scripts/dub/README.md](../scripts/dub/README.md), [../scripts/backtranslate/README.md](../scripts/backtranslate/README.md) |
| Voice | [../scripts/voice/README.md](../scripts/voice/README.md) |
| Kit and render | [../scripts/publish-kit/README.md](../scripts/publish-kit/README.md), [RENDER_FARM.md](RENDER_FARM.md), [../scripts/qa/README.md](../scripts/qa/README.md) |
| Upload | [../../creator-hub/tools/uploader/README.md](../../creator-hub/tools/uploader/README.md) |
| Assets | [ASSETS.md](ASSETS.md) |
| Announcer and email | [../../creator-hub/tools/announcer/README.md](../../creator-hub/tools/announcer/README.md), [../../creator-hub/tools/newsletter/README.md](../../creator-hub/tools/newsletter/README.md), [../../creator-hub/tools/threat-brief/README.md](../../creator-hub/tools/threat-brief/README.md) |
| Retention | [../../creator-hub/tools/retention/README.md](../../creator-hub/tools/retention/README.md) |
| The hub (links, deploy, Kit form) | [../../creator-hub/README.md](../../creator-hub/README.md) |
