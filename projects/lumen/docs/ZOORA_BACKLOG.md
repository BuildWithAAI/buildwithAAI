# Zoora backlog

Future runs take one unchecked item at a time, then test it, then stop. Do not start the next item in the same run. When an item ships, append a block to `docs/BUILD_LOG.md` so `/build` shows it.

## Public watch

- [x] Let the public watch Zoora and the Zoora Economy build live, from the owner's computer, through a tunnel. `/build`, `LUMEN_PUBLIC_MODE`, and `docs/HOSTING_LOCAL.md`.

## High priority — re-review 7

Done in the follow-up to the research station. Leave them checked. The full R7a fix is still open under blocker 4.

- [x] R7b: backfill the merchant column from the old note for existing rows.
- [x] R7c: key the give-up notice per time window, not by exact text forever. The same alert gives up again 3 hours later and a new notice is written.
- [x] R7d: include merchant in the ledger tamper-detection hash, with a migration.
- [x] R7a interim: case-insensitive, normalized merchant matching. `PAPER SHOP INC` matches `paper-shop`.
- [x] Low: catch errors in the async retry path of the drain timer.

The full R7a fix stays with blocker 4. Issuer activity still has to supply the merchant and the time, and descriptors still have to be mapped. Do not build that here.

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
