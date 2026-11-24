# AAI MT5 EA Library — Batch 1 (25 hypotheses)

Created November 6, 2026 (CT). **UNCOMPILED and UNTESTED MQL5 research artifacts. No claim of profitability, hedge-fund quality, or suitability for sale.** Earlier Python research found no robust edge; its results do not validate these implementations. No account accessed. EAs are hard-locked to Strategy Tester, not live or demo charts.

## Shared semantics and defaults

- Main research symbol AUDUSD+; every EA uses `_Symbol`, with no hardcoded broker suffix. Gold-oriented #25 defaults to M5 but still works on other symbols after input review.
- Timeframe below is the `SignalTF` input; the chart timeframe does not override it. Fixed lookbacks represent that stated timeframe, not equivalent durations on another timeframe. Sniper rejects non-H1 input in this batch.
- Entry is a market order on the first tick of a new signal bar, using completed bars only. No intrabar signal or guaranteed fill at the historical close. No pending orders or partial exits.
- SL always attached. `StopPips`/`TargetPips` are execution distances unless a strategy explicitly replaces them with ATR/structure. Stops are rounded outward to trade tick size and re-sized; invalid broker distances are skipped, never secretly tightened or widened to fit an account.
- `RiskPercent=1`, `MaxRiskPercent=2` (cannot exceed 2). Sizes rounded DOWN to broker step. `AllowMinimumLot=true` permits the broker minimum above the 1% target only if reserved planned risk <=2%. Disable it for strict target risk. `FixedLot=0` is off; fixed volume never bypasses max risk, spread, margin, or daily filters. Minimum lot is read from the broker, not assumed to be 0.01.
- Risk includes conservative tick-value loss, cross-checked OrderCalcProfit, account-currency round-trip commission reserve (default 7 per standard lot), and 5-point stop-slip reserve. Spread is paid through bid/ask entry/SL distance, not added twice. These defaults are NOT verified Bybit costs. Gaps/slippage/swap can still exceed any planned limit. Actual fills above reserve trigger a close, not a guaranteed 2% realized cap.
- `MaxSpreadPoints=20`, deviation 10 points. On 5-digit AUDUSD: 10 points=1 pip. Non-FX requires explicit `PipSizeOverride`; example gold 0.10 price units per user-defined pip is a convention, NOT a broker fact. All gold distances and spreads need review.
- UTC session inputs: server offset +120 minutes by default, London open 08 UTC, NY open 13 UTC (winter conventions). Change for actual broker and local DST. Generic UTC entry session defaults 00-to-00 (all weekday hours). Custom session signals refer to the signal bar OPEN; execution follows its close. No automatic holidays/news/DST feed.
- `MaxTradesPerDay=1`, keyed to EA magic/symbol and UTC date, counts unique entry orders including partial fills as one. `DailyLossLimitPercent=4`: today's realized PnL plus full current floating profit/swap, divided by reconstructed start-day account balance; breach closes this EA and latches until UTC date changes. It is NOT a global portfolio limit. Overnight floating is conservatively attributed in full, not marked from midnight. Latch is memory-only if forcibly restarted. Entry also checks remaining loss allowance; exits can gap beyond it.
- One own position per magic/symbol. On netting accounts ANY existing symbol position blocks new entries, preventing another strategy/manual trade from being merged. Do not run the same EA twice on the same symbol/magic. No martingale/grid/averaging or hidden size escalation.
- BE/trails update on completed signal closes only. Short close estimates use current spread; real ticks must verify behavior. BE at entry does not cover fees. Initial R is from actual open to SL; do not change inputs mid-position. Default timed exit is 360 elapsed minutes except where listed. A timed exit checks each tick; a market closure delays it.
- Indicator handles allocated in OnInit, CopyBuffer failures suppress signals, handles released in OnDeinit. Slow EMAs require 3x period calculated bars; load sufficient pre-test history. Common `WarmupBars=250` with at least 300 copied bars. No tick-history validity claim comes from these guards.
- Optimisation ranges below are research bounds, not recommended profitable settings. Many strategies will correctly take ZERO trades on a $100 account because minimum lots make their stops unaffordable. Do not loosen risk to manufacture activity. For $100 feasibility test after each balance change, not just initially.

