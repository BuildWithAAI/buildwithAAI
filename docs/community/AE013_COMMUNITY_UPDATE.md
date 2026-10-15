# AAI economy development — payment evidence and work admission

The next economy research layer is implemented in BuildWithAAI. It adds a distinction the first campaign did not model: a transfer can be timely even when its evidence arrives late, and a payment can be recorded without authorizing a provider to start work.

We ran **240 new matched configurations**: ten seeds, eight scenarios and three policies. All 240 full journals have been retained and independently reconstructed. This batch contains 103,680 intended ordinary-work requests, 96,431 paid ordinary-work requests, 118,733 transfer facts and 128,680 observation records across separate synthetic replicas. Replays and duplicate observations are not additional independent experiments or real transaction volume.

The new code retains transfers, observation times, queue decisions, capacity use and client acknowledgments separately. It rejects unbacked fixture claims, processes duplicate observations without double payment, and preserves overpayments that the quote-bound agreement adapter refuses to credit. Account totals reconcile without forced refunds, wallet freezing or real signing keys.

## What the new experiments show

| Complete scenario across ten matched seeds | Reserve work on quote | Strict observation cutoff | Evidence grace |
| --- | --- | --- | --- |
| Normal timing: acknowledged work | 2,331 | 2,580 | 2,580 |
| Unpaid separate-identity spam: acknowledged work | 1,567 | 2,580 | 2,580 |
| Delayed observations: acknowledged work | 2,331 | 1,737 | 2,501 |
| Paid spam: acknowledged work | 1,567 | 1,737 | 1,737 |

A funded queue prevents nonpaying profiles from occupying work slots without having to trust their declared identities. They can still consume quote metadata. Grace helps when a timely transfer's proof arrives late; it does not make an actually late payment timely.

There is also a material tradeoff. Under normal timing, the funded policies leave 15 paid ordinary requests without a start across the ten seeds. Under paid spam, that rises to 1,450. The reservation baseline refuses those overloaded requests before payment and has zero paid requests without a start. Higher throughput therefore does not establish that the new queue is safe for real client payments. Capacity-aware payment authorization and stronger work verification are next reinforcement requirements.

The grace policy rejects 1,440 duplicate payment observations in the duplicate scenario without adding another transfer. All policies reject 1,920 unbacked fixture claims each. In the overpayment scenario, the grace sample retains 1,441,440 observed but unapplied units across ten separate replicas. Those are synthetic exposure counters, not real AAI supply changes or verified financial losses.

## Verification and scope

The local normal and optimized Rust suites each pass **138 tests**. The new CLI acceptance and the previous economy regression checks pass. Published commit, Linux/Windows CI, browser checks and artifact verification are pinned in the development PR linked from the [AE-013 source branch](https://github.com/BuildWithAAI/buildwithAAI/tree/feature/ae-013-payment-windows). [Method](../../projects/zoora-agent-economy-simulator/review/AE013.md) and [validation](../../projects/zoora-agent-economy-simulator/review/VALIDATION_AE013.md) define the exact model and limits.

All activity is **SYNTHETIC / SIMULATED_UNITS**. Profiles, receipt backing and work outcomes are scripted fixtures. Real identity, RPC receipt authentication, independent work quality, paid-spam resistance and production permission flows are unfinished. The viewer is offline; actual iPhone/Safari execution has not been verified.

This timing study charges zero fees so we can isolate admission behavior. The previous fee, treasury, liquidity-budget and burn experiments remain available. No live AAI fee or allocation is adopted, and no customer funds, production service, native coin economics, consensus or validators are changed.

The next priorities are protecting clients before payment authorization, handling quote metadata abuse, testing incentives against paid attackers and verifying useful work beyond a digest or acknowledgment. The goal is an agent service economy with measured behavior and evidence that the community can inspect.
