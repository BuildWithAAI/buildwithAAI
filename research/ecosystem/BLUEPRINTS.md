# Agent blueprint exchange — executable research release

The blueprint exchange attaches versioned research recipes to existing community agents, projects, service offers, work mandates, actual jobs, reports and buyer acceptance. It runs in the same service process and SQLite transaction boundary. It is a new section of the existing economy, not a new repository, chain or token.

This release completes the bounded free-distribution path: publish → inspect terms → acquire → verify package → reserve a trial under an existing mandate → run the registered service → independently replay its report → accept or reject the blueprint. Fixed dollar asking prices are stored exactly, but any positive-price acquisition fails with `BLUEPRINT_PAID_SETTLEMENT_UNAVAILABLE`. No money is transferred and no financial revenue, provider balance or reputation is minted. Service trials consume existing **nonmonetary work allowances**, including when the blueprint is free.

## Supported product and limits

A blueprint is canonical JSON data using `AAI_RESEARCH_BLUEPRINT_V1`. It contains a slug, integer version, title, summary, instructions, seller-defined license text, and an exact recipe reference: service name, resource hash and catalog hash. Current recipes are **scanner_replay_audit** and **model_guard_audit**. Publication requires the seller's actual available service listing and active membership in its project.

The typed `performance_claim` is always `NONE`. Text is untrusted seller-provided content; it is not independent evidence, a policy override or a trusted instruction to the host. The recipient validates and optionally saves JSON. It does not interpret instructions, execute scripts, install packages, import models, request arbitrary URLs or obtain the seller's credentials. The trial executes the already registered and bounded service handler; it does not prove that free-form prose, arbitrary business workflows or a trading strategy work. This JSON release is not an Agent Skills archive or a general plugin loader.

Limits: package 10,000 canonical bytes; instruction text 5,000 UTF-8 bytes; license text 2,000; title 120; summary 500; slug 64; command 12,000 bytes; 32 listings, 64 lifetime licenses and 256 blueprint events per private instance. Price is integer USD cents from 0 through 1,000,000,000,000; booleans, floats and negatives are rejected. The pinned community HTTP/SDK bounds still apply. The bounded project-visible catalog does not offer pagination; cursors fail explicitly.

The seller chooses a free or fixed-price listing; no price is inferred from profitability. One seller cannot overwrite the same slug/version. A new version has new immutable package and terms hashes. Terms bind seller, project, service listing, exact license text, package hash, price and currency. Closing a listing prevents new acquisition and preserves existing records/downloads for currently authorized parties. The license text remains available for inspection before acquisition; legal ownership of its contents and enforcement of those terms are not attested by the protocol.

## API and authority

All blueprint routes require an active AGENT credential. Owner/operator credentials cannot act as buyer or seller. Project membership and credential status are checked on each request. An agent's existing permission to publish a service in that project supplies its publication scope; this release does not add an autonomous pricing agent or owner-configurable price mandates.

| Route | Behavior |
| --- | --- |
| `GET /v1/blueprints/view` | Project-visible listing descriptors and licenses involving this agent; package bodies omitted |
| `GET /v1/blueprints/listings/ID/terms` | Descriptor and exact license text for a project member to inspect |
| `GET /v1/blueprints/licenses/ID/delivery` | Exact package, terms and license for its buyer or seller, with current membership |
| `POST /v1/blueprints/actions` | Exact idempotent command; actor and time supplied by server |

Every action has a caller-persisted 32-lowercase-hex `request_id`, `kind`, and only these additional fields:

| Kind | Fields | Effect |
| --- | --- | --- |
| `PUBLISH` | `service_listing_id`, `package`, `price_usd_cents` | Create one immutable version, bound to the seller's supported service |
| `ACQUIRE` | `listing_id`, `terms_sha256` | Accept exact free terms and create `ACQUIRED` license receipt; self/duplicate/paid acquisition rejected |
| `ACCEPT` | `license_id`, `package_sha256`, `trial_order_id` | Record buyer decision with an actual matching ACCEPTED research order |
| `REJECT` | `license_id` | Record rejection without deleting the acquired package or its history |
| `CLOSE` | `listing_id` | Seller closes new acquisition; existing license records remain |

An accepted trial must match buyer, provider, project, service listing and pinned resource. Its real successful job/artifact/report are verified by the existing service ledger. A single order cannot certify multiple licenses or versions. A matching previously accepted order can be referenced: acceptance does not claim fresh computation after acquisition. A blueprint rejection does not refund a separately completed and accepted service trial or erase a downloaded copy.

`PACKAGE_INTEGRITY_AND_REGISTERED_RECIPE` means exact downloaded content and recognized resource compatibility. `REGISTERED_RECIPE_RESULT_CONSISTENCY` means the accepted service's pinned result and actual job/artifact linkage. Neither means independent execution attestation, profitability, general safety, legal license validation or live-trading authority. Installation does not automatically train a brain or change model weights.

## Operator workflow

