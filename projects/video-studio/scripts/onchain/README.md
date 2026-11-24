# On-chain audit tooling (Solana)

Small, reusable helpers for checking public claims about on-chain trading. Python 3
standard library only (no pip installs). **No case data lives here.** Raw responses,
wallet addresses and per-case working scripts belong under the gitignored
`data/private/` tree (check with `git check-ignore -v <path>` before writing).

| File | What it does |
| --- | --- |
| `rpc.py` | JSON-RPC client for `api.mainnet-beta.solana.com`: disk cache of every raw response (`<cache_dir>/<method>/<sha256>.json`), shared rate limit across processes, per-method pacing, exponential backoff on 429 / 5xx. `signatures_in_window()` pages `getSignaturesForAddress` with `before`. `get_transaction()` asks for `jsonParsed`, `maxSupportedTransactionVersion` 0 and falls back to 1 when the node reports a newer version. |
| `trades.py` | Turns a transaction's `meta` into trades for one wallet (token delta from pre/post token balances; quote leg = SOL lamports + wSOL, or a USD stablecoin), skips failed transactions, tags the venue (Pump.fun bonding curve, PumpSwap, other). `pool_trades()` reads a trade from the venue account's side and gives the execution price. `system_transfers()` lists SOL transfers (for funding links). |
| `candles.py` | OHLCV buckets from per-trade prices, ordered by (slot, tx index); validation (high >= max(open, close), low <= min(open, close), prices > 0); normalisation to price 1.0 at a reference event. |
| `solkeys.py` | Base58, program-derived addresses and associated token accounts (added for another case; used to list one wallet's activity in one token cheaply). |
| `txfetch.py` | Helper added for another case (see its docstring). |

## Rate limits observed (2026-11-24)

The public endpoint returned `x-ratelimit-method-limit: 10` for both `getTransaction`
and `getSignaturesForAddress`, i.e. about 10 calls per 10 s per IP for each of those
methods, while the overall limit was far higher. `rpc.py` therefore paces those two
methods at one call per ~1.05 s across all processes that import it (override with
`ONCHAIN_RPC_TX_INTERVAL` / `ONCHAIN_RPC_SIG_INTERVAL`), on top of the global
4 requests/second cap. Fetching a few thousand transactions takes about an hour, so
audits must sample and say how.

## Method notes

- **Ordering.** Use `slot`, then the transaction index inside the slot, not just
  `blockTime` (one-second resolution). `getSignaturesForAddress` returns
  `transactionIndex`; keep it.
- **Quote leg.** Some app wallets pay in USDC and a relayer pays the network fee, so
  the wallet's SOL balance does not move. Read the stablecoin delta as the quote and
  record the SOL-equivalent from the venue account's lamport change.
- **USD conversion.** Only with an on-chain reference: e.g. the SOL-USDC swap leg
  (a Raydium SOL-USDC pool) inside the same transaction, aggregated per hour.
- **What timing can and cannot show.** A wallet buying seconds before another one,
  even repeatedly, does not show common ownership or intent: copy-trading bots,
  shared signal feeds and launch snipers produce the same picture. Funding links are
  stronger evidence but still not proof of control. Report results as estimates.
- **Ethics.** Describe detection, never operation. No instructions for funding or
  hiding wallets, bundling, sniping or cashing out. Outside `data/private/`, name
  no one and publish no addresses, mints or tickers.

## Minimal example

```python
import sys; sys.path.insert(0, "scripts/onchain")
from rpc import RPC
from trades import parse_wallet_trades
rpc = RPC(cache_dir="data/private/<case>/rpc-cache")
rows, meta = rpc.signatures_in_window(WALLET, t_start, t_end)
for r in rows:
    if r["err"] is None:
        tx = rpc.get_transaction(r["signature"])
        trades = parse_wallet_trades(tx, WALLET, r["signature"], r["transactionIndex"])
```
