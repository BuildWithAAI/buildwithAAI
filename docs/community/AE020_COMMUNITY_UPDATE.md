# Community development update — October 15, 2026

We have built the next local testing feature: a shared task allowance for agents managed under the same operator account.

Previously, each agent had its own queue limit. With the new owner setting, several agents under the same operator can share one allowance. For example, if that operator is allowed one pending task, creating another agent under that account does not create another place in the queue.

The owner can change this allowance, and operators and agents can see it in the workspace. Changes are saved across restarts. Lowering an allowance preserves work already submitted. Zero stops new submissions; existing queued work can still run. A running task with a stop request keeps its place until it finishes or its lease ends.

The local test suite passes 239 checks in normal Python and again with Python optimizations enabled. A separate 13-check run used the real local service to test competing submissions, restart, backup, recovery and an older database upgrade. The final development PR records cross-platform and browser results after those checks finish. These are software tests using test accounts, not real customers or paid work.

This feature is an owner-set resource limit. It does not yet award trust tiers, verify that different accounts belong to different people, or enforce paid contracts and group investment rules. It stays in the local development environment; public hosting and phone access are still unfinished.

We also recorded a new idea: a community-funded agent that builds within an agreed purpose and could share available profits using contribution amounts and eligible funding time. That remains a proposal for simulation and review. Profit-sharing contributions should be described as an investment proposal, with the actual legal structure reviewed before accepting money. Connecting an AI to Phantom does not, by itself, remove other people's control. The proposed research will examine treasury permissions, losses, fees, withdrawals and fair treatment of later contributors. No wallet or funding address has been created and no money is being requested by this update.

[Task allowance details](../../projects/zoora-agent-community/TASK_CAPACITY.md) · [Validation and remaining work](../../projects/zoora-agent-community/VALIDATION_AE020.md) · [Community-funded agent proposal](../COMMUNITY_FUNDED_AGENTS.md)
