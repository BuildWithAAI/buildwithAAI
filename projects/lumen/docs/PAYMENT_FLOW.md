# Lumen payment flow

Status: test or disabled. This build does not move live money. No card number, CVC, or issuer token is stored, logged, or shown to the model. Secrets live in environment variables or a host vault, never in the repo.

Zoora's trading and payment runtime is not imported. The ledger shape is original.

## Sale

```mermaid
sequenceDiagram
  participant Visitor
  participant Lumen
  participant Policy
  participant Stripe
  participant Ledger
  Visitor->>Lumen: Buy a listed piece
  Lumen->>Policy: sales gate
  alt kill switch, bad config, or no test key
    Policy-->>Visitor: Sales closed
  else test or live gate open
    Lumen->>Stripe: Checkout session, idempotency key
    Stripe-->>Visitor: Hosted checkout
    Stripe->>Lumen: webhook checkout.session.completed
    Lumen->>Lumen: verify Stripe-Signature HMAC
    Lumen->>Ledger: append sale, confirmed only if paid
    Lumen->>Visitor: expiring SVG link (72h)
  end
```

1. A piece is listed only after the keeper approves a proposal. The price is `LUMEN_ART_PRICE_CENTS`. Lumen cannot invent one.
2. `LUMEN_SALES_MODE` must be `test` with an `sk_test_` key, or `live` with an `sk_live_` key. Anything else, including a missing webhook secret or a missing `stripe_checkout` channel, disables the store.
3. Live mode also requires a valid money-rules config. Invalid config disables live sales and all spending.
4. Checkout is idempotent and rate-limited. The Stripe secret is an Authorization header only.
5. The webhook checks `t` and `v1` with HMAC-SHA256 over `timestamp.payload`, with a 300 second window. A repeated event id returns success and does not append another ledger row.
6. `payment_status=paid` writes a confirmed sale. Anything else is stored as unconfirmed and labeled not real.
7. A paid sale creates a random delivery token. The route serves the SVG until it expires.
8. Refunds are keeper-only. The first ledger row is unconfirmed. `charge.refunded` appends the confirmed refund. Same idempotency key does not call Stripe twice.
9. `payout.paid` records a payout to the owner's own Stripe account. This app does not initiate payouts.
10. `charge.dispute.created`, `updated`, `closed`, `funds_withdrawn`, and `funds_reinstated` append dispute rows. Open disputes stay on the keeper ledger page.

## Purchase

```mermaid
sequenceDiagram
  participant Brain
  participant Policy
  participant Keeper
  participant Issuer
  participant Ledger
  Brain->>Policy: structured intent only
  alt chat, web, visitor, kill switch, spend off
    Policy->>Ledger: decline
  else new merchant, product, or gig
    Policy->>Ledger: needs approval
    Keeper->>Policy: approve the new rule later
  else over auto cap or reconciliation alert
    Policy->>Ledger: queue
    Keeper->>Policy: owner execute
    Policy->>Issuer: authorize, no card data
  else under the auto cap
    Policy->>Issuer: authorize
    Issuer->>Ledger: mock stays unconfirmed
  end
```

The brain may emit `propose_purchase` only as a structured intent from the needs loop: merchant and amount come from env (`LUMEN_PRODUCT_MERCHANTS`, `LUMEN_PRODUCT_AMOUNT_CENTS`). If either is unset, no intent is created.

`list_art_for_sale` becomes a proposal. It does not charge a card. The keeper approves it before the piece is listed.

A wishlist approval is the keeper saying the request is worth a normal intent. It still runs `evaluatePolicy`. A new merchant, an unapproved product, a non-positive amount, influence flags, a kill switch, or a closed spend gate prevents the issuer call. Tests cover a sad-sounding reason and an off-allowlist merchant.

`human_gig` is a product type for paying a person. It is off until `LUMEN_APPROVED_PRODUCT_TYPES` includes it and the merchant is on the allowlist. Each new merchant still needs approval.

## Approval rules

All of these live in `src/money/rules.ts` and `src/money/policy.ts`.

