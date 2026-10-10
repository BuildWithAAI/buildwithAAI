# BUILDWITHAAI DEVELOPMENT REPORT — AE-004

**IMPLEMENTED, TESTED and VERIFIED as offline software. NOT DEPLOYED.** User-wallet signing and real chain receipt verification are NOT STARTED. Historical escrow is a SYNTHETIC research comparison; direct payments cannot be reversed by this platform.

Verified source candidate: `4316408e26df85ce8e4a72a5ebbc40397f94d2e0`. Branch: `feature/ae-004-noncustodial-allocation`. [Draft PR #13](https://github.com/BuildWithAAI/buildwithAAI/pull/13) is stacked on unmerged #12. Its description records the final documentation/example commit and exact final CI results. The committed [evidence JSON](evidence/ae-004-2026-10-10.json) references the earlier strictly verified source candidate; this avoids claiming a commit verified itself before CI ran.

## Completed and changed files

- `src/direct.rs`, `tests/direct.rs`: user-wallet payment/delivery/dispute transcript, request/refusal, partial voluntary returns, remaining requested amount, provenance, duplicate protection, bounded replay and explicit absence of custody/signing/freezing/reversal powers.
- `src/allocation.rs`, `src/experiments.rs`, `tests/allocation.rs`, `configs/experiments.toml`: declared-operator fair/capacity-aware research allocation, reservation accounting, separate report identity and five matched adversarial scenarios.
- `src/engine.rs`, `types.rs`, `report.rs`, `lib.rs`, `main.rs`: compatible opt-in engine and CLI integration. Legacy report identities, default vectors and financial rules remain unchanged.
- `src/viewer.rs`, `viewer/*`: verified read-only export, direct-payment summaries, policy comparison, exact integer totals, status/search/pagination, evidence and responsive layout. CRLF/CR assets normalize before CSP hashing.
- `scripts/allocation_evidence.py`, `scripts/viewer_browser.mjs`, `.github/workflows/zoora-review-market.yml`: actual CLI integration, independent golden/hash/accounting checks, scaling, real Chrome QA and committed example comparisons. Final workflow enforces fmt checks rather than rewriting source.
- `.gitattributes`, `examples/direct.json`, `examples/direct.html`: source-backed offline demo with LF checkout for reproducible bytes.
- `AE004.md`, this report, `evidence/ae-004-2026-10-10.json`, module/project README files and `projects/AGENT_ECONOMY.md`: reproducible setup, product custody boundary, evidence and next milestone.

No foundation/marketplace source, lockfile, token economics, consensus, deployed contract, wallet secrets or production infrastructure changes.

## Tests and CI

All nine jobs passed on the source candidate:

- [Review CI 38072227396](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38072227396): **82 tests** (25 allocation/experiments, 18 direct workflow, 39 legacy review) on Linux and Windows in both Debug and Release; zero failures, ignored tests or clippy warnings; strict rustfmt; locked builds.
- [Marketplace regression 38072227399](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38072227399): **31 tests** per platform/profile, existing CLI/replay/scaling and canonical vectors.
- [Foundation regression 38072227395](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38072227395): **44 Linux / 43 Windows tests** per profile, existing invariants, CLI and scaling.
- Cargo-audit 0.22.2: **39 packages**, **0 known vulnerabilities**, **0 warnings**, no ignored advisories. RustSec commit `7eebec69c352c7191b1f13eb95dd510eeca5d1de`, 1,296 advisories. This is advisory scanning, not an independent security audit.

The real binary generated/replayed direct and experiment reports, rejected recomputed-hash forgeries, refused overwrites/invalid inputs and verified exports before writing. Python independently reconstructed canonical hashes and financial conservation. Linux/Windows and Debug/Release produced identical report bytes; the two platforms produced identical viewer bytes. Final CI also compares freshly generated direct JSON/HTML against the committed examples.

Canonical golden fingerprints:

- Experiments: `caad08ff832700c7bc3ae47d9233b344374310aebb1bd7728ba5c31ac9e2db9e`.
- Direct workflow: `d80b7f813b2e6afae0995131248a4817f8026e8a024e21ca06859b919c59bc94`.
- Legacy AE-003 and AE-002 vectors remain enforced by their existing evidence scripts.

## Integration and measured outcomes

**Verified:** Rust CLI → typed operation replay → independently checked report → offline HTML → real Chrome DOM. Chrome 154.0.8037.97 and Node v22.23.3 passed 11 browser checks covering actual rendering, policy selection, pagination, empty/status filtering, mobile overflow, direct-mode labels, hostile title text, connection-blocking CSP, invalid-ledger error state and exact amounts beyond JavaScript's safe integer range. No uncaught exceptions or external page requests were recorded. Desktop/mobile screenshots were visually reviewed. Browser artifacts are available in the CI run.

**Not verified:** blockchain transactions, wallet ownership, live signing, AI agent runtime identity, delivery quality, live forum traffic, or production operations. No network/transaction/signer adapter is present.

In the matched 100-task sample, baseline reviewer 2 made 88 of 117 decisions (**75.21%**); the allocated policy's largest declared operator made 16 of 117 (**13.67%**, basis-point truncation). Nine accounts under one declared operator produced the same operator decision distribution as the single-account control. This is a synthetic allocation result, not proof of real independence or performance gains.

Capacity stress admitted 16 tasks and rejected 84 before research escrow funding. The conflicting-role scenario rejected 100 primary-reviewer/worker conflicts plus unauthorized verdict attempts without changing legitimate payouts. The spam scenario admitted 32 of 124 tasks: 24 nonresponsive tasks occupied early slots, exposing starvation. All reservations released by completion/expiry.

The direct example records **500 paid / 150 voluntarily returned / 350 net transferred**, three refund requests, one recipient refusal, and two unresolved repayment requests. A refused request and an overdue payment remain unrecovered. Partial request fulfillment tracks remaining requested amount separately from total original payment. These are fixtures, not customer money or observed transfers. Wallet balances, fees and profit are not fabricated.

Allocation scaling processed **5,000 concurrent tasks** with **100 / 1,000 / 10,000 accounts**, **30,000 policy events** and **10,000 assignment/release events** per run. Reports replayed and conserved supply with no pending reservations. Raw CI timings in the evidence file are single samples, not an SLA, live transaction rate or useful-agent throughput.

## Remaining defects, blockers and next milestone

No known blocking defect remains for this bounded offline milestone. The initial Windows CSP/newline defect was fixed and the full integration re-run passed on both platforms. Partial refund request accounting was strengthened before source candidate verification.

Known model limits remain: unauthenticated declared identities; hidden collusion; starvation from nonresponsive tasks; synthetic, quote-bound receipt fixtures; no chain verification, balance accounting, real fees, reputation enforcement or signing. A real receipt adapter must retain observed transfer facts and quality flags even when they do not fit agreement terms; fixture admission rules cannot substitute for a complete chain observation ledger.

The broader live product is **BLOCKED** on authenticated agent/workspace services, a read-only real receipt adapter, user-controlled signing/permission design, and separately authorized deployment/operations. This release does not require purchasing infrastructure or handing the platform wallet keys.

Next milestone: agent registration/discovery, work offers, creative project records and community activity connected to the direct-payment boundary. See [AE004.md](AE004.md) for setup and scope. No automatic merge or public deployment has occurred.
