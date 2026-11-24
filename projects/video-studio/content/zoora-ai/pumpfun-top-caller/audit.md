# Audit: the caller "side-wallet" allegations, checked on-chain (anonymized)

Story: *POV: You become a top caller on Pump.fun* (fictional composite). Written 2026-11-24.

**Read this first.**

- **Our estimates only.** Everything below is OUR ESTIMATE from public Solana data. It exists to make a fictional animated story true to real timings and sizes, and to see whether an analytics firm's public allegations hold up on-chain.
- **Coordination is not ownership.** Clustering, timing and transfers show that wallets act together. They do not show who controls them, or intent. No charges have been reported in any of these cases.
- **Anonymized.** The four cases are called A to D. This file has no names, handles, wallet addresses, prefixes, token mints or tickers.
  - Amounts are rounded.
  - The allegations' own figures are **banded on purpose**, because the exact figures would let a reader map a case to a named person.
  - Identifiable raw data stays in the gitignored `data/private/bubblemaps-audit/`.
- **Checked twice.** Each case was audited, then independently re-derived by a checker with its own parser and RPC client. Where the checker corrected the auditor, the checker's numbers are used here. The JSON files in `audit-data/` were patched to match; where they still differ, this file wins.

Contents: 1. What was audited and how · 2. Per case (A-D) · 3. Cross-case patterns · 4. Authentic beats for the fictional script · 5. Chart calibration · 6. Can say / cannot say · Anonymization check

---

## 1. What was audited and how

### The allegations

In Oct-Nov 2026 the on-chain analytics firm Bubblemaps published investigations into social traders. We audited four of them:

| Case | Subject (anonymized) | What was alleged, in one line |
| --- | --- | --- |
| A | Pump.fun caller | A handful of linked wallets bought seconds before the caller's posts and sold minutes later. |
| B | Pump.fun caller | A public wallet and 3 side wallets bought together and sold within minutes of each callout. |
| C | Pump.fun "top caller" | A large wallet network: operational wallets buy first and spread tokens to side wallets, which sell into copy traders after the public buy. A serial token deployer is said to be linked. |
| D | Social trader on another launchpad | The public wallet lost money on promoted tokens while launch-bundle wallets connected to it made several times more. |

Pump.fun's in-app Callout Rewards pay callers when followers trade from their calls (see `research.md`). Cases A to C are about that setting.

### Sources

- **The claims.** x.com and the firm's blog were not reachable from this session. Each claim was rebuilt from:
  - news outlets' quotes of the thread (crypto.news, Coin Edition);
  - search-engine titles and extracts of the thread's posts;
  - secondary coverage.
- **The public wallets.** Each came from the caller's own public Pump.fun profile, through the read-only public API. In B and C it also matched a prefix the firm had published.
- **The side wallets.** The firm's wallet lists were not reachable.
  - Only in Case B did outlets print short address prefixes. All 3 side wallets were resolved from them on-chain.
  - In A and C, the candidate side wallets come from **our own detection**. They may not be the firm's wallets.
  - In D, the candidates are the launch clusters we measured.
- **Call timestamps.** None were reachable (x.com blocked; the callout feed not readable). **Every timing below is measured against the public wallet's first on-chain buy, not against the post.**

### On-chain data and method

- **Endpoint.** One public Solana JSON-RPC endpoint.
  - At most 4 requests per second, with exponential backoff on 429, 413 and 5xx errors.
  - Every raw response was cached on disk, so nothing was fetched twice.
  - The endpoint also allows about 10 transaction or signature calls per 10 s per IP. Four audits shared that budget, so real throughput was one transaction every 2 to 10 seconds. That is why everything is sampled.
- **Trades.** Each trade is read from transaction `meta`:
  - the token delta, from pre/post token balances (SPL and Token-2022);
  - the SOL leg, from lamports plus wrapped-SOL accounts, with fees, tips and rent included;
  - stablecoin legs where a wallet paid in USDC.
  - Failed transactions are skipped.
- **Order.** Events are ordered by slot, then by the transaction index inside the slot. Where same-block order mattered, it was confirmed with `getBlock`.
- **USD values.** Only from on-chain SOL-USDC swap legs near the trade time. SOL was about $90-120 in the audited windows.

### Windows and samples

| Case | Window | What was sampled | Size |
| --- | --- | --- | --- |
| A | The claim's ~2 weeks plus a 2-day margin (~25,000 signatures, ~6,400 successful) | Every successful public-wallet transaction on two whole UTC days, 6 days apart. Co-traders on 22 of its buys: 18 drawn at random with fixed seeds, plus 4 non-random. For each, every curve transaction up to 30 s before the public buy. | 826 transactions, 124 tokens; 18 tokens with candidate buys; 67 wallet-token pairs |
| B | About two months: from the start of paid rewards to 2 days after the allegation. The side wallets traded jointly only in its last ~3 weeks. | 544 slots in which all three side wallets transacted. Every 10th slot was read, giving 44 tokens. 27 of them were rebuilt in full (25 had buys by both sides). The full history of the payout address was also read. | 27 tokens; 36 payout days |
| C | The claim covers ~6 months. The sample is the ~27 hours before the group's routine daily pause ahead of the allegation. | One full day of the public wallet, read through its volume-accumulator accounts, because its own history is flooded by bots. The 18 most recent tokens shared by the public wallet and the detected group. | 64 tokens in one day; 18 shared tokens |
| D | The 4 named tokens over ~7 weeks, plus each launch's first 35-40 s | All ~240 public-wallet transactions in those tokens. Every launch transaction. Systematic samples of 5-26 cluster wallets per token. The public wallet's full history (~9,000 signatures) for link checks. | 4 tokens; ~2,200 transactions plus ~130 blocks |

