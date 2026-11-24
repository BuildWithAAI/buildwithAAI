# Daily orchestrator (channel 2, `zoora-security`)

Radar → story pick and brief → the writer's storyboard → claim gates → voice, render, thumbnails and publish kit → an approval packet the owner reviews on his phone → his `APPROVE` → the announcer and Threat Brief drafts. **It never uploads.** The upload stays a manual step in YouTube Studio.

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
| `lib/prepare.ts`, `lib/radar.ts`, `lib/select.ts` | The radar step, reading the radar's file, and the story pick with alternates. |
| `lib/history.ts`, `lib/opportunities.ts` | The data for the "real analysis":<br>• DefiLlama rows from the radar's cache (structured fields only);<br>• the radar's own history;<br>• our earlier episodes.<br>From these it builds the 30-day comparison, the radar pattern, the source figures and the Solana fund-flow check. |
| `lib/brief.ts`, `lib/writer.ts`, `lib/research.ts` | `brief.json` (in the news gate's curated-brief shape), `WRITER.md` (with a skeleton in the show's format) and `research.md` (the general gate's "Must not say"). |
| `lib/build.ts`, `lib/kit-adapter.ts` | The build steps in order, plus the thin adapter to the publish kit (`episode.json` for a Short). |
| `lib/packet.ts`, `lib/html.ts`, `lib/md.ts`, `lib/escape.ts` | The approval packet: its model, the mobile page (no scripts, everything escaped) and the Markdown version. |
| `lib/approve.ts`, `lib/postapproval.ts` | The approval record, and the drafts plus calls to the creator-hub tools when those tools exist. |
| `lib/narration.ts` | Sentences and claims. It uses the news gate's own splitter, with a local fallback. |
| `lib/status.ts`, `lib/lock.ts`, `lib/exec.ts`, `lib/util.ts`, `lib/paths.ts`, `lib/channel.ts`, `lib/types.ts` | Small helpers and the contracts. |
| `tests/` | `node:test` suites with fictional fixtures on reserved example domains. Every other step is mocked; `e2e.test.ts` runs the real news gate. |

## Adapters for tools that are not finished

- `creator-hub/tools/announcer` and `creator-hub/tools/threat-brief` do not exist yet. Until they do, `lib/postapproval.ts` writes local drafts and sends nothing. Once they exist, it calls `node <hub>/tools/<tool>/cli.ts --input <json> --out <dir> [--dry-run]`; `DAILY_ANNOUNCER_CMD` and `DAILY_THREAT_BRIEF_CMD` override that call.
- The publish kit models long-form episodes with Shorts cut from them. `lib/kit-adapter.ts` writes one Short that covers every scene. The kit's chapter check is reported as not applicable to a Short.
- The general claim gate (`scripts/claims/check.ts`) takes the episode folder as its argument. `NEWS_GENERAL_GATE_CMD` overrides that call, as it does for the news gate.
