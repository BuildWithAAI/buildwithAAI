# Fact bank seed, 2026-11-24

The first 39 facts in `facts.jsonl` came from the fact-check verdicts in two research files:

- `content/zoora-ai/pumpfun-top-caller/research.md`
- `content/zoora-ai/ai-agent-hedge-fund/research.md`

The tools and rules are in `docs/FACT_BANK.md`.

## Rules applied

1. **Only claims the checker marked "holds".** Claims marked unsupported, overstated or wrong were not imported, even when a page now supports them. One clause is the exception, and its fact records both origins: `goat-150-million-oct-2024` says the Truth Terminal bot endorsed GOAT but did not launch it. That clause comes from row 30 of `ai-agent-hedge-fund/research.md`, which the checker marked "overstated" as a whole while its note confirms this part (someone else launched GOAT and tagged the bot, which endorsed it); the research's "confirmed · safe" summary says the same, and the fact's excerpt, read directly, states it.
2. **The safe wording.** Each statement follows the checker's note: attribution ("Bubblemaps alleged", "Sparsity Research estimated"), "about" or "over" where the checker said so, and no figure the research's "Must not say" list bans. The checker's caveats are in each fact's `notes`.
3. **No private individuals.** Statements, notes and excerpts name no caller, defendant, plaintiff, founder, developer, attacker or contest winner. When a source sentence contains a name, the excerpt leaves the name out with `…`. No source URL in the bank contains a person's name or handle. A scan of the bank against a list of every name and handle seen in the source pages found none. That list stayed in scratch and was not committed.
4. **Verbatim excerpts.** Every excerpt is copied from the live page, at most 280 characters, and contains the claim's figures or names. `…` joins passages of the same page in page order. No excerpt is a paraphrase.
5. **Honest verification labels.**
   - **Imported as `search-extract` (24 facts).** The checker cited this outlet and page for this claim, and the checker's evidence was search-engine extracts. The source carries a `search` check that says so. For three sources the research names only the outlet, not the page, so the page was chosen at import: `bubblemaps-side-wallets-business-model` (crypto.news), `elizaos-token-declared-dead` (its Cointelegraph source) and `pumpfun-livestream-back-5pct` (Cointelegraph). Their `search` checks say "outlet cited by the checker, page chosen at import".
   - **Imported as `unverified` (15 facts).** The checker's own pages are unreadable here, mostly The Block, CryptoSlate, Kraken, sec.gov and court sites, so the bank cites a different article on an allowed host. The checker never saw that article, so the import records no search check for it.
6. **Re-verified by direct fetch.** On 2026-11-24, `node scripts/facts/cli.ts verify --all` fetched every source from the allowed hosts (crypto.news, decrypt.co, cointelegraph.com, coinedition.com) and found every excerpt on its page. All 39 facts are now `direct-read`, and every source carries the `verify` check that proves it. Nobody marked a fact verified by hand.

## The 39 facts

