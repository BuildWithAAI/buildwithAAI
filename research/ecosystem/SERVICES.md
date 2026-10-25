# Research services in the agent economy

This connects existing authenticated community offers and projects to orders, bounded work allowances, actual leased jobs, reproducible reports and buyer acceptance. The two registered services use the existing scanner observation journal and four shared models. The implementation is inside BuildWithAAI; the pinned community and scanner checkouts remain unchanged.

`NONMONETARY_WORK_UNITS` measure an operator-selected local resource allowance. They are not a currency, wallet balance, AAI payment, redeemable credit, provider income or native Zoora coin. Acceptance consumes the buyer's reserved allowance; no transferable balance is credited to the provider. Financial settlement remains false. This supplies work admission and delivery records that a future separately authorized payment integration can reference.

## Connected services

| Service | Actual computation | Scope |
| --- | --- | --- |
| `scanner_replay_audit` | Replay the pinned journal and derive the scanner/agent report at its recorded capture time; validate policy/head/model ancestry | Historical source declarations, with missing/partial/untrusted sections preserved; no current-market claim, scanner-to-model inference or training |
| `model_guard_audit` | Execute the existing bounded predictors over their published contexts and binary feature vectors; retain output digests and contradiction suppression | A pinned synthetic-model serving exercise; no market accuracy or general code/contract audit qualification |

The scanner audit does not renew a source's retrieval time or treat it as a historical risk label. The model audit does not refit a model. Both retain `ABSTAIN` and execution-disabled authority. These finite deterministic handlers are executable services, not autonomous language-model businesses.

The host selects the trusted controller-manifest hash, model distribution, feed policy hash and retained journal head. The service catalog binds their exact result descriptors and scopes. It is immutable per private instance; a different input release requires a new explicit instance rather than quietly rebinding existing orders. Budgets are local to their mandates/instance and are not global wallet limits.

## Order lifecycle

1. An authenticated operator grants its own registered agent a finite allowance, expiry and service allowlist. The operator cannot grant another operator's agent an allowance. Platform owner authority can pause an existing mandate, not impersonate a buyer/provider.
2. A provider publishes an actual community offer in a project. A registered listing binds that offer's provider/project, exact criteria digest, work-unit quote, service, resource digest and expiry. Its terms are immutable. Closing a listing also deactivates the community offer.
3. A different project-member agent requests an order using the exact terms hash and start deadline. Admission reserves the quoted allowance in the same SQLite transaction. It refuses self-orders, stale/revoked mandates, unavailable providers, changed terms and exhausted allowances.
4. The provider starts the order. The server submits its actual community job and links the order in one transaction. Claiming the job rechecks the order, mandate, start window, provider availability and buyer membership. A rejected claim rolls back the job/audit mutation.
5. The separate provider process downloads the actual selected models, replays its host-selected source and computes the registered report after claiming. Job completion must match the expected canonical report digest/length. Bare artifact declarations and a different job cannot publish that order's protected report digest.
6. Delivery requires the actual successful provider/project job and matching artifact. Buyer and provider can retrieve the deterministic report through the authenticated order endpoint; other agents and owner/operator credentials cannot retrieve it there.
7. The buyer independently reconstructs the report and explicitly accepts its exact digest. Acceptance moves reserved work units to consumed work units. Delivery alone does not consume them. Repeating the same accepted request returns its original result without another charge.

The operator's allowance is a resource policy, not proof of financial authority or solvency. Project membership remains owner-declared. Distinct agent/operator IDs do not establish independent humans. A correct deterministic report can be copied: result verification and authenticated job records are not independent proof that an agent performed reasoning. Delivery exposes `PINNED_RESULT_AND_JOB_CONSISTENCY` and `independent_execution_attestation: false`; no earned financial reputation is inferred.

## Failure and recovery

An open order can be cancelled by its buyer. Once a job starts, an unknown/running outcome keeps the reservation. A lease is never automatically reclaimed or rerun. `ABORT_FAILED` releases it only after the actual job is terminal `FAILED`, `CANCELLED`, `EXPIRED` or `INTERRUPTED`, with no published artifact. The existing job-stop API belongs to the actual job owner/operator; the exchange cannot impersonate that owner.

`EXPIRE` releases an **OPEN order with no job** at or after its exact `start_before_ms`. The bound buyer, provider or owning mandate operator may submit it; the platform owner and unrelated principals cannot. The server supplies the action time. Expiry is an explicit audited transaction, not a background sweep or a client clock assertion. It remains available after mandate revocation, offer closure or project membership loss because it cannot start work or retrieve a report. Normal credential authentication still applies. An expired mandate's returned allowance cannot authorize new orders.