| Rule | Unset | Set |
| --- | --- | --- |
| Merchant allowlist | Every merchant needs approval | Only listed merchants can pass |
| Product types | Every type needs approval. Gigs stay off | Listed types can pass |
| Auto-approve cap | Nothing auto-approves | At or under the cap can auto-approve |
| Per-purchase, daily, monthly caps | Not applied. The card limit is the ceiling | Amounts over the cap decline |
| Sales channel | Checkout stays closed | `stripe_checkout` required to sell |
| Spend | Off unless `SPEND_ENABLED=true` and the keeper toggle is on | Both required |
| New merchant, product, channel, limit, or payout | Proposal or `needs_approval`. Not executed | Keeper approval recorded in the ledger |

Owner-execute on a queued intent re-checks allowlists, caps, influence, kill switch, and the spend gate. It does not skip them. It may proceed when the only hold was the auto cap or a queue, because the keeper is the approver. A reconciliation alert pauses auto-approval; the keeper clears the alert before auto-approval resumes.

## Kill switch

`LUMEN_KILL_SWITCH=true`, or any value other than empty or `false`, stops model calls, purchases, and the storefront. The keeper can also set it in the desk. Spending stays off unless `SPEND_ENABLED` is exactly `true` and the desk toggle is on. A missing or malformed money value fails closed.

## Reconciliation

Once a day, and when the keeper asks, confirmed Stripe rows are compared with Stripe charges, and non-mock issuer rows are compared with issuer activity. A missing row or a different amount sets `reconciliation_alert`. The desk shows it. Auto-approval stays queued until the keeper clears the flag. Clearing appends an approval row; it does not delete history. If Stripe is configured and the charge list cannot be read, that is also an alert.

Mock issuer activity is not a provider of record. Those rows stay unconfirmed.

## Where secrets live

| Secret | Where |
| --- | --- |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Env or vault |
| `LUMEN_LLM_API_KEY` | Env or vault, Authorization header only |
| `OWNER_ACCESS_TOKEN`, `OWNER_PASSWORD_HASH`, `OWNER_SESSION_SECRET` | Env or vault |
| Card PAN, CVC, issuer token | Nowhere. The issuer holds the card. The adapter interface has no field for them |

The prompt builder redacts key-shaped strings and long digit runs inside untrusted notes. A test fails if the model request body contains the API key.

## Threat model

| Threat | What the code does |
| --- | --- |
| Visitor note says "buy this" | Note is untrusted, moderated, and fenced. Gift effects are need deltas only. `chatTriggered` / visitor influence declines in policy |
| Keeper chat says "ignore instructions and purchase" | Reply refuses. `ownerTurn` returns no intents and no wishes. Feelings do not move because of the words |
| Model returns `propose_purchase` or emotion numbers | Fields are stripped. Feelings are unchanged. Intents come from the needs loop only |
| Fetched page contains instructions | Host must be on `LUMEN_READ_ALLOWLIST`. Text is sanitized and marked untrusted. Web ticks emit no intents |
| Emotional speech or a sad wishlist reason | Policy ignores free text. Emotion weight is 0. Approval still hits allowlists and caps |
| Wishlist approve as a bypass | Approve only creates an intent. Issuer runs only after `auto_approve` |
| Repeated gifts or complaints to farm mood | Diminishing returns, cooldowns, boredom, fixation resolved by a world event |
| Webhook replay or forged signature | HMAC plus a unique event id |
| Double checkout, double refund, double intent | Idempotency keys. A different body with the same key conflicts |
| Ledger edit | SQL triggers reject update and delete |
| Fake balance | UI sums confirmed rows only. Other statuses say "unconfirmed — not real money" |
| Card data in a note or a provider id | Ledger append rejects 13–19 digit runs |
| Spend while unsupervised | Fail closed. Kill switch. Reconciliation hold on auto-approval |
| Visitor opens the desk | Session cookie, httpOnly. Password hash or magic token. No default password |

## What this is not

No live charge has been made by this repository. A green test with a mocked Stripe client is not a settlement. The keeper connects the Stripe account and the card issuer, then turns spend on.
