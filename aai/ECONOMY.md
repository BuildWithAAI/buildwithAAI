# Zoorped's layered agent economy (spec)

The economy starts **human-run** and moves toward **agentic automation** one measurable step at a time.
Everything below is **paper** unless Zoorped explicitly signs off on a specific stage for a specific strategy. No code in
this repo places real orders, moves money, or unlocks a real-money stage: `aai/economy.py` always reports
`real_money_allowed: false`.

## Layers

| Layer | Name | What lives there | Repo / module | Who acts |
|---|---|---|---|---|
| **L0** | Safety | Global kill switch, single-use human approval tokens for any money movement, per-agent lanes (`config/limits.json`), prompt-injection gates, hash-chained audit | `/workspace/agent-guard` | Enforced on everyone. Only Zoorped resumes the global kill |
| **L1** | Producer agents | Generate signals and paper trade ideas: Solana Meme Risk, perps arena (6 arms x $100 sim), forex, Billy, Stocks (not built), 2040 (long-term reviews) | `/workspace/solana-meme-risk`, `/workspace/perps-pipeline`, `/workspace/aai-forex`, `/workspace/billy-pipeline`, 2040 reports | Agents (paper) |
| **L2** | Shared plumbing | Normalised market data, signals, ideas, reports, control flags | `/workspace/aai-core`, `aai/store.py` -> `data/aai.db` | Infrastructure |
| **L3** | Risk + paper ledger | Per-trade risk 1-3% (memes 1%, perps 2%), 6% total open risk, sector caps, kill at -5% day / -15% DD, simulated fills | `aai/risk.py`, `aai/ledger.py` | Risk engine (deterministic) |
| **L4** | Long-term money | Separate capital bucket, no leverage, draft tickets only; OnePay Roth is audit-only and user-executed | `aai/longterm.py` | Zoorped executes; agents audit/draft |
| **L5** | Human interface | Zoora HUD (`/zoora`) and classic JSON API, localhost only (127.0.0.1:57025), plus the economy scorecard `/api/economy` | `aai/hud.py`, `aai/zoora.py`, `aai/economy.py` | Zoorped reads and decides |
| **L6** | Human-run outside income | Thesisdamus and other income Zoorped earns outside the agent stack | (outside this repo) | Zoorped only |

## How value and capital flow

```
 L6 outside income ──(Zoorped deposits, by hand)──▶ L4 long-term bucket ◀──(Zoorped rebalances, by hand)
        │                                                ▲
        └──(Zoorped funds a trading sleeve, by hand)──▶ L3 paper book  ──── paper P&L ───┐
                                                         ▲                               │
 L1 producers ── signals/ideas ──▶ L2 store ── ideas ──▶ L3 risk engine (approve/reject) │
        ▲                                                                                │
        └───── L5 scorecard: stats, ladder stage, paper weight (aai/economy.py) ◀────────┘
 L0 sits underneath all of it: kill switch, approval tokens, lanes, audit chain.
```

1. **Information flows up.** L1 producers write signals and ideas into L2. L3 sizes them, rejects what breaks a cap,
   and fills the rest on paper. Results go back into L2 (`positions`, `equity_snapshots`, `audit_log`).
2. **Paper capital flows by merit.** `aai/economy.py` scores each strategy from its closed paper trades, decides which
   ladder stage it is *eligible* for, and proposes paper capital weights (stage x positive expectancy x confidence,
   40% cap per strategy, the rest stays unallocated cash). Weights are advice for the paper book only.
3. **Real money flows only by hand.** Moving money between L6, L4, and any trading sleeve is Zoorped's action. Agents never
   hold execution ownership (DB-enforced for long-term accounts) and every money movement needs an L0 single-use human
   approval token.
4. **Profits are not auto-compounded into risk.** Raising a sleeve's real size is a promotion decision, not a side effect.

## Promotion ladder (per agent / strategy)

A *strategy* is a scored unit: `aai:<sector>/<idea source>` for ideas that went through the aai paper ledger, and
`perps-arena:<arm>` for each perps-arena arm. R = net P&L / planned risk for that trade. The out-of-sample (OOS)
window is the **last 30%** of trades in time order. Stages are cumulative: stage 2 needs stage 1's criteria too.

| Stage | Meaning | Entry criteria (all) |
|---|---|---|
| **0 Human-run** | Zoorped (or a script he runs) decides every idea. The default for anything new | none |
| **1 Human-approved per action (paper)** | Agent proposes; each paper action is approved by a human | >= 10 trades, max DD <= 15%, expectancy >= -0.05R |
| **2 Automatic within limits (paper)** | Agent's ideas flow through L3 automatically, inside L0 lanes and L3 caps | >= 30 trades, max DD <= 10%, expectancy >= +0.10R, >= 10 OOS trades with OOS expectancy > 0, profit factor >= 1.2, R-sharpe (mean R / sd R) >= 0.10, >= 7 days of record |
| **3 Autonomous within limits (paper)** | Agent also manages exits/sizing inside its lane without per-trade review | >= 100 trades, max DD <= 8%, expectancy >= +0.15R, >= 30 OOS trades with OOS expectancy >= +0.10R, profit factor >= 1.3, R-sharpe >= 0.15, >= 30 days |

