# AE-013 validation and measured findings

Local development candidate based on verified AE-012 commit `100fa8df87e53e496da0696f59581718ceeb2614`. All 138 Rust tests pass in normal and optimized builds; formatting and Clippy with warnings denied pass. The new actual-CLI acceptance script passes 30 checks; the existing AE-012 script still passes its 30 checks and preserves both prior campaign fingerprints. Published commit identity, CI checkout logs, artifact digests and browser results are recorded in this milestone's draft PR, associated with [feature/ae-013-payment-windows](https://github.com/BuildWithAAI/buildwithAAI/tree/feature/ae-013-payment-windows). Local verification is not a claim that a later uninspected source or deployment is verified.

The pinned payment campaign is **240 unique configurations**, fingerprint `a233a0aba0aa77f0a7e9a4533f4271248963e329e99adff89338c64297b29fa3`. Ten seeds × eight scenarios × three policies contain 103,680 intended ordinary-work requests and 96,431 paid ordinary-work requests across replicas. Replays and repeated observations are not additional independent experiments. All activity is SYNTHETIC / SIMULATED_UNITS; these are neither autonomous LLM performance results nor real money volume.

All 240 complete journals were retained, replayed and independently reconstructed in Python, including 118,733 transfer facts, 128,680 observation records and 279,773 queue events. The audit verifies nonnegative budgets, backing facts, duplicate idempotence, transfer/observation cutoffs, FIFO validation order, per-provider slot limits, all exposure totals and full-run/summary fingerprints. [Method](AE013.md) · [Local evidence](evidence/ae-013-local.json).

## Pooled results across ten matched seeds

Every scenario below has 4,320 intended ordinary requests per policy. Acknowledgment is a scripted client action, not independently assessed useful output.

| Scenario | Reservation acknowledgment | Strict acknowledgment | Grace acknowledgment | Paid ordinary work never started under grace |
| --- | --- | --- | --- | --- |
| NORMAL_DELAY | 2,331 | 2,580 | 2,580 | 15 |
| UNPAID_SYBIL_FLOOD | 1,567 | 2,580 | 2,580 | 15 |
| PAID_SYBIL_FLOOD | 1,567 | 1,737 | 1,737 | 1,450 |
| OBSERVATION_LAG | 2,331 | 1,737 | 2,501 | 143 |
| LATE_PAYMENT | 2,331 | 1,737 | 1,737 | 1,450 |
| DUPLICATE_RECEIPTS | 2,331 | 2,580 | 2,580 | 15 |
| OUT_OF_TERMS | 1,567 | 1,737 | 1,737 | 1,450 |
| UNBACKED_CLAIMS | 1,567 | 2,580 | 2,580 | 15 |

## What requires reinforcement

- Funded queues recover ordinary work under unpaid reservation spam without consulting the fixture's attack flag. Unpaid quotes still consume metadata. This is protection for work capacity, not proof of real identity or a complete spam defense.
- Under observation lag, grace improves acknowledgments from 1,737 to 2,501 compared with the strict policy, and reduces paid ordinary requests never started from 1,450 to 143. That remains worse than the same funded policy under normal timing: 2,580 acknowledgments and 15 paid requests never started. Late evidence leaves less service time.
- Paid spam starts 1,920 attack jobs per policy across the pooled study and harms ordinary clients. Under grace, 1,450 ordinary clients' paid requests never start, versus zero for the reservation baseline that refused those requests before payment. Better throughput alone does not make the funded policy safer for a live product. A capacity-aware payment authorization/reservation workflow and stronger work verification require separate design and tests.
- Grace rejects actually late transfers. Their money remains recorded; refusal to dispatch is not a refund. No production policy should be adopted from the headline acknowledgment count alone.
- Overpayments remain in wallet truth despite adapter rejection. The grace sample retains 1,441,440 observed but unapplied units across ten replicas; those are simulated exposure counters, not real AAI supply or actual losses.
- Duplicate observations do not create another wallet debit or adapter credit. The grace duplicate sample rejects 1,440 repeats. All three policies reject 1,920 unbacked fixture claims each, without converting receipt-shaped data into real proof.

This study charges zero fees to isolate timing. The AE-012 fee/burn/treasury/liquidity-budget experiments remain available and unchanged. No adopted AAI economics, forced refund, signing key, production transaction or protocol/validator change is introduced. The standalone direct adapter remains quote-bound; the separate synthetic fact ledger is not a replacement for a real evidence-preserving chain adapter.

## Verification boundaries

The independent audit complements native regeneration; it cannot authenticate external events or replace replay. Known source strings and hashes alone are not ownership or chain proof. Browser acceptance must inspect actual exported HTML. Chromium desktop/390px checks do not establish actual iPhone/Safari acceptance. This is an offline research milestone on a draft development branch; public service integration, paid-spam resistance, quote metadata abuse, live wallet permission flows and independent work quality are unfinished.