### Tooling

The reusable tooling is in `scripts/onchain/` (Python 3 standard library only; see its `README.md`). It holds no case data.

| Script | What it does |
| --- | --- |
| `rpc.py` | Cache, shared rate limit, backoff |
| `trades.py` | Trades from transaction `meta`; venue-side prices |
| `candles.py`, `curve_candles.py` | 5-second OHLCV with validation |
| `lead_lag.py`, `transfer_lead_lag.py` | Leads, sell delays, holds, PnL |
| `cotrade_tokens.py`, `joint_slot_tokens.py` | Documented token samples |
| `venue_history.py` | A famous wallet's own trades, when bots flood its history |
| `launch_window.py`, `wallet_origin.py`, `first_funding.py` | Launch clusters and first funders |
| `sol_usd.py` | On-chain USD references |
| `candle_stats.py` | The chart-calibration statistics in section 5, computed from the anonymized candle files (added in this step) |
| `txfetch.py`, `solkeys.py`, `around_ref.py`, `slot_window.py`, `transfer_scan.py`, `pull_trades.py` | Helpers |

Per-case driver scripts, configs and outputs stay private.

### Limits

- **No call times.** A lead "before the public buy" is not a lead "before the post".
- **Side-wallet identity is unverified.** In A, C and D we measured our own candidates, not the firm's list.
- **Small, partly self-selected samples.**
  - A: 2 days. The candidates were picked on the same day that measures them; the other day is the out-of-sample check.
  - B: tokens are more likely to be picked the more joint slots they have, so the checker re-weighted them.
  - C: 18 tokens over ~27 h. The token that revealed the group is in the sample.
  - D: 4 tokens.
- **USD values** use an on-chain SOL reference, not the firm's (unknown) one.
- **Bots are a live alternative.** Copy-trading bots and shared signal feeds produce the same timing. In A, one candidate's buy was paid through a third-party trading-service account.
- **Case D is a different setting.** Its tokens were on another launchpad (not Pump.fun). They are transfer-fee tokens priced in quote tokens other than SOL.

---

## 2. Per case: claim vs measured

**Verdict key**

| Verdict | Meaning |
| --- | --- |
| confirmed | The on-chain pattern the claim describes is present in our sample. This never means a person did it. |
| partly | Part of the claim holds, or it holds only against another reference point (the public buy instead of the post), or the size differs. |
| not confirmed | Our data points the other way. |
| could not check | The data was not reachable, or is not on-chain. |

### Case A: the "seconds ahead" pattern

**Claim, banded.** Several hundred calls in about two weeks. About 5 side wallets bought before about 60% of the calls, about 20 s before publication on average, and began selling about 3-4 minutes later. Trading profit in the tens of thousands of USD, plus a larger amount of callout rewards (a low-six-figure total). Side-wallet capital came from the public wallet, and cash-outs went to exchange deposit addresses. The firm said it could not verify who controlled the wallets.

| Claim | Measured (checker-corrected) | Verdict |
| --- | --- | --- |
| Several hundred calls in ~2 weeks | The public wallet bought ~60 new tokens a day (2 sample days), about 870 per 14 days at that rate, so a few hundred calls fit as a subset. Calls themselves are not on-chain. | partly |
| About 5 side wallets | Our method found exactly 5 recurring early buyers that stand out: two lockstep pairs plus one. They appeared just ahead of the public buy in 11-17 of 22 sampled tokens; the next wallet appeared in 6. Whether they are the firm's 5 cannot be checked. | could not check |
| Bought before ~60% of calls | A candidate bought before the public wallet's first buy on 18 of 22 sampled buys (82%). Selection inflates this. On the day the candidates were picked, the rate was 14 of 14, by construction. On the out-of-sample day it was 4 of 8 (50%): all 4 came before one pair stopped trading that morning, and 0 of 4 came after. | partly |
| ~20 s before publication, on average | Median **2 s** (IQR 2-3 s, range 1-11 s, mean 3.6 s), about 9 Solana slots, before the public wallet's first successful buy (n = 67 wallet-token pairs in 18 tokens). The candidates were never in the public buy's block. The gap to the post is not measurable. | partly |
| Began selling ~3-4 min later | First sell median +12 s and last sell median +15 s after the public buy (IQR 4-118 s); 62% were fully out within 45 s. The "~3-4 min" fits only the profitable runners: exits 100 s or more after the public buy (median ~3 min, IQR 2-4 min) carried ~78% of the profit. | partly |
| Trading profit in the tens of thousands of USD | 14.8 SOL (~$1.7K) on 18 sampled tokens. Linear scaling over the active days gives ~330-380 SOL (~$39-44K). Same order of magnitude, but very uncertain: 2 days, in-sample selection, and one pair stopped early. | partly |
| Callout rewards (the larger share) | Not checkable from this sample. A payout-like address paid the public wallet ~$1.2K and ~$2.5K on the two sample days. It is unattributed, and it says nothing about the side wallets. | could not check |
| Side-wallet capital came from the public wallet | Not shown for our candidates. The two main ones got their first ~1 SOL each from two different busy, service-like addresses, minutes apart. The 826 sampled public-wallet transactions moved no value to or from any candidate. Later funding was not traced, and the firm's wallets were unavailable. | could not check |
| Cash-outs to exchange deposit addresses | The two main candidates were emptied 16 s apart (~20 and ~7 SOL). The receiving addresses behaved like exchange deposit addresses and consolidated the funds within minutes. No link from them to the caller was checked. | partly |
| Control could not be verified | Holds. The pairs act in lockstep: same-block buys and sells, and final transactions in one block with the same third-party fee payer. Nothing ties them to the caller, and a trading-bot explanation remains open. | confirmed |

