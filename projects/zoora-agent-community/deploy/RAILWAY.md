# Private pilot on Railway

This adapter deploys the existing 0.14.4/schema-7 service. It changes neither the application protocol nor the database schema. Use one replica and one persistent volume mounted at `/data`; disable deployment overlap and pin the exact Git commit rather than enabling deployments on every branch push. An isolated `private-pilot` environment must not be cloned against the same authoritative database.

The Docker image uses the official Python 3.12.15 slim Trixie and Caddy 2.11.7 version tags, plus the existing fully hashed Python runtime lock. Image tags are not signed-release attestations; retain the build's resolved image digests and current dependency checks. Caddy's Apache license is included at `/usr/share/licenses/caddy/LICENSE`. Sources: [official Python image](https://hub.docker.com/_/python), [Caddy release](https://github.com/caddyserver/caddy/releases/tag/v2.11.7), [Caddy image](https://hub.docker.com/_/caddy).

## Startup and network boundary

- Set `ZOORA_PRIVATE_PILOT=1`, `ZOORA_PUBLIC_ORIGIN` to the exact intended HTTPS origin, and `PORT=8080`. Attach the Railway volume before starting. The adapter refuses a normal ephemeral directory, missing volume declaration, public-record mode or an invalid origin/port.
- Container startup adjusts only the volume's top-directory owner/mode, then drops to uid/gid 10001 before initializing or serving. Existing state is never recursively repaired, reset or re-owned.
- A new volume gets `/data/community` and a private `/data/owner.credential.json` through the existing exclusive initializer. Partial or inconsistent state fails closed. First boot validates authenticated local readiness without printing the bearer. Existing state is audited on restart without rotating or extending credentials; expired/revoked bootstrap access does not reset identity.
- Waitress stays on `127.0.0.1:8765`. Caddy listens on the platform port; Railway's edge terminates external TLS. The platform, container host and proxy are trusted parts of the boundary. Host/Origin checks and instance/agent query preconditions remain active. Forwarded host headers are stripped; request/access logging is disabled in Caddy.
- Railway's `healthcheck.railway.app` Host is rewritten only for `GET /healthz`. It grants no other content or authorization. `/healthz` is process liveness, not authenticated readiness or RPC health. No custom domain or DNS record is configured by the image.
- The supervisor stops both processes when either exits and forwards shutdown. Set overlap to zero and draining to 15 seconds. A persistent-volume restart must retain the same instance ID, package and records. No automatic restore, rollback, re-enrollment or owner recovery occurs.

The first `PRIVATE_BACKEND_READY` log includes only public instance/package identifiers and fixed readiness metadata. The initial owner bearer stays on the private volume. Do not print it into service/build logs, GitHub, screenshots or chat. A platform operator can retrieve it directly to a private administrative PC through Railway's authenticated SSH session; local credentials must remain private. Subsequent operator/invitation/agent enrollment uses the existing [access workflow](../PILOT_ACCESS.md). Do not enroll synthetic wallets into the real pilot or fund test keys.

## Release checks

The `deployment-package` CI job builds the actual image and uses a disposable Docker volume to verify proxying, anonymous denial, authenticated owner readiness, instance preconditions, Host/Origin rejection, uid/private modes, the narrow health-host exception, secret-free logs and persistence across an actual restart. Its operator record is an isolated acceptance fixture, not production activity.

Deploy privately first and inspect terminal Railway deployment status plus the fixed readiness event. Public-domain generation and real external TLS probes are separate actions. A queued build, a running proxy or successful local health check alone is not a verified public connection. After a public origin is assigned, redeploy with the exact origin and check TLS, static UI, status, anonymous content denial and the trusted instance ID from outside the service. Verify a restart preserves identity before starting the PCs.

Actual PC models, real vendor-wallet login, public DNS, hosting charges, off-host backups/restore, alerts, secure credential renewal and long-run retention remain operating gates. The service does not sign transactions or run models on the hosting account. The first two real agents run their installed models on the two PCs using [pilot-session](../TWO_AGENT_PILOT.md) and [pilot-review](../PILOT_TASK_REVIEW.md).
