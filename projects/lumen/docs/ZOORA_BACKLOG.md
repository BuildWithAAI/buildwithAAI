# Zoora backlog

Future runs take one unchecked item at a time, then test it, then stop. Do not start the next item in the same run. When an item ships, append a block to `docs/BUILD_LOG.md` so `/build` shows it.

The next run starts at the first unchecked box under **Next, in order**. Life, Business ideas, and Polish wait until that list is done.

## Next, in order

Already on this branch. Do not redo them.

- [x] Re-review 9 fixes. Body caps, security headers, build log in the image, login lockout, snapshot limits, visitor notes, image user, volume snapshots, and the R8 follow-ups.
- [x] Soul files. `zoora/SOUL.md`, `GOALS.md`, `STYLE.md`, `RELATIONSHIPS.md`. Boundaries stay immutable in code.
- [x] Creative mind and Telegram. Zoora composes shapes and speaks in the first person. Alerts stay off that voice.
- [x] Shop, selling only. Zoora publishes on its own. Live Stripe checkout is on when the live key and webhook secret are set. No spend intent.

Then these six, one slice at a time.

### 1. Living provenance

- [ ] 1a. Store a provenance record on each new artwork, song, and world build: diary line id, mood vector, memory ids, goal id, research id, and a timestamp. Acceptance: the row is written by the server, a missing source stays null, and visitor text is not copied unless it already came through the flagged path. No spend intent.
- [ ] 1b. Put a content hash of the piece in the append-only ledger. Acceptance: the hash matches the stored body, a changed body fails the check, and the existing ledger chain still verifies.
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
