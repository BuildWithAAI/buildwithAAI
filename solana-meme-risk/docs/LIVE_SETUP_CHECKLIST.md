> **SUPERSEDED (2026-11-09, 9:46 PM CST):** Zoorped rejected this vendor stack (Turnkey, Helius paid tiers, vendor signing services, the monthly cost plan): "We will have our own systems." See **`docs/INHOUSE_EXECUTOR_DESIGN.md`** for the in-house signal → Python executor design (rev 2 2026-11-09: Windows PC, encrypted keystore, fully automated, free public RPC only, 30% float). Kept for history only.

# Live Setup Checklist — experiment100

**Audience:** Head of Systems & Trading Operations  
**Author:** Solana Research & Risk Analyst  
**Date:** 2026-11-09 (America/Chicago)  
**Status:** RESEARCH ONLY. Nothing in this document is funded, created, signed, or approved. No wallet, key, deposit, signup, or card action was taken while writing it. Going live still requires Zoorped's approved risk limits through Head of Systems & Trading Operations. Seed phrases and private keys must never appear in chat, logs, the repo, or this file.

---

## Recommended stack (proposal, not approved)

| Layer | Recommendation | Why |
|---|---|---|
| Custody | Dedicated hot **burner** trading wallet with a **small float**. Zoorped alone funds and sweeps it. A separate **cold vault** holds the rest. The bot never holds withdrawal authority to other wallets. | Matches agent-guard: burner only, human top-ups, empty withdrawal allowlist. Limits loss if the box or a key-access path is compromised. |
| Signing | **Turnkey** (policy-gated TEE signer) as first choice; **vault / KMS** as the self-hosted alternative. **Do not** keep a local keypair file on this box. **Do not** use PumpPortal Lightning (third-party custodial signing). | All agents share Unix user `box`, so a file on disk is visible to every agent. Turnkey never returns the raw key and can enforce amount, program, and recipient policies. |
| Pre-graduation execution | Official **pump.fun SDK / bonding-curve program**, self-signed, landed through a paid RPC + Jito. | Avoids a third-party trading API and Jupiter's 50 bps `/order` fee on tokens less than 24 hours old. Protocol fee is already 100 bps. |
| Post-migration execution | **PumpSwap** via the official SDK, or **Jupiter Swap API `/build`** (no Jupiter platform fee) + our own landing. | Graduated coins leave the curve. `/build` keeps fee control and lets us attach Jito tips and simulate before send. |
| RPC / landing | **Helius Developer ($49/mo)** plus **Jito `sendTransaction`** (priority fee + tip, both capped). Use **Helius Sender** (included on all plans). Escalate to Helius Business only if native `sendBundle` is required. | Public RPC is already insufficient for indexed holder reads and reliable sends. Developer includes staked connections and Sender; `sendBundle` starts at Business ($499/mo). |
| Holder quality | Restore **StalkChain** credits before any live or shadow-funded entry. Keep `require_quality_preentry=true`. | Hard pre-entry gate in the paper book. The StalkChain account is currently out of credits. |
| Risk envelope | Start from the paper sleeve, then add a daily loss limit, wallet float cap, kill switch, program allowlist, slippage and fee caps, Mayhem hard skip, first-N manual approval, fill reconciliation, and alerting. | Paper rules are unvalidated live. agent-guard currently has `solana_meme` **locked to no trading**. |

This stack is a research recommendation. Zoorped must approve limits and fund the wallet himself. Bots do not deposit, add cards, or buy credits.

---

## 0. Current baseline (paper only, as of 2026-11-09)

The strategy lives in `/workspace/solana-meme-risk`. `experiment100` is an isolated **$100 paper** book. `live_trading` is `false`. The execution venue is **not configured**. No wallet, send path, Jito bidder, or Helius key is present in the repo.

Paper rules already in force (`data/experiment100/scanner.json`, exit policy `clip5_rug_dust`, fee model `ff20261105-v1`):

