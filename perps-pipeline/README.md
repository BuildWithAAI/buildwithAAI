# perps-pipeline: research, paper trading and a live paper-trading arena for crypto perpetual futures

This is a reproducible research and paper-trading stack for USDT-margined perpetuals (BTC, ETH and SOL, plus an optional set of extra pairs chosen by top volume). It uses public market data only. **It cannot place orders.**

> **Safety contract (Phase 1)**
> - There is no code path for live orders. The code has no private or authenticated endpoints, no API keys and no request signing. The only HTTP client is `PublicHttpClient`, which can only send GET requests.
> - `execution.enabled: true` is rejected when the config is validated. `tests/test_safety.py` scans the source tree for order, account and signing endpoints and fails the build if it finds any.
> - Paper trading simulates fills against live public prices and records them in a local SQLite ledger.
> - Adding real execution would take a separate, explicit Phase-2 change, reviewed by a human.

## Architecture

```mermaid
flowchart LR
  subgraph Exchanges["Public REST APIs (GET only)"]
    BF[Blofin /api/v1/market/*<br/>verified live]
    BB[Bybit V5 /v5/market/*<br/>built to docs, untested here]
  end
  BF & BB --> HTTP[PublicHttpClient<br/>token bucket + backoff/jitter<br/>403 geo-block -> ExchangeUnavailable]
  HTTP --> AD[Exchange adapters<br/>candles / funding / OI / specs / tickers<br/>closed candles only]
  AD --> BFILL[backfill<br/>incremental, backward pagination]
  BFILL --> STORE[(Parquet store<br/>dedupe on ts, atomic writes)]
  STORE --> QC[data quality<br/>gaps, dups, OHLC sanity, outliers]
  STORE --> BT[Backtest engine<br/>next-open fills, stop-first intrabar,<br/>fees, slippage, funding, liquidation]
  CFG[[YAML config<br/>risk caps, fees, strategies]] --> STRAT & RISK
  STRAT[Strategies<br/>range_breakout / ema_pullback / vol_squeeze] --> BT
  RISK[Risk module<br/>sizing = risk$/stop, lot/tick/min,<br/>leverage, daily loss, concurrency, kill switch] --> BT
  BT --> EVAL[Evaluation<br/>IS/OOS, sweep, walk-forward, metrics]
  EVAL --> REP[reports/latest<br/>report.md / report.html / PNG charts]
  AD --> PAPER[Paper engine (one-shot, cron)<br/>shared Position state machine]
  STRAT & RISK --> PAPER
  PAPER --> LEDGER[(SQLite ledger<br/>state/paper.sqlite)]
  LEDGER --> STATUS[perps report<br/>status JSON + markdown]
  STATUS --> ORCH{{Orchestrator agent}}
  AD --> ARENA[perps tick, every 5 min<br/>lock + kill checks, funding/OI snapshots,<br/>6 arms x $100, 1m-bar fills]
  ARENA --> AJ[(state/arena<br/>arena.sqlite, journal/*.md,<br/>stats.json, lessons.md, params/*.json)]
```

## Layout

```
config/default.yaml        risk caps, fees, slippage, universe, backfill depth, paper strategies
config/strategies.yaml     strategy params + robustness sweep grids
config/arena.yaml          arena limits, learning thresholds, the six arms and their params
src/perps/
  config.py                pydantic settings (hard cap 3%, absolute max 12%, execution locked off)
  timeframes.py
  data/http.py             GET-only client: rate limit, retries, backoff, geo-block detection
  data/adapters/           blofin.py (verified), bybit.py (V5 docs, untested from this box)
  data/store.py            Parquet store  data/{exchange}/{ohlcv/SYM/TF, funding, open_interest}
  data/quality.py          gap detection + QC report
  data/backfill.py         incremental backfill + universe resolution (top volume)
  risk/sizing.py           size = risk$ / per-unit loss (stop + slippage + both fees), lot/min/leverage/liq checks
  risk/limits.py           daily loss, max concurrent, drawdown kill, manual kill (flag or state/KILL file)
  core/costs.py            fees, slippage, funding sign convention
  core/position.py         one Position state machine shared by the backtester and the paper engine
  strategies/              indicators (causal), base class, 3 baseline strategies
  backtest/engine.py       multi-symbol shared-equity event loop
  evaluation/              metrics, IS/OOS + sweep + walk-forward, charts, report builder
  paper/                   SQLite ledger + one-shot paper engine
  arena/                   live paper arena: config, ledger, signals (6 arms), 1m manager,
                           journal + post-mortem, learning, tick orchestration, legacy archive
  reporting/status.py      orchestrator status (regime, signals, positions, PnL)
  cli.py                   `perps` command
tests/                     pytest suite (no network)
```

## Quick start

