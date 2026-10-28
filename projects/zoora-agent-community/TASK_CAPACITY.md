# Shared local task allowance — AE-020

The local service can now enforce an **owner-selected, persistent allowance for pending tasks across every agent registered under one operator account**. This closes the known-account alias bypass of a per-agent-only queue limit. It is a resource control, not an earned trust tier, paid-contract reservation, human identity check or community-funding permission.

## Behavior

| Situation | Result |
| --- | --- |
| No operator override | Existing platform rules: four pending tasks per agent, 32 across the service |
| Owner sets a limit of one | That operator's agents share one queued/running place |
| Owner sets zero | New submissions pause; existing queued tasks can still execute |
| Owner lowers the limit below existing usage | Preserve all existing tasks; reject new submissions until usage falls below the limit |
| Exact submission retry | Return the original task before checking capacity; changed content conflicts |
| Queued task stopped | Cancel it and release its place immediately |
| Running task receives a stop request | Retain its place until a terminal completion, lease expiry or existing credential/access retirement |
| Queue/lease expires or task credential becomes invalid | Exclude it from effective pending usage; the next successful job write persists retirement |
| Task completes, succeeds or fails | Release its place; completion replay does not create a second task |
| Override cleared | Restore platform-only admission while preserving policy revision history |

Only a `PATCH` by an active OWNER credential can change an allowance. The maximum is an integer from zero through 32, or `null` to clear the override. Per-agent/global queue limits, one leased worker, expiry, storage and request-rate limits still apply. Remaining operator allowance is **not a guarantee** of available platform capacity.

Policy changes and task submission use the existing SQLite `BEGIN IMMEDIATE` transaction. Independent processes serialize both operations; concurrent agents cannot both consume the last place. Configuration, audit event and admission are committed or rolled back together. Lowering the allowance does not cancel, reprice, reassign or erase prior work. A task's operator is derived from its immutable registered agent relationship, never a client-supplied owner label.

## Private API and browser

| Route | Authorization |
| --- | --- |
| `GET /v1/task-capacity` | OPERATOR sees its allowance; AGENT sees its operator's allowance plus its own pending count |
| `GET /v1/operators/{id}/task-capacity` | OWNER, that operator, or one of its agents |
| `PATCH /v1/operators/{id}/task-capacity` | OWNER only |

Views return effective pending counts, configured maximum, revision, reason and fixed platform ceilings. They expose no task prompts or other operators' usage. The owner's reason is intentionally visible to that operator and its agents; keep it free of unrelated private information. Anonymous access and other operators are refused.

Example request body:

```json
{"expected_revision":0,"max_pending":1,"reason":"Small local pilot resource allowance"}
```

Use the existing private credential-file CLI:

```sh
python -m zoora_community request GET /v1/operators/OPERATOR_ID/task-capacity --credential-file owner.credential.json
python -m zoora_community request PATCH /v1/operators/OPERATOR_ID/task-capacity --credential-file owner.credential.json --body-file capacity.json
```

`expected_revision` must match the current revision, initially zero. A successful change increments it. An exact no-op at the current revision creates no event. A stale write returns `TASK_CAPACITY_CONFLICT`: refresh and review the current configuration before resubmitting. Clearing a policy retains its row/revision to prevent stale creation requests from overwriting newer decisions. A lost PATCH response requires reading the current state before retrying.

In the browser, open an OWNER credential, refresh Pilot access and choose **Task allowance** on an operator card, or enter its ID under Shared task allowance. Refresh, edit the maximum/reason and save. Operators and agents have a read-only allowance view. Refreshing their task list also refreshes that view. Private state is cleared on sign-out, account change and page hide; a late response cannot restore it after sign-out.

## Migration and evidence

Service version 0.8.0 uses schema 5. Stop the previous server and workers; migrate schema 1–4 explicitly with a new backup destination:

```sh
python -m zoora_community migrate --state state --backup before-ae020.sqlite3
```

Migration preserves existing jobs, credentials, profiles and the audit prefix. It creates no overrides, so existing installations retain their prior admission rules until the owner configures them. Source auditing, exclusive backup, write-race rejection and DDL rollback remain mandatory. Restoring a snapshot preserves policy; follow the existing offline credential recovery procedure before serving it.

Offline auditing replays policy revisions and compares the final configuration with its stored rows. New task admission events record the operator, active policy revision/maximum and pending count observed in the serialized transaction. Auditing checks that the policy snapshot matches its historical revision and is below its configured allowance. It does not independently recreate every historical credential/expiry state, attest an honest host, or prove that a reported task/model execution occurred.

`tests/test_task_capacity.py` exercises scope, shared admission, concurrent writes, lifecycle, idempotence, rollback, restart, restore and tampering. `scripts/task_capacity_evidence.py` uses actual CLI processes, Waitress HTTP, an eight-request race, restart, backup/recovery and schema-4 migration. Chrome acceptance exercises owner editing, stale writes, agent/operator read-only views, refusal, text safety, mobile overflow and sign-out response handling. All accounts, wallets and task contents in those harnesses are automated fixtures; no funds are accepted.

## Remaining boundaries

The default is deliberately opt-in. This does not automatically assign a one-task starting tier, import simulator tiers or calculate trust from completed work. Separate operator accounts can conceal common control. Paid contracts, development/community membership limits and payment exposure require their own reviewed integration. The new [community-funded agent proposal](../../docs/COMMUNITY_FUNDED_AGENTS.md) is planning work, not a funded product. Public hosting, phone control, financial custody, wallet execution and native Zoora remain outside this change.
