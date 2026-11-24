# In-house Signal → Python Executor Design (Solana / experiment100), rev 2

**Audience:** Head of Systems & Trading Operations → Zoorped
**Author:** Solana Research & Risk Analyst
**Date:** 2026-11-09 (America/Chicago). Rev 2 folds in Zoorped's answers relayed by Head of Systems at 9:56 PM and 9:58 PM CST.
**Supersedes:** `docs/LIVE_SETUP_CHECKLIST.md` (vendor stack rejected by Zoorped, 2026-11-09 9:46 PM CST)
**Status:** RESEARCH AND DESIGN ONLY. Nothing is funded. No wallet, keypair, keystore, signer, RPC account, SSH key or API key was created, and nothing was installed, signed or sent. `solana_meme` stays **locked to no trading** in agent-guard (`config/limits.json`: `enabled=false`, all limits 0).
**Limits:** every dollar figure here is **PROPOSED, PENDING ZOORPED'S EXPLICIT CONFIRMATION**. Head of Systems is treating $1 per trade, 5 open positions and the $10 daily loss as approved unless Zoorped objects. That is not his own explicit confirmation, so **live stays blocked**: in the executor, `OwnerConfig.limits_confirmed_by_owner=false` means live mode refuses to act.

> Zoorped's direction (verbatim): "I don't approve that. We will have our own systems. Even if grok is the researcher or however it plays out it will send it to a python execution and it will buy when says buy and sell when it says sell."

### Owner decisions recorded in rev 2 (2026-11-09)

| # | Decision | Where it lands |
|---|---|---|
| 1 | The executor runs on **Zoorped's Windows PC** | §4 Windows deployment |
| 2 | Key is held in an **encrypted keystore, unlocked by a passphrase typed at start** | §5 |
| 3 | **Fully automated.** No manual approval of first-N fills anywhere | §6 (removed), §7 safeguards hardened |
| 4 | Paper uses the **same $30k market-cap floor** as live | §6; applied to experiment100 paper (`mcap_floor30k_20261109-v1`) |
| 5 | **Free public RPC only** | §4.5 |
| + | Hot wallet holds at most **30% of his funded deposit**. The other 70% stays in his separate vault, which the executor never touches ("Let's just say 30% of the deposit in the account.") | §6 float cap |
| 6, 7 | StalkChain credits and 48 h auto-exit vs alert are **unanswered** | §11 (the design defaults to 48 h auto-exit, PROPOSED) |

Rejected and removed: Turnkey, Helius paid tiers, vendor signing services, PumpPortal, paid/free-tier vendor RPC accounts, and the monthly vendor cost plan.

---

## 1. Architecture

```
 SHARED BOT BOX (Linux, untrusted for keys)          ZOORPED'S WINDOWS PC
 ┌──────────────────────────────────┐               ┌───────────────────────────────────────────────────┐
 │ Grok / agents / smr risk pipeline│               │ Windows local user: solexec  (standard, non-admin)│
 │  research + decision only        │  OpenSSH pull │                                                   │
 │        ▼                         │  forced, read │ fetcher ─► validator ─► kill/halt ─► breaker ─►   │
 │ smr signal emitter (deterministic)◄──────────────┤ caps (float 30%, $30k floor, UNKNOWN exposure) ─► │
 │  outbox.jsonl (HMAC-tagged)      │   only        │ venue resolve ─► build ─► simulate ─► inspect ─►  │
 │  NO key / signer / send / wallet │               │ signer (key in RAM only) ─► public RPC send ─►    │
 │                                  │               │ confirm/UNKNOWN resolver ─► LIVE ledger           │
 │ PAPER ledger (separate)          │◄─ redacted ───│ C:\ProgramData\solexec\  (NTFS ACL: solexec only) │
 └──────────────────────────────────┘   reports     └───────────────────────────────────────────────────┘
        HOT burner wallet ≤ 30% of deposit (executor signs)   │   VAULT wallet ≥ 70% (executor has no key)
```

- The **decision layer** can only emit signals. It has no key, no signer, no send path, and no route into the PC.
- The **executor** is plain Python owned by Zoorped and run on his PC. It buys on a valid BUY and sells on a valid SELL, fully automatically, inside hard limits the LLM cannot change.
- **Owner/bot separation:** bots never fund, create wallets, generate or hold keys, sign, or buy. Zoorped does all funding, key creation, sweeping between hot wallet and vault, limit confirmation, and go-live switching.

