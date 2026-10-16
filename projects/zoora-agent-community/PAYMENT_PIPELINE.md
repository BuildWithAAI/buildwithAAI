# AE-028 — connected sandbox purchase pipeline

October 16, 2026 (UTC). This batch connects authenticated commerce, explicit sandbox limits, customer observations, a provider journal, concurrent dispatch and a combined operational report. An agent purchase keeps one identity across these components. The existing synthetic book and separately denominated sandbox instruction cap remain distinct.

Current service is **0.12.0/schema 6**, provider journal **schema 3**, queue **schema 2**. [AE-030 agent tools](AGENT_PAYMENTS.md) optionally advance host-selected existing orders without changing their terms or caps. [AE-029 recovery](PAYMENT_RECOVERY.md) adds coordinated packages, durable recovery-only restore and explicit backed migration from the original AE-028 queue schema 1. Existing schema-6 community state needs no structural migration. The optional authenticated `sandbox_dispatch` request context is retained in commerce history; use a compatible service version to read those records. Downgrading to 0.9.0 after writing them is unsupported.

**External Bridge requests in retained evidence: zero. Provider interoperability: UNVERIFIED. No signer, live funds, merchant/card purchase, x402 execution or verified settlement is enabled.** The pipeline rehearses a separately approved sandbox transfer associated with a synthetic purchase; it does not implement that purchase's candidate merchant rail or convert its units to money.

## Connected components

| Component | Implemented connection |
| --- | --- |
| Authenticated commerce | Active agent credential, registered book member/payer, owning operator, exact purchase binding and current source instance. Final SUBMIT atomically checks the instance inside the service transaction and retains the exact queue-terms hash. |
| Sandbox mandate | Operator-authenticated setup pins the source instance, allowed agents, customer, declared source address, merchant destinations/activities, exact USDC principal limit, lifetime admission cap and time window. `real_funds_authorized` must be false. |
| Durable queue | Immutable terms, deterministic source-purchase ID, transactional shared admission, exact retries, complete audit and bounded claims. Source purchase IDs do not change with amount or mandate ID. |
| Concurrent worker | Up to eight selected orders and four worker threads per batch. Each order gets a committed two-minute lease; one blocked order does not stop other orders. Oldest claim order prevents earlier completed orders from starving unprocessed ones. |
| Provider boundary | Fresh exact-customer preflight before a new submission, original provider key/body, atomic first-create gate and persisted local dispatch fence. Previously attempted unknown transfers never get a replacement POST through this pipeline. |
| Combined status | Both instruction terms and provider observations, local admission totals, outstanding claims and audit hashes. Observations neither settle the source book nor release admission capacity or trigger fulfillment. |

The mandate's `payment_limit_usdc` and `admission_budget_usdc` are explicit six-decimal sandbox principal amounts. They are not a wallet balance, measured funds, total fee authorization or a real-asset mandate. Provider fees are not accounted for here. Synthetic principal/fee limits still apply independently in the source book. Operator-authenticated configuration declares addresses; it does not prove ownership or grant wallet rights.

These limits govern this configured pipeline. The private host retains its provider key; direct provider-client commands or another program with that key can bypass the queue. This is application admission control, not a cryptographic spending constraint or a constrained signer.

## Operator workflow

Run the local community service with an existing authenticated operator, its registered agents and an approved synthetic commerce purchase. Copy [the mandate template](examples/payment-pipeline-mandate-template.json), replace every placeholder and set the actual time window. Keep it private and outside source control. Use one shared queue/provider directory for that mandate. The provider key remains a separate private `sk-test` file; bearer keys never belong in JSON requests or command arguments.

```sh
python -m zoora_community.payment_worker --state ./payment-queue init --port 8765 --credential-file ./operator.json --mandate-file ./sandbox-mandate.json
python -m zoora_community.payment_worker --state ./payment-queue stage --port 8765 --credential-file ./agent.json --request-file ./purchase-link.json
python -m zoora_community.payment_worker --state ./payment-queue run-batch --port 8765 --credential-file ./agent.json --key-file ./bridge-sandbox.key --limit 8 --workers 4
python -m zoora_community.payment_worker --state ./payment-queue show
python -m zoora_community.payment_worker --state ./payment-queue audit
```

The stage request has exactly `book_id`, `purchase_id`, `commerce_binding_sha256` and `amount_usdc`. Obtain the first three from the authenticated purchase view. Choose the last explicitly under the sandbox mandate; it is never derived from the synthetic amount. Only the purchase's actual agent can stage it. Another agent in the same book cannot impersonate its payer. Initialization/revocation require the owning operator's credential.

`stage` reserves lifetime admission before any provider request. Repeating exact terms reads the same order and consumes no additional capacity. Changed terms conflict. Admission stays held even when preflight fails, an order expires, a provider reply is lost or an observation is returned. This conservative lifetime cap has no cancellation/refund/reactivation mechanism in this milestone. It does not certify current liabilities, solvency or global deduplication.

The worker posts one deterministic source SUBMIT request containing the queue-terms hash and instance pin. A retry of its own successful SUBMIT replays that command. A manual/unrelated earlier SUBMIT returns a different outcome and cannot be adopted as its dispatch. No automatic RESOLVE, refund, paid fulfillment or accounting credit is issued.

The shared `client.commerce_action` helper freezes the exact command and request ID before delivery. It makes at most three attempts, with short backoff, only for `STORAGE_UNAVAILABLE` or interrupted network delivery to this idempotent source endpoint. Authorization, conflict and rate-limit refusals are not retried. A final network failure remains `COMMERCE_DELIVERY_UNCERTAIN`; reservations are not released. This retry policy never applies to provider transfer POSTs. Both the existing commerce race workflow and the new worker use the same helper. The integrated harness discards one response after an actual source HTTP commit and verifies that the same-body retry returns an authenticated replay.

