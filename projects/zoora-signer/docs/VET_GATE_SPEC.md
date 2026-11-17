# Coin vetting gate: `vet(mint)` spec (schema `vet/1`)

**Status: DESIGN AND REFERENCE CODE ONLY.** Nothing here trades, signs, funds or holds a key. `solana_meme` stays locked in
agent-guard. Going live still needs a legitimate route for pump.fun (the frontend API returns 403 to this box and is
never bypassed), a GO from HoSec and Head of Systems, and Zoorped's final approval.
Executor limits this gate serves: $2 per buy, 3 open trades, $20 total exposure. Software Engineer builds the signer.

- Reference code: `smr/vet/` (`vet(mint) -> VetResult`), tests `tests/test_vet.py` (56 offline tests).
- Measurements: `tools/vet_latency_probe.py` -> `data/vet/latency_run5.json` (young coins, main run) and runs 1-4 (debug and earlier versions).
- Threshold evidence: `tools/vet_threshold_evidence.py` -> `data/vet/threshold_evidence.json`.
- Config version: `vetcfg-20261117-v6` (`smr/vet/vconfig.py`). Measured 2026-11-17, ~15:50-16:35 CST.

## 1. Interface

```python
from smr.vet import vet, VetConfig
r = vet(mint: str, *, ctx=None, cfg: VetConfig | None = None, use_cache: bool = True) -> VetResult
r.verdict   # "PASS" | "FAIL" | "UNKNOWN"
r.allow     # True only if verdict == "PASS"
r.to_dict() # vet/1 JSON (below)
```
CLI: `python -m smr.vet <MINT> [--budget-s 45] [--no-cache] [--pretty]` prints one JSON object on stdout.
Exit codes: `0` PASS, `1` FAIL, `2` UNKNOWN, `3` internal error. `vet()` never raises for data problems; they become UNKNOWN.

**Executor rule: buy only if `verdict == "PASS"`. UNKNOWN, FAIL, any exception, timeout, non-zero exit code, unparseable
JSON, a `schema` other than `vet/1`, or a `config_version` other than the pinned one all mean do not buy.**

## 2. Result schema `vet/1`

```jsonc
{
  "schema": "vet/1",
  "mint": "<base58>",                      // "<invalid>" if validation failed
  "verdict": "PASS|FAIL|UNKNOWN",
  "allow": false,                          // == (verdict == "PASS")
  "evaluated_at": 1795000000.123,          // unix s, when the checks were evaluated
  "valid_until": 1795000015.123,           // evaluated_at + result_ttl_s (15 s): re-vet after this
  "latency_ms": 16060, "budget_ms": 45000,
  "config_version": "vetcfg-20261117-v6", "code_version": "<git short hash>",
  "data_as_of": {"oldest": 1794999990.0, "newest": 1795000000.0},
  "sources_used": ["rpc:getAccountInfo(bonding_curve)", "rpc:getProgramAccounts(mainnet-beta)", "dexscreener", "..."],
  "cache": {"slow_facts": "hit|miss", "slow_facts_age_s": 12.3, "fact_latency_ms": {"curve": 62, "early": 7440, "...": 0}},
  "reasons": [                              // every fail / unknown / warn reason, flattened
    {"code": "TOP10_TOO_HIGH", "check": "holders", "severity": "fail", "observed": 46.2, "threshold": 30.0, "message": "..."}
  ],
  "checks": {                               // always these 8 keys when the input is valid
    "<name>": {"status": "pass|fail|unknown", "required": true, "latency_ms": 62, "data_as_of": 1795000000.0,
               "slot": 470690862, "sources": ["..."], "metrics": {"...": "numbers only"}, "reasons": [/* incl. info */]}
  }
}
```
Severity: `fail` blocks the trade. `unknown` blocks it too (fail-closed). `warn` and `info` are reported but never block.
`observed` and `threshold` hold numbers, booleans, addresses or reason strings. They never hold token metadata.

Verdict: **FAIL** if any check failed. Otherwise **UNKNOWN** if any required check is unknown or missing. Otherwise **PASS**.
FAIL outranks UNKNOWN because it is the more specific answer; both block the buy.

## 3. Checks (all required)

