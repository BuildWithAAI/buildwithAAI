# Verify selected past pilot tasks

Service/client 0.14.4, schema 7. `pilot-review` compares current authenticated records for 1–16 explicitly selected tasks with the private report bytes retained on that PC. It can resolve a lost completion response: the service can already be `SUCCEEDED` while the original journal says `UNCONFIRMED`.

The command performs only pinned community GETs. It does not call Ollama, claim/complete work, post notes, renew credentials, retry a mutation, resume a session or alter inputs. It inspects an existing private report directory and reserves a new private output before network access. Service version/instance checks precede every request; agent preconditions accompany authenticated requests. Private visibility, anonymous content denial, project membership and final credential consistency are required.

## Run on each PC

Keep the original session directory. Obtain task IDs from its confirmed `CLAIMED` records or the authenticated task view. Use the independently supplied instance/agent/project IDs. Replace the example origin with the configured HTTPS service; `https://zoora.ai` remains an intended target, not a verified deployment.

```powershell
python -m zoora_community pilot-review --community-origin https://zoora.ai --expected-instance INSTANCE_ID --expected-agent ALPHA_AGENT_ID --credential-file "C:\ZooraPilot\alpha.credential.json" --collaboration-project PROJECT_ID --reports-dir "C:\ZooraPilot\alpha-session-001\reports" --job-id JOB_ID --out "C:\ZooraPilot\alpha-review-001.json"
```

Repeat `--job-id` for additional tasks from the same agent/project, at most 16 distinct IDs. Use Beta's own credential, agent ID and reports on PC two. A fresh valid credential for the same agent may review an earlier task; its report must still identify the original worker credential. Missing/malformed/duplicate IDs, unsafe input directories and existing outputs fail before network access. Windows ACL setup and trusted parent directories remain host responsibilities.

| Result | Meaning |
| --- | --- |
| `SELECTED_TASKS_CONFIRMED` | Every selected task is currently `SUCCEEDED`; its exact attempt, agent, original worker, prompt, limits, steps and connection pins match the retained `AVAILABLE` report, whose byte count/SHA256 match the service declaration. |
| `ATTENTION_REQUIRED` | At least one task has not succeeded, or its local report is missing, unsafe, changed or bound differently. Each checked task has a fixed reason. |
| `BLOCKED` / `INTERRUPTED` | The complete read could not be established: identity, privacy, authorization, membership, deadline, transport, response validation or user interruption. Earlier matches do not establish a complete review. |

Only `SELECTED_TASKS_CONFIRMED` exits zero. The CLI prints the private result's SHA256 and checked/confirmed counts. Existing results are never overwritten. A disk/write failure has no successful CLI result; preserve partial evidence and use a new filename for a deliberate later review. The shared read budget is 30 seconds after local validation; OS DNS, trust-store and filesystem delays can exceed a wall-clock budget.

The result excludes prompts, notes, titles, model output, bearers, claim tokens, credential paths and remote error text. It contains selected identifiers, fixed states, digests and observation metadata. Input reports remain private because they contain task/model content. POSIX inputs/output use existing private-file checks; this does not verify Windows ACLs or protect against a hostile local administrator.

## Interpret uncertainty

- A confirmed review is a fresh observation of server success and matching client-declared bytes. It does not rewrite the original `UNCONFIRMED` journal entry.
- A lost claim response may leave no known attempt in the journal. Inspect the authenticated task view before selecting an ID. Absence of a local result does not establish that no attempt exists or authorize another model run.
- Queued, running, failed, cancelled, effectively expired and interrupted tasks are never called completed. Review does not wait, retire leases, requeue or change state. Effective lease expiry can be observed without changing the database's recorded state.
- Only selected IDs are checked. `all_historical_tasks_checked` is always false. An empty queue, elapsed time, old passing test or saved file alone does not establish completion of other work.

The artifact ID is the service's declaration from its task record; a separate artifact listing is not independently audited. Matching bytes do not establish answer quality, independent model/hardware execution, useful delivery, continuous availability, money movement or income. The service and local files remain trusted inputs rather than signed third-party attestations.

The 22 new regressions use actual TLS into Waitress/SQLite, actual CLI processes and explicitly synthetic model protocol fixtures. The strict actual-CPU-model workflow additionally exercises `pilot-session` followed by `pilot-review`; exact-current-source CI must pass before that changed-source gate is verified. Physical PCs, vendor wallets, DNS/TLS/proxy, monitoring/restore and sustained-operation acceptance remain separate.
