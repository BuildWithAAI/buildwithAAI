# Zoora's trading

Two rooms sit on the island. The Solana Saloon is a wooden false-front with batwing doors, built from original meshes. The trading floor is a separate room whose screens show stored public quotes. Neither room uses a borrowed model or a brand mark.

## Paper first

Trading starts in paper mode. The word PAPER is on the floor page, on the world screens, and in the ledger note. A paper fill uses a live DexScreener quote (`priceUsd` and `priceNative`). If that quote is missing, there is no fill and no stand-in price. The closed P&L is the difference between the entry quote and the exit quote, in USD cents and in SOL micro-units, each stamped with the quote time.

`/floor` lists the quotes, the open paper positions, the trade history, and the theses: why Zoora entered, the exit plan, and the result.

## Live switch

`LUMEN_TRADING_LIVE` is off unless it is exactly `true`. Live orders go only to `LUMEN_TRADE_SIGNER_URL`, an `https://` signer the owner runs. The body is `{ "instruction": "swap", "network": "mainnet", ... }`. This app does not hold a private key. If `LUMEN_TRADING_PRIVATE_KEY` or `SOLANA_PRIVATE_KEY` is set, trading stays closed.

The owner also sets:

- `LUMEN_TRADE_MAX_USD`, the most one trade may risk
- `LUMEN_TRADE_DAILY_LOSS_USD`, the most closed-loss plus a new trade may add in a day
- `LUMEN_TRADE_MAX_SLIPPAGE_BPS`, the highest slippage Zoora may ask
- `LUMEN_TRADE_ALLOW` and `LUMEN_TRADE_DENY`, comma-separated mints
- `LUMEN_RUG_LIQUIDITY_USD`, the liquidity in dollars under which a pair is refused. If this is unset, the check uses $5,000. The trade-size caps stay closed until the owner sets them.

A pair with a honeypot label, or with no usable quote, is refused. The kill switch stops a new trade. An uncertain signer reply is stored as unknown and pauses further trading.

The brain may propose a trade. The policy function decides. A visitor note, a web page, or a Telegram message cannot be the reason a trade is allowed.

Zoora may mention a paper trade in the owner Telegram, in the first person, and the line says it is not advice.