## 001 — Zoora Regime Transition

- File: `Experts/AAI/AAI_001_ZooraTrend.mq5`; magic `2601001`.
- Family: EMA regime. Style: **swing**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **H4** baseline.
- Entry and exit: Enter only when the completed close/EMA200/EMA800 regime changes to +1 or -1. Stop 3 ATR, no target; exit when regime no longer matches. No automatic re-entry after a stop.
- Why it might work: Persistent repricing can produce multi-day directional runs; a slow regime attempts to avoid small fluctuations.
- When it fails: Lag and repeated regime flips in ranges; wide stops commonly exceed $100 minimum-lot budget.
- Key inputs / limited optimisation bounds: EMA pairs 200/800 or 198/792 only; 3 ATR stop is fixed in code (a separate trial if changed).
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 002 — Zoora ATR-Band Pullback

- File: `Experts/AAI/AAI_002_ZooraPullback.mq5`; magic `2601002`.
- Family: EMA pullback. Style: **scalp/sniper**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **H1** baseline.
- Entry and exit: In completed H4 Zoora regime, buy a signal bar that touches the H4 fast EMA plus a 0.25 ATR band and closes back above; short is symmetric. Stop StopATR times signal ATR; 2R target; regime-change exit.
- Why it might work: Trend pullbacks may offer lower entry risk than chasing extensions.
- When it fails: An apparent pullback can become a reversal; H4 levels are deliberately delayed until completed.
- Key inputs / limited optimisation bounds: BandATR 0.1-0.5; StopATR 1-2.5; EMA pair 200/800 or 198/792.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 003 — Zoora H4-Level Sniper

- File: `Experts/AAI/AAI_003_ZooraSniper.mq5`; magic `2601003`.
- Family: level plus breakout. Style: **sniper**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **H1** baseline.
- Entry and exit: Completed H4 Zoora regime. Long H1 range overlaps H4 EMA200 +/-5 pips and closes above prior two H1 highs; short overlaps EMA800 and closes below prior two lows. Signal-bar opens in first three London/NY hours. 12-pip SL, 36-pip TP; completed-close BE at +1R; exit on regime change.
- Why it might work: Combines directional persistence, a pullback to a slow reference level, and local confirmation. This is the least-bad earlier research hypothesis, not an edge.
- When it fails: Only 45 earlier proxy OOS trades, roughly breakeven and cost-fragile; exact execution and UTC/day definitions differ from Python.
- Key inputs / limited optimisation bounds: Freeze 12/36 and 5-pip band first; EMA 198/792 is one separately logged sensitivity.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 004 — Asian Range Expansion

- File: `Experts/AAI/AAI_004_AsianRangeBreakout.mq5`; magic `2601004`.
- Family: session range breakout. Style: **scalp**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **M15** baseline.
- Entry and exit: Build complete UTC 00:00-06:00 M5 range. Between range end and first three London hours, enter a new completed-close break beyond the range plus buffer; 12-pip SL, 25-pip TP, max 6h.
- Why it might work: Quiet-session inventory can unwind when London liquidity arrives.
- When it fails: False breaks and news reversals; fixed UTC Asia definition is not local Sydney time.
- Key inputs / limited optimisation bounds: Asia end 5-7 UTC; buffer 0.5-2; stop 8-16, target 20-30 pips.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 005 — London First-Hour ORB

- File: `Experts/AAI/AAI_005_LondonOpeningRange.mq5`; magic `2601005`.
- Family: opening range breakout. Style: **scalp**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **M15** baseline.
- Entry and exit: Build the first full London hour from M5 bars, then trade a completed-close escape during the next two hours. Initial stop is max(StopPips, half opening-range width); target 2R.
- Why it might work: The initial high-liquidity auction may define a range whose escape marks committed flow.
- When it fails: Opening-range noise and unusually broad ranges; not equivalent to the pre-London Asian breakout.
- Key inputs / limited optimisation bounds: Buffer 0-2 pips; minimum stop 8-15 pips. Freeze one London/DST schedule.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 006 — New York Impulse Continuation