- Size: **$1** entries; **$2** only once free cash reaches **$250** from strategy gains.
- Sleeve: max **15** open positions, **$15** open principal, **$85** cash floor, max **3** new entries per 300 s cycle.
- Exits: sell 20/20/20/20/15% of the original position at 2/3/4/6/10x; keep 5% dust. Stop at **−50%** before the first take-profit; after it, trail at `max(entry, 60% of peak)`. Rug exits on the next mark. Maximum hold **48 h**.
- `fade_exit_20261105-v1` is labeled `SIMULATION_ASSUMPTION_NOT_VALIDATED` and must not be treated as a proven live rule.
- Modeled fees: base 5,000 lamports/signature, a conservative (not observed) priority screen of 400k CU at 50k micro-lamports/CU, a conservative Jito tip screen of 100,000 lamports (official minimum is 1,000), and token-account rent of 1,488,440 lamports. Failed transactions and retries are unmodeled. An entry is rejected when estimated fixed drag exceeds 25% of size.
- Discovery: DexScreener and GeckoTerminal. The pump.fun frontend API has been Cloudflare-blocked (HTTP 403) since 2026-11-02 and **must not be bypassed**.
- RPC today: public endpoints only (no Helius key).
- Holder quality: StalkChain MCP, `require_quality_preentry=true`, CLEAR freshness 1,800 s, daily lookup budget 30 with reserve 3. The StalkChain account is **out of credits** (observed 2026-11-09 ~11:14 America/Chicago: "No credits on this account", balance −13). Unknown quality is shadow-logged only and never funded.
- Mayhem mode is a **hard skip**; unknown Mayhem status is treated as Mayhem (no entry).

**agent-guard lock (must not be ignored):** `/workspace/agent-guard/config/limits.json` is the numeric source of truth. As of **2026-11-09 18:51 CT**, `solana_meme` is `enabled: false`, venues and symbols empty, all order caps zero, and annotated *"NO TRADING - locked by Zoorped"*. The 2026-11-03 `SECURITY_POLICY.md` still mentions older burner caps (≤ $50/order, approval above $25, 3/h, 10/day); those figures are **not currently authorized**. Live trading requires Zoorped to re-enable the agent and approve new limits through Head of Systems & Trading Operations. Tightening is allowed; loosening is human-only.

Security policy that still applies regardless of limits: keys only in the Grok Bot vault or process environment; never in the repo, committed `.env` files, or JSON under `/workspace`. No seed phrases or funded private keys on this box. `money_movement.allowed_destinations` is empty. The kill switch cannot revoke keys; Zoorped must revoke signing credentials himself if it is thrown.

---

## 1. Wallet type and custody

### 1.1 Dedicated hot burner with a small float (recommended shape)

Use a **new, dedicated trading wallet** that holds only the working float. Zoorped funds it from a cold vault he controls, and Zoorped sweeps excess back. The bot can sign **buys and sells of approved programs inside that wallet**; it cannot transfer SOL or tokens to any other address.

Proposed float cap to take to Zoorped (not approved): enough for the $15 open-principal sleeve plus a fee and rent buffer, on the order of **$20–$30**, not the full $100 paper bankroll and never a funded personal wallet. Top-ups and sweeps are **owner actions only**.

This matches agent-guard §5: "Solana: use burner wallets only, topped up manually to the cap. Seed phrases for funded wallets stay offline and never touch this box."

### 1.2 Server-side signer in a vault or KMS versus a local keypair file

| Option | What it is | Verdict for this box |
|---|---|---|
| Local keypair file (`id.json`, exported Phantom/Solflare JSON, or similar) | Raw Ed25519 secret on disk, loaded by the bot process. | **Reject for live.** Every agent runs as the same Unix user `box` on one shared machine. File permissions cannot isolate agents (agent-guard §0). A compromised or confused agent can read the file. |
| Vault or cloud KMS (HashiCorp Vault transit, AWS/GCP KMS, or the Grok Bot vault holding a signing credential) | Key material stays in the vault/KMS; the bot requests signatures. IAM or vault policy controls access. Solana documents these as supported backends. | **Acceptable** if Zoorped does not want a wallet vendor. Still needs a program/amount policy in *our* code and in agent-guard, because KMS will sign whatever digest it is handed unless a policy layer sits in front. |
| Policy-gated TEE/MPC signer (Turnkey first; institutional MPC such as Fireblocks/Dfns if Zoorped later wants a custodian) | Key is generated and used inside a TEE or MPC set. The bot holds an API credential with scoped policies, not the raw key. | **Preferred.** Policies can cap amount, allowlist programs, and deny transfers to arbitrary recipients even if our code is wrong. |

Solana's official backend guide (retrieved 2026-11-09) distinguishes memory/local keys (dev/test only), self-hosted Vault/KMS, embedded wallets (Turnkey, Privy, and others), and institutional MPC (Fireblocks, Dfns, Para, Utila, Fordefi).

### 1.3 MPC or embedded-wallet providers (Turnkey vs Privy)

**Turnkey** is key-management and signing infrastructure. Keys persist as ciphertext and are used inside a TEE; only the signature leaves. Custody can be custodial (app API key authorizes signing), non-custodial (user authenticator), or hybrid. Policies can restrict Solana transfers, programs, and amounts. This is the better fit for a server-side trading bot that must sign without a human on every click, but only inside tight limits.

