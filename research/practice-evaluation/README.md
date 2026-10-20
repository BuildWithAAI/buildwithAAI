# Paper cohort capture and evaluation

A separate research observer for the causal worker in draft PR #58. It collects the final account rather than treating the worker's last pre-decision snapshot as final performance. It never invokes a model, submits an order, advances the owner clock, changes weights, or accesses a wallet.

The current integration targets the existing SYNTHETIC_MEME_V1 teaching market and its exact accounting policy. All values are demo units. This is neither a historical market backtest nor evidence of trading edge.

## Workflow

1. Enroll each paper account at tick zero and prepare its host-selected worker scope.
2. Save a private, immutable cohort plan BEFORE the first worker observation. Its entries declare every experiment, instance, episode, agent and model pipeline, including trials that may later fail. A plan supports at most 16 distinct accounts.
3. Run the existing practice-step worker. Only the host/owner advances the synthetic clock.
4. Stop the worker and capture each account with its own AGENT credential. Capture also works after the original worker scope expires, provided the read credential remains authorized. A rotated read credential can observe the same pinned agent.
5. Save a bundle binding the plan and each exact capture. Run the offline evaluator. Missing, failed, unfinished and invalid trials remain visible and block a cohort aggregate.

Run commands from the repository root with the hashed community runtime dependencies installed:

~~~sh
python research/practice-evaluation/paper_evaluation.py capture \
  --journal-dir /private/trial-journal \
  --credential-file /private/agent.credential.json \
  --port 8765 --out /private/final-capture.json

python research/practice-evaluation/paper_evaluation.py evaluate \
  --plan /private/cohort-plan.json \
  --bundle /private/cohort-bundle.json \
  --out /private/cohort-report.json
~~~

A remote capture requires the same host-selected --community-origin used in the worker manifest. The existing client requires HTTPS, rejects redirects, and verifies instance and agent pins. Capture uses only authenticated GETs, with a 60-second deadline, two bounded receipt pages and repeated market/account reads. Concurrent changes cause rejection. No bearer is saved in the capture.

The evaluator makes no network calls. The capture, plan and bundle must be private regular JSON files, with at most 1 MiB each. Its output is exclusive and synced: an existing file is never replaced. Exit codes are 0 for a complete cohort, 2 for an incomplete cohort with a saved report, and 1 for rejected input/storage failure.

## Plan and bundle

A plan has protocol ZOORA_PAPER_COHORT_PLAN_V1, plan_id (32 lowercase hex), created_at_ms (integer milliseconds), unit MICRO_DEMO_USD, and entries. Each entry has exactly:

~~~json
{
  "experiment_id": "11111111111111111111111111111111",
  "instance_id": "22222222222222222222222222222222",
  "episode_id": "33333333333333333333333333333333",
  "agent_id": "44444444444444444444444444444444",
  "model_pipeline_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "label": "Host-declared trial label"
}
~~~

Use real identifiers from the enrollment and scope; the example identifiers are placeholders. No account may appear twice in a plan. The plan timestamp must precede all retained trial observations. This is only an internal clock check: a host who controls files/clocks can fabricate preregistration. There is no external timestamp or identity attestation.

A bundle has protocol ZOORA_PAPER_COHORT_BUNDLE_V1, plan_sha256, and entries:

~~~json
{
  "experiment_id": "11111111111111111111111111111111",
  "journal_dir": "trial-journal",
  "capture_file": "final-capture.json",
  "capture_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
~~~

Paths may be absolute or relative to the bundle file. plan_sha256 is SHA-256 of canonical JSON WITHOUT a trailing newline, using the community canonical function. capture_sha256 is SHA-256 of the exact saved capture bytes INCLUDING its newline; capture prints it. A missing planned entry produces a MISSING report row. Extra, duplicate, or reused entries are rejected. Journal hashes must match the exact observation/decision/receipt evidence at capture time: collect again if the worker later writes another record.

## What is measured

A COMPLETE row requires a closed episode at tick 120, no pending order, at least one sealed observation, no retained inference/delivery failure, and complete receipt reconciliation. Every settled order must match a sealed decision; every intended trade without a recorded failure needs a terminal receipt. A terminal receipt read by the observer may reconcile a worker that stopped before writing its settlement, without modifying the worker evidence.

The accountant independently reconstructs integer cash, token positions, fees and gas from ordered receipts. Rejected fills still consume gas. It compares these values to the captured account. It recomputes the marked exit value from the public effective reserves, real quote liquidity, stage and fee policy; virtual quote balances cannot fund a withdrawal.

The baseline is the unchanged initial demo cash balance. The report separates cash change from a CURRENT-RESERVE EXIT ESTIMATE for remaining holdings, including a further gas charge per exit. The estimate is not realized profit and is not a guaranteed next-tick fill. Continuous drawdown remains explicitly server-reported. The receipt stream is an authenticated server assertion, not independent external execution attestation.

The whole cohort gets descriptive sums only if every declared trial is complete. No statistical significance, biological learning, market generalization or profitable strategy is claimed. Matched comparison strategies, independent holdouts, historical replay, external attestation and biological model adapters remain further work.

## Validation

The focused suite runs against an actual local HTTP/SQLite server: a synthetic model-protocol fixture submits a buy, a partial sell and an intentionally rejected minimum-output order. The owner closes all 120 ticks; the server replay audit is also checked. This fixture is explicitly not an installed learned model.

Linux and Windows CI run the suite normally and with Python optimization. The artifact retains the exact private synthetic plan, journal, capture, report and source pins, excluding credentials and backend state. Evaluate the retained bundle offline to reproduce its accounting report. Raw source byte hashes can differ between operating-system checkouts because of line endings.
