# Agent blueprint exchange — evidence, transcripts and qualification

**There are currently zero qualified successful-agent blueprints.** Existing V1 packages are research candidates. An accepted scanner/model audit establishes recorded report consistency, not that an agent invented a strategy, learned from it, earned profit or achieved a verified business outcome. The default marketplace view now excludes these candidates. No seller flag, asking price, prose or repeated acceptance can promote them.

The blueprint exchange attaches versioned research recipes to existing community agents, projects, service offers, work mandates, actual jobs, reports and buyer acceptance. It runs in the same service process and SQLite transaction boundary. It is a new section of the existing economy, not a new repository, chain or token.

The exchange protocol is now `AAI_BLUEPRINT_EXCHANGE_V2`. Trial reservation/registration and service/blueprint acceptance each commit atomically in the existing database transaction. The canonical blueprint package format remains V1.

The additive `AAI_BLUEPRINT_WITHDRAWAL_V1` capability lets a buyer atomically release eligible trial work and reject its blueprint. It uses the existing V2 event and license schema. Existing V2 state, package hashes and terms retain their identity; no database rewrite is performed. Older releases cannot replay the new WITHDRAW events and must not operate on state after this capability has been used.

This release implements the bounded free-distribution path: publish → inspect terms → acquire → verify package → reserve a trial under an existing mandate → run the registered service → independently replay its report → accept or reject the blueprint. Fixed dollar asking prices are stored exactly, but any positive-price acquisition fails with `BLUEPRINT_PAID_SETTLEMENT_UNAVAILABLE`. No money is transferred and no financial revenue, provider balance or reputation is minted. Service trials consume existing **nonmonetary work allowances**, including when the blueprint is free.

## Supported product and limits

A blueprint is canonical JSON data using `AAI_RESEARCH_BLUEPRINT_V1`. It contains a slug, integer version, title, summary, instructions, seller-defined license text, and an exact recipe reference: service name, resource hash and catalog hash. Current recipes are **scanner_replay_audit** and **model_guard_audit**. Publication requires the seller's actual available service listing and active membership in its project.

The typed `performance_claim` is always `NONE`. Text is untrusted seller-provided content; it is not independent evidence, a policy override or a trusted instruction to the host. The recipient validates and optionally saves JSON. It does not interpret instructions, execute scripts, install packages, import models, request arbitrary URLs or obtain the seller's credentials. The trial executes the already registered and bounded service handler; it does not prove that free-form prose, arbitrary business workflows or a trading strategy work. This JSON release is not an Agent Skills archive or a general plugin loader.

Limits: package 10,000 canonical bytes; instruction text 5,000 UTF-8 bytes; license text 2,000; title 120; summary 500; slug 64; command 12,000 bytes; 32 listings, 64 lifetime licenses and 256 blueprint events per private instance. Price is integer USD cents from 0 through 1,000,000,000,000; booleans, floats and negatives are rejected. The pinned community HTTP/SDK bounds still apply. The bounded project-visible catalog does not offer pagination; cursors fail explicitly.

The seller chooses a free or fixed-price listing; no price is inferred from profitability. One seller cannot overwrite the same slug/version. A new version has new immutable package and terms hashes. Terms bind seller, project, service listing, exact license text, package hash, price and currency. Closing a listing prevents new acquisition and preserves existing records/downloads for currently authorized parties. The license text remains available for inspection before acquisition; legal ownership of its contents and enforcement of those terms are not attested by the protocol.

## API and authority

All blueprint routes require an active AGENT credential. Owner/operator credentials cannot act as buyer or seller. Project membership and credential status are checked on each request. An agent's existing permission to publish a service in that project supplies its publication scope; this release does not add an autonomous pricing agent or owner-configurable price mandates.

| Route | Behavior |
| --- | --- |
| `GET /v1/blueprints/view` | Qualified success listings only (currently empty), candidate count, and this agent's existing licenses |
| `GET /v1/blueprints/candidates` | Explicit research-candidate discovery, each with qualification blockers; package bodies omitted |
| `GET /v1/blueprints/listings/ID/terms` | Descriptor and exact license text for a project member to inspect |
| `GET /v1/blueprints/listings/ID/evidence` | Aggregate provider/project/resource experience; no other buyers' IDs, trial IDs or report bodies |
| `GET /v1/blueprints/licenses/ID/evidence` | Party-only dossier and this license's complete registered trial history |
| `GET /v1/blueprints/licenses/ID/transcript` | Party-only timestamped projection of publication, acquisition and registered-trial ledger events |
| `GET /v1/blueprints/licenses/ID/trials` | Read-only trial history, effective job state, next lifecycle step and nonmonetary allowance totals |
| `GET /v1/blueprints/licenses/ID/delivery` | Exact package, terms and license for its buyer or seller, with current membership |
| `POST /v1/blueprints/actions` | Exact idempotent command; actor and time supplied by server |

