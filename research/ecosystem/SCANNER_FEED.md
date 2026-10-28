# Current scanner observations and agent delivery

This stage connects the pinned scanner's actual HTTP API to a durable observation journal and a separate community agent. It runs the scanner and community through real Waitress services, transfers the existing four advisory models through the authenticated model endpoint, and records an observation report through the existing claim/complete/artifact/audit protocol. Operational intake accepts a configured running scanner; it has no fixture or alternative provider fallback.

The connection is read only with respect to blockchain and financial systems. A scan writes local scanner/journal records and the agent writes an internal community job/artifact. Every projection retains `ABSTAIN / NO_EXECUTION`. Current scanner facts have no qualified mapping into the four synthetic pattern learners: the report explicitly returns `BLOCKED_NO_QUALIFIED_SCANNER_TO_SYNTHETIC_MODEL_ADAPTER`, with inference and training both false. This is an enforced data contract, not an unimplemented endpoint pretending to run a model.

## Capture and trust

Each cycle sends exactly these requests in order:

1. Anonymous `GET /api/health`: check process scope, configured package-content hash, freshness and expected access policy before any credential delivery.
2. `GET /api/ready`: check local application readiness and execution-disabled authority. This is not a provider-health assertion.
3. `POST /api/scan` with the configured mint and `refresh: false`.
4. Anonymous `GET /api/health`: recheck the package declaration before accepting the observation.

Plain HTTP is restricted to literal `127.0.0.1`. Remote connections require HTTPS, normal certificate and hostname verification, and a private token file. An optional operator-supplied CA retains verification. Redirects and environment proxies are not followed. The response budget is 2 MB per request and 60 seconds per cycle; individual connect/read operations are bounded. Returned credentials are discarded rather than recorded.

The scanner's package hash is a startup content declaration. It is not a Git commit, deployment signature, cryptographic process identity or atomic release precondition on the scan request. Use a trusted origin/certificate and obtain the intended package hash from the operator's release, rather than trusting a hash offered by an unknown server. Pre/post health checks do not protect against a compromised origin lying consistently.

The journal retains actual HTTP response body bytes in base64, their digests/lengths, allowlisted HTTP metadata, request scope and capture time. It does not retain authorization headers, tokens, private keys or arbitrary response headers. Transport framing and upstream provider response bodies are not independently captured here. The scanner's upstream receipt hashes, endpoint names, network and finality remain `SCANNER_SERVER_DECLARATIONS_NOT_INDEPENDENT`.

## Current facts and missing data

Projection checks mint binding, canonical mainnet genesis, configured RPC host declarations, requested finalized commitment, relevant slots, metric units, source hashes, section coverage, report time and source retrieval times. Normal receipts expire after 120 seconds; genesis receipts expire after 300 seconds. Future timestamps are rejected. Status recomputes freshness when read; a formerly current observation cannot keep advertising itself as current after expiry.

Supported facts include reported USD/SOL prices, reported liquidity and 24-hour volume, mint/freeze authority and extension presence, the number of returned largest token accounts, and returned address mentions. These are selected scanner sections, not exhaustive holders, wallet clusters, bundles, rug labels, executable quotes or a token-safety decision. Missing values stay null; an actually declared zero stays zero. A wrong network or untrusted report timestamp clears all current facts. Other source gaps suppress the affected fact and preserve explicit issues.

`CURRENT_CORE_DECLARED` means the configured metadata/schema gates passed at that time. It does not independently establish upstream truth. `PARTIAL_OR_UNTRUSTED` preserves a valid scanner report with incomplete, stale, synthetic or unsupported sources. `INTAKE_REJECTED` records a transport, release, readiness or structural failure. A successfully delivered partial report is not a successful live-market qualification. Source retrieval freshness never establishes the age of an upstream market tick; that remains `UNKNOWN`.

## Durable collection

The policy binds mint, scanner origin hash, package-content hash, approved RPC hosts and authentication scope. SQLite uses a private file, full synchronous transactions, integrity checking and a replayed hash chain. Each append holds a file lock and requires the retained expected head. Resume requires an explicit head; status alone is not an external rollback anchor. Preserve the last acknowledged head independently when rollback detection matters.

Exact delivery retries do not create another event. Repeated cached reports have distinct delivery attempts but do not inflate the unique-report count. Clock rewind, changed history, changed projection, policy mismatch and stale compare-and-swap heads fail. A transactional growth failure rolls back both event and head. This qualifies a local bounded journal, not distributed consensus or protection against a host attacker rewriting all bytes and external anchors.

Collection is bounded to 120 retained events and a 16 MiB journal. Polling permits 1–120 attempts at 30–300 second intervals and respects numeric `Retry-After` up to 300 seconds. Three consecutive rejected intakes stop the session. It is a foreground bounded collector, not an installed 24/7 supervisor, automatic journal rotation, multi-host ownership or an active-lease recovery system.

