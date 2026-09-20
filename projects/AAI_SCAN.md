# AAI Scan

**Status:** private prototype; code merged, deployment paused pending founder decision. Status recorded September 20, 2026.

## The problem

A token's current numbers do not explain what changed since someone last looked. AAI Scan is intended to make that change visible through a saved observation journal in Telegram.

## What exists

- Scan a Solana mint and save a timestamped observation.
- Watch selected mints, compare against a previous observation, and inspect a short timeline.
- Show provider-reported pool metrics and optional on-chain mint-authority and largest-token-account information.
- Keep missing data explicit and suppress liquidity comparisons across different pools.
- Limit the initial pilot to allowed private users and a small watch list.

The implementation has 29 passing offline tests and a successful live public market-data smoke test from development. These results do not validate live Telegram delivery, production on-chain data, hosting, or uninterrupted operation.

## What makes it worth exploring

The proposed differentiator is an explainable answer to **what changed, when we observed it, and what we cannot know from the data**. A report should make it easy to inspect the supporting observation.

## Important limits

It does not trade, connect Phantom, identify verified insiders, or predict profitable tokens. Largest token accounts are not unique holders. Reported USD liquidity is not an executable sale quote. Pump.fun origin and complete launch-history coverage are not implemented. Alert thresholds are initial settings, not validated predictors.

## First community work

Review scan-report wording using synthetic examples. Design the private-pilot acceptance record. Propose a durable alert-delivery design with duplicate handling and expiry, since the current pilot uses best-effort delivery.

See [starter tasks AAI-001, AAI-002, and AAI-008](../tasks/STARTER_TASKS.md).
