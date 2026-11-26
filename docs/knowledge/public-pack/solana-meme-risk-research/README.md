# Solana Meme Risk — Public Research Pack

**Thesisdamus** curated research pack from the `solana-meme-risk` project: documentation, sample risk-score outputs, known public entity labels (CEX / DEX infrastructure), and a historical **backtest** dataset + report.

## Important labels (read first)

- **Backtests and paper trading only.** Nothing in this pack is live trading, live P&amp;L, or a live signal feed.
- **Not financial advice.** Meme coins are extremely high risk. Past backtest metrics do not predict future results.
- The underlying tool is designed as a **read-only, point-in-time risk screen**. It does not trade, sign transactions, or use wallet keys.
- Raw RPC caches, paper-trading databases, smart-wallet lists, usage logs, backups, secrets, and private linkage were **intentionally excluded** from this pack.

## What's included

| Path | Description |
|------|-------------|
| `README.md` | This pack overview |
| `LICENSE` | CC BY 4.0 |
| `PROJECT_README.md` | Project README (architecture, CLI, measured backtest summary) |
| `requirements.txt` | Python deps used by the project |
| `docs/paper_trading.md` | Paper-trading / simulation system documentation (names redacted) |
| `backtest/REPORT.md` | Human-readable backtest report |
| `backtest/report.json` | Machine-readable backtest metrics |
| `backtest/dataset.jsonl` | Backtest rows (public mint/creator addresses + scores/labels) |
| `backtest/thresholds.fitted.json` | Thresholds fitted on the train split (not necessarily deployed) |
| `samples/*.json` | Example `health` / `score` / watch-demo JSON outputs |
| `labels/known_entities.json` | Verified **public** CEX hot-wallet and service addresses with explorer citations (no social-handle↔wallet maps) |

## What's excluded (and why)

- `data/cache.db` (+ WAL/SHM) — regenerable raw RPC cache; large; not research content
- `data/paper.db*` / `experiment100/paper.db*` — paper-trading state DBs
- `data/smart_wallets.json`, `smart_money_cache.json`, `holder_cache.json` — runtime ingested lists/caches
- `data/stalkchain_usage.jsonl`, `x_usage.jsonl`, `paper_stalkchain.jsonl` — connector usage logs
- `data/funding_graph.db*`, `launches.db`, `watch/*`, live heartbeats/locks/logs — runtime / live scanner state
- `data/backups/*` — DB backups
- `data/backtest/work/*` — runtime backtest work logs and local DB copies
- `LEARNINGS.md` — internal ops journal (not a cleaned research artifact)
- Source code, tests, `.venv`, `.git`, `.env` / configs with keys — out of scope for this docs/data pack; secrets never included

## License

Documentation and data in this pack are licensed under **Creative Commons Attribution 4.0 International (CC BY 4.0)**. See `LICENSE`.

## Provenance

Prepared as a reviewed public-ready pack for Thesisdamus. Staging copy only; original live project tree was not modified.
