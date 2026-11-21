# Ventures and print on demand

## Ventures

A venture is one way Zoora tries to earn: prints, a shop, a white-label product, writing, land.

1. She proposes it, or the owner adds one at `/admin/ventures`. A proposal spends nothing.
2. The owner approves it with a budget and a time limit, or declines it.
3. It runs. Every line of income and cost goes on its scorecard and into its book (land ventures use the land book).
4. At the time limit it pauses. The owner resumes it with more days, or closes it.

The budget is what a venture may lose. A sale a customer already paid for covers its own cost and is never stopped by the budget. Samples, fees and tools are.

A venture made from an idea that came from outside (a reply, a buyer note, a web page) carries that mark for good. It can run, but it can never spend without the owner.

On the earned ladder, the budget and the number of ventures running at once are held to what the approved milestones grant. In open mode the owner's budget stands.

## Print on demand (Printful)

Printful prints and ships. Nothing is made until an order is confirmed.

- **Product.** One of her pictures on one blank. The owner approves it after looking at the art and ticking that it is her own work.
- **Draft.** Opening an order makes a draft at Printful. A draft costs nothing.
- **Priced.** Printful works out the cost. A paid order that leaves less than `POD_MIN_MARGIN_PERCENT` is refused and the draft deleted.
- **Confirmed.** This prints and charges the billing method on the Printful account. By default the owner clicks it. The owner can let paid orders confirm themselves. Samples always wait for the owner.

If the network drops mid-call, the order is marked `check` and read back from Printful before anything else happens, so nothing is created or confirmed twice.

Customer addresses go to Printful with the draft and are not stored by the engine.

### Setup

1. In Printful's developer portal, make a private token: orders scope only, one store, with an expiry.
2. Set `PRINTFUL_TOKEN`, and `PRINTFUL_ART_HOSTS` to the host her art is served from.
3. Add a billing method in Printful. Set `PRINTFUL_PAID_FROM` to match.
4. At `/admin/ventures`: approve a prints venture, add a product, order one sample.

### Buying on the site

1. `/merch` lists approved products in a running venture. "Pay by card" opens a Stripe checkout that takes the card and the shipping address.
2. Stripe's webhook reports it paid. The order and the sale are written. Nothing has been sent to the printer yet.
3. The engine asks Stripe again whether it was paid, for which product, how much, and where it ships. Any mismatch refuses the order.
4. The draft is opened at Printful, then priced. With the desk switch off, it waits for the owner's click. With it on, it prints.
5. Every five minutes the engine reads printed orders back: shipped, or cancelled by the printer.

A paid order that will not be printed raises an alert. At `/admin/ventures` one button sends the customer's money back through Stripe.

A refund or dispute that arrives before printing stops the order and deletes the draft. One that arrives after printing is a cost on the venture's scorecard.

Settings: `POD_SHIP_COUNTRIES` (default `US`), `POD_SHIPPING_CENTS` (default `0`, meaning the price includes shipping).

### Her own proposals

About once a week, when a feeling is strong enough to act on, she puts one way to earn in front of the owner: prints, then writing, then white-label goods, then pictures as files. Only one waits at a time. The words are fixed and her own. A declined idea is not put forward again.

### Not built yet

- She cannot propose a product by herself. A print needs a PNG, JPG or PDF on your host and a Printful catalog variant. Her engine draws SVG only and has no catalog reader.
- `/merch` links to the drawing instead of showing it, because the site's content policy allows images from the site itself only.
- No Printful webhook. Shipping is read by asking, every five minutes. No tracking number is shown to the buyer.
- When Printful cancels an order it already charged, the money it returns is entered by hand.
- Shipping is one flat charge. Tax is not collected.
- The Printful and Stripe calls follow the published documentation and are tested against stand-ins. They have not been run against real accounts.
