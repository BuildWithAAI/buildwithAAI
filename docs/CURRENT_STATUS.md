# Current source and integration status

**October 27, 2026 — consolidated development source.** The research, community, scanner, virtual-leasing and SFP development lines are now represented in one repository tree. The [consolidation record](integration/CONSOLIDATION_2026-10-27.md) identifies all five input tips and the 71 original draft PR heads. Its [machine-readable manifest](integration/SOURCE_HEADS_2026-10-27.json) preserves their exact identities.

Source consolidation is separate from deploying or qualifying a live ecosystem. Existing execution gates, nonmonetary accounting, protocol versions, model/data classifications and immutable component pins are preserved.

## Where the implementations live

| Area | Source and operating guide | Implemented scope | Remaining work |
| --- | --- | --- | --- |
| Blockchain history and AAI.fun research | [Source/replay package](../src/solana_research), [AAI.fun guide](../research/aai-fun/README.md) | Bounded finalized RPC capture, original bytes, supported PumpSwap events, chronological anonymous replay and source sessions | Representative lifecycle data, broader decoder coverage and a complete historical-market simulator/replica |
| Brain and readout research | [Research package](../src/multi_brain_research), [neural experiment](../research/aai-fun/NEURAL_TRADE.md) | Pinned FlyVis CPU inference/reexecution, bounded readout experiments, curriculum and consensus harness | Additional qualified model adapters, evaluated fusion, calibration and demonstrated market performance |
| Advisory learning and shared memory | [Ecosystem package](../src/ecosystem_research), [connection inventory](../research/ecosystem/CONNECTIONS.md) | Bounded specialist learning, Reef records, retained experience, contradiction guards, controller checkpoints and recovery probes | Representative independent tasks, qualified continuous learning and distributed ownership |
| Scanner | [Scanner package](../src/aai_scanner), [setup](SCANNER_SETUP.md), [operations](SCANNER_OPERATIONS.md) | Read-only reports, watches, source qualification, operational checks and a disabled-by-default Telegram adapter | Complete permitted provider coverage, actual authorized bot/host commissioning and sustained operations |
| Agent workspace and practice market | [Community package](../projects/zoora-agent-community/README.md), [practice market](../projects/zoora-agent-community/PRACTICE_MARKET.md) | Invitation identity, wallet message sign-in, forum/workspace, durable jobs, demo-credit practice and local-model worker | Actual chosen model/provider/credential lifecycle, physical-host commissioning and live economic operation |
| Research services and blueprints | [Services](../research/ecosystem/SERVICES.md), [blueprints](../research/ecosystem/BLUEPRINTS.md), [remote workers](../research/ecosystem/REMOTE_AGENTS.md) | Work allowances, order/job lifecycle, candidate licenses/trials, evidence, transcripts, authenticated transfer and offline reproduction | Genuine successful-strategy format/outcome evidence, paid settlement and general autonomous businesses |
| Commerce and payment controls | [Sandbox pipeline](../projects/zoora-agent-community/PAYMENT_PIPELINE.md), [agent tools](../projects/zoora-agent-community/AGENT_PAYMENTS.md) | Bounded synthetic/sandbox authority, durable dispatch/recovery and read-only chain payment evidence | Provider interoperability, real-value settlement, signer integration and user-authorized funded validation |
| Virtual business spaces | [Schema](../projects/virtual-business-spaces/SCHEMA_VL001.md), [validator](../projects/virtual-business-spaces/VALIDATOR_VL002.md) | Controlled synthetic schema and compiled-registry draft validation | Agreement acceptance, booking/lifecycle, general contracts, payments and production registry |
| SFP paper research | [Paper lab](../projects/sfp-paper-lab/README.md), [source adapter](../projects/sfp-paper-lab/SOURCE.md) | Causal detector, paper ledger, chronological studies, persistent notebook, raw-source receipts and portable reports | Representative unseen evaluation, exposure-matched baselines and any funded execution |

## Read the evidence at its source revision

The consolidation PR runs the combined CI workflows; their exact-head results and artifacts are authoritative for this candidate. Historical numerical results remain labelled by their original source heads. A previous 609-test research-only run is not the combined root-suite count after scanner tests are co-located.

Ecosystem research still uses the exact scanner/community checkouts in [components.json](../research/ecosystem/components.json). Importing the newly co-located community tree as if it were that old pinned checkout would fail its identity contract. Keep those reproducible checkouts separate until a specifically reviewed pin upgrade.

The combined 763 root tests need the scanner runtime dependency: install `requirements-scanner.txt` before `python -m unittest discover -s tests -v`, on Linux and Python 3.11/3.12. The cross-platform brain workflow uses `python scripts/run_research_tests.py` to preserve all 609 research tests, including scanner-feed contracts, without asserting scanner-runtime support on Windows or Python 3.14. Community tests use that project's fully hashed runtime lock; SFP runtime uses the standard library; Rust modules use their own locked Cargo manifests. The project workflows retain these boundaries.

## Unfinished and unresolved

- The success catalogue has no qualified successful blueprints under the supported V1 research format. Accepted recipe trials and repeated work do not establish profitability, independent customers or revenue.
- Source observations and neural/advisory training retain their partial, untrusted or synthetic classifications. A successful transport or test is not a qualified market signal.
- The intermittent `BLUEPRINT_RESTART_DUPLICATE` and earlier `SERVICE_NOT_FOUND` observations remain unresolved; successful reruns do not establish a fix.
- Provider login/usage accounting, original autonomous theses, funded wallet execution, paid settlement, token-funded compute, any BRAIN/AAI launch/pairing or holder rewards, and native-chain transcript anchoring remain unfinished or proposed.
- No new public deployment, two-physical-host commissioning, production capacity or security certification is established by consolidating source. Existing private-pilot deployment claims remain dated historical records, not a fresh operational check.

Financial authority remains **ABSTAIN / NO_EXECUTION**. Demo credits and research work allowances are nonmonetary. Canonical token details and the future native chain's identity are not changed by this merge.

## Earlier records

The [pre-consolidation status archive](STATUS_BEFORE_CONSOLIDATION_2026-10-27.md) retains prior community, leasing, SFP and September documentation snapshots. Individual module validation reports and original PRs retain their scope and source identities. The planning backlog contains 41 task records plus a separately described VL queue; it is not a statement that every task has a live issue or assigned contributor.
