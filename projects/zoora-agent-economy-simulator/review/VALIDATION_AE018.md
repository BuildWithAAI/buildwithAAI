# AE-018: validation and measured policy limits

October 15, 2026. The worktree is based on AE-017 commit `daa0b82d31c7206c5add11f6902f80abd1e433a1`, tree `17e1ab64962dd7b45906927e369d80aeeddae953`. That base contains the preceding milestone, not AE-018. The retained [local evidence](evidence/ae-018-local.json) identifies its actual parent and dirty development tree. The development PR records the exact published source/tree and final Linux/Windows workflow results. This milestone is draft development, with no merge or deployment.

## What was tested

Thirteen controlled scenarios each use three policies: `AGENT_ONLY`, `OWNER_COUNT` and `OWNER_RISK`. Each comparison receives the exact same original actions and configuration within its scenario. There are **312 distinct original action positions**, evaluated in 39 alternative histories (936 action evaluations). Clock/delegation recording yields 1,850 canonical inner recovery actions. The independent auditor checks 15,112 agent-state snapshots and 4,983 owner-state snapshots, including final states. Across the alternative histories it records 115 simulated agreements and 22 owner-gate refusals. Those totals are not live activity, independent user trials or an estimated success rate.

The normal and optimized Rust suites each pass 255 tests, including 27 new ownership regressions. The new actual-CLI acceptance script passes 91 checks; normal and optimized reports match byte-for-byte. The retained local evidence records these checks, formatting, strict all-target Clippy and prior acceptance scripts separately. Published-source CI runs both test profiles, all prior CLI scripts, the new owner script, existing Chrome integration and dependency auditing. Local source-parent labels must not be mistaken for the final published commit's results.

Native replay regenerates allowed and refused actions and each original owner gate. The independent Python audit reconstructs applied inner work/case/payment history, profile arithmetic, every owner state, full notional reservations, lead-only payment attribution, prior-prefix admission decisions and exact clock/delegation indices. Both reject deliberately rehashed reservation, capacity, payment, hold, policy and linkage forgeries. CLI checks also cover matched campaigns, exports, new-file output guards, invalid caps, time travel, bounded input, valid-but-incompatible demo settings and refusal of Python `-O`.

## Retained reports

Campaign fingerprint: `3a86e0ff3aa16bd77f4381c22d02017d7ce57ca5ba8b877c93aa8f3b3c2d3459`.

| Export | Bytes | SHA-256 |
| --- | ---: | --- |
| Full campaign JSON, retained compressed | 24,072,547 | `6884dd31a377edfc2f7c8f3eda7772711697ed5e9115874b1bde80a166635310` |
| `examples/owner-campaign.json.gz` | 648,354 | `04c7b787411a9d21afc756b028dab5a055e774ba140289c68f6fc93ce6462314` |
| `examples/owner-campaign.csv` | 47,716 | `c89275711be42ce6b7671d1dec8dc67de1317fbbca4152fcf29a0aaebe732af1` |

The archive contains all 39 full inputs, original decisions, owner snapshots, canonical recovery journals, review events and payment histories. CSV contains 201 final owner/run rows; `run_` totals repeat on each owner's row. Assignment exposure may also appear under multiple owners. Neither column family should be summed across owners as money. Large amounts remain exact decimal digits; import them as text into software that otherwise rounds integers above 2^53.

The prior standalone AE-016 fingerprint remains `f5bdab1d42c6663fe1bb8b989e99cac8385022a35a9d90e8cde3e9f4e3c08c68`; AE-017 remains `85a846c501f22791e8d299684b7877ba3f6ced09959361f1a429a3b0058d61da`. Dedicated Rust regressions pin both, and earlier CLI acceptance remains part of final-source CI. AE-018's nested recovery reports also pass standalone AE-017 CLI replay, without owner context.

## Measured outcomes

All amounts below are atomic `SYNTHETIC_UNIT` fixture units. Reference payment budgets are 100/300/1,000 and work capacities are 1/2/4. These are not adopted economics.

| Scenario | Observed result |
| --- | --- |
| Declared wallet rotation | Three same-owner openings under agent-only checks become one admitted opening under both owner policies |
| One large obligation | Count-only admits a 101-unit contract; the starter 100-unit payment budget refuses it before payment |
| Earned owner capacity | Tier 1 gives two shared open slots, rather than summing limits across agents; an extra opening is refused |
| Unpaid expiry and retry | An unpaid 100-unit commitment reserves the full amount; expiry frees it before a same-tick retry, and the refusal did not consume consent |
| Partial and full return | A 30-unit return leaves a 100-unit reservation with 70 observed net units; the remaining actual return frees admission without earning work credit |
| Late receipt | A valid payment on an expired unpaid job is recorded after another job opens; both paid jobs remain visible, exposing count/payment overages and a hold; zero automatic returns |
| Owner dispute hold | A peer's new group creation is refused under owner risk; accepted review and maturity later restore admission |
| Group under one owner | The job reserves capacity once; exact 60.6/40.4 work credits remain, while the payment receipt still names only the lead |
| Group across owners | Full assignment exposure is charged to each owner. Two paid contracts produce 300 aggregate assigned-exposure units but only 200 actual paid units; the non-lead gets no invented payout |
| Owner downgrade | The current limit falls to one while four existing paid agreements remain; 900 lifetime net units, including 500 from earlier completed jobs, remain recorded and no return is created |
| Unverified alias | A reviewed owner's Tier 1 limit does not give its unverified agent Tier 1 or a second individual work slot |
| Exact large totals | Count-only records `36893488147419103430` paid units; payment budgeting admits one fewer u64-maximum promise and records `18446744073709551815`; both remain exact |
| Hidden common control | Assigning different labels to the same conceptual owner still permits three openings under owner risk: this explicitly demonstrates the missing verification |

These fixed traces show policy mechanisms and counterexamples. They do not demonstrate statistically representative throughput, economic stability, adversarial safety or real ownership independence. Any acceptance-script duration is one test sample, not live performance.

## Practical boundary and next work

The owner adapter has no network or signer. It gates new commitments and does not force returns, seize funds or erase valid incoming receipts. Partial returns, reviews and downgrades do not move money. Conservative full charges for different collective owners can deny otherwise useful work and need further policy research. Peer holds can spread complaint-griefing harm across a declared owner's agents.

Real identity/ownership and reviewer verification, reliable useful-work assessment, mediation/reopening, evidence storage/access, scope-budget repair, aggregate owner membership policy, service/scheduler integration, group payouts, governance and public operations remain open. No AAI fee/burn/lock/liquidity rule, trade execution, public launch or native-chain/validator change is added. Passing tests and dated dependency checks are not a security certification. See [method](AE018.md) and [community draft](../../../docs/community/AE018_COMMUNITY_UPDATE.md).
