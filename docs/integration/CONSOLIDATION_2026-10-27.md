# Source consolidation — October 27, 2026

The founder requested that all developed work be merged correctly into the default branch. This integration combines the five development tips that collectively contain all 71 open draft PR heads observed at baseline. It preserves their histories rather than squashing the development into unrelated files.

Baseline main: `7e4ae535ce3ba16cdf8544e9cb57533e4370e5de`. The [source-head manifest](SOURCE_HEADS_2026-10-27.json) records every original PR head/base and all five tips. The consolidation merge commit retains the baseline main and all five source tips as parents; follow-up validation fixes retain that ancestry, and the enclosing PR merges it into main. Source consolidation does not assert that every roadmap item has been implemented.

| Development line | Tip PR | Source head |
| --- | --- | --- |
| research | [#79](https://github.com/BuildWithAAI/buildwithAAI/pull/79) | `f3ae05c67517a48f99b639e78a7d220839af4983` |
| community | [#59](https://github.com/BuildWithAAI/buildwithAAI/pull/59) | `fc42d8b36da77c58430e4a7594a30a0225883b6c` |
| scanner | [#10](https://github.com/BuildWithAAI/buildwithAAI/pull/10) | `97108a271face220aef6296fddb2e18abdb210b5` |
| leasing | [#49](https://github.com/BuildWithAAI/buildwithAAI/pull/49) | `19ef9c539a32ee190a0f09c9e6c416ca3b00279f` |
| sfp | [#27](https://github.com/BuildWithAAI/buildwithAAI/pull/27) | `6d9e006e3934843dfd7e662f52e0ad7db009f135` |

## Conflict resolution and completeness

- Three-way merges used the actual common baseline for each line. Conflicts were confined to `README.md`, `docs/CURRENT_STATUS.md` and `tasks/BACKLOG.md`; no runtime source file required a content resolution.
- The combined tree contains all **907 distinct input file paths**, with no input path omitted. The latest community source takes precedence over its older ancestor in the leasing line; leasing-specific files are retained in their own package.
- The backlog keeps both the distinct AAI-T-041 SFP task and the separately described VL queue. Its JSON retains 41 task records.
- The README is refreshed as a consolidated source catalogue. The current status is rewritten around the actual source packages and remaining limits. Earlier checkpoint text is retained in `docs/STATUS_BEFORE_CONSOLIDATION_2026-10-27.md`, in the same directory so its relative links keep their original meaning.
- Research/community/scanner runtime code, package versions, database schemas, protocol IDs, model/controller pins and financial gates are unchanged by conflict resolution. Ecosystem runs continue to use their declared immutable component checkouts.
- Shared root CI installs the existing pinned scanner runtime before running the combined root suite. The brain-foundation workflow preserves all 609 original research tests, including scanner-feed contracts, on Python 3.14 and Linux/Windows through `scripts/run_research_tests.py`. Scanner runtime tests remain in the complete 763-test Linux suite on their declared Python 3.11/3.12 matrix; scanner support is not silently expanded to Windows or Python 3.14. Root and scanner workflows check out the exact PR head using the already-used pinned checkout/setup actions, with persisted credentials disabled. The consolidated scanner lint check also exposed two unused consensus-test imports; only those imports were removed, with no test or assertion deleted.

## Validation and interpretation

Local unit/CLI checks and the full exact-head GitHub Actions run are recorded in the integration PR. The combined CI retains scanner, neural/research, advisory learning, service exchange, community/browser/container, SFP and Rust module checks; old workflows are not replaced with an untested aggregate smoke test. Inspect the final PR head/checks and main-branch readback for the actual merge result.

The initial dependency-free root run exposed the missing scanner `waitress` dependency in the shared job. Scanner readiness tests passed with the dependency installed, and the root workflow now installs the existing pinned requirement. This is an integration setup fix, not a claimed fix for the earlier intermittent `BLUEPRINT_RESTART_DUPLICATE` or `SERVICE_NOT_FOUND` observations.

The original PR bodies and source records remain dated evidence. A merged PR or green CI does not commission services, prove financial performance, qualify an unsupported blueprint or grant spending authority. See [current status](../CURRENT_STATUS.md) and the [connection inventory](../../research/ecosystem/CONNECTIONS.md).
