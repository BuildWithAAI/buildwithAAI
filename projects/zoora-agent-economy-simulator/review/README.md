# AE-003: delivery review, disputes and appeals

An offline policy adapter over AE-002's simulated escrow engine. This module owns review decisions and appeal rules; the existing marketplace still owns balances, fees, reservations, automatic refunds and supply conservation. AE-001 and AE-002 report identities and golden vectors remain unchanged. AE-002 gains only a read-only task lookup and a batching API that defers global audits to batch boundaries. The adapter audits at every public advance and on completion.

## Run locally

Use the repository-pinned Rust 1.99.0 toolchain. From this directory:

```sh
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --all-targets
cargo test --locked --release --all-targets
cargo run --locked --release -- run configs/default.toml my-review-report.json
cargo run --locked --release -- replay my-review-report.json
cargo run --locked --release -- benchmark my-review-scaling.json
```

Outputs must be new files. All activity is `SYNTHETIC`; the nested market uses `SIMULATED_UNITS` with no monetary value. This is not a deployed marketplace, agent service, blockchain program or work-quality oracle.

## Policy

1. A client names a primary reviewer when posting. Their declared operators must differ. A worker can accept only if its declared operator differs from both. Terms include a criteria digest, reward and exclusive deadline; funding, assignment and submission use the AE-002 engine.
2. After submission, the client may open one dispute with a reason digest. A reviewer may also evaluate a submission without a dispute. Every verdict includes the submitted artifact digest, criteria digest and reason digest. Mismatched or malformed references are refused. Digests declare evidence references; the simulator does not fetch or judge that evidence.
3. A primary approve/refund verdict is provisional. Escrow stays held until the exclusive appeal close tick. Either party may appeal once before then. The appellate reviewer is the lowest account ID whose declared operator differs from the client, worker and primary reviewer. This deterministic selector is experimental; it concentrates review work and provides no fairness or Sybil guarantee. Decision counts by reviewer expose that concentration.
4. An appellate verdict may uphold or overturn the primary verdict. It settles immediately, with no further appeal. If no appeal is filed, the close timer settles the primary verdict. If an appeal is filed, that timer becomes a no-op and escrow waits for the appellate verdict or task deadline.
5. Approval uses AE-002's worker payment and fee calculation. Refund uses its failed-task refund transition; that mechanical service counter is not an attribution of blame or a reputation score. Worker-declared failure is allowed only before submission; cancellation is allowed only while open. Neither can bypass review after delivery.
6. At the task deadline, the escrow engine runs expiry before policy events. Every unresolved review or blocked payment refunds fully. No fee is taken from refunds. A primary appeal window must close strictly before the task deadline. Appeal close timers also precede requests at their tick, so filing exactly at the close is too late.

Operator labels are immutable simulation inputs indexed by account ID. The simulator does not authenticate ownership, detect undisclosed common control or establish independence in the real world. Different labels are a modeled assumption. There are no penalties, stakes or trust scores added.

## Replay and bounds

Policy event IDs, priorities and timers are engine-owned. Successful scheduling and public advances are recorded in an operation history; replay executes that exact history, including incremental admission timing. It regenerates every policy record, decision, timer, account movement and nested marketplace report. A normal scenario also regenerates from the pinned foundation RNG. Modified journals are rejected even if their hash is recomputed. A reproducible hash is not an authorship or correctness certificate.

Bounds: 100,000 accounts, 5,000 retained tasks, 50,000 lifetime policy events including timers, 100,000 history operations and 100,000 ticks. Admission reserves space for the post deadline timer or provisional close timer before it enters the queue. An operation slot is kept for final `run`, so history saturation cannot prevent finishing. Invalid business actions are recorded; hard faults prevent verified final reports.

Report schema 1 hashes `ZOORA_AE003_JSON_FINGERPRINT_V1`, a NUL byte, and compact UTF-8 JSON for this ordered tuple: schema_version, model, classification, policy, rng, scenario, config, market, cases, metrics, operations, journal. The fingerprint field is excluded; nested AE-002 reports retain their own independent fingerprint. Declared struct field order, task-ID sorted cases, reviewer-ID sorted metrics and Cargo.lock pin the encoding; there are no floats, and nested u128 counters are canonical decimal strings. Schema/model must change when the encoding changes. CI independently reproduces the digest in Python.

CLI inputs are bounded regular files: 4 MiB TOML and 128 MiB JSON. Deserialization rejects unknown fields and bounds arrays; strings are byte-bounded at admission. New outputs use Unix mode 0600. This is not an OS sandbox and does not defeat file replacement races in attacker-controlled directories; use trusted directories. Supplied titles and digest references may contain private information, so avoid secrets.

## Synthetic workload

The normal workload overlaps all tasks: post at 0, accept/cancel at 1, submit/fail at 2, dispute/primary verdict at 3, appeal at 4, uncontested settlement at 5, appellate verdict at 6 and deadline refunds at 9. Draws use pinned ChaCha8. Clients use bounded random draws; worker selection scans cyclically from a random account for an eligible operator; reviewer selection is deterministic. Configured failure, refund, appeal, missing-review and overturn rates describe an experiment, not predictions. Scaling uses 5,000 tasks at 100/1,000/10,000 accounts.

See [VALIDATION.md](VALIDATION.md) for the verified source, test evidence and remaining work.

## AE-004 connected development

See [AE004.md](AE004.md) for direct payments from user-controlled agent wallets, voluntary-refund semantics, fair/capacity-aware research allocation, matched adversarial experiments and the verified local viewer. The escrow/refund rules above describe the historical **SYNTHETIC research ledger**, not platform custody or reversal of direct payments.
