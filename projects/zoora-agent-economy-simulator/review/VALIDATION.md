# AE-003 validation

Status: IMPLEMENTED, TESTED and VERIFIED as an offline review policy simulation. Draft [PR #12](https://github.com/BuildWithAAI/buildwithAAI/pull/12) is stacked on [AE-002 PR #11](https://github.com/BuildWithAAI/buildwithAAI/pull/11). Neither this module nor its documentation is a live deployment or an authenticated agent marketplace.

## Exact evidence

Verified implementation candidate: `af51482cc96fb23d082ee273f8b3c27c68f56ad3`. The final evidence/golden-check commit runs all checks again; its exact head and CI links are recorded in PR #12. Base: `772cac0b3945390f27289ada834ebee5c6e1676b`.

- [Review CI 38067521693](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38067521693): 39 tests per Linux/Windows platform in debug and release, strict formatting/clippy, committed lockfile and actual CLI paths.
- [Marketplace regression CI 38067521572](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38067521572): 31 tests per platform/profile and existing golden fingerprint, replay, CLI and scaling checks. The package version, report format, fixtures and financial rules are unchanged. The adapter adds a read-only task lookup and a batch-processing API; global audits still run at public advance/completion boundaries.
- [Foundation regression CI 38067521608](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38067521608): 44 Linux / 43 Windows tests per profile and its existing CLI/scaling checks. Its source, package version and lockfile are unchanged.
- Default and zero-budget report bytes match across debug/release and Linux/Windows. Python independently reproduced the canonical digest and checked balance/fee/refund conservation. Modified journals with recomputed fingerprints were refused. The resulting fingerprint values are retained as golden checks in the final CI candidate.
- Cargo-audit 0.22.2: 39 lockfile packages, 1,296 RustSec advisories, database commit `7eebec69c352c7191b1f13eb95dd510eeca5d1de`, zero known vulnerabilities and zero warnings. This does not constitute an independent security audit.
- [Permanent evidence](evidence/ae-003-2026-10-10.json) contains exact source identity, environment, per-platform measured scaling, metrics, report hashes and audit details. Raw CI artifacts are retained for 14 days.

Each scaling run posts 5,000 overlapping tasks: 29,523 review-policy events and 22,559 escrow events at 100/1,000/10,000 accounts. Linux simulation took 34.856 / 25.399 / 27.484 ms; Windows took 53.599 / 51.939 / 61.252 ms. Full verification took 225–422 ms. These single CI samples include configured failures/refunds/appeals, not actual agent work, repeated benchmarks or an SLA.

The default scenario posted 100 tasks: 38 approved completions, 8 review refunds, 28 failures before delivery, 13 cancellations and 13 deadline expirations. It recorded 17 disputes, 53 primary verdicts, 23 appeals, 16 appellate verdicts and 5 overturned verdicts. Of 10,000 escrowed simulated units, 3,724 were paid to workers, 76 went to fees and 6,200 were refunded. These are mechanical outcomes, not profitable activity. The zero-budget scenario funded no escrow or review cases.

## Findings and remaining scope

Tests cover held escrow during review, both appeal directions, upheld decisions, unresolved review/appeal refunds, exclusive windows, operator conflicts and aliases, evidence binding, unauthorized/duplicate actions, post-submission bypass attempts, overflow-safe refunds, incremental operation replay, recomputed-hash forgery, event saturation and reserving the final history slot. Existing golden vectors verify the batching adapter preserves legacy financial output.

Primary and appellate review decisions are counted by reviewer. In the default sample, reviewer 0 performed 51 of 69 decisions. The deterministic lowest-eligible-ID policy concentrates work; it is an experimental policy with visible outcomes, not a fair allocation or Sybil-resistant identity system. Declared different operators are a modeled assumption. Artifact and rationale digests bind supplied references but do not establish quality, truth or blame. Refund-driven failure counters remain mechanical, not reputation scores.

No networking, signing or wallet dependencies are introduced; unsafe code is forbidden. Strict bounded inputs and new-only output files are application safeguards, not a sandbox or defense against file replacement races in untrusted directories. Supplied terms and digest references must not contain secrets. No externally verified operator, third-party integration, real artifact evaluation, monetary transaction or deployment was attempted.

Remaining work: fair/capacity-aware reviewer allocation and collusion experiments; authenticated/operator ownership policy; real artifact evaluation and actual agents; reputation/penalty experiments; external costs; community-facing visualization. No known blocking defect remains for this bounded offline implementation. Merging depends on review and its stacked base; deployment and live settlement remain separately authorized work.