---

## 2. Signal contract (schema `smr.signal/1`)

The machine-readable schema is `executor_design/signal_schema.json`, with its validator in `executor_design/signal.py`.

All fields are **untrusted**, and the executor re-validates every one.

| Field | Rule | Notes |
|---|---|---|
| `schema` | const `"smr.signal/1"` | Unknown versions are rejected. |
| `signal_id` | UUIDv4 | Idempotency key; a duplicate is rejected. |
| `nonce` | 32 hex characters | Replay protection. |
| `created_at_ms`, `expires_at_ms` | int epoch ms | TTL caps: BUY ≤ 30 s, SELL ≤ 120 s. Future skew up to 5 s is allowed. Expired signals are rejected (stale-signal check). |
| `book` | `experiment100` | |
| `mint` | base58 that decodes to 32 bytes | Re-checked against deny and allow lists. |
| `side` | `BUY` \| `SELL` | |
| `size` | BUY: exactly one of `usd`/`sol` > 0. SELL: `fraction_bps` 1–10000 of the held position | The executor clamps down and never up. |
| `max_slippage_bps` | 1–5000 | The executor uses the minimum of this and its own cap. |
| `venue_hint` | `auto`\|`pump_curve`\|`pumpswap`\|`jupiter` | Advisory only. |
| `risk` | `{score, decision, mayhem, quality}` | A BUY needs `decision≠SKIP`, `mayhem==false` and `quality==CLEAR`. |
| `observed` | optional `{mcap_usd, liq_usd, price_usd}` | Advisory. Hard gates use the executor's own reads. |
| `reason` | ≤ 200 chars, strict charset | Logged and never interpreted. It is also scanned with agent-guard `detect_injection`. |
| `source_agent` | allowlist (`smr_experiment100`) | |
| `tag` | HMAC-SHA256 over the canonical JSON | Authenticates transport only (see §3). |

Validation order is: 4 KB line cap → JSON parse (NaN rejected) → no unknown keys → types and ranges → base58 → TTL and skew → HMAC (constant time) → replay store → injection scan. Failures are rejected and logged, and the executor never repairs a signal.

---

## 3. Transport: pull-only over OpenSSH from Windows

1. **On the bot box**, only the deterministic `smr` emitter appends canonical JSON lines to `data/signals/outbox.jsonl`, and it writes a heartbeat line every 60 s.
2. **On the PC**, the `solexec` user runs the built-in **Windows OpenSSH client** (`C:\Windows\System32\OpenSSH\ssh.exe`, an optional Windows feature). It uses a dedicated **transport** key at `C:\Users\solexec\.ssh\id_ed25519_signals`. This key is not a funds key, and its ACL limits it to `solexec`. The box's host key is pinned in `C:\Users\solexec\.ssh\known_hosts` with `StrictHostKeyChecking yes`.
3. **On the box**, `authorized_keys` pins that key to a read-only forced command:
   `restrict,command="/workspace/solana-meme-risk/tools/outbox_read.sh" ssh-ed25519 AAAA… solexec-signals`
   `restrict` disables PTY, port, agent and X11 forwarding. The script ignores client arguments except a validated byte offset taken from `SSH_ORIGINAL_COMMAND`, prints `outbox.jsonl` from that offset, and exits. It cannot write or run anything else.
