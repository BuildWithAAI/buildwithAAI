# Nothing here is live

This is a trading executor design. The current build cannot sign or broadcast. It boots in `DRY_RUN` and `PAUSED`. `LIVE` stays refused until the owner records `ROUTE_APPROVED` with an https permission URL, a date, and a hash of the permission text. Even then, an owner `resume` is required, and this build's broadcaster refuses to submit. The buy and sell builders assemble unsigned v0 messages. The sign step is refused before a key is read. A sweep still refuses. There is no `sendTransaction` path.

No private key, seed, or RPC URL belongs in the repo, the logs, CI, or chat. Tests generate throwaway keys in memory.

## What it enforces

Caps, in one SQLite `BEGIN IMMEDIATE`: $2 all-in, 3 open trades, 10 buys per Chicago day, $6 daily loss, $20 exposure, $25 wallet at mark, 1500 bps, 4 intents an hour. A kill holds every position until an owner CLI sell. Telegram can only halt. Buys need a fresh `vetcfg-20261117-v6` PASS from `python -m smr.vet`. The oracle is Pyth Hermes plus Jupiter, and a stale, wide, or disagreeing price halts.

The trade fee is read from the on-chain fee config. The recorded schedule is 95 bps protocol plus 30 bps creator. A missing or zero schedule fails closed. The global account's 95 bps protocol figure, read on 2026-11-17, is not used as a default.

## Windows setup

From PowerShell, in `projects\zoora-signer`:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --require-hashes -r requirements.lock.txt
python -m pip install --no-deps --no-build-isolation -e ".[dev]"
```

If activation is blocked, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` for this window only.

Create the data directory and the database path the CLI uses by default:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.zoora-signer" | Out-Null
```

### Credential Manager

The signing key and the HMAC key are prompted. They are not command-line arguments, so they do not land in shell history. The RPC URL may live in Credential Manager or in an ACL-locked env file. It is never a process environment variable.

```powershell
python -m keyring set zoora-signer signing-key
python -m keyring set zoora-signer hmac-key
python -m keyring set zoora-signer event-hmac
python -m keyring set zoora-signer rpc-url
```

Each command prompts. Paste into the prompt, not into the command. The signing key is hex. Quote nothing around the prompt value.

To lock an RPC env file instead of the RPC credential:

```powershell
$dir = "$env:USERPROFILE\.zoora-signer"
New-Item -ItemType Directory -Force $dir | Out-Null
notepad "$dir\rpc.env"
icacls "$dir\rpc.env" /inheritance:r /grant:r "${env:USERNAME}:(R)"
```

`rpc.env` may contain only:

```text
ZOORA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
ZOORA_RPC_PROVIDER=helius
```

A line whose name contains SIGNER, SEED, SECRET, HMAC, PRIVATE, or MNEMONIC is refused. Pass the file with `--rpc-env-file`. In PowerShell, quote paths that contain spaces:

```powershell
zoora-signer --rpc-env-file "$env:USERPROFILE\.zoora-signer\rpc.env" doctor
```

### Doctor and the owner commands

```powershell
zoora-signer doctor
zoora-signer status
zoora-signer halt
zoora-signer route-approved --source "written permission from pump.fun" --date 2026-11-17
zoora-signer mode dry-run
zoora-signer resume
zoora-signer expect-deposit 50000000 --ttl 3600
zoora-signer whitelist-add "YOUR_OWNER_ADDRESS"
zoora-signer sweep "YOUR_OWNER_ADDRESS" 1000
zoora-signer sell "MINT_ADDRESS" --tokens 1000
zoora-signer sell-all
zoora-signer reanchor --confirm REANCHOR
zoora-signer owner-sell-tampered "MINT_ADDRESS" --confirm OWNER_SELL
zoora-signer rotate-hmac
```

`init-event-key` generates a 32-byte event HMAC with `secrets.token_bytes` and stores it in Credential Manager as `event-hmac`. It prints `event key stored` and never prints the key. A key that matches `hmac-key`, is all one byte, or has fewer than 8 distinct bytes is refused. The public key id is the first 16 hex characters of the key's sha256 and is written on each event. A database whose events are still the old unkeyed sha256 chain is migrated with `rekey --confirm REKEY` after the owner has stored the key: the command reconciles the SOL balance, then appends an `event_key_genesis` event. Events before that event stay on the unkeyed hash. Events from that event onward use the keyring HMAC. This build does not keep a previous HMAC key, so `init-event-key` refuses when a key is already stored.

`rotate-hmac` prompts. `mode live` is refused until `route-approved` has been recorded. A devnet Helius host is refused in `LIVE` and remains available for a dry run. Resume runs the preflight again. A failed check leaves the process `PAUSED`.

`reanchor --confirm REANCHOR` records the state only when the kill switch is clear, the event chain verifies with the `event-hmac` key, the ledger matches the authoritative SOL balance, and no reservation is reserved or signing. It does not repair a tampered ledger.

`owner-sell-tampered` is the owner sell after that kind of tamper. It requires `--confirm OWNER_SELL` and a clear kill switch. The size is the owner's token balance on the chain. The sell pays the owner's own wallet. The ledger is not changed, and the event keeps the previous state digest so the halt stays. This build still returns `BROADCAST_REFUSED`.

PowerShell treats `--date 2026-11-17` as a single argument. If a source text contains spaces, keep it in double quotes as shown. Do not put a key in those quotes.

## Tests

```powershell
python -m pytest
python -m ruff check src tests scripts
python -m mypy --strict src/zoora_signer
```

The local validator rehearsal is `python scripts/e2e_validator.py`. It loads the account snapshot in `fixtures/e2e_curve.json` (public RPC, 2026-11-17), clones the pump and token programs with `--clone-upgradeable-program`, and simulates the real unsigned `buy_v3` and `sell_v3` builders with `sigVerify` false. It never signs or submits. The required CI jobs do not run it. An optional job installs Solana CLI `v4.4.1` and runs the script. That job is `continue-on-error` because the program clone uses the public RPC.

Credential Manager entry ACLs are not readable through the keyring API used here. The owner confirms those ACLs in Windows Credential Manager. The file ACL check covers the database, its directory, and `rpc.env`.

## Before any live use

1. Acceptance tests 1 through 13 are green on this commit.
2. `zoora-signer doctor` is all pass on the owner's PC: clock, Defender or another AV product, standard user, owner-only ACL, signing key present.
3. The owner has stored the key and the Helius URL in Credential Manager.
4. `ROUTE_APPROVED` cites a written pump.fun permission, with its date, in the event chain.
5. Head of Security GO, Head of Systems GO, and Zoorped's final approval in his own words.
6. The owner runs `resume` himself. This repository build still will not broadcast.
