# AAI ecosystem research integration

This connects AAI.fun source/model artifacts to pinned scanner mint parsing and the existing community job/artifact/activity APIs. It is an executable research workflow inside BuildWithAAI, with disposable local identity records. It does not merge the draft stacks or deploy their services.

The [bounded Reef learning layer](LEARNING.md) consumes these verified job artifacts, stores linked feedback in Reef, evaluates finite report-review workflows, and retains advisory versions. The native workflow runs it after this integration passes. Its observer snapshot binds this package's public snapshot by hash.

The [specialist behavior layer](BEHAVIOR.md) extends that handoff with delayed-outcome pattern memory for paper trading, simulated contract authorization, limited static code review and operational scope checks. Four actual sandbox jobs feed frozen task evaluation and Reef selection. Verified historical price-direction feedback is retained separately; the original authority controls and ABSTAIN gate remain in force.

~~~mermaid
flowchart TD
  S["Verified source history"] --> H["Research handoff"]
  M["Frozen readout"] --> H
  R["Current mint inspection"] --> H
  H --> J["Agent research jobs"]
  H --> G["Research gate"]
  J --> A["Artifacts and SQLite audit"]
  A --> O["Observer and assistant JSON"]
  G --> O
~~~

## Connected scope

| Component | Executed interface | Limit |
| --- | --- | --- |
| AAI.fun history | Original raw-source reconstruction, joined dataset and assessment | Existing decoder/coverage limits apply |
| Frozen FlyVis readout | Verified trained package applied to target feature exports | The bridge verifier does not execute FlyVis; native execution is a separate preceding workflow step |
| AAI scanner | Existing mint-account parser and provenance receipt on newly retained RPC bytes | Full scanner HTTP, market, holder and wallet-forensics services are not connected by this bridge |
| Brain registry/gate | Actual ModuleSpec readiness and explicit transaction-horizon task | The older millisecond coordinator cannot consume this task; its adapter is blocked |
| Agent community | Authenticated enrollment, project membership, submit/claim/complete jobs, published artifact digests, private activity and Store.audit | Local sandbox records, deterministic public test keys, no users or real funds |
| Observer / assistant | Allowlisted public snapshot and hash-linked activity-event JSON | No hosted client, assistant tool installation or live stream |
| Agent payments / token rewards | No settlement adapter is invoked | No value transfer, tokenomics change or income claim |
| Zoora native chain | No protocol changes or chain connection | Source assertions and local database records are not a new Zoora ledger |
| Telegram / Discord | No delivery adapter is invoked | No external messages |
| Other asset classes and additional brains | Reported as unavailable | No invented connectors, voters or inference evidence |

components.json pins exact same-repository commits for scanner and community. The driver requires clean, separate checkouts, verifies commits and tracked/untracked changes before and after execution, and imports only their named packages. Existing project branches stay intact. The existing community hash-locked runtime is installed separately from the native FlyVis environment.

## Data and task boundaries

The trained readout package is independently verified and reconstructed. A new target source is verified separately. Target inference uses the frozen training normalization/weights; it never fits target labels or checks future outcomes. Every observed transaction receives a forecast, including final observations without labels.

For neural input, the target export must bind its target dataset and the registered feature pipeline. The model's original feature export binds its training data; a different target export must not be mistaken for retraining. Retained metadata and hashes do not attest that a model ran. The hosted native job independently loads the frozen circuit and regenerates its native features in two processes before this bridge runs. Bridge-only verification always reports feature execution attestation as NOT_ESTABLISHED.

The target is later observed trade-price direction in transaction units, with a slot cap. It is not a millisecond horizon, executable return or profit target. The older coordinator's task-unit adapter is explicitly blocked. There is one available frozen circuit experiment, no established calibration and no second qualified model. Forecasts stay outside an eligible vote; the gate returns ABSTAIN / NO_EXECUTION.

