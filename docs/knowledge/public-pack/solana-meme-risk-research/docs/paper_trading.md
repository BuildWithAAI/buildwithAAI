> **PUBLIC RESEARCH PACK NOTICE:** This document describes a **paper-trading / simulation** system only.
> Results are **backtests and paper trades**, not live trading. Not financial advice. No wallets, keys, or live funds are used.
> Personal names in decision notes were redacted to `owner` for this public-ready copy.

# Paper trading (simulation only)

One week of simulated trading (2026-11-03 .. 2026-11-10 America/Chicago) to test whether the risk scores make money
before any real money is used. **No wallets, keys, signing or orders exist anywhere in this code path.**

## Commands
```
.venv/bin/python -m risk paper cycle                 # idempotent; run every 15 min (finishes in ~4-5 min, hard budget 9 min)
.venv/bin/python -m risk paper report --summary      # short plain-English text
.venv/bin/python -m risk paper report --json         # full metrics
.venv/bin/python -m risk paper events --since-unreported              # JSON (each event also has a "text" line)
.venv/bin/python -m risk paper events --since-unreported --text       # plain text only
.venv/bin/python -m risk paper events --since-unreported --mark-reported   # print, then mark exactly those ids reported
.venv/bin/python -m risk paper watcher start --quiet   # idempotent: start the 1-min exit watcher if dead/hung (run each cycle)
.venv/bin/python -m risk paper watcher status [--check]  # JSON: running, pid, heartbeat age, API calls; --check: exit 1 unless healthy
.venv/bin/python -m risk paper watcher stop
.venv/bin/python -m risk paper watcher once            # one tick in the foreground (debug)
```
Cron example: `*/15 * * * * cd /workspace/solana-meme-risk && .venv/bin/python -m risk paper cycle --quiet >> data/paper-cycle.log 2>&1`
Concurrent cycles are prevented by a file lock (`data/paper.db-cycle.lock`); a second one exits immediately.

## What a cycle does
1. **Mark** every open position (DexScreener batch quote, GeckoTerminal fallback) and apply exits; retry unpriced entries;
   track every scored launch's 24 h price path (min/max return) for the SKIP hit rate.
2. **Discover** launches 6-15 min old from the on-chain pump.fun mint-authority stream (`TSLvdd...`, indexed in
   `data/launches.db` by the same `AnchorIndex` the backtest/watch use; RPC = publicnode, mainnet-beta failover).
   The pump.fun frontend API is Cloudflare-blocked (HTTP 403) and is **not called at all** (stubbed out in the paper
   context; token name/symbol come from DexScreener). Candidates are shuffled (random sample, no newest/oldest bias)
   and prefiltered with the backtest/watch eligibility rule: >= 15 successful mint txs in the first 5 minutes
   (`smr.backtest.sampler._check`). Up to 15 eligible launches per cycle.
3. **Score** each AS OF create + 300 s (the point-in-time setup the thresholds were fitted on), 3 in parallel.
   Scores still running at the budget deadline are recorded as `timeout` and never traded.
4. **Enter** right after each decision at the first DexScreener/GeckoTerminal price. If no price is available the entry
   stays `pending` and is retried each cycle; if still unpriced 30 min after the decision it is `unfilled` (no trade).

## Entry-time market gates (added 2026-11-03 after cycle 1)

The as-of score (create + 300 s) cannot see the market at entry, and `risk score` applies its market gates only in live
mode, so cycle 1 bought drained curves with $36-$900 of liquidity and 0-3 holders. Now, when an entry is priced, the live
scorer's own `market_gates` (smr/risk_score.py) is applied to the CURRENT quote, and the paper decision is the stricter
of the as-of decision and the gates (smr/paper/gates.py):

| gate | rule | effect |
|---|---|---|
| liquidity | < `min_liq_usd_any` ($2,000) | SKIP |
| liquidity | < `min_liq_usd_normal` ($10,000) | at most REDUCED |
| holders | < `min_holders_normal` (75) | at most REDUCED |
| holders unknown | (paper only, conservative) | at most REDUCED |
| FDV | < $1,000 (paper only: curve drained below its launch price) | SKIP |

* Liquidity = best of DexScreener pair liquidity and GeckoTerminal `total_reserve_in_usd` (pump.fun curve pairs have
  no DexScreener liquidity). Unknown liquidity, or DexScreener and GeckoTerminal prices more than 25% apart, keeps the
  entry pending (retried each cycle, `unfilled` after 30 min); no price is invented.