Successful CLI results use exit 0; blocked/incomplete/uncertain workflow results use exit 2 with JSON; invalid commands/credentials/storage use exit 1 with redacted JSON errors. Argument usage errors use argparse's exit 2 and stderr text. Inspect the JSON phase as well as the exit code. `show`/`audit` are host-private commands; they expose IDs, terms and declared addresses, never bearer credentials.

## Interruption and recovery

| Interruption | Supported behavior |
| --- | --- |
| Source SUBMIT persisted, provider attempt not claimed | Preserve the queue reservation/lease. After expiry, replay that exact source command and retain the prepared provider key. New creation still requires current checks. |
| Queue dispatch fence committed, provider transaction interrupted | Fence stays recorded, provider transaction rolls back. After the lease, current authorization is checked again. A fence is not proof of a POST. |
| Provider accepted, process died before storing its reply | Preserve uncertainty. After the lease, bounded GET discovery reports candidates; it never sends a replacement POST. Explicit matching-ID reconciliation is required. |
| Provider observation persisted, queue result interrupted | A later process retrieves the known ID through GET and repairs the queue result. No repeated preflight or POST. |
| Lease still live / old worker finishes after takeover | Exclude the competing claim; reject a stale completion/fence. Provider create-once admission is independently serialized. |
| Customer check fails or one dependency errors | Record a redacted per-order result, retain admission and let other selected orders proceed. |

Targeted dispatch and private-host recovery:

```sh
python -m zoora_community.payment_worker --state ./payment-queue run-one --port 8765 --credential-file ./agent.json --key-file ./bridge-sandbox.key --order-id ORDER_ID
python -m zoora_community.payment_worker --state ./payment-queue recover --key-file ./bridge-sandbox.key --order-id ORDER_ID
python -m zoora_community.payment_worker --state ./payment-queue recover --key-file ./bridge-sandbox.key --order-id ORDER_ID --transfer-id TRANSFER_UUID
python -m zoora_community.payment_worker --state ./payment-queue revoke --port 8765 --credential-file ./operator.json
```

Without a known ID, recovery returns bounded candidates and requires an explicit target to bind one. A miss remains inconclusive. Recovery refuses unattempted orders without preparing a provider intent. Known IDs, credential fingerprints, full terms and existing provider-journal restore guards remain enforced. A restored `RECOVERY_ONLY` provider journal cannot gain POST authority through this worker.

Revocation prevents new admissions and dispatches that have not passed the local dispatch fence. A previously fenced attempt may complete afterward; revocation cannot retract an already initiated external operation. Earlier attempted orders remain eligible for GET-only recovery, including after source/pipeline expiry or revocation. There is no queue reactivation command. Read-only recovery needs the private host/provider credential, not a currently active agent credential.

The community DB, queue DB and provider journal are separate durable stores. Their commits are deliberately not described as one distributed transaction. Leases, stable identities, exact source-command replay, dispatch fencing and provider create-once enforce conservative recovery across those commits. The private queue directory includes its nested `provider/` state. Community backup/restore does not include it. Use [AE-029 coordinated packages](PAYMENT_RECOVERY.md) to restore queue/provider state into GET-only recovery; copying an old queue into active service is not an authorized workflow. Provider-only snapshot rules remain [AE-026](BRIDGE_RECOVERY.md).

## Reproducible integrated evidence

```sh
python -bb -X dev -W error scripts/payment_pipeline_evidence.py
```

**37 checks**, actual authenticated loopback service, actual separate CLI processes and verified local HTTPS. Three worker customer reads arrive before any is released, proving concurrency at that boundary without making throughput claims. Four separate processes actually exit at source SUBMIT, provider acceptance, dispatch fence and queue-result boundaries (82/83/84/85). Pipeline clocks are injected for lease boundaries; the community server uses real time. Shipped tools expose no test-host, test-clock or crash switches.

Measured fixture data:

| Quantity | Value and meaning |
| --- | --- |
| Principal admission cap | 14.000000 sandbox-denominated USDC |
| Admitted instructions | 13.000000 across ten queue orders; one remains available under the cap |
| Provider-fixture instructions | 9.000000 across eight unique transfer objects; no confirmed funds movement or settlement |
| Admitted but unsubmitted | 4.000000 across two instructions |
| Local provider HTTPS | 24 requests: eight POST, sixteen GET |
| Queue audit | Seventeen claims; four historical unfinished claims; nine fences (one interrupted before provider claim) |
| Provider audit | Twelve attempts: eight CREATE, three POLL, one RECONCILE |
| Source accounting | Zero settled/refunded principal and zero spent fees; source reservations remain synthetic |

The report retains the full synthetic source state and its hash, ten queue links, eight authenticated source dispatch contexts, original provider terms/keys/body hashes, crash boundaries and wire summaries. These support independent binding/count checks. They are fixture records, not revenue, TVL, profit, wallet balances, external attestations or a certification of physical power-loss/Windows ACL behavior. Reports do not contain the database files. Honest private host/storage and a single configured shared queue remain assumptions; independent copies or other wallet/provider activity are not globally fenced.

Provider sources and preflight limitations remain [AE-027](BRIDGE_PREFLIGHT.md); transport/recovery remain [AE-024](BRIDGE_SANDBOX.md) and [AE-025](BRIDGE_RECONCILIATION.md). Credentialed external account/route testing, constrained signing, fee/funds verification, production merchant rails, delivery and verified settlement remain subsequent work. [Validation](VALIDATION_AE028.md) · [Community draft](../../docs/community/AE028_COMMUNITY_UPDATE.md).
