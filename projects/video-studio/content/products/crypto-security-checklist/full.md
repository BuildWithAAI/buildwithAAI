---
edition: full
title: The Crypto Security Checklist
subtitle: Practical steps to protect your wallets, your accounts and your family from crypto theft
byline: by Zoo & Badger
independence: No sponsors, no affiliate links
editionLabel: Full edition
version: 1.0
date: 2026-11-24
---

@cover

# How to use this checklist {#how-to-use kind=front}

> Work through it once, in order. Then come back every three months, and any time something feels off.

Every item has a box to tick. The items are grouped by how soon they matter:

:::cards
- **Do today.** Closes the biggest holes. Most items take minutes.
- **This week.** Needs a purchase, a phone call or an hour of setup.
- **Habits.** What you do every time you sign, send or answer a message.
:::

## Three rules to remember

1. **Your seed phrase never goes into a website, app, chat, form, photo or cloud.** It is only ever entered on the wallet itself, during a recovery you started.
2. **Nobody legitimate rushes you.** Urgency is the attack. Close the tab or hang up, then come back through a route you already trust.
3. **Read before you sign.** If your wallet can't show you, in plain words, what you are approving, don't approve it.

## Who this is for

Anyone who holds crypto: one exchange account, a phone wallet or a drawer of hardware wallets. Thieves increasingly go after individuals, not just companies: Chainalysis counted 158,000 thefts from personal wallets in 2025, affecting at least 80,000 people. [@chainalysis-theft-2026] Some steps are technical. Each one says why it matters, so you can decide what fits your situation.

## Badger's Red Flags and Zoo's One Fix

Every chapter ends with two boxes from the show. **Badger's Red Flag** is the warning sign that should stop you cold. **Zoo's One Fix** is the single step to take if you only take one.

:::note What this checklist is, and isn't
This is general security education, not financial, legal or tax advice, and it never tells you what to buy or sell. We name categories, not brands: no company paid for, reviewed or sponsored this checklist, and it contains no affiliate links. When we cite a company's documentation, it's because it explains a feature or an incident clearly, not because we recommend the company. Features and menus change, so check your wallet's and exchange's own help pages before you change a setting. Every source we used is listed at the back, with the date we checked it.
:::

@toc

# The 10-minute version {#quick-start kind=front toc="The ten actions to take first."}

> Short on time? Start with these ten actions. The chapters explain each one, and why it matters.

