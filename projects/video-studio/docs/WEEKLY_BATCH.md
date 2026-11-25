# Weekly batch production (`scripts/batch`)

One production session a week makes every evergreen piece for both channels: Zoora AI's two POV episodes and the
Shorts cut from them, and, on Zoodger News, The Zoo & Badger Show's explainer and Scam of the Week. One page holds the
owner's review of all of it. Only the daily news (the Threat Brief, `scripts/daily`) stays daily, at about 5 minutes
of review a day.

Built 2026-11-24. **The schedule is a proposal pending the owner's approval**: slot days and times, cadence, lengths
and the order of topics. Nothing here uploads, publishes, posts or pushes. Every upload needs the owner's explicit
approval (docs/PROJECT_INSTRUCTIONS.md: "Do not upload or publish the video unless I request that separately"), and
the upload itself runs with the creator-hub uploader, never from this tool.

The 4-week proposal from 30 November 2026 is [CONTENT_CALENDAR.md](CONTENT_CALENDAR.md).

## The week

| When (proposed, Central Time) | Who | What |
| --- | --- | --- |
| Wednesday to Friday before the week | Claude sessions | `plan`; one writer session per episode (research, script, gates, dubs, voice, publish kit, renders, thumbnails); `review` |
| Saturday or Sunday before the week | The owner, one sitting | Reads the weekly page on his phone. Replies `APPROVE <week> all #<page code>`, `APPROVE <week> <items> #<page code>` or `EDIT <item>: ...` (the page shows each reply ready to copy) |
| After the reply | Claude session, then the owner | `approve` writes the uploader's approval records. The owner runs the uploads: each video goes up private, scheduled for its slot |
| Every day | The owner, about 5 minutes | The daily Threat Brief (docs/DAILY_BRIEF.md) |

All times are **America/Chicago**, the owner's time zone (CLAUDE.md, owner decisions, 2026-11-24). The workflow
brief said "TBD; default UTC", but CLAUDE.md has recorded the zone since then, so it is the default
(`timeZone` in `scripts/batch/config.json`). Slot times convert to exact UTC instants for YouTube's `publishAt`; a
wall time that the clocks skip or pass twice at a daylight-saving change is refused instead of guessed.

## Commands (run from `projects/video-studio/`)

| Command | What it does |
| --- | --- |
| `node scripts/batch/cli.ts plan --week 2026-W49` | Places backlog ideas in the week's slots and writes `out/batch/2026-W49/`: `plan.json`, `plan.md`, and per episode `<item>/WRITER.md` and `<item>/render-request.json`. Pins the placed ideas to the week in the backlogs: commit them |
| `... plan --week 2026-W49 --no-pin` | The same files as a preview; the backlogs stay unchanged |
| `... plan --week 2026-W49 --dry-run` | Prints the plan; writes nothing |
| `node scripts/batch/cli.ts status --week 2026-W49 [--json]` | Where each item stands: READY, or what is missing |
| `node scripts/batch/cli.ts review --week 2026-W49 [--copy-media]` | Builds the ONE weekly approval page, `out/approval/week-2026-W49/index.html`, its page code, and `review.json` (the hashes approve checks; every page built is also kept as `review-<code>.json`) |
| `node scripts/batch/cli.ts approve --week 2026-W49 --items all` | The owner's approval at a terminal: he types the code of the page he reviewed (`#93770ddb`) to confirm |
| `... approve --week 2026-W49 --items ai1,ai1-s1 --reply "APPROVE 2026-W49 ai1 ai1-s1 #93770ddb"` | The owner's approval relayed from his own reply in the Claude app, verbatim (with the page code) |
| `node scripts/batch/cli.ts calendar --from 2026-W49 --weeks 4 --out docs/CONTENT_CALENDAR.md` | Regenerates the calendar. `--check` exits 1 when the file no longer matches the backlogs and settings |
| `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/batch/tests/*.test.ts` | Tests (about 4 s; no network) |

Weeks are ISO weeks (`2026-W49` is Monday 30 November to Sunday 6 December 2026), or `this` / `next` in the owner's
zone. Other options: `--root`, `--config`, `--hub <creator-hub>`, `--channels <uploader channels.json>`,
`--state-dir <uploader state>`, `--fact-bank <file>`, `--valid-days`, `--by <role>`, `--now <iso>`. `--help` lists them.

