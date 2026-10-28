# AE-019: validation of the enrollment-to-simulator bridge

October 15, 2026. This development worktree is based on AE-018 head `5416da5f4cc367bf3fa04e2a76ab5118ad38c585`, tree `cbc21ecf2ff659fcb9963d885e714402e4a6dc5d`. The base contains the prior owner-limit milestone, not this bridge. The [retained local evidence](evidence/ae-019-local.json) labels its parent and dirty worktree explicitly. Final published-source heads, workflow results, artifacts and remaining limits are recorded in the draft development PR. No merge or deployment is part of this milestone.

## Local checks

The local environment uses CPython 3.12.14 / SQLite 3.53.1 and the existing hash-locked runtime dependencies. **215 tests pass in normal Python and 215 pass with `-O`**, with development warnings treated as errors. This includes 30 new tests covering authenticated scope, selected proof relationships, current suspension, historical credential rotation, changed handles, operator versus agent proofs, external pins, rehashed signature/mapping forgeries, restart, concurrent export, atomic audit rollback, limits and safe executable invocation. Ruff and all three existing browser JavaScript syntax checks pass.

All four prior local CLI/HTTP acceptance scripts pass: integration/restart/backup, schema migration, operations/crash/recovery and pilot access/suspension. Existing browser, live RPC and actual model integration are separately exercised by final-source community CI; this document does not turn earlier results into new local executions.

The new end-to-end acceptance script passes **30 checks**. It creates eight fixture agents under five authenticated operator accounts through the actual local HTTP service, signs their wallet enrollment messages with public NEVER-FUND test keys, exports through the actual CLI, binds native inputs and invokes the real optimized Rust binary. Its independent Python auditor checks every resulting native history. The local native executable was built from the unchanged AE-018 Rust source; final bridge CI builds the native executable directly at the published head and reruns its optimized regression suite.

Normal and optimized Python produce identical complete bundle bytes for a fixed snapshot/input/engine. All three committed reference bundles replay with a separately pinned current engine. Source instances, IDs, times and executable digests vary between fresh acceptance runs, so fresh Linux/Windows bundles are not expected to have identical bytes. Their relationships, signatures, policy outcomes and frozen reference verification must agree.

## Measured bridge example

The fixed input has 17 original action positions evaluated under three policies. The resulting runs contain 51 original action evaluations, 98 canonical inner recovery actions, 808 checked agent states and 270 checked owner states. These are alternative simulated histories, not real paid jobs or user trials.

| Policy | Admitted agreements | Owner-gate refusals | Simulated payment units recorded |
| --- | ---: | ---: | ---: |
| Individual agent checks | 3 | 0 | 300 |
| Shared owner work count | 1 | 2 | 100 |
| Shared count, budget and hold | 1 | 2 | 100 |

Slots 0, 5 and 7 share a server-recorded operator. The exported mapping preserves that relationship and the native run refuses a client input that assigns an alias to another owner. The signatures are verified directly as well as through the snapshot validator, and the snapshot's wallet/operator/handle records are compared with the current HTTP service records.

Rehashed operator reassignment fails the original signed affiliation. Rehashed invented native payment totals fail both native replay and independent accounting. External pins additionally protect server-assigned IDs, current handles, report metadata and the producer digest. The unit suite explicitly shows why the snapshot pin is necessary: initial enrollment signed `Agent: NEW`, before a final UUID existed. A self-recomputed digest is not source authentication.

Suspension prevents a new export of the selected accounts. It does not erase a historical offline report, and historical replay provides no live API authorization. All native wallet-execution flags remain false. No raw API credentials occur in the complete snapshot or bundles. The example agents, consent, reviews, deliveries and payment observations are fixtures; wallet enrollment does not authenticate those simulated work actions.

## Retained complete reference

| File/payload | Bytes | SHA-256 |
| --- | ---: | --- |
| `examples/identity-bridge.json.gz` | 30,685 | `6f8a5077efb9291073a00723596c5c237cb77dbf4f6fae237864f7c898795191` |
| Decompressed full reference | 591,981 | `41b7dbf1fe390fc8da19b42a17ab3ba3ef8351eed4e352a4dffa6eff886cd392` |

The archive retains the complete original snapshot and all three complete native bundles. [Reference pins](examples/identity-bridge-pins.json) supply the snapshot and bundle fingerprints. The keys are publicly reproducible test keys; do not fund or reuse them for real wallets. Compressed evidence is marked binary in Git attributes to preserve its bytes.

The new bridge workflow tests both Linux and Windows against the actual Rust engine; the existing community workflow covers five supported Python/OS combinations, Chrome, read-only live RPC and actual local-model inference. Exact final-source job logs and SHA/CRC-verified artifacts are recorded in the development PR. CI dependency checks are dated known-vulnerability checks, not a security certification or host audit.

## Limits and remaining work

The service remains LOCAL_ONLY, schema 4. No existing wallet-proof protocol, Rust source, simulator golden report, live work policy or ledger is changed. The export uses a selected set of 8–64 active accounts; it is not global accounting. Trust pins from the authenticated workflow or a trusted repository version, not from a modified file presented with its own replacement pin. Local audit-prefix hashes are not external attestations; host compromise remains outside this protection. File/executable checks assume trusted directories.

Different authenticated operator accounts can still hide common human control. Current continuous wallet control, real identity/reviewer verification, reliable work assessment, live trust/capacity enforcement, contract/payment attribution, group payouts, public hosting/phone controls and production operations remain unfinished. The server does not launch this executable; run/replay are local CLI commands. No custody, forced return, transaction signing, AAI fee/burn/liquidity program, trade execution or Zoora native-chain change is activated. See [method](RESEARCH_IDENTITY.md) and [community draft](../../docs/community/AE019_COMMUNITY_UPDATE.md).
