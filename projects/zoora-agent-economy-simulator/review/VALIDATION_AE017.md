# AE-017: validation and policy findings

October 15, 2026. Worktree based on AE-016 commit `248a36a31983a9f443084b0e10c8296cfd425e65`. This document describes development checks; the parent commit does not contain AE-017. The development pull request records the exact published head, tree and CI results. No merge or deployment is part of this milestone.

The candidate adds reviewed complaint/nonresponse cases and appeals to the same trust runtime. It retains **15 complete demonstrations: 294 actions, 16 work agreements, 15 review cases, 71 case events and 2,472 checked agent-state snapshots**. Eighteen actions are deliberately refused. These are controlled fixtures, not trials with independent users or evidence of autonomous competence.

## Validation record

| Check | Result |
| --- | --- |
| Normal Rust suite | 226 tests pass, including 27 new recovery tests |
| Formatting and strict Clippy | Pass, all targets, warnings denied |
| Optimized Rust suite | 226 tests pass, including all 27 new recovery tests |
| Actual new CLI acceptance | 51 checks pass; normal/optimized reports and retained JSON/CSV match exactly |
| Independent applied-history audit | All 15 histories; case transitions, evidence bindings, profiles and payment totals |
| Previous AE-016 campaign | Exact fingerprint preserved; prior independent audit passes |

Initial local compiler setup and builds encountered missing/corrupt metadata and empty object artifacts. Reinstalling the pinned standard library and cleaning the package restored normal builds. The final optimized build and 226-test rerun pass with incremental compilation disabled, one Cargo job and one codegen unit. The final CLI checks reproduce the exact normal/optimized report bytes. Initial environment failures are not counted as passing checks. All eight prior CLI acceptance scripts also pass. A final auditor review found and fixed a tick-zero truthiness error; native replay and the independent auditor now both reject a duplicated return event at tick zero, while accepting a legitimate return at zero.

Reference campaign fingerprint: `85a846c501f22791e8d299684b7877ba3f6ced09959361f1a429a3b0058d61da`.

| Retained export | SHA-256 |
| --- | --- |
| Full campaign JSON | `13541d4540a642d3202cfa4b74187ec2c92494d0b776afe80e372a11fc6fe73e` |
| Compressed archive | `f7a194afbe7ea7470c0db5f6ef35cbe730af9264f5dfa5ca6560bb3d69619554` |
| Worker/case CSV | `d5f255c1b858e32f78125ffeee5454d005f73f1e258af1e62291b13b987f9e3c` |

The compressed archive retains every input, accepted/rejected action, case event, profile snapshot and direct-payment transcript. The JSON is 3,396,214 bytes; its compressed archive is 121,464 bytes. CSV has 16 worker/case rows. The original AE-016 reference remains `f5bdab1d42c6663fe1bb8b989e99cac8385022a35a9d90e8cde3e9f4e3c08c68`.

## Measured outcomes

| Scenario | Recorded outcome |
| --- | --- |
| False complaint dismissed | Affected usable credit pauses; final acceptance and maturity restore 100 credits and Tier 1 |
| Customer does not respond | Review accepts on-time fully paid delivery; later work confirmation earns 100 credits without adding client acknowledgment |
| Complaint upheld | No usable credit; one active paid commitment and a hold remain; zero automatic returns |
| Appeal overturns rejection | Different declared operator accepts the work and credit later becomes usable |
| Appeal upholds complaint | Rejection and paid exposure remain visible |
| Primary reviewer misses deadline | Exactly one backup under another declared operator; late original verdict refused |
| Both primary reviewers time out | Case expires unresolved; no successful-work credit or refund |
| Appeal reviewer times out | Case expires unresolved even when primary verdict had accepted work |
| Full observed voluntary return | Pending case closes; zero net payment, zero work credit and no remaining hold |
| Partial return after provisional acceptance | Binding becomes stale; 99 payment units remain outstanding and access stays paused |
| Reviewer conflicts | Worker-controlled reviewer and alias of primary reviewer refused; independent appeal operator assigned |
| Undelivered paid work | Deadline causes hold; acceptance without delivery refused; reviewer rejects work |
| Group dispute | Both workers pause; acceptance restores exactly 60.6 and 40.4 credits; receipts still pay only the lead |
| Deadline boundaries | Premature verdict and appeal at exact close refused |
| Forged bindings and bypasses | Old binding after added evidence, duplicate case, outsider evidence, duplicate decision, late withdrawal and raw legacy dispute route refused |

The 27 Rust tests additionally cover insufficient panel diversity, withdrawal before a decision, repeated appeals, partial returns after a historically final acceptance, wrong reviewer IDs, rehashed profile/credit/event/payment forgeries, malformed timing, time travel and excessive inputs. Independent Python arithmetic is not native replay: it checks applied-history evidence, while native replay also regenerates refused attempts and the fixed demonstration matrix. Hashes and consistency cannot authenticate outside facts.

## Remaining limits

Review judgments, identities, declared ownership, receipts and artifact references are fixtures. The model does not read actual deliverables or establish reviewer fairness. Hidden common control and semantic duplicate work remain unresolved. Complaint griefing can temporarily pause good workers. Current expired/rejected/stale cases cannot reopen for mediation; a full observed return is their implemented exposure-resolution route. Different future recovery policy requires explicit development and tests.

Per-agent caps still permit multiple agent identities under one operator. Owner-wide limits, risk/value exposure caps, verified reviewer operations, evidence storage, project-budget repair, service/scheduler integration, collective compensation, community governance and production operation remain unfinished. Work credit is experience, not a payment, token or investment return. No real funds, signer, custody, reversal, forced refund, fee, AAI burn/lock/liquidity, hosting deployment or native-chain/validator changes are introduced. Passing software checks does not establish economic stability or an overall completion percentage.

[Method](AE017.md) · [Pre-publication local summary](evidence/ae-017-local.json) · [Full campaign archive](examples/recovery-campaign.json.gz) · [CSV](examples/recovery-campaign.csv) · [Community update](../../../docs/community/AE017_COMMUNITY_UPDATE.md).
