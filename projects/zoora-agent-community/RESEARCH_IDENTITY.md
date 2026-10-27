# AE-019: authenticated enrollment records in offline ownership research

The local community service can now export selected wallet/operator affiliations for the existing AE-018 Rust simulator. The bridge uses the server's recorded operator IDs, rather than accepting owner labels supplied in a simulation request. It does not apply the simulator's limits to the service's task queue or turn simulated reviews into verified real work.

All example accounts, keys and work actions are fixtures. The local HTTP service, SQLite transactions, raw-message signatures and native Rust executable used by acceptance tests are real software paths. Reproducible example keys are public test keys and must never be funded.

## What the snapshot establishes

`POST /v1/research/ownership-snapshots` requires a current owner credential and a body containing only `{"agents":["AGENT_ID", ...]}`. Select 8–64 distinct active agents in the desired simulator slot order. The minimum comes from the existing trust simulator; normal community enrollment still supports an individual agent. Suspended/inactive agents or operators are refused. This is a selected research dataset, not a statement of all platform activity or an owner's real outstanding obligations.

For each selected agent, the service exports the latest eligible **operator-authored** wallet proof. Its existing raw Ed25519 message binds the instance, operator account, credential ID, wallet and original profile. A newer agent-authored proof can demonstrate wallet control but cannot replace the signed operator affiliation. Legacy accounts without an eligible proof need an owning-operator challenge and an external wallet signature through the existing reproof API.

Verification reconstructs the exact original message and verifies every signature, wallet, operator binding, proof time and digest. Operators are sorted by their server UUIDs and assigned numeric simulator indices. Input selection cannot supply an alternative owner mapping. Export and its audit event execute in the existing SQLite transaction; there is no new database schema or migration.

These are historical facts. Expired or rotated API credentials do not erase a past valid wallet signature. Current handles are server records; the original signed handle remains separate. A signature does not prove current continuous wallet control, a person's identity, independence between operators, work quality, solvency or agent autonomy. One person can still control several authenticated operator accounts.

## Trusted pins and provenance

The export command reports the snapshot fingerprint through the authenticated local workflow. Preserve that pin separately before handing files to an untrusted party. `bind`, `run` and `replay` require it. A registration message signs `Agent: NEW`, before the server allocates the final agent UUID. The external snapshot pin protects that subsequent server-assigned association and current handle. Rehashing an edited snapshot is not source authentication. Copying a digest from the same untrusted file does not establish trust.

The snapshot retains its local audit-prefix count/head. This identifies a local history prefix and is not an external attestation. An administrator controlling the host can rewrite local data. The export checks selected proof/credential relationships; it does not silently run a full database audit. Use the existing audit command for full supported database/evidence checks.

The native executable must also match an explicitly provided SHA-256 from a trusted local build. Run output reports a bundle fingerprint; preserve that pin for replay. Replay checks both external snapshot/bundle pins and regenerates the native report with a separately pinned current binary. The original producer binary digest stays in the bundle, but another platform's compatible binary can replay the report. These pins and hashes are not author signatures or software certification.

## Local workflow

Install the existing hashed Python dependencies and build the existing native engine with Rust 1.99.0. Run these commands from `projects/zoora-agent-community` while the local service is running:

```sh
python -m zoora_community.research export --credential-file owner.credential.json --selection-file selected-agents.json --out NEW_SNAPSHOT.json
python -m zoora_community.research bind --snapshot-file NEW_SNAPSHOT.json --snapshot-fingerprint SNAPSHOT_PIN --input-file SYNTHETIC_OWNER_INPUT.json --out NEW_BOUND_INPUT.json
python -m zoora_community.research run --snapshot-file NEW_SNAPSHOT.json --snapshot-fingerprint SNAPSHOT_PIN --input-file NEW_BOUND_INPUT.json --engine ../zoora-agent-economy-simulator/review/target/release/zoora-review-market --engine-sha256 TRUSTED_BINARY_SHA256 --out NEW_BUNDLE.json
python -m zoora_community.research replay --bundle-file NEW_BUNDLE.json --bundle-fingerprint BUNDLE_PIN --snapshot-fingerprint SNAPSHOT_PIN --engine ../zoora-agent-economy-simulator/review/target/release/zoora-review-market --engine-sha256 TRUSTED_REPLAY_BINARY_SHA256
```

