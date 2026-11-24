# On-chain audit tooling (Solana)

Small, reusable helpers for checking public claims about on-chain trading. Python 3
standard library only (no pip installs). **No case data lives here.** Raw responses,
wallet addresses and per-case working scripts belong under the gitignored
`data/private/` tree (check with `git check-ignore -v <path>` before writing).

| File | What it does |
| --- | --- |
| `rpc.py` | JSON-RPC client for `api.mainnet-beta.solana.com`: disk cache of every raw response (`<cache_dir>/<method>/<sha256>.json`), shared rate limit across processes, per-method pacing, exponential backoff on 413 / 429 / 5xx (413 has come back on small requests from the shared egress). `signatures_in_window()` pages `getSignaturesForAddress` with `before`. `get_transaction()` asks for `jsonParsed`, `maxSupportedTransactionVersion` 0 and falls back to 1 when the node reports a newer version. |
| `trades.py` | Turns a transaction's `meta` into trades for one wallet (token delta from pre/post token balances; quote leg = SOL lamports + wSOL, or a USD stablecoin), skips failed transactions, tags the venue (Pump.fun bonding curve, PumpSwap, other). `pool_trades()` reads a trade from the venue account's side and gives the execution price. `system_transfers()` lists SOL transfers (for funding links). `account_token_deltas()` reads balance changes of named token accounts (not owners) and `vault_pair_trade()` prices a trade from a pool's two vault accounts, which stays correct when many pools share one vault authority (Raydium CPMM) and for Token-2022 tokens with a transfer fee. |
| `candles.py` | OHLCV buckets from per-trade prices, ordered by (slot, tx index); validation (high >= max(open, close), low <= min(open, close), prices > 0); normalisation to price 1.0 at a reference event. |
| `solkeys.py` | Base58, program-derived addresses (`find_program_address`) and associated token accounts (`get_ata`, SPL Token or Token-2022). Listing the signatures of a wallet's token account for one mint gives only that wallet's activity in that token, which is far cheaper than walking a busy wallet's whole history. Also derives a Pump.fun bonding-curve account (`["bonding-curve", mint]`). |
| `txfetch.py` | `get_tx()` (getTransaction with `maxSupportedTransactionVersion` 1, since version-1 transactions now exist and a version-0 request is refused with -32015); `cursor_at_time()` (a signature from a block at a chosen time: `getSignaturesForAddress` accepts any signature as its `before` cursor, so a scan can start at a date instead of paging down from today); `block_accounts()` (getBlock in accounts mode, gzip-cached, paced to the 6-per-10-s getBlock limit: every transaction in a slot in block order, with signers and balance changes); `block_tx_as_tx()` and `venue_from_keys()` to parse those like getTransaction results. |
| `pull_trades.py` | CLI: fetch a wallet's successful transactions from a saved signature list (optionally every N-th, a documented systematic sample) and write its trades and SOL transfers. |
| `cotrade_tokens.py` | CLI: for a list of mints, rebuild every configured wallet's trades in each token from its token-account history; slots where two or more of the wallets traded are read once with getBlock (exact order, fewer calls). |
| `lead_lag.py` | CLI: per-token lead (side first buy minus public first buy, with same-slot order), side hold times, side sell times relative to the public buy, and SOL PnL per wallet; aggregates with median and quartiles. |
| `curve_candles.py` | CLI: every successful trade on a Pump.fun bonding curve (or a pool account) in a window around a reference time, priced from the venue's own balance change, then 5-second candles via `candles.py`. `--base-vault` / `--quote-vault` price from the pool's two vault accounts (any quote asset, e.g. a token-quoted launchpad pool); `--every N` reads a documented systematic sample (every N-th successful transaction in chain order) for busy pools and records it in `meta`. |
| `sol_usd.py` | CLI: SOL/USD at given times: walks back from each time through transactions touching a liquid SOL-USDC pool (Orca Whirlpool) and takes the median of the last 3 swap legs (an account whose USDC and wSOL moved in opposite directions, at least 10 USDC), keeping each signature so it can be re-checked. Many transactions that touch the pool do not trade (bots that check and exit), so a few days can come back empty or with one odd leg: use the median of at least 2 legs that agree, otherwise interpolate and say so. `price_at()` / `--pool --base-mint --quote-mint` do the same for any token against USDC through a pool you name (e.g. the pool a trader's own router used). |
| `joint_slot_tokens.py` | CLI: documented token sample for a wallet group: slots where at least N of the side wallets had a successful transaction (from their signature lists, no fetching), every k-th of them read with getBlock, and the tokens two or more group wallets traded there recorded. |
| `launch_window.py` | CLI: every transaction of a venue account (launchpad pool, bonding curve, AMM pool) in a time window, e.g. a token's first minute, in chain order, with each owner's token / SOL / stablecoin / other-mint change, signers and fee payer; then per wallet: first acquisition (slot, index, seconds after the window start), acquired, sold, net position and its share of supply. For spotting launch bundles (many wallets buying in one slot at similar sizes). |
| `wallet_origin.py` | CLI: for a list of wallets, how long each history is, when it first appeared (`first_seen`, `age_at_ref_s`) and who sent it its first SOL or tokens (source, amount, signature), plus the fee payers of its first transactions. For freshness and shared-funder checks. |
| `venue_history.py` | CLI: a wallet's own Pump.fun and PumpSwap trades in a time window, listed through its two `user_volume_accumulator` PDAs (seeds `["user_volume_accumulator", user]` under each program). Use it for a famous wallet whose own signature list is flooded by copy-trading bots (1,000 failed bot transactions in 16 s in one audit). Covers only trades that pass that account; check one token against the wallet's token account if completeness matters. |
| `around_ref.py` | CLI: the venue's transactions just ahead of a reference trade (e.g. a public wallet's first buy), every wallet whose balance of the mint changed, and with `--follow-transfers` each early buyer's token-account history for that mint (where its tokens went). The venue is read from the reference transaction. `token_account_of()` finds a wallet's real token account for a mint inside a transaction (wallets do not always use the associated account). |
| `slot_window.py` | CLI: every successful transaction moving one mint in the blocks around a reference transaction (getBlock, exact order): the copy-trading surge right after a public buy, sells by wallets using non-associated token accounts, and plain transfers that never touch the venue. Keep windows to a few slots. |
| `transfer_scan.py` | CLI: token movements that are not trades: `signatures(mint) - signatures(venue vault)` over a window before (and after) a reference trade, then only those transactions are fetched. Catches wallet-to-wallet distributions ahead of a public buy cheaply. Uses the venue's own token vault (not its owner), because newer venues keep many tokens' vaults under one shared owner. |
| `transfer_lead_lag.py` | CLI: timing and PnL when a group acquires, moves and sells a token around a reference buy: classes each event (buy, sell, receive, send, other-quote), group first buy and same-slot order, first distribution, sell times and the share of sell proceeds after the reference, holds, per-wallet SOL PnL (stablecoins converted with a given on-chain SOL/USD), and a timing class per token (`sold_into_ref`, `exited_before_ref`, `same_slot_after_ref`, ...). |
| `candle_stats.py` | CLI: chart-calibration statistics from the ANONYMIZED 5-second candle files (normalized prices, relative times; no RPC, no case data): per token and as median + IQR over the tokens given: peak and time to peak, drawdown, the drop after the linked wallets' last sell, largest red candle at 5 s / 1 min / 5 min, volume spikes and shares, buy share and arrival of the first buys, and how quickly trading dies. Used for `content/zoora-ai/pumpfun-top-caller/audit-data/calibration.json`. |

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
- **Transfer-fee tokens (Token-2022).** Some launchpads issue tokens with a transfer
  fee (e.g. 3%): a buyer receives less than the pool sends, a seller's balance drops
  by more than the pool's rises, and a fee collector later moves the withheld tokens
  (sometimes paying them out to large holders). Identify the pool as the owner that
  moves most often across a window (not per transaction), and expect small token
  credits to a wallet from transactions it did not sign.
