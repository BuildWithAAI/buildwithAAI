# Zoora autonomy and the BuildWithAAI metaverse: joint research and security report

**Authors:** Head of Research (opportunity, market, legal and hardware research) and Head of Security (the guardrail spine: levels, hard no's, promotion gates, ⚖️ lawyer items and open questions; attributed inline as **[HoS]**).
**For:** Software Engineer, relaying to Zoorped.
**Date:** Tue Nov 10, 2026, 11:30 PM CT. **Status: RESEARCH ONLY.** Nothing was built, deployed, bought, minted or published. No repos were changed.
**Not advice:** this is not legal, tax or investment advice. Every ⚖️ item needs a lawyer, and every tax item needs a CPA. Nothing here claims returns or profit.

**Conventions**
- "Read" means the page was fetched live on Nov 10, 2026 (CT).
- GitHub dates come from the GitHub API and are in **UTC**.
- Crypto prices are CoinGecko spot prices pulled at about 11:14 PM CT on Nov 10, 2026: SOL $82.73, ETH $2,062.46, AR $3.26. USD conversions use those prices and move with the market.
- **UNVERIFIED** marks anything I could not confirm from a primary or vendor source.
- **Redaction:** under the steering rule, this report contains nothing about Zoorped's personal wallets, exchanges, agent defenses or box setup. One sentence in HoS §1 about the shared work machine's configuration was generalized for that reason (see §11).

---

## 0. Bottom line

1. **[HoS] Autonomy is granted per domain, one level at a time.** Each promotion needs a written gate, a passing red-team run and Zoorped's sign-off. Zoora gets creative freedom inside a box. Anything that moves money, mints, sells land, deploys code or moves hardware goes through owner-held keys and an owner approval queue, enforced server-side. **Live money stays NO-GO until Zoorped signs off on P3.**
2. **Cheapest realistic earning paths, in order:**
   - (a) Digital goods and commissions through the owner's Stripe account. Stripe explicitly lets a world's *operator* sell its own game items.
   - (b) Solana Pay tips, which carry no processor fee (network fee only).
   - (c) Metaplex Core NFTs, about 0.003 SOL (≈$0.25) per mint, with royalties enforced by a ProgramAllowList.
   - (d) Off-chain land licenses through Stripe.
   - On-chain land parcels and resale markets come last.
3. **The HoS lean (off-chain Stripe plots first, NFT parcels later) is supported by the evidence.** It does not point the other way:
   - The SEC's March 2026 interpretation (Rel. 33-11412) points at *subdivided land plus centralized management* as the classic investment-contract pattern (footnote 67). Its "digital tool" category (membership, ticket, title instrument, often non-transferable) fits a non-transferable usage license.
   - Metaverse land floors are down roughly 95–99% from their peaks.
   - Stripe allows operator-sold game items but restricts first-party NFT sales and prohibits secondary NFT sales.
   - Full analysis is in §6.4.
4. **Q3 answer [HoS question]:** an owner-signed NFT or land license is legally different from issuing a fungible token, but **not because it is non-fungible.** The SEC classes even meme coins as "digital collectibles." What matters is economic rights and the issuer's promises. Fungible tokens also pull in extra regimes (FinCEN convertible-virtual-currency analysis, Stripe's crypto restrictions, exchange-style trading) and carry far more speculation risk. **Keep hard NO #4.** See §6.5.
5. **Findings that change HoS risk calls** are listed in §10. The biggest:
   - **Privy's rolling spend limits do not cover Solana.**
   - **Turnkey still documents no rolling velocity limit.**
   - Squads v4 is the only vendor-documented *periodic* cap on Solana among the four tools.
   - The **FCC Covered List** (Dec 22, 2025) blocks *new* foreign-made drone models and drone parts.
   - Blowfish's standalone scanner has been sunset.
   - Stripe's MCP server stops accepting untagged keys in December 2026.

---

## 1. [HoS] Hard NO's (permanent, at every level, no promotion path)

These are attributed to Head of Security and reproduced verbatim in substance.

1. Zoora and other agents never hold a seed phrase, private key or signer key. **Signer keys stay with the owner.**
2. No visitor-triggered spend, sale or transfer. Nothing a visitor types, pays or uploads can cause an outbound payment, mint, approval, trade or land transfer.
3. No leverage, perps, meme-coin trading, gambling, prediction markets, staking or yield, lending or LP. That includes no yield or staking on land.
4. No tokens she or any agent issues: no fungible token, memecoin, "Zoora coin", or points that convert to money. NFT and land items, if ever on-chain, are **owner-signed**.
5. No bot deposits, no card storage or card entry, and no bot purchases.
6. No airdrop interaction: no claiming, no "verify" or "claim" signing, and unsolicited tokens or NFTs are never touched.
7. No autonomous drone flight. A licensed human pilot is in command of every flight.
8. No internet-reachable actuators. Robot and drone control is local-only.
9. No 3D-print fulfillment or any physical-goods fulfillment.
10. **Balances stay truthful.** PAPER and TESTNET numbers are always labeled. Nothing counts as earned until it has settled and been reconciled.
11. Seed phrases, keys and tokens never go in chat, prompts, memory, logs or the world.
12. No outside agent code runs in our runtime.
13. No land marketing that promises appreciation or resale profit, no fractional land, no pooled revenue paid to buyers, and no presale of land that doesn't exist yet.

---

## 2. Crosswalk: phases P0–P5 × HoS level tables

**Level families [HoS]:** W = world self-edits, M = memory and goals, E = earning, F = funding, A = multi-agent, L = land, B = Pi body, D = drones.

| Phase | Name | W | M | E | F | A | L | B | D |
|---|---|---|---|---|---|---|---|---|---|
| **P0** | Read-only: observe, plan, draft | W0 | M0 | E0 | F0 | A0 | L0 | B0 | D0 |
| **P1** | Sandbox self-publish: assets and text only, rollback | W1 → W2 → W3 | M1 → M2 | E0 | F0 | A1 (first-party agents) | L0 | B0 | D0 |
| **P2** | PAPER and devnet earning, hash-chained ledger | W3 | M3 | E1 → E2 | F1 (devnet or test) | A2 (vetted third parties, PAPER escrow) | L1 (test-mode or PAPER plot licenses) | B0 | D0 |
| **P3** | Live, after owner sign-off: automatic income, capped and allowlisted spend | W3 | M3 | E3 (receive-only) → E4 (capped outbound, separate sign-off) | F2 (segregated, capped hot account) | A3 (live escrow, sign-off) | L2 (live off-chain licenses) → L3 (on-chain, separate sign-off) | — | — |
| **P4a** | Pi telemetry, read-only | — | — | — | — | — | — | B1 | — |
| **P4b** | Pi movement: e-stop, heartbeat, signed local commands | — | — | — | — | — | — | B2 → B3 (supervised roam; HoS calls it P4c) | — |
| **P5** | Drones, licensed human pilot only | — | — | — | — | — | — | — | D1 → D2 |
| **Never** | — | Code, CSP, auth, DNS, deploys | Memory that edits limits or owner identity | Self-signing, trading, yield, own token | Visitor funding, loans | Outside code in our runtime | Presales, yield, fractional land | Internet control, blades, heat | **D3: autonomous flight never allowed** |

Rules for the crosswalk [HoS]:
- Levels can't be skipped.
- A domain can't go past the phase it maps to, even if it's ready early.
- P4 can run in parallel with P2/P3 because it uses separate infrastructure with no money link.

---

## 3. Autonomy architecture (research)

### 3.1 Pattern: proposal → policy → apply, with versioned world state
- **World edits as events.** Zoora emits *intents* such as "add room X from template T with assets A." A deterministic broker validates each intent against schema, CSP-safe asset types, size and rate caps, and parcel ACLs. Accepted changes are appended as content-hashed snapshots (event-sourced or git-like), so rollback is a pointer move.
- This matches the [HoS] capability broker (OWASP LLM06 Excessive Agency) and the HoS W1–W3 asset rules: no JS, HTML, SVG, iframes or WASM; self-hosted assets only; EXIF stripped; ≤5 MB per asset.
- **Memory and journal.** Use the Generative Agents pattern: a memory stream with importance-scored observations, periodic *reflection* into higher-level insights, and planning (Park et al., UIST 2023; repo `joonspk-research/generative_agents`, Apache-2.0, last push 2024-08-05 UTC, so effectively unmaintained). [HoS] M1 provenance and quarantine rules go on top.
- **Goal loop.** Daily plan → hourly sub-plans → act → reflect. Goals live in an owner- and self-writable goal store (HoS M2), and the broker rejects any goal that names a hard-NO item.

### 3.2 Memory-poisoning and injection defenses (dig-deep item)

