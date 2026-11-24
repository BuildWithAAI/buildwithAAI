# YouTube uploader: upload by API after the owner's approval

Uploads a rendered episode or Short to YouTube with the Data API v3, but only the exact file the owner approved.
The video always goes up as **private**. It is published at the time in the approval, or stays private until the
owner publishes it in Studio. The uploader also sets:

- made for kids and the altered/synthetic-media flag
- category, tags and languages
- per-language titles and descriptions
- the custom thumbnail
- caption tracks for each language
- the playlist

This replaces about 10 minutes of Studio form-filling per video. Every publish stays the owner's decision.

```sh
cd projects/creator-hub
node tools/uploader/cli.ts approve <kit.json> --publish-at "2026-11-28 09:00"   # owner: review + approve
node tools/uploader/cli.ts plan <kit.json> --approval <approval.json>           # print exactly what will be sent
node tools/uploader/cli.ts upload <kit.json> --approval <approval.json> --apply # send it (resumable)
node --test "tools/uploader/*.test.ts"                                          # tests (fake YouTube, no network)
```

`<kit.json>` is the publish kit's output: `projects/video-studio/out/publish/<channel>/<slug>/kit.json`
(`video-studio/scripts/publish-kit`). **Nothing in this folder has been run against the live YouTube API.** The
tests use an in-process fake of YouTube. The first real upload should be a short private test video (see "First
real upload" below).

## What it will never do

- **Send anything without an approval record.** The record has to match, right now:
  - the rendered file's SHA-256 and size;
  - the storyboard's `version` and SHA-256;
  - the digest of everything that would be sent: title, description, tags, category, languages, localizations,
    publish time, settings, thumbnail bytes, caption bytes and playlist.

  `plan` and `upload` refuse (exit 3) and name what changed. The record also expires (7 days by default).
- **Upload anything but private.** `privacyStatus: "private"` is a literal in the plan type, and a privacy guard
  refuses any `videos.insert` or `videos.update` whose JSON does not say `"private"`. This matters because YouTube makes an
  upload with no privacyStatus **public** (revision history, 2026-11-02). After the upload the uploader reads the
  privacy back. If YouTube reports anything else, it sets the video back to private at once and raises an alert.
- **Publish in the past.** A `publishAt` in the past makes YouTube publish the video immediately. So the uploader
  refuses a publish time less than `minLeadMinutes` away: 60 minutes by default, checked again just before the
  upload starts.
- **Upload the same file twice.** A ledger records every upload by channel and file SHA-256. Uploading a second,
  different file for the same episode render needs `--allow-second-upload`. A lock file stops two runs of one upload.
- **Upload to the wrong channel.** Before sending anything it checks the signed-in channel (`channels.list`, 1 unit)
  against the channel saved by `auth`, or the one pinned in `channels.json`. It also checks that the playlist exists
  on that channel.
- **Declare paid promotion, or touch existing videos.** The paid-promotion declaration stays a Studio step (see "Studio
  steps"). The only call that changes a video after upload is the emergency "set back to private".

## One-time setup

1. **Google Cloud project.** Create one (or reuse the comment guard's) and enable "YouTube Data API v3".
2. **OAuth app (Google Auth Platform).** Pick its audience. This decides whether sign-ins expire after 7 days (next
   section).
3. **OAuth client.** Credentials > Create credentials > OAuth client ID > **Desktop app**. Download its JSON. It
   holds the client id and secret.
4. **Sign in once per channel.** From `projects/creator-hub`:
   ```sh
   node tools/uploader/cli.ts auth --channel zoora-ai --client-secrets ~/Downloads/client_secret_XXX.json
   ```
   Open the printed address and sign in with the channel's Google account. If Google shows a channel picker, pick
   Zoora AI. Allow every box: the uploader needs `youtube.force-ssl` for captions, playlists and the channel check.
   It also asks for `youtube.upload`.

   The tokens are saved to `tools/uploader/.local/oauth.json`, which is owner-only (0600) and gitignored. The command
   prints the channel id it signed in to. Run `auth --channel zoora-security` for the second channel.
   `auth --channel <slug> --revoke` signs a channel out.
5. **`channels.json`** (committed; no secrets). For each channel set:
   - `categoryId`: required, an owner decision. `node tools/uploader/cli.ts categories` lists YouTube's (1 quota
     unit). Common ones are 28 Science & Technology, 27 Education, 24 Entertainment and 1 Film & Animation.
   - `youtubeChannelId`: recommended. It pins the slug to the channel id that `auth` printed, so a wrong sign-in can
     never upload.
   - `playlists.long` and `playlists.short`: playlist ids, or null for no playlist step.
6. **Channel features.**
   - Custom thumbnails need a verified channel (phone verification; YouTube Help 72431). If it isn't verified,
     `thumbnails.set` answers 403, and the uploader turns that into a Studio step instead of failing.
   - Dub tracks need "Advanced features" (Help 13338784).

### The 7-day sign-in expiry ("Testing") and how to stop it

Google expires refresh tokens **7 days after consent** for an OAuth app whose user type is **External** and whose
publishing status is **Testing**. Sources: Google's OAuth guide, "Refresh token expiration"
(developers.google.com/identity/protocols/oauth2#expiration, updated 2026-11-19), and Google Auth Platform "Manage App
Audience" (support.google.com/cloud/answer/15549945). The uploader then gets `invalid_grant`, stops before sending
anything and tells you to run `auth` again. `status` warns from day 6.

Two ways to stop it. Pick one when you create the OAuth app:

- **Personal (recommended for a one-owner tool).** Use Google Auth Platform's Personal-mode onboarding page
  (console.cloud.google.com/auth/overview/personal). Google's page says Personal apps "do not require OAuth app
  verification, are not subject to the OAuth user cap or 7-day test user token expiration, and do not display the
  unverified app screen".

  Two limits: only the Google Account that created the app can sign in (anyone else gets `client_user_mismatch`), and
  the choice is permanent for that project. Not verified: whether a Brand Account channel can authorize a Personal
  app. If the channel is a Brand Account and sign-in fails, use the next option.
- **External, published ("In production").** Google Auth Platform > Audience > **Publish app**. Refresh tokens then no
  longer expire after 7 days. YouTube scopes are sensitive, so Google shows an "unverified app" warning until the app
  is verified. You are the only user, so click "Advanced > Go to <app>" once. The 100-new-user cap does not matter for
  one user. Verification is only needed to launch an app to the public (support.google.com/cloud/answer/7454865).
  Tokens issued while the app was in Testing still expire, so run `auth` once more after publishing.

Other reasons a token stops working: you revoke it at myaccount.google.com/permissions, it goes 6 months unused, or
more than 100 tokens exist for one client.

**Run the uploader on your own computer, not on a server or CI.** Google's OAuth guide says user credentials must not
be deployed for server-to-server jobs. An approval is also meant to be acted on where the owner is. The state folder
can be moved with `--state-dir` or `$UPLOADER_STATE_DIR`. `$UPLOADER_CLIENT_ID` and `$UPLOADER_CLIENT_SECRET` can
supply the client instead of the saved one.

## Per video

1. **Make the inputs.**
   - The publish kit, with every check passing: the uploader refuses while any kit check fails.
   - The render.
   - The thumbnails, for long-form.
   - Optionally an upload spec (below) for dubbed titles, descriptions and caption languages.
2. **Owner approves.**
   ```sh
   node tools/uploader/cli.ts approve ../video-studio/out/publish/zoora-ai/<slug>/kit.json --publish-at "2026-11-28 09:00"
   ```
   This prints the full plan: every request, header and JSON body, the quota and the Studio steps. It then asks the
   owner to type the episode slug, and writes `approval-long.json` next to the kit.
   - `--render short-1` approves a Short.
   - With no `--publish-at`, the video stays private.
   - Times without an offset are read in **America/Chicago** (the owner's zone, CLAUDE.md). A time that does not exist,
     or happens twice, on a DST change is refused.
   - Without a terminal, the owner can pass `--confirm <slug>`. No tool or agent may pass it for the owner.
3. **Optional: `plan`** prints the same requests again, after checking the approval against the files as they are now.
4. **Upload:** `upload <kit.json> --approval <approval.json> --apply`. Progress is printed. At the end you get the
   video link, the Studio link, the steps left for Studio, and a receipt in `.local/receipts/`.
5. **Do the Studio steps it lists.** Then record the id in the kit, from `projects/video-studio`:
   `node scripts/publish-kit/cli.ts <channel>/<slug> --youtube-id <id>`. The newsletter and dashboard read it there.

If anything stops the run (network, quota, a closed laptop), **run the same command again**: it resumes (next sections).

### First real upload

Do one private test before relying on the uploader. Use a 10-second render of a test episode, with no `--publish-at`.
Then check in Studio: privacy, audience (not made for kids), altered content, category, video language, thumbnail,
captions and playlist. Delete the test video afterwards. That run also shows whether YouTube kept
`defaultAudioLanguage`: the receipt says so (see "Verified facts").

## The approval record

`approval-<render>.json`, written by `approve`, or by the daily pipeline's approve step after the owner taps Approve.
The daily step should call `approve ... --confirm <slug>`, or `createApproval()` from `approval.ts`, so the digest is
computed by the same code. It is a plain file, not a signature. It guards against wrong, stale or changed files, not
against someone who can already write to this machine.

```json
{
  "version": 1,
  "kind": "youtube-upload-approval",
  "channel": "zoora-ai",
  "slug": "pumpfun-top-caller",
  "approvedBy": "owner",
  "approvedAt": "2026-11-24T12:00:00.000Z",
  "expiresAt": "2026-12-01T12:00:00.000Z",
  "publishAt": "2026-11-28T15:00:00.000Z",
  "render": {"id": "long", "path": "out/publish/zoora-ai/pumpfun-top-caller/media/long.mp4", "sha256": "<64 hex>", "bytes": 123456789},
  "storyboard": {"path": "content/zoora-ai/pumpfun-top-caller/storyboard.json", "version": 1, "sha256": "<64 hex>"},
  "plan": {"sha256": "<64 hex>", "parts": {"video": "…", "insert": "…", "thumbnail": "…", "captions": "…", "playlist": "…", "storyboard": "…"}},
  "inputs": {"thumbnail": "out/publish/zoora-ai/pumpfun-top-caller/media/thumbnails/en/v0.png", "spec": null},
  "summary": {"title": "…", "privacyStatus": "private", "publishAtLocal": "2026-11-28 09:00 CST", "selfDeclaredMadeForKids": false, "containsSyntheticMedia": false, "paidPromotion": true, "captions": ["en \"Captions\""], "playlistId": null, "quotaUnits": 451}
}
```

Paths are relative to `projects/video-studio`.

- `plan` and `upload` rebuild the plan from `inputs` and the paths, then compare every hash.
- `--video <file>` points at a moved render, for example a render-farm download. Its SHA-256 must still match.
- `summary` is for people reading the file and is never used for verification.

Refusal codes: `approval-missing`, `approval-invalid`, `render-missing`, `render-hash-mismatch`,
`storyboard-version-mismatch`, `storyboard-changed`, `metadata-changed` (names what changed), `approval-expired`,
`approval-too-long`, `approval-from-future`, `approval-wrong-episode`, `approval-wrong-render`,
`publish-time-too-soon` and `kit-check-failed`.

## Upload spec (optional, `--spec`)

Use a spec for anything the kit does not carry. Paths are relative to `projects/video-studio`. The example is
`fixtures/upload-spec.example.json`.

| Key | Default | Meaning |
| --- | --- | --- |
| `categoryId` | channels.json | `snippet.categoryId` |
| `defaultLanguage`, `audioLanguage` | episode.json `lang`, else channels.json | Language of the title/description and of the spoken audio. Pipeline codes map to BCP-47 (`pt-br` → `pt-BR`, `zh` → `zh-Hans`); any BCP-47 tag works |
| `tags` | episode.json `tags` | 500 characters by YouTube's count. No commas, `<` or `>` |
| `localizations` | none | `{"es": {"title", "description"}, ...}`, sent as `localizations` in the same `videos.insert`. A translation may repeat the kit's links but never add one. Each affiliate link needs its disclosure in that language |
| `captions` | kit `captions.srt` as the default-language track (long-form) | Extra tracks `[{language, name?, file}]`. A track in the default language replaces the kit's. SRT, plain UTF-8 |
| `thumbnail` | the kit's first thumbnail (long-form); none for Shorts | Path, or null |
| `playlistId` | channels.json `playlists.long` / `.short` | Playlist id, or null |
| `notifySubscribers`, `embeddable`, `license`, `publicStatsViewable` | YouTube's defaults | Sent only when set |

The spec cannot set privacy, the publish time, made for kids, synthetic media, paid promotion, the title or the
description. Those come from the kit and the approval, and such keys are rejected with the reason.

## What is sent, in order

All requests are authorized with the saved account's access token. Quota numbers are from YouTube's Quota Calculator
(updated 2026-11-12).

| # | Request | Quota | When |
| --- | --- | --- | --- |
| 1 | `GET /youtube/v3/channels?part=id,snippet&mine=true` | 1 | Every run: is this the right channel? |
| 2 | `GET /youtube/v3/playlists?part=snippet&id=…` | 1 | Before the upload, when there is a playlist |
| 3 | `POST /upload/youtube/v3/videos?uploadType=resumable&part=snippet,status[,localizations]` with the video resource. Headers `X-Upload-Content-Length` and `X-Upload-Content-Type` | 1 call of the **separate 100-a-day upload bucket** | Once per upload session |
| 4 | `PUT <session URI>` per 32 MiB chunk (`Content-Range: bytes a-b/total`) | none (part of 3) | 308 + Range after each chunk, 201 + video at the end |
| 5 | `GET /youtube/v3/videos?part=processingDetails&id=…` | 1 per check | Shorts with a thumbnail only. thumbnails.set needs processing finished; checks every 30 s, up to 20 times |
| 6 | `POST /upload/youtube/v3/thumbnails/set?videoId=…&uploadType=media` (PNG/JPEG) | 50 | When there is a thumbnail |
| 7 | `POST /upload/youtube/v3/captions?part=snippet&uploadType=multipart` (JSON snippet + SRT) | 400 each | One per caption track |
| 8 | `POST /youtube/v3/playlistItems?part=snippet` | 50 | When there is a playlist |
| - | `PUT /youtube/v3/videos?part=status` with `privacyStatus: "private"` | 50 | Only if YouTube reports the new video as not private |
| - | `GET /youtube/v3/playlistItems?part=id&playlistId=…&videoId=…` | 1 | Only before retrying a playlist insert whose answer was lost |

The upload body is exactly:

```json
{
  "snippet": {"title": "…", "description": "…", "tags": ["…"], "categoryId": "28", "defaultLanguage": "en", "defaultAudioLanguage": "en"},
  "status": {"privacyStatus": "private", "publishAt": "2026-11-28T15:00:00.000Z", "selfDeclaredMadeForKids": false, "containsSyntheticMedia": false},
  "localizations": {"es": {"title": "…", "description": "…"}}
}
```

Localizations travel in the upload itself because `videos.insert` accepts them. A later `videos.update` would be
riskier: it deletes every mutable field of a part that the request leaves out, privacy included.

A long-form upload with a thumbnail, one caption track and a playlist costs **502 units + 1 upload call**. Each extra
caption language adds 400. The project's default bucket is 10,000 units a day, and uploads have their own 100 calls a
day, so about 19 such uploads fit in a day (captions are the expensive part). Quotas reset at midnight Pacific Time.

## Quota accounting

Every request is charged before it is sent, failed ones included: YouTube charges invalid requests at least 1 unit.
Charges go to `.local/quota.json`, per Pacific-time day and per bucket. Before an upload starts, the uploader checks
that what is left of the upload can still fit (`quota-insufficient` otherwise). It checks:

- today's remaining units (`dailyLimits.defaultUnits`);
- today's upload calls (`dailyLimits.uploadCalls`);
- this run's cap (`maxUnitsPerRun`, or `--max-quota`).

If YouTube itself answers `quotaExceeded`, the run stops with the job saved and you run it again after midnight PT.
The count is local: other tools on the same Google Cloud project (comment guard, dashboard) spend the same quota.
Check the project's Quotas page.

## Resume, retries and idempotency

- **State.** `.local/jobs/<channel>__<slug>__<render>__<sha16>.json` is rewritten after every step. It holds the
  upload session URI, the bytes YouTube confirmed, and which of thumbnail, captions and playlist are done.
- **Transient failures.** A lost connection, 500/502/503/504 or 429 is retried with full-jitter backoff,
  `random() * 2^n` seconds as in Google's upload sample, capped at 2 minutes. `Retry-After` is honoured. Then the
  uploader asks YouTube where the upload stands (an empty `PUT` with `Content-Range: bytes */total`) and continues
  from the byte after the confirmed `Range`. Up to 10 retries in a row, then it stops with the session saved.
- **A new process resumes the same session.** It never starts a second upload while the saved session is alive.
  - If the upload finished but the answer was lost, the status check returns the finished video. No duplicate.
  - If the session expired (404), the uploader does **not** start again by itself: check Studio for the video first,
    then use `--restart-upload`.
  - A render whose size or modification time changed mid-upload is refused (`file-changed`).
- **Finishing an uploaded video's steps.** Once this exact plan's video is on YouTube, finishing its remaining steps is
  not blocked by an expired approval, or by a publish time that is now close. Both checks guard the upload itself.
- **Calls that are not idempotent.**
  - A caption insert whose answer was lost is retried. YouTube answers 409 `captionExists`, which counts as done.
  - A playlist insert whose answer was lost is retried only after `playlistItems.list` shows the video is not there yet.
- **Ledger.** `.local/ledger.json` stops a second upload of the same file (`already-uploaded`), and a second file for
  the same episode render unless `--allow-second-upload` is passed.

## Studio steps (not automated, and why)

The plan and the receipt list these for each video:

| Step | Why it stays manual |
| --- | --- |
| **Paid promotion** box: tick it when the kit says `paidPromotion=true` | The docs disagree, so the uploader does not send `paidProductPlacementDetails`. The 2026-11-16 revision history says to specify `hasPaidProductPlacement` in `videos.insert`/`videos.update`, and that an omitted value no longer counts as false. The `videos.insert` and `videos.update` references do not list it among the properties you can set. Turn it on only after a private test upload shows the field is accepted and kept |
| **Dubbed audio tracks** (es, pt-BR, …): Studio > Languages > video > Add language > Dub > Add | The API has no audio-track method: none of the 83 methods in discovery rev 20261123 does it. Desktop Studio only, and it needs Advanced features (Help 13338784). Delete YouTube's auto-dub for that language first |
| Localized thumbnails | No API (Help 13338784) |
| Test & Compare (thumbnail variants 2-3) | The API sets one thumbnail. Changing the title or thumbnail later stops a running test |
| End screen, cards; a Short's Related video | No Data API method |
| Pinned comment (`pinned-comment.txt` from the kit) | Not part of this tool |
| "Video language", if the receipt says `defaultAudioLanguage` was not kept | See the verified facts |
| Custom thumbnail, if YouTube answered 403 (channel not verified) or the daily thumbnail limit | Upload it in Studio |

## Verified facts (read directly on 2026-11-24)

developers.google.com and support.google.com answered from this machine that day. The earlier platform-facts notes
(2026-11-23) could only use search-index extracts.

| Fact | Source |
| --- | --- |
| `videos.insert`: POST https://www.googleapis.com/upload/youtube/v3/videos; 256 GB; `video/*` or `application/octet-stream`. "Quota impact: 100 calls per day. A call to this method has a quota cost of 1 unit in the Video Uploads quota bucket." Scopes: youtube.upload, youtube, youtubepartner, youtube.force-ssl | developers.google.com/youtube/v3/docs/videos/insert (updated 2026-11-23) |
| Settable on insert: `snippet.title`, `description`, `tags[]`, `categoryId`, `defaultLanguage`; `localizations.(key).title/description`; `status.embeddable`, `license`, `privacyStatus`, `publicStatsViewable`, `publishAt`, `selfDeclaredMadeForKids`, `containsSyntheticMedia`; `recordingDetails.recordingDate` | same page |
| "If you don't specify a value for this property, the uploaded video's privacy status defaults to public." Unverified API projects are no longer locked to private (2026-11-02) | same page; revision history (2026-11-02) |
| `publishAt`: ISO 8601, "can be set only if the privacy status of the video is private", only for a never-published video. A time in the past publishes right away | developers.google.com/youtube/v3/docs/videos (updated 2026-11-23) |
| Tags: 500 characters; commas count; a tag with a space counts its quotes | same page |
| `defaultAudioLanguage`: described on the resource ("the language spoken in the video's default audio track") but not in the insert/update settable lists. Widely sent by other uploaders. The uploader sends it and reports whether YouTube kept it | same page; videos/insert; videos/update |
| `selfDeclaredMadeForKids` and `containsSyntheticMedia` are set on insert or update. Since 2026-10-15 an update that omits them leaves them unchanged | videos resource; revision history (2024-10-30, 2026-10-15) |
| Localizations need `snippet.defaultLanguage` (error `defaultLanguageNotSet`) | videos/insert errors |
| `videos.update`: 50 units. Omitted mutable properties of a sent part are deleted ("the video will revert to the default privacy setting"), except the two flags above | developers.google.com/youtube/v3/docs/videos/update (updated 2026-11-12) |
| Resumable protocol: start (200 + Location), PUT, 201; resume after a lost connection or 500/502/503/504 with backoff; status check `Content-Range: bytes */N` → 308 + `Range`; `Retry-After`; 404 = expired session; chunks in multiples of 256 KB | developers.google.com/youtube/v3/guides/using_resumable_upload_protocol (updated 2026-11-12) |
| Retry policy: up to 10 retries on 500/502/503/504, sleep `random() * 2^retry` s | developers.google.com/youtube/v3/guides/uploading_a_video (updated 2026-11-23) |
| `thumbnails.set`: POST .../upload/youtube/v3/thumbnails/set?videoId; JPEG/PNG; 50 MB (since 2026-09-14); about 50 units; for Shorts only after processing has succeeded (2026-11-03); 403 = no permission for custom thumbnails; 429 `uploadRateLimitExceeded` | developers.google.com/youtube/v3/docs/thumbnails/set (updated 2026-11-12); revision history |
| Custom thumbnails need a verified account; 3840×2160 recommended, minimum width 640 | support.google.com/youtube/answer/72431 |
| `captions.insert`: POST .../upload/youtube/v3/captions?part=snippet; 400 units; scopes youtube.force-ssl or youtubepartner only; `snippet.videoId`, `language` (BCP-47) and `name` (≤ 150 characters) required; 409 `captionExists` for the same language and name; timing is required since `sync` was deprecated (2024) | developers.google.com/youtube/v3/docs/captions/insert, /captions (updated 2026-11-12) |
| SRT is supported, as plain UTF-8 | support.google.com/youtube/answer/2734698 |
| `playlistItems.insert`: POST /youtube/v3/playlistItems?part=snippet; 50 units; needs `snippet.playlistId` and `snippet.resourceId` | developers.google.com/youtube/v3/docs/playlistItems/insert (updated 2026-11-12) |
| Quota: 10,000 units a day for most methods; `videos.insert` and `search.list` have their own buckets, "100 quota per day. Each call costs 1 quota"; reset at midnight PT; invalid requests cost ≥ 1. captions.insert 400, thumbnails.set 50, playlistItems.insert 50, videos.update 50, list calls 1. This settles the old 1600-unit figure (revision history: ~1600 → ~100 on 2025-12-04; separate buckets from 2026-06-01) | developers.google.com/youtube/v3/determine_quota_cost (updated 2026-11-12); revision history |
| No audio-track upload in the API; dub tracks and localized thumbnails are desktop-Studio only; eligibility is Advanced features | discovery rev 20261123; support.google.com/youtube/answer/13338784 |
| channels.list, playlists.list, videos.list and videos.update accept youtube.force-ssl, not youtube.upload. thumbnails.set and videos.insert accept both | discovery rev 20261123 |
| Installed-app OAuth: loopback `http://127.0.0.1:<port>`, PKCE S256; refresh tokens always returned; users may grant only some scopes | developers.google.com/identity/protocols/oauth2/native-app (updated 2026-11-19) |
| External + Testing ⇒ refresh token expires in 7 days; limit of 100 refresh tokens per account per client | developers.google.com/identity/protocols/oauth2 (updated 2026-11-19) |
| Personal apps: no verification, no user cap, no 7-day expiry, no unverified-app screen; single creator account; permanent choice | support.google.com/cloud/answer/15549945 |

## Files

| Path | What |
| --- | --- |
| `cli.ts` | Commands, options and exit codes |
| `inputs.ts` | Reads and checks the kit, the Short files, episode.json, the storyboard, channels.json, the spec, and the files (hashes, image sizes, SRT) |
| `plan.ts`, `requests.ts` | The plan and every request builder. The plan printer and the executor share them, so `plan` shows what `--apply` sends. The privacy guard is in `requests.ts` |
| `approval.ts`, `prepare.ts` | The approval record: creation, parsing, verification |
| `apply.ts`, `resumable.ts`, `api.ts`, `http.ts` | Executor, resumable protocol, API client (quota, refresh, retries), HTTP seam |
| `oauth.ts`, `quota.ts`, `ledger.ts`, `state.ts` | Sign-in, quota counter, ledger and lock, job state |
| `contracts.ts` | Endpoints, scopes, quota costs and limits, with their sources |
| `channels.json` | Per-channel settings (committed, not secret) |
| `.local/` (gitignored) | `oauth.json` (0600), `ledger.json`, `quota.json`, `jobs/`, `locks/`, `receipts/` |
| `fake-youtube.ts`, `test-helpers.ts`, `fixtures/` | Test support: an in-process fake YouTube with fault injection, and a throwaway video-studio layout |

Exit codes: 0 done; 1 failed or paused (run the same command again); 2 bad input; 3 refused (nothing, or nothing
more, was sent); 4 previewed but not approved.

## Tests

`node --test "tools/uploader/*.test.ts"` runs 86 tests in about 3 seconds. They use a fake YouTube and never reach
the network. A local socket is used only to check that Node's fetch returns 308 instead of following it. Covered:

- **No approval, bad approval.** Refusal with no record and with a malformed one; refusal on a render SHA-256 mismatch,
  a storyboard change or version change, and changed metadata (naming what changed); expiry; a publish time too close
  or past; failing kit checks.
- **Private enforcement.**
  - The guard blocks a non-private insert before the network.
  - An upload YouTube reports as public is set back to private, with an alert.
  - Spec keys that touch privacy are rejected.
- **Quota.** Per-bucket charges, failed attempts counted, and refusal before sending when today or the run cap cannot
  cover the upload. A `quotaExceeded` stops the run, and a later resume finishes it.
- **Resume.**
  - A lost chunk answer, a partial chunk, and a 308 without progress.
  - A process killed mid-upload resumes in a new run without a second session.
  - A finished upload whose answer was lost.
  - An expired session (refused, then `--restart-upload`).
  - 5xx with `Retry-After`, a 401 mid-upload with a token refresh, the retry limit, and a file changed mid-upload.
- **Ledger, channel and playlist checks; follow-up steps.**
  - Ledger and lock.
  - Wrong channel, missing or foreign playlist, missing scope.
  - Thumbnail 403 turned into a Studio step; `captionExists` after a lost answer; no duplicate playlist insert.
  - Shorts processing wait.
- **OAuth and the CLI.** OAuth loopback with PKCE and state check, the 7-day message, the token file mode, and the CLI
  end to end.

`npx tsc --noEmit` (creator-hub) typechecks it. Only erasable TypeScript is used, with no runtime dependencies.

## Not covered yet

- **Short-only episodes.** Daily Shorts with no long-form render are only reachable if the publish kit writes a
  `short-<n>` render: the uploader takes the kit's renders as they are.
- **A Short's own thumbnail and captions.** The kit makes no 9:16 thumbnails or per-Short caption files. Pass them with
  `--thumbnail` and a spec when they exist.
- **Brand Account sign-in with a Personal OAuth app.** Unverified (see above).
