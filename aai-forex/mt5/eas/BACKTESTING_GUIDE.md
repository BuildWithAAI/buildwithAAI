# Backtesting guide — Windows MT5 / Bybit

**These are source-code research candidates, not validated products. No profitable EA was established by the earlier Python study. This batch has NOT been compiled or run in MT5 here.** Wine/MetaEditor is unavailable on this box. A Python static check does not compile MQL5 or prove correct indicator/execution behavior. Do not use real funds. The source explicitly refuses execution outside the Strategy Tester, including demo charts. No account credentials are included or needed by this package.

## 1. Install the source files

1. Unzip `AAI_EA_Library_batch1.zip` on your Windows PC. Its root folder is `eas/`.
2. In your installed MT5 terminal choose **File → Open Data Folder**. Use THIS terminal's data folder, not a guessed Program Files directory.
3. Copy `eas/Experts/AAI/` into `<MT5 data folder>\MQL5\Experts\AAI\`.
4. Copy `eas/Include/AAI/` into `<MT5 data folder>\MQL5\Include\AAI\`.
5. The common file must end up at `MQL5\Include\AAI\AAI_Common.mqh`. Standard `<Trade/Trade.mqh>` comes with MT5. No extra libraries, DLLs, Python packages or web access are required by the EAs.
6. Keep the catalog, roadmap, guide, generator, static checker, manifest and logs outside MQL5 if desired. They are documentation/development tools, not runtime dependencies. EAs do not need the Python generator to run.

## 2. Compile before any performance testing

- Press F4 to open MetaEditor. Open each of the 25 `.mq5` files and press F7.
- Require **zero errors** and review every warning; do not dismiss implicit-conversion/API warnings as irrelevant. Save compiler version and full compiler log. An `.ex5` should appear beside each source. This package deliberately includes no invented/precompiled `.ex5` files.
- If an include is missing, check folder nesting first: `Include\AAI\AAI_Common.mqh`, not `Include\eas\Include\AAI`.
- If there is a compiler/API issue, preserve the exact message and line number. Fix the source and repeat all affected builds. Shared-include fixes require rebuilding all 25 EAs. A change invalidates previous compiled artifacts and requires a versioned trial log.

Optional batch compilation from a Windows terminal (replace paths; supported MetaEditor flags):

```powershell
$editor = 'C:\Path\To\MetaTrader 5\metaeditor64.exe'
$eaFolder = 'C:\Actual\MT5\Data\MQL5\Experts\AAI'
Get-ChildItem $eaFolder -Filter '*.mq5' | ForEach-Object {
    & $editor "/compile:$($_.FullName)" "/log:$($_.FullName).compile.log"
}
```

The command's process exit is not itself a compilation-success certificate: inspect every log and `.ex5` timestamp. GUI F7 is the primary path if your installation differs.

## 3. Confirm broker specifications, units, and costs

Using YOUR authorized demo/testing terminal, right-click AUDUSD+ or XAUUSD+ in Market Watch → Specification. Record actual contract size, account currency, digits/point, tick size/value/loss value, minimum/step/maximum volume, margin/leverage and stop-out, stops/freeze levels, trading sessions, swap type/values/triple-swap day, and commission. No account login or broker spec has been verified for you by this batch.

- AUDUSD 5 digits: typically point 0.00001, pip 0.0001. Verify rather than infer dollars solely from the symbol name.
- Gold: pip has no universal definition. Set `PipSizeOverride` explicitly, for example **0.10 price units** if you choose that convention. This changes StopPips/TargetPips/TrailPips and grid/buffer units; ATR/structural stops remain price-based. Do not mistake 20 points for $20.
- Default `MaxSpreadPoints=20` is an AUDUSD starting filter and may exclude essentially all gold quotes. Choose a defensible gold ceiling from observed broker ticks, not a permissive one just to produce trades.
- Commission reserve defaults to 7 account-currency units per full lot round-trip. It changes LOT SIZING ONLY. It does **not charge commission to the backtest**. Verify the tester account/symbol settings actually charge the correct commission and swap in the report. If the terminal version does not expose a commission control, use a properly configured custom/test account or export deals and deduct documented costs externally. A zero-commission report is not a realistic net result merely because the EA reserved fees.
- Use actual variable bid/ask spreads in real ticks. Do not additionally subtract the same spread from reported PnL. Slippage reserve likewise changes planned size, not fills: use tester execution-delay settings and an external cost stress check; do not pretend it injects slippage.
- `RiskPercent=1`, `MaxRiskPercent=2`, `AllowMinimumLot=true`: a 0.01 minimum can be accepted above 1% but never above 2% reserved planned risk. For strict 1% set `AllowMinimumLot=false`. `FixedLot=0.01` still cannot breach 2%. Do not raise or remove this cap to force a backtest. Any gap, swap or unmodeled slippage can still push REALIZED losses above a planned cap.
- Many gold and swing strategies should take zero $100 trades. That is a legitimate feasibility failure, not a code reason to use artificially small stops. A separate larger-deposit diagnostic must be labeled as such and does not establish $100 feasibility.

## 4. Time zones and history

Inputs are a deterministic UTC clock, not the PC's clock:

`UTC time = broker server timestamp - ServerGMTOffsetMinutes`.

Default server +120 minutes is unverified. Default London 08 UTC and New York 13 UTC are winter 08:00 local forex-session opens, not NYSE cash open. During summer they are usually 07 and 12 UTC. UK/US DST transition dates differ. Broker server DST can change independently.

For a valid historical test, split into periods with correct fixed offsets, retaining a calendar and settings log, or implement and separately validate a date-dependent timezone table before running a continuous DST-spanning test. Do not claim a winter-only schedule is local-session accurate over an entire year. In Chicago, London 08 UTC is 02:00 CST and New York 13 UTC is 07:00 CST; summer/mismatch weeks differ. The EAs never use the computer's Chicago timezone to set broker bars.

Generic entry session defaults to all weekdays. Custom session strategies examine the completed signal bar's OPEN in their window; the next-bar entry may occur after that opening window ends. Daily counters/loss limits use UTC dates, NOT the earlier Python study's NY-close trading date. Prior D1/W1 levels use broker bars. Asia ranges are defined in UTC 00–06, require every M5 bar, and skip incomplete ranges. These conventions are explicit differences, not exact Python-research reproduction.

Download sufficient authentic history on every referenced timeframe: M1/M5, SignalTF, H4 and/or D1. Slow EMA800 needs at least **2400 calculated bars** in this implementation (3x period), beyond the earlier Python warmup. MT5 may supply less pre-test history than needed; start the test earlier and treat initial unavailable-history months as warmup. M1 strategies need at least 300 signal bars and genuine bid/ask ticks. Confirm all multi-timeframe bars are completed and aligned visually. Sparse data cannot be made reliable by increasing the date span setting.

## 5. First functional Strategy Tester run

1. Press Ctrl+R. Select one Expert under AAI, actual broker symbol (start AUDUSD+), and its catalog baseline timeframe. `SignalTF` is the operative input; #003 deliberately rejects anything other than H1. Use each EA separately initially.
2. Set a **$100 USD deposit**, verified leverage, no optimization, and **Every tick based on real ticks**. Choose an interval with real ticks available. Inspect tester quality, gaps, spread availability and Journal for any fallback to generated ticks; do not silently treat generated data as real.
3. Load baseline defaults, then set verified server/session offsets, commission sizing reserve, spread ceiling and gold pip units where appropriate.
4. Use visual mode on a short interval. Inspect every first entry, attached SL/TP, bid-versus-ask trigger, indicator values, stop rounding to tick size, and broker stops/freeze behavior. Plot standard indicators separately if necessary. EAs do not automatically attach their indicators to the visual chart.
5. Verify a signal uses only bar 1 or older and executes no earlier than the new bar's first tick. For Ichimoku inspect the **visible** cloud: positive CopyBuffer shifts are deliberate; no future Chikou reference. For Supertrend compare replay/seed output with a separately checked causal reference. For Chandelier confirm extrema only include completed bars since the entry bar.
6. Confirm a trade above the minimum-lot risk budget prints a skip, not a too-tight SL or unbounded size. Count unique entry orders, not individual partial-fill deals. Check netting behavior if other symbol positions are present in a separate test harness.
7. Confirm daily-loss exits, max-entry limits, time exits, regime exits, no-SL emergency exits, and monotone trailing. Deliberately set invalid inputs and verify initialization refuses them. Check the hard Strategy-Tester-only lock on a demo chart without any live account use: initialization should fail before a trade is sent.
8. Entry fills outside reserve cause an emergency close; this is not guaranteed to avoid a realized overshoot. Check Journal failures and rejects, not just balance curve.
9. Save settings `.set`, source SHA256, compiler log, tester report and deals, data coverage/quality and screenshots of edge cases. A strategy with zero trades may reflect proper risk vetoes, warmup, offsets, missing ranges, or restrictive pattern frequency; inspect the Journal before altering anything.

**Do not run all 25 concurrently on $100.** These files do not implement a shared portfolio risk controller. Their daily limits are EA/symbol-local. On netting accounts, their symbol-position guard prevents merging with existing positions, but a portfolio test requires purpose-built scheduling and aggregate exposure controls.

## 6. Freeze trials; walk forward without hidden selection

1. Write each hypothesis, rationale, baseline rules, instrument, costs, risk settings, data exclusions, offsets, search bounds, selection rule and rejection criteria BEFORE evaluating returns. Save every version and every failed/zero-trade result in `TRIAL_LOG_TEMPLATE.csv` (copy it for actual work).
2. The earlier Zoora and four-bot studies already examined overlapping **2024–2026** history. Calling it OOS again does NOT make it pristine. Its reuse here is exploratory retrospective walk-forward evidence only. Do not claim untouched validation unless its provenance truly supports that claim.
3. For retrospective diagnostics, choose rolling **three-year development / one-year forward-test** windows where data permits. No random train/test split. Optimize only a tiny prespecified grid in the development window, then freeze rules/settings and costs for the next forward window. Overlapping feature warmup is allowed; outcomes/selection are not.
4. Keep final genuinely untouched data or prospective observations sealed until development is finished. Record a timestamped rule/cost/source freeze before opening it. If the result changes the strategy, that holdout is spent; future independent evidence is required.
5. Either start each fold flat (document boundary liquidation costs) or carry positions under one predeclared continuous-capital protocol; never cherry-pick the better accounting. Load only past warmup history, not future indicator values.
6. Include ALL 25 families and every parameter variant in the trial count. A lucky best-of-100 PF is not evidence of an edge. Report family-level multiplicity, bootstrap uncertainty, concentration by year/session/direction, and walk-forward failures, not just the winner.
7. Run baseline costs and prespecified stress: wider observed spread scenarios, +0.5/+1 pip loss-side slippage where applicable, realistic random/fixed execution delay, higher commissions, and proper swaps. Gold cost stress must be in correct price/tick units. Sparse 45-trade results remain inconclusive.
8. Compare with simpler/no-filter controls, a continuation versus reversal control where appropriate, and flat cash. Track account stalls from lot-step/margin/risk limits. A $100 account with no activity does not have a trading edge.

## 7. Minimum promotion criteria (not profit certification)

On aggregated, non-overlapping chronological OUT-OF-SAMPLE trades, after realistic costs:

- **Profit factor > 1.2** (strictly greater).
- **At least 100 closed trades** for the candidate; fewer is inconclusive, not a pass.
- **Maximum EQUITY drawdown < 25%** (strictly less; inspect intratrade equity, not just balance drawdown).
- Positive net expectancy across multiple forward windows, no single year/handful of news trades carrying everything, reasonable adjacent-setting stability, survivable cost stress, no risk or code violations, and an honest uncertainty interval.
- Repeat the feasibility run at exactly $100 and actual minimum volume, not only a larger diagnostic deposit.

These thresholds are screening gates, not guarantees, and cannot erase multiple-testing bias. The next step after independent confirmation is a separately authorized forward/demo study. Four to eight weeks of demo can establish operational correctness but rarely prove profitability, especially for sparse sniper/swing systems. This package cannot run on a demo chart without a separately reviewed implementation change. No publishing, selling, buying, funded-account access or live trading is part of this delivery.

## 8. Local checks and known limitations

On a machine with Python 3:

```text
python3 tools/static_check.py
python3 tools/test_policy_math.py
```

On Windows the launcher may be `py -3` instead of `python3`. No third-party packages required. The generator `tools/build_library.py` recreates the 25 sources, manifest and catalog; it does not overwrite the common engine or the guide. If you edit generated files, update the generator too or a rebuild will overwrite your edits.

Static checks inspect delimiters, entry points, magic uniqueness, shared-safety tokens, forbidden API/pattern absence and closed-bar signal conventions. Math tests are an independent Python model of policy calculations, NOT execution of the MQL5 implementation. Neither checks MQL5 types, broker execution, economic edge or every semantic bug. Compiler and visual/synthetic scenario tests remain mandatory.

Known caveats: finite Supertrend seed; current spread used to approximate completed short close for trailing; UTC sessions and counters differ from Python NY-close tests; fixed offsets do not automatically handle DST; PnL loss denominator assumes no mid-day balance transfers and ignores separately booked non-trade fees; full overnight floating is counted, not midnight mark-to-market; daily latch and initial R are memory state (restart changes behavior); historical broker commission/swap availability may be incomplete; full-history per-tick daily deal scans prioritize simplicity over optimization speed. No virtual terminal-side SL fallback: the broker must accept the attached SL or the entry fails.

## Official API references consulted for source review

- https://www.mql5.com/en/docs/indicators/iichimoku (buffers and displacement)
- https://www.mql5.com/en/docs/standardlibrary/tradeclasses/ctrade/ctradesettypefillingbysymbol
- https://www.mql5.com/en/docs/constants/environment_state/marketinfoconstants (tick value, volume, stops/freeze and metal/FX calculation modes)
