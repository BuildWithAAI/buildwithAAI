# Zoora capped pump.fun executor: design (draft 1, 2026-11-17)

Status: design only. No money, no funding, no mainnet signing. Live use needs (1) a confirmed legitimate route,
(2) HoSec GO, (3) HoS GO, and (4) Zoorped's final approval in his own words.

## Where things live
- Repo: BuildWithAAI/buildwithAAI. No new repo. Draft PR from main on branch `cursor/zoora-signer`, built by a cloud agent.
  - `projects/zoora-signer/`: a standalone Node/TS service (its own package, its own SQLite DB). It never imports Lumen code.
  - `projects/lumen/src/trade/intentClient.ts`: Zoora's side. It can only POST intents and read status.
  - `projects/zoora-signer/vetting/`: the verdict verifier for Solana Research & Risk's interface (TBD with that agent).
- Where the signer runs:
  - Dry run: CI and a local `solana-test-validator`, with a throwaway key generated in memory per run.
  - Live (proposal): a separate Fly app `zoora-signer` with no public IP, reachable only over Fly's private network
    from `lumen-tidepool`. Zoorped sets the key with `fly secrets set` from his own PC. No agent has a Fly token,
    and the key never touches the box, the repo, CI, logs or chat. The fallback is his Windows PC, with the key in
    Windows Credential Manager. The repo ships only a `SIGNER_KEY=<owner provisions>` placeholder and a startup
    check that refuses to boot without it.
- On-chain route: the pump.fun program via a normal Solana RPC (owner-chosen provider), with transactions built
  locally. No VPN. Whether this route is legitimate for him (ToS and region) is Head of Research's call. The signer
  enforces a program-id allowlist (pump.fun bonding curve, its AMM if needed, System, Token, ATA, ComputeBudget)
  and refuses any other instruction.