- File: `Experts/AAI/AAI_006_NYImpulse.mq5`; magic `2601006`.
- Family: volatility impulse. Style: **scalp**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **M5** baseline.
- Entry and exit: First two NY hours: a fresh candle body >=0.8 ATR, >1.5 times prior body, close in outer 20% of its range and correct side of EMA50. Enter next bar, 10-pip stop/25-pip target, max 90 min.
- Why it might work: Large one-sided opening flow can continue while participants adjust inventories.
- When it fails: Exhaustion candles and news spread/slippage; no future candle confirmation is used.
- Key inputs / limited optimisation bounds: BodyATR 0.6-1.2; EMA 30-80; stop 8-12, target 20-30 pips.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 007 — Prior-Day Extreme Breakout

- File: `Experts/AAI/AAI_007_PriorDayBreakout.mq5`; magic `2601007`.
- Family: daily structure breakout. Style: **swing**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **H1** baseline.
- Entry and exit: New completed-close break above prior broker-D1 high or below low, with EMA50 slope aligned. Stop 2 ATR, no target; 35-pip close trail after +1R; max 3 days.
- Why it might work: Daily extremes can attract stop orders and signal multi-session repricing.
- When it fails: Failed breaks, broker day-boundary dependence and overnight swaps.
- Key inputs / limited optimisation bounds: Buffer 0-3 pips; EMA 30-100; trail 25-60 pips.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 008 — Prior-Day Liquidity Sweep Fade

- File: `Experts/AAI/AAI_008_PriorDayFade.mq5`; magic `2601008`.
- Family: failed breakout reversal. Style: **sniper**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **M15** baseline.
- Entry and exit: Signal wick sweeps prior broker-D1 extreme by at least buffer, then closes back inside with reversal body. Stop beyond wick plus buffer; target 3R, max 4h.
- Why it might work: An unsuccessful stop-run can trap breakout traders and reverse into the range.
- When it fails: A genuine trend may resume after the rejection; structural stop can be unaffordable.
- Key inputs / limited optimisation bounds: Sweep 0.5-3 and wick buffer 0.5-2 pips; fixed 3R first.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 009 — Donchian 20/10 Turtle

- File: `Experts/AAI/AAI_009_DonchianTurtle.mq5`; magic `2601009`.
- Family: channel trend following. Style: **swing**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **H4** baseline.
- Entry and exit: Completed close above previous 20 highs/below lows enters. Initial SL 2 ATR, no target; exit on completed close beyond the opposite prior 10-bar channel; no pyramiding.
- Why it might work: Price channel escape is a simple response to directional persistence independent of EMA levels.
- When it fails: Frequent small range-bound losses and very wide stops for $100.
- Key inputs / limited optimisation bounds: Entry 15-55; exit 5-20, always shorter than entry. Sparse prespecified grid only.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 010 — Bollinger Re-entry Pico

- File: `Experts/AAI/AAI_010_BollingerPico.mq5`; magic `2601010`.
- Family: short-horizon mean reversion. Style: **pico**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **M1** baseline.
- Entry and exit: In flat EMA50 conditions (3-bar slope <0.15 ATR), prior close outside 2-sigma Bollinger band and latest close back inside enters toward mean. 5-pip SL/8-pip TP, max 10 min.
- Why it might work: Short liquidity shocks may overshoot a slowly moving local equilibrium.
- When it fails: Costs consume much of an 8-pip target; repeated band-walking in trends.
- Key inputs / limited optimisation bounds: Band period 15-30; deviation 1.8-2.5; SL 4-7, TP 5-10 pips. Require real ticks.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 011 — Bollinger-Keltner Squeeze Release

