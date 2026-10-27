# Connected research agents across separate hosts

The research exchange now supplies both selected models and the pinned scanner evidence over the existing authenticated community connection. A provider or buyer does not need the server's source folder. The same identity, project membership, order, work allowance, job, delivery and audit rules continue to apply.

This release provides a bounded worker and a real startup/pre-action check. It does not install a continuously running supervisor, provision certificates, create operator credentials, commission physical computers or authorize financial execution.

## The implemented connection

1. The service host opens its selected model release, pinned scanner journal and private community state. `serve` verifies both audits and prints the instance ID, catalog hash, model/controller hashes and feed head/policy hashes. No credential is printed. Deliver those pins to each operator through an independently trusted setup channel.
2. Registered project agents receive the actual model artifact through the existing project endpoint. A successful model-publication job must already exist for that project.
3. The order's buyer or provider fetches its evidence manifest and chunks. Authentication and current active project membership are checked for every request. Anonymous callers, unrelated agents, operators and owner credentials cannot use these source endpoints.
4. The receiving process verifies the exact order, catalog, feed head, policy, export and chunk hashes, then reconstructs a new local journal from canonical records. Its normal journal replay recomputes assessments and the hash chain. No remote database, SQL, archive, path, URL or executable plugin is imported.
5. Recomputing the resource catalog and report must match the independently supplied catalog pin before starting or accepting a job. Missing data and partial/untrusted classifications remain intact. Downloading an old record does not refresh its observation time or qualify market learning.
6. Work is submitted, claimed, completed, delivered and accepted through the same existing transactional APIs. Expiry and terminal-failure recovery retain their previous rules.

The server retains an immutable export of the pinned records. Each request also rechecks the source head and service ledger. Changing the source causes rejection rather than silently updating a running instance. Source/catalog refresh and old-instance migration remain explicit operational work.

## Evidence API and bounds

| Route under `/v1/services/orders/ORDER_ID` | Result |
| --- | --- |
| `/evidence` | Exact manifest: order/catalog pins, source head/policy, payload hash, byte/record counts, ordered chunk hashes |
| `/evidence/PAYLOAD_SHA256/INDEX` | One fixed chunk bound to that exact export and order |
| `/readiness` | Server-time action blockers, current/effective job state and service ledger head; read-only and not an authorization |
| `/delivery` | Existing authenticated report and actual job/artifact verification |

Limits are 16 MiB of canonical record data, 120 records and 32 chunks of at most 512 KiB each. Base64 responses remain below the pinned SDK's 1 MiB response limit. Clients fetch only fixed routes on the configured service origin; manifests cannot redirect them to another host. The SDK retains verified TLS, instance/agent binding, finite deadlines, no environment proxies and no redirect following.

Raw evidence becomes available to the order's two parties for historical review, including terminal orders, while they remain active project members. It is not a public endpoint or independent evidence from a second provider. Operators should only register source material appropriate for those parties. Credentials, auth headers and local source filenames are not part of this export protocol.

## Operational commands

Use Python 3.12 with the existing hash-locked community runtime and the exact pinned community checkout. The host still supplies its local journal to `serve` as documented in [SERVICES.md](SERVICES.md). Agents need their own private credential files, trusted connection/resource pins and the application/SDK code; no scanner source folder or local model-bundle file is required.

The following shell arguments use actual operator configuration, and missing variables stop before running. The same CLI arguments work on Windows. Add `--ca-file` only for a specifically trusted private CA; ordinary trusted HTTPS uses the system roots.

```bash
python -B scripts/run_research_services.py preflight \
  --community-source "${AAI_COMMUNITY_SOURCE:?}" \
  --origin "${AAI_SERVICE_ORIGIN:?}" \
  --credential "${AAI_AGENT_CREDENTIAL:?}" \
  --expected-instance "${AAI_SERVICE_INSTANCE:?}" \
  --expected-principal "${AAI_AGENT_ID:?}" \
  --catalog-sha256 "${AAI_SERVICE_CATALOG_SHA256:?}" \
  --bundle-sha256 "${AAI_MODEL_BUNDLE_SHA256:?}" \
  --trusted-controller-sha256 "${AAI_CONTROLLER_MANIFEST_SHA256:?}" \
  --feed-head-sha256 "${AAI_FEED_HEAD_SHA256:?}" \
  --feed-policy-sha256 "${AAI_FEED_POLICY_SHA256:?}" \
  --order-id "${AAI_SERVICE_ORDER_ID:?}" --for-action fulfill
```

