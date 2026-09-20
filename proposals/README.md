# Proposal system

This proposed process makes community ideas reviewable without making them official features. Start with an issue using the Community idea template, or copy [template.md](template.md) into a draft PR. Issue discussion works even while GitHub Discussions is disabled.

## Records and identifiers

Use sequential proposal IDs `AAI-P-0001`, `AAI-P-0002`, and so on. Maintainers allocate the next available ID when accepting a record; draft contributors can leave the ID unassigned to avoid collisions. IDs are not GitHub issue numbers. Keep one authoritative record per proposal and link its discussion, task and implementation PRs.

The six records below are founder-supplied **IDEAS**, prepared for discussion on September 20, 2026. They have no accepting maintainer, implementation approval, funding or delivery date. They do not replace the existing private scanner's development history.

| ID | Idea | Status | Commitment |
| --- | --- | --- | --- |
| AAI-P-0001 | [Telegram community bot](ideas/AAI-P-0001-telegram.md) | IDEA | IDEA |
| AAI-P-0002 | [Community dashboard](ideas/AAI-P-0002-dashboard.md) | IDEA | IDEA |
| AAI-P-0003 | [GitHub development tracker](ideas/AAI-P-0003-tracker.md) | IDEA | IDEA |
| AAI-P-0004 | [Meme and media tools](ideas/AAI-P-0004-media.md) | IDEA | IDEA |
| AAI-P-0005 | [Wallet and on-chain experiments](ideas/AAI-P-0005-wallets.md) | IDEA | IDEA |
| AAI-P-0006 | [Development bounties](ideas/AAI-P-0006-bounties.md) | IDEA | FUTURE |

## Review and lifecycle

Follow [STATUS.md](../docs/community/STATUS.md). Record scope, benefit, technical requirements, risks, security, dependencies, complexity, willing maintainer, feedback and decision. Identify whether the proposal affects only community tooling or token/economic behavior. Document alternative approaches and the smallest useful output.

An approval record needs the deciding maintainer, date, exact accepted scope, conditions and evidence. Protected changes additionally need explicit owner approval and additional review. Rejected/deferred records retain reasoning and conditions for reconsideration. Move decided records to `approved/`, `rejected/` or `deferred/` only when such records exist; update references in the same PR. The record's status remains authoritative during development, testing and release. Do not create duplicate copies in multiple folders.

Any change to the architecture, future blockchain relationship, token economics or security boundaries must be presented to the owner before substantive implementation. The future blockchain name is undecided: Zoora Blockchain or AAI Blockchain. No proposal can imply migration, native-coin entitlement or governance rights without a separately reviewed future decision.
