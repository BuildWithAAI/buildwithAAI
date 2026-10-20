# Multi-brain observation coordinator

October 20, 2026. This implements the founder's proposed rule: separate modules watch the same pair and an all-module agreement can become a research buy candidate. It is a deterministic software harness, **not a tested trading strategy or a connection of four functioning animal-derived market models**.

## What connects to what

One point-in-time market snapshot is identified by exact Solana network, venue, pool, base mint and quote mint. Symbols alone cannot identify a pair. Each external worker must consume that snapshot through its own versioned encoder, model and readout, then return a typed receipt for the same task and horizon. The coordinator collects those receipts. It imports no model and performs no network access.

An observation round fixes the entire policy, pair, feature schema, snapshot and required roster before receipts arrive. Every output binds to that snapshot digest, exact pipeline/source identity and task/horizon. The full pipeline digest includes graph, checkpoint, encoder and readout; a calibration artifact reference is also required. References are not independently authenticated evidence that calibration or model quality is valid. Missing stages stay UNAVAILABLE. Relabeling the same complete pipeline as another module cannot manufacture a second vote; different hashes still do not establish statistical independence.

| Condition | Research result |
| --- | --- |
| All required modules return qualifying scores within uncertainty/time limits | `UNANIMOUS_BUY_CANDIDATE` |
| At least one qualifying module does not support buying, with all present | `NO_BUY` |
| A ready module is still missing before the deadline | `WAITING` |
| Missing adapter/data, abstention, excessive uncertainty, timeout, late/stale result or invalid receipt | `ABSTAIN` |

Every result retains `action=NO_EXECUTION`, `execution_allowed=false`, `risk_policy=NOT_EVALUATED` and unestablished market validation/independence. NO_BUY is not an instruction to sell an existing position. No vote count is converted into a combined probability. A failed or absent module never reduces the required denominator. Invalid receipts latch a round fault even if a caller catches the exception. Once finalized, the round cannot accept replacements.

The hypothetical later path is **prediction → decision policy → independent risk checks → paper fill model → measured outcome**. Live execution needs separately validated risk limits, executable costs/liquidity/position sizing, idempotent orders, operator controls and signing authorization. This implementation contains no order or signing path, no private keys and no permission switch for execution. Its code does not grant readiness to any source in the existing catalog.

## Current biological-model reality

| Module candidate | Verified state | Still needed before market forecasts |
| --- | --- | --- |
| FlyVis model 000 | [FV-REF-001](../experiments/flyvis_trained_reference/README.md): pretrained visual-response check, 22/24 recorded polarities | Registered market task, encoder/readout, market calibration and chronological evaluation |
| Tadpole CNS | Original functional-model source identified in [source audit](OPEN_MODEL_SCIENTIFIC_AUDIT_20261020.md) | Reuse terms, runtime compatibility, reproduced scientific behavior, task suitability and market pipeline |
| Cat V1 | Original model/framework sources and publications audited | Pinned compatible environment/assets, scientific reproduction, task suitability and market pipeline |
| Macaque visual cortex | Model source/publication audited; noncommercial restriction recorded | Appropriate use rights, tractable pinned execution, scientific reproduction, task suitability and market pipeline |

No four-brain market ensemble is running. A vision or locomotor circuit does not acquire financial semantics from its species name. We must test a documented encoding and readout rather than treating a visual flash index as a buy score. Cross-species combination is synthetic engineering, not a measured biological connection.

## Working API and replay

Implementation: [consensus.py](../src/multi_brain_research/consensus.py), using the existing immutable `Snapshot` and `ModuleOutput` contracts. Create an `ObservationRound(policy, pair, snapshot)`, submit each `Receipt(output, received_time_ms)`, inspect `status(now_ms)` and call `finalize(now_ms)` once complete or blocked. The owner of the external worker transport must serialize ingress and record receipt times; the in-memory collector is not a concurrent worker host or security sandbox.

[replay_brain_consensus.py](../scripts/replay_brain_consensus.py) implements the concrete JSONL connection format. Supply a fixed JSON policy and OPEN / RECEIPT / POLL / FINALIZE events. It accepts one active round, refuses repeated finalized round IDs, enforces exact fields and preserves policy, snapshots, raw receipts and terminal audit records. It bounds policies/lines to 64 KiB, input/output to 16 MiB each, events to 20,000 and completed rounds to 1,000. Extra execution/import/quorum fields, duplicate JSON keys, unsupported event types and incomplete rounds fail with nonzero exit. Existing audit files are never overwritten. Preserve partial output after an error; do not present an incomplete stream as a completed run.

```bash
python scripts/run_consensus_demo.py --output research/consensus/generated/local-1
python scripts/replay_brain_consensus.py --policy research/consensus/generated/local-1/policy.json --events research/consensus/generated/local-1/events.jsonl --output research/consensus/generated/local-1/replayed-audit.jsonl
```

