# Work status and commitment

This is the proposed status system. Labels in [.github/labels.json](../../.github/labels.json) are definitions to configure after review, not evidence that GitHub labels or automation already exist.

Every task or proposal has **one work status**, plus a separate commitment category from [DECISIONS.md](../DECISIONS.md). A FUTURE possibility can remain DEFERRED. An APPROVED boundary is not a shipped feature. RESEARCH means a question has been selected for investigation; it does not claim completed research.

| Work status | GitHub label | Entry and exit evidence |
| --- | --- | --- |
| IDEA | `status: idea` | A problem and possible output are recorded; no implementation commitment |
| DISCUSSION | `status: discussion` | Feedback or a decision is needed; record the unanswered question |
| RESEARCH | `status: research` | A question, method, sources and limitations are specified; exit with findings or an explicit inability to answer |
| PROPOSED | `status: proposed` | Scope, acceptance criteria, dependencies, risks and maintainer needs are reviewable |
| APPROVED | `status: approved` | Owner/maintainer records acceptance of the exact scope; protected changes also need explicit owner approval and additional review |
| IN DEVELOPMENT | `status: development` | Approved scope has an accepting contributor and linked branch or work record |
| TESTING | `status: testing` | Reviewable implementation or existing pilot exists; validation results and pending checks are listed |
| RELEASED | `status: released` | Accepted output is published with version/evidence and operating limitations; merged code alone is not a deployed service |
| REJECTED | `status: rejected` | Decision maker records why the proposal was declined |
| DEFERRED | `status: deferred` | Work is paused with a reason and a condition for reconsideration |

Typical movement is IDEA → DISCUSSION → RESEARCH if needed → PROPOSED → APPROVED → IN DEVELOPMENT → TESTING → RELEASED. Small documentation fixes can move directly to PROPOSED. Rework can return to an earlier status. Rejections and deferrals preserve their history; reopening needs a recorded reason. Do not erase a previous release when proposing a new version.

Maintainers change status after reviewing evidence. Contributors can request a transition, but a self-applied label is not approval. Update the proposal decision record and task together. If a future native Projects board and issue labels disagree, the recorded maintainer decision controls; fix both displays rather than silently assuming synchronization.

Use a primary type label: bot, website, analytics, solana, community, documentation, security, research or branding. Priority means review order, not a delivery date: P0 = foundation/security prerequisite, P1 = next candidate, P2 = later candidate. No status grants funding, compensation, token rights or permission to deploy.
