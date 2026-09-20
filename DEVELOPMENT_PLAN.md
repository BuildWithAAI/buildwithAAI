# GitHub development plan — review edition

**Future blockchain name: UNDECIDED — Zoora Blockchain or AAI Blockchain.** Build With AAI is the existing community brand. This plan does not select the chain name, the official token launch name/ticker, or any token economics.

**PROPOSED documentation and workflow revision, September 20, 2026.** Review this draft before merging or activating repository settings. It preserves the Solana community experiment's separation from the future chain and its genesis-native currency.

## The 17 requested deliverables

| # | Deliverable | Prepared location |
| --- | --- | --- |
| 1 | Recommended repository structure | Structure table below |
| 2 | README draft | [README.md](README.md) |
| 3 | Contribution guide | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 4 | Project disclaimer | [DISCLAIMER.md](DISCLAIMER.md) |
| 5 | Honest phase roadmap | [ROADMAP.md](ROADMAP.md) |
| 6 | Security policy and activation plan | [SECURITY.md](SECURITY.md) |
| 7 | Proposal system | [Process](proposals/README.md), [template](proposals/template.md), six seeded idea briefs |
| 8 | Issue structure | [Issue process](docs/community/ISSUES.md) and eight issue templates |
| 9 | PR process | [Review process](docs/community/PULL_REQUESTS.md), PR template, proposed CODEOWNERS |
| 10 | Development-status system | [Status definitions](docs/community/STATUS.md) and [label definitions](.github/labels.json) |
| 11 | Initial project board | [Repository board](docs/community/PROJECT_BOARD.md), plus native-board setup specification |
| 12 | First 25 tasks | [Issue-ready backlog](tasks/BACKLOG.md) and [task data](tasks/backlog.json) |
| 13 | Contribution workflow | [CONTRIBUTING.md](CONTRIBUTING.md) and proposal lifecycle |
| 14 | Official-links security design | [OFFICIAL-LINKS.md](OFFICIAL-LINKS.md) |
| 15 | Token-information template | [TOKEN-INFO.md](docs/token/TOKEN-INFO.md) and [wallet register](docs/token/WALLETS.md) |
| 16 | Future-chain relationship | [Relationship document](docs/future-zoora-relationship.md) |
| 17 | APPROVED / IDEA / FUTURE / RESEARCH / NOT PROMISED | [Decision register](docs/DECISIONS.md) and [current status](docs/CURRENT_STATUS.md) |

## Recommended structure

Use the existing public repository. Keep the private scanner in its current repository until separately approved for wider access. Create application folders only when there is actual code or an accepted design to put in them.

| Path | Content now | Why |
| --- | --- | --- |
| Root Markdown files | Overview, plan, roadmap, rules, licensing status, official links | New visitors can orient themselves immediately |
| `docs/` | Current facts, decisions, vision, FAQ, future relationship | Keeps claims and decisions traceable |
| `docs/architecture/` | Scope and security boundaries | Prevents accidental coupling to the future chain |
| `docs/token/` | Canonical token record and wallet-register template | One place for verified token facts |
| `docs/community/` | Status, issues, reviews, governance, board, bounty plan | Makes contribution and authority clear |
| `projects/` | Existing briefs plus community-tool catalogue | Preserves prior work and explains new ideas |
| `proposals/` | Process, template, and six IDEA briefs | Gives discussion a repeatable format |
| `tasks/` | 25 tasks and the earlier starter-task crosswalk | Makes work reviewable and discoverable |
| `research/` | Existing launch-study protocol | Retains the research-first approach |
| `.github/` | Templates, label specification, proposed ownership rules | Prepares GitHub workflow without pretending settings are active |

Later, create `apps/website`, `apps/telegram-bot`, `apps/discord-bot`, `apps/dashboard`, or `apps/experiments` only for approved implementations. Introduce `packages/solana`, `packages/analytics`, and `packages/shared` only when code is actually shared. Create `community/memes`, `community/branding`, `community/assets`, and `community/campaigns` when approved assets and usage terms exist. Research subfolders and approved/rejected/deferred proposal folders grow as records exist; no empty scaffolding is needed now.

## Proposed organizational choices for your review

| Choice | Why | Effect |
| --- | --- | --- |
| Use “future blockchain” as the neutral term | Zoora vs AAI branding is undecided | Documentation wording only |
| Preserve this repo and private scanner separately | Avoid duplicating the existing implementation or publishing private code | No repository move or visibility change |
| Keep exact token identity in one file | Prevent inconsistent mint copies | Official links point to the token record |
| Separate work status from commitments | APPROVED must not look like RELEASED | Clear status fields and decision evidence |
| Start with a repository board and issue-ready bodies | You requested a plan before substantive activation | No live board, labels, or bulk issues created in this draft |
| Route sensitive security concerns privately | Public issue templates must not solicit exploits or credentials | Reporting setup remains a tracked prerequisite |

These are organizational proposals, not a new chain architecture. No bridge, custody system, governance contract, allocation, token launch, monetary change, or signing flow is added.

## Activation after review

First review the README and [decision register](docs/DECISIONS.md). Resolve the process choices above; leaving the chain name undecided is valid. Then merge the approved documentation. Separately configure labels, private reporting, review protections, and optional Discussions/Projects; verify each setting before describing it as enforced. Open the chosen tasks as issues with their original IDs and actual GitHub URLs. Discuss one useful implementation next; paid hosting remains paused.

Native GitHub Projects, Discussions activation, and protection settings are not created merely by committing these files. [Current delivery record](docs/VALIDATION.md).
