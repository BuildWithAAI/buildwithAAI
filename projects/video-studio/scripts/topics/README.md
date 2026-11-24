# Topic finder (`scripts/topics`)

Finds videos in our niches that got far more views than their channel usually gets, and turns them into a ranked
list of **our own** video ideas: one pitch per idea, with the source link, why it is an outlier, our original angle,
the facts to verify and the channel fit, plus candidates in the format of `content/<channel>/backlog.json`.
Python 3 standard library only.

> **Status (2026-11-24): built and tested on synthetic fixtures; never run against the live API.** Two things
> stand between it and a live run, both owner decisions: an API key, and YouTube's acceptance of the derived-metrics
> amendment for the key's project (see "Before the first live run"). Live runs refuse to start until both exist.

```bash
cd projects/video-studio
python3 scripts/topics/topics.py find --fixtures            # synthetic data, no key, no network -> out/topics/fixtures/
python3 scripts/topics/topics.py plan                       # what a live run would call, with quota bounds
YOUTUBE_API_KEY=... python3 scripts/topics/topics.py find   # live run -> out/topics/<date>.md, .json, exports
python3 scripts/topics/topics.py prune                      # delete YouTube data older than 30 days
python3 scripts/topics/topics.py quota                      # units this tool charged today (Pacific Time)
python3 -m unittest discover -s scripts/topics/tests -t scripts/topics   # 165 tests, about 4 s
```

Exit codes: 0 done (a capped run is still 0; the report says what was cut), 1 the run failed, 2 bad input,
3 blocked (policy gate or missing key).

## What a run does

1. **Search** each niche query in `config.json` (7 niches x English, Spanish, Portuguese = 21 queries:
   crypto security, wallet drainers, AI security, prompt injection, deepfake scams, memecoin rug pulls, AI agents)
   with `search.list`, `type=video`, `order=viewCount`, `publishedAfter` = 90 days before the run date (UTC
   midnight, so the answer is cacheable all day), `relevanceLanguage` per language, 50 results. Each query ORs
   several phrasings (`wallet drainer|crypto drainer|...`). Priority-1 English queries go first, so a cap cuts the
   least important ones.
2. **Read statistics** with `videos.list` (views, likes, comments, duration, and the player's aspect ratio, which
   tells a vertical Short from long-form at no extra cost), 50 ids per call.
3. **Filter**: outside the window, live or upcoming, our own channel, `excludeChannelIds`, attack tutorials
   (never inspiration), price predictions, off-niche (no topic of ours matched), and the minimum-views floor
   (long-form 10,000 en / 4,000 es and pt; Shorts 50,000 / 20,000, because Shorts count every start).
4. **Channels**: `channels.list` for the remaining candidates' channels (uploads playlist, lifetime totals).
5. **Baselines**, in order of a free pre-score (views / lifetime average): `playlistItems.list` on the uploads
   playlist (the 50 most recent uploads) and `videos.list` for their views. The baseline is the **median** views of
   the channel's recent uploads of the **same format**, without the candidate, uploads younger than 7 days or older
   than 365, and live broadcasts; it prefers uploads counted under the same view-counting rules as the candidate
   (YouTube changed them on 2025-03-31 for Shorts and 2026-08-27 for all formats). Thin samples fall back to a
   mixed-format median, then to the lifetime average without the candidate, each flagged and discounted.
6. **Score** (`config.json` "scoring", all ours, labelled as ours):
   `outlier ratio = views / max(median, floor)` (floor 1,000 long-form, 3,000 Shorts, so a 40-view channel cannot
   produce a 350x "outlier"); a video needs **3x** to count. Rank = 100 x (0.45 outlier + 0.20 recency + 0.15
   engagement + 0.20 fit) x confidence. Outlier = log2(ratio)/log2(32). Recency halves every 30 days. Engagement =
   (likes + comments) per view against this run's median for the same format (neutral when likes are hidden).
   Fit comes from `taxonomy.json` (channel, format, cue boosts such as a story title favouring a POV story, and a
   0.95 weight for Spanish and Portuguese sources). Confidence multiplies a penalty per flag: estimated baseline
   0.6, mixed-format 0.8, thin 0.85, view-count change 0.9, format assumed 0.95, video under 3 days 0.9, floor 0.9.