The demo runs **nine SYNTHETIC software scenarios**: unanimity, dissent, uncertainty, explicit abstention, missing worker, late worker, missing data, stale data and missing encoder. The first eight use four generic fixture workers through the actual CLI protocol; the ninth exercises an unavailable adapter with three received outputs. No fixture represents an animal model, live price feed, measured forecast or financial outcome. Fixture scores, component hashes and the 0.7 score/0.2 uncertainty limits are arbitrary engineering test values, not a recommended strategy. A separate process plus a second replay must produce identical audit bytes; both use the same implementation, so this is a reproducibility check, not independent scientific validation.

The retained evidence lives in [consensus/evidence](consensus/evidence/). CI runs the synthetic demo on Linux and Windows along with the entire existing test suite, including retained FlyVis raw evidence. JSONL receives explicit LF treatment for byte-stable cross-platform replay. Replay-provided timestamps and unsigned worker receipts are submitted evidence, not trusted live-clock or execution attestation.

Recorded software result: all nine expected scenarios passed locally and on [GitHub run 39400241477](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/39400241477) at source commit `9a86da552bd112be575cfcba63c72b41445334a0`. Both platform artifacts were downloaded, matched against GitHub's archive digests and replayed. Local/Linux/Windows policy, events, audit trace and missing-encoder output match byte-for-byte. Audit SHA-256: `e96b004be383789a5901e107cbb57c85be316f99c9a8fa2d4e9a08dd87ec72ec`. Original ZIPs, verification metadata, local inputs/trace and source equivalence are retained in that evidence directory. These are software-path checks and do not evaluate forecast quality or financial outcomes.

The replay driver does not schedule timeouts from a live clock; a future supervised transport must timestamp ingress and issue status/finalization calls. Round deduplication lasts for one replay process, not across restarts, and is not a durable order-idempotency store. These limitations are separate from the implemented per-round receipt/data checks and are prerequisites for any later live service.

## Candidate IRC discussion channel — idea only

The founder suggested IRC for agent communication. It could provide an observable discussion room for agent software surrounding the numerical models. No IRC server, account, bridge or outbound message has been created, and this is not a selected deployment architecture.

Keep decision receipts in the structured coordinator. Record/finalize independent module outputs before exposing agents to one another's reasoning; any later group discussion should be a separately labeled stage so copied opinions cannot masquerade as independent agreement. A numerical vision/locomotor model needs an agent wrapper to describe its actual recorded outputs; it does not inherently speak IRC or natural language.

A possible initial setup is one private IRC service, separate authenticated accounts per agent, TLS with certificate verification, restricted channel membership, bounded message rates and a defined history-retention policy. Identify senders by authenticated account, not display nickname. Treat chat text as untrusted content with no authority to execute code, change risk limits or authorize payments. Keep credentials and wallet secrets out of messages. IRC chat history is not the canonical decision ledger; retain round/snapshot/model references in the existing structured records.

[Ergo's official manual](https://github.com/ergochat/ergo/blob/master/docs/MANUAL.md) documents account authentication, TLS and persistent-history configuration; [IRCv3](https://ircv3.net/) specifies SASL login and messaging extensions. These establish implementation options, not a security audit or deployment approval. A prototype would need transport identity checks, reconnect/replay handling, loop/rate limits and prompt-injection tests before connecting agent runtimes.

## Research required before evaluating the trading idea

For a new registered market experiment under [BT-000](BIOLOGICAL_COMPUTE_PROTOCOL.md) and [BT-001](DATA_MEASUREMENT_PROTOCOL.md), define one concrete target and horizon, the dataset and its point-in-time availability, each module's licensed executable source, encoders/readouts, train/validation/untouched test windows, calibration and realistic financial costs. Characterize each module separately. Compare unanimous voting with individual modules, no-trade, simple baselines, averaging/majority voting, conventional ensembles and module-removal controls. Measure error correlation, coverage/abstention, calibration, losses/drawdown, costs, failed fills and regime stability. Record every attempted configuration and negative result before selecting a policy. Do not tune thresholds on the final test period.

Primary research checked: [Breiman, Random Forests (2001)](https://www.stat.berkeley.edu/~breiman/randomforest2001.pdf) analyzes classifier strength and error dependence for tree ensembles; it does not validate this proposed biological ensemble. Our engineering inference is that species diversity or agreement alone cannot establish useful independent evidence. [Bailey et al., The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf), [journal DOI](https://doi.org/10.21314/JCF.2016.322), addresses selection effects when many strategy configurations are tested. These motivate explicit comparisons and trial accounting; neither proves a trading edge here.