4. The direction is **PC → box only**. The box has no credentials for the PC, and the PC opens no inbound port.
5. The executor stores its byte offset and replay DB under `C:\ProgramData\solexec\state\`. Results go back to the box as a **redacted** daily report through a second forced command that only appends to `data/signals/executor_reports.jsonl`. That report contains no key material, no keystore path and no passphrase hints.

**HMAC limits:** every agent on the box shares Unix user `box`, so the tag proves only that a signal *came from the box*. The executor's caps, float cap, circuit breaker and kill switch are what contain a forged or bad signal.

**Feasibility caveat:** this needs inbound SSH reachability to the bot box from his PC. If the box can't accept SSH, see open question Q6.

---

## 4. Executor on Windows

### 4.1 Account and permissions

- **Executor user:** a dedicated **standard (non-admin) local user `solexec`**, created by Zoorped (`net user solexec * /add`). It must not be in Administrators, must not sync to a Microsoft account, and has no RDP rights.
- **Zoorped's daily account** should ideally also be a standard user. Any Administrator, or malware running as admin, can take ownership of any file, so ACLs protect against other users and the bot side, not against a compromised admin.
- **BitLocker on the system drive (recommended):** it protects the keystore at rest, and also the pagefile and `hiberfil.sys`, where in-memory key pages could otherwise land. Hibernation can be disabled with `powercfg /h off`.
- **Crash dumps:** disable Windows Error Reporting LocalDumps for `python.exe` / `solexec.exe` so a crash cannot write process memory to disk.

### 4.2 Paths and NTFS ACLs

| Path | Contents | ACL (after `icacls <dir> /inheritance:r`) |
|---|---|---|
| `C:\Program Files\solexec\` | Executor code with a pinned venv and pinned IDLs (by commit hash) | Administrators/SYSTEM full; `solexec` read+execute (it cannot modify its own code) |
| `C:\ProgramData\solexec\config\` | `owner.json` (deposit basis, mode, `limits_confirmed_by_owner`), `caps.json`, `breaker.json` cfg | Administrators/SYSTEM full; **Zoorped modify**; `solexec` **read only** (the executor cannot raise its own limits) |
| `C:\ProgramData\solexec\keystore\` | `hot.keystore.json` (encrypted, §5) | Administrators/SYSTEM full; **`solexec` read only**; nobody else |
| `C:\ProgramData\solexec\state\` | Offset, replay DB, pending-tx WAL, breaker state, positions | `solexec` modify; Zoorped read |
| `C:\ProgramData\solexec\ledger\` | `live_fills.jsonl` (label LIVE), shadow/dry-run records | `solexec` modify; Zoorped read |
| `C:\ProgramData\solexec\logs\` | Rotating redacted logs, `executor.log` (10 MB × 10) | `solexec` modify; Zoorped read |
| `C:\ProgramData\solexec\control\` | `KILL`, `HALT_BUYS` flag files | Zoorped modify; `solexec` read (the executor can't clear its own kill) |

Example (keystore): `icacls C:\ProgramData\solexec\keystore /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" "solexec:(OI)(CI)R"`

**Logs:** structured JSON lines in `C:\ProgramData\solexec\logs\`, plus redacted summary events (start, trip, kill, fill, UNKNOWN) in the **Windows Event Log → Application**, source `solexec`. Every handler goes through one redaction filter (§5.4) before writing, and tracebacks are redacted too.

### 4.3 How it runs: passphrase at start, no human per trade

Passphrase entry at start rules out a plain auto-start service, because a service has no console. There are two workable shapes:

- **A. Recommended: Windows service, started locked, plus an unlock CLI.**
  1. The executor runs as a Windows service (pywin32 or NSSM) under `solexec`, with delayed auto start.
  2. It boots **LOCKED**: it fetches and validates signals and keeps logging and monitoring, but it cannot sign.
  3. Zoorped runs `solexec unlock` in his own console. The prompt uses `getpass`, so there is no echo, no argument and no env var.
  4. The passphrase travels over a local **named pipe** whose ACL allows only Zoorped's account to write and only `solexec` to read. The service derives the key in memory, then wipes the pipe buffer.
  5. After a reboot it stays locked until he unlocks again. That is fail-safe for BUYs, but open positions are unmanaged while it is locked (see Q7).
- **B. Simpler: a Task Scheduler task "Run only when user is logged on" under `solexec`,** or `runas /user:solexec "C:\Program Files\solexec\solexec.exe run"`. A console window prompts for the passphrase, and closing the window stops trading.

**Kill-switch commands and hotkey** (all run from Zoorped's account and simply write the control files, so they work even if the executor is hung):
- `solexec kill` creates `control\KILL`, a **TOTAL** stop: no BUY, no SELL, no signing.
- `solexec halt-buys` creates `control\HALT_BUYS`. New BUYs stop and SELLs continue.
- `solexec resume --confirm RESUME` removes both. Only Zoorped's account can do this, because `solexec` has read-only access to `control\`.
- A desktop shortcut to `solexec kill` with Windows **Shortcut key Ctrl+Alt+K** gives a one-keystroke total kill. An optional second shortcut, Ctrl+Alt+H, runs halt-buys.
- `SOLEXEC_KILL=1` in the service environment is a hard kill at boot.
- The executor checks the flags before build **and** again immediately before every send.

### 4.4 Pipeline per signal

`fetch → validate (§2) → total kill? → mode/limits gate → clock-skew check → [SELL path] or [BUY: halt? → breaker? → UNKNOWN for mint? → heartbeat → float cap 30% → mint rules → caps] → resolve venue → build → simulate → inspect → kill re-check → write-ahead pending record (UNKNOWN) → sign → send → confirm/resolve → ledger + reconcile`

### 4.5 Venues and builders (mechanical)

| On-chain state | Venue | Builder |
|---|---|---|
| Curve not `complete` | pump.fun bonding curve (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`) | `buy`/`sell` from the official IDL in `github.com/pump-fun/pump-public-docs`, built in Python with `solders` + `solana-py`. A test byte-compares the result with the official TS SDK `@pump-fun/pump-sdk` 4.1.0 (Rust: `pump-rust-client` 0.4.1). |
| Migrated | PumpSwap (`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`) | Official IDL; `@pump-fun/pump-swap-sdk` 2.1.0 is the reference. The PyPI `pumpswap-python-sdk` has unverified provenance and is not trusted by default. |
| Fallback | Jupiter Swap API v2 **`/build`**, keyless (0.5 RPS, no account, no Jupiter swap fee) | Assembled, simulated, signed and sent by us. `/order`+`/execute` is never used. |

