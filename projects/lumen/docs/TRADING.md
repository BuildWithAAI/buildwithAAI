# Zoora's trading

Two rooms sit on the island. The Solana Saloon is a wooden false-front with batwing doors, built from original meshes. The trading floor is a separate room whose screens show stored public quotes. Neither room uses a borrowed model or a brand mark.

## Live only

There is no paper trading. The owner's rule, 2026-11-22: "There is zero paper trading. It's live trading everything. Everything should be shipped for live only."

- **An order of hers goes to a real venue or it is not placed.** Forex goes to the owner's broker, through the bridge on his computer (`docs/FOREX.md`). A coin trade goes to a signer he runs.
- **Nothing chooses between paper and live.** `LUMEN_TRADING_LIVE` is not read. A side is on when its venue is connected, and off when it is not.
- **With no venue, nothing is written down.** A coin order with no signer set is refused with `NO_SIGNER`. A forex order with no bridge set is refused with `NO_BRIDGE`. Neither leaves a row behind.
- **A row left from when there was paper trading is closed out** each time the database is opened. It is on no page and in no total. It is never filled, never sold, never counted as money out or as a loss, and the broker is never asked about it.

`/floor` shows her forex orders, her coin quotes, her open coin positions and her results, each with why she entered. The top of the page says LIVE when an order of hers can reach a venue and CLOSED when it cannot. The board in the world's trading floor says the same, and so does `/status` in the owner's Telegram, for each side.

A forex order placed while the terminal was logged in to a broker's practice account is marked DEMO and left out of every total. The broker says which kind of account it is. The engine has no setting for it.

What the figures are:

- **A forex result is the broker's own figure**, with its commission and its swap taken off.
- **A coin figure is the DexScreener quote at the time of the trade** (`priceUsd` and `priceNative`). What the chain gave, with its slippage and its fees, is not read back yet, so the true result can differ. If the quote is missing there is no trade and no stand-in price.

## The coin signer

Coin orders go only to `LUMEN_TRADE_SIGNER_URL`, an `https://` signer the owner runs, with `LUMEN_TRADE_SIGNER_SECRET`, a secret of at least 32 characters that the two share. With both set, coin trading is on. With either missing, or the address not `https://`, or the secret shorter, it is off.

The body is `{ "instruction": "swap", "network": "mainnet", ... }`, and the request carries `x-lumen-signature`, an HMAC-SHA256 of that body using the secret. The signer must authenticate the caller and reject a missing or wrong signature. This app does not hold a private key. If `LUMEN_TRADING_PRIVATE_KEY` or `SOLANA_PRIVATE_KEY` is set, trading stays closed. A signer network error is stored as unknown and pauses trading. It is not retried.

Nothing is sent to an address that is not `https://`, or signed with a shorter secret. That holds for a sale as much as for a buy. If a stop comes due while no proper signer is set, the sale is not sent, the trade stays open, and her trading waits for the owner.

**No signer that speaks this exists yet.** So today a coin order has nowhere to go, and she trades no coin.

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
- **Her money is her limit.** An order is refused unless everything she has in trades and waiting to trade, with this one, is money she has in a trading venue. Nothing has to be typed in for that.
- **One trade in a coin at a time.** While the kill switch is on, nothing is filled and nothing is sold.

By market, as the owner set it on 2026-11-22:

- **Solana meme coins: $3 in each trade.** This is what the book does today.
- **Forex: 0.01 lot, and $3 lost at the stop.** On a pair quoted in dollars, one pip on 0.01 lot is 10 cents, so the stop is 30 pips from her entry. On any other pair a pip is worth a different amount, and the stop is as many pips as come to $3. Because the lot is fixed, so is how far away the stop can be: she can take a trade only if the price that proves her wrong is within that distance. A broker holds a limit order with its stop and its target attached, so on forex they act even when her engine is off. Built for AUDUSD, live: her order goes through a bridge on the owner's computer to the MetaTrader 5 terminal and the broker. `docs/FOREX.md` has it, with what has not yet met a real terminal.

Two things follow from how these markets work, and both were checked on 2026-11-22:

- **A coin on a bonding curve or in a pool has no order book**, so an order cannot rest at the venue. Jupiter's trigger orders would hold one, but the least it takes is $10, and a trade here is $3. So the engine holds the order itself and sends the trade when the price comes. That is why it looks once a minute, and why the engine has to be running for an order to fill or a stop to act.
- **The stop is not a limit order.** A stop that is also a limit can be skipped altogether when the price falls fast, and the trade is then still open. A stop here is there to get out: the signer is told to sell at once and is given room on the price, 15%. Her entry and her target are limits.

The signer is sent her limit with a buy (`limitUsd`), her target with a target sale (`reason: "target"`, `minUsd`), and `reason: "stop"` with a stop sale. An order is taken in hand before the signer is asked, so two looks at the market cannot buy or sell it twice. If the signer's answer to a buy is unclear, the order is dropped and not tried again, because a second try could buy twice, and she is told it is not on. If its answer to a sale is unclear, the trade stays open and the sale is tried again once the owner clears the pause. If the signer is taken away while an order waits, the order goes on waiting. It is not filled any other way.

Not built:

- **Nothing places an order yet.** She has no way to do her research and send an order, and the owner's desk has no form for one, so today these rules are reached only by the tests (backlog 0v).
- **No coin signer exists** that speaks the protocol above, so a coin order has nowhere to go (backlog 0t).
- **What the chain gave for a coin trade is not read back.** A coin result is the quote's figure until the signer reports the fill.
- Her waiting coin orders are not on the floor page. It shows her coin positions and results, and every forex order.
- The money in the MetaTrader account is not in her books yet.
- Exchange venues, which do have order books and real limit orders, are not connected.

A pair with a honeypot label, or with no usable quote, is refused. The kill switch stops a new trade. The desk also has a trading kill and a control that clears the unknown pause. Both require the owner session and both write an audit row. An uncertain signer reply is stored as unknown and pauses further trading.

The brain may propose a trade. The policy function decides. A visitor note, a web page, or a Telegram message cannot be the reason a trade is allowed.

Zoora may mention a trade of hers in the owner Telegram, in the first person, and the line says it is not advice.

## How live-only was checked, 2026-11-22

- The tests: `tests/trading.test.ts` (13), `tests/forex.test.ts` (18), `tests/fxBridge.test.ts` (15), and the floor, the board, Telegram and the ladder in `compliance`, `scene`, `telegram`, `ladder`, `recheck`, `rereview10` and `rereview11`. The whole suite is 556 tests. One fails on the build machine only, the desk proxy on IPv6, as it did before.
- Thirty-eight deliberate breaks, one at a time: a signer that is not https, a short secret, the refusal with no signer taken out, each place a row marked paper could be read as hers, the step that closes old paper rows, the polling bot keeping the signer or the bridge, the board and the page saying LIVE when they should not. The tests caught thirty-seven. The one they did not catch is a second check in the polling loop that can only fire if the first, which is tested, is broken.
- A run of the built engine with the real bridge and the stand-in terminal: an order placed through the engine's own code showed on `/floor` as waiting, then in the trade once the price came, then closed at its target at $6.00, each written by the engine's own timer. The bridge sent the broker one check and one order. With the bridge's settings taken away the same page said CLOSED and still showed the trade. No page said paper or simulated.

What stood in for MetaTrader in that run is the file in `tests/fixtures/mt5`. It is not a terminal and not a broker (`docs/FOREX.md`). No coin trade was run, because no signer exists.
