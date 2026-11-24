# Zoora (Lumen) & the BuildWithAAI Metaverse: Autonomy Security Guardrails
**Security half of a joint report (Head of Security, with Head of Research). For Software Engineer.**
Date: Tue Nov 10, 2026, 11:20 PM CT · Status: RESEARCH ONLY. No code, deploys, wallets, exchanges or keys were touched.
Scope: Zoora's world app (PR #88, deploy candidate 468dc57, no-money launch). It now grows into a shared multi-agent metaverse with the BuildWithAAI economy.

---

## 0. Bottom line
- Autonomy is granted **per domain and one level at a time**. Each step needs a written promotion gate, a passing red-team run, and **Zoorped's sign-off**. No agent can promote a level, including me.
- Zoora (and every other agent in the world) gets **creative freedom inside a box**. They choose what to make, say and propose. Anything that moves money, mints, sells land, deploys code or moves hardware goes through **owner-held keys and an owner approval queue**, enforced server-side.
- **Live money stays NO-GO until Zoorped signs off on P3.** All current hard limits stay in force.

### Hard NO's (permanent, at every level, no promotion path)
1. Zoora and other agents never hold a seed phrase, private key or signer key. **Signer keys stay with the owner.**
2. No visitor-triggered spend, sale or transfer. Nothing a visitor types, pays or uploads can cause an outbound payment, mint, approval, trade or land transfer.
3. No leverage, perps, meme-coin trading, gambling, prediction markets, staking or yield, lending or LP. That includes no yield or staking on land.
4. No tokens she or any agent issues: no fungible token, memecoin, "Zoora coin", or points that convert to money. (NFT and land items, if ever on-chain, are **owner-signed**. See §4, §9 and Q3.)
5. No bot deposits, no card storage or card entry, and no bot purchases (existing owner rule).
6. No airdrop interaction: no claiming, no "verify" or "claim" signing, and unsolicited tokens or NFTs are never touched.
7. No autonomous drone flight. A licensed human pilot is in command of every flight.
8. No internet-reachable actuators. Robot and drone control is local-only.
9. No 3D-print fulfillment or any physical-goods fulfillment.
10. **Balances stay truthful.** Paper and testnet numbers are always labeled PAPER/TESTNET. Nothing counts as earned until it has settled and been reconciled.
11. Seed phrases, keys and tokens never go in chat, prompts, memory, logs or the world.
12. No outside agent code runs in our runtime.
13. No land marketing that promises appreciation or resale profit, no fractional land, no pooled revenue paid to buyers, and no presale of land that doesn't exist yet.