7. **Ideas**: outliers are grouped by (channel, format, topic, sub-topic); an idea seen on several channels gets +3
   per extra channel (at most +9), because one viral video can be luck. Ideas that duplicate a backlog idea
   (same channel, format, evergreen topic and sub-topic, judged on its title and factTags) are not proposed again;
   they appear as "demand evidence" for that idea instead.
8. **Write** `out/topics/<date>.md` (for the owner), `<date>.json` (everything), and
   `<date>.backlog.<channel>.json` per channel (`--merge-preview` also writes the channel's backlog with the
   candidates appended, as a preview file).

## Each idea carries

- **The original video link** and its numbers as YouTube returned them, with the fetch time.
- **Why it is an outlier**, in words: "186,000 views 19 days after publishing: 18.0x this channel's median of
  10,324 across its 21 most recent long-form uploads (2026-08-30 to 2026-11-14) ...", plus our score parts and flags.
- **Our original angle**, built only from `taxonomy.json` and our show formats, never from the source's title or
  script: The Zoo & Badger Show explainers get the concept, Badger's Red Flag and Zoo's One Fix; Scam of the Week
  gets a case file; Zoora AI gets a second-person POV story that ends on the consequence and the check that would
  have stopped it. A **copy guard** rejects any working title that shares more than half its content words, or a
  run of 4+ words, with a source title, and checks the angle for 5-word runs.
- **The facts to verify**, as backlog fact needs (`research needed`): the sub-topic's, the topic's, primary
  sources for every claim (a video is a lead, never a source), the primary report when a story rests on an
  incident, and a local-language regulator warning for the dubs when the source is Spanish or Portuguese.
- **The channel fit**: channel, format, evergreen topic (and the planned evergreen explainer it feeds), the
  reasons, the alternatives, and related backlog ideas.
- **Risks** (topic rules, plus "never repeat their income claims" and "stay at concept level" when the source
  makes income claims or is a how-to) and our tags (`topic:`, `subtopic:`, `channel:`, `lang:` ...).

## Backlog export