| Fact | Holds verdict it comes from | Imported as | Sources (all read directly) |
| --- | --- | --- | --- |
| `pumpfun-launch-month` | Launch Jan 19, 2024 (month precision kept) | search-extract | coinedition.com, decrypt.co |
| `pumpswap-launch` | PumpSwap Mar 20, 2025; instant migration; 6 SOL fee removed | unverified | crypto.news, cointelegraph.com |
| `pumpswap-launch-fees` | 0.25% fee at launch (0.20% LP / 0.05% protocol) | unverified | crypto.news |
| `pumpfun-livestream-back-5pct` | Livestream reopened to 5% on Apr 4, 2025 | search-extract | cointelegraph.com |
| `pumpfun-livestream-all-users` | Reopened to all users Apr 11, 2025 | unverified | crypto.news |
| `pumpfun-coingecko-launch-day-deaths` | CoinGecko: 18.67M tokens, 68.67% died on launch day | search-extract | crypto.news |
| `pumpfun-coingecko-90-day-survivors` | CoinGecko: 850,180 (4.55%) lasted 90+ days | search-extract | crypto.news |
| `pumpfun-revenue-1b-milestone` | First Solana app past $1B revenue | unverified | coinedition.com |
| `pumpfun-revenue-2024-2025` | $321M (2024), $664M (2025) | unverified | coinedition.com |
| `pumpfun-pump-token-sale` | PUMP ICO Jul 12, 2025: $500M or $600M in about 12 minutes | search-extract | cointelegraph.com, decrypt.co |
| `pumpfun-callout-rewards-concentration` | Sparsity: 51,115 wallets, $29.6M, top 10 about 16%, median $13 | search-extract | crypto.news |
| `pumpfun-caller-followers-losses` | Sparsity: followers of 10 small-cap callers down about $926K | search-extract | crypto.news |
| `bubblemaps-side-wallets-business-model` | Bubblemaps, Nov 6, 2026: "Side wallets have become a business model" | search-extract | crypto.news |
| `bubblemaps-side-wallet-pattern` | Extraction pattern per Bubblemaps (generic, no case figures) | unverified | crypto.news |
| `bubblemaps-analysis-and-estimates` | Bubblemaps' own caveats | unverified | crypto.news |
| `ai16z-launch-no-a16z-link` | ai16z launched Oct 2024, not affiliated with a16z (month precision) | unverified | decrypt.co |
| `ai16z-peak-over-2-billion` | Peak market cap over $2B | unverified | cointelegraph.com, decrypt.co |
| `ai16z-renamed-elizaos` | Rebrand to ElizaOS after a16z asked; Dixon's confirmation | search-extract | cointelegraph.com, decrypt.co |
| `ai16z-elizaos-token-swap` | 1:6 migration to ELIZAOS | unverified | crypto.news |
| `ai16z-lawsuit-alleged-human-control` | The complaint alleges human or insider control | unverified | crypto.news |
| `elizaos-token-declared-dead` | Founder: "the token is dead"; foundation winding down; -19% | search-extract | cointelegraph.com, crypto.news, decrypt.co |
| `goat-150-million-oct-2024` | GOAT just under $150M on Oct 14 (Birdeye), row 31; the "endorsed, did not launch" clause from row 30 (see rule 1) | search-extract | cointelegraph.com |
| `freysa-prize-pool-47k` | Freysa Act I: about $47K, attempt 482, 195 players | search-extract | cointelegraph.com |
| `freysa-fee-mechanics` | Freysa fees: +0.78% per message, 70% to the pool | search-extract | cointelegraph.com |
| `aixbt-dashboard-breach` | aixbt: dashboard access, 55.5 ETH (about $100K), Mar 18, 2025 | search-extract | cointelegraph.com |
| `aixbt-ai-not-manipulated` | The dev said the AI itself was not manipulated | search-extract | cointelegraph.com |
| `aixbt-token-fell-after-hack` | Token fell about 15.5% | search-extract | cointelegraph.com |
| `elizaos-memory-injection-study` | Princeton/Sentient memory-injection paper | search-extract | decrypt.co |
| `grok-bankrbot-morse-transfer` | Grok/Bankrbot Morse relay, about 3B DRB, some funds returned | unverified | coinedition.com, cointelegraph.com |
| `lobstar-wilde-mistaken-transfer` | About 4 SOL meant, 52.4M LOBSTAR (about 5%) sent | search-extract | cointelegraph.com, crypto.news |
| `lobstar-wilde-thin-liquidity` | $441,788 on paper; about $40K realised | search-extract | cointelegraph.com |
| `scone-bench-simulated-exploits` | SCONE-bench: 405 contracts; 207 exploited, $550.1M simulated | search-extract | cointelegraph.com |
| `scone-bench-post-cutoff-4-6m` | Opus 4.5, Sonnet 4.5 and GPT-5: $4.6M simulated, post-cutoff | search-extract | cointelegraph.com |
| `numerai-series-c-500m-valuation` | Series C $30M at a $500M valuation (Nov 20, 2025) | search-extract | decrypt.co (press release) |
| `numerai-jpmorgan-capacity` | JPMorgan AM up to $500M of capacity (Aug 2025) | search-extract | decrypt.co, crypto.news |
| `numerai-aum-growth` | AUM about $60M to $550M | search-extract | decrypt.co |
| `alpha-arena-season-1-setup` | Season 1 from Oct 18, 2025 on Hyperliquid: $200 per bot at the start, later $10K per model | unverified | cointelegraph.com |
| `alpha-arena-season-1-result` | Qwen first, GPT-5 last (direction only, see below) | unverified | cointelegraph.com |
| `sec-ai-washing-first-cases` | SEC 2024-36: Delphia and Global Predictions, $400K total | unverified | decrypt.co |

Every fact also carries Spanish and Brazilian Portuguese statements, marked `translation: machine` and `reviewed: false`. They need a native speaker's review, like every translation in this studio.

## "Holds" claims not imported, or imported only in part

