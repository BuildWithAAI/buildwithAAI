# Revenue dashboard

Shows which videos earn. It combines YouTube analytics, link-hub clicks and affiliate payouts into one
row per video. Every 10 videos it writes plain rules about what to double down on, what to test and
what to cut.

Status (2026-11-24): built and tested here on synthetic fixtures (`fixtures/`, all marked "fixture").
The YouTube Analytics API client follows Google's documentation, but it has **never been run against
the live API** from this machine. Its tests use a recorded-format response.

## Run it

```sh
cd projects/creator-hub
npm run dashboard                       # uses whatever it finds in data/ (see below)
npm run dashboard -- --force            # write recommendations.md now
npm run dashboard -- --help             # every option
node --test "tools/dashboard/**/*.test.ts" && npx tsc --noEmit
```

It writes to `out/dashboard/` (gitignored):

| File | What it is |
| --- | --- |
| `metrics.csv` | One row per video: views, CTR, average view duration, subscribers, hub clicks, conversions and revenue |
| `index.html` | A static page with no JavaScript. Open it in a browser. It works in light and dark mode and on a phone |
| `recommendations.md` | Double down / test / cut, with the numbers behind each call. It is rewritten at 10, 20, 30... videos with YouTube data, or with `--force` |
| `state.json` | The video count at which `recommendations.md` was last written |

Exit codes: 0 means the files were written. 1 means an input is broken, and nothing was written.
2 means a usage error.

These files contain your revenue figures and the names of your input files, so keep them private. Do
not publish `index.html`.

## Inputs

All inputs are optional; the dashboard uses what it gets. Default locations are under `DATA_DIR`
(default `projects/creator-hub/data/`, gitignored). Never commit exports or payout files: this repo
is public.

```
data/
  youtube/*.csv                    YouTube Studio exports ("Table data.csv", any file name)
  hub.sqlite                       a copy of the hub database
  payouts/<programme id>/*.csv     affiliate payout exports
  videos.csv                       format, topic tags and other ids per video (copy videos.example.csv)
config/payouts.json                payout column mappings (copy config/payouts.example.json; gitignored)
```

### (a) YouTube Studio export: views, CTR and retention

In YouTube Studio, open **Insights** (formerly Analytics), then **Advanced Mode** and the **Content** tab.
Pick the date range, usually Lifetime. Add the columns you want, then use **Export current view** and
choose CSV. The download is a zip; pass its `Table data.csv`.

- Set YouTube Studio to English. Headers are matched loosely: case, spaces, hyphens and soft hyphens
  are ignored. Both old and new metric names work: `Impressions` or `Thumbnail impressions`, and
  `Impressions click-through rate (%)` or `Thumbnail impressions click-through rate (%)`.
- Columns that are read: `Content` (the video id, required), `Video title`, `Video publish time`,
  `Duration`, `Views`, `Engaged views`, `Watch time (hours)`, thumbnail impressions and their CTR,
  `Average view duration`, `Average percentage viewed (%)`, `Subscribers` (net), `Subscribers gained`,
  `Subscribers lost` and `Estimated revenue (USD)`.
- Add **Subscribers gained** as a column. Studio's default `Subscribers` column is gained minus lost.
- The first data row is a `Total` row. It is skipped, and is only used to check that the rows add up.
- Values like `1,234`, `4.8`, `0:45` and `0:03:12` are read, and so are dates like `Oct 6, 2026`.
  An unreadable cell is left empty and reported, never guessed.
- The revenue currency comes from the header (`Estimated revenue (EUR)`), and it is never assumed to be
  USD.
- YouTube Help says downloaded reports stop at 500 rows. The dashboard warns when a file reaches 500.

### (b) Link-hub clicks

- `--hub-db data/hub.sqlite` opens the hub database read-only. Copy it with its `-wal` and `-shm`
  files, or stop the server first.
- `--hub-csv` reads an admin export instead. Use either `/admin/export/video-clicks.csv` (already
  counted) or `/admin/export/clicks.csv` (the raw log, counted here). The cell prefix `'` that the export
  adds against spreadsheet formulas is removed.

The counting rule is the hub's own: humans only, redirects only, and once per visitor, offer and UTC
day. The first click of the day keeps its video and source. A test checks that the raw log gives
exactly the same counts as the database.