- [ ] **Get your seed phrase off every device.** If it exists as a photo, screenshot, note, email draft or cloud file, treat that wallet as exposed and move to a new one. [@kaspersky-sparkcat-2025] [#seed-phrases]
- [ ] **Replace text-message codes with a security key or passkey** on your email and exchange accounts. An authenticator app is the minimum. [@cisa-mfa-2022] [#sim-2fa]
- [ ] **Ask your mobile carrier for SIM-change and port-out protection.** [@fcc-simswap-2023] [#sim-2fa]
- [ ] **Review your token approvals and revoke the ones you don't need.** [@ms-ice-phishing-2022] [#approvals]
- [ ] **Turn on your exchange's withdrawal allowlist** with the longest waiting period you can live with. [@binance-whitelist] [#exchanges]
- [ ] **Bookmark the real sites you use** and only ever arrive through the bookmark. [@ic3-search-ads-2022] [#phishing]
- [ ] **Agree a code word with your family,** in person, for any urgent request for money. [@ic3-genai-2024] [#ai-threats]
- [ ] **Split your crypto into a vault, a spending wallet and a burner.** [#hardware-wallets]
- [ ] **Send only to addresses from your address book,** never from your transaction history. [@cmu-address-poisoning] [#address-poisoning]
- [ ] **Read the incident plan now,** before you ever need it. [#incident-response]

:::fix
If you do only one thing today: find and delete every digital copy of your seed phrase. If one existed, move your funds to a new wallet.
:::

# Seed phrases {#seed-phrases kind=chapter spot=seed-phrases toc="Where it lives, who may ever see it, and what to do if it leaked."}

> Your seed phrase (also called a recovery phrase) is not a password. It *is* the wallet. Anyone who sees it can take everything, from anywhere, at any time, and there is no one to call. [@ethereum-security]

## Do today {priority=today}

- [ ] **Enter it in one place only: the wallet itself, during a recovery you started.** Never on a website, in an app that offers to "validate" or "sync" it, in a form, a support chat, an AI chatbot or a spreadsheet. No legitimate company needs it, ever. [@ledger-phishing; @ethereum-security]
- [ ] **Hunt down digital copies** in photos, screenshots, notes, password managers, email drafts and cloud drives. Screenshots sync to the cloud, and in 2025 researchers found apps in the official App Store and Google Play that read recovery phrases out of photo galleries. [@kaspersky-sparkcat-2025; @ethereum-security]
- [ ] **Write it by hand on paper or metal,** numbered and in order, checking each word against the device screen.
- [ ] **End the conversation if anyone asks for it.** Support agents, "validators", recovery services, airdrop pages, a letter that looks official: anyone who asks for your phrase is stealing. Criminals have even posted printed letters, using a wallet maker's logo, asking owners to scan a QR code and type their phrase in. [@ledger-phishing; @theblock-ledger-letters-2025]

## This week {priority=week}

- [ ] **Test your backup before you trust it,** with the wallet's built-in backup check or a recovery on a reset device. Do it before meaningful money goes in.
- [ ] **Keep two copies in two secure places,** so one fire or burglary can't take both. Every extra copy is one more place a thief can look.
- [ ] **Consider a passphrase** (sometimes called a 25th word). It opens a separate hidden wallet, so a stolen sheet alone isn't enough. Forget it and nobody can recover those funds, so back it up separately.

## Habits {priority=habit}

- [ ] **Keep your holdings private.** Don't post balances, "I bought" screenshots or wallet addresses linked to your name. Chainalysis found that victims of violent "wrench attacks" were mostly chosen through exposed information: social media, data breaches or insiders. [@chainalysis-wrench-2026]
- [ ] **Check that your copies are still where you left them** every three months.

@pagebreak

## Where your seed phrase can live

| Where | Verdict | Why |
| --- | --- | --- |
| Paper, written by hand, kept private | **Good** | Offline. Keep it dry, away from heat and out of sight. |
| Stamped or engraved steel | **Best for the long term** | Survives fire and water far better than paper. |
| Your wallet's multi-share backup, or a multi-signature wallet | **Good for larger amounts** | Built so that no single piece is enough to move funds. |
| A password manager | **Avoid** | Still a digital copy: one breached account or infected device exposes it. |
| Photos, screenshots, notes apps, cloud drives | **Never** | They sync to the cloud, and malware in official app stores has read recovery phrases from photo galleries. [@kaspersky-sparkcat-2025; @ethereum-security] |
| Email, chat apps, AI chatbots | **Never** | Stored on servers you don't control, often for years. |
| Your own split: half here, half there | **Never** | Half a phrase still helps a thief, and losing one half locks you out. |

:::steps If your phrase was ever exposed
1. Create a brand-new wallet, with a new phrase, on a device you trust.
2. Move everything from the old wallet to the new one, largest balances first. Revoking approvals does not help when the phrase itself is out.
3. Treat the old wallet as burned and never send to it again. On Ethereum, thieves often set a stolen wallet to forward anything it receives, so even a small top-up for fees can vanish in seconds. [@theblock-wintermute-7702]
:::

:::redflag
Anyone who asks for your seed phrase. No exceptions: not support, not a "wallet sync", not a recovery agent, not a letter from your wallet's maker.
:::

:::fix
Find and delete every digital copy of your phrase today. If one ever existed, move to a fresh wallet.
:::

# Hardware wallets {#hardware-wallets kind=chapter spot=hardware-wallets toc="A clean source, a clean setup, and the one screen to trust."}

> A hardware wallet keeps your keys on a small dedicated device, so a hacked computer can't simply copy them. It protects you only if it came from a clean source and you read what it shows you.

## Do today {priority=today}

- [ ] **Check where it came from.** Buy only from the manufacturer or an authorized reseller: never second-hand, from an auction or from a marketplace listing. Kaspersky examined a counterfeit device whose keys the thieves knew before the buyer even set it up; the owner lost about $30,000. [@kaspersky-fake-trezor-2023]
- [ ] **Never use a recovery phrase that came with the device.** A genuine device creates its phrase on its own screen. A pre-filled card, or instructions to "import" a phrase, means someone else knows it.
- [ ] **Update firmware only through the manufacturer's official app,** and only when you started the update yourself.
- [ ] **Set a PIN that isn't your birthday,** and know how many wrong tries wipe the device.

## This week {priority=week}

- [ ] **Split your crypto by job,** into three wallets:

:::cards
- **Vault.** Hardware wallet, most of your holdings. Signs rarely and never touches new sites.
- **Spending.** Everyday amounts, used only with apps you already know.
- **Burner.** Nearly empty. For new sites, mints and airdrops. Expect to lose it.
:::

## Habits {priority=habit}

- [ ] **Read the device screen, not the computer screen.** In the $1.5 billion Bybit theft, attackers changed what the signers' web page showed, and the transaction was approved without checking the device. [@certik-bybit-2025; @ic3-bybit-2025]
- [ ] **Verify every receiving address on the device** before you share it. Malware can swap an address you copy or paste, so trust the device screen. [@kaspersky-clipboard-2023]
- [ ] **Don't blind-sign.** If the device can't show a request in readable form, stop unless you've confirmed exactly what it is another way. [@certik-bybit-2025]

:::redflag
A device that arrives already set up, with a recovery card already filled in, or with instructions to type in a phrase you didn't create.
:::

:::fix
Before you approve anything, read the device screen. If it says something different from your computer, the computer is lying.
:::

# Approvals, and how to revoke them {#approvals kind=chapter spot=approvals toc="The permissions that outlive the app, and how to take them back."}

> When you use an app, you often give its contract permission to move your tokens. Those permissions don't expire on their own. A forgotten approval to a contract that gets hacked, or to a scammer, can drain that token without another signature from you. [@ms-ice-phishing-2022; @metamask-revoke]

:::note How permissions work
**Approvals (spending caps)** are on-chain permissions for a contract to move a token you hold, up to a limit. "Unlimited" means all of it, now and later. **Approval for all** lets one contract move every NFT in a collection. **Permits** are signed messages that set an allowance without a transaction or a fee; the attacker submits them later. That is why a "free" signature can still cost you everything. [@metamask-revoke; @eip-2612; @scamsniffer-2025]
:::

## Do today {priority=today}

- [ ] **Review your approvals on every network you use,** with your wallet's built-in approvals view or a block explorer's approval checker. [@metamask-revoke; @ms-ice-phishing-2022]
- [ ] **Revoke what you don't recognise or no longer use,** and any unlimited approval on a token you hold a lot of. Revoking is an on-chain transaction, so it costs a network fee. [@metamask-revoke]
- [ ] **Revoke from a source you trust.** Use your wallet's own feature, or a block explorer you reach through a bookmark. Fake "revoke" pages are themselves a phishing lure.

## Habits {priority=habit}

- [ ] **Approve only what you are about to spend:** set a custom spending cap for this transaction, not unlimited. [@ethereum-security]
- [ ] **Treat signature requests as permissions, not logins.** A message mentioning "permit", "approve", "setApprovalForAll" or "increaseAllowance", or one your wallet labels as a token approval, hands over spending power. [@scamsniffer-2025]
- [ ] **Accept account upgrades only from your wallet itself.** Since Ethereum's 2025 upgrade (EIP-7702), an ordinary account can be set to run contract code. A website asking you to "upgrade" or "secure" your account is a red flag. [@theblock-wintermute-7702]
- [ ] **Repeat the review monthly,** and after any scare. Revoking stops future spending; it can't undo a theft or fix an exposed seed phrase ([#seed-phrases]).

:::redflag
A "claim", "mint" or "verify" page asking for a signature you don't understand, especially one that costs nothing.
:::

:::fix
Ten minutes, once a month: review your approvals and revoke the stale ones.
:::

# Phishing and wallet drainers {#phishing kind=chapter spot=phishing toc="Drainer kits, fake sites and fake extensions."}

> A wallet drainer is a kit criminals rent out: a convincing fake site that asks for exactly the signatures and approvals that empty a wallet. The security firm Scam Sniffer counted about $494 million stolen this way on Ethereum-compatible chains in 2024 and about $84 million in 2025, and warns that the kits are still active. [@scamsniffer-2025]

## Do today {priority=today}

- [ ] **Bookmark the real sites you use and arrive only through the bookmarks:** never through search results, ads, direct messages or links in replies. The FBI has warned that criminals buy search ads impersonating real brands, including crypto exchanges. [@ic3-search-ads-2022]
- [ ] **Give crypto its own browser profile** with only your wallet extension installed. Extensions with broad permissions can read and change the pages you visit.
- [ ] **Install wallet extensions only through the link on the wallet maker's own website,** and check the publisher. In 2025 researchers found more than 40 fake wallet extensions in Firefox's official add-on store that copied real wallets and stole recovery phrases. [@koi-foxywallet-2025]

## Habits {priority=habit}

- [ ] **Never connect your vault to a new site.** Use a burner holding only what that site needs ([#hardware-wallets]).
- [ ] **Read the whole request before you sign.** If your wallet shows a warning or a preview of what will leave your wallet, read it, then decide.
- [ ] **Ignore tokens and NFTs that turn up uninvited.** A surprise airdrop that sends you to a "claim" page is bait. [@ethereum-security]
- [ ] **Doubt official-looking announcements,** even from verified accounts. Accounts get hijacked: in January 2024 the US Securities and Exchange Commission's own account on X posted a false announcement after a SIM swap. [@sec-x-account-2024]
- [ ] **Never let anyone take remote control of your computer** or watch your screen while you open a wallet. [@ethereum-security]
- [ ] **Treat urgency as the attack:** "wallet suspended", "claim within one hour", "last chance to mint".

:::redflag
"Connect your wallet to claim." Free money that needs your signature first.
:::

:::fix
Bookmarks only. If you didn't arrive through a bookmark, assume you're not on the real site until you've proved otherwise.
:::

# Address poisoning {#address-poisoning kind=chapter spot=address-poisoning toc="Lookalike addresses planted in your history."}

> Attackers generate an address whose first and last characters match one you use, then send you a tiny or zero-value transfer so it shows up in your history. Copy the address from your history next time and you pay the attacker. [@cmu-address-poisoning]

:::compare Illustrative addresses: same start, same end, different middle
Yours: 0x7a3f52b1e09c4d77a1f03c882e6b15d4a07e9c21
Lookalike: 0x7a3f0d9e77a2c3b418f6e0a5b9c17f02d84b9c21
:::

Researchers at Carnegie Mellon counted about 270 million poisoning attempts on two networks over two years, and at least $83.8 million lost in 6,633 incidents. In May 2024 one trader sent about $68 million to a single lookalike address. [@cmu-address-poisoning; @coindesk-68m-2024]

## Do today {priority=today}

- [ ] **Save the addresses you pay regularly in your wallet's address book,** and send from the address book, never from your transaction history.
- [ ] **Hide zero-value and spam transfers** if your wallet offers the setting.

## Habits {priority=habit}

- [ ] **Check the whole address,** not just the first and last few characters. Compare it in groups of four.
- [ ] **Get addresses from the source:** ask the recipient on a second channel, or scan their code in person.
- [ ] **For large amounts, send a small test first,** and wait for the recipient to confirm it arrived. A test proves the address works, not that it is the right one, so the confirmation is the point.
- [ ] **Compare after you paste.** Some malware swaps a copied address on your clipboard for the attacker's. [@kaspersky-clipboard-2023]
- [ ] **Withdraw from exchanges only to allowlisted addresses** ([#exchanges]).

:::redflag
An unexpected zero or tiny transfer from an address that looks like one you know.
:::

:::fix
Use the address book. Your history is where poisoned addresses hide.
:::

# Fake jobs and malware lures {#fake-jobs kind=chapter spot=fake-jobs toc="Recruiters, investors and 'tests' that install malware."}

> Some of the biggest thefts start with a friendly recruiter or an eager investor. The FBI has warned that North Korean groups target people in crypto with tailored job offers and "technical tests" that run malicious code. [@ic3-dprk-2024]

:::flow How the lure works
- **The offer.** A recruiter, investor or journalist contacts you, often on a professional network.
- **The move.** The conversation shifts to Telegram, Discord or a video call.
- **The test.** A coding test, a repository to review, a "meeting app", or a command to paste to fix a camera error. [@gtig-etherhiding-2025; @ms-cyberwarcon-2024]
- **The theft.** Malware takes passwords, browser sessions, wallet extensions and keys.
:::

## Do today {priority=today}

- [ ] **Never run code, install software or open files from someone you met online** on a device that holds crypto or logs in to exchanges. [@ic3-dprk-2024]
- [ ] **Never paste a command into Run, Terminal or PowerShell** because a web page, a CAPTCHA or a caller told you to. Microsoft calls this trick "ClickFix" and sees it aimed at thousands of devices every day. [@ms-clickfix-2025]
- [ ] **Join meetings only through the official app or website** you already use, never through a download the other person sends. [@ms-cyberwarcon-2024]

## This week {priority=week}

- [ ] **Keep crypto on its own computer,** or at least its own user account. Do take-home tests in a throwaway virtual machine.
- [ ] **Keep your operating system and browser updated,** and remove software you don't use.

## Habits {priority=habit}

- [ ] **Verify the person through the company's official website,** not through the contact details they gave you.
- [ ] **Download apps only from the developer's own site or official app stores.** Mandiant traced thousands of ads for fake "AI video generators" that reached millions of people and installed password-stealing malware. [@gtig-unc6032-2025]

:::redflag
A "quick technical test" that means cloning a repository and running it, or a meeting that needs a special download.
:::

:::fix
Your crypto lives on a device that never runs a stranger's code.
:::

# SIM swaps, 2FA and security keys {#sim-2fa kind=chapter spot=sim-2fa toc="Taking your phone number out of the attack."}

> In a SIM swap, a criminal talks or bribes your carrier into moving your number to their SIM, and your login codes go to them. The FBI received 1,611 SIM-swap complaints with more than $68 million in losses in 2021 alone. [@ic3-simswap-2022]

:::ladder How strong is your second factor?
- [best] **Security key or passkey.** Won't work on a fake site; CISA calls it the gold standard. [@cisa-mfa-2022]
- [good] **Authenticator app.** Far better than texts, but a fake site can still phish a code.
- [weak] **Text or voice codes.** SIM swaps and phishing beat them; NIST calls them "restricted". [@nist-800-63b-4]
- [none] **Password only.** One leak and the account is gone.
:::

## Do today {priority=today}

- [ ] **Lock down your email first:** it resets everything else. Give it a security key or passkey.
- [ ] **Ask your carrier for SIM-change and port-out protection** (number lock, port-out PIN or SIM protection). In the US, FCC rules adopted in 2023 require carriers to verify you securely before a SIM change or port-out and to notify you. [@fcc-simswap-2023]
- [ ] **Move exchange 2FA from text messages to a security key or passkey,** with a second key as backup. One major exchange's own help pages call text messages "the least secure option". [@coinbase-2sv]
- [ ] **Remove your phone number** from accounts that don't need it, turn off "recover by text message", and keep the number tied to your accounts private.

## This week {priority=week}

- [ ] **Get two FIDO2 security keys,** one for your keyring and one stored safely, and register both.
- [ ] **Write down each account's backup codes** and keep them with your records ([#record-keeping]).

## Habits {priority=habit}

- [ ] **If your phone suddenly shows "No service",** call your carrier from another phone at once. A SIM swap is a race. [@ic3-simswap-2022]
- [ ] **Never read a code to anyone.** Codes are for typing into the site you opened yourself.

:::redflag
A login code you didn't ask for, then a "support" call asking you to read it back.
:::

:::fix
A security key on your email and your exchange. Text-message codes are a last resort, not a lock.
:::

# Exchange account hardening {#exchanges kind=chapter spot=exchanges toc="Allowlists, locks and alerts for exchange accounts."}

> On an exchange, the company holds the keys, so your login is your wallet. Most account takeovers need three things: your email, your password and your second factor. Take each one off the table.

## Do today {priority=today}

- [ ] **Use an email address (or alias) only for financial accounts,** protected with a security key.
- [ ] **Use a long, unique password** from a password manager.
- [ ] **Use a security key or passkey for 2FA** ([#sim-2fa]). [@coinbase-2sv]
- [ ] **Turn on the withdrawal allowlist** (also called a whitelist or address book lock), with the longest waiting period for new addresses that you can tolerate. A thief who gets in can't send to their own address until the wait is over. [@binance-whitelist]
- [ ] **Turn on the settings lock if your exchange has one.** It blocks changes to withdrawal addresses, API keys and 2FA, and starts a delay with an email alert when someone tries to unlock it. [@kraken-gsl]
- [ ] **Set an anti-phishing code if it's offered:** a word you choose that appears in the exchange's genuine emails, so a fake email stands out.

## This week {priority=week}

- [ ] **Review devices, sessions and API keys,** and remove anything you don't recognise.
- [ ] **Lock down API keys** for bots and tax tools: read-only where possible, withdrawals never enabled, limited to your IP address if offered, and one key per tool so you can revoke one alone.
- [ ] **Turn on login and withdrawal alerts.**

## Habits {priority=habit}

- [ ] **Reach support only through the app, or a website address you type yourself.** Real support never asks for your password, your codes, your seed phrase or remote access, and never tells you to move funds to a "safe" wallet.
- [ ] **Expect impersonators who know your details.** In May 2025 Coinbase disclosed that criminals had bribed overseas support contractors to steal customer data, including names, addresses and ID images, to pose as the company; it said no passwords, keys or funds were accessed. [@coinbase-breach-2025]
- [ ] **Keep on an exchange only what you're actively using.** The rest belongs in a wallet you control.

:::redflag
"Your account is under attack. Move your funds to this secure wallet." No exchange will ever ask you to do this.
:::

:::fix
Allowlist on, longest delay. A thief who gets in still can't get out.
:::

# The scam phrasebook {#social-engineering kind=chapter spot=social-engineering toc="Ten scripts scammers use, and what to do instead."}

> Scams are scripts. The words change; the moves don't: urgency, authority, secrecy, and a request to send, sign or share. Chainalysis estimates crypto scams took in at least $14 billion on-chain in 2025, with impersonation scams up 1,400% on the year. [@chainalysis-scams-2026]

| They say | What's really happening | You do |
| --- | --- | --- |
| "This is your exchange's security team. Your account is under attack; move your funds to this safe wallet." | Impersonation. The "safe wallet" is theirs. [@coinbase-breach-2025] | Hang up. Open the app yourself. |
| "Your wallet must be validated or synced, or it will be suspended." | A fake support page that wants your seed phrase. [@ethereum-security] | Wallets don't expire. Never enter the phrase. |
| "Hi, is this Sam? Sorry, wrong number." Then friendship, then an investment app. | A relationship investment scam, also called pig butchering. [@fincen-pig-2023] | Anyone you met online who brings up investing is a scammer. [@ftc-crypto-scams] |
| "Guaranteed daily returns. We double your crypto." | Promises of guaranteed returns are always scams. [@ftc-crypto-scams] | Walk away. |
| "To withdraw your profits, first pay the tax or unlock fee." | A fake platform; the profits never existed. | Stop paying. Report it. |
| "We can recover your stolen crypto for a fee." "I'm with the FBI." | A recovery scam. Fake law firms and fake FBI staff target people who were already robbed. [@ic3-recovery-2024; @ic3-impersonation-2026] | Report only through the official site you typed yourself. |
| "Share your screen so I can help." | Remote control of your wallet. [@ethereum-security] | Never. |
| "It's me. I'm in trouble. Send money now and don't tell anyone." | A cloned voice. [@ftc-family-emergency; @ic3-genai-2024] | Hang up, call back on a number you know, ask for the code word. |
| "Read me the code we just sent you." | An account takeover in progress. | Codes are never read aloud. |
| "Send 1, get 2 back. Celebrity giveaway." | A giveaway scam, often from a hijacked account. [@ethereum-security; @ftc-crypto-scams] | Nobody doubles money. |

## Habits {priority=habit}

- [ ] **Use "hang up, look it up, call back".** End the conversation and reach the organisation through a route you already trust.
- [ ] **Never act while someone is still on the line.** Pressure and secrecy are the tells.
- [ ] **Never move crypto because someone told you to** on a call, in a text or in a direct message.

:::redflag
Any message with a deadline and a secret.
:::

:::fix
Hang up, look it up, call back.
:::

# AI-era threats {#ai-threats kind=chapter spot=ai-threats toc="Voice clones, deepfakes, fake AI tools and AI agents."}

> AI makes scams cheaper and more convincing: cloned voices, deepfake video calls, flawless phishing emails and fake AI tools that install malware. In its 2025 report, the FBI tracked AI as a category for the first time: 22,364 complaints and $893 million in losses. [@ic3-annual-2025]

## Voice clones and deepfake calls

- [ ] **Agree a code word with your family or team,** in person, never online, and ask for it on any urgent call about money. [@ic3-genai-2024]
- [ ] **Verify on a second channel.** Hang up and call back on a number you already have. [@ftc-family-emergency]
- [ ] **Treat video as proof of nothing.** In 2024 an employee at the engineering firm Arup sent about US$25 million after a video meeting in which the "chief financial officer" and colleagues were deepfakes. The US Treasury's financial crimes unit has warned banks that criminals use deepfakes to get past identity checks. [@scmp-arup-2024; @fincen-deepfake-2024]
- [ ] **Share less of your voice and face** if you hold significant crypto. A short clip is enough to clone a voice. [@ic3-genai-2024; @ftc-family-emergency]

## Fake AI tools, apps and extensions

- [ ] **Get AI apps only from the developer's own site or an official app store,** and skip ads for free AI tools. [@gtig-unc6032-2025]
- [ ] **Keep AI browser extensions out of your crypto browser profile.** Extensions can read the pages you visit.
- [ ] **Never paste a seed phrase, a private key or a screenshot of either into an AI chatbot.** Treat anything you paste as stored.
- [ ] **Ignore "AI trading bots" that promise returns.** The CFTC warns that AI can't predict the future and that these pitches are a common fraud. [@cftc-ai-bots-2024]

## AI agents with wallet access

- [ ] **Give an agent its own small wallet,** with spending limits, never your vault.
- [ ] **Approve every transfer yourself.** Instructions hidden in a web page, a message or a document can redirect an agent (prompt injection), and researchers made crypto agents send funds to attackers by planting fake "memories". [@owasp-llm01-2025; @princeton-fake-memories]
- [ ] **Don't let an agent read untrusted content** (email, direct messages, web pages) while it can sign.

:::redflag
A familiar voice or face asking for money, crypto or codes, with a reason you can't check right now.
:::

:::fix
A code word that nobody can clone.
:::

# I clicked something. Now what? {#incident-response kind=chapter spot=incident-response toc="A step-by-step plan for the first hour."}

> Minutes matter. Work from the top: stop the damage, secure what's left, then report and record. Use a clean device if you can.

## Step 1: Stop (first five minutes)

- [ ] **Don't sign or approve anything else.** Close the tab. If you think malware is involved, disconnect that device from the internet.
- [ ] **Don't answer anyone who offers to help.** Recovery "experts" who find you are scammers. [@ic3-recovery-2024]

## Step 2: Work out what happened

| What happened | Assume | Do now |
| --- | --- | --- |
| You signed an approval or permit on a bad site | They can spend that token | Revoke the approval ([#approvals]), then move what's left of that token to a fresh wallet. |
| You typed or shared your seed phrase or a private key | The wallet is gone | On a clean device, create a new wallet and move everything, largest first. Speed beats revoking. |
| You ran a file, app, script or pasted command | The device and every secret on it are compromised | From a different, clean device, move funds from every wallet that device touched, then change passwords and 2FA, starting with email. Wipe and reinstall the infected device. [@ms-clickfix-2025] |
| You gave a password or a login code | Someone can take over the account | From a clean device, reset the password, sign out all sessions, delete API keys and re-register 2FA. |
| Your phone suddenly lost service | A possible SIM swap | Call your carrier from another phone, then secure email and exchanges. [@ic3-simswap-2022] |
| You sent funds to a scammer | They're gone unless frozen quickly | If the funds went to an exchange, tell that exchange through its official channels, with the transaction ID. Report it (Step 4). |

## Step 3: Secure (first hour)

- [ ] **Change your email password first,** then your exchange passwords. Sign out every other session.
- [ ] **Check your email for new forwarding rules** and filters you didn't create.
- [ ] **Contact your exchange through its app** and ask it to freeze withdrawals if your account is affected.

## Step 4: Report and record (same day)

- [ ] **Report it.** In the US: the FBI's Internet Crime Complaint Center (ic3.gov), the FTC (ReportFraud.ftc.gov) and your local police. Elsewhere, your national police cybercrime reporting service. [@ftc-crypto-scams]
- [ ] **Include the details:** transaction IDs, addresses, amounts, dates and times, website addresses and screenshots of the messages ([#incident-log]).
- [ ] **Know what real reporting looks like.** The real IC3 has no social media accounts and doesn't recover funds through social platforms. Type the address yourself. [@ic3-impersonation-2026]

:::note What to put in a report
Write it as a timeline, in plain words: **when** it started (date, time, time zone); **how** they reached you (site address, app, phone number, account name); **what** you did (signed, sent, installed, shared); **every transaction** (network, transaction ID, from and to addresses, amount); and **who else** you have told (exchange ticket numbers, police reference). Keep the original messages and screenshots; don't edit them.
:::

## Step 5: Afterwards

- [ ] **Never reuse the compromised wallet** or device setup.
- [ ] **Expect follow-up "recovery" offers for months,** and ignore every one. [@ic3-recovery-2024]

:::redflag
A stranger who finds you after the theft and offers to get it back.
:::

:::fix
Read this page before you need it. Panic is when scams work best.
:::

# Record keeping {#record-keeping kind=chapter spot=record-keeping toc="An inventory for emergencies, taxes and family."}

> Good records pay off three times: in an emergency, at tax time, and for your family if something happens to you. Keep them offline, and never in the same place as your seed phrase.

## Do today {priority=today}

- [ ] **Start an inventory** ([#inventory]): each wallet, which device or app it lives on, which networks, and its public addresses. Never the seed phrase.
- [ ] **Record where each backup lives:** the location, not the words.
- [ ] **List your exchange accounts:** the platform, the login email, the type of 2FA and where the backup codes are.

## This week {priority=week}

- [ ] **Export your transaction history** from every exchange at least once a year. Platforms can close or limit access.
- [ ] **Keep proof of purchase for hardware wallets,** to show they came from an official source.
- [ ] **US taxpayers: keep your own cost records.** Brokers began reporting digital-asset sales on Form 1099-DA for 2025, but cost reporting only applies to assets bought from 2026 and kept in the same account. Coins moved between platforms or into your own wallet need your records. [@irs-1099da]

## Habits {priority=habit}

- [ ] **Keep an incident log** ([#incident-log]) whenever something odd happens: dates, transaction IDs, screenshots, report numbers.
- [ ] **Write a letter for your family:** what exists, where the records are, who to call, and a warning that no genuine helper will ever ask for the seed phrase.
- [ ] **Review everything every three months,** and after any change.

:::redflag
A "record" that includes the seed phrase. That's not a record, it's a target.
:::

:::fix
One inventory, updated every quarter, stored offline.
:::

# Emergency card {#emergency-card kind=appendix frame=cut}

> Fill this in now, print it and keep it somewhere you'll find it under stress. It contains nothing a thief can use.

:::fill
My mobile carrier's fraud line:
My exchange's official app or web address:
Where my clean device is:
Who knows our code word:
Report: ic3.gov · ReportFraud.ftc.gov · local police:
:::

:::steps The first three moves
1. Stop signing. Close the tab. Disconnect the device if you ran anything.
2. From a clean device, move funds out of anything exposed, into a new wallet.
3. Change your email password and 2FA, then your exchanges. Then report it.
:::

:::note Never, under any pressure
Never type your seed phrase anywhere but the wallet itself, never read out a code, never let anyone control your screen, and never pay anyone who offers to recover stolen crypto.
:::

# Wallet and account inventory {#inventory kind=appendix}

> Public information only. If a line would let someone move your money, it doesn't belong here.

| Wallet or account | Device or app | Networks | Public address or login email | Backup location (not the words) | Second factor |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |

# Incident log {#incident-log kind=appendix continue=true}

> Write it down while it's fresh. Reports with transaction IDs, addresses and times are the ones investigators can act on.

| Date and time | What happened | Transaction ID or link | Addresses involved | Amount | Reported to (reference number) |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |

# Sources {#sources kind=back}

> Every fact in this checklist comes from one of these sources. We checked them all on 24 November 2026.

Where an official page could not be opened directly when we checked it, we confirmed the fact through a search engine's copy of that page instead, and the entry says "(search extract)". Open the link before you quote any source word for word.

@sources

# About Zoo & Badger {#about kind=back spot=about-pair}

**The Zoo & Badger Show** covers crypto and AI security news: what happened, how it worked, and one fix. Zoo hosts. Badger, his dog, judges quietly.

**Our rules.** We attribute every fact, label developing stories, and correct mistakes in public. We never ask for your seed phrase, never message you first about your wallet, and never promise returns.

**Not advice.** This checklist is general security education. It isn't financial, legal or tax advice, and it doesn't tell you what to buy or sell. Laws and features differ by country and change over time.

**No sponsors.** No company paid for, reviewed or sponsored this checklist, and it contains no affiliate links. Companies named in it are cited as sources or as incidents, not recommended.

**Corrections.** Spotted something out of date? Tell us, and we'll fix it in the next version.