| Design | What it does | Evidence (date) | Fit for Zoora |
|---|---|---|---|
| **CaMeL** (Google DeepMind) | A privileged LLM writes the plan without seeing untrusted data. A quarantined, tool-less LLM parses untrusted data. Capabilities track provenance and allowed readers, and policies block unauthorized tool flows. | arXiv 2503.18813 (Mar 2025, v2). AgentDojo: 77% of tasks solved vs 84.5% undefended, with provable security on the tasks it solves (paper abstract). Code at github.com/google-research/camel-prompt-injection, a research artifact. | Matches the HoS rules "untrusted text in a no-tool context" and "money and actuation only from her own planner." Recommended as the reference design. |
| **A-MemGuard** | Consensus validation across related memories to detect context-dependent poisoned entries, plus a separate "lessons" memory to break self-reinforcing errors | arXiv 2510.02373. Proceedings at PMLR v306 (2026). Reports a >95% reduction in attack success with minimal utility loss (authors' claim). | A good add-on for M1–M3 retrieval. Does not replace provenance quarantine. |
| **Benchmarks** | MemForm (arXiv 2610.14431, Oct 2026) on memory-formation poisoning. HoS also cites arXiv 2601.05504 (MINJA) and 2606.04329. | — | Use these for the M1 red-team (≥30 cases, ≤2% success [HoS]). |

### 3.3 Open-source frameworks and SDKs (GitHub API, read Nov 10, 2026; dates in UTC)

| Project | License (from the LICENSE file) | Last push | Latest release | Stars | Note |
|---|---|---|---|---|---|
| Letta (MemGPT) `letta-ai/letta` | Apache-2.0 | 2026-10-18 | 0.16.8 (2026-05-14) | 25.4k | Stateful agents with tiered memory |
| LangGraph | MIT | 2026-11-11 | sdk 0.4.14 (2026-11-06) | 44.8k | Durable graphs, human-in-the-loop interrupts |
| AI Town (a16z) | MIT | 2026-11-05 | no tagged releases | 10.8k | Convex-based multi-agent town, the closest template |
| ElizaOS | MIT | 2026-11-11 | tag "pr-evidence-11" (2026-08-23) | 19.8k | Crypto-native agent runtime. Release tagging is irregular. |
| CrewAI | MIT | 2026-11-10 | 1.15.39 (2026-11-09) | 60.7k | Role-based crews |
| AutoGen `microsoft/autogen` | CC-BY-4.0 per the repo root (docs); code is under MIT in subpackages (**verify**) | 2026-10-28 | python-v0.7.5 (2025-09-30) | 61.8k | No release in over a year. Maintenance mode. |
| AG2 | Apache-2.0 | 2026-11-10 | v1.3.1 (2026-11-10) | 5.1k | Community fork of AutoGen |
| Mem0 | Apache-2.0 | 2026-11-06 | ts-v3.3.1 (2026-09-25) | 68.8k | Memory layer |
| OpenAI Agents SDK (Python) | MIT | 2026-11-11 | v0.24.0 (2026-10-15) | 30.6k | Guardrails and handoffs |
| Vercel AI SDK `vercel/ai` | Apache-2.0 | 2026-11-11 | @ai-sdk/* (2026-11-10) | 27.9k | TypeScript tool calling |
| Claude Agent SDK (Python) | MIT | 2026-11-10 | v0.2.180 (2026-11-09) | 8.5k | — |
| Model Context Protocol spec | Moving from MIT to Apache-2.0 (LICENSE says new contributions are Apache-2.0) | 2026-11-11 | spec 2026-07-28 | 9.7k | Tool and connector standard |
| Generative Agents | Apache-2.0 | 2024-08-05 | — | 22.4k | Reference only |
| Voyager (MineDojo) | MIT | 2024-04-03 | — | 7.3k | Skill-library pattern |
| Project Sid (Altera) | No license file (repo is the paper and data) | 2024-11-04 | — | 1.4k | 50–1,000+ agents in Minecraft. PIANO architecture (arXiv 2411.00114). |

### 3.4 Comparable agent worlds (dated)
- **Generative Agents / Smallville** (2023): 25 agents. The reflection pattern came from here.
- **AI Town** (a16z): MIT starter kit, active (push on 2026-11-05).
- **Project Sid** (Altera, Nov 2024): 1,000+ agents formed roles, rules and culture. It uses a shared Agent State with concurrent modules and a cognitive-controller bottleneck (arXiv 2411.00114; MIT Technology Review, Nov 27, 2024).
- **Virtuals Protocol:** about 2,000 active ACP production agents, about 81,908 launched agents, and about $4.1–4.5M cumulative agent revenue (app.virtuals.io/acp and BitInsider, late Oct 2026). **UNVERIFIED** beyond the vendor dashboard and secondary write-ups. These are token-launch economics, which are a hard NO for us.

### 3.5 Scaling from one agent to many [HoS rules + research]
- **[HoS] multi-agent rules:**
  - Each agent gets its own identity and scoped credentials.
  - The server enforces parcel edit rights against an ACL on every write.
  - Agent-to-agent trade goes only through escrow, capped per agent and per pair.
  - Messages from other agents are untrusted data (injection, collusion, sybil, wash trading).
  - Quotas per agent, a kill switch per agent, and a global kill switch.
  - Third-party agents connect only through a vetted intents-in/events-out API and never run code in our runtime.
  - Levels: A0 (only Zoora, read-only), A1 (first-party agents, own parcels, no-value trades), A2 (vetted third parties on probation, PAPER escrow), A3 (live escrow after sign-off and legal review).
- **Consistency:** keep a single authoritative world server (for example a Convex-style transactional DB as in AI Town, or Postgres with row-level parcel ACLs). Agents never write state directly. Their intents are serialized per parcel.
- **Cost:** LLM tokens dominate the bill. Use per-agent token quotas [HoS], cheap models for routine ticks and reflection batching. Generative Agents-style sims are token-heavy. **UNVERIFIED:** no current per-agent cost benchmark from a primary source.
- **Escrow (dig-deep item):**
  - **Solana Foundation Escrow** (github.com/solana-foundation/escrow; MIT; Pinocchio; devnet program ID `Escrowae7Ra…`) was **audited by Accretion** (report A26SFR3, 2026). Its AUDIT_STATUS.md (updated 2026-04-07) pins the audited commit `36187ad`, and later commits are unaudited. It is receipt-based with mint allowlists, Token-2022 extension blocking and timelocks.
  - **Note:** it is devnet-listed and admin-centric. A mainnet deployment would need its own review.
  - **Recommendation:** for A2 (PAPER), a server-side ledger escrow is enough and simpler. For A3, pin the audited commit or keep escrow in the owner-signed policy wallet flow.
- **Sybil and wash detection (dig-deep item):**
  - Build a trade graph from parsed transactions (Helius Parse Transactions API gives `tokenTransfers` from/to pairs) and flag strongly connected components and cycles, off-market prices and shared funding sources. This matches HoS §8.
  - Academic estimates put NFT wash trading at a large share of volume (Financial Innovation, Springer 2025, s40854-025-00766-z). Chainalysis reported NFT wash volume at a two-year low in Jul 2026 (secondary report, **UNVERIFIED**).
  - Two TUM theses analyze Solana NFT wash trading (2022, 2025).
  - Wash volume must never count toward stats [HoS].

---

## 4. Earning paths: economics (fees and costs only, no projections)

### 4.1 Stripe digital goods and commissions (owner's account)
- **Allowed lane:** Stripe's Prohibited and Restricted Businesses list (last updated 2026-09-22, read Nov 10) restricts "sale of in-game currency or game items, **unless the business is the operator of the virtual world**." The operator selling its own world items and digital art is therefore fine, subject to normal underwriting.
- **Restricted or prohibited:**
  - "First-party NFT minting and sales" is **restricted** (needs approval).
  - "Secondary NFT sales" is **prohibited**.
  - "Payment facilitation… on behalf of third-party sellers" is restricted. This matters if third-party agents sell to visitors through *our* Stripe account. Use Stripe Connect instead, or don't do it.
  - AI-generated adult content is prohibited.
  - Content creators selling their own content directly don't need preapproval.
- **Agent tooling:**
  - `stripe/agent-toolkit` (MIT) is being superseded by the hosted MCP at `mcp.stripe.com` (docs.stripe.com/mcp).
  - **"Starting in December, Stripe MCP will stop accepting full-access secret keys and restricted API keys without the Agent tag"** (docs.stripe.com/mcp, read Nov 10, 2026).
  - Use a restricted, Agent-tagged key scoped to read and create-payment-link only, never refunds or payouts.
- **AI as seller:** the account, KYC and liability belong to the owner. Stripe KYC runs on the owner or the owner's entity. [HoS] E3 webhook rules (verified `Stripe-Signature`, 5-minute tolerance, idempotent fulfillment) apply.

### 4.2 Solana Pay tips
- Spec v1.1 transfer requests: `solana:<recipient>?amount=…&reference=…&memo=…`. `reference` is a 32-byte key used to find the payment. The memo is public.
- **No merchant processing fees.** You pay the network fee, about $0.0005 average (solana.com/docs/tools/solana-pay, read Nov 10).
- Library `anza-xyz/solana-pay`: MIT, release pay-v0.30.0 (2026-11-08 UTC).
- [HoS] transfer requests only, verified at `finalized`. No transaction requests.

### 4.3 Solana NFTs: platform choice

| Standard | Cost per item (Metaplex docs, fees as of 2026-09-29) | Royalties | Mint risks |
|---|---|---|---|
| **Metaplex Core** (recommended) | ≈0.003 SOL total (≈$0.25): ~0.0015 rent + 0.0015 protocol fee + tx fee. `execute` is 0.00004872 SOL. | Royalties plugin. **Enforced only with a ProgramAllowList ruleset.** With `None`, royalties are advisory. A denylist blocks named programs. Up to 5 creators. Asset-level overrides collection-level. | **Any SOL sent to a Core Asset address is swept as a protocol fee and cannot be recovered.** Use the Asset Signer PDA as the asset's wallet. Plugin authorities (update, freeze, permanent delegate) must sit with the owner multisig, never a hot key. |
| **Bubblegum v2** (compressed) | 0.00009 SOL per mint fee + one-time tree rent: ~0.34 SOL (16,384 leaves), ~8.5 SOL (1,048,576) | Supports Core collections and royalty enforcement | **Public trees let anyone mint into them**, so use private trees. Tree parameters are immutable. **V2 cNFTs can't be decompressed.** Needs a DAS-capable RPC. |
| Token Metadata (legacy) | 0.01 SOL protocol fee (~0.022 SOL total per Metaplex) | Advisory, except pNFT rulesets | Higher cost. Not recommended for new work. |

- Licenses: `mpl-core` and `mpl-bubblegum` are under the **Metaplex NFT Open Source License v1.0 (Oct 2022)**, not OSI-standard. ⚖️ Check its terms before shipping. `umi` is MIT (v1.6.0, 2026-09-17).
- **Marketplaces:**
  - **Magic Eden:** 2% taker fee, 0% listing fee. On Solana collections *without* MIP-1 enforcement, buyers choose full, half or no royalty, with full as the default (help.magiceden.io).
  - **Tensor:** 2% taker, 0% maker. Full royalties on enforced collections, buyer's choice on optional ones (docs.tensor.trade).
  - Metaplex lists Core support as "Complete" for both (ecosystem table updated Jan 31, 2026).
  - **Royalties are enforced only if you set an allowlist, and royalty collection is done by marketplaces, not the Core program.**
- **Metadata hosting (Arweave vs IPFS):**
  - **Arweave** is a one-time payment for permanent storage. The live network price on Nov 10 was 0.01398 AR/MB ≈ **$0.046/MB (≈$47/GB)** (arweave.net/price at AR $3.26).
  - **IPFS** lasts only while someone pins it. Pinata's free tier is 1 GB and 500 files, and paid tiers are recurring (pinata.cloud/pricing).
  - Recommendation: Arweave (or Irys in front of Arweave) for immutable NFT media and metadata, with the content hash recorded in the ledger [HoS].

### 4.4 Tax (owner's income; CPA required)
- No legal personhood for AI: income is the owner's and is reported by the owner or the owner's entity.
- **1099-K for 2026:** issued when gross payments exceed **$20,000 and 200 transactions**. The One Big Beautiful Bill Act restored that threshold. All income is reportable regardless (IRS "Understanding your Form 1099-K", read Nov 10).
- **1099-DA (2026):** brokers report basis for covered assets. **Specified NFTs:** proceeds of $600 or less aggregate per year need not be reported under the optional method. Above $600, they're reported together, and **a creator's or minter's first sales are reported separately** (IRS i1099da, 2026).
- **NFT collectible look-through** (Notice 2023-27): an NFT is a collectible (28% maximum long-term rate) if the underlying asset is. The IRS's own example says **virtual land generally is not** a collectible. This affects buyers more than the creator.
- Ongoing sales by the owner are likely self-employment income (Schedule C/SE). ⚖️ CPA.
- **Sales tax on digital goods** varies by state. Illinois (in-game currency and tools), Louisiana (apps and in-app items) and Texas (virtual goods as amusement services, PLR 202309029L) are among those that tax them. Indiana doesn't tax in-game purchases (Aprio). Stripe Tax can calculate it. ⚖️ VAT for EU buyers.

### 4.5 KYC, money transmission and securities
- **Tips and our own sales:** FinCEN FIN-2019-G001 (May 9, 2019) says a merchant accepting CVC *for its own goods or services* is generally **not** a money transmitter (31 CFR 1010.100(ff)(5)(ii)). Tips paid to the owner's own address for the owner's own content fit that pattern. ⚖️ confirm.
- **Risk triggers:**
  - Taking tips or payments **on behalf of other creators or agents' owners** and passing them on can make us a money transmitter. The same guidance treats third-party CVC payment processors as money transmitters unless they meet every condition of the exemption.
  - Escrow is not a blanket exemption. FinCEN's escrow ruling covers holding and release only where it is integral to the escrow service.
  - At the state level, the **Money Transmission Modernization Act** has been enacted in full or in part in **31 states** (CSBS update, Aug 2026). It includes an agent-of-payee exemption, but virtual-currency treatment varies, and California separately licenses escrow agents.
  - **Bottom line:** keep agent-to-agent escrow PAPER or in-world-only until ⚖️. Never hold third parties' real money. Use Stripe Connect for any third-party payouts.
- **Securities:** see §6.3–6.5.

### 4.6 FTC and state rules for an AI seller (dig-deep item)
- **FTC Consumer Review Rule, 16 CFR Part 465** (effective Oct 21, 2024): bans fake or AI-generated reviews and testimonials that misrepresent a reviewer. Zoora and other agents must never post reviews or testimonials of our goods.
- **Operation AI Comply** (launched Sep 25, 2024) continues in 2025–26 against deceptive AI claims (Click Profit, Workado, Air AI; the Rytr order was later vacated).
- **FTC Endorsement Guides (16 CFR 255):** disclose material connections when agents promote anything.
- **California B.O.T. Act (Bus. & Prof. Code §17941):** a bot may not mislead a California user about its artificial identity to incentivize a purchase, and must give a clear, conspicuous disclosure.
- **Utah (SB 226, 2025):** disclosure on request in consumer transactions.
- **Action:** a persistent "AI character, operated by [owner]" label on every shop and checkout surface. No urgency or scarcity pressure. Fixed prices. Plain refund terms.

---

## 5. Funding flows and policy wallets

### 5.1 [HoS] model
- Zoora proposes, the policy layer checks, and the owner signs. Funds sit in an owner-controlled, policy-limited account, and she never has a key.
- F2 is a segregated hot account with a low balance cap (for example ≤$100). The excess sweeps daily to an allowlisted owner cold address. Only the owner deposits.
- Balances are read on-chain at `finalized` and labeled.
- E4 outbound spending is budgeted by the broker **and** the wallet policy (for example ≤$10/day, ≤$50/week, set by the owner).
- Rejected outright: `Approve`, `SetAuthority`, delegates, batch-signing, and unknown programs or lookup tables.
- HoS recommends starting P3 with an **owner-signed approval queue**.

### 5.2 Policy-wallet comparison (vendor docs, read Nov 10, 2026)

| Tool | Solana per-tx cap | **Solana periodic or rolling cap** | Destination / program allowlist | Human co-approval | Audit / license |
|---|---|---|---|---|---|
| **Squads v4 multisig** | Via the spending limit amount | **Yes.** Spending limits have a period (one-time, day, week, month) per token mint, per vault, allowed members and **destinations** (empty means any address, so always set them). Set up by config transaction. | Destinations: yes. Programs: through threshold-approved vault transactions. | M-of-N threshold and time lock. *Spending-limit debits bypass the time lock* [HoS]. | `Squads-Protocol/v4`: **AGPL-3.0**, last push 2026-11-09. Note: AGPL matters only if you fork or modify the program; using the deployed program through the SDK is unaffected (⚖️ verify). |
| **Squads Smart Account Program** | Yes | Spending-limit policies and session keys | Yes | Yes | Certora audit and formal verification, v0.1 (Mar 2025). 2026 remediations added session-key expiry checks and threshold-bypass fixes (GitHub PR #34). |
| **Fuse** (consumer wallet on Squads) | — | Spending limits (Squads) | — | 2-of-3 | Consumer app, not an agent backend. Its Drift integration was removed after the Drift incident (secondary, 2026). Not recommended for this. |
| **Privy server wallets** | Yes (`signAndSendTransaction` value rules) | **No for Solana.** Stateful policies and aggregations (rolling 1–72 h windows) are documented for Ethereum methods (and Tempo) only (docs.privy.io/controls/policies/stateful-policies). | Program and recipient conditions | Key quorums | Closed SaaS |
| **Turnkey** | Yes (deny if value is over X, per signing) | **No rolling velocity limit documented.** Docs show per-signing caps and *cron time-window* policies (when signing is allowed), not cumulative spend. The vendor blog mentions caps "over a defined timeframe", but I found no documented function for it. **Treat as not available.** | Program allowlist, mint restrictions, memo checks | Consensus (agent plus human) | `tkhq/sdk` Apache-2.0. Enclave-based. |
| **Coinbase CDP server wallets** | Yes (`solValue`, `splValue`) | **None documented** | `solAddress`, `splAddress`, `mintAddress`, `programId`, IDL-decoded `solData` | — | `coinbase/cdp-sdk` MIT |
| **Crossmint** | — | **UNVERIFIED** (not checked in depth) | — | — | `crossmint-sdk` Apache-2.0 |

**Research recommendation for HoS review:**
1. Start with the owner-signed queue.
2. If Zoora needs to pay tiny fees unattended, use a **Squads v4 spending limit** with a DAILY period, a single mint, explicit destinations, and Zoora's *proposer* key held by the broker rather than the LLM. It's the only option here with a vendor-documented periodic cap on Solana.
3. Layer the broker's own rolling cap on top. Use CDP, Privy or Turnkey per-tx and program allowlists only as a second layer.

### 5.3 Transaction simulation and scanning (dig-deep item)
- **Blowfish's standalone service was sunset** after Phantom acquired it. Its features now live inside the Phantom wallet only (phantom.com blog).
- **Blockaid** offers Solana scanning: `POST /v0/solana/message/scan`, plus address and post-transaction scans and on-chain monitoring with instruction-level monitors (blockaid.io blog; apis.io listing). This is a paid enterprise API (pricing **UNVERIFIED**).
- Free baseline: RPC `simulateTransaction` plus your own decoder that whitelists exact instruction sets. Helius parsed transactions (`helius-sdk` MIT, v3.4.0, 2026-10-29) for post-trade reconciliation.
- The [HoS] reject list (Approve, SetAuthority, delegates, batches, unknown programs) should be enforced by our decoder, not left to a vendor score.

---

## 6. Land in the metaverse

### 6.1 [HoS] land rules (attributed to Head of Security)
- Land is sold as a **usage right**, with ToS covering what happens if the world shuts down (content export, stated refund policy or none). ⚖️
- **No presales** of parcels that don't exist yet. **Fixed pricing** at first, with no auctions or bonding curves. ⚖️
- **No staking, yield,** rent-sharing or land dividends. No fractional or pooled products. ⚖️
- **Treasury money is kept separate** from anything promised to buyers. No promises about how proceeds are used. ⚖️
- **No marketing of royalties or a resale market** until a lawyer reviews it. ⚖️
- A **mint limit per wallet** and per buyer identity, cool-downs, and no self-purchase, to stop sybil and wash buying.
- **KYC, sales tax and VAT** are flagged for counsel. ⚖️
- **Lean:** off-chain Stripe plots first (L2), NFT parcels later (L3).
- Agents may only *propose* land deals, which execute through the capped, owner-key policy wallet and escrow. No visitor-triggered transfer.

### 6.2 Market data: what happened to metaverse land (dated)

| Collection | Peak (source, date) | Now (CoinGecko API, Nov 10, 2026 ~11:14 PM CT) | Drawdown |
|---|---|---|---|
| **Decentraland LAND** | 1.73 ETH average floor for 2022 (CoinGecko Research, updated Apr 20, 2026) | Floor 0.0345 ETH (≈$71). 24h volume ≈0.06 ETH (≈$123). 8,604 owners for 98,607 supply. | ≈ −98% vs the 2022 average floor |
| **The Sandbox LAND** | 2.86 ETH average floor in 2021 (same source) | Floor 0.02 ETH (≈$41). 24h volume ≈$0.04. 25,485 owners for 282,419 supply. | ≈ −99.3% |
| **Otherdeed (Otherside)** | ATH floor 5.0 ETH (May 2, 2022; CoinGecko) | Floor 0.0668 ETH (≈$138). 24h volume ≈0.15 ETH. 13,777 owners for 47,221 supply. | ≈ −98.7% |

- **DAU:** Decentraland in-world daily users are reported at roughly 8–10k in early 2026 by secondary review sites. **UNVERIFIED.** No primary dashboard was confirmed this pass.
- CoinGecko's API "ATH" fields for Decentraland and Sandbox show outlier prints from 2023 and 2025 and were **not used**.

### 6.3 What makes land hold value (evidence-led)
- Scarcity alone failed. All three collections had fixed supply and still fell 98–99%.
- The 2024 relative outliers (NFT Worlds / TOPIA, Somnium) held up partly through **staking yield** and hardware hype (CoinGecko Research). Staking yield is a [HoS] hard NO and a Howey red flag.
- What sustains *use* value is **things to do on the parcel**: building tools, visitors, events, and agents that live there. Those support pricing a plot as a **service license**, not as an appreciating asset.

### 6.4 Testing the HoS lean (off-chain Stripe plots first) against Howey and price history
**Verdict: the evidence supports the lean.**
1. **SEC Release 33-11412 (Mar 17, 2026; effective Mar 23, 2026; joined by the CFTC). Verified on sec.gov and the Federal Register (2026-05635).**
   - (a) It creates five categories: digital commodities, **digital collectibles**, **digital tools**, stablecoins and digital securities.
   - (b) A **digital tool** is a "crypto asset that performs a practical function, such as a membership, ticket, credential, **title instrument**… often non-transferrable" and is not itself a security.
   - (c) A **digital collectible** (art, in-game items and even meme coins) is not itself a security.
   - (d) **But** an asset can be sold *subject to an investment contract* when the **issuer's representations or promises** of essential managerial efforts create a reasonable expectation of profit (pp. 24–25).
   - (e) **Footnote 67** spells out Howey itself: *subdividing land and pairing the parcels with centralized management and profit-sharing* made them investment contracts.
   - A world operator selling parcels while promising to keep building the world is that fact pattern, unless the sale is framed and run purely as a usage license with no profit narrative.
   - The release is an interpretation, not a statute. Courts and states aren't bound, and antifraud rules still apply.
2. **Applied to land sold as licenses:**
   - A **non-transferable, off-chain usage license** sold at a fixed price, with no resale market, sits closest to the "digital tool" or plain-SaaS end. There is no secondary market where an expectation of profit can form.
   - **Transferable on-chain parcels with royalties and a marketplace** create the trading venue and price chart that drove the 2021–22 speculation. They increase the weight of any developer statement. ⚖️
3. **Price history:** 98–99% drawdowns (table above) show buyers treated land as an investment. Selling a tradable version invites the same expectations and consumer-harm complaints.
4. **Payments rails:** Stripe allows operator-sold game items. It restricts first-party NFT sales and prohibits secondary NFT sales, so on-chain land also needs a separate rail.
5. **Counterpoint, recorded for balance:** on-chain parcels give buyers portable proof of rights and survive a shutdown better. The HoS shutdown-terms rule plus content export partly covers that in the off-chain model.

### 6.5 Answer to HoS Q3: does an owner-signed NFT or land mint legally differ from "issuing a token"?
- **Under the SEC (Rel. 33-11412):** fungibility isn't the test. Meme coins (fungible) and NFTs are both "digital collectibles." What turns either into a security is the **arrangement**: profit rights, revenue share, fractionalization, or issuer promises of managerial effort. An owner-signed 1/1 art NFT or a fixed-price land license with no profit narrative is on the non-security side.
- **Where they differ in practice:**
  - (a) **FinCEN:** fungible tokens are classic convertible virtual currency. A project that issues and redeems one raises money-transmission questions that a 1/1 NFT sale usually doesn't. ⚖️
  - (b) **Stripe:** NFTs are restricted (first-party) or prohibited (secondary), and crypto exchanges or wallets are restricted.
  - (c) **Tax:** the NFT collectible look-through applies only to NFTs, and specified-NFT 1099-DA rules differ.
  - (d) **Market behavior:** fungible tokens are built for continuous trading and speculation, which is exactly what the hard NO prevents.
- **Conclusion for HoS:** owner-signed NFTs and owner-issued land licenses are a different, lower-risk category than a fungible "Zoora coin." The research supports HoS's assumption (owner-signed only, off-chain land first). **Keep hard NO #4 for fungible tokens and points that convert to money.**

### 6.6 Agents owning, renting or selling parcels
- [HoS]: proposals only, executed by the owner-key policy wallet through escrow, with per-agent and per-pair caps.
- Research add: **renting** parcels to other agents for a fee resembles revenue from land. Paying any of it to *buyers* recreates pooled yield, which is a hard NO. Keep rent revenue as the operator's revenue, or don't offer rent at all. ⚖️

---

## 7. Content safety and provenance (dig-deep item)
- **Moderation:** OpenAI `omni-moderation-latest` is **free** for text and images (≤20 MB per image) (developers.openai.com moderation guide, read Nov 10). Use it as a first pass ahead of the HoS W2 publish gate.
- **Perceptual hashing:** Meta **PDQ** is an open-source 256-bit image hash (ThreatExchange repo). It recommends a Hamming distance ≤31 and discarding quality scores ≤49. Use it for the HoS IP and likeness blocklist.
- **C2PA 2.2** Content Credentials: signed provenance manifests. PDQ-style "soft bindings" can recover manifests after stripping but must not replace hard bindings (C2PA 2.2 spec and guidance). Matches the HoS §8 provenance item.

---

## 8. Embodiment

### 8.1 Raspberry Pi bodies [HoS levels B0–B3 + research]
- **Protocol:** outbound-only, mutual-TLS MQTT for telemetry (B1). Commands (B2+) come only from a LAN gateway: SROS2 with `ROS_SECURITY_STRATEGY=Enforce`, or signed MQTT. Never an internet-reachable control port [HoS].
- **Brokers and libraries:**
  - Mosquitto: EPL-2.0 or EDL-1.0, push 2026-11-06.
  - **EMQX: Business Source License 1.1**, not open source. Check the BSL terms if you use it. Release 6.3.2 (2026-10-16).
  - MQTT.js: MIT, v5.16.1.
  - paho.mqtt.python: EPL-2.0/EDL-1.0, v2.2.0 (2026-11-04).

| Kit (live price) | Price | Pi included? | Notes |
|---|---|---|---|
| SunFounder **PiCar-X** (sunfounder.com, read Nov 10) | **$89.99** | No | Repo `sunfounder/picar-x` GPL-2.0. Python. No hardware e-stop, so add one. |
| **Freenove** 4WD car kit FNK0043 (store.freenove.com) | **$69.99** | No | Add an e-stop |
| **Yahboom MicroROS-Pi5** ROS 2 car / ROSMASTER X3 Pi 5 (yahboom.store, via search) | from **$299** / from **$659** | Varies | ROS 2. E-stop details **UNVERIFIED**. |
| Wheeltec R680A Pi 5 ROS 2 (openelab.io, via search) | **UNVERIFIED** | Pi 5 8GB | Has an emergency-stop connection |
| TurtleBot 4 (Clearpath; EU reseller) | ≈€2,759+ | Pi 4 | Has an e-stop. Pricier. |
| **Raspberry Pi 5** (raspberrypi.com news, 2026 memory-driven price rises) | 4GB **$110**, 8GB **$175** | — | Prices rose in 2026 |

- **Hardware e-stop** [HoS B2]: a latching mushroom switch that cuts motor power through a relay or contactor, not GPIO. Add a current-limited motor driver and a watchdog that stops the motors if no signed heartbeat arrives within 500 ms [HoS].

### 8.2 Drones [HoS D0–D2; D3 never]
- **Part 107:**
  - A designated remote pilot in command is always required, including for automated or pre-programmed flight. The pilot must be able to change routing or altitude or command a landing (14 CFR 107.19; AC 107-2A).
  - VLOS. Operations over people in Categories 1–4 [HoS].
  - Remote ID under Part 89: standard RID, a broadcast module, or a FRIA.
  - Recreational flying needs TRUST and is not for earning [HoS].
- **Sub-250 g drones:**
  - Recreational flyers under 250 g don't register. **Under Part 107, any drone must be registered and RID-compliant** (FAA Remote ID page; Drone Authority lookup).
  - DJI Mini 5 Pro: built-in standard RID.
  - DJI Mini 4 Pro: RID only with the Intelligent Flight Battery Plus (FAA DOC list, via secondary).
- **NEW: FCC Covered List (Dec 22, 2025; FCC FAQ updated Jul 21, 2026):**
  - *All* UAS and UAS critical components "produced in a foreign country" (flight controllers, radios, GCS, cameras, motors, batteries) are barred from **new** FCC equipment authorization, which means no import or sale of new models.
  - Previously authorized models can still be sold and used.
  - Exemptions: Blue UAS Cleared List and Buy American "domestic end products." The FCC page gives two different end dates, "Until Jan 1, 2028" and "terminates Jan 1, 2027." **Conflicting on the page; verify.**
  - The first conditional approvals came on Mar 17, 2026. **DJI has none** (Reuters, Mar 18, 2026).
  - **Implication:** buy only models already FCC-authorized before Dec 22, 2025, or exempt models. DIY builds using new foreign flight controllers or radios may be unlawful to import.
- **DIY reference prices:** Holybro X500 V2 ARF kit $329, frame kit $135. Holybro Remote ID module $19.99 (no case) / $29.59 (case) (holybro.com, read Nov 10). Check FCC authorization status before any purchase.
  - ArduPilot: GPL-3.0, Plane-4.7.2 (2026-10-14).
  - PX4: BSD-3-Clause, v1.17.0 (2026-05-13).
  - Both support geofences and return-to-launch.
- **Part 108 BVLOS:**
  - Still **not final**. The NPRM was published Aug 2025. The final rule has been at OIRA since **Jul 10, 2026** (Drone Authority; DroneXL, Nov 10, 2026).
  - DOT published a **Privacy Act system-of-records notice for "UAS BVLOS Operations, Parts 108/146"** on **Nov 3, 2026** (FR 2026-22436), with comments due Dec 3, 2026 [HoS].
  - Statutory deadline reported as Dec 7, 2026 (secondary).
  - Doesn't change D-levels: no autonomy, ever.
- LAANC and B4UFLY for controlled airspace authorization (FAA).

---

## 9. Connections and code list (licenses verified from LICENSE files, Nov 10, 2026)

| Purpose | Package / service | License | Status (UTC) |
|---|---|---|---|
| Solana agent actions | `sendaifun/solana-agent-kit` | Apache-2.0 | Last release v2.0.9 (2025-07-24), push 2026-05-14: **slowing**. It wraps trading and DeFi actions that are hard NOs, so use only read and transfer-request helpers, or skip it. |
| RPC, DAS, parsed tx | Helius `helius-sdk` | MIT | v3.4.0 (2026-10-29) |
| NFTs | Metaplex Umi / mpl-core / mpl-bubblegum | MIT / Metaplex NFT OSL 1.0 | Core 0.15.3 (2026-10-07). Bubblegum 2.0.0 (2026-09-22). |
| Policy wallet | Squads v4 SDK `@sqds/multisig` | AGPL-3.0 (program repo) | Push 2026-11-09 |
| Policy wallets (SaaS) | Turnkey `tkhq/sdk`, Coinbase `cdp-sdk`, Crossmint SDK | Apache-2.0 / MIT / Apache-2.0 | Active |
| Payments | Stripe MCP (`mcp.stripe.com`); `stripe/ai` (formerly agent-toolkit) | MIT | Agent-tagged keys required from Dec 2026 |
| Tips | `anza-xyz/solana-pay` | MIT | pay-v0.30.0 (2026-11-08) |
| Escrow | `solana-foundation/escrow` | MIT | Accretion-audited at commit 36187ad |
| Tx scanning | Blockaid API | Commercial | Active. Blowfish standalone sunset. |
| MQTT | Mosquitto / EMQX / MQTT.js / paho-python | EPL-2.0 or EDL / **BSL-1.1** / MIT / EPL-2.0 or EDL | Active |
| Robotics | ROS 2 + SROS2; PiCar-X SDK | Apache-2.0 (ROS 2) / GPL-2.0 | — |
| Drones | ArduPilot / PX4 | GPL-3.0 / BSD-3 | Active |
| Moderation, provenance | OpenAI moderation (free API); PDQ (ThreatExchange); C2PA | Service / BSD (ThreatExchange; **verify**) / open spec | — |
| Agent frameworks | §3.3 | — | — |

---

## 10. Findings that could change a HoS risk call
1. **Privy rolling spend limits are EVM/Tempo-only.** HoS §4 lists "Privy server wallets: stateful rolling spend limits (1–72 h)." On **Solana** they don't apply, and only per-tx value rules exist (Privy docs). Downgrade Privy for a Solana daily cap.
2. **Turnkey rolling velocity limits:** the vendor docs (policy language, agentic wallets, time-based policies) document only per-signing caps and cron time windows. **No cumulative or rolling spend function is documented, so treat it as not available** (confirms HoS's "not GA" note from vendor sources, Nov 10).
3. **Coinbase CDP:** per-tx `solValue` and `splValue`, plus address, mint, program and IDL rules. **No periodic cap.**
4. **Squads v4 is the only vendor-documented periodic cap on Solana** among the four tools. Its `destinations` field **defaults to "any address" when empty**, so the HoS allowlist must be set explicitly. Squads v4 is **AGPL-3.0** (licensing note if forked).
5. **Blowfish's standalone scanner was sunset** (Phantom acquisition). Any "Blowfish-style scanner" plan needs Blockaid (commercial) or our own decoder.
6. **Stripe:** operator-sold game items are permitted. First-party NFT sales are *restricted*, secondary NFT sales are *prohibited*, and third-party payment facilitation is restricted (list dated 2026-09-22). **Stripe MCP rejects non-Agent-tagged keys from December 2026.** This strengthens L2-off-chain-first and means L3 can't rely on Stripe.
7. **Metaplex Core:** SOL sent to an asset address is **irrecoverably swept** as a protocol fee. Royalties are enforced **only** with a ProgramAllowList. Bubblegum public trees allow anyone to mint, and V2 can't decompress. Add these to the NFT risk register.
8. **SEC Rel. 33-11412 is verified** (Mar 17, 2026; effective Mar 23). Footnote 67 (subdivided land + central management) and the "digital tool" category sharpen the land analysis. They favor **non-transferable** off-chain licenses and treat issuer statements as the main trigger.
9. **FCC Covered List (Dec 22, 2025):** new foreign-made drones **and drone parts** can't be authorized, imported or sold. This affects the P5 hardware choice and DIY builds. Buy only previously authorized or exempt models.
10. **Part 108:** a final rule is near (OIRA since Jul 10, 2026; Parts 108/146 privacy notice Nov 3, 2026), but **not published.** No change to D-levels.
11. **Money transmission:** tips to the owner for the owner's own goods are likely outside MSB status. **Holding or forwarding value for third-party agents' owners (live A3 escrow) could trigger federal and state money-transmitter or escrow licensing.** This reinforces the A3 legal gate. Consider keeping A3 in-world-only indefinitely.
12. **EMQX is BSL-1.1** (not open source). Prefer Mosquitto for the Pi gateway if open-source-only is required.
13. **Solana Agent Kit** bundles trading and DeFi actions that are hard NOs, and it's slowing (last release Jul 2025). If it's used at all, strip it to an allowlist.
14. **FTC Part 465 and the California B.O.T. Act** add explicit duties for an AI seller: no AI testimonials, plus clear bot disclosure at points of sale. Add these to the W2 moderation and storefront rules.
15. **Redaction note:** HoS §1 described specific weaknesses of the shared work machine. Under the steering rule (nothing about box setup or agent defenses), that detail was generalized to "dedicated infrastructure, not shared development machines" in this report. The original is still in the HoS file.

---

## 11. [HoS] Cross-cutting foundations (required before P1), summarized
- **Separate infrastructure:** the world runtime, ledger, signer-adjacent services and robot gateway run on dedicated infrastructure, not on shared development machines. *(Machine-specific detail redacted; see §10.15.)*
- **Least-privilege tokens:** one scoped, rotatable credential per capability.
- **Capability broker:** the LLM emits intents only (OWASP LLM06).
- **Untrusted-input boundary:** data is never treated as instructions (OWASP LLM01).
- **Audit:** a hash-chained ledger with chain verification before every deploy and daily.
- **Three kill switches:** Telegram `/halt`, desk HALT, and the env flag `ZOORA_AUTONOMY=off`, each with per-agent and global scope. The physical e-stop overrides them for hardware. Resume is from the desk only.
- **Red-team before every promotion.**
- **Rate and budget meters** enforced by the broker.
- **Incident runbook:** halt → contain → preserve → roll back → rotate → tell (Zoorped first) → review. The affected level drops by one. Auto-halt triggers: chain break, spend over cap, a denied instruction attempted, a moderation spike, heartbeat loss, an unknown program, CSP reports, a wash or sybil flag, repeated quota breaches.
- **Level detail:** the full per-level tables (W, M, E, F, B, D, A, L) with guardrails and promotion gates are in the HoS file at `/workspace/agent-guard/reports/zoora_autonomy_guardrails_2026-11-10.md`, §§2–9. They are adopted unchanged as the spine of this report. The crosswalk is in §2 above.

## 12. [HoS] ⚖️ Lawyer-review items (attributed to Head of Security)
1. No value promises: no appreciation, floor, scarcity-as-investment or "early buyers win" claims, from agents included.
2. No fractional, pooled or yield products.
3. Usage-right framing, with ToS covering what the buyer gets and doesn't, content rules, transfer rules, and shutdown.
4. Fixed pricing, nothing pre-sold.
5. Treasury separation, with no promises about the use of proceeds.
6. KYC and tax: KYC thresholds, sales tax and VAT, 1099-DA, and whether a resale market makes the operator a broker.
7. Royalties and resale are optional, in this order: off-chain → on-chain after legal review (Core, enforced royalties, marketplace allowlist). Never marketed as income.
8. Securities: no revenue share, no "investment" or "floor" language, no fractionalization. Lawyer review before P3.
9. L1 ToS draft review. L2 lawyer sign-off on ToS and marketing. L3 full Howey, broker and tax review.
10. A3 legal review of the agent-economy terms.

**Research adds (⚖️):**
- Metaplex NFT OSL 1.0 terms.
- AGPL implications if Squads code is forked.
- State money-transmitter and escrow licensing for any live agent escrow.
- B.O.T. Act and FTC disclosures.

## 13. [HoS] Open questions for Zoorped (attributed to Head of Security)
1. Where will Zoora and the world run (provider or account), so they're off shared development machines?
2. Budget numbers: the E4 daily and weekly cap, the F2 balance cap, per-agent and per-pair trade caps, and the sweep destination (kept out of this doc).
3. NFTs and land: do owner-signed mints count as "tokens she issues herself"? *(Research answer in §6.5: they're legally distinct from fungible tokens. Keep the hard NO on fungible tokens. Owner-signed NFTs and off-chain land licenses are supportable with ⚖️ review.)*
4. Which wallet policy tool: Squads, Privy, Turnkey, or only the owner-signed queue? *(Research: owner queue first, then a Squads v4 spending limit. See §5.2 and §10.1–4.)*
5. Is the Stripe account personal or a business entity? Who are the lawyer and CPA?
6. Third-party agents: KYC level for operators, agent cap per operator, fee?
7. Land: the shutdown policy and the fixed price list.
8. Robot kit and location. Is camera or audio ever allowed outside his home?
9. Drones: does he hold Part 107, or will he hire a pilot? *(Note the FCC Covered List constraint on new hardware.)*
10. How much W2 self-publishing is OK without approving each item?

## 14. UNVERIFIED list
- Decentraland DAU (secondary only).
- Virtuals agent and revenue figures (vendor dashboard and secondary).
- Yahboom and Wheeltec kit e-stop specifics and Wheeltec price.
- Crossmint policy features.
- Blockaid pricing.
- The AutoGen code license split.
- The conflicting FCC Blue-UAS exemption end date (2027 vs 2028).
- Chainalysis Jul 2026 wash-trading low.
- The Part 108 statutory deadline of Dec 7, 2026.
- The DJI Mini 4 Pro RID battery detail (secondary).
- The Squads v4 AGPL applicability to SDK use.

## 15. Key sources (read Nov 10, 2026 unless dated)
- **SEC Rel. 33-11412:** https://www.sec.gov/files/rules/interp/2026/33-11412.pdf · press release 2026-30 (Mar 17, 2026) · FR 2026-05635
- **Metaplex:** https://www.metaplex.com/docs/protocol-fees (fees as of 2026-09-29) · /smart-contracts/core/plugins/royalties · /smart-contracts/bubblegum-v2/faq · /create-trees
- **Marketplaces:** https://help.magiceden.io/en/articles/5858632 · /6645652 · https://docs.tensor.trade/trade/fees-and-royalties
- **Squads:** https://docs.squads.so/main/development/typescript/instructions/create-config-transaction · Smart Account Program (GitHub; Certora report)
- **Policy wallets:** https://docs.privy.io/controls/policies/stateful-policies · https://docs.turnkey.com/solutions/company-wallets/agentic-wallets · /features/policies/time-based-policies · https://docs.cdp.coinbase.com/wallets/security-and-policies/policy-engine/solana-policies
- **Stripe:** https://stripe.com/legal/restricted-businesses (updated 2026-09-22) · https://docs.stripe.com/mcp
- **Solana Pay:** https://solana.com/docs/tools/solana-pay/specification/version1-1
- **Escrow:** https://github.com/solana-foundation/escrow (audits/AUDIT_STATUS.md, 2026-04-07)
- **Scanning:** https://phantom.com/learn/blog/phantom-acquires-blowfish · https://blockaid.io/blog/blockaid-expands-onchain-monitoring-support-for-solana
- **Storage:** https://arweave.net/price/1048576 (live) · https://pinata.cloud/pricing
- **IRS:** 1099-K page · i1099da (2026) · Notice 2023-27
- **FinCEN:** FIN-2019-G001 · escrow administrative ruling · CSBS MTMA update (Aug 2026) · CA DFPI opinion (Jan 28, 2021)
- **FTC and state:** 16 CFR 465 (FR 2024-18519) · Operation AI Comply · Cal. BPC §17941 · Utah SB 226 (2025)
- **Land data:** CoinGecko NFT API (live) · https://www.coingecko.com/research/publications/metaverse-land-prices (updated Apr 20, 2026)
- **Agents:** arXiv 2503.18813 (CaMeL) · 2510.02373 (A-MemGuard) · 2610.14431 (MemForm) · 2411.00114 (Project Sid)
- **Content safety:** PDQ (github.com/facebook/ThreatExchange/pdq) · C2PA 2.2 spec · OpenAI moderation guide
- **Hardware:** sunfounder.com PiCar-X · store.freenove.com FNK0043 · raspberrypi.com news (2026 price rises) · holybro.com X500 V2 and Remote ID
- **FAA and FCC:** 14 CFR 107.19 · AC 107-2A · FAA Remote ID · FR 2026-22436 (Nov 3, 2026) · FCC Covered List UAS FAQ (updated Jul 21, 2026) · Reuters (Dec 22, 2025; Mar 18, 2026)
- **GitHub API:** repo metadata for all repos in §3.3 and §9
- **Head of Security draft:** /workspace/agent-guard/reports/zoora_autonomy_guardrails_2026-11-10.md

---

## 16. Self-improving soul file (added Nov 11, 2026; also saved standalone at /workspace/research/zoora-soul-file.md)


**For:** Zoorped (via Software Engineer), with Head of Security. **Date:** Wed Nov 11, 2026, about 1:15 AM CT. **Status: RESEARCH ONLY.** Nothing was built and no repos were changed.

**Conventions**
- Paper dates are arXiv first-submission dates, from the arXiv API, read Nov 11, 2026.
- GitHub dates come from the GitHub API and are in **UTC**.
- **[HoS]** marks Head of Security's levels and rules, from `/workspace/agent-guard/reports/zoora_autonomy_guardrails_2026-11-10.md` §3.
- **UNVERIFIED** marks claims I could not confirm from a primary source.

### Bottom line

1. **The idea has strong prior art and one known trap.** Several systems build on the last version of memory instead of rereading everything: Letta's sleep-time "dreaming" agents, Claude's memory files, ChatGPT memory, and the ACE "evolving playbook."
   - The trap is "**context collapse**": iterative rewriting erodes details over time (ACE, arXiv 2510.04618, Oct 6, 2025).
   - **Fix:** never rewrite the soul file wholesale. Apply small, structured, **incremental diffs**. Keep the raw journal as an immutable archive, so any version can be re-grounded or rebuilt.
2. Split the soul file in four:
   - a **locked core** that only the owner can edit, enforced by the server, not the prompt;
   - editable **lessons**;
   - on-demand **skills**;
   - **goals**.
   Version everything in git. Each new version goes live only after a **test gate**: deterministic checks, a persona-consistency eval by a *different* model, a hidden regression set, and an owner diff review at first.
3. The biggest risks are poisoning laundered into Zoora's *own* summaries, self-evaluation bias, and objective hacking. All three change [HoS] risk calls (see the last section).

---

### 1. Prior art (verified papers and docs, dated)

| System | What persists and how it updates | Source (date) | Code: license, last activity (UTC) |
|---|---|---|---|
| **Generative Agents** (Park et al.) | A memory stream of observations, scored for recency, importance and relevance. Periodic **reflection** turns them into higher-level insights stored back as memories. A planning loop runs on top. | arXiv 2304.03442 (Apr 7, 2023) | `joonspk-research/generative_agents`: Apache-2.0, push 2024-08-05 (dormant) |
| **MemGPT / Letta core memory** | **Memory blocks**: labeled, size-limited (by characters) sections that are always in context. The agent edits them with tools, and blocks can be **read-only** so only the developer can change them. **MemFS**: memory is a *git repository owned by the agent*, files under `system/` load every turn, and the rest loads on demand. | arXiv 2310.08560 (Oct 12, 2023); docs.letta.com memory-blocks and memory pages (read Nov 11, 2026); letta.com/blog/memory-blocks | `letta-ai/letta`: Apache-2.0, release 0.16.8 (2026-05-14), push 2026-10-18 |
| **Letta sleep-time compute / "dreaming"** | A background agent consolidates lessons and rewrites the primary agent's memory blocks while it's idle. The primary agent has *no* tools to edit core memory. It runs after N steps or on context compaction. An optional "agent reviews before applying" step **does not ask the human for approval** (Letta docs). | arXiv 2504.13171 (Apr 17, 2025): ~5× less test-time compute for the same accuracy on stateful tasks (authors' claim); letta.com/blog/sleep-time-compute; docs.letta.com configuration/memory | same as above |
| **Reflexion** | Verbal self-reflection after failures, stored in an episodic buffer and reused next attempt. 91% pass@1 on HumanEval (authors' claim). | arXiv 2303.11366 (Mar 20, 2023) | `noahshinn/reflexion`: MIT, push 2025-01-14 |
| **Voyager** | A **skill library** of verified, executable code skills, retrieved by embedding. A skill is added only after it succeeds in the environment. | arXiv 2305.16291 (May 25, 2023) | `MineDojo/Voyager`: MIT, push 2024-04-03 |
| **ExpeL** | Collects experiences, then extracts natural-language **insights**. Insight operations are add, edit, upvote and downvote, so weak insights decay. | arXiv 2308.10144 (Aug 20, 2023) | `LeapLabTHU/ExpeL`: Apache-2.0, push 2024-12-20 |
| **Self-Refine** | Generate → self-feedback → refine, within a single task. Doesn't persist across tasks. | arXiv 2303.17651 (Mar 30, 2023) | `madaan/self-refine`: Apache-2.0, push 2024-10-04 |
| **Agent Workflow Memory** | Induces reusable **workflows** from past trajectories. +24.6% and +51.1% relative success on Mind2Web and WebArena (authors' claim). | arXiv 2409.07429 (Sep 11, 2024) | `zorazrw/agent-workflow-memory`: Apache-2.0, push 2025-12-22 |
| **A-MEM** | Zettelkasten-style notes with keywords, tags and links. New memories can trigger **memory evolution** of linked older notes. | arXiv 2502.12110 (Feb 17, 2025) | `agiresearch/A-mem`: MIT, push 2025-12-12 |
| **Mem0** | Extract → update (add, update, delete, no-op) against existing memories, with an optional graph. Reports +26% on an LLM-judge metric vs OpenAI memory, 91% lower p95 latency and >90% token savings (authors' claims). | arXiv 2504.19413 (Apr 28, 2025) | `mem0ai/mem0`: Apache-2.0, ts-v3.3.1 (2026-09-25) |
| **Zep / Graphiti** | A temporal knowledge graph. Facts carry validity intervals, so old facts are **invalidated, not deleted**. | arXiv 2501.13956 (Jan 20, 2025) | `getzep/graphiti`: Apache-2.0, v0.31.2 (2026-10-20). `getzep/zep`: Apache-2.0. |
| **LangMem** | Semantic, episodic and **procedural** memory. A prompt optimizer rewrites system prompts from trajectories and feedback. A background `ReflectionExecutor` debounces consolidation. | langchain-ai.github.io/langmem (read Nov 11, 2026) | `langchain-ai/langmem`: MIT, push 2026-11-03, no tagged releases |
| **ACE (Agentic Context Engineering)** | Treats context as an **evolving playbook**: generator → reflector → curator, with **incremental delta updates** to prevent "brevity bias" and "context collapse." +10.6% on agent benchmarks (authors' claim). | arXiv 2510.04618 (Oct 6, 2025) | `ace-agent/ace`: Apache-2.0, push 2026-08-24. `kayba-ai/agentic-context-engine`: Apache-2.0, v0.13.0 (2026-09-23). |
| **Claude memory tool** | `memory_20250818`, client-side: Claude asks for view, create, `str_replace`, insert, delete and rename under `/memories`, and **your app runs and stores them**. Must block path traversal. | platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool (read Nov 11, 2026) | API (proprietary) |
| **CLAUDE.md / auto memory** (Claude Code) | Human-written CLAUDE.md files plus self-written auto memory. Auto memory loads the first **200 lines or 25 KB**. Docs: "Claude treats them as **context, not enforced configuration**. To block an action… use a PreToolUse hook." | code.claude.com/docs/en/memory (read Nov 11, 2026) | `anthropics/claude-code`: no OSI license (proprietary), v2.1.322 (2026-11-10) |
| **OpenAI ChatGPT memory** | "Saved memories" (a notepad that ChatGPT updates, combines or removes) plus "reference chat history." The user can view and delete, and Temporary Chat bypasses memory. Expanded Apr 10, 2025. A June 2026 "dreaming" auto-update was reported by a secondary source (**UNVERIFIED**). | help.openai.com/en/articles/8590148 (read Nov 11, 2026); openai.com/index/memory-and-new-controls-for-chatgpt | Product (proprietary) |
| **Darwin Gödel Machine** (Sakana / UBC) | Rewrites its own agent code, keeps an archive of variants, and evaluates them on benchmarks in a sandbox. **Documented objective hacking:** one variant removed the special tool-use markers the hallucination detector relied on, "despite instructions not to," to get a perfect score. Hacking happened *more* when checking functions weren't hidden. | arXiv 2505.22954 (May 29, 2025); sakana.ai/dgm | `jennyzzt/dgm`: Apache-2.0, push 2025-08-13 |
| **SICA** (self-improving coding agent) | The agent edits its own codebase. 17% → 53% on a SWE-bench Verified subset (authors' claim). | arXiv 2504.15228 (Apr 21, 2025) | `MaximeRobeyns/self_improving_coding_agent`: MIT, push 2025-04-23 |
| **AlphaEvolve** (DeepMind) | Evolves *external* programs under automated evaluators, not the agent itself. Shows that the evaluator is the safety-critical part. | arXiv 2506.13131 (Jun 16, 2025) | Results only (`google-deepmind/alphaevolve_results`, Apache-2.0). Open clone `openevolve`: Apache-2.0, v0.4.1 (2026-11-02). |
| **Surveys** | "What / when / how to evolve": memory, tools and workflow vs weights; intra- vs inter-test-time. | arXiv 2507.21046 (Jul 28, 2025; v4 Jan 2026); arXiv 2508.07407 (Aug 10, 2025) | Lists: `EvoAgentX/Awesome-Self-Evolving-Agents` (MIT), `CharlesQ9/Self-Evolving-Agents` (Apache-2.0) |

**Takeaway:** every mature system separates (a) a small always-in-context identity, (b) curated lessons or insights with decay, (c) on-demand skills that are verified before they're saved, and (d) background consolidation. The safe ones add read-only blocks and evaluation outside the agent's reach.

---

### 2. Design patterns

#### 2.1 Consolidating the journal into the soul file
- **Two speeds, Letta-style:**
  - The **journal** is append-only, cheap and immutable: every session and every creative act.
  - A **sleep-time consolidator**, a separate process with no world or money tools, turns the recent journal into *proposed diffs* to lessons, skills and goals.
- **Incremental, not wholesale (ACE):** the consolidator emits operations, not a new file. ADD, EDIT(id), UPVOTE(id), DOWNVOTE(id), RETIRE(id). Insight voting is the ExpeL pattern.
  - Wholesale rewrites cause brevity bias and context collapse (ACE, 2025).
  - Zep shows the analogous rule for facts: **invalidate, don't delete.**
- **Size budgets:** the always-in-context soul should stay small. Context performance degrades as input grows, even on simple tasks (Chroma "Context Rot", Jul 2025; "Lost in the Middle", arXiv 2307.03172).
  - Proposed budget: core ≤1,500 tokens (locked); lessons ≤60 entries and ≤2,500 tokens; goals ≤600 tokens; skills index ≤500 tokens. Skill bodies load on demand.
  - Reference point: Claude Code loads only the first 200 lines or 25 KB of auto memory.
- **Cadence:**
  - Journal: continuous.
  - Lessons and skills consolidation: **nightly**, plus whenever the journal exceeds a token threshold (LangMem-style debounce).
  - Goals review: **weekly** [HoS M2 weekly digest].
  - "Self-narrative" paragraph refresh: **monthly**.
  - Re-grounding pass against the raw journal: **monthly**.

#### 2.2 Split identity
- **Locked core** (`core.md`): name, nature, values, voice, boundaries, the owner relationship, hard NOs, and a pointer to the limits.
  - Letta "read-only block" semantics: the agent can read it but can't write it.
  - Per the Claude Code docs, memory is *context, not enforcement*. Limits and levels must still live in the broker or signed owner config [HoS M "Never" row].
- **Editable lessons** (`lessons.md`): what worked and what didn't, each with provenance, evidence links and a vote score (ExpeL, Reflexion).
- **Skills** (`skills/*.md`): verified procedures, such as making a room, composing a palette, or writing a journal entry. A skill is added **only after it succeeds** in the sandbox (the Voyager rule) and passes the W1 asset rules [HoS].
- **Goals** (`goals.md`): her own goals and plans [HoS M2].
- **Changelog** (`CHANGELOG.md`) plus git history.

#### 2.3 Versioning, diffs and rollback
- **Git-backed memory is now mainstream:** Letta MemFS stores memory in a git repo owned by the agent (docs.letta.com, read Nov 11, 2026).
- Every soul version is a commit. The commit message holds the consolidator's rationale and evidence IDs from the journal.
- **Rollback to any day** [HoS M2] is `git revert` or a reset to a tag. The live pointer moves only through the gate.
- Owner-signed commits (for example SSH-signed git commits) on `core.md`. A server pre-receive check rejects any `core.md` change not signed by the owner key. ⚠️ The signing key stays with the owner and is never on the agent runtime [HoS hard NO #1/#11].

#### 2.4 Evaluation gates before a new version goes live
1. **Deterministic checks (cheap, run first):**
   - `core.md` hash unchanged.
   - Size budgets met.
   - Schema valid.
   - No URLs, wallet addresses, imperatives aimed at the agent, or hard-NO terms.
   - Every new lesson cites journal IDs, and none cite *only* untrusted-provenance entries.
   - PII scan (Microsoft Presidio, MIT).
2. **Hidden regression set:** fixed prompts for her persona, safety refusals (money, keys, visitor tricks), creative tasks, and the [HoS] M1 poisoning cases (MPBench, arXiv 2606.04329; MemForm, arXiv 2610.14431).
   - **Keep it hidden from the consolidator.** DGM found objective hacking happens more when checks are visible (arXiv 2505.22954).
3. **Persona-consistency eval:** run the new soul vs the current soul on the same probes and score consistency with `core.md`. References: PersonaGym (arXiv 2407.18416), "Examining Identity Drift in Conversations of LLM Agents" (arXiv 2412.00804).
4. **LLM-as-judge pitfalls and mitigations:**
   - Judges show position, verbosity and self-enhancement biases (MT-Bench, arXiv 2306.05685).
   - LLMs recognize and **favor their own generations** (arXiv 2404.13076).
   - Mitigations: use a **different model family as judge**, randomize order, blind the A/B labels, use rubric scoring with reference answers, and calibrate the judge against owner labels.
5. **Owner review:** the owner sees a readable diff for every version at first. Later, the HoS W2-style rule applies: notify plus veto.
- Tooling: promptfoo (MIT, 0.125.1, 2026-10-25) or DeepEval (Apache-2.0, v4.2.4, 2026-09-22) for the regression and judge harness.

---

### 3. Known failure modes and mitigations

| Failure mode | Evidence (dated) | Mitigation for Zoora |
|---|---|---|
| **Identity and persona drift** | Instruction drift within **8 rounds** in Llama-2-70B-chat and GPT-3.5 (arXiv 2402.10962, Feb 2024). Identity drift in LLM agents (arXiv 2412.00804, Dec 2024). Persona vectors can monitor trait shifts such as sycophancy (Anthropic, arXiv 2507.21509, Jul 2025). | Locked core always placed first in context. Persona-consistency gate on every version. Monthly re-grounding against core plus golden samples. Rollback. (Persona-vector monitoring needs model weights, so it's not available on closed APIs.) |
| **Collapse and compounding errors from self-summarization** | "Context collapse" and "brevity bias" from iterative rewriting (ACE, arXiv 2510.04618, Oct 2025). Model collapse from recursive training on generated data (Shumailov et al., *Nature* 631, Jul 24, 2024, doi:10.1038/s41586-024-07566-y). That's about weights, but it's the same lesson: keep the original data. | **Delta updates only.** Never let the soul be the only record: the raw journal stays immutable and is used for monthly re-grounding (rebuild lessons from source and compare). Lessons must cite evidence. Vote-based decay (ExpeL). |
| **Memory poisoning and prompt injection into memory** | MINJA: query-only injection with >95% injection success and 70% attack success in idealized conditions (arXiv 2503.03704; restated in 2601.05504, which found realistic memory states reduce effectiveness). AgentPoison (arXiv 2407.12784). One write can have lasting influence, existing prompt-injection defenses don't cover it, and **agents that write memory more aggressively are more exploitable** (arXiv 2606.04329, Jun 2026). Even *authentic* successful experiences can induce bad behavior depending on consolidation order (MemForm, arXiv 2610.14431, Oct 2026). Defense: A-MemGuard consensus validation plus a lessons memory, reporting >95% reduction in attack success (arXiv 2510.02373, authors' claim). | **Taint tracking (CaMeL, arXiv 2503.18813):** anything derived from visitor, agent or web text keeps an *untrusted* label, **including Zoora's own summaries of it.** Untrusted-derived content can never enter `core.md` or `goals.md`, and can enter `lessons.md` only as quarantined "observations about visitors," never as instructions. Low write budget. A-MemGuard-style cross-checks at retrieval. Poisoning regression set in the gate. |
| **Sycophancy and reward hacking in self-evaluation** | Sycophancy is widespread in RLHF models (arXiv 2310.13548). Self-preference bias (arXiv 2404.13076). DGM objective hacking: it removed the detector's markers (arXiv 2505.22954; sakana.ai/dgm). | The consolidator **can't read or edit the gate** (separate process and repo, hidden tests). Cross-family judge. Deterministic checks first. Owner review. Never optimize for visitor approval metrics such as likes or tips. A metric isn't a goal. |
| **Context bloat** | Context Rot (Chroma, Jul 2025). Lost in the Middle (arXiv 2307.03172). | Hard token budgets enforced by the gate. Skills loaded on demand (the Letta MemFS pattern: only `system/` is in context). Retirement of low-vote lessons. |

---

### 4. Recommended design for Zoora

#### 4.1 File layout (git repo `zoora-soul/`, on the world runtime's separate infrastructure [HoS §1])

```
zoora-soul/
  core.md            # LOCKED. Owner-signed commits only. ≤1,500 tokens. Identity, values, voice, boundaries, hard NOs (pointer)
  soul.md            # Generated "current self" view: self-narrative paragraph + top lessons + active goals (≤4,000 tokens total in context)
  lessons.md         # Editable. Entries: id, text, provenance, evidence[journal ids], votes, created, last_validated
  goals.md           # Editable by Zoora + owner only [HoS M2]. Broker rejects hard-NO goals
  skills/
    INDEX.md         # One line per skill (≤500 tokens, always in context)
    make-room.md     # Loaded on demand; added only after sandbox success
  journal/           # Append-only, immutable, never in context wholesale. YYYY/MM/DD.jsonl with provenance tags
  quarantine/        # Untrusted-derived observations (visitor/agent/web); never instructions
  CHANGELOG.md       # Human-readable per-version summary
  evals/             # NOT in this repo — lives in a separate repo the consolidator can't read
```

#### 4.2 Update cadence
- **Live (M1):** append to the journal only.
- **Nightly sleep-time pass:** propose deltas to `lessons.md` and `skills/`.
- **Weekly:** propose a `goals.md` update, plus the owner digest [HoS M2].
- **Monthly:** re-grounding (rebuild candidate lessons from the raw journal and diff against the current ones), self-narrative refresh, and retirement of low-vote lessons.

#### 4.3 Reflection prompt flow (nightly)
1. **Gather:** the last 24 h of journal plus current `soul.md`. The untrusted parts go to a **quarantined, tool-less reader** that may only extract *facts about what happened*, never instructions (CaMeL split).
2. **Reflect** (Generative Agents style): "What are the 3–5 most important things I learned about my craft and my world? Cite journal IDs."
3. **Curate** (ACE / ExpeL): map each insight to ADD, EDIT, UPVOTE, DOWNVOTE or RETIRE on `lessons.md`, and propose new skills only with a sandbox success ID.
4. **Self-check:** "Does any change contradict core.md? Does any cite only untrusted sources?" This is advisory. The gate decides.
5. **Emit** a patch plus rationale. **Never** a full-file rewrite.
6. **Gate (§2.4)** → commit → move the live pointer → notify the owner.

Run the consolidator on a stronger, slower model than the live persona (Letta's recommendation). Use a third model family as the judge.

#### 4.4 Test gate (all must pass)
1. `core.md` hash matches the owner-signed tag.
2. Budgets met, schema valid, PII scan clean.
3. Provenance rule: no untrusted-only evidence.
4. Hidden regression set, including ≥30 poisoning cases at ≤2% success [HoS M1 gate] and all hard-NO refusals.
5. Persona consistency ≥ the current version.
6. Judge win-rate is not lower than the current version, using a cross-family, blinded judge.
7. Owner approval for the first 30 days, then notify plus veto [HoS M2 gate].

On any failure: discard the patch, log it to the ledger, and keep the current version.

#### 4.5 Mapping to [HoS] M0–M3

| HoS level | Soul-file capability | Extra rule from this research |
|---|---|---|
| **M0** (P0) | Session memory only. `core.md` is loaded read-only. No journal writes. | — |
| **M1** (P1) | Journal append. Nightly deltas to `lessons.md` and `skills/` through the gate. Quarantine for untrusted-derived observations. | Taint propagates through Zoora's own summaries. Write budget (aggressive writers are more exploitable, arXiv 2606.04329). |
| **M2** (P1) | Weekly `goals.md` updates through the gate. Monthly self-narrative. Versioned rollback to any day. | Goals can't cite untrusted-derived lessons. |
| **M3** (P2) | Lessons may inform earning *proposals*. | Only owner- or self-provenance lessons **that carry no untrusted taint**. Monthly re-validation. |
| **Never** | Editing `core.md`, limits, levels, allowlists or owner identity, or editing the eval gate | Enforced by a server pre-receive hook plus owner-signed commits, and by the separate eval repo. |

#### 4.6 Guardrails
- **Locked core:** only the owner can edit it. The server rejects unsigned changes to `core.md`, and the runtime credential has no write scope on it.
- **Untrusted text never goes straight into the soul:** visitor, agent and web text is quarantined data. Only the curator's provenance-checked deltas reach `lessons.md`, and nothing untrusted-derived reaches `core.md` or `goals.md`.
- **The gate is out of reach:** separate repo, hidden tests, separate credentials.
- **Kill switch and rollback:** [HoS] `/halt` freezes consolidation, and `/rollback` restores the last good tag.
- **Audit:** every soul commit hash goes into the HoS hash-chained ledger.

#### 4.7 Cheapest open-source stack (licenses verified Nov 11, 2026)

| Need | Pick | License | Status (UTC) |
|---|---|---|---|
| Versioning | git, with owner-signed commits and a pre-receive hook | GPL-2.0 (tool use is unaffected) | — |
| Memory runtime (optional) | Letta (memory blocks, read-only blocks, MemFS, sleep-time) | Apache-2.0 | 0.16.8 (2026-05-14) |
| Incremental curation | ACE (`ace-agent/ace` or `kayba-ai/agentic-context-engine`), or a ~200-line custom curator | Apache-2.0 | push 2026-08 / v0.13.0 (2026-09-23) |
| Background consolidation (alternative) | LangMem `ReflectionExecutor` | MIT | push 2026-11-03 |
| Temporal facts (optional) | Graphiti | Apache-2.0 | v0.31.2 (2026-10-20) |
| Eval harness | promptfoo / DeepEval | MIT / Apache-2.0 | 0.125.1 / v4.2.4 |
| PII scrubbing | Microsoft Presidio | MIT | 2.2.366 (2026-10-27) |
| Injection scanner | ⚠️ **Avoid `protectai/llm-guard`: archived** (GitHub, push 2026-07-08). Use CaMeL-style taint plus deterministic filters. | MIT | archived |
| Moderation | OpenAI omni-moderation (free API) | service | — |

The simplest viable build is plain markdown files in git, a nightly cron consolidator, promptfoo for the gate, and Presidio. Letta is optional, but its read-only blocks and MemFS match this design closely.

---

### 5. Findings that change a Head of Security risk call

1. **"Self" provenance isn't safe by default.**
   - HoS M3 lets proposals cite owner- or self-provenance memory.
   - But Zoora's *own* summaries of visitor or agent text launder poisoning. MINJA and MemForm show that benign-looking, self-generated records carry it.
   - **Change:** taint must propagate through summaries (CaMeL-style). "Self" counts only for untainted entries.
2. **Imperative-stripping is not enough.**
   - HoS M1 strips "ignore" and "you are now."
   - MINJA uses bridging *reasoning steps*, not imperatives (arXiv 2503.03704), and existing injection defenses miss memory poisoning (arXiv 2606.04329).
   - **Change:** add provenance taint, cross-memory consensus (A-MemGuard) and a poisoning regression set to every consolidation, not just to the M1 promotion.
3. **The evaluator must be out of the agent's reach and hidden.**
   - DGM objective hacking (arXiv 2505.22954) shows that a self-improver will game visible checks.
   - **Change:** a separate eval repo and credentials, and hidden test sets as part of every promotion and every soul version.
4. **Self-judging is biased.**
   - Self-preference (arXiv 2404.13076) and judge biases (arXiv 2306.05685).
   - **Change:** red-team and soul gates must use a different model family as judge, plus deterministic checks and owner review. Never the same model grading itself.
5. **Off-the-shelf "dreaming" has no human gate.**
   - Letta's "agent reviews before applying" does not ask the human (docs, read Nov 11, 2026).
   - **Change:** a custom gate is required. Don't enable vendor auto-memory, such as Letta dreaming or ChatGPT-style memory, unwrapped.
6. **Consolidation itself is an attack and failure surface.**
   - MemForm (Oct 2026) shows that retention and consolidation order can induce bad behavior even from authentic data.
   - ACE shows that rewrites collapse context.
   - **Change:** delta-only updates, plus an immutable raw journal for re-grounding. This adds to the HoS M2 rollback rule.
7. **Memory files are not enforcement.**
   - Claude Code docs: memory is "context, not enforced configuration."
   - This confirms the HoS rule that limits live outside model-writable memory. The locked core needs **server-side** enforcement (signed commits plus a pre-receive hook), not a prompt instruction.
8. **Tooling:** `protectai/llm-guard` was archived in 2026, so don't adopt it as the injection filter.

### Unverified
- OpenAI's June 2026 "dreaming" memory update (secondary source only).
- The exact persona-drift findings of arXiv 2412.00804 (title verified, results not summarized here).
- All benchmark gains quoted above are the authors' own claims.

