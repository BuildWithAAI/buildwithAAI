# Security review: PR #92 "capped Zoora signer" @ 06adef09e2c90113af54324511f0cafcd5d088a9

Reviewed 2026-11-17 ~5:30 PM CT by Head of Security (Grok Bot executor). Read-only on the repo and remote. Fake throwaway values only; no keys, HMAC secrets or RPC URLs were requested, read or printed; no RPC, wallet or pump.fun calls.

## Verdict
- **Code at this SHA, no-money DRY_RUN: GO.** Nothing in this build can broadcast or move funds. That rests on four things. There is no real Solana transaction encoder. `RefuseBroadcaster.enabled=False` returns before signing. The RPC client denies every method outside a read-only allowlist. And the shipped CLI has no daemon loop, a hard-down oracle, and a preflight that cannot pass. The caps held under 8-process races.
- **Live or any money: NO-GO.** The kill switch, instruction allowlist, Telegram, tx builders and preflight below are not live-grade.
- **Policy: needs Zoorped.** This is an autonomous pump.fun meme-token buy/sell executor (see the purpose section). It conflicts with the earlier "Solana meme lane: no trading" lock and with the hard-no "no meme trading" item, unless Zoorped's relayed A14 words supersede them. Security can't make that call.

## CI (GitHub API, unauthenticated)
Run 44199055819 "Zoora signer": head_sha 06adef09e2c90113af54324511f0cafcd5d088a9, event pull_request, branch cursor/zoora-signer, status completed, conclusion success, attempt 1. Started 2026-11-17 5:24 PM CT and finished 5:25 PM CT. Jobs: test (ubuntu-latest) success, test (windows-latest) success, package success, validator (optional) success. PR #92 is a draft, open, with 50 files, +6537/-0, base main 73afd9d.

## Purpose (exact quotes, projects/zoora-signer/docs/DESIGN.md)
- L1: "# Zoora capped pump.fun executor: design (draft 1, 2026-11-17)"
- L24: "Zoora's engine sends `{intent_id (uuid, idempotent), side: buy|sell, mint, usd_stake | token_amount, max_slippage_bps, vetting_verdict}`"
- L47: "| No leverage or transfers | Only buy and sell instructions. A SOL transfer is allowed only to the owner whitelist address, only through an owner command, and never from an intent. |"
- L119: "- **Pick**: Zoora picks from candidates with her own reasoning. Every pick carries a one-line public rationale for the log"
- L121: "- **Exits**: stake recovery comes first. Once a position's sell value is at least 2× cost, she sells enough to recover"
- L171: "- Live use requires one of: an official pump.fun API or program terms that clearly permit automated trading, or"
- L212: "- \"Build the capped Zoora pump.fun signer, no money until final approval.\"" (A14, relayed via Personal Assistant)

Answer: **yes. Once live, it buys and sells pump.fun meme tokens chosen by Zoora**, at $2 a trade, with up to 3 open trades, 10 buys a day and a $25 wallet. The signing key sits on Zoorped's PC (Credential Manager), not in Lumen/Zoora, so "Zoora never holds keys" is arguably kept. "No meme trading" is not. README.md L3 ("This package does not trade") and the pyproject description describe only this build, not the purpose.

## Findings (ranked; severity is for live readiness, and none can move funds at this SHA)

### High
- **H1. A kill is not durable. Any CLI command, including `status`, clears it, and `resume` clears every halt.** signer.py:128-136: `boot()` sets `activity='PAUSED', halt_reason=NULL` on every open, and every CLI command calls `Signer.open` (cli.py:123,127). Probe: `halt` → HALTED; `status` → PAUSED, halt_reason NULL. signer.py:258-283: `resume` clears any HALTED except `agent_guard*`, including `unexpected_sol`, `reconcile_unknown`, `LEDGER_BREACH`, `secret_in_log` and `owner` (probe: unexpected_sol → RESUMED/ACTIVE). An owner SELL does not clear a kill. "Hold everything until the owner SELLs" really means "until any process running as that Windows user runs any command, then `resume`".
  Fix: persist HALTED across boot. Only an explicit owner `unhalt --reason <code>` with a typed confirmation clears it, and it is refused for `unexpected_sol`/`reconcile_unknown`/`LEDGER_BREACH` until reconciliation passes. Read-only commands must not run `boot()`'s writes.
- **H2. The instruction allowlist works only at the program level.** txbuild.py:30-41. Probe: all of these PASS `assert_allowlisted`: SPL/Token-2022 Approve(4), SetAuthority(6), CloseAccount(9) to a foreign address, Transfer(3); System CreateAccount(0) funding a foreign key, Assign(1), TransferWithSeed(11); arbitrary Pump, PumpSwap and ATA data; 10 Pump instructions in one tx. Only System Transfer(2) to a non-whitelisted address and Metaplex are rejected. There is no transaction model: no account metas, signer/writable flags, fee payer check, v0 message or address-lookup-table handling. It is unreachable today, because the builders are fixed and intents carry no instructions, but it is the stated safety net.
  Fix: decode a real `solders` Message/VersionedMessage. Reject ALTs (or resolve and pin them). Allow exactly [ComputeBudget×≤2, optional ATA create-idempotent for payer/mint, one Pump buy_v2 or sell_v2 with the IDL account list checked]. Reject every Token or System instruction except whitelisted owner sweeps.
- **H3. The tx builders are placeholders, so the stated money bounds don't exist yet.** signer.py:665: `token_out=1_000_000` is hardcoded, so `min_tokens` (the slippage bound) isn't derived from the curve. The sell path (signer.py:757-848) builds no instruction and enforces no `min_sol`. The Pump instruction has 2 accounts (txbuild.py:66-69). `Services.fee_lamports=0` and `ata_rent_lamports=0` by default (signer.py:82-83), so the "$2 all-in" excludes fees. The CU price is passed lamports as micro-lamports/CU (txbuild.py:92-98). The fill books `tokens=1_000_000` with no mint-decimals handling.
- **H4. Telegram "HALT-only" and the agent-guard kill aren't implemented.** signer.py:291-295 is a text filter only. There is no bot, no `chat.id`/`from.id` owner check, no rejection of `forward_origin`/forwarded or channel messages, and no replay or update_id handling. cli.py:47-49 `_ClearKill` always returns "clear", which violates "unreachable killswitch counts as killed" (DESIGN L62).

### Medium
- **M1. The HMAC key isn't validated on read, and rotation changes the key.** secrets.py:73-78 and signer.py:1185-1190 accept an empty or short key. Probe: with an empty key, an intent forged with `HMAC(b"", …)` was FILLED. `rotate-hmac` stores `key.hex()` (secrets.py:80-83), but reads return the stored text as ASCII (L78), so the effective key is hex(typed) and Lumen won't match. The signed payload has no key id/version.
- **M2. HMAC is computed over a re-serialized, parsed subset, not over the bytes Lumen signed.** feed.py:45 → signer.py:246 → signer.py:1237-1275. Unknown fields (`vetting_verdict`, nonce, audience, key id) are silently dropped and unauthenticated. The `usd_stake` float path makes the verified bytes differ from the signed ones. `True` is accepted as 1 cent. NaN or Infinity (Python json accepts them) raise in `parse_intent` before the HMAC check (probe: ValueError/OverflowError), so one poisoned item fails every pull. That stalls the feed, including Zoora's sells. There is no domain-separation prefix.
  Fix: HMAC the exact received body bytes with a `v1|signer-intent|` prefix and a key id. Reject unknown fields, bools, floats and non-finite values. Parse per item inside try/except.
- **M3. The Windows preflight parsers fail open on several inputs.** preflight.py:63-68 `parse_whoami` is English-only. An Administrators member running unelevated ("Group used for deny only") passes, though DESIGN A15.4 says to refuse when the user is in Administrators. A German elevated token passes. preflight.py:70-81 `parse_icacls` is a blacklist: other named users, `NT AUTHORITY\INTERACTIVE`, `BUILTIN\Administrators` and a localized Everyone (`Jeder:`) all pass, so the check isn't "owner-only". `rpc.env`'s ACL is never checked. Credential Manager generic credentials have no per-entry ACL (any process running as the user can CredRead), so A15.5 can't be enforced as written. On the good side, unreadable output fails closed, and clock_sync needs 2 samples but the CLI supplies at most 1 (preflight.py:131-145), so it always fails. That means the A15.2 dual-source clock check isn't really implemented. Use SIDs (S-1-5-32-544, S-1-16-12288+) via `whoami /groups /fo csv` or the token API, and an ACL allowlist (owner SID plus SYSTEM only) via Get-Acl.
- **M4. The secret-in-log screen and key handling have gaps.** signer.py:1172-1183 screens the HMAC as `mac.hex()` of the ASCII value. Probe: the raw HMAC string was written to `events` and the HUD file undetected. The signing key is screened only as hex, not base58, base64 or a JSON array (probe: base64 not detected). `_needles()` and `_payer()` fetch the signing key from Credential Manager on every event append and every buy, which multiplies in-memory copies. Python `bytes` can't be zeroized, and nothing tries (bytearray or ctypes memset). It was not logged, written to disk, or put in repr or exception text (probe: solders errors carry no key bytes, and the store repr is the default object repr). Tracebacks with locals (pytest --showlocals, crash reporters) would expose it. Fix: cache only the pubkey, and fetch the secret once at sign time inside a bytearray.
- **M5. The signing-key format has a silent fallback.** secrets.py:64-67: a non-hex value (base58 from Phantom, a JSON array from solana-keygen) silently becomes raw ASCII bytes. It fails later (safely) in solders. Reject it explicitly with a format error.
- **M6. Supply chain.** requirements*.txt are pinned but not `--hash`'d, and transitive deps (anyio, idna, certifi, h11, httpcore, cffi, jaraco.*, pywin32-ctypes, backports-tarfile) are unpinned. `uv.lock` (which has hashes) is used by neither CI nor the README (`pip install -e ".[dev]"`). CI downloads gitleaks and the Solana installer (`curl | sh`) with no checksum check, and CI gitleaks runs `--no-git` (tree only). `smr.vet` is external, unpinned, and launched via PATH `python` (cli.py:88), so it is open to PATH or current-directory hijack on Windows. Its verdict is unsigned (`public_key=None` skips the check, vet.py:263). The vet gate only gates buys, and the caps still apply.
- **M7. The docs don't match this review's brief.** The RPC URL may also come from an ACL'd env file (secrets.py:85-92, README L43-63, DESIGN A14). That is allowed by the design, but it is not "Credential Manager only". README L3 says "does not trade" (see Purpose).

### Low
- L1. Every CLI invocation runs `_reconcile` (signer.py:1021-1050), which releases `reserved` rows of a concurrently running daemon.
- L2. `sweep` ignores kill and pause (dead `pass`, signer.py:458-459). `whitelist-add` has no confirmation, removal or limit. `route-approved` accepts any non-empty text (probe: `--source x --date y` → ROUTE_APPROVED → `mode live` accepted and persisted across boots). The broadcaster still refuses.
- L3. Zero-stake buys are accepted and FILLED (probe), consuming slots and the daily count. There is no positive minimum. `usd_stake=0.004` rounds to 0.
- L4. `pull_once` pushes the entire event log to Lumen on every pull (signer.py:250-253). `_sync_hud` rewrites the whole HUD file on every event (signer.py:1226-1233). Both are O(n²) and a DoS risk, and they leak whitelist and route text to Lumen.
- L5. The daily-loss limit is hardcoded `600` (signer.py:1005) instead of `DAILY_LOSS_CAP_CENTS`. The feed and RPC URLs aren't forced to https.
- L6. The acceptance concurrency tests use threads, not processes (tests/test_02_concurrency.py). My process-level probe is below.
- L7. Dev dependency pytest 8.3.5 has PYSEC-2026-1845 (fixed in 9.0.3).

## Verified OK
1. **Submit path.** `rg` across src, scripts, tests and the workflow finds no sendTransaction, sendRawTransaction, Jito or bundle code. `HeliusRpc.ALLOWED_METHODS` is read-only plus simulate (forced sigVerify=false), and `sendTransaction` returns METHOD_DENIED (rpc.py:18-27,74-76). `RefuseBroadcaster.enabled=False` makes the code return BROADCAST_DISABLED before `sign_message` (signer.py:676-677). `_message()` (signer.py:1290) isn't a Solana wire tx anyway. In the dependencies, `solders.rpc.requests` contains SendTransaction *serializers* only, with no transport, and src imports only `solders.keypair`. httpx is a generic client. scripts/e2e_validator.py simulates on a local validator only, and its one mainnet use is a read-only `solana program dump` in the optional job.
2. **Defaults.** A new DB starts DRY_RUN and PAUSED (db.py init). Every boot forces PAUSED, and LIVE is coerced to DRY_RUN without route_approved. Garbage activity or mode values fail closed (exact-match checks). Key-material env vars make it refuse (CLI exit 2). Agent-side inputs can't flip mode: intents carry no mode fields, Telegram isn't wired, and env lives on the owner's PC.
3. **Caps.** They are code constants (constants.py:293-300) and not DB-configurable, so only a code change raises them. A DB edit of reservations or trades could free slots, because the hash chain covers only `events`. Every check and reservation runs in one `BEGIN IMMEDIATE` (db.py transact). My 8-process × 4-5 intents races, 3 reps each: open trades exactly 3, buys/day exactly 10 (other caps lifted), exposure exactly 2000¢ (other caps lifted). Negative stake is refused, as are 10^30¢ stake and slippage over 1500. Integers are lamports and cents throughout. The CT day is correct at 23:59:59.999/00:00 and across both DST transitions (tzdata pinned for Windows). Replaying an intent_id returns the stored decision with no new reservation.
4. **Kill.** Zoora's sells are refused under HALTED and PAUSED. Owner `sell` and `sell-all` go through (bookkeeping only in this build). Scheduled exits are suppressed. "Owner SELLs" means CLI `sell MINT [--tokens N]` or `sell-all`. It doesn't clear the kill; see H1.
5. **HMAC** uses `hmac.compare_digest` on lowercase hex. TTL is 90 s with a 5 s future window, and expired intents are recorded. Destinations aren't in intents: buys pay only the payer's own position, and the SOL-out sweep is owner-CLI-only to a non-empty whitelist (empty → refused). Worst case with a compromised Lumen or HMAC, per DESIGN A4: ≤ $25 drained through bad trades within the caps, at ≤ 4 intents/hour.
6. **Program IDs** are pinned with sources and dates (constants.py:1-27,246-277): pump 6EF8…F6P, PumpSwap pAMM…EA, Token-2022, SPL Token, ATA, System, ComputeBudget. Metaplex is rejected.
9. **Tooling.** gitleaks 8.30.1 (fresh download, sha256 matches the release checksums) found no leaks on the PR range 73afd9d..06adef0 (git mode, default rules and the project config) or on a dir scan. pip-audit on requirements.txt reports no known vulnerabilities. The commits are unsigned (two by Cursor Agent, one by zooratechnologies).
8. **Tests** on Linux (Python 3.13.5, pinned deps): pytest 39 passed ×3, ruff clean, mypy --strict clean (19 files).