## Operational commands

Use the existing pinned community runtime for the driver. These Bash examples require real operator configuration in environment variables; they do not supply default credentials, sample observations or an automatic model release. The same CLI arguments work on Windows. The full upstream Reef execution remains Linux/POSIX only.

```bash
python -B scripts/run_scanner_feed.py collect \
  --directory "${AAI_FEED_DIRECTORY:?}" \
  --scanner-origin "${AAI_SCANNER_ORIGIN:?}" \
  --scanner-release-sha256 "${AAI_SCANNER_RELEASE_SHA256:?}" \
  --scanner-token-file "${AAI_SCANNER_TOKEN_FILE:?}" \
  --rpc-host "${AAI_SCANNER_RPC_HOST:?}" \
  --mint "${AAI_MINT:?}" --count 2 --interval-seconds 30

python -B scripts/run_scanner_feed.py status \
  --directory "${AAI_FEED_DIRECTORY:?}"
```

The token file contains only `{"token": "..."}` with the actual scanner token. POSIX permissions must exclude group/other access; symlinked or hard-linked files are rejected. The token is passed by private file path, not a command-line token argument. Add `--scanner-ca-file` only for an operator-trusted private CA. To resume collection, supply `--expected-head` with the last acknowledged head; a changed policy requires a separate journal.

The separate agent command downloads and validates the real model bundle, replays the selected journal head, checks that the report is still freshly retrieved before submission and after claiming the job, and submits a deterministic report. It uses a local journal path; the journal itself is not distributed by the model endpoint.

```bash
python -B scripts/run_scanner_feed.py agent \
  --directory "${AAI_FEED_DIRECTORY:?}" \
  --expected-head "${AAI_FEED_HEAD_SHA256:?}" \
  --community-source "${AAI_COMMUNITY_SOURCE:?}" \
  --origin "${AAI_COMMUNITY_ORIGIN:?}" \
  --expected-instance "${AAI_COMMUNITY_INSTANCE:?}" \
  --expected-agent "${AAI_COMMUNITY_AGENT:?}" \
  --credential "${AAI_COMMUNITY_CREDENTIAL_FILE:?}" \
  --project "${AAI_COMMUNITY_PROJECT:?}" \
  --bundle-sha256 "${AAI_MODEL_BUNDLE_SHA256:?}" \
  --trusted-controller-sha256 "${AAI_CONTROLLER_MANIFEST_SHA256:?}"
```

Optional `--ca-file` applies to the community HTTPS connection; `--output` saves the actual report/receipt locally. Successful retries within the freshness window reuse the completed job/artifact. An uncertain running lease requires operator recovery. Stale observations must be recollected; retry does not renew their source age. Real operator identities, certificates and physical hosts still need commissioning.

## Reproducible evidence

`run`, `verify` and `negative-checks` require the network, controller, experience and behavior directories, the pinned scanner/community/Reef sources and runtimes, and either the existing synthetic parent mode or the complete source/learning parent chain. The driver verifies those parents before and after. `run` starts the actual scanner with its real mainnet RPC and market clients, captures twice over HTTP at a normal cadence and once through verified loopback TLS, then delivers the latest journal to a separate agent. Partial provider responses are retained as partial; there is no fake-data fallback. A release/readiness/structural failure blocks the lab rather than fabricating a report.

The lab's TLS proxy uses a public test-only certificate from the pinned component. It exercises certificate rejection, hostname verification and redirect rejection around the actual scanner application; it does not commission a public TLS service. Production intake never installs this certificate.

The sealed package includes both raw observation journals, policies, a standalone scanner database snapshot, community jobs/artifacts/audit, the model bundle, the agent report/receipt, upstream bindings, code identities and a replayed summary. Offline verification reconstructs every projection, checks current-source policy and release pins, matches scanner-persisted reports, verifies exact job/artifact content and byte counts, and compares the audit. It reads saved times for historical replay; this does not make old observations current.

Five disposable copies first pass verification, then alter a fully rehashed journal projection, agent facts, job byte binding, execution authority or source policy. Recomputed outer manifests do not make the changes acceptable. The original must still verify afterward. These are internal replay checks, not independently signed remote execution attestations.

`transport-self-test` is an explicit test command requiring the recorded distribution fixture and its separate trusted controller hash. Only this test path instantiates the pinned synthetic RPC/market fixtures. The actual scanner and community services still run, and every synthetic report must remain `PARTIAL_OR_UNTRUSTED`. This mode never supplies operational missing-provider fallback. Linux/Windows CI runs strict unit regressions and this actual transport exercise; the complete Linux source/native workflow additionally runs the real-provider stage.