Clicks are tied to videos by `?v=`. A slug (`?v=fake-support-dm`) is followed to its YouTube id
through the publish kit (`video-studio/out/publish/<channel>/<slug>/kit.json`) or the `aliases` column
of `videos.csv`. Clicks that match no known video are listed under "Not tied to a video".

### (c) Affiliate payouts

Each network exports a different CSV. Copy `config/payouts.example.json` to `config/payouts.json` and map
each programme's columns: `date`, `offerId`, `subId`, `conversions`, `revenue` (required), `currency`
and `status`. You can also set:

- `delimiter` (`,` `;` or `tab`), `decimal` (`.` or `,`) and `dateFormat`
  (`YYYY-MM-DD`, `MM/DD/YYYY`, `DD/MM/YYYY`, `DD.MM.YYYY` or `auto`);
- `offerIds`, which maps the network's programme names to hub offer ids, or `defaultOfferId`;
- `currency`, for files without a currency column;
- `includeStatuses`, e.g. `["approved", "paid"]`. Rows with other statuses are counted in a note.

The hub appends `<subIdParam>=<videoId>.<source>` to offers that have `subIdParam`. That sub-id is how
a payout is tied to a video. A missing part is `none`. If a network lower-cases sub-ids, an unambiguous
case-insensitive match is used, and the run says so.

Without a `conversions` column, each row counts as one conversion, and a negative amount counts as a
reversal (-1). **Currencies are never converted silently.** USD is added up. Any other currency is
reported separately (for example "plus EUR 19.75 not converted"). It is converted only if you add a
rate with its date: `"rates": {"EUR": {"usdPerUnit": …, "asOf": "YYYY-MM-DD", "source": "…"}}`.

### (d) YouTube Analytics API v2 (optional)

`--api` calls `reports.query` (the channel "Top videos" report: `dimensions=video,creatorContentType`,
`sort=-views`, 200 rows per page). It fetches views, estimated minutes watched, average view duration,
average percentage viewed, and subscribers gained and lost. `--api-revenue` adds `estimatedRevenue`
in USD. That needs the `yt-analytics-monetary.readonly` scope and a monetized channel.

Authentication uses environment variables only, and tokens are never printed:

| Variable | Use |
| --- | --- |
| `YT_ANALYTICS_ACCESS_TOKEN` | A short-lived OAuth access token, or: |
| `YT_ANALYTICS_CLIENT_ID`, `YT_ANALYTICS_CLIENT_SECRET`, `YT_ANALYTICS_REFRESH_TOKEN` | Exchanged at `https://oauth2.googleapis.com/token` for an access token on each run |

Scopes: `https://www.googleapis.com/auth/yt-analytics.readonly` (plus `…/yt-analytics-monetary.readonly`
for revenue). Create an OAuth client in a Google Cloud project with the YouTube Analytics API enabled.
You can get a refresh token with Google's OAuth 2.0 Playground, using "use your own OAuth credentials".

**What the API does not provide.** The Analytics API has no thumbnail-impressions or impressions-CTR
metric: its "impressions" metrics are ad, card and annotation impressions. Since 2026-01-15, thumbnail
impressions and CTR are available only in the bulk **YouTube Reporting API** (`channel_reach_basic_a1`,
metrics `video_thumbnail_impressions` and `video_thumbnail_impressions_ctr`). That API is not
implemented here. So **the Studio CSV is the source of impressions and CTR**. When you use both, the API
wins for the fields both have, so export Studio for the same dates.

### (e) videos.csv and publish kits

`videos.csv` columns: `video_id` (a YouTube id or slug), `aliases` (other ids its links used),
`title`, `channel`, `format` (`long` or `short`), `tags` (topics, separated by `;`) and `published_at`.
Tags drive the topic comparison.

The format comes from `videos.csv` first, then the API's content type, then a Studio content-type
column, then the publish kit. As a last resort it is guessed from the duration (180 seconds or less
counts as a Short, because Shorts can be up to 3 minutes). A guessed format is reported.

One run covers one channel (`--channel`, default `zoora-ai`). `videos.csv` rows and kits for another
channel are left out. Run the second channel separately, with `--channel <slug> --out out/dashboard/<slug>`.

