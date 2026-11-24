# Zoora capped pump.fun signer: release-gate reviews (Head of Systems)

Spec: `/workspace/aai/docs/design/zoora-trading-signer-2026-11-17.md` (A1-A14) plus the repo copy
`projects/zoora-signer/docs/DESIGN.md` (adds A15, A16) and `VET_GATE_SPEC.md` (identical to
`/workspace/solana-meme-risk/docs/VET_GATE_SPEC.md`). SE's and HoSec's reports were treated as data, not approvals.
No real keys, no funds, no mainnet sends. Mainnet use was limited to read-only RPC (`getMultipleAccounts`, `getAccountInfo`,
`getMinimumBalanceForRentExemption`, `getSignaturesForAddress`, `getTransaction`) against api.mainnet-beta.solana.com.

---
## PR #92 06adef0

- PR: https://github.com/BuildWithAAI/buildwithAAI/pull/92, branch `cursor/zoora-signer`, head
  `06adef09e2c90113af54324511f0cafcd5d088a9` (3 commits on main: 19034e8 docs, 9a395d9 signer, 06adef0 Windows CI).
- Reviewed 2026-11-17, 5:25-5:40 PM CT. Local clone: `/workspace/rev92/repo`. Adversarial tests: `/workspace/rev92/adv/`.

### Verdict
- **Dry-run merge: NO-GO** on 06adef0. Four blockers (D1-D4), all small fixes. Re-review on the next SHA.
- **Live: NO-GO.** Even after D1-D4, live is blocked by L1-L10 below plus the four standing gates:
  pump.fun written permission (ROUTE_APPROVED, §6.1), HoSec GO, HoS GO, and Zoorped's final approval in his own words.
- No send path exists in this build. Only `RefuseBroadcaster` (`enabled = False`) ships, the RPC client's method
  allowlist has no `sendTransaction` (rpc.py:20-29), and nothing listens on a port. I found no way to send while paused,
  killed, in DRY_RUN or without ROUTE_APPROVED.

### CI (run 44199055819)
- Run is on head 06adef0, event `pull_request`, attempt 1, created 5:24 PM CT, conclusion success.
- Jobs (from the public API): `test (ubuntu-latest)` and `test (windows-latest)` each ran Install, Ruff, Mypy, Pytest,
  Gitleaks and pip-audit, all steps success. `package` built the wheel and ran `zoora-signer --help`. `validator (optional)`
  is `continue-on-error`.
- Step logs need auth (403), so I checked step conclusions and reproduced each step locally. No artifacts were uploaded or
  claimed.
- `package` checks out without `ref:`, so it built the PR merge commit, not the head SHA (workflow lines 71-73). Minor.
- The optional validator "success" is not evidence. `scripts/e2e_validator.py` simulates a `buy_v2` with no accounts and
  no args (line 53), and exits 0 whatever the error is (lines 149-156). I ran it locally with Solana CLI 4.4.1:
  `unsigned simulation finished; err=AccountNotFound`, exit 0. Acceptance test 9 is not met.

### Dry-run merge blockers
- **D1. Vet gate bypass.** `signer.py:221-228` calls vet only if `_preview_allows()` passes. Otherwise it still calls
  `_buy(intent, reading, None)`, and `_buy` (`signer.py:567-635`) never checks the assessment. Any state change between
  the preview transaction and the reservation transaction lets a buy through with no vet at all. Examples are a CT midnight
  rollover, an hourly rate-limit window expiring, a mark moving, or a slot freed by another process.
  Repro: `adv/test_adv_gates.py::test_F1_vet_bypass_on_ct_midnight_rollover`. With 10/10 buys used and the vet stub
  scripted to FAIL, a buy at 23:59:59.999 → 00:00:00.000 CT is `FILLED` with zero vet calls.
  Fix: vet unconditionally before reserving (after the cheap cap preview), and inside the reservation transaction require
  `assessment.ok` for side=buy.
- **D2. No 1-buy-per-10-min limit anywhere.** `caps.py:47-48` enforces only 4/hour (`constants.py:85`). A1 puts the
  10-min rule in Lumen, but the decision engine isn't in this PR. SE also said it is enforced "in both Lumen and the signer".
  Repro: `test_F2_no_ten_minute_spacing_in_signer` shows two buys 60 s apart, both accepted.
  Fix: in `evaluate_buy`, refuse if the last buy reservation that reached signing or is still reserved is under 600 s old.
- **D3. The hash chain doesn't protect what it logs, and resume clears a chain failure.**
  - `db.py:160` hashes only `prev ‖ payload`, so `kind`, `ts_ms` and `id` can be edited undetected.
    Repro: `test_chain_does_not_cover_kind_or_ts`, which renames `owner_resume` to `note` and sets ts=1, and `verify_chain`
    still returns True.
  - `signer.py:273-275`: owner `resume` clears a `hash_chain` halt without re-verifying.
    Repro: `test_owner_resume_clears_hash_chain_halt`.
  - Fix: hash over `prev ‖ id ‖ ts_ms ‖ kind ‖ payload`, make `prev_hash` UNIQUE as the design says, and have resume
    re-run `verify_chain` and refuse on failure.
- **D4. A placeholder key is not refused, and a non-allowlist exception strands the reservation.**
  - `secrets.py:59-67` accepts any string; `doctor` (`signer.py:199`) passes `signing_key` for `<owner provisions>`.
  - In `_settle_buy`, `_payer()` then raises `ValueError` from `Keypair.from_bytes`. Only `AllowlistError` is caught
    (`signer.py:658-671`), so the exception escapes and the reservation stays `reserved`. It holds a slot and a daily buy
    until reboot.
  - Repro: `test_placeholder_key_boots_and_strands_reservation`.
  - Fix: validate at boot and in doctor that the key parses as a 64-byte keypair. Refuse to boot otherwise, as A13 and the
    brief require. Wrap all of settle in `try/except Exception → _release(...)`.

### Live blockers (in addition to D1-D4 and the four gates)
- **L1. The transaction builder is a stub.**
  - `buy_v2` in the pump IDL at the pinned commit 639b87f takes 27 accounts and args `amount, max_sol_cost, partial_fill`.
    `txbuild.py:65-69` passes 2 accounts and no ATA create.
  - It puts the slippage-reduced quote into `amount`, the exact token amount to buy. There is no min-out on buy; slippage is
    `max_sol_cost`.
  - The quote is hard-coded: `token_out=1_000_000` (`signer.py:665`) and `tokens=1_000_000` (`signer.py:715`).
  - The "live" path signs and submits ad-hoc concatenated bytes, not a serialized transaction (`signer.py:681-684`,
    `1290-1291`). Owner and Zoora sells never build a transaction at all (`signer.py:757-857`).
  - `quote.tokens_out/sol_out/decode_global_fee_bps` are never called.
  - Repro: `test_buy_v2_layout_vs_idl`, `test_live_path_submits_unsigned_message_bytes`.
- **L2. Fees and all-in accounting.**
  - The on-chain fee is not 95 bps. Pump Fees `fee_config` `8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt` (owner
    `pfeeUxB6…VZ`) currently has one tier: protocol 95 + creator 30 = **125 bps**. The global account also shows
    `creator_fee_basis_points` 5. The 95 bps read from Global is only the protocol part.
  - `Services.fee_lamports` and `ata_rent_lamports` default to 0 (`signer.py:82-83`), and the CLI never sets them
    (`cli.py:67-80`). With a Token-2022 ATA (170 bytes, rent 1,513,840 lamports, read on mainnet today) plus the 5,000 base
    fee, the all-in cost at SOL $74.95 is **$2.114**, which breaks the $2.00 all-in cap (`test_all_in_defaults_exclude_rent_and_base_fee`).
  - `SetComputeUnitPrice` is passed lamports where it expects micro-lamports per CU (`txbuild.py:92-98`).
  - Rounding: `sol_usd_cents` truncates the price down (`models.py`), so the stake can exceed $2 by ~0.03¢
    (`test_price_truncation_overspend`: $2.000267). Round in the conservative direction.
- **L3. Runtime wiring is stubs.**
  - `cli.py:24-80` uses `_DownOracle`, `_NoMarks`, `_Chain` (non-authoritative, 0 SOL) and `_ClearKill`, so the
    agent-guard killswitch is never polled. There is no intent feed and no run loop.
  - Pyth Hermes public `/v2/updates/price/latest` returns 401 from the box too. The code fails closed
    (`test_pyth_401_fails_closed`), but live needs a keyed Hermes or the on-chain sponsored Pyth SOL/USD account
    `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` (exists, owner `rec5EKMG…FJ`), read through Helius.
- **L4. Reconcile releases possibly-landed transactions.** `signer.py:1036-1052`: with `chain.authoritative=False`, a
  `signing` reservation is marked `released/unconfirmed` on reboot. It must HALT unless the chain answer is authoritative.
- **L5. Phantom fill in LIVE.** `signer.py:672-689`: if a halt lands between the reservation commit and settle, `live`
  goes False and the code falls through to a *simulated* fill. That books an open trade and debits the ledger in LIVE mode.
  It should release instead (`test_F_phantom_fill_in_live_mode_when_halt_races_settle`).
- **L6. Owner sell can fail under a kill.** It returns `UNPRICEABLE` whenever the mark is unknown (`signer.py:813-815`).
  The owner exit must not depend on the mark/oracle; use a curve min-out.
- **L7. PC checks.**
  - The CLI probe has only the w32tm sample, so `time_skew_ms()` is always None and the signer can never resume on Windows
    (`preflight.py:131-145`, `cli.py:52-55`). That fails closed, but the second time source from A15 is missing.
  - `parse_whoami` (`preflight.py:63-67`) misses a non-elevated member of Administrators ("deny only"), which A15 #4 says to
    refuse.
  - The A15 #5 ACL check isn't applied to the Credential Manager entries.
- **L8. Acceptance test 9** (local validator with a real cloned curve, plus mainnet unsigned simulate) is not done; see CI.
- **L9. Loss and exposure measurements that aren't conservative.**
  - A deposit is booked at $0 when the oracle is down (`signer.py:423-434`), which masks loss
    (`test_deposit_booked_at_zero_when_oracle_down_masks_loss`).
  - The start-of-day equity snapshot counts unknown marks as $0, understating start equity and hence loss
    (`signer.py:986-999`).
  - A moon bag with an unknown mark counts $0 toward exposure and the wallet (`signer.py:960-973`,
    `test_moon_bag_with_unknown_mark_counts_zero_exposure`).
  - Wallet cents are truncated (`test_wallet_truncation_rounds_down`).
  - Fix: refuse or halt when any mark is unknown; for moon bags use last-known mark or cost.
- **L10. Intent lifetime is checked only on entry.** `signer.py:214`: an intent issued 89 s ago plus a 45 s vet is reserved
  134 s after issue (`test_ttl_not_rechecked_after_slow_vet`). Re-check the 90 s TTL inside the reservation transaction.

### Non-blocking notes
- `parse_intent` accepts `usd_stake_cents` 0..200 (`signer.py:1259`). A1 fixes the size at $2. Require 200, or at least >0.
  A zero stake fills and burns a slot (`test_zero_stake_is_accepted_and_burns_caps`).