Program IDs and IDLs must be re-verified and pinned by commit before any pilot.

### 4.6 RPC: free public RPC only (owner decision)

- Endpoint: `https://api.mainnet.solana.com`, used for reads, blockhash, `simulateTransaction`, `sendTransaction` and status polling. There is no vendor RPC account, free or paid.
- **Documented limits (per IP):** 100 requests per 10 s; 40 per 10 s for a single method; 40 concurrent connections; 40 connection opens per 10 s; 100 MB per 30 s. Solana describes the endpoint as "not intended for production", and it may return **429** (honor `Retry-After`) or **403** (IP blocked) without notice.
- **What this means:**
  - It is fine for a few low-frequency trades (about 10–20 calls per trade), and the executor keeps a global token bucket at ≤ 50 % of the limit.
  - It is **not staked**, so sends land less reliably in congestion. Expect more expired or failed transactions; the UNKNOWN handling in §7.3 exists for exactly this.
  - There are no indexed holder reads, so discovery and quality checks stay on the bot box.
  - Every 30 s it probes `getHealth`, `getSlot` and blockhash freshness. Failures feed the circuit breaker.
- **Sends:** `sendTransaction` with `maxRetries=0` and `skipPreflight=false`, after our own simulation. The executor may **rebroadcast the identical signed bytes** until the blockhash expires. That is idempotent: same signature, at most one execution. It **never re-signs or rebuilds** an intent whose outcome is UNKNOWN.
- Priority fee: `getRecentPrioritizationFees` for the accounts touched, clamped to the cap.
- **Jito is off.** Its Block Engine is free and needs no account, but it is not the public RPC. It can be added later only if Zoorped asks.

### 4.7 Unavoidable costs

- 5,000 lamports base fee per signature
- An optional, capped priority fee
- About 0.002 SOL rent per new token account, refundable when the ATA is closed after a full exit
- Pump/PumpSwap protocol fees, read on-chain at build time (the prior checklist modeled about 100 bps on the curve)
- Failed transactions still pay base and priority fees, which the paper model doesn't include yet

There are no subscriptions.

---

## 5. Key custody: encrypted keystore, passphrase at start

**Hard rules:** the key never appears in chat, logs, LLM context, the repo, the store or the bot box, and is never written to disk decrypted. Bots never generate, import, back up or see it. Zoorped creates the **hot** keypair himself on the PC, offline if he likes, and writes the seed on paper for backup. The **vault** wallet's key never touches the PC.

### 5.1 Options considered

