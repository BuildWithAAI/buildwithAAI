# Authenticated model connections

The research stack previously invoked community storage methods locally. This layer starts the actual pinned community Waitress service, authenticates separate agent processes over its HTTP API, publishes a job-bound advisory-model artifact, transfers its bytes, and runs the transferred models in the receiving process. The same operational commands support HTTPS with certificate/hostname verification and independently supplied service/agent/source pins.

This is an implemented network connection for four bounded advisory models and their contradiction guards. The source mode is always **PINNED_RESEARCH_REPLAY**. A working network transport does not make an old source snapshot fresh, establish market performance, or make a service publicly deployed.

## Implemented path

~~~mermaid
flowchart TD
  C["Trusted controller manifest"] --> B["Verified model distribution"]
  B --> P["Publisher agent"]
  P --> J["Authenticated job completion"]
  J --> S["Community artifact endpoint"]
  B --> S
  S --> R["Receiving agent"]
  C --> R
  R --> G["Model and contradiction guard"]
  G --> A["Advisory with execution disabled"]
~~~

The service adds `GET /v1/ecosystem/projects/{project_id}/artifacts/{bundle_sha256}` to the pinned community Store's transactional read dispatch. It reuses the actual schema, authentication, project membership checks, connection binding, HTTP parser, concurrency bounds and Waitress lifecycle. It does not copy or replace the vendor HTTP parser, and it does not modify the pinned component checkout.

The endpoint requires an authenticated AGENT and membership in the requested project. Its database query requires a completed job belonging to the project's owning agent, an associated artifact with the same author/project/digest, and the exact registered report byte count. A bare artifact declaration cannot publish the protected model digest. Non-owner publication and incorrect byte counts are rejected. These rules prevent an unbound declaration from reserving the protected digest and blocking the normal job-completion path.

Only the immutable, validated distribution loaded at service startup can be served. An arbitrary artifact digest or filesystem path is not a file download API. Model releases change through an explicit service restart and newly supplied pins; the service does not silently adopt an unverified file edit.

## What crosses the connection

The bounded JSON distribution contains the controller manifest/upstream/public projection, experience manifest/public projection, four selected model reports and the guard-session evidence. It contains no bearer credential, private signing key, raw RPC archive, original training-case registry or private community database. Access is project-scoped; it is not a public model dump.

The receiver checks this chain:

1. The separately trusted controller-manifest SHA-256 matches the transferred controller manifest.
2. Its committed upstream record binds the experience manifest; both manifests bind the transferred public projections, reports and guard history by exact SHA-256 **and byte length**.
3. Each model validates against its actual bounded model schema and matches the selected model digest in both public projections.
4. The final guard audit matches the controller journal head, admitted count and blocked-context count.
5. Research qualification, scope and execution restrictions remain intact, including ABSTAIN and `live_execution_allowed=false`.

Recomputing a transport hash cannot alter an anchored model. Recomputing the complete supplied ancestry changes the external trust anchor and is rejected against the operator's retained pin. The pin must come from an independently trusted release/evidence record; calculating it from an untrusted download and trusting that same value is not independent verification.

Distribution hashes use canonical JSON plus a terminal newline. The pinned SDK parses a response before the receiver reserializes and checks it; this authenticates canonical artifact content, rather than independently capturing raw socket bytes.

A trusted distribution-file check authenticates the selected files relative to that pin. It does not rerun the raw-source, community-audit, fitting or Reef evaluation work. The connected `run`, `verify` and `negative-checks` commands independently verify the full upstream chain before and after their work. The Windows-capable distribution/serving commands consume an already verified release without importing the POSIX-only Reef worker.

## Actual agent behavior

The producer submits, claims and completes an actual community job, whose report bytes are the distribution. The receiving agent downloads that artifact over the network and runs the four transferred models with their guards in another process. Its own completed job publishes a consumption-report digest. Models are not refitted, and receiving bytes does not update biological/LLM weights or authorize an action.

The integration exercises all binary feature vectors plus every published model context: **568 queries**, with **107 advisory classifications and 461 abstentions** on the current synthetic replay. All **three contradictory contexts** are suppressed. These are finite input/serving checks, not independent task-accuracy, semantic security or market-performance measurements.

The observer command retrieves the same authenticated artifact but returns only the allowlisted controller public projection. The predict command accepts an explicit bounded integer feature vector and returns the model advisory plus the unchanged global ABSTAIN/execution-disabled status. Neither command installs Jarvis, hosts a visualization, signs a transaction or sends a social message.

The client requires real instance, agent, project, distribution and controller-manifest pins. It uses the pinned community SDK's anonymous identity probe and query preconditions before authenticated requests. Remote origins must be HTTPS; plaintext mode binds to IPv4 loopback. Redirects and proxies are not followed. Optional `--ca-file` installs only the operator-supplied trust root into that client, retaining certificate and hostname verification. The server cannot supply a trust root for its own acceptance.

Credentials are read from the existing private credential-file format and never supplied in process arguments. The integration uses ephemeral random, unfunded enrollment proof keys. Those identities are disposable tests, not real users or funded wallets. The operational commands use the operator's own initialized community state and credentials; no test credential or model endpoint is substituted when configuration is missing.