```bash
make install                 # uv venv (Python 3.13) + pinned deps (requirements.lock) + editable install
make check                   # ruff + mypy + pytest
perps backfill               # Blofin, BTC/ETH/SOL, depth from config (1H/4H 730d, 15m/5m 365d)
perps quality                # data-quality summary of everything stored
perps research               # all strategies x timeframes x symbols -> reports/latest/report.{md,html}
perps backtest ema_pullback --tf 1H --symbols BTC-USDT,ETH-USDT   # one run, IS/OOS JSON
perps paper                  # one paper step (run from cron)
perps report --format md     # status for an orchestrator (add --offline to skip the network)
perps universe --top 15      # top USDT perps by 24h quote volume
```

Every CLI command takes `--config path/to/default.yaml` and `--exchange blofin|bybit`. Adding `--top-extra`, or setting `universe.top_volume_extra: N`, includes the N highest-volume extra pairs.

## Live paper-trading arena (`perps tick`, every 5 minutes)

The arena is the training loop. Six strategy arms compete, and each has its own simulated $100 sub-account. It is **simulation only**: it reads public market data and never sends an order. Config lives in `config/arena.yaml`, state in `state/arena/`.

```bash
perps tick                   # one step: lock -> kill check -> data -> fill/manage on 1m bars -> learn -> signals -> outputs
perps journal                # table of all trades (add --arm NAME, --open, --last N)
perps journal --id 7         # one trade in full: thesis, indicator values, PnL $ and R, duration, MAE/MFE, post-mortem
perps journal --format json  # machine-readable
perps arena-status           # status.md from the last tick (--format json for status.json)
perps archive-legacy         # close positions left in the old state/paper.sqlite at their stop; move it to state/archive/
```

**What each tick does**
- **Lock:** takes a non-blocking `flock` on `state/arena/tick.lock`. An overlapping run logs `status=skipped` and exits 0.
- **Kill switches:** honours `risk.kill_switch`, `state/KILL`, `state/arena/KILL`, and the box-wide agent-guard file `/workspace/agent-guard/state/KILL_SWITCH` (or `$AGENT_GUARD_KILL_FILE`). Under a kill:
  - no new entries are opened;
  - resting simulated orders are cancelled;
  - open simulated positions keep being managed, so their stops, targets and funding stay honest.
- **Data:** refreshes 1m/5m/15m/1H/4H closed candles, funding history, the current funding rate, and an OI snapshot.
  - Funding snapshots are appended to `data/blofin/funding_snapshots/`.
  - OI snapshots are appended to `data/blofin/open_interest/`, which builds the OI history that Blofin does not publish.
- **Position management on 1m bars:**
  - The partial entry minute is skipped.
  - Gap-through at the open is checked first, then liquidation, then the stop (stop wins when stop and target are both inside a bar).
  - The take-profit is a resting **maker** limit that needs price to trade *through* it.
  - Stops are taker fills with 2 bps + 3 bps slippage.
  - Funding is applied at each settlement using the venue's published rate.
  - MAE/MFE are tracked.
  - Trailing, time and signal exits are decided at arm-timeframe bar closes and filled at the next 1m open.
- **Per-arm limits** (`limits:` in `config/arena.yaml`):
  - Risk: 1.5% default, 1% floor, **3% hard cap**. The validator rejects anything higher, and the learning layer clamps to the same band.
  - Leverage: **implied leverage ≤ 10x**, with isolated-margin liquidation estimated at 10x and a 25% liquidation buffer.
  - Positions: at most 2 concurrent (resting orders count), one per symbol.
  - Loss limits: 5% daily loss, then a 30% drawdown retires the arm.
  - Stale-signal guard.
- **Journal:** every trade stores:
  - a written thesis and the exact indicator values at the signal;
  - entry, size, leverage, stop, target and liquidation;
  - fees and funding events;
  - exit, PnL in $ and R, duration and MAE/MFE;
  - an automatic post-mortem with tags: `tp_hit`, `gave_back_profit`, `immediate_adverse`, `thesis_failed`, `time_exit`, `signal_exit`, `fees_ate_edge`, `fee_heavy`, `funding_impact`, `regime_change`, `liquidated`.
  - It is written to `state/arena/arena.sqlite` and `state/arena/journal/<id>_<arm>_<symbol>.md`.
- **Learning:** writes `state/arena/stats.json`, `state/arena/lessons.md` and `state/arena/lessons_log.jsonl`, plus versioned parameters in `state/arena/params/<arm>.json` (full history with reasons and evidence). Every trade records its params version. Changes are sample-gated:
  - No change happens before 20 closed trades, and 20 trades are needed on the current version before another change.
  - The target is lowered when median MFE ≥ 1R but fewer than 20% of trades reach the target.
  - The stop is widened when at least half the losers were stopped immediately.
  - Risk is cut to 1% if E[R] < −0.3 after 30 trades.
  - The arm is benched if E[R] < −0.5 after 40 trades.