- The 4/hour counter includes refusals and Zoora's sells (`signer.py:780-785`, `1139-1142`). That is conservative, but bad
  intents can lock out Zoora's exits for an hour. Owner sells are unaffected.
- The secret screen only matches hex forms of the keys (`signer.py:1172-1183`). The raw HMAC text was written to the log
  unflagged (`test_secret_screen_misses_raw_form`); the RPC URL is caught. The signing key is also read from Credential
  Manager on every event.
- HMAC is verified over the raw dict in `handle_intent` but over the re-serialized `intent_wire` in `pull_once`
  (`signer.py:246`). Pin one canonical wire format with Lumen.
- The vet signature message uses `str(evaluated_at)`, so `1763400000` and `1763400000.0` differ (`test_vet_signature_binds_mint`).
  Pin the canonical format in the vet/1 spec before vet moves out of process.
- `pull_once` pushes the whole event log on every pull (`signer.py:250`).
- Every CLI command boots the signer. That resets activity to PAUSED and clears `halt_reason` (`signer.py:128-137`), so
  `zoora-signer status` pauses a running instance and drops the halt reason from state (it stays in the log).
- `sweep` has dead code (`signer.py:458-459`) and only books a ledger change; it never sends.
- The repo's concurrency test is threads in one process (`tests/test_02`). The crash test inserts rows from a probe rather
  than killing the signer. My multi-process and kill -9 tests below cover both.

### Verified OK
- **Program IDs** (mainnet `getMultipleAccounts`, today):
  - Pump `6EF8…F6P`, PumpSwap `pAMM…EA`, Token-2022, SPL Token, ATA and ComputeBudget are all executable.
  - Global `4wTV…njf` is owned by Pump, with discriminator `a7e8e8b1c86c727f` and `fee_basis_points` 95 at the offset
    `quote.py` uses.
  - PumpSwap global config is owned by PumpSwap.
  - The 8 most recently traded pump mints are all Token-2022.
  - `buy_v2` and `sell_v2` discriminators match the IDL at 639b87f.
- **Caps at the boundary:**
  - stake 200 ok / 201 refused (float 2.00499 → 200 ok, 2.0051 → refused);
  - slippage 1500 ok / 1501 refused;
  - open trades 3;
  - buys/day 10 (9 seeded + 1 ok, then BUYS_DAY);
  - daily loss 400 + 200 = 600 ok, 401 refused;
  - exposure 1800 + 200 = 2000 ok, +1¢ refused;
  - wallet $25.00 ok, $25.01 halts buys.
- **Concurrency:**
  - 6 rounds × 8 separate processes on one DB: exactly 3 reserved or filled every round, with ledger rows matching.
  - 6-process race on the 10th daily buy: exactly 1.
  - kill -9 inside `BEGIN IMMEDIATE`: nothing partial, and the next boot is PAUSED and resumable.
  - kill -9 after the reservation commit: reboot is PAUSED, the row is `released/reboot`, and the chain verifies.
- **Kill:**
  - owner halt, agent-guard killed and agent-guard unreachable all HALT, and resume refuses while killed;
  - Zoora's sells are refused (`KILL_HOLD`);
  - scheduled hard stops and time stops are suppressed;
  - owner sell works;
  - every boot is PAUSED.
- **Route:** LIVE is refused without ROUTE_APPROVED, boot forces DRY_RUN without a route, and the route source is in the chain.
- **Vet and oracle:**
  - vet UNKNOWN and FAIL block; the signature binds the mint;
  - Helius 429 → UNKNOWN after 3 backoffs, and `sendTransaction` → METHOD_DENIED;
  - oracle 30 s / 1% / 2% boundaries are exact, and Pyth 401 → ORACLE_DOWN → HALT.
- **Secrets:** a forbidden env var refuses boot and the CLI exits 2. Doctor prints only pass/fail. Events and the HUD file
  log the provider name only.
- **gitleaks 8.30.1:** clean over the 3 PR commits' history, and over the tree with and without the repo allowlist.
  pip-audit is clean.

### Tests run (all local, Python 3.13.5)
- Repo suite: `pytest` 39/39 passed; `ruff check` clean; `mypy --strict` clean; pip-audit clean; gitleaks clean.
- `scripts/e2e_validator.py` with Solana CLI 4.4.1 ran, giving `err=AccountNotFound`, exit 0. That makes it vacuous.
- Adversarial (`/workspace/rev92/adv/`): 41 tests, all passing. Several of them assert that a defect exists, namely D1-D4,
  L1, L2, L5, L9, L10 and the notes.
  - `test_adv_gates.py` (13): cap boundaries, float rounding, the D1 and D2 repros.
  - `test_adv_paths.py` (23): send paths, kill/route, the hash chain, secrets, vet/TTL, oracle, 429, fees/ATA/priority
    units, and the IDL layout.
  - `test_adv_procs.py` (4): multi-process races and kill -9.
  - `test_adv_fuzz.py` (1): a Hypothesis property fuzz, 2,000 random sequences of buy, sell, owner sell, mark moves and
    clock jumps. Invariants: every accepted buy was vetted; ≤ 3 open; exposure ≤ $20; ≤ 10 per CT day; ≤ 4 per hour.
    No counterexample; the D1 window needs ms-precise timing, which the targeted test covers.

## PR #92 70180eb

Head `70180eb175924b944b4a74fdfec07385079a4199` (commits 3ae15b6, 70180eb; 38 files since 06adef0). Delta review, judged as dry-run code only. SE's claims treated as data and verified independently.

### Verdict
- **Dry-run merge: NO-GO, on one small blocker (V1).** D1-D4 are fixed and verified, and no path can send. Once V1 is fixed (a few lines), I expect GO without another full review. A re-run of the validator script and adv2 is enough.
- **Live: NO-GO.** L1 and L2 are still placeholders, and the new live items are listed below.

### CI
Run 44205332184 ran on head_sha 70180eb (pull_request, attempt 1, created 6:08 PM CT). These jobs succeeded: test (ubuntu), test (windows), each with ruff, mypy, pytest, gitleaks and pip-audit; package; and validator (optional, `continue-on-error: true`). Note that the validator job's green result means nothing, because of V1.

### Dry-run blocker
- **V1. The validator script can't fail.** In `scripts/e2e_validator.py:246-252`, the loop over PUBLIC_RPCS breaks only on success. After the loop, the script always prints "unsigned buy_v3/sell_v3 simulation finished with no error" and returns 0.
  - Repro: I corrupted the first byte of the BUY_V3 and SELL_V3 discriminators. Every attempt failed with `InstructionFallbackNotFound (0x65)` on all RPCs, yet the script printed "finished with no error" and exited 0.
  - The success message is false, so SE's claim that "the validator simulates buy_v3/sell_v3" isn't actually tested by CI.
  - With the correct discriminators, the simulation does pass (buy_err=None and sell_err=None in 2 of 2 instrumented runs). The first RPC attempt sometimes logs "Program is not deployed" because the cloned program activates too early, and the second attempt then passes.
  - Fix: after the loop, `if buy_err is not None or sell_err is not None: print errors; return 1`. Also add a warm-up of one slot (or retry) before the first simulation. Add a test that runs the script with a known-bad discriminator and expects a non-zero exit.

### D1-D4 status (all fixed)
- **D1 (vet).** Every buy is vetted before the reservation (`signer.py:249-251`), and `_vet_fresh` is checked again inside the reservation transaction (`signer.py:629-645`, `985-1005`). Probes:
  - A PASS for another mint gives WRONG_MINT.
  - `evaluated_at` 16 s old gives STALE, after one re-run.
  - A verdict that is 14.999 s old at vet time and expires 2 ms later, before the transaction, is refused with no trade.
  - Replaying the same intent_id returns the stored decision with no second fill, even if the body is changed to another mint and re-signed.
- **D2 (10-min and hourly windows).** RATE_LIMIT applies within 10 min (`caps.py`). Probes:
  - It survives a restart (`Signer.open` on the same DB).
  - It survives the CT day rollover: a buy at 23:55 CT blocks a buy at 00:01 CT, and allows one at 00:05:00.001 CT.
  - A wall-clock rollback of 1 h still gives RATE_LIMIT.
  - Released reservations still count toward the window (conservative). Refusals and sells don't.
  - In the 8-process race, exactly 1 buy wins each round.
  - Fuzzing (2000 examples) confirms all accepted buys are at least 600,000 ms apart and at most 4 fall in any hour.
- **D3 (hash chain).** `event_digest` covers id, ts, kind, prev and body (`db.py`). Tampering with kind or ts is detected. A broken chain blocks resume (`signer.py:284-317`) and unhalt (`319-344`). Tail truncation is still undetectable without an external anchor (live item).
- **D4 (placeholders and settle).** All builders and `assert_allowlisted` raise PlaceholderBuilder (`txbuild.py`). LIVE + route + ACTIVE + an enabled broadcaster gives PLACEHOLDER_BUILDER (`signer.py:733-744`), with zero submits. An exception in `_fill` gives SETTLE_ERROR and the reservation is released (`signer.py:717-724`).

### No-send confirmation
- grep found no `sendTransaction`, `submit`, `sign_message` or `Keypair` use in src, other than `RefuseBroadcaster` and `signing.py`.
- With a recording broadcaster that has `enabled=True`, these submitted 0 payloads:
  - a DRY_RUN buy;
  - a LIVE buy (PLACEHOLDER_BUILDER);
  - a LIVE owner sell;
  - sweep (PLACEHOLDER_BUILDER).
- The validator script only calls simulateTransaction with sigVerify=false, against a local validator.

### Forged Date header (judgement)
`preflight.time_skew_ms` takes the max of the self-reported w32tm offset and one HTTPS Date header from the keyring RPC URL (`cli.py` `_probe`).
- Probe: w32tm offset 0.1 ms plus a monkeypatched HEAD whose Date mirrors a wrong local clock gives skew ≤ 2000 → pass. So one attacker-controlled RPC (or an attacker who controls both the local clock and that RPC) is enough.
- If the source is unreachable, the check returns None (fail-closed), which is correct.
- **Acceptable for dry-run**, since the clock affects only TTL, windows and the CT day, and nothing signs.
- **Blocks live (L7 reopened).** Live needs at least 2 independent HTTPS Date sources from different operators, not the RPC itself, and must refuse when they disagree.

### Still blocks live
1. **L1/L2 held.** These are fail-closed placeholders. Fee is 125 bps (fee_config 8Wf5…). ATA rent of 1,513,840 lamports plus the base fee pushes a "$2" buy to about $2.11, and price truncation still overspends ($2.000267 in the adv test). The all-in $2 must include these.
2. **Pyth staleness.** The on-chain account `7UVimf…` was older than 30 s in 12 of 30 samples (4 s apart; max 54.7 s, sawtooth pattern). The 30 s limit will halt or refuse often. Either crank or post the update, or choose an age limit and a fallback deliberately. The parser doesn't check the discriminator or verification_level (`oracle.py`).
3. **The CLI wires stubs.** `_DownOracle`, `_NoMarks` and `_Chain` are used, while OnchainPyth, ChainJupiterOracle and HeliusRpc aren't wired (`cli.py`).
4. **Kill switch semantic mismatch.** `killswitch.AgentGuardKill` treats only a file containing `{"status":"clear"}` as clear. agent-guard means engaged = file present and clear = file absent.
   - Under the real agent-guard, the signer would be permanently killed.
   - Worse, a stale clear file never expires, because there is no heartbeat or freshness check.
   - The two must agree on one contract with a freshness timestamp. agent-guard isn't on the PC yet.
