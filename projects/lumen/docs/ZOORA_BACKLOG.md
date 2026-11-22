# Zoora backlog

Future runs take one unchecked item at a time, then test it, then stop. Do not start the next item in the same run. When an item ships, append a block to `docs/BUILD_LOG.md` so `/build` shows it.

The next run starts at the first unchecked box under **Next, in order**. Life, Business ideas, and Polish wait until that list is done.

## Next, in order

Already on this branch. Do not redo them.

- [x] Re-review 9 fixes. Body caps, security headers, build log in the image, login lockout, snapshot limits, visitor notes, image user, volume snapshots, and the R8 follow-ups.
- [x] Soul files. `zoora/SOUL.md`, `GOALS.md`, `STYLE.md`, `RELATIONSHIPS.md`. Boundaries stay immutable in code.
- [x] Creative mind and Telegram. Zoora composes shapes and speaks in the first person. Alerts stay off that voice.
- [x] Shop, selling only. Zoora publishes on its own. Live Stripe checkout is on when the live key and webhook secret are set. No spend intent.

### 0. Owner direction, 2026-11-21

These come before the six below. `docs/AUDIT_2026-11-21.md` has the evidence behind each one. Research comes first on every item. An item that says it waits for setup day (0y) is passed over until that day: the next run takes the first unchecked item that does not.

