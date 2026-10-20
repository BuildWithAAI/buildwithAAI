# Trading school before live trading

This is an implemented curriculum, public-practice evaluator, paper teaching lab
and education-gated research coordinator. It has **not trained or graduated an
animal-derived model**, connected a model teacher, or enabled trading. Every
result retains `NO_EXECUTION` and `live_execution_allowed=false`.

The school is not yet wired to wallet profiles or the hosted site. Its records
are local/CI research artifacts, not trading credentials.

The existing FlyEM graph, FlyVis visual-response model and other species
references remain subject to their existing source, licence, runtime, market
encoder, readout and calibration gates. Studying text cannot turn a connectivity
graph or visual-response model into a market predictor.

## What education means here

| Stage | Required evidence | Current implementation |
| --- | --- | --- |
| Study | Reviewed sources, lessons, instrument vocabulary | Versioned study packets; 21 lessons |
| Public practice | Structured answers, safety behavior, remediation | 51 public cases across seven tracks |
| Model training | Actual adapter, objective, datasets, weights and training log | Not performed; model-specific work remains |
| Scientific evaluation | Frozen parameters, trial registry, causal splits, costs and independent review | Split-envelope validator and evidence pins; no statistical edge established |
| Forward paper observation | Trusted causal feed, separate decision process, execution/fee reconciliation and sustained records | Deterministic replay teaching lab; no independently attested forward service |
| Live deployment | Reviewed signer/venue adapter, capital policy, permissions and operational acceptance | Not implemented or authorized by this school |

Public answer keys intentionally make this an inspectable **practice** bank.
Even perfect scores do not prove comprehension, reasoning, model identity,
honesty, profitable forecasting or unseen-data performance. A study export omits
the answer field for convenience, but the key remains public in the repository.
The demonstration reads those keys programmatically; it is a software fixture,
not a brain learning session or an agent graduation.

## Curriculum

The [versioned curriculum](trading-school/curriculum.json) contains original
study notes, objectives, reviewed primary-source references and structured drills.
Common lessons cover:

1. Chain/network/venue/asset identity and exact units.
2. Bid/ask, spread, depth, OHLCV limitations and order types.
3. Spread, fees, gas, impact, slippage and net outcomes.
4. Point-in-time availability, lineage, missingness and leakage.
5. Capital, open exposure, loss controls, gaps, margin and liquidation concepts.
6. Order lifecycle, partial fills, uncertain status, retry reconciliation and outages.
7. Chronological research, baselines, selection bias and untouched evaluation.
8. Portfolio concentration, correlated errors, depegs and changing regimes.
9. Key custody, allowances, privilege separation and untrusted conversations.
10. Causal indicators, price action, warm-up and feature construction.
11. Supply, issuance, concentration, vesting and liquidity distinctions.
12. Contract administration, transfer restrictions and unsupported token features.
13. Futures, perpetuals, CFD contracts, collateral, funding and liquidation concepts.
14. Oracle integrity, bridged assets and multi-chain settlement dependencies.

| Track ID | Additional education | Explicit boundary |
| --- | --- | --- |
| `crypto_general` | Common crypto/market foundation | Not a chain or venue adapter |
| `solana` | Accounts, mints, programs, instructions, fees, expiry and commitment | No Solana trading signer |
| `ethereum` | Nonces, gas, receipts, approvals and finality | No Ethereum order/transaction adapter |
| `bnb_smart_chain` | Separate state, providers and BSC finality | EVM compatibility is not shared chain identity |
| `sui` | Object IDs/versions, ownership, dependencies and programmable transactions | No substitution of an EVM encoder |
| `rh_unresolved` | Separate brokerage, crypto service, wallet and chain meanings | Paper admission blocked until the owner defines RH |
| `xauusd` | Gold instrument identity, broker terms, sessions, financing, macro context and gap risk | Paper admission blocked pending a selected broker and contract specification |

Robinhood Chain has primary network documentation; that does not resolve the
user's shorthand or establish brokerage access. XAUUSD is not a universal lot,
margin or settlement specification. An exchange gold-futures multiplier must
not silently become an OTC/CFD broker configuration.

