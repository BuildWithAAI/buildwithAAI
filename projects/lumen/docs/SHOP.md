# Zoora's shop

Selling only. The shop cannot create a spend intent. Buying supplies stays on the card policy and stays off until spend is separately enabled.

Live checkout is off unless both of these are true:

- `SALES_ENABLED=true`
- the keeper turns the shop sales toggle on

`fly.toml` sets `SALES_ENABLED=false`. With either switch off, a listing says coming soon and no payment is taken. There are no Stripe keys in this repository. If the secret is unset, checkout stays a mock and still does not mark an order paid. A sale is real only after the signed Stripe webhook says `payment_status=paid`.

Payouts go to the owner's own Stripe account and then to the owner's bank. This app does not hold the money and does not start payouts.

## What Zoora may list

Only things the app can hand over by itself:

- Art, music notation, and writing are generated files. After a paid webhook, the buyer gets a random link that expires in 72 hours.
- A service listing states the scope and the turnaround. If that time passes and the file was not delivered, the order is refunded.
- Every public description says the work is made by an AI.
- Names and descriptions that impersonate a person, copy a trademark, or ask for a real likeness are refused.

Zoora chooses a price inside a server minimum and maximum for that kind. The keeper can lower the ceiling with the shop price cap. A buyer note cannot change the price, the listing, or the delivery.

New listings wait for the keeper when approve-before-publish is on. That is the default. The desk can approve, hide, unpublish, refund a charge, or throw the shop kill switch.

## Sales tax, refunds, and chargebacks

| Topic | Stripe | The owner |
| --- | --- | --- |
| Card charge | Stripe Checkout charges the buyer in the owner's Stripe account | Turns `SALES_ENABLED` on and the desk toggle on, after review |
| Sales tax | Stripe Tax can calculate and collect tax if the owner enables it on the Stripe account | Decides whether to enable Stripe Tax and registers where required. This app does not file a return |
| Payout | Stripe pays the owner's bank on Stripe's payout schedule | Owns the bank account. This app only records `payout.paid` |
| Refund | Stripe returns the charge when this app or the Dashboard asks | The desk refund button asks Stripe. The webhook confirms the ledger row |
| Undelivered service | The app asks for a refund when the turnaround passes with no file | Does not have to click, but should watch the desk if Stripe refuses the refund |
| Chargeback | Stripe opens the dispute, may withdraw funds, and runs the evidence window | Answers Stripe with evidence. This app records the dispute and pauses automatic spending |

## For the Personal Assistant payment-flow report

The shop is inbound money only. It does not authorize a card issued to Zoora, and it does not call the purchase policy. A listing change is an append-only ledger note with a zero amount. A paid webhook appends a confirmed sale. A refund or an undelivered service appends a refund. Disputes keep the existing dispute path. Nothing in the shop is allowed to emit `propose_purchase`.

Review before any live sale: the Head of Systems still has to accept the webhook, the price bounds, the delivery link, and the refund path on a test key.
