# Solana Meme Risk - self-improvement log

## Scoreboard (daily sessions from Wed 2026-11-04; Nov 3 sprint ran 150 sessions)
- Live version: bt20261103-b57add76 (skip>=40, reduced>=35, creator_sold=0, serial_deployer=0). Has passed seven clean fresh holdouts (#1-#7) plus fresh #8 point estimate (still live; refits identical so far).
- Latest refit (2026-11-06 ~07:27 CST, daily session): fitted values identical to live again (bt20261106-f2644efa = same numbers as Nov 5 fitted), NOT deployed (held-out/test AUC 0.7803 = live_test_auc, does not beat). Train 1053 (96 bad) AUC 0.713 (95% CI 0.67-0.75); test 703 (62 bad, reused split) 0.780 (0.72-0.83); FRESH #8 0.675 (95% CI 0.53-0.81, n=268, 15 bad, created after 1793677694) - passed point-estimate gate (>=0.60) but CI lower bound is below 0.60. Log data/backtest/work/d20261106_calibrate.log. Prior Nov 5 calibrate: NOT deployed (test 0.7803, fresh n=183 auc=0.789); fitted bt20261105-f2644efa.
- Earlier fresh results: #7 0.778 (0.69-0.85, n=309); #6 0.845 (0.77-0.91, n=284); #5 0.623 (0.51-0.74, n=137); #4 0.785; #3 0.69; #2 0.6945; #1 0.7933.
- Evaluation launches used: fresh #1-#7 USED. Fresh #8 boundary still created after 1793677694 (2026-11-02 21:48:14 CST); #8 has 268 usable / 15 bad and was used for the 2026-11-06 refit (first look was Nov 5 n=183). Continuation scoring running (log data/backtest/work/d20261106_fresh8.log). Do not start a new fresh-#9 boundary until #8 is formally closed/USED for a deployed change or owner says so; keep growing #8 while launches remain inside the 33 h history window.
- Next refit: not before 2026-11-07 ~07:00 CST; only with a never-before-scored fresh set (>=30 usable, >=5 bad) if #8 is marked USED, else re-check whether a new identical fit still fails "beats live".
- Filtering changes shipped: 1 owner-mandated (Mayhem gate), 1 evidence-based (2026-11-06: liq/mcap < 0.3 at entry -> at most REDUCED in smr/paper/gates.py). Entry >=20x -> SKIP not shipped (graduation pool: flagged bad_rate 0.818 vs passed 0.848; no separation). Creator-unsold>=1% still unmeasurable on paper (holders_live empty; asof_decision is the decision string only).
- Dataset: backtest.db 7,860 candidates (3,225 eligible), 2,224 scored, 2,231 labeled. Graduations collected: 1,033; labeled 303. Paper: 1,750 scored launches; floor resolved for gate measure n=24 (15 bad / 9 good). StalkChain log: 14 reads; organicScore/organic 0 on 6, >0 on 8 (not a blanket zero anymore). organic_zero voids: 2 positions (one mint x strategy+momentum); later zeros often paired with serial_deployer veto instead.
- Improvements shipped: 27 (2026-11-06: liq/mcap REDUCED gate; 2026-11-05: whole-market scanner daemon + silent `scanner` paper book; 2026-11-04: read-only entry-fill checker tools/check_entry_fills.py; earlier list in the Nov 3 sprint entries below).

## Next (ranked)
F1. FILTERING: liq/mcap < 0.3 -> REDUCED SHIPPED 2026-11-06 (graduation floor pool n=222, flagged 139 bad_rate 0.878 vs passed 83 at 0.735, good_in_flagged=17; paper floor n=24 directional 0.80 vs 0.333). Next candidates: (a) creator unsold and holds >=1% -> REDUCED once holders_live / creator pct is populated on >=30 floor with >=5 good; (b) re-check entry >=20x -> SKIP only if a future slice shows clear separation (current graduation evidence argues against). Keep collecting/labeling graduations every session; re-measure any new gate on both paper floor and tools/grad_gate_check.py.
F2. ENTRY FILL: scanner book already fills at max(decision quote, entry-minute 1-min close). Strategy/momentum paper engine still uses the DexScreener quote as entry_price (engine.py has concurrent dirty edits from other workers; defer wiring). When wiring: reuse scanner's wait+GT OHLCV path, share gtshare budget with watcher, add tests, note measured fill-vs-quote lift in LEARNINGS. tools/check_entry_fills.py remains the read-only checker.
0000. s128 clip5 momentum exit is live (owner request 2026-11-03), with shadow controls momentum_ladder / momentum_x1 (+ clip5_rug_dust / sighv). Momentum closed trades still 0; do not owner-report until >= 10 closed momentum trades.
000-entry. ENTRY-PRICE CAPTURE (owner, 2026-11-03): see F2. Missed dips from 15-min marks still open (measure-only).
000. s121 `holders_live` is on. organicScore is NO LONGER zero on every read (6/14 zero, 8/14 >0 as of 2026-11-06); organic_zero vetoed 2 positions historically and is not currently a blanket block — keep reporting facts, do not loosen. holders_live report counts still 0 launches_with_live_holders on main paper book (scanner/manual paths log to paper_stalkchain.jsonl).
00. Mayhem gate is live. Unknowns: 3 of 1641 priced (~0.2%, fine). Judge filters on shadow/all split by mayhem + graduation pool.
0-pre. RESOLVED s45: frozen shadow prices are real. No label change needed.
0. FILTERING FIRST (Zoorped). Keep `.venv/bin/python tools/collect_graduations.py` + `tools/label_graduations.py` every session. Graduation pool is the main paper-matched floor source (303 labels / 222 measurable floor).
1. Fresh #8: keep growing while scoreable (sample --n 300 --min-age-h 25 --max-age-h 33, run --newest-first --parallel 3 --budget-min 25); log data/backtest/work/d20261106_fresh8.log. #8 already used for 2026-11-06 refit (n=268). Next clean holdout needs a new boundary after the newest create_time already scored in #8, or owner direction.
1b. Fresh #8 AUC 0.675 (CI 0.53-0.81) is weaker than Nov 5's 0.789 (n=183) on the same boundary — on TRAIN only, look for what the live score misses on later launches; do not tune on #8.
2. Next refit: not before ~07:00 CST 2026-11-07, only with a fresh set that satisfies the never-before-scored guard.
3. Tracer / RPC watch items remain lower priority than filtering.

## Log

### 2026-11-06 ~07:20-07:35 CST - daily session (filter ship, refit, organic facts)
- Graduation collector: +6 -> 1,033 total. Labeler: due 735, labeled +20 -> 303 labels (errors 0).
- Paper snapshot (read-only): 1,750 scored (SKIP 1353 / REDUCED 334 / NORMAL 63); strategy -$0.31 (1 closed); all -27.4% mtm; momentum family 0 closed (clip5 comparison not due); Mayhem unknown 3/1641; organic_zero voids 2; serial_deployer voids 3; scanner 1 closed (-0.73% at zero dust).
- F1 gates measured: graduation pool (tools/grad_gate_check.py) n=222 (183 bad / 39 good). liq/mcap < 0.3: flagged n=139 bad_rate 0.878 (good 17) vs passed n=83 bad_rate 0.735 (good 22) -> SHIPPED as at-most-REDUCED in smr/paper/gates.py + tests. entry >=20x: flagged 0.818 vs passed 0.848 -> SKIP candidate rejected. Paper floor resolved n=24 (15 bad / 9 good): liq/mcap directional 0.80 vs 0.333 but below the solo n>=30 bar; used as supporting evidence only. Creator-unsold gate still unmeasurable.
- Effect on past paper: most liq/mcap<0.3 floor coins were already SKIP from the score; the gate mainly caps future NORMAL thin-liq entries to REDUCED. GTA 6 Coin (REDUCED, liq/mcap 0.22, dumped) stays REDUCED.
- StalkChain organic (data/paper_stalkchain.jsonl, 14 reads): organicScore/organic = 0 on 6 reads, >0 on 8 (49-75). organic_zero veto is NOT a blanket block anymore; do not loosen. serial_deployer dominates later vetoes.
- F2 entry fill: already in scanner (`max(quote, entry-minute close)`); NOT wired into strategy/momentum engine this session (engine.py dirty from other workers).
- Fresh #8: 268 usable / 15 bad (ready). Refit once: NOT deployed (fitted identical; test AUC 0.7803 does not beat live). Fresh #8 AUC 0.6752 (95% CI 0.53-0.81). Started continuation scoring (d20261106_fresh8.log). Live stays bt20261103-b57add76.
- Tests: 229 passed. Commit: gates.py + test_paper.py + LEARNINGS + calibrate artifacts from this session only.


### 2026-11-05 CST - built: whole-market scanner + `scanner` paper book (Zoorped; paper only)
- `risk scanner start|stop|status --check|run|once` (smr/paper/scanner.py), a 5-min local daemon in the watcher's pattern. Sources: DexScreener lists + search + /tokens/v1, GeckoTerminal trending/new pools through a GT budget shared with the watcher (gtshare.py, 4/min total, 5-min pause on 429). Never pump.fun API, never StalkChain/X (it only reads ingested files). Risk score: live version, reduced params, deduped/cached. Gates: Mayhem (pure-Python pump.fun curve PDA, smr/paper/pda.py, verified 8/8 against stored curves), $30k, liquidity sanity, price disagreement hold, bundle, entry gates; sizing = momentum `combine`; fill = max(quote, entry-minute close).
- Exits clip5_rug_dust via the 1-min watcher (WATCH_BOOKS + STEP_BOOKS), PARTIAL_SELL/SELL events tagged [PAPER scanner]; `paper events` default now includes scanner. Runner score features logged per candidate (scanner_candidates) for later evaluation; not a 100x predictor.
- First live cycle: 120 candidates, 115 quoted, 35 passed the prefilter, 4 risk-scored (2 SKIP, 1 REDUCED, 1 timeout), 0 entries (the REDUCED one failed the momentum rule, combined 38.8 < 55). ~13 DexScreener + 3 GT calls, 160 s.
- Next: after >= 2 days of scanner_candidates, compare runner_score deciles with each coin's later max/24 h return (from scanner_obs / marks) before trusting or tuning the score.

### 2026-11-04 07:15-07:30 CST - daily session 1 (refit, fresh #7, filter check, entry fills)
- Graduation collector: 7 new, 1,018 total. Graduation labeler: 0 due (oldest pool first seen 2026-11-03 11:24 CST). StalkChain log unchanged at 4 reads; organicScore 0 on all 4 (2 positions voided for organic_zero).
- Fresh #7 reached 309 usable / 29 bad (needs 30/5). Refit with SMR_FRESH_HOLDOUT_AFTER=1793669022: fitted values identical to live, not deployed. Test 0.769 (0.70-0.82, n=579, reused); fresh #7 0.778 (0.69-0.85, n=309, 29 bad). Fresh #7 is now USED. Started fresh #8 sampling + scoring in the background (`sample --n 300 --min-age-h 25 --max-age-h 32.5`, then `run --max-age-h 32.5 --parallel 3 --budget-min 25 --newest-first`).
- Paper floor check (read-only, 17 launches >= $30k, 16-23 h since entry, no 24 h labels yet): all 12 non-Mayhem floor coins are at <= 0.26x entry now (11 of 12 at <= 0.06x); the 5 Mayhem ones are frozen at ~1.0x (dead curves). The score already had 11 of the 12 non-Mayhem at SKIP; the one REDUCED (GTA 6 Coin, liq/mcap 0.22, 49x launch) went to 0.013x and both the liq/mcap and 20x gates would have caught it. Liq/mcap < 0.3: 10 of 10 dumped; >= 0.3: 2 of 2 dumped. Entry >= 20x: 10 of 10; < 20x: 2 of 2. No good floor coin exists to contrast, so neither gate can be judged; nothing shipped.
- Entry-fill measurement (GT 1-min candles, 11 of 12 non-Mayhem floor coins had a candle): see Next F2. DexScreener and GT quotes agreed within 25% on all 825 priced launches, so the MSTRT gap is a fast pump inside the entry minute, not a stale feed.
- Code: tools/check_entry_fills.py (read-only, rate-limited, safe_field on symbols) + tests/test_check_entry_fills.py. Full suite 192 passed. No gate change, no scoring change.

### 2026-11-04 00:50 CST - built: silent signal control books + 1-min exit watcher (Zoorped approved; paper only)
- New silent controls `momentum_clip5_rug_dust` (live clip5 rungs + rug rule: 1-min mark <= 0.65x previous -> sell all but dust at the next mark) and `momentum_sighv` (SIG-HV from the 2026-11-04 backtest), both with a permanent 5% dust bag. Same mechanics as ladder/x1: $1,000 notional, never cash-limited, mirror every momentum entry, voided with it, no events. `paper events`/`unreported` now drop any non-alerting book even when asked by name. Live clip5, strategy book, $30k floor, sizing, gates and scoring version untouched; only `momentum_exit.controls` in paper_edge.json gained the two names.
- 1-min watcher (`risk paper watcher start|stop|status|run|once`): one DexScreener batch per minute for the momentum family's open mints, optional GeckoTerminal 1-min candles for SIG-HV, marks table with m5 buys/sells/volume, intended vs actual fill per signal sale. Ownership by a DB lease: the cycle skips the signal books while it is live and falls back to the same step when it lapses, so an exit is never applied twice.
- Decision: the watcher does NOT mark the live momentum book. clip5 alerts stay on the cycle's 15-min cadence (no duplicate/out-of-order PARTIAL SELL/SELL risk); the watcher only logs `live_clip5_would_fire` to measure what 1-min marking would change.
- Lesson: the cycle calls mark_and_enter twice (entries, then "final marks") with the same clock in tests, so a pending signal sale was filled at its own deciding price. Fix: fill only at a mark >= 30 s after the decision, and the cycle skips a signal row marked < 30 s ago.
- Lesson: GeckoTerminal's keyless API 429'd 18 of 32 calls at 8/min from the watcher alone (00:38-00:41 CST), well under its nominal 30/min. Default lowered to 4/min, a 429 pauses candles for 5 min, and all watcher HTTP is single-attempt so a Retry-After never stalls a tick. SIG-HV falls back to mark-based features (DexScreener m5 counts for red share) when candles are missing.

### 2026-11-04 00:00 CST - research: signal-driven clip exits (owner ask, Zoorped; nothing live changed)
- Owner asked for clips driven by sell-pressure/rug signals instead of fixed 2x/3x/... rungs, plus a permanent 5% dust bag. Backtested on the 28-trade fair shadow set (1-min GT candles, worst-case fills, fees + slippage + liquidity impact as clip.py). Report: /workspace/runners/signal_exit_backtest.md (+ .csv, .png). No change to paper_edge.json, the scoring version, or routines.
- Pressure-only selling (red-vol share, drawdown, wick, momentum decay, big-sell score) LOSES: -18.7%/trade vs clip5 +13.4%. Candle sell signals fire after the drop (P(further -30%) 16-24% vs 26% base), and 4 of 17 movers (BARRON, Coca Cola, DOGE PAID, GTA 6) had a >50% crash inside the top minute with no warning.
- What led tops: heat (close >= 1.4x 15-min mean) fired before 12/17 tops, median 8.5 min lead (70% drop-30 rate vs 26%, but also 62% rise-50); upper-wick rejection 9/17, ~4 min; momentum decay 7/17, ~12 min. Volume divergence is noise (flags 42% of run-up bars).
- Best signal exit SIG-HV (2x min-profit gate, volatility-spaced 20% sells, 15% on overheated new highs, rug rule, floor max(entry, 0.6x high), 5% dust): +10.3%/trade ($1,074 at 3%) vs clip5 +13.4% ($1,099), E +9.0%. Out of sample: LOCO +7.2%, time-split test +6.0% (clip5 +12.7% on the same half).
- The rug rule (1-min close <= 0.65x previous close -> sell all but dust next bar) adds about +4 pts/trade to clip5 and to SIG-HV. clip5 + rug rule had the best test-half result (+16.0%). The 5% dust bag costs about 2-4 pts/trade on this sample (no coin was still up at data end; BARRON's dust is worth $0.01 per $10).
- Cadence: signal exits need 60-s marks. SIG-HV is +28% on 1-min point marks, +2.7% at 5 min, -11.9% at 15 min (today). clip5+rug+dust: +25% / +16% / +11.5%. A 60-s exit watcher for open momentum positions = 1 DexScreener batch call/min (<=30 mints); GT 1-min OHLCV would be +1 call/min per open pool (free ~30/min).
- Proposed (NOT enabled): shadow controls `momentum_sighv` (only with a 60-s watcher) and the cheaper `clip5_rug_dust`. Config in the report. n=28 from one day; SIG-HV and the signals were designed on the same coins.

### 2026-11-03 23:55 CST - session 150 (sprint handoff)
- Sprint deadline reached. No development work. Wrote .sprint_done and handed back to the parent to send the end-of-day sprint summary and switch this routine to its daily ~7:00 AM CT schedule (flexible 30 min), keeping the filtering priority.
- s148 fresh #7 continuation may still be running in the background (log data/backtest/work/s148_fresh7.log); the next daily session should check it.

### 2026-11-03 23:48-23:50 CST - session 149 (graduations, fresh #7 continued)
- Graduation collector: 5 new, 1,011 total. StalkChain log still 4 rows. No `risk paper` process running.
- s148 fresh #7 continuation still running: 6/245 scored at 23:49 CST, log data/backtest/work/s148_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: unchanged; the 23:55 session does the sprint handoff.

### 2026-11-03 23:46-23:48 CST - session 148 (graduations, fresh #7 continued)
- Graduation collector: 8 new, 1,006 total. StalkChain log still 4 rows. No `risk paper` process running at check.
- s145 fresh #7 continuation exited at its hard deadline: 41/283 scored (16.1 s per launch, 2 abandoned; probes 705, cache hits 160, hub page skips 112; mainnet-beta 29 of 578 rate-limited). Started the next continuation (newest-first, parallel 3, budget 9 min), log data/backtest/work/s148_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: unchanged; the 23:55 session does the sprint handoff.

### 2026-11-03 23:39-23:40 CST - session 147 (graduations, fresh #7 continued)
- Graduation collector: 8 new, 998 total. StalkChain log still 4 rows. A `risk paper` process was running (untouched; no gate change).
- s145 fresh #7 continuation still running: 32/283 scored at 23:40 CST, log data/backtest/work/s145_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (#7 not ready; sprint ends 23:55). Evaluation launches used: unchanged.
- Next: unchanged; the 23:55 session does the sprint handoff.

### 2026-11-03 23:32-23:34 CST - session 146 (graduations, fresh #7 continued)
- Graduation collector: 4 new, 990 total. StalkChain log still 4 rows. A `risk paper cycle` was running (untouched; no gate change).
- s145 fresh #7 continuation still running: 8/283 scored at 23:33 CST, log data/backtest/work/s145_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: unchanged; the 23:55 session does the sprint handoff.

### 2026-11-03 23:31-23:33 CST - session 145 (graduations, fresh #7 continued)
- Graduation collector: 3 new, 986 total. StalkChain log still 4 rows. A `risk paper cycle` was running (untouched; no gate change).
- s143 fresh #7 continuation exited at its hard deadline: 29/313 scored (25.1 s per launch, 2 abandoned in flight; probes 556, cache hits 143, hub page skips 110; mainnet-beta 28 of 640 rate-limited). Slower than s140 (10.9 s). Started the next continuation (`--max-age-h 28.1 --newest-first --parallel 3 --budget-min 9`), log data/backtest/work/s145_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (refit window opens 23:35 CST but #7 not ready to evaluate; sprint ends 23:55). Evaluation launches used: unchanged.
- Next: unchanged; the 23:55 session does the sprint handoff.

### 2026-11-03 23:23-23:24 CST - session 144 (graduations, fresh #7 continued)
- Graduation collector: 7 new, 983 total. StalkChain log still 4 rows. No `risk paper` process running.
- s143 fresh #7 continuation still running: 17/313 scored at 23:24 CST, log data/backtest/work/s143_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks whether the s143 job exited.

### 2026-11-03 23:18-23:21 CST - session 143 (graduations, fresh #7 continued)
- Graduation collector: 15 new, 976 total. StalkChain log still 4 rows. No `risk paper` process running.
- s140 fresh #7 continuation exited at its 9-min budget: 55/361 scored (10.9 s per launch, 0 abandoned; probes 873, cache hits 379, hub page skips 174). Started the next continuation (`.venv/bin/python -m risk backtest run --max-age-h 27.9 --newest-first --parallel 3 --budget-min 9`; boundary is 27.9 h old; 313 eligible), log data/backtest/work/s143_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks the s143 job.

### 2026-11-03 23:13-23:15 CST - session 142 (graduations, fresh #7 continued)
- Graduation collector: 5 new, 961 total. StalkChain log still 4 rows. No `risk paper` process running.
- s140 fresh #7 continuation still running: 54/361 scored at 23:14 CST, log data/backtest/work/s140_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks whether the s140 job exited and, if so, re-runs the recipe with a larger --max-age-h.

### 2026-11-03 23:10-23:11 CST - session 141 (graduations, fresh #7 continued)
- Graduation collector: 10 new, 956 total. StalkChain log still 4 rows. No `risk paper` process running.
- s140 fresh #7 continuation still running: 38/361 scored at 23:11 CST, log data/backtest/work/s140_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks whether the s140 job exited and, if so, re-runs the recipe with a larger --max-age-h.

### 2026-11-03 23:04-23:08 CST - session 140 (graduations, fresh #7 continued, paper read)
- Graduation collector: 8 new, 946 total. StalkChain log still 4 rows. A `risk paper cycle` was running (untouched; no gate change).
- s137 fresh #7 continuation exited at its 9-min budget: 53/417 scored (11.6 s per launch, 0 abandoned; hub page skips 149 of 756 probes, cache hits 258). Started the next continuation in the background (`--max-age-h 27.6 --newest-first --parallel 3 --budget-min 9`, boundary is 27.68 h old), log data/backtest/work/s140_fresh7.log. AUC not peeked.
- Paper read (read-only): 824 scored (SKIP 635, REDUCED 171, NORMAL 18). Benchmark: 29/29 resolved SKIPs dumped 50%+ vs 100% of non-SKIPs, Mayhem 7/7 and non-Mayhem 23/23 dumped, so the resolved benchmark set does not separate anything yet (everything dumps). Momentum books (clip5 / ladder / x1): 0 trades, nothing to compare (Next 0000 needs >= 10). Strategy: 1 open, 0 closed. Mayhem unknown 1 of 792 priced (fine). 69 launches waiting on the $30k floor.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks s140 job and collects graduations.

### 2026-11-03 23:00-23:02 CST - session 139 (graduations, fresh #7 continued)
- Graduation collector: 5 new, 938 total (page 3 HTTPError, non-fatal). StalkChain log still 4 rows. A `risk paper cycle` was running (untouched; no gate change).
- s137 fresh #7 continuation still running: 51/417 scored at 23:01 CST, log data/backtest/work/s137_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks whether the s137 job exited and, if so, re-runs the recipe with a larger --max-age-h.

### 2026-11-03 22:53-22:55 CST - session 138 (graduations, fresh #7 continued)
- Graduation collector: 1 new, 933 total. StalkChain log still 4 rows. No `risk paper` process running.
- s137 fresh #7 continuation still running: 16/417 scored at 22:54 CST, log data/backtest/work/s137_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks whether the s137 job exited and, if so, re-runs the recipe with a larger --max-age-h.

### 2026-11-03 22:50-22:53 CST - session 137 (graduations, fresh #7 continued)
- Graduation collector: 7 new, 932 total. StalkChain log still 4 rows. A `risk paper cycle` was running (untouched; no gate change).
- s135 fresh #7 job exited at its 9-min budget: 39/354 scored (15.9 s per launch, 0 abandoned; probe cache hits 216/602). Started the continuation in the background with --max-age-h 27.4 (boundary is 27.46 h old), log data/backtest/work/s137_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks s137_fresh7.log.

### 2026-11-03 22:44-22:46 CST - session 136 (graduations, fresh #7 continued)
- Graduation collector: 7 new, 925 total. StalkChain log still 4 rows. No `risk paper` process running.
- s135 fresh #7 continuation still running: 22/354 scored at 22:45 CST, log data/backtest/work/s135_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks whether the s135 job exited and, if so, re-runs the recipe with a larger --max-age-h.

### 2026-11-03 22:39-22:41 CST - session 135 (graduations, fresh #7 continued)
- Graduation collector: 11 new, 918 total. StalkChain log still 4 rows. No `risk paper` process running.
- s132 fresh #7 job exited at its 9-min budget: 43/268 scored (14.3 s per launch, 0 abandoned). Started the continuation in the background with --max-age-h 27.3 (sample --n 300 --min-age-h 25, then run --parallel 3 --budget-min 9 --newest-first), log data/backtest/work/s135_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks s135_fresh7.log.

### 2026-11-03 22:32-22:34 CST - session 134 (graduations, fresh #7 continued)
- Graduation collector: 7 new, 907 total. StalkChain log still 4 rows. A `risk paper cycle` was running (untouched; no gate change).
- s132 fresh #7 continuation still running: 39/268 scored at 22:33 CST, log data/backtest/work/s132_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks whether the s132 job exited and, if so, re-runs the recipe with a larger --max-age-h.

### 2026-11-03 22:30-22:32 CST - session 133 (graduations, fresh #7 continued)
- Graduation collector: 8 new, 900 total. StalkChain log still 4 rows. A `risk paper cycle` was running (untouched; no gate change).
- s132 fresh #7 continuation still running: 24/268 scored at 22:31 CST, log data/backtest/work/s132_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks whether the s132 job exited and, if so, re-runs the recipe with a larger --max-age-h.

### 2026-11-03 22:23-22:26 CST - session 132 (graduations, fresh #7 continued)
- Graduation collector: 4 new, 892 total. StalkChain log still 4 rows. No `risk paper` process running.
- s129 fresh #7 job exited at its deadline: 35/146 scored (18.9 s per launch, 2 abandoned in flight). Started the continuation in the background: `python -m risk backtest sample --n 300 --min-age-h 25 --max-age-h 27.0` then `run --max-age-h 27.0 --parallel 3 --budget-min 9 --newest-first`, log data/backtest/work/s132_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks s132_fresh7.log and re-runs with a larger --max-age-h once it exits. CLI is `.venv/bin/python -m risk ...`.

### 2026-11-03 22:21-22:23 CST - session 131 (graduations, fresh #7 progress)
- Graduation collector: 23 new, 888 total. StalkChain log still 4 rows. A `risk paper cycle` was running (untouched; no gate change).
- Fresh #7 build (s129 job, 9-min budget) at 34/146 scored at 22:22 CST; log data/backtest/work/s129_fresh7.log. AUC not peeked.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks whether the s129 job exited and, if so, re-runs the recipe (sample with a larger --max-age-h, then run) to keep growing #7.

### 2026-11-03 22:13-22:16 CST - session 130 (graduations, fresh #7 progress)
- Graduation collector: 10 new, 865 total. StalkChain log still 4 rows. A `risk paper cycle` was running (untouched; no gate change).
- Fresh #7 build (s129 job) still running: 10/146 scored at 22:15 CST, log data/backtest/work/s129_fresh7.log. Not looked at (AUC not peeked).
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged; next session checks whether the s129 job finished and, if so, re-runs the recipe with a larger --max-age-h.

### 2026-11-03 22:10-22:15 CST - session 129 (graduations, fresh #7 started)
- Graduation collector: 11 new, 855 total. No `risk paper` process running.
- Paper report 22:11 CST: 801 scored (SKIP 616 / REDUCED 167 / NORMAL 18); strategy 1 open, 0 closed; momentum + ladder/x1 controls still 0 trades, so no clip5 comparison yet; Mayhem 413 / not 357 / unknown 1 (0.13%); holders_live/organic veto unchanged (2 voided positions).
- Started fresh holdout #7 build in the background (Next #1): `backtest sample --n 300 --min-age-h 25 --max-age-h 26.7` then `backtest run --max-age-h 26.7 --parallel 3 --budget-min 9 --newest-first`, log data/backtest/work/s129_fresh7.log. Window: created after 1793669022 (2026-11-02 19:23:42 CST) and at least 25 h old. Not looked at; don't peek at AUC until >= 30 usable and >= 5 bad. Note: `risk paper report` prints text then JSON, not pure JSON.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: unchanged; later sessions check s129_fresh7.log and re-run the same recipe (larger --max-age-h as time passes) until #7 has enough rows.

### 2026-11-03 21:58-22:20 CST - session 128 (owner task: clip5 momentum exit + controls)
- Owner (Zoorped) asked for a new momentum exit. clip5: 20% of the original position at each of 2x/3x/4x/6x/10x; -50% stop until the first clip, then max(entry, 0.60 x peak); 48 h max hold. Each clip is a PARTIAL_SELL alert carrying share sold, profit locked, remaining share and stop level. Plus two shadow controls on identical entries: ladder E (50% at 2x, 25% at 4x, 25% on a 20%/40% trail chosen by graduated-at-launch) and x1 (50% at 2x, 50% at 3x, breakeven after 2x).
- Controls are separate books, momentum_ladder and momentum_x1. They mirror each momentum entry in the same transaction, have no cash limit, write no events and keep their own notional $1,000. This was cleaner than virtual tracks because book_report, equity, snapshot and voiding all work unchanged.
- events now allows several PARTIAL_SELLs per position (seq column, UNIQUE(position_id,kind,seq); one-time table rebuild, 0.06 s on a copy of the live DB). The migration ran under the cycle lock after a ps check.
- Fill rules are documented in docs/paper_trading.md: 15-min marks, rung fill = the rung price, stop fill = the mark, trigger and mark both recorded.
- Graduated-at-launch proxy: DexScreener pairCreatedAt on a PumpSwap entry pair, else graduations.jsonl, else 0 if on the curve, else unknown (40% trail).
- Open momentum positions: none (the only row, GTA6, was voided). Nothing to migrate; legacy rows keep the moon bag.
- Tests 166 -> 178 (tests/test_exits.py). Scoring version unchanged.

### 2026-11-03 21:56-22:00 CST - session 127 (graduations, liquidity/mcap measurement)
- Graduation collector: 12 new, 844 total. StalkChain log still 4 rows. A `risk paper cycle` was running (untouched; no gate change).
- Measured entry liquidity / market cap on the shadow book (read-only, 771 non-void positions; "dumped" = min_ret <= -50%, a proxy until 24 h labels exist ~07:00 CST Nov 4). Overall split is confounded with market cap (bonding-curve coins < $5k almost all have ratio >= 0.6 and rarely dump: 3/685). Within bands: $5k-30k ratio < 0.3 dumped 4/8 vs >= 0.3 4/61; >= $30k (the paper floor) ratio < 0.3 dumped 7/10 vs >= 0.3 1/7. Direction is strong but rests on 17 coins at the floor; NOT shipped.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: add to Next 0(b): candidate gate "entry liq/mcap < 0.3 at >= $30k -> at most REDUCED"; re-measure with 24 h labels and >= 30 floor-level coins, and check it's not just a proxy for post-graduation PumpSwap pools.

### 2026-11-03 21:49-21:52 CST - session 126 (graduations, paper check)
- Graduation collector: 8 new, 832 total. StalkChain log still 4 rows. No `risk paper` process running.
- `paper report` (21:49): 801 scored (SKIP 616, REDUCED 167, NORMAL 18). Strategy 0 closed / 1 open; buy-everything -13.6% (7 closed / 100 open). Mayhem 413 / not 357 / unknown 1; shadow closed Mayhem -60.8% mean (n=8) vs not-Mayhem +0.6% (n=25). organic_zero veto still only the 2 known positions. Note: `paper report` prints text first (not pure JSON); invoke as `.venv/bin/python -m risk paper report`.
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged from s124.

### 2026-11-03 21:43-21:46 CST - session 125 (graduations, holders_live + Mayhem check)
- Graduation collector: 6 new, 824 total. StalkChain log still 4 rows. No `risk paper` process running.
- holders_live: 0 launches with live holders, 0 vetoed, 0 changed. Voided by stalkchain_veto:organic_zero: 2 positions (both the 12:04 CST strategy+momentum read of one mint, already known); every StalkChain read so far still has organicScore 0 (4/4), so the blanket-veto concern in Next 000 stands but n is still 4 reads.
- Mayhem: 413 Mayhem / 357 not / 1 unknown priced (0.13% unknown); blocked strategy 93, momentum 71. Resolved counts are still dumps only (no launch has reached 24 h tracking until ~07:00 CST Nov 4).
- No code change, no gate change, no refit (next not before 23:35 CST). Evaluation launches used: unchanged.
- Next: unchanged from s124.

### 2026-11-03 21:37-21:40 CST - session 124 (graduations, resolved==dumped explained)
- Graduation collector: 2 new, 818 total. StalkChain log still 4 rows. A `risk paper cycle` was running (untouched).
- Explained why `resolved` == `dumped_50pct` everywhere in `paper report`: a launch counts as resolved when track_done=1 (set by engine.py after the 24 h check) OR dumped50=1. The first priced paper launch was created 2026-11-03 06:54 CST, so no launch has reached 24 h yet: 785 priced, 0 track_done, 28 dumped50. Until ~07:00 CST Nov 4 only dumps can resolve, so every dump_rate_pct reads 100% by construction. Not a code bug; the rates become meaningful once 24 h tracking completes. No code change.
- No gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) After ~07:00 CST Nov 4, re-read tier/mayhem dump rates (first real ones) and the SKIP hit rate. (2) >= $4k paper split at 40 unique mints. (3) StalkChain flags at >= 20 rows. (4) Build fresh #7 only if a post-sprint refit is wanted.

### 2026-11-03 21:35-21:40 CST - session 123 (refit, fresh holdout #6)
- Graduation collector: 6 new, 816 total. StalkChain log still 4 rows. No scoring run active; a `risk paper cycle` was running (untouched; no gate change this session).
- Ran `SMR_FRESH_HOLDOUT_AFTER=1793662244 python -m risk backtest calibrate` at 21:35:49 (~2 min before the 2 h mark of 19:37; it finished in seconds, result kept; log data/backtest/work/s123_calibrate.log). 1,605 exported. Train 697 (63 bad), test 466 (49 bad, reused). Picked on train: both_off, skip>=40, reduced>=35 (identical to live). Train AUC 0.723 (0.66-0.77); test 0.687 (0.62-0.75, not clean). FRESH #6: AUC 0.845 (95% CI 0.77-0.91, n=284, 17 bad, created 2026-11-02 17:30-19:23 CST) - clean first look, lower bound above 0.60, best fresh result of six (earlier 0.79, 0.69, 0.69, 0.785, 0.62). Moved subset (entry >= 1.1x launch): train 0.771 (0.69-0.86, n=148), test 0.809 (0.72-0.88, n=122), fresh 0.842 (0.72-0.93, n=59, 16 bad).
- Test tiers: SKIP 246 (17.1% bad), REDUCED 63 (4.8%), NORMAL 157 (2.5%); skip recall 0.857.
- NOT deployed: fitted values equal live, no gain. Live bt20261103-b57add76 stays.
- Evaluation launches used: + fresh #6 (306 exported created after 1793662244 up to 1793669022; 284 usable). NEW fresh boundary: created after 1793669022 (2026-11-02 19:23:42 CST).
- Fresh #5's weak 0.62 now looks like a noisy draw rather than lasting drift (#6 is later and scores 0.85), though #6's bad rate is lower (6.0% vs 14.6%).
- No code change, no gate change.
- Next: (1) Check why `resolved` == `dumped_50pct` in the mayhem/skip_hit_rate sections. (2) >= $4k paper split at 40 unique mints. (3) StalkChain flags at >= 20 rows. (4) Build fresh #7 only if a post-sprint refit is wanted.

### 2026-11-03 21:30-21:33 CST - session 122 (graduations, holders_live + Mayhem check)
- Graduation collector: 9 new, 810 total. StalkChain log still 4 rows.
- holders_live (first read since s121): 0 launches with live holders, 0 vetoed, 0 changed. `holders plan`: 0 candidates needing lookup (66 holders already known, 1 below floor); StalkChain today 13/30. Nothing to judge on the organic veto yet.
- Mayhem section: shadow closed Mayhem -60.8% mean (n=8) vs not-Mayhem +3.1% (n=24); all-book Mayhem -97.1% (n=1) vs not-Mayhem +32.2% (n=6). Blocked entries strategy 89, momentum 67, unknown 0 (1 unknown of 755 scored+priced, 0.13%). Direction still agrees with the owner rule on realized shadow exits; n small. Note: the `resolved`/`dump_rate_pct` fields are 100% in every group (they seem to count only dumped resolutions), so don't use them as a bad-rate.
- Paper book: strategy 0 closed / 1 open (SLJK); buy-everything -13.6% with 7 closed / 100 open.
- No code change, no gate change, no refit (next at/after 21:37). Evaluation launches used: unchanged.
- Next: (1) At/after 21:37: count fresh #6 usable and bad; refit if >= 30 usable and >= 5 bad. (2) Check why `resolved` == `dumped_50pct` in the mayhem/skip_hit_rate sections (label bias: only dumps resolve before 24 h?). (3) >= $4k paper split at 40 unique mints. (4) StalkChain flags at >= 20 rows.

### 2026-11-03 21:17-21:26 CST - session 121 (owner task: live holder count for $30k+ coins)
- Shipped edge feature `holders_live` (data/paper_edge.json, on for strategy+momentum; code default off). `risk paper holders plan` lists the `stalkchain_token_quality {"token": MINT}` calls needed: $30k+ strategy/momentum candidates (pending cross, momentum watching, pullback watchlist) with holders unknown and no other block. At most 3 per cycle, 3 of the shared 30/day budget held back for vetoes, cache reused for 30 min. `holders ingest --file ...` writes data/holder_cache.json (numbers, booleans and base58 only) and logs usage. Gate: a fresh live count replaces "holder count unknown (conservative)"; the normal threshold of 75 applies; reason "holders: N live (StalkChain)". A veto in the read (dev mints >= 10, organic score 0 or 0% organic volume, top holders > 60%, mint/freeze authority enabled) is a hard SKIP. Benchmarks unchanged (tests compare BENCH). Report `smart_lifts` now counts the smart_money `lifted` flag (holder changes are not smart lifts).
- 1 live StalkChain call (MSTRT, to learn the shape) -> today 12/30.
- Replay (read-only): all 10 of today's $30k+ unknown-holder shadow coins were blocked by more than the holder reason. 9 were as-of SKIP (score 45-85; the 4 take-profit winners MSTRT, Coca Cola, Dacity and BARRON were all SKIP 55: same-slot bundle 108-120% supply + fresh wallets + fresh deployer). The only non-SKIP one, GTA 6 Coin (REDUCED 35, -98.7% in shadow), would be a hard SKIP under the organic-zero veto. So the new gate changes no entry on today's data; the holder downgrade was not what kept the winners out.
- Tests 159 -> 166.

### 2026-11-03 21:14-21:16 CST - session 120 (graduations, scoring check)
- Graduation collector: 8 new, 801 total. StalkChain log still 4 rows.
- s119 run finished: 10/10 scored (no budget hit, 146.5 s, 14.7 s per launch). Tracer: 145 probes, 36 cache hits (24.8%), 30 hubs, 23 hub page skips. mainnet-beta 14 rate-limited of 118 (11.9%); publicnode 2,298 ok of 2,299, 0 rate-limited. The fresh #6 queue is now fully scored; no scoring run is going.
- No code change, no gate change, no refit (too early, next at/after 21:37). Evaluation launches used: unchanged.
- Next: (1) At/after 21:37: count fresh #6 usable and bad (created after 1793662244, `== 1`); if >= 30 usable and >= 5 bad, refit with `SMR_FRESH_HOLDOUT_AFTER=1793662244` and read headline and `auc_moved_subset` fresh AUC with CIs; otherwise sample more fresh #6 launches. (2) >= $4k paper split at 40 unique mints. (3) StalkChain flags at >= 20 rows.

### 2026-11-03 21:10-21:12 CST - session 119 (graduations, scoring restart)
- Graduation collector: 8 new, 793 total. StalkChain log still 4 rows.
- s116 run finished: 49/59 scored (budget hit, 614.2 s, 12.5 s per launch). Tracer: 732 probes, 230 cache hits (31.4%), 177 hubs, 153 hub page skips. mainnet-beta 23 rate-limited of 645 (3.6%); publicnode 11,452 ok of 11,457, 0 rate-limited.
- Restarted scoring for the rest (same flags, nohup, log data/backtest/work/s119_run.log): 10 queued.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) Read s119_run.log. (2) Refit at/after 21:37 with `SMR_FRESH_HOLDOUT_AFTER=1793662244` once fresh #6 has >= 30 usable and >= 5 bad; read headline and `auc_moved_subset` fresh AUC with CIs. (3) >= $4k paper split at 40 unique mints. (4) StalkChain flags at >= 20 rows.

