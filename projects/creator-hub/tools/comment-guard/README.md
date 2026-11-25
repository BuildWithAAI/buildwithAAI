# Comment scam guard

Crypto channels attract "WhatsApp me" bots, fake "account managers", recovery-scam hackers, wallet
drainers and accounts that copy the channel's own name. The guard finds them in your comments, explains
why each one looks like a scam, and can hold them for review in YouTube Studio. Holding is reversible.
The guard never deletes, rejects or bans.

**Status (2026-11-24):** built and tested on this machine against recorded-shape API responses and a mock
Google server (`mock-google.ts`). It has **not** been run against the live YouTube API, because this
build machine cannot reach Google's servers. Your first real run should be the dry run (`npm run guard`).

## Commands

Run from `projects/creator-hub`:

| Command | What it does |
| --- | --- |
| `npm run guard -- blocked-words` | Prints a blocked-words list to paste into YouTube Studio, plus the recommended comment settings. No API needed: **start here.** |
| `npm run guard -- auth --client-secrets <file>` | One-time Google sign-in for your channel. Saves `config/youtube-oauth.json` (gitignored, owner-only permissions). |
| `npm run guard` | **Dry run** (same as `guard scan`, the default). Reads recent comments and replies, scores them, and writes `out/comment-guard/guard-scan-<time>.md` and `.json`. Changes nothing. |
| `npm run guard -- apply --confirm --from-report latest` | Holds the comments the report marked **hold** (YouTube Studio > Comments > Held for review). Comments marked **review** are only listed for you. |
| `npm run guard -- apply --confirm` | Same, but scans again first instead of using a report. |
| `npm run guard -- release --confirm <comment id>...` | Undoes holds (sets the comments back to published). `--from-report latest` releases everything the last `apply` held. |
| `npm run guard -- auth --revoke` | Revokes the saved access at Google and removes it from the file. |

`apply` and `release` refuse to run without `--confirm`.

## Setup

1. **Blocked words first.** Run `npm run guard -- blocked-words` and follow its list: paste the blocked
   words, turn on link blocking, set comment moderation to at least "Basic" (hold potentially inappropriate
   comments), add impersonators to Hidden users, and pin the publish kit's `pinned-comment.txt` (YouTube
   allows one pinned comment, and that one already ends with the "we never DM you first" safety line).
2. **One Google Cloud project** for the guard. Do not create extra projects to get more quota: sharding is
   against YouTube's Developer Policies.
   - Enable **YouTube Data API v3**.
   - OAuth consent screen: type External, add your own Google account. Set publishing status to
     **In production**. In "Testing" mode, Google expires refresh tokens after 7 days and the guard stops
     with "authorization has expired". An unverified app in production shows Google's warning screen to
     you, and that is fine for your own channel.
   - Credentials > Create OAuth client ID > **Desktop app**. Download the JSON.
3. `npm run guard -- auth --client-secrets ~/Downloads/client_secret_....json`. It prints a Google link.
   Open it **in a browser on the same computer**, because Google redirects back to `http://127.0.0.1:<port>`,
   which the command is listening on. Sign in with the account that owns the channel and allow access
   (scope `youtube.force-ssl`, needed to read and moderate comments).
   On a server without a browser, run `auth` on your laptop and copy `config/youtube-oauth.json` to the
   server privately.
4. `npm run guard`, then read the Markdown report. If it looks right, run
   `npm run guard -- apply --confirm --from-report latest`.

**Second channel** (Zoodger News, @ZoodgerNews, channel ID UCOo2HSb3SYyN66YFiiiO1ZA): run
`npm run guard -- auth --account news` and sign in as that channel. Without `--account`, the key defaults to
the handle, `zoodgernews`. The file then holds both. Use `--account news` (or `--account zooratechnologies`) on
every command. All saved channels count as "you": their comments are never flagged, and all their names
are protected against impersonation. The owner's two channels are built in too: the Zoora AI and Zoodger News
channel ids are trusted by default, and both names and handles, and the show's name ("The Zoo & Badger Show"),
are always protected, so one channel's replies under the other's videos are never flagged, even before both are
saved. If either channel is ever taken over, add `--no-default-trust` (and `auth --revoke` its saved access:
saved channels count as you) so its comments are scored like anyone else's.

