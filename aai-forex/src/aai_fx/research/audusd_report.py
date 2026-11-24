"""Render the empirical AUDUSD report exclusively from saved result values."""
from __future__ import annotations
import json
from pathlib import Path


def fmt(x,n=2):return '—' if x is None else f'{x:,.{n}f}'

def render(r:dict)->str:
    d=r['characterization'];by={x['id']:x for x in r['h1_variants']}
    pico=[x for x in r['short_intraday_checks'] if x['family']=='PICO']
    pc=max(pico,key=lambda x:x['results']['1000']['is'].get('expectancy_r',-999))
    chosen=[by[r['is_selected_champions'][f]] for f in ['SCALP','SNIPER','SWING']]+[pc]
    L=['# AUDUSD: SCALP, SNIPER, SWING and PICO research',f"Generated {r['generated_at_CT']} (America/Chicago, CT). Historical simulation only. No live account accessed.",'',
    '## Bottom line',
    '**AUDUSD offers tradable-sized movement, but these rules do not establish a profitable edge.** A 130-pip move at 0.01 lot is about $13 gross on a USD account. Capturing it requires the right entry, surviving intervening pullbacks, and a workable exit; the range itself is not an expected return. No tested family is approved for live trading.',
    '',
    '- SCALP: reject the tested long-history breakout rules after costs.',
    '- SNIPER: the selective H4 EMA-level version is the least bad research lead, approximately flat on only 45 OOS trades. Inconclusive, not profitable proof.',
    '- SWING: runners did catch 100+ pip trades, but repeated tight-stop losses outweighed them. Reject the tested rules.',
    '- PICO: negative in every short M5 test; the data cannot support a robust conclusion about all ultra-short scalping. Do not deploy this version.',
    '',
    '## 1. Data, execution and validation',
    f"- Long source: **{r['data']['H1_rows']:,} recorded Dukascopy H1 BID/ASK bars**, January 2008–October 30, 2026. Descriptive work uses this entire span; strategy evaluation starts January 2018. Separate side highs/lows are preserved; midpoint is used only for features. Negative quoted-open spreads and zero-volume filler bars are excluded.",
    '- Development (IS): January 2018–June 29, 2023. OOS: June 30, 2023–October 30, 2026. Each segment starts with a fresh account; full-period results are also saved. H4/D1 EMAs use the pre-2018 H1 history, true completed NY+7 bar availability as of each signal-bar OPEN (a conservative extra bar lag at higher-timeframe boundaries), and roughly 1,843 higher-timeframe bars of EMA800 seed warmup.',
    '- IMPORTANT: the intended multi-year Dukascopy M1 download failed with TLS errors. Raw partial caches were preserved but NOT treated as a complete dataset. The long studies therefore execute **on H1**. SCALP and SNIPER H1 results are coarse proxies, not validation of M15 precision. SWING H1 is a legitimate separate entry timeframe.',
    '- Stored Yahoo M15/M5 checks cover only September 3–October 30, 2026, with synthetic spread because they are indicative mid quotes. Their own chronological 70/30 split leaves about 12 trading days OOS. Yahoo M1 is mostly two-minute cadence and is not used. PICO uses regular M5 bars, not tick data.',
    '- The final grid has 16 H1 variants (4 scalp, 4 sniper, 8 swing), the same 16 short M15 checks, and 4 PICO M5 variants. Every variant is reported, including losers and zero-trade controls. This is exploratory research, not a pristine never-before-seen holdout: earlier Zoora studies already looked at overlapping history. Small parameter grids and chronological splits reduce, but do not eliminate, data-snooping risk.',
    '',
    '### Cost and account assumptions',
    '- Baseline: recorded H1 bid/ask; $3.50 commission per standard lot per side; 0.15 pip entry/market-exit slippage; 0.25 pip stop slippage. Synthetic intraday spread is 1.15 pips. Fixed 0.8/1.5 pip, zero-commission, higher-slippage and zero-friction controls are saved. **These are not confirmed Bybit AUDUSD+ specifications.**',
    '- Swap: assumed -1.5%/year of long notional and -1.0% short, charged on crossed UTC calendar days including weekends. This is an approximation, not actual MT5 daily/triple-swap accounting. No positive carry is assumed.',
    '- $100 account: USD, 0.01 minimum lot and lot step. Target risk is 1% of current equity; if that rounds below 0.01, take 0.01 only when the initial stop loss plus stop slippage and commission is within 3%. Otherwise skip. Margin limits are imposed at 10:1 assumed leverage; lot size is capped by available margin. It starts at 0.01 and only steps when equity, risk and margin permit. A loss may shrink the account until it cannot take another trade.',
    '- Comparison: $1,000, strict maximum 1% initial risk, rounded down in 0.01-lot steps; never force a minimum lot above 1%. Realised loss can exceed planned risk through gaps, financing or slippage. A nominal 30-pip stop costs about $3.095 at 0.01 under this commission/stop-slip assumption, so the $100/3%-cap control takes **zero trades**, not a hidden oversized trade.',
    '- Stops/targets are set relative to the actual fill price. Thus a fixed 12-pip execution stop is not guaranteed to lie beyond a chart structure; the strategy must earn that assumption in testing. Spread is paid through bid/ask prices rather than double-counted in the risk denominator.',
    '- Signals at a completed bar close fill next bar open. Existing stops/targets are checked within each bar, stop first if both touch. A pre-scheduled exit fills at the next open, before checking that bar range. BE/trailing changes based on close t can protect only t+1, never retroactively. Positions are liquidated once at each segment end. Open positions cannot leak across IS/OOS segments.',
    '- One open position; no pyramiding, martingale, averaging down or partial exits. A half-partial is not practical at 0.01 lots with a 0.01 close step. Research disables production drawdown/daily kills to expose raw strategy behaviour, but never edits live risk policy. Drawdown is close-marked, not worst intrabar drawdown. No tick ordering, broker stop-distance rule, requotes, latency, news-spread spikes or stop-out threshold is modelled. No forced tighter chart stops to make risk look smaller.',
    '',
    '## 2. What AUDUSD actually offers',
    f"Across {d['daily']['days']:,} complete-enough NY-close sessions, the median daily range was **{fmt(d['daily']['range_pips']['p50'],1)} pips** (90th percentile {fmt(d['daily']['range_pips']['p90'],1)}). Median H1/H4 ranges were **{fmt(d['H1_range_pips']['p50'],1)}/{fmt(d['H4_range_pips']['p50'],1)} pips**.",
    f"A daily high-low range of 100+ pips occurred on {fmt(d['daily']['range_ge100_pct'],1)}% of days; a **100+ pip net open-to-close move** occurred on only {fmt(d['daily']['directional_ge100_pct'],1)}%, and 130+ on {fmt(d['daily']['directional_ge130_pct'],1)}%. High-low range is not a move available from one known entry.",
    '', '| Year | Median daily range | Days with 100+ pip range | Days with 100+ pip open-close |', '|---|---:|---:|---:|']
    for year in ['2024','2025','2026']:
        x=d['by_year'][year];L.append(f"| {year} | {fmt(x['range_pips']['p50'],1)} | {fmt(x['range_ge100_pct'],1)}% | {fmt(x['directional_ge100_pct'],2)}% |")
    L += ['', '2026 ends October 30; the November 5/6 move discussed in chat is outside this dataset and was not used to tune or validate a setup. The earlier high-volatility years inflate full-history averages. Multi-day 100-pip runs are possible even when daily net movement is smaller.',
    '', '| Session window (local) | Chicago opening hour(s), CT | Median session range | Median H1 range | Median quoted-open spread |', '|---|---|---:|---:|---:|']
    for name,x in d['sessions'].items():L.append(f"| {name}: {x['local_window']} | {', '.join(f'{h:02d}:00' for h in x['Chicago_open_hours'])} | {fmt(x['session_range_pips']['p50'],1)} | {fmt(x['H1_range_pips']['p50'],1)} | {fmt(x['quoted_open_spread_pips']['p50'],1)} |")
    L += ['', 'Session windows overlap and must not be added. Sydney starts on the prior Chicago calendar day; its 15:00/16:00/17:00 shifts reflect opposing DST seasons. Tokyo begins 18:00/19:00 CT the prior day. London is usually 02:00 CT and becomes 03:00 in DST-mismatch weeks. New York 08:00 is 07:00 CT. This is forex-session convention, not an equity cash-open strategy; no 08:30 CT cash-open variant was tested.',
    '', '### What preceded big moves?',
    f"The preceding daily range before a 100+ pip net-move day had median **{fmt(d['prior_day_range_before_100pip_days']['p50'],1)} pips**, versus {fmt(d['all_prior_day_ranges']['p50'],1)} generally: volatility clustered. This does not identify the direction or imply a low-risk entry."]
    for tf,x in d['prior_regime_direction_on_big_days'].items():L.append(f"- The already-known {tf} 200/800 regime pointed in the eventual big-day direction on {fmt(x['correct_prior_regime_direction_pct'],1)}% of {x['big_days']} eligible 100-pip days. Neutral/unwarmed regimes excluded; **no strong directional prediction is established**.")
    L += ['', '| News-day label | Eligible event days | Median range, event / other | 100+ pip net day, event / other |', '|---|---:|---:|---:|']
    for name in ['RBA_official','US_payroll','US_CPI','US_FOMC','AU_employment']:
        x=d['macro_days'][name];a,b=x['event_days'],x['other_days'];L.append(f"| {name} | {a['days']} | {fmt(a['range_pips']['p50'],1)} / {fmt(b['range_pips']['p50'],1)} | {fmt(a['directional_ge100_pct'],1)}% / {fmt(b['directional_ge100_pct'],1)}% |")
    L += ['', 'RBA dates are from official annual decision archives (2008–2026), saved with source URLs in `rba_dates.json`, filtered to available price days. Other event dates use the secondary Forex Factory archive only through April 2025; midnight placeholders were excluded, leaving sparse/selected subsets, especially US payrolls. These US/Australian-data comparisons are **descriptive and incomplete, not reliable effect estimates or strategy filters**. Neither direction of a surprise nor spreads at the instant of release is established. Session opens often have more movement, but range comparisons do not prove that open-breakout trading has edge.',
    '', '### Friction matters more as targets shrink',
    'With a 0.8–1.5 pip spread, 0.15 pip slippage on entry and market exit, and $7/lot round-trip commission (=0.7 pip), the illustrative market-order hurdle is **1.8–2.5 pips**. That is **36–50% of a 5-pip target**, 18–25% of 10 pips, 9–12.5% of 20 pips, or 6–8.3% of 30 pips. Limit-target exits can differ; stop slippage adds further loss-side friction. The exact simulation uses bid/ask triggers, not this percentage shortcut.',
    '', '## 3. Four-strategy comparison',
    'Representatives below are selected by IS strict-$1,000 expectancy, not by the best OOS result. All their IS expectancy values were negative: “selected” does not mean “qualified.” PICO uses its short M5 split and is not comparable to the 3.34-year H1 OOS period.',
    '', '| Family / representative | $100 → OOS equity | CAGR | Max DD | Trades | Win % | Avg R | PF | Longest loss streak | Verdict |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|']
    verdict={'SCALP':'Reject tested rule','SNIPER':'Inconclusive; costs fragile','SWING':'Reject tested rule','PICO':'Short-data negative; unproven'}
    for x in chosen:
        m=x['results']['100']['oos'];L.append(f"| {x['family']} {x['id']} | ${fmt(m['ending_equity'])} | {'not meaningful' if x['family']=='PICO' else fmt(m['cagr_pct'])+'%'} | {fmt(m['max_drawdown_pct'],1)}% | {m['trade_count']} | {fmt(m.get('win_rate_pct'),1)} | {fmt(m.get('expectancy_r'),3)} | {fmt(m.get('profit_factor'))} | {m['longest_losing_streak']} | {verdict[x['family']]} |")
    L += ['', '### Feasibility under the CURRENT 2% risk limit',
    'The main $100 tables above deliberately use the user-preference **3% research ceiling**, not live authorisation. Feasibility below uses the current **2% agent-guard cap** and 0.01 lots on a standard 100,000 AUD contract. Bybit AUDUSD+ contract details remain unconfirmed. “Feasible” refers only to this initial stop/cost budget, not a profitable setup or live approval. The account must pass the same check again after every balance change.',
    '', '| Representative | 0.01-lot planned stop loss incl. assumed fees/stop slip | Current 2% feasible at $100? | 3% research ceiling? | $100 OOS equity under current 2% cap |', '|---|---:|---|---|---:|']
    for x in chosen:
        risk=(x['params']['stop_pips']+.25)*.1+.07
        guard=x.get('current_guard_2pct_oos_100',{})
        L.append(f"| {x['family']} {x['id']} | ${fmt(risk,3)} | {'YES' if risk<=2 else 'NO — not feasible at $100'} | {'YES' if risk<=3 else 'NO'} | ${fmt(guard.get('ending_equity'))} |")
    L += ['', 'A 30-pip stop is not feasible at $100 under either ceiling after these assumed costs. A 20-pip swing stop is not feasible under 2%; it is conditionally feasible only in the 3% research simulation. Even a nominal 20-pip stop before commission leaves no cushion at a 2% live limit. No limit was changed.',
    '', '| Same rules, strict 1%-risk $1,000 | Final equity | CAGR | Max DD | Trades | Win % | Avg R | PF | Loss streak |','|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for x in chosen:
        m=x['results']['1000']['oos'];L.append(f"| {x['family']} {x['id']} | ${fmt(m['ending_equity'])} | {'not meaningful' if x['family']=='PICO' else fmt(m['cagr_pct'])+'%'} | {fmt(m['max_drawdown_pct'],1)}% | {m['trade_count']} | {fmt(m.get('win_rate_pct'),1)} | {fmt(m.get('expectancy_r'),3)} | {fmt(m.get('profit_factor'))} | {m['longest_losing_streak']} |")
    L += ['', 'Small-account histories differ from strict-$1,000 histories because lot rounding and risk/margin stalls change which trades can be taken. Neither is a promise to earn the same return in live trading.',
    '', '### SCALP: exact representative rules (H1_01)',
    '1. Signal H1 bars open at 08:00, 09:00 or 10:00 Europe/London; their closes/next-open entries are 09:00, 10:00 or 11:00. Compare bid close to the highest bid high / lowest bid low of the prior **two completed H1 bars**. Buy an upside close-break; sell a downside close-break. No Zoora trend filter.',
    '2. First qualifying signal per NY+7 trading date only; one open position. Enter next H1 open; fixed **15-pip execution stop**, **30-pip target**. No BE/trailing. Exit at the next available open after the NY session ends, or stop/target first. There may be no trade on a day.',
    '3. M15 checks use six preceding bars (90 minutes), not a claim that two H1 bars are equivalent. The other predeclared scalp variants use London/NY windows and 10/20 or 15/30 stop/target pairs.',
    '**Verdict:** negative IS and OOS; even the zero-friction H1 representative remains negative. The market can move 20–30 pips without this breakout being the right entry. Do not interpret the daily target as an income target.',
    '', '### SNIPER: exact research lead (H1_04)',
    '1. Completed **H4** EMA200/800 regime: long only when H4 close > EMA800 and EMA200 > EMA800; short only when H4 close < EMA800 and EMA200 < EMA800. Flat/unknown regime: no entry.',
    '2. Key level is H4 EMA200 for long entries and H4 EMA800 for shorts. Signal bar range must overlap level ±5 pips. For bars opening 08:00–10:00 London or 08:00–10:00 New York local (signals/entries 09:00–11:00), the bid close must also break the prior two H1 highs (long) / lows (short). First qualifying signal per NY trading date, next-open market entry.',
    '3. **12-pip stop, 36-pip target (3R gross)**, BE to entry after a completed close reaches +12 pips; BE is not cost-free and does not lock in commission/swap. Exit next bar when the higher-timeframe regime changes. No trailing in this representative.',
    '4. Other sniper variants use D1 instead of H4, or add prior completed NY-session high/low as an alternative level. Their H1 precision is still only a coarse proxy; M15 variants are independently labelled in the appendix.',
    '**Verdict:** least bad candidate for future broker-data research, not deployment. Its OOS $100 result is roughly flat, not reliable compounding. The long OOS rate is only about 13–14 trades/year. Many losing trades are tiny BE exits after fees, so win rate alone is misleading.',
    '', '### SWING: exact representative rules (H1_11)',
    '1. Fully completed **D1 EMA200/800** regime as defined above. H1 bid EMA20 is the entry reference. A bar must overlap EMA20 ±2 pips and close above it for a long regime / below it for a short regime. First qualifying signal each NY trading date; no pyramiding; enter next H1 open.',
    '2. **20-pip stop**, no fixed target. After a completed H1 close is +1R, raise stop to entry. Once close profit is ≥1R, ratchet a **45-pip close-based trailing stop** (long close minus45, short ask close plus45); never loosen an existing stop. Exit next bar when D1 regime changes or becomes neutral. Holds may span days; not all trades become swings.',
    '3. Alternatives test H4 bias, 32-bar H1 breakout (8 hours on M15), 20/25/30 pip stops, 30/45 pip trails, a 5R fixed-target control and an explicit 198/792 sensitivity. Fixed pip trails, not ATR/structure/EMA trailing optimisations, were tested. Partial exits were not tested.',
    '**Verdict:** catching occasional large moves did not overcome the stop-outs. The strict-$1,000 representative captured nine 100+ pip gross trades OOS and still lost money. The 198/792 H4 sensitivity also lost. Moving exits farther away is not, by itself, an edge.',
    '', '### PICO: exact short-data representative (M5_03)',
    '1. M5 bars opening 08:00–09:55 New York local (07:00–08:55 CT); first possible entry 08:05 New York /07:05 CT. Compare bid close to the prior two M5 bid highs/lows (10-minute range). First qualifying break per NY trading date, next M5 open entry.',
    '2. **6-pip stop, 10-pip target, maximum 15 minutes**. No BE/trailing; timed exit after three full M5 bars at the next open. London-window alternatives use 08:00–09:00 London local; other tested stop/target pair is 4/5 pips. All four variants and spread scenarios are shown below.',
    '3. Only 41 full-sample trades and 12 short OOS trades per variant. M5 OHLC cannot establish intraminute path or a true 4-pip execution edge. The irregular stored M1 data was rejected, not upsampled or filled in.',
    '**Verdict:** negative exploratory results, high costs, no qualified bot. No meaningful CAGR can be inferred from eight weeks (or 12 OOS trades); annualised numbers remain machine fields only and must not be marketed.',
    '', '## 4. Robustness, walk-forward and practical ruin',
    'The walk-forward selector trains on the preceding three calendar years and tests the following year (2021–2026, final partial year). It chooses the family variant with the best net training average R only if ≥25 trades and positive expectancy; otherwise holds cash. One continuous test account, not freshly reset yearly accounts. Year-boundary positions close next open before a new selection.',
    '', '| Family | Annual choices 2021→2026 | $100 final | $1,000 final | Strict-$1,000 trades |', '|---|---|---:|---:|---:|']
    for family,x in r['walkforward'].items():L.append(f"| {family} | {', '.join(w['chosen_id'] for w in x['windows'])} | ${fmt(x['accounts']['100']['ending_equity'])} | ${fmt(x['accounts']['1000']['ending_equity'])} | {x['accounts']['1000']['trade_count']} |")
    L += ['', 'A selector staying in cash is not a profitable strategy. No honest multi-year walk-forward is possible for PICO on the available M5 sample.',
    '', '| IS-selected H1 rule | OOS expectancy 95% block-bootstrap interval, R | Zero commission R | 1.5-pip spread R | High-slippage R |', '|---|---:|---:|---:|---:|']
    for x in chosen[:3]:
        ci=x['bootstrap'].get('expectancy_r_ci95');s=x['oos_cost_sensitivity_1000'];L.append(f"| {x['id']} | {fmt(ci[0],3)} to {fmt(ci[1],3)} | {fmt(s['no_commission'].get('expectancy_r'),3)} | {fmt(s['spread_15'].get('expectancy_r'),3)} | {fmt(s['high_slippage'].get('expectancy_r'),3)} |")
    L += ['', 'The sniper changes sign with commission and modest spread assumptions; its interval is extremely wide. None is a robustly positive estimate. “High slippage” is 0.5 pip market /1.0 pip stop. Baseline historical recorded spreads and constant synthetic spreads are not identical trade samples.',
    '', 'Risk-of-ruin style checks use 1,000 resampled paths of five-trade blocks, preserving limited short-term dependence, then simulate $100 lot-step sizing, 3% stop-risk cap and 10:1 margin. These are conditional historical stress tests, **not true future ruin probabilities**; unseen gaps or regime changes may be worse.',
    '', '| Rule | Resampled final equity, p05 / median / p95 | Fraction stalled by risk/margin | Fraction touching $50 |', '|---|---:|---:|---:|']
    for x in chosen[:3]:
        b=x['bootstrap'];L.append(f"| {x['id']} | {' / '.join('$'+fmt(z) for z in b['final_equity_p05_p50_p95'])} | {fmt(100*b['fraction_risk_or_margin_stalled'],1)}% | {fmt(100*b['fraction_touching_50dollars'],1)}% |")
    L += ['', 'Stopping around $60–$70 can mean insufficient margin or a minimum-lot risk breach, not successful capital preservation by a profitable system. No $0 event in this capped simulation does not mean zero real ruin risk. Actual maximum loss streaks, gaps beyond 1R, and equity drawdowns are in each account table and `results.json`.',
    '', '### Realistic expectation for $100',
    'A 20-pip stop at 0.01 risks roughly $2 before costs; under this baseline initial risk is about $2.095. A 130-pip trade makes roughly $13 gross only if the entire entry-to-exit move is captured, less costs and financing. Several failed attempts can absorb it. A 12-loss streak at 0.01 can be material even when many losses are BE scratches. Do not target 13% every day or assume one big winner compounds regularly.',
    'The selected H1 rules did not earn a lot-size step upward in the $100 OOS tests. Test $100 only in a genuinely authorised demo/paper execution study after the broker specification and fine-grained data are available; this report is not live permission. The existing Security policy may cap live risk below the research 3%; it was not changed.',
    '', '## 5. All tested variants — no winner hiding',
    'Full/IS/OOS equity, CAGR, drawdown, win rate, average R, PF, trades, streaks, risk percentages, cost stress tests and paths are machine-readable in `results.json`; OOS trade CSVs allow independent checking. Tables below show the long OOS results for every rule. Parameter dictionaries are exact code inputs.',
    '', '| ID / family | Parameters | $100 final | $1000 final | $1000 CAGR | DD | n | Win % | Avg R | PF | Loss streak |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for x in r['h1_variants']:
        a=x['results']['100']['oos'];m=x['results']['1000']['oos'];L.append(f"| {x['id']} {x['family']} | `{json.dumps(x['params'],separators=(',',':'))}` | {fmt(a['ending_equity'])} | {fmt(m['ending_equity'])} | {fmt(m['cagr_pct'])}% | {fmt(m['max_drawdown_pct'],1)}% | {m['trade_count']} | {fmt(m.get('win_rate_pct'),1)} | {fmt(m.get('expectancy_r'),3)} | {fmt(m.get('profit_factor'))} | {m['longest_losing_streak']} |")
    L += ['', 'Initial feasibility for every long-history variant is also explicit:',
    '| ID | 0.01-lot planned risk $ | Current 2% / $100 | Research 3% / $100 |', '|---|---:|---|---|']
    for x in r['h1_variants']:
        L.append(f"| {x['id']} | {fmt(x['minlot_initial_risk_dollars'],3)} | {'feasible' if x['feasible_at_100_current_2pct'] else 'NOT feasible'} | {'feasible' if x['feasible_at_100_research_3pct'] else 'NOT feasible'} |")
    L += ['', '### All short-data checks', '| ID / family | $100 full → OOS equity (separate fresh accounts) | OOS trades ($1,000) | OOS average R | OOS PF |', '|---|---:|---:|---:|---:|']
    for x in r['short_intraday_checks']:
        a=x['results']['100'];m=x['results']['1000']['oos'];L.append(f"| {x['id']} {x['family']} | ${fmt(a['full']['ending_equity'])} / ${fmt(a['oos']['ending_equity'])} | {m['trade_count']} | {fmt(m.get('expectancy_r'),3)} | {fmt(m.get('profit_factor'))} |")
    L += ['', 'Some M15 rows look positive on just one or a few trades. They neither override the long-study losses nor validate that future M15 trading will fail; the data is simply inadequate for that claim. M15 parameters correspond to the same numbered H1 family with the entry lookback/timeframe differences stated above. All dictionaries and split dates are in JSON.',
    '', '## 6. Reproduce, audit and next research gate',
    '```bash','cd /workspace/aai-forex','.venv/bin/python scripts/audusd_research.py','.venv/bin/python -m pytest','.venv/bin/python -m mypy src','```',
    '- Report: `research/audusd/report.md`; data/results: `results.json`, `characterization.json`, `rba_dates.json`, individual OOS and walk-forward trade CSVs.',
    '- Orchestration: `src/aai_fx/research/audusd.py`; engine: `audusd_engine.py`; statistics/data/features: `audusd_stats.py`, `audusd_data.py`, `audusd_features.py`; modular strategy classes: `audusd_strategies/scalp.py`, `sniper.py`, `swing.py`, `pico.py`. Research assumptions also in `configs/audusd.yaml` (runner uses the explicitly saved Simulation values).',
    '- Data-download helpers: `scripts/audusd_download_m1.py`, `src/aai_fx/data/dukascopy_minute.py`. They preserve raw caches and the script refuses to write a completed study dataset when request failures exist. The failed long download is not needed to reproduce current results.',
    '- Regression coverage: next-open bid/ask fills, fixed spread, same-bar stop checks, completed H4 mapping, minimum-lot rejection, strict 1% comparison, next-bar BE and cash/commission reconciliation. Final validation: **119 tests passed; mypy clean**. Account cash versus summed net trades differs by less than $0.000001 in all saved runs.',
    '- Next gate, not a profit claim: obtain confirmed Bybit AUDUSD+ contract/commission/swap/margin/stops specifications and years of broker-quality M1/tick bid/ask history; pre-register new exact rules and use a genuinely untouched future paper sample. If further study is commissioned, the selective H4 sniper is the least bad candidate; it must overcome its cost sensitivity, tiny sample and asymmetric long/short level choice. No EA or live deployment is justified yet. Demo execution evidence must never be presented as proof of a profitable edge.',
    '', '### Sources opened/used',
    '- Dukascopy public historical feed: https://datafeed.dukascopy.com/datafeed/AUDUSD/ (monthly BID/ASK H1 `.bi5` files cached in the existing pipeline).',
    '- Official RBA annual decision archives: https://www.rba.gov.au/monetary-policy/int-rate-decisions/2024/ and corresponding 2008–2026 pages, each saved in `rba_dates.json`.',
    '- Secondary macro archive: https://huggingface.co/datasets/oprizzle/Forex_Factory_Calendar — source date/time quality limitations disclosed above; raw CSV saved under `data/forex_factory_cache.csv`.',
    '- Stored Yahoo data provenance: existing `data/yfinance/*/AUDUSD.meta.json`; no claim it is executable broker bid/ask.',
    '', '**Safety:** no MT5 account, credentials, money movement, live trade, production order path or agent-guard settings were accessed or modified. The Security-patched `mt5_adapter.py` was not edited.']
    if 'asian_reversal_hypothesis' in r:
        ext=r['asian_reversal_hypothesis']
        E=['## 6. Additional pre-registered hypothesis: abnormal Asian-session reversal',
        '**Research hypothesis only—not approved rules and not a fifth qualified bot.** Source: Caporale & Plastun, “Daily abnormal price changes and trading strategies in the FOREX,” Journal of Economic Studies 48(1), DOI 10.1108/JES-11-2019-0503, using daily/hourly 2008–2018 data. The opened full text explicitly states that its trading simulation does not incorporate spread, broker/bank fees or swaps. Its discussion of anomaly profits is not evidence of net retail profitability.',
        'Adapting a next-day daily abnormal-move result to an Asian-session fade at the London open is **our own extrapolation**, not a reproduction of the paper. One threshold and stop/target were frozen in `asian_reversal_preregistration.json` before the first hypothesis simulation. No grid, martingale or post-result threshold change.',
        '', '### Frozen rules and matched control',
        '- Asian proxy: Tokyo 09:00 (00:00 UTC) to 08:00 Europe/London local on that London calendar date. Require every expected H1 bar (7 hours in UK summer, 8 in winter); exclude incomplete sessions.',
        '- “Abnormal” means absolute session open-to-close move strictly exceeds the **90th percentile of the previous 252 sessions**, with at least 126 past complete sessions. The current move is shifted out of its own threshold. No future prices enter the percentile.',
        '- At 08:00 London (normally 02:00 CT, 03:00 during DST mismatch), fade the Asian direction at next H1 open. Exactly one candidate per eligible day. **10-pip execution stop, 16-pip target**; no BE or trailing; flat by noon London (normally 06:00 CT, 07:00 in mismatch weeks). 0.01-lot initial risk is about **$1.095** under baseline fees/stop slip, feasible under the current 2% cap at a $100 start, subject to subsequent margin/risk checks.',
        '- Continuation control: same threshold, session, fill time, stop, target and noon exit, but trade **with** the Asian move. No control-specific optimisation.',
        '- Baseline uses the recorded Dukascopy H1 bid/ask, $3.50/lot/side commission and normal slippage. Requested 1/1.5-pip **total spread-plus-commission** budget controls use fixed 0.3/0.8-pip spread plus 0.7-pip commission, with extra slippage separate. This does NOT assume a 0.3-pip Bybit spread or charge the spread twice. A high-slippage control also retains actual historical bid/ask. The budget controls are cheaper than some recorded baseline quotes.',
        '- News robustness: compare paired arms on the **same January 2018–April 7, 2025 coverage**, one unfiltered and one excluding official RBA dates and secondary-calendar US payroll/CPI/FOMC days. Unknown midnight timestamps are treated conservatively: exclude both the source-printed calendar date and the London-converted date. This can exclude an extra neighbouring day; it never pretends to know an unknown release time. No “news-free” claim is made after archive coverage ends. The unfiltered long arm continues through October 2026.',
        '- Long split remains the exploratory June 30, 2023 boundary, not a pristine holdout. The paired shorter OOS period ends April 7, 2025. H1 bars cannot validate minute/tick execution; the minute feed limitation remains.',
        '', '| Cohort / direction | $100 final (2% cap) | $100 n | $1,000 final (1% cap) | $1,000 n | Avg R | PF | $1,000 max DD | Loss streak |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|']
        for x in ext['variants']:
            a=x['results']['100']['oos'];m=x['results']['1000']['oos']
            E.append(f"| {x['params']['cohort']} / {x['params']['direction']} | ${fmt(a['ending_equity'])} | {a['trade_count']} | ${fmt(m['ending_equity'])} | {m['trade_count']} | {fmt(m.get('expectancy_r'),3)} | {fmt(m.get('profit_factor'))} | {fmt(m['max_drawdown_pct'],1)}% | {m['longest_losing_streak']} |")
        E+=['', '| Cohort / direction | 1-pip all-in budget R | 1.5-pip all-in budget R | High-slippage R | 95% block-bootstrap average-R interval |', '|---|---:|---:|---:|---:|']
        for x in ext['variants']:
            c=x['oos_cost_sensitivity_1000'];ci=x['bootstrap'].get('expectancy_r_ci95')
            E.append(f"| {x['params']['cohort']} / {x['params']['direction']} | {fmt(c['allin_1pip'].get('expectancy_r'),3)} | {fmt(c['allin_1_5pip'].get('expectancy_r'),3)} | {fmt(c['high_slippage'].get('expectancy_r'),3)} | {fmt(ci[0],3)} to {fmt(ci[1],3)} |")
        E+=['', '**Verdict: reject this Asian-fade implementation after costs.** The full long OOS fade loses more than its continuation control. News exclusions do not rescue it. A positive continuation result in the short 26-trade filtered subset does not establish a new edge or justify changing the hypothesis after looking. No prospective confirmation is available; a future demo would establish operational behaviour, not proof of profitability.',
        '', 'All six cohort/direction arms, their full/IS/OOS metrics for both accounts, costs, bootstrap statistics and trade/session CSVs are saved in `asian_reversal_results.json` and the main JSON. This adds **54** individually logged simulation calls to the four-family final pass: **488 final logged calls**, plus 1,196 reconstructed prior exploratory calls = **1,684**. There are 36 four-family timeframe/rule variants plus six new cohort/direction arms, not 1,684 independent hypotheses. The code is `audusd_strategies/asian_reversal.py`; runner `audusd_reversal.py`; source paper PDF and extracted text are saved locally.',
        '', 'Paper: https://bura.brunel.ac.uk/bitstream/2438/20567/5/FullText.pdf ; public tick/minute data reference supplied in the brief: https://www.dukascopy.com/swiss/english/marketwatch/historical/ . Dukascopy is not Bybit.', '']
        text='\n'.join(L)+'\n'
        text=text.replace('## 6. Reproduce, audit and next research gate','\n'.join(E)+'\n## 7. Reproduce, audit and next research gate')
        return text
    return '\n'.join(L)+'\n' 


def write_report(root:Path):
    r=json.loads((root/'research/audusd/results.json').read_text())
    (root/'research/audusd/report.md').write_text(render(r))