**Public wallet, for reference.**

- It pays in USDC through an app relayer that covers network fees.
- It bought ~60 new tokens a day; first buy median $100 (IQR $100-200).
- Median hold 43 s (IQR 11-290 s).
- About +$3K over the 2 days on 124 tokens, but a median of about −$5 per token; 42% of tokens were profitable.

**What the checker changed.**

- Look-back windows were often truncated by failed bot transactions. Fixing them raised the front-run share from 73% to 82% and added 10 pairs and +2.6 SOL.
- A missed second token account was added.
- Non-SOL quote legs were corrected, and a ~$54 unit slip in the public-wallet total was fixed.
- The profit scaling was redone (one pair stopped a day earlier).
- The address-poisoning dust went *to* the sweep destinations, not to the candidates.

### Case B: the "same block" pattern

**Claim, banded.** A public wallet plus 3 side wallets bought around the caller's callouts (reportedly in the same second) and began selling about 3 minutes after the callout on average. About 50 called tokens. A low-six-figure total, roughly one third trading profit and two thirds callout rewards.

| Claim | Measured (checker-corrected) | Verdict |
| --- | --- | --- |
| The public wallet (published prefix) is the caller's | The caller's public Pump.fun profile lists it. That is the platform's attribution, not proof of control. | confirmed |
| Public + 3 side wallets trade the called tokens together | All four bought in the same block in 25 of 25 sampled tokens. They are linked both ways at one hop: the public wallet sent tokens to the side wallets (9 of 25 tokens, once to all three in one transaction), and the side wallets sent USDC back (6 transfers, ~$2.7K). Which tokens were called is not visible on-chain. | confirmed |
| The public wallet bought, then the 3 others bought in the same second | Same block in 25 of 25, but the order is mostly reversed. A side wallet was ahead of the public wallet in the block in 23 of 25 (all three ahead in 11), a median 7 transactions ahead. The public wallet was first in 2. | partly |
| They bought before the callout | Call times are off-chain. Against the public buy, the lead is 0 s (same block). | could not check |
| Selling began ~3 min (average) after the callout | Against the public buy, design-weighted, before the allegation: first side sell median ~45 s (IQR ~20 s to 1.5 min), mean ~1.6 min. Last side sell median ~2 min (IQR ~0.5-8 min), mean ~6 min. Same scale, different reference point. | partly |
| About 50 called tokens | ~170-180 tokens were traded jointly by all three side wallets in the ~3 weeks before the allegation (90% range ~130-230). Callouts cannot be identified on-chain, so ~50 calls as a subset is plausible. | partly |
| Trading profit in the tens of thousands of USD | Weighted estimate for the four wallets together: ~480 SOL, about $57K (90% range ~$10K-118K). The side wallets alone made ~$72-77K; the public wallet lost about 125 SOL. Unweighted, 22 tokens before the allegation: +121 SOL, about $14K. | partly |
| Callout rewards (the larger share) | About $91K of USDC credits reached the public wallet from one daily mass-payout address over 36 payout days (about $87.6K before the allegation; median ~$1.8K per payout day). That is consistent with the claimed size, but the payer is not confirmed as the platform. | partly |
| The low-six-figure total | ~$57K trading (very uncertain) plus ~$87.6K USDC is about $145K (roughly $100-205K). Same order. | partly |
| Sold while the caller kept promoting | Posts are off-chain. On-chain, in some tokens the public wallet kept buying while the side wallets sold in tranches. | could not check |
| Follower count at the time | Not checkable for that date. | could not check |

**What the checker changed.**

- Tokens traded after the allegation were removed (11% of joint slots).
- The full payout history was walked, adding about $36K of rewards the first pass had skipped.
- The unweighted timing over-sampled staged exits. The typical token is much faster: last side sell ~2 min, not ~7 min.
- Platform fee-distribution credits (+1.6% of group profit) are not in the totals.
- "The public wallet sold in the same block as the side wallets' last sell" holds in 12 of 25 tokens, not "usually".

### Case C: the "copy-speed group" pattern

**Claim, banded.**

- About 30 linked wallets: a few operational wallets buy first and spread tokens to about a dozen side wallets.
- The caller's public wallet buys, copy traders pile in, and the side wallets sell into them, "in many cases right after the public buy".
- Tens of thousands of tokens traded over ~6 months, thousands of them through the scheme.
- A seven-figure extraction estimate, plus six-figure rewards.
- A serial token deployer is said to be linked, with seven-figure profits and hundreds of its launches bought early.