* Holders: the live path needs `getProgramAccounts`, which free publicnode refuses ("Indexed requests require a
  personal token"). It is tried only with `HELIUS_API_KEY`/`SOLANA_RPC_URLS`; otherwise the point-in-time count
  reconstructed at create + 300 s is used and labelled `holder_source=as_of_reconstruction`.
* Recorded per launch: `asof_decision`, `gate_cap`, `gate_reasons`, `gate_liq`, `gate_holders`, `holder_source`,
  final `decision`; BUY events carry `asof_decision`, `gate_reasons` and say "downgraded from X by entry gates".
  The buy-everything and shadow books still buy every launch, tagged with the final decision (tier stats use it).

### Market-cap floor (strategy and momentum books; owner 2026-11-03)

The strategy book buys only when the market cap (price x circulating supply, see below) is at least `--min-mcap-usd` (default $30,000; env
`SMR_PAPER_MIN_MCAP_USD`) at entry. A non-SKIP launch under the floor is logged `strategy_status='filtered_mcap'`
with its score and gates, and the buy-everything and shadow books still buy it at the first price, so the filter
stays measurable. Every cycle re-checks `filtered_mcap` launches until 24 h after launch: when one's FDV crosses the
floor, the live gates are re-applied to that quote (fresh liquidity, holders, price cross-check) and, unless they say
SKIP, the strategy book enters at that price with the re-gated decision (`entered_on_cross`; the BUY event carries
`entry_trigger='mcap_cross'`, `mcap_at_cross_usd`, `first_priced_mcap_usd`, `minutes_after_launch`). A crossing that
the gates SKIP stays `filtered_mcap` and is re-checked; after 24 h it becomes `expired_mcap`. Other statuses:
`entered` (at or above the floor at first price) and `skip`. Re-checks need a cycle to run, so a crossing is seen at
15-minute resolution and a brief spike between cycles is missed.

### Market-cap units (verified on-chain 2026-11-03)

DexScreener `priceUsd` equals the on-chain curve price (virtual SOL / virtual tokens x SOL/USD); `priceNative` is SOL
per token. DexScreener `marketCap`/`fdv` for pump.fun tokens are `priceUsd x 1B`. Mayhem-mode launches mint 2B tokens,
but only 1B goes into the bonding curve (same start price and start market cap as a normal coin, per pump.fun's docs);
the other 1B goes to pump.fun's Mayhem agent (`BwWK17...`), which trades for up to 24 h and then burns whatever it did
not sell. GeckoTerminal `fdv_usd` counts that billion; DexScreener, pump.fun and StalkChain do not.
Corrected 2026-11-03: paper `entry_mcap`/`exit_mcap` = price x circulating supply, where circulating = on-chain supply
minus the agent's balance (`getTokenAccountsByOwner`, an indexed call publicnode refuses, so mainnet-beta/Helius serve it;
`launches.circ_supply`, agent balance in `entry_note.mayhem_agent_balance`). If the balance is unreadable, a pre-burn
Mayhem coin (supply >= 1.5B) uses 1B. The earlier "price x on-chain supply" doubled Mayhem caps: on 2026-11-03 Soljack
($72.5k recorded, $35.6k real) and spon ($52.4k recorded, $25.5k real, under the $30k floor) were entered on that basis.
Ledger rows before the fix keep their recorded values. A fresh curve is worth about 30 SOL x SOL/USD (~$2.8k at $93/SOL)
for both kinds. Cycle 1's sub-$1k
caps were real: those curves had been sold down to 0.5-12 virtual SOL (below the initial 30) within minutes.

### Mayhem-mode gate (strategy and momentum books; owner 2026-11-03 12:27 CST)

Rule: "Stay out of Mayhem mode trades." The strategy and momentum books never enter a pump.fun Mayhem-mode coin, and
treat an unknown status as Mayhem (no entry; the count of unknowns is logged). The `all` and `shadow` benchmark books
are unchanged and still buy every scored launch; their rows only carry the flag (`positions.mayhem`) so the gate stays
measurable. Positions opened before the gate (Soljack, strategy, entered 09:26 CST) are neither closed nor voided:
they run to their normal exits.

Detection (`smr/mayhem.py`, free RPC only, never raises). Any one source saying Mayhem wins:
1. `curve_flag`: the pump.fun BondingCurve account's `is_mayhem_mode` byte (offset 81 after the 8-byte discriminator,
   5 x u64, `complete`, `creator`). The curve address is the owner of the largest balance of the mint in the create
   tx (other holders are tried when the curve's tokens are split). An 81-byte legacy curve means not Mayhem.
   `getAccountInfo` on publicnode, cached 1 day (the flag is set at create and never changes).
2. `create_tx`: Mayhem's agent (`BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s`) holds a balance of the mint after
   create, or the logs show `InitializeMayhemState` / the Mayhem program `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e`.
   Complete (untruncated) `Create`/`CreateV2` logs without those mean not Mayhem.
3. `supply`: on-chain supply > 1.001B (only Mayhem mints a second billion; burns only lower supply).
4. `agent`: the agent's current balance of the mint > 0.
Not Mayhem needs an explicit `False` from the curve or the create tx; otherwise the status is unknown.
On 2026-11-03's 311 paper launches the curve flag and the create tx agreed on all 263 they both read (149 Mayhem /
114 not); 46 more were read from the curve only; supply > 1B occurred only on Mayhem coins; 2 stayed unknown
(a CreatePool launch that is not a pump.fun curve, and a split-curve create fixed by trying other holders).

Ledger: `launches.mayhem` (1 / 0 / NULL = unknown), `mayhem_source` (e.g. `curve_flag+create_tx+supply`),
`mayhem_checked_at`; `positions.mayhem`. A stored 1 is final; a stored 0 is re-opened only if supply or the agent
balance later shows Mayhem. Each cycle resolves up to 60 unchecked launches (`backfill_mayhem`) before snapshotting.
Statuses: a non-SKIP Mayhem launch gets `strategy_status='skip_mayhem'` (at first price, or dropped from the
"waiting for $30k" list) and `momentum_status='skip_mayhem'` (vetoed at first price or dropped from the watch list).
Unknown launches keep waiting/watching but cannot enter until the status resolves to 0. The decision tier is not
changed (tier stats stay clean); `gate_reasons` gains `mayhem_mode: ...` or `mayhem_mode unknown: ...`. Cycle output
has `mayhem` stats (checked / mayhem / not_mayhem / unknown / sources / blocked / blocked_unknown / waiting_dropped /
watching_dropped / backfilled); `paper report` has a `mayhem` section and a "Mayhem gate" summary line.
Tools: `tools/backfill_mayhem.py` (flags every launch, applies the drops; holds the cycle lock), `tools/measure_mayhem.py`
(read-only counts for paper.db and the backtest DB).

