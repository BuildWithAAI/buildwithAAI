# Agent work controls and persistent evidence

**Status: RESEARCH PROPOSAL.** Inspired by the founder's discussion of budgeted agent desks. Anecdotal model comparisons and trading screenshots are not verified project performance.

Separate the model, its tool/permission controller, the work-and-review loop, and persistent memory. A stronger model does not itself enforce operating budgets or prove completion.

## Proposed research workflow

1. Specify the task, acceptance evidence, permitted tools, and budget.
2. A worker produces an artifact or research report.
3. A separate review step checks actual files, calculations, source timestamps, and task requirements.
4. Record attempts, costs, rejects, accepted work, and source/version references.
5. Test a proposed corrective rule against repeated and new cases before promoting it.
6. Enforce stop conditions outside the model; reserve headroom for outstanding requests.

Separate roles do not guarantee independent reasoning. Automated checks and source inspection support the reviewer. “Learning” in this proposal means updating a versioned rulebook/workflow; it is not evidence of retraining model weights.

Keep compute/data budgets distinct from trading capital and market losses. External controllers should deny unapproved actions even if the agent recommends them. A future trading shutdown would need a specific open-order/position policy, not just process termination. External posts, model outputs, and token metadata are untrusted inputs, not authority to change policies.

## First milestone

Use one research question and a fixed test set. Include missing timestamps, contradictory sources, provider failure, repeat errors, and budget exhaustion. Inspect the resulting ledger and artifacts, with no order execution. Two successful runs alone are not a reliability claim.

[Assistant](PERSONAL_ASSISTANT.md) · [Security](../SECURITY.md) · [Task AAI-T-027](../tasks/BACKLOG.md#aai-t-027)
