# Pull request and review process

**Proposed process; repository enforcement still needs verification.** Start a small branch linked to a task or proposal. Use a draft PR for unfinished work. Explain the problem, resulting behavior, tests actually run, pending checks, security impact, breaking changes and token impact. Include screenshots for visual changes and sources/reuse terms for imported material.

## Ordinary changes

An authorized maintainer reviews scope, evidence, licensing and consistency with the project boundaries. Resolve material feedback and record acceptance before merging. A documentation merge releases documentation; a software merge does not demonstrate that a bot is deployed or safe for public use.

## Protected changes

Changes affecting supply, minting, authorities, treasury, fees, migration, governance, project-controlled wallets or official identity require:

1. A linked proposal describing the exact change and its risks.
2. Explicit project-owner approval of that scope, recorded publicly where safe.
3. Additional qualified review with findings and unresolved issues recorded.
4. Relevant evidence, tests and an operational recovery plan where applicable.
5. A public decision and release note before the changed behavior is represented as official.

Do not combine an economic change with a routine cleanup to avoid review. No PR may silently remove the current prohibitions on wallet-secret collection or automatic trading. Any future reconsideration is a separate owner-visible policy decision, not authorization supplied by this plan.

## Proposed GitHub enforcement

The supplied CODEOWNERS names the current owner for the repository. It does **not** itself require an approval. Configure eligible branch protection/rulesets for `main` after reviewing the account's available features: PR review, code-owner review, stale-approval handling and bypass permissions. Do not invent required checks when no corresponding workflow exists. Confirm behavior using a harmless draft/ready-for-review PR before claiming enforcement. [GitHub code-owner documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).

An author cannot provide their own GitHub approving review. With only one owner, independently reviewed sensitive changes may have to wait for an explicitly appointed reviewer. Do not bypass that requirement by labeling a self-authored change as reviewed. Draft PRs are for discussion; their existence is not approval.

This revision prepares rules and templates; it does not change branch protection, add reviewers, merge code, launch a token or authorize spending.