| check | what it decides | data path (all free, no pump.fun API) |
|---|---|---|
| `input` | mint is a 32-byte base58 key and not a system or program address | local |
| `authority` | pump.fun curve exists (owner `6EF8...`); quote is SOL; mint and freeze authority revoked; Token-2022 extensions allow-listed (metadata only); if `complete`, the canonical PumpSwap pool exists, pairs mint and WSOL, and **LP mint supply == 0 (burned)** | bonding-curve PDA + mint `getAccountInfo`; pool PDA + LP mint `getMultipleAccounts` |
| `mayhem` | Zoorped rule: hard-skip Mayhem coins (curve byte 81, PumpSwap pool flag, supply > 1.001B) | curve / pool accounts |
| `market` | Zoorped rule: market cap >= $30k; liquidity >= $2k; on-chain mcap vs DexScreener within 2x | curve or pool reserves x SOL/USD (DexScreener median of WSOL/USDC+USDT pairs) |
| `holders` | top10 (excludes curve, pool, pool authority, burn/infra, program-owned accounts) <= 30%; top1 <= 10%; creator <= 10%; holders >= 75; fresh-wallet ratio (warn only) | `getProgramAccounts` on **mainnet-beta**; program-owned check via `getMultipleAccounts` |
| `bundle_sniper` | non-creator buyers in the create slot < 3; their gross buys < 5% of supply; buys within 2 slots < 20%; those sniper wallets hold < 10% now | create time by on-chain bisection; first-buyer txs in create+5 min (shrinks to 60 s / 15 s for hot launches) |
| `creator_history` | prior launches by the curve creator in 24 h (warn only); share of measured prior launches that rugged or died < 0.8 (with >= 3 measured) | creator signatures ∩ create-stream index (`launches.db`) + prior curves' txs |
| `funding_cluster` | early buyers sharing a funder (2 hops): largest cluster < 20% of supply; deployer's cluster < 10%; trace coverage >= 60% | `BatchTracer` + `funding_graph.db` |

The on-chain bonding curve **replaces the pump.fun API** for what the gate needs. A `getAccountInfo` on PDA
`["bonding-curve", mint]` returns reserves, `complete` (migrated), `creator`, `is_mayhem_mode`, `is_cashback_coin` and
`quote_mint`. This matches the pump-fun/pump-public-docs IDL and was checked on live accounts. The creation time comes from
bisection: "does the mint have any signature before the create-stream anchor at time t?", which takes 6 probes with a
DexScreener `pairCreatedAt` hint and 15 without. The hint is verified, never trusted.
The creator's own history is not used to find the create tx: `create_v2` passes the creator as instruction data, so the create tx is often missing from it.

## 4. Fail-closed rules

- Any required check that cannot measure its input is **unknown**. That covers a source error, a timeout, a missing fact, a decode error, a mint older than about 33 h (creation unreachable), a create-stream gap, trace coverage under 60%, an incomplete creator history, or sources that disagree.
- Staleness at evaluation time: curve, mint, pool and price facts older than **15 s**, the holder list older than **30 s**, or launch facts (early buyers, traces, creator history) older than **1800 s** make the check unknown. Mutable facts are always re-read after the slow stage (`refresh_*` in `fact_latency_ms`), so evaluation never uses reads taken before it.
- Wall-clock budget: the default `budget_s` is **45 s** (proposal: measured cold full-path p95 35.4 s, max 44.7 s). The slow stage stops at budget minus 8 s, keeping 8 s for the final refresh. Unfinished facts become `timeout (budget exhausted)`, which makes the result UNKNOWN. Worker threads are not joined, so the call returns on time.
- Out of scope means FAIL, not UNKNOWN: no pump.fun curve, a non-SOL quote (curves quoted in tokenized stocks or PUMP were seen today), a missing migrated pool, or an LP not burned.
- Rules that ran backwards on labeled data are **warn only** and never block: serial-deployer count and fresh-wallet ratio (§7).

## 5. Caching

| data | cache | why |
|---|---|---|
| early buyers, funding traces, creator history | per mint, `slow_ttl_s` = 1800 s, in process and on disk (`DiskCache` key `vet_slow|mint|config_version`) | They describe the launch (point in time), not the present. This lets a send-time recheck skip about 99% of the work. |
| curve, mint, pool, LP, holders | **never** reused across vets (ttl 0); always re-read at the end | They can change every slot. |
| SOL/USD | 30 s | Used only for the USD conversion; a 15 s check-level staleness rule still applies to the curve. |
| DexScreener token pairs | 10 s | Cross-check only. |
| finalized txs, anchored signature pages | forever (existing `DiskCache` behaviour) | Immutable. |
| PASS verdict | **not cached by the executor beyond `valid_until`** | |
Changing `CONFIG_VERSION` invalidates the slow cache.

## 6. Input validation and hostile data