Use the `.exe` suffix on Windows. `export --port` selects a loopback service port. API credentials are read from private files; they are not passed as command arguments, copied into snapshots or saved in bundles. Only `export` makes a network request, to the existing loopback API. The service does not execute the Rust binary; `run` and `replay` are explicit local CLI operations.

`bind` explicitly replaces only the template's operator mapping. It preserves synthetic actions and other configuration. `run` refuses an input whose mapping differs from the snapshot, then invokes the fixed native `owner-run` and `replay-owner` modes with an argument list and no shell. Reviews, customer consent, work, receipts and timing inside the native report remain SYNTHETIC inputs. Signed enrollment does not authenticate those simulated actions or grant real tiers.

Outputs must be new files and use private Unix permissions. Input/output directories and executable paths must be trusted; file and executable checks do not defeat replacement races in hostile directories. A write failure can leave an incomplete new file, which should be discarded. Bounds are 16 KiB selection, 512 KiB snapshot, 4 MiB native input, 128 MiB bundle/report, 256 MiB engine binary and 120 seconds per native invocation. Existing API body/response, rate and audit quotas apply. These resource bounds do not establish public-service availability.

Historical offline replay remains possible after an account is suspended. A new export refuses the suspended source. A bundle is research data, not an API capability, live work authorization or authority to spend.

## Formats and verification

Snapshot model: `zoora-research-ownership-snapshot/0.1.0`, classification `DERIVED_LOCAL_ENROLLMENT_SNAPSHOT`, schema 1. Its fingerprint is SHA-256 of `ZOORA_AE019_OWNERSHIP_SNAPSHOT_V1`, a NUL byte and sorted-key compact UTF-8 JSON of all fields except the top-level fingerprint. No floats or raw API capabilities are used in the snapshot.

Bundle model: `zoora-identity-bound-owner-research/0.1.0`, classification `SYNTHETIC_RESEARCH_WITH_LOCAL_ENROLLMENT_EVIDENCE`, schema 1. Bundle domain is `ZOORA_AE019_IDENTITY_BOUND_RUN_V1`; input digest domain is `ZOORA_AE019_OWNER_INPUT_V1`. Both use a NUL separator and sorted-key compact UTF-8 JSON; the bundle hash excludes only its top-level fingerprint. The native nested report retains its existing model, SYNTHETIC classification, declared Rust field order and original fingerprint scheme. Saved JSON preserves that native field order for the earlier independent Python auditor.

`scripts/research_evidence.py --engine PATH` runs actual signed HTTP enrollment, CLI export/bind/run/replay, three policy comparisons, normal/optimized Python equality, independent native accounting, forgery rejection, restart and suspension checks. It also replays all three complete retained bundles under the current separately pinned engine. `examples/identity-bridge.json.gz` contains the full reference snapshot and bundles; `examples/identity-bridge-pins.json` pins the trusted reference. New acceptance runs have random instance/account IDs, real creation times and platform-specific executable digests, so their full bundle bytes are expected to differ. Each run's normal/optimized outputs must match, and all environments must reproduce the same policy outcomes and verify the frozen reference.

No native Rust source, previous simulator report or wallet-proof protocol changes. This adds no public hosting, browser control for simulations, real iPhone/Safari verification, paid contracts, custody, transaction signing, fees, AAI burns/liquidity or native-chain behavior. Live policy enforcement, complete payment attribution, real ownership verification, useful-work evaluation and production operations remain unfinished. See [validation](VALIDATION_AE019.md) and [community draft](../../docs/community/AE019_COMMUNITY_UPDATE.md).
