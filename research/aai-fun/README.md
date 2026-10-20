# AAI.fun — recorded-chain research and training environment

AAI.fun is the working product name proposed by the founder. Domain ownership, availability and naming clearance are not established. No domain, website, launchpad or public trading service is created by this change.

The objective is a familiar meme-market research environment for agents and biological-model readouts, using observed Solana history and simulated funds. A future Pump.fun-compatible interface and mechanics must be tested against specific source/program versions. "1:1" is a fidelity target with measurable limits, not the current implementation status.

## What this implementation adds

- A bounded, read-only collector for one to four finalized mainnet slots.
- Exact RPC response bytes, request parameters, capture time, HTTP status and hashes.
- Full genesis-hash verification; the shortened CAIP network identifier is not accepted as the RPC genesis hash.
- A getBlocks coverage record distinguishing non-returned slots from requested blocks whose payload is unavailable.
- Full getBlock transactions, canonical transaction indices and block-parent/hash linkage checks.
- PumpSwap BuyEvent/SellEvent CPI prefix decoding with exact integer token amounts, separately identified mints/decimals, per-market observed volume and OHLC.
- Failed-transaction and fee accounting. A failed transaction cannot contribute an executed trade, even if it emitted an event before reverting.
- An anonymous, ordered, hash-linked observation replay and independent-process source reconstruction.
- Synthetic regression fixtures and a separate actual-public-chain acquisition job. The job must obtain at least one supported real trade to pass.

Status comes from the PR checks. Synthetic fixtures are not historical data. A successful network capture is a small source sample, not a token-lifecycle dataset or a trained trading policy.

## Evidence and trust

Archive protocol: AAI_SOLANA_RAW_BLOCK_ARCHIVE_V1. The collector stores exact received response bytes as base64 plus SHA-256, canonical request hashes, UTC capture times and timing. Secrets and arbitrary URLs are excluded: only the two explicitly listed public Solana mainnet endpoint URLs and four read-only RPC methods are allowed. No wallet, signing, transaction submission, key, paid provider or account is used.

The raw-byte budget is 8 MiB, JSON file budget 16 MiB, window four slots, RPC count seven, request timeout 15 seconds and total request-start budget 180 seconds. Redirects are refused. Existing output directories/files are never overwritten. Incomplete responses, HTTP failures, wrong genesis, future windows and unsupported versions fail visibly; bounded failed attempts are retained as INCOMPLETE evidence.

All fields still originate from a single RPC response. Matching hashes detect later modification against saved data; they cannot establish validator consensus independently, validate transaction signatures, authenticate supplied logs or prove that a fabricated archive is real. RPC_CAPTURE is a collector classification, not a third-party attestation. A second independent provider and archived provenance are later requirements for stronger corroboration.

Capture time is when we retrieved the block now. blockTime and program event timestamp are retained as source metadata. Neither is relabeled as the historical time an agent could have received the observation. The first replay establishes canonical ledger order, not original network latency, mempool visibility, transaction submission order or private bundle membership.

## Decoder scope

Source schema facts were checked in the official pump-fun/pump-public-docs repository at commit 639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22; idl/pump_amm.json Git blob d907b16a91f035aeb3c3182bfa0972a91bf23a86. No unlicensed SDK or program source is copied. The first 248 event bytes cover fourteen integer fields and pool/user/base-account/quote-account public keys.

An event must match the PumpSwap program account, Anchor CPI tag and the specific BuyEvent/SellEvent discriminator. CPI events are counted once; duplicate log presentations are not added again. Events emitted only through logs, other event kinds and unmapped token identities are outside the decoded scope. Other/unmapped CPI events are counted explicitly. Supported-but-truncated events and conflicting token identities are hard failures.

Token identity/decimals come from transaction pre/post token-balance metadata and must agree when both are present. Missing token identities are not guessed. Static and loaded transaction account keys are resolved before event lookup.

The fixed prefix supports observed amounts, not a complete pool state. Later fields, including virtual quote reserves and new fee/reward extensions, are retained as an opaque suffix with a hash and byte count. They are not silently read as zero. This decoder does not attest the program executable deployed at the historical slot. Old or future layouts therefore require additional version-specific review before full-fidelity reconstruction.

Observed price is an exact rational of quote-token whole units per base-token whole unit. Volume sums the event's quote_amount_in for buys or quote_amount_out for sells, plus separately retained reported fee fields. It is not an agent's execution quote, spread, executable return, USD notional or proof of organic demand. Different pools and quote mints never share a volume total. No same-owner or wash-volume adjustment is inferred.

## Source history and simulated orders are different modes

