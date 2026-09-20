# Contributing to Build With AAI

**Process draft for owner review.** The [security boundaries](SECURITY.md) and separation from the future blockchain come from the founder's instructions.

Contribute code, research, design, art, documentation, test cases, or a thoughtful problem statement. Buying a token is not part of this contribution workflow.

## From idea to contribution

1. Read the [README](README.md), [current status](docs/CURRENT_STATUS.md), and [official links](OFFICIAL-LINKS.md).
2. Search issues and the [backlog](tasks/BACKLOG.md). Reference an existing task ID where relevant.
3. Open the appropriate issue with a user problem, proposed result, and completion condition. New proposals begin as IDEA or PROPOSED, never self-approved.
4. Discuss scope and evidence. A substantial feature needs a [proposal](proposals/README.md) before implementation. Small factual documentation corrections can use a focused PR directly.
5. A maintainer records scope, decision, and a willing contributor before IN DEVELOPMENT. Approval applies only to the recorded scope and budget.
6. Use a branch or fork and submit a focused PR using the [PR process](docs/community/PULL_REQUESTS.md).
7. Include actual checks, limitations, sources, security impact, and any change to token functionality. Visual changes need an inspectable preview.
8. Maintainers review; the owner explicitly approves protected changes. Merge and release are separate events. Record release evidence before RELEASED.

## Good proposals and evidence

Explain who benefits, technical requirements, dependencies, complexity, risks, security, maintainer, feedback, and how success is verified. State whether the proposal concerns community tooling, the Solana token, or future blockchain research.

Popularity, polls, merged discussion notes, and AI-generated plans do not make an idea official. See [governance and decision authority](docs/community/GOVERNANCE.md). The future chain name remains undecided between Zoora Blockchain and AAI Blockchain.

Separate observations, inferences, and unknowns. Include primary sources, dates, versions, and reuse terms. Label synthetic data and simulations. Disclose material AI assistance and verify generated code and citations. Do not claim implemented features, audits, biological models, or profitable strategies without evidence.

The scanner code is private. Tasks requiring it remain blocked until access is granted. Do not move private code or data into this hub without explicit authorization and a licensing decision.

## Protected changes

Supply, minting, authorities, metadata control, treasury, fees, migration, governance, and project-controlled wallets require explicit owner approval and additional documented review. The rule includes dependencies or documentation that would quietly change those behaviors or promises. See [PR requirements](docs/community/PULL_REQUESTS.md).

Community tooling must not ask for or store wallet secrets, execute automatic trades, or sign transactions without clear user approval. Trading research here is restricted to offline/replay/paper environments; a different execution policy is not approved.

## Participation and compensation

Follow the [code of conduct](CODE_OF_CONDUCT.md). Tasks are unassigned until someone agrees to them. No bounty, wage, token allocation, or revenue entitlement is created by opening an issue or submitting work. Paid scope needs a separate explicit agreement before work begins.

See [license status](LICENSE-STATUS.md) before submitting reusable code or media. Include attribution and third-party terms. Report sensitive vulnerabilities through the [security process](SECURITY.md), never a public issue containing exploit details or secrets.