Measured 2026-11-03 (before the gate went live):
- Share Mayhem: paper.db 149 / 309 classified launches (48%); non-SKIP priced pool 34 / 68 (50%); "waiting for $30k"
  32 / 65; momentum watch list 10 / 18. Backtest candidates 659 / 1,789 classified (37%; 146 unknown), the
  eligible set 531 / 945 (56%). The README's "~93% of launches are Mayhem" is not true of current launches.
- Outcomes (backtest labels, 24 h): bad (loss50 or dead) Mayhem 9 / 247 (3.6%) vs non-Mayhem 28 / 205 (13.7%);
  graduated 4 / 247 vs 5 / 205. Paper: resolved dump50 Mayhem 1 / 1, non-Mayhem 10 / 10; shadow closed Mayhem 1
  (-76%), non-Mayhem 11 (mean +7.6%); `all` closed Mayhem 0, non-Mayhem 6 (mean +32%). The data do NOT show Mayhem
  coins as riskier; the gate is the owner's preference, not a measured edge.
- Past entries: of 17 strategy/momentum position rows (incl. voided) 14 were Mayhem; the only live one (Soljack) is
  Mayhem, so the gate would have blocked 1 / 1 live entries. Of the 3 non-SKIP launches ever >= $30k, 2 were Mayhem
  (Soljack, spon) and the third (GTA 6 Coin) was vetoed by StalkChain: expect very few entries.

### Voiding

`python -m risk paper void --cycle N --reason R` sets `void_reason` on that cycle's launches, positions, misses and
events (rows kept for audit), marks unreported events reported so they are never sent, and voids earlier equity
snapshots. Voided rows are excluded from bankrolls, PnL, drawdown, tier stats and counts; `paper report` lists them
under `voided`. Cycle 1 (2026-11-03 07:09-07:12 CST) was voided with `pre_gate_bug`, restarting every book at $1,000;
cycle 2 (07:37, interrupted mid-run, entered before the market-cap floor existed) was voided with `interrupted_pre_mcap_gate`.

## Edge features (strategy and momentum books only; added 2026-11-03)
These features only change the **strategy** and **momentum** books. The `shadow` and `all` benchmarks are unchanged:
they still buy at the first price on the plain risk decision.
Config is in `data/paper_edge.json`, with one `enabled` flag per section. In code every default is OFF, so a missing
file or section means the feature is off. `SMR_PAPER_EDGE_CONFIG=<path>` points at a different file;
`SMR_PAPER_EDGE_CONFIG=off` turns all of them off (the test suite does this, and edge tests pass their config directly).
The existing hard rules stay as they are: buy only above a $30k market cap, hard-skip Mayhem coins, and the StalkChain veto.

| Section | Default in data/paper_edge.json | What it does |
|---|---|---|
| `bundle_gate` | on, `max_same_slot_supply_pct` 20 (wallet/cluster limits null = unused) | Hard skip if the wallets that bought in the create slot hold >= 20% of supply as of create+300 s. Status `skip_bundle`. Unknown bundle data does not block (counted as `bundle_unknown`). |
| `smart_money` | on, +5 per net-buying tracked trader (max +15), strategy lift on (>= 2 net buyers), feed fresh <= 5400 s | List = StalkChain FOMO leaderboard wallets (`data/smart_wallets.json`). Signal = `multi_trader_entries` buy feed (`data/smart_money_cache.json`) plus early-buyer overlap. Momentum: score + boost. Strategy: REDUCED -> NORMAL only when gates allow NORMAL, >= 2 net buyers, and no SKIP/Mayhem/bundle. |
| `x_heat` | on, fresh <= 1800 s, +/-15 points max | Posts per hour now vs the prior hours (counts endpoint) and author/engagement counts from a 25-post sample, per theme or ticker. Changes only the momentum narrative score (clamped 0-100). For strategy it is information only, shown in the alert. Stale or missing data counts as neutral (0 points). |
| `pullback` | on, books strategy+momentum, 20-35% dip, floor 0.75x qualify price, expiry 7200 s, poll >= 300 s, <= 10 entry quotes per cycle | Instead of buying at qualification, the coin goes on a watchlist (`watchlist` table, status `watch_pullback`). The high is tracked after qualification. Entry happens when the price is 20-35% under that high, still >= 0.75x the qualify price, and the market cap is still > $30k. Everything is re-gated at entry (SKIP -> `skip`, Mayhem -> `skip_mayhem`, bundle -> `skip_bundle`). Entered -> `entered_pullback`; no dip inside 2 h -> `pullback_expired`; no cash -> `missed` (counted in `missed_no_cash`). |
| `holders_live` | on, books strategy+momentum, `min_mcap_usd` 30000, cache fresh <= 1800 s, <= 3 lookups per cycle, veto reserve 3, vetoes: dev mints >= 10, organic score 0 or 0% organic volume (1h/6h/24h), top holders > 60%, mint/freeze authority enabled (added 2026-11-03 s121) | For a coin at/above $30k whose holder count is unknown, a fresh StalkChain `stalkchain_token_quality` read (`data/holder_cache.json`) replaces the "holder count unknown (conservative)" REDUCED cap: the normal holder threshold (75) is applied to the live count, and the reason reads "holders: N live (StalkChain)" (BUY alerts: "holders N (live, StalkChain)"). A veto condition in the same read is a hard SKIP (status `skip`). No fresh read: the old conservative behaviour. Applied at first price, on the $30k cross, at pullback entry and on momentum re-checks. The launch row keeps the benchmark decision; the strategy view is in `strategy_decision` and `launches.holders_live` (JSON). Never lifts an as-of SKIP; Mayhem, bundle and the BUY-time StalkChain veto still apply. |