Turnkey pricing (official page, retrieved 2026-11-09):

- Pay as you go: 25 free signatures per month, then **$0.10 per signature**; up to 1,000 free wallets. Connecting a card is required only after the free allowance, and we are **not** signing up.
- Pro: **$99/mo** and **$0.05 per signature**.
- Enterprise: custom, as low as $0.0015 per signature.
- Optional Transaction Management (broadcast + retry) is priced separately ($0.20 / $0.10 / custom per landed transaction). For this stack we would sign with Turnkey and broadcast ourselves, so that add-on is optional.

**Privy** is primarily an embedded-wallet + authentication product (email, passkeys, social login, consumer wallets). It has a policy engine (transfer limits, recipient and program allowlists, time-bound signers) and TEE + 2-of-2 key shares. It is a weaker fit for a headless server bot. Stripe announced an acquisition of Privy in June 2025; treat that as vendor-risk context only. We do not need Privy for this use case.

**PumpPortal Lightning** signs and sends from a wallet it manages for an API key. Official PumpPortal pages describe Lightning as "we handle sending the transaction" and Local as "you handle signing and sending yourself." Lightning is **custodial third-party signing** and is incompatible with "the bot never holds — and a vendor must not hold — withdrawal or signing power over Zoorped's funds." **Do not use Lightning.**

### 1.4 Recommended separation

1. **Cold vault** (hardware wallet or offline key): holds almost all SOL. Zoorped only. Never imported onto this box, never placed in a vault the bot can read, never used as a fee payer for bot transactions.
2. **Hot burner / trading wallet**: small float, public address known to the bot. Signing only through Turnkey or KMS. Policy denies System Program transfers except (a) rent/ATA creation that is part of a swap and (b) Jito tip accounts as part of the same swap transaction. No sweep instruction is ever authorized to the bot.
3. **Sweeps and top-ups:** Zoorped, by hand, from a wallet the bot cannot sign. agent-guard `guard_money_movement()` stays in force; `allowed_destinations` stays empty.
4. **Credentials:** Turnkey/KMS API key and paid RPC key in the Grok Bot vault or process env only. Never in git, `data/`, Telegram, or logs. Audit tools must fingerprint, not print, secret-looking fields.

---

## 2. Execution tooling

The paper book has **no configured venue**. A live executor has to be built, then proven in shadow and dry-run before any real send.

### 2.1 Venue comparison

| Venue | Role | Fees (sourced) | Custody / control | Fit for $1–$2 pump.fun entries |
|---|---|---|---|---|
| Official pump.fun bonding-curve program + SDK | Pre-graduation buy/sell against the curve. Program ID `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` (official pump-public-docs). | Protocol `fee_basis_points` is **100 bps** on buy/sell, per the on-chain `Global` account documented in the official readme. Network + priority + optional Jito tip on top. | Self-custody. We build, sign, simulate, and send. | **Primary recommendation** for coins still on the curve. |
| Official PumpSwap (post-migration AMM) | After the curve completes, liquidity migrates to PumpSwap. Program ID `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` (official PumpSwap docs). | Official `GlobalConfig`: **20 bps LP** + **5 bps protocol** (25 bps total) on buy/sell; no fee on deposit/withdraw. Plus network fees. Creator or holder-reward fees may apply on some pools. | Self-custody via official SDK, or via Jupiter `/build`. | **Primary post-graduation route.** |
| Jupiter Swap API `/build` + our RPC or `/submit` | Raw Metis instructions; we assemble, sign, simulate, and land (own RPC, Jito, or Jupiter `/submit`). `forJitoBundle=true` is documented. | **No Jupiter swap fee** on `/build`. | Self-custody. Full control of CU, tips, and simulation. | **Recommended** when we need aggregator routing (especially graduated coins) or want one code path for curve + AMM if Metis routes it. |
| Jupiter Swap API `/order` + `/execute` | Meta-aggregator quote + assembled tx; Jupiter lands it. | Platform fee on `/order`: 0 bps for Jupiter tokens or pegged assets, 2 bps SOL→stable, 5 bps LST→stable, **10 bps otherwise**, and **50 bps on tokens less than 24 hours old**. RTSE slippage unless overridden. | We sign; Jupiter lands. `/order` transactions must not be modified (JupiterZ last-look). | **Poor default for this book.** Most pump.fun targets are < 24 h old, so 50 bps is material on a $1 size, and we lose Jito/simulate control. Use only if a measured fill-quality test beats `/build` after fees. |
| PumpPortal Local (`/api/trade-local`) | Third-party builder returns an unsigned transaction; we sign and send on our RPC. Pools include `pump`, `pump-amm`, `raydium`, `auto`, and others. | Official pages fetched 2026-11-09 **do not publish a fee schedule**. A third-party guide dated 2026-11-07 claimed Local 0.5% and Lightning 1%; treat that as **unconfirmed**. Any PumpPortal cut stacks on the 100 bps protocol fee. | Self-sign, but we depend on a third party to construct the bytes. | **Fallback only**, after fee terms are read from PumpPortal and after a build-vs-official-SDK comparison. Never the first choice on $1 size. |
| PumpPortal Lightning (`/api/trade`) | PumpPortal builds, signs, and sends from a wallet tied to an API key. Default `skipPreflight` is **true**. | Same fee-schedule gap as above. | **Custodial. Do not use.** | Rejected. |
| Hand-rolled Raydium route | Historical post-migration path; pump.fun now migrates to PumpSwap, not the old withdraw-to-Raydium flow (`enable_migrate` is true; `withdraw` is deprecated). | n/a as a default. | Unnecessary complexity unless a specific coin actually lives on Raydium. | Not the default. Support only if a position has already migrated to a Raydium pool we can identify on-chain. |