## How the numbers are worked out

- **Per 1,000 views** means amount ÷ YouTube views × 1,000. Group rates are pooled (total amount ÷ total
  views), so a big video counts for more than a small one.
- **Revenue** = YouTube estimated revenue + affiliate payouts tied to the video, in USD. A part that is
  unknown counts as 0. If both are unknown, revenue is empty. Payouts from every link source (email, X…)
  count for the video, and are divided by YouTube views.
- **Hub clicks per 1,000 views** use only clicks from YouTube links (`s=yt`, `s=shorts`, or no source),
  because the denominator is YouTube views. `hubClicks` in metrics.csv counts every source.
- **CTR vs channel median** covers long videos with 100 or more views only. YouTube Help says CTR
  varies widely below 100 views, and Studio's Shorts report has no thumbnail CTR.
- **Retention** compares each video's average percentage viewed with the median of the same format.
  It can be above 100% for Shorts that people rewatch.
- Empty means unknown, never zero.

## The recommendation rules (recommendations.md)

The comparison metric is revenue per 1,000 views when any revenue is known. Otherwise it is YouTube
hub clicks per 1,000 views, then subscribers per 1,000 views.

| Call | Rule |
| --- | --- |
| Double down | at least 1.25× the comparison rate, with 3+ videos and 1,000+ views |
| Test | at least 1.25×, but fewer videos or views than that |
| Cut or rework | at most 0.5×, with 3+ videos and 1,000+ views |
| Steady | in between |
| Too early to call | anything else |

- Formats are compared with the whole channel. Each format call also lists the other metrics, so a
  format is never judged on one number alone.
- Topics are compared with what the channel would get for the same mix of long videos and Shorts, so a
  topic that is mostly Shorts is not cut just for being Shorts.
- Offers are judged on revenue per click after 30+ clicks, or on conversion rate before any revenue.
  100+ clicks with no conversion is a cut. An offer whose programme has no payout file is "too early".
  A note is added when 30% or more of an offer's requests were blocked by region rules.
- **Below 10 videos with YouTube data, no call is made**, and the file says the sample is too small to
  conclude anything.

The rules describe past results. They make no prediction or promise of earnings. Every affiliate or
referral link still needs its disclosure next to it.

## Additions to the shared contracts

`VideoMetrics` in `src/types.ts` is unchanged. `metrics.csv` starts with its 15 fields in contract
order, and then adds these columns: `tags`, `formatSource`, `engagedViews`, `subscribersNet`,
`hubClicksYoutube`, `revenueUsd`, `revenuePer1kViews`, `hubClicksPer1kViews`, `affiliateRevenueOther`,
`adRevenueOther` and `inputs`. `adRevenueUsd` holds YouTube's *estimated revenue* (ads plus YouTube
Premium, net), which is what the Studio Content export and the API's `estimatedRevenue` report.

## Sources (read 2026-11-24)

- reports.query: https://developers.google.com/youtube/analytics/reference/reports/query (page dated 2026-11-12)
- Metrics: https://developers.google.com/youtube/analytics/metrics (2026-11-16). This page has no thumbnail impressions or CTR.
- Channel reports, "Top videos": https://developers.google.com/youtube/analytics/channel_reports
- `creatorContentType`: https://developers.google.com/youtube/analytics/dimensions
- Discovery document, revision 20261122: https://www.googleapis.com/discovery/v1/apis/youtubeAnalytics/v2/rest
- Reach reports for thumbnail impressions (2026-01-15): https://developers.google.com/youtube/reporting/revision_history
- Refreshing an OAuth token: https://developers.google.com/identity/protocols/oauth2/web-server (2026-11-19)
- Advanced Mode and the 500-row export limit: https://support.google.com/youtube/answer/9717005
- Metric names ("Thumbnail impressions", "Engaged views") and the November 2026 view-count change: https://support.google.com/youtube/answer/12220281
- CTR below 100 views: https://support.google.com/youtube/answer/7628154
- Studio export header names were cross-checked against public open-source importers on GitHub, because
  no official page lists them. One example is an English/German mapping that includes the `Total` row
  and soft hyphens in headers. Treat the header list as best effort, and check it against your first
  real export.