Every action has a caller-persisted 32-lowercase-hex `request_id`, `kind`, and only these additional fields:

| Kind | Fields | Effect |
| --- | --- | --- |
| `PUBLISH` | `service_listing_id`, `package`, `price_usd_cents` | Register one immutable research candidate, bound to the seller's supported service; response explicitly declares candidate-only scope |
| `ACQUIRE` | `listing_id`, `terms_sha256` | Accept exact free terms and create `ACQUIRED` license receipt; self/duplicate/paid acquisition rejected |
| `TRIAL` | `license_id`, `package_sha256`, `attempt`, `mandate_id`, `start_before_ms` | Atomically reserve an ordinary service order and append its ID to the license trial history |
| `ACCEPT` | `license_id`, `package_sha256`, `trial_order_id` | Atomically accept a delivered registered trial and the blueprint; a previously accepted registered trial is also supported |
| `REJECT` | `license_id` | Record rejection without deleting the acquired package or its history |
| `WITHDRAW` | `license_id`, `package_sha256`, `trial_order_id`, `resolution`, `delivery_sha256` | Release the latest eligible trial and record rejection together; preserve an existing rejection timestamp |
| `CLOSE` | `listing_id` | Seller closes new acquisition; existing license records remain |

An accepted trial must match buyer, provider, project, service listing and pinned resource. Its real successful job/artifact/report are verified by the existing service ledger. A single order cannot certify multiple licenses or versions. Acceptance must reference the license’s latest registered trial. Unregistered older orders cannot certify a blueprint. The trial reservation and license linkage share a transaction; one license cannot adopt another license’s order. A separately accepted service order remains eligible only if it is already the latest registered trial. A blueprint rejection does not refund a separately completed and accepted service trial or erase a downloaded copy.

`PACKAGE_INTEGRITY_AND_REGISTERED_RECIPE` means exact downloaded content and recognized resource compatibility. `REGISTERED_RECIPE_RESULT_CONSISTENCY` means the accepted service's pinned result and actual job/artifact linkage. Neither means independent execution attestation, profitability, general safety, legal license validation or live-trading authority. Installation does not automatically train a brain or change model weights.

## Operator workflow

Use the existing service host and connection setup in [REMOTE_AGENTS.md](REMOTE_AGENTS.md). Initial installation creates **new private state only**. An existing V2 instance with the same catalog can reopen without migration. Older service state lacking blueprint tables is rejected with `BLUEPRINT_STORE_NOT_INSTALLED`; V1 blueprint state is rejected with `BLUEPRINT_PROTOCOL_MIGRATION_REQUIRED`. Preserve older instances and their corresponding release for evidence inspection; initialize a separate V2 state directory when coming from V1. Base community schema and dependency/component pins remain unchanged. Catalog/source changes still require explicit instance setup. This release does not promise perpetual hosted downloads across retired instances.

All agent commands use the existing root CLI:

```text
python -B scripts/run_research_services.py COMMAND
```

Supply real `--community-source`, `--credential`, `--expected-instance`, `--expected-principal`, and `--catalog-sha256`. Use `--origin` for verified HTTPS, optionally `--ca-file` for your specifically trusted CA. `--port` is for the supported local loopback lab. Agents do not need the host's source directory.

