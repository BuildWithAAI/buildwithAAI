# Daily orchestrator (channel 2, `zoora-security`)

Radar → story pick and brief → the writer's storyboard → claim gates → voice, render, thumbnails and publish kit → an approval packet the owner reviews on his phone → his `APPROVE` → the announcer and Threat Brief drafts. **It never uploads.** The upload stays a manual step in YouTube Studio.

Both radar lanes (crypto and AI security) compete on the same rules; `prepare.md` shows each candidate's lane, and an AI story's brief and `WRITER.md` carry the AI rules (safe mechanism, attribution, a user fix, a hidden Rekt Meter when no loss is reported; `tests/ai-lane.test.ts`). An AI or both-lane name the radar read only from a headline's shape (`subjectKnown: false`) could be a person or a handle, so the brief marks it `nameKnown: false` and leaves it out of the other candidates' names, and the news gate never allowlists it; crypto names are allowlisted as before, as in the Threat Brief (`lib/radar.ts` `subjectKnown`, `tests/ai-review-r2.test.ts`).

The runbook, with the schedule, every step and the failure handling, is [`docs/DAILY_BRIEF.md`](../../docs/DAILY_BRIEF.md).

```bash
cd projects/video-studio
node scripts/daily/run.ts prepare [--date YYYY-MM-DD] [--radar live|reuse|offline] [--pick <incident id>]
node scripts/daily/run.ts build <date-slug> [--only gates]
node scripts/daily/run.ts approve <date-slug> --reply "APPROVE <date-slug>"     # the owner's own reply only
node scripts/daily/run.ts approve <date-slug> --youtube-id <id>                  # after his manual upload
node scripts/daily/run.ts status <date-slug>
node --test scripts/daily/tests/*.test.ts
```

## Files

| File | What |
| --- | --- |
| `run.ts` | Entry point. It hides one Node warning, then runs `lib/cli.ts`. |
| `lib/cli.ts` | Arguments, commands and exit codes. |
| `lib/prepare.ts`, `lib/radar.ts`, `lib/select.ts` | The radar step (the radar's run date is the UTC day), reading the radar's file, the story pick with alternates, and the day's Threat Brief draft from the radar (every day, video or not). |
| `lib/history.ts`, `lib/opportunities.ts` | The data for the "real analysis":<br>• DefiLlama rows from the radar's cache (structured fields only), the window and the 30 days before it;<br>• the radar's own history;<br>• our earlier episodes.<br>From these it builds the 30-day comparison (a daily template: strong only when it finds something non-obvious), the radar pattern (real analysis with 3 or more same-type incidents in 7 or more daily files), the source figures (a template) and the Solana fund-flow check. A daily Short needs a strong analysis that is not a template. |
| `lib/match.ts` | "Same incident?": the same radar id, or the protocol's aliases match and the dates are within 3 days (a port of the radar's own matching). Coverage and corrections use it. |
| `lib/corrections.ts` | Corrections to pin: every episode approved in the last 30 days against today's radar view of the same incident (status, type, mechanism, figures). A correction blocks the next packet until `corrections.ts add --id <key>` records it. |
| `lib/brief.ts`, `lib/writer.ts`, `lib/research.ts` | `brief.json` (in the news gate's curated-brief shape), `WRITER.md` (with a skeleton in the show's format) and `research.md` (the general gate's "Must not say"). |
| `lib/build.ts`, `lib/kit-adapter.ts` | The build steps in order, plus the thin adapter to the publish kit (`episode.json` for a Short). |
| `lib/packet.ts`, `lib/html.ts`, `lib/md.ts`, `lib/escape.ts` | The approval packet: its model, the mobile page (no scripts, everything escaped) and the Markdown version. At the top, after the name findings (R4), it lists every quoted span in the storyboard with where it is (`quotesOf`): the gate refuses the payload shapes it knows, and the owner reads the rest (in an AI story a quote is an organisation's statement, never a prompt, an injected instruction or a bypass setting). |
| `lib/approve.ts`, `lib/postapproval.ts` | The approval record, and the drafts plus the calls to the creator-hub tools (the only steps that get the posting credentials). |
| `lib/narration.ts` | Sentences and claims. It uses the news gate's own splitter, with a local fallback. |
| `lib/status.ts`, `lib/lock.ts`, `lib/exec.ts`, `lib/util.ts`, `lib/paths.ts`, `lib/channel.ts`, `lib/types.ts` | Small helpers and the contracts. The lock appears with its content in one step and is released only by its holder; `util.ts scrubEnv` removes posting credentials from every non-posting step. |
| `tests/` | `node:test` suites with fictional fixtures on reserved example domains. Every other step is mocked; `e2e.test.ts` runs the real news gate. |

## Adapters to the other workflows' tools

- `creator-hub/tools/announcer` and `creator-hub/tools/threat-brief`: `lib/postapproval.ts` writes local previews, then calls `node <hub>/tools/<tool>/cli.ts --input <json> --out <dir> [--dry-run]` (`DAILY_ANNOUNCER_CMD` and `DAILY_THREAT_BRIEF_CMD` override the call; `{input}`, `{out}`, `{dryRun}` are filled in). The announcer posts only with `--apply`, which the daily never adds: the owner opts in by putting it in `DAILY_ANNOUNCER_CMD`, and it then posts only to the platforms whose credentials (`channel.json` postApproval.announcer.credentialEnv: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID; X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and X_ACCESS_TOKEN_SECRET) are all set, once the video id is recorded. The Threat Brief tool creates a Kit draft (never a send) without `--dry-run` when KIT_API_KEY is set. `approval.json` records `hub-live` only when the tool reports a post or a created draft. Every hub CLI and the publish kit are launched by their real path, the script in an owner's `DAILY_*_CMD` included (`lib/exec.ts` `realScript`): through a symlinked path their entry check skips `main()` and exits 0 having done nothing. A tool that still exits 0 with no output is recorded as failed (`hub-failed`; the publish kit's step says it "did not run"), never as written.
- The publish kit models long-form episodes with Shorts cut from them. `lib/kit-adapter.ts` writes one Short that covers every scene. The kit's chapter check is reported as not applicable to a Short.
- The general claim gate (`scripts/claims/check.ts`) is called with the absolute episode folder, `--out-dir <root>/out/claims`, and `--names data/private/names.txt` when that gitignored list exists, else `--no-names` with a warning in the packet (the news gate's R4 still refuses unknown names). `NEWS_GENERAL_GATE_CMD` overrides that call, as it does for the news gate.