Caveat for pullbacks: the high is only sampled at polls. Each cycle polls about twice, ~7 min apart, so spikes
between polls are missed and the measured depth is a lower bound. A coin that never dips is a missed trade, by design.

BUY alerts and `paper report` (section `edge`) show the smart-money count (net buyers, lifted yes/no), X heat (term,
posts/h, acceleration, authors, engagement, points, or the reason it was neutral), bundle % ("bundle unknown" when
missing) and pullback depth. `positions.edge` stores the same facts as JSON.

**Untrusted data.** X post text, token names, symbols and leaderboard handles are hostile input. They pass through
agent-guard (`require_clean`/`safe_field`); X handles are kept only if they match `^[A-Za-z0-9_]{1,15}$` exactly,
otherwise they are dropped. Only numeric counts and sanitized handles are stored, and post text never reaches a decision.

### Feeding data (the routine does the MCP calls, the CLI only reads files)
```
.venv/bin/python -m risk paper smartmoney plan                      # JSON: which StalkChain calls are due, with exact args and budgets
.venv/bin/python -m risk paper smartmoney ingest --leaderboard FILE [FILE ...]   # stalkchain_fomo_leaderboard results
.venv/bin/python -m risk paper smartmoney ingest --feed FILE         # stalkchain_fomo_multi_trader_entries result
.venv/bin/python -m risk paper holders plan                         # JSON: $30k+ unknown-holder candidates needing a stalkchain_token_quality read
.venv/bin/python -m risk paper holders ingest --file FILE [FILE ...]  # saved stalkchain_token_quality results -> data/holder_cache.json
.venv/bin/python -m risk paper xheat plan                            # JSON: terms due (themes/tickers of live candidates) + queries
.venv/bin/python -m risk paper xheat ingest --term T --kind theme|ticker --counts FILE [--search FILE]
```
Budgets: StalkChain is <= ~30 lookups/day in total. The veto lookups count toward this, and `data/stalkchain_usage.jsonl`
plus the veto log are both counted. The feed is fetched at most every 50 min and at most 12 times/day, and only while
there are live candidates. The leaderboard is fetched once a day. X: <= 6 terms per plan, each refreshed every
>= 25 min, <= 600 calls/day (`data/x_usage.jsonl`). The shared X quota resets at 00:00 UTC.
Live holders: `holders plan` lists at most 3 mints per cycle (pullback-watchlist coins first, then by market cap) and
keeps 3 calls of the shared StalkChain budget in reserve for the BUY-time veto. Each call is one
`stalkchain_token_quality {"token": MINT}` call; `holders ingest` logs one usage row per file. Only numbers, booleans and
base58 strings are kept from the result; the symbol only through `require_clean` + `safe_field`; notes, tags and the
organic label text are checked and dropped (the label is kept only if it is exactly low/medium/high).
Runtime files (gitignored): `data/holder_cache.json`, `data/smart_wallets.json`, `data/smart_money_cache.json`, `data/stalkchain_usage.jsonl`,
`data/x_heat.json`, `data/x_usage.jsonl`.

### Bundle gate evidence (704 labelled launches, bad = 24 h dump)
Same-slot supply >= 20%: bad 14/52 = 26.9% (95% Wilson CI 16.8-40.3) vs 45/652 = 6.9% (5.2-9.1) below it. 50 of the 52
were already SKIP, so in practice the gate catches the few non-SKIP heavy bundles (for example the voided GTA 6 Coin,
109%). Other cutoffs: >= 10%: 18.6% (13.3-25.4); >= 15%: 23.0% (15.4-32.9); >= 50%: 4/6. Wallet-count and cluster
cutoffs had too few rows (n = 6-9) to use.

## Books
| book | sizing | cash limit |
|---|---|---|
| strategy | NORMAL 2%, REDUCED 1%, SKIP 0% of realized bankroll; never Mayhem/unknown | yes ($1,000 start, no leverage) |
| all (counterfactual) | every scored launch 1% | yes |
| shadow | every scored launch, fixed $10 | no (per-tier evidence) |
| momentum | non-SKIP, non-Mayhem picks ranked by momentum + narrative, 1-2% (REDUCED capped at 1%), clip5 exits (moon bag before 2026-11-03 22:xx CST) | yes ($1,000 start, own bankroll) |
| momentum_ladder | shadow control: every momentum entry mirrored at the same $ size, ladder E exit, no alerts | no (own notional $1,000) |
| momentum_x1 | shadow control: every momentum entry mirrored at the same $ size, x1 exit, no alerts | no (own notional $1,000) |
| momentum_clip5_rug_dust | silent control (2026-11-04): mirrored entry; clip5 rungs + 1-min rug rule + permanent 5% dust; marked by the 1-min exit watcher; no alerts | no (own notional $1,000) |
| momentum_sighv | silent control (2026-11-04): mirrored entry; SIG-HV signal exit + 5% dust; marked by the 1-min exit watcher; no alerts | no (own notional $1,000) |

Bankroll for sizing = $1,000 + realized PnL. If a book has no free cash the trade is logged in `misses` (`no_cash`).

