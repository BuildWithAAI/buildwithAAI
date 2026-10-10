# AE-002 validation

Status: IMPLEMENTED, TESTED and VERIFIED as an offline simulator. Draft [PR #11](https://github.com/BuildWithAAI/buildwithAAI/pull/11) is stacked on AE-001 [PR #4](https://github.com/BuildWithAAI/buildwithAAI/pull/4). Neither this milestone nor its documentation is a live deployment or real-agent marketplace.

## Evidence

Verified implementation candidate: `fb5de051f59231bab51b070decaef74a05a19c26`. The final documentation commit runs the same complete checks again; its exact head and runs are recorded in PR #11. Foundation base: `8a58702718b86bc75da0b271b6943e50ee0af2a7`.

- [Task-market CI 38037604053](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38037604053): 31 tests on each of Linux and Windows, in both debug and release; strict formatting and clippy; committed lockfile; actual CLI run/replay/benchmark and negative cases.
- [Foundation regression CI 38037604149](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38037604149): 44 Linux / 43 Windows tests per profile, plus its existing CLI, replay, determinism and scaling checks. Its source, package version, lockfile and report fixtures are unchanged.
- Default and zero-budget report bytes match across debug/release and Linux/Windows. Python independently reproduced SHA-256; two hardcoded golden fingerprints passed.
- Cargo-audit 0.22.2 checked 38 lockfile packages against 1,296 RustSec advisories (database commit `7eebec69c352c7191b1f13eb95dd510eeca5d1de`): zero known vulnerabilities and zero warnings. This is a known-advisory check, not an independent security audit.
- [Permanent evidence](evidence/ae-002-2026-10-10.json) includes environment, exact candidate SHA, measured scaling, metrics, report hashes and dependency audit. Raw CI artifacts are retained for 14 days.

Each scaling run posts 5,000 overlapping tasks and processes 23,137 events. Linux simulated execution took 15.539 / 12.501 / 10.754 ms at 100 / 1,000 / 10,000 agents; Windows took 17.947 / 15.296 / 15.168 ms. Full verification took 64–71 ms. These are single CI samples including simulated refusals/failures/cancellations, not real work throughput, repeated benchmarks or a production SLA.

The default scenario posts 100 tasks: 70 complete, 21 fail and 9 cancel. Of 10,000 escrowed simulated units, 6,860 go to workers, 140 to the fee treasury and 3,000 return as refunds. These outcomes verify accounting; they do not establish profitable activity. The zero-budget scenario creates no tasks, escrow, payments or fees and records every refusal.

## Review findings and limits

The code review focused on authorization by simulated account ID, settlement atomicity, exclusive deadlines, duplicate settlement, lifetime admission bounds, input bounds, semantic replay and refund overflow. A client reserve protects the capacity needed for automatic refunds even when the account receives worker payments. Expiry slots are reserved before posting admission. Invalid business actions are journaled; hard integrity failures close the engine and prevent a final report.

There are no signing, networking, wallet or transaction dependencies added; unsafe code is forbidden. Files are bounded, strict reports reject unknown fields, arrays are bounded and outputs cannot overwrite an existing file. Local filesystem checks are not a sandbox and do not defeat races in attacker-controlled directories. Use trusted directories. Titles and digests are supplied data; do not include secrets. Simulation account IDs are not authenticated real identities. Hashes establish reproducibility, not work quality or authorship.

Remaining work: independently reviewed delivery and disputes/appeals; operator identities and shared ownership; abuse and reputation policy; external costs; human-facing visualization; actual agent adapters. No real integration was attempted or verified. No blockers remain for this bounded offline implementation; merging its stacked PR depends on review and the foundation branch. Public deployment and monetary settlement need separate authorization and design.
