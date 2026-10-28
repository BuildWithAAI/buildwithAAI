# AAI economy development update — October 14, 2026

We now have a runnable offline economy testing loop in the existing BuildWithAAI project. This development batch adds sustained stress scenarios, finite budgets, explicit fee accounting, replayable evidence and an inspectable report. It is available for review in [draft PR #28](https://github.com/BuildWithAAI/buildwithAAI/pull/28), stacked on the existing local agent-workspace development.

## What has been built and run

- Eight scenarios: ordinary demand, shared-operator reservation spam, separate-identity/Sybil spam, provider outages, demand surges, constrained budgets, refused returns and delivery digests without client acknowledgment.
- Matched comparisons of existing admission rules and a cap on unpaid reservations per declared operator.
- Twelve rounds per run, with normal, stress and recovery phases. Ten seeds, eight scenarios, two policies and two fee configurations produce **320 unique configurations**.
- An exact synthetic ledger for payments, voluntary returns, fees, treasury, liquidity budgets and burns. Every transfer checks nonnegative balances and conservation.
- Full journal retention, replay, CSV exports, an offline phone-sized report and checkpoint/resume support. Cached runs must verify before they can be reused.

The experiments contain **149,760 intended ordinary-work requests** and **124,356 admitted, paid ordinary-work requests across replicas**. These are scripted synthetic experiments, not deployed agents or real economic volume. Replaying a configuration does not turn it into another independent experiment.

## What we learned

| Matched reference result across ten seeds | Existing rules | Operator cap |
| --- | --- | --- |
| Shared-operator unpaid attack reservations admitted | 3,840 | 80 |
| Ordinary work acknowledged during that complete scenario | 1,742 | 2,616 |
| Separate-identity attack reservations admitted | 3,840 | 480 |
| Ordinary work acknowledged in that separate-identity scenario | 1,742 | 2,534 |

The cap helps with unpaid reservation starvation under the model's assumptions. It does not establish who really controls an identity. More declared identities still obtain more attack capacity, and providers can still fail to deliver or refuse a return. A digest on its own does not establish useful work.

The reference campaign uses **no fee**. A second, explicitly illustrative experiment charges 1% and allocates the fee among a burn counter, liquidity-budget counter and treasury counter. For a 1,000-unit payment, the ten-unit fee becomes five burned units, two liquidity-budget units and three treasury units after rounding. This is a research parameter, not an adopted AAI fee or allocation decision.

In the low-budget scenario, that fee reduced acknowledged work from **611 to 591 per policy** across ten seeds, while budget refusals increased from **3,286 to 3,321**. Payments and reserves reconcile, but that alone does not demonstrate a healthier economy. A burn does not establish a higher token floor, and a liquidity allocation counter is not a live liquidity position.

The low-budget model also runs out of ordinary-client purchasing capacity before recovery. Clients have fixed spend-only roles here; new income and capital replenishment are not modeled. This gives us a clear next experiment about funding flows, rather than a forecast about a real community.

## Development status

The source is a draft development candidate, with exact verification recorded in the [AE-012 validation report](../../projects/zoora-agent-economy-simulator/review/VALIDATION_AE012.md). All 320 full journals have been retained and independently reconstructed for balances, receipts, fee splits and exposure totals. Local normal and optimized Rust suites each pass 122 tests; the actual CLI acceptance script passes 30 checks. Published source `73ae81f` passes all nine CI jobs: Linux and Windows tests, CLI checks and dependency audits, plus 11 new Chrome report checks. The generated campaign JSON, CSV and HTML match exactly across the two platforms. Actual iPhone/Safari execution is not verified.

The runtime and data are **SYNTHETIC / SIMULATED_UNITS**. This batch does not move AAI, transact on a chain, burn real supply, deposit real liquidity, deploy a public service or change consensus/validators. It preserves the existing direct-payment principle: disputes, account suspension and deadlines cannot reverse a user's transfer; returns are voluntary recorded transfers.

## What needs reinforcing next

1. Identity controls and fair reservation admission that remain effective when one controller creates multiple accounts.
2. Delayed-payment and ordering experiments: immediate synthetic observations are an assumption, not a live-chain result.
3. Work verification that distinguishes a posted digest, a client acknowledgment and independently useful output.
4. Client income/replenishment experiments and demand feedback before drawing macroeconomic conclusions.
5. Separate implementation and review of virtual leases, community funding/voting and any proposed live fee, burn or liquidity policy.

The platform direction remains user-created agents that can provide services, collaborate and transact with user-controlled wallets. These simulations give us a repeatable way to measure assumptions and failures before connecting real economic activity.
