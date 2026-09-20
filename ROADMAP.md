# AAI community roadmap

Prepared September 20, 2026. This is a proposed sequence for the founder and community to review, not a fixed delivery schedule.

## 1. Make the ideas easy to join

**Current focus, before paid bot hosting.**

- Publish the community overview, project briefs, and contribution guide.
- Turn the most useful starter tasks into GitHub issues with a clear completion condition.
- Choose documentation and code licenses before describing repositories as open source.
- Record which decisions are approved and which remain proposals.

**Complete when:** a newcomer can understand AAI, pick a task, and submit work without needing access to the private scanner code.

## 2. Validate AAI Scan privately

**Built:** private pilot code for scans, saved observations, watches, comparisons, and change alerts. Offline tests passed; one live public market-data request succeeded.

**Still needed:** a decision on hosting cost, private Telegram setup, on-chain provider validation, persistent-storage checks, and a restart/restore exercise.

**Complete when:** an allowed tester can scan, watch, compare, and retrieve saved history after restart; unsupported data and failures are shown accurately.

Any wider release needs a separate decision on access, licensing, data costs, privacy, monitoring, and reliable alert delivery. No paid service is required to contribute to the documentation in this hub.

## 3. Choose the next experiment

Invite small proposals for:

- A jellyfish-inspired Solana model evaluated against simple baselines in replay or paper trading.
- One clearly specified XAUUSD expert advisor tested offline and on demo.
- One Telegram utility with a specific user problem.

**Complete when:** the selected experiment has an owner, a written specification, usable data, a reproducible evaluation, and published limitations. Selecting one does not commit the project to building every proposal at once.

## 4. Design useful AAI payments

Select a real service before designing token payment requirements. Specify the unit of service, pricing method, payment verification, access, failure handling, and refunds. Prototype the flow in a test environment.

**Complete when:** the payment design can be demonstrated without claims that token demand or price will rise. No AAI payment integration is implemented by this roadmap.

## 5. Review launch readiness

Separately review the working product, funding disclosure, support capacity, launch research, and proposed token terms. Keep incomplete work visible. Only publish launch details after they have been decided and verified.

The launch study can inform decisions, but it cannot establish a perfect launch or guarantee low volatility.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| Idea | A problem or direction worth discussing |
| Research | A question and evaluation plan are being developed |
| Prototype | Code exists; operational validation may be incomplete |
| Pilot | A limited test with documented acceptance results |
| Released | A usable version with support and operating limits documented |

Use dated evidence when changing status. A repository, a backtest, and a live service are different milestones.