- **Non-SOL quotes.** Launchpad pools can be quoted in another token. Price candles
  in that quote, and convert to USD with an on-chain reference for the quote token
  (`sol_usd.price_at`), ideally a routing leg inside the same transaction.
- **Measure at the pool when proceeds can go elsewhere.** Some routers let a seller
  name another address for the proceeds, or pay for a buyer's tokens from another
  account. A wallet's own balance then shows a large loss or a free gain. Value each
  trade by what entered or left the pool's vaults, and record who received the
  proceeds; group totals then add up even when the money moves between wallets.
- **Who kept the balance between a wallet's own transactions.** Fetch only the
  transactions a busy wallet signed, then check that each one starts from the
  balance the previous one ended at; any gap is a credit or debit it did not sign.
- **Famous wallets are flooded.** Copy-trading bots list a famous wallet (and its
  token accounts) as read-only accounts in their own, mostly failing, transactions.
  Its signature list is then useless for finding its trades: use its volume-accumulator
  PDAs (`venue_history.py`), and keep only events where the wallet signed and its
  balance changed (a bot's transaction can touch the wallet's token account).
- **Shared vault owners and token quotes.** Newer Pump venues keep many tokens'
  vaults under one owner and quote curves in other tokens (PUMP, tokenised stocks).
  List the vault account's history, not the owner's, and treat a trade paid in another
  token as `other_quote` (not valued) unless it is converted with an on-chain price.
- **Distribution is visible as non-venue transfers.** A wallet group that buys with one
  wallet and moves the tokens to others before selling shows up as mint signatures
  missing from the venue vault's list (`transfer_scan.py`); a single transaction signed
  by several of the wallets (e.g. consolidating tokens) is a stronger link than timing.
- **First funding of busy wallets.** Paging a wallet with tens of thousands of
  signatures back to its start is too slow; bisect on time instead: probe
  `getSignaturesForAddress(wallet, before=<signature at time T>, limit=1)` on a date
  grid to find the first active day, then page back from the end of that day. Watch
  for address-poisoning dust in the first transactions: zero-value transfers from
  look-alike addresses (same first and last characters as the real funder).
  `first_funding.py` does this.
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
