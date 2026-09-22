# GitHub issue process

The repository supplies eight Markdown issue templates. They become selectable when present on the default branch. Labels are specified separately and must exist before maintainers apply them. [GitHub template documentation](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository).

| Template | Use | Expected output |
| --- | --- | --- |
| Bug report | Reproducible problem in existing work | Version, steps, expected/actual results and redacted evidence |
| Feature request | Improvement to a defined tool | User need, scope and acceptance criteria |
| Community idea | New experiment or starter task | Problem, proposed output, skills, dependencies and token impact |
| Research proposal | A question that needs evidence | Sources, method, evaluation and limitations |
| Security process concern | Non-sensitive policy or reporting-process question | A safe process improvement; no exploit or credential details |
| Documentation improvement | Confusing, missing or inaccurate text | Location, proposed correction and supporting evidence |
| New integration | A provider, platform or service connection | Permissions, data flow, cost, failure behavior and removal plan |
| Design / branding | Art, UX, memes or media | Brief, files/preview, source rights and accessibility checks |

Sensitive vulnerabilities go through [SECURITY.md](../../SECURITY.md), not a public issue. The contact link opens that policy; it does not enable private reporting itself.

## Triage

Check for duplicates and link the existing task. Assign one work-status label and a primary type after labels are configured. Record the commitment category, priority, dependencies and whether token behavior is affected. Maintainers accept assignments only after the contributor agrees. Do not mark a proposal APPROVED until the decision is recorded.

The 40 prepared task IDs (`AAI-T-001` through `AAI-T-040`) are planning identifiers, not GitHub issue numbers. When opening a selected task, copy its body from [BACKLOG.md](../../tasks/BACKLOG.md), include its ID in the title, and add the actual issue URL to the record. Do not open duplicates. No task in this backlog offers payment.

Issue comments are sufficient for discussion initially. If the owner later enables Discussions, create an Ideas category with slug `ideas` before using the supplied category form. This optional setting is not enabled or verified by this documentation update. [GitHub category-form documentation](https://docs.github.com/en/discussions/managing-discussions-for-your-community/creating-discussion-category-forms).
