# Auto-announcer (Telegram and X)

Step 4 of the channel pipeline (video-studio `CLAUDE.md`, "Channel 2"): once an episode is approved, rendered and public, this tool posts one announcement per platform from the episode's publish kit (`kit.json`, the `PublishKit` contract in `src/types.ts`). It serves both channels, Zoora AI and Zoodger News (The Zoo & Badger Show). Both post through the same credentials, one `TELEGRAM_CHAT_ID` and one X account (see "Credentials"); separate Zoodger News accounts are the owner's decision.

**It is a dry run unless you pass `--apply`.** The dry run prints exactly what each platform would receive: the endpoint, the request body, the text, its length against the limit, the ledger state and the approval state. Nothing is posted and the ledger is not touched.

**Posting needs the owner's approval record for that episode** (see "The owner's approval" below). Without one, `--apply` refuses and posts nothing, whatever the caller passes.

```sh
cd projects/creator-hub
node tools/announcer/cli.ts post --kit ../video-studio/out/publish/zoora-ai/<slug>/kit.json --targets telegram,x
node tools/announcer/cli.ts post --kit <kit.json> --targets telegram,x --youtube-id <id> --approval <approval.json> --apply
node tools/announcer/cli.ts ledger list
node tools/announcer/cli.ts ledger forget "<channel>/<slug>#<target>"
node --test tools/announcer/*.test.ts
```

| Option | Meaning |
| --- | --- |
| `--kit <file>` | The episode's publish kit. Required. |
| `--targets <list>` | `telegram`, `x` or `telegram,x` (default: both). |
| `--apply` | Post for real. Every check must pass, the owner's approval must cover this episode, the video's YouTube id must be known, and the ledger must have no record of this kit on that target. |
| `--approval <file>` | The approval record. Default: `<studio>/content/<channel>/<slug>/approval.json` (where the daily writes it). The weekly batch keeps its records next to the kit (`approval-<renderId>.json`): pass that file. |
| `--studio-root <dir>` | `projects/video-studio`, which the paths inside approval records are relative to. Default: `../video-studio`. |
| `--youtube-id <id>` | The video's id when `kit.json` does not have it yet. It must match the kit's id if the kit has one. |
| `--video <file.mp4>` | Telegram only: upload the Short (at most 50 MB) with `sendVideo` and use the post as its caption (at most 1024 characters). |
| `--developing` | Label the posts DEVELOPING. This is set automatically when the kit's disclosures contain a "developing" line, which the daily pipeline adds. |
| `--offers <file>` | Offer registry. Default: `config/offers.json`. Without one, every offer is left out. |
| `--hub <origin>` | Hub origin for relative offer links. Default: the kit's links, else `PUBLIC_BASE_URL`. |
| `--out <dir>` | Also write the planned posts (`x.txt`, `telegram.txt`, `plan.json`). |
| `--ledger <file>` | Idempotency ledger, relative to where you run the command. Default: `data/announcer/ledger.json`, or `ANNOUNCER_LEDGER`, which is relative to `projects/creator-hub` so that the daily's call (run from `video-studio`) and a manual run (from `creator-hub`) always share one ledger. |
| `--allowlist <file>` | Names that are not people (rule R4). Default: `../video-studio/scripts/news/allowlist.json`. |

Exit codes: `0` ok (a target that was already posted counts as ok), `1` a check failed or a post failed, `2` usage error.

## The owner's approval

Owner rule: nothing is published without his approval (video-studio `CLAUDE.md`, "Channel 2"; `docs/PROJECT_INSTRUCTIONS.md`). `approval.ts` checks the record before `--apply` posts anything. Two kinds of record exist, and the paths inside both are relative to `projects/video-studio`:

| Record | Written by | What must hold |
| --- | --- | --- |
| `daily-content-approval` (schema `zoora-security/approval@1`, at `content/zoora-security/<slug>/approval.json`) | the daily pipeline's `approve` step, after the owner's "APPROVE <slug>" reply | decision `approved`; same channel and slug; its `versionHash` matches its storyboard and render hashes; the storyboard is unchanged since approval; for `post --kit`, the kit.json is byte for byte the approved publish kit (`versions.publishKit.sha256`); for the daily call, the same title; a developing approval needs the DEVELOPING label; the post links the video id recorded after the manual upload (it refuses while none is recorded) |
| `youtube-upload-approval` (the uploader's, also the weekly batch's) | `tools/uploader` or the batch's approve step | same channel and slug; not expired; the storyboard is unchanged since approval. It does not bind kit.json or the video id, so check the dry run. |

The daily call (`--input`) accepts only the daily record. A record is a plain file, not a signature: it stops wrong, stale or changed files from being announced, not someone who can already write to this machine.

## What gets posted