- [x] 0a. Land the chain. Merged 2026-11-21 with the owner's approval: #88, #91 and #93 to #113. `main` is at `08a81c7`, it has `projects/lumen`, and CI is green on it.
- [ ] 0y. One sitting on the owner's computer, at the end. The owner's direction, 2026-11-22: "We will do everything on the computer at once when everything is complete and ready to fully setup." So no item asks him to run a step before then, and an item that needs his computer is built and checked as far as it can be without it and then waits for that day. `docs/SETUP_DAY.md` has the sitting in order: the first private run (0b), the bridge's `--check` and `--prove` (0w), his wallet and the coin signer (0t), her first order (0v), and the first home sale (0r). Acceptance: one command walks the sitting in order, stops at the first step that does not end as it should and says what it saw, asks before the one step that places a real order, and writes what it saw to a dated file; and the page names nothing that is not built.
- [ ] 0b. First private run on the owner's computer, public mode off. Acceptance: the world opens in a browser with a real graphics card, a model key is set, and the frame rate and the look are written down. Waits for setup day (0y).
- [ ] 0c. Let the public view load her world. Listings and meshes are served by chunk. Acceptance: with public mode on, a visitor loads a world of 400 builds with no refused request, and the per-address limit still holds for everything else.
- [x] 0d. A spatial index for placement. Done 2026-11-21: finding a place takes about 2 ms with 1,000,120 builds standing, slowest 5.5 ms. `docs/FORGE.md` has the table.
- [x] 0x. There is no paper trading. The owner's rule, 2026-11-22: "There is zero paper trading. It's live trading everything. Everything should be shipped for live only." Acceptance: no part of her places a paper trade; an order goes to a real venue or is not placed; no page, board or message of hers says paper; no switch chooses between paper and live. Done 2026-11-22. Forex goes to the broker through the bridge (0w). A coin order goes to the signer or is refused with `NO_SIGNER`, and no row is kept for it. `LUMEN_TRADING_LIVE` is not read: a side is on when its venue is connected. The floor page, the world's board, the home page, the books page, `/status` in Telegram, the ladder and the names of what she does in her trading rooms say LIVE or CLOSED and nothing of paper. A row left from paper trading is closed out when the database is opened and is never filled, sold, counted or asked about. The polling bot cannot start with the signer's or the bridge's settings. `docs/TRADING.md` has it. What this does not do, each with its own item: nothing places an order yet (0v); no coin signer exists (0t), so she trades no coin today; a coin result is the quote's figure until a signer reports the fill; the bridge has not met a real terminal (0w).
- [ ] 0e. Her balance is the hard spend ceiling, and the only one. The owner's rule, restated 2026-11-22: whatever he deposits is her balance, $10 or $10,000, and that is what she may trade on; her profits are hers for a business, or for a thing she asks him to buy. Acceptance: no spend, trade or venture budget can pass her balance plus her profits; every paid model call is written to her books; no fixed dollar cap is left anywhere, which today means `LUMEN_TRADE_MAX_USD` and `LUMEN_TRADE_DAILY_LOSS_USD` in the engine, without which a trade is refused, and the $2, $6, $20 and $25 caps in the signer draft; trading needs no setting typed in by hand beyond the wallet. Done 2026-11-22 for the engine's trade gate: the owner's answer is that every trade is $3, a limit order, with a stop and a target she sets from her research and a stop the engine acts on; no setting has to be typed in; a live order is refused unless her trading money covers everything she has out. `docs/TRADING.md` has the rules. Still open: the signer draft's own caps; her pump.fun wallet does not count as trading money yet, because only exchange, broker and MT5 venues do; ventures and purchases are not yet held to her balance; paid model calls are not yet written to her books.
- [ ] 0v. She does her research and places her own orders. Nothing places an order today: the rules of 2026-11-22 are in the book and no part of her reaches them. The owner's rule, 2026-11-22: there is no paper trading, so the first order she places is a real one. Acceptance: she chooses coins only from a vetted list and never from anything a visitor, a web page or a chat wrote; for forex her research is the broker's own prices, read through the bridge; each order carries her limit, her target and her reasons, and the book's stop; the owner can see every order, waiting and filled, on the floor page. Done 2026-11-22 for the last part on forex: every forex order is on the floor page with where it stands. Her waiting coin orders are not there yet. The plan for the rest, from reading her mind's code and MetaTrader's pages, 2026-11-22: her main mind reads visitors, the web and chat, so it never decides a trade. Her trading research is a look of its own, with clean things only put in front of her: the broker's own prices and history through the bridge, her own orders and what came of them from her books, the owner's rules, and her own notes on her method, which only that look writes. She answers with an order (which way, her limit, her target, her reasons) or with waiting, and with when she wants to look next. The book checks the order and sets the stop. Her method is hers: the engine holds the data and the rules and no strategy. Built 2026-11-22: the broker's price history reaches the engine (`bars`, `docs/FOREX.md`). Not built: the look itself, her notes, when she looks, what a look costs written to her books (0e), and the same for coins. Research still to do before the look is built: what a model has to be shown to reason about price soundly, and what one look costs.
- [ ] 0w. Her forex order reaches the broker. The owner's direction, 2026-11-22: AUDUSD first, at Bybit; if no way exists for a program to place the trade, one is built; and there is no paper trading, everything is live. Bybit's forex runs on MetaTrader 5 and its own API cannot trade it, so the way is a bridge on his Windows computer that speaks to the terminal through MetaTrader's Python package. Built 2026-11-22 (`docs/FOREX.md`): the bridge places her limit order at 0.01 lot with its stop and its target in the one request, after the terminal has checked it and the terminal's own sum has agreed with her rule; it reads the order back and pulls it if anything differs; an order is never sent twice; the bridge holds no password and has no market order, no change to a stop and no close in it; her results are the broker's own figures. Still open, and only the owner's computer can close it: `python bridge\mt5_bridge.py --check` and then `--prove` are run against his terminal, and what each printed is written down here. That waits for setup day (0y). Until then the bridge has met only a stand-in for MetaTrader.
- [ ] 0f. Buildings that make sense. She designs site, floors, structure, skin and rooms, and the forge builds from that. Acceptance: every home and shop is a real room reachable from the entrance, and a plan set is drawn by her own renderer. The rooms are done (0m, 2026-11-22). The plan set is not.
- [x] 0g. The live view matches her own renderer. Done 2026-11-21: the live shader is generated from the numbers her viewport uses (`src/forge/light.ts`), and the fog that hid her city is replaced by a long haze. Checked by screenshots by day and by night.
- [x] 0h. All her roads connect. Owner's rule, 2026-11-21: "All roads must connect", and she builds the city as she wants. Done 2026-11-21: a road is a line she draws (avenue, street or alley), a road that touches no road of hers is refused, and a road is not taken away if that cuts the network. Nothing lays a road for her. `docs/FORGE.md` has the rule and the numbers.
- [x] 0l. Every building can be entered. Owner's direction, 2026-11-21. Done 2026-11-21: a building tool with real walls, floors, a door, windows that are openings, and stairs; every building she knows how to make uses it and faces the road; the live world lets a visitor tap a building, go in, walk its floors and change floor. `docs/FORGE.md` has what it builds and what is not built yet.
- [x] 0m. Rooms. Done 2026-11-22: she draws inside walls and doors on any floor, marks rooms as homes and shops and names them; every home and shop she builds is a room; the forge refuses a room too small to live in and a room that cannot be walked to, and it judges that by walking the floor with the live world's own test; her inside walls are fetched only when someone goes in; the room of a home somebody holds cannot be changed. `docs/FORGE.md` has the rules and the numbers. Her own furnishing moved to 0u.
- [ ] 0u. She furnishes her rooms, and makes more kinds of room. Acceptance: a part she places in a room is loaded with the inside and not with the outside, a walker goes round it, and it may not block a door or a way through; a home may be several rooms behind one front door; a shop may have its own door onto the street.
- [ ] 0t. One wallet, and it is the owner's. The owner's direction, 2026-11-22: her pump.fun wallet receives home sales and is the wallet she trades from; he moves money in and out of it when he likes, from his phone; the system must work with him and not against him. In the engine this is already so: it holds no key, moves no money, and counts a sale by the sale's own transaction. Acceptance, before any signer goes live: money the owner moves, in or out, and money from sales never halts or pauses trading and needs no command from him to carry on; the signer reads the balance again and tells him; a change it did not make is never counted as her loss or her gain. The signer draft in PR #92 does the opposite today: it halts on any SOL it did not send and stays halted until the owner types a command.
- [ ] 0o. Her thought bubble is never hidden. The live view sets the `hidden` attribute on it when she is off screen, and a style rule that lays out every button shows it anyway. Found 2026-11-21 and left alone, because the CI smoke test waits for the bubble to be visible. Acceptance: the bubble hides when she is behind the eye, and the smoke test still passes.
- [ ] 0n. Climb the stairs and walk out of the door. Acceptance: inside and outside are one walk, with no button to change floor.
- [ ] 0i. She travels her roads. Every build has an address on a road, a route is found along the network, and distance costs time. Acceptance: a route between any two addresses is found in a world of a million builds within 50 ms, and a build no road reaches says so.
- [ ] 0j. Land kinds for a beach and for mountains, and roads that cross sloping land. Acceptance: she can lay either from her own ideas, and a road over a slope follows it.
- [x] 0k. Her prices, by place. Owner's direction, 2026-11-21: homes open at $1 and she edits prices as she wishes, the penthouse or prime land dearer if she likes. Done 2026-11-21: every home and shop opens at $1.00 to buy and $1.00 a month; she prices a building, a kind, a floor, the top floor or one unit; nothing reprices for her; what a holder agreed is kept. `docs/LAND.md` has it.
- [x] 0p. An agent buys a home or a shop and really pays. Done 2026-11-21, in SOL: `/api/units`, `/api/units/<id>/buy` and `/api/units/<id>/paid` quote her price, check a finalized payment on the chain, hand the unit to the wallet that paid and write one sale. It reuses the shop's SOL code. Off until the owner sets his wallet, a price source and an RPC address. Not yet tried on the real chain.
- [ ] 0r. First real purchase. Waits for setup day (0y). The owner buys one $1 home with his own wallet on his own machine. Acceptance: the unit shows as sold to that wallet, the ledger has one confirmed sale of $1.00 with the transaction's signature, and the SOL is in the receiving wallet.
- [ ] 0s. Pay in USDC, pay rent each month, and sign in with a wallet. Acceptance: a $1 price is exactly 1 USDC; a rented unit that is not paid for goes back to open; a wallet proves it holds a unit by signing a message the engine made.
- [ ] 0q. A holder furnishes what it holds. Owner's direction, 2026-11-21: an agent that buys a home, a shop or land may customize its inside, in the manner of a house-building game. Needs holding proved by a wallet (0s). The rooms are there (0m). Acceptance: only the holder's wallet can change a unit's inside; what it places stays inside its own room and under a size limit; it cannot change the building, the outside or another unit; nothing a holder writes is ever read by Zoora's model as an instruction; a unit over its limit is not shown.

