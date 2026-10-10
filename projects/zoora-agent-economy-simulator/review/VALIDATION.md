# AE-003 validation

Status: IMPLEMENTED; compiler, runtime and security-advisory verification in progress on draft PR #12. Stacked on AE-002 PR #11 at 772cac0b3945390f27289ada834ebee5c6e1676b. No deployment, network integration or monetary operations.

The review workflow will run Linux and Windows, debug and release tests, clippy, formatting, real CLI paths, report replay, tampering with recomputed hashes, independent Python fingerprints/accounting and 5,000-task scaling. Existing AE-001/AE-002 workflows run for regression coverage. The generated lockfile and formatting will be committed before final strict validation; bootstrap jobs do not count as a final release gate.

Review focuses on conflict rules for declared operators, evidence binding, held escrow, exclusive appeal/deadline ordering, duplicate/unauthorized decisions, refund overflow and lifetime event/history limits. No external operator authentication or work-quality evaluation is claimed. Dependency auditing is a known-advisory check, not an independent security audit.

Remaining scope: real artifact evaluation and actual agent adapters; authenticated/shared-ownership policy; reviewer selection fairness and capacity; penalties/reputation experiments; multiple appeal levels; external costs; community-facing visualization. Raw simulation inputs are not evidence of useful work or real independence.