Source review is dated **2026-10-20** and expires **2026-11-19 UTC** in this
version. These dates are review policy, not a promise that a source cannot
change earlier. Dynamic fees, network configuration, venue permissions and
contract terms require fresh validation for any future integration. No source
page is automatically executed, downloaded into a model, or treated as an
instruction channel. The bibliography belongs to trusted course material;
the separate community forum's prohibition on user-posted links is unchanged.

## Per-model records and admission

An attempt binds the learner's module ID, market-pipeline hash, calibration
hash, curriculum hash, track, timestamps, classification and every submitted
answer. Changes to graph, checkpoint, encoder, readout or calibration invalidate
the corresponding coordinator binding. Curriculum changes invalidate earlier
attempts; assessments expire at the earlier of 30 days or the source-review
deadline. Re-verification recomputes the grade from the raw answers and checks
current expiry instead of trusting a stored `passed` flag.

Every required question must be answered. The version-1 practice policy requires
at least 90% overall and **all safety-critical questions correct**. Those are
project practice cutoffs, not a scientifically validated competency scale or
financial risk recommendation. A missed safety scenario blocks admission even
when the total score exceeds 90%. Duplicate answers, unknown cases, other-track
answers, malformed input and future attempts fail closed.

`SchoolObservationRound` wraps the existing coordinator for **Solana research**.
Every configured worker must have matching, current, complete practice evidence;
the roster cannot be reduced to the workers that passed. Synthetic practice
cannot be relabelled as an operator model assessment. The existing coordinator
still checks snapshots, pipeline receipts, timing, abstention and unanimity.
Practice expiry is checked again at close. The resulting record includes both
assessments and the underlying consensus record, with no execution permission.

The lower-level `ObservationRound` remains available for research and already
returns `NO_EXECUTION`. This wrapper is not a newly connected production safety
service. The source-readiness function also records the absence of independently
validated trading education/skill for wallet execution. A future execution
adapter must independently verify all required evidence; this code supplies no
credential, signer, wallet allowance or order-submission path.

## Replay-only paper lab

The paper lab uses bounded, exact integers and explicit units. Its instrument
fingerprint binds track, network, venue and base/quote asset IDs. It handles one
long-only spot instrument with a supplied bid/ask/depth tape; it is **not** an
AMM, order-book matching engine, derivatives simulator or XAUUSD broker model.
It makes no RPC calls. Recorded data is labelled `RECORDED_UNVERIFIED`; the demo
is `SYNTHETIC_FIXTURE`.

A decision must reference the latest quote available at its timestamp. Stale,
future, mismatched, closed or excessively wide-spread observations cannot
admit a fill. Execution uses the **first eligible later quote** after the
configured latency, subject to a bounded wait. It never searches for a favorable
later price, fills at the candle close that generated a decision, or supplies an
unobserved intrabar path. Entry uses ask and exit uses bid.

Controls enforce cash including costs, order/position limits, spread, adverse
slippage, displayed depth, no short selling, a kill switch and a drawdown halt
for new buys. Drawdown checks include intermediate quote observations, so a
recovery before the next decision does not erase an earlier breach. Reducing
an existing position remains possible under the drawdown halt. Gaps can exceed
a configured loss limit; the limit is not a guaranteed exit price.

Buy debits round up; sell credits round down. Fees round up and each filled
paper trade pays the explicitly configured quote-denominated gas estimate.
These parameters are operator assumptions, not estimates verified against a
real chain. Rejected lab orders are not submitted transactions; chain failure
fees, bridge costs, funding, AMM impact, partial/resting orders, queue priority,
liquidation and broker financing remain unmodelled. Such scenarios belong in
future venue-specific simulators before any corresponding live use.

The sequential lab refuses a later decision timestamp preceding an earlier
order's simulated fill. It does not model concurrent outstanding orders. It
records all fills/rejections, cash/units, paid costs, marked equity/drawdown,
a hypothetical final-bid exit valuation, a no-trades cash baseline and a hash
chain. Final-bid valuation is not a promised executable exit. Audit can replay
the retained input and compare the entire output, not just a digest label.

Historical timestamps alone cannot prove an external agent did not inspect
future data. All supplied decisions are explicitly **not independently
attested**. A trusted forward-paper observer must withhold future information
from the model process, seal decisions before outcomes, and reconcile feeds
and venue costs independently. The positive toy PnL in the demo checks integer
accounting; it is not market performance or a strategy recommendation.