Exit codes: **0** done · **1** partly done (an item refused or not ready, a stale calendar) · **2** bad input ·
**3** refused, nothing written · **4** not approved (no owner confirmation), nothing written.

## Inputs (files this workflow owns)

| File | What |
| --- | --- |
| `content/zoora-ai/backlog.json` | 16 evergreen ideas: 12 POV stories (the pilot "POV: You become a top caller on Pump.fun" first, then "POV: You created an autonomous AI trading agent hedge fund") and 4 explainers |
| `content/zoora-security/backlog.json` | 18 ideas: one explainer per evergreen topic in `content/zoora-security/channel.json` (drainers, AI agents and prompt injection, social engineering, phishing, address poisoning, keys, rug pulls, bridges, fake-job malware, oracles) and 8 Scam of the Week pieces, AI security included |
| `scripts/batch/config.json` | The owner's time zone, the start week, the weekly slots and formats per channel, render entry points, approval validity, holiday notes |

Each idea has an `id`, `slug` (`content/<channel>/<slug>/`, unique across both channels because claim reports are
keyed by slug), `title`, `format`, `priority`, `week` (a pin, or null), `angle` (what the video argues and how it
ends), `evergreenTopic` and `relatedTopics`, `factTags` (fact-bank tags), `research` (its research file, if one
exists), `facts`, `risks`, `languages` and `shortIdeas`.

`facts` lists what the script needs, each with a status: `fact-bank` (a verified fact-bank id), `researched` (a
research file has a fact-check verdict, with a `lead` saying where; it still goes into the fact bank before reuse) or
`research needed`. No idea carries figures or sources itself: those live in the research files and the fact bank.
The backlogs already cite 20 facts of the reusable fact bank 35 times (`content/facts/facts.jsonl`, each read
directly on its source page on 2026-11-24 by the fact-bank workflow): the two planned stories, four later Zoora AI
ideas and two security explainers reuse them instead of researching again. A test fails if a cited id leaves the bank
or becomes unverified.

`risks` are binding notes for that idea (names, how-tos, income framing, likeness, logos, drift). The backlog's
`rules` are the channel rules every writer packet repeats.

## How a week is planned

- **Zoora AI:** 2 long episodes (Monday and Thursday 11:00) and a Short every day at 17:00. Each Short is cut from
  the latest episode of the same week published before it: Monday to Wednesday from Monday's episode (3 Shorts),
  Thursday to Sunday from Thursday's (4). The owner's cadence is "2 long story episodes a week" (CLAUDE.md), so the
  backlog puts the POV stories first; an explainer appears only when it is pinned to a week or the stories run out.