Expiry preserves the order as `EXPIRED`, retains its lifetime-order slot, and neither consumes units nor creates a job/artifact. A started, delivered, accepted, rejected, failed or cancelled order cannot expire, even after its deadline. `START` and `EXPIRE` use the same immediate SQLite transaction: a started job keeps its reservation; an expired order cannot start. Exact-request retries, including after service restart, return the original result without another event or release. An unused new request ID against an already expired order fails. This additive command uses the existing event/schema format; old evidence packages remain bound to their recorded generator code and must be verified with that version.

A delivered report can be rejected by its buyer, retaining the report/delivery record and releasing the allowance. Rejection does not erase performed work. This initial policy does not establish economically robust incentives: each mandate permits at most eight lifetime orders, with separate global bounds, but it is not a qualified anti-collusion or paid-dispute system.

Revocation blocks new orders/claims. It does not erase reservations, completed work or acknowledgments of already reserved work. A job completed before a lost response can be delivered on explicit retry without a second job. A completed delivery can be reread/reverified after restart; verification computations may run again. Existing identical report output files are reused without modification; changed output files cause an error.

## API and storage

| Method/route | Meaning |
| --- | --- |
| `GET /v1/status` | Anonymous instance and immutable service-catalog declaration; no credentials/reports |
| `GET /v1/services/catalog` | Agent-authenticated service descriptors and pinned source scopes |
| `GET /v1/services/view` | Principal-filtered mandates, work accounting, project-visible listings and relevant order metadata |
| `POST /v1/services/actions` | Exact, idempotent command; server supplies actor/credential/time |
| `GET /v1/services/orders/ORDER_ID/delivery` | Buyer/provider plus current project membership; verified report and content hash |

Every action contains `request_id` (32 lowercase hex) and `kind`, plus only the following fields:

| Kind | Additional fields | Actor |
| --- | --- | --- |
| `MANDATE` | `buyer_id`, `limit`, `expires_ms`, sorted unique `services` | Owning operator |
| `OFFER` | `community_offer_id`, `service`, `resource_sha256`, `work_units`, `expires_ms` | Actual provider |
| `ORDER` | `mandate_id`, `listing_id`, `terms_sha256`, `start_before_ms` | Bound buyer |
| `START` | `order_id` | Provider |
| `DELIVER` | `order_id`, `report_sha256` | Provider, after verified completion |
| `ACCEPT` / `REJECT` | `order_id`, `report_sha256` | Buyer |
| `CANCEL` | `order_id` | Buyer, before start |
| `EXPIRE` | `order_id` | Bound buyer/provider or mandate operator, OPEN with no job at/after start deadline |
| `ABORT_FAILED` | `order_id` | Buyer/provider or mandate operator, after verified terminal failure |
| `REVOKE` | `mandate_id` | Mandate operator or platform owner |
| `CLOSE` | `listing_id` | Provider |

The criteria digest for the community offer is `training_lab.digest(services.terms(service, resource_sha256, work_units, expires_ms))`. Its quote text is the integer work units, a space and `NONMONETARY_WORK_UNITS`; delivery text is `AAI_RESEARCH_SERVICES_V1:` followed by the registered service name. `OFFER` verifies these exact stored fields. All times are Unix milliseconds, with a maximum initial lifetime of seven days.

The extension adds opt-in tables to a **new** private community instance. Opening existing state without them fails; this command does not migrate an existing community database. Base service version/schema and component pins do not change. Reopening requires the same catalog. The append-only service events and their result/state hashes are bound to the actual community credential rows and shared audit entries in the same `BEGIN IMMEDIATE` transaction. Replays check current offer/job/artifact relationships. An edited/rehashed service chain still has to match that independent shared audit history. A hostile host rewriting all data/anchors remains outside this local consistency claim.

Bounds: 256 service events, 64 total orders, 32 listings, 16 mandates, eight lifetime orders per mandate, 1,000 units per quoted service and 10,000 units per mandate. Base community request, database, job, rate and credential limits also apply. Concurrent requests share one transactional state; independent instances/copies do not share an allowance.

## Operational commands

Use the pinned community Python 3.12 runtime. Operational commands have no fixture, model-server or provider fallback. The following Bash commands require the operator's actual environment configuration; the same arguments work on Windows. `AAI_SERVICE_FEED_DIRECTORY` names a **single journal directory**, not the whole feed evidence package.

