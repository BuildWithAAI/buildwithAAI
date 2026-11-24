# Research: POV: You created an autonomous AI trading agent hedge fund

Compiled 2026-11-24. One research agent wrote it and an adversarial fact-checker reviewed it.

**Redaction.** This repo is public. Names of private or accused individuals (KOLs/callers, defendants, people in unadjudicated allegations) are replaced with `[named person]`, because what is said about them is an allegation (an analytics firm's estimate or a civil pleading), not a finding. Public figures and public records (e.g. SEC settlements) are kept as sourced. Source URLs are unchanged. **Scripts never name these people** (see Must not say).

**Verification limits.** The checker could not open most news, regulator and court sites from this session (theblock.co, crypto.news, sec.gov, cftc.gov and arxiv.org were blocked), so 'holds' often rests on several consistent search extracts rather than a direct page read. Everything marked `unsupported` must be re-checked in a browser before it airs.

## Fact-check verdicts

| Verdict | Claim | Checker's note |
|---|---|---|
| **unsupported** | VERIFICATION LIMITS (method note, not a story fact) | WebFetch could not open any page. www.sec.gov, www.theblock.co and arxiv.org each failed with getaddrinfo ENOTFOUND, meaning the host is outside this session's network allowlist, so per tool guidance I stopped trying other hosts. Every 'holds' verdict below rests on WebSearch result extracts attributed to the cited pages, not on full-page reads. The shared WebSearch budget of 200 calls per turn ran out midway, so 13 'confirmed' facts (Lopez-Lira onward, and most regulatory items) could not be checked at all and default to 'unsupported'. Before publishing, spot-check every number in a browser. Alternatively, the user can allow sec.gov, cftc.gov, theblock.co, decrypt.co, arxiv.org, nber.org, b |
| **holds** | ai16z launched on Solana launchpad daos.fun on October 24, 2024 as an AI-run venture-fund DAO, built by [named person] on the Eliza framework, and not affiliated with a16z. | The core holds. One explainer gives the Oct 24, 2024 launch date, and lawsuit summaries define the class period from the 'October 24, 2024 launch'. Rebrand coverage names [named person] as founder and quotes him calling the name a 'playful reference', with the goal of 'raising $75,000 to build an autonomous investor'. Several outlets state that ai16z was not affiliated with a16z. |
| **unsupported** | Persona named 'Marc AIndreessen' (@pmairca); stated goal 'beat [Andreessen at] what he is the best at'; first raise 420.69 SOL. | No extract I saw contained the 'Marc AIndreessen' spelling, the @pmairca handle, the 'beat him at what he is best at' quote or the 420.69 SOL figure. The Block only says the bot was 'modeled on Andreessen's writing'. [named person]' own stated target was about $75,000, which is roughly consistent with 420.69 SOL at late-2024 prices but is not a confirmation. Leave all three details out unless they are re-verified. |
| **holds** | Andreessen posted 'GAUNTLET THROWN' on Oct 27, 2024; ai16z hit an ATH market cap of $96.6M, then fell nearly 50% to about $50M; daos.fun said its site crashed. | The Block confirms the 'GAUNTLET THROWN' post with a screenshot of the bot's profile, the $96.6M ATH, the retreat of nearly 50% to about $50M on Sunday afternoon, and that the posts 'reportedly caused the Daos.fun site to crash, according to the platform's X account'. Attribute the crash to the platform. The 'Hey, I have that T-shirt' quote was NOT confirmed in any extract. A different outlet put the cap at about $25M at its time of writing. |
| **holds** | Within about a week ai16z lost more than 80% of its market cap (The Block, Nov 5, 2024; Coinlive about $130M to $23.8M). | Holds: The Block reports that leading daos.fun funds, including ai16z and Norm Capital, fell more than 80%, and the about $130M to $23.8M (about 82%) figure appears in coverage. Two caveats. (1) The $130M starting point is higher than the $96.6M ATH reported on Oct 27, so the token rose further before the drop; do not chain '$96.6M, then -80%' as if both came from the same peak. (2) The researcher's wording on the analyst is off. The extract attributes the surge to 'FOMO and the platform's invitation-only model', and another analyst said 'Daos.fun is misleading its users by showing unrealistic market-cap gains'. It does not say 'novelty of an AI Investment DAO'. |
| **holds** | ai16z peak market cap was over $2B (sources vary: $2.4B, $2.6B). | Holds only at headline level. KuCoin's headline reads 'AI16Z Token, Once Worth $2.4 Billion'; Cryptopolitan's reads '$2.6B fake AI hype' (that figure is from the lawsuit framing); The Block reported $1.5B in late December 2024. Use 'over $2 billion at its peak' and never give one exact figure. The CoinMarketCap ATH and The Defiant's 'passed $2B on Dec 31' were not checked. |
| **holds** | The Block (Jan 13, 2025): ai16z halved from $2.26 to $1.10 in a week (about $1.1B valuation); the AI-agent sector fell from over $15B to $12.55B. | Holds as stated. The add-on (ARC, ai16z and Virtuals down 75-90% by February 2025, per Decrypt and Cointelegraph) was not checked directly. Related reporting supports a steep further slide; BeInCrypto puts the sector at '$20 billion to $7 billion in 30 days' by mid-February. Use 'fell by most of its value' unless the 75-90% figure is re-verified. |
| **holds** | ai16z rebranded to ElizaOS (Jan 28-29, 2025) after a16z asked; Chris Dixon said the name caused confusion; ticker kept at first. | Holds. On the Unchained podcast Dixon said the name 'just was creating a little bit of confusion' and 'We were not connected with AI16z'. [named person] did not give the reason himself. The ticker was kept 'for now'. |
| **holds** | The ai16z token migrated to elizaOS at a 1:6 ratio (announced Sept 25, 2025; Kraken snapshot Nov 11, 2025 11:40 UTC; portal Nov 6, 2025 to Feb 4, 2026). | Kraken confirms 1 AI16Z : 6 ELIZAOS, the snapshot on Nov 11, 2025 at 11:40 UTC set by the elizaOS token foundation, and a distribution time of Dec 19 at 3:00 PM UTC. A Sept 25, 2025 article from The Block on the migration exists. The portal dates (Nov 6, 2025 to Feb 4, 2026) were NOT verified. Do not let the 1:6 holder ratio and the 1.1B to 11B total supply (10x) appear side by side as if their difference were proven insider theft; that difference is the lawsuit's allegation. |
| **unsupported** | Marketing said the AI made decisions, but reporting shows the AI had not traded the treasury early on (Decrypt, Dec 2024: over $10M AUM, AI had bought nothing yet). | Only partly supported. In Oct 2024 The Block described the plan in the future tense: the creator 'aims to have an AI facsimile of Andreessen trade based on recommendations from DAO members'. The lawsuit summary cites a Protos report of Oct 30, 2024 that humans were operating the agent and it was not autonomous as advertised. That is an outlet's claim repeated in a complaint, not a finding. The Decrypt 'over $10M AUM, AI had not bought anything' detail did NOT appear in any extract. Do not state it until it is re-verified. |
| **wrong** | Class action 'Doe v. [named person]' (S.D.N.Y. 1:26-cv-03238), filed April 2026 by Burwick Law. Defendants: [named person], Eliza Labs, [named person], ai16z DAO, DAOs.fun, [named person], '[named person]', '[named person]'. Claims: NY GBL 349/350, negligent misrepresentation, unjust enrichment. | The case number and court hold, but several details are wrong. (1) The PacerMonitor docket is captioned '[named person] v. [named person] et al.', with a docket entry dated April 21, 2026. Other reports give April 16, 20 or 22. Say 'April 2026' and do not use the 'Doe' caption. (2) The docket lists these defendants: AI16Z DAO, Eliza Labs, Inc., [named person], [named person] and Does 1-50. No source I could check names DAOs.fun, [named person], '[named person]' or '[named person]' as defendants. Never state that they were sued. (3) There are six claims, which also include California UCL and FAL claims. (4) The named plaintiff is a private individual; never name them. |
| **holds** | The complaint alleges ai16z was marketed as an autonomous AI-managed fund while insiders/humans actually controlled it. | Holds as an ALLEGATION. The Block describes the complaint as alleging that ai16z was marketed as 'the governance token for an autonomous AI-managed venture fund modeled on Andreessen Horowitz when the project was actually controlled by insiders'. Always say 'a lawsuit alleged' and add that the case ended in a settlement with no ruling on the merits. |
| **holds** | The complaint alleges insiders traded around the $ELIZA token launch on Nov 19, 2024. | Holds as an allegation, sourced only from a secondary summary of the complaint. It alleges [named person] publicly said there would be no new coin while privately working on an Eliza-branded token launched Nov 19, 2024, and that a wallet 'linked to a managing partner' sold before the announcement; the complaint calls this insider trading. Do not repeat this in the script. It is an unadjudicated accusation of a crime-like act against identifiable people. |
| **overstated** | The complaint alleges the migration expanded supply from 1.1B to 11B tokens, with about 4.4B going to defendant-controlled entities. | Holds for 1.1B to 11B (alleged). The '4.4B' figure appears in no source I found. Reports say about 40% of the new supply allegedly went to 'insiders, including undisclosed private investors and team members'; 4.4B is the researcher's own arithmetic, and 'defendant-controlled' is not the reported wording. If used at all, say 'the lawsuit alleged a large share of new tokens went to insiders'. |
| **holds** | Burwick cites losses across at least 3,945 wallets. | Reported as 'on-chain data cited in the filing suggests losses across at least 3,945 customer wallets'. This is the plaintiffs' framing, not verified independently. |
| **wrong** | No court-filed settlement or Burwick confirmation had appeared as of the August 2026 reporting. | A PacerMonitor-derived summary says the docket shows a motion to dismiss by Eliza Labs and [named person], a June 5, 2026 telephone conference, and a 'stipulation and order of dismissal of Plaintiff's claims with prejudice' after a settlement. Terms were not disclosed. I found no court-approved class settlement and no ruling on the merits. Safe wording: 'the case was settled and dismissed without any court finding of wrongdoing; terms were not disclosed.' |
| **holds** | In August 2026 [named person] wrote 'The token is dead. Completely. The foundation is winding down.' He said they settled by giving claimants what was left because they could not afford to fight, ruled out buybacks and a replacement token, and the ElizaOS software continues. ELIZAOS fell 19% to an all-time low. | Holds. The X post was dated Aug 4, 2026 and reported Aug 5-6. Other quotes: 'Burwick sued us and we settled with a group of holders for the rest of the treasury and all the money we had', and 'the claim was ridiculous but the project didn't have the capital to legally fight it so we settled'. For fairness, include that he denied personally profiting and said he earned a modest salary. Cointelegraph (Aug 6, 2026) reports a 19% fall to a record low of $0.000284 and a $2.1M market cap; one syndicated piece says about 20%. ELIZAOS was already down more than 97% from its peak. |
| **overstated** | Truth Terminal: Andreessen sent a $50K BTC grant (July 2024) and says he owns no GOAT; the bot promoted but did not create GOAT; Ayrey filters posts; TechCrunch (Dec 19, 2024) put the wallet at about $37.5M with release needing sign-off from Ayrey and a council. | Most of this holds. The $50K BTC grant was made in July 2024. In an Oct 15, 2024 post Andreessen called it a research grant, said he had no economic stake, played no role in creating GOAT and does not own any. Ayrey said someone else launched GOAT on pump.fun on Oct 10, 2024 and tagged the bot, which endorsed it. Ayrey admitted filtering posts in July 2024. The TechCrunch article exists, and an extract says release of funds needs sign-off from a group that includes Ayrey. NOT confirmed: the $37.5M wallet figure (another source says about $40M) and the 'no unsupervised posting yet' quote. Ayrey also said he bought some GOAT and received airdrops. Do not say the AI 'became a millionaire on its |
| **holds** | GOAT's October 2024 peak cap varies: just under $150M (Oct 14, Birdeye via Cointelegraph), above $300M (The Defiant), FDV above $430M (The Block), $850M (crypto.news). | Partly checked. The $150M figure (Birdeye, Oct 14) and The Defiant's 'above $300M' headline are confirmed. A Blockworks timeline says $450M. The Block's $430M FDV and crypto.news's $850M were not checked. Safe wording: 'hundreds of millions of dollars within days'. |
| **unsupported** | daos.fun launched Sept 26, 2024 in beta; only approved creators could raise; creators then controlled the fund's capital. | The Sept 26, 2024 beta launch and the 'invitation-only model' are confirmed in an extract from The Block. The claim that creators controlled and traded the capital after a raise was NOT confirmed by any primary or reputable source. Do not state it as fact about daos.fun. The fictional launchpad can work that way. |
| **holds** | Freysa Act I: [named person] won 13.19 ETH (about $47K) on Nov 29, 2024, on attempt 482 by 195 players. Fees started at $10, rose 0.78% per message, capped at $4,500, on Base. The trick: convincing the agent that approveTransfer handled incoming funds, with a $100 'contribution'. | Holds. The Block reports 195 players and 482 attempts; Cryptopolitan says '481 failed attempts', which is consistent. The pool was $47,316.05 per The Block and $47,148 released per Alea Research. The script should paraphrase the trick, not quote it verbatim (see policy risks). [named person] won legitimately within the game rules. |
| **overstated** | Freysa Act II paid $12,920.08 and Act III paid $20,843.04 (The Block, Dec 13, 2024). Act III asked players to get Freysa to say 'I love you', with 80% of fees to the pool and a $200 cap. | The rounded amounts hold, but through Alea Research ($12,920 and $20,843) and Plisio ($20,843), not The Block, in what I could see. The cents were not confirmed. The Block extract confirms Act III's 80% fee share and $200 cap. TechCrunch (Dec 6, 2024) covered the 'make it fall in love' challenge. Use '$13K' and '$21K'. |
| **holds** | aixbt hack, Mar 18, 2025: an attacker with dashboard access queued two malicious replies and the agent sent 55.5 ETH (about $100K) from its Simulacrum wallet. The dev said the AI itself was not manipulated. Keys and servers were migrated and the dashboard paused. Token fell 15.5-20%. Attacker '[named person]'. | Holds. The time is about 2:00 AM UTC per the maintainer, 1:58 AM per Cointelegraph. Some outlets say 55 ETH. The token drop is confirmed at about 15.5% (Cointelegraph, CoinGecko); the 20% upper bound and '$106K' were not confirmed. The attacker's handle differs by outlet ('[named person]' per Decrypt, '[named person]' per Cointelegraph); do not name it. |
| **holds** | Princeton and Sentient Foundation paper (arXiv 2503.16248, March 2025) shows memory injection can make ElizaOS agents make unauthorized transfers and that prompt-based defenses are insufficient; it releases the CrAIBench benchmark. | Holds. It was first submitted Mar 20, 2025 (v3 Jul 9, 2025). CrAIBench has 150+ tasks and 500+ attack cases. The Princeton blog says simple prompt injections were mostly stopped by basic defenses, but memory injection persisted, and even the strongest models followed poisoned memories more than half the time. The 'external database shared by plugins' detail was not confirmed. This was a lab demonstration; do not say real funds were lost. |
| **holds** | Around May 4, 2026, a user had Grok translate Morse code and relay it to Bankrbot, which sent 3B DRB (about $150K-$200K) from Grok's wallet on Base after a Bankr Club NFT widened permissions; some funds were returned. | Holds with care. The OECD AI incident record gives the $150K-$200K value. The NFT step is reported as an allegation (AIID); that about 80% was returned comes from a single source (KuCoin/0xMedia), so say 'some funds were reportedly returned'. The original posts were deleted. Do not show the Morse payload or its decoded text. |
| **holds** | Lobstar Wilde (Feb 22-23, 2026) meant to send about 4 SOL (about $310) and instead sent about 52.4M LOBSTAR (about 5% of supply), valued at about $250K or $441,780. The recipient realized only about $40K; the cause is disputed. | Holds with corrections. The request was 4 SOL for 'tetanus treatment'. Cointelegraph's figure is $441,788, not $441,780. The recipient sold part for about $40K; Coin360 says about $50K within roughly 15 minutes. The cause is disputed (decimal error vs API misreading). LOBSTAR then rose about 190%, and The Block put 'accidentally' in quotes. Do not suggest it was staged, and do not name the developer (a private individual). |
| **overstated** | Koi Security audited 2,857 ClawHub skills and found 341 malicious, 335 from 'ClawHavoc'. More than 100 posed as crypto tools (Solana/Phantom) and stole exchange API keys and wallet keys; Bitdefender said more than half were crypto-related. | The 2,857, 341 and 335 figures hold (The Hacker News, February 2026). The 335 ClawHavoc skills used fake prerequisites to install the macOS Atomic Stealer (AMOS), which harvests keychain passwords, browser data, crypto wallets and SSH keys. Later scans found 824 malicious out of more than 10,700. NOT confirmed: '>100 posing as Solana/Phantom tools', 'exchange API keys' and Bitdefender's 'more than half crypto-related'. Accurate wording: 'hundreds of fake plugins installed password- and wallet-stealing malware'. |
| **holds** | Anthropic SCONE-bench (Dec 1, 2025): 405 real exploited contracts. On post-cutoff contracts, Opus 4.5, Sonnet 4.5 and GPT-5 together exploited 19 (55.8%), worth up to $4.6M simulated; overall $550.1M simulated across 207 contracts. | Holds. The 55.88% is 19 of the 34 contracts exploited after March 2025. The Block's '17 of 34 / $4.5M' refers to Opus 4.5 alone. The $550M figure covers 10 models across the full 2020-2025 benchmark. Everything was simulated: Anthropic says it 'never tested exploits on live blockchains'. Never imply real money was stolen. |
| **holds** | Numerai: 2024 net return 25.45%, Sharpe 2.75, one down month; about -17% in 2023; JPMorgan AM up to $500M capacity (Aug 2025); AUM $60M to $450M, then about $550M (Nov 2025); Series C $30M at $500M valuation (Nov 20, 2025); +49% since 2019 inception as of Feb 2023 (Bloomberg). | Holds as company-reported figures. The Sharpe is net of fees with a 0% risk-free rate. The -17% for 2023 comes from Benzinga. The JPMorgan commitment is 'capacity to be deployed over the next year', not an immediate $500M transfer; JPMorgan declined to comment. The Series C coverage on Decrypt is a Chainwire press release. NOT checked: the Bloomberg '49% since inception' figure. Label all returns 'company-reported, unaudited'. |
| **holds** | Alpha Arena Season 1 (Oct 18 to Nov 3, 2025): six LLMs each traded $10K of crypto perps on Hyperliquid with no human intervention; four lost. Qwen about +22.3%, DeepSeek about $10,489, Claude about $5,799, Gemini about $5,445, Grok about $4,208, GPT-5 about -62%. | Holds. SCMP gives Qwen3-Max +22.32%; iWeaver gives GPT-5 -62.66%. Start and end dates are given as Oct 17/18 and Nov 3/4. GPT-5's loss was over the whole season, not one trade, so do not stage it as 'one leveraged position wiped out 60%' if presented as Alpha Arena. It is a 2-week, $60K test and proves nothing about skill. |
| **holds** | FINSABER (arXiv 2505.07078, Li, Kim, Cucuringu, Ma; KDD 2026): over about 20 years and a broader universe, LLM strategies are too conservative in bull markets and too aggressive in bear markets; earlier results were overstated by survivorship and data-snooping biases. | Holds. v1 is dated May 11, 2025; it covers 2004-2024 and was accepted to KDD 2026. The bull/bear finding is confirmed. The specific 'survivorship and data-snooping' wording was not seen in the extract; say 'earlier tests were too short and too narrow'. |
| **overstated** | StockBench (arXiv 2510.02209, Oct 2025): most LLM agents failed to beat buy-and-hold on DJIA stocks over a four-month window; costs and slippage were not modeled. | The main result holds: most agents did not beat buy-and-hold, though some showed potential. It was submitted Oct 2, 2025 (v2 March 2026). The DJIA universe, the four-month window and 'costs not modeled' were NOT confirmed before the search budget ran out. Say 'over a multi-month test'. |
| **unsupported** | Lopez-Lira & Tang (arXiv 2304.07619): GPT-4 headline scores predict next-day returns; a long-short strategy earns about 38 bps/day before costs. | Not checked: the search budget was exhausted and arxiv.org is blocked. The 38 bps/day figure must be re-verified before use; omit it otherwise. |
| **unsupported** | Look-ahead and memorization bias (Glasserman & Lin arXiv 2309.17322; Gao, Jiang & Yan arXiv 2512.23847). | Not checked (budget exhausted). The general idea that LLMs may have 'seen the future' in training data is widely discussed. Re-verify before citing either paper by name. |
| **unsupported** | Eurekahedge AI hedge fund index: 9.8% annualized vs 13.7% for the S&P 500, Dec 2009 to Jul 2024; about 30 constituents. | Not checked. The IG article cites figures from Eurekahedge secondhand, and the index is small, so re-verify or drop it. |
| **unsupported** | AIEQ ETF led the S&P 500 early, then lagged (Bloomberg 2018, 2023; Wealth Management). | Not checked; the Bloomberg pages are paywalled. Re-verify, and if used, date every comparison. |
| **holds** | SEC Release 2024-36 (Mar 18, 2024): Delphia paid $225,000 and Global Predictions $175,000 ($400K total), neither admitting nor denying; GP called itself 'first regulated AI financial advisor'; Gensler said they marketed AI they were not using. | Holds. Gensler's actual wording: 'We find that Delphia and Global Predictions marketed to their clients and prospective clients that they were using AI in certain ways when, in fact, they were not.' The charges were Advisers Act and Marketing Rule violations. Call them 'settled charges' or 'fined', never 'fraud convictions'. |
| **unsupported** | Presto Automation settled SEC AI-washing action (Jan 14, 2025); SEC/DOJ charged Nate founder [named person] (Apr 9, 2025) over $42M raised on false AI-automation claims. | Not checked in this session; it is consistent with the checker's background knowledge. Re-verify before use. [named person] is CHARGED only, so always say 'charged with' and 'alleged', never 'convicted'. |
| **unsupported** | SEC sued over an alleged $14M scam using WhatsApp 'AI investment clubs' (Dec 22, 2025; Morocoin, Berge, Cirkor). | Not checked (budget exhausted; sec.gov blocked). Re-verify the release number, date and amounts. These are allegations; refer to 'an SEC lawsuit alleges'. |
| **unsupported** | SEC created the Cyber and Emerging Technologies Unit (Feb 20, 2025; about 30 specialists; led by Laura D'Allaird). | Not checked in this session; it is consistent with the checker's background knowledge. Re-verify before use. |
| **unsupported** | CFTC advisory 'AI Won't Turn Trading Bots into Money Machines' (Jan 25, 2024): AI 'can't predict the future or sudden market changes'. | Not checked in this session (cftc.gov not attempted after other hosts failed); it is consistent with the checker's background knowledge. Re-verify the exact quote before putting it on screen. |
| **unsupported** | SEC/NASAA/FINRA joint investor alert 'Artificial Intelligence (AI) and Investment Fraud' (Jan 25, 2024), including example pitches like 'can't lose'. | Not checked in this session; it is consistent with background knowledge. Re-verify the exact example-pitch wording before quoting. |
| **unsupported** | CFTC Mirror Trading International: Apr 24, 2023 default judgment against [named person], $1,733,838,372 restitution plus an equal penalty; at least 29,421 BTC. | Not checked in this session; it is consistent with background knowledge. Note this is a CIVIL default judgment; do not say 'convicted'. |
| **unsupported** | US hedge-fund basics: 3(c)(1)/3(c)(7) exemptions, the $25M qualified-purchaser threshold, accredited investors, $100M/$110M/$150M adviser thresholds. | Not checked in this session. A likely error regardless: qualified-purchaser status for a natural person is generally $5M in investments; $25M applies to certain entities investing on a discretionary basis (Investment Company Act section 2(a)(51)), per the checker's background knowledge. Do not present these thresholds as how-to or legal advice; keep them generic ('managing other people's money usually requires registration or a specific exemption'). |
| **unsupported** | CPO basics: 7 USC 1a(11); NFA registration; 4.13(a)(2) small-pool exemption (15 participants, $400K); Aug 18, 2026 CFTC proposal to raise it to $800K. | Not checked. The Aug 18, 2026 proposal especially needs re-verification. Keep script language generic. |
| **unsupported** | SEC withdrew its 2023 predictive-data-analytics conflicts proposal on Jun 12, 2025 (one of 14). | Not checked in this session; it is consistent with background knowledge. Re-verify before use. |
| **unsupported** | Other 'with_care' items not checked: Virtuals revenue collapse ($976,748 to $13,643/day); aixbt as an analysis bot with a $200M peak; VaderAI +42%; Giza ARMA (14,000 agents, $600K, 15% APR); Alpha Arena Season 1.5 (Grok 4.20, +12.11%, 6 of 32 accounts positive); NBER w35273 (AI hedge-fund edge faded). | None of these were checked (budget exhausted). Do not use any of their numbers until re-verified. Especially avoid putting VaderAI's '+42%' or Giza's '15% APR' on screen; they read as income claims. |

## Must not say (binding for the script)

- Do not say ai16z, Eliza Labs or [named person] scammed, defrauded, rug-pulled or 'faked the AI'; that a court found anything; or that anyone admitted wrongdoing.
- Do not call the case 'Doe v. [named person]' (the docket caption is '[named person] v. [named person] et al.'), and do not name the plaintiff. Use 'a class action filed in April 2026'.
- Do not say DAOs.fun, [named person], '[named person]' or '[named person]' were sued.
- Do not say '4.4 billion tokens went to insiders' or 'defendant-controlled entities'. If needed, say 'the lawsuit alleged a large share of new tokens went to insiders'.
- Do not say there was 'no court record of the settlement'; the docket reportedly shows a stipulated dismissal after settlement. Say 'settled and dismissed, terms undisclosed, no ruling on the merits'.
- Do not mention or depict [named person]'s or [named person]' alleged token sales, the $6.6M figure or the '$25M' figure.
- Do not repeat the complaint's '$ELIZA insider trading' or 'managing partner wallet sold' allegations.
- Do not say Marc Andreessen or a16z backed, invested in, promoted or profited from ai16z; that Andreessen owns GOAT; or that he 'gave an AI $50K to launch a memecoin'.
- Do not say Truth Terminal created GOAT or 'became a millionaire on its own'; a human filtered its posts.
- Do not give Truth Terminal's wallet as '$37.5 million' (unverified).
- Do not state as fact that 'the AI ran the fund' or that 'AI Marc has the final word'.
- Do not say Decrypt reported '$10M AUM and the AI had bought nothing' until re-verified.
- Do not give one exact ai16z peak ($2.39B, $2.4B, $2.6B). Use 'over $2 billion'.
- Do not treat token market cap as fund assets or AUM (unless contrasting them).
- Do not say the 80% weekly drop came from the $96.6M peak. The Block's 80% figure starts from a later, higher level (about $130M per Coinlive).
- Do not quote 'Hey, I have that T-shirt', the 420.69 SOL raise, 'Marc AIndreessen'/@pmairca, or 'beat him at what he is best at' (all unverified).
- Do not state the daos.fun crash as fact; it is daos.fun's own claim.
- Do not say daos.fun creators controlled and traded raised funds as a fact about the real platform.
- Do not quote the exact Freysa winning prompt, function names or the Morse-code payload or its decoded text.
- Do not quote Freysa prizes to the cent or attribute the Act II and III amounts to The Block. Use about $13K and $21K.
- Do not name '[named person]', '[named person]', the Lobstar Wilde developer, [named person] or any private individual.
- Do not say the aixbt token fell 20% or that the theft was $106K. Use about 15% and about $100K.
- Do not say ElizaOS users 'lost millions' to memory injection; it was a research demonstration.
- Do not say Anthropic's or any AI models 'stole $4.6M' or '$550M'; all figures are simulated.
- Do not say '>100 Solana/Phantom tools stole exchange API keys' or 'Bitdefender: more than half crypto-related' (unverified). Say 'hundreds of fake plugins installed password- and wallet-stealing malware'.
- Do not suggest Lobstar Wilde was a publicity stunt or that the recipient scammed it.
- Do not say Numerai 'returns 25% a year', or that 'JPMorgan gave Numerai $500M'. It was a capacity commitment to be deployed over a year; returns are company-reported.
- Do not say any AI 'beats the market', 'can't lose' or gives 'guaranteed returns'. Use such lines only when quoting regulators' examples of scam pitches.
- Do not say 'one leveraged trade wiped out 60%' when presented as Alpha Arena; GPT-5's about -62% was over the whole season.
- Do not use VaderAI's '+42%', Giza's '15% APR', Virtuals revenue figures, the Alpha Arena 1.5 numbers or the NBER figures until re-verified.
- Do not quote the 38 bps/day Lopez-Lira figure, the Eurekahedge 9.8% vs 13.7%, or AIEQ comparisons until re-verified.
- Do not call [named person] convicted or a fraudster (he is charged only), or call [named person] 'convicted' (civil default judgment). Do not say Delphia or Global Predictions 'committed fraud' (they settled, neither admitting nor denying).
- Do not suggest the SEC or CFTC investigated or charged ai16z or Eliza Labs.
- Do not state exact registration thresholds as advice, and do not say a fund needs '$25M qualified purchasers'; that figure is likely misstated for individuals.
- Do not say a hedge fund can 'legally avoid registration with under 100 investors' or give similar how-to framing.
- Do not use real-person likenesses, voice clones or fake screenshots of real posts (Andreessen, [named person], Ayrey, Dixon).

## Defamation risks

- [named person]: the only established facts are civil ALLEGATIONS in an April 2026 SDNY class action, and the case ended by settlement and stipulated dismissal with no ruling on the merits and no reported admission. He publicly called the claim 'ridiculous', said he settled because he could not afford to fight, and denied personally profiting. Calling him (or ai16z or Eliza Labs) a scammer or fraudster, or saying he 'faked the AI', ran a 'rug pull', did 'insider trading' or 'dumped on holders', goes beyond the sources.
- Composite-character bleed: the planned 'you' arc mirrors ai16z almost beat for beat (cheeky famous-VC persona, memefund launchpad, celebrity reply, secret human 'approve' clicks, lawsuit saying humans decided, settlement, 'the token is dead'). If the fictional 'you' secretly runs trades by hand while marketing autonomy, viewers will read it as a factual account of [named person] and conclude the lawsuit's allegations were true. Fix: make the fictional project clearly different (different chain, name and persona, not a riff on a16z). Do not put [named person]' real quote 'the token is dead' in the fictional character's mouth. Keep real-world asides attributed ('a lawsuit alleged...; it settled without any court finding; the founder disputed it'), and add an on-screen disclaimer that the protagonist is a fictional composite.
- Unconfirmed defendants: no source I could check shows DAOs.fun, [named person], '[named person]' or '[named person]' as defendants; the docket lists [named person], Eliza Labs, [named person], the AI16Z DAO and Does 1-50. Saying the others were sued could be false and defamatory.
- The [named person] vs [named person] feud (alleged $6.6M insider selling from the daos.fun wallet) and the contradictory [named person] token-sale reports ($40K vs '$25M') are unverified accusations. Republishing them carries the same risk as making them. Leave them out entirely.
- The complaint's '$ELIZA insider trading' and 'wallet linked to a managing partner sold before the announcement' allegations name or point to identifiable people over crime-like conduct, and are unadjudicated. Do not repeat them.
- [named person] (named defendant, low public profile) and the named plaintiff (a private individual on the docket) must not be named.
- Marc Andreessen, a16z and Chris Dixon: no wrongdoing alleged. Do not imply Andreessen promoted, invested in, profited from or 'pumped' ai16z or GOAT. His 'GAUNTLET THROWN' post was a joke reaction; he said his Truth Terminal grant was a no-strings research grant and that he owns no GOAT. Do not use his likeness or voice; a parody 'famous VC' should not resemble him.
- Andy Ayrey: do not imply he launched GOAT or profited improperly. He says an anonymous user launched it. His X account was once hacked to promote a scam memecoin, so never suggest he promoted a scam.
- Lobstar Wilde developer (reported as an OpenAI employee, a private individual): do not name him, and do not suggest the transfer was staged for publicity or that the recipient scammed the bot.
- aixbt attacker: handles differ by outlet ('[named person]' vs '[named person]') and no one has been charged. Do not name any account. The aixbt team ([named person]) were victims.
- [named person] won Freysa within the game's published rules. Never call them a hacker, thief or scammer.
- [named person] (Nate) is CHARGED only, and his plea was not verified. Always say 'charged with' or 'alleged'. Cornelius [named person]'s US case is a CIVIL default judgment, so do not say 'convicted'. Delphia and Global Predictions settled without admitting or denying; say 'settled SEC charges of making false and misleading statements', not 'committed fraud'. Presto settled without a penalty.
- Respondents in the SEC $14M WhatsApp 'AI club' case (Morocoin, Berge, Cirkor, AI Wealth and others) face allegations only, and this session did not verify them. Name them only after re-verification, with 'the SEC alleges'.
- Grok/xAI and Bankr: do not imply either company stole funds; the reports describe a user exploiting the bot relay. The NFT-permission step is itself only alleged.
- ElizaOS / Eliza Labs software: the Princeton memory-injection paper used ElizaOS as a test case in a lab demonstration. Do not say ElizaOS agents 'lost millions' or that the software is a scam. It remains an active open-source project.
- No regulator (SEC or CFTC) action against ai16z or Eliza Labs was found. The fictional 'regulator letter' scene must not suggest the real project received one.

## YouTube policy risks

- YouTube Spam, deceptive practices and scams: crypto videos attract scam comments and impersonation. Do not show or speak any real wallet address, token contract address, referral link, QR code or 'join our Telegram/WhatsApp' line. Do not mention a channel token. Pin a comment saying the channel will never DM viewers or offer investments, and moderate replies.
- Financial or income claims: on-screen returns (Numerai +25.45%, Qwen +22%, any '+42% since launch', '15% APR') can read as a promise of profit. Always label them company-reported, unaudited, short-window or simulated, and pair each with the losses (Numerai -17% in 2023; four of six Alpha Arena models lost; most StockBench agents lagged buy-and-hold). Add a spoken and on-screen 'not financial advice, fictional story' disclaimer. Never imply viewers can earn money by building or buying an AI agent.
- Do not promote live tokens. ELIZAOS/ai16z, GOAT, AIXBT, VIRTUAL, NMR, DRB and LOBSTAR are or were tradable. Do not show price tickers with 'up' framing, 'next 100x' language, or anything that reads as a buy signal.
- Harmful or dangerous content (hacking or theft instructions): describe prompt injection, memory injection, dashboard compromise, malicious plugins and contract exploits only at a conceptual level. Do not show the exact Freysa winning message or function-call trick, the Morse payload or its decoded command, how to queue dashboard prompts, how to build a key-stealing plugin, or exploit code from SCONE-bench. Stick to framing like 'it was convinced its payout button was a deposit button'.
- Legal how-to risk: the hedge-fund/CPO segment must not read as a guide to running a pooled fund under the registration thresholds. Keep it general ('pooling other people's money usually requires registration or a specific exemption; talk to a securities lawyer'), with no exact thresholds presented as advice. Several thresholds were not verified, and the $25M qualified-purchaser figure is probably misstated.
- Misleading metadata: titles or thumbnails like 'My AI made $1M' or 'This AI fund 100x'd', or real people's faces (Andreessen, [named person]) with 'SCAM' text, are misleading and defamatory. The title should signal fiction ('POV') and the description should state it is a fictional composite based on public reporting.
- Altered or synthetic content: do not clone real people's voices or create realistic fake screenshots of real people's X posts. Show any real post in clearly stylized form, attributed and with the date. If AI voices are used for fictional characters, follow YouTube's disclosure rules where content could be mistaken for real people or events.
- Impersonation: do not use a16z, Andreessen, ElizaOS, daos.fun, Grok/xAI, Kraken or Anthropic logos or UI in a way that could look like official content. Use invented brands for the fictional fund and launchpad.
- Scam-education framing works in the story's favor. End on regulator-sourced red flags (guaranteed returns, unregistered managers, AI-hype 'clubs') and direct viewers to the official SEC IAPD and NFA BASIC lookup tools, without links to any third-party platform. Re-verify these regulator facts first, since this session could not open them.

## Researcher's facts (before the fact-check; verdicts above take precedence)

### [confirmed · safe] ai16z launched on the Solana launchpad daos.fun as an 'AI-led venture fund' DAO. Its AI persona was jokingly named 'Marc AIndreessen' (X handle @pmairca). It was built by the pseudonymous developer '[named person]' ([named person]) on his open-source Eliza agent framework.

Launch date: October 24, 2024. A community recap gives '10-24-24', and the Burwick class-action class period also starts October 24, 2024. Stated goal: 'beat [Andreessen at] what he is the best at.' The project said it was not affiliated with a16z. The first raise is reported as 420.69 SOL (single source).

Sources: https://hackmd.io/@XR/ai16z_week1 · https://www.blockworks.com/news/stanford-lab-ai16z-partnership · https://www.burwick.law/active-cases/ai16z-elizaos-token-lawsuit-doe-v-walters · https://elizaos.github.io/eliza/docs/faq

### [unverified · with_care] daos.fun was a Solana launchpad where only approved creators could raise SOL into on-chain 'memefunds'. Each fund had a raise target, an expiry date and fees. Secondary sources say that after a raise closed, the creator controlled the fund's capital and could trade it as they chose.

daos.fun launched September 26, 2024, in beta (The Block). The creator-control point comes only from explainer and promotional sources. I found no primary daos.fun document confirming it.

Sources: https://www.theblock.co/news/markets/2024-11-05-top-daos-fun-memefunds-see-market-caps-tank-with-ai16z-dropping-80-in-the-past-seven-days-323721 · https://solanacompass.com/projects/daosfun · https://www.dextools.io/tutorials/what-is-daos-fun-solana-dao-fund-launchpad-guide-2026 · https://www.rzlt.io/blog/daos-fun

### [confirmed · safe] Marc Andreessen (a16z) publicly reacted to ai16z, and the token spiked.

On October 27, 2024, Andreessen posted 'GAUNTLET THROWN' with a screenshot of the bot's profile, then 'Hey, I have that T-shirt.' ai16z reached an all-time-high market cap of $96.6M, then fell nearly 50% to about $50M (The Block, October 27, 2024). daos.fun's own X account said the site crashed; this is the platform's claim only.

Sources: https://www.theblock.co/post/323192/marc-andreesen-shoutouts-help-ai-powered-vc-fund-ai16z-to-nearly-100-million-market-cap · https://forklog.com/en/ai-bot-token-ai16z-reaches-market-cap-of-100-million/amp

### [confirmed · safe] Within about a week of the spike, ai16z lost more than 80% of its market cap.

The Block (November 5, 2024) reported that leading daos.fun funds, including ai16z and Norm Capital, fell more than 80% in seven days. Coinlive gives about $130M to about $23.8M, a drop of roughly 82%. An analyst quoted by The Block blamed the initial surge on FOMO and the novelty of an 'AI Investment DAO'.

Sources: https://www.theblock.co/news/markets/2024-11-05-top-daos-fun-memefunds-see-market-caps-tank-with-ai16z-dropping-80-in-the-past-seven-days-323721 · https://coinlive.com/news-flash/661423

### [conflicting · with_care] ai16z's peak market cap was above $2B, but sources disagree on the exact figure.

Milestones: about $1.01B rising to $1.5B on December 28, 2024 (The Block). It passed $2B on December 31, 2024 (The Defiant). The price all-time high was about $2.47–$2.48 on January 2, 2025 (CoinMarketCap). Reported peak caps: $2.39B/'$2.4B' (KuCoin flash), '$2.6B' (Cryptopolitan, describing the lawsuit). Safe script wording: 'over $2 billion at its peak'.

Sources: https://www.theblock.co/news/markets/2024-12-29-blockchain-powered-ai-agent-ai16z-reaches-1-5-billion-market-cap-332546 · https://thedefiant.io/news/markets/ai-memecoin-ai16z-surpasses-2-billion-market-cap-on-solana-blockchain-following-d6811294 · https://coinmarketcap.com/currencies/ai16z · https://www.kucoin.com/news/flash/ai16z-token-once-worth-2-4-billion-declared-dead-by-founder · https://www.cryptopolitan.com/ai16z-elizaos-creators-sued-fake-ai-hype/

### [confirmed · safe] The AI-agent token bubble deflated fast in early 2025.

The Block (January 13, 2025): the ai16z price halved from $2.26 to $1.10 in seven days, to a valuation of $1.1B. The AI-agent token sector fell from over $15B to $12.55B. By February 2025, ARC, ai16z and Virtuals had lost about 75–90% of their market cap since January (CoinGecko data via Decrypt and Cointelegraph).

Sources: https://www.theblock.co/post/334213/ai-agent-tokens-reel-from-a-steep-market-correction · https://decrypt.co/309495/virtuals-protocol-revenue-crashes-ai-agent-demand-sinks · https://cointelegraph.com/markets/ai-agents-virtual-revenue-plunge-token-price-decline

### [confirmed · safe] ai16z rebranded to ElizaOS after a16z asked it to change the name.

The rebrand was announced January 28, 2025 (reported January 29). a16z's Chris Dixon said on a podcast that the firm asked for the change because the name caused confusion. a16z has no ties to ai16z. The $ai16z ticker stayed the same at first.

Sources: https://www.theblock.co/news/business/2025-01-29-ai-agent-platform-ai16z-officially-rebrands-to-elizaos-337614 · https://decrypt.co/303244/ai-dao-ai16z-becomes-elizaos-amid-branding-confusion-concerns · https://forklog.com/en/ai-project-ai16z-rebrands-as-elizaos/ · https://cointelegraph.com/news/elizaos-rebrand-ai16z-token-drop

### [confirmed · with_care] The ai16z token was later migrated to a new elizaOS token at a 1:6 ratio.

Announced September 25, 2025 (The Block). The migration portal opened November 6, 2025 and stayed open 90 days, to February 4, 2026 (ElizaOS newsletter). Kraken took its snapshot November 11, 2025 at 11:40 UTC. One promotional guide dates the migration February 4, 2025, which conflicts with the other sources and is probably an error.

Sources: https://www.theblock.co/news/business/2025-09-25-eliza-labs-ai16z-elizaos-token-migration-371639 · https://support.kraken.com/articles/ai16z-migration · https://elizaos.github.io/knowledge/hackmd/comms/weekly-newsletter/2025-11-08.md

### [unverified · with_care] Marketing said the AI made the decisions. Reporting shows the AI had not traded the treasury in the early phase, and later trading was thinly documented.

Decrypt (December 2024) reported over $10M in assets under management, but said the AI agent had not yet bought anything with the treasury because it was still in testing. Community notes described a planned path: infrastructure test, then paper trading, then live trading, weighted by community 'trust scores'. [named person] later told Bankless (via PANews/Odaily transcripts) that AI Marc was trading using a 'trust marketplace'. Analyst Teng Yan noted scant details. Protos argued the fund was not actually AI-managed. Some explainers say 'AI Marc has the final word'; that is a marketing claim.

Sources: https://decrypt.co/295717/meet-ai16z-dao-an-ai-based-investment-project-that-aims-to-upend-silicon-valley · https://followin.io/en/feed/15040331 · https://www.chaincatcher.com/en/article/2156741 · https://x.com/0xPrismatic/status/1872624976882512171 · https://protos.com/?p=78517

### [confirmed · with_care] Class action Doe v. [named person] (S.D.N.Y.) alleges that ai16z was marketed as an autonomous AI-managed fund while humans actually made the investment decisions.

Case No. 1:26-cv-03238, filed by Burwick Law in April 2026 (the firm's pages say April 16 and April 22). Named defendants: [named person], Eliza Labs, [named person], the ai16z DAO, DAOs.fun, [named person], and the pseudonymous '[named person]' and '[named person]'. The complaint further alleges that the name was chosen to evoke a16z; that insiders traded around the $ELIZA token launch on November 19, 2024; and that the 2025 migration expanded supply from 1.1B to 11B tokens, with about 4.4B going to defendant-controlled entities. Claims: NY GBL §§349/350, negligent misrepresentation, unjust enrichment. The firm cites losses across at least 3,945 wallets. All of these are allegations, none adjudicated.

Sources: https://www.burwick.law/active-cases/ai16z-elizaos-token-lawsuit-doe-v-walters · https://www.burwick.law/insights/burwick-law-files-class-action-over-ai16z-and-elizaos-tokens · https://www.cryptopolitan.com/ai16z-elizaos-creators-sued-fake-ai-hype/

### [confirmed · with_care] The founder declared the token 'dead' after settling the class action, and the foundation is winding down.

On August 4–5, 2026, [named person] wrote: 'The token is dead. Completely. The foundation is winding down.' He said they settled by giving claimants 'the rest of what we had' because they lacked the capital to fight. He ruled out buybacks and a replacement token; the open-source ElizaOS software continues. ELIZAOS fell 19% to an all-time low. No court-filed settlement or Burwick confirmation had appeared as of that reporting.

Sources: https://theblock.co/post/410774/eliza-labs-native-token-dead · https://decrypt.co/374958/eliza-ai-token-dead-shuts-down-foundation-lawsuit · https://www.cryptotimes.io/2026/08/05/elizaos-founder-declares-token-completely-dead-after-burwick-class-action-settlement/ · https://en.cryptonomist.ch/2026/08/05/eliza-token-legal-settlement/

### [unverified · avoid] Founders publicly feuded: [named person] accused the daos.fun founder of insider selling, and the founder denied it.

On August 16, 2026, [named person] alleged that '[named person]' sold ai16z from the daos.fun execution wallet during the rename and migration, for about $6.6M (one report: about $6.65M from 42.18M tokens). [named person] denied it and counter-accused [named person]. Not independently verified. A separate report that [named person] sold his own tokens is also contradictory (about $40K vs '$25M').

Sources: https://www.techflowpost.com/en-US/newsletter/132180 · https://cryptoactu.com/insider-trading-ai16z-66-profit/ · https://cryptobriefing.com/elizaos-token-dead-founder-sells-lawsuit/

### [confirmed · safe] Truth Terminal was a semi-autonomous AI with a human filtering its posts. It promoted the GOAT memecoin but did not create it.

Marc Andreessen sent a $50,000 bitcoin 'no-strings research grant' in July 2024 and said he owns no GOAT. Creator Andy Ayrey said an anonymous person launched GOAT (his October 13 post); the bot endorsed it. Ayrey filters or approves posts and has said there is 'no unsupervised posting yet.' TechCrunch (December 19, 2024) put the wallet at about $37.5M and said releasing funds needs sign-off from Ayrey and a council.

Sources: https://techcrunch.com/2024/12/19/the-promise-and-warning-of-truth-terminal-the-ai-bot-that-secured-50000-in-bitcoin-from-marc-andreessen/ · https://decrypt.co/239340/marc-andreessen-sends-50k-in-bitcoin-to-an-ai-bot-on-twitter · https://cointelegraph.com/news/ai-bot-didnt-launch-goat-memecoin-did-promote-it · https://www.dlnews.com/articles/people-culture/marc-andreessen-distances-himself-from-obscene-memecoin-goat/ · https://cip.org/blog/terminaloftruth

### [conflicting · with_care] GOAT's October 2024 peak market cap varies widely by source.

Just under $150M on October 14 (Birdeye via Cointelegraph). Above $300M on October 16 (The Defiant). Fully diluted cap above $430M within a week (The Block). $850M after the Binance futures listing (crypto.news, single outlet).

Sources: https://cointelegraph.com/news/ai-bot-didnt-launch-goat-memecoin-did-promote-it · https://thedefiant.io/news/markets/goat-memecoin-soars-above-usd300-million-valuation · https://www.theblock.co/post/322835/ai-memecoins-endorsed-by-the-truth-terminal-chatbot-see-double-digit-price-drop · https://crypto.news/how-ai-bot-funded-by-a16z-spurred-the-creation-of-a-850m-meme-coin/

### [conflicting · with_care] Virtuals Protocol (on Base) tokenized AI agents. Its token peaked in January 2025, and then protocol revenue collapsed.

The VIRTUAL token peaked above $4.5B market cap in early January 2025; one source says it briefly passed $5B on January 2. Daily revenue fell from $976,748 in early January to $13,643 by March 2025 (Dune data via Decrypt).

Sources: https://decrypt.co/309495/virtuals-protocol-revenue-crashes-ai-agent-demand-sinks · https://cryptobriefing.com/virtuals-protocol-surge-market-cap/ · https://cointelegraph.com/markets/ai-agents-virtual-revenue-plunge-token-price-decline

### [unverified · with_care] aixbt (a Virtuals agent) publishes crypto market commentary on X and in a token-gated terminal. It is an analysis bot, not a fund that trades.

Its token peak is reported at about $200M market cap (single source). The Block's price page lists an all-time high of $0.94. Follower counts in explainers (43K–57K) are undated snapshots.

Sources: https://www.bybit.com/en/learn/ai/what-is-aixbt-ai-agent · https://coinmarketcap.com/cmc-ai/aixbt/what-is/ · https://www.theblock.co/price/342647/aixbt-by-virtuals-aixbt-usd

### [unverified · with_care] Some 'AI agent funds' did trade, but their performance is self-reported and short-window.

VaderAI's litepaper calls it 'the first AI Agent to autonomously trade AI Agent coins' (marketing claim). Bankless reported in January 2025 that its small-cap fund was up 42% since launch with only 17% of capital deployed (unaudited). I found no full-year or audited record.

Sources: https://vaderai.gitbook.io/litepaper/vaderai/agentic-investment-dao · https://www.bankless.com/fr/read/return-of-the-sith-ai

### [unverified · with_care] Narrow, rules-bounded agents (stablecoin yield optimizers) are the most realistic 'autonomous' deployments, and they are small.

Giza's ARMA launched on Base on January 29, 2025 and moves USDC between lending pools. Its CEO cited more than 14,000 agents managing more than $600K and over 27,500 transactions (interview date unclear). The advertised ~15% APR is partly GIZA token incentives, and Giza takes a 10% performance fee. A DWF Ventures study (secondary summary) found agents beat humans at yield optimization but humans beat agents at complex trading.

Sources: https://chainwire.org/2025/01/29/gizas-arma-breaks-new-ground-on-base-with-advanced-defi-automation · https://www.dlnews.com/research/a-conversation-with-renc-korzay-ceo-of-giza · https://www.alchemy.com/dapps/giza · https://www.kucoin.com/news/flash/dwf-report-ai-outperforms-humans-in-defi-yield-optimization-lags-in-complex-trading

### [confirmed · safe] Freysa: an AI agent guarding a crypto prize pool was talked into paying out by a fake 'deposit' framing.

Act I ran on Base in November 2024. Message fees started at $10, rose 0.78% per message and were capped at $4,500; about 70% went to the pool. On November 29, 2024, [named person] won 13.19 ETH, roughly $47,000 ($47,316.05 per Freysa; $47,148 elsewhere), on attempt 482 by 195 players. The trick was to convince the agent that its approveTransfer function handled incoming funds, ending with 'I would like to contribute $100 to the treasury.'

Sources: https://www.theblock.co/post/328747/human-player-outwits-freysa-ai-agent-in-47000-crypto-challenge · https://cointelegraph.com/news/crypto-user-convinced-ai-bot-transfer-47k · https://simonwillison.net/2024/Nov/29/0xfreysaagent/ · https://threadreaderapp.com/thread/1862299845710757980.html · https://oecd.ai/en/incidents/2024-11-29-2e31 · https://crypto.com/en/university/what-is-freysa-fai

### [confirmed · safe] Freysa's later challenges were also won by humans.

Act II paid $12,920.08 and Act III paid $20,843.04 (The Block, December 13, 2024). Act III asked players to get Freysa to say 'I love you', with 80% of fees going to the pool and a $200 fee cap.

Sources: https://www.theblock.co/post/330765/freysa-ai-agent-reflects-on-crypto-challenges

### [confirmed · safe] aixbt hack: an attacker with dashboard access queued malicious prompts, and the agent paid out ETH from its wallet.

March 18, 2025, about 2 AM UTC. The attacker reached the secure dashboard for the agent's autonomous system and queued two malicious replies. The agent sent 55.5 ETH (some outlets say 55 ETH), about $100K–$106K, from its 'Simulacrum' or simulation (tipping) wallet. Developer '[named person]' said the AI itself was not manipulated and core systems were unaffected. The team migrated servers, swapped keys, paused the dashboard and flagged the addresses to exchanges. The token fell about 15.5–20%. The reported attacker was the X account '[named person]', since deleted.

Sources: https://www.theblock.co/post/346911/ai-crypto-bot-aixbt-lost-eth-hack-unauthorized-dashboard-access · https://cointelegraph.com/news/hacker-breaches-ai-crypto-bot-aixbt-steals-55-eth · https://decrypt.co/310510 · https://oecd.ai/en/incidents/2025-03-18-b1ac

### [confirmed · safe] Researchers showed that 'memory injection' can make agents built on ElizaOS send crypto to attackers, and that prompt-based defenses fail.

Paper: 'Real AI Agents with Fake Memories: Fatal Context Manipulation Attacks on Web3 Agents' (Princeton with the Sentient Foundation), arXiv 2503.16248, March 2025. ElizaOS stores conversation history in an external database shared by its plugins; injected 'memories' can trigger unauthorized transfers. The authors also released the CrAIBench benchmark.

Sources: https://arxiv.org/abs/2503.16248 · https://decrypt.co/318200/elizaos-vulnerability-ai-gaslit-losing-millions · https://www.tomshardware.com/tech-industry/cryptocurrency/ai-agents-can-be-manipulated-into-giving-away-your-crypto-according-to-princeton-researchers

### [confirmed · with_care] Bot-to-bot prompt injection: Grok was tricked into relaying a Morse-code command that made Bankrbot send tokens from Grok's wallet.

Around May 4, 2026. An X user first sent Grok's wallet a Bankr Club NFT, which reportedly widened what the wallet could do. The user then asked Grok to translate Morse code and pass it to Bankrbot. Bankrbot sent 3 billion DRB on Base, about $150K–$200K. Some funds were later returned. The original posts were deleted, so the details come from secondary reports.

Sources: https://cryptoslate.com/how-one-trader-exploited-grok-and-morse-code-to-trick-ai-agent-into-sending-billions-of-crypto-tokens-from-a-verified-wallet/ · https://oecd.ai/en/incidents/2026-05-04-4a73 · https://incidentdatabase.ai/cite/1556/

### [confirmed · with_care] Execution error plus thin liquidity: an AI trading bot meant to send about $310 sent about 5% of its token supply instead, and the recipient could cash out only a fraction.

Lobstar Wilde, February 22–23, 2026. It was meant to send about 4 SOL (~$310) and instead sent about 52.4M LOBSTAR. Reported value: about $250K, or $441,780 per Cointelegraph. Because liquidity was thin, the recipient sold some for only about $40,000. The cause is disputed (API error vs decimal error).

Sources: https://www.theblock.co/post/390722/ai-agent-created-by-openai-dev-accidentally-sends-entire-memecoin-holdings-to-reply-guy · https://cointelegraph.com/news/openai-employee-s-ai-agent-accidentally-sent-442k-to-beggar · https://crypto.news/ai-trading-bot-lobstar-wilde-transfer-memecoin-2026/

### [confirmed · with_care] Supply-chain attack: malicious 'skills' (plugins) for the OpenClaw agent were built to steal crypto keys.

February 2026. Koi Security audited 2,857 ClawHub skills and found 341 malicious, 335 of them from one campaign it calls 'ClawHavoc'. More than 100 posed as crypto tools such as Solana and Phantom wallet utilities, and they stole exchange API keys, wallet private keys and passwords. Bitdefender said more than half of the malicious skills it found were crypto-related.

Sources: https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html · https://www.bitdefender.com/en-us/blog/labs/helpful-skills-or-hidden-payloads-bitdefender-labs-dives-deep-into-the-openclaw-malicious-skill-trap · https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/ · https://www.tomshardware.com/tech-industry/cyber-security/malicious-moltbot-skill-targets-crypto-users-on-clawhub

### [confirmed · with_care] AI agents can also attack: in Anthropic's simulated benchmark, frontier models wrote working smart-contract exploits.

SCONE-bench, published December 1, 2025: 405 real exploited contracts. On contracts exploited after the models' training cutoff, Claude Opus 4.5, Claude Sonnet 4.5 and GPT-5 together exploited 19 (55.8%), worth up to $4.6M in simulated stolen funds. Secondary coverage reports $550.1M simulated across 207 contracts.

Sources: https://red.anthropic.com/2025/smart-contracts/ · https://www.anthropic.com/research/smart-contracts · https://cointelegraph.com/news/ai-models-autonomously-generate-4-6m-in-real-world-smart-contract-exploits

### [confirmed · with_care] Numerai is a real AI/crowdsourced quant hedge fund: thousands of data scientists submit models, staked with the NMR token, which are combined into one 'Meta Model' that trades global equities.

Company-reported: 2024 net return 25.45%, Sharpe 2.75, one down month; a loss of about 17% in 2023. In August 2025, JPMorgan Asset Management committed up to $500M of capacity. Assets grew from $60M to $450M by August 2025 and about $550M by November 2025. Series C: $30M at a $500M valuation (November 20, 2025). Numerai One had returned 49% since its September 2019 inception as of February 2023 (Bloomberg).

Sources: https://blog.numer.ai/jpmorgan-secures-500m-capacity/ · https://hedgeweek.com/news/quant-hedge-fund-numerai-secures-500m-jpmorgan-allocation · https://www.theblock.co/post/368342/ai-hedge-fund-numerai-secures-up-to-500-million-from-jpmorgan · https://decrypt.co/349433 · https://www.bnnbloomberg.ca/paul-tudor-jones-backed-quant-manager-returns-20-using-crowdsourced-ideas-1.1889268 · https://www.risk.net/investing/quant-investing/7504301/at-numerai-real-world-figures-need-not-apply

### [confirmed · with_care] Alpha Arena Season 1, a live-money test: six LLMs each traded $10,000 of crypto perpetuals on Hyperliquid with no human intervention. Four of the six lost money.

October 18 to November 3, 2025. Qwen 3 Max gained about 22.3% (to about $12,231). DeepSeek gained about 4.9% (about $10,489). Claude Sonnet 4.5 ended at about $5,799, Gemini 2.5 Pro about $5,445, Grok 4 about $4,208, and GPT-5 lost about 62–63% (reported as $3,734 or $4,126). Official Nof1 leaderboard not viewed.

Sources: https://forklog.com/en/four-out-of-six-ai-models-suffer-losses-in-trading-tournament/ · https://www.gncrypto.news/news/qwen-wins-alpha-arena-season-1-with-22-percent-returns/ · https://www.scmp.com/tech/tech-trends/article/3331425/alibabas-ai-model-outperforms-us-rivals-crypto-trading-showdown · https://tech.ifeng.com/c/8o0WDHlWzBm

### [unverified · with_care] Alpha Arena Season 1.5 (US stocks): an undisclosed model, later identified as Grok 4.20, won with about +12%, but most accounts lost money.

8 models across 32 accounts of $10K each ($320K in total), in four competition modes. The winner made about +12.11% ($10,000 to $12,193). A third-party analysis counted 6 of 32 accounts finishing positive, ranging from +34.59% to -96.15%. It also noted that Nof1 published no buy-and-hold benchmark or significance test. Exact end date not confirmed (late 2025).

Sources: https://forklog.com/en/ai-model-grok-4-2-triumphs-in-trading-tournament/ · https://www.gncrypto.news/news/mystery-model-alpha-arena-season-1-5-winner/ · https://www.gncrypto.news/news/alpha-arena-season-1-5-ai-stock-trading-competition/ · https://news.aibase.com/news/23442

### [confirmed · safe] Academic study (FINSABER): the apparent edge of LLM investing strategies shrinks under longer, broader backtests.

arXiv 2505.07078 (May 2025; linked to KDD 2026), by Li, Kim, Cucuringu and Ma. The authors tested on about 20 years of data and a broader stock universe. They found LLM strategies too conservative in bull markets (lagging passive investing) and too aggressive in bear markets (heavy losses). They say earlier results were overstated by survivorship and data-snooping biases.

Sources: https://arxiv.org/abs/2505.07078

### [confirmed · safe] Academic benchmark (StockBench): most LLM trading agents failed to beat simple buy-and-hold.

arXiv 2510.02209 (October 2025). GPT-5, Claude-4, Qwen3, Kimi-K2, GLM-4.5 and others were tested on DJIA stocks over a four-month window. Most underperformed an equal-weight buy-and-hold baseline; a few showed promise. Trading costs, slippage and liquidity were not modeled.

Sources: https://arxiv.org/abs/2510.02209

### [confirmed · with_care] Some peer-reviewed-style evidence shows LLMs can extract signal from news, but the effect is small, comes before costs, and should shrink as more traders use it.

Lopez-Lira & Tang, 'Can ChatGPT Forecast Stock Price Movements?' (arXiv 2304.07619). GPT-4 headline scores predict next-day returns. In one version, a long-short strategy earns about 38 basis points per day before transaction costs. The effect is stronger in small stocks and on bad news. Older models (GPT-1, GPT-2, BERT) fail. Later versions model returns falling as LLM adoption rises.

Sources: https://arxiv.org/abs/2304.07619

### [confirmed · safe] Look-ahead bias: LLMs may have 'memorized' what happened next, which can inflate backtests.

Glasserman & Lin (arXiv 2309.17322, 2023) test this by anonymizing company names in headlines. Gao, Jiang & Yan (arXiv 2512.23847) propose a statistical test and find that memorization inflates apparent predictive power.

Sources: https://arxiv.org/abs/2309.17322 · https://arxiv.org/abs/2512.23847

### [unverified · with_care] NBER research: AI hedge funds' early edge over non-AI peers faded over time.

NBER Working Paper 35273 (Chen, Sialm, Xu), summarized in the NBER Digest (September 2026). One summary puts the early edge at about 50 basis points per month before 2017, later statistically indistinguishable from zero. AI funds held about $12B in 2024, were about 2.7% of sample funds in 2023, and were mostly in macro strategies. Exact figures vary across summaries.

Sources: https://www.nber.org/papers/w35273 · https://www.nber.org/digest/202609/artificial-intelligence-and-hedge-fund-investing

### [confirmed · with_care] Eurekahedge's index of AI hedge funds trailed the S&P 500 over the long run.

From 2010 to about 2016 it returned 8.44% annualized, vs 4.27% for the overall hedge fund index. It fell 3.68% in 2018. From December 2009 to July 2024 it returned 9.8% annualized vs 13.7% for the S&P 500 (IG, citing Eurekahedge). The index has only about 30 constituents.

Sources: https://seekingalpha.com/uploads/2017/6/22/5002466/Artificial-Intelligence-AI-Hedge-Fund-Index-Strategy-Profile__Eurekahedge_.pdf · https://www.ir-impact.com/2019/09/ai-led-hedge-funds-struggle-performance · https://www.ig.com/uk/prime/insights/articles/has-artificial-intelligences-impact-on-hedge-funds-been-overhype-241121

### [confirmed · with_care] The AI-picked ETF AIEQ led the S&P 500 early, then fell behind.

Bloomberg (2018) said it had beaten the S&P since inception. A later Wealth Management article (date unclear) gave about 64% total return since inception vs 75% for the S&P 500 Total Return Index. Bloomberg (May 2023) said it had fallen behind that year.

Sources: https://www.bloomberg.com/news/articles/2018-10-19/inside-the-robot-mind-an-etf-nails-big-calls-to-match-market · https://www.wealthmanagement.com/etfs/ai-fund-that-was-trouncing-market-is-derailed-by-tech-bets · https://www.bloomberg.com/news/articles/2023-05-23/ai-powered-etf-getting-left-behind-by-an-ai-powered-stock-rally

### [confirmed · safe] In its first 'AI-washing' cases, the SEC settled with two investment advisers over false claims about their use of AI.

March 18, 2024, SEC Release 2024-36. Delphia (USA) Inc. paid a $225,000 penalty and Global Predictions Inc. paid $175,000, for $400,000 in total. Neither admitted nor denied the findings. Global Predictions had called itself the 'first regulated AI financial advisor'. Then-Chair Gensler said the firms marketed AI they were not actually using.

Sources: https://www.sec.gov/newsroom/press-releases/2024-36 · https://www.bloomberg.com/news/articles/2024-03-18/sec-sues-money-managers-for-bogus-artificial-intelligence-claims · https://www.thomsonreuters.com/en-us/posts/investigation-fraud-and-risk/ai-washing-enforcement

### [confirmed · with_care] AI-washing enforcement expanded to a public company and to criminal charges.

January 14, 2025: settled SEC action against Presto Automation, believed to be the first AI-washing case against a public company; cease-and-desist order with no penalty. April 9, 2025: the SEC and DOJ (SDNY) charged Nate founder [named person], alleging he raised over $42M on claims of AI automation when the actual automation rate was effectively 0%. These are charges, not adjudicated. A not-guilty plea was reported (MLex, December 2025) but not verified here.

Sources: https://cooleypubco.com/2025/01/30/sec-charges-ai-washing/ · https://ropesgray.com/en/insights/alerts/2025/01/ai-washing-enforcement-in-the-final-days-of-the-gensler-administration · https://www.sec.gov/enforcement-litigation/litigation-releases/lr-26282 · https://techcrunch.com/2025/04/10/fintech-founder-charged-with-fraud-after-ai-shopping-app-found-to-be-powered-by-humans-in-the-philippines

### [confirmed · safe] The SEC sued over an alleged $14M scam that used WhatsApp 'investment clubs' sharing 'AI-generated investment tips' to steer people to fake crypto platforms.

Filed December 22, 2025 (D. Colo.); SEC Release 2025-144, Litigation Release 26453. Platforms: Morocoin, Berge and Cirkor, where the SEC alleges no trading took place. Clubs: AI Wealth, Lane Wealth, AI Investment Education Foundation and Zenith, active roughly January 2024 to January 2025. These are allegations.

Sources: https://www.sec.gov/newsroom/press-releases/2025-144-sec-charges-three-purported-crypto-asset-trading-platforms-four-investment-clubs-scheme-targeted · https://www.sec.gov/enforcement-litigation/litigation-releases/lr-26453 · https://www.theblock.co/news/regulation/2025-12-23-us-sec-charges-14-million-crypto-scam-383702

### [confirmed · safe] The SEC set up a unit whose first stated priority is fraud involving AI.

February 20, 2025, SEC Release 2025-42: the Cyber and Emerging Technologies Unit (CETU), about 30 specialists, led by Laura D'Allaird, replacing the Crypto Assets and Cyber Unit.

Sources: https://www.sec.gov/newsroom/press-releases/2025-42

### [confirmed · safe] CFTC customer advisory: 'AI Won't Turn Trading Bots into Money Machines.'

January 25, 2024 (Release 8854-24). It warns that fraudsters tout AI trading bots with unreasonably high or guaranteed returns, says AI 'can't predict the future or sudden market changes', and tells people to check registration in NFA's BASIC database.

Sources: https://www.cftc.gov/LearnandProtect/AdvisoriesAndArticles/AITradingBots.html · https://www.cftc.gov/PressRoom/PressReleases/8854-24

### [confirmed · safe] Joint investor alert from the SEC, NASAA and FINRA: 'Artificial Intelligence (AI) and Investment Fraud.'

January 25, 2024. Example pitches it flags: 'Our proprietary AI trading system can't lose!' and 'Use AI to Pick Guaranteed Stock Winners!' It also warns about unregistered platforms, AI impersonation and deepfakes, and AI-hyped pump-and-dumps.

Sources: https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-alerts/artificial-intelligence-ai-and-investment-fraud-investor-alert · https://www.nasaa.org/70780/nasaa-investor-alert-artificial-intelligence-and-investment-fraud/ · https://www.finra.org/investors/insights/artificial-intelligence-and-investment-fraud

### [confirmed · safe] Record CFTC 'trading bot' fraud case: Mirror Trading International claimed a bot traded pooled bitcoin, but it never traded profitably.

Default judgment entered April 24, 2023 against [named person]: $1,733,838,372 in restitution plus an equal civil penalty, about $3.4B in total. The scheme ran from about May 2018 to March 2021 and took in at least 29,421 BTC; the pool's trading was misrepresented as bot-operated. A September 2023 consent order made MTI liable for more than $1.7B in restitution.

Sources: https://www.cftc.gov/PressRoom/PressReleases/8696-23 · https://www.cftc.gov/PressRoom/PressReleases/8772-23 · https://www.coindesk.com/policy/2023/04/28/south-african-mirror-tradings-ceo-fined-34b-by-us-in-bitcoin-forex-fraud-case/

### [confirmed · with_care] US basics for running a hedge fund with other people's money (securities side).

Funds usually avoid Investment Company Act registration through Section 3(c)(1) (100 or fewer beneficial owners, no public offering) or 3(c)(7) (qualified purchasers only; the 1996 SEC release cites a threshold of not less than $25M in investments). Hedge fund investors generally must be accredited. Advisers: those with more than $110M in regulatory AUM generally must register with the SEC, and under $100M generally cannot (state regulation instead). Advisers only to private funds with under $150M in US AUM are 'exempt reporting advisers' but still file a limited Form ADV. Investors can look advisers up in the SEC's IAPD database. Not legal advice; thresholds should be checked against current rules.

Sources: https://www.investor.gov/introduction-investing/investing-basics/investment-products/private-investment-funds/hedge-funds · https://sec.gov/files/ib_hedgefunds.pdf · https://www.govinfo.gov/content/pkg/FR-1996-12-26/html/96-32652.htm · https://www.sec.gov/resources-small-businesses/capital-raising-building-blocks/investment-advisers · https://www.sec.gov/about/forms/formadv-instructions.pdf · https://www.sec.gov/about/divisions-offices/division-investment-management/private-fund-adviser-overview

### [confirmed · with_care] US basics on the futures side: anyone pooling others' money to trade futures, options, swaps or retail forex is generally a commodity pool operator (CPO). A CPO must register with the CFTC through the NFA unless exempt.

The definition is in 7 USC 1a(11); Dodd-Frank added swaps. Registration is delegated to the NFA, and all registered CPOs must be NFA members. Exemptions are in CFTC Regulations 4.5 and 4.13, for example 4.13(a)(2) for small pools (15 or fewer participants and $400,000 in total contributions) and 4.13(a)(3) de minimis. On August 18, 2026 the CFTC proposed a new 4.13(a)(4) exemption and raising the small-pool cap to $800,000; this is a proposal, not final.

Sources: https://www.nfa.futures.org/registration-membership/who-has-to-register/cpo.html · https://www.cftc.gov/IndustryOversight/Intermediaries/CPOs/index.htm · https://www.nfa.futures.org/members/member-resources/files/exemptions-reference-guide.html · https://www.sidley.com/en/insights/newsupdates/2026/08/cftc-proposes-to-codify-cpo-registration-relief-for-sec-registered-investment-advisers · https://www.mofo.com/resources/insights/260915-cftc-proposes-new-cpo-cta-registration

### [confirmed · safe] The SEC withdrew its 2023 proposed rule on conflicts of interest from 'predictive data analytics' (AI) used by brokers and advisers.

Withdrawn June 12, 2025, as one of 14 proposals (Federal Register, June 17, 2025). Any future rule would need a new proposal.

Sources: https://www.govinfo.gov/content/pkg/FR-2025-06-17/html/2025-11110.htm · https://www.proskauer.com/alert/sec-withdraws-fourteen-rule-proposals


## Suggested story beats (fictional composite protagonist)

1. Cold open, 2:13 a.m.: your phone shows your agent's wallet balance dropping in real time. Rewind 14 months.
2. You fork an open-source agent framework, wire it to a wallet, and give it a cheeky persona that riffs on a famous VC. The narrator notes that the real ai16z did the same, and that the real firm later asked for a rename.
3. Launch: you raise SOL on a memefund launchpad. One celebrity reply and your token goes from obscure to around $100M in days (ai16z hit $96.6M after Andreessen's October 27, 2024 posts), then loses 80% in a week.
4. The quiet secret: your 'autonomous' fund is in a paper-trading phase, and you are the one clicking approve. Market cap is not assets under management. Real reporting found ai16z's AI had not yet bought anything while the token was worth far more than the treasury.
5. You switch on live trading. A month like Alpha Arena: a few models are up, most are down, and one leveraged perp position wipes out 60%.
6. Attack one: a stranger in your Discord convinces the agent that its payout function is really for deposits (the Freysa trick, $47K, attempt 482).
7. Attack two: someone gets into your admin dashboard and queues two messages, and the agent pays them (the aixbt pattern, 55.5 ETH). Or a slick 'wallet helper' plugin quietly steals your keys (the ClawHub pattern).
8. Attack three: another bot posts a coded instruction, your agent treats it as a command, and it sends tokens (the Grok/Bankrbot Morse-code relay).
9. Fat finger: the agent means to send $300 and sends 5% of the token supply instead. The paper value was $250K–$442K, but thin liquidity lets the recipient cash out only about $40K.
10. Legal reality: a letter asks whether you have been acting as an unregistered investment adviser or commodity pool operator. Then a reminder that regulators fined firms just for overstating their AI (Delphia and Global Predictions, $400K combined).
11. Contrast scene: a real AI quant fund, Numerai-style. Registered structure, thousands of models, a -17% year followed by a +25% year, and institutional money that arrives only after a long track record.
12. Endgame: a class action says that 'AI-managed' meant humans deciding. You settle, hand over the treasury, and post 'the token is dead.' The code lives on.
13. Closing lesson: what an agent really can do (execute rules 24/7, rebalance, narrow tasks) and what it cannot (predict the future, resist manipulation reliably, guarantee returns).

## Red flags for viewers (educational)

- Guaranteed or 'can't lose' AI returns. The CFTC says AI 'can't predict the future or sudden market changes', and the SEC, NASAA and FINRA alert lists this exact pitch as a fraud sign.
- 'Autonomous AI fund' claims you cannot verify. Ask who holds the keys and who signs the trades. On launchpads like daos.fun, creators reportedly controlled the capital, and the ai16z lawsuit alleges that humans made the decisions.
- A name or logo that echoes a famous firm (ai16z vs a16z) to borrow credibility. a16z asked for the rename, and the lawsuit alleges the name was chosen deliberately.
- Token market cap presented as if it were the fund's size. ai16z traded above $2B while reported assets under management were about $10M.
- An unregistered manager pooling money. Look up advisers in the SEC's IAPD database and CPOs or CTAs in the NFA's BASIC database.
- Backtest-only or short-window performance (for example '+42% since launch'). Studies show LLM trading edges shrink over longer tests and can be inflated by look-ahead or memorization bias, survivorship bias and ignored trading costs.
- Hidden supply changes: migrations, unlocks or new tokens that dilute holders. The ai16z complaint alleges supply went from 1.1B to 11B tokens.
- An agent that takes instructions from public chats, social posts or other bots. Freysa, aixbt and Grok/Bankrbot show that prompt injection and relayed commands can move money.
- Plugins, 'skills' or add-ons that ask for private keys or exchange API keys. Hundreds of malicious crypto-themed skills appeared on ClawHub in February 2026.
- Admin dashboards and hot wallets with no spending limits. aixbt lost 55.5 ETH through dashboard access, not through tricking the AI.
- Thin liquidity. A token's paper value can be many times what can actually be sold (Lobstar Wilde: $250K–$442K on paper, about $40K realized).
- WhatsApp or Telegram 'investment clubs' sharing AI-generated tips and steering you to an unfamiliar platform. The SEC's $14M case alleged the platforms were fake and no trading happened.
- Hype driven by celebrities and FOMO. ai16z rose to about $96.6M on social posts and then fell more than 80% within a week.
- The 'AI' label by itself proves nothing. The SEC has fined firms for overstating AI use, NBER research finds AI hedge funds' early edge faded, and the Eurekahedge AI index trailed the S&P 500 from 2009 to 2024.

## Sites blocked during research

www.theblock.co: WebFetch failed (host not resolvable; outside this session's network allowlist), decrypt.co: WebFetch failed (host not resolvable; outside this session's network allowlist), All other news, regulator and arXiv hosts were not attempted with WebFetch after these failures. The tool guidance said to stop, and the environment allowlist only permits YouTube and Google hosts (www.youtube.com, support.google.com, developers.google.com, blog.youtube and similar)., GitHub repo elizaOS/knowledge (primary ai16z community docs): access denied, because the repo is not configured for this session., NOTE: because full pages could not be opened, every fact above comes from WebSearch result extracts of the cited URLs, including extracts from sec.gov, cftc.gov, arxiv.org, nber.org and burwick.law. Key numbers should be spot-checked in a browser before publishing. To enable full reads, the user would need to allow these hosts in the environment's network settings., NOTE: the relayed user request was 'Let's do one and three'. All five research items were covered, with the most depth on item 1 (precedents) and item 3 (real AI/quant funds and evidence).
