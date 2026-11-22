# Zoora's trading

Two rooms sit on the island. The Solana Saloon is a wooden false-front with batwing doors, built from original meshes. The trading floor is a separate room whose screens show stored public quotes. Neither room uses a borrowed model or a brand mark.

## Paper first

Trading starts in paper mode. The word PAPER is on the floor page, on the world screens, and in the ledger note. A paper fill uses a live DexScreener quote (`priceUsd` and `priceNative`). If that quote is missing, there is no fill and no stand-in price. The closed P&L is the difference between the entry quote and the exit quote, in USD cents and in SOL micro-units, each stamped with the quote time.

`/floor` lists the quotes, the open paper positions, the trade history, and the theses: why Zoora entered, the exit plan, and the result.

## Live switch

`LUMEN_TRADING_LIVE` is off unless it is exactly `true`. Live orders go only to `LUMEN_TRADE_SIGNER_URL`, an `https://` signer the owner runs. The body is `{ "instruction": "swap", "network": "mainnet", ... }`, and the request carries `x-lumen-signature`, an HMAC-SHA256 of that body using `LUMEN_TRADE_SIGNER_SECRET`. The signer must authenticate the caller and reject a missing or wrong signature. This app does not hold a private key. If `LUMEN_TRADING_PRIVATE_KEY` or `SOLANA_PRIVATE_KEY` is set, trading stays closed. A signer network error is stored as unknown and pauses trading. It is not retried. Paper P&L and live P&L are stored apart, and a live fill is never labeled PAPER.

The owner may also set, and none of these has to be set:

- `LUMEN_TRADE_USD`, what one trade is. Unset, it is $3.
- `LUMEN_TRADE_DAILY_LOSS_USD`, a daily loss limit, over coins and forex together. Unset, there is none.
- `LUMEN_TRADE_ALLOW` and `LUMEN_TRADE_DENY`, comma-separated mints
- `LUMEN_RUG_LIQUIDITY_USD`, the liquidity in dollars under which a pair is refused. If this is unset, the check uses $5,000.
- `LUMEN_TRADE_MAX_USD` and `LUMEN_TRADE_MAX_SLIPPAGE_BPS` bound a trade sent straight to the gate, which her own orders never are. Unset, they are the size of one trade and 500.

## Her trading rules

The owner's rules, 2026-11-22. They are in `src/trading/book.ts`, and every order she places goes through them.

- **Every trade is $3.** She does not choose the size. An order carries none.
- **Every trade is a limit order.** She names the most she will pay for one coin. If the price is already at her limit or under it, she is filled at once at that price. Otherwise the order waits, and is filled at her limit when the price comes to it. An order that has waited a day is cancelled.
- **Every trade has a stop and a target**, set from her own research before she enters, with her reasons in her own words. An order without both, or with a stop that is not under her limit or a target that is not over it, is refused. Nothing in the book moves a stop or a target once a trade is on, and she cannot close a trade by choice.
- **The stop is acted on with no say from her.** The engine looks at her orders once a minute. A trade whose price is at its stop or under it is sold at once, at the price it is by then. If the price fell past the stop between two looks, that lower price is what it is sold at. A trade at its target or over it is sold at the target.
- **Her money is her limit.** A live order is refused unless everything she has in trades and waiting to trade, with this one, is money she has in a trading venue. Nothing has to be typed in for that. On paper there is no limit.
- **One trade in a coin at a time.** While the kill switch is on, nothing is filled and nothing is sold.

By market, as the owner set it on 2026-11-22:

- **Solana meme coins: $3 in each trade.** This is what the book does today.
- **Forex: 0.01 lot, and $3 lost at the stop.** On a pair quoted in dollars, one pip on 0.01 lot is 10 cents, so the stop is 30 pips from her entry. On any other pair a pip is worth a different amount, and the stop is as many pips as come to $3. Because the lot is fixed, so is how far away the stop can be: she can take a trade only if the price that proves her wrong is within that distance. A broker holds a limit order with its stop and its target attached, so on forex they act even when her engine is off. Built for AUDUSD, live: her order goes through a bridge on the owner's computer to the MetaTrader 5 terminal and the broker. `docs/FOREX.md` has it, with what has not yet met a real terminal.

Two things follow from how these markets work, and both were checked on 2026-11-22:

- **A coin on a bonding curve or in a pool has no order book**, so an order cannot rest at the venue. Jupiter's trigger orders would hold one, but the least it takes is $10, and a trade here is $3. So the engine holds the order itself and sends the trade when the price comes. That is why it looks once a minute, and why the engine has to be running for an order to fill or a stop to act.
- **The stop is not a limit order.** A stop that is also a limit can be skipped altogether when the price falls fast, and the trade is then still open. A stop here is there to get out: live, the signer is told to sell at once and is given room on the price, 15%. Her entry and her target are limits.

Live, the signer is sent her limit with a buy (`limitUsd`), her target with a target sale (`reason: "target"`, `minUsd`), and `reason: "stop"` with a stop sale. No signer that reads those fields exists yet. An order is taken in hand before the signer is asked, so two looks at the market cannot buy or sell it twice. If the signer's answer to a buy is unclear, the order is dropped and not tried again, because a second try could buy twice. If its answer to a sale is unclear, the trade stays open and the sale is tried again once the owner clears the pause.

Not built: nothing places an order yet. She has no way to do her research and send an order, and the owner's desk has no form for one, so today these rules are reached only by the tests. Her orders are not shown on the floor page. Fees are not taken off a paper trade. Forex is on paper only, and exchange venues, which do have order books and real limit orders, are not connected.

A pair with a honeypot label, or with no usable quote, is refused. The kill switch stops a new trade. The desk also has a trading kill and a control that clears the unknown pause. Both require the owner session and both write an audit row. An uncertain signer reply is stored as unknown and pauses further trading.

The brain may propose a trade. The policy function decides. A visitor note, a web page, or a Telegram message cannot be the reason a trade is allowed.

Zoora may mention a paper trade in the owner Telegram, in the first person, and the line says it is not advice.