## Train each brain through the appropriate adapter

For an instruction-following agent, a future adapter can deliver study packets,
retrieve only curated material and submit structured answers plus concise,
source-backed explanations. The current grader evaluates answer choices, not
free-text explanations. It does not invoke an LLM or alter model weights.

An animal-derived network requires a different pipeline: a licensed source and
supported neuronal runtime, a causal market-feature encoder, a training objective
and target specification, a readout and uncertainty/calibration model. Text
documents cannot be sent directly to a connectivity graph as if it were an LLM.
Each version needs its own reproducible training and evaluation record.

The [learner plan](trading-school/learner-plan.json) records fly, tadpole, cat and
macaque as **planned, not trained**. No weights or school scores are invented.
Unresolved species-source rights and unsupported runtimes retain their existing
blockers. Additional models can use the same course protocol once their actual
pipeline identity is registered.

## Scientific evaluation before any graduation claim

Freeze target/horizon, asset/venue universe, costs, dataset manifests and tested
configurations before evaluation. Compare with cash and simple non-neural
baselines. Preserve validation failures, abstentions and every attempted model;
do not select the prettiest backtest and present its results as untouched.

`EvaluationPlan` checks chronological train, validation, test and forward
envelopes, requires horizon-aware embargo gaps and pins datasets, trial registry,
parameters and cost assumptions. End times mean the last included label was
available by that time. This is a structural check, **not a row-level purge
audit, probability-of-overfitting calculation, significance test or power
analysis**. Those independent empirical checks remain required for real models.

Evaluate all intended chains, instruments and regimes separately. Inspect
cost-aware returns, drawdown/exposure, calibration, abstention, turnover,
liquidity/capacity and uncertainty, with confidence intervals and trial-selection
adjustments appropriate to the experiment. A fixed count of trades, high hit
rate, single Sharpe ratio or quiz score cannot by itself establish readiness.
Keep live authority separate even if education and paper evaluation eventually
pass. Re-evaluate after material source, model, calibration or market changes.

Primary references are recorded in the curriculum: official Solana, Ethereum,
BNB Chain and Sui documentation; Robinhood network documentation; LBMA and CME
instrument references; Uniswap's impact/slippage definitions; the authors'
*Probability of Backtest Overfitting* paper; NIST's AI RMF; and CFTC's trading
systems advisory. These support the concepts, not a claim that our particular
brains have demonstrated financial skill.

## Run and verify

No new dependency is required; Python 3.11+ suffices.

```sh
python scripts/trading_school.py study --track solana --output solana-study.json
python scripts/trading_school.py demo --output research/trading-school/generated/local
python -bb -X dev -W error -m unittest discover -s tests -p test_trading_school.py -v
python -O -bb -X dev -W error -m unittest discover -s tests -p test_trading_school.py -v
```

Use a new output directory/file: publication refuses to replace an existing
artifact or symlink. `assess` consumes a structured attempt and explicit replay
time. `verify-assessment` regrades a retained attempt, and `verify-paper`
replays a retained lab input against a report. The demo writes seven practice
records, a frozen curriculum, paper input/output and an educated synthetic
research round. CLI and in-process bytes must match, and independently hand
calculated fixture costs/PnL must agree. CI repeats this on Linux/Windows and
Python 3.11/3.14; no chain account or funds are involved.

## Retained hosted evidence

The [verification record](trading-school/evidence/hosted-verification.json)
identifies source commit `81bb944`, its implementation-file hashes and the four
Linux/Windows, Python 3.11/3.14 artifact digests from run `39442079916`. All four
ZIP archives were downloaded and their SHA256 values checked against GitHub.
Each of their 13 components matched the local replay byte for byte. The frozen
curriculum, paper input, paper record, educated synthetic round and summary are
retained beside that record. These are reproducible software tests; no brain
training or independent financial-performance attestation is implied.

CI also recomputes the retained paper result from its original inputs. To run
that check locally with a new output file:

```sh
python scripts/trading_school.py --curriculum research/trading-school/evidence/curriculum.json verify-paper --input research/trading-school/evidence/paper-input.json --record research/trading-school/evidence/paper-record.json --output retained-paper-check.json
```