## Not exercised (Windows-only)
Real `WindowsOsProbe` commands (w32tm, Get-MpComputerStatus, SecurityCenter2, whoami, icacls, Get-WinEvent), the keyring Windows Credential Manager backend and its actual readers, NTFS ACL inheritance on the WAL and HUD files, and the PowerShell setup in the README. I tested parser behavior only, with fake text. CI's windows-latest job is green.

## Scratch
All work was in /tmp/zsec-signer (mode 700), which was removed afterward. /tmp/zsec-tools (another agent's) was left untouched. Its gitleaks binary hash matches the official 8.30.1.

---

## Re-check 1 (70180eb)

Reviewed 2026-11-17 ~6:15 PM CT, read-only. Fake secrets only. No signing, no mainnet transactions, no pump.fun calls. Scratch /tmp/zsec-signer (700) was removed afterward.

**CI.** Run 44205332184 "Zoora signer": head_sha 70180eb175924b944b4a74fdfec07385079a4199, pull_request, completed, success, attempt 1. It started 6:08 PM CT and finished 6:09 PM CT. All jobs succeeded on 70180eb: test (ubuntu-latest), test (windows-latest), package, validator (optional). PR #92 is still a draft. There are 2 new commits (3ae15b6, 70180eb, both Cursor Agent, unsigned), changing 38 files, +2872/-528.

**Verdict.**
- **Dry-run code: GO.** It still cannot sign or broadcast. `signing.sign_message` isn't imported anywhere in src. Every builder plus `assert_allowlisted` raises PLACEHOLDER_BUILDER. In LIVE mode a buy gets released as PLACEHOLDER_BUILDER, and a sweep also returns PLACEHOLDER_BUILDER (both probed). The RPC method allowlist is unchanged. The caps held in 8-process races.
- **Live: NO-GO.** H1 and H2 are still open (one new bypass for H1), and H3 is held by design.

**Tooling.**
- pytest: 63 passed, run 3 times.
- ruff: clean. mypy --strict: clean (21 files).
- gitleaks 8.30.1 (sha256 verified): no leaks on 73afd9d..70180eb (default rules), 06adef0..70180eb (project config), or the dir scan.
- pip-audit: requirements.txt clean. The lock file has only the dev-only pytest 8.3.5 issue (PYSEC-2026-1845).
- The hash-locked install (`--require-hashes`) succeeded.
- New transitive dep `lazy-importer==0.1.0`: upstream importlib-metadata 10.2.0 legitimately requires it. It has a single release, no author metadata, and on this lock it only installs on Python <3.12. I inspected the wheel: it's an import-hook shim with no network or exec code. Info only.

### Status of earlier findings
- **H1 (kill durability): partly fixed.**
  - Fixed:
    - Boot keeps HALTED (signer.py:136-148).
    - `status` and `doctor` are read-only via `Signer.attach` (cli.py:149-156). CLI probe: halt → status / doctor / whitelist-add / resume / mode / sell-all / expect-deposit all stay HALTED.
    - `resume` refuses with HALT_PERSISTED (signer.py:303-304).
    - `unhalt --confirm UNHALT` verifies the chain first (a tampered chain gives HASH_CHAIN) and refuses `unexpected_sol` and `reconcile_unknown` until reconciliation passes (signer.py:319-344).
    - Owner sell under a kill works and leaves the kill in place. Zoora sells get KILL_HOLD.
  - **NEW High, N1: sticky-halt laundering.** `_halt()` overwrites `halt_reason` on every call (signer.py:1200-1210). Any later halt therefore replaces a sticky reason with a non-sticky one, and `unhalt` then succeeds without reconciliation. I reproduced two paths, both ending in UNHALTED → resume → ACTIVE:
    - (a) `unexpected_sol` → any write command run without `--kill-switch`, or with an unreachable switch (poll_kill at boot, signer.py:207) → reason becomes `killed`.
    - (b) `unexpected_sol` → a `resume` attempt while the oracle is down (signer.py:293) → reason becomes `ORACLE_DOWN`.
    The same happens for `reconcile_unknown`.
  - Also: LEDGER_BREACH's "reconcile" only re-checks counts (signer.py:968-970). `unconfirmed`, `secret_in_log` and `vetting_service` aren't sticky.
- **H2 (instruction decode): partly fixed.**
  - message_policy.py decodes real legacy and v0 `solders` messages. Unknown programs and discriminators are rejected, which makes it an allowlist. Probes rejected: Token Transfer, Approve, SetAuthority, CloseAccount, TransferChecked, ApproveChecked, Burn, MintTo; System CreateAccount, Assign, Transfer, TransferWithSeed, Allocate, CreateAccountWithSeed, AdvanceNonce; 2 swaps; more than 4 instructions; an ALT that's actually used; extra ComputeBudget kinds; non-idempotent ATA. Account count and signer/writable roles are checked against fixtures/pinned_ix.json, which pins buy_v2/sell_v2 and PumpSwap buy/sell. The 4 fixed addresses are pinned.
  - **Still accepted (live-blocking):**
    - Account addresses are free except those 4 (message_policy.py:141-148). Accepted: buy_v2 or sell_v2 with `associated_base_user` set to an attacker's ATA (tokens bought with our SOL delivered elsewhere), a substituted `bonding_curve`, `global` or `fee_recipient`. PDAs and ATAs aren't derived and compared.
    - The ATA create-idempotent accounts and owner aren't checked (L95-98). Creating an ATA for a foreign owner was accepted.
    - ComputeBudget values are unbounded (L109-114). A CU price of u64 max with a 1.4M limit was accepted, which is a wallet drain via priority fees.
    - Swap arguments aren't checked (L100-104). `max_sol_cost` = u64 max and an empty arg tail were both accepted.
    - The fee payer and signer aren't checked against our own key.
    - **v3 mismatch:** the validator rehearses `buy_v3`/`sell_v3` (scripts/e2e_validator.py:39-40), which the policy rejects as SWAP_DISCRIMINATOR. The v3 discriminators have no cited source.
    - `validate_transaction` isn't called from the signer yet.
- **H3 (builders): held as designed.** The placeholders fail closed (txbuild.py:29-61; LIVE buy, sweep and builders probed). DESIGN.md lists the required builder work. But **NEW Medium, N2:** in LIVE, `_sell` still books a sale with no transaction (signer.py:812-908). Probe: LIVE owner sell → CLOSED, with ledger SOL credited. Sells must refuse as PLACEHOLDER_BUILDER in LIVE, the way buys do.
- **H4 (Telegram / kill-unreachable): partly fixed.**
  - Fixed: `AgentGuardKill` treats a missing path, unreadable file, bad JSON or anything other than `{"status":"clear"}` as killed (killswitch.py:13-22). An exception in poll also counts as killed (signer.py:202-205). Probed: error → killed, weird → killed.
  - Telegram (signer.py:350-367) checks the chat and sender against an allowlist (empty by default, so it rejects everything), rejects strings, and only accepts halt, /halt or kill. Probes: wrong chat, wrong from, `resume` and `forward_date` were all rejected.
  - **Remaining Medium:** it expects flat `chat_id`/`from_id`, not the Bot API `chat.id`/`from.id` (a real-shaped Update gets rejected, which fails closed). It doesn't reject `forward_origin` (the current Bot API field): a probe with `forward_origin` was HALTED. `sender_chat`, `via_bot` and edited messages aren't handled. No bot or poller exists yet. The direction is HALT-only, so the risk is low until it's wired up.
- **M1 (HMAC key): fixed.** The key has to be hex and at least 32 bytes (secrets.py:77-80, 144-153). An empty key returns None and the empty-key forgery gets BAD_HMAC. Rotation refuses under 32 bytes, and stores and reads hex consistently. `key_id` = hmac_version is enforced (BAD_KEY_ID).
- **M2 (canonicalization): mostly fixed.**
  - The HMAC is over the raw body bytes with the `v1|signer-intent|` prefix (signer.py:1304-1309). No prefix → BAD_HMAC, and re-serialized bytes → BAD_HMAC.
  - NaN and Infinity are rejected (parse_constant). Bool or float stake, bool issued_at, and zero or negative stake are all BAD_INTENT. Each item is parsed in its own try (signer.py:267-271).
  - **Remaining Low/Medium:** buy intents with unknown fields are still accepted. The allowed-key check only runs in the sell branch (signer.py:1363-1384). Probe: `vetting_verdict` and `destination` → FILLED, while a sell with an extra field → BAD_INTENT. Duplicate JSON keys are accepted, with the last one winning (signer.py:228).
- **M3 (Windows preflight): partly fixed.**
  - Admin detection uses SID S-1-5-32-544 (preflight.py:66-75), so deny-only and German-locale admins are now caught.
  - The clock check uses w32tm plus the HTTPS Date header from the RPC URL (preflight.py:111-124, 160-174).
  - **Remaining:**
    - `parse_icacls` is unchanged and still a blacklist (preflight.py:81-92). Other named users, `NT AUTHORITY\INTERACTIVE` and a localized `Jeder:` all pass.
    - **The README says the ACL check covers `rpc.env`, but it doesn't.** The CLI passes only the DB and its directory (cli.py:51).
    - High integrity is detected only by English text; S-1-16-12288 or higher isn't checked (L76).
    - Credential Manager ACLs are owner-confirmed per the README. I accept that as a documented caveat. Any process running as the user can still read the key.
- **M4 (log screen): fixed for the HMAC.** Raw, hex, HEX, base64, base58 and JSON forms are all caught (secrets.py:41-58). base64url and partial substrings aren't, which is Low. The signing key is no longer screened, but it's also no longer read on the hot path; only `has_signing_key` in `doctor` parses it (secrets.py:138-142). Low. The RPC URL is screened; the API key alone isn't.
- **M5 (key format): fixed.** Only 128 hex characters are accepted (secrets.py:24-38).
- **M6 (supply chain): mostly fixed.**
  - CI installs `requirements.lock.txt` with `--require-hashes` (519 hashes).
  - gitleaks archives are checked by sha256. Both hashes match the official v8.30.1 checksums.
  - gitleaks now scans the git range.
  - The anza installer is checked by sha256 (matches 21de1236…).
  - smr.vet runs via `sys.executable -m`.
  - **Remaining:**
    - README.md:20 still has the owner's PC (the live host) run an unhashed `pip install -e ".[dev]"`.
    - The pip-audit job audits requirements.txt, not the lock (workflow L67).
    - `-m` puts the cwd on sys.path, so a local `smr/` could shadow the module. Use `-P`/`-I` (vet.py:130).
    - The anza installer's second-stage download isn't pinned (optional job only).
- **M7 (docs): fixed.** The README now says "This is a trading executor design. The current build cannot sign or broadcast."
- **Lows:**
  - Fixed:
    - Sweep under a kill gives KILL_HOLD, otherwise PLACEHOLDER_BUILDER.
    - Zero stake is refused (1 micro-USD rounds up to 1¢, which is acceptable).
    - The event push and HUD write are now incremental.
    - The hardcoded 600 is gone.
    - The feed URL must be https.
    - There's a process-level race test (tests/race_worker.py).
    - Read-only commands no longer reconcile.
  - Remaining: `route-approved --date` only checks the length (`notadate!!` was accepted, signer.py:370). `status` on a missing or mistyped `--db` reports PAUSED/DRY_RUN instead of an error (signer.py:583-606). The state tables still aren't covered by the hash chain: a DB edit of `activity` to ACTIVE was followed by a FILLED buy (the DB is owner-ACL'd).

### New findings
- **N1 High:** sticky-halt laundering (see H1).
- **N2 Medium:** LIVE sells are booked without a transaction (see H3).
- **N3 Medium: the validator reports a false green.** `main()` prints "simulation finished with no error" and returns 0 whatever `buy_err`/`sell_err` were (scripts/e2e_validator.py:246-252). The green "validator (optional)" job proves nothing.
  - It never signs: `Transaction.new_unsigned` and `sigVerify` false.
  - It never sends: there's no sendTransaction, and `_rpc` only talks to the local 127.0.0.1:8899.
  - Network: it reads from the **live public mainnet RPCs** (api.mainnet-beta.solana.com, solana-rpc.publicnode.com) through `solana-test-validator --url/--clone-upgradeable-program`, read-only.
  - The fixture contains a third party's public on-chain wallet address (public data, Info).
- **N4 Low:** buy-intent unknown fields and duplicate keys (see M2).

### Network calls in CI
- pip from PyPI (hash-locked).
- pip-audit (OSV/PyPI).
- gitleaks and the anza installer from GitHub and anza (sha256-checked).
- The optional validator job: read-only clones from the public mainnet RPCs.

