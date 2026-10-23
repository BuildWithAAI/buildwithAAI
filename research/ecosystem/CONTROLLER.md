# Owned experience execution and recovery

The shared-experience experiment already binds outcomes to local oracle replay and audited agent artifacts. This layer consumes its verified package and reconstructs the same delivery sequence in a controlled journal. Each of five batches runs in a fresh Python process. A batch commits its memory events and checkpoint in one SQLite transaction. Independent verification compares the entire resulting experience state with the verified upstream journal.

The five batches are bootstrap training, shared training, 100 duplicate deliveries, five rejected shares and 12 later counterexamples. They reproduce 629 events: 624 admitted training outcomes and five quarantines. The duplicate batch adds a controller checkpoint without adding experience or confidence. Selected model digests, three blocked contexts and the upstream ABSTAIN qualification remain connected in the observer projection. This layer submits no additional community jobs and performs no additional model fitting.

## Ownership and commit rules

| Mechanism | Enforced behavior |
| --- | --- |
| Nonblocking OS file lock | A second cooperating process cannot acquire ownership, including with the recovery flag, while an owner holds the lock |
| Persistent lock file | Never deleted or replaced by the controller; inode changes, aliases and symlink paths fail closed |
| Database epoch and random owner nonce | Every acquisition advances the epoch; a stale, closed or fork-inherited session cannot commit |
| Frozen binding | Policy, plan, upstream package and protocol are bound before the first delivery |
| Compare and swap | Each new batch requires the exact preceding checkpoint and the next fixed plan index |
| Atomic checkpoint | Events and their checkpoint share one DELETE-mode, synchronous=FULL SQLite commit |
| Delivery and batch idempotence | Retrying an acknowledged or unacknowledged completed batch returns its original receipt without changing memory or the checkpoint |
| Full replay before writes | Reconstruct every checkpoint from the fixed plan and replay the journal; detect missing checkpoints, missing events and writes bypassing the controller |
| Retained external anchor | Resuming with a known later checkpoint rejects an otherwise valid older database snapshot |

The database is capped at 8 MiB, the frozen plan at 4 MiB / 32 batches / 4,096 deliveries, and the experience history at 2,048 events. Failed admission transactions, SQL checkpoint failures and growth-limit failures roll back both tables. A read transaction sees a committed snapshot; SQLite can report contention rather than expose a partial batch.

~~~mermaid
stateDiagram-v2
  [*] --> Released
  Released --> Owned: acquire exact checkpoint
  Owned --> Owned: atomic batch and checkpoint
  Owned --> Released: verified close
  Owned --> RecoveryRequired: process death
  RecoveryRequired --> Owned: OS lock plus explicit recovery and exact checkpoint
  RecoveryRequired --> Rejected: stale checkpoint
  Owned --> Rejected: competing owner or stale epoch
~~~

## Crash and recovery boundary

Ordinary acquisition refuses an abandoned active owner. The OS releases its lock after process death, but the database retains the active owner marker. Recovery must be explicit and must supply the exact current checkpoint. There is no elapsed-time lease or automatic takeover of an owner that might still be alive.

If the process dies before commit, SQLite rolls back the entire batch and its checkpoint. If it dies after commit but before acknowledgement, both survive. The caller reconciles the verified committed checkpoint, recovers ownership and retries using the batch's original preceding checkpoint. The retry returns the original commit receipt.

Persist the latest trusted checkpoint separately from the database when using the Python API. A hash chain alone cannot detect restoring both the database and every copy of its trusted anchor to an earlier valid state. The sealed experiment also compares with the independently verified upstream final state, so a truncated valid prefix cannot qualify as a completed package.

The CLI builds a fresh reproducible experiment and seals its manifest last. It does not automatically resume incomplete output directories. The lower-level `ControlledJournal.acquire(expected, recover=True)` is the explicitly tested recovery path; an interrupted package build remains incomplete and must not be presented as complete.

## Executed fault evidence

`fault-checks.json` is regenerated in disposable databases during build and every verification. It records eight passing probes, rather than trusting previously recorded pass flags:

1. A separate live owner excludes normal and recovery acquisitions.
2. A reader observes the previous committed checkpoint while another process pauses after writing but before commit.
3. Process exit 73 before commit leaves no partial batch and requires explicit recovery.
4. Process exit 74 after commit retains the batch; stale-anchor recovery fails and retry does not reapply it.
5. Restoring an older complete database is rejected against the retained newer anchor.
6. Writing through the raw experience API without a controller checkpoint is detected.
7. A false checkpoint is rejected even after its own hash is recomputed.
8. Advancing the stored ownership epoch fences the earlier session.

Four additional package copies first pass verification, then alter a checkpoint, roll back a complete final batch, change the frozen plan or change the public guard. Their outer manifests are recomputed; the false checkpoint's own hash is recomputed too. All copies must be rejected, and the original package must still verify. These probes share the production replay routines; they are fault-injection evidence for the stated local protocol, not an independent implementation or cryptographic execution attestation.

The portable tests also cover SQL failure after event insertion, real transactional size-limit rollback, strict JSON numeric types, retained lock inode, clean release, rejected double initialization and caller-owned dictionary mutation. Linux and Windows run strict normal and optimized tests. Actual pinned community/Reef execution continues on Linux/POSIX because the upstream Reef worker requires Unix `resource`.

## Connected commands

Use the existing pinned clean component checkouts and community/Reef runtimes. The source, handoff, report-learning, behavior and experience packages must already verify. Run commands serially:

~~~sh
python -B scripts/run_ecosystem_controller.py run --directory /private/controller --experience-directory /private/experience --behavior-directory /private/behavior --ecosystem-directory /private/connected --learning-directory /private/learning --scanner-source /private/scanner --community-source /private/community --community-python /private/community-venv/bin/python --reef-source /private/reef --reef-python /private/reef-venv/bin/python
python -B scripts/run_ecosystem_controller.py verify --directory /private/controller --experience-directory /private/experience --behavior-directory /private/behavior --ecosystem-directory /private/connected --learning-directory /private/learning --scanner-source /private/scanner --community-source /private/community --community-python /private/community-venv/bin/python --reef-source /private/reef --reef-python /private/reef-venv/bin/python
python -B scripts/run_ecosystem_controller.py negative-checks --directory /private/controller --experience-directory /private/experience --behavior-directory /private/behavior --ecosystem-directory /private/connected --learning-directory /private/learning --scanner-source /private/scanner --community-source /private/community --community-python /private/community-venv/bin/python --reef-source /private/reef --reef-python /private/reef-venv/bin/python
~~~

For an existing synthetic-only parent, omit ecosystem/learning/scanner arguments and pass `--synthetic-only`. The upstream qualification explicitly remains `BLOCKED_SOURCE_NOT_PROVIDED`. Both connected and synthetic modes fully verify their declared upstream chain before and after the controller experiment.

Only `public-snapshot.json` is the observer handoff. It exposes aggregate memory/checkpoint status, upstream selected model digests and the unchanged market qualification, with no raw task records or private identity details. Hash-linked JSON does not establish that a deployed stream, assistant or social bot consumes it.

## Scope of this advance

This establishes exclusive local controller ownership and tested process-crash consistency for the fixed, verified research plan. It adds a concrete prevention/detection boundary around unsupported overlapping controllers. It does **not** establish the cause of the intermittent local snapshot issue previously observed during overlapping development commands, or qualify arbitrary concurrent controllers running the older upstream package builders.

Locks and fencing apply to cooperating processes on one machine using a normal local filesystem and the same lock path. Network filesystems, distributed failover, power-loss durability, hostile processes that can replace both database and lock files, and external economic side effects are unqualified. Raw SQLite access can bypass the OS lock; subsequent replay detects mismatched memory, but the controller is not an OS security sandbox. No automatic repair erases or rewrites accepted history.

The learning registry and task features remain bounded and synthetic. This is not a new autonomous service, broad self-learning, semantic contract/code assurance, a FlyVis/LLM weight update or evidence of a trading advantage. The existing risk and authority controls remain authoritative. No live execution, payment, token reward, funded key, chain change or deployment is introduced.