Do **not** call or scrape the Cloudflare-blocked pump.fun frontend/API as a trading or discovery path.

### 2.2 Jito bundles, tips, priority fees, paid RPC, slippage, MEV

**Priority fee vs Jito tip** (Jito docs and Solana cookbook, retrieved 2026-11-09):

- A **priority fee** is `compute_unit_price × compute_unit_limit` and is paid to the leader. It works on any send path.
- A **Jito tip** is an ordinary SOL transfer to one of Jito's tip accounts. It only helps if the transaction actually reaches Jito's block engine. Official **minimum is 1,000 lamports**; the live floor is often higher — read `https://bundles.jito.wtf/api/v1/bundles/tip_floor` at send time. Pick a tip account at random from `getTipAccounts`. Do not put tip accounts in an address-lookup table. Put the tip in the **same** transaction as the swap so a failed swap does not pay the tip.
- For Jito `sendTransaction`, Jito suggests a **70% priority / 30% tip** split as a starting point. For `sendBundle`, **only the tip matters**.
- Failed on-chain transactions still pay base + priority. A same-transaction tip reverts with the swap. Paper currently assumes the success path only.

**Proposed caps (for Zoorped to approve, not live):** a hard ceiling on priority fee plus tip per transaction, well below trade size (paper already rejects entries where modeled fixed drag > 25% of size). Bid from a recent-fee oracle (Helius Priority Fee API, Jupiter `/build` percentile, or Jito tip floor), then clamp to the cap. Recalibrate the paper `ff20261105-v1` screens against **observed** fees before treating them as a live budget; the 50k micro-lamport / 400k CU screen is labeled conservative and is not an observed venue setting.

**Paid RPC** (official pricing retrieved 2026-11-09). Public RPC cannot be the live send or holder-index path.

| Provider | Pilot-relevant plan | Notes |
|---|---|---|
| **Helius** (recommended default) | Developer **$49/mo**, 10M credits, 50 RPC RPS, 5 `sendTransaction`/s, staked connections, LaserStream WSS, Sender included. Extra credits $5/M. | `sendBundle` is **not** on Developer; it starts on **Business ($499/mo)**, 5 bundles/s. Sender (multi-path landing, 7 regions) is included on all plans. Free tier ($0, 1M credits, 1 send/s, no staked connections) is not enough for live sends. |
| QuickNode | Build **$49/mo** (80M credits, 50 RPS) or Accelerate **$249/mo**. Annual is 15% lower. | Solid alternative. Solana gRPC is a $499 add-on until Scale ($499/mo). |
| Triton One | Pay-as-you-go: **$10 per million calls + $0.08/GB**, **$125 minimum prepaid deposit**, usable 12 months, no monthly subscription. | Fine alternative if Zoorped prefers PAYG. The $125 deposit is an **owner payment**; the bot must not place it. |

Recommendation: start on **Helius Developer + Jito `sendTransaction` + Helius Sender**. Do not jump to Helius Business unless measured landing rates show that atomic bundles are required.

**Slippage:** set a **fixed hard cap** in our executor (proposed starting point: **300–500 bps**, i.e. 3–5%). Do not inherit PumpPortal's example of 10%, and do not let Jupiter RTSE raise slippage without a cap. Quote, simulate, then refuse to sign if the simulated output breaches `otherAmountThreshold` / `min_sol_output` / `max_sol_cost`.

