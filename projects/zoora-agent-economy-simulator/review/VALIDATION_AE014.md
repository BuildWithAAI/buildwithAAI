# AE-014 — validation and measured limits

Local source candidate based on verified AE-013 commit `00aaf271c2bbb03c6f24b121da7a844d7229ee8d`. The review suite passes **155 tests** per normal/optimized build, including 17 new authorization tests. Formatting and Clippy with warnings denied pass. New actual-CLI acceptance, prior payment checks and prior economy checks are recorded separately. Exact published head, clean Linux/Windows CI, dependency reports, browser tests and artifact digests are pinned in this milestone's development PR on [feature/ae-014-capacity-authorization](https://github.com/BuildWithAAI/buildwithAAI/tree/feature/ae-014-capacity-authorization). Local evidence does not establish that a later uninspected source is verified.

Campaign fingerprint: `7f5788cfba1fe2d6a7953bdd3094a7798c0e28e1b4e921a4f14a1cd7e06e0465`. **240 unique configurations**, ten seeds × eight scenarios × three policies. The batch contains 103,680 intended ordinary requests, 100,531 paid ordinary requests and 92,303 started ordinary jobs across separate synthetic replicas. Native checkpoint completion regenerated summary fingerprints against all full journals. An independent Python audit reconstructed all 240: **128,765 permits, 678,455 authorization events, 123,593 transfers and 123,593 observations**. Replays, duplicate permission requests and retry events are not additional unique experiments or real transaction volume.

## Paired measurements across ten seeds

Each scenario/policy has 4,320 intended ordinary requests. Entries show **paid requests / acknowledged requests / paid requests never started**. Acknowledgment is scripted, not an independent work-quality judgment.

| Scenario | No capacity held | Hold through send window | Hold through evidence window |
| --- | --- | --- | --- |
| NORMAL_DELAY | 4,320 / 2,565 / 39 | 4,320 / 2,570 / 34 | 4,303 / 2,580 / 0 |
| UNPAID_BURST | 4,320 / 2,565 / 39 | 4,320 / 2,570 / 34 | 4,293 / 2,572 / 0 |
| RENEWING_UNPAID | 4,320 / 2,565 / 39 | 4,320 / 2,555 / 64 | 2,868 / 1,737 / 0 |
| PAID_FLOOD | 4,320 / 1,731 / 1,462 | 4,320 / 1,735 / 1,459 | 2,868 / 1,737 / 0 |
| OBSERVATION_LAG | 4,320 / 2,495 / 155 | 4,320 / 2,498 / 154 | 4,293 / 2,572 / 0 |
| EVIDENCE_AFTER_EXPIRY | 4,320 / 1,731 / 1,462 | 4,320 / 1,732 / 1,463 | 4,308 / 1,737 / 1,440 |
| DUPLICATE_AUTHORIZATION | 4,320 / 2,565 / 39 | 4,320 / 2,570 / 34 | 4,303 / 2,580 / 0 |
| PROVIDER_OUTAGE | 4,320 / 1,731 / 155 | 4,320 / 1,732 / 156 | 4,175 / 1,737 / 0 |

## Interpretation

- The evidence-window hold eliminates paid-but-unstarted ordinary requests **inside its modeled window**, by refusing some authorizations before payment and retaining capacity while timely evidence is pending. It does not simply pay or serve everyone. Normal timing refuses 17 requests before payment across ten seeds; paid flood refuses 1,452.
- Holding only through sending is insufficient: observation lag leaves 154 paid requests without a start. Under paid flood, 1,459 remain. A timely payment does not mean its evidence is already available.
- Renewing unpaid reservations reduce held-policy acknowledgment from 2,572 under a one-batch unpaid burst to 1,737. The same attack does not reserve slots under unreserved permission. This is a real tradeoff in the fixture study; reservation starvation is not solved.
- Paid attackers still start 1,920 jobs under the evidence hold. It retains 2,640,500 unacknowledged net units across ten replicas in that scenario. Preventing one form of client exposure does not verify delivered value or stop paid denial of service.
- The outside-window scenario leaves 1,440 paid ordinary requests unstarted even under the full hold. A bounded promise cannot guarantee arbitrarily delayed observation, and expiry performs no refund. The complete transfer facts remain in wallet balances and direct accounting.
- Provider outage starts paid work but supplies no stress acknowledgment or voluntary return. The held policy retains 2,027,500 unacknowledged net units pooled across replicas. A capacity reservation is not protection against dishonest or unavailable providers.

The independent audit checks all wallet debits/credits, permit domains/bindings, one-time consumption, exclusive windows, hold expiry, FIFO by observed validation order, per-provider capacity, release evidence and all round/total metrics. Native regeneration complements it; neither authenticates real funds, real owners, provider service or work quality. Local test candidates and published clean-checkout evidence are kept distinct. The new CLI also tests mutation of checkpoint inputs while a campaign runs, rather than checking resume identity alone.

All activity is **SYNTHETIC / SIMULATED_UNITS** with zero fees. AE-012 fee/burn/LP-budget semantics and AE-013 fingerprints remain unchanged. Production signed permissions, wallet integration, useful-work verification, quota/fairness design, adaptive spam resistance, deployment and release integration remain unfinished. Actual iPhone/Safari acceptance is unverified. [Method](AE014.md) · [Local evidence](evidence/ae-014-local.json).
