# AE-012 validation and measured findings

Status: source candidate prepared on AE-011 head `28a54dd53458c503cda141471565ec6c2513992a`. Local development verification is recorded below. Exact published source/CI and final artifact review will be added after the draft source runs in CI. This is a synthetic offline software milestone, not a merged or deployed economy.

## Reproducible campaigns

| Campaign | Unique configurations | Fingerprint |
| --- | --- | --- |
| Zero-fee reference | 160 | `e2eb76c2865bb459a62a4ebb45d87cd4c53290efdba9449113496820e8d9227d` |
| Illustrative 1% fee sensitivity | 160 | `e3490e8c9981d7f6aa15032bad3eab7b98c5870457358cf75141a49151e8890d` |

Each campaign uses ten seeds × eight scenarios × two admission policies, with 12 rounds and 24 declared profiles per run. Together they contain 149,760 intended ordinary-work requests and 124,356 admitted, paid ordinary-work requests across experiment replicas. Replays are not counted as new experiments. No real money, AAI supply, wallets, trading or production network was involved. [Method and CLI](AE012.md).

## What the experiments expose

The table pools the ten reference seeds; each policy has the same intentions within a scenario. Acknowledgment is a scripted client action, not verified useful work.

| Reference scenario | Work intended per policy | Baseline work acknowledged | Operator-cap work acknowledged | Unpaid attacks admitted, baseline → cap |
| --- | --- | --- | --- | --- |
| Balanced | 4,320 | 2,616 | 2,616 | 0 → 0 |
| Shared-operator spam | 4,320 | 1,742 | 2,616 | 3,840 → 80 |
| Separate declared identities / Sybil spam | 4,320 | 1,742 | 2,534 | 3,840 → 480 |
| Provider outage | 4,320 | 2,155 | 2,155 | 0 → 0 |
| Demand surge | 7,200 | 3,870 | 3,870 | 0 → 0 |
| Budget squeeze | 4,320 | 611 | 611 | 0 → 0 |
| Refused returns | 4,320 | 1,742 | 1,742 | 0 → 0 |
| Digest without acknowledgment | 4,320 | 1,742 | 1,742 | 0 → 0 |

The shared-operator cap helps with unpaid reservation starvation under these identity and immediate-payment assumptions. It does not solve hidden common control: six declared attacker identities receive six times as many admitted reservations under the same cap (480 versus 80). Outages, failed work, digest-only activity and finite client budgets require different controls. The cap preserves baseline acknowledgments in the balanced fixture; that is not evidence it has no false-positive tradeoffs under delayed payments or different demand.

In the budget-squeeze fee sensitivity, ordinary acknowledgments fall from **611 to 591 per policy** and budget refusals rise from **3,286 to 3,321**. The illustrative fee consumes ten extra units per 1,000-unit payment. Each such payment routes five units to a modeled burn, two to the modeled liquidity budget and three to treasury after rounding. In the capped budget-squeeze sample, pooled replica counters record 4,995 burned units, 1,998 liquidity-budget units and 2,997 treasury units. These are totals across ten separate synthetic economies, not AAI supply changes or a real liquidity position. They show why fee receipts and burns alone do not establish stability.

## Verification scope

- Existing community schemas, foundation semantics, noncustodial direct transfers and prior pinned AE-005 example fingerprints are preserved.
- Local normal and optimized suites each pass all 122 tests, including 14 new economy tests. Formatting and Clippy with warnings denied pass. A transient local cached-object linker failure was resolved by the subsequent optimized rebuild; it is not recorded as a passing attempt.
- The actual CLI acceptance script has passed 30 checks: both complete campaigns, independent campaign hashes, all row stock/fee reconciliations, 16 independently reconstructed full journals, debug/release byte equality for two full transcripts, forged-hash rejection, CSV/report exports, checkpoint pause/resume, cache preservation, corrupt-cache/config rejection and output bounds/overwrite refusal.
- Source CI will run Linux/Windows normal and optimized checks, Clippy/formatting, dependency audit, historical CLI evidence, new campaign evidence and real Chrome viewer tests. Planned Chrome checks cover comparisons, filters, paired delta, run selection, stocks/round tables/timeline, 390px page fit, hostile text, blocked connections, full-u64 precision and invalid-conservation error state. They do not establish actual iPhone/Safari acceptance.

The complete-journal Python checkpoint runner is available for retaining larger campaigns. Campaign summaries can reproduce every full run from the stored config/seed/scenario/policy, but a summary is not a substitute for retaining original external observations when a future real adapter is introduced. Current observations are deliberately synthetic.
