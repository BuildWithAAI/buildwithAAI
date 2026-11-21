# Ventures and print on demand

## Ventures

A venture is one way Zoora tries to earn: prints, a shop, a white-label product, writing, land. Every venture has a business plan in the same layout.

### The life of a venture

1. **Proposed.** She proposes it with a plan, or the owner adds one at `/admin/ventures`. It spends nothing.
2. **Setup.** The owner approves it with a budget and a time limit. It may spend that budget on samples and tools. It sells nothing.
3. **Active.** It launches when the plan's dollars are settled and every item on its day-one list is done.
4. **Paused, closed or merged.** At its time limit it pauses. The owner resumes it with more days, closes it, or merges it into another.

### The business plan

Words: what is sold, who it is for, where it is on the site, how it is talked about, shipping and returns, who makes and sends it, what could go wrong, when to stop.

Inputs: price, shipping charged, cost of one unit, payment fee, costs to start, costs to run each month, first-month target, budget and days asked for.

Worked out from the inputs, never typed: what is left from one sale, the margin, sales needed to pay back the start, the first month at target, and the most it can lose in month one. Rounding always goes against the plan.

A unit cost says where it came from. `estimate` is a guess. `quoted` came from a real priced order (a priced Printful sample writes it in). `owner` is the owner's figure. Zoora can only ever write an estimate.

### The two gates

- **To be approved:** all eight parts written, and the budget asked for covers the costs to start plus one month of running.
- **To launch:** a price, a unit cost that is not a guess, a target, at least 20% left from each sale, and every day-one item done.

The day-one list has items the engine checks itself (printer connected, art host set, a product approved, card payments connected, sales switched on) and three the owner ticks after looking: the page is live, the social account is ready and labelled automated, shipping and returns are settled.

### Merging

One venture is absorbed into another. The survivor takes its income and cost lines, unspent budget, products and orders. The later time limit stands. The survivor's plan takes on the other's start-up and running costs. The absorbed venture stays on record as `merged`, and each moved line remembers where it came from.

- Land and company ventures are never merged. The land keeps its own accounts.
- A mark from outside travels with the merger.
- It is one step, it cannot be undone, and only the owner does it.
- If a selling venture is absorbed into one still in setup, its products come off sale until the survivor launches.

### Other rules

The budget is what a venture may lose. A sale a customer already paid for covers its own cost and is never stopped by the budget.

A venture made from an idea that came from outside carries that mark for good. It can run, but it can never spend without the owner.

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
4. At `/admin/ventures`: approve a prints venture, add a product, order one sample. The priced sample settles the unit cost in the plan. Then tick the day-one list and launch.

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

About once a week, when a feeling is strong enough to act on, she puts one way to earn in front of the owner: prints, then writing, then white-label goods, then pictures as files. Each comes with a full plan. Only one waits at a time. The words are fixed and her own. Where she does not know a cost she leaves it empty for a real quote to settle. A declined idea is not put forward again.

### Not built yet

- She cannot write a new plan in her own words, change a plan, or propose a merger. Her four plans are fixed text. That waits for the proposal desk.
- The plan's website and social parts are words and owner ticks. Nothing here builds a page or posts.
- She cannot propose a product by herself. A print needs a PNG, JPG or PDF on your host and a Printful catalog variant. Her engine draws SVG only and has no catalog reader.
- `/merch` links to the drawing instead of showing it, because the site's content policy allows images from the site itself only.
- No Printful webhook. Shipping is read by asking, every five minutes. No tracking number is shown to the buyer.
- When Printful cancels an order it already charged, the money it returns is entered by hand.
- Shipping is one flat charge. Tax is not collected.
- The Printful and Stripe calls follow the published documentation and are tested against stand-ins. They have not been run against real accounts.