| arm | timeframe | rule |
|---|---|---|
| momentum_breakout | 15m | Close breaks the prior 24h high/low with the trend (EMA200) and volume > 1.2x the median. Stop 1.5 ATR, target 2R, max 96 bars. |
| ema_trend_pullback | 1H | EMA20/50/200 stack with a pullback to EMA20 and a bullish/bearish close back over it. **4H regime filter**: EMA50 vs EMA200 and the EMA50 slope must agree. Stop 2 ATR, target 2.5R, 3 ATR trail, exit on an EMA50 cross. |
| vol_squeeze | 1H | Bollinger bandwidth in the bottom 20% of 120 bars within the last 6 bars, then a close outside the band. Stop 1.5 ATR, target 2.5R, 2.5 ATR trail, exit at the mid band. |
| funding_fade | 1H | Current funding ≥ max(p95 of 90d, 0.01%) with the close below EMA20 → short; ≤ min(p5, −0.005%) with the close above EMA20 → long. Stop 2 ATR, target 2R, max 24h. |
| oi_divergence | 15m | 4h price move above +1% while OI falls more than 1% → short (short covering); price below −1% with OI falling → long (liquidation flush). Needs about 4h of OI snapshots to warm up. Stop 1.5 ATR(1H), target 2R, max 12h. |
| maker_scalp | 5m | Follows the 1H trend (EMA20/50). A post-only limit sits at 5m EMA20 ∓ 0.2 ATR, fills only on trade-through, and expires after 30 min. Stop 1.2 ATR, target 1.5R (maker), max 2h. |

### Cron

```cron
# minute 1,6,11,... so the exchange has confirmed the bar that just closed
1-59/5 * * * * cd /workspace/perps-pipeline && .venv/bin/perps tick --quiet >> state/arena/cron.log 2>&1
```

**How to stop it**
- Pause new entries: run `touch state/KILL`, `touch state/arena/KILL`, or create the agent-guard file. Open simulated positions are still managed.
- Stop the loop entirely: `crontab -l | grep -v 'perps tick' | crontab -`.
- On this box, cron runs as a plain daemon (the container has no init system). If the box restarts, start it again with `sudo cron`.

The legacy single-account `perps paper` engine is kept for comparison but is no longer scheduled. Its last open position was archived (see `state/archive/`).

## Modelling assumptions (no lookahead)

| Topic | Rule |
|---|---|
| Signal timing | Each signal is computed from data up to the close of bar *t*. The entry is a market fill at the **open of bar t+1**, with adverse slippage. |
| Unclosed candles | Candles that are still forming are dropped by the adapters (Blofin `confirm=1`; Bybit keeps a bar only once `start+interval <= now`). |
| Intrabar exits | A gap through the stop or liquidation level at the open fills at the open. If both the stop and the TP are inside the bar's range, **the stop is assumed to be hit first**. A stop fill pays an extra `stop_bps`. |
| Trailing, time and signal exits | These are evaluated at the bar close and take effect from the next bar. |
| Fees | Blofin is charged at 0.02% maker / 0.06% taker, and Bybit at 0.02% / 0.055%. Entries and stops are taker. TP fills are taker by default, which is conservative. |
| Funding | Each historical 8h settlement is charged as `-side * qty * price * rate` if the position was open at that instant. |
| Liquidation | Isolated margin: `entry * (1 - 1/lev + mmr)`. A stop must sit inside 75% of the distance from entry to liquidation, otherwise the trade is rejected. A liquidation loss is capped at the posted margin. |
| Sizing | `qty = risk$ / (|entry - stop_fill| + entry*taker + stop_fill*taker)`. The quantity is floored to the lot size and rejected if it is below the minimum size. The result is capped by `max_leverage` and by the available margin. |
| Equity | One shared equity pool across symbols. Daily mark-to-market feeds Sharpe and Sortino, annualised with sqrt(365). CAGR is reported only when the window is at least 90 days. |
| IS/OOS | A time split at 70%. Parameters are chosen on IS only, using daily Sharpe with at least 20 trades, then run once on OOS. Walk-forward is anchored with 4 folds. Indicator warm-up uses the earlier data, but no trades are taken before the window starts. |

## Exchanges

- **Blofin** (`https://openapi.blofin.com`) is used for all data in this repo. It has been verified against live data. Its limits are 500 requests/min and 1500 per 5 min, so the backfill runs at 2 req/s. Open interest is a **snapshot only**: Blofin publishes no OI history, so history builds up from repeated `backfill`/`paper` runs.
- **Bybit V5** (`https://api.bybit.com`) was implemented from the official public docs: kline, funding/history, open-interest (with history), instruments-info and tickers. **It is untested from the build box**, which gets a CloudFront 403 geo-block. The block raises `ExchangeUnavailable`, and the CLI exits with code 2 and a clear message. Run it from an unblocked machine to validate it: `perps backfill --exchange bybit --days 30`.

## Limitations

- These are bar-level simulations. There is no order-book or queue modelling, and slippage is a fixed number of bps, which is optimistic for large size and conservative-ish at $100.
- Blofin covers roughly 2 years of 1H/4H and 1 year of 15m/5m in this repo. That window is a single market history, so treat any result as a hypothesis.
- Paper entries fill at the live bid/ask when the step runs, not at the exact open of the bar. An entry part-way through a bar treats the rest of that bar's range as if it came after the fill, which is an approximation.
- Test capital is about $100. Some symbols have minimum lots that can force a rejection; the reason is reported (`sizing: below exchange min size`).