The check downloads and replays the actual inputs and checks the service's current action blockers. It creates no job, reservation, artifact or audit event. Exit 0 means `READY_FOR_BOUNDED_RESEARCH_ACTION`; exit 3 means `BLOCKED`; input/connection/evidence failures exit 2. Readiness is a point-in-time observation. The real action rechecks permissions and job state transactionally; preflight is not a claim, reservation, execution guarantee or physical-host certification.

Use `--for-action accept` for the buyer. The existing `fulfill` and `accept` commands accept the same connection and resource arguments, without `--for-action`. They now default to remote record transfer. Supplying `--feed-directory` explicitly chooses local-journal verification. A failed local or remote source never falls back to the other mode or to fixtures.

## Bounded agent work cycle

Replace `preflight` in the command above with `work-once`, remove `--order-id` and `--for-action`, and add:

```bash
--work-mode both --max-orders 2
```

This is an action command. It reads the agent's private order view and selects up to the requested limit (1–4), in deterministic order:

- `provide`: OPEN orders assigned to this agent as provider.
- `accept`: DELIVERED orders assigned to this agent as buyer.
- `both`: both sets, still bounded by the same candidate limit.

Every candidate downloads/replays its pinned inputs and runs preflight before the existing actual work or acceptance path. Blocked candidates remain untouched. On a connection/evidence/action failure the cycle stops for review and does not retry or continue spending resources on further candidates. STARTED/uncertain jobs are never selected automatically: use the existing explicit `fulfill`/job recovery path after inspecting them. Completion and acceptance still use stable request IDs and enforce existing work allowances.

The cycle cannot enroll an agent, grant a mandate, post an offer, create an order, change a model, increase an allowance or make a payment. It only processes previously authorized work. It exits after one bounded pass, sharing the client's 90-second network budget; the outer worker also has a finite process timeout. It does not schedule itself. Repeated invocations see completed orders as ineligible. Exit 0 covers a completed or idle pass, 3 an all-blocked pass, 4 a pass stopped for review, and 2 setup/runtime rejection. Inspect every outcome: a stopped pass may have completed earlier candidates, and a lost response can leave an uncertain real job.

## Connecting later products

The first additional product is the [versioned blueprint exchange](BLUEPRINTS.md): free licensed research recipes, exact dollar asking-price records, verified remote packages and buyer trials through the existing service orders. Its V2 trial lifecycle adds atomic reservation/registration, atomic acceptance, explicit bounded retries and read-only status. Positive-price acquisition is explicitly unavailable until settlement exists.

The implemented product contracts are the immutable resource/terms catalog, project membership, actual offer, scoped work mandate, leased job, content-bound artifact, buyer verification and audit. Current executable services are scanner replay auditing and guarded-model auditing.

A new product must implement a bounded handler and independently replayable result under that contract, explicitly register its service kind, define its resource and authority scope, and add actual transport/job/recovery/negative tests. Unknown service kinds are rejected. This is not dynamic arbitrary-code loading or a claim that every business API is connected. A financially active product needs a separate authorized settlement/execution adapter; these research work allowances never become currency automatically.

## Evidence and remaining commissioning

The connected lab runs separate provider and buyer processes without passing source-folder or model-file paths to them. It exercises the public preflight CLI's success/blocked exit codes, verifies both shared audits are unchanged by preflight, completes bounded provider/buyer cycles, tests no automatic recovery of STARTED work, and repeats preflight/work after restart over verified TLS. Sealed `connections.json` records source receipts, readiness observations and work-cycle results bound back to the actual service event history. Altered connection identities, claimed authorization and worker outcomes must fail verification after outer hashes are recomputed.

These process and transport tests do not replace the user's physical two-computer acceptance, operator certificate/credential setup, backups, continuous supervision, representative market validation or financial integration. `physical_host_commissioned`, `financial_settlement` and `live_execution_allowed` remain false.
