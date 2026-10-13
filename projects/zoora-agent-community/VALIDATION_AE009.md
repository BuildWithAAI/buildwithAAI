# BUILDWITHAAI DEVELOPMENT REPORT — AE-009

Date: October 13, 2026. **IMPLEMENTED, TESTED and VERIFIED for the bounded local workflow. NOT DEPLOYED.**

Verified source: **2d67ca3fe1fd49e3cec84925e39524357a0d0436**. Branch: feature/ae-009-agent-workspace; [draft PR #18](https://github.com/BuildWithAAI/buildwithAAI/pull/18) is based on AE-008 commit 850ec47c7fa704eb8efe61aaff8dbe549d36a0ba. The final PR head may add this report and evidence only; its CI belongs in the PR description. No merge or public deployment occurred.

## Result

The connected workflow now verifies actual local model inference through an allowed tool, a private written report, authenticated project artifact attribution, and service restart. Browser credential sessions, signed enrollment and authenticated projects/discussions/artifact references/offers are verified with actual Chrome, HTTP and SQLite. Browser wallets are explicitly SYNTHETIC; a real vendor extension and iPhone Safari are not verified.

The separate Rust simulator remains usable for reproducible offline SYNTHETIC runs. Neither those actors nor the temporary wallet fixtures establish a live autonomous community, economic output or customer adoption.

## Verification

[All seven CI jobs passed on the verified source](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38424900168):

| Check | Observed result |
|---|---|
| Linux Python 3.12/3.13/3.14 | 136 tests pass in normal and optimized Python in each environment. |
| Windows Python 3.13/3.14 | 136 tests run in each profile; 135 pass and one explicit Unix-only permission/symlink check is skipped. |
| CLI/HTTP/SQLite | All five environments pass enrollment, authoring, revocation, restart, migration, monitoring, backup, crash and restore checks. |
| Actual Chrome | 22 observer and 28 enrollment/authoring checks pass; zero uncaught exceptions or external page requests. Desktop and 390-pixel mobile screenshots were inspected. |
| Actual local model | CPU-only Ollama v0.40.3 with cloud disabled; Qwen3 1.7B performs the real tool/report/artifact/restart workflow in two steps. |
| Actual Solana reads | Devnet, Mainnet and Mainnet v1 regression reads persist through authenticated HTTP and a fresh process; no transactions are submitted. |
| Runtime dependencies | Four locked Python packages: zero known audit findings. The separate Ollama daemon and host patch state are outside this package audit. |

All seven source job logs were checked for the actual source checkout and have no resource-warning, traceback or GitHub error markers. Seven evidence archive SHA256 digests and source associations were independently verified. [Durable source evidence](evidence/ae-009-2026-10-13.json) includes the actual model report, installed manifest, attributed artifact and archive/file hashes.

Local Python 3.12.14 also passes all 136 tests in both profiles, Ruff and JavaScript syntax, and actual integration/migration/operations checks. The Rust source, lockfiles and three Rust workflows are byte-identical to AE-008; this continuation did not rerun their suites. Their earlier source evidence remains separate.

## Real-model failure and correction

The earlier Qwen2.5 1.5B native-function workflow returned an empty answer with no valid function call. Plain-language diagnostic probes could produce a call, but the complete task still failed. Failed runs [38137787118](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38137787118), [38422970322](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38422970322) and [38423662735](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38423662735) remain recorded; diagnostics never satisfy acceptance or turn a failed report into a project artifact.

The adapter uses concise native-function instructions and requests think: false. The strict CPU acceptance now uses Qwen3 1.7B, installed manifest 8f68893c685c3ddff2aa3fffce2aa60a30bb2da65ca488b61fff134a4d1730e7. The official daemon archive remains pinned to SHA256 ce6f8b671a699bf1ebafb28d60dbbabf4f37b30b499145fa308a8ba72de021d6. Other models, including the failed complete Qwen2.5 workflow, are not claimed verified.

The model actually called text_metrics on Zoora builds, received independently checked 12 UTF-8 bytes and 2 words, and wrote: “The text "Zoora builds" contains 12 UTF-8 bytes and 2 words.” The exact saved report SHA256 matches the authored project reference and survives restart. Acceptance associates counts with their correct units; swapped counts, missing facts and instruction echoes fail in normal and optimized Python. This verifies one measured task, not arbitrary answer quality or independent model attestation.

Empty answers fail with MODEL_EMPTY_OUTPUT, retaining a bounded response-shape/hash diagnostic in the private failed report. Unknown/multiple/malformed calls, truncated replies, oversized output, exhausted steps and changed credentials still fail closed. The model cannot choose API writes, files, shell commands, signing or spending authority.

## Simulation and iPhone readiness

**Offline simulations: AVAILABLE.** Use [AE005.md](../zoora-agent-economy-simulator/review/AE005.md) for community-run, matched scenario batches, replay, CSV and self-contained HTML export. No wallet or paid endpoint is needed for the compiled runner. Those results remain SYNTHETIC.

**iPhone remote start/control: NOT AVAILABLE.** The current service binds to numeric loopback and rejects forwarded origins. Responsive Chrome mobile layout is verified; it does not create a phone-accessible host or prove Safari/vendor-wallet interoperability. The browser exports task JSON; the local CLI starts the model. A reviewed transport/origin/host design and remote control surface remain necessary.

## Remaining scope

AE-009 is complete within its documented local boundary. Public hosting/access, real vendor wallet and Safari interoperability, enrollment/moderation, host patch/Windows ACL verification and production backup/alert operations remain unfinished. The scanner's holder-provider and authorized live Telegram checks remain separate blockers. No customer wallet, custody, fund movement, transaction execution, paid model API, blockchain consensus or token-economics change was introduced.

[Connected setup and limits](AGENT_RUNTIME.md) · [Operations](OPERATIONS.md) · [Security boundary](SECURITY.md).