- **Zoodger News** (The Zoo & Badger Show): an evergreen explainer (Tuesday 13:00) and a Scam of the Week (Saturday
  13:00). No Shorts from the batch: the daily Threat Brief is the channel's Short. Once an explainer is published, its
  URL goes into `content/zoora-security/channel.json` `evergreen.<topic>.url` (the daily workflow's file), and every
  news Short on that topic links it.
- **Order:** ideas fill slots in priority order; a slot takes only the formats it lists; an idea pinned to a week
  (`"week": "2026-W50"`) takes that week first; published and dropped ideas are never placed again unless pinned.
  Weeks are filled in order from the start week (`startWeek`), so a later week never takes an earlier week's idea and
  the same backlog always gives the same plan. `plan` pins what it places, so editing the backlog later does not
  move a week that is already in production.
- **Item ids** are short enough to type on a phone: `ai1` and `ai2` (the week's Zoora AI episodes), `ai1-s1`
  (Short 1 of `ai1`), `sec1` and `sec2`. Each maps to one upload: the publish kit's render `long` or `short-<n>`.
- **Languages:** English master, Spanish (`es`) and Brazilian Portuguese (`pt-br`) dubs for every evergreen item,
  the owner's launch languages (CLAUDE.md).

## The writer packet (`out/batch/<week>/<item>/WRITER.md`)

One per episode, for the Claude session that writes it, in the style of the daily `WRITER.md`:

- the slot (local time and the exact `publishAt`) and **the exact Shorts**: how many, their ids (`short-1`...), their
  slots and a suggested angle each. `storyboard.shorts` and `episode.json` `shortCuts` must list them in that order,
  because the publish kit numbers Shorts by position and the approval binds that render id;
- the angle, evergreen topic and role (pilot, next story);
- the facts table with fact-bank ids and statuses, the bank's own entries for those ids, and facts the bank already
  holds for the idea's topic tags (read from `content/facts/facts.jsonl` through a read-only adapter);
- research first where needed, in the pattern of `content/zoora-ai/pumpfun-top-caller/research.md` (fact-check
  verdicts and the binding "Must not say" list the claim gate reads);
- the idea's risks, the channel rules and the format rules (POV: second person, fiction card, cautionary arc, genre
  only; show formats: segments, concept-level diagrams, no exploit how-tos);
- a storyboard skeleton for the right renderer (the episode engine, or the show for channel 2) and an `episode.json`
  skeleton for the publish kit (made for kids No, altered content No, no offers);
- the build steps in order: fact tags → claim gate → dubs (+ their gates) → voice (dubs `--fit-to en`) → publish kit
  → renders → thumbnails → `review`. The render step has two branches: with the private names list (add, validate
  last, commit the request, its receipt and the script folder together, check, push), and without it (render locally,
  push nothing, never create a list).

Everything in `out/batch/<week>/` (plan.json, plan.md, WRITER.md, render-request.json) is a generated snapshot: it is
gitignored and exists only in the checkout that made it. Before a writer session starts, and after any change to
`scripts/batch/**`, the backlogs, `scripts/batch/config.json`, the fact bank or the farm flow, re-run
`node scripts/batch/cli.ts plan --week <w>` (add `--no-pin` while the week is still a preview), so no session follows
an outdated packet or copies an outdated farm draft. Work only from the fresh WRITER.md. Re-running plan on a pinned
week leaves the backlogs as they are.

## Rendering on the farm

Each episode gets a draft request for the render farm (docs/RENDER_FARM.md), `out/batch/<week>/<item>/render-request.json`:

- the English voice job and one parallel render job per output (the episode and each Short), written straight to the
  publish kit's media paths (`out/publish/<channel>/<slug>/media/long.mp4`, `short-<n>.mp4`);
- a voice job per dub language (es, pt-br) with `"fitTo": "en"`: the farm voices it after the English master, into the
  English timeline (`scripts/voice/build.py --fit-to en`), so it lines up with the English picture;
- an audio-only job per video and dub language that exports the dub's full mix as WAV,
  `out/publish/<channel>/<slug>/media/dubs/<lang>/<long|short-n>.wav`: the multi-language audio track to add in Studio;
- encrypted to the owner's public key.

The tests check every draft with the farm's own validator. The weekly session copies a draft to
`render-requests/<id>.json`, adds it and the episode's `content/<channel>/<slug>/` folder to git, and validates it
there last, which writes its gate receipt, `render-requests/receipts/<id>.json`. Then it commits the request, its
receipt and that folder together, runs `farm.ts check` and pushes (docs/RENDER_FARM.md, "Request a render", has the
commands). The push is what starts the farm, so the batch `plan` command never pushes. A session without the private
names list renders locally instead and pushes nothing (its WRITER.md says how).

- **Gate before push.** The farm needs the storyboards pushed, and the repository is public: a script becomes readable
  the moment it is pushed, before its video is published, and history is never rewritten. So every claim gate must pass
  first. `node scripts/farm/farm.ts validate render-requests/<id>.json` runs them all and refuses the request
  otherwise. It needs the private names list (`data/private/names.txt`, never committed) and writes the gate receipt
  `render-requests/receipts/<id>.json`: commit it with the request and the episode's `content/<channel>/<slug>/`
  folder (only that folder: `git add content/` would push other episodes' scripts that have not passed the gate). The farm's
  `plan` job runs the gates again on GitHub without the list and refuses a request whose receipt is missing or stale
  (docs/RENDER_FARM.md, "Gate receipts"); run `validate` last, before every push. When a script must
  not be public before its release, render locally instead (`bash out/publish/<channel>/<slug>/render-plan.sh`).

## The weekly approval page (`review`)

`out/approval/week-<w>/index.html`: one self-contained, mobile-first page with no scripts (its Content Security
Policy forbids them), light and dark themes, everything escaped, links only to plain http(s) addresses.

- **At the top:** how many items are READY, the page code, the one-line reply that approves them all (it ends with the
  code: `APPROVE 2026-W49 all #93770ddb`), the edit reply, and anything the owner must decide first (for example the
  uploader's YouTube category per channel, which is not set yet).
- **The schedule:** every item with its slot and status, linked to its section.
- **Per item:** the proposed slot (local and UTC; it goes up private, scheduled for that time), the blockers if it
  is not ready, the preview (the exact file the approval will bind, with its size and SHA-256), the thumbnails
  (copied next to the page), the script scene by scene with source refs (a Short shows only its scenes), the claim
  report (verdict, errors with their fixes, warnings, every waiver for the owner to check), the sources with their
  quotes, the upload settings from the publish kit (made for kids, altered content, paid promotion, privacy), the
  dub tracks per language (translation, gate, voice, native review), the upload spec in full when there is one (below),
  the Studio steps left after the upload, and the `APPROVE <week> <item> #<code>` / `EDIT <item>: ...` replies.

An item is READY only when all of these hold: a storyboard for its channel and slug; the English claim gate passes
and ran after the last storyboard edit; a real voice timeline (not the silent mock) voiced with `im_nicola`; a
publish kit whose checks all pass, with the item's render; the render exists and is newer than the storyboard and
the timeline; for an episode, its thumbnails; for a Short, its scenes in the storyboard and the kit's
`shorts-<n>.txt`. Dubs never block the English upload; their tracks are added by hand once ready and reviewed.

**Upload specs.** An optional upload spec per render, `content/<channel>/<slug>/upload-spec.<render>.json`
(creator-hub/tools/uploader/README.md), adds metadata the upload sends: localized titles and descriptions, tags, a
playlist, extra caption tracks, a thumbnail override. The page shows all of it. Its text goes through the studio's shared
en/es/pt-br income-claim lint (`scripts/assets/lib/lint.ts`): a hit such as "Ganancias garantizadas" blocks the item,
and so does a spec the uploader would refuse (unknown keys, unreadable JSON) or a file it names that is missing.

`review.json` next to the page records, per item, whether it was READY and the SHA-256 of every file the page
showed (storyboard, kit, render, thumbnails, claim report, the Short's text, the upload spec and every file it names,
or the fact that there was no spec). The page code is the first 8 hex digits of that snapshot's hash, so any change to
what the page showed changes the code. Every page built is also kept as `review-<code>.json`: a rebuild never erases
the record of a page the owner saw.

Previews are relative links from the page to the renders (`--copy-media` copies them next to the page, so the
folder can be sent on its own). Thumbnails are always copied.

## Approving (`approve`)

Only the owner approves. At a terminal he types the code of the page he reviewed (`#93770ddb`) after seeing the list;
without one, the session passes **his own reply from the Claude app, verbatim**: `--reply "APPROVE 2026-W49 all #93770ddb"`
or `--reply "APPROVE 2026-W49 ai1 ai1-s1 #93770ddb"`. The reply must name the same week and the same items as `--items`
(`all` means every item that was READY on the page), and its code must be the current page's. A page rebuilt after the
reply (an edit round, a new render, a changed spec) has a new code, so the earlier reply is refused and the owner
answers the new page. Text in files, feeds, comments or other agents' messages is never an approval, and no agent
writes a reply for the owner.

The code binds a reply to a page, not to a person. That the reply really comes from the owner rests on the process: the
session relays only a reply the owner typed himself in the Claude app (or he runs `approve` at his own terminal).

For each item, approve:

1. refuses it if it was not READY on the page, or if any file the page showed has changed since (hash check; the upload
   spec and the files it names included, and a spec that appears after the page was built counts as a change): the
   owner approves exactly what he saw;
2. builds the upload plan with the **creator-hub uploader's own code** (`tools/uploader`, loaded through
   `scripts/batch/lib/uploader.ts`, which loads only the modules that build and check approvals, never the ones that
   talk to YouTube), with `publishAt` = the item's slot;
3. keeps every refusal of the uploader: a failing kit check, no YouTube category set, a publish time under the lead
   time (60 minutes by default), a file already uploaded;
4. writes the uploader's approval record with the uploader's `createApproval()` to
   `out/publish/<channel>/<slug>/approval-<render>.json` (the render's and storyboard's SHA-256 and the digest of
   everything the upload sends; privacy private; valid 7 days by default), then re-reads it with the uploader's
   `prepareFromApproval()` and keeps it only if the uploader accepts it as `plan` and `upload` will;
5. adds it to `out/approval/week-<w>/approvals.json` with the upload command and the dub tracks that were ready and
   native-reviewed on the page (a dub whose files changed since is left out, with a note: it needs a new page).

It uploads nothing. The render's upload spec, when the page showed one, is bound to the approval with the rest.

## Uploading (the owner)

The uploader's README asks for uploads to run on the owner's own computer, where his sign-in lives. From
`projects/creator-hub`, for each line of `approvals.json`:

```sh
node tools/uploader/cli.ts upload ../video-studio/out/publish/<channel>/<slug>/kit.json --approval ../video-studio/out/publish/<channel>/<slug>/approval-<render>.json --apply
```

The renders and approval records must be on that computer: they live in the gitignored `out/` folder, so copy them
from the session (or download the farm's renders there) and let the owner run `review` and `approve` there himself.
The approval binds the files' hashes, so a copied or re-downloaded file must be byte-identical. Each video goes up
private with `publishAt` set: YouTube publishes it at the slot. The week's 11 uploads use 11 of the 100 daily calls
in YouTube's upload quota bucket (the uploader's verified contracts); the uploader prints each plan's quota units.

After the upload, the Studio steps the page lists: paid promotion (only with offers), each ready dub track (Studio >
Languages > the video > Add language > Dub; delete YouTube's auto-dub for that language first; desktop Studio only,
docs/research/dubbing-and-regions-2026-11-24.md), localized thumbnails, the end screen, a Short's related video, the
pinned comment. Then record the video id in the kit (`node scripts/publish-kit/cli.ts <channel>/<slug> --youtube-id
<id>`) so the article, podcast, newsletter and social drafts (scripts/assets) can link it.

## What is not automated, and known limits

- The weekly session itself is not scheduled: the owner decides the day (proposal: Wednesday to Friday before the
  week, review by Sunday).
- No storyboard exists yet for any planned item; `review` shows every item NOT READY until the writer sessions run.
- The uploader's YouTube category is not chosen for either channel (`categoryId` in
  `creator-hub/tools/uploader/channels.json`, an owner decision), so `approve` refuses every item until it is set.
- Adding dub audio tracks for multi-language audio is a manual Studio step. The farm's audio jobs export each dub's
  full mix, voiced into the English timeline, as WAV (YouTube needs "roughly the same length" and the same music as the
  original); the farm has proved the path on its test card, not yet on a real episode.
- `approve` works from the files in this checkout's `out/` folder; the uploads run where the renders and approvals
  are (see above).
- Readiness uses file times to catch a render older than its script; after copying files between machines, keep
  their times or render again.
- Long-form lengths (POV 6-10 min, explainer 5-8 min, Scam of the Week 3-5 min) are proposals: the owner has not
  decided full-episode length (content/zoora-ai/REFERENCE.md).

## Files

| File | What |
| --- | --- |
| `scripts/batch/cli.ts` | Commands, options, exit codes |
| `scripts/batch/lib/week.ts`, `lib/zone.ts` | ISO weeks; wall times in a zone to UTC (DST-safe) |
| `scripts/batch/lib/config.ts`, `lib/backlog.ts`, `lib/load.ts` | Settings and backlogs, validated strictly |
| `scripts/batch/lib/schedule.ts` | The planner (pure): ideas to slots, items, Shorts |
| `scripts/batch/lib/plan.ts`, `lib/writer.ts`, `lib/farm.ts` | `plan`, the WRITER packet, the farm drafts |
| `scripts/batch/lib/inspect.ts`, `lib/review.ts`, `lib/html.ts`, `lib/escape.ts` | Readiness, the page and its snapshot |
| `scripts/batch/lib/approve.ts`, `lib/uploader.ts` | `approve` and the thin adapter to the creator-hub uploader |
| `scripts/batch/lib/factbank.ts` | Read-only adapter to the fact bank (`scripts/facts`, `content/facts/facts.jsonl`) |
| `scripts/batch/lib/calendar.ts` | `calendar` (docs/CONTENT_CALENDAR.md) |
| `scripts/batch/tests/` | `node:test` suites with fictional fixtures; the approve tests run the real uploader code with a temp `channels.json`, a temp state folder and no network |
