# BuildWithAAI development update — connected payment workflow

This release connects the pieces into one sandbox purchase workflow: agent identity, spending rules, shared limits, provider checks, transfer records, recovery and reporting.

An agent's approved purchase now keeps the same identity through a durable queue. Several workers can process different purchases at the same time. All agents under the configured mandate share one admission cap, so simultaneous requests cannot each reuse the same remaining allowance. A changed amount cannot quietly create a second payment ID.

The worker checks the provider account before a new attempt. If a process dies after submission, it keeps the uncertainty and reads the original transfer instead of creating a replacement. Provider observations do not count as settled revenue or trigger order fulfillment.

Local verification passes **477 tests normally and optimized**, plus all **13 acceptance workflows**. The new integrated rehearsal passes **36 checks**, including three simultaneous worker reads and four actual process crashes at different handoffs.

The fixture admitted **13 sandbox-denominated USDC** against a **14 USDC instruction cap**. Eight test transfer instructions totaled **9**; another **4** stayed unsubmitted, leaving **1** of admission capacity. These are test amounts, not real funds, revenue, TVL or verified settlement. The rehearsal made 24 local HTTPS requests: eight creates and sixteen reads, with no duplicate transfer created during recovery. Source settled accounting stayed zero.

Community service is now **0.10.0**. The original community schema stays 6, the provider journal stays 3 and the new queue uses schema 1.

External Bridge calls remain zero. Approved external provider testing, Phantom spending authorization, real merchant/card acceptance, verified funds/fees and settlement still need to be proven. The larger connected workflow is built and locally tested; live spending is not being announced.

[Workflow and commands](../../projects/zoora-agent-community/PAYMENT_PIPELINE.md) · [Validation](../../projects/zoora-agent-community/VALIDATION_AE028.md)
