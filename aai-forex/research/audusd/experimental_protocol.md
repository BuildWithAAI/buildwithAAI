# AUDUSD research protocol — fixed before result review

Data: Dukascopy public daily M1 BID/ASK, 2018-01-01 to 2026-10-30, and hourly
BID/ASK from 2008 where used for descriptive conditioning. The project has no
Bybit execution data or contract specification. No account connection.

The study is a small family test, not a strategy search. Four strategies have
separate modules. Testing all 200/800 and 198/792 regimes is a documented
in-the-small sensitivity check; 198/792 cannot be chosen as 'best' in isolation.
No variant is declared tradable unless it has positive OOS expectancy after
costs, a meaningful sample, and acceptable robustness to spread/slippage.

Common execution: actual bid/ask candles, market entry at next bar open,
0.15 pip market slippage, 0.25 pip stop slippage. Stops first within a bar,
no optimistic intrabar ordering. Breakeven and trailing after +1R measured on
completed bars, never retroactively in the same bar. Entry signals at close t
execute at t+1 open. $100 compounding 1% target risk, 0.01 minimum lot/lot
step, all trades with minimum-lot initial risk above 3% skipped. Also $1000
at strict 1% (rounded down to 0.01) for comparison. $0 base commission unless
a separate $3.50/lot/side sensitivity is stated; $0 is not a claim Bybit is
commission-free. Assumed swap: -1.5% long / -1.0% short notional per year.
Actual spread from M1 open-to-open (clipped at 10 pips to contain feed errors)
plus fixed 0.8, 1.15, and 1.5 pip scenarios.

IS = 2018-01-02 through 2023-06-29 inclusive (generation/data boundaries may be
slightly adjusted). OOS = 2023-06-30 through 2026-10-30. Same chronological
boundary across all M15/M1 variants. A 1-year walk-forward robustness check
for any interesting family is performed without using its test year to tune it.
All tested variants and bootstrap/losing-streak stats go to results.json.

1. SCALP: M15, DST-aware London 07/08 UTC and NY 12/13 UTC for 02:00/07:00 CT,
US DST alignment is explicit. One order per NY trading day (first qualifying
breakout after London open, or after NY open in separate variants). Breakout
of prior 6 completed M15 bars (90 minutes). Initial stop 10 or 15 pips,
target 20/25/30 pips, max holding until 21:00 UTC NY close. Session attribution
not combined with the best performing subsequently. No trend filter in the
base variant (simple predeclared breakout). D1 trend filter is an explicit
secondary variant, not retrospectively chosen.

2. SNIPER: M15, first daily setup only at predeclared H4/D1 EMA band or prior
NY-day high/low, aligned to D1 Zoora regime (close vs EMA800 and EMA200>800).
Breakout of prior 2 completed M15 bars after price touches a key level
(within 5 pips) during London or NY windows. Stops 8/12/15 pips; targets 3R/5R
and 3R with trailing. No target by session-close if testing multi-R hold;
regime-off exits at next M15 open. A less selective base ('EMA only') and
combined EMA-or-prior-day-level family remain separately reported.

3. SWING: M15 execution of fully causal D1/H4 features (available only after
higher timeframe bar close). D1 or H4 Zoora regime. Pullback after M15 price
has touched running fast 20 EMA then closes back in the regime direction;
H4 regime bias also a separate session-breakout version. Stop 20 or 30 pips;
no fixed target; BE at +1R and trailing 20/30/45 pips, regime-off exit. Target
5R optional fixed control. Prior-day high/low breakout alternative with H4
band. Aim: not build from hindsight around Nov 5 move.

4. PICO: M1, M1 bar-close momentum and micro pullback/breakout around London/NY
opens. Initial stops 4 or 6 pips and targets 5 or 10 pips. No trailing or BE.
Max holding 15 minutes, first entry per session/day cap two trades. M5 entry
resampling is a secondary robustness check. Because M1 intra-bar stop/target
sequence is unknown, stop-first assumption is conservative; real spreads and
slippage already constitute 27–65% of target before commission.

No news filter in the basic strategy rules. Calendar characterization is
separate, with an explicit source and no invented macro releases.