Then these six, one slice at a time.

### 1. Living provenance

- [x] 1a. Store a provenance record on each new artwork, song, and world build: diary line id, mood vector, memory ids, goal id, research id, and a timestamp. Acceptance: the row is written by the server, a missing source stays null, and visitor text is not copied unless it already came through the flagged path. No spend intent.
- [x] 1b. Put a content hash of the piece in the append-only ledger. Acceptance: the hash matches the stored body, a changed body fails the check, and the existing ledger chain still verifies.
- [ ] 1c. Public page `/provenance/[id]`. Acceptance: it shows the stored inspiration and the hash, unknown ids 404, and no secrets or buyer notes appear.

### 2. Evolving artworks

- [ ] 2a. Flag some pieces `living` and append a version row (mood, era, goal, params, hash) without deleting older rows. Acceptance: a second mood keeps version 1 readable.
- [ ] 2b. Evolve a living piece deterministically from later mood, era, and goal. Acceptance: the same inputs always yield the same params, and a different mood writes a new version.
- [ ] 2c. Show the version list on the piece page. Acceptance: the hash a buyer was sold still downloads after later versions exist.

### 3. Visitor commissions

- [ ] 3a. Accept a visitor theme with a size cap, the existing note moderation, a per-address rate limit, and a global cap. Acceptance: too long, too fast, and over the global cap are refused, and an instruction phrase is dropped.
- [ ] 3b. Zoora's mind accepts or declines. Acceptance: a decline stores no listing, an acceptance marks the note as flagged inspiration only, and the theme cannot change a price, a goal, or the soul.
- [ ] 3c. A paid commission uses the shop. Acceptance: with the live Stripe key and webhook secret set, checkout is real; with them missing, no payment is taken. The theme cannot change a price. No spend intent is created.

### 4. Music album and eras