Only text that already passed the claim gates: the chosen title, the hook (the first line of the kit's X post), the summary, sources, offers and disclosures.

**X** (280 weighted characters; every URL counts 23):

```
[DEVELOPING: ]<hook>

<first sentence of the summary, if it fits>

https://youtu.be/<id>

<offer disclosure> https://<hub>/go/<offer>?v=<slug>&s=x     (one per offer)

<up to 2 hashtags, if they fit>
```

If the post is too long, the hashtags go first, then the summary sentence, then the hook is shortened one word at a time (then one character at a time for a single long word), measured with X's own weighted count, in which the "…" and every emoji or CJK character weigh 2. A shortened post therefore always fits. A disclosure and its link are never dropped: if they cannot fit, the lint fails and nothing is posted. The lint also runs on the shortened text, so a cut that removes an attribution blocks the post.

**Telegram** (`sendMessage`, plain text, 4096 characters; the video link is the preview card):

```
[DEVELOPING: ]<title>

<summary>

Watch: https://youtu.be/<id>

<offer disclosure>
https://<hub>/go/<offer>?v=<slug>&s=other

More partner links, only where they are available in your country: https://<hub>/?v=<slug>&s=other   (restricted offers)
Some of them are affiliate or referral links that may earn me money; each one is disclosed on that page.

<the kit's other disclosures>

Sources:
- <Publisher>: “<headline>” <url>

[This is a developing story. Corrections will be pinned under the video.]
```

**Offers** follow the newsletter's policy, because a post is read everywhere. An offer goes in only when the registry says it is live and allowed for an unknown country. Region-restricted offers, such as exchanges and other financial offers, are never named in a post. Telegram links to the hub's region-filtered page instead (`restrictedOfferLines` in `src/server/offers.ts`), and X leaves them out. Hub links carry `?s=x` on X and `?s=other` on Telegram, so the dashboard can count them. Each disclosure sits directly before its link. X's paid-partnership label can only be set in the X app, so set it there when a post carries an affiliate link.

**Lint before every post.** The checks are the Threat Brief's scaled-down news-gate rules (`../threat-brief/safety.ts`, mirroring `video-studio/scripts/news/lib/lexicon.ts` and `names.ts` as of 2026-11-24):

- no personal names, handles or the radar's `[named person]` placeholder;
- no exploit how-tos (code, addresses, function names, payload talk, attack step lists);
- accusations and loss figures name their source, and figures are never averaged;
- no unattributed speculation;
- no price, market, investment or income talk (income claims come from the hub's shared `src/claims.ts`);
- no placeholders.

On top of those:

- a developing story starts with `DEVELOPING`;
- each post fits the platform's limit;
- every hub link is tagged for its target and has its disclosure before it;
- the kit's blocking checks have passed (`disclosures`, `income-claims`, `placeholders`, `links-via-hub`, `restricted-offers`, `offers-live`).

A source headline is quoted with its publisher only when it passes the same rules. Otherwise only the publisher and the link are shown. On the daily call the publisher always comes from the PostInput's `publisher` field: a radar label such as "SlowMist Hacked: Chainflip (2026-11-21)" ends in a date, and a date in parentheses is never read as a publisher.

## Never twice: the ledger

Neither platform accepts an idempotency key, so the ledger is write-ahead:

1. The entry for `<channel>/<slug>#<target>` is saved as `pending` before the request is sent.
2. A confirmed answer turns it into `posted` (with the message or post id). Only a refusal turns it into `failed`: an HTTP status from 300 to 499 (or Telegram's own `{"ok": false, "error_code": 4xx}`). `failed` means nothing was posted, and a later run may try again.
3. Everything else leaves it `pending`, because the post may exist: a timeout, a dropped connection, a 5xx, and any 2xx answer that cannot be confirmed (the body breaks off, is not JSON, or has no message or post id). The report then says "it may have been posted". Every later run refuses that target until you check the channel and run `ledger forget "<key>"`.

A lock file next to the ledger stops two runs from posting at the same time. It carries a random token. A lock that has not been refreshed for 10 minutes (a crashed run) is taken over atomically: it is renamed to a name only that run uses, so of two runs that see the same stale lock only one wins, and the winner checks that it moved the stale lock it looked at (a fresh one is put back). A running announcer refreshes its lock every minute, checks before each write-ahead entry that the lock still carries its token, and at the end removes the lock only if it still does. An unreadable ledger stops all posting. The default file is under `data/`, which the hub's `.gitignore` already excludes (`git check-ignore data/announcer/ledger.json` confirms it).

## Credentials (environment only)

| Variable | Where it comes from |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | @BotFather `/newbot`. Then add the bot to the channel as an administrator with "Post messages". |
| `TELEGRAM_CHAT_ID` | `@channelusername` for a public channel, or the numeric id (`-100…`) for a private one. |
| `X_API_KEY`, `X_API_SECRET` | The app's consumer keys (X Developer Console, Keys and tokens). |
| `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | The posting account's OAuth 1.0a access token and secret. Set the app's permission to "Read and write" before you generate them. |

Never put these in files, flags or chat. In a cloud session, add them through the environment's secure credential settings.

## Platform facts (checked 2026-11-24)

From the build machine, the session proxy refused `core.telegram.org`, `docs.x.com`, `api.telegram.org`, `api.x.com` and `api.kit.com` (CONNECT 403). The facts below therefore come from search-index extracts of the official pages, not a direct read. **The clients have only been tested against a mocked `fetch`.** Make one real post on a test channel and a test account before relying on them.

**Telegram Bot API.** The changelog index shows the Bot API at 10.x in 2026.

- `sendMessage`: `text` 1-4096 characters after entities parsing ([sendMessage](https://core.telegram.org/bots/api/methods/sendmessage)).
- `sendVideo`: `caption` 0-1024 characters. "Bots can currently send video files of up to 50 MB in size" ([sendVideo](https://core.telegram.org/bots/api/methods/sendvideo)).
- `link_preview_options` has existed since Bot API 7.0.
- Limits ([Bots FAQ](https://core.telegram.org/bots/faq)): no more than 20 messages per minute in one group, and about one per second in one chat. The announcer sends one message per kit.
- Answers are `{"ok": true, "result": …}` or `{"ok": false, "error_code", "description", "parameters": {"retry_after"}}`.

**X API v2.** Access and pricing:

- Pricing is pay-per-use: credits bought in the Developer Console, with no subscription ([pricing](https://docs.x.com/x-api/getting-started/pricing)). The localized copies of that page list "Post: Create" at **$0.015** and "Post: Create (with URL)" at **$0.200** per request. Every announcement carries the video link, so budget about **$0.20 per X post**. The dry run prints that estimate.
- New developers can no longer get the free tier. It closed in February 2026 (Gigazine 2026-02-09, heise; secondary sources). Reports of the dates for moving legacy Basic and Pro plans to pay-per-use conflict and are unverified.
- Rate limit: the endpoint reference gives 200 requests per 15 minutes per user. An older limits table says 100 per 24 hours per user and 1,667 per app (Basic era). These conflict, but either is enough for one post per episode.
- Auth: `POST https://api.x.com/2/tweets` accepts OAuth 1.0a User Context or OAuth 2.0 Authorization Code with PKCE (scopes `tweet.read tweet.write users.read`) ([integrate guide](https://docs.x.com/x-api/posts/manage-tweets/integrate), [auth mapping](https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping)). This tool uses OAuth 1.0a, whose user tokens do not expire. The signer (`oauth1.ts`) reproduces the worked example in X's [Creating a signature](https://docs.x.com/fundamentals/authentication/oauth-1-0a/creating-a-signature) guide, signature `hCtSmYh+iHYCEqBWrE7C7hYmtUk=`, as a unit test.
- Character count: 280 weighted, with every URL counting 23, emoji 2 and CJK 2. `x-count.ts` reuses the publish kit's counter (`video-studio/scripts/publish-kit/limits.ts`), which is tested against twitter-text 3.1.0.
- X refuses duplicate text. The ledger stops repeats before X has to.

## Daily pipeline

`video-studio/scripts/daily/lib/postapproval.ts` calls `node tools/announcer/cli.ts --input <post-input.json> --out <dir> [--dry-run]`. This tool accepts that call:

- It reads the daily's `PostInput` and writes `announce-x.txt`, `announce-telegram.txt` and `announce-plan.json` next to the daily's own drafts.
- **It never posts from that call by itself.** Posting needs `--apply`, which the daily does not pass, and `--dry-run` always wins. To let the daily post after APPROVE, set `DAILY_ANNOUNCER_CMD` to a JSON argv that includes `--apply`, for example `["node","<hub>/tools/announcer/cli.ts","--input","{input}","--out","{out}","{dryRun}","--apply"]`.
- Even then it posts only under the daily content approval for that slug (`content/zoora-security/<slug>/approval.json`, found under `--studio-root`), with the same title, the DEVELOPING label when the approval is for a developing story, and the video id recorded after the manual upload.
- `content/zoora-security/channel.json` still lists the proposed credential names `ANNOUNCER_X_TOKEN` and `ANNOUNCER_TELEGRAM_TOKEN`. The real names are the ones in the table above. Until channel.json lists them, the daily always calls with `--dry-run`, which is the safe direction.

## Not done (known limits)

- **No X video upload.** X shows the YouTube link as a card. Native video on X needs the chunked media-upload endpoint and is not implemented.
- **No OAuth 2.0 (PKCE) for X.** Its access tokens expire after 2 hours and need a refresh flow.
- **YouTube community posts have no API.** The daily writes a draft for them to post by hand.
- **Not run live** against Telegram or X, as explained above.