The required jobs make no RPC calls, and there are no transaction sends anywhere.

### Caps (re-run, 8 processes × 5 intents, 3 reps)
- Default limits: exactly 1 RESERVED (the new 1-buy-per-10-minutes limit).
- Rate limits lifted: exactly 3 open slots.
- Buys/day: exactly 10.
- Exposure: exactly 2000¢.
- A replayed intent returns the stored decision.

### Remaining for a live GO (my bar: H1-H4 and M1-M3 on a green SHA)
1. **H1/N1.** Keep every halt reason as a set and make `_halt` append, not overwrite. `unhalt` must reconcile every sticky reason present. Consider making `unconfirmed` and `secret_in_log` sticky, and LEDGER_BREACH needs a real reconcile.
2. **H2.** Derive and compare every PDA and ATA: bonding_curve, associated_*, global, fee_recipient against the global account, creator_vault, the volume accumulators. Check the ATA ix accounts and owner. Bound the CU limit and price so fee and rent fit inside the $2 all-in. Decode the swap args and check them against the reservation (amount and max_sol_cost / min_out). The fee payer must be our own key with exactly 1 required signature. Pin v3 (or v2) from a cited IDL with tests, and call `validate_transaction` on every message right before signing.
3. **H3.** The real builders per the DESIGN list, plus N2 (sells in LIVE must build or refuse) and N3 (the validator must fail on any error).
4. **H4.** Parse real Bot API Updates (`message.chat.id`, `message.from.id`), reject `forward_origin`, `sender_chat`, `via_bot` and edited messages, add the poller with update_id dedupe, and configure the allowlist.
5. **M2.** Reject unknown fields on buys and duplicate keys.
6. **M3.** Use an ACL allowlist (owner SID + SYSTEM only) via Get-Acl or SDDL, include rpc.env and the WAL/SHM/HUD files, and check the high-integrity SID.
7. M6 (README hashed install) and the Lows before live.

---

## Re-check 2 (0a0a316)

Reviewed 2026-11-17 ~6:34–6:45 PM CT, read-only. Fake keys and addresses only. No signing by me, no mainnet transactions, no pump.fun site or API calls. Public GitHub (pump-public-docs) fetched read-only. Scratch /tmp/zsec-signer (700) removed afterward.

**CI.** Run 44208166684 "Zoora signer" is on head_sha 0a0a316d24d1037f368565c8b2a5ae0d740347e5 (pull_request), completed success, attempt 1, 6:29–6:31 PM CT. Jobs all success on 0a0a316: test (ubuntu-latest), test (windows-latest), package, validator (optional). The "Unsigned local simulation" step succeeded in 8 s, and the script now exits 1 on any sim error, so both unsigned sims passed. I can't read the job log (needs auth). PR #92 is still a draft. 2 new commits, 1b4df5d and 0a0a316, both by Cursor Agent and unsigned: 28 files, +2514/-246.

**Verdict.**
- **No-broadcast code: GO.** There is no sign or send path. `signing.sign_message` has no caller in src. The RPC allowlist has no sendTransaction and forces unsigned simulate. `RefuseBroadcaster` is the only broadcaster wired in the CLI (cli.py:183). In LIVE, buys give SIGN_REFUSED, sells give BROADCAST_REFUSED with the position kept open, and sweeps give PLACEHOLDER_BUILDER (all probed).
- **Live / broadcaster: NO-GO yet.** The policy's PDA, payer and ATA checks are switched off on the real buy path (N5), and the CU-fee and $2 all-in gaps below are still open.

**Tooling.**
- pytest: 80 passed, 3 times. ruff check clean (9 files are unformatted, not gated). mypy --strict clean (21 files).
- gitleaks 8.30.1 (tarball sha256 551f6fc8… verified): no leaks on 70180eb..0a0a316 (default rules), 73afd9d..0a0a316 (project config), or the dir scan.
- pip-audit: requirements.txt and requirements.lock.txt are both clean. pytest is now 9.0.3, and CI audits the lock.

### IDL verification (pump-public-docs 639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22, 2026-10-13, still the repo HEAD)
- `idl/pump.json` (6EF8…F6P): buy_v3 = `07051dc4f5176550` and sell_v3 = `1c92de7726c469d5`. Both equal sha256("global:<name>")[:8], and both have 17 accounts. The order and writable/signer flags match `fixtures/pinned_ix.json` and `txbuild._CURVE_FLAGS` exactly: global, base_mint, quote_mint, base_token_program, quote_token_program, bonding_curve, assoc_base_bc, assoc_quote_bc, user(s,w), assoc_base_user, assoc_quote_user, user_volume_accumulator, fee_config, buyback_fee_recipient, system, event_authority, program.
- Args: buy_v3 is (amount u64, max_sol_cost u64, partial_fill OptionBool). TRADE_V3.md says partial_fill "May be left off", so the builder's `<QQ` is valid. sell_v3 is (amount, min_sol_output).
- `idl/pump_amm.json` (pAMM…XEA): buy_v2 = `b817ee6167c5d33d` and sell_v2 = `5df6823ce7e940b2`, 17 accounts. The order and flags match the pinned list. Pinned global_config ADyA8h… = PDA(["global_config"], pAMM), which I verified.
- The buyback recipients in message_policy.py:152-163 equal the 8 in docs/FEE_RECIPIENTS.md. The fee_config seeds ["fee_config", program] under pfee… match the IDL. These discriminators match too: Global a7e8e8b1c86c727f, FeeConfig, Pyth PriceUpdateV2 22f123639d7ef4cd.
- **Doc mismatch (functional, fails closed):** for PumpSwap, `buyback_fee_recipient` must be the buyback wallet's quote-mint **ATA** (PUMP_SWAP_TRADE_V2.md #15), but the policy requires one of the 8 wallets (message_policy.py:235). Valid PumpSwap trades would therefore be rejected when an owner is passed.

### Status of Re-check 1 items
1. **N1 sticky-halt laundering: FIXED.** Reasons are now a set and `_add_halt` appends (signer.py:84-93). Resume drops only non-sticky reasons (L348-356), and unhalt reconciles each sticky one (L383-385). I probed 3 sticky reasons × 5 triggers (kill unreachable, oracle-down resume, reboot with kill, owner halt, Telegram halt). Every case stayed RECONCILE_REQUIRED / HALT_PERSISTED / HALTED.
2. **H2 policy: much improved, but not effective in the signer.**
   - With `owner` and `mint` passed, the policy rejects: a foreign associated_base_user, a fake bonding_curve, global, assoc_base_bc, fee_config, volume accumulator or token program, a foreign buyback recipient, an ATA create for a foreign owner, a foreign payer, 2 signers, ALTs, more than 4 ix, a second swap, retired v2 discriminators, System Transfer/Allocate/AdvanceNonce, SPL and Token-2022 Approve/SetAuthority/Close/TransferChecked/ApproveChecked/SyncNative, non-idempotent ATA, extra ComputeBudget kinds, CU price above 2^32, and max_sol_cost u64 max or amount 0.
   - **N5 High:** `_settle_buy` calls `validate_transaction(raw, owner=self._owner_pubkey(), …)` (signer.py:856). But `_owner_pubkey` reads `secrets.signing_pubkey` (L593), which neither `KeyringSecretStore` nor `MemorySecretStore` defines, so owner is always None. `_check_derived` then returns early (message_policy.py:206-207), and the ATA-owner and fee-payer checks are skipped (L97-100, 129). On the buy path, every account substitution above is ACCEPTED (probed).
   - The sell path passes `owner=str(inputs["user"])` from the market reader (signer.py:649), not our key.
   - No caller passes `max_all_in_lamports`, `expected_token_amount` or `expected_limit_lamports`. The backstops are therefore 50 SOL for max_sol_cost and 0.05 SOL for the priority fee (message_policy.py:164-165, 251, 273).