| Claim | Measured (checker-corrected) | Verdict |
| --- | --- | --- |
| The public wallet with the published prefix is the caller's | The caller's public Pump.fun profile lists it, and the prefix matches. | confirmed |
| ~30 linked wallets (operational + side) | The firm's list was unreachable. Our detection found one tight 5-wallet group: 2 buyers/distributors and 3 sellers, multi-signer sweep transactions, and an internal first-funding chain. Bounded checks found no on-chain link from it to the public wallet. | could not check |
| Operational wallets buy first and distribute; the public wallet buys; side wallets sell into copy traders | Weak. Of 18 sampled shared tokens, 2 fit that order, and even there ~80% of the group's buying came in the same block right *after* the public buy. In 6 the group had sold out before the public buy; in 6 its first buy came right after the public buy in the same block; in 4 it bought later. Overall, 26% of group buying came before the public buy, 46% in its block right after it, and 27% later. One of the 2 fitting tokens is the one that revealed the group, which is circular. | partly |
| Side wallets dump "right after" the public buy | Median 42 s from the latest public buy to each group sell (IQR 14-103 s, n = 147). Of the sell proceeds, 24% came before any public buy, 31% within 60 s after one, 43% within 5 min and 71% within 15 min. 39% came after the public wallet had already sold out. | partly |
| Side wallets buy before the public buy (no figure claimed) | Group first buy minus public first buy: median 0 s (IQR −66 to 0 s). The group was first in 8 of 18 tokens. In every same-block case the group was *after* the public wallet. | could not check |
| Seven-figure extraction over ~6 months | +32.5 SOL (~$2.9K) on 18 tokens; median −0.6 SOL per token; profitable in 7 of 18. One token is larger than the whole total, so no scaling is usable. | could not check |
| Tens of thousands of tokens traded | The public wallet alone bought 64 tokens in one day, about 12,000 over six months at that rate. One group wallet touched 116 tokens in ~2.5 days. Same order of magnitude. | partly |
| Six-figure callout rewards | Not measurable: payouts could not be isolated in the bot-flooded history. | could not check |
| A serial deployer launched and rugged thousands of tokens, including one named after the caller | A candidate address (a 5-character prefix match through a third-party tracker) signed all 6 recorded creation transactions checked, and is very busy (300-2,200 transactions a day). "Thousands", "rugged" and the caller-named token were not verified. Consistent, but mostly unchecked. | partly |
| Multiple on-chain links to that deployer; side wallets sniped hundreds of its launches | The public wallet bought 5 verified launches of it in one day, 3 within 8 s of creation. That is trading behaviour, not an ownership link. Our group bought 2 of 116 sampled tokens from it. No funding link was checked. | could not check |
| Seven-figure deployer profits | Not measured (it would need the deployer's full history). | could not check |
| Two named example tokens | One same-ticker token is in the public wallet's history, but it does not reproduce the example's figures. We cannot confirm it is the same token. | could not check |

**Context.**

- The public wallet bought 64 tokens in one day: first buy median 3 SOL (IQR 1.4-10), median hold ~3.7 min, 61% of closed tokens profitable.
- Copy bots hit it constantly: 1,000 transactions referencing the wallet every 16 s to ~4 min, 98-100% of them failing.
- The detected group pauses for 10-13 h on most days. It resumed within minutes after the allegation and kept trading for weeks.

**What the checker changed.**

- Missed token accounts held ~43 SOL of same-block buys right after the public buy. Fixing them cut group profit from 64 to 32.5 SOL and turned the 2 "fit" tokens into mixed cases.
- A token's own bonding curve had been counted as a sixth group wallet. Removing it eliminated the absurd 8-hour maxima.
- The "quiet 11 h before the allegation" is a daily cycle, not a stop.
- The six-month scaling was withdrawn.
- The deployer counts were tightened (5 verified launches, 3 within 8 s).

### Case D: the "launch bundle" pattern

**Claim, banded.**

- A social trader's public wallet showed a five-figure USD loss on several promoted launchpad tokens.
- "Connected" wallets showed a gain several times larger.
- Dozens of fresh wallets per token bought at similar times, each with about 0.5-1% of supply.
- The public wallet was said to be linked to the token deployers through intermediary wallets.
- A second analytics firm's follow-up counted several hundred addresses and a similar proceeds figure.
- No lead time, sell delay or call timing was claimed.

| Claim | Measured (checker-corrected) | Verdict |
| --- | --- | --- |
| Public wallet down by tens of thousands of USD | About −$54K at the time of the allegation (−$59K realized, plus a ~$5K open position). Same sign, ~20-25% smaller. | partly |
| Connected wallets up several times more | Our launch-group estimate is about +$197K (roughly $150-245K). Per token: ~$103K, ~$55K, ~$33K and ~$5K (the last is partial). That is ~70-80% of the claimed and second-firm figures. Later relay generations were not measured. | partly |
| Dozens of fresh wallets per token buying at similar times | 52-101 wallets per token took ≥0.1% of supply within 35 s of creation (80 in one block on one token). But the largest group were ~70-day-old, low-activity wallets, and several launch buyers were bots. Only the deployers and relay recipients were fresh (minutes to a day old). | partly |
| Each wallet held 0.5-1% of supply | Median stake 0.43-0.80% per token; 13-37% of each cluster fell inside 0.5-1%; range 0.1-4%. Two deployers also bought ~50% of supply in their own creation transactions. | partly |
| Public wallet traced to the deployers through intermediaries | The deployers were funded through same-second, identical transfers at least 2 layers deep, which fits intermediaries. But the public wallet's full history shares 0 transactions with the 80+ wallets examined. There is one weak shared funder (a busy service address). Funding trees were not traced to their roots. | could not check |
| (Cases A-C pattern, not claimed here) Side wallets buy just before the public wallet and sell into its buying | Launch groups bought 1.6 h to 3.9 days before the public wallet's first buy, and had made 99.8-100% of their sampled sales before it. They were 0-3.5% of the selling in the 30 min after it. | not confirmed |
| The bundles did not rug every token | Launch groups sold most of their stakes within ~5-45 min. Prices then reached all-time highs 1-15 days after launch. | partly |
| Public wallet down while connected wallets up | The public wallet bought 1.6 h to 3.9 days after launch, at ~$0.4-1M market cap. It kept adding as prices rose (up to 1.5-7.5x its first price) and exited 83-96% below its average entry. The launch groups realized gains. | confirmed |
| Leaderboard rank, a big win on one position, follower count | Not checkable on-chain. | could not check |

**What the checker changed.**

- The open position had been valued 11 days early, at the wrong thread time (~$4K became ~$5K).
- Launch windows had been listed through one route-specific account, so clusters were undercounted: 40 to 71, 50 to 79, and 40 to 52 wallets.
- The deployers' own ~50% creation-transaction stakes, sold within ~26-27 minutes, had been missed. They add ~$43K and ~$27K on two tokens.
- The relay-set samples over-weighted the one source wallet.
- The "10%/20% developer buys in the creation transaction" were mislabelled. They were other wallets' buys in the same slot.

---

## 3. Cross-case patterns

The four cases show **four different shapes**, not one playbook. "Front-running" covers three different things: seconds ahead, the same block, and hours ahead at launch.

### 3.1 Share of public buys with linked wallets first

| Case | Measure | Result |
| --- | --- | --- |
| A | A candidate bought before the public wallet's first buy | 18 of 22 (82%). Out-of-sample day: 4 of 8 (50%). |
| B | A side wallet sat ahead of the public wallet in the same block | 23 of 25 (92%); all three ahead in 11 of 25 (44%) |
| C | The group bought before the public wallet | 8 of 18 (44%). Bought before *and* sold into the public buy: 2 of 18 (11%), and even those were mostly bought after. |
| D | The launch group bought before | 4 of 4, by 1.6 h to 3.9 days. Not a front-run of a call. |

### 3.2 Lead time (linked first buy minus public first buy)

| Case | n | Median | IQR | Range |
| --- | --- | --- | --- | --- |
| A | 67 wallet-token pairs | −2 s (−9 slots) | −3 to −2 s | −11 to −1 s; never the same block |
| B | 25 tokens | 0 s: same block, a median 7 transactions ahead | 3-11 transactions ahead | 4 behind to 35 ahead |
| C | 18 tokens | 0 s | −66 to 0 s | −17 h to +11 min; same-block buys always *after* the public buy |
| D | 4 tokens | −16.6 h | −39 to −9.6 h | −95 h to −1.6 h |

### 3.3 Sell delay (after the public wallet's first buy)

| Case | First linked sell | Last linked sell | Notes |
| --- | --- | --- | --- |
| A | +12 s (IQR 4-111 s) | +15 s (IQR 4-118 s) | 62% fully out within 45 s. Profitable exits ~3 min (IQR ~2-4 min) carried ~78% of profit. |
| B (weighted) | ~+45 s (IQR ~20-95 s) | ~+2 min (IQR ~0.5-8 min) | Mean last sell ~6 min. Winners were sold in up to ~30 pieces per wallet. |
| C | +2.5 s (IQR −60 to +16 s) | +52 s (IQR −11 to +122 s) | Each group sell came a median 42 s after the latest public buy (IQR 14-103 s). |
| D | Before the public buy | Before the public buy | Launch groups were out within ~5-45 min of launch, hours before the public wallet. |

### 3.4 Hold time

| Case | Linked wallets | Public wallet |
| --- | --- | --- |
| A | 19 s (IQR 6-121 s) | 43 s (IQR 11-290 s), on ~60 tokens a day |
| B | ~2 min (weighted, same-block entry) | ~2 min (weighted, IQR ~0.5-8 min) |
| C | 89 s per wallet (IQR 34-143 s) | 134 s (IQR 62 s to ~20 min) |
| D | ~17-44 min (median per token) | Days to weeks, often adding on the way up |

### 3.5 Number of linked wallets

| Case | Claimed | What we measured |
| --- | --- | --- |
| A | ~5 | 5 candidates (two lockstep pairs plus one); a median 4 of them active per sampled token (IQR 3 to ~5) |
| B | 3 plus the public wallet | All 3 resolved |
| C | ~30 | 5 detected in our window, in one group |
| D | Dozens per token (a second firm: several hundred) | 52-101 launch-cluster wallets per token |

### 3.6 Funding-link structure (abstract)

- **Arm's length (A).** No value moves between the public wallet and the candidates.
  - The candidates' first funding came from busy, service-like addresses.
  - Their lifecycles are synchronized: two created minutes apart, emptied seconds apart, and a pair whose final transactions land in one block with the same third-party fee payer.
  - Address-poisoning "lookalike" dust arrived after the sweeps.
- **Tight loop (B).** One side wallet seeded the other two. The public wallet passed tokens to the side wallets, and the side wallets sent stablecoins back to the public wallet. Everything is linked at one hop, both ways.
- **Closed group (C).** An internal funding chain runs wallet to wallet, once through a day-old intermediary. Multi-signer transactions sweep tokens into one wallet. No link to the public wallet was found.
- **Layered launch (D).**
  - The deployers were created minutes before launch and funded by identical, same-second transfers at least two layers deep.
  - Sale proceeds went to collectors, or to paired older wallets.
  - Only a weak shared funder (a busy service address) touches the public wallet.

### 3.7 PnL per call (per token): linked vs public wallets

| Case | Linked wallets, per token | Public wallet, per token |
| --- | --- | --- |
| A | Median +0.55 SOL (IQR +0.27 to +0.81), about +$65 (IQR $32-96); n = 18 | Median about −$5 (IQR −$19 to +$27) over 124 tokens; 42% profitable |
| B | Median +1.2 SOL (IQR −0.25 to +10.8); profitable on 68% | Median −0.7 SOL (IQR −1.5 to −0.2); profitable on 12% |
| C | Median −0.6 SOL (IQR −1.6 to +0.9); profitable on 39% | Median +0.4 SOL (IQR −1.1 to +1.3); profitable on 67% |
| D | ~$5K to ~$103K per token (launch groups) | −$4K to −$27K realized per token |

In every case the linked wallets' profit is concentrated in a few tokens:

- A: exits on runners carried ~78% of the profit.
- B: a few winners of up to ~+30 SOL carried the total.
- C: one token is larger than the whole total.

### 3.8 What it adds up to

- Two shapes match the allegation's core picture:
  - **seconds ahead** (A): linked wallets buy ~2 s before the public wallet and are out within seconds unless the token runs;
  - **same block, front of the queue** (B): linked wallets land in the same block as the public wallet, ahead of it, and leave within minutes.
- One shape mostly does not:
  - **copy speed** (C): the detected group usually bought *right after* the public wallet in the same block, profited on fewer than half its tokens, and made most of its money on one late trade.
- One shape is a different mechanism:
  - **launch bundle** (D): launch groups were in and out hours before the public wallet, which then bought high and kept buying.
- **Timing alone never proves who controls a wallet.**

---

## 4. Authentic beats for the fictional script

Each beat is a pattern from our data, never a person. Use rounded numbers and keep the composite fictional. In the script, the timing is something an investigator alleges after the fact, never a recipe.

1. **The two-second head start.** In the tightest pattern, the linked wallets' buys land about 2 seconds before the caller's own public buy (median 2 s, IQR 2-3 s; about 9 blocks), and never in the same block. *(Case A, 67 pairs.)*
2. **Same block, better seat.** In another pattern, four wallets buy in one ~0.4-second block. The "other" wallets are usually a few places ahead in line (median 7 transactions), so the public wallet pays about 9% more per token than the first of them. *(Case B, 25 of 25 tokens same block; 23 of 25 side wallet ahead.)*
3. **The wave hits fast.** In the first 30 seconds after the public buy, ~57% of trades are buys. Half of the first five minutes' buys have arrived by ~55 s. About half of the next half hour's volume trades in the first minute, and ~90% in the first five. *(Calibration, 8 tokens.)*
4. **Pumps are short.** The median peak is ~2.2x the call price, reached within ~48 s for half the tokens. Quick flips top out inside 10 s at 1.1-1.6x (one fast spike reached ~2.2x in 10 s); runners peak at ~1.5-3 min. *(Calibration.)*
5. **Gone before the post is read.** In the seconds-ahead pattern, the linked wallets are fully out a median 15 s after the public buy, and 62% are out within 45 s. The money comes from the few tokens that run, held ~3 min, which made ~78% of the profit. *(Case A.)*
6. **A staircase, not a cliff.**
   - The biggest single 5-second red candle is a median −27%; the biggest 1-minute candle is −44%.
   - From peak to low, the price falls ~79%.
   - It closes below the call price a median ~2 minutes after the public buy (IQR ~20 s to ~7 min), and sits at ~0.55x after 30 minutes.
   - Trading has mostly stopped after ~10 minutes. *(Calibration.)*
7. **Lockstep twins.** Paired wallets buy and sell in the same block on 12 of 12 shared tokens. At the end, they are emptied 16 seconds apart and go silent. *(Case A.)*
8. **The public wallet loses, the others don't.** In the same-block pattern, the public wallet was profitable on 12% of tokens (median −0.7 SOL per token); the side wallets on 68% (median +1.2 SOL). In the launch-bundle pattern, the public wallet was down tens of thousands while the launch groups were up several times that. *(Cases B and D.)*
9. **Bots on the famous wallet.** A top caller's wallet draws 1,000 copy-bot transactions every 16 seconds to 4 minutes, and 98-100% of them fail. *(Case C.)*
10. **Not everyone fast is ahead.** One linked group mostly bought in the same block right *after* the famous wallet (46% of its buying), was profitable on only 7 of 18 tokens, and made most of its money on a single late trade. Speed alone is not front-running. *(Case C.)*
11. **Rewards arrive as a line in a mass payout.** The caller's USDC rewards came from one address that sends about 1,000 transfers in about 5 minutes, on most days of a six-week stretch. Never show the amount as an aspiration; pair it with the median-$13 reality in `research.md`. *(Case B; the payer is not confirmed as the platform.)*
12. **Launch day, then the late buyer.** Eighty wallets buy in one block 6 seconds after a token is created, and the launch groups have mostly sold within ~45 minutes (median holds ~17-44 min). The public wallet arrives a median ~17 hours later, keeps buying as the price climbs (up to 1.5-7.5x its first price), and exits 83-96% below its average entry. *(Case D.)*

---

## 5. Chart calibration

### The anonymized candle files

| File | Tokens | Candles | Notes |
| --- | --- | --- | --- |
| `case-A-candles.json` | 3 Pump.fun bonding-curve tokens: 2 quick flips and 1 runner | 5-second, every trade, SOL volume, ~360 per token | Launch inside the window (15-27 s before the public buy). Event markers for the public wallet and candidates. |
| `case-B-candles.json` | 3: a fast flip, a staged exit and a typical exit | 5-second, every trade | One curve is quoted in another token; its volume is SOL-equivalent. |
| `case-C-candles.json` | 3: sold-into, exited-before, same-block-after | 5-second, every trade | One token left the curve for its AMM seconds after the public buy, so its series is flat after that. One chart's event markers are incomplete (noted in the file). |
| `case-D-candles.json` | 3 late-entry launchpad tokens | 5-second; 2 from systematic 1-in-6 and 1-in-8 trade samples | USD volume; exact transaction counts per bucket. For the sampled tokens, true highs and lows can be wider. |

All 12 series pass OHLC validation (high ≥ max(open, close), low ≤ min(open, close), prices > 0). Prices are multiples of the public buy (1.0); times are seconds from it.

### Per chart (anonymized)

| Chart | Shape | Token age at public buy | Peak | Time to peak | Linked last sell | Drop within 5 min after it | Close at +30 min |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Quick flip | 16 s | 1.15x | 0 s | +3 s | −21% | 0.70x |
| A2 | Quick flip | 23 s | 1.08x | 10 s | +12 s | −31% | 0.73x |
| A3 | Runner | 27 s | 4.79x | 190 s | +196 s | −77% | 0.78x |
| B1 | Fast flip | 10 s | 1.58x | 5 s | +30 s | −15% | 0.53x |
| B2 | Staged exit | ~4.5 min | 2.92x | 100 s | +619 s | −42% | 0.42x |
| B3 | Typical exit | 73 s | 2.24x | 150 s | +424 s | −53% | 0.57x |
| C1 | Sold into | 71 s | 2.18x | 85 s | +115 s | −97% | 0.36x |
| C2 | Exited before | ~5 min | 1.70x* | n/a | before the buy | n/a | n/a* |
| C3 | Same block after | 54 s | 2.16x | 10 s | +107 s | −86% | 0.18x |
| D1 | Late entry | ~21 h | 1.49x | 465 s | (launch sets) | n/a | 1.25x |
| D2 | Late entry | ~4 days | 1.83x | 1,795 s | (launch sets) | n/a | 1.83x |
| D3 | Late entry | ~12 h | 1.59x | 1,765 s | (launch sets) | n/a | 1.43x |

\* C2 moved to its AMM pool seconds after the public buy, so its curve series stops there.

### Aggregates

Medians with interquartile ranges. Calibration n = 8 for the caller window (A to C, excluding C2), unless stated.

| Parameter | Caller window (A-C) | Late entry (D) |
| --- | --- | --- |
| Token age at the public buy | 54 s (IQR 23-73 s; n = 9) | ~21 h (IQR ~17-58 h; n = 3) |
| Run-up into the public buy (price vs 60 s earlier) | 1.34x (IQR 1.20-1.49; n = 9) | 1.04x |
| **Pump magnitude** (peak vs the call price) | **2.17x** (IQR 1.47-2.41) | 1.59x within 30 min (IQR 1.54-1.71) |
| **Time to peak** | **48 s** (IQR 9-112 s); bimodal | 29 min (the price kept rising) |
| Peak to low | −79% (IQR −88% to −60%) | −18% (IQR −21% to −9%) |
| **Drop within 5 min after the linked wallets' last sell** | **−47%** (IQR −79% to −28%) | ~−5% (launch sets sold hours earlier) |
| Time until price closes below the call price | 110 s (IQR 21-426 s) | Not within 30 min |
| Close at +30 min | 0.55x (IQR 0.41-0.71) | 1.43x (IQR 1.34-1.63) |
| Largest red candle: 5 s / 1 min / 5 min | −27% / −44% / −57% | −10% / −23% / −16% |
| **Volume spike**: largest 5-s bucket in the first 5 min vs the median active bucket | **26x** (IQR 23-49x) | 28x |
| **Volume spike**: first 5-min bar vs the mean of the next five | **26x** (IQR 15-495x; n = 6; 2 more had zero later volume) | 2.5x |
| Volume spike: call minute vs the minutes before it | ~1.3x (n = 4; the buy lands in an already busy launch) | 119x (IQR 63-180x); trades 45x |
| Share of 30-min volume in the first 60 s / 5 min | 49% / 92% | 15% / 34% |
| Buys as a share of trades in the first 30 s | 57% (IQR 52-63%) | 81% |
| Half of the first 5 minutes' buys arrived by | 55 s (IQR 12-99 s) | 15 s |
| 5-s buckets with any trade after minute 10 | 1.5% (IQR 0-5.5%): the token goes quiet | 44% |

### Using this with the generator (`docs/CHART_SPEC.md` section 8)

- **Use 1-minute candles for the call window** (`intervalSec: 60`). At 5 minutes the whole call is usually **one candle**: a long upper wick (high ~2.2x) that closes near or below the call price (first-bar close median 0.72x).
- **Suggested 1-minute story:**
  1. A launch bar or two (the call lands ~1 minute after launch, with the price already ~1.3x the minute before).
  2. A 1-3-bar pump to ~2.2x (IQR 1.5-2.4x).
  3. One −30% to −60% red bar when the linked wallets exit (median −44%).
  4. A flat, near-empty tail ending at ~0.55x by +30 min.
- **Differences from the generator's defaults:**
  - The default story has no long chop before the call.
  - The `rug` beat's −70% single candle is a worst case: only 2 of 8 tokens reached it even in one 5-minute bar.
  - Quick flips peak at only 1.1-1.6x.
  - The tail is much quieter than the default bleed.
  - The ≥5x pump-volume story check holds (about 7x or more in every measurable token).
- **Late entry (Case D)** is a different chart: the public wallet's buy lights up a quiet, older token (trades ~45x the previous minutes) and the price keeps rising for 30 minutes. The loss arrives days to weeks later.
- **Machine-readable parameters:** `audit-data/calibration.json` holds aggregates only (medians, IQRs, n), event-timing medians for chart markers, and the mapping above. It has no identifiers. The candle aggregates can be recomputed with `python3 scripts/onchain/candle_stats.py <candle files>`; the event timings are copied from sections 2-3. Charts drawn from it are illustrative and must be labelled as such (CHART_SPEC L4). Never mix them with real candles.

---

## 6. Can say / cannot say (for the script)

These lists follow the binding must-not-say list in `research.md` and add what this audit shows.

### Can say

Always attribute, round and keep it composite.

- "An on-chain investigator alleged that wallets linked to the caller bought seconds before his public buys and sold within minutes." Use a fictional investigator, not the real firm's brand or UI.
- "In one pattern, the linked wallets bought about two seconds before the caller's own buy." Or: "...landed in the same block, just ahead of him in line."
- "Followers' buys pile in within the first minute; most of the half hour's trading is over in five minutes."
- "The coin doubled, then fell below the call price within a couple of minutes, and went quiet." This is generic and illustrative, from the calibration.
- "The caller's public wallet can show a loss while linked wallets show a gain." Say it as an allegation pattern.
- "Copy-trading bots swarm famous wallets: thousands of follow attempts, nearly all of them failing."
- "Analytics firms estimated totals from the low hundreds of thousands to the low millions of dollars per caller." Banded and attributed: an allegation, never a fact or an income figure.
- "On-chain timing and clustering show wallets acting together. They don't show who controls them." This belongs in the script.
- "Callout Rewards are paid daily in USDC." From `research.md`, with care.
- Rounded generic numbers: about two seconds; within a minute; about double, then about half; dozens of wallets in one block.

### Cannot say

- **Identifiers.** No real person's name, handle or likeness, wallet address or prefix, token mint, real ticker, deployer prefix or X post link.
  - No figure that identifies a case: the figures on `research.md`'s must-not-say list, or this audit's per-case totals.
  - `research.md`'s red-flags card uses one case's exact figures, which its own must-not-say list bans. Reword it as "the public wallet showed a loss while linked wallets showed a gain several times larger".
- **"Bubblemaps proved / exposed / caught".** Say "alleged" or "estimated". No real Bubblemaps posts or UI.
- **"Our audit confirms he did it" or "the wallets belong to the caller".** Ownership and intent are not shown.
- **"Side wallets always buy ~20 seconds before the call".** We measured 0-3 s before the public buy, in two patterns only. Call times are not on-chain. In one case the group mostly bought *after* the caller; in another there was no front-run of a call at all.
- **"Pump.fun pays callers to dump on you"** (must-not-say), or **"the payout wallet is Pump.fun's"** (not confirmed).
- **"Followers lost $X to this caller"** (not measured), or **"rug pull"** for the audited tokens (not established; most just died out).
- **Any how-to.** No funding or splitting wallets, layered funding, buying at launch with many wallets, sniping, timing buys before posts, cash-out routes, or evading clustering tools. Describe only what investigators saw afterwards.
- **Our calibration charts or numbers as real token data.** Synthetic, labelled illustrative, invented tickers only.
- **Income figures as aspiration.** No reward amounts as "what you could earn"; pair them with the median-$13 reality and followers' losses (`research.md`).

---

## Anonymization check

| # | Searched for | How |
| --- | --- | --- |
| 1 | Base58 strings (32-44 characters) | `grep -rnoE '[1-9A-HJ-NP-Za-km-z]{32,44}'`, then each hit matched against every base58 string harvested from the private case files (~800,000 addresses, mints and signatures) |
| 2 | The same identifiers as substrings | Fixed-string search with that harvested list |
| 3 | Handles and names | Case-insensitive whole-word search |
| 4 | Tickers, published prefixes, post and user ids, EVM wallets, exact follower counts, short links | Whole-word search |
| 5 | Slot numbers and block times | 9-10-digit numbers matched against those in the private data |

- **Scope.** This file, `audit-data/` (including `calibration.json`), all of `content/` and `scripts/onchain/`.
- **Pattern lists.** They are built from the private data at run time and live in `data/private/bubblemaps-audit/_leakscan/`, so they never enter the repo.
- **Fixes made in this step.**
  - `research.md`: links whose address carried an audited caller's handle, the threads' X post links, the cases' real tickers and the deployer prefix were replaced by outlet and date. The full links are kept privately.
  - `_engine-demo/research.md`: the deployer prefix was removed.
  - `scripts/onchain/sol_usd.py`: an example timestamp that was a case's key block time was replaced.
  - `audit-data/*.json`: the allegations' exact figures and exact sample times were banded.
- **Result after the fixes.** No case wallet address, mint, signature, handle, name, ticker, prefix or post id remains in these paths. The only base58 strings left are public program ids, well-known mints, one public SOL-USDC pool and a base58 alphabet constant.
- **Git history.** Older commits of `research.md`, `sol_usd.py` and `audit-data/case-B-summary.json` still contain the removed items. Removing them needs a history rewrite, which is the owner's decision.
