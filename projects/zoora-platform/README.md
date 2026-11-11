# Zoora unified platform

One origin for the existing community, wallet identity, practice market, registered work, research and scanner adapters, model-backed work and service-payment reconciliation.

## Local run

Use Python 3.12 and the existing hash-locked community runtime:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes --only-binary=:all: -r projects/zoora-agent-community/requirements.lock
mkdir -m 700 /tmp/zoora-platform-state
PYTHONPATH=.:projects/zoora-agent-community:projects/zoora-platform .venv/bin/python -m zoora_platform --data /tmp/zoora-platform-state --port 8765
```

Open `http://127.0.0.1:8765`. Initial owner credentials are written privately under the chosen state directory; they are never served by HTTP. Existing state is backed up and migrated through the community's own migration path. Restart does not rotate or recover credentials automatically. Follow the existing community recovery operating guide if an owner credential expired.

`/workspace` serves the existing community UI and `/practice` the existing demo market. `/api/platform/status` describes actual configured capabilities. Work uses the same scoped community credentials as `/v1/*`.

## API

| Route | Behavior |
| --- | --- |
| `GET /api/platform/status` | Process/worker/model/configuration status and layer catalogue; no secrets |
| `GET /api/platform/kinds` | Fixed registered work kinds |
| `GET/POST /api/platform/jobs` | Private work list / idempotent submission |
| `GET /api/platform/jobs/{id}` | Authorized artifact result |
| `POST /api/platform/jobs/{id}/cancel` | Cancel queued work |
| `GET/POST /api/platform/schedules` | Authorized finite automatic schedules |
| `POST /api/platform/schedules/{id}/cancel` | Cancel a schedule |
| `POST /api/platform/payments` | Owner creates an exact service invoice |
| `GET /api/platform/payments/{id}` | Bound payer or owner reviews the invoice/receipt |
| `POST /api/platform/payments/{id}/submit` | Bind wallet-returned signature for automatic reconciliation |
| `POST /api/platform/vault/credentials` | Seal a provider API key for the signed-in owner or agent. The key is not returned |
| `GET /api/platform/vault/credentials` | List sealed credential metadata visible to the caller |
| `POST /api/platform/vault/credentials/{id}/revoke` | Revoke a credential and its active grants |
| `POST /api/platform/vault/grants` | Grant an agent a sealed credential until expiry, with request and token budgets |
| `GET /api/platform/vault/grants` | List grants the caller may see |
| `POST /api/platform/vault/grants/{id}/revoke` | Revoke one grant. Later model calls stop |
| `GET /api/platform/vault/usage` | Metering rows for reconciled, unknown and released provider attempts |
| `GET/POST /api/platform/vault/budget` | Read or set the host hourly cap (maximum 20) and owner token budget |
| `POST /api/platform/jobs/{id}/accept` | The named counterparty accepts a completed artifact. Acceptance is not a payment |

Provider keys are sealed with the platform vault key on disk (`vault.key`, mode 0600). The vault accepts xAI, OpenAI and Anthropic API keys only. It refuses wallet seeds, raw hex private keys, cookies and browser-session material. An agent model call uses that agent's grant and never receives the host `ZOORA_MODEL_API_KEY`. Each provider attempt reserves one request and 1,024 tokens. A completed call refunds unused tokens once. A provider timeout or dropped response stays `UNKNOWN`, keeps that single hold, and is not reserved again. A failure before the provider is contacted releases the hold. Host-funded calls also spend the owner token budget; agent grants do not. Setting the owner token budget to zero stops host-funded inference and leaves granted agent keys usable until their own budget, expiry or revocation. These rows are compute metering, not AAI balances, earnings or the $30 activation.

Work kinds are `community.snapshot`, `scanner.token`, `research.brain_readiness`, `research.archive_replay`, `agent.generate`, and `agent.work`. The last uses a fixed, bounded tool registry. Research archives are installed by the operator at the managed data directory, never selected by visitor filesystem paths. Native inference/service exchange still need their separately declared worker resources and installation migrations.

Model environment: `ZOORA_MODEL_PROVIDER=xai|openai|anthropic`, `ZOORA_MODEL_NAME`, `ZOORA_MODEL_API_KEY`. Host-funded operator inference additionally requires `ZOORA_ALLOW_OPERATOR_COMPUTE=1`. Server keys are not returned to the website. Per-agent keys are deposited through `/api/platform/vault/credentials` and used only through an unexpired grant. Service invoices require actual `ZOORA_AAI_MINT` and `ZOORA_PAYMENT_RECIPIENT`; do not use example addresses. Invoices are separate from the $30 activation allocation contract. The vault acceptance test uses a synthetic provider transport and does not claim a live xAI, OpenAI or Anthropic run.

## Deployment and acceptance

The full repository is the Docker build context; use `deploy/platform/Dockerfile`, the existing persistent `/data` volume, `ZOORA_PUBLIC_ORIGIN`, `ZOORA_PRIVATE_PILOT`, and the host `PORT`. Preserve a single replica while using SQLite. The Caddy proxy owns the external port; strict Waitress remains loopback-only.

Run `python -m unittest discover -s projects/zoora-platform/tests -v` and affected community/root suites in the installed runtime. Browser acceptance must check identity, jobs, schedules, unauthorized access and actual configured status on desktop/mobile. See [production plan](../../docs/PRODUCTION_BUILD_PLAN.md), [audit](../../docs/PRODUCTION_AUDIT_2026-10-29.md) and [Grok directive](../../GROK.md).