### 2026-11-03 21:03-21:05 CST - session 118 (graduations, scoring check)
- Graduation collector: 5 new, 785 total. StalkChain log still 4 rows.
- s116 newest-first scoring run still going (started 20:56): 38 of 59 scored so far; left running, not restarted.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) Read s116_run.log when it finishes; restart for the remainder if the budget hits. (2) Refit at/after 21:37 with `SMR_FRESH_HOLDOUT_AFTER=1793662244`; read headline and `auc_moved_subset` fresh AUC with CIs. (3) >= $4k paper split at 40 unique mints. (4) StalkChain flags at >= 20 rows.

### 2026-11-03 20:58-20:59 CST - session 117 (graduations, scoring check)
- Graduation collector: 6 new, 780 total. StalkChain log still 4 rows.
- s116 newest-first scoring run still going (started 20:56): 6 of 59 scored so far; left running, not restarted.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) Read s116_run.log; restart for the remainder if the budget hits. (2) Refit at/after 21:37 with `SMR_FRESH_HOLDOUT_AFTER=1793662244`; read headline and `auc_moved_subset` fresh AUC with CIs. (3) >= $4k paper split at 40 unique mints. (4) StalkChain flags at >= 20 rows.

### 2026-11-03 20:56-20:58 CST - session 116 (graduations, scoring restart)
- Graduation collector: 7 new, 774 total. StalkChain log still 4 rows.
- s114 run finished: 63/122 scored (budget hit, 584.7 s, 9.3 s per launch). Tracer: 829 probes, 236 cache hits (28.5%), 161 hubs, 136 hub page skips. mainnet-beta 5 rate-limited of 541 (0.9%); publicnode 13,668 ok of 13,673, 0 rate-limited.
- Restarted scoring for the rest (same flags, nohup, log data/backtest/work/s116_run.log): 59 queued.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) Read s116_run.log. (2) Refit at/after 21:37 with `SMR_FRESH_HOLDOUT_AFTER=1793662244`; read headline and `auc_moved_subset` fresh AUC with CIs. (3) >= $4k paper split at 40 unique mints. (4) StalkChain flags at >= 20 rows.

### 2026-11-03 20:51-20:53 CST - session 115 (graduations, scoring check)
- Graduation collector: 8 new, 767 total. StalkChain log still 4 rows.
- s114 newest-first scoring run still going (started 20:46): 41 of 122 scored so far; left running, not restarted.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) Read s114_run.log; restart for the remainder if the budget hits. (2) Refit at/after 21:37 with `SMR_FRESH_HOLDOUT_AFTER=1793662244`; read headline and `auc_moved_subset` fresh AUC with CIs. (3) >= $4k paper split at 40 unique mints. (4) StalkChain flags at >= 20 rows.

### 2026-11-03 20:45-20:47 CST - session 114 (graduations, scoring restart)
- Graduation collector: 12 new, 759 total. StalkChain log still 4 rows.
- s112 run finished: 36/158 scored (budget hit, 576.8 s, 16.0 s per launch). Tracer: 624 probes, 113 cache hits (18.1%), 135 hubs, 111 hub page skips. mainnet-beta 22 rate-limited of 563 (3.9%); publicnode 10,425 ok of 10,429, 0 rate-limited.
- Restarted scoring for the rest (`python -m risk backtest run --max-age-h 33 --parallel 3 --budget-min 9 --newest-first`, nohup, log data/backtest/work/s114_run.log): 122 queued.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) Read s114_run.log; restart for the remainder if the budget hits. (2) Refit at/after 21:37 with `SMR_FRESH_HOLDOUT_AFTER=1793662244`; read headline and `auc_moved_subset` fresh AUC with CIs. (3) >= $4k paper split at 40 unique mints. (4) StalkChain flags at >= 20 rows.