## Options and environment

| Option | Default | Meaning |
| --- | --- | --- |
| `--max-quota <units>` | 1000 | API quota this run may spend. Reads cost 1 unit per page; each hold call costs 50. The guard stops before going over. |
| `--max-threads <n>` | 300 | Newest comment threads to read (all their replies are read too). |
| `--from-report <file\|latest>` | | `apply`: hold what a reviewed scan report says. `release`: undo what an apply report held. |
| `--input <file>` | | `scan` only: score a JSON file of comments (`[{id, text, authorName, authorChannelId}]`) instead of the API. Your two channels are trusted by default; add `--trust` for any other channel whose replies are yours. |
| `--account <key>` | the only one | Which saved channel to use. |
| `--channel-name <name>` | | Extra name to protect from impersonation (repeatable). Your channel title and handle are always included. |
| `--trust <channel id>` | | A channel whose comments are never flagged, e.g. a moderator (repeatable). Zoora AI and Zoodger News are trusted by default. |
| `--no-default-trust` | | Score Zoora AI's and Zoodger News's comments like anyone else's, e.g. if one of them was taken over. |
| `--own-handle <handle>` | | A handle or link you own, e.g. your official Telegram bot, so viewers asking about it are not flagged (repeatable). |
| `--oauth-file <file>` | `config/youtube-oauth.json` | Where the credentials live. |
| `--out <dir>` | `out/comment-guard` | Where reports go. |

Environment variables: `YOUTUBE_OAUTH_FILE`, `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` (for `auth`,
instead of `--client-secrets`), and comma-separated `GUARD_CHANNEL_NAMES`, `GUARD_TRUSTED_CHANNELS` and
`GUARD_OWN_HANDLES`.

`config/youtube-oauth.json` looks like this (written by `auth`; never commit it):

```json
{"version": 1, "client": {"clientId": "...apps.googleusercontent.com", "clientSecret": "..."},
 "accounts": {"zooratechnologies": {"channelId": "UC...", "title": "Zoora AI", "handle": "@zooratechnologies",
   "tokens": {"accessToken": "...", "expiresAt": 0, "refreshToken": "...", "scope": "https://www.googleapis.com/auth/youtube.force-ssl"},
   "savedAt": "2026-11-24T00:00:00.000Z"}}}
```

## Quota

| Call | Units | Used for |
| --- | ---: | --- |
| `commentThreads.list` (`allThreadsRelatedToChannelId`, 100 threads per page) | 1 | Newest threads on all your videos and the channel |
| `comments.list` (`parentId`) | 1 | Replies beyond the few that come with each thread |
| `comments.setModerationStatus` (`heldForReview`, up to 50 ids per call) | 50 | Holding, and undoing a hold (`published`) |
| `channels.list` (`mine=true`) | 1 | Once, during `auth` |

A project gets 10,000 units a day by default (shared by every tool using that project), and the quota resets
at midnight Pacific Time. A dry run of 300 threads costs 3 units for the thread pages, plus 1 unit for each
thread with more replies than the few the API includes with it. Holding up to 50 comments costs 50. If a
batch fails, for example because one comment was deleted in the meantime, the guard retries those ids one
at a time, which costs 50 units each. Check your project's Quotas page in
Google Cloud Console before raising `--max-quota`.

## How it scores

Every rule that fires adds its weight. The total gives the action:

- **7 or more: hold.** `apply` holds these.
- **4 to 6: review.** Listed in the report, never changed.
- **Below 4: allow.**

Each reason in the report shows the rule, its weight and the matched text.

Before matching, `normalize.ts` undoes the usual disguises:
- styled Unicode (𝐓𝐞𝐥𝐞𝐠𝐫𝐚𝐦, ᴛᴇʟᴇɢʀᴀᴍ, full-width letters);
- Cyrillic or Greek look-alike letters inside Latin words (Теlеgrаm);
- spaced-out letters (W h a t s A p p);
- invisible characters;
- digits from any script (١٢٣, १२३, １２３, 𝟏𝟐𝟑) and emoji keycaps (1️⃣);
- the letter O or l typed in place of 0 or 1 inside a phone number.

