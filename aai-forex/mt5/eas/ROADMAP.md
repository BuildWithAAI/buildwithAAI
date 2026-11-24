# Roadmap — 75 additional research ideas (026–100)

Planning only: these EAs have NOT been implemented or validated. Batch 1 contains 001–025 only. A different indicator period, stop, symbol or target does not count as a distinct strategy. Each item below changes the causal setup, information source or state-transition rule, not merely the settings. Shared risk infrastructure stays mandatory. None is a promise of an edge or an obligation to ship 100 low-quality bots. Reject redundant/unsupported ideas before coding; retain rejection records.

Some candidates require external datasets imported into tester files, related-symbol histories, or reliable tick volume. Those are explicit research dependencies, not hidden web/DLL access. No grid, martingale, pyramiding or averaging down. One initial position and a real SL per EA/symbol. All validation is net of costs.

## Batch 2: Session microstructure and price structure

026. **Session EMA Reclaim Scalp** — During first London hour, fade an early countertrend excursion only after EMA20 is reclaimed; tests time-specific pullback flow, not a range escape.
027. **Asian Extension London Fade** — Fade an unusually large signed Asian move defined by a past-only volatility percentile; an extrapolated reversal hypothesis, not a published profitable rule.
028. **London Failed Auction Reversal** — Fade a London opening-range break only after a close back inside and failed retest; targets trapped breakout inventory.
029. **NY London-Trend Pullback** — Trade the first NY retracement of a directional London session after its first higher-low/lower-high; tests flow handoff.
030. **London Lunch Inventory Reversion** — Fade a morning extension during the quieter lunch transition if price returns inside the morning value zone.
031. **NY Afternoon Range Rotation** — Trade rejection of the established NY morning range after a low-volatility afternoon transition; tests balanced inventory.
032. **Tokyo Fix Drift-and-Reversal** — Separately preregister direction before/after the Tokyo fixing window using actual local-time conversion; tests concentration of scheduled flow.
033. **London Fix Overshoot Reversion** — Fade an extreme fixing-window move after the window ends; requires genuine tick data and explicit DST calendars.
034. **Month-End Fix Continuation** — Follow pre-fix momentum on month-end dates only; tests concentrated rebalancing, without assuming the flow direction beforehand.
035. **Rollover Recovery** — After the daily rollover spread normalizes, test reversal of a price dislocation; exclude abnormal financing and quote gaps.
036. **VWAP Stretch Reversion** — Fade an intraday deviation from tick-volume-weighted session VWAP after a reclaim; volume is broker activity, not consolidated forex volume.
037. **VWAP Acceptance Trend** — Enter after repeated closes accept one side of anchored VWAP with rising volume participation; distinct from stretching back to VWAP.
038. **Weekly VWAP Pullback** — Buy/sell the first pullback to a weekly inventory anchor in an established week-long drift.
039. **Swing-Failure Pattern** — Sweep a confirmed non-daily swing point, reclaim and enter on a retest; tests trapped liquidity at endogenous structure.
040. **Confirmed Double-Bottom/Top Break** — Use two confirmed pivots and a neckline close-break; minimum confirmation delay prevents hindsight pivot selection.
041. **Head-and-Shoulders Failure** — Trade a failed neckline break and recapture of the right-shoulder zone; exploits invalidation of a common pattern, not its textbook completion.
042. **Trendline Third-Touch Rejection** — Construct a line from past confirmed pivots and trade the first subsequent rejection, never redraw with future pivots.
043. **Horizontal Shelf Absorption** — After multiple non-breaking tests of an equal high/low shelf, trade eventual acceptance beyond it; repeated tests are state, not extra entries.
044. **Impulse-Base-Imbalance Retest** — Define a displacement bar and preceding narrow base, then test the first return; quantify zones instead of discretionary supply/demand labels.
045. **Three-Bar Price-Void Fill** — Test partial fill of a precisely defined three-bar non-overlap after displacement; no assumption that every price void must fill.
046. **Engulfing at Weekly Extreme** — A complete body engulfing at a prior-week boundary tests multi-session rejection, distinct from a wick-only daily pin bar.
047. **Three-Bar Exhaustion Reversal** — Fade a sequence of diminishing bodies with new extremes only after a contrary close; tests waning impulse without oscillator divergence.
048. **Measured Pullback Continuation** — In a confirmed swing trend, require a 38–62% retracement of the last completed impulse plus renewed structure break.
049. **Break-Retest of Prior Week** — Trade acceptance after a prior-week boundary breakout and retest; explicitly multi-day horizontal structure rather than the daily close break.
050. **Two-Day Compression Expansion** — A pair of overlapping narrow daily ranges followed by directional acceptance tests multi-day balance resolution.