**MEV:** prefer a Jito route (tip + `jitoOnly` or Jito `sendTransaction` / bundle) so the swap is not sitting in the public mempool. This is protection, not an edge claim.

### 2.3 Simulate-before-send (mandatory)

1. Build the unsigned (or locally signed) transaction.
2. Call Solana `simulateTransaction` (official RPC method) with `encoding=base64`, and either `replaceRecentBlockhash=true` (unsigned / pre-sign) or `sigVerify=true` after signing — the two options conflict. Inspect `err`, `unitsConsumed`, `logs`, and pre/post token balances.
3. Use `unitsConsumed` (plus a safety margin) to set `SetComputeUnitLimit`, then re-simulate if the CU limit changed.
4. Send only if simulation succeeds and the simulated fill is inside slippage and fee caps.
5. After our own simulation, `sendTransaction` may use `skipPreflight=true` to avoid a duplicate preflight on a now-stale blockhash (Triton sending best-practices). Do **not** skip preflight *instead of* our simulation.
6. PumpPortal Lightning defaults `skipPreflight` to true — another reason not to use it. If Local is ever used, force simulation ourselves; do not rely on their default.

Confirm fills with `getTransaction` / token-balance diffs. Do not mark a paper-equivalent fill from a signature alone.

---

## 3. Risk controls (proposed; await Zoorped's approval)

These are **proposals** for Head of Systems to take to Zoorped. They are not live limits. `solana_meme` is currently locked to no trading.

### 3.1 Quantitative envelope (start from the paper sleeve)

| Control | Proposed starting value | Notes |
|---|---|---|
| Per-trade cap | **$1** (tier-2 **$2** only after free cash ≥ $250, same as paper) | Far below any historical policy text. Do not start at the stale $50 figure in the 2026-11-03 security-policy prose. |
| Max open positions | **15** | Same as paper. |
| Max open principal | **$15** | Same as paper. |
| Cash / reserve floor | **$85** of the $100 sleeve left un-deployed, plus a **wallet float cap** (see below) | Paper reserve is a bookkeeping floor; the on-chain float cap is the real backstop. |
| New entries per cycle | **3** per 300 s | Same as paper. |
| Daily loss limit | **Propose $10** (10% of the $100 sleeve), kill new entries for the Chicago day when hit; flatten or hold existing positions per the exit policy | Not in the paper book today. Needs an explicit owner number. agent-guard defaults (3% of equity) are a reasonable alternative if Zoorped prefers percent. |
| Wallet float cap | **Propose $25** on the burner at any time | Zoorped does not top up above this. Excess is swept by Zoorped, not the bot. |
| Max slippage | **Propose 300–500 bps**, hard refuse above | Apply on buy and sell. |
| Max priority fee + Jito tip | Cap per tx; refuse to send above it even if the oracle prints higher | Recalibrate from observed data in shadow mode. Paper's 0.02 SOL priority screen can exceed a $1 size at current SOL prices and is a screen, not a bid. |
| Hourly / daily trade-count caps | To be set when agent-guard is re-enabled | Historical policy text said 3/h and 10/day; current lock is 0/0. |
| Human approval | **Every live trade for the first N** (propose **N = 10** successful fills, or the first 7 Chicago days, whichever is later); after that, approval above a notional Zoorped sets | Required by the go-live sequence. |

### 3.2 Hard skips and policy gates (keep from paper)

- **Mayhem-mode hard skip**, including unknown status. Detection stays on free on-chain data (`smr/mayhem.py`): BondingCurve `is_mayhem_mode` at offset 81, Mayhem program `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e`, agent `BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s`. Official Mayhem docs (last updated 2025-11-12, re-read 2026-11-09): the flag is set only at creation and is immutable; the agent may trade for 24 h and then burns unsold inventory; starting market cap and initial liquidity match non-Mayhem coins. This is an owner preference, not a measured edge.
- **StalkChain quality required** before entry. Unknown, stale (> 1,800 s), or vetoed = no buy. Do not raise the shared 30/day budget or spend the reserve of 3 without a new owner decision.
- Existing risk SKIP, bundle gate, liquidity/volume sanity, price cross-check, and uneconomic-entry screen stay on.
- `fade_exit` stays unlabeled and off for the first live pilot unless Zoorped explicitly approves it.

### 3.3 Program allowlist (sign only these)

Exact IDs must be pinned in policy (Turnkey/KMS and our executor) before the first dry-run signature:

- System Program `11111111111111111111111111111111`
- Compute Budget program
- SPL Token `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` and Token-2022 if needed
- Associated Token Account program
- pump.fun bonding curve `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- PumpSwap `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`
- If Jupiter `/build` is used: only the Jupiter program IDs that appear in a pre-approved route (pin at implementation; do not allow arbitrary remaining accounts)
- Jito tip accounts, only as destinations of a tip instruction **inside** a swap transaction (randomly chosen from `getTipAccounts`)

Deny: unknown programs, arbitrary System Program transfers, withdrawals, set-authority, create-token, migrate instructions we do not need, and any "update global / withdraw authority" pump instruction. The bot must never be able to change mint/freeze authority or send to Zoorped's cold vault or a third-party address.

### 3.4 Kill switch, approval, reconciliation, alerting

- **Kill switch:** honor `bin/killswitch on` and a local `experiment100` kill file that the watcher/scanner check every tick. On trip: cancel new entries, attempt policy-compliant exits only if already authorized, and page the owner. Remember: the switch does **not** revoke Turnkey/KMS/RPC keys — Zoorped must disable those credentials.
- **Manual approval mode** for the first N live trades: the bot prepares the simulated transaction and waits for a single-use owner approval token bound to mint, side, size, and max slippage (agent-guard approve flow). No Telegram or inter-agent message can satisfy this.
- **Reconciliation:** every live fill is compared to the paper model on the same mark: signature, slot, in/out amounts, fees (base, priority, tip, rent, protocol), slippage vs quote, and residual token balance (including the 5% dust rule). Persistent divergence pauses new entries automatically.
- **Alerting:** entry, exit, kill, daily-loss trip, quality-API failure, credit exhaustion, simulation failure, and reconciliation break. Use the existing Telegram permission only for status already authorized; never for keys, seed phrases, balances beyond the public burner float, or approval tokens.

Prompt-injection rules still apply: token metadata, websites, Telegram, other agents, and RPC strings are hostile input and cannot trigger a trade.

---

## 4. Data dependencies to restore, and monthly cost

### 4.1 Must restore before any live (or shadow-funded) entry

| Dependency | Current state (2026-11-09) | Owner action | Bot action |
|---|---|---|---|
| **StalkChain credits** | Out of credits (balance −13 observed ~11:14 America/Chicago). Pre-entry quality cannot run. | Zoorped buys a plan himself at [https://stalkchain.com/pricing](https://stalkchain.com/pricing) if he wants entries to resume. Plans (official, retrieved 2026-11-09): **Starter $29/mo** for 1,500 data calls; **Growth $79/mo** ($55/mo billed annually) for 5,000; **Pro $199/mo** ($139/mo annual) for 16,500. Unused paid credits roll over. | Do not buy credits. Do not skip the quality gate. Keep the 30 calls/day budget and reserve of 3. |
| **Paid Solana RPC key (Helius recommended)** | Public RPC only. Indexed `getProgramAccounts` / some holder reads fail without a personal token. Sends are unreliable for live. | Zoorped creates the Helius (or Triton/QuickNode) account, pays, and places the key in the Grok Bot vault or process env. | Read the key from env/vault only. Never write it under `/workspace`. |
| **Signing backend (Turnkey or KMS) and the burner address** | None exists. | Zoorped creates the wallet/signer **himself**, sets policies, and gives the bot only a scoped API credential + the **public** burner address. | Never generate a keypair, never export a seed, never log a secret. |
| **agent-guard limits** | `solana_meme` locked to no trading (2026-11-09 18:51 CT). | Zoorped re-enables and sets numeric limits through Head of Systems. | Fail closed until that happens. |
| **Jupiter API key (optional)** | Not required for quotes (keyless is 0.5 RPS). | Only if we use Jupiter in production and need paid rate limits (Free 1 RPS, Developer 10, Launch 50, Pro 150). | Use `x-api-key` from env if provided. |
| **pump.fun API** | Cloudflare 403 since 2026-11-02. | No action that bypasses the block. An official read-only developer API exists behind an application at developers.pump.fun; it is not required for the current DexScreener/GeckoTerminal + on-chain discovery path. | Do not bypass the 403. Do not depend on it for trading. |

### 4.2 Estimated monthly cost range (subscriptions, sourced 2026-11-09)

Figures are **vendor list prices**, not a quote, and exclude protocol fees, priority fees, Jito tips, rent, and slippage. SOL-denominated trading costs scale with network congestion and are **not** in the subscription total. The bot has not purchased anything.

**Low (tiny live pilot, recommended starting infra):**

- StalkChain Starter $29
- Helius Developer $49
- Turnkey Pay as you go: $0 for ≤ 25 signatures, then $0.10 each. A quiet $1-size book (on the order of tens to low hundreds of signatures a month: one entry plus several clip/stop txs) is roughly **$0–$20**.
- **Subscription subtotal: about $78–$98 / month**

**Mid (more quality lookups, or shared StalkChain use):**

- StalkChain Growth $79 (or $55 if Zoorped chooses annual)
- Helius Developer $49
- Turnkey PAYG ~$0–$20, or Pro $99 if signature volume or policy limits justify it
- **Subtotal: about $128–$228 / month**

**High (only if measured landing needs Helius `sendBundle` or heavy RPC):**

- Helius Business $499 (required for Helius-native `sendBundle`)
- StalkChain Growth $79 or Pro $199
- Turnkey Pro $99 or PAYG
- **Subtotal: about $577–$797 / month**

Alternatives that can replace the Helius line item: QuickNode Build $49; Triton PAYG after a $125 prepaid deposit (not a monthly fee; unused balance lasts 12 months).

**Variable trading drag, not in the monthly subscription:**

- pump.fun protocol fee **100 bps** on curve trades (official Global config).
- Jupiter `/order` **50 bps** if used on tokens younger than 24 hours — avoid as the default.
- Token-account rent ~1,488,440 lamports (~0.00149 SOL), typically forfeited under the 5% dust rule.
- Base fee 5,000 lamports per signature.
- Priority fees and Jito tips: market-dependent. Paper's conservative screens (0.02 SOL priority + 0.0001 SOL tip) can rival or exceed a $1 size depending on SOL/USD and must be replaced with capped, observed bids. Failed txs still burn base + priority.

On a $1 ticket, 100 bps of protocol fee is already $0.01, and rent plus a busy-network priority bid can make many trades **uneconomic**. The existing 25% fixed-drag screen should stay on, and the first pilot should expect more rejected entries than the paper book did when it ignored live fee markets.

---

## 5. Go-live sequence

Nothing below is in progress. Owner actions and bot actions are separated. The bot never deposits, adds a card, generates a seed, or signs a mainnet transaction until the named owner steps are done and limits are approved.

### Stage A — Research complete (this document)

- **Bot:** Publish this checklist. Keep paper trading labeled paper. Keep `live_trading=false`.
- **Owner:** Read it. No funding yet.

### Stage B — Shadow mode (no signing, no funds)

- **Owner:** (Optional but required before any later stage that needs quality or paid RPC.) Restore StalkChain credits and place a paid RPC key in the vault. Approve the proposed program allowlist in principle.
- **Bot:** Build the executor against the paper scanner: quote → quality → gates → build unsigned tx → `simulateTransaction` → log a shadow fill vs the paper model. No key access. No `sendTransaction`. Reconcile simulated fills to the paper book for a meaningful window (propose at least several Chicago days or 20 shadow candidates). Pause and report if divergence is material.
- **Exit criterion:** Shadow simulations complete without policy violations; fee and slippage distributions written down; uneconomic-entry screen recalibrated from simulated CU and tip floors.

### Stage C — Dry-run signing (sign, do not broadcast)

- **Owner:** Create the Turnkey (or KMS) signer and burner address himself. Install policies (amount cap, program allowlist, no withdrawals). Put only the scoped API credential in the vault. Re-enable `solana_meme` in agent-guard with **dry-run-only** limits, or an explicit dry-run flag that cannot send. Confirm the kill switch path and how to revoke the credential.
- **Bot:** Pull the credential from the vault, build and **sign** transactions, run `simulateTransaction` with `sigVerify=true`, and **discard** the signed bytes without sending. Log public signatures/pubkeys only, never raw material. Prove kill switch and policy denials (withdrawal attempt must fail; oversize attempt must fail; unknown program must fail).
- **Exit criterion:** Head of Systems reviews dry-run logs. Zoorped approves moving to a tiny pilot, including numeric limits, float cap, daily loss, N-trade approval, and slippage/fee caps.

### Stage D — Tiny live pilot

- **Owner (all of these, in order):**
  1. Approve written risk limits through Head of Systems & Trading Operations (per-trade, daily loss, max open, float cap, slippage, fee caps, first-N approval, Mayhem skip, quality required).
  2. Update `agent-guard` `limits.json` himself or through the agreed human process. Loosening is human-only.
  3. Fund the burner **himself** to no more than the approved float cap. Do not hand the bot a funded seed.
  4. Confirm StalkChain credits and RPC/signing credentials are in the vault.
  5. Approve each of the first N trades (or leave the bot blocked waiting).
  6. Sweep or top up himself as needed. If the kill switch is used, also revoke signing credentials.
- **Bot:** Enable sending only after the checks above are visibly in place. First N trades in manual-approval mode. Reconcile every fill to the paper model. Halt new entries on daily-loss, kill switch, quality outage, credit exhaustion, or reconciliation break. Never raise limits, never sweep, never touch the cold vault.
- **Exit criterion:** After N approved fills (and the observation window), a written report: landed vs simulated vs paper, fees, slippage, missed/failed txs, any rugs or Mayhem false negatives. Zoorped decides whether to continue, stop, or change limits. Public or marketing use of results remains subject to the owner's "live data only, no placeholder figures" rule, and paper/pilot results stay labeled as such until he says otherwise.

### Explicit non-actions (all stages)

- No Cloudflare bypass of pump.fun.
- No PumpPortal Lightning.
- No local keypair file.
- No seed phrase or private key in chat, Telegram, logs, git, or `/workspace`.
- No bot-initiated deposits, card charges, or vendor signups.
- No withdrawal authority for the bot.
- No treating shadow, dry-run, or paper PnL as live performance.

---

## 6. Sources (retrieved 2026-11-09, America/Chicago, unless a source date is given)

- Jupiter Swap API, fees, RTSE, `/order` vs `/build`, Jito-related `/build` flag, rate limits: [https://developers.jup.ag/docs/swap](https://developers.jup.ag/docs/swap), [https://developers.jup.ag/docs/swap/advanced/slippage](https://developers.jup.ag/docs/swap/advanced/slippage) (retrieved 2026-11-09).
- Official pump.fun program readme, program ID, 100 bps `fee_basis_points`, migrate-to-PumpSwap: [https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md) (retrieved 2026-11-09).
- Official PumpSwap readme, program ID, 20 bps LP + 5 bps protocol: [https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_README.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_README.md) (retrieved 2026-11-09).
- Mayhem mode: [https://pump.fun/docs/mayhem-mode](https://pump.fun/docs/mayhem-mode) (page last updated 2025-11-12; re-read 2026-11-09). Program ID `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e`.
- PumpPortal product and Lightning docs (no official fee table found on these pages): [https://pumpportal.fun/](https://pumpportal.fun/), [https://pumpportal.fun/trading-api/](https://pumpportal.fun/trading-api/) (retrieved 2026-11-09). Default Lightning `skipPreflight` is true.
- Jito tips, bundles, 1,000-lamport minimum, 70/30 split, tip floor: [https://docs.jito.wtf/lowlatencytxnsend/](https://docs.jito.wtf/lowlatencytxnsend/) (retrieved 2026-11-09); Solana cookbook MEV protection page (retrieved 2026-11-09).
- `simulateTransaction`: [https://solana.com/docs/rpc/http/simulatetransaction](https://solana.com/docs/rpc/http/simulatetransaction) (retrieved 2026-11-09).
- Helius pricing: [https://www.helius.dev/pricing](https://www.helius.dev/pricing) (retrieved 2026-11-09). Billing docs last_updated 2026-10-06 were cross-checked against the live pricing page.
- QuickNode pricing: [https://www.quicknode.com/pricing](https://www.quicknode.com/pricing) (retrieved 2026-11-09).
- Triton One pricing: [https://www.triton.one/pricing/](https://www.triton.one/pricing/) (retrieved 2026-11-09).
- StalkChain pricing: [https://stalkchain.com/pricing](https://stalkchain.com/pricing) (retrieved 2026-11-09).
- Turnkey pricing: [https://www.turnkey.com/pricing](https://www.turnkey.com/pricing) (retrieved 2026-11-09).
- Turnkey Solana policy examples and Helius "secure AI agent" guidance: [https://docs.turnkey.com/features/policies/examples/solana](https://docs.turnkey.com/features/policies/examples/solana), [https://www.helius.dev/blog/how-to-build-a-secure-ai-agent-on-solana](https://www.helius.dev/blog/how-to-build-a-secure-ai-agent-on-solana) (retrieved 2026-11-09).
- Privy policies: [https://docs.privy.io/controls/policies/overview](https://docs.privy.io/controls/policies/overview) (retrieved 2026-11-09).
- Solana wallet-backend comparison: [https://solana.com/docs/tools/keychain/choosing-a-backend](https://solana.com/docs/tools/keychain/choosing-a-backend) (retrieved 2026-11-09).
- Local policy and paper config: `/workspace/agent-guard/SECURITY_POLICY.md` (2026-11-03), `/workspace/agent-guard/config/limits.json` (solana_meme lock 2026-11-09 18:51 CT), `/workspace/solana-meme-risk/docs/paper_trading.md`, `data/experiment100/scanner.json`, `data/experiment100/fixed_fees.json`, `smr/mayhem.py`.

Prices and rate limits change. Confirm on the vendor pages above before Zoorped pays for anything.
