# Authenticated durable commerce — AE-023

The existing local community service now persists commerce policy books and commands under its actual scoped API credentials. Service **0.9.0 / schema 6** adds authenticated operator/agent mapping, server-derived identity/time, transactional shared budgets and replay after restart.

Economic amounts, merchants, provider eligibility, settlement/refund and supplier-order observations remain **synthetic research fixtures**. A local API credential authorizes local records; it does not prove human identity, business eligibility, legal authority or permission to move a wallet. No provider, bank, card, live signer or payment worker is connected.

## Local API

| Method/route | Access and result |
| --- | --- |
| POST /v1/commerce/books | OPERATOR creates its own immutable policy book; exact request retries reconcile |
| GET /v1/commerce/books | Private summaries filtered to the operator, explicitly bound agents or platform OWNER |
| GET /v1/commerce/books/BOOK_ID | Authorized shared-book policy, stable agent bindings, last committed state and server elapsed time |
| POST /v1/commerce/books/BOOK_ID/actions | Appends one authorized, idempotent command and audit event in the same SQLite transaction |

Creation body: `request_id` (32 lowercase hex), `policy` (the existing AE-022 schema) and `bindings` (alias/registered agent-ID pairs). The policy controller and candidate route owner labels must be `operator`. Every declared alias must map one-to-one to an active agent registered under the authenticated operator. No aliases are inferred from display names; bindings remain stable across handle or credential changes.

Aliases share a book's lifetime budgets. Books are independent mandates: limits and invoice deduplication are not global across different books, and there is no real wallet balance/reservation. Four books per operator and 64 globally bound storage, not solvency. A book cannot be updated to reset its budget; revocation is retained.

Action body: `{"request_id":"...","command":{...}}`. Commands use AE-022 fields with these API differences:
- Never supply `actor`, `at_tick` or a purchase quote's `payer`. The service derives them from the credential and server clock.
- Quote/mandate/schedule times are milliseconds elapsed since book creation, not Unix timestamps. This keeps ticks within the model's bounded integer domain.
- Agents can request PURCHASE, SUBMIT or CANCEL for their own bound alias.
- The book's OPERATOR can cancel an unsent purchase or REVOKE the entire book. It cannot impersonate an agent to create/submit a purchase.
- Platform OWNER can inspect or REVOKE as an administrative pause, but cannot create an operator book, submit purchases or declare terminal fixtures.
- Only the book's OPERATOR may append RESOLVE/REFUND/FULFILL observations, and each must include `fixture: true`. These never become verified provider evidence.

Use the existing credential-file CLI after [enrolling the operator/agents](README.md):

```sh
python -m zoora_community request POST /v1/commerce/books --credential-file operator.credential.json --body-file book.json
python -m zoora_community request GET /v1/commerce/books --credential-file operator.credential.json
python -m zoora_community request POST /v1/commerce/books/BOOK_ID/actions --credential-file agent.credential.json --body-file command.json
python -m zoora_community request GET /v1/commerce/books/BOOK_ID --credential-file operator.credential.json
```

Use the returned book ID and real locally enrolled agent IDs. The API remains loopback-only. The current model tool set and browser workspace do not expose these endpoints; a separate client/adapter must explicitly use them. This milestone adds no public hosting, iPhone control or browser payment UI.

## Persistence and recovery

`BEGIN IMMEDIATE` serializes authentication, authorization, model replay, budget reservation, idempotency checks, command persistence, book summary and audit append across database connections/processes. A response is returned after commit. Failure before commit rolls everything back; a lost response can be retried with the same request ID without another command/attempt.

The stored request digest binds the authenticated role/principal and complete request. Credential rotation retains the same principal and does not reset its budget. Another principal or changed command cannot reuse the request ID. Current credential expiry, revocation and account suspension still apply to every request.

Each stored action has server-derived actor/time, its request, outcome and resulting state hash. Replay verifies the full history and cross-checks policy, agent bindings, credentials, audit ordering and summaries. The shared audit catches deleted commands even when a book summary is reset. Local hashes provide internal consistency, not an external attestation or defense against a host that rewrites a wholly consistent database.

Unknown submitted outcomes remain reserved through service crashes, expiry and revocation. Suspended credentials cannot append new actions. Authorized operator fixtures can record late outcomes without granting new spending rights. Refunds do not replenish lifetime budgets. Reads expose the last committed model state and its evaluation tick; they do not silently sweep expired authorizations. Every new command revalidates current server time.

Reports can be reconstructed from persisted actions. This is durable local accounting/policy state, **not** a resumable network payment executor: there is no provider retry, signed transaction, external reconciliation, card capture or supplier dispatch.

## Schema upgrade and backup

Existing schemas 1–5 require explicit offline migration with an exclusive audited backup:

```sh
python -m zoora_community migrate --state state --backup before-schema-six.sqlite3
python -m zoora_community audit --state state
```

Migration preserves existing accounts, credentials, tasks, task-capacity settings and the audit prefix. It creates empty commerce tables and grants no spending automatically. A failed migration rolls back new tables and retains the valid old-schema backup. The schema-6 DDL is included in the runtime package digest.

Existing backup verification and restore replay commerce history. Credential-invalidating owner recovery preserves records while refusing old access. Restoring an old backup does not recover external events that happened afterward; any future real executor must reconcile with providers before resuming. That executor is not implemented here.

## Verification and limits

The new regressions exercise real scoped service calls, eight database connections, two actual processes racing one remaining allowance, abrupt process exit before commit, crash/restart, credential rotation, suspension, owner/operator boundaries, malformed identity/time, idempotency, refunds, backup/restore, tampered/rehashed histories and schema-5 migration/rollback.

`scripts/durable_commerce_evidence.py` runs 16 actual CLI/Waitress HTTP checks. It enrolls public NEVER-FUND fixture wallets, races eight requests, kills/restarts the service with an unresolved attempt, checks revocation and late fixtures, restores with old credentials invalidated, and upgrades a schema-5 fixture. Its retained 20 commands/21 state views reconstruct an offline report checked by the separate accounting auditor.

The final scripted allocation is 90 synthetic principal settled, ten refunded, 80 net principal and three separately denominated fee units consumed. These are not business sales, money, profit or independent agent performance. HTTP times, generated account IDs and race winners differ between runs; report fingerprints are run-specific. Earlier deterministic payer/commerce references remain unchanged.

Limits: 256 retained commands/32 purchases per book, 64 books, four books/operator, 16,384 action rows, existing 16 KiB request/64 MiB database/50,000 audit-event bounds and authenticated write throttles. No compaction/deletion API is supplied. Audit replay is bounded but not a production throughput benchmark. Unix directory/file permissions are enforced; Windows ACL/host security remain separate operational work.

Next: a constrained signer and approved provider sandbox, verified external outcomes, actual invoice/resource binding and recovery that reconciles uncertain submissions with the provider. Existing task collaboration, collective research, AAI economics and native Zoora protocol scope remain separate. [Validation](VALIDATION_AE023.md) · [Commerce rules](COMMERCE_ROUTING.md) · [Architecture](../../docs/AGENT_PAYMENT_SYSTEM.md).