## Batch 3: Alternative signals and statistical states

051. **Stochastic Cycle Pullback** — In a slow trend, enter when stochastic leaves an extreme while price holds a confirmed higher-low/lower-high; tests cyclical timing.
052. **CCI Zero-Line Reacceleration** — Enter a return through CCI zero after a shallow trend-side retracement; tests standardized typical-price momentum.
053. **Williams %R Failure Swing** — A failed oscillator extreme without a fresh price extreme tests short-term exhaustion, not simply oversold buying.
054. **Parabolic SAR Stop-and-Reverse Filtered** — Trade a new SAR direction only after a separate range-expansion condition; single position, no automatic doubling.
055. **Aroon Trend Birth** — A new directional high/low dominance after a period of stale extremes tests the age of price information.
056. **Vortex Directional Shift** — Cross-period high-low movement dominance after consolidation tests directional travel rather than MACD return smoothing.
057. **Choppiness Regime Transition** — Enter when a formerly high-choppiness state resolves with directional price efficiency; no lookahead regime label.
058. **Kaufman Efficiency Pullback** — Use adaptive moving-average response in an efficient trend, then buy/sell the first valid pullback; distinguishes smooth drift from noisy range.
059. **Linear Regression Channel Rotation** — Fade residual extremes around a low-slope past-only fitted line; refit only with information available at entry.
060. **Regression Slope Acceleration** — Trade a statistically scaled increase in fitted slope with residual-volatility control; not a simple close-return threshold.
061. **Hurst-Filtered Range Reversion** — Use a fixed-window persistence estimate to permit reversion only in anti-persistent states; estimation error is a major risk.
062. **Variance-Ratio Momentum Gate** — Compare short and long return variance to choose whether a predefined continuation setup is eligible; no ex-post regime choice.
063. **CUSUM Structural Break** — Enter a newly detected cumulative-return mean shift using past-calibrated thresholds; tests regime change without a moving-average cross.
064. **Page-Hinkley Volatility Shift** — After a sequential volatility-change alarm, wait for directional acceptance; studies uncertainty transitions, not just small Bollinger width.
065. **Kalman Innovation Reversion** — Fade large one-step innovations from a causal state estimate after the estimated drift stabilizes; no smoothed future states.
066. **Ornstein-Uhlenbeck Half-Life Reversion** — Trade residual deviations only when a rolling mean-reversion model has a stable eligible half-life; reject unstable fits.
067. **Directional Semivariance Imbalance** — Trend-follow when upside/downside realized variance becomes asymmetrically persistent; use signs, not overall ATR alone.
068. **Return Entropy Transition** — Test directional acceptance after reduced sign-sequence entropy; freeze discretization to avoid data-mining state definitions.
069. **Failed Momentum Divergence Reversal** — Require confirmed price and oscillator pivots with a later structure break; divergence is observable only after pivot confirmation.
070. **Tick-Volume Climax Rejection** — A past-normalized tick-activity spike plus price rejection tests exhaustion; broker volume quality is an explicit dependency.
071. **Low-Activity Drift Continuation** — Test persistent price drift on unusually low tick activity, the opposite participation state to climax rejection.
072. **Tick-Volume Price-Impact Shock** — Measure price change per unit of quote activity, then trade/fade a preregistered impact shock; needs high-quality tick sequencing.
073. **Spread-Normalized Liquidity Recovery** — Enter only after an extreme spread event resolves and a measurable price displacement persists; the spread state is part of the signal.
074. **Up/Down Tick Run Exhaustion** — Fade extreme same-direction quote runs after a fixed reversal confirmation; true ticks are essential and spread noise must be controlled.
075. **Volatility Seasonality Surprise** — Trade directional response to volatility exceeding the past distribution for that exact clock slot; tests surprise relative to time-of-day norms.

## Batch 4: Cross-market, events and portfolio research

