# AE-012 validation and measured findings

**Verified source:** [`73ae81f638c16f388639ef58a3937f1b2065f345`](https://github.com/BuildWithAAI/buildwithAAI/commit/73ae81f638c16f388639ef58a3937f1b2065f345), stacked on AE-011 in [draft PR #28](https://github.com/BuildWithAAI/buildwithAAI/pull/28). All **nine source CI jobs pass**: [foundation run 38649185156](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38649185156), [market run 38649185257](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38649185257), and [review/campaign run 38649185271](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38649185271). Actual checkout hashes were checked in all nine job logs. All nine evidence archives were downloaded and SHA-256 verified against the artifact metadata; their source heads match. [Machine-readable evidence](evidence/ae-012-2026-10-14.json).

This is verified offline research software in a draft, unmerged development candidate. Public deployment, real economic output and live AAI economics are outside this milestone.

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
- Local normal and optimized suites each pass all 122 tests, including 14 new economy tests. Formatting and Clippy with warnings denied pass.
- All **320 full journals** were subsequently retained by the coordinator and independently reconstructed in Python: every entry matches a direct receipt, balances remain nonnegative, fee routes and exposure totals reconcile, and full-run metrics/fingerprints match the two campaign summaries. This supplements the CI acceptance sample.
- The actual CLI acceptance script has passed 30 checks: both complete campaigns, independent campaign hashes, all row stock/fee reconciliations, 16 independently reconstructed full journals, debug/release byte equality for two full transcripts, forged-hash rejection, CSV/report exports, checkpoint pause/resume, cache preservation, corrupt-cache/config rejection and output bounds/overwrite refusal.
- Published-source Linux and Windows each pass all **122 tests per normal/optimized profile**, formatting, Clippy with warnings denied, the 30 new CLI acceptance checks and the pre-existing review/allocation/community acceptance suites. The foundation suites pass 44 tests on Linux and 43 on Windows per profile (one Unix-specific test is not built on Windows); the task market passes 31 per platform/profile.
- The three dependency audits report no known vulnerabilities and no warnings at this run. This is not a complete security certification.
- Chrome 154 passes **11 new economy viewer conditions**, in addition to the existing 11 review and 13 community conditions. New checks cover comparisons, filters, paired delta, run selection, stocks/round tables/timeline, 390px page fit, hostile text, blocked connections, full-u64 precision and invalid-conservation error state. Desktop and mobile screenshots were visually reviewed. These checks do not establish actual iPhone/Safari acceptance.
- Both platforms produce byte-identical reference/sensitivity JSON, CSV and HTML, and all six files match the retained local full-journal campaigns. Full campaigns contain 320 unique configurations; the CLI and replay verify them without treating replays as new independent observations.

The complete-journal Python checkpoint runner is available for retaining larger campaigns. Campaign summaries can reproduce every full run from the stored config/seed/scenario/policy, but a summary is not a substitute for retaining original external observations when a future real adapter is introduced. Current observations are deliberately synthetic.
