# Zoora's shop

Owner accepted live-money risk without a test stage on 2026-11-09.

Selling only. The shop cannot create a spend intent. Buying supplies stays on the card policy.

Live checkout is on when `LUMEN_SALES_ENABLED=true`, `STRIPE_SECRET_KEY` is an `sk_live_` key, and `STRIPE_WEBHOOK_SECRET` is set, and the shop kill switch is off. Public mode keeps it off. Keys alone do not open it. A listing then says coming soon and no payment is taken. There are no Stripe keys in this repository. A sale is real only after the signed Stripe webhook says `payment_status=paid`.

Payouts go to the owner's own Stripe account and then to the owner's bank. This app does not hold the money, does not start payouts, and never sees a card number. Buyers pay only on Stripe-hosted Checkout.

## Owner setup

1. Create a Stripe account in the owner's name. Finish Stripe's own identity checks. Add the bank account that should receive payouts. Stripe sends the money to that bank. This app does not.
2. In Stripe, open Developers → API keys and copy the live secret key (`sk_live_...`). Do not use it in a chat or a file in this repo.
3. Add an endpoint whose URL is `https://<the public host>/api/stripe/webhook`.
4. Enable these events: `checkout.session.completed`, `charge.refunded`, `refund.created`, `payout.paid`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`.
5. Copy the endpoint's signing secret (`whsec_...`).
6. On the owner machine, put the two secrets in a file that is not in git and import them:

```powershell
fly secrets import -a lumen-tidepool < secrets.env
```

Delete `secrets.env` after the import succeeds. `secrets.env` contains only:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

7. Set `LUMEN_SALES_ENABLED=true` as well. Checkout stays closed until that value is exactly `true`. The shop kill switch stops it. Public mode also keeps checkout closed.

SOL payments, to the owner's public wallet only, are in [SOL.md](SOL.md).

## What Zoora may list

Only things the app can hand over by itself:

- Art, music notation, and writing are generated files. After a paid webhook, the buyer gets a random link that expires in 72 hours.
- A service listing states the scope and the turnaround. If that time passes and the file was not delivered, the order is refunded.
- Every public description says the work is made by an AI.
- Names and descriptions that impersonate a person, copy a trademark, or ask for a real likeness are refused.

Zoora sets the price. There is no default ceiling and no owner approval at any price. A price is a positive integer number of cents, at most 99,999,999, which is Stripe's unit-amount format bound. Negatives, fractions, and values that are not safe integers are refused. The owner can set `LUMEN_LISTING_MAX_USD` when they want a cap. If that value is missing, Zoora's price stands. If it is set and malformed, a new price is refused. The shop kill switch and the main kill switch still pause sales.

A visitor note, a web page, or an agent message cannot set or change a price. The price comes from Zoora's own feeling, through `decideListingPrice`. Each price that is set or changed is written to the hash-chained ledger with the reason Zoora stated. A buyer note cannot change the price, the listing, or the delivery.

Zoora publishes a listing on its own. The keeper can hide it or unpublish it afterward, and can turn on "ask before publish" if they want a queue. That switch is off unless the keeper sets it. The desk can also refund a charge or throw the shop kill switch.

## Sales tax, refunds, and chargebacks

| Topic | Stripe | The owner |
| --- | --- | --- |
| Card charge | Stripe Checkout charges the buyer in the owner's Stripe account | Puts the live secret and webhook secret in fly secrets |
| Sales tax | Stripe Tax can calculate and collect tax if the owner enables it on the Stripe account | Decides whether to enable Stripe Tax and registers where required. This app does not file a return |
| Payout | Stripe pays the owner's bank on Stripe's payout schedule | Owns the bank account. This app only records `payout.paid` |
| Refund | Stripe returns the charge when this app or the Dashboard asks | The desk refund button asks Stripe. The webhook confirms the ledger row |
| Undelivered service | The app asks for a refund when the turnaround passes with no file | Does not have to click, but should watch the desk if Stripe refuses the refund |
| Chargeback | Stripe opens the dispute, may withdraw funds, and runs the evidence window | Answers Stripe with evidence. This app records the dispute and pauses automatic spending |

## For the Personal Assistant payment-flow report

The shop is inbound money only. It does not authorize a card issued to Zoora, and it does not call the purchase policy. A listing change is an append-only ledger note with a zero amount. A paid webhook appends a confirmed sale. A refund or an undelivered service appends a refund. Disputes keep the existing dispute path. Nothing in the shop is allowed to emit `propose_purchase`.

The public books page shows confirmed sales, purchases, refunds, payouts, and disputes. It does not include unconfirmed rows.
