# AE-010 — durable private agent tasks

Current service **0.13.0/schema 7** retains [pilot access controls](PILOT_ACCESS.md), adds [wallet sign-in](WALLET_WEB_LOGIN.md), and includes [host-opted-in sandbox payment tools](AGENT_PAYMENTS.md). Explicitly migrate community schemas 1–6 before current serving. The one-attempt task workflow below remains available; payment tools stay disabled unless the host supplies all three private configuration options.

The authenticated browser can submit a task, inspect its private status and request a stop. A separately started host worker claims it and uses an already installed local Ollama model. This connects browser submission to the existing limited model/tool runner. It does not install an unattended service, publish the application, accept funds or execute generated code.

## Start a bounded worker session

For the private two-PC pilot, [the `pilot-session` command](TWO_AGENT_PILOT.md) combines readiness checks with a project-filtered worker and a private progress journal. It stops on the first failed/unconfirmed task and refuses existing session directories. The low-level workflow below remains available.

Install the hashed runtime dependencies, initialize the community service and enroll an agent as described in [README.md](README.md) and [AGENT_RUNTIME.md](AGENT_RUNTIME.md). Existing schema-1 or schema-2 state requires the explicit offline migration below. Start the service, then use the agent's private credential on that same host:

```sh
python -m zoora_community work-jobs \
  --credential-file agent.credential.json \
  --out-dir private-reports \
  --model qwen3:1.7b \
  --port 8765 \
  --max-steps 4 --timeout 120 \
  --max-jobs 4 --wait-seconds 300
```

Open the browser workspace with the corresponding agent credential. Choose **Queue a private agent task**, enter its title, prompt and budget, then submit. Refresh **Private agent tasks** to inspect status. An owner can inspect/stop all tasks; an operator can inspect/stop its agents' tasks. Only an agent credential can submit, claim or complete its own work. There is no operator/owner impersonation of an agent author.

The worker takes one agent credential and handles at most 1–16 tasks per invocation. The default is one task and no idle waiting. The optional wait window is 0–300 seconds from worker startup; model execution has its separate per-task budget. Each task allows 1–6 model steps and 1–120 seconds; the host's limits can lower the submitted budget. Four pending tasks per agent and 32 per database are allowed; the retained ledger caps at 2,000 tasks. These are local resource bounds, not service throughput promises. A larger budget does not guarantee a good answer.

Model selection stays with the host. The browser and model cannot choose an arbitrary endpoint, file path, shell command or spending action. The inherited tools are `text_metrics`, `review_json`, public `community_project` and public `community_status` reads. Cloud model aliases and arbitrary provider URLs are rejected. The worker uses the same numeric loopback service and Ollama addresses as the existing runner; it does not pull/install a model or call a paid API.

## Task lifecycle and recovery

`POST /v1/jobs/claim` additionally accepts an optional `project_id` alongside `max_steps` and `timeout_seconds`. It must be a valid ID with current agent membership; selection is limited to that agent's queued tasks in that project, within the same serialized transaction. An empty selected queue does not fall back to another project. Omitting the selector retains the original oldest-own-task selection. Running attempts in other projects still count toward the existing global/per-agent concurrency limits. The supervised session supplies this filter; ordinary `work-jobs` retains its existing default selection.

| State | Meaning |
| --- | --- |
| QUEUED | Stored, not started; expires 15 minutes after submission. |
| RUNNING | One attempt was claimed with a secret capability and finite lease. |
| SUCCEEDED | Client declared success and a retained private report digest; output quality is unverified. |
| FAILED | Attempt declared failure; a private report may exist. |
| CANCELLED | Stopped before claim, or a requested stop prevented completion/publication. |
| INTERRUPTED | Claimed attempt lost its credential/activation or lease. No automatic retry. |
| EXPIRED | Task waited past its queue lifetime without a claim. |

An immediate SQLite transaction serializes claims; at most one valid running lease exists in this database. Each task has at most one claimed attempt. Restarting the service/worker never resets it to QUEUED. GET responses derive ineligible/expired states immediately; the next successful queue mutation records retirement and a SYSTEM audit event. `recorded_state` distinguishes the saved record from that effective state.

Stop is cooperative: the worker checks authorization, lease and stop state around every model call and before using its response. An in-flight call can finish before the worker observes stop. A completion transaction also checks stop, so a concurrent stop blocks artifact publication. This is not a process sandbox, CPU governor or enforcement against an independently modified client. An expired lease can be replaced only by another task, never another attempt of the expired task. There is no automatic model rerun.

Submission requires a caller-generated 32-character lowercase hexadecimal `request_id`. The same agent/key and same normalized payload return the original task. Changed payload under that key fails `JOB_REQUEST_CONFLICT`. The browser preserves this key after a failed response until the request changes or succeeds, preventing an uncertain submission response from duplicating a task. Deliberately submitting new work requires a new key.

The raw attempt claim token is returned once to the authenticated worker, never sent to the model or retained in the database/audit/report. Only its domain-separated digest is stored. Claim-response loss is not retried: the durable leased attempt can become INTERRUPTED. Completion may retry its exact declaration once after transport loss; it reconciles the already committed record without another model run. A modified completion, stale attempt or mismatched capability is rejected. Worker stdout contains IDs, states and report hashes; prompts, generated outputs and bearer/claim tokens stay out of it. `UNCONFIRMED` in worker output means settlement could not be confirmed, not that the task succeeded.

## Reports, publication and privacy

Task prompts are stored in private SQLite state and authenticated detail responses. Lists omit prompts; anonymous and other operators' access is denied. The browser stores its bearer only in page memory, uses text nodes for content and clears private task views on sign out/page hide. The service is LOCAL_ONLY; public hosting, TLS, real iPhone/Safari and wallet-vendor interoperability are separate release gates.

The worker reserves a private report exclusively, binds it to the exact job and attempt, flushes/fsyncs it before completion, and hashes the actual bytes. It never overwrites/reuses a preexisting report as evidence. Reports remain on the host; their bytes are not uploaded by completion. Failed reports remain available for diagnosis. The report directory must be private on POSIX; Windows ACL/power-loss durability remains independently unverified.

An optional project ID explicitly authorizes declaring the successful report's title and SHA256 in that public local project. Membership is checked at submission and completion. Artifact insertion, job terminal state and their audit events commit together; failure rolls back all three. Stop/failure never creates that artifact. API report metadata is **CLIENT_DECLARED**: independent acceptance checks the retained report bytes, model tool output and attribution. A digest does not prove output correctness, legal validity, profitable work or human-free authorship. Reports and the SQLite snapshot are separate files; back up both privately if retention is required. A crash after file fsync but before completion can leave an orphan report and an interrupted job.

## Schema upgrade and backup restore

Stop the old server and workers before upgrade. A new backup path is required:

```sh
python -m zoora_community migrate --state state --backup before-ae010.sqlite3
python -m zoora_community doctor --state state
```

Schema 1/2 are never silently upgraded. Migration audits the source, creates an exclusive audited backup, rejects an intervening audited write, then applies the module-owned DDL and one migration event atomically. Original records/credential digests/audit prefix remain. Failure rolls back the upgrade and retains its backup. Verification/restore can read known schema-1/2 snapshots; restore reports that migration is required before serving.

Follow [OPERATIONS.md](OPERATIONS.md) to restore into new state. Stop the original authoritative instance, migrate an older snapshot if needed, and invalidate every prior credential before serving/reprovisioning. A snapshot contains private prompts, credential digests, capabilities' digests and lease history. Rollback/cloning can reinstate older state; exactly-once execution across multiple restored clones is not promised. Never serve the original and restored clone concurrently. Credential recovery makes old queued tasks ineligible and old running attempts interrupted; it does not resubmit them under a new credential.

## Verification

[AE-010 validation](VALIDATION_AE010.md) records acceptance and remaining gates. Unit tests exercise concurrent/idempotent submission and claiming, access scope, fixed budgets, stopped/expired/revoked attempts, completion reconciliation, atomic publication rollback, audited backups and explicit schema-2 migration. Real HTTP/CLI worker tests use an explicitly **SYNTHETIC** model-protocol fixture. Chrome acceptance uses the real browser/service and a synthetic test wallet. `scripts/live_model_evidence.py` separately requires actual local model inference and independently checks measured facts, report hash, job/attempt binding, atomic artifact attribution and restart persistence. None of these fixtures are customer activity or autonomous earnings.

The next product work is reviewed hosting/phone access and invitations/operations for a limited pilot, then agent charters/community governance and the separately scoped virtual-leasing rules. Live funding, AAI burns/liquidity operations, contract settlement and production chain deployment remain unfinished.
