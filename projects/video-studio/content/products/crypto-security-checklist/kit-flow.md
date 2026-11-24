<!-- Kit signup and delivery flow for The Crypto Security Checklist (version 1.0, 24 November 2026). -->
<!-- Copy for Kit (kit.com) and the creator-hub pages. {{double braces}} are owner inputs. -->
<!-- Kit facts below were checked on 2026-11-24 through search extracts of help.kit.com (the site is blocked from the build machine); check them in Kit before launch. -->

# Kit signup flow: The Crypto Security Checklist

## 1. Setup in Kit (owner, about 20 minutes)

1. **Create a new form** for the checklist. Don't reuse form 10168331 (zoora.ai): its subscribers agreed to "product and build updates", not to this.
   - Name: Crypto Security Checklist (free)
   - Fields: email address only. Every extra field lowers signups, and we don't need a name.
   - Tag on subscribe: `lead-checklist-free`.
2. **Turn on the incentive email.** In Kit, the incentive email is the double opt-in confirmation email: leave "Auto-confirm new subscribers" unchecked ([Kit: The incentive email](https://help.kit.com/en/articles/2502655-the-incentive-email)).
   - "After confirming, redirect to": choose **Download** and upload `crypto-security-checklist-free.pdf` from `out/product/` (re-upload it after every new version).
3. **Point the hub page at the form.** The hub's checklist page posts the address straight to this form's action URL. Set Kit's "after subscribing" option to redirect to the hub's `/checklist/thanks`, which the hub's Content-Security-Policy allows.
4. **Create the welcome sequence** (section 4) and a Visual Automation: trigger "Joins a form: Crypto Security Checklist (free)", then "Subscribe to sequence: Checklist welcome", then, at the end, add the tag `threat-brief`.
5. **Set the postal address** in Kit's settings. Kit prints it in every email footer, and US anti-spam law (CAN-SPAM) requires one.
6. **Test it end to end** with a fresh address: signup, confirmation email, download, thanks page, sequence email 1.

## 2. The confirmation (incentive) email

- **Subject:** Confirm your email to get the checklist
- **Preview text:** One click and the PDF downloads.
- **Body:**

> Hi,
>
> Thanks for asking for **The Crypto Security Checklist**. Click the button to confirm this is your email address, and the PDF downloads straight away.
>
> **[Confirm and download]**
>
> Didn't ask for this? Ignore this email and you won't hear from us again.
>
> One thing before you go: we will never ask for your seed phrase, a code, or for you to connect a wallet. Not by email, not by message, not by phone. Anyone who does is not us.
>
> Zoo & Badger
> The Zoo & Badger Show

## 3. The thanks page and the download

- **Hub page /checklist/thanks:** see `landing.md`, page 2.
- **The download:** Kit serves the file after confirmation. Name it `crypto-security-checklist-free.pdf`; the PDF's own title and metadata already say "The Crypto Security Checklist (Free edition)".

## 4. Welcome sequence: "Checklist welcome"

Five emails over ten days, then the subscriber joins the weekly Threat Brief. Plain text styling, one idea each, no images needed. Every email ends with the same footer line: "We'll never ask for your seed phrase or ask you to connect a wallet." Kit adds the unsubscribe link and the postal address.

### Email 1: immediately after confirmation

- **Subject:** Your Crypto Security Checklist
- **Preview text:** Plus the three checks to do first.
- **Body:**

> Here's your checklist: **[Download the PDF]** (the same file, in case the first download didn't stick).
>
> If you only have ten minutes today, do these three:
>
> 1. **Find every digital copy of your seed phrase**: photos, screenshots, notes, cloud drives. Delete them. If a copy existed, move your funds to a new wallet.
> 2. **Swap text-message codes for a security key or passkey** on your email first. Your email resets everything else.
> 3. **Ask your mobile carrier for SIM-change and port-out protection.**
>
> Over the next ten days we'll send four short emails, one fix each. After that you'll get the Threat Brief: one email a week on what happened in crypto and AI security, how it worked, and one fix.
>
> Zoo & Badger

### Email 2: day 2

- **Subject:** The one place your seed phrase may be typed
- **Preview text:** And it isn't a website.
- **Body:**

> Your seed phrase isn't a password. It is the wallet. So here's the rule that beats a whole category of scams: **it is only ever typed into the wallet itself, during a recovery you started.**
>
> Not a "wallet sync" page. Not a support chat. Not an AI chatbot. Not a printed letter with a QR code: criminals have posted those, on a wallet maker's letterhead ([The Block](https://www.theblock.co/post/352479/ledger-confirms-physical-scam-letters-requesting-seed-phrase)).
>
> And don't keep a photo of it. In 2025, researchers found apps in the official app stores that scanned photo galleries for recovery phrases ([Kaspersky](https://www.kaspersky.com/blog/ios-android-ocr-stealer-sparkcat/52980/)).
>
> **Today's fix:** paper or metal, written by hand, two copies in two safe places.
>
> Zoo & Badger

### Email 3: day 4

- **Subject:** Read the screen that can't lie
- **Preview text:** What one exchange learned the hard way.
- **Body:**

> In February 2025, attackers stole about $1.5 billion from the exchange Bybit ([FBI](https://www.ic3.gov/PSA/2025/PSA250226)). The signers used hardware wallets. What went wrong? The web page they used to sign had been tampered with, and the transaction was approved without checking the details on the device ([CertiK](https://www.certik.com/resources/blog/bybit-incident-technical-analysis)).
>
> Your computer screen can be faked. Your hardware wallet's screen is much harder to fake. **Read the device, not the computer.** If the device can't show a request in readable form, stop.
>
> **Today's fix:** open your wallet's approvals view (or a block explorer's approval checker) and revoke what you don't use.
>
> Zoo & Badger

### Email 4: day 7

- **Subject:** Your phone number is a weak spot
- **Preview text:** Two settings take it out of the attack.
- **Body:**

> In a SIM swap, a criminal talks or bribes your carrier into moving your number to their SIM, and your login codes go with it. The FBI logged 1,611 SIM-swap complaints with more than $68 million in losses in 2021 alone ([FBI](https://www.ic3.gov/PSA/2022/PSA220208)).
>
> Two fixes:
>
> 1. **Ask your carrier for SIM-change and port-out protection.** Names vary: number lock, port-out PIN, SIM protection.
> 2. **Replace text-message codes with a security key or passkey,** starting with your email. CISA, the US cyber defence agency, calls this kind of login the gold standard because it won't work on a fake site ([CISA](https://www.cisa.gov/sites/default/files/publications/fact-sheet-implementing-phishing-resistant-mfa-508c.pdf)).
>
> Zoo & Badger

### Email 5: day 10 (with our own product)

- **Subject:** If you ever click the wrong thing
- **Preview text:** The first three moves, written down before you need them.
- **Body:**

> Panic is when scams work best, so decide now what you'd do:
>
> 1. **Stop signing.** Close the tab. If you ran a file or pasted a command, disconnect that device.
> 2. **From a clean device,** move funds out of anything exposed into a new wallet. Change your email password and second factor, then your exchanges.
> 3. **Report it** (in the US: ic3.gov and ReportFraud.ftc.gov) and ignore anyone who finds you offering to recover the money. The FBI has warned about fake "recovery" law firms that target people who were already robbed ([FBI](https://www.ic3.gov/PSA/2024/PSA240624)).
>
> **A note about something we make.** If you'd like the full playbook, we wrote it: the full edition of the checklist has twelve chapters, the scam phrasebook, a step-by-step "I clicked something" plan, and printable templates. **This is our own product, and we earn money if you buy it.** {{owner: full edition link through the hub, /go/checklist-full?v=email-5&s=email}}
>
> Either way, from next week you'll get the Threat Brief.
>
> Zoo & Badger

## 5. The full edition: purchase and delivery

- **Where to sell it:** {{owner: Kit's built-in product sales, Gumroad or similar}}. If you use Kit: Kit collects EU and UK VAT for you (prices include it) but does not collect US sales tax, and you still file the returns yourself ([Kit: VAT](https://help.kit.com/en/articles/6631323-how-to-collect-vat-for-product-purchases)). Ask an accountant whether US sales tax applies where your buyers are.
- **Product name:** The Crypto Security Checklist (Full edition)
- **Product description (short):** Twelve chapters of step-by-step crypto security, the scam phrasebook, an incident playbook and printable templates. Every fact sourced. PDF, version 1.0.
- **Receipt and delivery email:**
  - Subject: Your full edition is ready
  - Body: "Thanks for buying The Crypto Security Checklist. Download your copy here: [Download the PDF]. Start with page 4, the 10-minute version. {{owner: update policy line}} Questions or a correction? Reply to this email. We'll never ask for your seed phrase or ask you to connect a wallet."
- **Tag on purchase:** `customer-checklist-full`, and remove the day-10 pitch for buyers (Kit: exclude the tag from the sequence's last email).

## 6. Rules this flow follows

- **Consent (GDPR, UK GDPR, CAN-SPAM):** the form says exactly what people will get; double opt-in proves consent; every email has one-click unsubscribe and the postal address; subject lines describe the email honestly.
- **FTC disclosures:** every mention of the paid edition says, next to the link, that it's our own product and we earn money from it. No testimonials until real ones exist, used with written permission; never written or generated by us (16 CFR 465).
- **No promises:** no "unhackable", "100% safe" or "guaranteed" wording; the copy says what the checklist covers, not what it prevents.
- **Anti-phishing:** we never ask for a seed phrase, a code, a wallet connection or remote access, and every email says so. Links go to our own domains or to the official sources we cite.
- **Region:** the checklist promotes no financial product, so it needs no country rules in the hub's offer registry. If the full edition is ever sold through an affiliate or partner, it becomes an offer like any other, with its disclosure.