076. **AUDNZD Relative-Strength Confirmation** — Permit an AUDUSD directional setup only when AUD strength also appears against NZD; needs synchronized related-symbol history.
077. **AUDUSD/NZDUSD Residual Reversion** — Estimate a rolling hedge relation and trade AUDUSD residual deviation only, with a stop and no paired live leg; joint risk remains a research question.
078. **AUDJPY Risk-Sentiment Confirmation** — Require aligned AUDJPY and AUDUSD movement before a predefined AUDUSD pullback; tests a risk-sensitive common factor.
079. **Broad-USD Residual Shock** — Separate AUDUSD movement from a fixed basket USD factor and test the idiosyncratic remainder; avoid using future basket values.
080. **DXY Break Transmission** — Enter AUDUSD only after a synchronized dollar-index shock and local confirmation; availability and basis of DXY data must be established.
081. **Copper-AUD Lead/Lag** — A lagged copper return conditions a later AUDUSD entry; timestamp cash/futures sessions correctly and test whether any lead survives costs.
082. **Iron-Ore AUD Regime** — Use lagged daily iron-ore changes to gate swing direction; publication timing and stale quotes are key dependencies.
083. **China Equity Spillover** — Test AUDUSD response after a significant mainland equity opening move using only actually released index values.
084. **US Equity Futures Risk Shock** — After a large synchronized equity-futures move, test AUDUSD continuation on retest; prevent cross-feed clock leakage.
085. **AU-US Yield-Differential Drift** — Lagged changes in short-rate expectations condition multi-day AUDUSD direction; requires point-in-time rates data, not revised series.
086. **Carry Plus Trend** — Enter only when verified broker swap direction and a slow price trend align; costs and changing carry are modeled explicitly.
087. **RBA Surprise Follow-Through** — Trade after a verified decision-versus-consensus surprise and a post-release range confirmation; needs historical consensus and release times.
088. **RBA Initial-Response Failure** — Fade an initial RBA move only after a measured failed continuation; separate from deciding based on surprise sign.
089. **Australian Employment Surprise** — Condition direction on actual-versus-consensus labor surprises after a latency buffer; no hindsight economics data.
090. **US Payroll Cross-Asset Confirmation** — Require consistent USD and rates response after payrolls before AUDUSD entry; ticks and authentic release timestamps mandatory.
091. **CPI Volatility Cooldown Break** — Wait a fixed post-CPI cooldown, then trade acceptance outside the event range; no order at the release instant.
092. **FOMC Statement/Conference Disagreement** — Test reversal when the conference-phase move invalidates the earlier statement-phase move; preregister event-phase timing.
093. **Holiday Liquidity Reversion** — Trade bounded intraday reversion on a predefined bank-holiday calendar after strict spread checks; distinguish regional closures.
094. **Post-Holiday Inventory Catch-Up** — Test directional acceptance when a major center reopens after a holiday, conditional on the closed-center-period move.
095. **Month-Start Risk Reset** — A fixed first-business-day momentum/retracement rule tests allocation resets; calendar labels alone are not an edge.
096. **Gold Real-Yield Shock** — Test lagged gold response to a point-in-time real-yield shock with a structural entry; forward-filled releases cannot imply intraday knowledge.
097. **Gold/Silver Relative-Value Residual** — Trade only gold after a standardized gold-silver residual extreme and reversal confirmation; correlated-market synchronization required.
098. **Gold Futures/Spot Basis Dislocation** — Test spot reaction after futures-basis stress normalizes; futures rolls, funding and session gaps must be handled explicitly.
099. **Gold Safe-Haven Decoupling** — Define divergence from equities and USD in advance, then test trend persistence in the decoupling regime; no subjective crisis labeling.
100. **Fixed-Rule Ensemble Disagreement Filter** — Use a small preregistered set of independent signals and only trade agreement after prior disagreement; no backtest-selected weights or concurrent layering.

## Sequencing and acceptance

Implement price-only, reproducible hypotheses first (026–050). Next validate indicator/statistical approaches against simpler controls (051–075). Only then consider data-dependent cross-market/event work (076–100), after timestamp and licensing checks. Record every trial, including failed implementations and zero-trade variants. Overlapping histories already examined in 2024–2026 are exploratory, not pristine holdouts. Reserve genuinely untouched/prospective evidence before promotion.
