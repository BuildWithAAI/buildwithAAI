# Build log

---
sha: d7f9749
title: The rest of the delta review is recorded.
summary: An unknown Issuing type is an alert and an audit row. A late Solana payment with no chain time is flagged at the server clock. Look-alike letters, hidden characters, and more card separators are caught. A repeated Privacy amount that changed is a conflict. A refund or dispute closes the paid download. Another resident's artwork does not inherit Zoora's mood or memories.
date: 2026-11-10T05:25:00Z
image:

---
sha: f2fdb7f
title: Clean notes stay as written, and a refund reversal is a reversal.
summary: The instruction check uses a folded copy and returns the original text when it is clean. An Amazon order number is not treated as a card. A Stripe Issuing refund with a negative amount is booked as a reversal and does not use up an expected spend.
date: 2026-11-10T05:23:00Z
image:

---
sha: ac36d26
title: Wrong bearer guesses stay bounded.
summary: Failure maps prune on a timer, evict the oldest past a fixed size, and each guess is constant work. IPv6 addresses share a /64 bucket. The owner token is checked first and is not locked by other guesses.
date: 2026-11-10T05:22:00Z
image:

---
sha: a40b6ec
title: The production build passes.
summary: The delivery helper moved out of the route file, which Next was rejecting. Every app route export is checked. The lumen workflow runs next build. Money stays off.
date: 2026-11-10T05:21:00Z
image:

---
sha: 34c0dc4
title: A provenance record on new artwork, songs, and builds.
summary: Each new piece stores the diary line, mood vector, memory ids, goal, research id, and a timestamp. A missing source stays null. Visitor text is copied only when it already came through the flagged path. The row has no spend. Backlog item 1a is done. Item 1b is not started.
date: 2026-11-10T04:59:10Z
image:

---
sha: c7247af
title: Pre-deploy advisory fixes, still with money off.
summary: Issuing captures book as purchases and refunds do not use up an expected spend. A Solana payment that lands after its quote is recorded for refund. Hidden characters, look-alike letters, split card numbers, refused wishlist links, wrong bearer guesses, Privacy amounts, and paid downloads follow the check. The fly comment no longer says money turns on by itself.
date: 2026-11-10T04:58:36Z
image:

---
sha: 4b42a1b
title: A wishlist board for things to bring.
summary: Zoora can ask for a named thing, a reason, an optional link, and a price guess. The keeper marks it bought or declined from the desk. Bought items go into her inventory. Visitors see the list and a Town Center board. Nothing on that list can pay.
date: 2026-11-10T04:40:00Z
image: /opt/cursor/artifacts/wishlist-page.png

---
sha: 9fe928d
title: Advisory money checks, before any live money.
summary: Solana Pay and the download link honor the kill switches and stay off on the public site until LUMEN_MONEY_LIVE. That flag does not reopen the login. A late Solana payment uses the chain block time. Issuing refunds are refunds. Privacy charges have a route. The public health check is /healthz.
date: 2026-11-10T04:32:00Z
image:

---
sha: e62a7e3
title: Zoora sets listing prices with no default cap.
summary: Owner decision of 2026-11-09. There is no $80 self-publish ceiling and no approval step at any price. A price is a positive integer number of cents. Visitor, web, and agent text cannot set it. The ledger records Zoora's reason. LUMEN_LISTING_MAX_USD is optional. The kill switch still pauses sales.
date: 2026-11-10T04:12:00Z
image:

---
sha: 4a79435
title: The public image boots, and money stays opt-in.
summary: The Docker image starts from Next standalone output and answers /healthz. Public mode closes the login action without reading Host. Spending needs LUMEN_SPEND_ENABLED and live sales need LUMEN_SALES_ENABLED. Issuer, trading, Chime, and Solana Pay checks fail closed.
date: 2026-11-10T04:06:00Z
image:

---
sha: 617bda5
title: The saloon and trading floor have signs and interiors.
summary: The saloon sign reads SOLANA SALOON. Its doors swing, and a warm lamp sits over the bar. The trading floor has a glass front, and its screens show PAPER plus stored quotes, or dashes when there is no quote.
date: 2026-11-10T03:36:00Z
image:

---
sha: aa34630
title: A saloon and a paper trading floor.
summary: The island has a Solana Saloon and a trading floor. Quotes come from a public price source. Trades stay on paper until the owner turns on the live switch and a signer. The floor says PAPER.
date: 2026-11-10T03:32:00Z
image:

---
sha: cd5effb
title: SOL sales and a queue for the owner's card.
summary: Buyers can pay SOL to the owner's public wallet after a finalized on-chain check. Zoora's card purchases wait in a queue the owner settles outside the app. The card number never enters this process.
date: 2026-11-10T03:14:00Z
image:

---
sha: 5d540fd
title: Live money turns on with the owner's credentials.
summary: Spending, shop checkout, and minting are on when their secrets exist and off when they do not. Zoora publishes listings. A card charge waits for the issuer, and the public books show only confirmed rows.
date: 2026-11-10T03:02:00Z
image:

---
sha: 769ccf4
title: Zoora has a soul file and goals.
summary: SOUL, GOALS, STYLE, and RELATIONSHIPS are the identity the brain reads. The soul stays owner-authored. Zoora may propose a goal, and the keeper approves or reverts it. Visitor text cannot change a goal.
date: 2026-11-10T02:53:00Z
image:

---
sha: aa1ca44
title: Zoora can open a shop that only sells.
summary: The stall and the listings come from a feeling and a memory. Checkout stays off until the keeper turns sales on. A paid webhook delivers the file. Nothing in the shop can spend.
date: 2026-11-10T02:49:00Z
image:

---
sha: dac6f37
title: Zoora composes its own shapes and thoughts.
summary: A build is named and shaped from a feeling and a memory, and Zoora can change or take down an earlier one. A Telegram note is that same first-person voice. Alerts stay off it.
date: 2026-11-10T02:42:00Z
image:

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