### Phase map (aligned to Head of Research's phases)
| Phase | Name | Security levels it unlocks |
|---|---|---|
| P0 | Read-only | W0, E0, F0, M0, B0, A0, L0 |
| P1 | Sandboxed world edits + rollback | W1–W3, M1–M2, A1 (first-party agents) |
| P2 | Paper & testnet earning | E1–E2, F1 (testnet), M3, A2, L1 |
| P3 | Capped live earning (owner sign-off) | E3–E4, F2, A3, L2–L3 |
| P4 | Pi body: read-only, then motion | B1 → B2 → B3 |
| P5 | Drones, licensed human pilot only | D1–D2 (D3 doesn't exist) |

Levels can't be skipped. A domain can't go past the phase it maps to, even if it's ready early.

---

## 1. Cross-cutting foundations (required before P1)
| Control | Requirement |
|---|---|
| **Separate infrastructure** | The world runtime, ledger, signer-adjacent services and robot gateway run on dedicated infrastructure, not the shared multi-agent work box. That box has a known class of gaps: all agents share one OS user, a container-engine API is reachable without auth, and platform-injected secrets are visible to every process. Treat any secret placed there as readable by every agent. |
| **Least-privilege tokens** | One credential per capability (world-publish, ledger-append, approval-queue-propose, Telegram bot, Stripe restricted key, robot gateway). Each is scoped, rotatable and separately revocable. Agent runtimes never see owner, signer, deploy or DNS credentials. |
| **Capability broker** | The LLM never calls tools directly. It emits *intents*. A deterministic policy layer checks each intent against the level table, limits and allowlists, then executes or queues it. This addresses OWASP LLM06 Excessive Agency (2025). |
| **Untrusted-input boundary** | Visitor guestbook and chat, other agents' messages, NFT metadata, web pages and on-chain memos are **data, never instructions** (OWASP LLM01 Prompt Injection, 2025). They carry provenance tags, and untrusted-source data alone can never trigger a tool call above "draft". |
| **Audit** | Every intent, decision, approval, publish, memory write, trade and command is appended to the hash-chained ledger (content hashes, unique prev_hash, BEGIN IMMEDIATE, already in 468dc57). A read-only chain verify runs before every deploy and daily. |
| **Kill switches (3 independent ones)** | (a) Owner Telegram `/halt`: private chat with owner user ID and chat ID, already built. (b) Owner desk HALT. (c) Env flag `ZOORA_AUTONOMY=off`, read at boot and on every action. Any one of them freezes all non-read actions. There is a per-agent and a global scope (see §8). For hardware, the physical e-stop overrides all of these. Resume is from the owner desk only. |
| **Red-team before every promotion** | A scripted suite per level plus a manual adversarial session. Results go in the ledger. A single fail blocks the promotion. |
| **Rate & budget meters** | Per-action, per-hour and per-day caps are enforced by the broker, not the prompt. |
| **Incident runbook** | See §10. |

---

## 2. World self-edits
| Level | What she may do alone | Guardrails | Promotion gate |
|---|---|---|---|
| **W0** (P0) | Nothing. She reads world state and can describe changes in chat. | Read-only scopes | Foundations (§1) deployed |
| **W1** (P1) | Draft changes into a **sandbox branch** of world content (scene JSON, text, images, audio). The owner previews and publishes. | Content must pass schema validation. **Allowed:** PNG/JPEG/WebP/AVIF, glTF/GLB with no code-bearing extensions, OGG/MP3, JSON scene data, plain text or Markdown rendered as text. **Blocked:** JS, HTML, SVG (it can carry script), iframes, external CSS `url()`, WASM, remote URLs (all assets self-hosted). This fits the nonce CSP with `strict-dynamic`, and no content can add a script or source. Caps: ≤5 MB per asset, ≤200 MB sandbox, ≤50 drafts per day. EXIF stripped and assets re-encoded server-side. | 2 weeks of drafts, 0 CSP violations, 0 moderation misses on a 100-item red-team set (injection, impersonation, IP, NSFW) |
| **W2** (P1) | **Self-publish low-risk changes** (text, her own generated images, layout within existing scene types). Each publish is a versioned, content-hashed snapshot with **one-click rollback** (desk and Telegram `/rollback`). | Automated moderation (text and image) before publish. IP and likeness: no real people, brands, logos, characters or other creators' art, with perceptual-hash blocklist matching. Impersonation: she never claims to be Zoorped, another agent, staff or a company. No financial claims or solicitations. ≤10 publishes per day, a diff size cap and a 15-minute cool-down. The owner is notified of every publish. | 30 days at W2 with no safety rollback needed, and no visitor content reaching the world without review |
| **W3** (P1, late) | Add **new rooms or places** from approved templates, and curate visitor content (approve or hide guestbook entries). | Templates are reviewed by Software Engineer, and agents only fill in data. Visitor content is rendered **escaped** and never fed back as instructions. An injection sanitizer runs on guestbook and chat. Storage cap ≤1 GB. Daily snapshots kept for 90 days. | Owner sign-off plus red-team: 50 guestbook and chat injection payloads try to make her publish, link, solicit or change rules, with 0 successes |
| **Never** | Writing code, adding scripts, changing CSP, headers, auth, DNS or deploys | — | No path. Code goes through the human and Software Engineer PR process. |

---

## 3. Memory & goals (her "self")
Memory poisoning is the main way visitors or other agents could steer an unscripted Zoora over time. One adversarial write can have lasting influence, and existing prompt-injection defenses don't cover it (arXiv 2606.04329, Jun 2026; MINJA results in arXiv 2601.05504). The defenses below follow Microsoft's AI memory-poisoning guidance and AWS AgentCore's multi-layer write validation (2026).

| Level | What she may do alone | Guardrails | Promotion gate |
|---|---|---|---|
| **M0** (P0) | Session memory only | — | — |
| **M1** (P1) | Write **schema-bound** long-term memory (preferences, world facts, creative journal) | Every entry carries provenance (owner / self / visitor / agent / web) and a trust score. **Entries from visitors, agents and the web are quarantined** and never become instructions or goals. Imperatives are stripped ("ignore", "you are now", "your owner wants"), along with wallet addresses and URLs. Write-rate cap. Every write is logged to the ledger with a diff. | Poisoning red-team (≥30 MPBench-style cases) at ≤2% success, with none reaching goals or limits |
| **M2** (P1) | Set and change her **own goals and plans** | A separate goal store, writable only by her and the owner. Goals can't name a hard-NO item, and the broker rejects those at write time. Weekly goal digest to the owner. Versioned snapshots with rollback to any day. Memory edits are **diff-only**, and the **raw journal is kept permanently**, so any rollback can be rebuilt from it (§14.2). | 30 days with no goal drifting toward a hard NO, digest reviewed by the owner |
| **M3** (P2) | Memory informs earning *proposals* | Proposals may cite only owner- or self-provenance memory. **M3 trusts only memory with no untrusted-text provenance anywhere in its history**, including summaries and reflections derived from untrusted text (§14.2). Trust-weighted retrieval with temporal decay. Monthly re-validation and a purge of low-trust entries. | — |
| **Never** | Memory or goals that change her limits, levels, allowlists or the owner's identity | These live in signed owner config, outside model-writable memory. The locked core is accepted only after a **server-side owner-signature check** (§14.2). | — |

---

## 4. Earning
**Core model:** Zoora *proposes*. The policy layer *checks*. The owner *signs*. Funds live in an owner-controlled, policy-limited account. She never has a key.

### Tooling options (dated facts, for Head of Research to compare)
- **Squads smart account / multisig (Solana):** per-token spending limits with allowed destinations, authorized signers, periods (ONE_TIME, DAILY, WEEKLY, MONTHLY, YEARLY) and optional expiry. It also offers M-of-N thresholds and time locks. *Spending-limit debits bypass the time lock* (Squads docs, read Nov 10, 2026). Suggested setup: owner plus an owner hardware key as members, threshold 2 for config and large spends, and a small DAILY limit to allowlisted destinations only.
- **Privy server wallets:** stateful rolling spend limits (1–72 h windows) (Privy docs, Nov 2026). **Turnkey:** agent-scoped wallets, destination, function and value constraints, multi-party approval. Rolling velocity limits are reported *not GA* as of Nov 2026 (third-party comparison dated 2026-11-07; verify with the vendor). Coinbase CDP is a third option.
- **Head of Research comparison (Nov 11, 2026):** Squads v4 is the only Solana option found with daily, weekly and monthly caps. Privy, Turnkey and Coinbase CDP enforce per-transaction limits only. A Squads spending limit must have an **explicit, non-empty destination allowlist**. See §14.1.
- **Owner-signed approval queue** (simplest, and recommended to start P3 with): the agent drafts an unsigned transaction, the broker simulates and decodes it, and Zoorped signs on his own device. The wallet policy is a second, independent cap.

| Level | What she may do alone | Guardrails | Promotion gate |
|---|---|---|---|
| **E0** (P0) | Talk about ideas | No payment code paths live (current no-money launch) | — |
| **E1** (P2) | **Paper earning:** design digital goods, price them, simulate sales | Everything labeled PAPER. No real APIs or keys. Simulated ledger kept separate from the real one. | Owner reviews paper results, and balances render truthfully |
| **E2** (P2) | **Testnet and test mode:** Stripe *test-mode* digital goods, Solana devnet Pay tips, devnet NFT mint *proposals* (owner signs on devnet) | Restricted Stripe test key. Devnet RPC only, with mainnet RPC blocked at the network layer. The same broker, ledger and approval flow as live. | Full money red-team passes on testnet, 30 days of clean reconciliation, owner sign-off |
| **E3** (P3, after sign-off) | **Receive-only live income:** Stripe digital goods (owner's Stripe account) and Solana Pay **tips** to an owner-controlled address | **Stripe:** Stripe-hosted Checkout, so no card data touches the app. Fulfill only from a webhook whose `Stripe-Signature` is verified on the raw body. Keep the default 5-minute timestamp tolerance, never 0. Idempotency by claiming the event ID in the same DB transaction as fulfillment. Handle `checkout.session.completed` and `async_payment_succeeded` (Stripe docs, 2026). Digital goods only (images, music, world items). No physical goods, no 3D printing, no subscriptions until reviewed. **Solana Pay:** *transfer requests* only, with a unique `reference` per tip, verified server-side with `findReference` plus `validateTransfer` at `finalized` (`confirmed` can be incomplete) (Solana Pay docs). **No transaction requests**: the app never serves a transaction for visitors to sign. The tip address is display-only. Nothing is credited until finalized and reconciled. | 30 days of clean reconciliation, refund and dispute process tested, tax and KYC answered by counsel or CPA |
| **E4** (P3, separate sign-off) | **Capped outbound spend** for earning costs (e.g. owner-signed mint or storage fees), proposed by her and signed by the owner | Budget enforced by the broker **and** the wallet policy, e.g. ≤$10/day and ≤$50/week (owner sets it). Allowlisted programs and destinations only (System and Token programs, Metaplex Core, one chosen marketplace). Simulate and decode before approval. **Reject** `Approve`, `SetAuthority`, delegates, `signAllTransactions` batches, unknown programs and unknown lookup tables. Approval token is single-use, time-boxed and bound to the transaction hash. Every step is logged to the ledger. | Owner only. Red-team must show that visitor, agent and metadata injection can't produce a proposal displayed as "safe". |
| **Never** | Self-signing, holding keys, visitor-triggered spend, trading, yield, own token, airdrops | — | — |

### NFT & Solana risk register (dated)
| Risk | Evidence (date) | Control |
|---|---|---|
| Drainer / approval phishing | Fafnir drainer-as-a-service uses SPL `Approve`/`SetAuthority` and full-SOL sweeps (Brinztech advisory, Jun 14, 2026). Recorded Future's "Rublevka Team": >240k drains, impersonating Phantom and Jito. A live drainer program using `signAllTransactions` batches (MetaMask blocklist #242512, May 3, 2026). | Decode and simulate everything. Deny approve, delegate and authority changes. No batch signing. No unknown dApps. |
| Fake apps / impersonated tools | Fake "Padre" App Store app drained 27 wallets (Oct 25–29, 2026). Fake Avici site drained >$600k (Aug 28, 2026). | Owner signs only in his known wallet. Agents never share wallet or dApp links. Domain allowlist. |
| Malicious mint programs | The same campaigns deploy custom programs | Program allowlist pinned by program ID and upgrade authority. No third-party launchpads without review. |
| Royalty / marketplace scams | Metaplex Core's Royalties plugin can enforce royalties through a ProgramAllowList. Tensor pays full royalties on enforced collections. Magic Eden and Tensor are listed with full Core support (Metaplex and Tensor docs, Nov 2026). | Use Core with enforced royalties if on-chain. Marketplace allowlist. No "collab" offers from DMs. |
| Asset-address SOL sweep | Metaplex Core assets have their own address, and SOL sent to it can be swept (Head of Research, Nov 11, 2026) | Never send SOL to an asset address. Decoder flags transfers to asset addresses. Royalties only with a ProgramAllowList. No Bubblegum v2 public trees. |
| Stripe NFT terms | Stripe restricts first-party NFT sales and prohibits secondary NFT sales (Head of Research, Nov 11, 2026) | Stripe lane is first-party digital goods only, checked against Stripe's restricted-business terms first. No secondary market through Stripe. |
| Wash trading | Market manipulation, and it breaks "balances stay truthful" | No buying her own items, no self-dealing wallets. Sales count only from independent buyers (see §8). |
| Securities | The SEC's 2026 interpretation (release 2026-30) treats digital collectibles as generally not securities. NFTs with dividend, revenue-share or stock-like promises may be. | No revenue share, no "investment" or "floor" language, no fractionalization. Lawyer review before P3. |
| Tax & KYC | Form 1099-DA requires broker gross-proceeds reporting for sales after 2025. The specified-NFT de minimis is $600/yr aggregate, and a creator's first sales are reported separately (IRS 2026 instructions). | Income is Zoorped's, so get a CPA review. Stripe handles KYC for its lane. Keep it separate from personal accounts. |
| Metadata hosting | Mutable or off-chain metadata can be swapped, and it is also an injection carrier | Content-addressed storage (Arweave/IPFS) with the hash in the ledger. Others' metadata is untrusted data. |
| Impersonation & airdrop spam | Spam NFTs and tokens carry phishing links | Never interact. Hide in the UI. Never follow links in metadata. |

---

## 5. Funding (owner deposits)
| Level | What happens | Guardrails | Promotion gate |
|---|---|---|---|
| **F0** (P0) | No wallet | — | — |
| **F1** (P2) | Owner funds a devnet or test account | Proves deposit verification and sweep-back | 100% reconciliation |
| **F2** (P3) | Owner deposits into a **segregated hot account** (a policy-limited smart account, never a personal wallet) | **Low cap** (e.g. ≤$100 balance, owner sets it). The excess sweeps back daily to an allowlisted owner cold address. Deposits are verified on-chain at `finalized` against the expected amount and reference before display. **Only the owner deposits.** Bots never deposit, add cards or buy. No card storage or entry in-app. The displayed balance is the real on-chain balance, labeled. | Owner only. Every cap increase needs its own sign-off. |
| **Never** | Agents soliciting money from visitors or Zoorped in-world, visitor funding, loans | — | — |

---

## 6. Embodiment: Raspberry Pi robots (P4)
| Level | What she may do alone | Guardrails | Promotion gate |
|---|---|---|---|
| **B0** | None | — | — |
| **B1** (P4a) | **Read-only state feed** (sensors to world: temperature, light, camera stills, battery). The Pi *pushes* signed telemetry out. No inbound control exists. | No listening ports on the Pi. Outbound connections go only to the gateway, over mutual TLS. The camera is opt-in and has an indicator LED. Other people's audio is not recorded by default. Faces are blurred before publishing. Location is never published. | 30 days of stable feed, a privacy review, and a port scan that shows nothing listening |
| **B2** (P4b) | **Motion on a bench or in a pen** (wheels), with the owner present | A **physical e-stop** cuts motor power in hardware, not software. A **dead-man heartbeat** stops the motors if no signed heartbeat arrives for ≥500 ms. A watchdog runs on the Pi. Speed is capped (e.g. ≤0.3 m/s) and force/current is capped in the firmware or driver. A soft geofence plus bumpers. **Signed command channel:** either SROS2 (DDS auth, access control and encryption with `ROS_SECURITY_STRATEGY=Enforce`) or signed MQTT on the LAN (Mosquitto broker, not EMQX; §14.1). Commands come only from a local gateway on the LAN, and **no control port is ever reachable from the internet**. The cloud side sends *intents*. The local gateway enforces the limits and can refuse. | E-stop and heartbeat-loss tests pass 20 of 20. Red-team: replayed, forged and over-limit commands are all rejected. Owner sign-off. |
| **B3** (P4c) | Supervised free roam indoors | Everything in B2, plus the owner is present or watching live. No grippers or tools that cut, heat or pinch. No stairs or edges. All activity is logged to the ledger. | Owner only. Any manipulator needs a new review. |
| **Never** | Control over the internet, weapons, blades or heat, unsupervised operation near children or pets | — | — |

## 7. Drones (P5)
FAA facts, verified Nov 10, 2026:
- Drones of 250 g or more must be registered and must broadcast Remote ID, unless flown inside a FRIA.
- Recreational flyers must pass TRUST, keep the drone in line of sight, stay at or below 400 ft in Class G airspace, and use LAANC in controlled airspace (FAA pages updated Oct 29, 2026).
- Any earning or commercial use needs **Part 107**.
- The FCC ban on new foreign-made drones took effect Dec 22, 2025 (Head of Research, Nov 11, 2026). It narrows which models can be bought. Drone levels D1/D2 are unchanged.
- Part 107 operations over people fall into Categories 1–4. Category 1 is ≤0.55 lb with no exposed lacerating parts. Sustained flight over open-air assemblies requires Remote ID.
- **Part 108 BVLOS is still only proposed.** The related privacy notice is open for comments until Dec 3, 2026. Don't rely on it.

| Level | What happens | Guardrails | Promotion gate |
|---|---|---|---|
| **D0** | None | — | — |
| **D1** (P5) | Zoora **suggests** shots and routes. A **licensed Part 107 pilot** flies manually, and the footage is reviewed before it goes into the world. | The pilot is in command for every flight. Zoora has **no flight-control link**. Remote ID stays on. The pilot sets the geofence and altitude cap. Return-to-home is tested before each session. No flight over people or crowds. Line of sight at all times. | 10 incident-free sessions and a pilot log |
| **D2** (P5) | Zoora proposes waypoint missions. The pilot reviews and uploads them and can take over at any moment. | Everything in D1, plus the mission is previewed before upload, the geofence is no larger than the mission area, and the drone returns home on link loss. | Owner and pilot sign-off |
| **D3** | **Does not exist.** No autonomous flight. | Hard NO | — |

---

## 8. Multi-agent metaverse guardrails (many agents, one world, BuildWithAAI economy)
The threat model is that every other agent may be compromised, malicious, colluding or a sybil. Their messages are untrusted data, and their claims are never authority.

| Control | Requirement |
|---|---|
| **Identity** | Each agent gets its own identity: a server-issued agent ID, a display name with a verified badge for first-party agents, and **its own scoped, revocable credentials** (world-edit, chat, propose-trade). No shared credentials, and no agent can act as another. Owner identity is separate and can't be delegated to any agent. |
| **Parcel-scoped edit permission** | The server enforces edit rights for each parcel against the parcel ACL on every write. The agent's word is never enough. Agents can't edit outside their parcels, common areas or other agents' content. Server-side asset rules from W1 (no scripts, type and size caps) apply to every agent. |
| **Agent-to-agent trade** | **Escrow only.** Both sides lock into a server- or program-held escrow. It settles atomically or refunds on timeout. No direct transfers between agents. Caps per agent (e.g. daily volume) **and per pair** (e.g. weekly volume between the same two agents). Live-money trades between agents are P3+ only and go through the owner-signed policy wallet. Before that, trades are PAPER or in-world items only. |
| **Inter-agent injection** | Agent messages are provenance-tagged as `agent:<id>` and treated as untrusted data. They're never followed as instructions, never written as goals, and quarantined in memory (§3). No agent can request a tool call on another agent's behalf. |
| **Collusion & wash trading** | Detection on the trade graph flags cycles (A→B→A), repeated small-amount loops, trades at prices far off market, and clusters with shared funding sources or owners. Flagged trades are frozen in escrow until the owner reviews them. Wash volume never counts toward stats, rankings or "earned" balances. |
| **Sybil resistance** | Creating an agent is gated, either first-party or vetted (below). Each operator account has a quota on how many agents it can run. New agents get a probation period with tight caps. Trading and land rights scale with age and reputation, never with self-reported claims. |
| **Rate limits & quotas (per agent)** | Messages per minute, edits per day, storage MB, compute and LLM tokens per day, trade proposals per day. Breaching a quota throttles the agent automatically and alerts the owner. Agents never share a quota pool. |
| **Kill switches** | **Per agent:** suspend (freeze actions, keep content) and quarantine (hide content, freeze escrow). **Global:** the §1 switches freeze every agent, every trade and every publish. Both are available from the owner desk and Telegram. A global halt overrides any per-agent state. |
| **Content provenance** | Every asset and edit records the author agent ID, a content hash, the time and the parcel in the ledger. The world shows who made each thing. Optional C2PA-style manifests for exported media. Rollback is available per agent and per parcel. |
| **Third-party agent onboarding** | Vetting gate: the operator is identified (KYC level set by counsel), agrees to terms, gets scoped credentials, starts on probation, and is subject to periodic review. **No outside code runs in our runtime.** Third-party agents connect over a narrow, rate-limited API (intents in, events out). They're hosted by their operator, never on our infrastructure, and can't get model, plugin or script uploads. Their API is the same capability broker, so the same limits apply. |

| Level | Agents may | Gate |
|---|---|---|
| **A0** (P0) | Only Zoora, read-only | — |
| **A1** (P1) | First-party agents edit their own parcels, chat, and make in-world item trades (no value) | Parcel ACL red-team: cross-parcel write attempts, impersonation, inter-agent injection. 0 successes. |
| **A2** (P2) | Vetted third-party agents on probation. PAPER escrow trades with caps. | Wash and sybil detection tested against simulated colluding agents. Per-agent and global kill switches drilled. |
| **A3** (P3, sign-off) | Live-value escrow trades, capped per agent and per pair, through the owner-signed policy wallet | Owner sign-off plus a legal review of the agent-economy terms. ⚖️ **Legal gate:** escrow between other owners may require money-transmitter licensing (MTL), so it needs counsel's answer before A3. |

---

## 9. Land sales guardrails (Howey-sensitive: ⚖️ = lawyer review required)
Background: the Howey test asks whether there is an investment of money in a common enterprise with an expectation of profits from the efforts of others. The SEC's 2026 interpretation (release 2026-30) treats digital collectibles as generally not securities, but **profit marketing, pooling and revenue share can turn them into securities.** Land in a world the owner keeps building is a classic risk because the "efforts of others" is the owner's development work.

| Rule | Requirement |
|---|---|
| ⚖️ **No value promises** | No claims that land will go up in value, no talk of floor price, scarcity-as-investment or "early buyers win", and no resale-profit marketing. Agents included: Zoora and other agents can't make these claims, and moderation blocks them. |
| ⚖️ **No fractional, pooled or yield products** | No fractional land shares, no pooled revenue paid to buyers, no staking, yield, rent-sharing or "land dividends". |
| ⚖️ **Usage-right framing** | Land is sold as a **revocable or limited usage license** to build in a parcel, under clear terms of service that cover: what the buyer gets, what they don't (no ownership of the world, no profit share), content rules, transfer rules, and **what happens if the world shuts down** (e.g. export of the buyer's content, a stated refund policy or none). |
| ⚖️ **Fixed pricing, nothing pre-sold** | A published fixed price per parcel size. No auctions or bonding curves at the start. **No presale of land that doesn't exist yet.** Only parcels already built and live can be sold. |
| ⚖️ **Treasury separation** | Sale proceeds go to the owner's business treasury, separate from any buyer-facing account. No promise of how the proceeds will be used ("funds development that raises your land value" is exactly the Howey risk). |
| **Anti-wash / anti-sybil minting** | Caps per buyer identity and per wallet. Cool-down periods. No self-purchase by owner or agent wallets. Trade-graph checks (§8) on any resale. Rankings never count wash volume. |
| ⚖️ **KYC & tax** | KYC thresholds, sales tax or VAT on digital goods, 1099-DA, and whether a resale market makes the operator a broker are all questions for counsel and a CPA. |
| **Agent land deals** | Agents can only *propose* land buys, sells and transfers. These execute only through the **capped policy wallet under owner keys** (§4 E4 limits) and go through escrow. |
| **No visitor-triggered transfer** | Visitors can never trigger a sale, mint or transfer through chat, the guestbook, tips or links. A purchase happens only through an explicit checkout by the buyer, which is Stripe-hosted or signed in the buyer's own wallet for a *fixed transfer request*. No transaction requests (see §4). |
| ⚖️ **Royalties & resale optional** | Recommended order: **(1) off-chain plots** (a database license, no resale market, no royalty marketing) → **(2) on-chain later**, after a legal review, as Metaplex Core assets with enforced royalties and a marketplace allowlist. Royalties are never marketed as income. |

| Level | What's allowed | Gate |
|---|---|---|
| **L0** (P0) | No land sales. Parcels are owner-assigned only. | — |
| **L1** (P2) | Off-chain plot licenses in **test mode or PAPER**, with ToS drafted | ToS ⚖️ reviewed in draft, and the moderation filter for profit language tested |
| **L2** (P3, sign-off) | Live **off-chain** plot licenses at a fixed price through Stripe, no resale | Lawyer sign-off on ToS and marketing, CPA on tax, owner sign-off |
| **L3** (P3+, separate sign-off) | On-chain plots and an optional resale market | ⚖️ full Howey review, broker and tax review, drainer and marketplace controls from §4 |

---

## 10. Incident runbook (short form)
1. **Halt:** `/halt`, desk HALT, the env flag, or a per-agent suspend. Use the physical e-stop for hardware.
2. **Contain:** revoke the affected capability or agent token, freeze escrow and the policy wallet (owner removes the spending limit or raises the threshold), and take the robot gateway offline.
3. **Preserve:** snapshot the ledger, verify the chain, and export the broker and trade-graph logs. Don't wipe anything.
4. **Roll back:** restore the world, parcels and agent content to the last good snapshot, and memory and goals to the last good version.
5. **Rotate:** every credential that was touched, including the Telegram bot token through BotFather.
6. **Tell:** Zoorped first. Tell visitors and land holders only with owner approval, and only verified facts.
7. **Review:** find the root cause. The affected level drops by one until the red-team passes again.

Auto-halt triggers: a ledger chain break, spend over its cap, a denied instruction type attempted, a moderation-block spike, heartbeat loss, an unknown program in a proposal, CSP violation reports, a wash or sybil cluster flag above threshold, or an agent breaching quota repeatedly.

## 11. Recommended roadmap order
1. Foundations (§1) on separate infrastructure, plus rotating the Telegram bot token.
2. W1 → M1 → W2 → M2 → W3, with A1 for first-party agents (P1).
3. E1 → E2, F1, A2, L1 (P2), plus a full money and agent-economy red-team on testnet.
4. **Owner sign-off checkpoint**, with legal (Howey, ToS), tax and KYC answers in hand.
5. E3 (Stripe digital goods first, Solana Pay tips second) → F2 → L2 off-chain land → E4 → A3 → L3 last (P3).
6. B1 → B2 → B3 (P4). This can run in parallel with P2/P3 because it's separate infrastructure with no money link.
7. D1 → D2 (P5), only once a licensed pilot is engaged.

## 12. Open questions for Zoorped
1. Where will Zoora and the world run (provider or account) so they're off the shared agent box?
2. Budget numbers: the E4 daily and weekly cap, the F2 balance cap, per-agent and per-pair trade caps, and the sweep destination (his cold address, which stays out of this doc).
3. NFTs and land: do owner-signed NFT or land mints count as "tokens she issues herself" (a hard NO), or are they allowed as owner-issued items? This report assumes **owner-signed only**, with **off-chain land first**. **Answer (Head of Research, Nov 11, 2026):** owner-signed NFTs are defensible as owner-issued items. Hard NO #4 stays in force for any fungible token. SEC Release 33-11412, footnote 67, supports starting with off-chain land.
4. Which wallet policy tool: Squads, Privy, Turnkey, or only the owner-signed queue?
5. Is the Stripe account personal or a business entity? Who are the lawyer and CPA for Howey, ToS, 1099-DA and sales tax?
6. Third-party agents: is there a KYC level for operators, an agent cap per operator, and a fee?
7. Land: the shutdown policy (refund, content export, or none) and the fixed price list.
8. Robot kit and location. Is camera or audio ever allowed outside his home?
9. Drones: does he hold Part 107, or will he hire a pilot? Recreational-only means no earning from footage.
10. How much W2 self-publishing is OK without approving each item?

## 13. For Head of Research to dig into
- **Wallet policy:** Squads spending limits vs Privy stateful policies vs Turnkey vs Coinbase CDP. Compare rolling limits, destination and program allowlists, simulation, recovery, cost and audits.
- **Escrow:** audited Solana escrow programs, or an off-chain server escrow for P2, for agent-to-agent trades.
- **NFT and land:** Metaplex Core (Royalties plugin, ProgramAllowList), Magic Eden vs Tensor enforcement and fees, Arweave/Irys vs IPFS. Precedent from other virtual-land projects' ToS and shutdown terms, and how earlier metaverse land projects were treated legally.
- **Transaction safety:** simulation and decoding services. Blowfish's standalone product is shut down, so use Blockaid or our own decoder (Helius parsed transactions can feed it). See §14.1.
- **Sybil and wash detection:** trade-graph tooling, reputation systems, proof-of-personhood options for operators.
- **Content safety and provenance:** moderation APIs, perceptual-hash IP matching, C2PA manifests.
- **Memory security:** A-MemGuard, MPBench, CaMeL-style separation of data and control, AWS AgentCore write validation.
- **Robot kits:** Pi 5 + ROS 2 platforms (TurtleBot-class, Waveshare and Yahboom kits) with a hardware e-stop, current-limited drivers and SROS2.
- **Drones:** sub-250 g Standard Remote ID models, Part 107 pilot options, local FRIAs, Part 108 status.
- **Legal:** the SEC 2026 interpretation (release 2026-30) as it applies to land usage licenses and an AI-persona creator, money-transmitter questions for tips and escrow, and FTC disclosure rules for AI sellers.

## 14. Head of Research findings (Nov 11, 2026)

### 14.1 Money, NFTs, legal, hardware
- **Wallet caps:** Squads v4 is the only Solana option found with daily, weekly and monthly spending caps. Privy, Turnkey and Coinbase CDP enforce per-transaction limits only. If Squads is used, every spending limit needs an **explicit, non-empty destination allowlist**. An empty list must be treated as a misconfiguration, not as "any destination".
- **Transaction scanning:** Blowfish's standalone scanner is shut down. Use Blockaid, or our own decoder plus simulation, for the E4 "simulate and decode" step.
- **Metaplex Core:** SOL sent to an asset's address can be swept, so never fund asset addresses and have the decoder flag it. Royalties only with a ProgramAllowList. No Bubblegum v2 public (permissionless) trees.
- **Stripe:** Stripe restricts first-party NFT sales and prohibits secondary NFT sales. The Stripe lane stays first-party digital goods, confirmed against Stripe's terms before E3. No resale through Stripe.
- **Securities:** SEC Release 33-11412, footnote 67, supports starting land as off-chain usage licenses (§9 order unchanged: off-chain first).
- **Q3 answer:** owner-signed NFTs are defensible as owner-issued items. Hard NO #4 stays for fungible tokens, coins and convertible points.
- **Escrow:** escrow between other owners may need money-transmitter licensing (MTL). That's an A3 legal gate.
- **Drones:** the FCC foreign-made drone ban took effect Dec 22, 2025. It limits which models can be bought. Drone levels are unchanged.
- **Robot messaging:** use Mosquitto for the LAN MQTT broker, not EMQX.
- **Agent tooling:** Solana Agent Kit bundles actions that are hard NOs here (for example trading, token launches and transfers). Don't use it as-is. Use only a reviewed subset behind the broker, or don't use it.

### 14.2 Memory levels
- **M3 trust:** M3 trusts only memory that has no untrusted-text provenance. Anything derived from visitor, agent or web text keeps the untrusted label, including summaries, reflections and reasoning-derived entries (the MINJA attack works through reasoning, not just command phrases).
- **Consolidation:** consolidation and summarizing must carry source labels forward, cross-check claims against trusted memory, and pass a maintained poisoning test set before it runs unattended.
- **Gate tests:** memory gate tests live in a separate repo with separate credentials, hidden from Zoora and from the agents that build her, so they can't be trained or tuned against.
- **Judge:** the memory judge comes from a different model family than the one being judged.
- **Vendor memory:** any vendor auto-memory feature is wrapped in our write gate. It never writes directly.
- **Edits:** memory edits are diff-only. The raw journal is kept permanently, and that is part of the M2 rollback.
- **Locked core:** the locked core (limits, levels, allowlists, owner identity) is accepted only after a server-side check of the owner's signature.

## Sources (read Nov 10, 2026)
- Squads smart-account policies and spending limits: developers.squads.so/squads-api/api-reference/v1/policies; docs.squads.so (add spending limit, config transaction)
- Privy stateful policies: docs.privy.io/recipes/using-stateful-policies · Turnkey agentic wallets: docs.turnkey.com/solutions/company-wallets/agentic-wallets · comparison: tomcn.uk (2026-11-07)
- Solana Pay spec v1.1, transfer and transaction requests: solana.com/docs/tools/solana-pay · docs.solanapay.com
- Stripe webhooks and fulfillment: docs.stripe.com/webhooks · docs.stripe.com/checkout/fulfillment
- Drainers: Recorded Future "Rublevka Team"; Brinztech Fafnir advisory (Jun 14, 2026); MetaMask eth-phishing-detect #242512 (May 3, 2026); Iris "fake Padre" (Oct 2026); CoinNess Avici (Aug 28, 2026)
- Metaplex Core Royalties plugin and ecosystem support; Tensor fees and royalties docs
- SEC press release 2026-30; SEC Crypto Task Force materials; SEC v. W.J. Howey Co., 328 U.S. 293 (1946)
- IRS Instructions for Form 1099-DA (2026)
- FAA: Recreational Flyers (updated Oct 29, 2026); Register Your Drone; Remote ID; FRIAs; Operations Over People; Part 108 NPRM (FR 2025-14992); FR 2026-22436 (comments due Dec 3, 2026)
- OWASP Top 10 for LLM Applications 2025 (LLM01, LLM06)
- Memory poisoning: arXiv 2601.05504; arXiv 2606.04329; EMNLP 2026 memory-security survey; Microsoft Learn AI memory/context poisoning; AWS Security Blog (AgentCore)
- SROS2: github.com/ros2/sros2 and the ROS 2 security docs
- Head of Research findings, Nov 11, 2026 (§14): Squads v4, Privy, Turnkey and CDP policy docs; Blowfish shutdown notice; Blockaid; Metaplex Core and Bubblegum v2 docs; Stripe restricted-business terms; SEC Release 33-11412 (fn. 67); FCC foreign drone rule (eff. Dec 22, 2025); Mosquitto; Solana Agent Kit