### 2026-11-03 20:38-20:40 CST - session 113 (graduations, scoring check)
- Graduation collector: 9 new, 747 total. StalkChain log still 4 rows.
- s112 newest-first scoring run still going (started 20:35): 9 of 158 scored so far (5.9-69.9 s per launch); left running, not restarted.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) Read s112_run.log; restart for the remainder if the budget hits. (2) Refit at/after 21:37 with `SMR_FRESH_HOLDOUT_AFTER=1793662244`; read headline and `auc_moved_subset` fresh AUC with CIs. (3) >= $4k paper split at 40 unique mints. (4) StalkChain flags at >= 20 rows.

### 2026-11-03 20:34-20:37 CST - session 112 (graduations, scoring restart)
- Graduation collector: 13 new, 738 total. StalkChain log still 4 rows.
- s111 sampler finished: checked 283 new candidates; backtest.db now 5,903 candidates, 2,220 eligible.
- Started newest-first scoring (`.venv/bin/python -m risk backtest run --max-age-h 33 --parallel 3 --budget-min 9 --newest-first`, nohup, log data/backtest/work/s112_run.log): 158 queued. Note: there is no `.venv/bin/risk`; use `python -m risk`.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) Read s112_run.log; restart for the remainder if the budget hits. (2) Refit at/after 21:37 with `SMR_FRESH_HOLDOUT_AFTER=1793662244`; read headline and `auc_moved_subset` fresh AUC with CIs. (3) >= $4k paper split at 40 unique mints. (4) StalkChain flags at >= 20 rows.

### 2026-11-03 20:26-20:29 CST - session 111 (graduations, sampler)
- Graduation collector: 8 new, 725 total. StalkChain log still 4 rows.
- s110 run finished: 25/25 scored (no budget hit, 281.5 s, 11.3 s per launch). Tracer: 362 probes, 90 cache hits (24.9%), 54 hubs, 40 hub page skips. mainnet-beta 10 rate-limited of 346 (2.9%); publicnode 5,711 ok of 5,713, 0 rate-limited. Post-boundary queue is empty.
- Started background sampler for more fresh #6 launches (created after 1793662244): `backtest sample --n 300 --min-age-h 25 --max-age-h 26.9`, log data/backtest/work/s111_sample.log.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) Read s111_sample.log; if new eligible rows, score them newest-first (same flags, nohup) before the 21:37 refit. (2) Refit at/after 21:37 with `SMR_FRESH_HOLDOUT_AFTER=1793662244`; read headline and `auc_moved_subset` fresh AUC with CIs. (3) >= $4k paper split at 40 unique mints. (4) StalkChain flags at >= 20 rows.

### 2026-11-03 20:21-20:24 CST - session 110 (graduations, scoring restart)
- Graduation collector: 6 new, 717 total. StalkChain log still 4 rows.
- s107 run finished: 41/66 scored (budget hit, 571 s, 13.9 s per launch). Tracer: 680 probes, 134 cache hits (19.7%), 169 hubs, 145 hub page skips. mainnet-beta 29 rate-limited of 373 (7.8%); publicnode 11,490 ok, 0 rate-limited.
- Restarted scoring for the rest (`backtest run --max-age-h 33 --parallel 3 --budget-min 9 --newest-first`, nohup, log data/backtest/work/s110_run.log): 25 queued.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: unchanged (refit at/after 21:37 with fresh #6, read s110_run.log first; >= $4k paper split at 40 unique mints; StalkChain flags at >= 20 rows).

### 2026-11-03 20:14-20:16 CST - session 109 (graduations, paper check)
- Graduation collector: 6 new, 711 total. StalkChain log still 4 rows.
- s107 scoring run active (34/66 at 20:15); not touched. A `risk paper cycle` was running; no gate change attempted.
- Paper report (read-only): 723 scored (SKIP 562, REDUCED 144, NORMAL 17); strategy 0 closed / 1 open; buy-everything 7 closed / 100 open, -13.59%. Mayhem unknowns 1 of 696 priced (0.1%, fine). 25/25 resolved SKIPs dumped vs 100% of non-SKIPs: the benchmark resolutions so far don't separate (all dumped).
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: unchanged from s108 (refit at/after 21:37 with fresh #6; >= $4k paper split at 40 unique mints; StalkChain flags at >= 20 rows).

### 2026-11-03 20:10-20:13 CST - session 108 (>= $4k paper split recheck)
- Graduation collector: 13 new, 705 total. StalkChain log still 4 rows.
- s107 scoring run active (23/66 at 20:11); not touched.
- Read-only paper.db: closed clean non-void positions with entry >= $4k (same exclusions as s99): 29 rows, 24 unique mints (13 stop-loss, 11 take-profit), unchanged since s99. Still below the 40-mint bar; no filter test run. Score buckets by mint: < 40 3/4 losers, 40-79 5/14, >= 80 5/6 (n tiny).
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) Refit at/after 21:37 with `SMR_FRESH_HOLDOUT_AFTER=1793662244`; read headline and `auc_moved_subset` fresh AUC with CIs. (2) >= $4k paper split at 40 unique mints (paper closes are slow: 0 new in ~40 min). (3) StalkChain flags at >= 20 enriched rows. (4) mainnet-beta 429 rate.

### 2026-11-03 20:06-20:09 CST - session 107 (fresh #6 recount, scoring restart)
- Graduation collector: 15 new, 692 total. StalkChain log still 4 rows.
- s105 run finished: 30/96 scored (budget hit, 624 s, 20.8 s per launch, slower than s103's 8.6 s). mainnet-beta 47 rate-limited of 522 (9.0%); publicnode 8,572 ok of 8,577, 0 rate-limited.
- Fresh #6 count (created after 1793662244, no AUC peek): 95 scored, 0 errors, 95 labeled, 91 usable, 6 bad_24h. Now meets the >= 30 usable and >= 5 bad bar, so the next refit (not before 21:37) can use it. Bad rate 6.6% (newest-first).
- Restarted scoring for the rest (same flags, nohup, log data/backtest/work/s107_run.log): 66 queued.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) Refit at/after 21:37 with `SMR_FRESH_HOLDOUT_AFTER=1793662244` (fresh #6 ready); read headline and `auc_moved_subset` fresh AUC with CIs. Let s107 run finish first if possible (more fresh rows). (2) >= $4k paper split at 40 unique mints; test entry-multiple SKIP there. (3) StalkChain flags at >= 20 enriched rows. (4) mainnet-beta 429 rate at 9%: fine while publicnode carries ~94%.

### 2026-11-03 20:00-20:02 CST - session 106 (moved-subset AUC in calibrate)
- Graduation collector: 5 new, 677 total. StalkChain log still 4 rows.
- s105 scoring run still active (21/96 at 20:01, one launch took 304 s); not touched. Fresh #6 recount next session.
- Code (commit 386fa65): `backtest calibrate` report.json now has `auc_moved_subset` for train/test/fresh: n, n_bad, AUC and bootstrap 95% range on launches with entry_x_launch >= 1.1 (s104 showed 481/608 train launches sat < 1.1x with only 5 bad, so headline AUC mostly measures "did anything happen"). Report-only; does not change the deploy gate. New unit test; suite 159 passed.
- No gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) read s105_run.log summary (~20:05+), recount fresh #6 (need >= 30 usable, >= 5 bad, no AUC peek); restart scoring if no run active. (2) At the next refit (not before 21:37), read `auc_moved_subset` alongside headline AUC; consider making the moved-subset fresh AUC a reported (not gating) criterion. (3) >= $4k paper split at 40 unique mints; test entry-multiple SKIP there. (4) StalkChain flags at >= 20 enriched rows.

### 2026-11-03 19:53-19:57 CST - session 105 (fresh #6 count, restart scoring)
- Graduation collector: 4 new, 672 total. StalkChain log still 4 rows.
- s103 run finished: 65/161 scored (budget hit, 561 s, 8.6 s per launch). Tracer totals (first d256d3f summary): 800 probes, 208 probe cache hits (26%), 195 hubs, 164 hub page skips, 622 complete histories. RPC: publicnode 12,091 ok of 12,102, 0 rate-limited; mainnet-beta 26 rate-limited of 421 (6.2%).
- Fresh #6 count (created after 1793662244, no AUC peek): 67 scored, 0 errors, 67 labeled, 65 usable, 3 bad_24h. Below the >= 5 bad bar; bad rate 4.6% so far (newest-first, so these are the youngest launches).
- Restarted scoring for the rest (`backtest run --max-age-h 33 --parallel 3 --budget-min 9 --newest-first`, nohup, log data/backtest/work/s105_run.log): 96 queued.
- Note: data/backtest/backtest.db and data/backtest.db are empty 0-byte files; the real DB is data/backtest/work/backtest.db.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) read s105_run.log (~20:03), recount fresh #6 (need >= 5 bad). (2) `backtest calibrate` also reports AUC with CI on the moved subset (entry_x_launch >= 1.1). (3) >= $4k paper split at 40 unique mints; test entry-multiple SKIP there. (4) StalkChain flags at >= 20 enriched rows.

### 2026-11-03 19:47-19:51 CST - session 104 (train-only drift look, Next 1b)
- Graduation collector: 6 new, 668 total. StalkChain log still 4 rows. s103 fresh #6 scoring run active (22/161 at 19:48); not touched.
- TRAIN only (s101 split: 608 rows created before 1793652485, first 60%; no test/fresh rows looked at). Early half 304 (28 bad) score AUC 0.579 (0.46-0.69); late half 304 (24 bad) 0.689 (0.60-0.78). So within train the score got better over time, not worse; the fresh #5 drop is not visible in train.
- creator_sold and serial_deployer show `triggered` 17/28 bad and 254/276 good early but 0/24 and 3/280 late: an artifact of those rules being weighted 0 in later scoring (they no longer trigger), not a market change. Don't use `triggered` for those two rules across versions; read their evidence instead.
- Big finding: 481 of 608 train launches were entered at < 1.1x launch price and only 5 of them were bad; 47 of the 52 bad are among the 127 that had moved >= 1.1x by as_of (37% bad). entry_x_launch alone has train AUC 0.896 (0.82-0.96) and txs_first_5m 0.862 (0.80-0.91) vs risk raw_points 0.622 (0.54-0.69). Caveat: this is largely built into the label (a coin still at launch price can barely fall 50% on the curve, and the "not graduated" leg needs <= 1.10x launch), so it measures "did anything happen", not rug risk.
- Among moved launches only (entry >= 1.1x, n=127, 47 bad) the risk score AUC is 0.680 (0.58-0.77). At >= 1.5x: 34 of 44 bad (77%); at >= 3x: 14 of 15 bad. Supports Next 0(b) (high entry multiple -> SKIP), but every paper entry is already ~11x+ launch, so this says almost every coin that reaches the paper floor fast is likely to halve; the backtest set has only 15 such rows (n tiny).
- No code change, no gate change, no refit. Evaluation launches used: unchanged (train only).
- Next: (1) read s103_run.log (~19:53), count fresh #6 usable + bad without AUC peek, restart scoring if no run. (2) Small code change: have `backtest calibrate` also report AUC (with CI) on the "moved" subset (entry_x_launch >= 1.1), so headline AUC isn't dominated by dead launches. (3) >= $4k paper split at 40 unique mints; test entry-multiple SKIP there. (4) StalkChain flags at >= 20 enriched rows.

### 2026-11-03 19:43-19:45 CST - session 103 (start fresh holdout #6 scoring)
- Graduation collector: 6 new, 662 total. StalkChain log still 4 rows.
- s102 sampler finished: 297 checked; backtest.db now 5,620 candidates, 2,062 eligible.
- Started fresh #6 scoring run newest-first (`backtest run --max-age-h 33 --parallel 3 --budget-min 9 --newest-first`, nohup, log data/backtest/work/s103_run.log): 161 launches queued, budget 9 min, so expect ~35-40 scored this pass.
- No code change, no gate change, no refit (not before 21:37). Evaluation launches used: unchanged.
- Next: (1) read s103_run.log summary (~19:53); count fresh #6 usable + bad (created after 1793662244, no AUC peek); restart scoring for the rest if no run active. (2) train-only drift look (Next 1b). (3) >= $4k paper split at 40 unique mints. (4) StalkChain flags at >= 20 enriched rows.