Context lowers the score:
- Your own channels and `--trust` channels are always allowed.
- Scam phrases quoted inside a warning do not count. For example: Ignore anyone who says 'text me on WhatsApp', it's a scam.
- Quoted phrases without a warning count half.
- Negated or reported requests are not requests: "never share your seed phrase", "if someone asks you to connect your wallet".
- Questions and victims' stories are dampened.

Impersonation: the author name is folded to a "skeleton". Look-alike letters, digits read as letters
(0→o), I/l merged, and words such as Official, Support, Team, Help, Admin, Real, Live and Shorts are
dropped. The skeleton is then compared with your channel names. An exact skeleton match from another
channel scores 7. Within 2 edits scores 5, and only for names of 5 or more letters. Zoodger News counts
within 1 edit only: its skeleton, "zoodger", is 2 edits from ordinary names such as Rodger, Dodger and Booger,
which would otherwise score 5 and be held together with any +2 signal (a profit or "legit" claim).

Copy-paste bursts: near-identical text (at least 6 distinct words, 80% word overlap) from 3 or more
accounts in the same run adds 5 to each of those comments.

| Rule | Weight | Reads | What it catches |
| --- | ---: | --- | --- |
| `seed-request` | +7 | text | Asks for a seed phrase, recovery phrase or private key. Whoever has these can empty the wallet. |
| `doubling-scheme` | +7 | text | "Send X, get 2X back": a giveaway scam that keeps whatever is sent. |
| `impersonation-exact` | +7 | author | The author name is your channel name in disguise (look-alike letters, or words like "Official" or "Support" added), but the comment comes from a different channel. |
| `impersonation-lookalike` | +5 | author | The author name is within 2 letters of your channel name, but the comment comes from a different channel. |
| `messaging-link` | +5 | text | Contains a direct chat link (t.me, wa.me...) that takes viewers off YouTube into a private chat. |
| `prize-bait` | +5 | text | Tells the reader they won or were selected for a prize or giveaway. |
| `wallet-connect` | +5 | text | Asks the reader to connect, "validate" or "sync" a wallet: the usual wallet-drainer script. |
| `author-contact` | +5 | author | The author name itself advertises a messaging app, chat link or phone number. |
| `copy-paste-burst` | +5 | batch | The same text was posted by several different accounts: coordinated bot spam. |
| `contact-me` | +4 | text | Asks readers to contact the writer privately ("text me", "DM me"): the usual first step of a scam. |
| `messaging-handle` | +4 | text | Gives a messaging-app username, phone number or e-mail address to contact. |
| `phone-number` | +4 | text | Contains a phone number (any formatting, including spaced-out or non-ASCII digits). |
| `link-shortener` | +4 | text | Contains a shortened link that hides where it leads. |
| `obfuscated-link` | +4 | text | Writes a web address in disguise ("site[.]xyz") to get past YouTube's link filter. |
| `testimonial` | +4 | text | A success story that credits a named handler: the classic "thanks to Mrs X I earned..." script. |
| `contact-them` | +3 | text | Sends readers to a third party in private ("contact her on WhatsApp"): typical of "handler" scams. |
| `handler-role` | +3 | text | Pitches an "account manager", "recovery expert", "certified hacker" or similar. These roles are scam staples. |
| `income-claim` | +3 | text | Claims a recurring income ("$3k weekly"), as fake testimonials do. |
| `guaranteed-returns` | +3 | text | Promises guaranteed or fixed high returns. Real investments never do. |
| `claim-bait` | +3 | text | Pushes the reader to claim free crypto, an airdrop or a reward, often with false urgency. |
| `drainer-jargon` | +3 | text | Uses wallet-drainer jargon ("rectification dapp", "validation portal"). |
| `investment-pitch` | +3 | text | Pitches an "investment opportunity", "mining investment" or "passive income", the openers of investment scams. |
| `friend-opener` | +3 | text | Opens like a romance or "pig-butchering" scam ("I'd like to be friends", "hello dear"). |
| `profile-bait` | +3 | text | Sends readers to the writer's profile or bio, where the scam link usually is. |
| `handler-title` | +2 | text | Names a person with a title such as "Mrs", "Expert" or "Hacker". Scam scripts promote a named "handler". |
| `recovery-claim` | +2 | text | Claims that lost or stolen funds were (or can be) recovered. |
| `profit-claim` | +2 | text | States a trading or investment profit. |
| `legitimacy-claim` | +2 | text | Insists someone or something is "legit" or "not a scam". |
| `obfuscation` | +2 | text | Disguises text with look-alike or styled letters, spaced-out letters or unusual digits to slip past filters. |
| `author-handler-name` | +2 | author | The author name is styled as a "handler" ("@MrsSarahFX", "Expert Brian"). |
| `messaging-app` | +1 | text | Mentions a private messaging app (WhatsApp, Telegram, Signal...). Weak evidence on its own. |
| `warning-context` | −4 | dampener | Reads as a warning about scams, so scam phrases it repeats count less (and not at all inside quotation marks). |
| `victim-story` | −2 | dampener | Describes the writer, or someone close, losing money or being targeted. |
| `question` | −1 | dampener | Asks a question, as genuine viewers do. |