5. **LIVE owner and scheduled sells are ledger-only.** `_sell` (`signer.py:812-905`) books proceeds with `simulated: True` even in LIVE mode, so a sell is recorded as done when nothing hit the chain. In LIVE, a sell must go through the real builder or be refused.
6. **The clock check needs independent sources** (see above, L7).
7. **Boot and LIVE don't require a valid signing key.** A placeholder key gives doctor "signing_key: fail", but activate and LIVE are still allowed. A failing doctor should block activation in LIVE.
8. **Wallet cents truncate down.** $25.0099 is accepted under a $25 halt. It should round against us.
9. **Tail truncation of the event log is undetectable.** It needs an external anchor, such as a periodic digest copied off the PC.
10. **Credential Manager ACL** is attested by the owner only. Get an independent `cmdkey` or `icacls` capture on the PC.
11. The four gates stay closed: ROUTE_APPROVED (pump.fun written permission), HoSec GO, HoS GO, and Zoorped's final approval in his own words.

### Non-blocking notes
- Buy intents with unknown extra fields are accepted. The HMAC covers the raw bytes, so this is not exploitable, but strict parsing is preferred.
- An owner sell with an unknown mark proceeds at 0 (by design: a kill must be escapable).
- `test_09_e2e_script.py` checks only strings in the script. It should run the script's failure path.

### Tests run (70180eb)
- Repo: pytest 63 passed; ruff clean; mypy --strict clean (21 files); gitleaks 8.30.1 clean on 06adef0..70180eb and the src tree; pip-audit clean.
- Adversarial suite `/workspace/rev92/adv2` (adapted to the raw-bytes HMAC and micro-stake API): **52 passed**.
  - gates: 13
  - paths: 22
  - procs and fuzz: 5 (8-process race, kill -9 recovery, Hypothesis with 2000 examples plus the 10-min spacing invariant)
  - new delta probes `test_adv_delta.py`: 12 (verdict replay and expiry, intent replay, key_id/HMAC tamper, 10-min across restart, CT rollover and rollback, forged Date, kill-file semantics, no-send in every mode)
- Validator script:
  - correct discriminators: sims pass (instrumented);
  - corrupted discriminators: sims fail, but the script still exits 0 (V1).
- Mainnet calls were read-only: Pyth account reads (30 samples), plus one unsigned simulate during the validator rehearsal. No keys, no funds and no sends.

## PR #92 0a0a316

Head `0a0a316d24d1037f368565c8b2a5ae0d740347e5` (commits 1b4df5d, 0a0a316; 28 files, +2514/−246 since 70180eb). This is a delta review judged as dry-run code. I treated SE's claims as data and verified them independently. Reviewed 2026-11-17, about 6:30–6:50 PM CT.

### Verdict
- **Dry-run merge: GO, with one condition: K1 must be fixed before any heartbeat writer exists or the dry run starts on the PC.**
  - V1 is fixed.
  - No path can send.
  - Dry-run behaviour is unchanged and correct.
  - The new builders run only on the LIVE path, which ends in SIGN_REFUSED or BROADCAST_REFUSED.
  - K1 is the kill-switch contract mismatch. It fails closed today because nothing writes the heartbeat, so the signer always reads "killed".
- **Live: NO-GO.** The new findings below include a 12.6× cap breach on USDC-paired curves and a first-buy overspend from the volume-accumulator rent.

### CI
Run 44208166684 ran on head_sha 0a0a316 (pull_request, attempt 1, created 6:29 PM CT). Every job and step succeeded:
- test (ubuntu) and test (windows), each running ruff check, mypy, pytest, gitleaks and pip-audit (now against requirements.lock.txt);
- package;
- validator (optional), step "Unsigned local simulation".

The script now returns 1 on a simulation error and 2 when the CLI is missing, so a green step means both simulations passed. The job still has `continue-on-error: true`, so a red validator would not block the PR. Job logs return 403 without auth, so I didn't read them.

### V1 (validator): fixed and verified
`scripts/e2e_validator.py` `rehearsal_result` returns 1 unless both errors are None. There is a one-slot warm-up, a retry on "not deployed", and a unit test `test_security_recheck.py:140`.

Local runs with Solana 4.4.1:
- **Good run:** exit 0, both simulations clean.
- **Corrupted run:** I XORed the first byte of the buy_v3 and sell_v3 discriminators after the build. Result: `InstructionFallbackNotFound (101)` ×4, "unsigned simulation failed; buy={'InstructionError': [2, {'Custom': 101}]} sell=…", **exit 1**.
- **Corrupted constant:** the builder's own allowlist refuses it before simulation (SWAP_DISCRIMINATOR, exit 1).

