# Zoorped OPSEC & Threat-Intel Pipeline

A keyless, self-hosted pipeline that pulls crypto-security intelligence from public sources, normalizes and de-duplicates it,
scores every incident for **severity** and **relevance to your exposure** (Bybit, BloFin, Solana/pump.fun/Phantom, MT5, Ledger…),
audits **public** wallet addresses for risky approvals/delegates, and ships a Markdown digest plus JSON alerts.

## Security rules (enforced in code)
- **Never** request, store, or handle private keys, seed phrases, passwords, or API secrets. `wallets/check.py` refuses anything
  that looks like a private key or seed phrase (`_guard`).
- Wallet monitoring uses **public addresses only** (read-only RPC/explorer calls).
- Only free keyless sources. Optional `ETHERSCAN_API_KEY` (free tier) adds approval discovery on Base/Arbitrum/Polygon/BSC; without it those
  chains are reported as "approval discovery unavailable" and the run continues.

## Setup
```bash
cd /workspace/security-pipeline
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q tests        # offline unit tests
```

## Commands
```bash
.venv/bin/python run.py                          # last 24h, WATCH+ -> out/digest_latest.md, out/alerts_latest.json
.venv/bin/python run.py --since 24h --tier HIGH  # only CRITICAL/HIGH
.venv/bin/python run.py --since 30d --tier WATCH # wider window
.venv/bin/python run.py --no-ingest --since 7d   # re-score/re-report from local DB (no network)
.venv/bin/python run.py --no-wallets -v          # skip wallet audit, verbose logs
.venv/bin/python run.py --exit-code-on-critical  # exit 2 if any CRITICAL (for alerting wrappers)

# Wallet audit (public addresses only)
.venv/bin/python -m wallets.check                         # addresses from config/exposure.yaml
.venv/bin/python -m wallets.check --no-config --evm 0xYourPublicAddress --chains ethereum,optimism
.venv/bin/python -m wallets.check --no-config --sol YourSolanaPublicKey

# Phishing / token checks
.venv/bin/python -m phishing.check url https://bybit-airdrop.xyz blofin.com "https://pump-fun.org/claim"
.venv/bin/python -m phishing.check token <SolanaMint>                 # RugCheck + GoPlus
.venv/bin/python -m phishing.check token 0xToken --chain ethereum     # GoPlus
```

Outputs: `out/digest_latest.md`, `out/alerts_latest.json`, `out/incidents_latest.json`, `out/archive/alerts_<run_id>.json`
(last 200 kept). Logs: stderr + `data/pipeline.log` (rotating). DB: `data/intel.db` (SQLite, WAL).

## Scheduling (cron, America/Chicago)
```cron
CRON_TZ=America/Chicago
0 */4 * * *  cd /workspace/security-pipeline && .venv/bin/python run.py --since 24h >> data/cron.log 2>&1
15 7 * * *   cd /workspace/security-pipeline && .venv/bin/python run.py --since 7d --tier WATCH >> data/cron.log 2>&1
```
Safe to schedule: a non-blocking lock (`data/run.lock`) prevents overlap, upserts are idempotent, outputs are written atomically,
and every source runs isolated — a dead source is logged and listed under "failed sources" but never breaks the run.

## Adding your wallets (public addresses only)
Edit `config/exposure.yaml`:
```yaml
wallets:
  evm:
    - {address: "0xYourPublicAddress", label: "MetaMask main", chains: [ethereum, base, arbitrum]}
  solana:
    - {address: "YourPhantomPublicKey", label: "pump.fun burner 1"}
known_bad_addresses: []     # optional extra denylist
```
With zero addresses the wallet stage reports "Wallet monitoring idle" and the run completes normally.

## What is checked
| Stage | Checks | Sources |
|---|---|---|
| intel | hacks, exploits, drainers, supply-chain, malware, account takeovers, outages | DeFiLlama hacks DB, rekt.news, CoinDesk, Cointelegraph (+hacks tag), Decrypt, The Block, The Defiant, Protos, CryptoSlate, Web3 Is Going Great, SlowMist, Chainalysis, TRM Labs, BleepingComputer, The Record, Bybit announcements, Google News RSS queries (Bybit, BloFin, Solana/Phantom/pump.fun, MT5, wallet security, PeckShield/CertiK alerts) |
| scoring | severity (category, loss, recency, status, corroboration) × relevance (your entities, attack class) → CRITICAL/HIGH/WATCH/INFO; incident clustering across sources (same entity+category within ±4 days); follow-up/retrospective coverage capped | `config/exposure.yaml` |
| wallets/EVM | live ERC-20 allowances, NFT operator approvals, Permit2 allowances (verified on-chain), spender = EOA / known-bad / GoPlus-flagged, address-poisoning, interactions with known-bad addresses | Blockscout (eth, optimism), PublicNode RPC, ScamSniffer address list, GoPlus |
| wallets/Solana | SPL + Token-2022 delegates, foreign close authority, frozen accounts, account owner reassignment, bad counterparties | Solana public RPC (`SOLANA_RPC_URL` override), ScamSniffer |
| phishing | lookalikes (homoglyph, typo, brand+lure, other TLD, brand subdomain), IDN, risky TLDs, MetaMask + ScamSniffer lists, GoPlus, RDAP domain age | MetaMask eth-phishing-detect, ScamSniffer, GoPlus, rdap.org |
| tokens | mint/freeze authority, LP, holder concentration, honeypot/tax flags | RugCheck, GoPlus |

### Source status (verified live 2026-11-01)
- Working: all of the above.
- Failing / disabled: `blofin_announcements` (Cloudflare 403 — kept enabled so the gap stays visible; `gnews_blofin` covers BloFin news),
  `certik_blog` (no public RSS, 404 — disabled), `peckshield_medium` (stale since 2021 — disabled). Also unusable keyless: rekt.news RSS (500, HTML parser used instead),
  Bybit public API/status (geo-blocked 403), Blockscout for Base/Arbitrum/Polygon (403; set `ETHERSCAN_API_KEY`).

## Tiers
- **CRITICAL**: relevance ≥ 0.8, severity ≥ 55, ≤ 7 days old, not mitigated, an incident (or a CRITICAL wallet finding).
- **HIGH**: relevant incident (relevance ≥ 0.6, severity ≥ 40) or any very severe recent incident (severity ≥ 75, ≤ 14 days).
- **WATCH**: moderately relevant or severity ≥ 50. **INFO**: everything else.

Limitations: rule-based triage, not attribution; loss figures come from DeFiLlama or reporting and change as incidents develop. Verify via
official channels before acting. Large wallets (thousands of approvals) take minutes to audit.
