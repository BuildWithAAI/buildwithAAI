# Grok production implementation directive

**Owner instruction: proceed with building the live Zoora / AAI economy as one connected website.** This is an implementation assignment. The production direction supersedes earlier documentation that limited a particular research milestone to read-only or paper operation.

Start with `AGENTS.md` and `docs/PRODUCTION_BUILD_PLAN.md`. The runnable composition is in `projects/zoora-platform`; it mounts the existing community API and UI, scanner/research worker adapters, durable work, schedules, model-provider adapters and wallet-side service-payment preparation/reconciliation behind one origin. Extend it rather than making an unrelated landing page or another repository.

The screenshot's framing needs two corrections:

1. An absent payment/trading integration is a feature to implement and test. It is not, by itself, a reason to refuse production development.
2. Signing a wallet login message is not the $30 AAI payment. Build separate quote → wallet authorization → chain confirmation → allocation verification → activation states. Never display a signature-only onboarding as a paid activation.

## Work to complete

1. Verify the running host uses the intended main revision. The October 29 audit found the existing Railway service still on `feature/live-connections-audit` at `f4e7ece…`, despite the earlier main consolidation. Use the full monorepo build context and `deploy/platform/Dockerfile`; back up and migrate existing state rather than resetting it.
2. Finish the production acceptance gates in the build plan in dependency order: provider onboarding, qualified worker/artifact connections, activation allocation contract, paid service acceptance/settlement, delegated signer and venue adapters, then broader economy products. Build each gate's missing code instead of repeatedly proposing the same setup card.
3. Use the explicit current research admission findings. The newer 253 brain modules do not represent 253 trained models or 253 tested services. A checksum is not a signature; a caller's hold declaration is not chain evidence. Do not wire those sketches into paid authorization.
4. Connect the existing practice market, scanner, learning/memory, model evidence, blueprint exchange, contracts, collectives, leasing, SFP and ASE through shared identities, typed jobs, durable artifacts and the one website. A source link in the dashboard is a catalogue entry, not a claim that its full runtime is commissioned.
5. Implement automatic operation with persisted schedules, restart recovery, scoped tools, explicit compute/spend budgets, observability and owner suspension. Do not give an LLM raw server keys, an arbitrary shell or unconditional wallet authority.
6. Deliver code and evidence: changed paths, schema migrations, exact tested revision, test results, API contracts, deployment result, observed end-to-end behavior, remaining configuration and the next acceptance gate. Keep going through unblocked work.

Production implementation is authorized. Actual asset transfers still require a real wallet signature or a narrowly delegated, owner-approved signer policy. Missing credentials or program deployment should produce specific configuration requirements, not invented balances, earnings or blanket refusal to write the integration.

Public launch is a capability rollout: the working website and configured workers can be deployed while an unconfigured financial capability remains explicitly unavailable. Finish those financial capabilities; do not remove their verification requirements to change a status label.