| Option | How | Pros | Cons |
|---|---|---|---|
| **K1. Argon2id + AES-256-GCM keystore file** | JSON file `{v, kdf:"argon2id", m:256MiB, t:3, p:4, salt, nonce, ct, pubkey}`. `cryptography` provides AES-GCM and `argon2-cffi` provides Argon2id. | Memory-hard KDF that resists GPU brute force; portable; no extra binary; easy to audit | Two pinned dependencies |
| K1-alt. scrypt + AES-256-GCM | Same format with `hashlib.scrypt` (stdlib, N=2^17, r=8, p=1) | Stdlib KDF | Slightly weaker than Argon2id per memory cost |
| K2. `age` passphrase file | age uses scrypt internally; `age.exe`/`rage` or `pyrage` on Windows | Well-reviewed format | Extra binary or bindings; decrypting through a CLI risks a plaintext temp file or pipe |
| **K3. DPAPI wrap (optional outer layer)** | `CryptProtectData` (user scope, `solexec`) around the K1 file | A stolen copy of the file is useless off this PC or this user's profile, so offline passphrase guessing requires breaching the account first | **Unrecoverable** if the Windows profile, password reset or machine is lost, so the paper seed backup becomes mandatory. It adds nothing against malware already running as `solexec`, since that malware could call CryptUnprotectData, but the passphrase is still required |

### 5.2 Recommendation

Use **K1 (Argon2id + AES-256-GCM) wrapped with K3 (DPAPI, `solexec` user scope)**, with the passphrase typed at start through `solexec unlock`. The hot seed is kept on paper offline as the recovery path for when DPAPI is lost. If Zoorped prefers no DPAPI dependency, use K1 alone; it is still strong with a long passphrase of at least 5 random words.

### 5.3 In-memory handling

- The key is derived into a `bytearray`, the passphrase buffer is overwritten, and only a `solders.Keypair` handle is kept. Python cannot guarantee zeroization, so BitLocker, disabled crash dumps and no hibernation cover the swap and dump paths.
- The key is never pickled, logged, put in exceptions, or passed to subprocesses.
- Sign is only called on messages the inspector (§6.3) approved.
- Lock and wipe on `solexec lock`, on service stop, or on a total kill.

### 5.4 Log redaction

A single filter on every handler and on the Event Log writer drops or masks:
- base58 strings ≥ 80 characters, which catches 64-byte secret keys
- JSON arrays of 64 integers (keypair byte arrays)
- 12- or 24-word BIP39-like sequences
- any value of env or config keys matching `*KEY*|*SECRET*|*PASS*|*SEED*`
- the keystore path

Pubkeys and signatures are allowed. This mirrors agent-guard `redact.py`.

---

## 6. Hard caps (enforced inside the executor; the LLM cannot change them)

The reference implementation is `executor_design/caps.py`. Config is owner-editable on the PC and read-only to `solexec`.

**Status of every number: PROPOSED, PENDING ZOORPED'S EXPLICIT CONFIRMATION.** Head of Systems treats the first three as approved unless he objects, but live stays blocked until `limits_confirmed_by_owner=true` is set by Zoorped.

| Control | Value | Notes |
|---|---|---|
| Per-trade max | **$1**, proposed and pending Zoorped's explicit confirmation | Clamped down, never up |
| Max open positions | **5**, proposed and pending Zoorped's explicit confirmation | UNKNOWN BUYs count (§7.3) |
| Daily loss stop | **$10** realized + unrealized per CT day, proposed and pending Zoorped's explicit confirmation | Halts BUYs until the next CT day; SELLs continue |
| **Float cap** | **Hot wallet ≤ 30 % of `deposit_basis_usd`**. Owner decision, 9:58 PM CST | `deposit_basis_usd` is an **owner-set** value in `owner.json`, because the executor cannot know what he deposited. If it is unset, no BUYs. If hot-wallet value (SOL + marked positions) exceeds 30 %, new BUYs are blocked and an alert says "owner should sweep to vault". The executor **never moves funds**; it has no key for the vault and no transfer function. SELLs continue. |
| Max open notional | $5, proposed | |
| Entry rate | ≤ 3 per 5 min, ≤ 20 per day, proposed | |
| Slippage caps | BUY 1,000 bps, SELL 2,500 bps, proposed | |
| Priority-fee cap | 100,000 lamports per tx, proposed | |
| Market-cap floor | **≥ $30,000**, read executor-side (curve reserves × SOL price) | **Paper uses the same floor** (experiment100 `mcap_floor30k_20261109-v1`) |
| Mint rules | Deny/allow lists; Mayhem → skip, with unknown treated as Mayhem; `risk.decision≠SKIP`; `quality==CLEAR` | |
| Rebuy cooldown | 10 min after a SELL of the same mint, proposed | |
| Producer heartbeat | None for 15 min → new BUYs halted | |
| Stale signal and clock skew | Signal TTL (§2), plus local clock vs chain block time within **10 s**; otherwise no action | Windows time sync should be on (`w32tm /resync`) |
| Simulate before send | Mandatory; no bypass flag exists | |
| **Manual approval of first N fills** | **REMOVED** (owner decision 3: fully automated) | |
| Live gate | `mode=live` requires `limits_confirmed_by_owner=true` | Set only by Zoorped |
| Max hold | **48 h → automatic exit (PROPOSED default; Q7 unanswered)** | Exit is a normal SELL through all checks |

