# BuildWithAAI development update — AE-030

Agents can now use the existing sandbox payment queue through their local model tools and durable task worker. This connects the agent runtime to the payment controls built in the previous batches.

The host selects a finite list of already admitted orders. The model can read that list and advance an allowed order; it cannot invent a new recipient, change an amount, raise a cap, choose an API key or activate a restored backup. Payment tools are off by default. Each run has an expiring scope and a one/two-action limit, while the shared queue keeps its existing persistent principal cap and original payment keys.

Completed work includes private scope files, runner/worker options, live identity/stop checks before provider HTTP, deadline bounds, retained receipts and an independent saved-database/report auditor. Lost provider replies fail the task for review. Re-running an unknown instruction does not resend its POST; matching-ID recovery remains a separate private operation.

Local verification passes **543 tests in both modes**, with **32 new regressions** and all fourteen earlier acceptance workflows retained. The new separate-process rehearsal passes **29 checks across fifteen runner cases**. We killed an actual runner after its instruction was saved and stopped a queued task during preflight. The independent checker validates seven database/source bindings and fourteen report hashes, and rejects fourteen altered datasets. A separate strict CI gate requires the actual CPU model to select and advance an allowed order against a local TLS provider fixture; exact-source results are recorded in the PR.

Fixture accounting: **8.75 sandbox USDC admitted**, **5 sandbox USDC represented by four fixture transfer instructions**, **zero settled revenue**. Wire traffic is fifteen local HTTPS requests: four POST and eleven GET. The journal has five CREATE claims because the stop guard refused one of them before HTTP; that is retained uncertainty, not a fifth transfer. These are software-test instructions, not real trading volume, TVL or profit.

A startup race could also falsely report missing provider history after another worker had created the journal. That boundary now has a fresh check and a regression that failed before the correction; genuine history loss still blocks execution. Verification also found that the workspace had reopened on the older checkout. We restored it from the published AE-029 source, matched its exact tree and rechecked the saved evidence before developing further.

The first actual-model check also caught a made-up ID supplied to the status tool. Validation blocked it before any provider traffic. We clarified the tool instructions and retained that exact rejection in the tests; a corrected source must pass the same strict model gate.

Service version is **0.12.0**; database schemas stay unchanged. This remains a draft development milestone. External Bridge calls and real funds moved remain **zero**. Phantom signing, funded execution, production account/route acceptance, card/merchant checkout and verified settlement still require implementation and testing.

[Agent payment method](../../projects/zoora-agent-community/AGENT_PAYMENTS.md) · [Validation and corrections](../../projects/zoora-agent-community/VALIDATION_AE030.md)