**Exit / auto-demotion** (evaluated every scorecard read):
- Current drawdown from peak >= the stage's exit level (stage 1: 15%, stage 2: 10%, stage 3: 8%) -> down one stage.
- Expectancy over the last 20 trades < -0.25R -> down one stage.
- Kill switch hit (global kill for aai-store strategies, arena kill, killed or benched arm) -> **stage 0, weight 0**.

**Real money gate.** A stage that touches real money (any stage applied to a funded account) requires, in this order:
(1) the strategy has been at stage >= 2 on paper for the full entry window, (2) **Zoorped's written sign-off** naming the
strategy, stage, sleeve size and loss limit, recorded in the audit log, (3) an L0 single-use approval token per money
movement, and (4) the hard L3 caps still apply. None of these is automatable from this repo. Until then every stage is
paper and `aai/economy.py` only reports eligibility.

## Where to read it
- `GET /api/economy` (read-only, sanitised through agent_guard) on the Zoora HUD host.
- `.venv/bin/aai economy` (CLI, read-only).
- Zoora HUD panel 10 "Economy ladder", or ask Zoora "economy" / "ladder" (read-only; it cannot promote or grant a stage).

## Roadmap / checklist
Future runs: pick the top unchecked item that fits in one run, follow the `IMPROVEMENTS.md` lock contract, and tick it here.

Built:
- [x] Layer map L0-L6 and capital-flow rules (this file).
- [x] Promotion ladder with measurable entry/exit criteria and the real-money sign-off gate (this file).
- [x] `aai/economy.py`: per-strategy stats (P&L, return %, max/current drawdown, expectancy R, R-sharpe, return per $ risk,
      profit factor, OOS window, recent window), stage eligibility, auto-demotion, capped paper weights.
- [x] Sources: aai paper ledger (test artifacts excluded) and the perps arena arms (read-only `arena.sqlite`).
- [x] `GET /api/economy` and `aai economy` (read-only). Tests: `tests/test_economy.py`.
- [x] **E1 Zoora economy panel** (2026-11-03). Panel 10 "Economy ladder" in `/zoora` renders `GET /api/economy` (polled every
      30 s): one row per strategy with stage chip, trades, expectancy R, max DD, paper weight and the top next-stage blocker,
      killed/demoted rows tagged, stage counts and unallocated cash on top. `/api/economy` now also returns `panel` +
      `summary` (`economy.panel()`; comparisons spelled out because agent_guard strips `<`/`>`). Zoora intent `economy` /
      `ladder` / `scorecard` answers from the same read-only data; "promote/grant ... stage" is refused (403) and changes
      nothing. Tests: `tests/test_economy_panel.py`. Screenshot: `docs/screenshots/zoora-economy-panel-crop.png`.
- [x] **E2 Granted-stage registry + sign-off log** (2026-11-03). `aai/grants.py`, append-only `economy_stage_grants`
      (strategy, stage, action grant/revoke/auto_demotion, granted_by, quote, eligible_stage, prev_stage, ts). Only
      `aai economy-grant ... --confirm GRANT` with `--by` and a verbatim `--quote` writes (CLI actor only, never above current
      eligibility, killed -> stage 0 only, audited). `aai economy-reconcile` logs auto-demotions; reads never write.
      Effective stage = min(granted, eligible); panel 10 shows S (eligible) and G (granted) chips. HUD/voice cannot grant.
      Paper weights are still eligibility-based (E5 will switch sizing to the effective stage).

Remaining (in priority order):
- [ ] **E3 More L1 producers in the scorecard.** Read forex (`/workspace/aai-forex`) and Billy paper results read-only, and
      the meme-risk call accuracy (signal -> outcome) as a non-trading "forecast" strategy type.
- [ ] **E4 Stage-aware routing in L3.** Ideas from stage-0 strategies get `status=needs_human` instead of auto-fill; stage-1
      need a per-idea human approve in the HUD (paper); stage >= 2 flow automatically. Still paper only.
- [ ] **E5 Allocation -> paper sizing.** Feed the paper weight into per-strategy paper sleeves (sleeve risk budget =
      weight x 6% total), never above the hard 1-3% per-trade caps.
- [x] **E6 Daily economy snapshot.** (done 2026-11-03: `aai/snapshots.py`, `aai economy-snapshot`, `GET /api/economy/history`, stage-change alarms + panel feed) Append the scorecard to an `economy_snapshots` table once a day for stage history and
      a stage-change feed in the HUD; alert when a strategy becomes eligible or is demoted.
- [ ] **E7 Walk-forward check.** Replace the fixed last-30% OOS split with rolling walk-forward windows once strategies have
      100+ trades; report stability across windows.
- [ ] **E8 L4/L6 ledger view.** Read-only view of manual deposits/transfers Zoorped logs (L6 -> L4 / sleeves) so the whole
      capital flow is visible. Display only; no money movement.
- [ ] **E9 Real-money readiness checklist** (needs Zoorped): written per-strategy sign-off template, sleeve size, loss
      limit, broker/venue, and the L0 token flow. Do not start without the owner.
