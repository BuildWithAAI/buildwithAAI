# Agent identity, model funding, research and execution boundaries

This is the integration contract for the next runtime stage, researched on 2026-10-27. It does not mark provider login, paid inference, autonomous theses, wallets, social posting or Zoora anchoring as implemented. The current executable addition is [blueprint evidence, data replay and timestamped agent transcripts](BLUEPRINTS.md).

## Provider access and credit ownership

AAI identity, a model-provider account, its compute allowance and a wallet are distinct authorities. Authentic model usage does not by itself make a thesis accurate or a blueprint successful. A provider account must not implicitly authorize asset spending.

| Provider path | Verified official support | Integration still required here |
| --- | --- | --- |
| OpenAI Sign in with ChatGPT | Eligible apps can request identity and, separately, ChatGPT plan usage. The open-source/local flow documents explicit consent, per-installation host identity, issued client IDs, PKCE/state/nonce, ID-token verification and granted scopes. Identity alone does not enable inference. | Eligible-app review of deployment model, supported runtime integration, local protected token storage, revocation/refresh, granted-scope checks, model discovery and live user-authorized validation |
| Claude included API credits | Eligible Max/Team plans can link a Claude Console organization and claim API credits for applications/agents. Credits apply to the linked organization's API keys/workspaces; expiry, account eligibility and spend limits still apply. | User-managed eligible organization, restricted project/workspace key, credit/limit checks, request/usage receipts and live user-authorized validation |
| Other provider APIs or local models | No universal subscription-credit interface is assumed. | Implement each provider's supported authentication, usage accounting, failure/retry behavior and validation before enabling it |
| AAI token-funded compute | An intended payment product, separate from provider credits and existing nonmonetary work units. | Quote, authorized payment, settlement/reconciliation, refund policy and funded end-to-end verification |

Use the official provider flow. Never copy browser cookies, collect account passwords, share credentials across agents, or silently fall back from an exhausted allowance to a chargeable key. Credential vault access must be separate from transcript/export access. A signed-in identity is not a verified remaining balance. Reserve authorized compute before dispatch; reconcile actual provider usage afterward. An uncertain response must remain unresolved until reconciled rather than triggering an unbounded paid retry.

Provider sources:

- [OpenAI Sign in with ChatGPT](https://developers.openai.com/siwc)
- [OpenAI open-source integration guide](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- [OpenAI ChatGPT plan usage overview](https://developers.openai.com/siwc/token-sharing-open-source)
- [Claude API credits for subscribers](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)
- [Claude usage and cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)

OpenAI currently directs paid or remotely hosted apps to its interest form; support for local/open-source apps does not automatically approve a hosted paid economy. Claude organization cost reporting requires appropriately scoped administrative access, which must stay outside individual agent credentials.

These sources establish available integration paths, not this project's eligibility, a user's credit balance or a completed connection. Recheck current provider requirements before deployment; do not hard-code today's promotional amounts as economic guarantees.

## Original research theses

The intended service is a disclosed research agent that can conclude that evidence is insufficient or a project is unattractive. Its objective must not be a target token price, manufactured volume or apparent independent investor support. Multiple specialist agents can share an operator; their common control and sponsorship must remain visible.

Each retained thesis needs the subject/network/address, author agent and operator disclosure, provider/model/request reference, source snapshot hashes and capture times, explicit evidence-linked observations, the agent's interpretation, counterevidence, assumptions, invalidation conditions, unresolved questions, conflicts/compensation, and a conclusion with a review deadline. A new revision references its predecessor and explains what changed. It must preserve unfavorable evidence and prior wrong conclusions.

The generator must derive its own conclusion from the supplied evidence and cite external ideas it uses. Exact/near-duplicate screening and source attribution can flag copying, but cannot certify originality or truth. Provider usage records establish which request ran, not whether the generated conclusion is correct. Never describe a contract-test fixture as a live agent's thesis. There is currently no model-backed thesis generator or scheduled social publisher in this release.

Revenue should correspond to disclosed useful services and verifiable external payments. Local allowances, circular transfers, self-purchases and repeated runs are not revenue, independent demand or proof of success. No trading-volume targets, coordinated account callouts or undisclosed promotional network is authorized by this design. [Pump's terms](https://pump.fun/docs/terms-and-conditions) also prohibit manipulative or misleading messages; account/platform-specific integration requires its own supported interface and testing.

## Transactions and operational security

A dedicated low-balance agent wallet can limit exposure, but it does not replace enforced permissions. A future execution service must sit outside the reasoning process and independently enforce an owner-issued mandate: allowed chains/assets/programs, recipients, per-action/day budgets, fees/slippage, expiry, rate limits, counterparty checks, simulation where supported, and an emergency stop. Retrieved documents, seller text and model outputs cannot grant or increase spending authority.

Keep signing keys and provider tokens out of model contexts, transcripts and exported blueprints. Only structured requests enter a signer. Record the approved intent and policy version before submission; reconcile chain/network, transaction signature, receipt, block/slot, status, actual amounts and fees afterward. Unknown submission status remains pending; do not broadcast a replacement simply because a response timed out. Resumption must preserve intent idempotency and nonce/sequence constraints appropriate to the actual chain.

Current transcripts already link local research actions to their original audit/event/result hashes and server timestamps. They do not fabricate chain signatures. Future on-chain anchoring should commit a digest of a redacted, retained transcript and preserve the actual anchor receipt; it must never publish secrets or private reasoning. No Zoora RPC/consensus adapter or wallet signer has been commissioned here.

Before financial autonomy, require real host commissioning, credential isolation, malicious-input exercises, budget exhaustion tests, uncertain-submit recovery, reconciliation and load measurements at the intended scale. No hundred-million-volume capacity or security certification is inferred from current bounded research tests. Financial authority remains ABSTAIN / NO_EXECUTION.
