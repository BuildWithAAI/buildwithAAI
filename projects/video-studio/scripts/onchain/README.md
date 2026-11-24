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
| `solkeys.py` | Base58, program-derived addresses (`find_program_address`) and associated token accounts (`get_ata`, SPL Token or Token-2022). Listing the signatures of a wallet's token account for one mint gives only that wallet's activity in that token, which is far cheaper than walking a busy wallet's whole history. Also derives a Pump.fun bonding-curve account (`["bonding-curve", mint]`). |
| `txfetch.py` | `get_tx()` (getTransaction with `maxSupportedTransactionVersion` 1, since version-1 transactions now exist and a version-0 request is refused with -32015); `cursor_at_time()` (a signature from a block at a chosen time: `getSignaturesForAddress` accepts any signature as its `before` cursor, so a scan can start at a date instead of paging down from today); `block_accounts()` (getBlock in accounts mode, gzip-cached, paced to the 6-per-10-s getBlock limit: every transaction in a slot in block order, with signers and balance changes); `block_tx_as_tx()` and `venue_from_keys()` to parse those like getTransaction results. |
| `pull_trades.py` | CLI: fetch a wallet's successful transactions from a saved signature list (optionally every N-th, a documented systematic sample) and write its trades and SOL transfers. |
| `cotrade_tokens.py` | CLI: for a list of mints, rebuild every configured wallet's trades in each token from its token-account history; slots where two or more of the wallets traded are read once with getBlock (exact order, fewer calls). |
| `lead_lag.py` | CLI: per-token lead (side first buy minus public first buy, with same-slot order), side hold times, side sell times relative to the public buy, and SOL PnL per wallet; aggregates with median and quartiles. |
| `curve_candles.py` | CLI: every successful trade on a Pump.fun bonding curve (or a pool account) in a window around a reference time, priced from the venue's own balance change, then 5-second candles via `candles.py`. |
| `sol_usd.py` | CLI: SOL/USD at given times: walks back from each time through transactions touching a liquid SOL-USDC pool (Orca Whirlpool) and takes the median of the last 3 swap legs (an account whose USDC and wSOL moved in opposite directions, at least 10 USDC), keeping each signature so it can be re-checked. Many transactions that touch the pool do not trade (bots that check and exit), so a few days can come back empty or with one odd leg: use the median of at least 2 legs that agree, otherwise interpolate and say so. |
| `joint_slot_tokens.py` | CLI: documented token sample for a wallet group: slots where at least N of the side wallets had a successful transaction (from their signature lists, no fetching), every k-th of them read with getBlock, and the tokens two or more group wallets traded there recorded. |

Case configs (wallet labels, roles, addresses) are JSON files under `data/private/`, e.g.
`{"cache_dir": "...", "wallets": [{"label": "P", "role": "public", "address": "..."}]}`.

## Rate limits observed (2026-11-24)

The public endpoint returned `x-ratelimit-method-limit: 10` for both `getTransaction`
and `getSignaturesForAddress`, i.e. about 10 calls per 10 s per IP for each of those
methods, while the overall limit was far higher. `rpc.py` therefore paces those two
methods at one call per ~1.05 s across all processes that import it (override with
`ONCHAIN_RPC_TX_INTERVAL` / `ONCHAIN_RPC_SIG_INTERVAL`), on top of the global
4 requests/second cap. Fetching a few thousand transactions takes about an hour, so
audits must sample and say how. `getBlock` answered `x-ratelimit-method-limit: 6`.
The limit is per egress IP, and several audits (and other users of the same egress)
share it, so real throughput was often one transaction every 4 to 10 s. JSON-RPC
batch requests are not used: they would get around the per-call limit.

## Method notes

- **Ordering.** Use `slot`, then the transaction index inside the slot, not just
  `blockTime` (one-second resolution). `getSignaturesForAddress` returns
  `transactionIndex`; keep it.
- **Quote leg.** Some app wallets pay in USDC and a relayer pays the network fee, so
  the wallet's SOL balance does not move. Read the stablecoin delta as the quote and
  record the SOL-equivalent from the venue account's lamport change.
- **USD conversion.** Only with an on-chain reference: e.g. the SOL-USDC swap leg
  (a Raydium SOL-USDC pool) inside the same transaction, aggregated per hour.
- **Launch transactions.** `pool_trades()` sets `is_create` when the venue's token
  account has no pre-balance (supply minted in that transaction) and leaves its
  price empty: SOL/token there is not a market price and would wreck a candle.
- **Who bought just before X.** `getSignaturesForAddress(<venue account>, before=<X's
  tx>)` lists the transactions immediately ahead of X on that curve or pool, in chain
  order; fetch the ones inside the look-back window and record the buyers. Then
  count which wallets recur across many tokens, and check whether their timing is
  locked to X's buy or to the token's launch (compare against the launch time).
- **Successful is not the same as traded.** Around a busy launch, many successful
  transactions touch the curve but move nothing (bot programs that check a condition
  and exit cleanly). `curve_candles.py` keeps only transactions where the curve's
  balances changed and reports the rest as `ok_without_curve_flow`.
- **Sampling-weighted totals.** When tokens are found by reading every k-th "joint
  slot", a token with j joint slots is found with probability about min(1, j/k); weight
  it by the inverse to estimate totals for the whole period, and bootstrap the tokens
  for a range. Say clearly that this is an estimate.
- **Cheap per-wallet, per-token history.** A trader's token account for one mint
  (read from the token balances of any of its trades) has a short signature list:
  use it instead of walking a bot's whole history.
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