### Dry-run condition
- **K1. The kill-switch contract doesn't match agent-guard** (`killswitch.py:25-38`).
  - The signer treats `<root>/killed` as killed and a fresh `<root>/heartbeat.json` (`ts_ms`, ≤ 15 s old, ≤ 2 s in the future) as clear.
  - The real contract (`/workspace/agent-guard/agent_guard/killswitch.py`, `bin/killswitch on`) writes **`state/KILL_SWITCH`** (JSON reason/by/at) and has no heartbeat at all.
  - Repro: with a fresh heartbeat plus agent-guard's `state/KILL_SWITCH` present, `poll()` returns **"clear"**.
  - Nothing in either repo writes `heartbeat.json`, and no writer is specified in DESIGN.md.
  - **Fix:**
    - treat `KILL_SWITCH` (agent-guard's name, or `AGENT_GUARD_KILL_FILE`) as killed;
    - name the heartbeat writer (agent-guard's `status` loop or a small owner-run task);
    - restrict the heartbeat file to the owner SID and SYSTEM (checked by the ACL probe);
    - add a test that uses agent-guard's own `engage()` output format.
  - What works: stale, future or unparseable heartbeats, a missing directory, and a non-int `ts_ms` all give killed.

### Other claims verified
- **Clock** (`preflight.py:74`, `101-117`):
  - Sources default to cloudflare.com and google.com, not the RPC. The CLI `_probe` passes no clock URLs and no RPC time.
  - A forged RPC Date that matches a wrong local clock (local 30 s off, both public sources honest) gives None.
  - One unreachable source gives None; both unreachable give None (fail closed).
  - Gap: there is no distinct-host check. `clock_urls=("https://evil.example",)*2` passes. It's reachable only through the constructor, not the CLI.
  - Live note: if one party controls the local clock and TLS interception toward both hosts, it can still pass. That is acceptable residual risk.
- **Pyth:**
  - The discriminator `22f123639d7ef4cd` equals sha256("account:PriceUpdateV2")[:8].
  - Byte 40 = 1 means Full verification. Partial would shift the layout and is refused.
  - A live read at 6:41 PM CT parsed $75.13, **54.6 s old**, so it's still over the 30 s rule.
- **Wallet rounding:** wallet value now rounds up, so $25.0099 gives BUY_HALT.
- **LIVE sell:**
  - It builds the real unsigned sell_v3, validates it, and calls `broadcaster.submit`.
  - The production CLI wires `RefuseBroadcaster` only (`cli.py:183`).
  - With an injected recording broadcaster, the bytes submitted carried an all-zero signature, the position stayed open, and the result was BROADCAST_REFUSED.
- **Anchor** (`signer.py:1456-1509`):
  - A naive truncation of the last event leads to boot HALTED (anchor_mismatch).
  - **Rollback of an old DB copy together with its old `.anchor`** is not detected: boot went to PAUSED with the newer trade gone.
  - The anchor sits in the same directory as the DB and is unkeyed. A missing anchor is accepted (`_anchor_matches` returns True).
  - Documented limit: this protects against accidental or naive edits only. It does not protect against anyone with write access to the signer directory.
- **Fees** (live `8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt`, read-only):
  - owner pfee…; flat (lp 0, protocol 95, creator 30); 1 tier at threshold 0 = (0/95/30); stable tier and exotic both (0/95/30). Total 125 bps.
  - The fixture fee_config is byte-identical to live. The layout matches the `pump_fees` IDL.
- **Edge pricing:**
  - At prices of $50, $74.89, $74.95, $150, $250 and $400, with and without ATA creation, `all_in = max_sol_cost + ATA rent 1,513,840 + 5,000 signature fee + 200 priority fee` is ≤ $2 exactly at the given price, and budget + 1 lamport is over $2.
  - `max_sol_cost = quote × 1.15`, fees included (per TRADE_V3.md).
  - The policy ceiling refuses at limit − 1.
- **Builders vs IDL** (pump-public-docs 639b87f):
  - buy_v3 and sell_v3 have 17 accounts; order, signer and writable flags all match the IDL.
  - The discriminators match; the data is `<QQ` (partial_fill omitted, which the docs allow).
  - fee_config is 8Wf5…; quote WSOL with SPL Token; base Token-2022.
  - The ATA instruction is CreateIdempotent (tag 1) with the Token-2022 program, the trade mint, and the same ATA as account 9.
  - Slippage: buy `max_sol_cost` = quote × 1.15, and sell `min_sol_output` = net × 0.85.
  - PumpSwap buy_v2 and sell_v2 flags match `pump_amm.json`.
  - Complete and cashback curves are refused.
- **Allowlist** (`message_policy.py`): effectively ComputeBudget (one limit and one price), ATA CreateIdempotent, pump buy_v3/sell_v3 and PumpSwap buy_v2/sell_v2, with exactly 1 swap and at most 4 instructions. All of these are rejected:
  - system transfer and allocate;
  - Token-2022 TransferChecked and Burn;
  - SPL Close and SyncNative;
  - Memo;
  - non-idempotent ATA Create and RecoverNested;
  - ComputeBudget heap frame and loaded-data;
  - price above 2^32;
  - two swaps;
  - a curve v2 discriminator.
- **No-send:**
  - There is no `sendTransaction` in src. The script raises if it's ever called.
  - `signing.py` (sign_message) has no caller in src.
  - The only Broadcaster in src or the CLI is `RefuseBroadcaster`.
  - The LIVE buy ends in SIGN_REFUSED with no submit. The LIVE sell submits only unsigned bytes and only to an injected broadcaster.

### Requirements for the broadcaster PR (all must hold before any signing or sending code lands)
1. **Fix K1** (agent-guard `KILL_SWITCH`, a named heartbeat writer, ACL), and re-check the kill before signing and again before submit.
2. **Refuse any quote mint other than WSOL** in `build_curve_buy`/`build_curve_sell` (`txbuild.py:103-136`, `curve_quote` at 261), and in the policy (account 2 == WSOL, account 4 == SPL Token).
   - Repro: a USDC-paired curve builds with `max_sol_cost` = 25,186,794 base units = **$25.19 of USDC** (12.6× the cap), because the lamport budget is reused as quote units.
   - pump.fun's README says USDC pairs are coming.
3. **Count the `user_volume_accumulator` rent** (1,844,400 lamports per TRADE_V3.md, created if missing) and any bonding-curve rent top-up in `_fixed_costs` (`txbuild.py:312`). Otherwise read the account and fail closed.
   - Today the first buy is **$2.138** at $74.89.
4. **Make the live paths pass full expectations** to `validate_transaction`: owner (refuse if None), mint, `max_all_in_lamports`, `expected_token_amount` and `expected_limit_lamports`, at `signer.py:856` (buy) and `649` (sell).
   - Without them the policy accepted a **49 SOL `max_sol_cost`** and a **sell `min_sol_output` of 1 lamport**.
   - With owner=None, every derived-address check is skipped (`message_policy.py:206`).
   - `_check_budget` must bound `limit + priority + rent + signature` together, not each one separately.
5. **Use one price.**
   - The builder takes `inputs["sol_usd_cents"]` from the market reader (`signer.py:618`). Use the same oracle reading that passed the caps.
   - Use micro-USD and round against us. Cent truncation still spends **$2.000267** at the true price.
   - `ata_rent_lamports` defaults to 0 when missing (`signer.py:621`). Make it fail closed.
6. **PumpSwap: disable for live, or fix it.**
   - User base and quote accounts are caller-supplied, not derived (`txbuild.py:186`, `233`). The policy checks only payer, global_config and buyback (`message_policy.py:230-236`), so a non-derived user base account was accepted.
   - SOL pools need a funded WSOL account. The allowlist (correctly) forbids SyncNative, system transfer and close, so buys can't be funded and sell proceeds would stay in WSOL.
   - Derive and verify the pool, the user ATAs, fee_config and the volume accumulator.
7. **ATA create checks.** Verify that mint == trade mint, the token program matches, and the ATA address equals the derivation (`message_policy.py:126-131`). A foreign-mint ATA was accepted.
8. **Sign safely.**
   - Sign only the exact bytes that passed `validate_transaction`, in the same process, with the key from Credential Manager (doctor pass required, as already enforced).
   - Run an unsigned simulate first and refuse on any error.
   - Send with preflight on, and use a fresh blockhash with expiry handling.
9. **Track results.**
   - Record the signature before submit, poll for confirmation, and reconcile the on-chain fill against the ledger.
   - Retries must be idempotent and never double-buy (same reservation, same blockhash window).
   - `_broadcast_sell` currently records BROADCAST_REFUSED whatever `submit` returns (`signer.py:650-657`). A real broadcaster must change that.
10. **Make the validator job required** (drop `continue-on-error`). Add a PumpSwap rehearsal, or keep PumpSwap disabled.
11. **Fix the clock check:** assert the time sources are distinct hosts, and keep RPC time out of the pair.
12. **Move the anchor off the PC:** copy the anchor to an append-only location the signer can't rewrite (e.g. HUD or agent-guard audit, or a remote), compare on boot, and refuse a missing anchor once one has existed.

### Still blocks live
- All the requirements above, plus:
  - Pyth staleness: 54.6 s now, 12/30 samples over 30 s earlier.
  - Credential Manager ACL is owner-attested only.
- The four gates: ROUTE_APPROVED (pump.fun written permission), HoSec GO, HoS GO, and Zoorped's final approval in his own words.

### Non-blocking notes
- `ruff format --check` would reformat 9 files; CI runs only `ruff check`.
- partial_fill is omitted from buy_v3 (allowed). Mayhem coins then fail on oversize buys, which is the safe direction.
- Buys larger than `real_token` are refused (no synthetic migration), which is conservative.

### Tests run (0a0a316)
- **Repo:**
  - pytest **80 passed**; ruff check clean; mypy --strict clean (21 files); pip-audit (lock) clean.
  - gitleaks 8.30.1 found no leaks on 06adef0..0a0a316 history or the project tree.
- **Adversarial suite `/workspace/rev92/adv2`: 100 passed.** It was updated for the new API (4-tuple `_wallet_exposure`, SIGN_REFUSED, LIVE sells refused, rounding up):
  - gates: 13
  - paths: 22
  - procs and fuzz: 5 (8-process race, kill -9, Hypothesis 2000 examples with the 10-min spacing invariant)
  - delta: 10
  - new `test_adv_delta3.py`: 50 (clock, kill contract, anchor, fee edge ×12, builders vs IDL ×4, allowlist rejects ×14, policy gaps, USDC, volume accumulator, LIVE sell)
- **Validator:** good run exit 0; post-build corrupted discriminators exit 1.
- **Mainnet calls were read-only:** fee_config and Pyth getAccountInfo, plus program clones for the local validator. No keys, no funds and no sends.

## PR #92 13ec28d

Head `13ec28deb43439478a7449f2e2e929c17d8b4c02`. Six commits since 0a0a316 (58f0c5e … 13ec28d); 23 files changed, +1187/−168. This is a delta review judged as dry-run code. I treated SE's claims as data and verified them independently. Reviewed 2026-11-17, about 7:15–7:40 PM CT.

### Verdict
- **Dry-run merge: GO.**
  - K1 is confirmed against the real agent-guard CLI when `--kill-switch` points at the agent-guard home.
  - One small follow-up (K2) must land **before the heartbeat writer is started on the PC**. The build doesn't start the writer, so today the signer always reads "killed".
  - Nothing can send.
- **Live: NO-GO.** Broadcaster PR items 7 and 8, the items below, and the four gates are still open.

### CI
Run 44208166684 was superseded by 44213583007, which ran on head_sha 13ec28d (pull_request, attempt 1, created 7:09 PM CT). Every job and step succeeded:
- test (ubuntu) and test (windows), each running Ruff, Mypy, Pytest, Gitleaks and pip-audit;
- package;
- **validator**: `continue-on-error` was removed and the job was renamed from "validator (optional)".

"Required" is verified at workflow level only. A red validator now fails the run. Branch-protection required checks can't be read without auth (`rules/branches/main` returns `[]`, protection returns 401), so the owner should confirm that the merge setting requires it.

### K1: confirmed with the real agent-guard
The test used `AGENT_GUARD_HOME=<tmp>` and `--no-propagate`, through `/workspace/agent-guard/bin/killswitch`. The real `state/`, `audit.jsonl` (sha256), `aai-forex/state/KILL_SWITCH` and `perps-pipeline/state/KILL` were byte-identical before and after. **The global kill switch was never engaged.**

| Step | Signer `poll()` |
|---|---|
| no heartbeat | killed |
| `write_heartbeat` (mode 0600), fresh | clear |
| `killswitch on` (creates `state/KILL_SWITCH`) + fresh heartbeat | **killed** |
| `killswitch off --confirm RESUME` + fresh heartbeat | clear |
| `AGENT_GUARD_KILL_FILE=<tmp>/custom_kill`, `on` / `off` | killed / clear |
| heartbeat 15.000 s / 15.001 s old / 2.001 s in the future | clear / killed / killed |
| mode 0644, `status:"paused"`, `ts_ms:true` | killed (each) |

The writer is `heartbeat.py:26`, the only call site in src, and it isn't started by this build. It creates the file 0600 via `O_CREAT` and re-chmods it. On Windows it sets a protected DACL of owner + SYSTEM through SetNamedSecurityInfoW, and the check at `:44` requires exactly {owner, S-1-5-18} with allow-ACEs only.

**K2 (fix before the heartbeat writer runs on the PC):**
1. **Wrong root silently ignores the kill.** `killswitch.py:54-56` looks only for `<root>/killed` and `<root>/state/KILL_SWITCH`.
   - If `--kill-switch` is set to agent-guard's *state* directory (an easy mistake, and the CLI has no help text), then agent-guard `on` + a fresh heartbeat gives **clear**.
   - Fix:
     - also check `<root>/KILL_SWITCH`, or require `<root>/state` to be a directory (otherwise killed);
     - document `--kill-switch` = AGENT_GUARD_HOME, or default it to `AGENT_GUARD_HOME`.
2. **`killswitch.py:67` uses `is_file()`**, but agent-guard's `status()` uses `exists()`. A `KILL_SWITCH` that is a directory reads as engaged to agent-guard and **clear** to the signer. Use `exists()` (or `lstat`), and treat errors as killed.

Note: the heartbeat is written by the signer itself, so it only shows that the signer is alive, not that agent-guard is. That is acceptable because the kill file is the authoritative signal.

### Re-run of the 0a0a316 repros

| Repro | 0a0a316 | 13ec28d |
|---|---|---|
| USDC-paired curve, $25.19 max cost | built | **refused** by the builder (`txbuild.py:305`, QUOTE_MINT) for both buy and sell |
| First buy, $2.138 | over | **≤ $2**. Rent counted (ATA + volume account + curve top-up when unknown). All-in $1.9999999 at $74.89 |
| 49 SOL buy limit | accepted | **refused** (MAX_SOL with no ceiling, and LIMIT_LAMPORTS) |
| Sell `min_sol_output` = 1 | accepted | **refused** (MIN_OUT) |
| owner=None | checks skipped | **refused** (OWNER_REQUIRED, `message_policy.py:103`) |
| Foreign ATA address / foreign owner | accepted | **refused** (`message_policy.py:282-285`) |
| ATA for a different mint | accepted | **refused** |
| Same clock host twice (also case and path variants) | accepted | **refused** (None) |
| Anchor deleted after one existed | accepted | **HALTED** (`signer.py:1531-1539`) |
| Understated `rent_lamports` | n/a | refused |
| PumpSwap in the live policy | allowed | **refused** (PUMPSWAP_DISABLED) |
| CU limit 400,001; missing CU price or limit | accepted | refused |

**$2 edge.** I tested 24 combinations (6 SOL prices × ATA on/off × volume account present/absent):
- `all_in = limit + rent + 5,000 + 200` is ≤ $2 exactly at the given price, and budget + 1 lamport is over $2.
- The policy accepts the build at its own budget and refuses it at all_in − 1.
- Fees read 95 + 30 = 125 bps from the live fee_config.

**Allowlist.** I re-ran all 14 forbidden instruction shapes with a fully valid base and full expectations, so the extra instruction is the only reason for rejection. All were refused. A second swap, curve v2 and PumpSwap were also refused.

**Validator.** A good local run exits 0. Corrupting the discriminators after the build gives `{'Custom': 101}` and exit 1.

### Findings that remain (not dry-run blockers)
- **P1. The policy doesn't pin the curve's quote accounts.** `message_policy.py:224-245` checks mint, global, curve, ATAs, volume, fee_config and buyback, but not account 2 (quote_mint) == WSOL, account 4 == SPL Token, or the quote ATAs at 7 and 10. A hand-built curve buy with a USDC quote account passes `validate_transaction`; only the builder stops it. The policy is the last gate before signing, so add these checks before the broadcaster PR (xfail test `test_usdc_quote_in_message_refused_by_policy`).
- **P2. Price rounding isn't against us.**
  - `models.py:64-67` gives `sol_usd_cents = mid_1e8 * 100 // 10**8`, which floors the mid price.
  - For a buy, a lower price means more lamports, so at a true price of $74.959999 the all-in is **$2.000267**. SE's claim of "rounded against us" is not met.
  - Fix: use micro-USD and round the price **up** for buy budgets. Consider the conf-adjusted upper bound.
- **P3. Volume account size.** `constants.py:68` sets `USER_VOLUME_ACCOUNT_BYTES = 106`, but the live account is **137 bytes** (IDL and mainnet).
  - `rent_exempt_lamports` uses 6,960 lamports per byte. Mainnet `getMinimumBalanceForRentExemption(137)` is 1,346,200, so the code (1,628,640) is conservative today.
  - Fix: use 137 and the live rent RPC, and keep a floor.
- **P4. Sells without expectations.** A sell `min_sol_output` of 2 passes when no `expected_limit_lamports` is given. The signer always passes it (`signer.py:670-678`), but the policy should make it mandatory for sells.
- **P5. Clock.**
  - Two subdomains of one operator pass. This is inherent and acceptable.
  - `https_times=` (a constructor test hook) bypasses the host check; the CLI doesn't use it.
- **P6. Anchor limits (documented, `DESIGN.md:63`).**
  - Rolling back the DB and the anchor together gives PAUSED with the newer trade gone.
  - Deleting the anchor and resetting `anchor_meta.written = 0` in the DB gives PAUSED.
  - The off-PC copy is a manual instruction with no comparison mechanism, so it needs one before live.

### No-send confirmation
- There's no `sendTransaction`, `send_transaction` or `sign_message` call in src. `signing.py` is used only for `verify_ed25519` (vet).
- The only Broadcaster class is `RefuseBroadcaster` (`signer.py:145`), and the CLI wires only that.
- `submit` is reached only by the LIVE sell, after two kill polls (`signer.py:681`).
- With an injected recording broadcaster:
  - DRY_RUN buy: 0 submits.
  - LIVE buy: SIGN_REFUSED, 0 submits.
  - LIVE sell: BROADCAST_REFUSED, 0 submits (no market inputs), position open.
  - Earlier probe with market inputs: only unsigned bytes (zero signatures) were submitted.

### Broadcaster PR (still open)
1. Item 7, signing: sign exactly the validated bytes, with the key from Credential Manager.
2. Item 8: unsigned simulate first and refuse on error; preflight on; record the signature before send; confirm and reconcile; idempotent retries with blockhash expiry; `_broadcast_sell` must stop ignoring `submit`'s result.
3. Also P1, P2 and P4 above.
4. A kill poll between sign and send.
5. K2.

### Still blocks live
- The broadcaster PR, plus P3 and P6 (an off-PC anchor comparison).
- Pyth staleness: 54.6 s observed against the 30 s rule.
- agent-guard isn't installed on the Windows PC yet, and K2 is open.
- Credential Manager ACL is owner-attested only.
- Branch-protection "required" status for the validator is unconfirmed.
- The four gates: ROUTE_APPROVED (pump.fun written permission), HoSec GO, HoS GO, and Zoorped's final approval in his own words.

### Tests run (13ec28d)
- **Repo:**
  - pytest **93 passed**; ruff check clean; mypy --strict clean (22 files); pip-audit (lock) clean.
  - gitleaks 8.30.1 found no leaks on 06adef0..13ec28d history or the project tree.
- **Adversarial suite `/workspace/rev92/adv2`: 123 passed, 1 xfail (P1).**
  - gates: 13
  - paths: 22
  - procs and fuzz: 5
  - delta: 10
  - delta3: 12 (superseded probes moved)
  - new `test_adv_13ec.py`: 61 passed + 1 xfail
- **K1 live run** against the agent-guard CLI in a temp `AGENT_GUARD_HOME` (table above).
- **Validator:** good run exit 0; post-build corrupted discriminators exit 1.
- **Mainnet calls were read-only:** a volume accumulator getAccountInfo, getMinimumBalanceForRentExemption, and program clones. No keys, no funds and no sends.

## PR #92 819c8a4

Delta review, 7:36–7:45 PM CT. Head `819c8a458b59d6a26142e5a996325d0bf44396f9` (commits 6574640, 819c8a4; 17 files, +655/−61). SE's and HoSec's claims were treated as data and checked independently.

**Verdict: GO as dry-run code.** K2 is closed, so the heartbeat writer may run on the PC from a code standpoint. One new live/broadcaster finding (R1) does not block dry-run.

### CI
- Run 44216688103 ran on head 819c8a4 (pull_request, attempt 1, created 7:33 PM CT). All jobs passed. The new "README install on a fresh venv" step passed on ubuntu and was skipped on windows.
- Branch protection / required checks still can't be verified with my access (rules endpoint `[]`, protection 401).

### K2: closed
Tested against real `/workspace/agent-guard/bin/killswitch` with a temp `AGENT_GUARD_HOME` and `--no-propagate`. Afterward, the real state, the audit sha, `/workspace/aai-forex/state/KILL_SWITCH` and `/workspace/perps-pipeline/state/KILL` were all unchanged.

| `--kill-switch` root | agent-guard ON (fresh heartbeat) | OFF | KILL_SWITCH as a dir / dangling symlink / symlink to a file |
|---|---|---|---|
| home | killed | clear | killed / killed / killed |
| state dir | killed | clear | killed / killed / killed |

- A home with no `state/` → killed. `state` as a file → killed. A root that is a differently named symlink to the state dir → killed. That is fail-closed; the owner must use the real path.
- With no flag, the default is `AGENT_GUARD_HOME` (`killswitch.py:76`, `cli.py:209`).
- `AGENT_GUARD_KILL_FILE` as a dangling symlink → killed.
- A dangling symlink reads "not engaged" to agent-guard's own `status` (`exists()`) but killed to the signer. That mismatch is conservative.

### P1–P4
- **P1: closed.** `message_policy.py:224-262` pins metas[2]=WSOL, [4]=SPL Token, [7]=ATA(curve, SPL, WSOL), [10]=ATA(owner, SPL, WSOL) and [15]=PDA(`__event_authority`). On both buy and sell, the policy refuses a hand-built USDC quote, Token-2022 as the quote program, or a random key at 7, 10 or 15. The former xfail now passes as a plain assertion.
- **Account 15** matches the IDL at pump-public-docs 639b87f: buy_v3/sell_v3 index 15 is `event_authority`, seed `__event_authority`; 14 is system and 16 is the program. The built tx carries the derived PDA.
- **P2: closed for the micro path.** I swept the true price around $74.959999, $150, $50 and $74.889999. The worst true spend was $1.99999994. The cents-only call (`sol_usd_micro` omitted) still gives $2.000267. The signer's LIVE buy passes `sol_usd_micro` (`signer.py` ~970-990), so this is only reachable by a direct library caller. Recommend making `sol_usd_micro` mandatory in `build_curve_buy`.
- **P3: closed.** `USER_VOLUME_ACCOUNT_BYTES = 137`, and rent comes from `getMinimumBalanceForRentExemption` via `_rent` (`signer.py:717-727`, `cli.py:92/98`).
- **P4: closed.** A sell without `expected_limit_lamports` → PolicyError (`message_policy.py:326`). A 1- or 2-lamport min output without an expectation is also refused.
- Sells now must carry `max_all_in` (a fee cap). A max-price CU budget on a sell is refused.
- An agent_guard halt now needs chain reconciliation before UNHALT (stricter). I updated my adversarial tests for both changes.

### Rent read: does it fail closed?
- `_rent` returns None (→ SIGN_REFUSED or no build) when the call raises or returns None, 0, 1, a negative, a str, a bool or a float.
- A missing curve or an `account_info` exception → `_chain_trade_facts` returns None.
- An absurdly high rent (1e15) → BuildError CAP. That is fail-closed.
- **R1 (new; must be fixed before broadcaster/live, does not block dry-run):** there is no lower plausibility floor. `signer.py:725` accepts any int ≥ 2, and `txbuild._volume_rent` accepts any value > 0.
  - A faulty or hostile RPC that returns rent=2 makes the build budget 2 lamports for the volume account and the Token-2022 ATA. On chain, the program would actually charge about 1,346,200 + 1,513,840 lamports, so the real all-in is **≈ $2.21 at $74.89, over the $2 cap**.
  - The same class applies to `account_info` falsely saying the volume account or ATA already exists (rent 0).
  - Fix: refuse if the chain rent is below a pinned floor, e.g. `(size+128)*5080` with a small tolerance, or outside a [floor, ~2× floor] band. Optionally budget `max(chain, local 6,960/byte formula)`. Cross-check existence with a second provider before LIVE, or have the broadcaster simulate first and compare the pre/post balance delta against the cap.
- The Token-2022 ATA size is assumed to be 182 bytes (the real size is 170). That overcounts, which is conservative.

### No-send
- `sign_message` has no callers in `src` apart from `signing.py` itself.
- The CLI wires only `RefuseBroadcaster` (`cli.py:215`).
- `signer.py:767` `submit` is reached only through the injected broadcaster on a LIVE sell. My recording-broadcaster tests still see no payload in PAUSED, KILL_HOLD or DRY_RUN.
- `e2e_validator.py:44` refuses `sendTransaction`.
- No mainnet send, no real keys, and no secrets were printed. The only mainnet calls were unsigned simulate/read.

### Validator
- Good run: Solana CLI 4.4.1 local validator with publicnode accounts at slot 470726647. buy_v3/sell_v3 finished with no error, exit 0.
- Corrupted-discriminator run: buy/sell `Custom 101` (InstructionFallbackNotFound), exit 1. I regenerated the template for the new builder args; the temp script was removed.

### Tests
- Repo: 107 passed. `ruff check src tests scripts` clean. `mypy --strict src`: 22 files, clean. `pip-audit -r requirements.lock.txt`: no known vulnerabilities. gitleaks on 06adef0..HEAD and on the tree: no leaks.
- Adversarial `/workspace/rev92/adv2`: 152 passed, 0 xfail.
  - The new file `test_adv_819c.py` has 28 tests: P1 accounts 2/4/7/10/15 on buy and sell, account 15 against the IDL, the P2 sweep, P3, volume-rent bounds, P4, the sell fee cap, and rent-read fail-closed across 10 values, low, high and error.
  - Updated: the P1 xfail is now an assert; base sells pass `max_all_in`; the unhalt path expects RECONCILE_REQUIRED until the chain is authoritative.

### Still open
- **Broadcaster PR:**
  - R1.
  - Make `sol_usd_micro` mandatory.
  - The earlier items 7 and 8:
    - sign exactly the validated bytes;
    - simulate first and compare the balance delta to the cap;
    - record before send;
    - confirm and reconcile;
    - make retries idempotent;
    - `_broadcast_sell` must honor `submit`'s result;
    - re-poll the kill switch between sign and send.
- **Live:**
  - P6: an off-PC anchor comparison.
  - The Pyth staleness policy (54.6 s observed versus 30 s).
  - agent-guard installed on the PC, with the heartbeat writer verified there.
  - The Credential Manager ACL is owner-attested only.
  - Branch-protection required checks are unconfirmed.
  - The four gates: pump.fun written permission (ROUTE_APPROVED), HoSec GO, HoS GO, and Zoorped's final approval in his own words.

## PR #92 3db1564

Delta review from 819c8a4, done 8:01–8:12 PM CT. Head is `3db156499e9a123bca44ebb3199a461f6b72d561` (commits dac5229, 6ced2d9 and 3db1564; 17 files, +492/−84). I reviewed it in the worktree `/workspace/rev92/wt3db` with its own venv. SE's claims were treated as data.

**Verdict: GO as dry-run code.** The dry-run path is fail-closed and nothing can send. **One new blocker for the broadcaster PR (R1b):** SE's claim that "real mainnet rent passes" is false.

### CI
Run 44219750762 is on head_sha 3db1564, event pull_request, attempt 1, created 7:58 PM CT, conclusion success.
- Jobs: test (ubuntu), test (windows), package and validator, all success.
- The only non-success step is "README install on a fresh venv", skipped on windows by design.
- Locally the repo suite passes 115 tests, which matches SE's count.

### R1: band added, but calibrated to the wrong rate
- `quote.py:60-68` `accept_chain_rent` refuses anything below `(n+128)*6960` or more than 1% above it. `signer.py:783` `_rent` and `txbuild.py:389` `_volume_rent` both use it.
- These are all refused: 2, 1000, formula−1, formula+1%+1, 1e15, 0 and negatives. The formula itself and formula+1% exactly are accepted.
- **R1b (blocker for broadcaster/live):** I read mainnet `getMinimumBalanceForRentExemption` read-only from api.mainnet-beta and publicnode at 8:05 PM CT.

  | Bytes | Mainnet value | Formula value |
  |---|---|---|
  | 137 | 1,346,200 | 1,844,400 |
  | 165 | 1,488,440 | 2,039,280 |
  | 170 | 1,513,840 | 2,074,080 |
  | 182 | 1,574,800 | 2,157,600 |

  - Mainnet is 5,080 lamports/byte, which is 0.7299× the 6,960 formula. **Every real mainnet rent value is refused.**
  - So any LIVE buy that has to create the ATA (every first buy of a mint) or the volume account gets `_chain_trade_facts` → None → SIGN_REFUSED. `build_curve_buy(volume_rent_lamports=1_346_200)` raises BuildError RENT.
  - CI can't catch this, because solana-test-validator uses the 6,960 default.
  - This is fail-closed, so it is safe, but the LIVE buy path doesn't work on mainnet.
  - Fix, matching the function's own docstring ("Budget max(chain, formula)"): refuse only if chain > formula+1%, and return `max(chain, formula)`. Optionally treat chain < `(n+128)*5080` minus a small tolerance as a bad-RPC signal and refuse. Add a test that uses the real mainnet values.
- With the formula rent, all-in at the true price is ≤ $2.000000 in every ATA/volume combination. The worst cases were exactly $2.000000 (no ATA, volume exists) and $1.99999996.
- `sol_usd_micro` is now required (`txbuild.py:125`): omitting it → TypeError; 0 or −1 → BuildError. The old $2.000267 case (cents 7495, micro 74,960,000) is gone.

### Existence cross-checks (`signer.py:713-725`, `_account` 747-769)
These are refused (facts → None):
- curve with the wrong owner;
- wrong curve discriminator;
- truncated curve;
- missing curve;
- self-contradictory missing accounts (lamports > 0 or size > 0 with exists=False) for the curve, volume account and ATA;
- an existing ATA owned by the wrong token program;
- claimed_volume=True while the volume account is missing;
- non-bool exists.

A volume account with the wrong owner or size is treated as missing, and rent is budgeted for it, which is conservative.

Minor:
- `signer.py:724-725` is a no-op. With claimed_volume=True and an unverified volume account, the code proceeds and budgets rent rather than refusing.
- An existing ATA is checked only by its owning program, not by size or mint. A lying RPC can drop the create-ATA instruction, but then the on-chain buy fails and only the fee is lost; there's no overspend.

### HoSec items
- `getMinimumBalanceForRentExemption` is in `rpc.py` ALLOWED_METHODS. The rpc client has no `follow_redirects=True`.
- Helius host check (`cli.py:167-174`, `HELIUS_RPC_HOSTS`): I tried 25 URL shapes.
  - Rejected: `mainnet.helius-rpc.com.evil`, `helius-rpc.com.evil`, a path containing the host, `host@evil`, `evil@host`, `user:pw@host`, the `#@`, `\@` and `?@` tricks, http, a trailing dot, `xmainnet.`, `mainnet-helius`, `.co`, IPv6, NUL, punycode and a Cyrillic homoglyph.
  - Accepted: upper case, `:443`, and a leading space or tab. urlparse strips the whitespace and the URL still points at the genuine host, so this is benign.
- lstat kill (`killswitch.py:92-101`): KILL_SWITCH as a file, dir, dangling symlink, symlink to a file, symlink to a dir, symlink loop or FIFO → killed. ENAMETOOLONG gives None, which also means killed. ENOTDIR → absent. The EACCES case was skipped because the box user can't trigger it the way a test needs, but the code maps every other OSError to killed.
- Kill polled at intent start (`signer.py:290`): it comes before HMAC, so a killed switch gives KILL_HOLD and HALTED even for a garbage intent.
  - Mid-intent kill in LIVE: polls at start and before build (`:1026`); a flip at either one → KILL_HOLD + HALTED. There is also a poll before validate (`:1038`).
  - Mid-intent kill in DRY_RUN: there's only the start poll, so a kill after it still produces a simulated FILLED. No money is involved; noted for parity.
- Digest at every write (`_transact`/`_run`): a direct edit to signer_state → the next intent returns ANCHOR_MISMATCH and the signer is HALTED. UNHALT → RECONCILE_REQUIRED.
- **Gap (live hardening, P6 class):** `_state_digest` (`signer.py:91-96`) covers only the signer_state row. Directly deleting `reservations`/`trades` rows reset the counters, and the next buy FILLED inside the 10-minute window with no halt. This needs local DB write access, i.e. a compromised PC. Fold reservations and trades into the digest, or derive counts from the hash-chained events. `reanchor` (`cli.py:260/297`) re-baselines without any external proof, which is the same P6 issue.

### Minor
- `txbuild.py:371` accepts a direct-caller `ata_rent_lamports=2`; the signer path goes through `_rent`, so only direct callers are exposed.
- `txbuild.py:226/242`: PumpSwap still prices with `cents*10_000`, so the $2.000267 class remains there. PumpSwap is disabled in LIVE (`message_policy.py:151`).

### No-send
- The CLI wires only `RefuseBroadcaster()` (`cli.py:227`).
- `sign_message` has no callers outside `signing.py`.
- `submit` exists only at `signer.py:823` (the LIVE sell, via the injected broadcaster).
- `e2e_validator.py:44` refuses `sendTransaction`.
- The recording broadcaster saw no payloads in any test.
- The only mainnet calls were read-only rent reads and unsigned simulations.

### Validator, scans and suites
- Validator good run: exit 0. Corrupted discriminator: buy/sell Custom 101, exit 1. The temp script was removed and `git status` is clean.
- Repo: 115 passed. ruff clean. `mypy --strict`: 22 files, clean. pip-audit: no known vulnerabilities. gitleaks on 06adef0..HEAD and on the tree: no leaks.
- adv2 against 3db1564: **231 passed**.
  - The new file `test_adv_3db.py` has 79 tests.
  - I updated the old tests for the intended API changes: kw adds `sol_usd_micro`; sell kwargs drop it; fixture DB edits call `record_state`; the 819c rent tests now expect refusal of 2 and 1e18.
- The first-round `adv` suite is superseded by adv2 (it imports the removed `sign_intent`). Its gates, paths, procs and fuzz tests live on, updated, in adv2.

### Still open
- **Broadcaster PR:**
  - R1b.
  - Sign exactly the validated bytes.
  - Simulate first and compare the balance delta to the cap.
  - Record before send.
  - Confirm and reconcile.
  - Make retries idempotent.
  - `_broadcast_sell` must honor `submit`'s result (`signer.py:823`).
  - Poll the kill switch between sign and send.
- **Live:**
  - P6: an off-PC anchor, plus a reservations/trades digest and a reanchor that requires proof.
  - Pyth staleness (54.6 s observed versus 30 s).
  - agent-guard installed on the PC, with the heartbeat writer verified there.
  - The Credential Manager ACL is owner-attested only.
  - Branch protection / required checks are unconfirmed.
  - The four gates: ROUTE_APPROVED with pump.fun written permission, HoSec GO, HoS GO, and Zoorped's final approval in his own words.

## PR #92 e1d53b8

Delta review from 3db1564, done 8:31–8:41 PM CT. Head `e1d53b86681885971e2e6b594049ffddfabad9fb` (commits dd962a5, 3c007f6, e1d53b8; 22 files, +733/−74). I reviewed it in a new worktree, `/workspace/rev92/wte1d`, with its own hash-locked venv. SE's claims were treated as data.

**Verdict: GO as dry-run code.** R1b is fixed and nothing can send. Three new findings must be fixed before the broadcaster PR. B1 means SE's claim that "deleting rows halts the next buy" holds only for a naive edit.

### CI
Run 44223346574: head_sha e1d53b8, pull_request, attempt 1, created 8:27 PM CT, success.
- Jobs: test (ubuntu), test (windows), package and validator, all success.
- The only non-success step is "README install on a fresh venv", skipped on windows by design.
- Locally the repo suite passes 123 tests. The package job now builds `--no-isolation` and uploads the wheel plus its sha256.

### R1b: fixed (claims 1 and 4)
- Mainnet `getMinimumBalanceForRentExemption`, read-only at 8:33 PM CT from api.mainnet-beta and publicnode:

  | Bytes | Mainnet value |
  |---|---|
  | 0 | 650,240 |
  | 137 | 1,346,200 |
  | 165 | 1,488,440 |
  | 170 | 1,513,840 |
  | 182 | 1,574,800 |
  | 399 | 2,677,160 |

  Every value equals `(n+128)*5080` exactly (`quote.py:51`), so `accept_chain_rent(mainnet) == mainnet`.
- `tests/test_recheck2.py:867-872` pins all six sizes and asserts the rate is not 6960.
- `build_curve_buy(volume_rent_lamports=1_346_200)` builds.
- Band: formula+1% is accepted; +1%+1, 1e15, 2^63 and −1 are refused. ATA (182 or 165 by program) and volume rent at 2× are refused.
- Below the formula, values from 0 up to formula−1 are budgeted at the formula. A warning is logged once per low value; mainnet values don't log.
- The direct-caller ATA rent now goes through `accept_chain_rent` (`txbuild.py:381-387`).
- **Is accepting below-formula values safe?** Yes. The formula equals current mainnet rent, so budgeting it is exact, and a lying RPC can't change what the chain actually charges. If the cluster ever raises rent, an honest RPC reports a value above +1% and gets refused, which is fail-closed. Keep the warning and the pinned test.
- All-in cost at the true price, across 4 ATA/volume combinations × 7 prices × 4 rent inputs (none, mainnet, 2, +1%): the worst case is ≤ $2.000000. A budget is never below real mainnet rent.

### Chain-byte builds (claims 3 and 6)
- `_chain_trade_facts(owner, mint, claimed)` now reads the mint account. Refused: a missing mint; owner = pump program or a random program; short data; uninitialised; self-contradictory.
- Curve checks unchanged and still refused: wrong owner, wrong discriminator, truncated, missing.
- `_unsigned_buy` and `_broadcast_sell` build from `chain[5]`/`[6]`/`[7]` (curve, mint, mint owner). The market's `curve_data`/`mint_data` are no longer read.
- The no-op is gone. An unverified volume account (wrong owner or 136 bytes), with claimed None/True/False, is budgeted as missing at 1,346,200 (`signer.py:886`).
- Minor: the ATA token balance is read from bytes 64-72 (`signer.py:906`) without checking the account's mint and owner fields; a fake ATA with foreign fields gave balance 999. A lying RPC can only make a sell fail on chain, so this is minor. Add the field checks.

### LIVE host
- `rpc_host_allowed(live=True)` (`rpc.py:34-43`) accepts only `mainnet.helius-rpc.com`. Devnet (any case), `testnet.helius-rpc.com`, `api.devnet/testnet.solana.com`, `.evil`, `evil@host` and `mainnet@devnet` are all refused. The earlier 25 lookalike shapes are still refused.
- `set_mode("LIVE")` with a devnet Helius URL (lowercase, uppercase or `:443`) → LIVE_HOST.
- `api.devnet.solana.com` and `devnet.helius-rpc.com.` get MODE from `_devnet_in_live` (`signer.py:1868`), but the CLI builds stub readers for any URL that isn't allowed (`cli.py:25-40`, `is_stub`), so LIVE_STUB stops them. Tightening `_devnet_in_live` to "not in HELIUS_LIVE_HOSTS" would be cleaner.

### DRY_RUN kill re-polls (claim 5)
- Buy: polls at intent start, at the would-be sign (`:1238`) and at the would-be send (`:1244`). A flip after poll 0, 1 or 2 → KILL_HOLD + HALTED. A flip after poll 3 or later → FILLED, as expected.
- Sell: `:1325/1331`, skipped for owner sells by design ("hold until I say sell").
- LIVE still polls at start and before build.

### State digest (claim 2): partly met
- **These now halt the next buy (ANCHOR_MISMATCH + HALTED):** deleting reservations; updating reservation status or ct_day; inserting a reservation; deleting trades; updating trade cost or status; updating the ledger; updating halt_reason.
- **B1 (blocker for broadcaster/live), at `signer.py:1961-1971` and `_transact` `:1818-1825`:** the per-write check trusts the *last event's payload* without verifying its HMAC.
  - Reproduction: delete reservations, then append one event row whose hash is plain sha256 (no event key) and whose payload holds the recomputed `state_sha256`. Two consecutive buys then FILLED with the signer ACTIVE.
  - An event whose payload simply has no `state_sha256` passes too (`:1969-1970` returns True).
  - It is caught only at the next reboot, resume or unhalt (verify_chain → HALTED, and unhalt is refused).
  - Fix: in `_transact`, verify the HMAC of the last event and its link to the previous row (or the whole chain), and treat a missing `state_sha256` as a mismatch.
- **B1b, uncovered tables:**
  - `equity_day` isn't in the digest. Repro: a $4.01 loss → DAILY_LOSS. Then resetting `start_equity_cents` with no event → FILLED, no halt. **The $6 daily-loss cap is bypassable by a DB edit.**
  - Deleting `decisions` is still caught as REPLAY, and deleting `intent_hits` still gave RATE_LIMIT. Deleting `equity_day` or editing `anchor_meta` → FILLED, no halt.
  - Fix: add `equity_day`, `intent_hits`, `expected_deposits`, `whitelist` and `decisions` to the digest.

### reanchor (claim 6)
- Without the event key → HASH_CHAIN. A wrong key → HASH_CHAIN. Without `REANCHOR` → CONFIRMATION_REQUIRED. Killed → KILL_HOLD. It also requires the ledger to equal the chain balance and no pending reservations.
- So it can't be abused without the HMAC key.
- **B3 (P6 class):** any process running as the owner can read the event key from Credential Manager and run `reanchor --confirm REANCHOR`. That blesses a counter tamper. Deleting reservations, deleting trades, or moving ct_day → ANCHOR_MISMATCH → REANCHORED → UNHALTED → RESUMED → next buy FILLED. The ledger check doesn't cover the counters.
  - Fix: rebuild or verify reservations, trades and equity_day from the HMAC event log (or from chain history) before reanchor accepts, or keep reanchor as P6 with an off-PC proof.

### New submit path
- **B2 (blocker for the broadcaster PR), `signer.py:711-790` `owner_sell_after_tamper`:** it calls `self.s.broadcaster.submit(built.raw)` (`:787`) after recording BROADCAST_REFUSED.
  - The call isn't gated by mode, route or LIVE, and its result is ignored.
  - With a recording broadcaster in DRY_RUN/PAUSED, it submitted 1 payload.
  - Today's CLI wires only `RefuseBroadcaster()` (`cli.py:224`), so nothing can go out.
  - Fix: gate on LIVE + ROUTE_APPROVED + clear kill, record before submitting, and honor the submit result. Or remove the submit until the broadcaster PR.

### No-send
- `RefuseBroadcaster()` is the only broadcaster wired (`cli.py:224`).
- `submit` is called only at `signer.py:787` (B2) and `:1004` (the LIVE sell).
- `sign_message` has no callers.
- `e2e_validator.py:44` refuses `sendTransaction`.
- I used no keys or funds. The only mainnet calls were read-only rent reads and unsigned simulation.

### Validator, scans and suites
- Validator good run: exit 0. Corrupted discriminator: Custom 101, exit 1. The temp script was removed and the worktree is clean.
- Repo: 123 passed. ruff clean. `mypy --strict`: 22 files, clean. pip-audit: no known vulnerabilities. gitleaks on 06adef0..HEAD and on the tree: no leaks.
- adv2 against e1d53b8: **272 passed**.
  - The new file `test_adv_e1d.py` (123 tests) covers: rent pins and band, low-value logging, the true-price sweep, mint/curve/volume/ATA facts, chain-byte use, digest covered and uncovered, forged event, no event key, reanchor (key, confirm, kill, bless), owner_sell_after_tamper, the LIVE host, lookalikes, lstat kill kinds, and DRY/LIVE kill flips.
  - Updated for the intended changes:
    - the worker and fixture DB edits use `event_hmac` / `record_state`;
    - `verify_chain(conn, key)`;
    - the 819c rent tests now expect low values to be budgeted at the formula;
    - `test_adv_3db.py` is retired (renamed `.bak`) in favor of `test_adv_e1d.py`.
- Regressions: none found beyond the items above.

### Still open
- **Broadcaster PR:**
  - B1, B1b and B2.
  - Sign exactly the validated bytes.
  - Simulate first and compare the balance delta to the cap.
  - Record before send.
  - Confirm and reconcile.
  - Make retries idempotent.
  - `_broadcast_sell` (`:1004`) and `owner_sell_after_tamper` (`:787`) must honor `submit`'s result.
  - Poll the kill switch between sign and send.
  - Minor: check the ATA mint and owner fields (`:906`); make `_devnet_in_live` "not mainnet".
- **Live:**
  - P6: an off-PC anchor, plus B3 (reanchor must prove the counters).
  - Pyth staleness (54.6 s observed versus 30 s).
  - agent-guard installed on the PC, with the heartbeat writer verified there.
  - The Credential Manager ACL is owner-attested only.
  - Branch protection / required checks are unconfirmed.
  - The four gates: ROUTE_APPROVED with pump.fun written permission, HoSec GO, HoS GO, and Zoorped's final approval in his own words.

## PR #92 346b134

Delta review from e1d53b8, done 8:59–9:12 PM CT. Head `346b1349f4ff45acd34d2cfebf8d3d6d89f32b1a` (commits 699ff11, 346b134; 14 files, +866/−118). I reviewed it in a new worktree, `/workspace/rev92/wt346`, with its own hash-locked venv. SE's claims were treated as data.

**Verdict: NO-GO as dry-run code, on one functional blocker (R2).** It is not a safety problem; nothing can send. B1, B1b, B2 and the minor items are fixed. Two new keyless tamper paths (B5, B6) are blockers for the broadcaster PR.

### CI
Run 44226684428: head_sha 346b134, pull_request, attempt 1, created 8:54 PM CT, success.
- Jobs: test (ubuntu), test (windows), package and validator, all success.
- The only non-success step is "README install on a fresh venv", skipped on windows by design.
- Locally the repo suite passes 131 tests, matching SE's count.

### Blocker for dry-run: R2, the owner exit no longer books in DRY_RUN (`signer.py:739-812`)
- At e1d53b8, `owner_sell` in DRY_RUN → CLOSED, open trades 0. At 346b134 → BROADCAST_REFUSED, open trades 1. `sell_all` behaves the same. A Zoora intent sell still closes.
- `_owner_exit` requires an on-chain ATA balance (`:751`, `chain[8] <= 0` → BROADCAST_REFUSED). A dry-run position never exists on chain.
- Even with a balance, it returns OWNER_SELL_SIMULATED (`:811`) without closing the trade or crediting the paper ledger.
- SE's own tests were changed to match: `test_05_kill` now asserts `open_trade_count() == 1` after the owner sell, and `test_01_caps` closes trades by direct DB edit (`_close_open`).
- Effect: the owner's "hold everything until I say sell" can't be rehearsed. After a kill, dry-run positions stay open forever and keep using the 3-open and $20 caps.
- **Deadlock:** after any anchor mismatch with an open dry-run trade, reanchor needs on-chain ATA balances that equal the trade tokens (`:2041-2048`), so it always gives RECONCILE_REQUIRED. The owner exit can't close the trade either, so the dry-run signer can't recover.
- Fix: in DRY_RUN, the owner exit should simulate the sell from the ledger (as at e1d53b8) and book it. Reanchor should skip the chain-balance check for trades that were simulated fills.

### B1, per-write event check: fixed (`signer.py:2249-2278`)
Each of these now gives ANCHOR_MISMATCH and HALTED:
- a forged event hashed with plain sha256;
- an event with a valid owner-key HMAC but no `state_sha256` (`:2276`);
- the equity_day reset after a $4.01 loss;
- truncating the last 1, 2, 3 or 5 events;
- swapping the ids of two events;
- replaying an old event re-hashed with plain sha256.

A verbatim replay of an older event is blocked by `UNIQUE(hash)`. An edit to a middle event isn't seen per-write (only the last event is checked), but reboot verifies the full chain → HALTED, which is acceptable.

### B1b: fixed (`:98-117`)
- Deleting `decisions`, deleting `equity_day`, toggling `anchor_meta.written`, or inserting a `whitelist` row → ANCHOR_MISMATCH.
- My `intent_hits`/`expected_deposits` probes weren't meaningful: the table was empty, and my insert used the wrong column. Both tables are in the digest.

### B5 (new; blocker for broadcaster/live; keyless): rolling back the whole DB while the signer runs
- Repro: snapshot the DB file, do 2 buys, then restore the snapshot under the running signer. The next buy FILLED, and **the next reboot → PAUSED, not halted**.
- The restored chain is old but valid. `_write_anchor` (`:2280`) then appends the rolled-back head to `<db>.anchor` (anchor lines 9 → 11), so the boot check passes.
- A restore followed by a reboot with no write in between *is* caught (HALTED).
- No event key is needed. This resets daily buys, open trades and loss, the same impact as B1.
- Fix: before any write, and in `_write_anchor`, require the last anchor line `(count, head)` to exist in the current chain (row `count` has hash `head`, and the event count is ≥ that count); otherwise halt with anchor_mismatch. A rollback of the anchor file as well stays P6, since it needs an off-PC anchor.

### B6 (new; blocker for broadcaster/live): rekey blesses a keyless rewrite (`signer.py:2094-2135`)
- Repro: delete reservations and trades, then rewrite the whole event log as an unkeyed sha256 chain whose last event carries the new digest. No key is used.
- The owner then runs `rekey --confirm REKEY`, the documented migration step, which a HASH_CHAIN halt invites. Result: EVENT_KEY_GENESIS, then reboot, RESUMED, and the next buy FILLED.
- Rekey checks only that the legacy chain verifies, ledger == chain balance, and no pending reservations. It does not check the counters (`_counters_match_log`), the snapshot, or the anchor file.
- Fix: refuse rekey once any keyed event or anchor exists (keep a keyring or anchor-file marker for "keyed since"). Also require `_anchor_matches` and `_counters_match_log` before genesis.

### Owner-key forgery (P6)
A process running as the owner can read the event key from Credential Manager. It can tamper, append a valid-HMAC event with the new digest, and the next buy FILLED; reboot → PAUSED. That is the expected local-compromise case and needs the off-PC anchor.

### B3, reanchor replay (`:1983`, `:2024-2049`)
- After deleting reservations or trades, moving ct_day, lowering trade cost, or resetting equity → reanchor gives RECONCILE_REQUIRED. Without the key → HASH_CHAIN. Unconfirmed → CONFIRMATION_REQUIRED. Killed → KILL_HOLD.
- A clean reanchor with an open dry-run trade is also refused (part of R2).
- Note: the daily-loss baseline (`equity_day`) isn't part of `_counters_match_log`. It was refused here only through the snapshot and chain-balance checks.

### B2 / no-send: fixed
- `.submit(` appears once in the whole module (`signer.py:1085`, `_broadcast_sell`, LIVE only). `_owner_exit` and `owner_sell_after_tamper` contain no submit.
- `_broadcast_sell` with a recording broadcaster:

  | Broadcaster | Code | Submits | Trades closed |
  |---|---|---|---|
  | disabled | BROADCASTER_NOT_ENABLED | 0 | 0 |
  | raises "BROADCAST_DISABLED" | BROADCAST_REFUSED | — | 0 |
  | raises other text | that text as the code | — | 0 |
  | returns | BROADCAST_ACCEPTED, ok=False | 1 | 0 |

  So BROADCAST_ACCEPTED doesn't fill. Minor: exception text is used as the code (`:1088`); map it to a fixed set.
- The CLI wires only `RefuseBroadcaster()` (`cli.py:239`).
- `sign_message` has no callers.
- `e2e_validator.py:44` refuses `sendTransaction`.
- I used no keys or funds. The only mainnet calls were read-only reads (rent, fee config) and unsigned simulation.

### Fee config cap: right
- Read-only mainnet `getAccountInfo` of `8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt` (owner pfee…, slot 470776859, 9:00 PM CT): flat 95/30, 1 tier (threshold 0, 95/30). Total 125 at every market cap.
- The cap is `min(max_fee_bps, 125) + 10` = 135 (`signer.py:1941-1947`); `max_fee_bps=10000` still gives 135. A config of 125 or 135 → accepted; 136 or 500 → facts None.
- The fee is inside the swap budget, so all-in stays ≤ $2.000000. I re-ran the e1d sweep.

### Minors
- devnet-in-live is now "host not in HELIUS_LIVE_HOSTS" (`:2150`), and an empty URL counts as not live.
- The ATA mint and owner fields are checked only in `_ata_token_balance` (`:2051-2070`, used by reanchor). `_chain_trade_facts` (`:978-980`) still reads the balance without that check, and `_owner_exit` and `_broadcast_sell` size their sells from it. A lying RPC can only make the sell fail on chain. Still minor.

### init_event_key / rekey
`init_event_key` refuses when a key exists (EVENT_KEY_EXISTS). Rekey needs REKEY and the key; with a current chain it returns EVENT_KEY_CURRENT. See B6.

### Validator, scans and suites
- Validator good run: exit 0. Corrupted discriminator: Custom 101, exit 1. The worktree is clean.
- Repo: 131 passed. ruff clean. `mypy --strict`: 22 files, clean. pip-audit: no known vulnerabilities. gitleaks on 06adef0..HEAD and on the tree: no leaks.
- adv2 against 346b134: **316 passed, 1 skipped**.
  - The new file `test_adv_346.py` has 45 tests: forged, no-digest, equity, other tables, truncate, rollback (in-process, with anchor, reboot), replay, reorder, middle edit, owner-key forgery, rekey (guards, legacy rewrite), reanchor tamper/clean, broadcaster result codes, the owner exit in DRY_RUN, the dry-run deadlock, and fee cap against the chain.
  - Updated for the intended changes: owner sells pass `confirmation="OWNER_SELL"`; equity fixture edits call `record_state`; the e1d chain fake carries the fee_config account; the forged-event assertion is flipped to "refused".
- Regressions: R2, as above. Nothing else.

### Still open
- **Dry-run:** R2.
- **Broadcaster PR:**
  - B5 and B6.
  - Sign exactly the validated bytes.
  - Simulate first and compare the balance delta to the cap.
  - Record before send.
  - Confirm and reconcile, including the BROADCAST_ACCEPTED state.
  - Make retries idempotent.
  - Poll the kill switch between sign and send.
  - A fixed set of submit error codes (`:1088`).
  - The ATA field check in `_chain_trade_facts` (`:978`).
- **Live:**
  - P6: an off-PC anchor; owner-key forgery and an anchor-file rollback stay here.
  - Pyth staleness (54.6 s observed versus 30 s).
  - agent-guard installed on the PC, with the heartbeat writer verified there.
  - The Credential Manager ACL is owner-attested only.
  - Branch protection / required checks are unconfirmed.
  - The four gates: ROUTE_APPROVED with pump.fun written permission, HoSec GO, HoS GO, and Zoorped's final approval in his own words.

## PR #92 850394f

Reviewed 9:41 PM CT, 2026-11-17. Head `850394f9d70b300f7ab7a65a14315cf8a07cceb8`, worktree `/workspace/rev92/wt850`. Verdict: **GO as dry-run code.** No blockers. Live remains gated.

**CI and hygiene.** CI run 44230718342 ran on this exact SHA (pull_request, attempt 1, created 9:28 PM CT). It passed validator, package, test (ubuntu) and test (windows). The only skipped step was the fresh-venv README install on Windows. Locally: 154 repo tests passed, ruff clean, mypy clean (22 files), pip-audit found no vulnerabilities, and gitleaks found no leaks (06adef0..HEAD and the tree). Validator good run exited 0: unsigned buy_v3 and sell_v3 simulations passed against mainnet-cloned accounts and nothing was signed or submitted. Bad run, with the discriminator flipped, exited 1 with Custom 101. The temporary script was deleted and the tree is clean.

**No-send.** `cli.py:240` is still `RefuseBroadcaster()`. The only `submit` is `signer.py:1190`, and it now also requires `kind is BroadcasterKind.LIVE` (`:1187`). An injected recorder without that kind gets BROADCASTER_NOT_ENABLED and submits nothing. Every captured raw transaction has all-zero signatures. `rekey` appears nowhere in src or scripts.

**R2: closed.**
- In DRY_RUN, owner_sell closes the trade: status closed, `simulated=1`, recovered/P&L booked, ledger credited. This holds under a kill too. `sell_all` closes all 3.
- Flipping `trades.simulated` to 0 trips the digest: ANCHOR_MISMATCH, HALTED, and the mode is not LIVE.
- `set_mode("LIVE")` returns SIMULATED_FILL while a simulated trade is open (`:595`). The documented way to clear it is an owner_sell in DRY_RUN; after that LIVE is accepted.
- Reanchor with an untampered open simulated trade returns REANCHORED (repo test).
- LIVE plus a tamper-reopened trade boots HALTED and reanchor is refused.
- After a tamper, owner_sell writes no rows (OWNER_SELL_SIMULATED, open count unchanged), as designed.

**B5: closed for every case reachable without P6.**
- Restore under a running signer: next op ANCHOR_MISMATCH, anchor file 9→9 lines (not extended), reboot HALTED, reanchor refused.
- Empty anchor file: mismatch and HALTED.
- Deleted anchor file: mismatch and HALTED, because `anchor_meta.written=1` is digest-covered.
- Fresh DB at the same path with the old anchor: HALTED.
- Anchor file truncated with the DB intact: the next fill is allowed. That is benign, since the older anchor is still a prefix and nothing was rolled back.
- **P6 only (needs an off-PC anchor):** rolling the DB and anchor back together, or deleting both, gives ACTIVE → FILLED.

**B6: closed.**
- No rekey in the CLI or API.
- A keyless legacy rewrite stays refused: ANCHOR_MISMATCH, then reboot HALTED, unhalt/resume ANCHOR_MISMATCH, reanchor HASH_CHAIN.
- An event without `event_key_id` fails `verify_chain`.
- Lost key: boot HALTED. `init_event_key` stores a new key (EVENT_KEY_STORED), but the old chain still fails, so it stays HALTED with HASH_CHAIN. The same happens with a tamper added first. It is not a bypass.
- README:86 documents recovery: start a new DB and run `init-event-key`.

**Minors: closed.**
- `_ata_amount` returns None on a wrong mint or a wrong owner.
- Submit exceptions are recorded as fixed BROADCAST_REFUSED/BROADCAST_FAILED codes; exception text never reaches the `broadcast_result` event (checked with a secret-shaped message).
- reconcile_unknown is set at boot when the chain is not authoritative and a signing reservation exists; unhalt is refused.
- Boot during a halt keeps the trusted digest, and reanchor prints the diff keys (open_tokens, simulated_open, state_sha256, trade_count).

**Notes (non-blocking).**
- N1: After any real tamper, reanchor can never succeed, even if the edit is reverted (the diff shows state_sha256, because the post-tamper halt state differs from the trusted snapshot). The DB is dead and an open dry trade stays open. This fails closed, but there is no runbook for it beyond the lost-key case. A fresh DB also loses same-day counters (10 buys/day, $6 daily loss).
- N2: `_write_anchor` checks the prefix in one query (`:2523-2528`) and appends later (`:2541`). This is a local TOCTOU, P6 class. The broadcaster PR should re-check under a file lock.
- N3: `:1193` picks the code by comparing exception text against a fixed set. That is safe, but a typed exception would be cleaner.

**adv2.** 339 passed, 1 skipped. Rekey tests were converted to removal and refusal checks. LIVE-path tests now close the dry trade first. The broadcaster recorders carry `BroadcasterKind.LIVE`. New file `test_adv_850.py` has 23 tests.
