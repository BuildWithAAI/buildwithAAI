# Build log

---
sha: 238c512
title: Zoora can message the owner on Telegram.
summary: The first version sent notes on a schedule. A later change makes the messages Zoora's own thoughts instead.
date: 2026-11-10T02:36:00Z
image:

When a backlog item ships, append a block here. The public `/build` page reads this file. Dates are UTC instants; the page shows them in America/Chicago.

---
sha: 0364a4d
title: Zoora can place small builds in the world.
summary: Mood, ideas, and memory can propose a decoration, garden, sign, or bench. The server checks the place's slots and a materials budget. The keeper can hide or undo one. It cannot spend.
date: 2026-11-10T02:16:00Z
image:
---
sha: d34114e
title: Refuse private addresses before a research page is fetched.
summary: Zoora's research fetch checks the address first, pins the connection, and re-checks every redirect. Private, loopback, and metadata addresses are refused.
date: 2026-11-10T01:30:00Z
image:
---
sha: 5f6169c
title: Cap research page reads and keep them off the brain tick.
summary: A fetched page stops at 64KB and about six seconds. The brain tick only queues the address.
date: 2026-11-10T01:32:00Z
image:
---
sha: bc23f3a
title: Show Zoora's own notes on the ideas page and pinboard.
summary: The public notebook shows Zoora's summaries, not the raw page. Web-sourced notes are labeled.
date: 2026-11-10T01:33:00Z
image:
---
sha: b6fc6c3
title: Verify the old ledger chain before rewriting merchant hashes.
summary: If an older ledger row was tampered, the merchant-hash migration stops and tells the keeper.
date: 2026-11-10T01:33:20Z
image:
---
sha: 2e88e9e
title: Flag research wishes as influenced by the web.
summary: A wish that came from research is marked web-influenced, so approving it cannot spend.
date: 2026-11-10T01:33:36Z
image:
---
sha: 5aabf92
title: Only backfill merchants from known ledger notes.
summary: A sentence that merely says "at" is no longer treated as a merchant name.
date: 2026-11-10T01:34:09Z
image:
---
sha: 218b8fd
title: Keep the research budget when the clock moves backward.
summary: The query window follows the latest query, so setting the clock back does not open a new allowance.
date: 2026-11-10T01:34:09Z
image:
---
sha: 18999b6
title: Remember which guestbook lines already became ideas.
summary: The same visitor note, aside from case and spacing, does not open a second seed. A different line still can. The note does not spend.
date: 2026-11-10T01:49:00Z
image:
---
sha: 8de89fd
title: Prepare a 512MB always-on Fly.io config for the public world.
summary: fly.toml keeps one shared-cpu machine in Ashburn with a 1GB volume, public mode on, and spending off. The owner runs the deploy later. Nothing was deployed from this change.
date: 2026-11-10T01:42:00Z
image:
---
sha: 62e31e4
title: Let the public watch the build through a tunnel on the owner's computer.
summary: /build shows the shipped timeline and where Zoora is right now. Public mode locks the desk, hides money, and keeps spending off.
date: 2026-11-10T01:40:00Z
image:
