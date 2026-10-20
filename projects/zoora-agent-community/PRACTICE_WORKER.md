# Local-model practice worker

This milestone connects an installed local instruction-following model to the
private synthetic market. It does not implement an animal-network market
adapter, train model weights, attest model identity or establish trading skill.
The school/model research stack remains separate. Service schema 9 and the
existing practice-market limits are unchanged.

## Decision and delivery boundary

The host selects one episode, enrolled agent, declared pipeline, installed model,
instance, expiry, decision budget and maximum demo buy. The worker obtains the
current observed market, its own account and the last eight observed price/flow
frames. It checks that history ends at the current tick and that the market did
not advance while the snapshot was read. Only that snapshot and bounded host
limits reach the model. The model receives one tool: paper_decision.

Each invocation performs at most one model decision. HOLD is explicit. A valid
BUY/SELL needs a visible coin, exact units, positive minimum output and available
demo cash/holdings. Server-side fees, delayed fills, drawdown and position limits
still apply independently. The worker cannot enroll accounts, advance the clock,
edit the scope, chat, operate a payment provider or sign a wallet transaction.

Observation bytes are saved and synced before inference. Decision bytes and
provider response hashes are saved before order HTTP. A request ID derives from
the frozen experiment, instance, episode, agent and tick. It never derives from
a model-selected identifier. The same experiment and tick therefore retain one
retry identity even if its directory is copied. Changed order bodies conflict
at the existing server boundary.

After uncertainty, the next invocation first checks private pending orders and
all bounded receipts. A known accepted order is reconciled through GET, without
resubmission. An unsent/unknown sealed decision can submit only the exact saved
body, once per invocation. No automatic inference or order retry loop is added.
If inference was interrupted before a decision was saved, that tick abstains
permanently in this journal. A failed or malformed local record blocks reuse.

A separate SQLite lock uses OS process locks to exclude overlapping workers on
one journal and release after process death. These locks and the local budget do
not coordinate independently created experiments or make the host tamper-proof.
Do not operate multiple experiments against the same agent account concurrently.
A complete administrator-controlled rewrite/rollback is not independently
detectable. Directory durability and Windows ACLs require operating acceptance.

## Scope file and commands

Prepare an ordinary agent credential using the existing enrollment flow. The
service owner creates an episode; its creator enrolls the agent at tick 0 with
the declared pipeline SHA256. Use the owner's independently obtained instance ID.
Store an immutable scope JSON in a private file (0600 on POSIX):

| Field | Meaning |
| --- | --- |
| version | Integer 1 |
| experiment_id | New 32-character lowercase hexadecimal identifier |
| instance_id, episode_id, agent_id | Exact trusted instance and enrolled episode/account |
| model | Exact already installed local model name |
| model_pipeline_sha256 | Creator-declared pipeline fingerprint, not host attestation |
| created_at_ms, expires_at_ms | UTC Unix milliseconds; expiry at most 24 hours after creation |
| max_decisions | Integer 1–64, including HOLD, failures and interrupted inference |
| max_buy_micro | Integer 1–250000000 micro demo USD; server limits remain |

The scope is a local host configuration, not a signed server mandate. A changed
scope, credential ID, origin or model port requires a new journal. Credential
rotation/expiry/suspension still apply at the server. An expired scope cannot
dispatch new writes, including retries; offline review remains available.

Run from projects/zoora-agent-community, using your private paths:

~~~sh
python -m zoora_community practice-step --credential-file agent.json --scope-file scope.json --journal-dir experiment-001 --model qwen3:1.7b --timeout 120 --stop-file STOP
python -m zoora_community practice-review --journal-dir experiment-001 --out experiment-001-review.json
~~~

For a remote service add --community-origin with the exact HTTPS origin. The
scope supplies both required instance/agent connection preconditions. There are
no alternate HTTP endpoints or model-selected URLs. The model remains on numeric
loopback. The existing TLS trust and connection-binding limitations apply.

Create STOP to block inference and dispatch; check it again after every model
call and immediately before HTTP. It does not cancel a request already accepted
by the service. Only the owner advances ticks. Run another bounded step after
that advancement; a pending receipt is reconciled first. This is not a daemon,
automatic owner clock, year-long unattended worker or public deployment.

## Retained evidence and interpretation

The private journal retains the frozen manifest, causal snapshots, structured
decisions, accepted order responses, terminal receipts and reason-coded failures.
Linked hashes bind observations to decisions and decisions to receipts. The
offline review rechecks these bindings, exact retry bodies and budget, and emits
file pins and HOLD/BUY/SELL/fill/rejection/unresolved counts. Its account snapshot
is the last observed estimate; marked exit value is not realized profit or a
guaranteed liquidation price. No statistical edge, independence, calibration or
neural learning is inferred from these counts.

The fast CI jobs run normal/optimized tests on Linux and Windows and retain an
actual HTTP/restart/review rehearsal using a labelled synthetic model protocol.
The existing CPU-model job additionally invokes the installed model through the
same worker, with no synthetic fallback. A valid HOLD is an acceptable CPU
integration outcome. That job tests the model-to-paper interface, not forecasting.

Independent model training, a biological market encoder/readout, curriculum
integration, supervised multi-episode evaluation, external timestamping and ASE
company/investment records remain later milestones. This code adds no database
migration, real execution permission, release or deployment.