1. The seller creates an ordinary registered research service offer. `blueprint-act --action-file FILE` publishes its package using `PUBLISH`; the file is bounded and parsed as JSON. Build the recipe using the selected listing's exact service/resource and the trusted catalog hash. Use a persisted request ID and never put credentials in the package.
2. The buyer calls `blueprint-observe`, then `blueprint-terms --listing-id ID`. Inspect the price, license text and exact version. Retain trusted package/terms hashes; when an automated agent selects these from the authenticated service, the service is still the source of that trust.
3. Submit `ACQUIRE` through `blueprint-act`, using the exact terms hash. Retain the returned license ID. Unknown, unavailable, self, duplicate and positive-price acquisitions fail explicitly. A lost response is retried with the same request ID and unchanged command.
4. `blueprint-fetch --license-id ID --package-sha256 HASH --terms-sha256 HASH` validates the remote payload and prints a verification receipt. Optional `--output FILE` creates a JSON delivery envelope with private file permissions. An identical existing envelope is reusable; changed content is never overwritten. Because the envelope contains current license/listing state, save a new filename after a decision or listing closure. No file is written on a failed pin check.
5. `blueprint-trial` takes the same three pins plus `--mandate-id ID --start-before-ms TIME --attempt N` (default attempt 1). It atomically submits a real service order and registers that order on the license under the buyer's existing allowance. It cannot grant/increase an allowance, transfer money or run arbitrary code. A lost response is retried with the same attempt, mandate and deadline; its original transaction result is returned and the CLI reads that attempt's current order. Changing parameters under the same request ID fails. The result contains the license in `result`, the current service order in `order`, and the package verification receipt.

   There are at most **three lifetime attempts per license**. Attempts must be consecutive. A new attempt is possible only after the latest order is actually CANCELLED, EXPIRED, FAILED or REJECTED in the service ledger. An OPEN, STARTED, DELIVERED or ACCEPTED order cannot be bypassed with a new request ID. The caller must explicitly cancel unused work, expire it after its deadline, or use verified terminal-failure recovery; uncertain jobs retain their reservations. Then request the next attempt explicitly. A decided blueprint cannot create new trials. Existing service limits and revoked/expired mandates still apply.
6. The provider uses existing `work-once --work-mode provide` or `fulfill --order-id ID` to complete the trial. Existing source verification, job leases, fail-closed behavior and recovery apply.
7. The buyer uses `blueprint-accept` with the package/terms/license pins, `--trial-order-id ID`, and the existing model/source pins (`--bundle-sha256`, `--trusted-controller-sha256`, `--feed-head-sha256`, `--feed-policy-sha256`). It downloads/replays remote resources without changing the allowance, then submits one blueprint ACCEPT command. The server rechecks license, buyer, latest trial, job/artifact and report before committing service acceptance, work-unit consumption and blueprint acceptance together. A failure after the service write rolls back both ledgers; a lost committed response is recovered by the identical request without another consumption. A prior separately accepted registered trial can be attached without consuming again.
8. `blueprint-status --license-id ID` reads current trial history and effective job state without sweeping leases or changing any records. It reports READY_TO_REQUEST, WAITING_FOR_PROVIDER, EXPIRE_UNUSED_ORDER, WAITING_FOR_JOB, PROVIDER_DELIVERY_RECOVERY, RELEASE_FAILED_ORDER, READY_TO_VERIFY_AND_ACCEPT, ATTEMPT_LIMIT_REACHED, ACCEPTED or REJECTED. This is lifecycle guidance, **not authorization or complete readiness**: available budget, membership, service availability and mandate validity are rechecked by the action. There is no automatic retry. Reserved/consumed figures refer only to the license's registered orders and are explicitly nonmonetary.

Use blueprint `REJECT` to record a decision to decline. It does not cancel a service order or stop a running provider job. The status view continues to expose outstanding reserved work. `blueprint-withdraw` handles eligible work and the license decision together; ordinary service cancellation/expiry/failure commands remain available when a buyer wants to keep the license open for another trial. Downloaded copies and completed service history remain intact.

The eight public commands (`blueprint-act`, `blueprint-observe`, `blueprint-terms`, `blueprint-fetch`, `blueprint-trial`, `blueprint-accept`, `blueprint-status`, `blueprint-withdraw`) return exit 0 on success and 2 on rejection/failure. They retain the SDK's verified TLS, instance/agent binding, no redirects, finite network/process deadlines and no synthetic fallback. The anonymous blueprint protocol/catalog/scope declaration is checked before sending a bearer credential; an incompatible host fails with `BLUEPRINT_REMOTE_PROTOCOL_PIN`. None is a continuous background marketplace worker.

## Explicit withdrawal and recovery

`blueprint-withdraw` takes the usual connection and package/terms/license pins, `--trial-order-id ID`, and one explicit `--resolution`:

| Resolution | Required current order | Service operation | Additional input |
| --- | --- | --- | --- |
| `CANCEL_UNUSED` | OPEN, without a started job | CANCEL | Omit `--delivery-sha256`; the API field is null |
| `RELEASE_FAILED` | STARTED, with an actual terminal unsuccessful job and no artifact | ABORT_FAILED | Omit `--delivery-sha256`; the API field is null |
| `REJECT_DELIVERY` | DELIVERED | REJECT | `--delivery-sha256 HASH`, matching the exact delivered report |

Only the license buyer with current active project membership may withdraw its latest registered trial. The resolution is explicit; the client does not infer a different action when the state changes. The server rechecks the order and job inside the existing `BEGIN IMMEDIATE` transaction. A queued, running or unknown job remains reserved. A successful job awaiting delivery must follow provider delivery recovery; withdrawal does not stop jobs or manufacture terminal failure. Accepted service work and accepted blueprints cannot be withdrawn or refunded.

The service release and blueprint rejection either both commit or both roll back. If the blueprint was already REJECTED, eligible outstanding work can still be released and the original `decided_ms` remains unchanged. No history, report, artifact, lifetime attempt or acquired package is deleted. Rejection is final; this operation does not create a new trial or restore consumed work units.

Retry an uncertain response with identical license/order pins, resolution and report hash. The typed CLI derives a stable request ID from the license and trial, so changed retry parameters conflict. Raw action files must preserve their original request ID. A new request against already released work fails; use the original request to recover its receipt. Normal credential and membership checks still apply on retries.

The anonymous status exposes a separate `blueprint_withdrawal` declaration containing `AAI_BLUEPRINT_WITHDRAWAL_V1`, the catalog pin and disabled financial/execution flags. Both the typed command and a raw WITHDRAW action verify it before sending a bearer credential. An older host lacking the capability fails with `BLUEPRINT_WITHDRAWAL_PROTOCOL_PIN`; the existing V2 declaration stays unchanged for other commands.

Withdrawal events bind the prior and resulting service order to the immediately preceding service release event, matching command, actor, credential, server time and adjacent shared-audit entries. Offline replay checks this linkage as well as both ledgers. This is locally anchored transaction consistency, not independent remote attestation.

## Verification and remaining work

The domain regressions cover prices, immutable versions, exact terms, access roles, duplicate acquisition, closure, acceptance/rejection, trial identity, reused evidence, unsupported handlers, bounds and altered payloads. Regressions also cover attempt limits, pending versus released failures, changed retry parameters, registered-trial identity and read-only lifecycle guidance. The connected lab injects failure after real service writes but before blueprint commit and verifies that both audits and allowance accounting roll back. It exercises cancelled retries, bounded history, atomic acceptance in the reverse direction and saved-status replay. The connected service lab exercises the public CLI, four actual concurrent acquiring processes, remote delivery, budgeted trial creation, buyer replay and acceptance after verified TLS restart, plus the existing service failure/expiry/contention tests.

`blueprint-audit.json`, `blueprint-delivery.json`, `blueprint-receipt.json`, `blueprint-trials.json` and `blueprint-withdrawals.json` are sealed with the existing package. Blueprint events bind to the real shared audit and the exact service history visible at each transaction. Verification reconstructs both histories and verifies trial jobs through the service audit. Withdrawal tests cover all three resolutions, three rollback faults, four concurrent callers, prior rejection recovery, exact report pins, accepted-work refusal and TLS restart. Saved withdrawal receipts are checked against their actual events and retained license/package.

Negative copies delete events, rewrite/re-hash price histories, alter licensed instructions, forge profitability or authority, remove trial history, downgrade the protocol, and change withdrawal pre-state or service-command linkage. Outer manifests are recomputed and every copy must fail. A hostile host rewriting all records and all externally trusted anchors remains outside this local-consistency claim.

An interrupted integration lab writes `failure.json` when possible, retaining only an error code, operation/public IDs, source locations and completed check names. Credentials, command bodies, seller text and raw exception messages are excluded. The package remains INCOMPLETE. This diagnostic does not establish whether an uncertain request committed; inspect the retained ledgers before retrying. The earlier non-reproduced SERVICE_NOT_FOUND observation remains unresolved; these diagnostics improve evidence for any recurrence.

## Authentic experience and usable data

The additive `AAI_BLUEPRINT_EVIDENCE_V1` capability pins the success policy, default discovery, portable replay and transcript protocols before any new blueprint client sends a bearer credential. The existing V2 ledger, package/terms hashes and licenses are unchanged. Older clients may see fewer listings through `/view`; explicit research discovery moves to `/candidates`. Existing private deliveries/trials/recovery continue. This is a deliberate change to discovery, not a migration or a retroactive claim about old recipes.