Patterns are English-first, with the common scam phrasings in Spanish, Portuguese, French, German,
Indonesian, Turkish, Russian, Arabic and romanised Hindi.

## How well it works

`fixtures/comments.json` holds 333 labelled **synthetic** comments: 153 scams and 180 genuine. The genuine
ones include hard negatives: questions about Telegram and wallet security, warnings that quote scams,
victims' stories, non-English comments, an own-channel reply and a trusted second channel. The tests
require at least 95% of scams held or flagged and at most 2% of genuine comments flagged, with none held.
They print the confusion matrix (`node --test tools/comment-guard/classifier.test.ts`). The current
result is 153/153 scams flagged (144 held) and 1/180 genuine flagged for review (none held): "I make about
$2k a month freelancing..." still reads like an income claim.

That perfect score is **not** a real-world estimate, because the rules were tuned on these comments. A
fairer number comes from three rounds. In each round, fresh comments were written after the rules were
frozen and scored once before any change:

| Round | Scams flagged | Scams held | Genuine flagged |
| --- | ---: | ---: | ---: |
| 1 | 20/25 | 16/25 | 0/25 |
| 2 | 19/25 | 13/25 | 1/25 |
| 3 | 16/20 | 11/20 | 0/20 |
| **Total** | **55/70 (79%)** | **40/70 (57%)** | **1/70 (1.4%)** |

Expect roughly that on scam wording the guard has not seen. It misses or only flags about a fifth of new
scam phrasings. The misses from each round were then used to widen the rules, and those comments stay in the
fixtures as regression tests (`"round": 1..3`).