## Costs (per side, see smr/paper/costs.py)
- fee 1.0% (pump.fun curve ~1%, PumpSwap/Raydium less, plus priority/Jito tips; flat for all venues)
- base slippage 0.5% (latency / MEV)
- price impact v/(R+v) with R = liquidity/2 (constant product); unknown liquidity -> 5%
- round trip floored at 2% (effectively >= 3% with these defaults)
Liquidity: DexScreener `liquidity.usd`, else GeckoTerminal `total_reserve_in_usd` (pump.fun curve pairs have no
DexScreener liquidity).

## Exits (evaluated each cycle on the market price vs entry price)
- take profit at +100%: filled at the +100% target (a resting limit would not capture overshoot)
- stop at -50%: filled at the **observed** price (gap risk with 15-min polling, conservative)
- time exit at 24 h at the observed price; if no price at 24 h the position stays open and is retried
- dead token: no valid price for 24 h -> closed at -100% (proceeds 0)
Prices are never invented: failed lookups leave rows pending.

## SKIP hit rate
A launch "dumped" if its market price fell >= 50% below entry within 24 h (or it had no price for 24 h). Reported for
SKIP vs non-SKIP.

## Events
Every strategy-book and momentum-book BUY/PARTIAL_SELL/SELL writes an event row in the same transaction as the position change. `paper events`
lists unreported events; `--mark-reported` marks only the ids it printed, so events created meanwhile are not lost
and nothing is reported twice. Token names/symbols are untrusted and pass through agent-guard `safe_field`
(fallback sanitizer if agent-guard is missing).
`paper events` defaults to `--book strategy,momentum`; `--book strategy` gives the old strategy-only output.
Momentum events carry `theme` (sanitized keyword), `mom_score`, `narr_score`, `mom_combined`, `mom_detail`
(signals/components), and for PARTIAL_SELL / SELL: `partial_frac`, `partial_proceeds_usd`, `profit_locked_usd`,
`moon_bag` (riding / closed: reason). `--text` lines start with `[PAPER momentum]`.
clip5 rows: one PARTIAL_SELL per clip (events `seq` = clip number; see "Momentum exits" below for the fields).
The control books never write events.

## Limitations
- 15-min polling: intra-interval highs/lows are not seen (stops can gap; a TP touched and reversed is missed).
- Entry happens minutes after the as-of time (score latency), so the price moved since the model's view.
- Liquidity for curve tokens is real reserves only (pump.fun's virtual reserves make true impact somewhat smaller).
- In as-of mode the scorer does not apply live liquidity gates, so some NORMAL trades are in very thin pools.
- One week is a small sample; with no proven edge (held-out AUC 0.47 for the old version) expect noise.

## Momentum book (added 2026-11-03; unproven A/B)
Goal (owner): ride the current narrative/meta and momentum, take the stake out at 2x, leave a moon bag.
**No edge is claimed.** It is an A/B against the strategy book until paper results come in. The strategy book's
rules are unchanged (a test asserts identical strategy rows with momentum on/off).

Selection, all hard vetoes first: model decision SKIP -> never; entry-time safety gates (smr/paper/gates.py) and
the $30k real circulating market-cap floor apply exactly as for the strategy book. Non-SKIP launches below the
floor are kept `watching` for up to 6 h and re-checked each cycle; then `expired`.

Momentum signals (smr/momentum.py), all from the entry quote batch (DexScreener /tokens/v1 up to 30 mints per call,
GeckoTerminal tokens/multi with `include=top_pools` on the call already made; no extra per-coin calls):
- volume acceleration: 5m volume x12 vs 1h volume (ramp 0.5x -> 2x)
- buy pressure: buys/(buys+sells) over 5m+1h txns (ramp 0.45 -> 0.70)
- price trend: 5m and 1h price change (full at +20% / +100%)
- turnover: 1h volume / market cap (full at 1.0)
- unique buyers: GeckoTerminal top pool 5m unique buyers (full at 150)
- peak state: new_high / near_high / pullback / fading from price-change buckets plus our own observed max return
Score 0-100 with weights .20/.20/.20/.15/.10/.15, renormalized over available components; needs >= 50% coverage.

Narrative (smr/narrative.py), built at most once per cycle outside the DB transaction: DexScreener top boosts,
latest boosts, latest profiles (3 calls, cached 10 min) + /tokens/v1 lookups (<= 120 mints, batches of 30) +
data/backtest/work/graduations.jsonl + our own scored launches, last 6 h. Themes = plain keyword matching on
safe_field-sanitized names/symbols (lowercase, ascii, stopwords; a theme must appear in at least one coin's name or
symbol and in >= 2 coins). Runner = +100% over 6 h or >= $100k 1h volume. Heat = runners + 0.5 x attention-only
coins. A theme is fading if its runners' median 1h change < -30% or 1h volume < half their 6h hourly average.
A coin's narrative score excludes its own run; x0.4 in a fading theme; x0.25 overall for a late copycat (theme's first
runner > 3 h before it). No LLM, nothing in metadata is executed or followed.

Combined = 0.7 x momentum + 0.3 x narrative - 0.5 x (risk score - 20, if > 0). Enter only if momentum >= 50 and
combined >= 55; best first, max 4 new per cycle, max 12 open. Size of realized bankroll: >= 75 -> 2%, >= 65 -> 1.5%,
>= 55 -> 1%; REDUCED capped at 1%.

Exits (moon bag; legacy: positions opened before clip5 went live keep it, see "Momentum exits" below):
- before 2x: stop at -50% (observed price); time exit at 24 h if 2x never hit
- at +100%: sell a fraction (clamped 50-60%) so proceeds after fees/slippage/impact >= the stake (fixed-point, rounded
  up); event PARTIAL_SELL with amount sold and profit locked