| Claim (verdict: holds) | What happened | Why |
| --- | --- | --- |
| Three Bubblemaps cases against named callers (Oct 14, Oct–Nov and Nov 9, 2026) | Not imported | Allegations about private individuals. Their exact figures are on the episode's Must-not-say list, and the source URLs carry the callers' handles. The generic pattern and the caveats are imported instead. |
| Complaint alleges insiders traded around the $ELIZA launch | Not imported | The checker: "Do not repeat this in the script". It is a crime-like accusation against identifiable people (Must not say). |
| Launch day January 19, 2024; operator Baton Corporation Ltd. | Month only | The checker's source was a The Block article whose URL it did not record, and theblock.co shows a bot challenge here. No readable page names the operator. |
| Livestream suspended Nov 25, 2024; moderators doubled | Not imported | The only readable page describes the self-harm incident. The research says to call it "dangerous stunts" and nothing more. |
| PUMP sale price of $0.004 per token | Not imported | Not on any readable page. |
| Burwick cites losses across at least 3,945 wallets | Not imported | No readable page carries it, and burwick.law cannot be reached. |
| "GAUNTLET THROWN" post, $96.6M ATH, nearly 50% drop, daos.fun crash claim | Not imported | Only The Block has it. Bot challenge. |
| ai16z down more than 80% within a week (Nov 2024) | Not imported | The Block and Coinlive only. |
| The Block, Jan 13, 2025: ai16z halved; sector $15B to $12.55B | Not imported | The Block only. |
| ai16z launch day Oct 24, 2024; daos.fun as the launchpad | Month only | No readable page gives the day. |
| Kraken migration snapshot (Nov 11, 2025, 11:40 UTC) | Not imported | support.kraken.com is not an allowed host. The 1:6 ratio is imported from crypto.news. |
| Numerai: 2024 net return 25.45%, Sharpe 2.75, about -17% in 2023 | Not imported | No readable page. These are also income-sensitive figures. |
| Alpha Arena per-model returns (Qwen +22.3%, GPT-5 -62%, "four of six lost") | Direction only | Cointelegraph's final tally (CoinGlass data) conflicts: Qwen +7.5%, ChatGPT -57%, every other model in the red. Both facts' notes record the conflict. |
| FINSABER paper (arXiv 2505.07078) | Not imported | arxiv.org is not an allowed host, and no readable page covers it. |
| SEC 2024-36 split ($225,000 and $175,000) | Total only | sec.gov cannot be reached. The Decrypt article gives the $400,000 total. The split is in the fact's notes. |
| Bubblemaps "no launchpad adopted" | Not imported | The checker itself did not verify it. |

## Found during re-verification

- **Headlines that cannot go on screen.** The episode's sources card shows "title · domain". Five sources have a headline that conflicts with the research's Must-not-say list: "Gaslit Into Losing Millions", "Real-World ... Exploits", "$100K a month" (an unverified allegation), "to Beggar", and "threats" (self-harm). Their facts carry a `cardTitle` that names the publisher, and `to-storyboard` puts that on the card instead. The real headline stays in `title`. Decrypt's aixbt article ("Token Falls 20%", also must-not-say) was not used. A later review found a sixth: Cointelegraph's Alpha Arena headline ("…Qwen3 Wins With 20x Bitcoin Long") is a multiplier claim under the studio's income lint, so both Alpha Arena facts carry the card title "Cointelegraph on Alpha Arena Season 1", and `validate` now runs that lint on every card title.
- **Dates differ by outlet.** Sparsity's report is dated Nov. 10 (crypto.news) or Nov. 15 (Coinotag), so the statement leaves the date out. Pump.fun's 5% livestream reopening is April 4 (Cointelegraph) or April 5 (crypto.news).
- **Now readable but not imported.** Decrypt (decrypt.co/295717) says ai16z's agent "has not yet bought anything with the DAO's treasury because it's still in the testing phase". The checker marked that claim *unsupported* because it could not see the page. It needs the owner's review before it becomes a fact.

## Hosts on 2026-11-24

| Host | Result |
| --- | --- |
| crypto.news, decrypt.co, cointelegraph.com, coinedition.com | HTTP 200; the article text is in the HTML. Every seeded source is on these hosts. |
| www.theblock.co | HTTP 403, Cloudflare bot challenge |
| www.coindesk.com | HTTP 429, Vercel security checkpoint |
| thedefiant.io | HTTP 403, Cloudflare block page |
| blockworks.co | 308 redirect to blockworks.com, which this environment does not allow |
| arxiv.org, www.sec.gov | Not allowed in this environment |