- File: `Experts/AAI/AAI_011_BollingerSqueeze.mq5`; magic `2601011`.
- Family: volatility compression breakout. Style: **scalp**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **M15** baseline.
- Entry and exit: Prior 2-sigma Bollinger width lies inside EMA20 +/-1.5 ATR; latest close escapes current Bollinger band and width expands. SL StopATR*ATR; TP 2R; max 6h.
- Why it might work: Compression followed by expansion can reveal new directional information.
- When it fails: Squeezes can persist or release falsely; expansion is not necessarily directional continuation.
- Key inputs / limited optimisation bounds: Band period 15-30; SqueezeATR 1-2; StopATR 1-2; fixed 2R.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 012 — RSI(2) Trend Pullback

- File: `Experts/AAI/AAI_012_RSI2Pullback.mq5`; magic `2601012`.
- Family: oscillator pullback. Style: **swing**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **H1** baseline.
- Entry and exit: Above EMA200 and prior RSI2 below 10, buy when RSI2 crosses back above 10; mirrored short at 90 below EMA200. SL 2 ATR; no target; exit at RSI2 >=70 long/<=30 short or 2 days.
- Why it might work: A very short oscillator can flag temporary countertrend exhaustion within a slower drift. Connors-inspired, not a reproduction of an equity system.
- When it fails: Pullbacks become trends and RSI thresholds lack a verified forex edge.
- Key inputs / limited optimisation bounds: Oversold 5-15; overbought 85-95; EMA 100-250. Keep RSI period 2.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 013 — Keltner Channel Trend Capture

- File: `Experts/AAI/AAI_013_KeltnerTrend.mq5`; magic `2601013`.
- Family: ATR envelope breakout. Style: **swing**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **H1** baseline.
- Entry and exit: EMA40 slope aligned and completed close crosses EMA40 +/-2 ATR envelope. SL 2 ATR, no target; exit on crossing back through middle EMA; max 5 days.
- Why it might work: Volatility-scaled escape from equilibrium may mark a persistent trend rather than a fixed-pip fluctuation.
- When it fails: Late entries and band break failures; ATR growth expands risk.
- Key inputs / limited optimisation bounds: EMA 20-60; channel 1.5-3 ATR; 2 ATR stop fixed first.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 014 — MACD Histogram Turn with Slow Bias

- File: `Experts/AAI/AAI_014_MACDTrend.mq5`; magic `2601014`.
- Family: momentum crossover. Style: **scalp**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **M15** baseline.
- Entry and exit: MACD(12,26,9) main crosses signal in direction of EMA200 bias and main-line sign. SL StopATR*ATR; 2R target; opposite cross exits; max 6h.
- Why it might work: Momentum reacceleration after a pause can align entry timing with a larger directional drift.
- When it fails: Whipsaw and redundant lagging filters; MACD main minus signal is used, not an MT4-only histogram buffer.
- Key inputs / limited optimisation bounds: BiasEMA 100-250; StopATR 1-2; MACD 12/26/9 fixed initially.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 015 — Supertrend Volatility Flip

- File: `Experts/AAI/AAI_015_SupertrendFlip.mq5`; magic `2601015`.
- Family: recursive ATR trend. Style: **swing**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **H1** baseline.
- Entry and exit: Reconstruct Supertrend(ATR14, multiplier 3) causally over last 200 completed bars. Enter only on direction flip; SL beyond current band (at least 1 ATR); no target; opposite flip exits; max 7 days.
- Why it might work: An ATR-adjusted hysteresis band may stay with direction while suppressing small countertrend noise.
- When it fails: Recursive seed and finite warmup sensitivity; no universal trend persistence.
- Key inputs / limited optimisation bounds: Multiplier 2-4; ATRPeriod 10-20. Replay length fixed 200; assess seed stability separately.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 016 — Ichimoku Cloud Escape

