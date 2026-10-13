# AAI Scan

## Current candidate — October 13, 2026 status review

[PR #10](https://github.com/BuildWithAAI/buildwithAAI/pull/10) contains read-only scanner 0.1.4 in this existing repository. Head 97108a271face220aef6296fddb2e18abdb210b5 has four passing recorded CI jobs and 154 tests, including authenticated UI and actual operational/HTTP verification rehearsals. The latest real complete-coverage test on October 8 failed holder access (primary HTTP429; backup HTTP403). Live Telegram, permitted holder-provider coverage and public deployment/operations remain unverified. This review rechecked recorded CI; it did not rerun live requests or delivery. See the PR evidence and [current ecosystem snapshot](../docs/CURRENT_STATUS.md).

The paragraphs below are the historical September private-prototype record.

## Historical September prototype

**Status:** private prototype; code merged, deployment paused pending founder decision. Status recorded September 20, 2026.

## The problem

A token's current numbers do not explain what changed since someone last looked. AAI Scan is intended to make that change visible through a saved observation journal in Telegram.

## What exists

- Scan a Solana mint and save a timestamped observation.
- Watch selected mints, compare against a previous observation, and inspect a short timeline.
- Show provider-reported pool metrics and optional on-chain mint-authority and largest-token-account information.
- Keep missing data explicit and suppress liquidity comparisons across different pools.
- Limit the initial pilot to allowed private users and a small watch list.

The earlier development record reports 29 passing offline tests and one successful live public market-data request. Those checks were not rerun during this documentation verification. These historical results do not validate live Telegram delivery, production on-chain data, hosting, or uninterrupted operation.

## What makes it worth exploring

The proposed differentiator is an explainable answer to **what changed, when we observed it, and what we cannot know from the data**. A report should make it easy to inspect the supporting observation.

## Important limits

It does not trade, connect Phantom, identify verified insiders, or predict profitable tokens. Largest token accounts are not unique holders. Reported USD liquidity is not an executable sale quote. Pump.fun origin and complete launch-history coverage are not implemented. Alert thresholds are initial settings, not validated predictors.

## First community work

Review scan-report wording using synthetic examples. Design the private-pilot acceptance record. Propose a durable alert-delivery design with duplicate handling and expiry, since the current pilot uses best-effort delivery.

See [starter tasks AAI-001, AAI-002, and AAI-008](../tasks/STARTER_TASKS.md).
