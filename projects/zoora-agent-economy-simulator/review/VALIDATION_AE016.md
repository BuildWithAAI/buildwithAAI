# AE-016 — Local validation and measured policy behavior

October 15, 2026. Local worktree based on AE-015 commit `6e4c78cec795adab5ddcf4a4ee1061967bea1cd2`. This report describes pre-publication worktree checks, not a claim that the parent commit contains AE-016. Exact published-source head and CI results are recorded in the development pull request. No merge or deployment is part of this milestone.

## Software evidence

| Check | Result |
| --- | --- |
| Normal Rust suite | 199 tests pass, including 27 new trust tests |
| Optimized Rust suite | 199 tests pass, including all 27 new trust tests |
| Formatting and strict Clippy | Pass, all targets, warnings denied |
| Actual new CLI acceptance | 45 checks pass |
| Native replay and independent applied-history audit | All 15 full demonstration histories |
| Normal/optimized CLI output | Byte-identical complete campaign |
| Retained compressed reference | Decompressed bytes equal regenerated campaign |

An initial local parallel optimized compilation failed with Rust E0786 (invalid crate metadata). A package clean and single-job optimized build succeeded. Final test status above records the completed rerun, not the failed attempt. This is not a production throughput or security certification.

The reference contains **552 actions, 61 work agreements and 4,536 checked agent-state snapshots**, across 15 separate demonstrations with eight declared profiles each. It has **15 deliberately refused actions**. These are controlled policy examples, not independent real users or observed agent competence. `trust_evidence.py` checks both actual CLI modes and the Python audit, including rehashed false tiers, credit allocations, history and payment totals; incomplete/reordered matrices cannot replay or export. Unknown inputs, invalid timing, excessive arrays, past actions and overwrites are refused. Python `-O` cannot silently skip the independent audit.

Reference fingerprint: `f5bdab1d42c6663fe1bb8b989e99cac8385022a35a9d90e8cde3e9f4e3c08c68`.

Full retained evidence: [compressed campaign](examples/trust-campaign.json.gz), [per-agent CSV](examples/trust-campaign.csv), [local summary](evidence/ae-016-local.json). The archive contains **all** inputs, actions, profile snapshots and direct transcripts, not just totals. The same campaign and acceptance summary are uploaded by the Linux/Windows review CI jobs. Earlier versioned experiments remain unchanged and their prior checks remain in those jobs.

## Measured reference behavior

| Case | Result |
| --- | --- |
| Starter limits | One active work agreement; second refused. One membership per group category; extra creations refused. |
| Ten small jobs | 100 total credits; two customer operators; Tier 1. |
| One large job | The same 100 credits; one customer operator; Starter until diversity qualifies. |
| Balanced history | Two accepted 50-credit jobs unlock two slots; a third simultaneous agreement is refused. |
| Experience before review | Five 100-credit jobs retain Starter until review approval, then unlock four slots; a fifth is refused. |
| Root task splitting | Ten jobs consume the 100-unit budget; another unit is refused. |
| High payment volume | Two maximum-u64 receipt amounts produce two work credits; no higher tier. Amounts remain exact decimal strings. |
| Related customers | Self-dealing share earns zero; two customer wallets under one declared operator count once. |
| Collective credit | Two 101-credit jobs at 60/40 produce exactly 121.2 and 80.8 credits. Both workers consume a work slot; a peer cannot bypass it with a solo job. |
| Premature credit | Delivery without acceptance, then acceptance before maturity, are refused credit. |
| Later dispute | Affected usable credit drops from 100 to 50; tier returns to Starter and new work pauses. No refund is invented. |
| Voluntary return | Actual return observations remove affected credit and close fully returned exposure. |
| Review revocation | Existing four commitments remain; current tier falls to Starter and further work is refused. |
| Wallet rotation | Three declared agents under one operator each occupy one Starter slot. Per-agent limits do not solve owner-wide exposure. |
| Reused artifact | The second literal contribution reference cannot earn credit. |

The 27 Rust tests also cover joining versus creating memberships, leaving groups, every member's plan-bound consent, tiny fractional shares, partial/excess/duplicate receipts, wrong actors, review revocation for a customer, age gating, and malformed bounded inputs. Exact fractional credit prevents per-task rounding bonuses. These are experience counters with no monetary value; direct receipts still pay the lead and do not distribute collective compensation.

## Practical limits

Reviews, operator independence, payment observations and work acceptance are supplied fixtures. Digests do not assess artifact content or authenticate an agent. Literal-duplicate checks do not detect semantic duplicates. New related identities can bypass per-agent capacity; global experience alone is not a risk-specific reputation or exposure model. Tier history has no decay or separate per-category experience requirement in this stage.

Outstanding paid work keeps its slot after deadline. This model does not yet implement dispute resolution, appeals, malicious-complaint protection, project-budget repair, price/value exposure limits or independent reviewer operations. The current dispute pause is an experimental admission rule, not a determination of blame. False or fabricated fixture inputs can generate an internally consistent alternate history; replay hashes do not certify that it happened.

The adapter is not connected to the community service, real wallet proofs, an autonomous work evaluator, collective payouts or the AE-015 reservation scheduler. It maintains receipt records, not spendable balances. No real funds, signer, custody, forced return, fees, burns, locks, liquidity deposits, production hosting or native-chain/validator changes are introduced. No whole-project completion percentage is inferred.

[Method and reproduction](AE016.md) · [Community update](../../../docs/community/AE016_COMMUNITY_UPDATE.md).
