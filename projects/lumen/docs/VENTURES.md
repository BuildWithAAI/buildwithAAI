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

### Not built yet

- The shop checkout does not open print orders. Today only the owner's desk does, for samples. Wiring a paid shop order to `openPodOrder` is the next step, and its income line must not be counted twice with the shop's own ledger.
- Zoora cannot yet propose a venture or a product from her own loop. The functions exist; the brain does not call them.
- No webhook. Shipping and refunds are not read back. A refund is entered by hand as a line.
- The Printful calls follow the published v2 documentation and are tested against a stand-in. They have not been run against a real Printful account.
