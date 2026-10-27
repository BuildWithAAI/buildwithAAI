# BUILDWITHAAI DEVELOPMENT REPORT — AE-005

**IMPLEMENTED, TESTED and VERIFIED as bounded offline software. NOT DEPLOYED.** We can run reproducible community simulations and provide their SYNTHETIC datasets now. Authenticated agent participation, real LLM work, wallet ownership, blockchain receipts and live service operation remain unverified and unfinished.

Verified source: `676331a1e32c867cb6db88dcce7390ccc13ffaf2`. Branch: `feature/ae-005-community-simulations`. [Draft PR #14](https://github.com/BuildWithAAI/buildwithAAI/pull/14) is stacked on unmerged AE-004 #13, base `a38452719ced469472e94a5aa6295001079cfe2f`. The PR description records the final documentation/evidence commit and its exact-head CI. This report and the [evidence JSON](evidence/ae-005-2026-10-11.json) record the strictly verified source candidate rather than claiming a commit verified itself before CI ran. No merge or public deployment occurred.

## Completed work and changed files

- `src/community.rs`, `tests/community.rs`: declared profiles, permanent wallet-label/handle uniqueness, reserved rename history, owner profile controls, projects/contributors/artifact digests, replies, posting limits, offers, provider capacity, exact order-to-agreement binding, related-operator flags and complete typed replay. Deactivation cannot freeze funds or fabricate a return transfer.
- `src/community_scenarios.rs`, `configs/community*.toml`: pinned seeded intentions, balanced/spam/provider-offline scenarios, matched workloads, multi-seed batch summaries and full regeneration checks. Actors and outcomes are scripted; no LLM runtime is present.
- `src/community_export.rs`, `community-viewer/*`: verified CSV and self-contained responsive HTML exports, absent-data indicators, spreadsheet text guards, exact large integer payloads, directory search/history, inactive filters, project records, order pagination and source evidence.
- `src/direct.rs`, `lib.rs`, `main.rs`, `viewer.rs`: a read-only direct-journal getter and modular CLI/viewer integration. Existing direct-payment rules, historical research ledgers and export identities remain intact.
- `scripts/community_evidence.py`, `scripts/viewer_browser.mjs`, `.github/workflows/zoora-review-market.yml`: real CLI integration, independently reconstructed fingerprints/accounting, rehashed-forgery rejection, pinned canonical outputs, supported workload-dimension checks and actual Chrome rendering. Final workflow checks committed source formatting without rewriting it.
- `examples/community-balanced.{json,csv,html}`, `examples/community-batch.{json,csv}`: generated source-backed datasets/viewer, reproduced byte-for-byte by CI. No placeholder market data, customer balances or invented fees/profit.
- `AE005.md`, this report, the evidence JSON, project/module READMEs and `projects/AGENT_ECONOMY.md`: setup, metric definitions, provenance, findings and remaining live work.

No new dependencies or lockfile changes. No consensus, token economics, wallet secrets, signer, customer-fund control or production infrastructure changes.

## Tests and CI

All nine jobs passed on the exact source commit:

| Workflow | Verification |
|---|---|
| [Review CI 38110447002](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38110447002) | 108 tests per platform/profile: 26 community, 25 allocation, 18 direct, 39 legacy review. Linux and Windows; Debug and Release. |
| [Marketplace regression 38110446846](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38110446846) | 31 tests per platform/profile; existing CLI, replay, canonical vectors and scaling passed. |
| [Foundation regression 38110446796](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38110446796) | 44 Linux / 43 Windows tests per profile; existing invariants, CLI and scaling passed. |

Zero test failures, ignored tests or clippy warnings. Strict rustfmt, locked builds and release execution passed. Three cargo-audit 0.22.2 scans covered 37/38/39 packages in the foundation/market/review lockfiles; each reported zero known vulnerabilities, zero warnings and no ignored advisories. RustSec database commit `7eebec69c352c7191b1f13eb95dd510eeca5d1de`, 1,296 advisories. Advisory scanning and our code/test review are not an independent security certification.

The actual binary generated, replayed and exported all three scenarios and a nine-run batch. Debug/Release report bytes match. Linux/Windows produced identical bytes for 11 new community JSON/CSV/HTML outputs and six existing review/direct outputs. Both platforms regenerated all five committed community examples exactly. CLI checks reject overwrites, unsupported dimensions and forged reports before creating an export. The independent artifact audit reconstructed 13 run/community/direct/intention/batch hashes on each platform, reconciled amounts and offer bindings, checked missing timestamps/slots and checked CSP hashes. Artifact ZIP digests were verified against GitHub metadata.

Chrome 154.0.8037.97 and Node v22.23.3 passed 13 community browser checks and all 11 earlier viewer checks. Community checks cover actual export rendering, order pagination, historical handle search, empty state, contributors/replies, mobile page overflow, inactive profiles, unavailable offers, hostile text, blocked connections, exact large amounts/seeds and invalid wallet-boundary errors. Zero uncaught exceptions or external page requests were recorded. Desktop/mobile screenshots were visually reviewed; strict-source screenshots match those reviewed bytes.

Initial compile/lint defects and integer-display precision issues were fixed before strict-source verification. The temporary development formatter was removed; no failing checks were bypassed. A later documentation/evidence candidate passed the browser assertions but failed while deleting Chrome’s temporary profile (`ENOTEMPTY`, run 38110849567, job 114385914204). Bounded filesystem retries now handle transient profile teardown; persistent cleanup errors still fail CI. The PR description records the succeeding final exact-head run.

## Real integrations verified

**VERIFIED:** compiled Rust CLI → seeded community model → AE-004 direct transcript → typed replay/regeneration → independently checked JSON/CSV → self-contained HTML → actual Chrome DOM. These are functioning offline software integrations.

**NOT STARTED / UNVERIFIED:** authenticated public registration, persistent live APIs, LLM agents/tools, signed wallet ownership, real blockchain receipt ingestion, user-wallet signing, live transfers, actual delivery quality and deployed operations. Profile/operator/wallet labels and capabilities are declared fixtures. An acknowledgment or artifact hash does not prove useful AI work.

## Measured simulation data

Default seed 42: 20 declared profiles, 10 projects and offers, 100 intended ordinary tasks. Amounts below are **SYNTHETIC_UNIT**, with no monetary value.

| Scenario | All admitted orders | Scripted acknowledgments | Recorded payments | Voluntary returns | Net transferred |
|---|---:|---:|---:|---:|---:|
| Balanced | 100 | 62 | 10,000 | 1,150 | 8,850 |
| Injected unpaid reservations | 160 | 0 | 0 | 0 | 0 |
| Five providers inactive | 49 | 29 | 4,900 | 450 | 4,450 |

All three share identical intended tasks. Spam admitted 160 injected unpaid reservations before ordinary requests, then rejected all 100 ordinary requests for provider capacity. Three excess posts were refused. This exposes starvation despite bounded posting/admission; it does not demonstrate an effective spam solution. Provider unavailability rejected 51 ordinary requests without recording payments for them. Accepted-order and acknowledgment rates include every admitted order, including injected spam, and are not productivity, quality or adoption estimates.

Balanced activity leaves 20 unresolved return requests and 32 orders with positive net payments but no delivery digest. Returned payments and missed deliveries remain distinct: no dispute, refusal, deactivation or expiry reverses a transfer. Wallet balances, gas/transaction fees, USD/SOL rates and realized/unrealized P/L are unavailable. Net transferred is not profit.

The batch repeats all three scenarios for seeds 7, 42 and 99; it is a small programmed experiment, not statistical evidence about real agents. Canonical fingerprints:

- Balanced: `f4a6cff4db298f06a23a59d4f07cca87d779f5f92f2bb6a9e10358b810b79bf4`.
- Spam reservations: `96f736d30b1ea42625a69b3af7811ca25a86071c008d0a9bd9c617856177b681`.
- Provider offline: `913ca89a88d8476c850bdd44e01ff03ddf9550a3a5b04a6877cfa8465f1af94b`.
- Nine-run batch: `16596c4f754a2fffea1991c8f3a44eeb11aa8d3c1dc823cc078581c1ccc5d326`.

Supported workload checks exercised 128 profiles, 500 intended tasks and pending limit 32 per provider. Balanced admitted 500 and recorded 296 scripted acknowledgments. Spam admitted 2,048 unpaid reservations, refused all 500 ordinary requests and recorded zero payments. Both replayed, reconciled and respected capacity on Linux and Windows. Raw CI timings in the evidence file include process/report I/O and internal verification; they are single samples, not a live transaction rate, useful-agent throughput or SLA.

## Remaining defects, blockers and next milestone

No known blocking defect remains for this bounded offline milestone. Known model limits remain: unauthenticated declared roles, hidden aliases/collusion, unpaid-reservation starvation, unverified delivery quality, bounded synchronous replay, unsigned editable HTML and synthetic quote-bound receipts. Full journals are retained in JSON; the viewer deliberately shows only the first 100 posts.

A future real receipt adapter must preserve observed transfers even when they violate agreed prices/deadlines, separately from policy interpretation. Current fixture admission is not a complete chain accounting ledger. The platform records requests and voluntary returns; it has no signer, customer wallet balance, freezing or forced-refund authority in this implementation.

**Local simulations are unblocked.** See [AE005.md](AE005.md) for commands and configuration. Open the [community viewer](examples/community-balanced.html), inspect the [raw run](examples/community-balanced.json), use the [order CSV](examples/community-balanced.csv), or compare the [batch CSV](examples/community-batch.csv).

**Live service is BLOCKED** on authenticated agent/workspace services, persistent storage, runtime/tool permissions, evidence-preserving real receipt ingestion and authorized deployment/operations. Public deployment and live wallet execution are separate authorization gates. No hardware setup or production credentials were required to run these CI simulations.

Next milestone: authenticated agent registration and persistent community/workspace APIs, with explicit ownership checks, admission-abuse defenses and a controlled real-agent test environment. That work must preserve the user-controlled wallet boundary and label observed runtime data separately from these fixtures.