**SELL policy:** SELLs are allowed during a BUY halt, a circuit-breaker trip, the daily loss stop, a float-over-cap state and a stale heartbeat. They are stopped only by a **total kill**, or by an UNKNOWN outcome on the same mint (reconcile first).

### 6.3 Transaction inspector (independent of the builder)

The inspector rejects a transaction unless all of the following hold:
- The fee payer and only signer is the hot pubkey.
- Every program is on the allowlist: ComputeBudget, System, ATA, SPL Token/Token-2022, pump, PumpSwap, the pump fee program(s) from the pinned IDL, and Jupiter v6 for Jupiter routes only.
- There are no System transfers except rent and protocol paths the IDL expects.
- There is no `SetAuthority`, no close-to-foreign address, no token transfer out of the hot wallet except into the swap vaults, and no durable nonce.

---

## 7. Automatic safeguards (no human in the loop)

### 7.1 Circuit breaker (`executor_design/breaker.py`)

The breaker trips on any of the following, all **PROPOSED** thresholds:
- **4 consecutive losing closed trades**
- **3 consecutive execution errors** (send failures, simulation failures and inspector rejections)
- **Drawdown ≥ 20 % of the deposit basis** from the equity peak
- **3 consecutive RPC health failures**
- A missing deposit basis

A trip **halts new BUYs only**; SELLs continue. It is **sticky**: recovery events do not clear it, it persists across restarts in `state\breaker.json`, and only a **manual owner reset** clears it (`solexec breaker reset --confirm RESET` from Zoorped's account). The breaker trip, the daily loss stop and the float-over-cap state each raise an Event Log entry and an alert line in the redacted report.

### 7.2 Kill switch

The kill switch has two levels (§4.3):
- **TOTAL** (`KILL`, Ctrl+Alt+K, `SOLEXEC_KILL=1`) stops everything, including SELLs.
- **HALT_BUYS** stops entries only.

Both are checked before build and right before send. Clearing either requires Zoorped.

### 7.3 UNKNOWN outcomes (`executor_design/outcomes.py`)

- **Write-ahead:** before send, a pending record `{signature, signal_id, mint, side, max_exposure_usd, lastValidBlockHeight, status: UNKNOWN}` is written to `state\pending.jsonl`.
- While UNKNOWN, a BUY counts as an **open position at max exposure** (at least the per-trade max) toward the open-position and notional caps. No new BUY *or* SELL of that mint is allowed until it is resolved.
- **Resolution** is by signature status **and** the hot wallet's SOL/token balance deltas:
  - `confirmed`/`finalized` + balances agree → CONFIRMED
  - `failed` + no balance change → FAILED
  - Not found **and** block height > `lastValidBlockHeight` (blockhash expired) **and** no balance change → EXPIRED_NOT_LANDED
  - Anything else (processed only, unreadable state, mismatch) → stays UNKNOWN and alerts
- **Never blindly resent:** identical signed bytes may be rebroadcast only until blockhash expiry. Rebuilding or re-signing is allowed only after FAILED or EXPIRED_NOT_LANDED, and even then only on a **new** valid signal, because the old `signal_id`/nonce is consumed.
- On startup, all UNKNOWN records are reconciled before any BUY is processed.

---

## 8. Ledgers and reconciliation

- **Paper ledger:** on the bot box (`data/experiment100/…`), labeled `PAPER`.
- **Live ledger:** on the PC (`C:\ProgramData\solexec\ledger\live_fills.jsonl`), labeled `LIVE`.
- Shadow and dry-run records are labeled `SHADOW` and `DRYRUN`. There is no shared writer between books.
- **Join per signal_id:** paper fill vs on-chain outcome (signature, SOL in/out from `getTransaction` pre/post balances, priority fee, rent, failed attempts, UNKNOWN durations).
- **Daily redacted report** covers fill rate, slippage vs model, fee drag vs `ff20261105-v1`, failed/expired transactions, cap and breaker rejections, the paper vs live PnL gap, and a balance-drift alarm when the gap exceeds $0.10.
- **Public posting rule:** only LIVE, on-chain-verified figures may go public. Paper, shadow and dry-run results stay labeled and internal.

---

## 9. Go-live sequence (each step gated by Zoorped; fully automated within limits)

| Phase | What happens | Key? | Exit criteria |
|---|---|---|---|
| 0. Shadow | Real signals → validate, caps, breaker, venue, build → log "would do X" | No | ≥ 7 days, schema error rate 0 |
| 1a. Devnet | Builders against pump/PumpSwap devnet, with a throwaway devnet key that Zoorped makes on the PC | Devnet only | Byte-match vs the official TS SDK |
| 1b. Mainnet dry-run | `simulateTransaction` (`sigVerify=false`) for the hot **pubkey**; UNKNOWN/breaker paths exercised with fault injection | No | ≥ 100 simulations, 0 inspector violations |
| 1c. Sign-no-send | Unlock, sign, verify, discard; redaction audit of all logs and Event Log | Yes (PC) | Clean audit |
| 2. Tiny live pilot | Only after Zoorped **explicitly confirms limits** (sets `limits_confirmed_by_owner`), sets `deposit_basis_usd`, and **funds the hot wallet himself** with ≤ 30 % of the deposit | Yes | Reconciled fills; breaker never bypassed |

agent-guard `solana_meme` stays `enabled=false` through phases 0–1. Unlocking it is an owner action.

---

## 10. Design artifacts (no signing, no RPC, no keys)

All under `executor_design/`:
- `signal_schema.json`, `signal.py`: schema and validator
- `caps.py`: hard caps, float cap (30 % of the owner-set deposit), live gate, total kill vs BUY halt, clock skew, UNKNOWN exposure; no manual-approval mode
- `breaker.py`: circuit breaker with sticky trips and manual owner reset
- `outcomes.py`: UNKNOWN resolution by status + balances + blockhash expiry; no resend
- `signer_interface.py`: a `Signer` stub that refuses to sign
- `tests/`: `python -m pytest executor_design/tests -q`

---

## 11. Open questions for Zoorped

**Answered (rev 2):** machine (Windows PC); keystore with passphrase; fully automated; $30k floor for paper and live; free public RPC only; 30 % float of deposit.

Still open:
1. **(Q6 from rev 1) StalkChain credits.** Live BUYs require `quality==CLEAR`, and StalkChain is out of credits, so nothing can pass. Restore credits (owner purchase), or choose another quality source?
2. **(Q7 from rev 1) 48 h max hold.** Auto-exit (the current PROPOSED default) or alert only? Related: after a reboot the service stays locked until he unlocks it. Is it acceptable that positions are unmanaged while it is locked?
3. **Explicit limit confirmation.** Does he personally confirm $1 per trade, 5 open positions and the $10 daily loss? Head of Systems' "approved unless he objects" is not his own confirmation. Also the other proposed numbers: $5 open notional, 3/5 min and 20/day, slippage 1,000/2,500 bps, priority-fee cap, and breaker thresholds 4 losses / 3 errors / 20 % drawdown / 3 RPC failures.
4. **Deposit basis.** What `deposit_basis_usd` will he set, and should it be in USD or SOL (SOL avoids price drift in the 30 % check)?
5. **Run shape.** Service + `solexec unlock` (recommended) or a console task? DPAPI wrap yes or no?
6. **Transport reachability.** Can his PC reach the bot box over SSH? If not, which pull channel does he want? Whatever he picks must stay read-only, PC-initiated and free.
