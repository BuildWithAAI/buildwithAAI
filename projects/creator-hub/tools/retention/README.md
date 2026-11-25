# Scene-level retention feedback

Shows where viewers leave each video, scene by scene, and which templates hold or lose viewers across episodes.
It joins YouTube's audience-retention curve with our own scene timeline (we know every scene's start and end), so it
can say, for one video, "viewers drop at Badger's Red Flag: 8.2 pp per 10 s, 5.3 pp more than expected at that
moment" (only when that is more than 2 standard errors of sampling noise for the video's playbacks), and across many,
"within each channel, openings under 3 s kept 3.7 pp more viewers at 0:30 (95% CI +1.2 to +6.2 pp; about +5%
relative to the 73.3% that longer openings kept; 7 vs 17 episodes)". Those two examples come from the SYNTHETIC demo
set (`demo`), not from real videos. Every recommendation carries the numbers that triggered it, and nothing is
recommended on thin data.

Status (2026-11-24): built and tested on synthetic fixtures only. The API client follows the official
documentation read on 2026-11-24, but it has **never been run against the live YouTube API** from this machine,
and no real video has been analysed yet. It only reads: nothing here uploads, publishes or changes anything on
YouTube.

## Before the first pull (owner, once)

1. **Policy decision (required).** YouTube's API Developer Policies (III.E.4.h, updated 2026-11-06) say "Your API
   Clients must not ... (ii) access or use API Data to create new or derived data or metrics", and the
   [derived-metrics page](https://developers.google.com/youtube/terms/derived-metrics-policy) (updated 2026-09-14)
   permits them only "subject to your acceptance of the amendment to the Developer Policies" (both read 2026-11-24).
   This tool derives metrics (drops per 10 s, comparisons, recommendations), so `pull`, `refresh` and `report` refuse
   to run (exit 4) until one of the two decisions the policy allows is recorded:
   - **Accepted.** Submit the YouTube API Services audit and quota extension form for your Google Cloud project and
     choose "Section 5: Use Cases, API Integration, and Feature Implementation", then "Analytics & Reporting" (as that
     page says). Then `node tools/retention/cli.ts policy --derived-metrics accepted --date YYYY-MM-DD`.
   - **Exempted in writing.** Only if YouTube itself answered in writing that this use needs no amendment: quote their
     words, with where they came from:
     `node tools/retention/cli.ts policy --derived-metrics exempted --date YYYY-MM-DD --note 'YouTube API Services, case <id>: "<their words>"'`.

   There is no self-exemption: deciding yourself that the amendment does not apply is not an option, and a
   `not-required` decision recorded by an earlier version is no longer accepted. The same exposure applies to any
   tool that computes ratios from YouTube API data (for example the dashboard's rates per 1,000 views), so the
   decision covers more than this tool.
2. **Google Cloud project.** Enable the *YouTube Analytics API* and the *YouTube Data API v3*. Create an OAuth client
   of type **Desktop app** and download its JSON. Set the OAuth consent screen to **In production**: in "Testing",
   Google issues refresh tokens that expire after 7 days.
3. **Authorize** (on your own computer; the answer comes back to `http://127.0.0.1:<port>`):
   ```sh
   cd projects/creator-hub
   node tools/retention/cli.ts auth --client-secrets ~/Downloads/client_secret_XXXX.json
   # Zoodger News (zoora-security): add --account security and sign in as @ZoodgerNews
   ```
   It asks for two **read-only** scopes, `yt-analytics.readonly` and `youtube.readonly`, and saves the tokens to
   `data/retention/oauth.json` (gitignored, mode 600). It refuses to write tokens anywhere git would track, and warns
   when the client-secret JSON you pass sits where git would commit it: keep that file outside this public repository
   (`client_secret*.json` and `*.apps.googleusercontent.com.json` are also gitignored in this folder).

## Use it

```sh
cd projects/creator-hub
# after an upload has had a few days of views (YouTube's data is 48-72 h behind):
node tools/retention/cli.ts pull --video <id> --slug zoora-ai/pumpfun-top-caller --lang en
node tools/retention/cli.ts pull --video <id> --slug zoora-ai/pumpfun-top-caller --lang es
node tools/retention/cli.ts pull --video <id> --slug zoora-ai/pumpfun-top-caller --lang en --short short1
node tools/retention/cli.ts pull --video <id> --slug zoora-security/<slug> --lang en          # the show
node tools/retention/cli.ts report        # writes out/retention/report.md and report.json
node tools/retention/cli.ts status        # what is stored, how old, which accounts
node tools/retention/cli.ts refresh       # every 30 days (see "Storage rules")
node tools/retention/cli.ts demo          # a SYNTHETIC example report, no YouTube calls: out/retention-demo/
```

| Command | What it does |
| --- | --- |
| `auth` | Loopback + PKCE consent, then saves tokens. `--client-secrets` the first time, `--account <key>` per channel. |
| `pull` | One upload: YouTube's 100-point retention curve, its views, and its Data API duration; joins it with our timeline and saves a record. Options: `--short <id>`, `--start/--end`, `--audience all\|organic\|ad-instream\|ad-indisplay`, `--timeline <file>` and `--storyboard <file>` (e.g. a timeline unpacked from a render-farm artifact), `--renderer episode\|show`, `--video-studio <dir>`, `--mla` (the upload carries extra dubbed audio tracks), `--account`. |
| `refresh` | Re-pulls every stored upload older than 30 days (`--all`: every one); deletes the records of videos that no longer exist. |
| `report` | `out/retention/report.md` (for you) and `report.json` (for the dashboard and the storyboard writer). `--min-views`, `--include-stale`, `--allow-unverified-duration`, `--out`. |
| `status` | Stored pulls with age and sample size, saved authorizations (never the tokens), the policy decision. |
| `forget` | Deletes stored pulls (`--video <id>` or `--all`; `--reports` also deletes the reports). Only this tool's copies; nothing on YouTube changes. |
| `revoke` | Revokes the authorization at Google, deletes it and every pull made with it. |
| `policy` | Records (or shows) your derived-metrics decision. |
| `demo` | Writes a synthetic report from the generated test set. |

Common option `--data <dir>` (default `DATA_DIR` or `projects/creator-hub/data`). Exit codes: 0 ok, 1 failed, 2
usage, 3 not authorized, 4 policy decision missing.

## Where to run it: your own computer

Run this tool on the owner's computer, with the token file from `auth`. **Do not put its credentials in this
repository's GitHub secrets.** The repository is public, its workflow logs and artifacts are public, and its
workflows run on pushes to any branch, so a workflow edited on any branch could read repository secrets. A refresh
token with `yt-analytics.readonly` + `youtube.readonly` reads every analytics figure of the channel.

If a scheduled run is ever wanted anyway:

- use a **private** repository, or a GitHub **Environment** (for example `retention`) that holds the
  `YT_ANALYTICS_*` secrets, with **required reviewers** and a deployment branch policy of **`main` only**, so no other
  branch's workflow can read them;
- the tool already prints **counts only** when `CI` or `GITHUB_ACTIONS` is set: no views, drops, percentages or
  recommendation titles reach the log (tested);
- never upload `report.md`, `report.json` or `data/` as a plain artifact: encrypt them first, or keep them on the
  runner.

The variables it reads there: `YT_ANALYTICS_ACCESS_TOKEN`, or `YT_ANALYTICS_CLIENT_ID` + `YT_ANALYTICS_REFRESH_TOKEN`
(+ `YT_ANALYTICS_CLIENT_SECRET`) (the dashboard reads the same ones), and `RETENTION_DERIVED_METRICS=accepted` +
`RETENTION_POLICY_DATE` (or `exempted` + the date + `RETENTION_POLICY_NOTE` quoting YouTube's written answer).

## What each pull checks

- **Duration**: YouTube's `contentDetails.duration` must be within max(1.5 s, 2%) of the timeline (long-form:
  `timeline.totalMs`; a Short: the sum of its scenes). A bigger gap means another cut was uploaded, so scene
  positions would be wrong: the record is kept but excluded from the report.
- **Format**: `creatorContentType` (SHORTS vs VIDEO_ON_DEMAND) must match `--short`.
- **Language**: `snippet.defaultAudioLanguage` vs `--lang` (warning only).
- **Timeline**: gaps, overlaps, empty scenes, scenes past the end, scenes missing from the storyboard or the
  timeline, a missing Short scene, a mock (silent preview) timeline. The scene layout is **snapshotted into the
  record** with the timeline's sha256, so reports keep working after `public/generated/` is rebuilt.

## How the numbers are made

YouTube values are copied as returned. Everything else is our calculation, and the report says so.

- **Curve.** YouTube returns 100 buckets per video; `elapsedVideoTimeRatio` is the exclusive end of each bucket. Each
  value sits at its bucket's midpoint, joined linearly. Missing buckets are filled from their neighbours (at least 90
  must be present). Values above 1 (rewinds, Shorts loops) are kept.
- **Per scene** (start ratio = startMs / video length): retention in and out, **drop per 10 s** (percentage points of
  the video's views), **loss rate** (% of the viewers still watching who left per 10 s, read between the first and
  last *whole* buckets inside the scene, so the bucket that straddles a cut, e.g. into the end screen, never leaks
  in), mean relative retention performance, and the share of playbacks that ended in the scene (`stoppedWatching`).
  A scene with fewer than 2 whole buckets is listed but not measured on its own.
- **Hook windows.** Retention at 0:05 and 0:30, what was lost in them, which scenes they cover, and each against the
  channel's typical curve (the median of at least 3 *other* episodes, aligned in seconds, not as a share of the video).
- **Scene model** (per channel and format). Loss rate = upload level + the channel's drop-off at that moment + the
  template + Badger. Fitted jointly: upload fixed effects (topic, thumbnail, audience, language version), a drop-off
  curve exp(-t/τ) with τ picked from a grid, one category per scene (its show segment, else its template type), and
  Badger on/off. Template effects are against the **median template**, so one bad segment cannot make its neighbours
  look good; Badger is compared only with scenes of the same template. Standard errors are clustered by episode.
  Openings (judged by the hook analysis) and end screens (everyone leaves at the end) are left out.
- **Can it tell a template from its moment?** Only if the template's order changes between episodes. A template that
  always comes in the same place, or whose effect disappears when the drop-off curve may bend (a log-time slope and a
  hinge added), is capped at "worth watching" with the advice to move it in a few episodes. This is the honest limit
  of observational data, and an easy experiment to run.
- **Episode level.** Openings under 3 s vs the rest (Welch's t) and the slope per extra second of opening, on
  retention at 0:30 (long-form) or 0:05 (Shorts), centred within each channel. The headline is that within-channel
  difference in pp. A relative figure ("about +5%") is the same difference divided by the longer openings' mean, with
  its interval; the raw group means are shown only as context, because they mix channels (in the demo set the raw
  ratio is +11%, about twice the adjusted +5%). Languages: each dubbed upload minus the English upload of the same
  episode (paired). Uploads with extra dubbed audio tracks (`--mla`) are left out of language pairs because their
  curves blend languages.
- **Per-upload drops and sampling noise.** One upload's scene is named under "Where viewers leave" only when its loss
  beyond expected is more than 2 standard errors of sampling noise for that upload's playbacks (binomial: 100 ×
  sqrt(share watching × q × (1 - q) / n) pp, per 10 s); smaller ones are counted as "within sampling noise". A
  rewatch spot needs a rise of at least 1 pp and above 2 Poisson standard errors (100 × sqrt((in + out) / n) pp: about
  11 pp at 100 playbacks, 1.1 pp at 10,000). Real curves are noisier than this, so it is a floor, not a test.

### Gates (rules.ts), and why

| Rule | Value | Why |
| --- | --- | --- |
| Views per curve | 100 playbacks (or views) | At n = 100 a bucket's binomial SE is 5 pp at 50% retention; below it, single viewers move a scene by a point or more, and YouTube may withhold low-traffic data (data_model#data-anonymization). |
| Buckets present | 90 of 100 | A few gaps are interpolated; more would invent the curve. |
| Measurable scene | 2 whole buckets | A bucket is 1/100 of the video (0.6 s at 60 s, 6 s at 10 min); a shorter scene only shows its neighbours. |
| Typical curve | 3 other episodes | A median of fewer is one video's quirks. |
| Independent unit | the episode | Language versions share a script; counting them separately would overstate the evidence. |
| Comparison | 5 episodes per side (8 for a slope) | Below 5, one episode is 20%+ of the sample and the 95% t multiplier is at least 2.78. |
| Practical size | 1% of viewers per 10 s (scenes), 2 pp (hooks, languages), 0.5 pp per second (hook slope) | Smaller effects would take dozens of episodes to confirm and are unlikely to matter. |
| False discoveries | Benjamini-Hochberg q ≤ 0.10 over every comparison in the report | The report runs dozens of tests; without this some "findings" would be chance. |
| Staleness | 30 days | YouTube API Developer Policies III.E.4.b-c. |
| Per-upload drop or rewatch spot | above 2 standard errors of sampling noise (and a rise of at least 1 pp) | At 100 playbacks a scene's loss moves several pp by chance alone; without this every small upload would name about 3 "drop" scenes. |

Status of each comparison: **insufficient data** (below the episode minimum, or not identifiable), **no clear
difference** (interval includes 0, or the effect is below the practical size), **worth watching** (interval and size
pass, but it could be chance or is tied to its moment), **supported** (all gates pass; only these become
recommendations).

### Calibration on synthetic data

The generator (`synth.ts`) builds curves from a known hazard model with seeded noise: 24 long-form episodes (two
channels, three languages), 9 Shorts, and broken uploads. With effects injected (Badger's Red Flag +7% per 10 s,
charts -2.5%, a hook bonus for openings under 3 s), 30 regenerated datasets found them 30/30, 29/30 and 27/30
times, with mean estimates +6.81 and -2.56 (unbiased); about 5% of all discoveries were false. With **no** effect
injected, 3 of 100 datasets produced any recommendation (5 false out of 2,000 tests). Two earlier designs failed
this check and were replaced: a typical curve aligned as a share of the video (the 20 s end screen sits at a
different share of each video) and "this scene vs the rest of its episode" (one bad scene makes every other look
good).

## report.json (contract for the dashboard and the storyboard writer)

`{version: 1, kind: "retention-report", generatedAt, synthetic: "all"|"some"|"none", disclosure, policy, summary,
recommendations[], comparisons[], formats[], uploads[], rules, sources}`

- `recommendations[]`: `{id, comparisonId, format, title, action, evidence, numbers: {estimate, unit, ci95, p, q,
  episodes, group, rest, standardized, relative, relativeCi95}, suggestedRule, recheck}`. `relative` is the estimate
  divided by the comparison group's mean (two-group designs only), `relativeCi95` its interval.
- `suggestedRule` kinds: `scene-length-cap {type|segment, maxSec}`, `prefer-scene {type|segment}`,
  `hook-length-cap {maxSec}`, `hook-room`, `prefer-badger-on-screen`, `review-badger-scenes`, `review-dub {lang}`,
  `prefer-dub {lang}`. These are **proposals**: they become binding only after the owner approves them.
- `comparisons[]`: `{id, family, format, channel, group, label, outcome, unit, design, n, estimate, ci95, p, q,
  relative, relativeCi95, status, reason, momentConfounded, details}`. The hook comparison's `details` also carry the
  raw, channel-mixed `rawDiffPp` and `rawRelative` (context only).
- `uploads[]`: per upload, the exclusions, sample, hook metrics and every scene's metrics (`entry`, `exit`,
  `dropPer10sPp`, `lossRate`, `lossSpanMs`, `model.excessRate`, `model.excessPpPer10s`, `model.sePpPer10s` (sampling
  noise), `stopShare`, `typical.levelPp`, ...).