### 2026-11-03 19:41-19:44 CST - session 102 (start fresh holdout #6 sampling)
- Graduation collector: 8 new, 656 total. StalkChain log still 4 rows.
- Started background sampler for post-boundary launches (fresh #6, created after 1793662244): `backtest sample --n 300 --min-age-h 25 --max-age-h 26.3` (only ~1.3 h of launches are both past the boundary and >= 25 h old right now), log data/backtest/work/s102_sample.log. 297 candidates checked at session end.
- No code change, no gate change, no refit (not before 21:37). Evaluation launches used: unchanged.
- Next: (1) read s102_sample.log result; start fresh #6 scoring newest-first (`backtest run --max-age-h 33 --parallel 3 --budget-min 9`, nohup) if none active; re-sample as the window grows. (2) train-only drift look (Next 1b). (3) >= $4k paper split at 40 unique mints. (4) StalkChain flags at >= 20 enriched rows.

### 2026-11-03 19:36-19:40 CST - session 101 (refit, fresh holdout #5)
- Graduation collector: 8 new, 648 total. StalkChain log still 4 rows.
- s99 run finished: 21/21 scored (291 s, 13.9 s per launch; publicnode 5,958 ok of 5,967, 0 rate-limited). Fresh #5 count (created after 1793652485, before AUC look): 147 scored, 147 labeled, 137 usable, 20 bad_24h. Meets the bar.
- Ran `SMR_FRESH_HOLDOUT_AFTER=1793652485 python -m risk backtest calibrate` at 19:37 (1,286 exported, 1,014 usable; log data/backtest/work/s101_calibrate.log). Train 608 (52 bad), test 406 (39 bad, reused). Picked on train: both_off, skip>=40, reduced>=35 (identical to live). Train AUC 0.723 (0.67-0.78); test 0.718 (0.66-0.78, not clean). FRESH #5: AUC 0.623 (95% CI 0.51-0.74, n=137, 20 bad, created 2026-11-02 14:55-17:30 CST) - passes on point estimate, lower bound below 0.60; weakest fresh result of five (earlier 0.79, 0.69, 0.69, 0.785). Rests on 20 bad, more than any earlier fresh set, so it is also the most informative one.
- NOT deployed: fitted bt20261104-7f5b6ef8 equals live values, no gain. Live bt20261103-b57add76 stays.
- Evaluation launches used: + fresh #5 (147 scored created after 1793652485 up to 1793662244; 137 usable). NEW fresh boundary: created after 1793662244 (2026-11-02 17:30:44 CST).
- No code change, no gate change.
- Next: (1) build fresh #6 (sample post-boundary, score newest-first); (2) train-only look at why later launches score worse (drift); (3) >= $4k paper split at 40 unique mints; (4) StalkChain flags at >= 20 enriched rows.

### 2026-11-03 19:30-19:34 CST - session 100 (data quality: are sub-$1k shadow entries real?)
- Graduation collector: 5 new, 640 total. StalkChain log still 4 rows. s99 fresh #5 scoring run still active (14/21 at 19:32); not touched, no second copy started.
- s99 Next 3: checked the 6 newest shadow entries below $1k mcap (ids 816-824) on DexScreener. DexScreener itself reports the same tiny mcaps on the dex=pumpfun pair ($6, $28, $192, $376, $399, $92), with no liquidity figure, and id 824 also has a dust PumpSwap pool ($1 mcap, $2.39 liquidity). None had graduated and dumped. So these entries are source-side mispriced curve quotes (DexScreener's pump.fun pricing), not real prices: a live curve cannot sit below ~$2.6k.
- Conclusion: exclude entry_mcap < ~$2.5k rows from every filter analysis on shadow/all outcomes (s98 count: shadow ~575, all ~105 below $4k). Strategy/momentum books are unaffected (they need >= $30k). Benchmarks left unchanged by design. n = 6 checked, all consistent.
- No code change, no gate change, no refit (fresh #5 run still in flight). Evaluation launches used: unchanged.
- Next: (1) When s99 run ends (~19:37), count fresh #5 usable + bad (no AUC peek); refit only if >= 30 usable and >= 5 bad. (2) Re-run the >= $4k paper split when unique mints >= 40. (3) Consider a paper-report flag that marks entries below the curve floor as "mispriced" (report-only, does not change which positions open).

### 2026-11-03 19:26-19:30 CST - session 99 (filtering measurement: paper closes >= $4k entry)
- Graduation collector: 17 new, 635 total. StalkChain log still 4 rows.
- Started s99 fresh #5 scoring run for the 21 remaining launches (`backtest run --max-age-h 33 --parallel 3 --budget-min 9 --newest-first`, nohup, log data/backtest/work/s99_run.log).
- Read-only paper.db (s98 Next 1): clean closed non-void positions excluding garbage rows 134/135/338/397/569, split by entry mcap: < $4k 3 rows (2 mints), $4k-$30k 17 rows (14 mints), >= $30k 12 rows (10 mints). Open: shadow 646 (70 at >= $4k, 7 at >= $30k), all 121 (18 / 2), strategy 16 (6 / 3), momentum 1.
- Unique mints with entry >= $4k: 24 (13 stop-loss, 11 take-profit). Risk score >= 80: 5 stop-loss / 1 take-profit; score < 80: 8 stop-loss / 10 take-profit. Directionally the score works on paper outcomes, but n = 24 mints (6 in the high bucket), far too thin for a gate change; nearly all of these were already SKIP (score >= 40), so it would not change strategy buys anyway.
- Liquidity / mcap at entry shows no separation (stop-loss and take-profit both cluster around 0.2-0.3).
- No code change, no gate change, no refit (fresh #5 still short of 30 usable; checked next session). Evaluation launches used: unchanged.
- Next: (1) Read s99 summary (~19:36); count fresh #5 usable + bad rows (no AUC peek); refit only if >= 30 usable and >= 5 bad. (2) Re-run the >= $4k paper split when unique mints >= 40. (3) Check a few sub-$4k shadow entries on DexScreener (dex=pumpswap?) to decide real vs mispriced.

### 2026-11-03 19:21-19:25 CST - session 98 (data quality: sub-$1k entries in paper books)
- Graduation collector: 11 new, 618 total. StalkChain log still 4 rows.
- s95 fresh #5 run finished: 36/57 scored in 566 s (15.7 s per launch, budget hit); publicnode 9,252 ok of 9,263, 4 rate-limited. 21 launches remain; no run active, none started this session.
- Read-only paper.db scan of entry_mcap (s97 follow-up, before writing an entry sanity check): the problem is much bigger than 4 rows. Entries below $1k mcap: shadow 213 of 670, all 32 of 128, strategy 6 of 16 (all 6 already voided pre_gate_bug), momentum 0 of 1. Below $4k: shadow 575 of 670, all 105 of 128. Latest sub-$1k shadow entry 1793755129 (~2026-11-03 19:18 CST), so it is still happening; the all book's last one was ~12:24 CST.
- Why it matters: a pump.fun curve cannot price below its launch price (~28 SOL mcap, ~$2.6k at SOL $93), so a sub-$1k entry is either a graduated coin that dumped on PumpSwap or a mispriced/dust quote. The shadow book enters at score time regardless of the $30k floor (by design), so these are not strategy trades, but any filter test that uses shadow outcomes must exclude or separately bucket them.
- Did NOT ship a $1k/$50M entry bound: it would change which positions the shadow and buy-everything benchmark books open, and the benchmarks are meant to stay unchanged. No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: (1) In filter analysis, restrict shadow/all outcomes to entry_mcap >= $30k (shadow 18, all 4 rows) or at least >= $4k, and drop rows 134/135/338/397/569; report n. (2) Decide with evidence whether sub-$4k shadow entries are real (graduated + dumped: check a few mints on DexScreener for dex=pumpswap) or mispriced; only add an entry sanity bound for the strategy/momentum books (they already need >= $30k). (3) Start a scoring run for the 21 remaining fresh #5 launches if none is active. (4) 19:31+ refit only once fresh #5 has >= 30 usable and >= 5 bad (count, no AUC peek).

### 2026-11-03 19:14-19:18 CST - session 97 (data quality check on paper closed book)
- Graduation collector: 6 new, 607 total. StalkChain log still 4 rows.
- s95 fresh #5 scoring run still active: 30/57 scored at ~19:15; not restarted.
- Read-only paper.db: 36 closed non-void (29 unique mints), unchanged.
- Found 4 garbage mints in the closed book that must be EXCLUDED from any filter test: positions 134/135 (entry mcap $9, 08:31), 338 (entry mcap $343M, entry price 0.34, 10:50), 397 (entry mcap $4, 11:53) and 569 (entry mcap $48, 14:51). 397 and 569 are tagged take_profit but have pnl -86% / -44%: the mark price hit 2x but the fill model (exit_fill_price) on a dust-priced pair filled far below entry. All are mispriced quotes (wrong pair / dust pool). 134-397 predate the s49 sanity gate (63acfe6); 569 (14:51) is after it, so the liquidity<2%-of-mcap check doesn't catch a dust pool where liq/mcap looks normal.
- Clean closed sample is therefore 25 unique mints, not 29: the 30-mint bar for paper-book filter tests is further away than thought.
- Quick look (n tiny, NOT evidence, no gate change): among clean shadow closes, entries >= 40x launch price were 4 SL / 2 TP; minutes-from-launch-to-entry shows no separation (SL 8-17 min, TP 9-17 min).
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: (1) Add an entry sanity check: keep entry pending when entry mcap < ~$1k or > ~$50M, or entry price implies a mcap far from the curve/first_priced_mcap (test against rows 134/338/397/569), and exclude such rows in filter analysis. (2) Read s95 summary; start another run if launches remain. (3) Count fresh #5 labeled rows (no AUC peek) for the 19:31+ refit.

### 2026-11-03 19:08-19:11 CST - session 96 (data: graduations, run check)
- Graduation collector: 6 new, 601 total. StalkChain log still 4 rows.
- s95 fresh #5 scoring run active (started 19:06): 10/57 scored so far (5-150 s per launch); not restarted.
- Read-only paper.db: 36 closed (29 unique mints; shadow 15 SL / 14 TP, all 3 SL / 4 TP), 766 open; one mint short of the 30 unique-mint bar.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: (1) read s95 summary (~19:15); start another run if launches remain and none active. (2) Count fresh #5 labeled rows (no AUC peek) for the 19:31+ refit. (3) Paper-book filter tests once 30 unique closed mints (next session likely).

### 2026-11-03 19:05-19:07 CST - session 95 (data: graduations, fresh #5 scoring)
- Graduation collector: 6 new, 595 total. StalkChain log still 4 rows.
- s92 run finished: 49/106 scored in 552 s (11.3 s per launch, budget hit); publicnode 12,891 ok of 12,896 calls, 0 rate-limited. Tracer: 738 probes, 170 cache hits, 128 hub page skips.
- Started s95 run (same command), 57 remaining; log data/backtest/work/s95_run.log.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: (1) read s95 summary (~19:15); if launches remain and none active, start another. (2) Count fresh #5 labeled rows (no AUC peek) for the 19:31+ refit. (3) Paper-book filter tests at 30 unique closed mints.

### 2026-11-03 18:59-19:02 CST - session 94 (data: graduations, run check)
- Graduation collector: 9 new, 589 total. StalkChain log still 4 rows.
- s92 fresh #5 scoring run still active: 40/106 scored at ~19:00 (5-26 s per launch); budget ends ~19:01. Not restarted.
- Read-only paper.db: 35 closed (28 unique mints), 760 open; still below the 30 unique-mint bar.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: (1) read s92 summary; if launches remain and no run active, start another identical run (`backtest run --max-age-h 33 --parallel 3 --budget-min 9 --newest-first`, nohup, log to data/backtest/work/). (2) Count fresh #5 labeled rows (no AUC peek) for the 19:31+ refit. (3) Paper-book filter tests at 30 unique closed mints.

### 2026-11-03 18:53-18:56 CST - session 93 (data: graduations, run check)
- Graduation collector: 3 new, 580 total. StalkChain log still 4 rows.
- s92 fresh #5 scoring run active (started 18:52): 9/106 scored so far at 22-62 s per launch; not restarted.
- Read-only paper.db: 35 closed (28 unique mints), 760 open; still below the 30 unique-mint bar.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: (1) read s92 summary when it ends (~19:02); start another run if launches remain and none active. (2) Count fresh #5 labeled rows (no AUC peek) for the 19:31+ refit. (3) Paper-book filter tests at 30 unique closed mints.

### 2026-11-03 18:51-18:54 CST - session 92 (data: graduations, fresh #5 scoring)
- Graduation collector: 15 new, 577 total. StalkChain log still 4 rows.
- s90 run finished: 41/147 post-boundary launches scored in 566 s (13.8 s per launch, budget hit). publicnode healthy again: 1 null in 12,583 calls (vs 85% in s85), so the 33 h window fix solved it.
- Started s92 run (same command), 106 remaining; log data/backtest/work/s92_run.log.
- Read-only paper.db: 35 closed (28 unique mints), 760 open; still below the 30 unique-mint bar.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: (1) read s92 summary; if launches remain and no run is active, start another. (2) Once ~all 147 scored, count fresh #5 labeled rows (no AUC peek) for the 19:31+ refit. (3) Paper-book filter tests at 30 unique closed mints.

### 2026-11-03 18:45-18:47 CST - session 91 (data: graduations, run check)
- Graduation collector: 13 new, 562 total. StalkChain log still 4 rows.
- s90 fresh #5 scoring run healthy: 38/147 scored after ~8 min (18-102 s per launch), so the 33 h window fix is working. Not restarted (still running).
- Read-only paper.db: 35 closed (28 unique mints), 760 open; still below the 30 unique-mint bar.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: (1) next session: read s90's final summary; if < 147 scored and no run active, start another identical run (check ps). (2) Count fresh #5 labeled rows (no AUC peek) toward >= 30 usable and >= 5 bad for the 19:31+ refit. (3) Paper-book filter tests at 30 unique closed mints.

### 2026-11-03 18:36-18:40 CST - session 90 (data: fresh #5 sampling worked, scoring started)
- Graduation collector: 6 new, 549 total. StalkChain log still 4 rows.
- s89 sampler finished: candidates/eligible now 5,323 / 1,901. Post-boundary (created after 1793652485): 300 candidates, 147 eligible, 0 scored yet. The s89 fix worked.
- Started background scoring run s90 (`backtest run --max-age-h 33 --parallel 3 --budget-min 9 --newest-first`), picked exactly the 147 post-boundary launches; log data/backtest/work/s90_run.log.
- Housekeeping: removed an empty stray data/backtest/backtest.db created by an ad-hoc sqlite connect (real db is data/backtest/work/backtest.db).
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: (1) next session: read s90_run.log summary (scored count, s per launch, publicnode null share); if < 147 scored and no run active, start another identical run. (2) Count fresh #5 rows with labels (no AUC peek) toward >= 30 usable and >= 5 bad for the 19:31+ refit. (3) Filtering on paper books still waits on 30 unique closed mints.

### 2026-11-03 18:29-18:36 CST - session 89 (infra: RPC window; fresh #5 sampling fix)
- Graduation collector: 5 new, 543 total. StalkChain log still 4 rows.
- Probed publicnode directly: getTransaction on create txs works up to 33.9 h old and returns null from 34.1 h on (25 samples, 31-36 h). Earlier it served ~2 days. So s85's 85% null rate came from scoring 34-40 h old launches, not a general outage.
- Found: only 1 candidate (0 eligible) exists after the fresh #5 boundary (1793652485, now ~27.7 h ago). The recent scoring runs were spending the free RPC on older, pre-boundary launches that can't count for fresh #5.
- Shipped (commit 04b0290): publicnode tx-history default 36 h -> 33 h, so 34 h+ txs go straight to mainnet-beta instead of a wasted null first. 158 tests pass.
- Started background sampler for post-boundary launches: `backtest sample --n 300 --min-age-h 25 --max-age-h 27.6`, log data/backtest/work/s89_sample.log.
- No gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: (1) next session: read s89_sample.log; if eligible post-boundary candidates exist, start `backtest run --max-age-h 33 --parallel 3 --budget-min 9 --newest-first` (check ps first). (2) Filtering work continues on paper books (35 closed / 28 unique mints, need 30).

### 2026-11-03 18:25-18:28 CST - session 88 (data: graduations, RPC diagnosis)
- Graduation collector: 9 new, 538 total. StalkChain log still 4 rows.
- s85 run finished: only 5 of 241 scored (budget hit, 614 s, 122.8 s per launch).
- Cause found (measurement): publicnode is answering with null results far more often. Null share of publicnode calls: s80 181/11,637 (1.6%), s83 551/4,390 (12.6%), s85 570/674 (85%). Null answers push work to mainnet-beta (s85: 762 calls, 46 rate-limited, 636 ms avg latency vs publicnode 42 ms), so per-launch time rose 13.8 s -> 33 s -> 123 s. It is not our mainnet-beta share causing it; publicnode stopped returning the data.
- Did NOT start another scoring run: on current free RPC it would score ~5 launches per 9 min. Fresh #5 growth is effectively stalled until publicnode recovers or a Helius key is added.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: (1) next session: probe publicnode with one getSignaturesForAddress on a recent mint to see if nulls persist; if they do, consider adding another free endpoint (only documented public ones) behind the existing breaker, or pause scoring runs. (2) Otherwise unchanged; filtering work continues on the paper books (35 closed / 28 unique mints, need 30).

### 2026-11-03 18:18-18:20 CST - session 87 (data: graduations, run check)
- Graduation collector: 13 new, 529 total. StalkChain log still 4 rows.
- s85 scoring run for fresh #5 still at 1/241 after ~7 min (log shows only the first launch); not restarted, its 9-min budget ends it soon.
- Read-only paper.db: 35 closed (28 unique mints), 717 open; still below the 30 unique-mint bar.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: unchanged. Next session: read s85's final summary; if it scored < 5, compare mainnet-beta vs publicnode call share before starting another run.

### 2026-11-03 18:14-18:16 CST - session 86 (data: graduations, run check)
- Graduation collector: 15 new, 516 total. StalkChain log still 4 rows.
- s85 scoring run for fresh #5 in progress, but slow: 1/241 done after ~3 min (22.7 s on the first launch); not restarted.
- Read-only paper.db: 35 closed (28 unique mints), 715 open; still below the 30 unique-mint bar.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: unchanged. If s85 finishes with < 15 scored, compare mainnet-beta vs publicnode call share in its summary before starting the next run.

### 2026-11-03 18:11-18:13 CST - session 85 (data: graduations, fresh #5 scoring run)
- Graduation collector: 2 new, 501 total (one page timed out). StalkChain log still 4 rows.
- s83 run finished: 20 of 269 scored (deadline hit, 660 s, 33.0 s per launch, slower than s80's 13.8 s; 2 in-flight abandoned; tracer 269 probes, 75 cache hits (27.9%), 12 hub page skips; publicnode 0 rate-limited of 4,390, mainnet-beta 36 of 822).
- Started background scoring run s85 for fresh #5 (same flags, 241 eligible, log data/backtest/work/s85_run.log).
- Read-only paper.db: 35 closed (28 unique mints), 715 open; still below the 30 unique-mint bar.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: unchanged. Watch per-launch time: if s85 is also ~30 s/launch, check whether mainnet-beta share (822 calls in s83 vs 236 in s80) is the cause.

### 2026-11-03 18:04-18:06 CST - session 84 (data: graduations, run check)
- Graduation collector: 8 new, 499 total. StalkChain log still 4 rows.
- s83 scoring run for fresh #5 in progress (19/269 at check); not restarted.
- Read-only paper.db: 35 closed (28 unique mints), 707 open; still below the 30 unique-mint bar.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: unchanged.

### 2026-11-03 17:57-17:59 CST - session 83 (data: graduations, fresh #5 scoring run)
- Graduation collector: 8 new, 491 total. StalkChain log still 4 rows.
- s80 run finished: 42 of 312 scored (budget hit, 579 s, 13.8 s per launch; tracer 916 probes, 154 cache hits (16.8%), 72 hub page skips; publicnode 12 rate-limited of 11,637, mainnet-beta 22 of 236).
- Started background scoring run s83 for fresh #5 (same flags, log data/backtest/work/s83_run.log).
- Read-only paper.db: 34 closed (27 unique mints), 702 open; unchanged, still below the 30 unique-mint bar.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: unchanged.

### 2026-11-03 17:53-17:54 CST - session 82 (data: graduations, run check)
- Graduation collector: 4 new, 483 total. StalkChain log still 4 rows.
- s80 scoring run for fresh #5 still in progress (29/312 at check); not restarted.
- Read-only paper.db: 34 closed (27 unique mints), 702 open; still below the 30 unique-mint bar.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: unchanged.

### 2026-11-03 17:50-17:52 CST - session 81 (data: graduations, run check)
- Graduation collector: 5 new, 479 total. StalkChain log still 4 rows.
- s80 scoring run for fresh #5 in progress (16/312 at check); not restarted.
- Read-only paper.db: 34 closed (27 unique mints), 702 open; still below the 30 unique-mint bar.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: unchanged.

### 2026-11-03 17:45-17:47 CST - session 80 (data: graduations, fresh #5 scoring run)
- Graduation collector: 4 new, 474 total. StalkChain log still 4 rows.
- s78 run finished: 43 of 364 scored (budget hit, 595 s, 13.8 s per launch; publicnode 2 rate-limited of 12,140, mainnet-beta 6 of 278).
- Started background scoring run s80 for fresh #5 (same flags, log data/backtest/work/s80_run.log).
- Read-only paper.db: 34 closed (27 unique mints), 698 open; unchanged, still below the 30 unique-mint bar.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: unchanged (grow #5, count with `== 1`, no AUC peek; splits at >= 30 unique-mint closes; StalkChain flags at >= 20 enriched rows).

### 2026-11-03 17:41-17:44 CST - session 79 (data: graduations, run check)
- Graduation collector: 5 new, 470 total. StalkChain log still 4 rows.
- s78 scoring run for fresh #5 still in progress (34/364 at check, 9 min budget); not restarted.
- Read-only paper.db: 34 closed (27 unique mints), unchanged; still below the 30 unique-mint bar for entry-multiple and liq/mcap splits.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: unchanged from s78 (grow #5, count with `== 1`, no AUC peek; splits at >= 30 unique-mint closes; StalkChain flags at >= 20 enriched rows).

### 2026-11-03 17:33-17:35 CST - session 78 (data: graduations, fresh #5 scoring run)
- Graduation collector: 11 new, 465 total. StalkChain log still 4 rows.
- Started background scoring run s78 for fresh holdout #5 (`backtest run --max-age-h 40 --parallel 3 --budget-min 9 --newest-first`, log data/backtest/work/s78_run.log). No other scoring run was active.
- No code change, no gate change, no refit (not before 19:31). Evaluation launches used: unchanged.
- Next: (1) check s78 finished, keep growing #5 (re-sample if window runs dry); count #5 with `== 1`, no AUC peek; (2) entry-multiple and liq/mcap splits at >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 17:29-17:33 CST - session 77 (refit, fresh holdout #4)
- Graduation collector: 7 new, 454 total. StalkChain log still 4 rows. s75 run had finished: 21 of 389 scored (budget hit, 310 s, 14.8 s per launch; publicnode 0 rate-limited of 7,552).
- Ran `SMR_FRESH_HOLDOUT_AFTER=1793643423 python -m risk backtest calibrate` at 17:31 (1,029 rows exported, 821 usable). Train 492 (2026-10-31 04:27 - 2026-11-02 08:27 CST, 44 bad), test 329 (2026-11-02 08:27-12:17 CST, base bad rate 8.8%). Picked on train: both_off, skip>=40, reduced>=35 (identical to live). Train AUC 0.738 (0.67-0.79); test 0.729 (0.66-0.79; reused, not clean). FRESH holdout #4: AUC 0.785 (95% CI 0.68-0.88, n=93, 6 bad, created 2026-11-02 12:17-14:48 CST) - clean first look, passes; first fresh holdout since #1 whose lower bound clears 0.60. Rests on only 6 bad.
- NOT deployed: fitted bt20261103-8cf10036 equals live (live test AUC 0.7294), so no gain. Live bt20261103-b57add76 stays; it has now held up on four clean fresh holdouts. Test SKIP recall 0.86, precision 0.15.
- Paper report (read-only): 20/20 resolved SKIPs dumped 50%+ vs 100% of resolved non-SKIPs too, so the 24 h dump label separates nothing on the paper books yet (almost everything dumps); filtering value has to show in which coins reach $30k and their PnL, not the dump rate.
- Evaluation launches used: + fresh #4 (103 created after 1793643423 up to 1793652485; 93 usable). NEW fresh boundary: created after 1793652485 (2026-11-02 14:48:05 CST).
- No code change, no gate change.
- Next: (1) grow fresh #5 (newest-first scoring, re-sample if the window runs dry); (2) entry-multiple and liq/mcap splits at >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows; (4) from ~11:45 CST Nov 4, label graduations.

### 2026-11-03 17:24-17:27 CST - session 76 (data: graduations, run check)
- Graduation collector: 7 new, 447 total. StalkChain log still 4 rows.
- s75 short scoring run in progress (7/389 at check, budget 5 min, ends before 17:31); not restarted. A `risk paper cycle` was running.
- Read-only paper.db: unchanged (34 closed non-voided, 27 unique mints, 17 TP / 17 SL; 680 open). Still below the 30 unique-mint bar.
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) at/after 17:31: confirm s75 finished (`ps`), recount #4 with `== 1`, then refit with `SMR_FRESH_HOLDOUT_AFTER=1793643423`; report fresh #4 AUC with 95% CI and mark #4 USED; (2) entry-multiple and liq/mcap splits at >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 17:22-17:25 CST - session 75 (data: graduations, short scoring run)
- Graduation collector: 6 new, 440 total. StalkChain log still 4 rows.
- s73 run finished: 51 of 442 scored (budget hit, 563 s, 11.0 s per launch; tracer 803 probes, 126 cache hits, 136 hub page skips; publicnode 0 rate-limited of 13,732, mainnet-beta 2 of 122).
- Started a SHORT background scoring run (`--budget-min 5`, log data/backtest/work/s75_run.log) so it ends before 17:31 and doesn't overlap the refit.
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) at/after 17:31: confirm s75 finished (`ps`), recount #4 with `== 1`, then refit with `SMR_FRESH_HOLDOUT_AFTER=1793643423`; report fresh #4 AUC with 95% CI and mark #4 USED; (2) entry-multiple and liq/mcap splits at >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 17:13-17:16 CST - session 74 (data: graduations, run check)
- Graduation collector: 8 new, 434 total. StalkChain log still 4 rows.
- s73 scoring run in progress (7/442 at check); not restarted. A `risk paper cycle` was running.
- Read-only paper.db: unchanged (34 closed non-voided, 27 unique mints, 17 TP / 17 SL; 679 open). Still below the 30 unique-mint bar for entry-multiple and liq/mcap splits.
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) at/after 17:31: let s73 finish (check `ps`), recount #4, then refit with `SMR_FRESH_HOLDOUT_AFTER=1793643423`; report fresh #4 AUC with 95% CI and mark #4 USED; (2) entry-multiple and liq/mcap splits at >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 17:10-17:14 CST - session 73 (data: fresh #4 qualifies, new scoring run)
- Graduation collector: 10 new, 426 total. StalkChain log still 4 rows.
- s70 run finished: 47 of 501 scored (budget hit, 570 s, 12.1 s per launch; tracer 886 probes, 141 cache hits 15.9%, 136 hub page skips; publicnode 56 rate-limited of 12,355, mainnet-beta 4 of 137).
- Fresh #4 count (created after 1793643423, no AUC peek): 103 scored, 103 labeled, 93 usable, 6 bad_24h (counted with `== 1`). Meets the >= 30 rows / >= 5 bad bar, so the 17:31+ refit can use it. Still only 6 bad: expect a wide CI.
- Started background scoring run s73 (same command, log data/backtest/work/s73_run.log) to keep growing #4 before the refit.
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged (#4 not yet evaluated).
- Next: (1) at/after 17:31: let s73 finish (check `ps`), recount #4, then refit with `SMR_FRESH_HOLDOUT_AFTER=1793643423`; report fresh #4 AUC with 95% CI and mark #4 USED; (2) entry-multiple and liq/mcap splits at >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 17:02-17:04 CST - session 72 (data: graduations, run check)
- Graduation collector: 6 new, 416 total. StalkChain log still 4 rows.
- s70 scoring run still in progress (44/501 at check, budget ends ~17:04); not restarted. A `risk paper cycle` was running.
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) read s70 run summary, recount fresh #4 bad with `== 1` (needs >= 5 bad); (2) refit at/after 17:31 only if #4 qualifies; (3) entry-multiple and liq/mcap splits at >= 30 unique-mint closes; (4) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 16:59-17:01 CST - session 71 (data: graduations, run check)
- Graduation collector: 14 new, 410 total. StalkChain log still 4 rows.
- s70 scoring run still in progress (29/501 at check); not restarted. A `risk paper cycle` was running.
- Read-only paper.db: unchanged from s68 (34 closed non-voided, 27 unique mints, 17 TP / 17 SL; 647 open).
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) read s70 run summary, recount fresh #4 bad with `== 1` (needs >= 5 bad); (2) refit at/after 17:31 only if #4 qualifies; (3) entry-multiple and liq/mcap splits at >= 30 unique-mint closes; (4) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 16:53-16:56 CST - session 70 (data: re-sample done, fresh #4 scoring run)
- Graduation collector: 9 new, 396 total. StalkChain log still 4 rows.
- s69 re-sample finished: candidates 5,023, eligible 1,754 (was 4,648 / 1,581).
- Started background newest-first scoring (`python -m risk backtest run --max-age-h 40 --parallel 3 --budget-min 9 --newest-first`, 501 launches queued, log data/backtest/work/s70_run.log). No AUC peek.
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) read s70 run summary, then recount fresh #4 rows/bad (created after 1793643423, count bad with `== 1`, needs >= 5 bad); (2) refit at/after 17:31 only if #4 qualifies; (3) entry-multiple and liq/mcap splits at >= 30 unique-mint closes; (4) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 16:48-16:53 CST - session 69 (data: fresh #4 recount + label-count bug note)
- Graduation collector: 3 new, 387 total. StalkChain log still 4 rows.
- s67 run finished: 58 of 394 scored (budget hit, 587 s, 10.1 s per launch; tracer 852 probes, 141 cache hits 16.6%, 126 hub page skips; publicnode 2 rate-limited of 14,185, mainnet-beta 6 of 161).
- Fresh #4 count (created after 1793643423, no AUC peek): 63 scored, 63 labeled, 55 usable, 2 bad_24h. NOTE: label fields are stored as ints 0/1, not booleans, so a `bad_24h is True` check counts 0; s66's "0 bad" was likely this bug. Count with `== 1`. Comparison, prior 24 h before the boundary: 444 usable, 38 bad (8.6%); #4 is running 2/55 (3.6%), n small.
- Pool dry again (133 candidates past boundary, 63 eligible, all scored). Started re-sample in background (`python -m risk backtest sample --n 400 --min-age-h 26 --max-age-h 40`, log data/backtest/work/s69_sample.log).
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) when s69 sample finishes (check `ps`), start newest-first scoring run, then recount #4 bad with `== 1` (needs >= 5 bad); (2) entry-multiple and liq/mcap splits at >= 30 unique-mint closes, with the entry_mcap sanity filter; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 16:45-16:48 CST - session 68 (data: graduations + close count)
- Graduation collector: 7 new, 384 total. StalkChain log still 4 rows. s67 scoring run still in progress (39/394 at check); not restarted.
- Read-only paper.db: 34 closed non-voided (17 take-profit / 17 stop-loss) over 27 unique mints (shadow 27, all 7); 647 open. Still below the 30 unique-mint bar for entry-multiple and liq/mcap splits.
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) read s67 run summary, then count fresh #4 rows/bad (created after 1793643423), no AUC peek; (2) entry-multiple and liq/mcap splits at >= 30 unique-mint closes, with the entry_mcap sanity filter; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 16:38-16:41 CST - session 67 (data: fresh #4 scoring run)
- Graduation collector: 12 new, 377 total. StalkChain log still 4 rows. A `risk paper cycle` (paper routine) was running.
- s66 re-sample finished: candidates 4,648, eligible 1,581 (was 4,262 / 1,393).
- Started background newest-first scoring (`python -m risk backtest run --max-age-h 40 --parallel 3 --budget-min 9 --newest-first`, 394 launches queued, log data/backtest/work/s67_run.log). No AUC peek.
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) read s67 run summary, then count fresh #4 rows/bad (created after 1793643423), no AUC peek; (2) entry-multiple and liq/mcap splits at >= 30 unique-mint closes, with the entry_mcap sanity filter; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 16:31-16:35 CST - session 66 (data: fresh #4 count + re-sample)
- Graduation collector: 8 new, 365 total. StalkChain log still 4 rows.
- s64 run finished: 47 of 265 scored (budget hit, 574 s, 12.2 s per launch; tracer 986 probes, 112 cache hits 11.4%, 108 hub page skips; publicnode 0 rate-limited of 13,953, mainnet-beta 6 of 83).
- Fresh #4 count (created after 1793643423, no AUC peek): 28 scored, 28 labeled, 25 usable, 0 bad_24h. Pool is dry again: 62 candidates past the boundary, 28 eligible, all scored. 0 bad so far means #4 needs many more rows before it can be used (>= 5 bad).
- Started re-sample in background (`python -m risk backtest sample --n 400 --min-age-h 26 --max-age-h 40`, log data/backtest/work/s66_sample.log; 386 new candidates). Note: there is no .venv/bin/risk entry point; use `.venv/bin/python -m risk`.
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) when s66 sample finishes (check `ps`), start newest-first scoring run (`python -m risk backtest run --max-age-h 40 --parallel 3 --budget-min 9 --newest-first`), then recount #4; (2) entry-multiple and liq/mcap splits at >= 30 unique-mint closes, with the entry_mcap sanity filter; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 16:24-16:27 CST - session 65 (measurement: liq/mcap on paper closes, preliminary)
- Graduation collector: 12 new, 357 total. StalkChain log still 4 rows. s64 scoring run in progress (17/265 at check); not restarted.
- Paper closes: 31 closed non-voided (16 take-profit / 15 stop-loss) over 24 unique mints (shadow 24, all 7); still below the 30-unique-mint bar.
- Preliminary entry liq/mcap split (first close per mint, n=24): liq/mcap < 0.25 -> 7 SL / 5 TP; >= 0.25 -> 5 SL / 7 TP. No usable separation at this n (difference is 2 coins). Also found entry_mcap units are inconsistent in older rows (values like 4, 9, 48 and one 343M, likely pre-3c584ae Mayhem-supply bug and a bad quote), so mcap-based splits must drop rows with entry_mcap < 1,000 or > 10M first.
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) read s64 run summary, then count fresh #4 rows/bad (created after 1793643423), no AUC peek; (2) re-run liq/mcap + entry-multiple splits at >= 30 unique mints with the mcap sanity filter; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 16:19-16:21 CST - session 64 (data: fresh #4 scoring run)
- Graduation collector: 0 new, 345 total. StalkChain log still 4 rows.
- s63 re-sample finished: candidates 4,262, eligible 1,393 (was 3,080 / 811).
- Started background newest-first scoring for fresh holdout #4 (`backtest run --max-age-h 40 --parallel 3 --budget-min 9 --newest-first`, 265 launches queued, log data/backtest/work/s64_run.log). No AUC peek.
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) read s64 run summary, then count fresh #4 rows/bad (created after 1793643423), no AUC peek; (2) entry-multiple and liq/mcap splits once >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 16:15-16:19 CST - session 63 (data: graduations + fresh #4 re-sample)
- Graduation collector: 9 new, 345 total graduations. StalkChain log still 4 rows. A `risk paper cycle` (paper routine) was running.
- s61 run finished: 44 of 111 scored (budget hit, 554 s, 12.6 s per launch; tracer 867 probes, 162 cache hits 18.7%; publicnode 12 rate-limited of 12,416, mainnet-beta 10 of 227 = 4.4%).
- Fresh #4 count: 0 scored rows created after 1793643423. The candidate pool ran dry at the boundary (newest candidate 1793643557), so s61 scored only older launches. Started re-sample in background (`backtest sample --n 400 --min-age-h 26 --max-age-h 40`, log data/backtest/work/s63_sample.log; 391 new candidates being checked).
- Note: data/backtest/backtest.db at that path is a stray 0-byte file (untracked, 15:06); the real DB is data/backtest/work/backtest.db.
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) when s63 sample finishes (check `ps`), start newest-first scoring run for fresh #4, then count rows/bad (no AUC peek); (2) entry-multiple and liq/mcap splits once >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 ~14:00-16:20 CST - edge-features session (owner task: smart money, X heat, bundle skip, pullbacks)
- Shipped behind flags in data/paper_edge.json (all on there, all off in code), strategy + momentum only; shadow/all unchanged. Commits 74681b2 bundle, d8563ad smart money, a318d2b X heat, 89a17c8 pullback, plus docs.
- Bundle evidence (704 labelled, bad_24h): same-slot >= 20% bad 26.9% (Wilson 16.8-40.3, n=52) vs 6.9% (5.2-9.1, n=652). 50/52 were already SKIP, so the gate adds little. No past non-void paper entry would have been blocked. Six shadow coins >= $30k with ss >= 20% lost ~95-100% and three hit TP.
- Smart money: the 247 leaderboard wallets (7d+30d top 150) had 0 early-buyer matches across 801 backtest launches and 29 paper mints, so overlap is useless as a signal. The live multi-trader buy feed is the real one (11 Solana tokens over 60 min, up to 8 traders on one token). StalkChain responses carry no credit info, so the budget is counted locally (data/stalkchain_usage.jsonl + veto log).
- X heat: counts + a 25-post sample per term. The first live sample was theme "elon": 6.4 posts/h vs 8.0 prior, 0.8x, 5 authors, -3 points. X heat cannot push momentum over the >= 50 momentum threshold (it changes only the narrative part), by design.
- Pullback: the high is sampled only at polls (~2 per cycle), so the measured depth is a lower bound. Watch for missed runners (pullback_expired) vs better entries before judging it.
- Next: after >= 30 strategy/momentum closes, compare entered_pullback vs the first-price shadow on the same mints, smart-lifted vs not, and x_heat_points vs outcome. Keep StalkChain <= 30/day.

