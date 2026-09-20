# XAUUSD EA Lab

**Status:** idea; no strategy, expert advisor, or verified performance is published here.

## The idea

Develop expert advisors for XAUUSD with rules that can be explained, reproduced, and tested. MetaTrader 5 / MQL5 is a proposed starting platform; the final platform and broker requirements still need confirmation.

## Proposed first version

Start with one strategy specification rather than several loosely defined systems. Write the entry, exit, invalidation, trading session, position sizing, and maximum exposure rules before coding.

Record the broker's symbol, contract size, price precision, volume steps, execution conditions, trading hours, and timezone. Historical testing must state spread, commission, swaps, slippage, and data quality assumptions.

## Evaluation

- Reserve a later time period that was not used to select the rules.
- Compare results across different conditions and modest parameter changes.
- Report drawdown, trade counts, costs, exposure, and losing periods alongside returns.
- Reconcile simulated behavior with a demo-account forward test.
- Document restart recovery, rejected orders, duplicate-order prevention, and loss/exposure limits before considering live execution.

No profit target or strategy advantage is asserted by this brief. A good first result can be a reproducible demonstration that a strategy should not proceed.

## First community output

Write one complete strategy specification and an evaluation plan. Avoid supplying live account credentials or using a backtest image as the sole evidence.

See [starter task AAI-004](../tasks/STARTER_TASKS.md).
