# Security policy and implementation plan

**Founder-requested rules; operational setup pending verification.** This policy does not mean the project has undergone an audit.

## Report a concern

Do not put vulnerabilities, exploits, leaked credentials, or private user data into public issues. Use **Security → Advisories → Report a vulnerability** only if that private feature is available here. Its enabled state and response coverage have not been verified by this documentation update.

If unavailable, open a non-sensitive request for a reporting channel without exploit details, secrets, affected-user identities, or private logs. Wait for a route confirmed by the maintainer through this repository. No email address or response-time guarantee is invented. Non-sensitive policy questions may use the security-question issue template.

## Required behavior

- Never request seed phrases or private keys, or store users' wallet secrets.
- Do not implement or execute automatic trades under this documentation scope. Initial experiments remain offline/replay/paper; later assistant execution modes, demo/live integration, and the creator-fee account require separately accepted policies and controls.
- Do not automatically sign transactions without clear user approval. Connecting a wallet is not permission to transact.
- Make proposed interactions explicit: network, asset, recipient, amount, fees, permissions, and action. Never rely on arbitrary signing links in posts or token metadata.
- Do not hide project-controlled wallets, mint authority, transfer taxes, blacklists, or behavior changes. Disclose controls with evidence.
- Keep application credentials, wallet secrets, private records, and credential-bearing provider URLs out of code, logs, issues, and screenshots.
- Any future on-chain program or material wallet integration needs a separate threat model, security review, and tests before release.

These rules do not verify an unknown token. Unverified permissions remain unknown in the [token record](docs/token/TOKEN-INFO.md).

## Setup before public wallet functionality

| Task | Completion evidence | Status |
| --- | --- | --- |
| Verify private reporting | Owner confirms private intake and records a non-sensitive result | PROPOSED |
| Identify responders | Willing contacts and coverage recorded | PROPOSED |
| Protect links and sensitive changes | Approved review rules and recorded settings check | PROPOSED |
| Credential/dependency checks | Checks run on the actual software scope | FUTURE |
| Incident exercise | Simulated bad-link/credential incident documented | PROPOSED |
| Program/wallet review | Threat model, findings, remediation, tests | FUTURE |

## Incident process draft

Assess privately; identify exposure and version; contain the integration; rotate exposed application credentials through their provider; investigate; test the fix; publish a redacted account when safe. Mark disputed official records clearly and retain history. Do not silently replace a mint or delete evidence.

This file authorizes no wallet operations, credential changes, deployments, or payments. GitHub private intake requires a separate owner/admin setting; this file does not enable it. [GitHub documentation](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

## Agent, model, music, and funded-account proposals

Keep agent forum messages, external research, token metadata, and model output separate from trusted instructions and transaction permissions. An agent cannot approve its own budget increase. Record common operators/sources and protect against impersonation and fabricated reputation.

The multi-brain lab must label source-derived and synthetic components and run offline/paper first. Research datasets require version and reuse checks; do not bundle unreviewed dependencies or massive downloads as a hidden prerequisite.

The music proposal needs consent and rights records, private-file controls, and a reviewed path for unauthorized uploads, voice/likeness impersonation, and disputes. No royalty distribution or signing service is implemented.

A funded trading-account proposal needs externally enforced limits and a defined existing-order/position policy before operation. Ledger and review documentation do not themselves enforce controls. No funds are moved by this update.