- File: `Experts/AAI/AAI_016_IchimokuCloud.mq5`; magic `2601016`.
- Family: cloud trend structure. Style: **swing**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **H1** baseline.
- Entry and exit: Completed close newly escapes above/below the visible cloud, Tenkan above/below Kijun and cloud polarity aligned. SL 2 ATR; no target; close through Kijun exits; max 7 days. No future Chikou comparison.
- Why it might work: Agreement of short, medium and displaced range midpoints may identify persistent directional structure.
- When it fails: Lag, false cloud escapes and sensitivity to market-specific period convention.
- Key inputs / limited optimisation bounds: 9/26/52 baseline; assess 8/24/48 as one separate trial. Verify cloud alignment visually.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 017 — ADX Directional Acceleration

- File: `Experts/AAI/AAI_017_ADXAcceleration.mq5`; magic `2601017`.
- Family: directional-strength expansion. Style: **scalp**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **M15** baseline.
- Entry and exit: ADX14 newly crosses above 25; dominant DI exceeds other by >=8; close exceeds previous candle high/low. SL StopATR*ATR, TP 2R; exit when ADX <20 or DI dominance reverses.
- Why it might work: Transition from low to stronger directional movement may be more informative than high ADX alone.
- When it fails: ADX is nondirectional by itself and often peaks after much of the move.
- Key inputs / limited optimisation bounds: ADX 10-20 periods; Strength 22-30; DI gap 5-15.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 018 — Inside-Bar Mother-Range Break

- File: `Experts/AAI/AAI_018_InsideBar.mq5`; magic `2601018`.
- Family: candle compression. Style: **sniper**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **M15** baseline.
- Entry and exit: Bar2 lies wholly inside bar3 (mother). Bar1 closes outside mother range in direction of EMA100 slope. SL beyond mother opposite extreme plus buffer, TP 3R; max 8h.
- Why it might work: A pause within a directional market can concentrate stops before continuation.
- When it fails: Outside break can exhaust; mother-bar stop often too large for minimum volume.
- Key inputs / limited optimisation bounds: Buffer 0.5-2 pips; EMA100 fixed; target 2.5-4R only in separately logged trials.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 019 — Pin-Bar Rejection at Daily Level

- File: `Experts/AAI/AAI_019_PinBarLevel.mq5`; magic `2601019`.
- Family: wick rejection. Style: **sniper**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **H1** baseline.
- Entry and exit: At prior broker-D1 high/low +/-3 pips, require wick >=2 bodies and close in outer 30% of range, pointing away from level. SL past wick, TP 3R; max 1 day.
- Why it might work: A strong rejection of a widely watched reference may indicate depleted aggressive flow.
- When it fails: OHLC shapes do not reveal true order flow; strong trends run through levels.
- Key inputs / limited optimisation bounds: Tolerance 2-5 pips; wick/body 2-3; 3R target fixed.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 020 — Round-Number Sweep Pico

- File: `Experts/AAI/AAI_020_RoundNumberPico.mq5`; magic `2601020`.
- Family: psychological level reaction. Style: **pico**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **M1** baseline.
- Entry and exit: Sweep and reclaim nearest 50-pip grid level with close at least 0.5 pip back inside. Contrarian entry, 5-pip SL/8-pip TP, max 10 minutes. Grid is explicitly configurable in price-derived pips.
- Why it might work: Clustered orders near 00/50 levels can create temporary overshoot/rejection.
- When it fails: Round numbers can accelerate rather than reverse price; tiny target is cost-sensitive.
- Key inputs / limited optimisation bounds: Grid 50 or 100 pips; reclaim 0.3-1; SL 4-7 and TP 5-10. For gold configure grid units explicitly.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 021 — NR7 Volatility Release