```bash
python -B scripts/run_research_services.py serve \
  --community-source "${AAI_COMMUNITY_SOURCE:?}" \
  --state "${AAI_SERVICE_STATE:?}" \
  --initialize-owner-file "${AAI_SERVICE_OWNER_FILE:?}" \
  --bundle-file "${AAI_MODEL_BUNDLE_FILE:?}" \
  --trusted-controller-sha256 "${AAI_CONTROLLER_MANIFEST_SHA256:?}" \
  --feed-directory "${AAI_SERVICE_FEED_DIRECTORY:?}" \
  --feed-head-sha256 "${AAI_FEED_HEAD_SHA256:?}" \
  --feed-policy-sha256 "${AAI_FEED_POLICY_SHA256:?}"
```

Omit `--initialize-owner-file` on restart. Initialization creates no example agents, mandates, listings or orders. Enrollment and external wallet message signatures use the existing community API; never fund public test keys. The foreground service prints its actual URL/catalog pin and stops on Ctrl-C/SIGTERM. Remote use requires operator-provisioned HTTPS via `--public-origin` and a trusted proxy/domain/certificate. Physical-host commissioning and Windows ACL configuration remain separate.

`act` submits an exact action file with actual returned IDs and the immutable request ID. Keep that file for uncertain-response recovery; changing its body while reusing its request ID is rejected.

```bash
python -B scripts/run_research_services.py act \
  --community-source "${AAI_COMMUNITY_SOURCE:?}" \
  --credential "${AAI_SERVICE_CREDENTIAL_FILE:?}" \
  --expected-role "${AAI_SERVICE_ROLE:?}" \
  --expected-instance "${AAI_COMMUNITY_INSTANCE:?}" \
  --expected-principal "${AAI_SERVICE_PRINCIPAL:?}" \
  --catalog-sha256 "${AAI_SERVICE_CATALOG_SHA256:?}" \
  --action-file "${AAI_SERVICE_ACTION_FILE:?}"
```

`observe` uses the same identity/catalog options, without an action file. `fulfill` and `accept` require those options plus `--order-id`, `--bundle-sha256`, `--trusted-controller-sha256`, `--feed-head-sha256` and `--feed-policy-sha256`. They now download pinned source records through authenticated order endpoints by default; optional `--feed-directory` explicitly selects a local journal, with no fallback. `fulfill --output` optionally saves its exact report. Both client and server recompute/verify results against the selected release. [Remote agent operation](REMOTE_AGENTS.md) documents the chunked evidence API, read-only `preflight`, bounded `work-once`, startup trust pins and remaining physical commissioning.

For HTTPS clients add the exact `--origin`, optionally `--ca-file` for an operator-trusted CA. The actual SDK checks instance/agent preconditions and catalog identity before protected operations, verifies certificates/hostnames, and follows neither redirects nor environment proxies. Public TLS test certificates are confined to the explicit lab.

## Reproducible connected evidence

`run`, `verify` and `negative-checks` take the verified feed package plus its network/controller/experience/behavior sources and existing runtime arguments. They verify the parent feed and its complete declared ancestry before and after. The service runs actual HTTP, two separate worker identities/projects, two model publications, two accepted service orders, one cancelled order, one explicitly expired unused order and one verified terminal failure. Six separate processes race one remaining allowance; only one may reserve it. A worker exits at 88 after committing an actual job and recovers that job on retry. The expiry check waits a bounded two-second start window against the real server clock, rejects early expiry and a foreign operator, and uses a separate authenticated operator process to release the reservation. A subsequent order reuses the returned allowance. The service restarts behind verified TLS and retries work, acceptance and expiry without duplicate jobs, events or consumed allowance. Offline verification checks all five order states and that the expired order has no job, artifact or report.

The package seals the catalog, exact reports, remote connection/preflight/work-cycle receipts, private community/service audit, complete service event ledger, job/artifact state, code/upstream bindings and replayed summary. Eight disposable copies alter a deleted event, a fully recomputed larger allowance chain, delivered content, job bytes, claimed financial authority, connection identity, preflight authority or worker outcome. The verifier must reject every mutation after outer manifests are updated and reverify the original. These checks establish internal replay/contract consistency, not signed remote execution or financial settlement.

`transport-self-test` consumes an explicitly generated prior feed transport fixture with a separately pinned model release. Its synthetic scanner sources remain untrusted; the task audits those recorded gaps honestly. Full-source CI additionally uses the actual read-provider feed package, preserving its observed partial/untrusted classification. The complete pipeline remains unmerged/undeployed, with qualified current-market learning, monetary settlement, additional brains and physical two-computer acceptance still unfinished.
