# Weekly batch (`scripts/batch`)

One production session a week for every evergreen piece (Zoora AI's two POV episodes and their daily Shorts, the
security channel's explainer and Scam of the Week), and one approval page for the owner. The daily news stays in
`scripts/daily`. The runbook is [`docs/WEEKLY_BATCH.md`](../../docs/WEEKLY_BATCH.md); the 4-week proposal is
[`docs/CONTENT_CALENDAR.md`](../../docs/CONTENT_CALENDAR.md).

```bash
cd projects/video-studio
node scripts/batch/cli.ts plan --week 2026-W49            # items, slots, WRITER packets, farm drafts; pins the ideas
node scripts/batch/cli.ts status --week 2026-W49          # what is still missing, per item
node scripts/batch/cli.ts review --week 2026-W49          # out/approval/week-2026-W49/index.html (one page)
node scripts/batch/cli.ts approve --week 2026-W49 --items all            # the owner, at a terminal (types the page code)
node scripts/batch/cli.ts approve --week 2026-W49 --items ai1 --reply "APPROVE 2026-W49 ai1 #93770ddb"   # his reply, verbatim
node scripts/batch/cli.ts calendar --from 2026-W49 --weeks 4 --out docs/CONTENT_CALENDAR.md
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/batch/tests/*.test.ts
```

Nothing here uploads, publishes, posts or pushes. `approve` writes the creator-hub uploader's own approval records
(built and re-checked with the uploader's code); the owner runs the uploads. Node 22 runs the `.ts` files directly; no
dependencies.