3. **N2 LIVE sells: FIXED.** owner_sell, Zoora sell and sell_all in LIVE all return BROADCAST_REFUSED. The trade stays open and the ledger is unchanged.
4. **N3 validator false green: FIXED.** It returns 1 on error and 2 if the CLI is missing (e2e_validator.py:339-347, 261).
5. **Telegram: FIXED.** It parses `update.message.chat.id/from.id` as strict ints and rejects the old flat shape, wrong chat or sender, forward_origin, forward_date, sender_chat, via_bot, edited_message, channel_post, string or bool IDs, and non-halt text. The default allowlist is empty, so everything is rejected. Low nits: `forward_origin: {}` (falsy) and `is_automatic_forward: true` still HALT (signer.py:1556). Use key presence, and reject is_automatic_forward. HALT-only, so this is Low.
6. **Strict and duplicate keys: FIXED.** Buys with destination, vetting_verdict or token_amount, a missing stake, a sell with usd_stake_micro, duplicate keys, NaN, bool, float or nested values all give BAD_INTENT. 2_000_001 micro gives STAKE, a wrong key_id gives BAD_KEY_ID, and a valid buy is FILLED.
7. **M3 ACL: still open, now fail-closed on real Windows.**
   - `parse_icacls` (preflight.py:85-98) only counts lines whose principal starts with `S-1-`. Real `icacls <path>` prints account names, so a correct owner+SYSTEM ACL returns False (probed). Preflight can never pass on Zoorped's PC.
   - It also takes the first ACE from the path line via `split(":")[0]`, and with a `C:\` path that yields "C". A foreign SID there is ignored: a probe with a foreign SID on line 1 plus owner and SYSTEM returned True.
   - The tests use synthetic SID-only text (test_feed_and_rpc.py:143, test_security_recheck.py:192).
   - Fix: read SDDL (`(Get-Acl).Sddl` or GetNamedSecurityInfo), parse every ACE, allow only the owner SID and S-1-5-18, and check owner and protected/inherit flags.
   - Fixed parts: the ACL paths now include the WAL, SHM, HUD and rpc.env (cli.py:138-142), and the integrity check uses SID S-1-16-12288.
8. **Nits.**
   - pip-audit on the lock, done. `python -I -m smr.vet`, done (vet.py:130). ISO date validation, done.
   - README.md:21 still runs `pip install -e ".[dev]"` after the hashed install, which allows unhashed build-backend downloads. Use `--no-deps --no-build-isolation` or install the wheel.
   - `status` on a missing DB still prints PAUSED (signer.py:700-702).
- **Kill switch, changed by design** (killswitch.py): it's now a directory, with a `killed` file or a stale (>15 s) or future heartbeat meaning killed. Probed: empty dir, stale, future, bool ts and `killed` all read as killed, fresh reads as clear.
  - A heartbeat containing `"status":"killed"` reads **clear**. Reject any status other than clear.
  - The kill dir isn't in the ACL paths, so anyone who can write it can clear the kill.
  - Live dependency: agent-guard must run the heartbeat writer, and we need to agree the contract with SE.
- **Old Low still open:** a direct DB edit of `activity` to ACTIVE is not detected (FILLED buy, and boot shows no anchor_mismatch). `anchor_mismatch`, `hash_chain`, `settle_error`, `unconfirmed` and `secret_in_log` aren't sticky.

### Builders (H3, L1, L2): built unsigned, math mostly right
- **Rounding.** The USD→lamports budget rounds down (quote.py:52-58). Fees use ceil (L67-70). net_sol is the largest net whose ceil fees fit. Tokens round down. max_sol_cost = floor(quote×(1+s)), and the builder checks limit+fixed ≤ budget and micro-USD ≤ $2 (txbuild.py:129-132, 300-338). Sell min_out = floor(net×(1−s)), with net after ceil fees. Slippage is capped at 1500 bps, stake must be 1–200¢, mint decimals must be ≤9, the mint must be initialized, and its owner must be SPL or Token-2022 (wrong owner → MINT). SPL and Token-2022 derive the right ATAs, and WSOL quote uses SPL Token. Curves that are complete or cashback are refused.
- **N6 Medium: the $2 all-in leaves out first-trade rent.** TRADE_V3.md #12 says user_volume_accumulator is "Created if missing, paid by user" (137 bytes, 1,346,200 lamports in the fixture). `_fixed_costs` (txbuild.py:312-315) doesn't count it. True worst-case cost of the first trade: $2.19 at $140/SOL, $2.34 at $250, $3.35 at $1000. Also, `_unsigned_buy` defaults `ata_rent_lamports` to 0 even when `create_base_ata` is True (signer.py:621-622). The builder accepts rent 0 and reports $2.00, while the true cost is $2.21 at $140/SOL.
  - Fix: count accumulator rent when it's missing, require rent > 0 whenever an ATA is created, and read rent from getMinimumBalanceForRentExemption instead of the 1,513,840 constant. That constant matches the fixture's current mainnet rent, but rent can change.
- **N7 Medium: token-paired curves aren't refused.** A curve whose quote_mint isn't WSOL builds with max_sol_cost in quote-token units. A USDC-quoted probe gave max_sol_cost = 14,280,513 base units, about **$14.28** (txbuild.py:261-266, 129-136). Refuse any quote_mint other than WSOL until token quotes are priced.
- **N8 Medium: the SOL price comes from the market reader** (`inputs["sol_usd_cents"]`, signer.py:618), not the oracle reading already vetted in `_settle_buy`. Pass `sol_usd_cents(reading)`.
- **Policy gaps that remain even with an owner passed:**
  - Calling with no SetComputeUnitLimit and price 2^32 µL is **ACCEPTED**. The policy computes the fee as 0, but the runtime defaults to 200k CU per non-builtin ix, which means about 0.86–1.72 SOL in fees (message_policy.py:270-275).
  - The priority fee is capped separately from max_sol_cost, so priority + max_sol_cost can reach twice the all-in.
  - Sell `min_sol_output` of 0 or 1 is ACCEPTED (L239-257 has no floor on sells).
  - Trailing bytes after the args are accepted, so partial_fill can be set by the tail.
  - Not checked: assoc_quote_user, assoc_quote_bc, base_mint vs mint, quote_mint, event_authority. The program enforces most of these, so they're Low.
  - Legacy transactions are accepted.
  - PumpSwap checks only the payer, global_config and buyback: a foreign `user_quote_token_account` on a PumpSwap sell was built and ACCEPTED by both. PumpSwap isn't wired into the signer yet.
- No regressions found. Caps re-run, 8 procs × 5 intents × 3 reps: default gives 1 FILLED + 39 RATE_LIMIT. With the rate limit lifted it gives exactly 3 FILLED + 37 OPEN_TRADES.

### Network
- CI test and package jobs: PyPI (hash-locked), gitleaks (sha256), pip-audit. No RPC.
- Validator (optional, `continue-on-error`): the anza installer (sha256; its second stage isn't pinned) and `solana-test-validator --url` public mainnet RPCs for read-only `--clone-upgradeable-program`. Simulation is local only (127.0.0.1), sigVerify false, with no sendTransaction (`_rpc` raises). The fixture's "user" is a third-party mainnet trader address (public data, Info).

### Broadcaster PR — HoS requirements (draft)
1. **One path only.** A single `Broadcaster` implementation and a single call site: build → `validate_transaction` with **all** arguments (owner = the pubkey derived from the Credential Manager key, mint, max_all_in = reservation all-in, expected token amount, expected limit, sell min-out floor) → sign → re-decode the **signed** bytes and re-validate them → sha256(message bytes) must equal the validated hash → simulate → kill check → send. Nothing else may import `signing.sign_message`, and a CI grep test must enforce that.
2. **Simulate first.** `simulateTransaction` on the exact signed bytes with sigVerify true and replaceRecentBlockhash false. Refuse on any err, on CU used above the limit, or if the simulated SOL delta exceeds the reservation all-in, or exceeds min-out on a sell.
3. **Hash binding.** Persist message_hash and signature in the reservation **before** sending, inside BEGIN IMMEDIATE. A re-send must reuse the identical bytes, and the signer must never sign a second message for the same reservation.
4. **Confirm and reconcile.** Poll getSignatureStatuses to `confirmed` until blockhash expiry, using lastValidBlockHeight. If the result is still unknown at expiry, add sticky `reconcile_unknown` and halt. If confirmed, reconcile the SOL and token balances against the expected deltas, and add sticky `unexpected_sol` on a mismatch. No retry with a new blockhash until the old one has provably expired and the signature is absent.
5. **Jito: no** for v1. Use plain sendTransaction to the one allowlisted RPC with `skipPreflight=false` and `maxRetries=0`. A Jito tip is an extra transfer the policy forbids, so revisit it only with a separate review.
6. **RPC allowlist.** HTTPS only, with the host pinned to the configured provider (exact hostname match, no redirects, TLS verify on). Add `sendTransaction` only on that host and only inside the broadcaster. The URL never gets logged.
7. **Canary.** The first 5 live trades are capped at $0.50 all-in, at most 1 open, and at most 3 a day. After that, normal caps apply only after an owner CLI command, `canary-complete --confirm`, with all 5 trades reconciled.
8. **Kill check immediately before send.** `poll_kill()` plus an activity check in the same step as send. If the kill flips between sign and send, discard the signed bytes and mark the reservation released.
9. **Key access.** Only the broadcaster reads the signing key, from Credential Manager, at sign time. It's held in a bytearray and zeroed after use, never logged or put in env, files or exceptions. The owner pubkey is derived from it and must equal the configured wallet pubkey. Every other path gets `has_signing_key` only.
10. **Real-signing e2e in test mode only.** On a local `solana-test-validator` (or devnet), using a throwaway key generated in the test, sign and send buy_v3 and sell_v3 against cloned programs and assert the balance deltas and reconcile. The CI job must be required, not optional. No mainnet URL is allowed in test mode, so assert the URL host isn't a mainnet RPC.
11. **Fix first:** N5, N6, N7, N8, the CU-limit-absent bypass, the sell min-out floor, and M3 SDDL. Also add the PumpSwap derivations or remove PumpSwap from the allowlist.
12. **Approvals.** This reviewer's GO on the exact broadcaster SHA with green CI, HoS GO, then **Zoorped's final approval in his own words** before `set-mode LIVE` with a real key. ROUTE_APPROVED stays required.

---

## Re-check 3 (13ec28d), 2026-11-17 CST

Head 13ec28deb43439478a7449f2e2e929c17d8b4c02 (from 0a0a316): 6 unsigned commits, 23 files, +1187/-168, new heartbeat.py and tests/test_recheck2.py. The PR is still an open draft. CI run 44213583007 ran on 13ec28d and passed (attempt 1, 7:09–7:11 PM CST). The validator job is now required: continue-on-error is removed and its simulation step passed. Read-only on the repo and remote. All values were fake and used only in /tmp/zsec-signer, which has since been removed. No mainnet transactions and no pump.fun calls.

**Verdicts**
- **No-broadcast code: GO.** It has no sign or send path. sign_message has no caller in src, the RPC ALLOWED_METHODS do not include sendTransaction, and RefuseBroadcaster (cli.py:188) is the only broadcaster.
- **Building the broadcaster PR on top: CONDITIONAL GO.** Building can start. Live enablement is NO-GO until R3-1, R3-2, R3-3 and R3-4 are fixed and re-checked, along with broadcaster requirements 1-12 from Re-check 2.

**Tooling.** pytest passed 93 of 93, three times. ruff is clean. mypy --strict is clean (22 files). pip-audit is clean on both the lock and requirements.txt. gitleaks found nothing on 0a0a316..13ec28d, on 73afd9d..13ec28d with the project config, or on the directory scan. A caps race (8 processes × 5 buys, 3 runs each) gave 1 FILLED with default limits and 3 FILLED with rate limits off, which matches the open-trade cap.

### SE claims 1-10, verified by probing
| # | Claim | Status |
|---|---|---|
| 1 | Owner wiring (secrets.py:105, message_policy.py:104, signer.py:896/:670) | FIXED. wallet_pubkey returns the last 32 bytes. owner=None is refused with OWNER_REQUIRED and mint=None with ATA_MINT. A live buy uses the wallet owner and ignores the market's "user". A sell with a foreign buyback is refused (FEE_RECIPIENT). |
| 2 | One CU limit (≤400k) and one price, fee inside the all-in (:343) | FIXED. Refused: missing limit, missing price, both missing, a duplicate of either, limit 400_001, limit 0 or price 0, price 1_000_001, 2^32 or u64-max, overflow, a 6-byte limit encoding, and 400k×1M pushing the total past the all-in. |
| 3 | Sell min 0 or 1 (:308), trailing bytes (:299), legacy (:107) | FIXED, with a note: a 1-byte tail of **any** value is still accepted (0x07, 0x01), see R3-7. |
| 4 | Rent from account size (quote.py:46), volume and curve top-up (txbuild.py:351), refuse a create when rent is missing (:359) | PARTIAL. rent=0 with an ATA is refused. The volume size is wrong and the inputs are trusted, see R3-1 and R3-2. |
| 5 | WSOL only (txbuild.py:305) | FIXED. A USDC quote is refused with QUOTE_MINT on buy and sell. In the policy, quote_mint and quote_tp are still unpinned, see R3-5. |
| 6 | Vetted price (signer.py:612) | FIXED. |
| 7 | PumpSwap off the live allowlist; dry-run derives all accounts | Allowlist part FIXED (PUMPSWAP_DISABLED). The dry-run buyback derivation is wrong, see R3-6. |
| 8 | ATA mint and address check (:277) | FIXED. A foreign ATA address, owner, mint or token program is refused. |
| 9 | SDDL DACL, owner + S-1-5-18 only (preflight.py:85) | PARTIAL. The LS alias is accepted as SYSTEM, see R3-3. |
| 10 | Non-'clear' status means killed; kill dir in the ACL paths; more sticky reasons; kill polled at :882/:679 | MOSTLY FIXED. The kill file is only matched when it is a regular file, see R3-4. Sticky reasons survive resume, but most clear without a real reconcile, see R3-8. A buy does not poll the kill switch after validation (OK without a broadcaster). |

**HoS K1** (killswitch.py:34-37, heartbeat.py:26 as sole writer). The checks work: an absent heartbeat, status killed, ""/null/"CLEAR", stale (16 s), future (3 s), a bool or float ts, an empty file, a list, garbage and mode 0644 all give killed. A missing status key gives clear (by design). See R3-9 for the design gap. **Two clock hosts** (preflight.py:112): FIXED on the live path. Duplicate hosts (case-insensitive) give None. **Missing anchor halt** (signer.py:1529): FIXED. A deleted, truncated or rewritten anchor gives HALTED anchor_mismatch on boot. **Nits** (README, signer.py:1632): Telegram is FIXED. forward_origin (any value), is_automatic_forward and edited_message are rejected. README regression: see R3-10.

### H2 attack set, with real owner wiring
- Fee bypass with missing, duplicate or overflowed CU instructions: all refused.
- Foreign global, base_mint, base_tp, bonding_curve, the base ATAs, volume, fee_config or buyback; a changed amount; max_sol +1 or u64-max; a foreign payer; 2 signers; an added System transfer, SPL Approve, T22 TransferChecked, memo or second ATA; ALT; legacy; retired v2: all refused.
- Still accepted (Low): foreign quote_mint [2], quote_tp [4], assoc_quote_bc [7], assoc_quote_user [10] and event_authority [15].
- Non-WSOL quote: refused in the builder.
- Heartbeat and kill: see above.
- SDDL with realistic strings:
  - Protected or inherited (ID) owner+SY: True.
  - An inherited default-profile BA ACE, a foreign SID in the first ACE, a deny ACE (fails closed), WD, BU, AU, CO, OW, a NULL DACL, an empty DACL, or an OA/XA foreign ACE: False.
  - **LS in place of SY: True (wrong).**
  - A second DACL-like line is ignored (contrived, Low).
- Telegram: see R3-11.

### New or open findings
- **R3-1 (Medium, live blocker)** constants.py:68 `USER_VOLUME_ACCOUNT_BYTES = 106`. The account is 137 bytes (per TRADE_V3.md and the mainnet fixture), so the volume rent is under-counted by 215,760 lamports at the code's own 6960/byte rate.
  - At 6960/byte, a first trade with ATA create costs $2.01 at $50/SOL, $2.03 at $140, $2.05 at $250, $2.13 at $600 and $2.22 at $1000. That is over the $2.00 all-in.
  - At today's observed 5080/byte it stays ≤$2 ($1.72–$1.99).
  - Fix: 137 bytes. Better, read the size, or getMinimumBalanceForRentExemption, from chain.
- **R3-2 (Medium, live blocker)** signer.py:635-638 `_unsigned_buy` takes `ata_rent_lamports`, `volume_exists` and `curve_lamports` from market inputs.
  - Probe: ata_rent=1 is accepted (counted rent 1,628,641), and volume_exists=True removes the volume rent.
  - Fix: derive these from getAccountInfo or rent-from-size in the signer. Never trust the feed.
- **R3-3 (Medium)** preflight.py:106 maps `"LS"` (LocalService, S-1-5-19) to SYSTEM. A DACL granting LocalService passes. Fix: map only SY. Add tests for LS, OW and BA.
- **R3-4 (Low-Med)** killswitch.py:67 `path.is_file()`. A kill path that is a directory or a dangling symlink gives **clear**. Fix: `os.path.lexists()`; any entry means killed.
- **R3-5 (Low)** message_policy.py (buy/sell v3 checks) does not pin metas[2] quote_mint to WSOL or [4] quote_tp to SPL Token. It relies on the builder plus program checks. Pin them in the policy (defence in depth).
- **R3-6 (Low, not live)** txbuild.py:475 and message_policy.py:273 require the PumpSwap buyback (#15) to be the **user's own** WSOL ATA. PUMP_SWAP_TRADE_V2.md says it is the buyback wallet's quote ATA. The docs-correct value gives DERIVED; the user's ATA gives BUILT. Fix before PumpSwap is ever enabled.
- **R3-7 (Low)** message_policy.py:297-298 accepts a 1-byte tail of any value (0x07 is an invalid bool; 0x01 means partial_fill=true). Accept only the exact expected byte.
- **R3-8 (Low)** signer.py `_reconcile_ready`: agent_guard, settle_error and unconfirmed (and LEDGER_BREACH on a count) clear with only the unhalt confirmation. Require a chain reconcile for settle_error and unconfirmed.
- **R3-9 (Medium for live, design)** heartbeat.py is written by the signer itself. A fresh heartbeat proves the signer is alive, not that agent-guard is reachable. That loses "guard unreachable = killed". agent-guard's KILL_SWITCH is on the box while the signer runs on the PC, so there is no sync path. The broadcaster PR needs an external writer (agent-guard, or a signed relay) or an authenticated pull.
- **R3-10 (Low, regression)** README.md:21: `pip install --no-deps --no-build-isolation -e .` fails on a fresh 3.12 venv ("Cannot import build backend setuptools.build_meta") because setuptools==75.8.2 is not in the hash lock. Add it to the lock, or document the step.
- **R3-11 (Low)** signer.py:1632 Telegram:
  - forward_date, sender_chat and via_bot are truthiness checks (forward_date 0 and sender_chat {} pass).
  - Legacy forward_from and forward_from_chat, and from.is_bot, are not checked.
  - The impact is HALT-only. Use `in` checks.
- **Open from before (Low)** signer.py:1457-1460 `_event` records the current state digest, so a direct DB edit followed by any event gets re-baselined. It is only caught if the process boots before the next event. Deleting the anchor_meta row before the first anchor gives no halt.
- Sells pass max_all_in=None, so the sell priority fee is bounded only by 400k×1M = 0.0004 SOL. Low.

---

## Re-check 4 (819c8a4), 2026-11-17 CST

Head 819c8a458b59d6a26142e5a996325d0bf44396f9 (from 13ec28d): 2 commits by Cursor Agent (6574640, 819c8a4), not verifiable as signed. 17 files, +655/-61. The PR is still an open draft. CI 44216688103 ran on 819c8a4 and passed (attempt 1, 7:33–7:35 PM CST). Jobs: package, test ubuntu (the new "README install on a fresh venv" step passed), test windows (that step is skipped, Linux only), and validator ("Unsigned local simulation" passed). Read-only on the repo and remote. Fake values only, in /tmp/zsec-signer (removed). No mainnet, no pump.fun.

**Verdicts**
- **No-broadcast code: GO.** sign_message has no caller in src. ALLOWED_METHODS has no sendTransaction. RefuseBroadcaster is the only broadcaster.
- **Live blockers apart from the broadcaster PR: YES, R4-1 to R4-4.** The external heartbeat writer and the box-to-PC KILL_SWITCH sync (R3-9) are accepted as broadcaster-PR scope.

**Tooling.** pytest passed 107/107, three times. ruff clean. mypy --strict clean (22 files). pip-audit clean on the lock and requirements.txt. gitleaks 8.21.2 (checksum verified) found nothing on 13ec28d..819c8a4, on 73afd9d..819c8a4 with the project config, or on the directory scan. The README install (`--require-hashes` lock, then `--no-deps --no-build-isolation -e .[dev]`) now works on a fresh venv.

### Claims, verified by probing
| Item | Status |
|---|---|
| R3-1: 137 bytes, chain reads, RPC rent | PARTIAL. constants.py:69 is 137. signer.py:650-698 reads curve, volume and ATA via account_info. **But getMinimumBalanceForRentExemption is not in rpc.py ALLOWED_METHODS**, so on the real HeliusRpc it returns METHOD_DENIED with no request sent, and rent_exemption gives None (R4-1). Tests monkeypatch chain.rent_exemption and never hit this. |
| First trade ≤ $2.00 at standard rent | FIXED (with the chain fakes giving true facts). The micro-USD ceil cost is ≤ 2,000,000 across 100+ prices from $50 to $1000/SOL and all four volume/ATA combinations. The worst case is exactly $2.000000. ATA create is refused at $1000, and at $600+ when the volume account is also missing. Sizes asked: 137 and 182 (Token-2022; real is 170, so conservative). |
| R3-2: market rent claims ignored | FIXED. Market ata_rent, curve_lamports and create_base_ata are ignored. volume_exists=True without the chain account is refused. signer.py:623 special-cases ata_rent==1 as a refusal, which is cosmetic and test-shaped. |
| R3-3: only SY maps to SYSTEM | FIXED. LS, OW, BA, NS and S-1-5-19 give False. SY and S-1-5-18 give True. |
| R3-4: lexists | MOSTLY FIXED. A directory or dangling symlink at killed, KILL_SWITCH or state/KILL_SWITCH now gives killed. A permission-denied state dir does not (R4-4). |
| HoS K2 | FIXED. A home without state/, or with state as a file or dangling symlink, gives killed. root=state dir with state/KILL_SWITCH gives killed. Unset env plus empty flag gives None, which gives killed. A root named "State", or a symlink to state under another name, gives killed (fail closed; on Windows a case-insensitive name compare would be friendlier). A root=state dir ignores home/killed (Low). |
| R3-5: pins | FIXED. Foreign [0]-[16] are all refused, each with its specific code. |
| R3-7: exact tail | FIXED. Tails 00, 01 and 07 are refused when no tail is expected; 01 is accepted only with expected_tail=1. Neither caller passes expected_tail, so any tail is refused (good). |
| R3-8: unhalt reconcile | FIXED. agent_guard, settle_error and unconfirmed need chain.authoritative plus no unknown signatures; agent_guard also needs the kill clear. anchor_mismatch still clears on the anchor match alone (see R4-3). |
| R3-11: Telegram | FIXED. Key-presence checks for forward_* fields, sender_chat and via_bot; is_bot true is rejected. (is_bot "no" or missing still HALTs, which is harmless.) |
| R3-6: PumpSwap buyback ATA | FIXED in dry-run (txbuild.py:505-510, policy :286; test_txbuild covers it). Still off for live. |
| Sell fee inside the all-in | FIXED. A sell with all_in None gives MAX_SOL. CU 400k×1M on a sell gives MAX_SOL. A missing expected limit gives MIN_OUT. |
| setuptools hashed, CI step | FIXED. setuptools 84.1.0 is in the lock and the hash matched PyPI on install. The new step (zoora-signer.yml:41-47) only installs from the hashed lock plus `--no-deps --no-build-isolation` and pulls nothing unhashed. Pre-existing: the package job installs `build==1.2.2` unhashed, and `python -m build` (isolated) downloads setuptools and the wheel deps unhashed. The anza installer is hash-checked but fetches its own release. Low. |
| State digest halts on mismatch (signer.py:1567) | NOT EFFECTIVE (R4-3). |
| Missing anchor_meta halts | FIXED. Deleting anchor_meta then rebooting gives HALTED anchor_mismatch. db.py:114 only recreates it when there are no events. Dropping the last event or deleting the anchor file also halts. |

### RPC read hardening (focus item)
- **Through HeliusRpc and _RpcChain.account_info (cli.py:98-116), with a mocked transport:**
  - HTTP 500, a 302 redirect (httpx follow_redirects=False), non-JSON, a JSON-RPC error, a non-dict result, a list value, and bool or float lamports all give None (fail closed).
  - A missing "value" key gives (False, 0, 0), meaning absent. That is conservative for rent; an absent curve gets refused.
  - Invalid base64 ("!!!!", or junk characters) is silently decoded by non-validating b64decode to size 0 or 3, not None.
  - The encoding label isn't checked.
  - **Owner, data length and discriminator are not returned or checked.**
  - Negative lamports pass cli but are refused in signer._account.
- **In signer._chain_trade_facts:**
  - Any account_info None or exception, a missing curve, or rent of None, 0, 1, True, an exception or 10^12 gives a refusal.
  - **Accepted:** a volume account with size 1 or lamports 0, an ATA with size 1, and rent=2 (counted rent 4 lamports).
  - Curve lamports 0 counts the full top-up (conservative).
- **Trust:** cli.py:195 only requires the URL to start with "https://", with no host pin to the Helius domain. HeliusRpc itself takes any scheme. TLS verification is httpx's default (on).
- **Impact:** if the RPC lies that the volume account exists, or reports tiny rent, the first trade really costs **$2.09 at $50, $2.26 at $140, $3.84 at $1000/SOL**.

### New findings
- **R4-1 (Medium, live blocker, fails closed)** rpc.py:20-29 is missing getMinimumBalanceForRentExemption, so cli.py:92-96 always returns None. Every live buy that needs volume or ATA rent is refused, including the first buy for a new wallet. Fix: allowlist it, and add an HTTP-level test (MockTransport), not a monkeypatch.
- **R4-2 (Medium, live blocker)** RPC facts are under-validated (cli.py:98-116, signer.py:679/688/725):
  - Return the owner and check it: pump for the curve and volume, the token program for the ATA.
  - Require size == 137 for the volume account and the curve discriminator for the curve. Use `b64decode(validate=True)` and check `data[1] == "base64"`.
  - Floor the rent at the local formula (refuse if RPC rent is below `rent_exempt_lamports(n)`).
  - Pin the RPC host to the Helius domain over https.
- **R4-3 (Medium, live blocker)** The state digest does not detect tampering, and it false-halts:
  - (a) signer.py:1564-1573 halts only when a payload *supplies* state_sha256. Only the intent-refused path does (signer.py:1526-1537), and it computes the digest in the same transaction, so it can't catch a prior edit. Probe: an edit to the ledger or HALTED→ACTIVE, followed by a buy, gives FILLED, and the later reboot gives PAUSED with no halt. A HALTED→ACTIVE edit followed by resume() gives RESUMED. (A reboot straight after an edit is caught, via the boot check at signer.py:185.)
  - (b) False sticky anchor_mismatch in normal operation, pre-existing since 13ec28d:
    - halt then resume (HALT_PERSISTED: signer.py:362-369 rewrites halt_reason without an event), then reboot, gives HALTED anchor_mismatch.
    - whitelist_add (signer.py:504-517 appends an event without _sync_hud/_write_anchor), then reboot, gives HALTED anchor_mismatch.
    - oracle down at resume, then resume again, gives the same.
  - (c) anchor_mismatch is cleared by `unhalt UNHALT` alone, once boot rewrites the anchor, even after a real tamper.
  - Fix:
    - Compare the transaction-start digest with the last event's digest at the top of every write transaction.
    - Emit an event for every signer_state write, and sync the anchor after whitelist_add.
    - Make anchor_mismatch require an explicit owner review step.
- **R4-4 (Low-Med)** killswitch.py:96 `os.path.lexists` returns False on any OSError (the `except OSError` is dead). With state/ unreadable (mode 000 or no x) and state/KILL_SWITCH present, poll gives **clear**. Fix: `os.lstat`; FileNotFoundError or NotADirectoryError means False, any other OSError means None (killed).
- **R4-5 (Low, pre-existing)** In DRY_RUN, a buy fills (simulated) while the kill switch reads killed, unless something polled first. LIVE gives KILL_HOLD. Seen on 13ec28d too. Poll the kill at the start of every intent.
- **R4-6 (Low)** signer.py:623 `inputs.get("ata_rent_lamports") == 1` is a test-shaped special case. Drop it now that market rent is ignored.
- Open from before: CI package job unhashed installs (Low).

---

## Re-check 5 (3db1564), 2026-11-17 CST

Head 3db156499e9a123bca44ebb3199a461f6b72d561 (from 819c8a4): 3 commits by Cursor Agent (dac5229, 6ced2d9, 3db1564), 17 files, +492/-84. The PR is still an open draft. CI 44219750762 ran on 3db1564 and passed (attempt 1, 7:58–7:59 PM CST): test ubuntu, test windows (the README step is skipped by design), package, validator. Read-only on the repo and remote. Fake values only, in /tmp/zsec-signer (removed). No mainnet, no pump.fun, no real RPC.

**Verdicts**
- **No-broadcast code: GO.** sign_message has no caller in src, ALLOWED_METHODS has no send method, and RefuseBroadcaster (cli.py:227) is the only broadcaster.
- **Live blockers apart from the broadcaster PR: YES, R5-1 and R5-2.** R5-3 should also land before live.

**Tooling.** pytest passed 115/115 three times. ruff clean. mypy --strict clean (22 files). pip-audit clean on the lock (now including build and pyproject_hooks) and requirements.txt. gitleaks 8.21.2 (checksum verified) found nothing on 819c8a4..3db1564, on 73afd9d..3db1564 with the project config, or on the directory scan.

### Claims, verified by probing (end to end through HeliusRpc and _RpcChain with an httpx MockTransport)
| Item | Status |
|---|---|
| 1. Rent method allowlisted (rpc.py:26) | FIXED. The request reaches the transport. |
| 2. RPC hardening | MOSTLY FIXED. Refused: bad base64, junk characters, a base58 or missing encoding label, data as a string, a missing owner, a fake curve owner or bad discriminator, an ATA owned by SPL or System for a Token-2022 mint, an absent account that reports lamports or data, rent as a string, a float, 0, formula-1, or formula+1%+1. A volume account with a fake owner or the wrong size (136 or 1) is treated as missing, so rent is budgeted (conservative). A missing `value` key reads as absent, so rent is budgeted. Accepted: an ATA of size 1 (Low; the address is an ATA PDA). See R5-1 for the rent band. |
| Host pin (cli.py:167) | FIXED. http, host-suffix tricks, path tricks, userinfo, `\@` and other subdomains are refused. `#@evil` resolves to the Helius host (fine). **devnet.helius-rpc.com is accepted** (R5-5). httpx does not follow redirects. |
| First trade ≤ $2.00 | FIXED when the data is truthful. The worst case over $50–$1000/SOL in 7-dollar steps, across all four volume/ATA combinations at standard rent, is exactly 2,000,000 micro-USD. A pinned-host RPC that lies with a well-formed volume account (pump owner, 137 bytes) still makes the real cost $2.09 at $50, $2.26 at $140 and $3.84 at $1000. That residual trust in TLS plus Helius is accepted as Low. |
| 3. Digest check in _transact (signer.py:1625) | FIXED. A raw ledger edit followed by a buy gives ANCHOR_MISMATCH/HALTED. A HALTED→ACTIVE edit followed by a buy or resume is refused. |
| False sticky halts | FIXED. No anchor_mismatch after: halt→resume→reboot, halt→resume→unhalt→resume→reboot, whitelist_add→reboot, oracle down ×2, 10 buy/sell pairs, sell_all, Telegram halt→resume, route plus LIVE mode, rotate_hmac, deposit, unexpected SOL, kill→buy, preflight fail, 5 reboots, buy_halt, 48 h scheduled exits. (The harness's record_state appends an event without writing the anchor, so it false-halts on reboot. That's a test artifact only.) |
| Reanchor clears anchor_mismatch (:1298) | Implemented, but it blesses tampering (R5-2). |
| 4. lstat (killswitch.py:96-99) | FIXED. A state dir at mode 000 or 600 gives killed, with or without KILL_SWITCH. Modes 300 and 100 (traversable) give clear with no file and killed with one. A KILL_SWITCH that is a dir, a dangling symlink, a self-loop symlink or a fifo gives killed. ENAMETOOLONG gives killed. An env kill path under a regular file (ENOTDIR) reads as absent (OK). |
| Kill polled first in handle_intent (:290) | FIXED. A DRY_RUN buy while killed, a kill error, or a bad-HMAC intent while killed all give KILL_HOLD. |
| ata_rent==1 removed | FIXED. |
| Hashed package job (zoora-signer.yml:89-96) | PARTIAL (R5-4). |
| HoS R1: rent = max(chain, formula) with a band | NOT AS DESCRIBED. quote.py:64 refuses chain rent below the formula instead of budgeting max(); see R5-1. |
| sol_usd_micro required | FIXED. Omitted gives TypeError, None gives TypeError, 0 gives CAP. |
| P1: curve pins (message_policy.py:230-243) | FIXED (all of [0]-[16] verified in Re-check 4; the code is unchanged). |
| P2: micro-USD rounds up (models.py:70) | FIXED. 14,000,000,001 gives 140,000,001; ...000 gives 140,000,000; ...099 gives 140,000,001; not-ok gives 0. |
| P4: expected_limit mandatory for sells (message_policy.py:326) | FIXED. None gives MIN_OUT, below the limit gives MIN_OUT, exact is accepted. |

