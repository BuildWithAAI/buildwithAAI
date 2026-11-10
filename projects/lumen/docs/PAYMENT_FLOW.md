# Zoora payment flow

Owner accepted live-money risk without a test stage on 2026-11-09.

Spending, sales, and minting turn on when their credentials are present. They stay off, or on a mock that never confirms money, when those credentials are missing. No card number, CVC, private key, or issuer token is stored, logged, or shown to the model. Secrets live in environment variables or fly secrets, never in the repo.

Zoora's trading and payment runtime is not imported. The ledger shape is original.

## Sale

```mermaid
sequenceDiagram
  participant Visitor
  participant Zoora
  participant Policy
  participant Stripe
  participant Ledger
  Visitor->>Zoora: Buy a listed piece
  Zoora->>Policy: sales gate
  alt kill switch, bad config, or no live key
    Policy-->>Visitor: Sales closed
  else live gate open
    Zoora->>Stripe: Checkout session, idempotency key
    Stripe-->>Visitor: Hosted checkout
    Stripe->>Zoora: webhook checkout.session.completed
    Zoora->>Zoora: verify Stripe-Signature HMAC
    Zoora->>Ledger: append sale, confirmed only if paid
    Zoora->>Visitor: expiring SVG link (72h)
  end
```

1. A piece is listed only after the keeper approves a proposal. The price is `LUMEN_ART_PRICE_CENTS`. Zoora cannot invent one.
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
| Per-purchase, daily, monthly caps | Not applied. The card limit is the ceiling. Flip `REQUIRE_HARD_CAPS_WHEN_SPENDING` in `src/money/rules.ts` to require all three | Amounts over the cap decline |
| Sales channel | Checkout stays closed | `stripe_checkout` required to sell |
| Spend | On when card credentials exist, unless `SPEND_ENABLED=false` or the spend kill switch is on | The card's own limit is the cap |
| New merchant, product, channel, limit, or payout | Proposal or `needs_approval`. Not executed | Keeper approval recorded in the ledger |

Owner-execute on a queued intent re-checks allowlists, caps, influence, kill switch, and the spend gate. It does not skip them. It may proceed when the only hold was the auto cap or a queue, because the keeper is the approver. A reconciliation alert pauses auto-approval; the keeper clears the alert before auto-approval resumes.

## Kill switch

`LUMEN_KILL_SWITCH=true`, or any value other than empty or `false`, stops model calls, purchases, and the storefront. The keeper can also set it in the desk. Separate kill switches stop the shop, spending, and minting. A missing or malformed money value fails closed. Unset `SPEND_ENABLED` is on only when the card issuer and its key are configured.

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

## Card authorization and refund order

An approved purchase is an expected spend: merchant, maximum amount, and a one-day expiry. It is not a confirmed charge. Stripe Issuing sends `issuing_authorization.request`. The app approves that request only when the descriptor maps to the expected merchant and the amount is inside the cap. `issuing_transaction.created` then appends one confirmed purchase, with the issuer's transaction id and time. A descriptor such as `PAPER SHOP INC` maps to `paper-shop`. A charge with no matching expected spend is not invented as a ledger row. The issuer key is read only to call the issuer and is not given to the model.

A `charge.refunded` event with no refund id is stored as unconfirmed. `refund.created` appends the confirmed refund once. The public balance counts the confirmed row only.

A sweeper for a purchase stuck in progress, with an owner alert after a timeout, is still pending.
While any purchase claim is `unknown`, automatic spending is paused. The keeper's desk shows the merchant, amount, and time in America/Chicago and UTC, and asks for a confirmation. Charged needs the issuer transaction id, or an explicit unknown-id mark. The booked provider is the configured card issuer (`LUMEN_CARD_ISSUER`), not a placeholder named `issuer`. The merchant is its own ledger column, so a name like `shop.example.com` stays intact. Older notes are backfilled into that column, and the merchant is part of the ledger hash. Matching ignores case, punctuation, and a trailing company suffix, so `PAPER SHOP INC` matches `paper-shop`. An unknown-id mark covers at most one provider purchase of the same merchant and amount inside 72 hours, then it expires. A give-up notice for the same channel can be written again after an hour. Not charged writes a zero ledger row linked to the claim. Neither choice calls the issuer again. A give-up notice names the channel, and a later alert that also gives up gets its own notice.

Alert retries keep the original alert, one row per channel, and give up after about 30 minutes. The drainer runs on its own timer. A give-up notice is written once per failed alert.

## Shop

Zoora may open a shop and list original files or a small service it can deliver as a file. Details, tax, refunds, and chargebacks are in [SHOP.md](SHOP.md). Checkout uses the live Stripe key when that key and the webhook secret are set. A buyer note cannot change a price. The shop does not create a spend intent. Minting is in [NFT.md](NFT.md).

## What this is not

A green unit test with a mocked Stripe client is not a settlement. A confirmed row exists only after the provider reports it. The keeper's kill switches still stop spending, sales, and minting.