`out/topics/<date>.backlog.<channel>.json` has the exact shape of `content/<channel>/backlog.json` (another
workflow's file; this tool reads it and never writes it). The ideas hold only our own text, so an idea can be
copied into the real backlog as is; renumber its `priority` there. The YouTube evidence (links, titles, counts)
sits in a separate top-level `evidence` map that expires with the report: **never copy it into the backlog**,
because YouTube API data may not be stored beyond 30 days and the backlog is permanent and public. The tests run
the weekly batch's own parser (`scripts/batch/lib/backlog.ts`, through node) on the exports and on the merged
previews, including against the real channel backlogs when they are present.

## Quota (verified 2026-11-24 on developers.google.com)

| Method | Cost | Bucket | Used for |
| --- | --- | --- | --- |
| `search.list` | 1 per call (each page is a call) | Search Queries: **100 calls a day** per project | one call per query |
| `videos.list` | 1 unit per call (up to 50 ids) | the shared 10,000 units a day | statistics, baselines |
| `channels.list` | 1 unit per call (up to 50 ids) | 10,000 a day | uploads playlist, lifetime totals |
| `playlistItems.list` | 1 unit per call (50 items) | 10,000 a day | recent uploads |

The brief's "search.list = 100 units" was the cost before 2026-06-01, when YouTube moved `search.list` into its own
bucket (revision history; Quota Calculator, updated 2026-11-12). The costs live in `quota.json`, so a change is a
table edit (a project still billed the old way sets `search.list` to `{"bucket": "default", "cost": 100}`).

- `--max-units` (default **2,000**) caps the shared bucket for one run; `--max-searches` (default **30**) caps search
  calls. Every request is charged **before** it is sent, retries included (Google counts failed requests), and a call
  the cap cannot afford is never sent. If the cap runs out during baselines, the remaining channels keep a flagged
  lifetime-average estimate and the report says so.
- A **ledger** (`.cache/topics-ledger.json`) adds up what this tool charged per Pacific-Time day (quotas reset at
  midnight PT) and lowers the caps so runs on one day never pass the project's daily allowance. The Cloud console
  Quotas page is the authority.
- A **disk cache** (`.cache/topics/`, gitignored) keeps normalized answers (never raw responses, never the key):
  search and video statistics 24 h, channels 72 h, uploads 24 h, never longer than 30 days. A re-run the same day
  costs nothing. `--refresh` ignores it; `--no-cache` turns it off.
- A default run makes 21 search calls. The units depend on how many candidates pass the filters: `plan` prints the
  upper bounds (21 videos.list + 21 channels.list + 2 units per channel baseline); the fixture run spends 33. Live
  figures will be known after the first run.

## Before the first live run (what the owner provides)

1. **A Google Cloud project used only by this tool.** YouTube's Developer Policies (III.D) require exactly one API
   project per API client, not shared with other clients, so do not reuse the uploader's or the comment guard's
   project. Never create extra projects to get more quota (sharding is prohibited).
2. **Enable "YouTube Data API v3"** in that project (APIs & Services > Library).
3. **Create an API key** (APIs & Services > Credentials > Create credentials > API key) and **restrict it**:
   API restrictions = YouTube Data API v3 only; application restrictions = your machine's IP address if you run it
   from a fixed machine (cloud sessions have changing addresses, so there keep only the API restriction and rotate the
   key if it ever leaks). The key is never committed: the repo is public, and the policies forbid embedding
   credentials in open-source projects.
4. **Apply for the derived-metrics amendment.** The outlier ratio, the engagement score and the ranking are metrics
   derived from YouTube data. Developer Policies III.E.4 forbid that unless the project has accepted the
   ["Additional policies for derived metrics and data storage"](https://developers.google.com/youtube/terms/derived-metrics-policy)
   (updated 2026-09-14), which allows "Custom Channel Scores and Ratios" and "Content Categorization and Tagging".
   Submit the [YouTube API Services Audit and Quota Extension Form](https://support.google.com/youtube/contact/yt_api_form),
   choose "Section 5: Use Cases, API Integration, and Feature Implementation" then "Analytics & Reporting", and
   describe the tool honestly: a single-user internal research tool, public data only, ratios of a video's views
   to its channel's median, our own topic tags, data deleted after 30 days, no redistribution. Wait for YouTube's
   confirmation.
5. **Record the acceptance** in `config.json`: `compliance.derivedMetricsAmendment` = `{"accepted": true,
   "acceptedOn": "YYYY-MM-DD", "reference": "<YouTube's reference>"}`. Until then `find` stops before the first API
   call with exit code 3.
6. **Give the tool the key.** On your own machine: `export YOUTUBE_API_KEY=...` (never in a file in the repo). In a
   Claude cloud session: save it through the secure credential form for host `youtube.googleapis.com` with header
   `X-Goog-Api-Key`; the session proxy then adds it to every request, and `YOUTUBE_API_KEY` can be any placeholder.
   The host must be allowed in the session's network settings.
7. **First run as a smoke test**: `topics.py plan`, then `topics.py find --max-searches 3 --max-units 100`, read
   the report, and compare the Cloud console Quotas page with `topics.py quota`.

The key travels in the `x-goog-api-key` header, never in the URL, so it cannot leak into URLs, logs or cache keys;
every error message is scrubbed of it. If a project ever rejects the header, `--key-in-query` sends the documented
`key` query parameter instead.

## Data handling (YouTube API Developer Policies)

- **30-day limit.** Data fetched with an API key may be kept at most 30 calendar days (III.E.4). Every run
  deletes cache entries and `out/topics` reports older than that (`compliance.retentionDays`, lower only), each
  report states its deletion date, and `prune` does it on demand.
- **Derived metrics** are allowed only after step 4, and are labelled as ours wherever they appear.
- **Attribution.** Reports name YouTube as the source of every video, channel and count, link the video on
  youtube.com and the YouTube Terms of Service, and show counts as of their fetch time.
- **Minimal data.** `fields` selectors request only what the tool uses; the cache keeps normalized records;
  descriptions are cut to 600 characters and left out of the reports.

## Verified facts and sources

Read directly on 2026-11-24 (pages' "Last updated" dates in brackets); details in `topiclib/contracts.py`.

| Fact | Source |
| --- | --- |
| search.list: 1 unit in its own Search Queries bucket, 100 calls a day; `order=viewCount`; "a sort order other than relevance might result in a smaller or incomplete result set, particularly when combined with date filters like publishedAfter"; non-video results can slip through with a non-default order | [search.list](https://developers.google.com/youtube/data/reference/rest/v3/search/list) [2026-11-12] |
| videos.list, channels.list, playlistItems.list: 1 unit each; player sizes only with maxHeight/maxWidth; maxResults not supported with id on videos.list | the three reference pages [2026-11-12] |
| Default allocation: 100 search.list calls, 100 videos.insert calls, 10,000 units for all other methods; reset at midnight PT; every request costs at least 1 | [Quota Calculator](https://developers.google.com/youtube/data/determine_quota_cost) [2026-11-12] |
| Granular buckets since 2026-06-01; view counting changes 2025-03-31, 2026-08-27, 2026-11-16 | [Revision history](https://developers.google.com/youtube/data/revision_history) [2026-11-17] |
| Error reasons (quotaExceeded, playlistNotFound, invalidSearchFilter ...) | [Errors](https://developers.google.com/youtube/data/reference/rest/v3/errors) [2026-11-18] |
| API keys for public data; restrict the key | [Implement authorization](https://developers.google.com/youtube/data/guides/authentication) [2026-11-12] |
| Endpoints and parameter types: rootUrl https://youtube.googleapis.com/, counts as strings | [Discovery document](https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest) rev 20261123 |
| One project per API client; no credentials in open source; no derived metrics without the amendment; 30-day storage | [Developer Policies](https://developers.google.com/youtube/terms/developer-policies) [2026-11-06] |
| Derived metrics allowed after the amendment (Section 5 > Analytics & Reporting) | [Derived metrics policy](https://developers.google.com/youtube/terms/derived-metrics-policy) [2026-09-14] |

Not verified: the `x-goog-api-key` header's documentation page (docs.cloud.google.com is blocked in this session; a
search extract of it says the header is the recommended way and the query parameter exposes the key in URLs), and
the live API itself (no key; the one recorded answer is the 403 for a request without a key).

## Known limits (honest)

- **Untested against the live API.** Request and response shapes follow the reference pages and the discovery
  document, and the stand-in API enforces the documented constraints, but the first live run is the real test.
- **Search coverage.** `order=viewCount` with `publishedAfter` can return an incomplete set (Google's own warning),
  and it favours big channels, whose videos are rarely outliers. If runs look thin, try `--orders viewCount,relevance`
  (one more search call per query) or `--pages 2`.
- **View counts are public view counts**: since 2026-08-27 they count from the first frame, including autoplay and
  hover, and since 2026-11-16 they include TV co-views. They are not engaged views or watch time, which the API does
  not give for other people's videos.
- **Shorts detection** needs YouTube to know the aspect ratio; without it only videos of 60 s or less count as Shorts
  (flagged "format assumed").
- **Topics are keyword-based** (`taxonomy.json`, English, Spanish and Portuguese phrases). Titles phrased outside the
  lexicon are missed or land in "off-niche"; read the "Not listed" table after the first live runs and extend the
  lexicon.
- **Angles are structured drafts**, not scripts: they come from our templates and need a writer's pass, the claim gate
  and the owner's review like every other idea.
- **The scores are a reason to look, not proof of demand.** The weights are proposals for the owner to tune.

## Files

| Path | What it does |
| --- | --- |
| `topics.py` | CLI: `find`, `plan`, `prune`, `quota` |
| `config.json` | Queries, floors, thresholds, weights, retention, the compliance record (owner-editable) |
| `quota.json` | Quota costs and daily limits (owner-editable) |
| `taxonomy.json` | Our topics, sub-topics, en/es/pt phrases, channel fits, angle templates, titles, fact needs, risks |
| `topiclib/contracts.py` | Verified API and policy facts with sources |
| `topiclib/http.py`, `api.py` | Transport (key in a header, gzip, error classes) and client (budget, cache, retries) |
| `topiclib/quota.py`, `cache.py` | Budget, Pacific-day ledger, disk cache, 30-day retention |
| `topiclib/classify.py`, `baseline.py`, `score.py` | Our tags, the channel baseline, the metrics |
| `topiclib/ideas.py`, `export.py`, `report.py`, `pipeline.py` | Ideas and copy guard, backlog export, report, the run |
| `topiclib/fake_api.py`, `fields.py` | The stand-in API for tests and `--fixtures`; the `fields` selector |
| `fixtures/` | Synthetic database and error envelopes (see `fixtures/README.md`) |
| `tools/build_fixtures.py` | Rebuilds the synthetic database |
| `tests/` | 165 unittest tests, including the batch-parser conformance check (needs node) |