- File: `Experts/AAI/AAI_021_NR7Expansion.mq5`; magic `2601021`.
- Family: relative range contraction. Style: **scalp**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **M15** baseline.
- Entry and exit: Bar2 is strictly the narrowest range of seven bars (2-8). Bar1 closes outside bar2 in direction of EMA50 slope. Structural stop beyond bar2, TP 2.5R; max 6h.
- Why it might work: Volatility clustering can produce expansion after a local contraction; directional slope supplies a separate bias.
- When it fails: Noise in extremely narrow bars; stops may violate broker minimum distance.
- Key inputs / limited optimisation bounds: Buffer 0.3-1 pips; EMA50 fixed; NR7 fixed rather than mining many lookbacks.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 022 — Weekly Open Gap Reversion

- File: `Experts/AAI/AAI_022_WeeklyGapFade.mq5`; magic `2601022`.
- Family: calendar discontinuity fade. Style: **scalp**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **M15** baseline.
- Entry and exit: Compare current broker-W1 opening price with the last completed H1 close before that open. If gap 5-40 pips, during first six elapsed hours require a reversal body toward the old close; target the old close; stop max(8 pips, gap size).
- Why it might work: Weekend inventory imbalances can partially unwind when continuous liquidity returns.
- When it fails: Fundamental weekend news can justify the gap; weekend open and historical quotes vary by broker.
- Key inputs / limited optimisation bounds: Gap 5-40 pips; entry window 2-6 hours; session weekday filter means Sunday signals are skipped.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 023 — ATR Chandelier Trend Runner

- File: `Experts/AAI/AAI_023_ATRChandelierSwing.mq5`; magic `2601023`.
- Family: trailing trend persistence. Style: **swing**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **H4** baseline.
- Entry and exit: EMA50 above/below EMA200 and completed close newly breaks prior 5-bar extreme; initial 2.5 ATR stop, no target; ratchet highest/lowest since entry minus/plus 3 ATR after +1R; exit on bias loss.
- Why it might work: Combines a medium-term trend bias with a volatility-adjusted exit that allows extended runs.
- When it fails: Large initial stops and profit giveback; no claim tight entries can reliably capture 100 pips.
- Key inputs / limited optimisation bounds: Chandelier 2-4 ATR; fixed 50/200 bias and 5-bar trigger initially.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 024 — Three-Horizon Momentum Agreement

- File: `Experts/AAI/AAI_024_MTFMomentum.mq5`; magic `2601024`.
- Family: multi-timeframe momentum. Style: **swing**.
- Symbol/timeframe: AUDUSD+ first; XAUUSD+ only after contract/unit review; **H1** baseline.
- Entry and exit: Completed D1 5-bar, H4 6-bar and H1 12-bar returns all agree and exceed 0.5 ATR of their respective timeframes; enter only when H1 momentum newly qualifies. Stop 2 signal ATR; no target; 40-pip close trail after +1R; exit if D1/H4 sign flips.
- Why it might work: Agreement across horizons may reflect broader repricing rather than a single noisy fluctuation.
- When it fails: Correlated filters and late entries; threshold selection easily overfits.
- Key inputs / limited optimisation bounds: Momentum threshold 0.3-1 ATR; trail 30-60 pips. Horizons fixed, not interchangeable bar counts.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

## 025 — Gold Asian-Range London Retest

- File: `Experts/AAI/AAI_025_GoldLondonRetest.mq5`; magic `2601025`.
- Family: breakout retest / metals. Style: **sniper**.
- Symbol/timeframe: XAUUSD+ first; AUDUSD+ cross-check; **M5** baseline.
- Entry and exit: Gold-oriented but symbol-generic: build UTC 00-06 M5 range, London first three hours only. Bar2 closes outside range; bar1 retests broken edge within 0.15 ATR and closes back outside. Stop beyond retest wick or StopATR*ATR, whichever wider; TP 3R; max 4h.
- Why it might work: Gold can transition from Asian balance to London price discovery; retest demands acceptance beyond the broken range rather than chasing the first escape.
- When it fails: Gold volatility/spread and contract minimum often make this impossible on $100. Not a gold-only symbol check; pip override mandatory for CFDs.
- Key inputs / limited optimisation bounds: Retest 0.1-0.3 ATR; StopATR 1-2; keep gold price-unit override fixed from specification.
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