### New findings
- **R5-1 (Medium, live blocker, fails closed)** quote.py:60-68 `accept_chain_rent` refuses chain rent below `(n+128)*6960`. The repo's own mainnet fixture (fixtures/e2e_curve.json, slot 470726647, recorded 2026-11-17) shows rent-exempt balances of exactly `(n+128)*5080`: mint 399 B = 2,677,160, ATA 170 B = 1,513,840, volume 137 B = 1,346,200. If live getMinimumBalanceForRentExemption returns 5080/byte, every live buy that needs volume or ATA rent is refused, including a new wallet's first buy (probe: "MAINNET rent 5080" gives REFUSED). The tests and the validator only use 6960. Fix: budget `max(chain, formula)`. Refuse only above formula+1%, or confirm the live value from a read-only call on Zoorped's side.
- **R5-2 (Medium, live blocker)** signer.py:539-551 `reanchor` (CLI cli.py:260/297) needs no confirmation, no reconcile and no kill-clear, and shows no diff. Probes:
  - Set ledger=1e12 lamports, reboot (HALTED anchor_mismatch), `reanchor` gives REANCHORED, `unhalt UNHALT` gives UNHALTED, resume gives ACTIVE with ledger 1e12.
  - With an authoritative chain and the ledger 99 lamports off the chain balance, reanchor plus unhalt succeeds.
  - Reanchor works while killed, and on a plain owner halt.
  - Anyone who can run the CLI as the owner user can bless a tamper in two commands. The event chain is also unkeyed (events: prev_hash/hash only), so anyone with DB write access can forge a consistent event (the harness's record_state does exactly that).
  - Fix: `reanchor --confirm REANCHOR`; refuse while killed; require verify_chain, ledger == authoritative chain SOL, and no reserved or signing reservations; record the prior and current state fields in the event. Consider keying the event chain with an HMAC from Credential Manager.
- **R5-3 (Medium-Low)** signer.py:664-666 (buy) and :802-804 (sell) still build from market `mint_data` and `curve_data`. The chain curve data is fetched for buys (signer.py:713) but only its discriminator is checked. Probe: market reserves ×3 builds with token_amount 81.2e12 against a chain-truth 27.1e12. The money cap still holds. On a buy, a bad amount reverts. On a sell, market data sets min_out, so deflated reserves remove slippage protection. Fix: build from the chain curve and mint bytes (or require byte-equality), and fetch them on sells too.
- **R5-4 (Low)** zoora-signer.yml:90 `python -m build` runs isolated and installs setuptools==84.1.0 from PyPI **without hashes** (confirmed locally: "Installing packages in isolated environment: setuptools==84.1.0"). :93-96 hashes the wheel it just built, which is circular. Fix: `python -m build --no-isolation` (setuptools is already in the hashed lock).
- **R5-5 (Low)** constants.py:102 allows devnet.helius-rpc.com for a mainnet signer. Devnet chain facts would be wrong. Pin mainnet only for LIVE.
- **R5-6 (Low)** signer.py:832-840 `sell_all` lets AnchorMismatch escape, so the CLI `sell-all` crashes with a traceback. owner_sell returns ANCHOR_MISMATCH. Also, after a tamper the owner can't sell until they reanchor; document that or allow owner sells under halt.

---

## Re-check 6 (e1d53b8)

Head e1d53b86681885971e2e6b594049ffddfabad9fb (was 3db1564). Commits dd962a5, 3c007f6 and e1d53b8 (Cursor Agent, unverifiable signatures). 22 files, +733/-74. CI run 44223346574 passed: test ubuntu, test windows (README step skipped by design), package and validator, 8:27–8:29 PM CST on Nov 16. The PR is still an open draft. Everything below is read-only work in /tmp/zsec-signer with fake throwaway keys. No mainnet, no RPC with funds, no pump.fun.

**Verdict: GO as no-broadcast code. NO-GO for live.** Besides the broadcaster PR, two things still block live: R6-1 (the authoritative SOL balance is a hard-coded 0) and R6-2 (FeeConfig is still read from market input). R6-3 and R6-4 should be fixed before or inside the broadcaster PR.

### Tooling
- **Tests:** 123 passed, three runs in a row.
- **Static checks:** ruff clean, mypy clean (22 files), pip-audit clean on both the lock and the env.
- **gitleaks v8.21.2** (checksum verified): no leaks on 3db1564..e1d53b8, on 73afd9d..e1d53b8 with the project config, or on a dir scan.
- **No sign or send path:** the only `sign_message` is signing.py:17/21, which nothing calls. No sendTransaction or sendRawTransaction anywhere. cli.py:224 wires only `RefuseBroadcaster()`.
- **Normal-flow soak:** 15 cycles of buy, reboot, halt, resume, sell, whitelist_add, reboot, sell_all and scheduled exits. No false halts.

### Per-item status
| Item | Status |
|---|---|
| R5-1 rent: 5080 rate, max(chain, formula), refuse above +1%, ATA through the same rule | **Fixed.** Band edges on a 182 B ATA (formula 1,574,800): formula and formula+1% (1,590,548) accepted; +1%+1 refused; formula-1, 1 and 0 budgeted at the formula; -1 refused; a 6960 quote (2,157,600) refused, so it fails closed. First-trade sweep from $50 to $1000/SOL, slippage 0 and 1500, ATA/volume/curve top-up combinations: max all-in built is exactly $2.000000. At 5080, 8 low-price combinations refuse with CAP. At 6960 every rent-bearing case refuses with RENT. Volume rent goes through accept_chain_rent too (txbuild.py:402). |
| R5-2 reanchor | **Partly fixed.** The gates work: no confirm or a lowercase confirm gives CONFIRMATION_REQUIRED; killed or a kill error gives KILL_HOLD; a non-authoritative chain gives RECONCILE_REQUIRED; a ledger off by +1, +7 or -1 gives RECONCILE_REQUIRED; a 1e12 ledger against a 1e8 chain gives RECONCILE_REQUIRED; a reserved or signing reservation gives RECONCILE_REQUIRED. Open issues: see R6-1 and R6-5. |
| R5-2 event HMAC | **Fixed in the code, with operational gaps (R6-6).** A forged unkeyed event fails verify and halts with anchor_mismatch and hash_chain. A missing, empty or 31-byte key fails closed (hash_chain halt, no event written). Hex, raw and base64 forms of the key in a payload all raise SecretInLog. |
| R5-3 chain bytes for buys and sells | **Fixed** for the curve, mint and mint owner (signer.py:819-821, 983-985). test_market_reserves_do_not_change_the_chain_quote checks the ×3 reserves case. FeeConfig is still market-supplied: see R6-2. |
| R5-4 build | **Fixed.** The lock pins build 1.2.2, setuptools 84.1.0 and wheel 0.46.2 with hashes. A local `pip install --require-hashes` followed by `python -m build --no-isolation` built the wheel. The workflow hashes the wheel and pins upload-artifact by SHA. What remains trusted is setup-python's bundled pip. |
| R5-5 devnet in LIVE | **Fixed** on buy (signer.py:808), sell (:970) and set_mode (:534). Not checked in owner_sell_after_tamper: see R6-3. |
| R5-6 sell_all | **Fixed.** It returns ANCHOR_MISMATCH (:1013-1023; covered by a test). |
| State digest covers reservations and trades (signer.py:95) | **Fixed.** Deleting trades or reservations halts with anchor_mismatch. |
| Dry-run re-polls the kill at sign and send | **Fixed** (:993-1003). |

### New findings
- **R6-1 (High, blocks live): the "authoritative" SOL balance is the constant 0.**
  - Where: cli.py:66 sets `_RpcChain.authoritative = True`, and cli.py:71-72 has `sol_lamports()` return 0. getBalance is allowlisted but never called.
  - Effect on reanchor: in production, reanchor (signer.py:596-607) passes only when the ledger is 0.
  - Proven blessed tamper: delete trades and reservations, set the ledger to 0, then reanchor. It returns REANCHORED, unhalt returns UNHALTED, resume returns RESUMED, and open trades drop to 0. Caps and counters are reset.
  - Effect on a genuine non-zero ledger: it can never reanchor.
  - The same constant feeds boot's opening ledger and the unexpected-SOL reconcile.
  - Fix:
    - Implement getBalance on the pinned HeliusRpc with strict int types.
    - Read at `finalized` commitment.
    - Raise on any error so reanchor refuses.
    - Add a test that drives `_RpcChain` itself, not FakeChain.
- **R6-2 (Medium, blocks live): FeeConfig bytes still come from market input.**
  - Where: signer.py:822 (buy), :986 (sell) and :742 (owner_sell_after_tamper).
  - Proof: parse_fee_bps accepts any total below 10,000 bps. A forged FeeConfig (9000 + 900 bps, empty tier table) passes, and validate_transaction only compares the transaction against the builder's own output.
  - Effect: on a 1e12-token sell at 0 bps slippage, the forged FeeConfig drops min_out from 364,095 to 3,686 lamports (-99%). A lying feed can disable the sell's slippage protection, which is a sandwich risk.
  - Fix: read the fee_config PDA (already derived in message_policy.py:253/284) from the chain in `_chain_trade_facts`, like the curve.
- **R6-3 (Medium; fix before or inside the broadcaster PR): owner_sell_after_tamper has no LIVE, devnet or tamper gate, and hands unsigned bytes to the broadcaster.**
  - Where: signer.py:711-790.
  - Probe: with a recording broadcaster, `submit(744 bytes)` is called in DRY_RUN, in LIVE, in LIVE with a devnet RPC URL, and with no tamper at all. Today only RefuseBroadcaster stops it. Nothing in the method itself refuses LIVE as the design note claims.
  - What it gets right: it never touches the ledger, keeps the anchor_mismatch halt (the event reuses the old state digest), and refuses a market slippage_bps of 99999 (SLIPPAGE_CAP_BPS).
  - Fix:
    - Add an explicit `mode == LIVE` refusal (or route it through the broadcaster-PR send path with the same gates).
    - Add `_devnet_in_live`.
    - Require an anchor_mismatch or hash_chain halt to be present.
    - Re-poll the kill switch before submit, as `_broadcast_sell` does.
- **R6-4 (Low): the sell size can come from market `token_in`.**
  - Where: signer.py:979, `token_amount or inputs.get("token_in") or chain[8]`.
  - The amount is not clamped to the chain ATA balance (chain[8]). A larger amount fails on chain. A smaller one partially sells while the ledger may treat the position as closed.
  - Fix: use `min(requested, chain[8])` and ignore market token_in.
- **R6-5 (Medium): reanchor reconciles only the SOL ledger, and its event does not show the change.**
  - Proof: deleting trades and reservations while the ledger matches the chain, or flipping route_approved, gives REANCHORED and then UNHALTED, with open trades 0.
  - The event cannot show what changed. signer.py:613 and :617 snapshot the same row, so all previous_* fields equal new_* (diff = []), and the event has no trade or reservation counts.
  - Fix:
    - Store a snapshot (state fields, trade and reservation counts, open-position token totals) in each HMAC'd event.
    - On reanchor, diff the current state against the last HMAC'd snapshot and show the diff.
    - Refuse when trades or reservations shrank or config flags changed, unless each change is listed and confirmed.
    - Reconcile token balances for open trades against the chain.
- **R6-6 (Low/Medium, operational): event-HMAC key lifecycle.**
  - **No creation path.** The README (lines 36-40) says only `python -m keyring set zoora-signer event-hmac` and paste hex. It gives no generation command, and set_event_hmac (secrets.py:135/208) has no caller.
  - **No rotation and no versioning.** Changing the key halts with hash_chain, and reanchor is then impossible.
  - **No migration.** A DB with an existing unkeyed chain boots halted (anchor_mismatch, hash_chain). Unhalt and reanchor both return HASH_CHAIN, so the only way out is a fresh DB. That fails closed, but it strands state. Document it or add a one-shot migration under typed confirmation.
  - **No entropy check.** 32 zero bytes and 32×'a' are accepted.
  - **No key separation.** An event key equal to the intent HMAC key (b"k"*32) is accepted.
  - Suggested fix:
    - Add an `init-event-key` command that generates `secrets.token_bytes(32)` and writes it without printing.
    - Refuse a key equal to hmac-key, and refuse low-entropy keys.
    - Add a key id to each event so the key can be rotated.
  - **Design limit:** anyone running as the same Windows user can read Credential Manager and forge events.

### Design question: an owner sell while killed
Probe today:
- A DRY_RUN `owner_sell` while killed returns CLOSED (the position closes in simulation).
- A LIVE `owner_sell` while killed returns KILL_HOLD (`_broadcast_sell` polls the kill first).
- owner_sell_after_tamper also requires a clear kill switch.

So the same owner request behaves differently in the two modes.

Recommendation: unify on one owner-exit path.
1. **What the kill switch stops.** It stops Zoora (intents, buys, Zoora sells, scheduled exits). It does not stop an owner's explicit, typed sell. A kill should not trap funds. Proceeds stay in the same owner wallet.
2. **One strict path in both modes.** The owner exit always goes through the strict path:
   - chain curve, mint, FeeConfig and ATA balance (after R6-2);
   - sell only, sized at most to the chain balance;
   - validate_transaction;
   - slippage cap;
   - devnet-in-live refusal;
   - typed confirmation.
   DRY_RUN should simulate this same path rather than closing from DB rows.
3. **After a tamper.** Only the chain-sourced variant is allowed. It reads nothing from the DB, never writes the ledger, and keeps the halt.
4. **What still needs reconcile.** Resuming trading, unhalt and any ledger write still require a real reconcile (R6-1 and R6-5).

This matches the parent's lean ("allowed while killed, strict path only, never after a tamper without reconcile"), with one clarification. "Without reconcile" should gate resuming trading and ledger updates, not a chain-sourced owner exit. Otherwise a tamper traps funds, because reanchor cannot pass until R6-1 is fixed.

---

## Re-check 7 (346b134)

Head 346b1349f4ff45acd34d2cfebf8d3d6d89f32b1a (was e1d53b8). Commits 699ff11 and 346b134. 14 files, +866/-118. CI run 44226684428 passed: test ubuntu, test windows, package and validator, 8:54–8:57 PM CST on Nov 17. The PR is still an open draft. Everything below is read-only work in /tmp/zsec-signer with fake throwaway keys. No mainnet, no RPC with funds, no pump.fun.

**Verdict: GO as no-broadcast code. NO-GO for live.** R6-1 and R6-2 are fixed. Besides the broadcaster PR, two things still block live:
- **R7-1:** the snapshot diff is defeated by the boot event, so the R6-5 fix doesn't hold in the real CLI flow.
- **R7-3:** boot crashes when getBalance fails, so `halt` and `sell` are unavailable during an RPC outage.

R7-2 (rekey) is latent, but it should be fixed or removed before live.

### Tooling
- **Tests:** 131 passed, three runs in a row.
- **Static checks:** ruff clean, mypy --strict clean (22 files), pip-audit clean on the lock.
- **gitleaks v8.21.2** (checksum verified): no leaks on e1d53b8..346b134, on 73afd9d..346b134 with the project config, or on a dir scan.
- **Build:** a local hash-locked install followed by `python -m build --no-isolation` built the wheel.
- **No sign or send path:** the only `sign_message` is signing.py:17/21, which nothing calls. No sendTransaction anywhere. cli.py:239 wires only `RefuseBroadcaster` (`enabled = False`, signer.py:206-210).
- **Normal-flow soak:** 15 cycles of buy, reboot, halt/resume, sell, whitelist_add, reboot, owner sell, sell_all, exits, expect_deposit and reboot, with the authoritative chain on. No false halts.

### Per-item status
| Item | Status |
|---|---|
| R6-1 getBalance | **Fixed.** cli.py:72-83 sends `getBalance [owner, {commitment: finalized}]`. A bool, string, float, negative or None value, a non-dict result, ok=False or a missing owner all raise. R6-1 replay (delete trades and reservations, ledger 0, chain 80,000,000) gives RECONCILE_REQUIRED. With the chain also lying 0, it still gives RECONCILE_REQUIRED (the event-log counter replay catches it). Minor: 2**70 is accepted (no u64 bound, cli.py:81). |
| R6-2 chain FeeConfig | **Fixed.** `_chain_trade_facts` reads the fee_config PDA and requires the owner pfee… and the discriminator (signer.py:930-950). The mainnet fixture has one tier, 0/95/30 = 125 bps. 135 is accepted, 136 refused, 9000/900 on chain refused, a pump owner refused, a bad discriminator refused. The LP field is ignored on the curve, which is correct per FEE_PROGRAM_README. A market-forged 9900 bps FeeConfig changes nothing (buy limit and token amount identical). Neither buy nor sell reads the market fee_config any more. |
| R6-3 owner exit | **Fixed.** I ran DRY_RUN and LIVE × normal, killed, kill error, tamper, and tamper+killed, with a recording broadcaster set to `enabled=True`. In every case: submit calls 0, ledger, trades and reservations unchanged, and anchor_mismatch kept after a tamper. DRY_RUN gives OWNER_SELL_SIMULATED; LIVE gives BROADCASTER_NOT_ENABLED. No confirm gives CONFIRMATION_REQUIRED. Devnet in LIVE and `MAINNET.helius-rpc.com.` both give LIVE_HOST. Slippage is the cap, the size is min(request, chain balance), and the fee comes from the chain. Behavior change: a DRY_RUN owner sell no longer closes the DB position (now documented). |
| R6-4 sell clamp | **Fixed** (signer.py:1054-1055). |
| R6-5 snapshot diff | **Not effective in the CLI flow:** see R7-1. The counter replay from the log (:1983) and the open-trade chain balance check do work. Deleting fill or sell events gives RECONCILE_REQUIRED, and so does R6-1. |
| R6-6 event key | **Partly fixed.** `init_event_key` uses token_bytes(32) and returns only a key id. Zero, repeated and low-entropy keys are refused, and so is a key equal to hmac-key. A fresh install with no key recovers: boot halts, then init-event-key, then reanchor and unhalt. The rekey/migration problems are in R7-2 and R7-5. |
| Last-event HMAC on every write (:2249) | **Fixed.** A legacy-hash or missing digest at the head halts. |
| Digest covers more tables (:98-114) | **Fixed.** Edits to whitelist, equity_day, decisions, expected_deposits, intent_hits and anchor_meta halt at the next boot or write. But see R7-1 for what reanchor then accepts. |
| ATA mint and owner check (:2066-2070) | **Fixed.** |
| Devnet-in-live means any non-live host (:2150) | **Fixed.** |

### New findings
- **R7-1 (Medium–High, blocks live): boot absorbs a tamper, so reanchor's snapshot diff compares the tampered state with itself.**
  - Cause: `_event` stamps the current state digest and the current `_book_snapshot` on every event (signer.py:1927-1930), including the boot events written right after the tamper is detected (`boot_halt_persisted`, `reconciled`, `preflight` at :266 and :278-281). `_last_snapshot` (:1965) then reads that post-tamper snapshot.
  - The CLI boots on every command except status and doctor (cli.py:312), so a tamper is always followed by a boot before `reanchor`.
  - Proof: after one closed round trip, each of these edits halts at boot, and then reanchor, unhalt and resume all succeed and the next buy is FILLED:
    - a route_approved 0→1 flip (the diff is supposed to refuse this; it does only in-process, without a reboot);
    - route_source edited, hmac_version edited;
    - a whitelist row inserted;
    - equity_day deposits_cents +$1000, or start_equity lowered to hide a loss;
    - decisions deleted;
    - a 5 SOL expected_deposit inserted;
    - a closed trade's recovered_cents edited;
    - an extra closed trade or old reservation inserted;
    - a reservation's stake_cents edited.
  - Even in-process, whitelist, equity_day and closed-trade P&L edits pass, because the snapshot covers only counts, route, mode and ledger (:1950-1963).
  - Fix:
    - While a sticky anchor_mismatch or hash_chain halt is set, or whenever `_state_event_matches` is false before the write, `_event` must carry forward the last trusted state_sha256 and snapshot, not the current ones. The owner exit already does this.
    - Reanchor should diff against the snapshot of the last event written before the first anchor_mismatch halt, and show that diff.
    - Extend the snapshot to the whitelist (hash), equity_day row, closed-trade P&L totals, decisions and intent_hits counts, and expected_deposits.
- **R7-2 (Medium, latent): rekey would bless a tamper; via the CLI it can never succeed.**
  - Where: `rekey` (signer.py:2094-2130) checks only that the legacy chain verifies, ledger == chain, and that there are no reserved or signing reservations. It runs no snapshot diff, counter replay, state-digest check or anchor check.
  - In-process proof: on a keyed DB, delete trades and reservations and rewrite the whole log as an unkeyed sha256 chain. Rekey then gives EVENT_KEY_GENESIS with the state ACTIVE and no halt, the next buy is FILLED, and a reboot comes up clean (PAUSED).
  - Truncating a migrated DB back to its legacy prefix would be blessed the same way. verify_chain (db.py:205) trusts everything before the first genesis.
  - Why it's latent: in the CLI flow, boot appends HMAC'd events before rekey runs, so `verify_legacy_chain` fails and rekey returns HASH_CHAIN. If the key is absent, boot raises (R7-5).
  - So the documented migration (README:86, DESIGN) doesn't work, and the downgrade is blocked only by accident.
  - Fix: drop the legacy migration (start a fresh DB; the old paper-trading DB shouldn't carry into live). Or make rekey:
    - one-shot, gated by a marker outside the DB (a keyring entry holding the genesis hash);
    - refused if any event carries `event_key_id`;
    - required to pass the last legacy event's state digest == current, plus the full reanchor reconcile.
- **R7-3 (Medium, blocks live): boot crashes when getBalance fails.**
  - Where: signer.py:239, `opening = self.s.chain.sol_lamports()`, outside any try. `_RpcChain` now raises on an outage, an RPC error or a missing wallet key.
  - Effect: every CLI command except status and doctor fails, including `halt` and `sell --confirm OWNER_SELL`. Only the kill file still works.
  - Fix: catch the error at boot, keep the stored ledger (or None), add a non-sticky `reconcile_unknown` buy halt, and let halt and the owner exit run.
- **R7-4 (Low–Medium): an empty anchor file counts as a match** (signer.py:2244-2245).
  - Proof: roll the whole DB back to an older, consistent copy and empty the anchor file. Boot comes up PAUSED with no halt, and today's buy count drops from 3 to 1, resetting the daily cap.
  - Leaving or deleting the anchor file catches it.
  - Rolling back the anchor file as well can't be detected by any in-directory anchor.
  - Fix: when written == 1, treat an empty file as a mismatch. Also keep a monotonic external anchor (the box heartbeat or a keyring counter).
- **R7-5 (Low): a legacy DB with the key absent makes boot raise an uncaught AnchorMismatch** (`run_preflight` → `_note` → `_write_anchor` → `_transact(mark)`, signer.py:2304 and :1910), instead of halting cleanly.
- **R7-6 (Low): getBalance has no upper bound** (cli.py:81). 2**70 is accepted. Refuse values above u64 max.
- **R7-7 (Low/Info): the fee cap fails closed, which includes the owner exit.**
  - 125 + 10 = 135 bps matches the only recorded on-chain tier (0/95/30 at slot 470726647). pump-public-docs 639b87f FEE_PROGRAM_README sets no maximum; tiers are a pump-controlled schedule.
  - Whether a legit fee above 135 is possible: only if pump raises its fee schedule. If that happens, every trade is refused, including the owner exit.
  - Suggestion: give the owner exit a separate, higher explicit ceiling (for example 300 bps, behind typed confirmation), and add a doctor warning showing the current fee config total.
- **R7-8 (Info, for the broadcaster PR):** the broadcast gate is a duck-typed `enabled` attribute (signer.py:1082). A LIVE Zoora sell with any `enabled=True` object submits the unsigned bytes and records `BROADCAST_ACCEPTED` under kind `sell_refused`, without touching trades or the ledger. The broadcaster PR needs:
  - an explicit broadcaster type;
  - signing inside the policy gate;
  - defined trade and ledger semantics for accepted, confirmed and failed sends.

---

## Re-check 8 (850394f)

Head 850394f9d70b300f7ab7a65a14315cf8a07cceb8 (was 346b134). Commits 70d06b2 and 850394f. 12 files, +840/-196. CI run 44230718342 passed: test ubuntu, test windows, package and validator, 9:28–9:31 PM CST on Nov 17. The PR is still an open draft. Everything below is read-only work in /tmp/zsec-signer with fake throwaway keys. No mainnet, no RPC with funds, no pump.fun.

**Verdict: GO as no-broadcast code. NO-GO for live.** Every R7-1 tamper is now refused across real CLI reboots, and R7-2, R7-4, B5 and item 6 hold. Besides the broadcaster PR, two things still block live:
- **R8-2:** the R7-3 fix doesn't hold. `reconcile_unknown` is wiped by `resume` and by every buy.
- **R8-3:** LIVE never compares the chain balance with the ledger. This has been there since the first commit; I missed it in earlier rounds.

R8-1 (reanchor can't clear a real halt) and R8-4 (the owner exit after a tamper builds nothing) should be fixed before live.

### Tooling
- **Tests:** 154 passed, three runs in a row.
- **Static checks:** ruff clean, mypy --strict clean (22 files), pip-audit clean on the lock.
- **gitleaks v8.21.2** (checksum verified): no leaks on 346b134..850394f, on 73afd9d..850394f with the project config, or on a dir scan.
- **Build:** a local hash-locked `python -m build --no-isolation` worked.
- **No sign or send path:** the only `sign_message` is signing.py:17/21, which nothing calls. No sendTransaction anywhere. cli.py:240 wires only `RefuseBroadcaster` (kind REFUSE).
- **Soak:** 15 cycles with real `cli.main reboot` and `status` calls, halt/resume, buy, sell, whitelist_add, owner exit, sell_all, exits and expect_deposit, plus an RPC outage every third cycle. No false halts, and the final reanchor (with no halt set) was REANCHORED.

### Per-item status
| Item | Status |
|---|---|
| R7-1: boot carries the trusted snapshot | **Fixed.** I re-ran all 16 tampers with a real CLI reboot in between. Every one stays HALTED (anchor_mismatch); reanchor gives RECONCILE_REQUIRED with the right diff keys (route_approved, route_source, hmac_version, whitelist_sha256, equity_sha256, decisions_sha256, expected_deposit_lamports, closed_pnl_cents, trade_count, reservation_count, simulated_open, state_sha256, or ledger/open_tokens for the R6-1 replay); unhalt and buy give ANCHOR_MISMATCH. The variants hold as well: a tamper then two reboots; a tamper while owner-halted (reasons anchor_mismatch,owner, resume refused); a tamper then an owner exit (with or without a reboot first); truncating events back to before the halt and reverting the state (B5 prefix refuses); a digest-only edit (reservation stake: the diff shows state_sha256, refused). The diff can't be gamed: `state_sha256` is part of the diff, so any byte change in the covered tables refuses. Catch: see R8-1. |
| R7-3: getBalance failure | **Partly fixed.** Boot no longer crashes, the stored ledger is kept, and `halt` and the owner exit run. But the buy halt is wiped: see R8-2. |
| R7-2: rekey and the sha256 prefix removed | **Fixed** (db.py:200-228; every event needs an HMAC and `event_key_id`). A keyed DB with the key removed halts cleanly (anchor_mismatch,hash_chain), and halt and the owner exit still run. |
| R7-4: empty or missing anchor | **Fixed.** A restore with the anchor emptied or deleted halts. A restore with the anchor rolled back as well isn't detected (expected; needs an external anchor). |
| HoS B5: anchored prefix | **Fixed.** A DB restored mid-run halts on the next write. |
| Lows | **Fixed.** The u64 bound is in (cli.py:82). OWNER_SELL_HIGH_FEE can only come from the CLI `sell --confirm`: Telegram can only halt, intents go through `_sell(owner=False)`, and `sell_all` passes OWNER_SELL. The doctor warning is present. |
| Item 6: BroadcasterKind | **Fixed.** There's no config, env or entry-point path to a LIVE kind; cli.py:240 hard-wires `RefuseBroadcaster`; the check is identity, `is BroadcasterKind.LIVE` (:1187). With an injected LIVE-kind recorder, a LIVE Zoora sell submits and records `broadcast_result` BROADCAST_ACCEPTED, or BROADCAST_FAILED when submit raises. In both cases the trade stays open and the ledger doesn't move. The exception text (an RPC URL) is not logged. The LIVE owner exit never calls submit. |
| HoS R2: simulated trades | **Fixed.** `set_mode LIVE` with an open simulated trade gives SIMULATED_FILL and stays in DRY_RUN. A DRY_RUN owner exit closes from the ledger, but never after a tamper (it records an event only). But the paper ledger carries into LIVE: see R8-3. |

### New findings
- **R8-2 (High, blocks live): `reconcile_unknown` is wiped by `resume` and by every buy.**
  - Boot sets `buy_halt_reason = 'reconcile_unknown'` (signer.py:286-288). But `_refresh_buy_halt` (:1839-1852) unconditionally overwrites buy_halt_reason with daily_loss, wallet or None. It runs in `resume` (:487) and in every buy (:1328).
  - DRY_RUN proof: getBalance fails at boot, then buy gives FILLED.
  - LIVE proof: getBalance fails at boot; `resume` gives RESUMED with buy_halt None; the buy then reaches the signing stage (SIGN_REFUSED). So the stale-ledger buy the fix was meant to stop goes ahead.
  - The next successful boot also clears the reason (:290-291) without checking ledger == chain.
  - Fix:
    - Make reconcile_unknown a reason `_refresh_buy_halt` preserves (or a separate column).
    - In LIVE, clear it only after a successful finalized getBalance where ledger == chain. Otherwise raise unexpected_sol.
- **R8-3 (High, blocks live; present since 9a395d9, missed in earlier rounds): LIVE never compares the chain balance with the ledger.**
  - `observe_sol` (signer.py:728), the only path to deposits and unexpected_sol, has no production caller; only tests call it.
  - Boot reads getBalance but uses it only when the ledger is NULL. `set_mode LIVE` doesn't reconcile either, so a DRY_RUN paper ledger carries into LIVE.
  - Proof: in LIVE with the ledger at 100,000,000 and the chain at 30,000,000, 50,000,000 or 1,100,000,000, the reboot comes up clean and the buy reaches signing.
  - Effect: an externally drained wallet goes unnoticed, and so does SOL above the $25 cap, because the wallet cap and daily-loss math run on the ledger.
  - Fix:
    - In LIVE, compare a finalized getBalance with the ledger at boot, on set_mode LIVE, on every poll interval and before each buy reservation.
    - Route any difference through observe_sol (whitelisted deposit or unexpected_sol halt).
    - set_mode LIVE should set the ledger from the chain and require no paper P&L carry-over.
- **R8-1 (Medium, fails closed; fix before live): reanchor can never clear a real anchor_mismatch.**
  - Cause: `_state_digest` hashes the whole signer_state row (signer.py:114-135), including `activity`, `halt_reason` and `boot_id`. The halt and every boot change those. The trusted digest predates the halt, so reanchor's diff always contains state_sha256.
  - Proof:
    - A tamper reverted exactly, then a reboot: reanchor gives RECONCILE_REQUIRED, with only state_sha256 differing. The only differences are activity, halt_reason and boot_id; restoring those three by hand gives REANCHORED.
    - A false halt from a deleted anchor file is also permanent.
    - **The documented first-run step bricks a fresh DB.** CLI `init-event-key` boots before storing the key: hash_chain halt, then key stored, then anchor_mismatch,hash_chain. resume, reanchor and unhalt are all refused. The only way out is deleting the DB.
  - Fix:
    - Exclude the volatile signer_state columns (activity, halt_reason, buy_halt_reason, boot_id, provider_name) from the reanchor comparison, or compute a separate "book" digest for it. Keep halt edits caught by the sticky-reason logic.
    - Have `init-event-key` run without booting (attach plus key store only).
- **R8-4 (Medium; fix before or inside the broadcaster PR): the owner exit after a tamper builds nothing.**
  - `_owner_exit` returns `_record_owner_exit(..., tamper=True)` (signer.py:805-806) without building the chain-sourced sell that R7 had. Once broadcasting exists, a tampered DB (which R8-1 makes unrecoverable) leaves the owner no exit through the signer.
  - Fix: restore the chain-only build (curve, mint, fee and ATA from the chain; validate_transaction; no ledger write) on the tamper path, and hand it to the broadcaster under the same LIVE gates.
- **R8-5 (Low): halt events pile up on every boot while halted.** A fresh-install brick produced 8 `halt` events in two boots.
- **R8-6 (Info):** `sell-all` passes OWNER_SELL itself (signer.py:1216), so that CLI command skips the typed confirmation. It's owner-only, but consider requiring `--confirm`.
- **R8-7 (Info, design limit):** rolling back the whole DB together with the anchor file isn't detectable. That needs an external monotonic anchor (the box heartbeat or a keyring counter), which the broadcaster PR's box-to-PC link could carry.

---

## Re-check 9 (de3d36c) — 2026-11-17 ~9:58 PM CST

Head de3d36cb5b644c68e6d8ea27504f733b158eb12f, CI 44232961776 green (4 jobs, 9:48–9:51 PM CST), PR still draft. Read-only; scratch /tmp/zsec-signer (700), removed afterwards.

**Tooling:** pytest 164 passed ×3; ruff clean; mypy --strict clean (22 files); pip-audit (lock) no known vulns; gitleaks v8.21.2 (sha256 verified) 850394f..de3d36c, 73afd9d..de3d36c, dir scan: no leaks; hash-locked venv + `python -m build --no-isolation` builds sdist+wheel. No sign/send path: `sign_message` only defined (signing.py:17/21), never called; only broadcaster wired is RefuseBroadcaster (cli.py:241); `submit` (signer.py:1350) gated on BroadcasterKind.LIVE, enum = {REFUSE, LIVE}.

### SE claims — verified by probe
- **R8-2 FIXED.** RPC down → `reconcile_unknown`; survives resume, poll, reboot (DRY_RUN and LIVE); buy refused (RECONCILE_UNKNOWN / BUY_HALT). `_refresh_buy_halt` (signer.py:2005-2009) leaves non-derived halts. Buy guard with RPC down mid-LIVE → RECONCILE_UNKNOWN.
- **R8-3 FIXED (detection).** LIVE poll/boot/buy/set_mode compare finalized balance vs ledger; 30M/50M/1.1B vs 100M and ±1 lamport all → `unexpected_sol`. Exact-match only, so no slow-drain threshold. Over-cap adoption: 1.1B and 10B lamports go LIVE but `wallet` buy halt binds (BUY_HALT); 100M/250M (≤$25) proceed to SIGN_REFUSED. **But see R9-1: the halt is bypassable.**
- **R8-1 PARTIAL.** Exact-reverted tamper reanchors; route/ledger tampers + deleted anchor → reanchor RECONCILE_REQUIRED (anchor not restored); boot never auto-restores. CLI first-run (init-event-key) works. **But the book-digest exclusions let real cap-relevant timestamp tampers be blessed (R9-2).**
- **R8-4 FIXED.** `_live_owner_exit` (signer.py:1005-1064) is chain-sourced, builds+validates unsigned sell, records only an event (`carry=tamper`), no ledger write; LIVE returns BROADCASTER_NOT_ENABLED.
- **Lows:** sell-all without/wrong `--confirm` refuses (trade stays open). Halt dedupe works for the deleted-anchor case only (R9-4). DESIGN.md:272 external anchor note present.
- Soak: 300 random DRY_RUN steps with CLI reboots + RPC outages → 0 false halts.

### New findings
**R9-1 (High, live blocker) — `set-mode live` re-adoption launders any unexplained SOL change and resets the daily-loss baseline.** signer.py:623-668 / `_adopt_chain_ledger` :866-904. `set_mode("LIVE")` is accepted while already LIVE and while halted on `unexpected_sol`; it sets ledger = chain and rewrites today's `equity_day.start_equity_cents` (withdrawals/deposits = 0). Probe: LIVE, chain −30M (30% drain) → unexpected_sol, UNHALT = RECONCILE_REQUIRED → `set_mode LIVE` → ledger 70M, start_equity 700 → UNHALT = UNHALTED → RESUMED → buy reaches SIGN_REFUSED. Same for −1, +1, +5M. This defeats the R8-3 reconcile and the daily-loss cap intra-day (re-baseline after losses). Fix: refuse adoption unless transitioning DRY_RUN→LIVE with no halt/non-derived buy halt and no prior LIVE today; never reset equity_day downward (carry realized/unrealized live loss); make re-baseline a separate typed-confirm command that logs the delta and requires the explanation (expected deposit/withdrawal).

**R9-2 (Medium) — Book digest skips timestamps that feed caps; reanchor blesses those tampers.** signer.py:114-125 (`_BOOK_SKIP`: opened_ms, created_ms, added_ms, seen_ms, buy_halt_reason) used by reanchor. Probe: 4 buys → 5th RATE_LIMIT; `UPDATE reservations SET created_ms = created_ms - 7200000`; reboot → anchor_mismatch; reanchor → REANCHORED (diff empty), UNHALT, RESUME → hourly count 0, buy FILLED. Also blessed: `trades.opened_ms +10h` (time stop, :1403) and `intent_hits.seen_ms` (:2025); created_ms also drives the unconfirmed-signing expiry (:2072). Daily cap (ct_day) and expected_deposits (diff caught) still protected. Fix: keep these fields in the book digest; only exclude genuinely free-form fields (activity/halt text/boot_id), or compare them against the trusted snapshot.

**R9-3 (Medium) — DRY_RUN can never clear `reconcile_unknown`.** signer.py:326-334 clears only when `live`; poll/guard read balance only in LIVE; unhalt doesn't touch buy_halt. One RPC blip at boot/poll leaves DRY_RUN buys halted forever (reboot, resume, RPC back → still BUY_HALT). The only exit is `set-mode live` — a perverse incentive to go live to unblock paper trading. Fix: in DRY_RUN clear on a successful finalized read (paper ledger isn't compared), or provide an owner `reconcile` command.

**R9-4 (Low) — Halt events still repeat on every boot of a tampered DB.** Each boot after a state tamper (e.g. route_approved flip) writes boot_halt_persisted + reconciled + 3× `halt {reason: anchor_mismatch}` with an unchanged halt set. The test (test_recheck8.py:202) only covers the deleted-anchor case.

**R9-5 (Low) — `expect-deposit` is dead in LIVE; dust = sticky halt.** poll/boot/guard call `_observe_sol_db(balance, None)` (source None → never whitelisted), so even an announced owner deposit (expect_deposit 5M then +5M) → unexpected_sol; any third-party 1-lamport dust halts LIVE. Today the only recovery is the R9-1 re-adoption. Fix together with R9-1: let poll match an unconsumed expected deposit of the exact delta (source check via a getSignaturesForAddress lookup in the broadcaster PR), and document dust handling.

**R9-6 (Low) — Rollback + deleted anchor is blessed by reanchor.** A restored DB backup with the anchor deleted → reanchor REANCHORED and the anchor is recreated at the older count (14 vs 17). Same class as R8-7; the owner sees only "anchor missing". Fix: print the restored count/head and the last known count in the reanchor diff, and refuse without the external monotonic anchor once it exists.

**R9-7 (Info)** — The buy guard does an RPC `getBalance` inside the BEGIN IMMEDIATE transaction (:1490), holding the DB write lock for the RPC timeout. Entering LIVE with a matching balance leaves `reconcile_unknown` set until the next guard (cosmetic). Finalized commitment will lag the ledger after a live fill by ~13 s, so the broadcaster PR must order ledger updates against finalized reads to avoid false unexpected_sol halts.

### Verdict
- As no-broadcast code: **GO** (no sign/send path; all tools clean; R8-2/R8-3/R8-4 detection fixed). R9-1/R9-2 must be fixed before the broadcaster PR.
- Live: **NO-GO** (R9-1 High, plus the broadcaster PR and the owner/HoSec sign-offs still outstanding).