## Restart and failure behavior

After a completed publication/consumption, another process reuses the original idempotent job request and report binding. The integration restarts the service against the same SQLite state, reconnects over verified TLS and confirms that both successful jobs replay without creating new jobs or artifacts.

An active/uncertain job lease is not guessed complete or silently reclaimed. The command stops with `NETWORK_JOB_REQUIRES_OPERATOR_RECOVERY`. Use the existing community job/stop/recovery controls to reconcile that attempt. This revision qualifies successful-job replay across a service restart, not automatic recovery of every interrupted network write or claim. The original fixed-plan memory controller's separate recovery guarantees remain as documented in [CONTROLLER.md](CONTROLLER.md).

Use a dedicated agent/project task queue for these bounded handlers. The publisher is the project's owning agent; the receiver must be its member. Authenticated project membership remains OWNER_DECLARED. Community job/report records remain CLIENT_DECLARED internal consistency, not independent execution attestation. A host or database compromise can exceed these application controls; this is not an OS isolation boundary.

## Commands

`python scripts/run_ecosystem_network.py --help` lists every implemented command:

| Command | Required operational inputs | Behavior |
| --- | --- | --- |
| `serve` | Community checkout/runtime, initialized state, distribution file, trusted controller hash | Run the real foreground community service with the added artifact endpoint; loopback by default, existing trusted TLS-proxy configuration for remote exposure |
| `publish` | Distribution file, trusted controller hash, bound connection, private agent credential and project | Complete the owning agent's publication job |
| `consume` | Bound connection, private member credential, project, distribution digest and trusted controller hash | Transfer, validate and exercise the actual models; publish the receiving job's report |
| `observe` | Same trusted connection/release inputs | Read only the allowlisted observer projection |
| `predict` | Same trusted connection/release inputs plus domain and JSON feature vector | Run the transferred advisory model and contradiction guard |
| `run` / `verify` / `negative-checks` | All upstream package paths and existing pinned runtimes | Full connected evidence build, replay or altered-package checks |
| `transport-self-test` | Explicit distribution file and trusted hash | Real HTTP/TLS/service/agent exercise; distribution verification only, without full upstream reexecution |

Run foreground service commands directly with the configured community Python environment on Windows or Linux. The four-package hash lock in the pinned community project supplies this runtime. No Reef/FlyVis installation is needed by a receiver consuming an already verified distribution. The service needs an initialized state; use the existing community setup and wallet-enrollment flow for real operators. Public HTTPS still needs a real domain/certificate and a trusted TLS reverse proxy; supplying `--public-origin` does not provision them.

The following is an executable transport test using the explicitly labeled replay fixture; it is never an operational fallback:

~~~sh
python -B scripts/run_ecosystem_network.py transport-self-test --directory research/ecosystem/generated/network-contract --bundle-file tests/fixtures/ecosystem-network-bundle.json --trusted-controller-sha256 b521bad111dab36cc42d20bcc29d041d25b4f7f2cbcb39261bf8b65280991ecd --community-source .ecosystem-community
~~~

Connected commands accept `--controller-directory`, `--experience-directory`, `--behavior-directory`, `--ecosystem-directory`, `--learning-directory`, `--scanner-source`, `--community-source`, and their existing Python/Reef runtime arguments. Use `--synthetic-only` only for the existing synthetic parent. The full native workflow runs the real-source form automatically after its preceding stages pass.

## Validation and retained evidence

The actual transport exercise uses Waitress, SQLite and separate producer/receiver processes. It first uses loopback HTTP, then restarts the service behind the pinned component's real TLS test proxy. That proxy uses an explicitly trusted **public test certificate**, not a deployed certificate or a production key. No model/provider reply is mocked by the transport exercise.

Ten observed rejection cases cover unpublished content, a bare protected-digest declaration, non-owner publication, incorrect publication byte count, an anonymous read, a nonmember read, a wrong agent pin, a wrong instance pin before bearer delivery, an untrusted certificate before HTTP delivery, and a redirect. The two intentionally rejected publication jobs are recorded FAILED; the two real publication/consumption jobs are SUCCEEDED, with two bound artifacts.

Five copied packages first verify, then change transferred model counts, the consumer's guard result, a job/report binding, observer authority or an access-denial result. All are rejected after outer manifests are recomputed. Pure tests also recompute a complete altered ancestry and confirm that the independent controller pin still rejects it. Portable tests run under strict normal and optimized Python; the actual HTTP/TLS exercise runs on both Linux and Windows.

The evidence package seals its manifest last and retains the distribution, publisher/receiver bytes, consumption report, observer projection, connection/rejection results and audited community SQLite state. Credential files, claim secrets and signing keys are excluded. Reverification reconstructs model outputs and SQLite bindings; retained transport flags are internally checked records, not cryptographic proof that a network exchange occurred. Hosted execution logs and the actual running exercise supply the execution evidence.

Physical two-computer commissioning, public hosting, continuous ingestion/learning, paid commerce, wallet execution, additional animal brains and the civilization UI remain separate unfinished connections. See the explicit [connection inventory](CONNECTIONS.md). No current missing service is reported as live.