- `mint` must be a `str` of 32-44 base58 characters that decodes to exactly 32 bytes and is not a reserved address (system, WSOL, token programs, pump programs, USDC/USDT). It is only decoded and compared; it is never interpolated into a shell, SQL or prompt. The `pump` suffix is informational (`MINT_SUFFIX_NOT_PUMP`, info), because pump.fun origin is proven by the on-chain curve.
- Per agent-guard, all token metadata is hostile. The gate never reads name, symbol, URI or description. From Token-2022 extensions it reads only the extension **names**. Results contain numbers, addresses and fixed reason codes only (a test asserts injected text never reaches the output). Any display layer must pass metadata through `agent_guard.safe_field`.

## 7. Proposed thresholds and the data behind them

Labeled dataset: `data/backtest/work/backtest.db`, 2,051 usable launches, 177 `bad_24h` (base rate 8.6%), signals
scored at create + 5 min. **The pipeline has no proven edge for picking winners** (the old version's held-out AUC was
0.47; the live score's latest fresh holdout #8 was 0.675, 95% CI 0.53-0.81). These are conservative **safety floors**, not predictors.
Tags: *owner* = Zoorped rule; *default* = existing hand-set pipeline default; *proposal* = new number, not backed by data.

| metric (FAIL if) | value | tag | evidence (bad rate flagged vs passed, share flagged) |
|---|---|---|---|
| market cap < | $30,000 | owner | n/a |
| Mayhem mode | true | owner | n/a |
| liquidity < | $2,000 | default | n/a |
| mint / freeze authority active, non-allow-listed Token-2022 extension, LP not burned | any | proposal (structural) | authority: never seen on pump.fun (0 / 2,051) |
| top10 excl. curve/pool > | 30% | default | **76% vs 6.4%**, 1.3% flagged (>20%: 83% vs 3.8%, 4.5% flagged) |
| top1 > | 10% | proposal | **62% vs 5.8%**, 2.7% |
| creator holds > | 10% | default | **67% vs 6.7%**, 1.1% |
| holders < | 75 | default | not testable (dataset is at create + 5 min) |
| same-slot non-creator buyers >= | 3 | default | 14.6% vs 6.8%, 23% flagged |
| same-slot gross buys >= | 5% supply | default | 14.6% vs 6.5%, 26% |
| sniper (<= 2 slots) gross buys >= | 20% supply | proposal | **28.3% vs 7.1%**, 7.4% |
| sniper wallets hold now >= | 10% | proposal | no data (current balances not in dataset) |
| largest shared-funder cluster >= | 20% supply | default | weak: 12.2% vs 8.3%, 9.2% |
| deployer cluster >= | 10% supply | proposal | weak: 11.9% vs 8.2%, 11.5% |
| prior-launch bad ratio >= (>= 3 measured) | 0.8 | default | none: 10.1% vs 8.5% (safety floor only) |
| *warn only*: prior launches in 24 h >= | 10 | default | **inverted**: 4.9% vs 12.9% |
| *warn only*: fresh-wallet ratio >= | 0.5 | default | **inverted** at every cut from 0.5 to 1.0 (e.g. >= 0.9: 4.4% vs 12.4%) |
"Gross buys" adds up repeated buys, so hot launches show more than 100% (the dataset uses the same definition).

## 8. How the executor calls it

1. A signal arrives (BUY mint). The executor checks its own hard caps first ($2, 3 open, $20, kill switch, breaker); the gate never replaces those.
2. `r = vet(mint)` in-process, or the CLI with a 50 s hard timeout. A cold vet takes about 16 s at p50 and 35 s at p95.
3. If `r.allow` is false, drop the signal and log `mint, verdict, reason codes, config_version, code_version, evaluated_at`. Never log token names.
4. Build and simulate the swap.
5. **At send time, if `now - r.evaluated_at > 15 s`, call `vet(mint)` again.** This uses the warm path: launch facts come from cache, mutable facts are re-read, and measured latency is **p50 0.31 s, p95 0.79 s**. Send only if it is PASS again. Otherwise abort.
6. SELL signals and exits are **never** gated by `vet` (exits must always be possible). The gate is BUY-only.
7. Pin `config_version`. A different version means do not buy until it is reviewed.

## 9. Measured latency (run 5: 12 young pump coins from GeckoTerminal/DexScreener, 10 ran the full path; 2 short-circuited as not pump.fun)

Each mint was vetted cold (first vet of that mint; shared wallet/tx caches warm, as they would be in production), then rechecked.

| check | critical path | p50 ms | p95 ms | sources |
|---|---|---|---|---|
| input | local | 0 | 0 | none |
| authority + mayhem | curve + mint (+pool) | 62 | 87 | publicnode `getAccountInfo` / `getMultipleAccounts` |
| market | curve, SOL price, DexScreener | 62 | 78 | publicnode + DexScreener |
| holders | GPA holder list | 226 | 577 | mainnet-beta `getProgramAccounts` (one 5.5 s outlier in run 2) |
| bundle_sniper | creation bisection + first-buyer txs | 7,440 | 10,080 | publicnode sigs/tx (+ mainnet-beta failover) |
| creator_history | early + serial | 8,101 | 12,098 | publicnode + `launches.db` |
| funding_cluster | early + 2-hop traces | 15,782 | 34,834 | publicnode/mainnet-beta + `funding_graph.db` |
| final refresh | curve/mint/pool/holders | 146 | 454 | publicnode + mainnet-beta |
| **total cold (full path)** | | **16,060** | **35,358** (max 44,743) | |
| **send-time recheck** | | **308** | **794** | |
| short-circuit FAIL (not pump.fun / non-SOL quote) | | 62-140 | | |

The traces are the long pole (p50 9.6 s, p95 25.7 s). An earlier version that walked the mint's full history took about 33 s just for early buyers; the bisection change fixed that.

## 10. Data sources from this box today (2026-11-17)

**Work:** publicnode `getAccountInfo`, `getMultipleAccounts` (**10 keys max** now), `getSignaturesForAddress` (incl.
`before` anchors), `getTransaction` (about 33 h of history). mainnet-beta `getProgramAccounts`, `getTokenSupply`,
`getAccountInfo`, signatures. DexScreener (pairs, `tokens/v1`, profiles/boosts). GeckoTerminal (new/trending pools).
**The pump.fun bonding curve read on-chain** (curve state, creator, complete/migrated, Mayhem, quote mint) and the PumpSwap
canonical pool plus LP mint supply, both on-chain. pump-fun public IDLs (GitHub raw).
**Don't work:** pump.fun frontend API (Cloudflare 403; not bypassed, not called). **StalkChain: out of credits, verified
with one `token_quality` call ("No credits on this account", balance -13)**. publicnode indexed methods
`getProgramAccounts` / `getTokenLargestAccounts` / `getTokenSupply` ("Indexed requests require a personal token", new
since Nov 10). mainnet-beta `getTokenLargestAccounts` (constant 429). Backfilling the create stream past about 33 h with free RPC.
**Gap:** `launches.db` has a hole from Nov 11 06:06 to Nov 16 06:20 CST (box downtime). Creator history is complete only for
coins created after Nov 17 06:20 CST, and only while something keeps the index head current (each vet refreshes it). A
downtime of more than 33 h creates a new hole that free RPC cannot fill.

## 11. Known limitations

- Coins older than about 33 h come back UNKNOWN (creation unreachable through free RPC), as do coins whose creator changed. That is intended fail-closed behaviour.
- `creator_history` follows the curve's `creator`. For launchpad-style creates the fee payer is a different wallet and is not traced.
- Holder concentration counts token accounts per owner from the full GPA list; the `program_owned` exclusion uses the top 15 owners.
- **Existing pipeline regression (not fixed here):** `smr.data_extractors.holder_concentration` still calls GPA on publicnode (now rejected, with no failover), and `_program_owned` batches 15 keys (publicnode limit 10, so the error is swallowed and program-owned vaults are not excluded). The gate uses its own readers that skip publicnode for GPA and batch by 10.

## 12. Open questions

1. Is `top10 > 20%` acceptable instead of 30%? It is stronger in the data (83% vs 3.8% bad) but flags 3.5 times as many launches.
2. Should `PRIOR_RUGS` stay a FAIL? The data shows no separation.
3. Is the 45 s cold budget acceptable for the executor's signal latency? The alternative is 1-hop traces, which is faster but marks hub funders less well; not measured yet.
4. Does `bundle_sniper`'s "holds now >= 10%" need data before it blocks? Today it is a proposal.
5. Should a keeper process be run on the executor host to keep `launches.db` continuous? Without one, `creator_history` goes UNKNOWN after a downtime.
6. Should coins older than 33 h be allowed through a paid or indexed RPC? That would change the free-RPC-only decision, so it is Zoorped's call.
7. Should the deployer (fee payer) also be traced for serial history when it differs from the curve creator?
8. Should the existing pipeline regression in §11 be fixed in the core pipeline (separate change)?