Mint snapshots are read now from the allowlisted mainnet endpoints, after retained source history. getGenesisHash and getAccountInfo are the only methods. Each account read uses finalized commitment and minContextSlot at least the target source end. This is a lower slot bound, not a historical account-state query. Raw request/response bytes, digests and retrieval timestamps are retained. The scanner parser checks mint layout and reports authorities/extensions with the original source receipt.

Current mint state does not become point-in-time historical risk, a rug/bundle label or a token safety guarantee. Missing/unsupported accounts remain explicit. Available decimals must agree with the recorded trade source. No current scanner observation enters historical training features or labels.

Mint intake bounds are 32 base assets, 256 KiB per response, 8 MiB total raw and 12 MiB stored files, with spaced requests and a 600-second request-start budget. Excess data, RPC failures and inconsistent sources stop the integration; received failure bytes remain available. Existing source, neural and job-report limits also apply.

Transient source-intake failures receive at most one automatic resume when a finalized range is already fixed and a retained request shows HTTP 429/5xx or a transport failure. The original attempt and exact range remain intact; a sibling recovery receipt records the failure and outcome. Semantic/source-validation errors and missing anchors are not retried or switched to another sample.

## Agent workflow and verification

Two disposable agent records share a research project. One audits retained sources; the second computes the uncalibrated forecast report. These are Python research handlers using the actual job API, not autonomous language-model sessions.

Each handler runs after a successful claim. Reports are written before completion and bound by exact file SHA-256 and byte length. Repeated submission/completion is checked for idempotence. Cross-agent private job reads must be denied. Activity must show completed records without claiming continuous model runtime.

Only local authentication challenges use reproducible public test keys. They are not real user wallets, transaction signers or funded identities. Never fund or reuse those keys. Bearer credentials stay in memory; the temporary owner credential is removed. Artifacts whitelist report files and the database, excluding credential files.

A second offline process reconstructs inputs/forecasts/scanner parsing, audits SQLite relationships and the audit chain, and compares job/artifact digests against actual report bytes. Disposable copies first pass verification; altered reports, database bindings and public execution flags must then be rejected. The original package must still pass afterward.

The database proves internal job/artifact consistency. Job reports remain CLIENT_DECLARED and do not independently attest model execution or an externally performed service.

Workers use isolated Python, a sanitized environment, bounded subprocess time and guards against accidental Python socket connections. These controls are not an OS security sandbox.

## Commands and retained evidence

Use clean checkouts of the same BuildWithAAI repository at the commits in components.json, and install the pinned community requirements. The native package must already contain neural-training, real-input and real-features.json:

~~~sh
python scripts/run_ecosystem_research.py run --native-directory /private/native-trade --scanner-source /private/scanner-checkout --community-source /private/community-checkout --output /private/connected
python scripts/run_ecosystem_research.py verify --directory /private/connected --scanner-source /private/scanner-checkout --community-source /private/community-checkout
python scripts/run_ecosystem_research.py negative-checks --directory /private/connected --scanner-source /private/scanner-checkout --community-source /private/community-checkout
~~~

Verification is repeatable without network calls or new job submissions. The component checkouts and pinned community runtime are required for offline replay.

The package retains copied training/target sources, target neural features, raw mint captures, private research reports, jobs.json, the local database, source/gate evidence, public snapshot/events and the integration summary. No bearer credential is included. Restore trusted local database permissions if a ZIP download changes file modes.

Only public-snapshot.json and public-events.json are observer/assistant handoffs. Raw archives, mint identities, private reports and the database are research evidence, not public stream overlays. A generic JSON handoff does not establish that a deployed UI, Jarvis installation or Telegram bot consumes it.

Source preparation and target inference perform no real-data fitting. The earlier synthetic comparison favored the numerical control over the neural encoding. This integration does not establish a representative historical corpus, trading advantage, multi-brain fusion, paid commerce or production readiness.
