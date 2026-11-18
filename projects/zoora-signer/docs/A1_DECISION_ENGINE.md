# A1 decision engine (spec only)

This file is the spec for a later pull request stacked on Lumen. It is not implemented in Lumen. The signer does not import Lumen.

Lumen lives at `projects/lumen/src/trade/` when that tree exists. The path is covered by the same no-visitor-input sink test as the rest of Lumen.

## Candidates

Candidates come only from the Solana Research & Risk vetting feed: mints that already passed `vet(mint)`, plus Zoora's watchlist built from that feed. Never from visitor, guestbook, web, or chat text, and never from a mint string in free text.

## Pick

Zoora picks from those candidates and writes a one-line public rationale for the log and the HUD. The size is fixed at $2.00 all-in. She does not choose the size.

## Exits

Stake recovery comes first. Once a position's sell value is at least 2 times cost, sell enough to recover cost plus fees. The rest is a moon bag, which she may keep or close. A time stop (default 6 hours with no recovery) and a hard stop (mark at or below 50 percent of cost) are defaults. Only the owner can change them, and only inside owner-set bounds.

The signer repeats the rate limit: at most 4 intents an hour. Lumen also limits itself to 1 buy intent per 10 minutes and 4 per hour. The signer's 10 buys per Chicago day and the other caps still apply.

## Kill

While the signer is halted, Lumen must not send sells. Automated stops and time-stops do not fire. Only an owner CLI SELL releases a position. The signer enforces that even if an intent arrives.

## Intent lifetime

An intent lives 90 seconds. The signer re-vets when the verdict is older than 15 seconds. If the feed is unreachable, there are no new buys and open positions are held.
