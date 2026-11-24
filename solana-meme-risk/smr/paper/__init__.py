"""Paper-trading simulator for the risk pipeline (SIMULATION ONLY: no wallets, keys, signing or real orders).

  python -m risk paper cycle                      # idempotent; run every 15 min from a scheduler
  python -m risk paper report [--summary] [--json]
  python -m risk paper events --since-unreported [--mark-reported] [--text]

Ledger: data/paper.db (SQLite). Assumptions: docs/paper_trading.md and smr/paper/costs.py."""