### 2026-11-03 15:38-15:41 CST - session 62 (data: graduations)
- Graduation collector: 6 new, 336 total graduations. s61 background scoring run (fresh #4) still in progress (8/111 at check); not restarted. StalkChain log still 4 rows. Paper closes unchanged: 28 closed non-voided (15 stop-loss / 13 take-profit) over 21 unique mints.
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) read s61 run summary, then count fresh #4 rows/bad (created after 1793643423), no AUC peek; (2) entry-multiple and liq/mcap splits once >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 15:35-15:38 CST - session 61 (data: graduations + fresh #4 scoring run)
- Graduation collector: 7 new, 330 total graduations. StalkChain log still 4 rows. Paper closes unchanged: 28 closed non-voided (15 stop-loss / 13 take-profit) over 21 unique mints, still below 30.
- Started background scoring for fresh holdout #4 (`backtest run --max-age-h 40 --parallel 3 --budget-min 9 --newest-first`, log data/backtest/work/s61_run.log). No AUC peek.
- No code change, no gate change, no refit (not before 17:31). Evaluation launches used: unchanged.
- Next: (1) read s61 run summary, then count fresh #4 rows/bad (created after 1793643423); (2) entry-multiple and liq/mcap splits once >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 15:28-15:36 CST - session 60 (refit, fresh holdout #3)
- Graduation collector: 9 new, 323 total. s58 run had finished: 26 of 144 scored (budget hit, 555 s, 21.3 s per launch; tracer 606 probes, 92 cache hits 15%; publicnode 164 rate-limited of 9,516 = 1.7%, mainnet-beta 2 of 301). StalkChain log still 4 rows.
- Ran `SMR_FRESH_HOLDOUT_AFTER=1793635224 python -m risk backtest calibrate` at 15:31 (761 rows exported). Train 368 (2026-10-31 04:27 - 2026-11-02 04:07 CST), test 246 (2026-11-02 04:07-10:00 CST, base bad rate 7.7%). Picked on train: both_off, skip>=40, reduced>=35 (identical to live). Train AUC 0.756 (0.68-0.82); test 0.7112 (0.61-0.81; reused, overlaps fresh #2, not clean). FRESH holdout #3: AUC 0.69 (95% CI 0.53-0.82, n=65, 5 bad, created 2026-11-02 10:01-12:17 CST) - clean first look.
- NOT deployed: fitted version bt20261103-53a21845 equals live (live test AUC 0.7112), so it doesn't beat live. Live bt20261103-b57add76 stays; it has now held up on three clean fresh holdouts, though #2 and #3 rest on only 5 bad each. Test SKIP recall 0.79, precision 0.13.
- Evaluation launches used: + fresh #3 (75 created after 1793635224 up to 1793643423; 65 usable). NEW fresh boundary: created after 1793643423 (2026-11-02 12:17:03 CST).
- No code change, no gate change.
- Next: (1) entry-multiple and liq/mcap splits once >= 30 unique-mint closes; (2) StalkChain flags vs outcomes once >= 20 enriched rows; (3) grow fresh #4 (newest-first scoring); refit not before 17:31.

### 2026-11-03 15:24-15:27 CST - session 59 (data: graduations + close count)
- Graduation collector: 14 new, 314 total graduations. s58 background scoring run still in progress (19/144 at check); not restarted. StalkChain log still 4 rows.
- Read-only paper.db count: 28 closed non-voided positions (15 stop-loss / 13 take-profit) over 21 unique mints (all 7, shadow 21 positions); still below the 30 unique-mint threshold for entry-multiple and liq/mcap splits.
- No code change, no gate change, no refit (not before 15:31). Evaluation launches used: unchanged.
- Next: (1) at/after 15:31, once s58 run finishes (check `ps`), run the refit with SMR_FRESH_HOLDOUT_AFTER=1793635224, report fresh AUC with 95% CI; (2) entry-multiple and liq/mcap splits once >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 15:18-15:21 CST - session 58 (data: graduations + next scoring run)
- Graduation collector: 8 new, 300 total graduations. StalkChain log still 4 rows. A `risk paper cycle` (paper routine) was running.
- s55 run finished: 30 of 179 scored (budget hit, 656 s, 21.9 s per launch). Tracer: 732 probes, 90 probe cache hits (12.3%), 123 hubs, 101 hub page skips. RPC: publicnode 11,183 calls / 0 rate-limited; mainnet-beta 200 calls / 5 rate-limited (2.5%).
- Started s58 background scoring (same command, newest-first, 9-min budget, log data/backtest/work/s58_run.log) to add fresh #3 rows before the 15:31 refit.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) at/after 15:31, once s58 run finishes (check `ps`), run the refit with SMR_FRESH_HOLDOUT_AFTER=1793635224, report fresh AUC with 95% CI; (2) entry-multiple and liq/mcap splits once >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 15:16-15:20 CST - session 57 (check: fresh holdout #3 readiness)
- Graduation collector: 7 new, 292 total graduations. s55 background scoring run still in progress (28/179 at check, past its 9-min budget start window; not restarted). A `risk paper cycle` (paper routine) was running. StalkChain log still 4 rows.
- Fresh holdout #3 (created after 1793635224) count, no AUC looked at: 75 scored + labeled, 65 usable, 5 bad_24h (up from s55's 46 / 2 bad as the run and labeler caught up). That meets the >= 30 rows and >= 5 bad minimum, so the 15:31 refit can now run (only 5 bad: expect a wide CI; the lower bound will likely sit below 0.60).
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) at/after 15:31, after the s55 run finishes (check `ps`), run the refit with SMR_FRESH_HOLDOUT_AFTER=1793635224 and report the fresh AUC with its 95% CI; (2) re-run entry-multiple and liq/mcap splits once >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 15:11-15:15 CST - session 56 (measurement: liquidity/market-cap ratio at entry vs closed paper exits)
- Graduation collector: 6 new, 285 total graduations. s55 background scoring run still in progress (16/179 at check); not restarted. StalkChain log still 4 rows.
- Read-only: 16 unique mints with closed non-voided positions (entry mcap $1k-$10M, first position per mint). Liquidity/mcap at entry: <0.15 n=3 (1 SL / 2 TP); 0.15-0.30 n=9 (6 SL / 3 TP); >=0.30 n=4 (3 SL / 1 TP). No monotonic pattern and n is tiny, so liquidity-vs-mcap is NOT a supported gate yet.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) [s57: fresh #3 now 65 usable / 5 bad, refit allowed at 15:31] read s55 run summary; (2) re-run entry-multiple and liq/mcap splits once >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 15:06-15:09 CST - session 55 (data: fresh holdout #3 count + scoring run)
- Graduation collector: 17 new, 279 total graduations. No backtest or paper process running at start.
- Fresh holdout #3 (created after 1793635224) count check, no AUC looked at: 169 candidates, 75 eligible, 46 scored + labeled, only 2 bad_24h. The refit gate needs >= 30 rows and >= 5 bad, so a 15:31 refit would not be able to deploy; skip it until >= 5 bad.
- Started background scoring (`backtest run --max-age-h 40 --parallel 3 --budget-min 9 --newest-first`, 179 eligible 26-40 h launches, log data/backtest/work/s55_run.log). Next session: read its summary.
- No code change, no gate change, no refit. Evaluation launches used: unchanged.
- Next: (1) read s55 run, re-count fresh #3 bad (need >= 5) before any refit; (2) re-run entry-multiple split once >= 30 unique-mint closes; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 14:59-15:03 CST - session 54 (measurement: entry multiple vs closed paper outcomes)
- Graduation collector: 9 new, 262 total graduations. A `risk paper cycle` was running (paper routine), so no gate change would have been allowed anyway.
- Tested Next 0(b) idea "entry >= ~20x launch price -> SKIP" on realized exits (read-only, 25 closed non-voided positions, junk quotes excluded, entry multiple = launch price_vs_launch scaled by position entry price). Position counts by multiple: <5x 8 (4 SL / 4 TP), 5-12x 4 (1 SL / 3 TP), 12-20x 1 (1 SL), >=20x 8 (5 SL / 3 TP). Unique mints >=20x: 6 (4 SL, 2 TP; eiWhkspZ and JAFQtEgs appear in both shadow and all books). All but one were already SKIP. A 67% vs 50% stop-loss rate on n=6 vs 8 is noise, so the idea is NOT supported on realized outcomes yet (s31's 7/7 used the dumped50 label, not exits).
- No code change, no gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: (1) refit at/after 15:31 with SMR_FRESH_HOLDOUT_AFTER=1793635224 if fresh #3 has >= 30 rows and >= 5 bad (check counts first, don't peek AUC); (2) re-run this entry-multiple split once >= 30 unique-mint closes (dedupe across books); (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 14:53-14:57 CST - session 53 (check: Mayhem gate health + StalkChain log size)
- Graduation collector: 2 new, 253 total graduations. No backtest or paper process running.
- Mayhem section of `paper report` (read-only): unknown status 1 of 403 scored+priced (0.25%, well under the ~2% alarm), so detection is healthy. Blocked entries so far: strategy 45, momentum 23. Shadow closed returns: Mayhem -87.7% mean (n=4) vs not-Mayhem -13.8% (n=14); all-book Mayhem -97.1% (n=1) vs not-Mayhem +32.2% (n=6). Direction now agrees with the owner rule on realized paper exits, but n is tiny (5 Mayhem closes) and conflicts with the earlier label finding (Mayhem less often bad), so no claim either way yet.
- StalkChain enrichment log has only 4 rows (paper buys are rare under the $30k + Mayhem gates), so the dev-mint-count / organic-score / top-holder flags can't be measured against outcomes yet; revisit when >= ~20 rows with outcomes.
- No code change, no gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: (1) refit at/after 15:31 with SMR_FRESH_HOLDOUT_AFTER=1793635224 if fresh #3 has >= 30 rows and >= 5 bad (check counts first, don't peek AUC); (2) Next 0(b)/(c) once >= 30 resolved paper outcomes, using the alive-at-entry split; (3) StalkChain flags vs outcomes once >= 20 enriched rows.

### 2026-11-03 14:51-14:55 CST - session 52 (data quality: pick_pair avoids fake side pools)
- Graduation collector: 11 new, 251 total graduations. No backtest or paper process running.
- Shipped (commit d48b345): `prices.pick_pair` now drops any DexScreener pair whose liquidity is < 2% of its market cap (same rule as `gates.quote_sanity`) when another priced pair exists, so a coin like 2QUUWXGM (fake $343M PumpSwap side pool, real ~$38k on the curve) gets the curve/real-pool price at entry instead of being held pending. If every pair fails, old choice is kept and the s49 entry gate keeps it pending. 1 new test; full suite 140 passed. No paper process was running at commit.
- Effect: on the s49 measurement (n=417 entry quotes) this touches the same 2 cases; 0 strategy/momentum entries changed. Data-quality fix, not a risk filter. Not measured on live quotes yet.
- No refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: (1) refit at/after 15:31 with SMR_FRESH_HOLDOUT_AFTER=1793635224 if fresh #3 has >= 30 rows and >= 5 bad (check counts first, don't peek AUC); (2) Next 0(b)/(c) once >= 30 resolved paper outcomes, using the alive-at-entry split; (3) hold-time null (exit_at/entry_at unix ints) in ad-hoc queries, cosmetic.

### 2026-11-03 14:42-14:46 CST - session 51 (report: alive-at-entry split of dump rates)
- Graduation collector: 5 new, 240 total graduations. No backtest or paper process running.
- Shipped (commit 896272a): `report.alive_split` + `tiers[*]` and `skip_hit_rate.alive_at_entry` now show dump rates only for coins alive at entry (price_vs_launch >= 1 and liquidity >= 2% of mcap). Report-only, no gate change. 2 new tests; full suite 139 passed.
- Measured on paper.db (read-only): SKIP resolved 14, 12 alive at entry, 12/12 dumped (2 dead/bad-quote removed); REDUCED 2/2 alive, 2/2 dumped; NORMAL 0 resolved. Caveat: "resolved" = dumped OR 24 h track done, so early on it is biased toward dumps (a dump resolves immediately, a survivor needs 24 h). The real comparison waits for track_done rows (~first ones from ~noon Nov 4).
- No refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: (1) refit at/after 15:31 with SMR_FRESH_HOLDOUT_AFTER=1793635224 if fresh #3 has >= 30 rows and >= 5 bad (check counts first, don't peek AUC); (2) pick_pair prefer curve pair while curve incomplete; (3) fix hold-time null in s50's query (exit_at/entry_at unix ints); (4) Next 0(b)/(c) once >= 30 resolved paper outcomes, using the alive-at-entry split.

### 2026-11-03 14:40-14:44 CST - session 50 (measurement: closed paper outcomes, alive vs dead at entry)
- Graduation collector: 2 new, 235 total graduations. No backtest or paper process running (s43 queue finished in s49).
- Read-only look at all 25 closed non-voided positions (all 7, shadow 18). Excluding the bogus 343M-mcap entry (s49 quote-sanity case) and two already-dead entries ($4 and $9 mcap), shadow closed = 15: take_profit 6, stop_loss 9. The 14/14 "SKIP dumped" headline uses the dumped50 label, not exits; on exits, shadow SKIPs are 6 TP vs 7 SL (excl. the 3 junk rows), so SKIP vs non-SKIP is not yet separable on realized outcomes.
- Entries at >= $30k (the paper floor), shadow, real quotes: 7 (5 stop_loss, 2 take_profit; 1 of the SL was REDUCED, rest SKIP). Liquidity/mcap at entry: SL 22-40%, TP 21-29%, no separation. n=7, evidence far too thin for any gate.
- hold-time column computes as null via julianday (exit_at/entry_at are likely unix ints); cosmetic, report-only.
- No gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: (1) refit at/after 15:31 with SMR_FRESH_HOLDOUT_AFTER=1793635224 if fresh #3 has >= 30 rows and >= 5 bad (check counts first, don't peek AUC); (2) report: split benchmark outcomes into alive-at-entry vs already-dead and exclude quote-sanity rows; (3) pick_pair prefer curve pair while curve incomplete; (4) Next 0(b)/(c) once >= 30 resolved paper outcomes.

### 2026-11-03 14:36-14:41 CST - session 49 (data quality: mispriced-pool entry check)
- Graduation collector: 8 new, 233 total graduations.
- s43 queue's run (PID 629870) finished: 46 of 182 scored, budget hit at 559 s, 12.2 s per launch, 0 abandoned (old code). Tracer: 873 probes, 82 cache hits (9.4%). Fresh #3 AUC not peeked.
- Explained s48's pos 338 (2QUUWXGM, shadow SKIP): not a unit bug. Both DexScreener and GeckoTerminal quoted a non-canonical PumpSwap pool (F2XD5m96...) at $0.3434 (= $343M mcap, 131,943x launch) with $1.5M listed liquidity, while the coin was still on its bonding curve at ~$38k. The sources agreed, so the 25% disagreement check couldn't catch it. pick_pair takes the highest-liquidity pair, so a side pool with fake reserves wins.
- Shipped (commit 63acfe6): `gates.quote_sanity` + engine `_gate_entry` keeps an entry pending when liquidity is under 2% of the circulating-supply market cap. Measured on paper.db launches with an entry quote (n=417): flags exactly 2 (2QUUWXGM at 0.44%, EqBMTpRK at 0.000004% which was already SKIP for low liquidity); next-lowest real ratio is 5.0% (fKJAtGZY, $2.5M), then 8.1%. Changes 0 strategy/momentum entries and removes 1 bogus -100% SKIP "dump" from the shadow book going forward (existing rows untouched). 1 new test; full suite 137 passed. No paper process was running at commit.
- Not an evidence-based risk filter: a data-quality guard (n=2). No refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: (1) pick_pair could prefer the pump.fun curve pair while the curve is incomplete, so the entry gets the real price instead of waiting; (2) report: split benchmark outcomes into alive-at-entry vs already-dead (s48 Next 2); (3) refit at/after 15:31 with SMR_FRESH_HOLDOUT_AFTER=1793635224 if fresh #3 has >= 30 rows and >= 5 bad; (4) Next 0(b)/(c) once >= 30 resolved paper outcomes.

### 2026-11-03 14:28-14:33 CST - session 48 (data check: sub-$1k entry market caps)
- Graduation collector: 2 new, 225 total graduations. s43 queue's run (PID 629870, old code) at 41/182, ~8-80 s per launch; left running, no second copy.
- Paper books at 14:28: strategy $999.69 (1 open), buy-everything $865.16 (-13.48%), filter ahead by $134.53; 48 waiting for $30k. Closed: all 7, shadow 18, strategy 0. Too few for Next 0(b)/(c).
- Finding: 109 of 397 shadow and 23 of 107 buy-everything positions entered at a market cap under $1,000 (some $2-$90). Checked 2 against DexScreener: it reports the same prices ($45.92 and $52.72 mcap on the pump.fun pair; ours is 2x for the 2B Mayhem supply), so these are real quotes for coins that were already drained/dead before the ~10-15 min entry, not a unit bug. They are far below the $30k floor and the entry gates already mark them (FDV drained below launch), so the strategy book is unaffected; they do dilute benchmark labels (~1 in 4 benchmark entries is a coin that was already dead at entry).
- Two oddities, not yet explained: pos 397 closed as take_profit with pnl -86% (exit liquidity $3.91, so slippage ate the 2x; exit reason label is misleading), and pos 338 entered at $343M mcap (price 0.3434, liq $1.5M), almost certainly a wrong pair/quote; it closed -100% and counts as a SKIP dump in the 14/14 SKIP hit rate.
- No gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: (1) check pos 338's entry_source/entry_pair and, if a wrong pair, propose (with tests) a quote sanity check (reject entry quotes > ~$5M mcap on a pump.fun curve, or liq/mcap mismatch) in the tracker, without editing paper.db; (2) in the report, split benchmark outcomes into "alive at entry" (mcap >= launch) vs "already dead" so the SKIP hit rate isn't inflated by dead coins; (3) Next 0(b)/(c) once >= 30 resolved paper outcomes.

### 2026-11-03 14:25-14:29 CST - session 47 (filter measurement: where as-of NORMALs go)
- Graduation collector: 7 new, 223 total graduations.
- s43 queue's run (PID 629870) started 14:04 with the OLD code (before 7c91df1), so the hard deadline doesn't apply to it; 22 min in it is at 32/182, but per-launch time is back to ~10-45 s (young 26-32 h window), confirming s43's window theory. Left running; no second copy.
- Paper books at 14:26: strategy $999.69 (1 open), buy-everything $865.16 (-13.48%), filter ahead by $134.53; 47 waiting for $30k; resolved benchmark outcomes still 14 (SKIP 14/14 dumped vs 100% non-SKIP). StalkChain log still 4 entries. Too few for Next 0(b)/(c).
- Measurement (paper.db read-only, 403 decided launches, excl. voided where noted): as-of score NORMAL 165 -> after entry gates NORMAL 8, REDUCED 71, SKIP 86. Gate reasons on downgraded launches: few holders 182, low liquidity 178, FDV drained below launch 84, Mayhem 46. Key finding: 127 of 160 non-voided as-of NORMALs (79%) are Mayhem coins, vs 31 of 187 as-of SKIPs (17%). The risk score rates Mayhem coins as clean (they're agent-bought, so bundle/funder rules rarely fire), so the owner's Mayhem gate is doing most of the work that the score's NORMAL tier would otherwise pass. Non-Mayhem as-of NORMALs: 33 (0 dumped of 30 resolved-not-dumped labels so far; dumped50 mostly 0 because they're unresolved/frozen curves).
- max_fdv_seen is null for 352/431 launches and cross_at is never set, so "reached $30k ever" can't be measured from paper.db yet; use the graduation pool (Next 0 a0) for paper-matched labels.
- No gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: (1) when the graduation labeler starts (~11:45 Nov 4), score non-Mayhem graduations as the main paper-matched pool; (2) next session checks whether PID 629870 finished and how many fresh-#3 launches it scored; (3) Next 0(b)/(c) once >= 30 resolved paper outcomes.

### 2026-11-03 14:18-14:22 CST - session 46 (infra: backtest hard deadline)
- Graduation collector: 3 new, 216 total graduations.
- Shipped s45's Next (1), commit 7c91df1: `backtest run --budget-min` now abandons launches still in flight 120 s after the budget (hard_grace_s; not saved, a later run picks them up) and the CLI exits the process so stuck worker threads can't hold it. Summary gains an `abandoned` count. 2 new tests; full suite 136 passed.
- Why: s41's run (budget 540 s, started 13:56) was still alive at 14:19 (23 min) with 3/73 scored at 184/811/670 s per launch, blocking s43's queued fresh re-sample. Stopped it (PID 617989); the 3 finished launches were already committed. s43's queue then started (`backtest sample --n 400 --min-age-h 26 --max-age-h 32`, then the budgeted run with the new code); log data/backtest/work/s43_run.log.
- No gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: (1) next session reads s43_run.log: sample counts, per-launch time (expect ~15 s inside the window) and whether the hard deadline fired; (2) Next 0(b)/(c) filtering tests once >= 30 resolved paper outcomes.

### 2026-11-03 14:12-14:17 CST - session 45 (data quality check: frozen shadow prices)
- Graduation collector: 3 new, 213 total graduations.
- Checked s44's frozen-price finding. All open positions with stale marks (6-7 h old: 21 all, 21 shadow, 15 strategy, 1 momentum) are VOIDED positions, which the tracker intentionally stops marking; s44's "all marks fresh" only held for live ones. Of 25 random live, freshly marked shadow positions held > 2 h with last_price = entry_price, 24 match DexScreener's current price within 1% and show 0 trades in the last 6 h (dead bonding curves, not stale quotes); 1 (6mwa2GLG) DexScreener now shows a ~-100% price, a single edge case.
- Conclusion: no bug. A dead pump.fun curve can still be sold into at its quoted price, so ret ~ 0 (not dumped) is the right label for those; no change to the tracker or label rules. These are almost all below the $30k floor, so the strategy book is unaffected.
- s41 background run: 3/73 scored, 184-811 s per launch (36 h+ window, as s43 found); budget 540 s is only checked between launches, so it overruns while in-flight launches finish. s43's queued re-sample runs after it. No second copy started.
- No gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: (1) small infra: make `backtest run --budget-min` also stop in-flight launches (or skip launches older than the publicnode window) so stuck 36 h+ launches don't block the queued fresh sample; (2) Next 0(b)/(c) filtering tests once >= 30 resolved paper outcomes.

### 2026-11-03 14:09-14:13 CST - session 44 (filter-measurement check, data quality finding)
- Graduation collector: 10 new, 210 total graduations.
- s41 background run still slow (1/73 scored at 183.7 s, the 36 h+ window issue from s43); s43's queued re-sample + run waits on it. No second copy started.
- Paper books at 14:09: strategy $999.69 (1 open), buy-everything $865.16 (-13.48%), filter ahead by $134.53; 46 waiting for $30k; Mayhem 174 / not 195 / unknown 1 (blocked strategy 43, momentum 21). Resolved benchmark outcomes 14 (SKIP 12/12 dumped vs 100% non-SKIP). StalkChain log still 4 entries.
- Tried to use the shadow book's intraday min/max returns as an early filter signal (positions held >= 2 h, n=264): hit -50% only 1-6% in every tier (as-of NORMAL 1/94, REDUCED 2/36, SKIP 5/134), hit 2x 0-4%. No usable separation.
- Why: DATA QUALITY FINDING. 274 of 354 open shadow positions (77%) and 71 of 100 open buy-everything positions have last_price exactly equal to entry_price (min_ret = max_ret = 0), although marks are fresh (all < 5 min old). Likely these launches had no trades after entry (dead bonding curve, quote unchanged), not a stale cache - NOT yet verified. If true, the tracker scores them ret_24h ~ 0 at 24 h (not dumped) unless the quote disappears (then -100% via DEAD_NO_PRICE_S). That would under-count bad outcomes for dead launches and flatter both books; 348 of 354 shadow entries are below $30k, so it matters mostly for the shadow/benchmark labels, less for the strategy book.
- No gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: (1) verify the frozen-price cause: for ~10 frozen mints, compare the quote source's volume/txn fields (or DexScreener pair txns h1/h6) to confirm zero trades vs stale quotes; (2) if they're dead, propose (with tests) treating "no trades for >= 6 h and price never moved" as its own outcome bucket in the labels/report rather than ret_24h = 0; don't touch paper.db directly.

### 2026-11-03 14:03-14:06 CST - session 43 (diagnosis + data collection)
- Graduation collector: 5 new, 200 total graduations.
- Found why scoring slowed (s39 69 s/launch, s41 first launch 184 s): every one of the 336 unscored eligible candidates is now 36+ h old (70 at 36-40 h, 266 older; 0 younger than 36 h). That is past publicnode's ~36 h history window, so their txs fall through to slow mainnet-beta. Not an RPC router bug; the sample window ran dry.
- Queued in background (waits for s41's run, PID 617989, to exit): `backtest sample --n 400 --min-age-h 26 --max-age-h 32`, then `backtest run --max-age-h 34 --parallel 3 --budget-min 9 --newest-first`. Log data/backtest/work/s43_run.log. New launches will count toward fresh holdout #3 (created after 1793635224).
- Paper books at 14:03: strategy $999.69 (1 open), buy-everything $865.16 (-13.48%), filter ahead by $134.53; 45 waiting for $30k; Mayhem 173 / not 192 / unknown 1 (blocked strategy 43, momentum 21). Resolved benchmark outcomes 14 (SKIP 12/12 dumped vs 100% non-SKIP), no separation measurable. StalkChain log still 4 entries.
- No gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: next session reads s43_run.log (sample counts, per-launch time; expect ~15 s if the window theory holds). Going forward, re-sample with `--max-age-h 32` whenever unscored eligible candidates younger than 34 h run out, and keep `run --max-age-h 34`.

### 2026-11-03 13:57-13:59 CST - session 42 (data collection only)
- Graduation collector: 6 new, 195 total graduations.
- s41 background run (started 13:56, 73 launches, budget 540 s) still going; did not start a second copy.
- Paper books at 13:58: strategy $999.69 (1 open), buy-everything $865.33 (-13.47%), filter ahead by $134.36; 45 waiting for $30k; Mayhem 167 / not 187 / unknown 1 (blocked strategy 42, momentum 20). Resolved benchmark outcomes 13 (SKIP 11/11 dumped vs 100% non-SKIP), no separation measurable. StalkChain log still 4 entries.
- No gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: unchanged; next session reads s41's RPC mix (mainnet-beta share) when it finishes.

### 2026-11-03 13:55-13:58 CST - session 41 (data collection only)
- Graduation collector: 11 new, 189 total graduations.
- s39 background run finished (budget hit): only 9/88 scored, 69 s per launch (vs 15.6 s in s37). Cause looks like RPC mix: mainnet-beta took 1,023 of 2,862 calls (36%, vs ~6% before) at 1,015 ms average latency, 33 rate-limited (3.2%) + 10 errors; publicnode 1,839 calls, 0 rate-limited, 53 ms. Tracer 184 probes, 16 cache hits, 10 hubs. Started the next newest-first budgeted run, log data/backtest/work/s41_run.log.
- Paper books at 13:56: strategy $999.69 (1 open), buy-everything $865.33 (-13.47%), filter ahead by $134.36; 45 waiting for $30k; Mayhem 167 / not 187 / unknown 1 (blocked strategy 42, momentum 20). Resolved benchmark outcomes 13 (SKIP 11/11 dumped vs 100% non-SKIP), no separation measurable. StalkChain log still 4 entries.
- No gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: if s41's run also shows mainnet-beta > ~20% of calls, check why the RPC router is shifting load off publicnode (breaker never tripped, so maybe a routing/weight rule for getTransaction); small infra item, below filtering.

### 2026-11-03 13:51-13:54 CST - session 40 (data collection only)
- Graduation collector: 15 new, 178 total graduations.
- s39 background run still going (5/88 scored at check, slow 120-257 s per launch); did not start a second copy.
- Paper books at 13:52: strategy $999.69 (1 open), buy-everything $865.33 (-13.47%), filter ahead by $134.36; 45 waiting for $30k; Mayhem 167 / not 187 / unknown 1 (blocked strategy 42, momentum 20). Resolved benchmark outcomes 13 (SKIP 11/11 dumped vs 100% non-SKIP), no separation measurable. StalkChain log still 4 entries.
- No gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: unchanged. Watch s39 per-launch time (much slower than s37's 15.6 s); if it stays > 100 s, check RPC 429s in its summary.

### 2026-11-03 13:45-13:48 CST - session 39 (data collection only)
- Graduation collector: 5 new, 163 total graduations.
- s37 background run finished (budget hit): 38/135 scored, 15.6 s per launch. mainnet-beta 40/633 rate-limited (6.3%), publicnode 0/9,260; tracer 731 probes, 98 cache hits (13%), 139 hub page skips. No endpoint change. Started the next newest-first budgeted run, log data/backtest/work/s39_run.log.
- Paper books at 13:45: strategy $999.69 (1 open), buy-everything $865.44 (-13.46%), filter ahead by $134.25; 43 waiting for $30k; Mayhem 160 / not 179 / unknown 1 (blocked strategy 40, momentum 18). Resolved benchmark outcomes 13 (SKIP 11/11 dumped vs 100% non-SKIP), no separation measurable. StalkChain log still 4 entries.
- No gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: unchanged.

### 2026-11-03 13:42-13:45 CST - session 38 (data collection only)
- Graduation collector: 7 new, 158 total graduations.
- s37 background run still going (28/135 scored at check); did not start a second copy.
- Paper books at 13:42: strategy $999.69 (1 open), buy-everything $865.44 (-13.46%), filter ahead by $134.25; 43 waiting for $30k; Mayhem 160 / not 179 / unknown 1 (blocked strategy 40, momentum 18). Resolved benchmark outcomes 13 (SKIP 11/11 dumped vs 100% non-SKIP), still no separation measurable. StalkChain log still 4 entries.
- No gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: unchanged.

### 2026-11-03 13:34-13:37 CST - session 37 (data collection only)
- Graduation collector: 7 new, 151 total graduations.
- s35 background run finished (budget hit): 34/172 scored, 17.4 s per launch. mainnet-beta 27/423 rate-limited (6.4%), publicnode 3/10,806; tracer 629 probes, 77 cache hits (12%), 90 hub page skips. No endpoint change. Started the next newest-first budgeted run, log data/backtest/work/s37_run.log.
- Paper books at 13:34: strategy $999.69 (1 open), buy-everything $865.40 (-13.46%), filter ahead by $134.29; 41 waiting for $30k; Mayhem 158 / not 177 / unknown 1 (blocked strategy 39, momentum 17). Resolved benchmark outcomes 13 (SKIP 11/11 dumped vs 100% non-SKIP), still no separation measurable. StalkChain log still 4 entries.
- No gate change, no refit (next not before 15:31). Evaluation launches used: unchanged.
- Next: unchanged.

### 2026-11-03 13:31-13:35 CST - session 36 (refit, fresh holdout #2 passed)
- Graduation collector: 4 new, 144 total. s35 background scoring run (PID 593436) still going; not touched.
- Ran `SMR_FRESH_HOLDOUT_AFTER=1793627113 risk backtest calibrate` (598 rows exported, 420 usable). Train 252 (2026-10-31 04:27-13:54 CST, 21 bad), test 168 (2026-10-31 13:55 - 2026-11-02 07:45 CST, 15 bad).
- Weight variant picked on TRAIN = both_off again (train AUC 0.7675, CI 0.67-0.84). Test AUC 0.739 (CI 0.62-0.84; reused split, not clean). Live-weights test AUC 0.724. FRESH holdout #2 AUC 0.6945 (95% CI 0.54-0.83, n=115, 5 bad, created 2026-11-02 08:31-10:00 CST) - clean first look, passes the 0.60 gate on its point estimate but the lower bound is under 0.60 with only 5 bad cases, so this is weak confirmation.
- Auto-deployed bt20261103-b57add76. Values are identical to the previous live version (skip>=40, reduced>=35, creator_sold=0, serial_deployer=0): nothing about live scoring changes; the setup is now confirmed on a second out-of-sample set. Test SKIP catches 14 of 15 bad (recall 0.93, CI 0.78-1.0) at precision 0.18; NORMAL tier bad rate 1.2% (1/81).
- Rule lift on all 420 usable: creator_holds 5.1x (n=10 fired, 40% bad), early_concentration 3.9x, shared_funder_cluster 2.7x, fresh_wallet_ratio 2.6x but fires on 93%, creator_sold 0.48x and serial_deployer 0.34x (inverse, still weighted 0).
- Evaluation launches used: train 252, test 168, fresh #2 115 (created up to 1793635224). NEW fresh boundary: created after 1793635224 (2026-11-02 10:00:24 CST) for holdout #3.
- Full suite 134 passed. No gate change.
- Next: build fresh holdout #3 (after 1793635224); next refit not before 15:31 CST. Filtering items in Next 0 unchanged.

### 2026-11-03 13:24-13:27 CST - session 35 (data collection only)
- Graduation collector: 6 new, 140 total graduations.
- s32 background run finished (budget hit): 26/206 scored, 26.3 s per launch. mainnet-beta 50/496 rate-limited (10%, under the 30% trigger; s30 run's 34% was a blip); publicnode 0/8,829. No endpoint change. Started the next newest-first budgeted run, log data/backtest/work/s35_run.log.
- backtest.db now 3,480 candidates, 584 labeled, 575 scored. Fresh holdout #2 (created after 1793627113): 114 scored+labeled, 93 with a bad_24h value, 5 bad (counts only, AUC not looked at). It just reaches the >= 30 rows / >= 5 bad bar, but 5 bad means a very wide 95% range, so treat any refit result there as weak evidence.
- Paper books at 13:25: strategy $999.69 (1 open), buy-everything $865.45 (-13.45%), filter ahead by $134.24; 38 waiting for $30k; Mayhem 153 / not 171 / unknown 1. Resolved benchmark outcomes still 12 (SKIP 10/10 dumped vs 100% non-SKIP). StalkChain log still 4 entries.
- No gate change, no refit (allowed from 13:27; this session started 13:24). Evaluation launches used: unchanged.
- Next: s36 may run the refit with SMR_FRESH_HOLDOUT_AFTER=1793627113 (holdout #2 at 93 usable / 5 bad); report the 95% range and don't ship on a gain inside it.

### 2026-11-03 13:20-13:23 CST - session 34 (data collection only)
- Graduation collector: 9 new, 134 total graduations.
- s32 background run still going (24/206 scored at check, 19-129 s per launch); did not start a second copy.
- Paper books at 13:21: strategy $999.69 (1 open), buy-everything $865.45 (-13.45%), filter ahead by $134.24; 38 waiting for $30k; Mayhem 153 / not 171 / unknown 1 (blocked strategy 38, momentum 16). Resolved benchmark outcomes still 12, SKIP 10/10 dumped vs 100% non-SKIP, no separation measurable. StalkChain log still 4 entries.
- No gate change, no refit (next not before 13:27). Evaluation launches used: unchanged.
- Next: unchanged; s35+ may refit from 13:27 with SMR_FRESH_HOLDOUT_AFTER=1793627113 only if fresh holdout #2 has >= 30 rows and >= 5 bad; check s32's mainnet-beta 429 rate when it finishes.

### 2026-11-03 13:15-13:17 CST - session 33 (data collection only)
- Graduation collector: 15 new, 125 total graduations.
- s32 background run still going (10/206 scored at check, 13-55 s per launch); did not start a second copy.
- Paper books at 13:15: strategy $999.69 (1 open), buy-everything $865.42 (-13.46%), filter ahead by $134.27; 37 waiting for $30k; Mayhem 149 / not 167 / unknown 1 (blocked strategy 38, momentum 16). Resolved benchmark outcomes still 12 (Mayhem 1/1 dumped, non-Mayhem 11/11), SKIP 10/10 dumped vs 100% non-SKIP, so no separation measurable yet. StalkChain log still 4 entries.
- No gate change, no refit (next not before 13:27). Evaluation launches used: unchanged.
- Next: unchanged; s34+ check s32 run's mainnet-beta 429 rate when it finishes, and refit becomes allowed from 13:27 with SMR_FRESH_HOLDOUT_AFTER=1793627113 (only if fresh holdout #2 has >= 30 rows and >= 5 bad).

### 2026-11-03 13:10-13:13 CST - session 32 (data collection only)
- Graduation collector: 6 new, 110 total graduations.
- s30 background run finished (budget hit): only 7/216 scored, 81.5 s per launch (s28 was 18.8 s). mainnet-beta 86/254 rate-limited (34%) vs publicnode 1/3,715, so the slow run lines up with mainnet-beta 429s crossing s28's 30% trigger again. Started the next newest-first budgeted run, log data/backtest/work/s32_run.log.
- Paper books at 13:11: strategy $999.69 (1 open), buy-everything $865.42 (-13.46%), filter ahead by $134.27; 36 waiting for $30k; Mayhem unknown 1/307; resolved benchmark outcomes still 12 (under 30). StalkChain log still 4 entries.
- No gate change, no refit (next not before 13:27). Evaluation launches used: unchanged.
- Next: if s32's mainnet-beta 429 rate is also > 30%, try making mainnet-beta fallback-only or lowering its rps (speed item, below filtering).

### 2026-11-03 13:05-13:09 CST - session 31 (filtering measurement only)
- Graduation collector: 9 new, 104 total graduations. s30 background run still going (2/216 scored at check); did not start a second copy.
- Entry-timing measurement (paper.db launches, read-only, 261 priced with price_vs_launch, all < 6 h old so outcomes are partial). Dumped 50%+ after first price: <1x launch 0/165, 1-2x 0/60, 2-5x 3/20, >=5x 9/16. The low buckets are mostly coins that stop trading (min_ret = max_ret = 0), so "no dump" there mostly means "no trades", not safety.
- The >=5x bucket is the paper-relevant pool (median first-priced mcap ~$69k). Non-Mayhem launches priced at >=20x launch: 7/7 dumped 50%+ (two touched 2x+ first: 17.2x and 2.24x peaks). Only one of the 7 was not already SKIP (49.1x, REDUCED 35, -99%). Candidate gate: entry >= ~20x launch price -> SKIP. Evidence rests on 7 cases, 6 already SKIP, so it would have changed 1 past entry (bad) and 0 good ones. Not shipped; re-check when >= 30 such entries resolve.
- Data-quality note: 124/143 Mayhem vs 100/163 non-Mayhem priced launches show no price move at all after entry (prices are fresh, < 1 h old, so it's no trading, not stale quotes). Mayhem coins in this pool mostly go quiet rather than dump; keep that in mind when reading Mayhem vs non-Mayhem benchmark outcomes.
- Paper books at 13:05: strategy $999.69 (1 open), buy-everything $865.49 (-13.45%), filter ahead by $134.20; 36 waiting for $30k; Mayhem unknown 1/307. StalkChain log still 4 entries. No gate change, no refit (next not before 13:27). Evaluation launches used: unchanged (paper.db only, no AUC).
- Next: add to Next 0(b): test "entry >= 20x launch price -> SKIP" alongside entry speed once >= 30 resolved >=5x entries exist.

### 2026-11-03 12:58-13:01 CST - session 30 (data collection + measurement)
- Graduation collector: 5 new, 95 total graduations.
- s28 background run finished (budget hit): 42/264 scored, 18.8 s per launch (better than s24's 78 s). Started the next newest-first budgeted run, log data/backtest/work/s30_run.log (216 eligible).
- Tracer totals (Next 3, first full run with d256d3f code): 722 probes, 129 probe cache hits (17.9%, up from s12's 6.7%), 156 hubs, 117 hub page skips (16% of probes). Reusing a later COMPLETE probe still has limited upside; keep it low priority.
- RPC: mainnet-beta 71/610 rate-limited (11.6%, down from s24's 35%); publicnode 0/11,206. Under the 30% trigger, so no endpoint change.
- Paper books at 12:59: strategy $999.69 (1 open), buy-everything $865.84 (-13.42%), filter ahead by $133.85; 35 waiting for $30k; Mayhem unknown 1/295 (0.3%). StalkChain log still 4 entries. Under 30 resolved outcomes, so no gate test.
- No gate change, no refit (next not before 13:27). Evaluation launches used: unchanged.
- Next: unchanged (dropped the mainnet-beta fallback idea while 429s stay under 30%).

### 2026-11-03 12:51-12:55 CST - session 29 (measurement only)
- Graduation collector: 3 new, 90 total graduations.
- s28 background run healthy: 33/264 scored, 10-54 s per launch (faster than s24's 78 s). Did not start a second copy.
- Checked the s28 "database is locked" lead: every sqlite3.connect in smr/ already uses timeout=60 (busy wait), so no busy_timeout fix is needed; the s24 error was a >60 s hold by another writer. Dropped that Next item.
- Filtering measurement (paper.db, read-only): of 112 launches the scorer called NORMAL, 105 were downgraded by entry-time market gates. Gate reasons: 105 too few holders, 103 liquidity under the floor, 44 curve already drained below launch price, 3 Mayhem. So the market gates, not the risk score, do almost all of the filtering at entry; any score-side gate change will touch very few paper entries until more coins reach $30k.
- Paper books at 12:52: strategy $999.69 (1 open), buy-everything $865.84 (-13.42%), filter ahead by $133.85; 35 waiting for $30k; StalkChain log still 4 entries. Under 30 resolved outcomes, so no gate test.
- No gate change, no refit (next not before 13:27). Evaluation launches used: unchanged.
- Next: unchanged.

### 2026-11-03 12:44-12:47 CST - session 28 (data collection only)
- Graduation collector: 12 new, 87 total graduations (sessions between 12:29 and 12:44 were skipped while the Mayhem task held the lock, so some graduations in that gap may be missed).
- s24 background run finished (budget hit): 14 of 292 scored, 78 s per launch (much slower than s21's 22 s); 1 ERROR "database is locked" after 600 s (likely contention with the Mayhem task/paper cycle). mainnet-beta 184/520 rate-limited (35%) vs publicnode 4/6,609. Started the next newest-first budgeted run, log data/backtest/work/s28_run.log.
- Paper books at 12:44: strategy $999.69 (1 open), buy-everything $865.58 (-13.44%, 6 closed / 101 open), filter ahead by $134.11; 10/10 resolved SKIPs dumped 50%+. Mayhem section: 135 Mayhem / 156 not / 1 unknown (0.3%, fine); blocked strategy 34, momentum 12. 33 waiting for $30k. StalkChain log still 4 entries. Under 30 resolved outcomes, so no gate test.
- No gate change, no refit (next not before 13:27). Evaluation launches used: unchanged.
- Next: unchanged; new item: if the mainnet-beta 429 rate stays > 30%, try dropping mainnet-beta to a fallback-only endpoint (publicnode carries 93% already), and look into the "database is locked" (add a busy_timeout if missing).

### 2026-11-03 12:28-12:55 CST - Mayhem gate (delegated task, not a scheduled session)
- Owner rule (12:27): "Stay out of Mayhem mode trades." New smr/mayhem.py: Mayhem if the BondingCurve `is_mayhem_mode` byte (offset 81) is 1, OR the create tx gives the agent BwWK17... a balance / runs InitializeMayhemState, OR supply > 1.001B, OR the agent holds a balance. Not Mayhem needs an explicit False from curve or tx; else unknown = no entry.
- Strategy + momentum books skip Mayhem and unknown (`strategy_status`/`momentum_status`='skip_mayhem', gate reason `mayhem_mode`); 'all'/'shadow' unchanged, rows flagged (`positions.mayhem`). Soljack (open, strategy, Mayhem) left open, not voided.
- Measured: paper.db 149 Mayhem / 160 not / 2 unknown of 311 (48%); curve flag and create tx agreed on all 263 read by both; live re-check 10/10. Backtest candidates 659 / 1,130 / 146 (37% of known); eligible 531 / 414 / 48 (56%). README's ~93% is stale.
- Outcomes: backtest bad_24h Mayhem 9/247 (3.6%) vs non-Mayhem 28/205 (13.7%); graduated 4/247 vs 5/205. Paper shadow closed: Mayhem 1 (-76%) vs non-Mayhem 11 (mean +7.6%); tiny n. The data do not say Mayhem is riskier.
- Blocks: 32/65 waiting-for-$30k coins and 10/18 momentum watchers dropped; the only live strategy entry so far (Soljack) is Mayhem. Of 3 non-SKIP launches ever >= $30k, 2 were Mayhem; expect very few entries.
- Tests 123 -> 134. Evaluation launches: label rates were read across all labeled rows by Mayhem group (no score/AUC looked at, no gate fitted).

### 2026-11-03 12:27-12:29 CST - session 27 (data collection only)
- Graduation collector: 5 new, 75 total graduations.
- s24 background run still going (12/292 scored; latest SKIP 55, REDUCED 35; mainnet-beta 429s still showing). Did not start a second copy.
- Paper books at 12:28: strategy $999.69 (1 open), buy-everything $865.61 (-13.44%, 6 closed / 101 open), filter ahead by $134.08; 10/10 resolved SKIPs dumped 50%+; 65 launches waiting for the $30k floor. StalkChain log still 4 entries. Under 30 resolved outcomes, so no gate test.
- No gate change, no refit (next not before 13:27). Evaluation launches used: unchanged.
- Next: unchanged.

### 2026-11-03 12:23-12:25 CST - session 26 (data collection only)
- Graduation collector: 9 new, 70 total graduations.
- s24 background run still going (11/292 scored; mostly SKIP, one REDUCED 30). Did not start a second copy.
- Paper books at 12:23: strategy $999.69 (1 open), buy-everything $865.61 (-13.44%, 6 closed / 101 open), filter ahead by $134.08; 10/10 resolved SKIPs dumped 50%+, and the report shows resolved non-SKIPs also 100% dumped (tiny n). 65 launches waiting for the $30k floor. StalkChain log still 4 entries. Under 30 resolved outcomes, so no gate test.
- No gate change, no refit (next not before 13:27). Evaluation launches used: unchanged.
- Next: unchanged.

### 2026-11-03 12:19-12:21 CST - session 25 (data collection only)
- Graduation collector: 5 new, 61 total graduations.
- s24 background run still going (3/292 scored at last check: SKIP 55, NORMAL 30, NORMAL 30). A `risk paper cycle` was running; did not start a second backtest copy.
- Paper books at 12:19: strategy $999.69 (1 open), buy-everything $865.61 (-13.44%, 6 closed / 101 open), filter ahead by $134.08; 10/10 resolved SKIPs dumped 50%+; 65 launches waiting for the $30k floor. StalkChain log still 4 entries. Still under 30 resolved outcomes, so no gate test.
- No gate change, no refit (next not before 13:27). Evaluation launches used: unchanged.
- Next: unchanged.

### 2026-11-03 12:13-12:16 CST - session 24 (data collection only)
- Graduation collector: 5 new, 56 total graduations.
- s21 background run finished (budget hit): 26 of 325 eligible scored, 22.1 s per launch; tracer 609 probes, 57 cache hits (9.4%), 50 hub page skips; mainnet-beta 54/393 rate-limited (13.7%) while publicnode carried 95% of calls. Started the next newest-first budgeted run in background (292 eligible), log data/backtest/work/s24_run.log.
- Paper books at 12:14: strategy $999.69 (1 open), buy-everything $865.61 (-13.44%, 6 closed / 101 open), filter ahead by $134.08; 10/10 resolved SKIPs dumped 50%+. 60 launches waiting for the $30k floor. data/paper_stalkchain.jsonl still 4 entries. Still under 30 resolved outcomes, so no gate test.
- No gate change, no refit (next not before 13:27). Evaluation launches used: unchanged.
- Next: unchanged; watch the mainnet-beta 429 rate (now 13.7%).

### 2026-11-03 12:09-12:11 CST - session 23 (data collection only)
- Graduation collector: 6 new, 51 total graduations.
- s21 background job still running (21/325 scored, mostly SKIP). Did not start a second copy.
- data/paper_stalkchain.jsonl still 4 entries; nothing to measure. No gate change, no refit (next not before 13:27). Evaluation launches used: unchanged.
- Next: unchanged.

### 2026-11-03 12:06-12:09 CST - session 22 (data collection only)
- Graduation collector: 19 new, 45 total graduations.
- s21 background job (sample 26-28 h window, then scoring newest-first) still running: 9/325 scored so far (SKIP 4 of 5 shown, one NORMAL). Did not start a second copy.
- data/paper_stalkchain.jsonl now 4 entries, still too few to measure flags against outcomes.
- Paper books at 12:07: strategy $999.69 (1 open, 0 closed), buy-everything $865.61 (-13.44%, 6 closed / 101 open); 10/10 resolved SKIPs dumped 50%+. Shadow/all resolved outcomes still well under 30, so no gate test yet.
- No gate change, no refit (next not before 13:27). Evaluation launches used: unchanged.
- Next: unchanged; check s21 run summary when it finishes.

### 2026-11-03 12:00-12:03 CST - session 21 (data collection only)
- Ran tools/collect_graduations.py: 5 new, 26 total graduations. data/paper_stalkchain.jsonl still 2 entries, nothing to measure.
- Fresh holdout #2 had 0 candidates: newest candidate in backtest.db was created 28.3 h ago (right at the 1793627113 boundary). Started in background (nohup, log data/backtest/work/s21_sample_run.log): `backtest sample --n 400 --min-age-h 26 --max-age-h 28` (all post-boundary, ~2 h of launches) then `backtest run --max-age-h 40 --parallel 3 --budget-min 9 --newest-first`.
- No gate change (a `risk paper cycle` was running; evidence still thin). No refit (next not before 13:27). Evaluation launches used: unchanged.
- Next: check s21 log; keep sampling 26-28 h windows each ~hour so holdout #2 grows newest-first; keep running the graduation collector every session.

### 2026-11-03 11:20-12:05 CST - momentum book (delegated task, not a scheduled session)
- Shipped: new 'momentum' paper book ($1,000 own bankroll), unproven A/B. SKIP + entry gates + $30k real-mcap floor stay a hard veto; non-SKIP coins ranked by momentum (5m/1h volume accel, buy ratio, 5m/1h price change, turnover = 1h vol/mcap, GT unique buyers, peak state) + keyword narrative themes (DexScreener boosts/profiles + graduations + own launches). Moon-bag exit: ~50-60% sold at 2x to take out stake+fees, rest trails 40% off peak, 48 h max hold; -50% stop / 24 h time exit before 2x. Strategy book unchanged (tested). See docs/paper_trading.md "Momentum book".
- API load: no new per-coin calls. Unique buyers come from `include=top_pools` on the existing GT entry batch; narrative = 3 DexScreener list calls (cached 10 min) + <= 4 /tokens/v1 batches per cycle, built only when there are pending/watching launches, outside the DB transaction.
- Learned: description words ("platform", "everyone", "stand") made junk themes - a theme must now appear in a coin's NAME/SYMBOL. 3-letter themes need prefix/suffix matching (BABYCAT -> cat). Rounding the partial fraction down left proceeds a hair short of the stake; now rounded up.
- First live cycles (18 by the routine at 11:43, 19 manual at 11:52): momentum enabled, 0 entries - every non-SKIP coin was under the $30k floor (now 'watching' up to 6 h). Hot themes: ai, gta, america, cat, dog, intel, trump.
- Ops gotcha: the routine runs `risk paper cycle` from the working tree, so uncommitted paper code goes live (and migrates paper.db) at the next routine cycle. Finish + test before the next :07/:22/:37/:52 slot.
- Limits: no true intraday highs (would need per-coin OHLCV, GT 429s); boost lists have no names; pump.fun API not used (Cloudflare). Tests: 123 passed.

### 2026-11-03 11:54-11:58 CST - session 20 (filtering, graduation labeler)
- Ran tools/collect_graduations.py: 5 new, 21 total graduations collected.
- Shipped tools/label_graduations.py: for each collected PumpSwap pool first seen >= 24 h 15 min ago and not yet labeled, fetches GeckoTerminal 15-min OHLCV (USD, free API, 2.2 s between calls, max 20 per run) and writes data/backtest/work/graduation_labels.jsonl with p0 (open of the candle at first sight), p24, ratio_24h, bad_24h (ratio <= 0.5), max_x / min_x and hit_2x (would the paper 2x take-profit have hit), plus fdv/reserve at first sight so the $30k floor and liquidity/mcap can be applied when analysing. Refuses to label (marks unlabelable) when there's no candle within 1 h of +24 h, so dead pools are counted but not guessed. Verified the OHLCV response shape live on one pool. Tests tests/test_label_graduations.py (3); full suite 123 passed.
- First entries become due ~11:45 CST Nov 4. No gate change, no refit (next not before 13:27). Other worker's uncommitted smr/paper/* and momentum/narrative files left untouched. Evaluation launches used: unchanged.
- Next: keep running the collector every session; from Nov 4 ~11:45 CST also run the labeler every session; after >= 30 labels, measure entry fdv, reserve/fdv and minutes-since-graduation vs bad_24h / hit_2x on this paper-matched pool.

### 2026-11-03 11:47-11:51 CST - session 19 (data collection only)
- Found .session.lock from 11:35 (12 min old, stale per the 10-min rule) and took it over. Uncommitted edits to smr/paper/{cli,engine,ledger,prices,report}.py plus new smr/momentum.py, smr/narrative.py and tests/test_momentum.py (mtimes up to 11:45) belong to another worker; left untouched. A `risk paper cycle` (and a /tmp/paper_dry.db dry cycle) were running, so no gate change was possible anyway.
- Ran tools/collect_graduations.py: 11 new PumpSwap graduations, 16 total. Sessions between 11:31 and 11:47 didn't run it, so graduations in that gap were missed (feed reaches only ~5 min back).
- data/paper_stalkchain.jsonl still has 2 entries; nothing to measure yet. No refit (next not before 13:27). Evaluation launches used: unchanged.
- Next: write the graduation labeler (24 h price vs first-seen price via GeckoTerminal OHLCV) so it's ready when the first entries turn 24 h old at ~11:27 CST Nov 4.

### 2026-11-03 11:27-11:31 CST - session 18 (filtering, paper-matched data source)
- Probed allowed sources for Next #0a (launches that reach the $30k paper floor). GeckoTerminal free API: dex pool listing can't sort by creation time (400), and `new_pools` is capped at 10 pages x 20 = 200 pools, which reached back only ~5 minutes (oldest 17:22:21Z at 17:28Z). PumpSwap (graduated pump.fun coins) was 1 of 20 on page 1. So graduations can't be sampled after the fact; they have to be collected forward.
- Shipped tools/collect_graduations.py: pulls the 10 new_pools pages (2.2 s apart, under the free rate limit), keeps only pumpswap pools, stores pool, mint, created time, fdv and reserve (no token names/symbols), dedups by pool, appends to data/backtest/work/graduations.jsonl. Tests tests/test_collect_graduations.py (2); full suite 100 passed. First run: 5 new graduations in the ~5-minute window, so roughly 60/hour if every session runs it.
- No gate change, no refit (s17 refit was at 11:27; next not before 13:27). s17's scoring run (PID 469595) and a `risk paper cycle` were running; not touched. Evaluation launches used: unchanged.

### 2026-11-03 11:25-11:30 CST - session 17 (refit, fresh holdout passed)
- s14 scoring run had finished: 33 of 214 scored in 565.5 s (17.1 s per launch, budget hit). Tracer totals (first d256d3f run): 537 probes, 77 probe cache hits (14%), 104 hubs, 80 hub page skips. mainnet-beta 33 of 579 rate-limited (5.7%); publicnode 4 of 8,427.
- Fresh holdout (created after 1793570956) now has 96 scored + labeled launches, 8 bad_24h, so it qualifies (>= 30, >= 5 bad). Labels 418 -> 451, so +100 since 06:50 too. Ran `SMR_FRESH_HOLDOUT_AFTER=1793570956 risk backtest calibrate` (445 rows exported).
- Result: weight variant picked on TRAIN = both_off (train AUC 0.8011, 95% CI 0.71-0.87). Test AUC 0.6683 (95% CI 0.53-0.79, n=125, 11 bad; split reused, not clean). Live-weights test AUC on the same rows 0.4821 (rows partly scored under older weights). FRESH holdout AUC 0.7933 (95% CI 0.68-0.90, n=96, 8 bad, created 2026-11-01 17:12 - 2026-11-02 07:45 CST) - clean first look, passes 0.60 with its lower bound above the gate. Caveat: only 8 bad cases, so the CI is wide and could be optimistic.
- Deployed bt20261103-2f4dba42 automatically per the gate. Values are identical to the previous live version (skip>=40, reduced>=35, creator_sold=0, serial_deployer=0); what changed is that the setup is now confirmed out-of-sample. Test skip precision 0.17, recall 0.82, base bad rate 8.8%.
- Evaluation launches used: train 186 (2026-10-31 04:27-11:52 CST), test 125 (2026-10-31 12:03 - 2026-11-01 15:54 CST), fresh #1 96 (2026-11-01 17:12 - 2026-11-02 07:45 CST). Fresh boundary moved to 1793627113.
- Full suite 98 passed. No gate change (filtering on paper still waits on more resolved outcomes; StalkChain log has only 2 entries).

### 2026-11-03 11:18-11:22 CST - session 16 (filtering, paper-matched label feasibility)
- Checked whether Next #0a (paper-matched label) can be built from backtest.db (read-only). Market cap per unit of launch-price ratio is 27.96 SOL (median over 406 scored+labeled, matches pump.fun's launch cap). With SOL at $93.39 (DexScreener SOL/USDC, 11:18 CST) the $30k paper floor is ~321 SOL, about 11.5x the launch price.
- Result: of 403 usable labeled launches, only 2 were >= $30k at create+300 s, 0 at 1 h, 0 at 6 h, 1 at 24 h (3 distinct), and 9 graduated within 24 h. Train split (186): 1 launch >= $30k at entry, and it was bad. So the backtest set is almost entirely coins the paper trader would never buy, and filters tuned on it say little about paper entries. Caveat: only checkpoint prices are known, so a coin could have crossed $30k between checkpoints; the true count is somewhat higher but the 9 graduations bound it as small.
- Consequence: the s14 train signals (creator-not-sold 40% vs 6.4%, entry_x_launch) were measured on a population that is mostly sub-$30k; they may not transfer. No gate change. No code commit. Evaluation launches used: unchanged (train split only read).
- Housekeeping: a stray empty data/backtest/backtest.db was created by this session's first read (wrong path; the real DB is data/backtest/work/backtest.db) and was deleted right away; nothing else touched. s14 scoring run (PID 459009) still running, not touched.

### 2026-11-03 11:15-11:20 CST - session 15 (filtering, paper books)
- Measured paper-book entry features vs outcome (data/paper.db read-only; shadow + all books, 225 unique mints, median position age only 1.8 h). Outcome = stop-loss hit / min_ret <= -50% (5) vs take-profit / max_ret >= +100% (5); everything else unresolved.
  - Only 10 shadow entries were at a market cap >= $30k (shadow buys at the first price, so most entries are far below the paper floor). Of those, 6 resolved: 4 stop-loss (JAFQ.. $122k, BZGN.. $116k, m1z9.. $70k, 2QUU.. with a bogus $343M cap, likely the pre-3c584ae supply bug) vs 2 take-profit (eiWh.. $68k, c9Aq.. $136k). Entry mcap >= $60k: 4 bad / 2 good of 9.
  - Liquidity/mcap at entry does not separate in the >= $30k group: stops at 0.23 / 0.23 / 0.29, take-profits at 0.29 / 0.21.
  - Minutes from launch to entry (quartiles 10.6 / 12.9 / 15.4 min) and holder count (median 1, the market feed reports 0-2 holders for most) carry no usable signal yet; holder_count from the paper feed is too coarse to be a gate.
  - Every resolved outcome (5 bad, 5 good) was a SKIP decision; NORMAL/REDUCED have 0 resolved of 60, so the model can't be judged on paper yet.
- Strategy book check: 16 positions, 14 voided (pre_gate_bug / interrupted_pre_mcap_gate / spon Mayhem bug), 1 live (96DC.. REDUCED at $72.5k). Paper-matched evidence is still n=6 at >= $30k, far below the >= 30 resolved needed in Next #0b. No gate change; no commit to code.
- s14 scoring run was still running at session start (PID 459009); not touched. No refit. Evaluation launches used: unchanged.
- Next idea refined: Next #0a (paper-matched label from the backtest set: first $30k crossing, 24 h after) is the only way to get n >= 100 for gate tests this week; prioritise building it next session.

### 2026-11-03 11:12-11:17 CST - session 14 (filtering)
- Switched to the filtering priority. Paper books (data/paper.db, read-only): shadow 219 entries, only 10 resolved (5 stop-loss, 5 take-profit); all book 128, 6 closed. Too few to judge any gate yet.
- Train-only measurement (time-ordered first 60% of the 311 usable labeled launches created before the fresh boundary: 186 launches, 17 bad_24h). Bad rate when the signal is present vs absent:
  - creator has not sold anything by as-of: 6/15 (40%) vs 11/171 (6.4%)
  - creator still holds >= 1% of supply: 5/10 (50%) vs 12/176 (6.8%); >= 3%: 1/3 vs 16/183
  - entry_x_launch >= 2 at create+300 s: 10/12 (83%) vs 7/174 (4.0%); >= 3: 6/7; >= 5: 4/4
  - fresh_wallet_ratio rule fires on 176/186 launches (9.7% bad vs 0/10); ratio is never >= 0.5 in train, so the rule's trigger is not using the ratio in a separating way. Confirms it is noise as a filter.
  - current model's SKIP: 15/130 (11.5%) vs 2/56 (3.6%).
- Key caveat found: entry_x_launch looks like the strongest signal, but the paper trader only buys at >= $30k market cap, which is already several times the pump.fun launch price, so every paper entry is "high x_launch" by construction. Part of the 83% is also mechanical (a 2x coin falling back to launch price is a 50% drop). It can't be used as-is as a paper gate; the transferable version is a paper-matched label (Next #0a).
- No gate change shipped: evidence rests on 10-15 train launches, and a `risk paper cycle` was running. Started scoring run s14 (`--max-age-h 40 --parallel 3 --budget-min 9 --newest-first`, log data/backtest/work/s14_run.log). s13's run ended at 45 scored, 13.3 s per launch, mainnet-beta 29 of 762 calls rate-limited (3.8%). No refit (fresh holdout still short of 5 bad as of s13). Evaluation launches used: unchanged; this session only read the train split.

### 2026-11-03 10:38-10:50 CST - session 13
- Read s12's full run: 21 of 309 scored in 585.9 s, 27.9 s per launch (vs 123.9-410 s per launch oldest-first in s8-s11). RPC: publicnode 7,449 calls, 0 rate-limited, 72 ms avg; mainnet-beta 466 calls, 40 rate-limited (8.6%), 15 errors, 638 ms avg; 439 history skips, 0 timeouts. Newest-first confirmed as the default for backtest runs.
- Shipped (Next #3, stats part): `risk backtest run` summary now carries `tracer`, the sum of every scored launch's funding-tracer counters (probes, probe_cache_hits, complete_histories, hubs, hub_page_skips, anchor_fallbacks). Read from each report's data_coverage.tracer; scoring output unchanged. New tests/test_runner_tracer_stats.py (3 tests, incl. old 4-tuple compatibility); full suite 95 passed. Commit d256d3f. CLI contract (health/score/watch) unchanged. Measured on s12's 21 stored docs: 511 probes, 34 cache hits, 111 hubs, 79 hub page skips.
- Dataset: started `backtest run --max-age-h 40 --parallel 3 --budget-min 9 --newest-first` with nohup (280 eligible, log data/backtest/work/s13_run.log); 44 scored by 10:49, many in 7-20 s. Totals: ~411 scored, 418 labeled, 0 unlabeled scored. Fresh holdout 36 -> 80 scored + labeled, but only 4 bad_24h (needs 5). pump.fun API still Cloudflare-blocked, not bypassed.
- No backtest refit: the fresh holdout can't pass the >= 5 bad requirement yet, so a fit couldn't deploy and would only spend the holdout. Live version unchanged: bt20261103-12b97fda, held-out AUC 0.6657 (95% CI 0.50-0.79). Evaluation launches used: unchanged (the 124-launch test split of the 06:50 fit); fresh-holdout launches not yet evaluated.

### 2026-11-03 10:10-10:17 CST - session 12
- Read s11's run (killed by its 7 min foreground timeout): 2 of 322 scored at 342.7 s and 357.2 s. Started runs with nohup from now on so they survive the session.
- Next #2 checked: the labeler is keeping up. 346 scored, 349 labeled, 0 scored rows without a label; 15 fresh-holdout launches are scored + labeled (need 30 with >= 5 bad).
- Checked the "REDUCED with score 0" line in s11's log (9RK1FX1JYA): not a bug, it is the low-data-coverage rule (confidence 0.442, wallet history coverage 0.5 -> REDUCED). The other low-score REDUCED rows in backtest.db were scored under the older reduced threshold of 30.
- Shipped: `risk backtest run --newest-first` (runner newest_first=True) scores the youngest eligible launches first. Their own early transactions are still inside publicnode's ~36 h history window (0.11 s per tx in session 7's probe) instead of falling through to mainnet-beta (~5-7 s). Default order unchanged. New test in tests/test_backtest_runner_budget.py; full suite 92 passed. Commit d438a6a. CLI contract (health/score/watch) and scoring output unchanged.
- Dataset: started `backtest run --max-age-h 40 --parallel 3 --budget-min 8 --newest-first` in the background (309 eligible, log data/backtest/work/s12_run.log). First 8 launches in its first ~3.5 min: 38.1 / 58.2 / 61.3 / 104.4 / 202.1 / 56.3 / 29.5 / 34.9 s (median ~57 s), vs 342.7 / 357.2 s in s11 and 123.9 s per launch in s10, both oldest-first. Roughly 2-6x faster on n=8; part of it may be a warmer probe cache, so confirm on the full run. Fresh holdout should pass 15 -> ~23+ from this run alone. pump.fun API still Cloudflare-blocked, not bypassed.
- No backtest refit: under +100 labels since the 06:50 fit and the fresh holdout is only 15/30. Live version unchanged: bt20261103-12b97fda, held-out AUC 0.6657 (95% CI 0.50-0.79). Evaluation launches used: unchanged (the 124-launch test split of the 06:50 fit).

### 2026-11-03 09:46-09:58 CST - session 11
- Read session 10's run: 4 of 122 scored at 126.2 / 356.7 / 293.9 / 495.7 s (123.9 s per launch overall, vs 257 s in s9). RPC snapshot: mainnet-beta 747 calls, 24 rate-limited (3.2%), 3 errors, 0 timeouts, avg latency 5.0 s; publicnode 401 calls, 250 nulls; 372 history skips. 429s are low but not zero, so concurrency stays at 3.
- Dataset (Next #2): re-ran the candidate sampler for the first time since session 3 (`backtest sample --n 400 --min-age-h 26 --max-age-h 40`): 392 new creates checked, candidates 2,688 -> 3,080, eligible 603 -> 811. 671 candidates (356 eligible) were created after the fresh-holdout boundary. Started a budgeted scoring run (`backtest run --max-age-h 40 --parallel 3 --budget-min 4`, log data/backtest/work/s11_run.log). pump.fun API still Cloudflare-blocked, not bypassed.
- Shipped: the overfitting guard is now enforced in code, not just by hand. The calibrator takes a fresh-holdout boundary (env SMR_FRESH_HOLDOUT_AFTER or fresh_after=): launches created after it are kept out of train/test and never used for picking, and a fit deploys only if, on top of the old gate, the fresh holdout has >= 30 launches, >= 5 bad, and AUC >= 0.60. With no boundary set, nothing deploys. report.json now carries auc_ci95 (bootstrap 95% range) for train, test and the fresh holdout. Also fixed tests/test_hub_page_skip.py, which compared getTransaction call order and failed since the concurrent fetch in 87d8c7c (same set of calls, order varies). New tests/test_fresh_holdout_gate.py (5 tests); full suite 89 passed. Commit 077282f. CLI contract and scoring output unchanged.
- No backtest refit: under +100 labels since the 06:50 fit and no fresh holdout yet. Live version unchanged: bt20261103-12b97fda, held-out AUC 0.6657 (95% CI 0.50-0.79). Evaluation launches used: unchanged (the 124-launch test split of the 06:50 fit).

### 2026-11-03 09:30-09:40 CST - session 10
- Read session 9's finished run: 3 of 127 scored at 273.3 / 287.7 / 771.0 s (257 s per launch overall, vs session 8's 407-454 s for its first two). The concurrent tx fetch helps, but one launch took 771 s, a long tail consistent with stuck calls held for the 45 s timeout and then retried. That run printed no RPC stats, so 429s could not be checked.
- Shipped (Next #1b, adjusted): RpcPool now has a per-method HTTP timeout; getTransaction uses 15 s (env SMR_RPC_TX_TIMEOUT_S, never above the 45 s default). A timed-out call is not skipped: it is counted (new stat `timeouts`, pool and per endpoint) and retried like before, so the data and scores are identical, only a hung call is abandoned 30 s sooner. `risk backtest run` now prints the rpc snapshot at the end so the next session can see 429s and timeouts. New tests/test_rpc_method_timeout.py (3 tests); full suite 84 passed. Commit d9930aa. CLI contract and scoring output unchanged.
- Dataset: 2,688 candidates, 342 labels, 340 scored at session start. Started a budgeted run with the change (`python -m risk backtest run --max-age-h 40 --parallel 3 --budget-min 4`, 122 eligible, log data/backtest/work/s10_run.log); left running. pump.fun API still Cloudflare-blocked, not bypassed.
- No backtest refit: far fewer than +100 new labels since the 06:50 fit and no fresh holdout big enough for the overfitting guard. Live version unchanged: bt20261103-12b97fda, held-out AUC 0.6657 (95% CI 0.50-0.79). Evaluation launches used: unchanged (the 124-launch test split of the 06:50 fit).

### 2026-11-03 09:08-09:16 CST - session 9
- Shipped (Next #1a): the funding tracer now fetches a wallet probe's funding txs (up to trace_oldest_k + trace_recent_k = 8) with up to 3 getTransaction calls in flight per probe (setting trace_tx_concurrency, env SMR_TRACE_TX_CONCURRENCY, 1 = old serial behaviour). Results are consumed in input order, so edges, fanout, warnings and the stored probe are identical to serial fetching; the per-endpoint token bucket (mainnet-beta 3.5 rps) still caps the global rate. Before, 8 tracer threads x 1 serial call at ~6 s latency used only ~1.3 of mainnet-beta's 3.5 rps. New tests/test_tx_fetch_concurrency.py (serial vs concurrent give identical probe, edges, funders and warnings; >1 in flight; order kept); full suite 81 passed. Commit 87d8c7c. CLI contract and scoring output unchanged.
- Early measurement: budgeted run (`python -m risk backtest run --max-age-h 40 --parallel 3 --budget-min 4`, 127 eligible, log data/backtest/work/s9_run.log) scored its first two launches in 273.3 s and 287.7 s, vs 407.2 s and 453.9 s for session 8's first two. About 35% faster on n=2; left running, not conclusive yet. pump.fun API still Cloudflare-blocked, not bypassed.
- Dataset: 2,688 candidates, 339 labels, 337 scored at session start (+2 scored this session).
- No backtest refit: last fit 06:50 (over 2 h ago) but only ~+5 labels since and no fresh holdout big enough for the overfitting guard. Live version unchanged: bt20261103-12b97fda, held-out AUC 0.6657 (95% CI 0.50-0.79). Evaluation launches used: unchanged (the 124-launch test split of the 06:50 fit).

### 2026-11-03 08:50-08:58 CST - session 8
- Shipped (Next #1c): RpcPool.get_transaction now takes an optional block_time hint (from the signatures page). Endpoints carry tx_history_hours (publicnode = 36 h, env SMR_PUBLICNODE_TX_HISTORY_H); a tx known to be older is not tried there and goes straight to mainnet-beta, saving the doomed publicnode round trip (~0.1 s plus a bucket token) and the null-failover on most funding-trace fetches. Never skips every endpoint; the cache key is unchanged, so results are identical with or without the hint. Hint passed from batch_tracer, data_extractors (window tx sampling) and the labeler. New rpc stat history_skips. New tests/test_tx_history_skip.py (4 tests); full suite 79 passed. Commit 8ab46b1. CLI contract and scoring output unchanged. Honest expectation: a small per-call saving; the dominant cost is still mainnet-beta's ~5-7 s latency (Next #1a).
- Dataset: session 6's run finished (3 of 142 scored at 702.7 / 853.3 / 1232.0 s; 410.7 s per launch). backtest.db now 2,688 candidates, 336 labels, 334 scored. Started a new budgeted run with the change (`python -m risk backtest run --max-age-h 40 --parallel 3 --budget-min 4`, 134 eligible, log data/backtest/work/s8_run.log); left running. pump.fun API still Cloudflare-blocked, not bypassed.
- No backtest refit: 2 h have passed since 06:50 but only a handful of labels were added, and there is no fresh holdout big enough to pass the overfitting guard. Live version unchanged: bt20261103-12b97fda, held-out AUC 0.6657 (95% CI 0.50-0.79). Evaluation launches used: unchanged (the 124-launch test split of the 06:50 fit).

### 2026-11-03 08:35-08:41 CST - session 7
- Next #1 (measure throughput): direct getTransaction probe on 4 random funding-edge sigs per age bucket from funding_graph.db, maxSupportedTransactionVersion 1. publicnode: <2 days old 4/4 ok at 0.11 s; 2-14 d, 14-90 d and >90 d all 4/4 null. mainnet-beta: <2 d 4/4 ok at 1.85 s; 2-14 d 3 ok + 1 timeout (8 s cap) at 6.98 s avg; 14-90 d 4/4 at 6.87 s; >90 d 4/4 at 5.13 s. So the slowdown is mainnet-beta latency on historical txs (~7x worse than session 4's ~0.9 s), not rate limits (no 429s at ~1 call/s) and not pump.fun. Funding traces are mostly historical txs, so they all hit the slow endpoint.
- Session 6's budgeted run finished its first launch in 702.7 s (e6Vd5uBTTp, REDUCED 35) and is still working through in-flight ones; left running.
- No code change this session (diagnosis only); tests not re-run, nothing committed besides this log. pump.fun API still Cloudflare-blocked, not bypassed.
- No backtest refit (last 06:50; ~+1-3 labels since, not worth a refit). Live version unchanged: bt20261103-12b97fda, held-out AUC 0.6657 (95% CI 0.50-0.79). Evaluation launches used: unchanged (the 124-launch test split of the 06:50 fit).

### 2026-11-03 08:20-08:34 CST - session 6
- Shipped (Next #1, per-funder reuse): the funding tracer now skips the remaining getSignatures pages (1,000 sigs each) for a wallet that an EARLIER-anchored probe already proved has >= 2,000 prior signatures without reaching its first tx, once the fetched page already covers the recent funding window. History only grows, so the stored probe is identical to a full scan (still incomplete + hub, sigs_scanned 2000, same recent txs) and it is point-in-time safe (a later-anchored probe is never used as proof). Measured in funding_graph.db: 8,860 probes over 5,412 wallets; 3,448 probes repeat a wallet, 1,010 of them were already-proven deep hubs, so roughly 1 in 9 probes saves one heavy RPC page. New tests/test_hub_page_skip.py (identical probe vs full scan, no lookahead, no skip when window not covered); full suite 75 passed. Commit 27d186c. CLI contract and scoring output unchanged.
- Dataset: budgeted run (`--max-age-h 40 --parallel 3 --budget-min 5`, started before the change) had completed 0 of its 3 in-flight launches after 10 min; left running to finish. Throughput is now the blocker (Next #1). pump.fun API still Cloudflare-blocked, not bypassed.
- No backtest refit (last 06:50; due ~08:50, far from +100 labels). Live version unchanged: bt20261103-12b97fda, held-out AUC 0.6657 (95% CI 0.50-0.79).
- Evaluation launches used: unchanged (the 124-launch test split of the 06:50 fit).

### 2026-11-03 07:53-08:05 CST - session 5
- Shipped (Next #4 groundwork): fresh_wallet_ratio rule now keeps its raw inputs (fresh_wallet_ratio, fresh_wallet_count, buyers_with_history, fresh_supply_pct) in rule evidence, so a graded version can be tuned offline from the exported dataset without re-scoring. Scoring unchanged; evidence is a free-form object in risk_report.v1, so the CLI contract and top-level keys are untouched. New tests/test_fresh_wallet_evidence.py; full suite 72 passed. Commit 422e5a4.
- Train-split check (185 rows, time-ordered 60%): fresh_wallet_ratio full points on 173 (16 bad_24h), half points on 2 (1 bad), zero on 10 (0 bad). Too close to a constant to help ranking as-is.
- Dataset: budgeted run (`--max-age-h 40 --parallel 3 --budget-min 5`) scored 2 launches at 411 s and 455 s each (a third was still in flight at session end and left to finish; budget stops it starting new ones). 330 scored total. Throughput dropped ~4x vs session 4 - logged as Next #1. pump.fun API still Cloudflare-blocked, not bypassed.
- No backtest refit (last 06:50; not due until ~08:50, and nowhere near +100 labels). Live version unchanged: bt20261103-12b97fda, held-out AUC 0.6657 (95% CI 0.50-0.79).
- Evaluation launches used: unchanged (the 124-launch test split of the 06:50 fit). Newest scored create_time recorded in Next #3 for the fresh holdout.

### 2026-11-03 07:34-07:46 CST - session 4
- Diagnosed the "stalled" backtest run (Next #1): not a hang and not pump.fun/Cloudflare. A faulthandler dump showed all threads in the RPC token bucket inside batch_tracer funding traces. One-launch run: 139 RPC calls in 80 s; publicnode returned null for 59 of 68 getTransaction calls (history outside its window), so they failed over to mainnet-beta, which delivered under 1 call/s (6 HTTP 429s, ~900 ms latency). The launch finished in 103.6 s. Session 3's 100 s `--limit 1` timeout was just too short.
- Shipped: backtest runner now reports progress as each launch completes (as_completed instead of ex.map), takes `--budget-min N` (stops starting new launches after N minutes, lets in-flight ones finish) and returns a summary (scored, budget_hit, per-launch seconds). New tests/test_backtest_runner_budget.py; full suite 66 passed. Commit b3d73cc. CLI contract unchanged (risk health/score/watch untouched).
- Dataset: budgeted run (`--max-age-h 40 --parallel 3 --budget-min 4.5`) scored 3 more launches in ~280 s, plus 1 from the diagnostic. 328 scored, 310 with a 24h label (was 309). 155 eligible 26-40h launches remain.
- No backtest refit (last 06:50, next due ~08:50 or at +100 labels); live version unchanged (bt20261103-12b97fda, held-out AUC 0.6657, 95% CI 0.50-0.79).
- Evaluation launches used so far: unchanged from session 1 (the 124-launch test split of the 06:50 fit). The 4 launches scored this session are training-pool rows, not evaluated.

### 2026-11-03 07:19-07:30 CST - session 3
- Checked idea "creator_sold / serial_deployer predict dead coins instead": falsified. Train split dead_24h rate is LOWER when they fire (creator_sold 4.7% fired vs 26.7% not; serial_deployer 3.6% vs 14.6%). Bad_24h on train: creator_sold not fired 15 launches, 40% bad vs 6.5% when fired. creator_holds almost never fires (2 train launches), so "creator hasn't sold yet" is the real risk signal and nothing captures it today.
- Shipped: report-only inverted-rule variants in the calibration weight experiment (creator_sold_inverted, both_inverted). Measured and written to the report, never picked or deployed (live scorer has no negative weights). Current-data AUC train/test: both_off 0.8001/0.6657, creator_sold inverted (+serial off) 0.8489/0.6846, both inverted 0.8704/0.6726, creator_sold -0.5 0.8321/0.6710. New test; full suite 57 passed. Commit 33002b6. No backtest refit (last 06:50; not due), live version unchanged.
- Dataset: sampler ran (300 new candidates checked; totals 2,688 candidates, 603 eligible), but `backtest run --max-age-h 40` scored 0 launches in 5 min, and a 1-launch run also hung 100 s. RPC healthy; `risk health` e2e score fine; pump.fun API still 403 (Cloudflare, not bypassed). Logged as Next #1.

### 2026-11-03 07:04-07:13 CST - session 2
- Security hardening (one-time, done): session 1's commit had pasted the proposed agent-guard patch in raw (sys.path hack inside build(), hard dependency on /workspace/agent-guard, and it mutated sig["coin"]). Replaced with a module-level import of agent_guard.safe_field (path overridable via AGENT_GUARD_PATH) plus a local fallback sanitizer (NFKC, strips control/invisible/bidi chars and markup, caps length). Symbol capped at 32, name at 64; None stays None; input signals no longer mutated. Commit 115bc5e.
- New test tests/test_token_metadata_safety.py: hostile name/symbol (bidi override, zero-width, control chars, <script>, "BUY 100 SOL" text, oversize) through both sanitizers and the full replay report; schema valid, score/recommendation and v0 keys unchanged. Full suite: 54 passed. Verified fallback path loads when agent-guard is absent.
- `risk health` still reports overall=fail only because pump.fun's API returns HTTP 403 (Cloudflare) - known gap, not bypassed; RPC checks pass.
- Not done this session: dataset growth, backtest (last fit 06:50, next due ~08:50 or at +100 labels).
- Uncommitted work by another session is present (smr/cli.py, smr/paper/, tests/test_paper.py - the paper trader); left untouched and not committed here.

### 2026-11-03 06:48-06:55 CST - session 1
- Tried: reworked the two rules the backtest showed working backwards. Train-only evidence: creator_sold fired on 170/185 train launches with a 6.5% bad rate vs 40% when it didn't fire; serial_deployer 4.4% vs 22.9%. Both point the wrong way.
- Added a weight experiment to calibration (small fixed set of variants, picked on TRAIN AUC only, then thresholds refit on the rescored train split). Results train/test AUC: live 0.6628/0.4714; creator_sold off 0.7314/0.5615; serial off 0.757/0.5265; both off 0.8001/0.6657; both half 0.7563/0.5611. Picked on train: both off.
- Deploy gate (now: held-out AUC >= 0.60 AND beats live): passed, 0.6657 vs 0.4714. Live version bt20261103-12b97fda. Held-out tiers: SKIP 53 (17.0% bad), REDUCED 7 (14.3% bad), NORMAL 64 (1.6% bad); skip recall 0.82; mean sized return +0.05% of bankroll vs -0.13% all-NORMAL.
- Caveats: only 11 bad launches in the test split; bootstrap 95% CI on test AUC 0.50-0.79. The idea came from a lift table that included the test rows, though train-only lift shows the same thing.
- Bug fixed: calibrate.auc replaced a raw_points value of 0 with the score (falsy check); now only falls back when missing.
- Rules still compute and report their evidence (weight 0 = informational). CLI contract unchanged; 31 tests pass; `risk health` schema valid.
- Data: no new launches this session (time went to the rework). pump.fun API not used.
- Ops note: rsync isn't installed; a full tar copy to the store took ~7 min (big data/*.db files, utime warnings are harmless). Next session: copy only files changed since the last backup (e.g. `find -newer`) to stay inside the 12-minute budget.
