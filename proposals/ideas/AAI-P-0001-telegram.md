# AAI-P-0001: Telegram community information bot

| Field | Value |
| --- | --- |
| Author | Founder idea, organized into a draft for discussion |
| Date | September 20, 2026 |
| Work status | IDEA |
| Commitment category | IDEA |
| Maintainer | Unassigned; no implementation owner has accepted |
| Estimated complexity | Moderate; provider access and moderation needs are unresolved. |
| Token impact | No token behavior change approved; protected changes need separate review |
| Related tasks | AAI-T-003, AAI-T-008, AAI-T-012, AAI-T-015 in [BACKLOG.md](../../tasks/BACKLOG.md) |

## Problem and benefit

Members need one consistent place to check official information and development updates.

## Proposed solution

Design a read-only command set for official links, token facts, sourced price/chart and holder observations, community help, and opt-in GitHub/proposal notices. Scam-link warnings can flag mismatches, not certify safety. Decide whether it complements the existing private scanner.

## Technical requirements and dependencies

Telegram permissions, a verified official-link record, defined data providers, update timing, rate limits and retention rules.

## Risks and security considerations

Stale facts, impersonation, provider outages, spam and overbroad group permissions. No seed phrases, keys, trading or automatic signatures.

## Acceptance criteria for the proposal

- Show sample conversations for valid, unknown and stale data.
- Separate the official-token record from arbitrary token scans and label sources/timestamps.
- Specify permissions, opt-in notifications and failure behavior without activating a bot.

## Community feedback

Not collected in this draft. Link the discussion and preserve objections and alternatives when available.

## Decision

Pending. This is an idea record, not implementation, funding, launch or deployment approval. Any substantive architecture change must be shown to the owner first. The future blockchain name is undecided between Zoora Blockchain and AAI Blockchain; this Solana experiment creates no rights to that future network or its native currency.