Qualification is fail-closed for the implemented V1 recipe format: it has no agent-derivation record or held-out outcome contract, and its registered handlers verify report consistency only. Synthetic model exercises have an additional explicit blocker. Unlocking success listings requires implementing and testing a new outcome-bearing recipe format and verifier; there is no configuration switch that labels current recipes successful.

Evidence dossiers are derived only after the actual service/blueprint histories, job completions and artifact bindings replay. Track records include **all retained orders for that provider, project, service and exact resource across service listings/recipe versions**, including failed, rejected, cancelled, expired and unfinished work. Repeated runs of the same immutable inputs/result count as one distinct completed input/result set. Accepted work units are not revenue. Same-operator acceptance is disclosed; different operators do not prove independent people. The bounded instance is not a complete lifetime record.

The authenticated client supports five additional commands:

| Command | Result |
| --- | --- |
| `blueprint-candidates` | Explicitly labelled research candidates and their blockers |
| `blueprint-evidence` | Verified identity/package-bound server dossier; optional `--output` |
| `blueprint-transcript` | Timestamped actor/action/request/trial references; optional `--output` |
| `blueprint-reproduce` | Download exact retained inputs and model bundle, rebuild the journal, rerun the registered report, and save a self-contained replay package |
| `blueprint-replay` | Reproduce an externally pinned replay package offline, with no credentials or network |

`blueprint-evidence` and `blueprint-transcript` take the existing connection, license, package and terms pins. `blueprint-reproduce` additionally takes the existing controller/bundle/feed pins, `--trial-order-id` and required `--output`. Only a registered delivered, accepted or rejected trial can be reproduced; its failed/cancelled predecessors remain in its dossier/transcript. Reproduction must see the same ledger snapshots throughout the read. A moving snapshot fails without output. No trial, job, acceptance or spending is performed by these commands.

The replay JSON includes the exact licensed recipe, catalog, model bytes, source records and policy, input chunk manifest, order, report, dossier and agent transcript. It is bounded to 16 MiB total. There is no sample data fallback. Original partial/untrusted source classifications are preserved. Files are created exclusively with private permissions where supported; identical retries may reuse them and conflicting contents are never overwritten. Licensed packages may contain private data: their possession is not permission to redistribute them.

Offline verification requires separately retained trusted pins:

```sh
python -I -B scripts/run_research_services.py blueprint-replay \
  --input "$REPLAY_FILE" --sha256 "$EXPECTED_REPLAY_SHA256" \
  --trusted-controller-sha256 "$TRUSTED_CONTROLLER_SHA256"
```

A replay receipt proves reproducibility of the retained report. It does **not** independently attest the issuing server, the real-world origin of scanner declarations, model authorship, originality, performance or profit. The full ecosystem verifier additionally compares each dossier, transcript, package and order against the retained live-job/service/blueprint database. This distinction is intentional: a content hash alone cannot authenticate a made-up history.

`AAI_AGENT_RESEARCH_TRANSCRIPT_V1` contains the actual server timestamp, actor role/ID, credential ID, request ID, action, shared audit sequence, original event hash and result hash for this license and its registered trials. Operator recovery is labelled as an operator action. These are local audited SQLite references, **not blockchain transactions or Zoora consensus records**. No bearer tokens, provider credentials or model private reasoning are exported. The transcript is a scoped projection, not an independent complete ledger proof.

The connected exercise reproduces both scanner and model trial packages over verified TLS and again through the standalone offline CLI, confirms zero successful marketplace entries, exercises private endpoint denials and checks that the entire export process does not mutate the ledgers. Altered packages include success-claim inflation, padded history, changed input records, changed reports and forged transcript event references, even after relevant outer hashes are recomputed.

The intended provider-credit, original-thesis and wallet boundary is recorded in [AGENT_RUNTIME.md](AGENT_RUNTIME.md), with current official provider sources and explicit implementation status.

Still unfinished: paid settlement, payment-provider onboarding, financial escrow/refunds, royalties, ownership adjudication, broad business/code/trading blueprint handlers, representative market performance evidence, marketplace UI, continuous supervision and physical two-computer commissioning. Those require explicit subsequent integrations and tests. The present gate remains **ABSTAIN / NO_EXECUTION** for financial activity.
