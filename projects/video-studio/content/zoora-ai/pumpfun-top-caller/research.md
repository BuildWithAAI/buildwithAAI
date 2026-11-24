# Research: POV: You become a top caller on Pump.fun

Compiled 2026-11-24. One research agent wrote it and an adversarial fact-checker reviewed it.

**Redaction.** This repo is public. Names of private or accused individuals (KOLs/callers, defendants, people in unadjudicated allegations) are replaced with `[named person]`, because what is said about them is an allegation (an analytics firm's estimate or a civil pleading), not a finding. Public figures and public records (e.g. SEC settlements) are kept as sourced. Source URLs are unchanged. **Scripts never name these people** (see Must not say).

**Verification limits.** The checker could not open most news, regulator and court sites from this session (theblock.co, crypto.news, sec.gov, cftc.gov and arxiv.org were blocked), so 'holds' often rests on several consistent search extracts rather than a direct page read. Everything marked `unsupported` must be re-checked in a browser before it airs.

## Fact-check verdicts

| Verdict | Claim | Checker's note |
|---|---|---|
| **unsupported** | VERIFICATION METHOD NOTE (not a story fact) | I could not open any page myself. WebFetch failed with ENOTFOUND on theblock.co and crypto.news, which are outside this session's network allowlist. Following the tool's guidance, I stopped trying other hosts, so the Bubblemaps blog, Justia, CourtListener, SEC, DOJ, CFTC and others were not fetched directly. Every 'holds' below rests on WebSearch's own page extracts, which quote the named outlets, not on my reading of the full page. After about 27 searches, the shared WebSearch budget (200 per turn across all agents) ran out. Facts I had not reached by then are marked 'unsupported (not re-checked)', even where they match my pre-June-2026 background knowledge. To finish the check, the user ne |
| **holds** | Pump.fun launched Jan 19, 2024; operator Baton Corporation Ltd.; co-founders [named person], [named person], [named person] | Jan 19, 2024 is supported: The Block (Jan 26, 2025 piece) says the site 'launched... on January 19, 2024'. Blockchain.com and Decrypt name all three co-founders. Coverage of the Aug 31, 2026 ruling gives their roles as [named person] (chief executive), [named person] (CTO) and [named person] (chief product officer). Caveat: Decrypt's 2024 'Project of the Year' piece calls the pseudonymous co-founders 'Alon and Sapijiju', and how those handles map to the legal names is not stated. Some outlets call [named person] 'COO' instead of CEO. Wikipedia was not opened. |
| **holds** | PumpSwap launched Mar 20, 2025; instant migration; removed 6 SOL Raydium fee; 0.25% swap fee (0.20% LP / 0.05% protocol); later tiered | Supported as stated. The 0.25%/0.20%/0.05% split was the March 2025 launch figure only. Current PumpSwap fees follow a market-cap tier schedule, which Coinpaprika gives as 1.25% falling to a 0.30% floor. Always say 'at launch'. |
| **overstated** | Current fee structure 'from the official fee page': curve 1.25% (0.30% creator / 0.95% protocol); graduation 0.015 SOL; PumpSwap creator share falling ~0.95% to 0.05%; creator fees from May 13, 2025 | Neither I nor the researcher retrieved the official page (pump.fun/docs/fees). Search could not surface it either, so the 'official' attribution is unsupported. Third-party sources support 1.25% = 0.30% creator + 0.95% protocol (Coinpaprika, Trojan), and Coinpaprika supports 'from 13 May 2025'. Only BloFin gives 0.015 SOL for graduation, and BloFin itself says to trust the official docs. Older snapshots conflict: one Axios-linked snapshot of the fee page shows a 0.05% creator share, and MadeOnSol describes a flat 1%. Script fix: say 'a small percentage of every trade goes to the platform, and a share goes to the coin's creator'. Avoid exact percentages unless they are re-checked on publish d |
| **overstated** | Project Ascend announced Sept 2, 2025 with Dynamic Fees V1 (creator fees 0.95% falling to 0.05%; 98,240 SOL top tier); creators earned ~$2.1M (Cryptorank) or $2.4M+ (Solanafloor) in 24h | These parts hold: Sept 2 announcement; a market-cap-based tiered creator fee on PumpSwap that falls as market cap rises; $2.1M in 24h (Cryptorank, Coinpaper, Benzinga); 'over $2.4M' (Solanafloor). Other outlets report different 24h totals: Decrypt/Dune about $2M, Shib.io over $2.5M. These were not found: the 0.95% and 0.05% end-points, and the 98,240 SOL tier. The 'safe' label should be 'with_care'. Say 'about $2 million in its first day, by various counts'. |
| **holds** | Livestream suspended Nov 25, 2024; moderators doubled; reopened to 5% Apr 4, 2025 and to all users Apr 11, 2025 under moderation policy | Holds. The Block, Cointelegraph and Forklog give Apr 4 for the 5% reopening. CoinGape and crypto.news say Apr 5. CryptoSlate gives Apr 11 for all users. The Block says the reopening banned violence, harassment, sexual content and youth endangerment. |
| **unsupported** | Livestream sub-details: a man firing a gun on stream; Decrypt quote that streamers are 'needing crazier content to pump their tokens' | The extracts confirm a self-harm threat tied to a market cap, plus 'abusive' and 'heinous' content, but not the gun incident. The Decrypt quote was not checked. Do not depict either until verified. Under YouTube's self-harm policy, refer to it only as 'dangerous stunts'. |
| **holds** | CoinGecko: 18.67M tokens (Jan 14, 2024 to Jun 18, 2026); 68.67% (~12.8M) last bonding-curve trade on launch day; 4.55% (~850K) still trading after 90 days; method undercounts post-graduation DEX trading | Holds per secondary coverage. The extracts add that 80.37% (14.99M) had stopped by the day after launch, that 850,180 tokens lasted past 90 days, and that tokens which never traded were excluded. CoinGecko's original report was not seen. CoinGecko does not label the tokens as scams, so the script must not do so either. |
| **unsupported** | CoinGecko study: 'About 1% graduated' | No extract of the CoinGecko coverage gives a graduation rate, and one search summary says so explicitly. Do not attribute '1% graduate' to CoinGecko. Cite the separate graduation sources below instead. |
| **overstated** | Graduation share 'usually around 1%': 2025 0.89% of 11.6M; best week 1.67%; Jul–Aug 2025 0.7–0.8%; Feb 2026 1.15%; Dune lifetime ~1.4%; academic 0.63% (655,770 tokens); published range 0.198%–5% | These hold: Jul–Aug 2025 at 0.7–0.8% (Cointelegraph); 1.15% (Cryptopolitan, Feb 19, 2026, the highest since summer 2025); Dune about 1.4% (Solana Compass); 0.63% across 655,770 launches (academic, per Coinpaprika). The 1.67% figure appears in Cointelegraph as a single-week rate, but the 'Nov 2024' date was not confirmed. Not found: 2025 at '0.89% of 11.6M' (Solana Compass says 11.7M never graduated). The '0.198%–5%' range is outdated. The Block (Jul 29, 2026) reported a one-day spike to 6.7% after the BOOST launch mechanism, DEXTools reported 0.26% in 2026, an Aug 2026 industry sample found 1.76%, and the June 2024 peak was 2.1%. Script fix: 'historically, only about one in a hundred, though |
| **holds** | Pump.fun first Solana app past $1B cumulative revenue (The Block, Mar 12, 2026); DefiLlama ~$1.08B ($321M 2024 / $664M 2025 / $98M 2026 YTD) | Holds. The exact DefiLlama figures are $321.3M, $664.0M and $98.3M, totalling about $1.08B. Pump.fun did not comment to The Block. One KuCoin flash item says '$10 billion', which is an error and must not be used. |
| **unsupported** | 'Most revenue goes to PUMP buybacks' | The extracts say only that Pump.fun 'is conducting buybacks of the PUMP token'. No checked source gives the share as 'most'. Drop it, or say 'the platform has used revenue to buy back its own token'. |
| **holds** | PUMP ICO Jul 12, 2025 raised $500M (Cointelegraph) or $600M (The Block/Bloomberg) in ~12 minutes at $0.004 | Holds as a range. DL News and CryptoSlate say the dashboard showed 125B tokens, 12.5% of supply, sold for $500M. Bloomberg quotes the co-founder giving $600M. Blockworks says about $100M more was raised off-chain through CEXs. The Block's headline now reads $600M, although its URL slug says 500. |
| **overstated** | Callout Rewards: initial version Jan 2026; major upgrade Aug 2026 with ~$15M budget; daily USDC; not for UK persons; Oct 4 high-frequency cut; Oct 10 Alon: 'Volume will cease to be the main attributer', low-cap nerfed; Nov 17 Alon: ~$33M to nearly 55,000 callers | These hold: callouts went live in mid-Jan 2026 (FXStreet, Jan 16, 2026; another source cites a Jan 15 post). That version used push notifications, one call per account every 6 hours and a global leaderboard, and no paid rewards are described for it. Paid Callout Rewards started around August 2026 with a budget of about $15M (Crypto Briefing; Bittime dates it Aug 14; the terms are dated Aug 13). Payouts are daily in USDC. The Callout Terms say nothing is 'directed at... any UK Person'. The Oct 4 cut for high-frequency posting is reported. Alon's Oct 10 quote and 'low-cap callouts earn less' are reported by The Defiant and PrimeXBT. crypto.news reports $33M across nearly 55,000 callers as of N |
| **holds** | Sparsity Research: ~51,115 wallets got ~$29.6M since August; top 10 ~16%; median $13; followers of 10 small-cap callers lost ~$926K a day after calls (researcher marked unverified; used in story beats) | Holds in secondary coverage only. Coinotag and RootData give $29.6M, 51,115 wallets, 16% to the top 10 and a $13 median. crypto.news gives the $926K loss for followers of 10 small-cap callers. Date correction: Coinotag says this report was published Nov 15. The Nov 10 Sparsity item is a different study (Pump.fun had about 92% of launch volume). Coinotag also reports that after Oct 10, the share of payouts going to tokens with a median market cap under $100K rose from 68% to 94%, the opposite of the 'low-caps nerfed' framing. The '14 callers tracked' detail was not found. Script: 'one research firm reported...'. |
| **holds** | Bubblemaps (Nov 6, 2026): 'Side wallets have become a business model'; urged launchpads to audit top traders, expose side wallets, ban repeat offenders; no launchpad adopted | The quote, the demand and the Nov 6 date hold per crypto.news and Coinotag. 'No launchpad adopted' was not verified. Coinotag notes that Pump.fun's Callout Terms (Aug 13) already allow it to investigate, exclude accounts, and cut or cancel rewards. Say 'none had publicly announced such audits as of reporting', or drop the line. |
| **unsupported** | Definitions of bundles / clusters / snipers; vendor claim 29.3% of Sept 2026 launches had a launch-block buyer | Not re-checked because the search budget ran out. Coinotag quotes Bubblemaps' own caveat that a cluster is not proof of wrongdoing, since payroll or VC distributions also form clusters. Keep definitions generic and non-operational. Drop the vendor's 29.3% figure and any Jito-bundle mechanics. |
| **holds** | Extraction pattern per Bubblemaps: 4 operational wallets pass tokens to ~12 side wallets; public wallet buys; copy traders follow; side wallets sell. [named person]-linked wallets bought ~20s before calls and sold within minutes | Holds as Bubblemaps' description (Crypto Briefing, edgeX, aicoin). Crypto Briefing adds that the flow figures are Bubblemaps' 'labeled flows, not audited books'. For [named person], wallets bought in the same second as the public wallet, not 20s before. The '[named person] same-block' part is unsupported (see [named person]). Present it only as an investigator's allegation, in montage, with no how-to detail. |
| **unsupported** | CFTC 2018 advisory describes Telegram pump groups with countdowns like '15 mins left before the pump!' | Not re-checked: cftc.gov is blocked and the search budget is spent. This matches my background knowledge of the CFTC 'Beware Virtual Currency Pump-and-Dump Schemes' advisory, but confirm the exact quote on cftc.gov before quoting it. |
| **unsupported** | PumpCell Telegram ring (Solidus Labs, Dec 2025): ~$800K profit in Oct 2025; OTC cash; ZERO ~$2M FDV | Not re-checked because the search budget ran out. Verify on coindesk.com (Dec 9, 2025) and soliduslabs.com before use. |
| **unsupported** | ZachXBT leak (Sept 1, 2025): 200+ influencers approached, 160+ accepted, fewer than 5 disclosed; per-post rates up to $60k | Not re-checked because the search budget ran out, and this figure is used in a story beat and in a red flag. Outlets give different rate ranges, so verify against theblock.co/post/368956 before use. Do not name any influencer from the list. |
| **holds** | Bubblemaps case: [named person] (Oct 14, 2026): 534 recs over ~2 weeks; 5 linked wallets bought before 61% of calls ~20s ahead; sold ~4 min later; ~$130K ($50K trading + $80K callout rewards); Bubblemaps could not confirm wallet control; [named person] acknowledged the methods | The figures hold per The Defiant, Coin Edition and DiarioBitcoin. Bubblemaps clarified that the $130K covers only the five wallets. The acknowledgment rests on one secondary line (Coinotag: '[named person] had acknowledged using the methods described'), and no direct statement from [named person] was found. These were not checked: Crypto Economy's $125K variant, and 'profile links only his public wallet'. All of this is an allegation, with no charges. |
| **holds** | Bubblemaps case: [named person]: 49 callouts; public + 3 side wallets bought before callouts; selling ~3 min after; ~$125K ($45K trading + $80K rewards) | Holds. The side wallets bought in the same second as his public wallet. Selling often happened while he was still promoting. He has about 88,000 followers. Outlets note that wallet ownership is not independently established. One crypto.news extract confuses this case with [named person]'s (5 wallets, 61%), so do not mix the two cases' numbers. |
| **overstated** | Bubblemaps case: [named person] (Oct 26 / Nov 5, 2026): public wallet ~-$70K, side wallets ~+$270K; 2 hops from wallet funding deployers of STONKINU, BOP, QUEEF, HEV, LLAMA; thousands of intermediary wallets; fresh wallets buying 0.5–1%; [named person] said he had long known some teams | Only +$270K / -$70K holds (Coinfomania, Coinotag). Coinfomania loosely ties the case to a 'bundling operation linked to STONKINU'. These were not found: '2 hops', the BOP/QUEEF/HEV/LLAMA list, 'thousands of intermediary wallets', '0.5–1%', the Oct 26 date (sources are dated November), and [named person]'s 'long known the teams' remark. Bitquery's separate analysis found 542 wallet addresses across 5 of 6 [named person]-linked tokens, with about $252K in estimated proceeds. It stresses that these are addresses, not people and not wallets [named person] is shown to own, and that it did not contact him. |
| **holds** | Bubblemaps case: [named person] (Nov 9, 2026): ~30 linked wallets extracted ~$1.74M since May 7 across 27,000+ tokens; linked to serial deployer 3z4vj (rugged thousands incl. $CUPSEY, $1.3M profit); 400+ snipes; $331K callout rewards; only reply a meme | Holds as Bubblemaps' allegation. The 27,000+ figure is all tokens traded by the linked wallets. Only about 3,000 were profitable or went through the side-wallet operation. Bubblemaps also cites about $2.0M in labeled flows back to the operational group. Not found: the 'meme reply' and the exact Nov 9 date. No response from [named person] was found at all. AiCoin reports about 230,000 followers. |
| **unsupported** | Bubblemaps case: [named person] (~Nov 20, 2026): 9 wallets, ~$340K on 760 tokens vs ~$50K public; funded a deployer with 400+ launches | Three searches found no source that names [named person] or gives any of these figures. Two search summaries mention a Bubblemaps post teasing a new investigation without naming the target. Do not use any of it, and never name [named person]. |
| **overstated** | [named person]: signed by Pump.fun as creative partner Oct 20, 2026; rumored $40M TRUMP profit; Bubblemaps (Nov 5, 2026) estimated ~$6M and alleged concealed related wallets | These hold: the Oct 20, 2026 partnership; the $40M claim, described as unverified; Bubblemaps' estimate of about $6M, 'based on our analysis and estimates'. Not found: the Nov 5 date (Protos and Forklog say Bubblemaps traced his wallets on the day of the 'Project [named person]' crash) and any 'concealed wallets' allegation. The research omits material context. A Project [named person] token promoted from his X account rose to about $15M market cap, the post vanished about 30 minutes later, and the token fell more than 98%. Early 'account hacked' claims were questioned by on-chain investigators and remain unconfirmed. Alon reposted the promo, then removed the repost. [named person] then remo |
| **holds** | Bubblemaps' own caveats: 'analysis and estimates'; clustering/timing alone don't prove ownership or manipulation; no KOL case has led to charges | Holds: Bubblemaps uses 'analysis and estimates', says a cluster is not proof of wrongdoing, and outlets say the wallet links do not establish control or intent. 'No charges' is an absence of evidence. None appeared in my searches, but I could not run an exhaustive check, so write 'no charges have been reported'. |
| **unsupported** | LIBRA: Milei post Feb 14, 2025; ~$4.5B peak; Bubblemaps 82% clustered; $87M–$107M liquidity pulled; [named person] ~$100M; Nansen 86% of 15,431 wallets lost $251M | Not re-checked because the search budget ran out. These match my background knowledge (pre-June-2026), but verify on theblock.co/post/342266 and the Bubblemaps blog before use. Keep all figures attributed: 'Bubblemaps said...', 'Nansen estimated...'. |
| **unsupported** | LIBRA insiders: [named person] acknowledged sniping; Bubblemaps links MELANIA, LIBRA and YZY sniper wallets; ~$12M on YZY | Not re-checked because the search budget ran out. These are Bubblemaps attributions and must stay framed as such. |
| **unsupported** | LIBRA legal status: Hurlock v. Kelsier (S.D.N.Y.) amended complaint dismissed Sept 29, 2026; Argentine congressional commission (Nov 2025) cited Milei's 'essential collaboration'; judicial probe ongoing | The Sept 29, 2026 dismissal is after my knowledge cutoff and I could not search it before the budget ran out. Treat it as unverified until checked on CourtListener. A civil dismissal is not an exoneration, and the script must not present it as one. |
| **unsupported** | $HAWK legal status: E.D.N.Y. securities class action (Dec 2024) vs [named person], overHere, So, Tuah The Moon Foundation; [named person] not a defendant; her lawyer says SEC closed probe (Mar 2025) | Not re-checked. This matches my background knowledge. If it is used, say [named person] was 'not named as a defendant' and that her lawyers said the SEC closed its inquiry. Never say 'the SEC cleared her'. |
| **unsupported** | Solidus Labs (May 2025): ~98.6% of Pump.fun tokens show rug-pull or pump-and-dump traits; Pump.fun disputed it | Not re-checked. This matches my background knowledge of CoinDesk's May 7, 2025 coverage. If it is used, attribute it and include Pump.fun's rebuttal. Present it as heuristic 'traits', not proven fraud. |
| **unsupported** | Dune (Jan 2025): ~0.41% of ~13.55M wallets realized >$10K; 293 wallets $1M+ | Not re-checked. Even if accurate, the story beat's 'ever realized more than $10K' misstates it. It was a snapshot as of January 2025, counted realized PnL only, excluded post-graduation trading, and was disputed by the founder. Say 'as of early 2025, one on-chain analysis found fewer than 1 in 200 wallets had realized more than $10,000'. |
| **unsupported** | Chainalysis: 3.59% of 2024 token launches (74,037) showed possible pump-and-dump patterns; ~94% of suspect pools rugged by pool creator | Not re-checked. This matches my background knowledge of the Chainalysis 2025 Crypto Crime report. |
| **overstated** | Aguilar v. Baton (S.D.N.Y. 1:25-cv-00880) history: filed Jan 2025; amended Jul 23, 2025 adding Solana/Jito and RICO; Dec 9, 2025 leave to amend after 5,000+ chat logs; refiled Jan 14, 2026 | These hold: case number 1:25-cv-00880, Judge McMahon, the Jan 30, 2025 filing (Law360 case page), and the Jul 23, 2025 expansion naming Solana and Jito executives (The Block headline). Not checked: the Dec 9, 2025 leave to amend, the 5,000+ chat logs and the Jan 14, 2026 refiling. The 'safe' label should be 'with_care'. |
| **overstated** | Aug 31, 2026 ruling: RICO Counts I–II survive for Carnahan and Okafor vs Baton, [named person], [named person], [named person]; enterprise incl. 25 unidentified promoters; Aguilar's RICO dismissed (no domestic injury); Solana defendants dismissed (with prejudice); securities claim on FRED/GRIFFAIN dismissed with prejudice; memecoin trading not 'placing a bet' under NY law | These hold: RICO and RICO conspiracy survive for Carnahan and Okafor against Baton and the three founders; Aguilar was dismissed for no domestic RICO injury; the Solana entities were dismissed; FRED and GRIFFAIN were found not to be securities, with prejudice (fact-specific). Count V was held duplicative of the RICO fee theory. The filing is ECF 184 on CourtListener (title seen, not opened). Not found: the '25 unidentified promoters' count and 'association-in-fact' wording; 'with prejudice' for the Solana defendants (unverified). The gambling holding conflicts across sources. One says the court rejected the gambling predicates entirely, another says the wire fraud, illegal gambling and money |
| **unsupported** | SEC/DOJ Dec 2022 'Atlas Trading' stock pump case: dismissed Mar 2024, revived by Fifth Circuit Oct 2, 2025, trial set May 3, 2027, all pleaded not guilty | Not re-checked because the search budget ran out. The trial date is after my knowledge cutoff. Story beat 10 ('revived and set for trial in 2027') must not air until the DOJ case page is checked. It is also a stock case, not crypto. |
| **unsupported** | McAfee/[named person] 'Coin of the Day' charges (Mar 5, 2021); >$2M alleged | Not re-checked. This matches my background knowledge. McAfee died before trial. [named person]'s outcome is unverified, so never call him convicted. |
| **unsupported** | SEC v. Kardashian settled Oct 3, 2022: $1.26M; undisclosed $250K for EMAX; neither admitted nor denied; 3-year promotion ban | Not re-checked this session, so it cannot be marked holds. It matches widely reported SEC release 2022-183 and is low risk. Keep 'neither admitted nor denied'. |
| **unsupported** | SEC staff statement Feb 27, 2025: typical meme coins generally not securities; non-binding; Crenshaw dissent | Not re-checked. This matches my background knowledge. The dissent's title 'What Does it Meme?' should be checked on sec.gov before it is quoted. |
| **unsupported** | Kishu Inu creator [named person] indicted Oct 6, 2026 (N.D. Ill.), 3 wire-fraud counts, ~$9M alleged rug | This is after my knowledge cutoff and I could not search it. It is the highest-risk unverified item, because it names a private individual as indicted. The story beat ('a memecoin creator was indicted for an alleged $9M rug') must not air until the justice.gov release has been opened. Even then, do not name him. |
| **unsupported** | Regulators' advice: Investor.gov says fraudsters pay touts; CFTC says don't buy on single tip; tips to CFTC.gov/TipOrComplaint and SEC.gov/tcr | Not re-checked because the hosts are blocked. This matches my background knowledge and is low risk. Confirm both URLs resolve before putting them on screen. |
| **unsupported** | Viewer checks: Bubblemaps cluster/bundle views, common funders, deployer history on Solscan, RugCheck | Not re-checked. These are educational and low risk, but keep them generic: no affiliate or referral links, and no endorsement of any tool. The thresholds are vendor rules of thumb. |

## Must not say (binding for the script)

- Any real caller's name, handle or likeness ([named person], [named person], [named person]/[named person], [named person], [named person], [named person]), or exact figures that identify their cases ($1.74M, $331K, 27,000 tokens, 534 calls, 61%, +$270K/-$70K, 3z4vj)
- 'Pump.fun is a scam / rigged casino / racketeering enterprise / criminal operation', or 'a judge found Pump.fun...' (the RICO claims were only allowed to proceed)
- 'Pump.fun's founder admitted most users lose' (alleged in a complaint, unverified)
- 'Pump.fun pays influencers $100K a month' or 'Pump.fun pays callers to dump on you'
- 'The court ruled memecoin trading isn't gambling' or '...is illegal gambling' (sources conflict)
- '25 promoters were part of the enterprise' (not verified)
- 'Callers make $10k–$100k per call' (no source)
- 'Past payouts won't be clawed back' or 'the daily pot can be zero' (not found in sources)
- 'Most of Pump.fun's revenue goes to buybacks' (not supported)
- 'CoinGecko found only 1% graduate' (CoinGecko coverage gives no graduation rate), or 'only 1% ever graduate' stated as a fixed fact
- 'Only 0.41% of traders ever made $10K' (a January 2025 snapshot of realized PnL, disputed)
- '98% of Pump.fun coins are scams/fraud' as fact (Solidus heuristic, disputed by Pump.fun)
- Exact current fee percentages attributed to Pump.fun's official fee page (not verified)
- 'Bubblemaps proved / exposed / caught' (say 'alleged' or 'estimated')
- 'Milei scammed Argentines' / '[named person] stole $100M' / 'Hawk Tuah girl rug-pulled fans' / 'the SEC cleared her'
- 'The LIBRA case was thrown out, so they're innocent' (dismissal unverified, and not an exoneration)
- 'A memecoin creator was indicted for a $9M rug' (Kishu Inu indictment unverified), and [named person]'s name in any case
- 'The influencer pump case goes to trial in 2027' (unverified)
- Any named person called 'convicted', 'guilty' or 'fraudster' (none of the cases listed has a criminal conviction)
- 'Memecoins aren't securities, so it's legal' (non-binding SEC staff view, and fraud and manipulation remain illegal)
- 'Graduated' or 'LP burned' means safe
- Any how-to: setting up or funding side wallets, funding hops, fresh-wallet seeding, Jito bundles, sniper bots, mixers, OTC cash-out, timing buys before posts, evading Bubblemaps
- Real contract addresses, real tickers being called, referral or affiliate links, Telegram links, 'follow my wallet'
- Any income promise or aspirational payout figure ('you'll earn...', 'top callers make six figures')
- The livestream self-harm or gun incidents in any detail (the gun detail is unverified)
- [named person] case details in any form (no source found)
- '[named person] hid wallets' or any Project [named person] hack/rug claim

## Defamation risks

- Named KOLs ([named person], [named person], [named person]/[named person], [named person], [named person]): everything against them is a private analytics firm's estimate (Bubblemaps). No charges, lawsuits or adjudication have been reported, and outlets stress that wallet ownership and intent are not established. Naming, picturing or hinting at any of them (handles, avatars, look-alike names, their exact figures such as $1.74M, $331K, 27,000 tokens, 534 calls, 61%, $270K/-$70K, the 3z4vj deployer, STONKINU) would imply a crime the sources do not establish. Keep the protagonist a clearly fictional composite and use rounded, generic numbers.
- [named person]: no source could be found for this case at all, so naming him would repeat an unverified accusation. Never name or allude to him.
- [named person]: the researcher's 'concealed wallets' allegation was not found. The Project [named person] crash has a disputed hack claim and no statements from [named person] or Pump.fun. Any allusion risks implying a rug pull that nobody has established.
- Pump.fun / Baton Corp. and [named person], [named person], [named person]: these are civil RICO allegations that survived a motion to dismiss. They are pleadings, not findings. Calling the platform a 'racketeering enterprise', 'rigged casino', 'scam' or 'fraud', or saying the founders 'knew users would lose' (from unverified private messages in the complaint), goes beyond the record. The '25 unidentified promoters' detail and the gambling holding are unverified or conflicting. The $100K/month offer is an unconfirmed screenshot claim. Do not suggest Pump.fun pays callers to dump on followers.
- The 'house always got paid' ending: fine as a fact about fees (the platform earns on every trade), but pairing it with 'rigged' or 'the game was fixed' echoes the plaintiffs' allegations as if they were fact.
- [named person] and the [named person] promo: he reposted and then removed the repost. Do not imply coordination or foreknowledge.
- Javier Milei: he denies wrongdoing. The congressional finding came from an opposition-led commission, the judicial probe is ongoing, and there is no conviction. Do not say he scammed or rug-pulled anyone.
- [named person]: 'rugged LIBRA' is Bubblemaps' characterization and must be attributed. The reported U.S. civil dismissal (Sept 29, 2026) is unverified and is not an exoneration in any case. Do not say he 'stole' money.
- [named person]: she is not a defendant. 'The SEC cleared her' is her lawyers' account. Do not imply she defrauded fans.
- $HAWK defendants ([named person], [named person], overHere, Tuah The Moon Foundation): civil allegations only, with current status unknown.
- [named person] and co-defendants: charged, pleaded not guilty, presumed innocent. The 2027 trial date is unverified. This is a stock case, so do not present it as a crypto-caller precedent.
- [named person]: the indictment itself is unverified (post-cutoff, not opened). Naming him on an unverified report is a serious risk. Do not name him, even if it is verified.
- Kim Kardashian: settled without admitting or denying. Do not say she was 'found guilty' or committed 'fraud'.
- John McAfee and [named person]: McAfee died before trial and [named person]'s criminal outcome is unverified. Do not say either was convicted.
- [named person] and [named person]: unproven payment claim that [named person] denies. Leave both out entirely.
- Real token tickers (FRED, FWOG, GRIFFAIN, STONKINU, BOP, QUEEF, HEV, LLAMA, CUPSEY, ZERO, KIMCHI): showing them next to 'rug' or 'dump' imagery implies their creators committed fraud. Use invented tickers. Check that each invented name is not a well-known live token, and add an on-screen fiction disclaimer.
- Bubblemaps and Bitquery brands: do not show real Bubblemaps UI or X posts 'exposing' the fictional character, because that implies they made claims they never made. Use a fictional 'on-chain investigator'. Do not mock up posts from real accounts with invented text.

## YouTube policy risks

- Spam, deceptive practices & scams: depicting a pump scheme is allowed as education or narrative, but the video must not work as a promotion. Do not show live contract addresses, real tickers being 'called', Pump.fun or any launchpad referral or affiliate links, Telegram or Discord invite links, or 'link in bio / follow my wallet' calls to action. Keep descriptions free of crypto links and trading-bot sponsors.
- Harmful or dangerous / instructional fraud: do not give a usable playbook. Leave out how to set up or fund side wallets (funding hops, fresh wallets, mixers), Jito bundling, sniper-bot configuration, buy-X-seconds-before-posting timing, OTC cash-out routes, and ways to evade clustering tools. Show the 'fork in the road' as a consequence-focused montage, with the timing described only as what investigators alleged after the fact.
- Financial and income claims: no 'you can make $X calling coins', no leaderboard payout screens shown as aspirational, no 'top callers earn six figures'. Every earnings figure must be attributed ('an analytics firm estimated...'), paired with the loss side ($13 median reward; followers' losses), and framed as alleged. Add a spoken and on-screen 'not financial advice / education only' line. Title and thumbnail must not promise income: avoid 'How to become a top caller' or '$1M from memecoins'.
- Get-rich-quick framing: the 'POV / your life as' format can read as aspirational. Keep the arc as a cautionary tale and resolve it with consequences, not a win.
- Self-harm and violence: the 2024 livestream controversy involved self-harm threats tied to coin prices, and the gun detail is unverified. Do not depict or dramatize it. At most say 'dangerous stunts led the platform to shut streaming down'.
- Paid promotion disclosure: if any part of the video is sponsored, tick YouTube's paid-promotion box. Avoid crypto-exchange, launchpad or trading-tool sponsors for this video, which would undercut the 'treat every call as an ad' message and could breach ad policies.
- Real people's likeness and synthetic content: do not animate recognizable real people (Milei, [named person], [named person], the KOLs) or fabricate their quotes or voices. If any realistic synthetic depiction of a real person were used, it would need YouTube's altered/synthetic disclosure, so it is simpler to avoid it.
- Audience setting: this is a 2D-animated video for adults about gambling-like speculation. Mark it 'not made for kids' so it is not misclassified.
- Numbers drift: fee rates, graduation rates (6.7% one-day spike in Jul 2026; 0.26% elsewhere) and Callout Rewards terms change often. Show 'as of' dates on screen so the video does not later read as a misleading claim.

## Researcher's facts (before the fact-check; verdicts above take precedence)

### [confirmed · safe] Pump.fun launch date and operator

Launched January 19, 2024 (Wikipedia; Decrypt says 'January 2024'). Run by Baton Corporation Ltd.; reported co-founders [named person], [named person], [named person] (all named defendants in the S.D.N.Y. case). Some sources say the founders' identities are not fully verified. CoinGecko's dataset begins Jan 14, 2024; that is the start of its data, not the launch date.

Sources: https://en.wikipedia.org/wiki/Pump.fun · https://decrypt.co/resources/what-is-pump-fun-the-solana-meme-coin-factory · https://www.theblock.co/post/338170/investor-sues-pump-fun-for-losses-on-highly-volatile-memecoins-alleging-securities-violations

### [conflicting · with_care] How a launch works: bonding curve, then graduation

Anyone can create a coin, and it trades first on a bonding curve. When the curve fills, the coin 'graduates' and its liquidity moves to a DEX. The 2024-era figures that get repeated most are about 85 SOL in the curve, a ~$69,000 market cap, a 1.5 SOL graduation fee and a 6 SOL migration fee to Raydium. Guides say Pump.fun's own docs do not publish a numeric threshold, and one guide calls the $69k/1%/1.5 SOL figures stale 2024 numbers. Reports also say LP tokens are burned at graduation, but that does not make a coin safe, because the dev and other holders can still sell.

Sources: https://blog.snipethem.com/blog/pumpfun-bonding-curve · https://moby.win/learn/pumpfun/ · https://www.dextools.io/tutorials/bonding-curves-explained-pump-fun · https://app.dexlab.space/token/listing/pump-fun-graduation

### [confirmed · safe] Graduated tokens now migrate to PumpSwap (Pump.fun's own DEX)

PumpSwap launched March 20, 2025. Graduated tokens move to it instantly instead of Raydium, and it removed the 6 SOL migration fee. The launch fee was 0.25% per swap (0.20% to LPs, 0.05% to the protocol). Fees were later restructured into tiers.

Sources: https://www.theblock.co/post/347360/pump-fun-launches-dex-called-pumpswap-to-instantly-migrate-graduated-tokens · https://cryptoslate.com/pumpfun-launches-its-own-dex-called-pumpswap-amid-falling-revenue/

### [confirmed · with_care] Current fee structure (official fee page, as surfaced by search)

Bonding curve: 1.25% total (0.30% creator, 0.95% protocol, 0% LP). Graduation: 0.015 SOL per coin. PumpSwap canonical pools: market-cap sliding scale, with the creator share falling from about 0.95% to 0.05% as market cap rises (third-party guides put total fees at 1.25% down to 0.30%). Creator fees apply to coins on the curve or PumpSwap from May 13, 2025. Fees change often, so check the page on the day of publishing.

Sources: https://pump.fun/docs/fees · https://coinpaprika.com/education/launchpad-fees/ · https://www.theblock.co/post/354038/pumpswap-revenue-tokens

### [confirmed · safe] Creator rewards: revenue sharing (May 2025) and Project Ascend dynamic fees (Sept 2025)

PumpSwap added creator revenue sharing on May 13, 2025, starting at 0.05%. Project Ascend was announced Sept 2, 2025, with 'Dynamic Fees V1': creator fees start at 0.95% and fall to 0.05% at higher market caps (Solanafloor cites a 98,240 SOL top tier). Creators earned about $2.1M (Cryptorank) or $2.4M+ (Solanafloor) in the first 24 hours.

Sources: https://www.theblock.co/news/defi/2025-05-13-pumpswap-revenue-tokens-354038 · https://x.com/Pumpfun/status/1962916227090731353 · https://solanafloor.com/news/pump-funs-new-creator-fee-model-pays-2m-24-hours · https://cryptorank.io/news/feed/1b461-pump-fun-creators-earn-2-1-m-in-24-hours-after-project-ascend-launch

### [confirmed · safe] Livestream controversy and policy change

Pump.fun suspended livestreaming on Nov 25, 2024 after streams showing threats of self-harm tied to coin prices and a man firing a gun, among others. The company said it had doubled human moderators. It reopened streaming to 5% of users on April 4, 2025 and to all users on April 11, 2025, under a Livestream Moderation Policy that allows terminations and suspensions. Decrypt later reported streamers 'needing crazier content to pump their tokens'.

Sources: https://blockworks.com/news/pumpdotfun-suspends-livestream-feature · https://www.dlnews.com/articles/markets/solana-memecoin-launchpad-removes-livestream-feature/ · https://www.theblock.co/post/349647/memecoin-launchpad-pump-fun-reopens-livestreaming-to-5-of-users-with-stricter-moderation-rules · https://cryptoslate.com/pumpfun-fully-restores-streaming-feature-with-stricter-moderation-policy/ · https://decrypt.co/352919/creator-capital-markets-pump-fun-streaming-twitch

### [conflicting · with_care] Scale: tokens launched

CoinGecko counted 18.67M tokens launched from Jan 14, 2024 to Jun 18, 2026 (reported late June 2026). Other counts: about 11.9M (early-2026 articles), nearly 13M (undated), and 24M (AMBCrypto, source unclear and an outlier). No official Pump.fun cumulative figure was found.

Sources: https://crypto.news/pump-funs-token-factory-has-a-69-launch-day-death-rate-coingecko/ · https://cryptobriefing.com/pump-fun-token-survival-rate-study/ · https://ambcrypto.com/pump-funs-24m-launches-yield-just-312-tokens-above-100k-what-gives/

### [confirmed · safe] Most tokens die on day one (CoinGecko analysis)

Of 18.67M tokens, 68.67% (about 12.8M) made their last bonding-curve trade on launch day. Only 4.55% (about 850,000) were still trading after 90 days. About 1% graduated. Method: bonding-curve trades only, so post-graduation DEX trading may be undercounted.

Sources: https://crypto.news/pump-funs-token-factory-has-a-69-launch-day-death-rate-coingecko/ · https://cryptopotato.com/nearly-70-of-pump-fun-tokens-die-on-launch-day-coingecko/ · https://cryptobriefing.com/pump-fun-token-survival-rate-study/

### [confirmed · with_care] Share of tokens that graduate

Usually around 1%, and it depends on the window. Full-year 2025: 0.89% of 11.6M tokens. Best week: 1.67% (Nov 2024). Jul–Aug 2025: about 0.7–0.8%. Feb 2026 week: 1.15%. Lifetime about 1.4% per Dune-based reporting. An academic study of 655,770 tokens (Sep–Oct 2025) found 0.63%. Published estimates range from 0.198% to 5%.

Sources: https://cointelegraph.com/news/pump-fun-memecoins-are-dying-at-record-rates-less-than-1-survive · https://www.cryptopolitan.com/pump-fun-graduating-tokens-break-to-1-15-of-new-launches/ · https://solanacompass.com/news/pumpfun-launched-42000-tokens-in-one-day-fewer-than-2-will-ever-reach-a-dex · https://arxiv.org/html/2602.14860v1 · https://koal.fun/blog/bonding-curve-graduation-rates-analysis

### [confirmed · safe] The platform's take: over $1B in cumulative revenue

The Block (Mar 12, 2026): Pump.fun was the first Solana app to pass $1B in cumulative revenue. DefiLlama: about $1.08B (about $321M in 2024, $664M in 2025, $98M in 2026 to date). Most revenue goes to PUMP buybacks. Earlier, the PUMP ICO on July 12, 2025 raised $500M (Cointelegraph) or $600M (The Block/Bloomberg) in about 12 minutes at $0.004 per token.

Sources: https://www.theblock.co/post/393358/pump-fun-becomes-solanas-first-1b-revenue-platform · https://www.theblock.co/post/362320 · https://cointelegraph.com/news/pump-fun-ico-raises-500m-sells-out-minutes

### [confirmed · with_care] Pump.fun 'Callout Rewards': the platform pays callers

Users post token 'callouts' to followers in the Pump.fun app. When followers trade from a callout, the caller earns a daily USDC share of a fixed pool based on their ranking. The launch date is disputed: an initial version in January 2026 (FXStreet), with a major upgrade on Aug 7, 2026 / mid-August 2026. The initial budget was reportedly about $15M. Terms say the daily pot can be zero, and it is not available to UK persons. Oct 4, 2026: rewards cut for high-frequency posting. Oct 10, 2026: co-founder Alon said 'Volume will cease to be the main attributer', rewards would be tied to whether followers profited, low-cap callouts were 'nerfed', and past payouts would not be reversed. Nov 17, 2026: Alon said about $33M had been paid to nearly 55,000 callers.

Sources: https://www.odaily.news/en/newsflash/509417 · https://invezz.com/news/2026/08/14/pump-surges-as-pump-fun-pays-users-to-call-tokens-can-0-003-break-next/ · https://cryptobriefing.com/pump-fun-callout-rewards-follower-profits/ · https://x.com/a1lon9/status/2092662794206236742 · https://thedefiant.io/news/tokens/bubblemaps-alleges-anglio-linked-wallets-traded-ahead-of-pump-fun-calls · https://crypto.news/pump-fun-alleged-100k-monthly-influencer-deal/

### [unverified · with_care] Who earns callout rewards, and what happens to followers (Sparsity Research, Nov 10, 2026)

About 51,115 wallets collected about $29.6M since August. The top 10 wallets got about 16%, and the median recipient got $13. Of 14 callers tracked, 10 had a median recommended token below $100k market cap, and their followers collectively lost about $926,000 one day after the recommendations. Only secondary coverage was found, not the original report.

Sources: https://crypto.news/pump-fun-alleged-100k-monthly-influencer-deal/ · https://cryptonews.net/news/altcoins/33777608/ · https://www.kucoin.com/news/flash/pump-fun-allegedly-offered-influencer-100k-month-to-promote-tokens

### [unverified · avoid] Alleged $100K/month influencer offer from Pump.fun

[named person] posted screenshots, reportedly of an unnamed influencer offered $100,000/month in August 2026 to leave rival platform Fomo and call more tokens. The influencer says they declined. Not confirmed by Pump.fun.

Sources: https://crypto.news/pump-fun-alleged-100k-monthly-influencer-deal/ · https://en.cryptonomist.ch/2026/11/19/pump-fun-influencer-allegations/

### [confirmed · safe] What a 'side wallet' is, and Bubblemaps' call to launchpads

Bubblemaps uses 'side wallets' for addresses it links to a trader but that are separate from the trader's public wallet. On Nov 6, 2026 it said leaderboards, affiliate links and callout rewards let traders monetize audiences through side wallets ('Side wallets have become a business model'). It urged launchpads to audit top traders, expose side wallets and ban repeat offenders. No launchpad had adopted this as of reporting.

Sources: https://www.tokenpost.com/news/investing/52014 · https://pluang.com/en/news-feed/bubblemaps-mendesak-launchpad-audit-pedagang-teratas-dan-dompet-tersembunyi

### [confirmed · with_care] What 'bundles', 'clusters' and 'snipers' are

Bundle: wallets that buy in the same block as, or within seconds of, the launch. This can be sniping bots or a team preloading its own coin, and on Solana it is often done through a single Jito bundle, so creation and buys land together. Cluster: wallets linked by shared funding or transfers. Caveat from the sources: not all same-block buying is manipulation. A vendor source (which sells bundling tools) claims 29.3% of Sept 2026 launches had another wallet buy in the launch block.

Sources: https://blog.bubblemaps.io/whats-the-difference-between-bundle-cluster-2/ · https://blofin.com/en/academy/education/pumpfun/pump-fun-bundling-explained · https://terminal.raiden.wtf/blog/pump-fun-bundle-checker

### [confirmed · safe] The extraction pattern as Bubblemaps describes it ([named person] case)

4 operational wallets buy a token and pass it to 12 side wallets. The caller's public wallet then buys, copy traders follow, and the side wallets sell into that demand. In other Bubblemaps cases ([named person], [named person]), linked wallets bought about 20 seconds before the public call, or in the same block as the public wallet, and sold within minutes, before the public wallet did.

Sources: https://www.tokenpost.com/news/investing/53549 · https://x.com/bubblemaps/status/2119823688673751416 · https://www.tokenpost.com/news/people/61852

### [confirmed · safe] Telegram pump groups: CFTC description

CFTC advisory (Feb 2018, still live): pump-and-dumps are mostly anonymous and organized in public chat rooms or messaging apps, sometimes with thousands of members. Organizers target little-known tokens they control or can easily move, spread rumors, urge immediate buying, and post countdowns such as '15 mins left before the pump!'. The CFTC also has a newer messaging-app advisory.

Sources: https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/beware_virtual_currency_pump_dump.html · https://www.cftc.gov/LearnAndProtect/DigitalAssetFrauds

### [confirmed · safe] PumpCell: a documented Telegram pump ring (Solidus Labs, Dec 2025)

An invite-only Telegram group ran synchronized launches, sniper-bot buys and meme hype on Solana and BNB Chain, pushing micro-caps to seven-figure valuations within minutes. Estimated about $800K in profit in October 2025 alone, cashed out via CEXs and an OTC broker paying physical cash. Example: ZERO briefly reached about a $2M FDV in under an hour. Active since at least late 2024.

Sources: https://www.coindesk.com/business/2025/12/09/telegram-ring-ran-pump-and-dump-network-that-netted-usd800k-in-a-month-solidus-labs · https://www.soliduslabs.com/reports/crypto-pump-and-dump-report

### [confirmed · with_care] Paid, undisclosed promotion (ZachXBT leak, Sept 1, 2025)

ZachXBT published a leaked sheet of 200+ influencers approached to promote a token. Of 160+ who accepted, he said fewer than 5 disclosed the post as an ad. Memenetic claimed the campaign. Per-post rates vary by outlet: $750–$60,000, $50–$60,000, or $10k–$20k for top-tier accounts and $500–$1,500 for small ones. The full list has not been independently verified.

Sources: https://www.theblock.co/post/368956 · https://forklog.com/en/zachxbt-exposes-hundreds-of-influencers-for-undisclosed-token-promotions/ · https://www.ccn.com/news/crypto/zachxbt-leak-crypto-influencers-paid-promotions/

### [unverified · avoid] Premise check: '$10k–$100k per call'

No source found shows $10k–$100k per call as typical extraction. Bubblemaps' estimates are cumulative: [named person] about $130K across 534 calls, [named person] about $125K across 49 calls, [named person] about $1.74M across 27,000+ tokens since May 7, 2026. Simple division (our arithmetic, not a sourced statistic) gives roughly $240 per call for [named person] and $2,550 per call for [named person]. Five-figure sums per post do appear, but as paid-promotion fees (ZachXBT leak), not front-running profits.

Sources: https://thedefiant.io/news/tokens/bubblemaps-alleges-anglio-linked-wallets-traded-ahead-of-pump-fun-calls · https://crypto.news/bubblemaps-accuses-pump-fun-influencer-ethan-of-125k-scam/ · https://www.tokenpost.com/news/investing/53549 · https://www.theblock.co/post/368956

### [confirmed · with_care] Bubblemaps case: [named person] (Oct 14, 2026)

534 recommendations over about two weeks in October. 5 linked wallets bought before 61% of calls, about 20 seconds ahead on average, and began selling about 4 minutes later. Estimated $130K: about $50K from trading plus $80K from Pump.fun callout rewards (Crypto Economy gives $125K = $45K + $80K). Bubblemaps says [named person] acknowledged the methods. Bubblemaps could not independently confirm who controlled the wallets. Pump.fun's profile links only his public wallet.

Sources: https://thedefiant.io/news/tokens/bubblemaps-alleges-anglio-linked-wallets-traded-ahead-of-pump-fun-calls · https://www.tokenpost.com/news/people/32118 · https://blog.bubblemaps.io/key-opinion-leaders-are-leading-by-example-just-not-for-you/ · https://coinedition.com/crypto-live-news/bubblemaps-flags-anglio-linked-wallets-over-130k-in/

### [confirmed · with_care] Bubblemaps case: [named person] (Oct–Nov 2026)

49 token callouts. A public wallet plus 3 side wallets bought before callouts, and suspect wallets typically began selling within about 3 minutes. Estimated $125K: $45K trading plus $80K promotional/callout rewards. One outlet printed $12,500, which looks like a typo. No response from [named person] found.

Sources: https://crypto.news/bubblemaps-accuses-pump-fun-influencer-ethan-of-125k-scam/ · https://coinedition.com/bubblemaps-says-crypto-influencer-ethan-made-125k-from-token-callouts/

### [confirmed · with_care] Bubblemaps case: [named person] (X thread Oct 26, 2026; report Nov 5, 2026)

Public wallet about -$70K on the examined tokens. Linked side wallets about +$270K. The public wallet was 2 transfer hops from a wallet that funded deployers of STONKINU, BOP, QUEEF, HEV and LLAMA. Thousands of intermediary wallets were used to obscure the trail, and dozens of fresh wallets each bought about 0.5–1% of a token in a narrow window. [named person] said he had long known some of the teams.

Sources: https://www.tokenpost.com/news/investing/50277 · https://www.tokenpost.com/news/people/41537 · https://x.com/bubblemaps/status/2114773390414487697

### [confirmed · with_care] Bubblemaps case: [named person] (Nov 9, 2026)

About 30 linked wallets extracted about $1.74M from copy traders since May 7, 2026 (one outlet says six months), across 27,000+ tokens. Bubblemaps links [named person] to serial deployer '3z4vj', which it says launched and rugged thousands of tokens including $CUPSEY. [named person]'s side wallets sniped 400+ of those launches, and 3z4vj's trading profits were $1.3M. [named person] reportedly also collected $331K in callout rewards. The only reported reply was a meme, and no formal denial was found.

Sources: https://x.com/bubblemaps/status/2119823688673751416 · https://x.com/bubblemaps/status/2119823766905892990 · https://www.tokenpost.com/news/investing/53549 · https://cryptobriefing.com/bubblemaps-alleges-cupsey-solana-wallet-scheme/ · https://pluang.com/en/news-feed/bubblemaps-tuduh-cupsey-dompet-samping-crypto-1-7-juta

### [confirmed · with_care] Bubblemaps case: [named person] (~Nov 20, 2026)

9 wallets linked to the influencer traded alongside his public wallet on 5,000+ tokens since April. Estimated about $340K on 760 tokens, against about $50K for the public wallet on the same tokens. They often bought in the same block as the public wallet and sold before it after promotions. The public wallet funded a deployment address for a developer who has launched 400+ tokens since October and sold quickly. No response found.

Sources: https://www.tokenpost.com/news/people/61852 · https://www.tokenpost.com/news/investing/61850

### [confirmed · with_care] Bubblemaps case: [named person] and Pump.fun's KOL signing

Pump.fun co-founder Alon announced [named person] as a creative partner on Oct 20, 2026. [named person] was rumored to have made about $40M on TRUMP. Bubblemaps' Nov 5, 2026 cluster analysis (giveaway wallet plus linked wallets) estimated about $6M and alleged related wallets were concealed. Bubblemaps calls all of this 'analysis and estimates'.

Sources: https://blog.bubblemaps.io/key-opinion-leaders-are-leading-by-example-just-not-for-you/ · https://www.blockmedia.co.kr/archives/1161927 · https://airdropalert.com/blogs/who-is-kimchi-guide/

### [confirmed · safe] Bubblemaps' own caveats

Bubblemaps describes these findings as 'analysis and estimates'. Coverage stresses that clustering and timing alone do not prove common ownership, coordination or market manipulation, and none of the KOL cases has led to charges.

Sources: https://blog.bubblemaps.io/bubblemaps-investigates-crypto-kol-moves-onchain/ · https://coinedition.com/crypto-live-news/bubblemaps-flags-anglio-linked-wallets-over-130k-in/ · https://cryptobriefing.com/bubblemaps-alleges-cupsey-solana-wallet-scheme/

### [confirmed · with_care] LIBRA (Feb 2025): insider concentration and extraction

Javier Milei posted about LIBRA on Feb 14, 2025, and it briefly hit about a $4.5B market cap. Bubblemaps: 82% of supply sat in clustered insider wallets. Liquidity pulled is put at $87M or about $100M (Bubblemaps) and $99M by 8 wallets (Bankless Times). [named person] told Coffeezilla he held about $100M, and a Kobeissi Letter thread quotes him at about $110M. The '$107M' figure in the brief was not found in any source. Nansen: 86% of 15,431 wallets (gain or loss over $1,000) lost a combined $251M, 2,101 wallets made about $180M, and two wallets made $5.4M+ in 43 minutes.

Sources: https://blog.bubblemaps.io/how-hayden-davis-rugged-libra-for-100m-with-president-milei/ · https://www.banklesstimes.com/articles/2025/02/20/libra-scandal-gets-worse-insiders-took-99m-in-liquidity/ · https://www.theblock.co/post/342266/traders-of-solana-based-libra-memecoin-lost-251-million-nansen · https://decrypt.co/307025/some-wallets-still-trading-libra-despite-251-million-losses-nansen · https://en.wikipedia.org/wiki/$Libra_cryptocurrency_scandal

### [confirmed · with_care] LIBRA insider behaviour: sniping, and links to MELANIA and YZY

[named person] acknowledged that project-linked wallets sniped LIBRA at launch. Bubblemaps traced 44 wallets it believes [named person] controls, running from the MELANIA team wallet to the LIBRA sniper wallet to 14 YZY sniper wallets. The Block (Aug 25, 2025) reported about $12M made sniping YZY. A wallet tagged '0xcEA' made about $6M on LIBRA and $2.4M on MELANIA. No on-chain evidence was found that KOLs were paid or coordinated to promote LIBRA.

Sources: https://www.theblock.co/news/ecosystems/2025-08-25-libra-token-facilitator-earns-12-million-sniping-kanye-west-memecoin-bubblemaps-368164 · https://decrypt.co/336762/libra-wallets-linked-hayden-davis-made-12-million-kanye-west-meme-coin · https://blog.bubblemaps.io/melania-coin-melania-the-onchain-trail-linking-it-to-libra/

### [confirmed · with_care] LIBRA legal status

U.S.: in Hurlock v. [named person] (S.D.N.Y.), about $57.6M USDC was frozen in 2025 and the freeze was later lifted. The amended complaint against Kelsier, the [named person] defendants, ex-Meteora CEO Benjamin Chow and others was dismissed on Sept 29, 2026 (RICO counts failed to state a claim). Whether it was with prejudice, and whether there is an appeal, is unconfirmed. Argentina: an opposition-led congressional commission (Nov 2025) said Milei provided 'essential collaboration' and the facts were 'compatible with an alleged scam'. Milei denies wrongdoing, and an Argentine judicial probe is ongoing.

Sources: https://www.courtlistener.com/opinion/10595490/hurlock-v-kelsier-ventures/ · https://business.cch.com/srd/20260929_Hurlock-v-KelsierLabs_order100626.pdf · https://www.cryptotimes.io/2026/10/01/us-judge-dismisses-libra-m3m3-case-against-davis-kelsier/ · https://www.theblock.co/post/379796/argentinas-milei-provided-essential-collaboration-libra-project-congressional-report-finds · https://buenosairesherald.com/politics/libra-crypto-scandal-milei-used-presidential-role-to-spread-alleged-scam-congress-report-concludes

### [conflicting · with_care] $HAWK (Dec 4, 2024): insider and KOL-related behaviour

Launched around 10:00 PM UTC on Dec 4, 2024, peaked at about $490M market cap, and fell about 91% within about 3 hours. Bubblemaps said insiders held 96% of supply at one point (one report says 97%+; another says later revised to 79%). The team said the 96% cluster was deployer distributions under its tokenomics. One sniper wallet took 17.5% of supply and flipped it in about 90 minutes for $1.3M. [named person] posted 'not 1 KOL was given 1 free token', and an X community note said team and insiders had been selling. Bubblemaps' CEO called it a 'one-day pump and dump', with about $3.3M (£2.59M) in team profits per IBTimes.

Sources: https://blog.bubblemaps.io/how-hailey-welchs-hawk-token-became-a-500m-disaster/ · https://cointelegraph.com/news/hawk-tuah-memecoin-dumps-90-percent-outrage-token-launch-insider · https://cryptoslate.com/hawk-tuah-girls-claims-no-tokens-sold-as-memecoin-launch-sparks-crypto-community-backlash/ · https://www.ibtimes.co.uk/hawk-tuah-haliey-welchs-crypto-team-nets-259m-amid-botched-token-launch-fans-file-sec-complaints-1729511 · https://decrypt.co/295179/hawk-tuah-girls-meme-coin-faces-allegations-of-rug-pull-project-leads-deny-wrongdoing

### [confirmed · with_care] $HAWK legal status

Securities class action filed in E.D.N.Y. in December 2024 (Wolf Popper release: Dec 20, 2024; case numbers vary by source) against [named person], overHere Ltd, [named person] and the Tuah The Moon Foundation, alleging unregistered securities. [named person] is not a defendant. Her lawyer said in March 2025 that the SEC closed its probe without action, and she said in May 2025 that the FBI cleared her. The SEC does not confirm investigations. The current status of the civil case is unconfirmed.

Sources: https://www.theblock.co/news/business/2024-12-19-team-behind-hawk-memecoin-tied-to-hawk-tuah-girl-sued-for-alleged-securities-law-violations-331746 · https://www.mondaq.com/pressrelease/155052/$hawk-investors-notice-wolf-popper-llp-and-burwick-law-announce-the-filing-of-a-class-action-lawsuit-against-promoters-of-$hawk · https://www.theblock.co/news/markets/2025-05-21-hawk-tuah-girl-says-fbi-sec-cleared-her-of-legal-wrongdoing-in-memecoin-fiasco-355173 · https://www.tubefilter.com/2025/03/28/haliey-welch-sec-ruling-hawk-coin/

### [confirmed · with_care] Solidus Labs: ~98.6% of Pump.fun tokens show rug-pull or pump-and-dump traits (May 2025)

Covers tokens with at least 5 trades from January 2024 to March 2025. The body says 98.6%; the executive summary says 98.7%. Of about 7M tokens, only about 97,000 ever kept at least $1,000 in liquidity. 361,000 of 388,000 Raydium pools (93%) showed 'soft rug pull' characteristics. The method is heuristic. Pump.fun disputed it: 'What Solidus Labs lacks is a basic understanding of memecoins.'

Sources: https://www.coindesk.com/business/2025/05/07/98-of-tokens-on-pump-fun-have-been-rug-pulls-or-an-act-of-fraud-new-report-says · https://www.soliduslabs.com/reports/solana-rug-pulls-pump-dumps-crypto-compliance · https://cryptopotato.com/98-of-tokens-on-pump-fun-are-rug-pulls-or-fraud-report/

### [confirmed · with_care] Wallet profit distribution (Dune analysis, January 2025)

Of about 13.55M Pump.fun wallets, 55,296 (about 0.41%; 0.408% in one source) had realized more than $10,000 profit, 0.048% more than $100,000, and 293 wallets reached $1M+. A separate 6-month Dune analysis found about 2.4M wallets (about 56%) lost at least $1,000. Method: realized PnL only. Pump.fun's founder disputed it: the analysis excludes post-graduation Raydium trades, many wallets are bots, and about 30% of wallets made a single transaction. The data is nearly 2 years old.

Sources: https://www.chaincatcher.com/en/article/2161942 · https://www.chaincatcher.com/en/article/2161945 · https://bravenewcoin.com/insights/over-99-of-pump-fun-traders-miss-the-10k-mark · https://crypto.news/over-60-pump-fun-traders-saw-losses-less-than-0-01-made-over-1m/

### [confirmed · with_care] Chainalysis: pump-and-dump patterns across 2024 token launches

2025 Crypto Crime Report: 3.59% of tokens launched in 2024 (74,037 of about 2.06M) showed patterns possibly linked to pump-and-dumps. About 94% of DEX pools in suspected schemes appear to have been rugged by the address that created the pool. The figures are heuristic estimates of suspected activity, not confirmed fraud. Note how much lower this is than Solidus's 98.6%: the methods and definitions differ.

Sources: https://www.chainalysis.com/blog/crypto-market-manipulation-wash-trading-pump-and-dump-2025/

### [unverified · with_care] Co-founder's private messages: 'most lose' (alleged in court filing)

The amended Pump.fun complaint cites private messages in which co-founder [named person] allegedly acknowledged that most users lose money, comparing the platform to gambling. Unnamed 'KOL' informants allegedly supplied 'standard Pump.fun agreements'. A third informant relayed hearsay that Pump.fun buys early positions and sells to retail. The complaint also alleges some KOLs were paid to promote without disclosure and were told in advance which tokens to buy. DL News noted the evidence is thin, and these are allegations only.

Sources: https://www.dlnews.com/articles/defi/pump-fun-exec-says-most-lose-on-platform-per-lawsuit/ · https://www.kucoin.com/news/flash/pump-fun-lawsuit-reveals-founder-admits-most-users-suffer-losses

### [confirmed · safe] Aguilar v. Baton Corp. (Pump.fun class action, S.D.N.Y. 1:25-cv-00880): history

Carnahan v. Baton filed Jan 16, 2025, and Aguilar filed Jan 30, 2025, alleging Pump.fun took nearly $500M in fees selling unregistered securities (FRED, FWOG, GRIFFAIN). The cases were consolidated. The amended complaint of July 23, 2025 added Solana Labs, the Solana Foundation, Jito Labs and executives, plus RICO, illegal gambling ('rigged casino', 'slot machine') and wire fraud theories, and dropped the claim that all Pump.fun tokens are securities. On Dec 9, 2025, Judge Colleen McMahon granted leave for a second amended complaint after a confidential informant supplied 5,000+ internal chat logs, and the case was refiled on Jan 14, 2026.

Sources: https://www.theblock.co/post/338170/investor-sues-pump-fun-for-losses-on-highly-volatile-memecoins-alleging-securities-violations · https://www.dlapiper.com/en/insights/publications/2025/02/meme-coins-alleged-to-be-securities-in-two-new-class-actions · https://www.theblock.co/news/regulation/2025-07-23-burwick-law-names-solana-and-jito-executives-in-expanded-rico-case-against-pump-363996 · https://cointelegraph.com/news/pump-fun-lawsuit-slot-machine-rico · https://www.courtlistener.com/docket/69593359/aguilar-v-baton-corporation-ltd-dba-pumpfun/

### [confirmed · with_care] Aug 31, 2026 ruling in Aguilar v. Baton: what was decided

Judge McMahon granted the motions to dismiss in part. RICO Counts I–II survive for plaintiffs Kendall Carnahan and Michael Okafor against Baton, [named person], [named person] and [named person]. The complaint plausibly alleges an 'association-in-fact' enterprise of Baton, its founders and 25 unidentified memecoin promoters, run through the platform. Aguilar's RICO claims were dismissed (no domestic injury). All claims against the Solana defendants were dismissed (reported as with prejudice). The securities claim (Count III) about FRED and GRIFFAIN was dismissed with prejudice: those coins are not securities as pleaded, but the court did not rule that memecoins can never be securities. Reports say the court held that trading memecoins is not 'placing a bet' under New York law. Nothing has been found liable on the merits, and the case goes to discovery. No post-September schedule was found.

Sources: https://www.wolfpopper.com/news/court-allows-rico-claims-against-pumpfun-and-founders-to-proceed · https://www.law360.com/articles/2519804/meme-coin-platform-pump-fun-must-face-users-rico-claims · https://law.justia.com/cases/federal/district-courts/new-york/nysdce/1:2025cv00880/635992/184/ · https://www.courtlistener.com/opinion/10377722/aguilar-v-baton-corporation-ltd-dba-pumpfun/ · https://solanafloor.com/news/all-claims-against-solana-labs-and-foundation-dismissed · https://coinpaprika.com/education/launchpad-tokens-securities-pump/

### [confirmed · safe] SEC/DOJ Dec 2022 case against 8 social-media influencers ('Atlas Trading')

The SEC complaint was filed Dec 13, 2022 and announced Dec 14 (S.D. Tex. No. 4:22-cv-04306). It alleged an about $100M scheme of hyping STOCKS on Twitter and Discord, then selling; the DOJ alleged about $114M. This was a stock case, not crypto. The criminal indictment was dismissed Mar 20, 2024 under Ciminelli. The Fifth Circuit reversed on Oct 2, 2025 (U.S. v. [named person], No. 24-20143), relying on Kousisis. The DOJ case page (updated Aug 5, 2026) sets trial for May 3, 2027, and all defendants have pleaded not guilty. [named person] reportedly left the U.S. The status of the SEC civil case is unconfirmed. Nothing has been adjudicated on the merits.

Sources: https://www.sec.gov/newsroom/press-releases/2022-221 · https://www.sec.gov/enforcement-litigation/litigation-releases/lr-25591 · https://law.justia.com/cases/federal/appellate-courts/ca5/24-20143/24-20143-2025-10-02.html · https://www.justice.gov/criminal/criminal-vns/case/united-states-v-constantinescu-et-al · https://www.houstonchronicle.com/news/houston-texas/crime/article/appeals-court-revive-finance-bro-case-21126328.php · https://www.velaw.com/insights/insider-scoop-the-doj-struggles-to-prosecute-insider-trading/

### [confirmed · with_care] Crypto-influencer 'coin of the day' case (McAfee/[named person], 2021)

On Mar 5, 2021 the DOJ (S.D.N.Y.), CFTC and SEC charged John McAfee and [named person]. The allegation: from Dec 2017 to Feb 2018 they bought little-known coins, touted them as 'Coin of the Day'/'Coin of the Week' on McAfee's Twitter, then sold, for more than $2M in alleged profits. McAfee died in June 2021, before trial (background knowledge, not from the sources found). [named person] pleaded not guilty, and an SEC judgment (2022) reportedly fined him about $375K. His criminal outcome is unverified.

Sources: https://www.cnbc.com/2021/03/05/john-mcafee-indicted-on-cryptocurrency-fraud-charges.html · https://www.cftc.gov/media/5741/enfjohndavidmcafeecomplaint030521%20/download · https://www.benzinga.com/markets/cryptocurrency/22/07/28116683/john-mcafees-associate-fined-for-ico-pump-and-dump-scams-heres-what-the-sec-said

### [confirmed · safe] Undisclosed paid promotion: SEC v. Kardashian (settled)

Oct 3, 2022: Kim Kardashian paid $1.26M ($1M penalty plus about $260K disgorgement) to settle SEC charges over an undisclosed $250K payment for a June 2021 Instagram post about EMAX. She neither admitted nor denied the findings and agreed not to promote crypto for 3 years.

Sources: https://techcrunch.com/2022/10/03/kim-kardashian-charged-by-sec-for-pushing-crypto-reaches-1-26m-settlement · https://www.axios.com/2022/10/03/kim-kardashian-sec-crypto-settlement · https://www.bloomberg.com/news/articles/2022-10-03/kim-kardashian-to-pay-1-3-million-to-sec-over-crypto-touting

### [confirmed · safe] SEC staff: typical meme coins are generally not securities (Feb 27, 2025)

In a statement, the Division of Corporation Finance staff said typical meme coins generally are not securities. Fraud is still covered by other laws (e.g., wire fraud, CFTC anti-fraud). The statement is non-binding staff guidance, and Commissioner Crenshaw dissented ('What Does it Meme?').

Sources: https://www.sec.gov/newsroom/speeches-statements/crenshaw-response-staff-statement-meme-coins-022725 · https://www.wilmerhale.com/en/sitecore/content/whlaunch/home/research/news-publications/20250313-the-state-of-meme-coin-regulation-sec-staffs-statement-and-other-considerations · https://www.polsinelli.com/publications/staff-statement-on-meme-coins-signals-shift

### [confirmed · with_care] Memecoin creator indicted for rug pull (Kishu Inu, Oct 2026)

[named person] ('[named person]'), 28, of Fayetteville, AR was indicted on Oct 6, 2026 (N.D. Ill.) on 3 wire-fraud counts. Prosecutors allege he secretly allocated tokens to himself at launch (about 6% of supply vs a public claim of 1.7%), made false statements, and sold for about $9M ($9.8M per TokenPost), hiding the sales via multiple wallets and mixers. He denies wrongdoing. Charged, not convicted. He is a creator, not a caller.

Sources: https://www.justice.gov/usao-ndil/pr/creator-digital-asset-kishu-inu-indicted-allegedly-operating-9-million-rug-pull-fraud · https://www.tokenpost.com/news/regulation/27840 · https://www.cryptotimes.io/2026/10/08/kishu-inu-founder-indicted-on-wire-fraud-charges/

### [confirmed · safe] Regulators' advice for viewers

SEC/Investor.gov: fraudsters sometimes pay people to tout investments on social media, and investors should not decide on social media information alone. CFTC: don't buy on a single tip, especially over social media; be wary of sudden spikes and promises of quick wealth. Market manipulation is illegal, and many participants lose money. Tips go to CFTC.gov/TipOrComplaint and SEC.gov/tcr.

Sources: https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-alerts/social-media-and-investment-fraud-investor-alert · https://www.investor.gov/additional-resources/spotlight/directors-take/finfluencers-celebrities-social-media · https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/beware_virtual_currency_pump_dump.html

### [confirmed · safe] Viewer checks: holder concentration, clusters, bundles, dev and funding

Bubblemaps guides: add up the holdings of wallets in the same cluster to get true insider control, and use the bundle view for launch-block buyers. Vendor guides add: check whether many wallets were funded by the same address (Bubblemaps can miss coordinated wallets that bought at different times), check the dev/deployer history on Solscan (serial deployers launch hundreds of tokens), watch for slow drip-selling, and use RugCheck for a quick concentration and safety scan. Caveat: a concentrated new token is not proof of a scam, and the thresholds (e.g., 'bundle >10% = red flag') are rules of thumb from tool vendors.

Sources: https://blog.bubblemaps.io/how-to-analyze-meme-coin-holders-with-bubblemaps/ · https://blog.bubblemaps.io/how-to-spot-a-rug-pull-using-bubblemaps-before-it-happens/ · https://blog.bubblemaps.io/whats-the-difference-between-bundle-cluster-2/ · https://madeonsol.com/blog/how-to-analyze-solana-token-holders · https://blofin.com/academy/education/pumpfun/pump-fun-holder-distribution-check

### [unverified · with_care] Other investigators: ZachXBT and Lookonchain on callers/KOLs

ZachXBT: the Sept 1, 2025 paid-promotion leak (above). He also disputed Bubblemaps' 2024 $30M estimate for celebrity-memecoin launcher [named person]; his own estimate was $2–3M, under $5M, and Bubblemaps later revised to about $5M. No Lookonchain report on a KOL selling right after promoting a coin was found; its usual posts track individual whale or trader wallets.

Sources: https://www.theblock.co/post/368956 · https://www.tradingview.com/news/cointelegraph:41e46140e094b:0-memecoin-mastermind-sahil-likely-made-3m-from-celeb-meta-zachxbt/ · https://beincrypto.com/individual-made-millions-celebrity-meme-coin/


## Suggested story beats (fictional composite protagonist)

1. COLD OPEN (2026): You launch your first coin for almost nothing and watch it die before lunch. Same as most: CoinGecko found 68.67% of 18.67M Pump.fun tokens made their last curve trade on launch day.
2. You learn the machine. Every coin starts on a bonding curve, and only about 1% ever 'graduate' to PumpSwap (live since Mar 20, 2025). Every trade pays the platform, which passed $1B in revenue by March 2026.
3. You switch from launching to calling. Pump.fun's Callout Rewards (scaled up in Aug 2026) pay you USDC when your followers trade off your calls. Your public wallet shows up on a leaderboard, and copy traders start mirroring it.
4. Show the payout reality: a reported Nov 2026 snapshot found ~51,000 wallets sharing ~$29.6M, with a median of $13 and the top 10 wallets taking ~16%. You're not getting rich from the rewards alone.
5. The DM arrives (fictional composite): a 'friend' offers paid promos and a set of 'side wallets'. Context only, no mechanics: a 2025 leak showed per-post fees reportedly up to $60k and fewer than 5 of 160+ paid accounts disclosing the ad.
6. The fork in the road (shown in montage, not as a tutorial): your public wallet buys, your call goes out, followers pile in, and somewhere other wallets sell. Use investigators' published description: linked wallets buying ~20 seconds before calls and selling within minutes.
7. The followers' side: a cutaway to a composite follower buying at the top. A reported study found followers of 10 small-cap callers lost ~$926K one day after their calls. Earlier Dune data: only ~0.41% of 13.55M wallets ever realized more than $10K.
8. The platform shifts rules: on Oct 10, 2026, rewards are tied to followers' profits, not volume, but past payouts aren't clawed back. Bubblemaps says 'side wallets have become a business model' and urges launchpads to ban repeat offenders.
9. The bubble map: an on-chain investigator's thread goes viral. Your 'separate' wallets light up as one cluster, linked by funding hops, same-block buys and sells minutes after calls. Composite, modeled on the Oct–Nov 2026 investigations (estimates of ~$125K to ~$1.74M per caller).
10. Legal shadow, accurately framed: an S.D.N.Y. judge let RICO claims proceed against Pump.fun's operator and founders, alleging an enterprise that includes 25 unidentified promoters (alleged, not proven). An influencer stock pump case was revived and set for trial in 2027. A memecoin creator was indicted for an alleged $9M rug. Callers are not immune.
11. Echoes of the big ones: LIBRA (82% of supply clustered, 86% of tracked traders lost $251M per Nansen) and HAWK (~91% crash in ~3 hours). Same playbook, bigger stage.
12. ENDING: You close the laptop. The house always got paid, and most players didn't. End card: a quick red-flag checklist (holder clusters, bundles, dev history, caller wallet timing, undisclosed ads), framed as education and with no endorsement of trading.

## Red flags for viewers (educational)

- Treat every call as an ad. A 2025 leak showed fewer than 5 of 160+ paid influencers disclosed paid posts, and the SEC says fraudsters sometimes pay people to tout investments.
- Check the caller's wallet history, not their screenshots. Investigators found public wallets showing losses while linked 'side wallets' profited (e.g., -$70K public vs +$270K linked).
- Timing tells: if wallets keep buying seconds before a caller posts and selling within minutes after, followers are likely the exit liquidity.
- Platform incentives: callers have been paid by Pump.fun based on the trading their calls generate, so a call can pay the caller even if you lose. Ask who profits from your click.
- Holder concentration: look at top holders, then add up wallets in the same Bubblemaps cluster. Separate-looking wallets can be one owner.
- Bundles and fresh wallets: many buys in the launch block, or dozens of brand-new wallets each holding about 0.5–1%, are reasons to check further (not proof of fraud on their own).
- Common funding source: if many holders were funded by the same address, treat them as one holder, even if they bought at different times.
- Dev and deployer history: a deployer that has launched hundreds or thousands of tokens and sold quickly is a serial launcher. Check on a block explorer such as Solscan.
- 'Graduated' or 'LP burned' does not mean safe. Insiders and the dev can still sell their tokens.
- Countdowns, urgency and 'next 100x' hype are classic pump-and-dump signals per the CFTC. Don't buy on a single social-media tip.
- Know the odds: most Pump.fun tokens stop trading on launch day (68.67% per CoinGecko), only about 1% graduate, and only about 0.41% of wallets ever realized more than $10K (Dune, Jan 2025).
- Report suspected manipulation: CFTC.gov/TipOrComplaint and SEC.gov/tcr.

## Sites blocked during research

WebFetch could not open any page: blog.bubblemaps.io and law.justia.com failed with ENOTFOUND. This session's network allowlist is limited to www.youtube.com, yt3.ggpht.com, i.ytimg.com, support.google.com, developers.google.com and blog.youtube, so every other research host (Bubblemaps blog, Justia, CourtListener, SEC, DOJ, The Block, CoinDesk, etc.) is blocked for direct fetch. All facts were gathered through the WebSearch tool's own page reads, not by me opening each URL. Before publishing, re-open and check the load-bearing numbers: Bubblemaps case figures, the Aug 31, 2026 opinion (Justia doc 184), Sparsity Research, and the CoinGecko 18.67M study. To fetch directly, the user would need to add these hosts in the environment network settings., No original report found (secondary coverage only): Sparsity Research's Nov 10, 2026 callout analysis; CoinGecko's June 2026 Pump.fun study. No Lookonchain KOL/caller case was found.