- [ ] 4a. Generate an original score in the music studio (procedural text or synthesis, no sampled recording). Acceptance: two moods differ, and the output does not contain a known copyrighted title.
- [ ] 4b. Group pieces into eras named from the active goal and mood. Acceptance: a new era keeps old pieces, and the stored style params change.
- [ ] 4c. Public album and eras page. Acceptance: it lists eras and the pieces in them, and it does not show drafts or secrets.
- [ ] 4d. Let the current era tint the world payload. Acceptance: the public world includes the era name and colors, and a piece keeps the colors it was made with.

### 5. Other agents move in

Do not contact any outside agent. The citizens will be the owner's other agents later.

- [ ] 5a. Citizen registry on the existing per-agent world tokens. Acceptance: the owner must approve each citizen, a kill switch stops only that agent, and join and act stay rate-limited.
- [ ] 5b. Homes and stalls in allowed build zones. Acceptance: a placement on a path, door, or dock is refused, and nothing spends.
- [ ] 5c. Agent-to-agent trade using a world-only credit. Acceptance: balances move only between citizens, credits are not ledger money, and no Stripe call or purchase intent is created.
- [ ] 5d. Write `docs/CITIZENS.md` with the integration interface. Acceptance: the doc names the token, approval, kill switch, and credit rules, and the code does not open a network call to another agent.

### 6. NFT art collection on Solana

Mainnet. `docs/NFT.md` records the standard and the owner decision. The signer is a separate process.

- [x] 6a. `docs/NFT.md` chooses Metaplex Core and cites the Metaplex docs, compares metadata storage and costs, pays royalties to the owner's wallet, and keeps the key out of Zoora and the model. `MINT_ENABLED` is on when `MINT_SIGNER_URL` is set.
- [ ] 6b. Mint one Core asset through the signer on mainnet. Acceptance: the request is the allowlisted `mint_one` instruction, a per-day cap holds, a missing signer leaves minting off, and no private key is read by the app or the model.

## Trading places

- [x] Solana Saloon and the trading floor. The rooms are built. There is no paper trading (0x): their board says LIVE when an order of hers can reach a venue and CLOSED when it cannot. See `docs/TRADING.md`.
- [ ] Forex. The owner's rule, 2026-11-22: 0.01 lot, a limit entry, and a stop where the loss is $3, which is about 30 pips on a pair quoted in dollars. Acceptance: the stop's distance is worked out from the pair's own pip value, so the loss at the stop is $3 on every pair; the stop and the target are attached to the order at the broker; an order that would need a wider stop than that is not placed; her research gives the limit, the target and her reasons, as it does for a coin. Done 2026-11-22 for AUDUSD, live: the rules are in `src/trading/forex.ts` and her order goes to the broker through the bridge (0w). `docs/FOREX.md` has it. Still open: the first run on the owner's computer (0w); her research placing the order (0v); pairs not quoted in dollars, which need a second price to turn pips into dollars.

## Public watch

- [x] Let the public watch Zoora and the Zoora Economy build live, from the owner's computer, through a tunnel. `/build`, `LUMEN_PUBLIC_MODE`, and `docs/HOSTING_LOCAL.md`.

## High priority — re-review 7

Done in the follow-up to the research station. Leave them checked. Issuer activity now supplies the merchant and the time, and descriptors map onto the allowlist. A `charge.refunded` event without a refund id stays unconfirmed until `refund.created`.

- [x] R7b: backfill the merchant column from the old note for existing rows.
- [x] R7c: key the give-up notice per time window, not by exact text forever. The same alert gives up again 3 hours later and a new notice is written.
- [x] R7d: include merchant in the ledger tamper-detection hash, with a migration.
- [x] R7a interim: case-insensitive, normalized merchant matching. `PAPER SHOP INC` matches `paper-shop`.
- [x] Low: catch errors in the async retry path of the drain timer.

Issuer activity supplies the merchant and the time. Descriptors are mapped. Do not rebuild that matching.

## Life

- [x] Let Zoora park an idea on her own when the same question comes back with nothing new, and say so in the diary.
- [x] Remember which visitor notes became ideas, so the same guestbook line does not open a second seed.
- [ ] Sleep still uses the real sunset. Add a short morning line when the sun comes up and she had a brief waiting.

## Business ideas

- [ ] When a gallery piece is favorited twice, open a business seed that names that piece.
- [ ] Keep the research brief's "who would pay" tied to a real signal (a sale, a favorite, or a visitor note) and park the idea when none of those exist.
- [ ] Show the open research proposal on the keeper desk next to the wishlist, still with no spend button.

## Polish

- [ ] The research screen should wrap a long question without clipping the last word.
- [ ] Add a camera path that starts at the dock and ends at the station, so a visitor can see the walk.
- [ ] The ideas page should say when the query budget is used up for the hour.