## Trust boundary
Zoora's engine sends `{intent_id (uuid, idempotent), side: buy|sell, mint, usd_stake | token_amount, max_slippage_bps,
vetting_verdict}` signed with HMAC-SHA256 using a key the owner provisions. The signer re-derives every number
itself and trusts nothing in the intent except the side, the mint and the requested size. No visitor, web or
chat text can produce an intent: the engine path is owner- and Zoora-only and goes through the same import-graph
sink test as Lumen.

## Limits (all enforced in the signer, atomically)
One SQLite DB in WAL mode. Every intent runs inside a single `BEGIN IMMEDIATE`: it re-reads state, checks all caps,
writes a **reservation** row (trade slot, exposure, daily buy count, worst-case loss), and commits. Only then does it
build and sign. If the transaction fails or expires (blockhash lapse), the reservation is released by a recorded
event, never by deleting the row. Two simultaneous intents therefore cannot both take the 3rd slot or the last
dollars of the $20.

| Limit | Rule |
|---|---|
| Stake | Total cost of a buy ≤ $2.00 USD: SOL in, plus base and priority fees, the pump.fun fee and new ATA rent. Priced at oracle mid, and refused if the price can't be computed. |
| Oracle | Pyth SOL/USD (Hermes): publish time ≤ 30 s old, confidence ≤ 1% of price, and agreement within 2% with a second source (Jupiter price). Otherwise refuse and auto-halt. |
| Open trades ≤ 3 | A trade is open until its realized sell proceeds (net of fees) ≥ its buy cost (net of fees). After that, what's left is a moon bag and no longer counts. |
| Buys/day ≤ 10 | Counts reservations that reached signing. The day is 00:00–24:00 America/Chicago. |
| Daily loss ≤ $6 | Below. |
| Exposure ≤ $20 | Open trades are valued at max(unrecovered cost, mark) and moon bags at their mark. Pre-buy check: exposure + new stake ≤ $20. |
| Wallet ≤ $25 | Wallet value = SOL + all token marks. Above $25, buys halt with an alert telling the owner to sweep to the whitelist. The signer can't refuse deposits, so this is a halt, not a refusal. |
| Slippage | ≤ 1500 bps, set as min-out / max-in on the instruction itself (enforced on-chain). |
| No leverage or transfers | Only buy and sell instructions. A SOL transfer is allowed only to the owner whitelist address, only through an owner command, and never from an intent. |

**Mark** = the executable sell quote for the full position from bonding-curve math (or the AMM pool), after fees, at
oracle mid. An unknown or failed mark counts as $0 for equity (the conservative direction for loss) and as unrecovered
cost for exposure.

**Daily loss** = `start_equity − (current_equity + owner_withdrawals_today − deposits_today)`.
`start_equity` is snapshotted at 00:00 CT, or on the first resume of the day, as wallet SOL plus every position at mark.
A buy is refused if `daily_loss + new_stake > $6`, so it assumes the new stake can go to zero. If `daily_loss ≥ $6`,
buys halt until the next CT day. Sells are still allowed.

## Kill switch and halts
- State machine: `PAUSED | ACTIVE | HALTED(reason)`. **Every boot starts PAUSED.** Only an owner resume reaches ACTIVE.
- Owner kill: a signed owner command (CLI on his PC, or the existing Telegram owner chat as a second channel)
  that sets HALTED.
- The global agent-guard killswitch is polled every 5 s, and an unreachable killswitch counts as killed. Agent-guard's `engage()` is not in this repository. It writes `state/KILL_SWITCH` and does not write a heartbeat. The signer also treats `killed` and the file named by `AGENT_GUARD_KILL_FILE` as killed. A heartbeat whose status is anything other than `clear` is killed. The only heartbeat writer is `zoora_signer.heartbeat.write_heartbeat` in the signer process. That file is mode `0600`, and on Windows its ACL is the owner SID plus SYSTEM. A broader ACL makes the heartbeat invalid. The kill-switch directory is on the owner-only ACL list. This build does not start that writer. The switch is polled again immediately before the refused sign step and immediately before the refused send step.
- The outside anchor file is part of the halt check. Once an anchor has been written, a missing file is `anchor_mismatch`. Keep a copy of that file off the PC. A restored database without its anchor must stay halted.
- Under either kill, new buys stop and open trades are held. Only an owner "sell all" or "sell X" closes them.
  Question for HoS and Zoorped: may Zoora's own sells still go through during a kill? The default proposal is no.
- Auto-halt triggers: any cap breach or attempted breach, a stale or disagreeing oracle, the wallet over $25,
  an unknown token or an unexpected SOL delta in the wallet compared with the ledger, a transaction unconfirmed
  for more than 90 s, a DB error, a hash-chain verify failure, a vetting service error, or clock skew over 5 s.
  Fail closed on every one.

## Vetting gate
A buy needs a verdict from Solana Research & Risk for this exact mint: `{mint, verdict: pass, checks[], ts, sig}`,
signed with its key, ≤ 120 s old, and its rules version must match the allowlist. A missing, stale, failed or
unverifiable verdict is refused. Sells never need vetting.

## Log and HUD
- The signer has an append-only `events` table, hash-chained (`prev_hash`, unique), recording intents, vetting
  results, reservations, refusals with their reason codes, transaction signatures, fills, fees, marks, P&L, halts
  and owner commands. It holds no keys, seeds, HMAC secrets or raw RPC URLs with API keys. A read-only
  `/events?after=<id>` feed lets the HUD read only new lines.
- HUD alerts: open, stake recovered (becomes a moon bag), close, halt, and the daily loss reaching 50% and 100%.

## Acceptance tests (what a GO rests on; no paper phase)
1. Every cap at the boundary and at boundary+1¢ or +1: stake, 3 trades, 10 buys, $6, $20, $25, 1500 bps.
2. Concurrency: 2–20 simultaneous buy intents near each cap. Exactly the allowed number pass. Run it repeatedly.
3. Restart: kill -9 mid-reservation and mid-confirmation. On boot it's PAUSED, the reservations reconcile against
   the chain, and the caps still hold.
4. Oracle: stale, wide confidence, source disagreement, and down. Each refuses and halts.
5. Kill switch: owner kill, agent-guard kill, and an unreachable agent-guard all stop buys. Holds and owner sells work.
6. Vetting: missing, stale, wrong mint, bad signature, fail. All refused.
7. Instruction allowlist: a crafted intent can't produce a transfer or an unknown program.
8. A fuzz pass of intents against the cap invariants (property-based).
9. End to end: `solana-test-validator` with the pump.fun program and a fixture curve cloned for real fills,
   plus mainnet `simulateTransaction` (sigVerify off, unsigned) for quote and slippage realism. No mainnet signing,
   ever, in tests.
10. A log chain verify, and a secret scan (gitleaks) over the repo and a sample log.

## Build order once the design gets GO
1. Signer core: state, caps, reservations and tests 1–3, 7, 8.
2. Oracle and marks (test 4).
3. Kill switch and halts (test 5).
4. Vetting interface (test 6, once Solana R&R defines it).
5. Local-validator end-to-end (test 9) and the HUD feed.

Then HoSec and HoS review, then the route answer and Zoorped's final approval in his own words.

## Open questions
- Zoora's sells during a kill (default no).
- Where the signer runs live: a separate Fly app (proposed) or his PC.
- The RPC provider (his account and key, provisioned by him).
- The vetting interface and its signing key (Solana R&R).
- Is the $25 wallet cap measured at mark or at SOL only? Proposed: at mark.

---
## Amendments after HoS design GO (2026-11-17)

### A1. Decision engine (lives in Lumen at `projects/lumen/src/trade/`; covered by the no-visitor-input sink test)
- **Candidates**: only from the Solana R&R vetting feed, i.e. mints that already passed `vet(mint)`, plus Zoora's own
  watchlist built from that feed. Never from visitor, guestbook, web or chat text, and never from a mint string in free text.
- **Pick**: Zoora picks from candidates with her own reasoning. Every pick carries a one-line public rationale for the log
  and HUD. Size is fixed at $2.00 all-in. She never chooses the size.
- **Exits**: stake recovery comes first. Once a position's sell value is at least 2× cost, she sells enough to recover
  cost plus fees, and the rest becomes a moon bag, which she may keep or close at any time. There's also a time stop
  (default 6 h with no recovery: close) and a hard stop (mark ≤ 50% of cost: close). Both are defaults she may tune
  within bounds that only the owner can change.
- **Rate limit**: at most 1 buy intent per 10 min and 4 per hour, enforced in Lumen. The signer's 10/day cap and
  the other caps still apply independently.

### A2. Deposits
An owner CLI command, `expect-deposit <SOL> [ttl]`, is logged in the chain. A matching inbound transfer from the
whitelist address is booked as a deposit, and any other inbound SOL or token still halts. A balance over $25 at mark
always halts buys.

### A3. Daily loss includes moon bags at mark
A moon-bag drawdown alone can reach $6 and halt buys for the rest of the day. That's intended (the conservative
direction). It's shown on the HUD as "halted: daily loss (incl. moon bags)".

### A4. Worst case if Lumen or the HMAC is compromised
An attacker could submit intents within the caps, so **the maximum loss is the wallet: ≤ $25**. Transfers out are
impossible from intents. Mitigations:
- The HMAC key rotates on an owner command.
- It's separate from OWNER_SESSION_SECRET and every other secret.
- The intent rate limit is repeated in the signer: ≤ 4 intents per hour.

### A5. Telegram is HALT-only
The Telegram owner chat can only send HALT. Resume, sell-all, sell-X, whitelist changes, expect-deposit and HMAC
rotation go through the owner CLI only. Before relying on Telegram, rotate the Telegram bot token (the old
LUMEN_TELEGRAM_BOT_TOKEN was exposed in process envs).

### A6. Program allowlist from verified IDs
At build time, verify the current pump.fun bonding-curve program, its mint token program (SPL Token vs Token-2022)
and its migration target (PumpSwap AMM) against the official pump.fun sources and on-chain accounts. Pin those IDs
in a constants file with tests, cite the source and date in a comment, and allow nothing written from memory.

### A7. Sells during a kill
Default: no. Under a kill, only owner sells go through. Under a daily-loss halt, Zoora's sells are allowed.
Final call: Zoorped.

### A8. Vetting signature
The verdict is signed over `mint ‖ rules_version ‖ ts ‖ verdict` with Solana R&R's key. The signer holds only the
public key. The verdict key never lives in Lumen. Interface `vet(mint)` is per Solana R&R's spec.

### A9. Logging
Log the RPC provider by name only, never the URL or key. For every decision, record the oracle values used
(Pyth price, confidence, publish time, and the second-source price).

### A10. The $25 cap is measured at mark (confirmed).

### A11. Hard live gate: route permission (HoR, pump.fun Terms updated 2026-11-16)
- Under §4.2, direct on-chain or third-party use still counts as using pump.fun. Under §6.1, bots are allowed only
  where pump.fun expressly permits them.
- Live use requires one of: an official pump.fun API or program terms that clearly permit automated trading, or
  written permission from pump.fun.
- The signer has two modes, `DRY_RUN | LIVE`, and boots in DRY_RUN. It refuses to enter LIVE unless the owner CLI
  has set `ROUTE_APPROVED` with a permission source (URL or document reference plus its date). That source is
  recorded as an event in the hash chain, and the flag is checked on every intent.
- No scraping and no working around pump.fun's bot protection (the box's 403), ever.
- Full live gate: ROUTE_APPROVED, HoSec GO, HoS GO, acceptance tests 1-10, and Zoorped's final approval in his own words.
- Test 11: with ROUTE_APPROVED missing, LIVE refuses and every intent stays simulation-only, even with a valid key present.

### A12. Vetting integration (Solana R&R vet/1, spec /workspace/solana-meme-risk/docs/VET_GATE_SPEC.md @3875b0f)
- `vet` is Python (`smr.vet`). It runs as a separate local sidecar next to the signer, never inside Lumen, and the
  signer calls it itself. Lumen's candidate feed is only a hint, so Lumen can't forge or replay a verdict.
- Buy only if all of these hold: `schema == vet/1`, `verdict == PASS`, `allow == true`, `config_version ==
  vetcfg-20261117-v6` (pinned), exit code 0, valid JSON, a 50 s hard timeout on the cold call, and `now - evaluated_at
  ≤ 15 s` at send. Otherwise re-vet on the warm path and send only on PASS again. Everything else counts as do-not-buy.
- Order: kill switch and caps first, then vet, then reserve and sign. Sells and exits are never gated by vet.
- Signature (A8): the vet/1 output is unsigned today. While the sidecar is local to the signer, the signer's own call
  is the trust anchor. If vet ever runs as a separate service, it must add an Ed25519 signature over
  `mint‖config_version‖evaluated_at‖verdict`, and the signer must hold only the public key.
- Log mint, verdict, reason codes, config_version and code_version. Never log token name, symbol or URI.
- Known limits shown to the owner: coins over about 33 h old come back UNKNOWN (no buy), free public data sources,
  no proven edge.
- Test 12: a stubbed vet returning UNKNOWN, FAIL, the wrong config_version, a stale evaluated_at, bad JSON,
  exit 3 or a timeout. Each is refused.

### A13. Live host: Zoorped's Windows PC (his words, 2026-11-17 4:44 PM CT). This replaces the Fly signer plan.
- The signer, the vet sidecar (Python) and the owner CLI all run on his PC. The Fly-hosted signer is dropped.
- Key: Zoorped stores it in Windows Credential Manager himself. The signer reads it at sign time through the OS API.
  It isn't in an env var or a file, and it's never logged. The repo only checks that the entry exists.
- No inbound ports on the PC. The signer **pulls** HMAC-signed intents from Lumen over HTTPS (outbound only, like
  the Telegram poller), and posts status and events back. If Lumen is unreachable, no new buys happen and existing
  positions are held.
- Route: Zoorped will supply it. ROUTE_APPROVED stays a hard gate (A11). The RPC provider is his choice, and its key
  goes in Credential Manager.
- Timing with vet: a cold vet takes up to 45 s (50 s timeout). The decision engine pre-vets candidates in the
  background. An intent's lifetime is 90 s. At send, if the verdict is more than 15 s old, the signer re-vets on the
  warm path (p95 0.8 s) and sends only on PASS. The rate limit (1 per 10 min) easily covers vet latency.
- PC sleep, reboot or offline: the signer comes back PAUSED (as in the main design) and reconciles on-chain state
  before the owner resumes.

### A14. Owner answers (2026-11-17, relayed in his own words via Personal Assistant)
- "Build the capped Zoora pump.fun signer, no money until final approval."
- Kill switch: "hold everything until I say sell." Under a kill, Zoora can't sell. Only an owner sell command closes positions.
- Host: "Run it on my Windows PC." (A13)
- RPC: Helius free tier, an account he creates himself. The RPC URL is configurable, read from Credential Manager
  (preferred) or from an env file locked with icacls. It's never in the repo or the logs, and the log shows the
  provider name only.
- Live gate (unchanged): automated limit tests, a no-money dry run, a §6.1-compliant route (ROUTE_APPROVED), HoSec GO,
  HoS GO, and his final approval in his own words.

---
## A15. Windows host preflight (Head of Systems, 2026-11-17)

The preflight runs at boot, on resume from sleep or hibernate, and every 10 minutes. Each failed check fails closed: the signer goes to PAUSED and logs an event. No check prints a secret.

1. It always starts PAUSED after a reboot, a process restart, or a resume from sleep. Resume from sleep is a wall-clock versus monotonic jump of more than 30 seconds, or a power-event hook.
2. Clock sync compares the local clock with at least two independent time sources (for example the HTTPS Date header from the RPC provider and the Lumen feed, plus `w32tm /query /status`). Skew over 2 seconds refuses to sign.
3. Windows Defender or another AV product is active. The check is `Get-MpComputerStatus` (`AMServiceEnabled`, `RealTimeProtectionEnabled`) or a third-party product via SecurityCenter2. If neither is active, refuse.
4. The process runs as a standard user. Refuse if the token is elevated or the user is in Administrators.
5. The ACL on the Credential Manager key and RPC entries, and on the SQLite database and its directory, is owner-only. Everyone, Users, or Authenticated Users access refuses to start.

OS probes sit behind an interface with test doubles. Acceptance tests 13a through 13e cover one check each. `zoora-signer doctor` prints each check as pass or fail and prints no secrets.

Under a kill, hold everything. No automated sells, stops, or time-stops fire during a kill. Only an owner CLI SELL releases a position.

The RPC is the Helius free tier. A client-side limiter and backoff stay under the free tier's documented limits (10 RPC requests/second, 5 `getProgramAccounts`/second, 1,000,000 credits/month; https://www.helius.dev/docs/billing/rate-limits and https://www.helius.dev/docs/billing/plans, read 2026-11-17). This build stays at 8 RPC requests/second and does not submit transactions. A 429 or quota error is UNKNOWN, which means no new buys. The log records the provider name only.

Confirmed: an intent's TTL is 90 seconds, a verdict older than 15 seconds triggers a warm re-vet, and an unreachable intent feed produces no new buys.

## A16. Implementation language (owner decision, 2026-11-17)

The signer in `projects/zoora-signer` is Python 3.11 or newer, not Node or TypeScript. It is the package that runs on the owner's Windows PC. There is no parallel TypeScript implementation.

## H3 / L1 / L2 builders (code only, 2026-11-18)

The unsigned builders are in this build. `RefuseBroadcaster` is still the only broadcaster. Boot stays `DRY_RUN` and `PAUSED`. The sign step is refused before any key is read, and nothing in this process submits a transaction.

The current bonding-curve trades in `idl/pump.json` at docs commit `639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22` are `buy_v3` and `sell_v3` (17 accounts). `TRADE_V3.md` is the current interface; `buy_v2` and `sell_v2` remain in the IDL but are not what the builder emits. v3 keeps protocol and creator fees on the curve, so the creator vault is not an account. The fee config and the user volume accumulator are. PumpSwap's current trades are `buy_v2` and `sell_v2` from `idl/pump_amm.json`, also 17 accounts.

The builder requirements are:

- Account lists follow those IDL instructions, in order, with the signer and writable flags.
- A buy computes `token_out` from the live curve or pool, and sets `max_sol_cost = quote × (1 + slippage)`. Slippage is capped at 1500 bps.
- A sell sets `min_sol_output = quote × (1 − slippage)`.
- Mint decimals come from the mint account. Token-2022 and SPL Token choose the token program.
- Fees are read from the on-chain fee config. The recorded schedule is 95 bps protocol plus 30 bps creator. A missing or zero schedule fails closed.
- ATA rent is the live rent-exempt minimum supplied by the caller. The recorded Token-2022 figure is 1,513,840 lamports, included only when the ATA is created.
- `SetComputeUnitPrice` is micro-lamports per compute unit. That priority fee, the signature fee, and the rent are inside the cost.
- The $2 all-in cap includes the quote after slippage, both fees, ATA rent when created, and the network and priority fees. The lamport budget rounds down so the USD value cannot exceed $2.000000. A trade that does not fit is refused.

The on-chain Pyth SOL/USD account must be a `PriceUpdateV2` with verification level Full. A publish time older than 30 seconds fails closed. On 2026-11-17 that account was older than 30 seconds in 12 of 30 samples, and the oldest sample was 54.7 seconds. The threshold stays 30 seconds. A Pyth pull update or a sponsored feed is what keeps the account fresh enough to use.

Stack: stdlib `sqlite3` in WAL mode with `BEGIN IMMEDIATE`; `keyring` (Windows Credential Manager) behind an interface, plus a test double; `solders` and `httpx` for transactions, simulation, the outbound intent pull, and the on-chain Pyth price account; pytest and hypothesis; argparse for the owner CLI. Windows probes go through PowerShell or ctypes behind interfaces. The vet gate shells out to `sys.executable -I -m smr.vet`. Lumen is unchanged: A1 stays a spec in this project until a later PR.