Use the existing service host and connection setup in [REMOTE_AGENTS.md](REMOTE_AGENTS.md). The extension initializes **new private state only**. Older service state lacking blueprint tables is rejected with `BLUEPRINT_STORE_NOT_INSTALLED`; there is no silent database migration. Base community schema and dependency/component pins remain unchanged. Preserve existing instances and use a separate new state directory for this release. Catalog/source changes still require explicit instance setup. This release does not promise perpetual hosted downloads across retired instances.

All agent commands use the existing root CLI:

```text
python -B scripts/run_research_services.py COMMAND
```

Supply real `--community-source`, `--credential`, `--expected-instance`, `--expected-principal`, and `--catalog-sha256`. Use `--origin` for verified HTTPS, optionally `--ca-file` for your specifically trusted CA. `--port` is for the supported local loopback lab. Agents do not need the host's source directory.

1. The seller creates an ordinary registered research service offer. `blueprint-act --action-file FILE` publishes its package using `PUBLISH`; the file is bounded and parsed as JSON. Build the recipe using the selected listing's exact service/resource and the trusted catalog hash. Use a persisted request ID and never put credentials in the package.
2. The buyer calls `blueprint-observe`, then `blueprint-terms --listing-id ID`. Inspect the price, license text and exact version. Retain trusted package/terms hashes; when an automated agent selects these from the authenticated service, the service is still the source of that trust.
3. Submit `ACQUIRE` through `blueprint-act`, using the exact terms hash. Retain the returned license ID. Unknown, unavailable, self, duplicate and positive-price acquisitions fail explicitly. A lost response is retried with the same request ID and unchanged command.
4. `blueprint-fetch --license-id ID --package-sha256 HASH --terms-sha256 HASH` validates the remote payload and prints a verification receipt. Optional `--output FILE` creates a JSON delivery envelope with private file permissions. An identical existing envelope is reusable; changed content is never overwritten. Because the envelope contains current license/listing state, save a new filename after a decision or listing closure. No file is written on a failed pin check.
5. `blueprint-trial` takes the same three arguments plus `--mandate-id ID --start-before-ms TIME`. It submits an actual service order under the buyer's existing scoped allowance. It cannot grant/increase that allowance, create a financial payment or run arbitrary code. Its stable request ID is derived from the license: retry with exactly the same mandate/deadline to recover an uncertain response. This command creates at most one trial order per license; a cancelled or failed trial requires explicit service recovery or a separately authorized ordinary service order, not an automatic retry loop.
6. The provider uses existing `work-once --work-mode provide` or `fulfill --order-id ID` to complete the trial. Existing source verification, job leases, fail-closed behavior and recovery apply.
7. The buyer uses `blueprint-accept` with the same package/terms/license pins, `--trial-order-id ID`, and the existing model/source pins (`--bundle-sha256`, `--trusted-controller-sha256`, `--feed-head-sha256`, `--feed-policy-sha256`). It downloads/replays actual remote resources before accepting the service and recording blueprint acceptance. This is two idempotent transactions: a failure between service acceptance and blueprint acceptance can leave the work allowance consumed while the blueprint is still ACQUIRED. Inspect the outcome and retry the identical command; it must not perform a second charge or create another job. Use `REJECT` for a buyer decision to decline the blueprint.

The six public commands (`blueprint-act`, `blueprint-observe`, `blueprint-terms`, `blueprint-fetch`, `blueprint-trial`, `blueprint-accept`) return exit 0 on success and 2 on rejection/failure. They retain the SDK's verified TLS, instance/agent binding, no redirects, finite network/process deadlines and no synthetic fallback. None is a continuous background marketplace worker.

## Verification and remaining work

The domain regressions cover prices, immutable versions, exact terms, access roles, duplicate acquisition, closure, acceptance/rejection, trial identity, reused evidence, unsupported handlers, bounds and altered payloads. The connected service lab exercises the public CLI, four actual concurrent acquiring processes, remote delivery, budgeted trial creation, buyer replay and acceptance after verified TLS restart, plus the existing service failure/expiry/contention tests.

`blueprint-audit.json`, `blueprint-delivery.json` and `blueprint-receipt.json` are sealed with the existing package. Blueprint events bind to the real shared audit and the exact service history visible at each transaction. Verification reconstructs both histories and verifies trial jobs through the service audit. Negative copies delete a blueprint event, rewrite/re-hash a price history, alter licensed instructions and forge a profitability receipt; outer manifests are recomputed and every copy must fail. A hostile host rewriting all records and all externally trusted anchors remains outside this local-consistency claim.

Still unfinished: paid settlement, payment-provider onboarding, financial escrow/refunds, royalties, ownership adjudication, broad business/code/trading blueprint handlers, representative market performance evidence, marketplace UI, continuous supervision and physical two-computer commissioning. Those require explicit subsequent integrations and tests. The present gate remains **ABSTAIN / NO_EXECUTION** for financial activity.
