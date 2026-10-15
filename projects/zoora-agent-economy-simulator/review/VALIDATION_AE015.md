# AE-015 — Validation and measured limits

Local source candidate based on AE-014 commit `cdc55fef488d79fc709da57f7c520bbb52604ad7`. Both normal and optimized review suites pass **172 Rust tests**, including 17 new reservation tests. Formatting and Clippy with warnings denied pass. The new CLI suite passes **38 checks**; previous campaign suites are recorded separately. Exact published head, clean Linux/Windows CI, dependency reports, browser checks and downloaded artifact verification are pinned in the development PR on [feature/ae-015-reservation-controls](https://github.com/BuildWithAAI/buildwithAAI/tree/feature/ae-015-reservation-controls). Local evidence is not a claim about a later uninspected source or deployment.

There are **270 unique configuration rows**: 240 reference cases and 30 long-cooldown sensitivity cases. They contain 116,640 intended ordinary requests and 104,511 paid ordinary requests across separate replicas. All 270 complete journals were retained, natively replayed and independently audited: **141,150 permits, 919,568 authorization events, 129,085 transfers, 129,085 observations and 699,393 rule decisions**. Replays, request retries and verification smoke runs are not extra unique experiments or real transaction volume.

| Campaign | Configurations | Fingerprint |
| --- | --- | --- |
| Eight-tick cooldown reference | 240 | `7c9cdb51dcad0ff2e5166bddc07f55f96047c97d035bc500c57d86a941d791cf` |
| Sixteen-tick cooldown, slow payers | 30 | `3b5d47e2577f578a89608ace556823a5ff2af040ceae7cbab0d8eb2b349b81f8` |

## Pooled acknowledgments across ten matched seeds

Every scenario/policy has 4,320 intended ordinary requests. Counts include normal, stress and recovery; acknowledgment is scripted rather than independently verified useful work.

| Reference scenario | Evidence hold | Pending quota | Quota plus eight-tick cooldown |
| --- | --- | --- | --- |
| NORMAL_DELAY | 2,580 | 2,581 | 2,581 |
| CONCENTRATED_UNPAID | 1,737 | 2,563 | 2,577 |
| ROTATING_UNPAID | 1,737 | 1,737 | 2,570 |
| SLOW_PAYER | 2,501 | 2,379 | 2,379 |
| OBSERVATION_LAG | 2,572 | 2,574 | 2,574 |
| PAID_FLOOD | 1,737 | 1,737 | 1,737 |
| EVIDENCE_AFTER_EXPIRY | 1,737 | 1,737 | 1,737 |
| PROVIDER_OUTAGE | 1,737 | 1,737 | 1,737 |

## What the comparison supports

- The pending quota helps against one concentrated unpaid wallet. It does not restore acknowledgments against the rotating-wallet cohort. Different declared IDs bypass that local limit; this is not real Sybil resistance.
- An eight-tick cooldown restores rotating-cohort acknowledgments from 1,737 to 2,570 in the bounded fixture study. It admits 4,288 of 4,320 intended ordinary payments in that scenario; it neither serves everyone nor establishes production safety.
- The quota costs honest slow-payer throughput: 2,501 acknowledgments under the baseline versus 2,379 under either eight-tick controlled rule. The additional eight-tick cooldown does not lower the total further in this sample. It still refuses honest requests. Do not invent a throughput penalty merely because a rule is stricter.
- The sixteen-tick sensitivity preserves baseline and quota-only outcomes at 2,501 and 2,379, while quota-plus-cooldown drops to **1,737**. The same intended workloads are retained. A longer waiting rule can obstruct legitimate recovery substantially.
- All three policies retain the evidence-window hold. None leaves an ordinary paid request unstarted in the in-window reference scenarios or long-cooldown sensitivity. Beyond-window evidence leaves **1,440 paid ordinary requests unstarted per policy**. Expiry does not erase a transfer or refund it.
- Paid flood still starts attack work; provider outage still yields no stress acknowledgments or voluntary returns. These request controls do not verify delivered value or solve provider accountability.

Each full rule decision cites its blocking permit and cooldown end where applicable. The independent audit reconstructs the permit history visible at that request, including grant-before-send ordering. It then reuses the independent capability/wallet checker for exact debits, proof backing, one-time consumption, exclusive windows, FIFO, capacity and release evidence. Full controls, wallet outcomes, round metrics and exposure totals reconcile. Native replay additionally regenerates all scripted request attempts and rejects rehashed forged results.

No attack flag is available to the rule controller. Concentration/rotation, nonpayment and delayed clients are fixture interventions, not authenticated identities or measured agent intentions. Baseline-equivalence tests and pinned prior campaigns protect AE-014 output semantics while sharing the runtime. The helper audit remains fail-closed under Python -O. All activity is **SYNTHETIC / SIMULATED_UNITS**, with zero fees.

Production signed permission, true ownership/Sybil evidence, admission fairness for adaptive demand, work-quality verification, provider accountability, deployment and live AAI fee/burn/LP activation remain unfinished. Actual iPhone/Safari execution is unverified. [Method and commands](AE015.md) · [Local evidence](evidence/ae-015-local.json).