- the rest rides: trailing stop 40% below its peak (peak starts at the 2x level), or 48 h max hold since entry
Book value counts the partial: open cost = size x (1 - partial fraction), partial PnL realized into the bankroll.

Config: defaults in `MomentumConfig`; override any field via JSON at `$SMR_MOMENTUM_CONFIG` or `data/momentum.json`.
`SMR_PAPER_MOMENTUM=0` or `paper cycle --no-momentum` disables the book. Launch column `momentum_status`:
skip / watching / entered / expired / voided. `paper report` has a `momentum` section (themes traded, partials,
profit locked, moon bags riding, hot themes last cycle) and `momentum_vs_strategy`; `--summary` adds two lines.

Momentum limitations:
- True intraday highs need per-coin GeckoTerminal OHLCV calls (rate-limited 429s), so "pullback vs new high" uses
  DexScreener price-change buckets + our 15-min observed max only.
- DexScreener boost/profile lists give mints and descriptions, no names; names come from extra /tokens/v1 lookups.
- GeckoTerminal 429s often drop unique buyers; the score then renormalizes without it.
- pump.fun API is Cloudflare-blocked and is not used; graduations.jsonl is small (5-16 rows on 2026-11-03).
- Keyword themes are crude (e.g. "america" + "americacoin" both appear); trailing stops see 15-min polling only.

## Momentum exits: clip5 + shadow controls (owner 2026-11-03)
Code: smr/paper/exits.py (pure rules), `Cycle._policy_step` / `_clip` in smr/paper/engine.py. Switch:
`momentum_exit` in data/paper_edge.json (`enabled`, `policy`, `controls`, `grad_window_s`); code default is off
(= moon bag). A position keeps the exit it was opened with (`positions.exit_policy`; NULL = legacy moon bag).
Exit change only: scoring version and entry rules are unchanged.

| policy | book | rungs (share of the ORIGINAL position) | stop before 1st clip | stop after 1st clip | max hold |
|---|---|---|---|---|---|
| clip5 | momentum (alerted) | 20% each at 2x, 3x, 4x, 6x, 10x | -50% of entry | max(entry, 0.60 x highest mark since entry) | 48 h, rest at the mark |
| ladder (E) | momentum_ladder (control) | 50% at 2x, 25% at 4x, last 25% rides | -50% | max(entry, 0.80 x peak) if it graduated at launch (20% trail), else max(entry, 0.60 x peak) (40% trail) | 48 h |
| x1 | momentum_x1 (control) | 50% at 2x, 50% at 3x | -50% | breakeven (entry) | 48 h |

No 24 h "no 2x yet" time exit for these policies (the moon bag had one); only the 48 h max hold. When every rung has
filled (clip5 at 10x, x1 at 3x) the position closes with `<policy>_all_clips_filled`.

**Fills, and the 15-min marks.** Positions are marked about every 15 minutes (one cycle). Highs and lows between marks
are not seen, so:
- A rung fills when a mark is at or above it. The fill is min(mark, rung), which is the rung price: a resting limit
  order, with no credit for the overshoot. If one mark has passed several rungs (e.g. 4.5x), each of them fills at
  its own rung price in the same cycle. This is conservative when price ran through; it is optimistic if a rung was
  touched only inside the interval (we miss those clips completely).
- A stop fills at the **mark** when a mark is at or below the stop level (gap-through). The stop level used is the
  one in force before this mark's clips.
- Max hold sells the rest at the mark. Each mark checks in order: stop, max hold, then rungs.
- Every fill records the trigger price (rung or stop level) and the mark price used: `clip_log` JSON per clip
  (`trigger_price_usd`, `mark_price_usd`, `fill_price_usd`, `mark_vs_trigger_pct`, share, proceeds, cost), and
  `exit_trigger_price` vs `exit_price` (the mark) on the closing sale. `paper report` -> `momentum_exits` gives the
  mean clip overshoot and the mean and worst stop gap (mark vs trigger) per book.

**Accounting.** The cumulative columns are `partial_frac` (share of the original sold), `partial_tokens`,
`partial_proceeds_usd` and `partial_pnl_usd` (proceeds minus size x share sold). They plug into the same bankroll maths
as the moon bag: open cost = size x (1 - partial_frac), and partial PnL is realized. `clips_done` counts the clips,
`stop_price` is the current stop level, and `tokens` is what remains.

**Alert fields (momentum book only).** Each clip writes a PARTIAL_SELL event with:
- clip details: `clip_label` ("clip 2/5"), `clip_no`, `clip_multiple`, `clip_trigger_price_usd`,
  `clip_mark_price_usd`, `clip_fill_price_usd`, `clip_share_sold_pct`, `clip_proceeds_usd`;
- running totals: `sold_pct_of_original`, `remaining_pct_of_original`, `cash_recovered_usd`, and `profit_locked_usd`
  (realized PnL on the share sold so far);
- the stop: `stop_level_usd`, `stop_vs_entry_pct`, `stop_rule`;
- what's next: `next_rung`, `clip_fills` (every clip so far).

`--text` lines read like:
`PARTIAL SELL clip 2/5 at 3x: sold 20% of the original position at $X (target, mark) ... | profit locked $Y on 40% sold | remaining 60% | stop now $Z (+80% vs entry; max(entry, 60% x highest mark since entry)) | next clip at 4x $W`.
The closing SELL adds `clips_done`/`clips_total`, `exit_trigger_price_usd` and `exit_mark_price_usd`. The BUY event
includes the policy rule and the starting stop.