## Storage rules (YouTube API Developer Policies III.E.4, read 2026-11-24)

- Pulls are stored in `data/retention/videos/<videoId>.json` (gitignored, mode 600). Analytics data may be kept, but
  every 30 days the authorization must be re-checked and the video confirmed to exist: run `refresh` (stale pulls
  are left out of reports until then). The Data API fields in a record (duration, publish date, audio language) must
  be refreshed or deleted within 30 days; `refresh` does that too.
- `forget` deletes stored data on request; `revoke` revokes at Google and deletes the data pulled under it.
- The report shows each upload's pull date and data window, and marks derived figures as not from YouTube.
- The repository is public: never commit `data/` or `out/` (both are gitignored).

## Integrating with video-studio (read-only)

- Timelines: `video-studio/public/generated/<channel>/<slug>/<lang>/timeline.json` (the voice step). Storyboards:
  `content/<channel>/<slug>/storyboard[.<lang>].json`; the `_dev` channel uses the dev fixtures folders. A language
  without its own storyboard falls back to `storyboard.json` (scene ids are stable).
- Show segments follow `src/show/types.ts` (`scene.segment`: coldOpen, headline, howItWorked, badgerRedFlag, zooOneFix,
  scamOfTheWeek, correction, sources, outroEndScreen, beat, desk; defaults hook → coldOpen, endscreen →
  outroEndScreen, else desk). The renderer defaults to the show for `zoora-security`; a ShowShort trims its outro to
  the speech plus 45 frames, as `src/show/timing.ts` does. Episode-engine uploads get segments only when explicit, or
  inferred from a branded title ("Badger's Red Flag", "Zoo's One Fix", "Rekt Meter", "Scam of the Week", "What We
  Know") in the source-language storyboard.
- Reused by import: comment-guard's `readClientSecrets`, `revokeToken`, `AuthError` and Google endpoints, and the
  dashboard's `REPORTS_URL` and `resolveAccessToken` (YT_ANALYTICS_* variables).

## Limits

- Correlation in past uploads, not cause. The scene model and paired designs reduce confounding; they do not remove it.
- One video per retention query (the API's rule). Quota: each Analytics request costs 1 unit; a pull makes 2-4
  Analytics requests and 1 Data API request (`videos.list`, 1 unit).
- Multi-language audio tracks cannot be separated through the API, and YouTube may auto-dub English uploads, so
  "language" means the upload's own audio language.
- Shorts: since 2025-03-31 a Short's views count every start and replay (`engagedViews` keeps the old count); the
  tool uses the smaller of the two for its view minimum when `startedWatching` is missing. Co-views on TVs are
  included in views from 2026-11-16 (revision history).
- Cluster-robust intervals with few episodes are approximate; this is why the episode minimum, the practical size
  and the false-discovery check all have to pass.

## Sources (read 2026-11-24)

- Channel reports, audience retention: https://developers.google.com/youtube/analytics/channel_reports#audience-retention-reports (updated 2026-11-12)
- Dimensions, `elapsedVideoTimeRatio` ("100 data points ... 0.01 to 1.0 ... exclusive end of the interval") and `audienceType`: https://developers.google.com/youtube/analytics/dimensions#elapsedVideoTimeRatio (2026-11-12)
- Metrics, `audienceWatchRatio`, `relativeRetentionPerformance`, `startedWatching`, `stoppedWatching`, `totalSegmentImpressions`: https://developers.google.com/youtube/analytics/metrics#Audience_Retention_Metrics (2026-11-16)
- `reports.query` (one video id for retention reports; "now require[s] access to the youtube.readonly scope"; scopes): https://developers.google.com/youtube/analytics/reference/reports/query (2026-11-12)
- Sample request, audience retention: https://developers.google.com/youtube/analytics/sample-requests#channel-audience-retention-reports
- Data model (48-72 h latency, anonymization, 1 unit per request): https://developers.google.com/youtube/analytics/data_model (2026-11-12)
- Revision history (2024 segment metrics; video filter required, group not supported; Shorts view counting; co-views): https://developers.google.com/youtube/analytics/revision_history (2026-11-16)
- Discovery documents: https://youtubeanalytics.googleapis.com/$discovery/rest?version=v2 (rev 20261122), https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest (rev 20261123)
- Quota costs (videos.list, channels.list 1 unit): https://developers.google.com/youtube/v3/determine_quota_cost (2026-11-12)
- Developer Policies III.E.4: https://developers.google.com/youtube/terms/developer-policies (2026-11-06); derived metrics: https://developers.google.com/youtube/terms/derived-metrics-policy (2026-09-14)
- OAuth for installed apps (loopback, PKCE): https://developers.google.com/identity/protocols/oauth2/native-app (2026-11-19); refresh-token expiry ("Testing": 7 days): https://developers.google.com/identity/protocols/oauth2#expiration (2026-11-19)

## Files

`cli.ts` (commands) · `api.ts` (YouTube calls) · `oauth.ts` (consent, tokens) · `gitignore.ts` (would git commit
this file? shared with the uploader) · `store.ts` (records, policy decision) · `timeline.ts` (join with video-studio) · `segments.ts` (show segments adapter) · `curve.ts`
(100-point curve) · `analyze.ts` (per upload) · `scenemodel.ts` (joint scene model) · `aggregate.ts` (comparisons,
false-discovery control) · `recommend.ts` · `report.ts` · `rules.ts` (every threshold) · `stats.ts` · `synth.ts`
(synthetic data) · `mock-google.ts` (test fake of Google) · `fixtures/video-studio/` (edge-case timelines and
storyboards) · `*.test.ts`.

```sh
node --test "tools/retention/**/*.test.ts" && npx tsc --noEmit
```
