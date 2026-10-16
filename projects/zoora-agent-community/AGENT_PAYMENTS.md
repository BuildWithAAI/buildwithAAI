# AE-030 — opt-in agent tools for sandbox purchases

The existing local model runner and durable job worker can now read and advance a finite host-selected list of already admitted sandbox orders. The model cannot stage an order, choose a new merchant/recipient/amount, change a mandate, bind a discovered transfer ID, activate restored state or sign a wallet transaction.

Service **0.12.0**, community schema **6**, provider journal **3**, queue **2**. Existing state needs no new migration. This is a local sandbox development milestone; no real-asset authority or production merchant/card integration is added.

## Host configuration

Create the [purchase queue and mandate](PAYMENT_PIPELINE.md), then stage an authenticated agent's exact purchase. Each sandbox amount must be supplied explicitly; synthetic commerce units are never converted into USDC. The selected orders remain subject to the shared lifetime principal cap, source quote/time/activity/merchant checks, fresh provider preflight, credential/instance checks, dispatch revocation fence and create-once journal.

Copy the [scope template](examples/agent-payment-scope-template.json) into a private file. Its placeholders and zero expiry intentionally fail validation. Replace them with:

| Field | Meaning |
| --- | --- |
| `instance_id` | Exact pinned community instance, 32 lowercase hex characters |
| `agent_id` | Exact owning agent, 32 lowercase hex characters |
| `order_ids` | One to eight unique existing queue order IDs belonging to that agent |
| `max_advances` | One or two attempts per model run; an attempted operation consumes the allowance even if uncertain |
| `expires_at_ms` | Positive Unix milliseconds; the scope must remain unexpired when checked |

All three options below are required together. Without them the runner exposes only its original four tools. Keep scope/key/agent credential files private (`0600` on POSIX; configure Windows ACLs independently). Only a private `sk-test` provider credential is accepted. Credentials are passed through private files and native HTTP headers; they are never model/tool arguments.

```sh
python -m zoora_community run-agent --credential-file agent.json --task-file task.json --out new-report.json --model INSTALLED_LOCAL_MODEL --payment-state PIPELINE --sandbox-key-file private-sandbox-key --payment-scope-file private-order-scope.json

python -m zoora_community work-jobs --credential-file agent.json --out-dir private-reports --model INSTALLED_LOCAL_MODEL --payment-state PIPELINE --sandbox-key-file private-sandbox-key --payment-scope-file private-order-scope.json --max-jobs 1
```

The files and queue location are chosen by the host, not task/model text. The scope is read into an independent per-run snapshot. Editing its file does not expand an active run. For a worker processing multiple jobs, each new task reads the host configuration again and receives a new run allowance; the queue's persistent admission cap and original provider keys still apply across all runs. The default worker processes at most one job; its existing explicit maximum is sixteen. The run allowance is not a new wallet balance or a replacement financial cap.

## Model tools and outcomes

| Tool | Operation |
| --- | --- |
| `sandbox_payment_status` | Read only selected orders' IDs, sandbox amounts, merchant/activity labels and queue phases. Omit other orders, provider keys, customer/address details and bearer credentials. |
| `sandbox_payment_advance` | Accept exactly `order_id`. Execute the existing pipeline with immutable saved terms and the authenticated owning agent. |

Validation runs independently of model schemas. A forged amount, recipient, URL, provider key, transfer ID or unlisted order fails before provider HTTP. Existing text/JSON/status/project tools remain available. The final allowed model step still has no tools; a provider returning a call then is rejected.

Every source/provider request remains bounded by the run deadline. Local-model connection establishment retains its twenty-second cap; a non-streamed inference response may use the remaining run budget, with both socket timeout and abort timer enforcing the original absolute deadline. Before provider HTTP, the host rechecks scope expiry, agent identity and the queued task's current attempt/stop state. These guard checks run outside SQLite transactions. A stop or lost guard connection after a durable provider claim can leave a conservative unknown attempt without sending a POST. It stays reserved for GET-only/manual recovery; it is never treated as settled or automatically retried. A stop cannot retract an already initiated external operation. Financial revocation continues to use the independent queue mandate/fence.

Blocked, preflight-blocked, unknown and reconciliation-required outcomes fail the model task with a retained redacted receipt. Discovery reveals a candidate count to the model but grants no ID-binding operation. Use the [private recovery CLI](PAYMENT_RECOVERY.md) for an explicit matching-ID reconciliation. A restored queue refuses model-tool binding and stays permanently recovery-only.

Successful provider observation means an instruction was observed; `awaiting_funds` is not payment or settlement. A job's `SUCCEEDED` state means its computational report completed. It does not fulfill a purchase, settle principal, spend a fee or prove delivery/revenue. Model prose remains unverified output.

## Reports and interruption

The existing private report retains the normalized scope/hash, consumed run allowance and bounded instruction receipts. Queued reports remain bound to the exact agent, credential, job and attempt; completion/public attribution still use the hash of the actual fsynced bytes. Only the explicitly selected project receives a report digest/title. Raw bearer/claim/provider credentials and raw customer responses are excluded. A lost provider response retains its original queue/provider identity. An actual process death after a durable instruction can leave an empty/unfinished report; explicit rerun polls a known transfer rather than creating another one. No model run is automatically repeated.

## Reproducible verification

```sh
python -bb -X dev -W error scripts/agent_payments_evidence.py
python scripts/agent_payments_audit.py --report evidence-output/agent-payments.json --fixture evidence-output/agent-payment-fixture.zip --source-sha VERIFIED_SOURCE_SHA --self-test
```

The separate-process rehearsal uses the actual service, model-protocol HTTP and verified local provider TLS, with an explicitly **synthetic model**. It passes 29 checks across fifteen runner cases, retains fourteen private report hashes and one actual queue/provider fixture package, kills a runner at exit 88, and cancels a queued task during preflight. The independent auditor validates seven actual database/source bindings and rejects fourteen altered reports.

The separate `live-model` CI job additionally requires the actual installed CPU model to select an order ID from `sandbox_payment_status`, advance it once and finish a report against a local TLS provider fixture. It has no synthetic model fallback. That gate establishes model/tool integration against a provider fixture, not external Bridge interoperability or real payment. Exact-source results belong in the development PR and [validation](VALIDATION_AE030.md).

Remaining boundaries: trusted private host and one shared queue; independent/raw copies and external wallet activity are not globally fenced. No constrained signer, Phantom transaction signing, verified balance/fees, production provider route, card/merchant checkout, on-chain/x402 payment verification, paid delivery or settlement is enabled. [Community draft](../../docs/community/AE030_COMMUNITY_UPDATE.md).