**Controls.** Separate books in `positions` rather than virtual tracks. Every momentum entry (first price, recheck
or pullback; all of them go through `_momentum_enter`) is copied into `momentum_ladder` and `momentum_x1` in the
same transaction. The copy has the same size_usd, tokens, entry price and entry cost, and `mirror_of` = the
momentum position id. The controls are never cash-limited, so they always mirror the entry, and they have their own
notional $1,000 bankroll for return %. They write no events (no alerts) and never touch the momentum bankroll. They
are marked with the same quotes in the same cycle. If the momentum book misses a trade, the controls don't enter it
either. Voiding a momentum position also voids its mirrors. Report: `momentum_exits` (side by side: equity,
return, closed/open, win rate, exit reasons, clips by multiple, slippage), plus a "Momentum exits side by side" line
in `--summary`.

**"Graduated within the minute it launched" (ladder trail).** No reliable on-chain flag is stored, so a proxy is
computed at entry and saved as `grad_at_launch` / `grad_source`:
1. If the entry quote is on a PumpSwap pair, compare its DexScreener `pairCreatedAt` with our on-chain create time.
   A gap of <= 60 s (`grad_window_s`) means 1, otherwise 0.
2. Otherwise, check data/backtest/work/graduations.jsonl. A `pool_created_at` <= 60 s after create means 1, a later
   one means 0.
3. If the quote is still on the pump.fun curve at entry, the value is 0.
4. If none of these apply, the value is NULL (unknown), and the ladder uses the 40% trail.

Caveat: a coin that graduates after entry is still treated as "not at launch", which is correct for the rule as
given.

**Schema.** New `positions` columns: `exit_policy`, `clips_done`, `clip_log`, `stop_price`,
`exit_trigger_price`, `grad_at_launch`, `grad_source`, `mirror_of`. `events` gets `seq` and
UNIQUE(position_id, kind, seq) instead of UNIQUE(position_id, kind), so one position can have up to five
PARTIAL_SELLs. The table is rebuilt once by `Ledger._migrate_events_seq`; ids and rows are kept, and it is a no-op
afterwards. Old rows get seq 0.

**Open positions at switch-over (2026-11-03 ~22:10 CST).** No momentum position was open: the only momentum row
(GTA6) was voided (stalkchain_veto:organic_zero). Nothing needed migrating. Any older momentum rows keep
`exit_policy` NULL and the moon-bag rules.

## Signal control books + 1-minute exit watcher (owner 2026-11-04; paper only)
Code: smr/paper/sigexit.py (pure rules/features), smr/paper/sigbooks.py (ledger steps), smr/paper/watcher.py
(process), `Cycle._signal_step` in engine.py. Enabled by listing `clip5_rug_dust` and `sighv` in
`momentum_exit.controls` (data/paper_edge.json). The live momentum book (clip5), the strategy book, the $30k floor,
sizing, gates and the scoring version are unchanged.

| book | rule |
|---|---|
| momentum_clip5_rug_dust | live clip5 rungs (20% of the original at 2x/3x/4x/6x/10x, filled at the rung) and clip5 stops, on the 95% that is not dust; **rug rule**: a 1-min mark <= 0.65 x the previous mark (previous mark <= 20 min old) -> sell everything but the dust at the NEXT mark |
| momentum_sighv | SIG-HV (backtest 2026-11-04): -50% stop before the first sale, then floor max(entry, 0.60 x peak); 48 h max hold; rug rule (and big-sell candle with >= 35% drawdown) -> sell all but dust; nothing else below 2x; at >= 2x: vol-step 20% of the rest each time price is >= (1 + clamp(3 x ATR, 25%, 100%)) x the last step price; pressure tiers (score 2/3/4 -> 12.5/25/50% of the rest, each tier once until a new high); heat 15% on a new high >= 1.4 x the 15-min mean |

Both keep a **permanent 5% dust bag** (`dust_tokens`, never sold). Realized PnL counts the dust at zero; after the
close the row keeps `tokens = dust_tokens` and the watcher re-marks `dust_last_price` about every 15 min when a
DexScreener batch has room. The report shows equity with the dust at its last price and at zero.

**Fills.** Signal sales (rug rule, vol-step, pressure, heat) are decided at a mark and filled at the next mark at
least 30 s later (`pending_sell`); every fill logs `intended_price_usd` (deciding mark), `actual_fill_price_usd`,
`delay_s`, `fill_vs_intended_pct`, `decided_by`/`filled_by` in `clip_log`. Stops and max hold fill at the crossing
mark (gap-through). Rug-dust rungs fill at the rung price like live clip5.

**Features** (sigexit.features): from 1-min marks (table `marks`, 7-day retention) plus GeckoTerminal 1-min candles
when fresh (<= 180 s). red5 = red-candle volume share over 5 bars, else DexScreener m5 sells/(buys+sells) with >= 10
txns; wick/big-sell need candles; ATR from candle ranges, else mark-to-mark moves.