**Round 4 (2026-11-24 review).** An independent review wrote 30 realistic genuine comments chosen to collide
with the rules. Before the fix the guard **held 3 of 30** and flagged 8 more for review (37% flagged), so
genuine comments are less safe than rounds 1-3 suggested. The held ones were a test-transaction tip ("send
some ETH ... until you get 2 confirmations" read as "send X, get 2X"), a victim's story quoting the
scammer's "call back at +1 ..." and a Spanish comment quoting the scammer's WhatsApp number. The fixes:
returned amounts must be money (not "2 confirmations"); a number that is both a phone number and a WhatsApp
contact counts once; "saying ... and to call back" is reported speech; warnings and "blocked / reported"
in Spanish, Portuguese, Indonesian and German dampen the score; "retired" alone is no longer a scam outcome.
These 30 comments, 8 variants and 15 scams that probe the new dampeners are `"round": 4` in the fixtures.
They were tuned on, so they are regression tests, not an estimate. Real bot comments may differ from these
synthetic ones, so measure on your own channel. Run the dry run for a week and count wrong calls in the
reports before relying on `apply`.

### Improving it

1. Copy a missed scam (or a wrongly flagged genuine comment) from a report into `fixtures/comments.json`
   with the right `label`. **The repository is public:** replace real names, handles, links and phone
   numbers with invented ones (`example` handles, US `555-01xx` numbers) before committing.
2. Adjust or add a pattern in `rules.ts`.
3. `node --test tools/comment-guard/classifier.test.ts`. The metric gate must still pass.

## Privacy and safety

- Reports contain commenters' names and text. They are written under `out/` (gitignored) with owner-only
  permissions, and links inside them are defanged (`hxxps://`, `site[.]com`) so nothing in a report is
  clickable.
- YouTube's Developer Policies limit how long API data may be kept: 30 days for most data, according to the
  research notes in `projects/video-studio/docs/research/platform-facts-2026-11-23.md` (read through search
  extracts, not the live policy). So each run deletes this tool's own reports older than 30 days.
- `config/youtube-oauth.json` holds a refresh token. It is gitignored and written with mode 0600. Revoke it
  with `auth --revoke` or at https://myaccount.google.com/permissions. The repository is public, so the
  guard refuses to save credentials anywhere inside the git repository that git does not ignore
  (`git check-ignore`). creator-hub ignores every `config/*.json` except the `*.example.json` templates, and
  any `*oauth*.json` file, so `--oauth-file config/youtube-oauth-news.json` works for a second channel.
- Only `heldForReview` and `published` are ever sent. `rejected` and `banAuthor` are not implemented on
  purpose. Hiding an account is a manual decision: the report lists candidates under "Accounts to consider
  hiding".

## Limitations

- Rule-based: new scam wording gets through until a rule covers it (see the numbers above).
- It reads text only. It cannot see images attached to comments, avatars, or where a link really leads.
- The API's `textDisplay` can differ from what was typed (YouTube may rewrite video links).
- Impersonation compares names only, not profile pictures.
- Copy-paste bursts are detected within one run's comments.
- Comments longer than 4,000 characters are only read up to that point.

## Files

| File | Role |
| --- | --- |
| `cli.ts` | Commands, options, reports, quota budget per run |
| `classifier.ts` | Scoring, thresholds, quotes, own and trusted channels, copy-paste bursts |
| `rules.ts` | The rule table (id, weight, explanation, test) |
| `normalize.ts` | Unicode folding, look-alike letters, digits, name skeletons, edit distance |
| `youtube.ts` | OAuth (loopback + PKCE), YouTube Data API v3 client, quota meter, credential file |
| `report.ts` | JSON and Markdown reports, escaping and defanging, 30-day pruning |
| `blocked-words.ts` | `guard blocked-words` text |
| `mock-google.ts` | Test-only mock of Google's token endpoint and the comment API |
| `fixtures/comments.json` | 333 labelled synthetic comments |
| `fixtures/api/*.json` | Recorded-shape API responses (discovery-document schemas) |

## Sources

Checked 2026-11-24. Hosts that this build machine could not open are marked as read through search-engine
extracts.

- YouTube Data API discovery document, revision 20261123 (read directly): methods, parameters, enums and
  scopes for `commentThreads.list`, `comments.list`, `comments.setModerationStatus` and `channels.list`.
  https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest
- Reference pages (search extracts):
  - https://developers.google.com/youtube/v3/docs/commentThreads/list
  - https://developers.google.com/youtube/v3/docs/comments/list
  - https://developers.google.com/youtube/v3/docs/comments/setModerationStatus ("comma-separated list of IDs"; 50 units)
- Quota costs and the 10,000-unit default (search extracts):
  - https://developers.google.com/youtube/v3/determine_quota_cost
  - https://developers.google.com/youtube/data/guides/quota_and_compliance_audits
- OAuth for desktop apps, loopback redirect and PKCE (search extracts):
  https://developers.google.com/youtube/data/guides/auth/installed-apps and
  https://developers.google.com/identity/protocols/oauth2/native-app. Endpoints come from
  https://accounts.google.com/.well-known/openid-configuration (read directly).
- 7-day refresh-token expiry in "Testing" mode, and the YouTube impersonation and spam policies: see
  `projects/video-studio/docs/research/platform-facts-2026-11-23.md`.
- Studio comment settings (search extracts; menu names change):
  - https://support.google.com/youtube/answer/9483359
  - https://support.google.com/youtube/answer/16622701
  - https://support.google.com/youtube/answer/9482556