| Mode | What stays exact | What requires a model |
| --- | --- | --- |
| Observational replay | Captured ledger events, order, observed amounts and metadata within the verified source scope | Historical availability and missing/out-of-scope data |
| Agent paper trading | The retained source history is an input | Fill eligibility, latency, costs, routing, slippage and rejection |
| Interactive market simulation | Rules and supplied initial state can be pinned | Agents change the state; later recorded outcomes cannot be assumed unchanged |

A simulated order never modifies the archive or becomes an observed historical trade. If an agent changes reserves, the resulting prices and later fills are counterfactual. Resetting reserves to the next historical value while also keeping the agent's impact would be inconsistent. A future interactive engine must specify how external order flow is replayed and how its success changes after agent interventions.

Ordinary transaction history alone is insufficient to assert every historical account state, program binary, fee configuration, routed quote, failed off-chain submission or private bundle. Full mechanics need state snapshots/writes and program/version history alongside transactions.

## Fidelity acceptance plan

| Area | Required comparison | Current status |
| --- | --- | --- |
| Source capture | Exact responses, finality request, genesis, coverage and replay | Implemented; hosted outcome recorded in PR |
| Observed PumpSwap trades | Discriminators, amounts, identities, order, fees and source lineage | Fixed-prefix CPI scope implemented |
| Bonding-curve launches and trades | Versioned curve state, reserve math, integer rounding and fee extensions | Not implemented here |
| Graduation/migration | Coin identity across curve and pool; transition state and event ordering | Not implemented here |
| Simulated execution | Buys/sells, exact fees, slippage, liquidity, rejection and agent impact | Separate engine work |
| Agent interface | Stable research API for observation, decision, risk veto and paper execution | Integration work |
| Brain learning | Causal features, explicit target, grouped chronological holdouts and frozen evaluation | Trade readout and optional [frozen neural activity adapter](NEURAL_TRADE.md) implemented; historical cohort and market validation remain open |
| Research observer | Verified replay, original-vs-simulated comparison, balances and decision explanations | Offline anonymous observation trace only |

Full 1:1 status is withheld until each claimed behavior matches a versioned historical reference and remaining differences are disclosed. The brand/interface will identify AAI.fun as an independent research simulator using simulated funds.

## Training-data plan

Build a cohort from preselected launch intervals or a reproducible sampling rule, not only surviving high-cap coins. Retain dead/failed coins, migrations, missing responses and all observed failures. Keep original mint/pool identity and lineage in private source records. Windows, aliases and pools for the same economic asset stay in one train/validation/test group.

Randomize whole episodes within their chronological partition. Preserve every episode's internal ledger order. Training and test windows cannot overlap, and outcome labels are released only after their observation horizon. Rename tokens for presentation; familiar charts and stable wallet patterns can remain recognizable, so aliases do not create an independently blinded evaluation.

Bundle or rug labels need separately sourced point-in-time evidence and an explicit definition. Observed selling or a common funder is not automatically proof of fraud or shared ownership. No verified rug/bundle label is manufactured here.

The existing quote trainer requires bid/ask/depth. Executed trades do not provide those measurements. The new [trade-learning path](TRADE_LEARNING.md) groups observed swaps at the transaction boundary and fits a separate trade-specific target through the shared numerical readout. It does not invent bid/ask/depth. Its synthetic control and actual-source preparation checks are separate; historical cohort adequacy and live-money transfer remain empirical questions.

## Commands

From the repository root, Python >=3.11, standard library only:

~~~sh
python scripts/coin_evidence.py capture --blocks 1 --require-trades --output /private/aai-fun-source
python scripts/coin_evidence.py verify --directory /private/aai-fun-source

python scripts/coin_evidence.py build --archive /private/archive.json --output /private/aai-fun-replay
~~~

The collector defaults to https://api.mainnet.solana.com; the explicitly allowed legacy public endpoint can be selected with --endpoint. A specific historical start slot can be supplied with --start-slot and up to four slots with --blocks. Availability, pruning, rate limits and response budgets can prevent acquisition. No provider purchase or upgrade occurs automatically.

Outputs are archive.json, trade-tape.json, replay-plan.json, public-replay.json and summary.json. Only the public replay is intended for a future overlay; raw archives and tapes expose source identifiers and future history. The current CLI does not stream, host a market, fit weights or place simulated/live orders.

Primary references: [Solana getBlock](https://solana.com/docs/rpc/http/getblock), [getTransaction](https://solana.com/docs/rpc/http/gettransaction), [public endpoints](https://solana.com/docs/references/clusters), [full Mainnet genesis hash](https://solana.com/docs/payments/agentic-payments/x402), [pinned PumpSwap IDL](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/idl/pump_amm.json), [Anchor-compatible CPI tag](https://github.com/solana-foundation/solana-dev-skill/blob/main/skills/solana-dev/references/programs/pinocchio.md).
