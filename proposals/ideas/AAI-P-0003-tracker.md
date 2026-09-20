# AAI-P-0003: GitHub development tracker

| Field | Value |
| --- | --- |
| Author | Founder idea, organized into a draft for discussion |
| Date | September 20, 2026 |
| Work status | IDEA |
| Commitment category | IDEA |
| Maintainer | Unassigned; no implementation owner has accepted |
| Estimated complexity | Small to moderate; begin with a static view before notifications. |
| Token impact | No token behavior change approved; protected changes need separate review |
| Related tasks | AAI-T-009, AAI-T-017 in [BACKLOG.md](../../tasks/BACKLOG.md) |

## Problem and benefit

Community members need evidence of what is being built and which tasks welcome help.

## Proposed solution

Propose a read-only view of milestones, issues, PRs, releases, contributors, recently completed tasks and upcoming work. Optional opt-in feeds can follow later.

## Technical requirements and dependencies

Public GitHub metadata, task-status mapping, cache/rate-limit rules and a published contribution process.

## Risks and security considerations

Private repository leakage, spam, API failures and confusing a merged PR with a live deployment.

## Acceptance criteria for the proposal

- Map statuses to visible evidence and distinguish code merges from service releases.
- Use public data only and document empty/error states.
- Specify contributor attribution without equating commits, token holdings or trading volume with authority.

## Community feedback

Not collected in this draft. Link the discussion and preserve objections and alternatives when available.

## Decision

Pending. This is an idea record, not implementation, funding, launch or deployment approval. Any substantive architecture change must be shown to the owner first. The future blockchain name is undecided between Zoora Blockchain and AAI Blockchain; this Solana experiment creates no rights to that future network or its native currency.