**Watcher process.** `risk paper watcher run` (started by `start` via nohup, own session): every 60 s it lists open
rows of momentum + its 4 controls, quotes their mints with one DexScreener batch call (<= 30 mints; > 30 -> 2 calls;
> 60 -> round-robin), optionally fetches GeckoTerminal 1-min OHLCV for open SIG-HV positions (default 4/min, max 25,
paused while a paper cycle runs and for 5 min after a 429; never more than 20 s per tick), then in ONE short
transaction renews its lease, stores marks (with m5 buys/sells/volume), steps the signal books on fresh rows and
marks dust. A 429 never blocks a tick (single attempt, skip the source while its Retry-After runs). pump.fun is never
called. Files: data/watcher.pid, .lock (flock, single instance), .log (JSON lines, rotated 2 MB x 5), .out, and
data/watcher.heartbeat.json (pid, time, ticks, errors, last tick, API calls last minute/hour, http stats).

**Ownership (no double exits).** SQLite WAL + busy_timeout 60 s; every write is inside BEGIN IMMEDIATE and re-reads
the row. The watcher holds a lease (meta `exit_watcher_lease`, TTL max(180 s, 3 x interval)). While it is live the
15-min cycle skips the signal books (`signal_books_skipped_watcher_owns`); when it has lapsed the cycle applies the
same step itself at 15-min resolution (`signal_books_cycle_fallback`, `filled_by: cycle`), skipping a row marked in
the last 30 s.

**Live momentum book: not marked by the watcher (decision).** The watcher never writes momentum, momentum_ladder or
momentum_x1 rows or events. clip5 keeps its 15-min cadence and the routine keeps relaying the cycle's
PARTIAL SELL/SELL events, so there is no path to duplicate or out-of-order alerts and no change to the approved live
exit. Instead it logs `live_clip5_would_fire` (read-only) when a 1-min mark would have triggered a clip5 rung/stop,
which measures what 1-min marking would change before anyone decides to move the live book.

**Routine.** Each 15-min cycle: `.venv/bin/python -m risk paper watcher start --quiet` (no-op if healthy; restarts a
hung one whose heartbeat is > 5 x interval old; starts a dead one). Health: `watcher status --check` exits 0 when
running with a heartbeat <= 3 x interval old.


## Scanner book (whole-market 5-min scanner; owner 2026-11-05; paper only)
`risk scanner start|stop|status [--check]|run|once [--quiet]` runs `smr/paper/scanner.py` as a plain local daemon
(pid/lock/heartbeat/log in `data/scanner.*`, DB lease `meta.scanner_lease`, `start` idempotent, `status --check` exits 1
unless running with a fresh heartbeat). No LLM/agent calls, no StalkChain or X calls (it only reads the routine's
`data/holder_cache.json` / `data/x_heat.json`), never the pump.fun API, never wallets or keys.

Every 300 s: discover (DexScreener boosts latest+top, profiles, community takeovers, `/latest/dex/search` for a few words,
Solana only; GeckoTerminal trending_pools 1h + new_pools) -> DexScreener `/tokens/v1` batches -> prefilter (mcap >= $30k and
<= $50M, liquidity >= $5k + liquidity sanity, 1h volume >= $5k, >= 30 txns/h, not -60% in 1h, never traded) -> runner score
-> live risk score for the best few (live version unchanged, reduced params 15 buyers / 1 hop / 8 traced, 4 per cycle,
150 s budget, cached 6 h in `scanner_scores`; the paper cycle's own score is reused) -> gates: risk SKIP / hard flags,
DexScreener-vs-GeckoTerminal disagreement > 25% or no GT cross-check -> hold, circulating mcap > $30k, liquidity sanity,
Mayhem (unknown blocks; a mint with no pump.fun bonding-curve PDA is not Mayhem), bundle, StalkChain holder veto (cached
only), entry gates (holders unknown caps at REDUCED) -> the momentum book's own `combine` (same size tiers, REDUCED cap) and
runner score >= 60 -> entry. Fill = max(decision quote, close of the entry minute's 1-min GT candle; DexScreener re-quote
if no candle). Max 12 open, 3 new per cycle, no entries after the paper window ends.

Book `scanner`: $1,000, exits `clip5_rug_dust` (clip5 rungs + rug rule 1-min close <= 0.65x the previous + 5% dust bag) by
the 1-min exit watcher (cycle fallback when its lease lapses). BUY / PARTIAL_SELL / SELL events, tagged `[PAPER scanner]`,
come out of `paper events` (default `--book strategy,momentum,scanner`). Strategy/momentum/control books are unchanged.

GeckoTerminal budget: `data/gt_share.json` (smr/paper/gtshare.py) is shared by the watcher and the scanner, 4 calls/min in
total, and a 429 seen by either pauses both for 5 min. The scanner uses ~3-6 GT calls per cycle and ~13 DexScreener calls.

Runner score (0-100; weights; each feature 0..1, unknown features dropped and the rest renormalised, no score under 60%
coverage): vol_accel 20 (vol_m5 x 12 / vol_h1, 1x->0, 3x->1), buy_pressure 15 (buys share, 0.6 m5 + 0.4 h1, 50%->0,
65%->1), buyer_growth 15 (GT unique buyers m5 x 12 / h1, else DexScreener buy-count proxy, 1x->0, 2.5x->1), liq_growth 10
(vs own observation 20-90 min ago, 1.0->0, 1.5->1), mcap_band 15 (1 in $30k-$3M, falls to 0.3 at $10M, 0.1 above),
age 10 (< 15 min 0.4, 15 min-48 h 1, falls to 0.4 at 7 d, 0.2 after), holder_growth 5 (only with a known count),
x_heat 10 (ingested X heat points / max). Every evaluated candidate is logged with its features in `scanner_candidates`
(observations in `scanner_obs`, cycles in `scanner_cycles`) for later evaluation. **It is a ranking of current
acceleration, not a prediction that a coin will 100x;** it has not been validated yet.
