# Zoora's forex

The owner's direction, 2026-11-22: AUDUSD first, at Bybit, and every trade a limit order. If no way exists for a program to place that trade, one is built.

What is built is the first half: her rules, a paper book that trades them, and a bridge that reads the broker's prices from the owner's computer. The half that sends her order to the broker is not built. Nothing here can place a real trade.

## Where AUDUSD can be traded by a program

Checked on 2026-11-22. Each line names where it came from.

- **Bybit's forex runs on MetaTrader 5.** Bybit calls it the MT5 CFD account. It was called TradFi until July 2026. It is a separate account from the unified trading account and is funded with USDT, which it shows as USDx. Source: [Bybit Learn, "What is MetaTrader 5 (MT5)? Your guide to Bybit CFD"](https://www.bybit.com/en/learn/tradfi/what-is-bybit-metatrader-5-mt5).
- **Bybit's trading API cannot trade it.** Bybit's API guide says its CFD products use MetaTrader 5 and are not supported by the V5 API. The API does trade three forex perpetual contracts of Bybit's own, EURUSDUSDT, GBPUSDUSDT and USDJPYUSDT, listed on 2026-09-08. AUDUSD is not one of them. Sources: [Bybit V5 API, TradFi integration](https://bybit-exchange.github.io/docs/v5/tradfi-integration) and [Finance Magnates](https://www.financemagnates.com/cryptocurrency/exchange/bybit-adds-247-fx-majors-to-its-crypto-derivatives-account/). The live list of those contracts could not be read from the build machine, so "three" is what those two pages say and not a count made today.
- **So her AUDUSD orders go through a MetaTrader 5 terminal.** Bybit's guide says to install the terminal from MetaTrader's own site and log in with the MT5 ID, server and password, which are separate from the Bybit login. Bybit says Expert Advisors may automate trades there. Sources: the Bybit Learn page above and [Bybit Learn, "How to use Bybit MT5"](https://www.bybit.com/en/learn/tradfi/how-to-use-bybit-mt5).
- **MetaTrader has an official Python package** that lets a program on the same Windows computer read prices and send orders through the terminal, including a waiting limit order with its stop and its target in the one request. Sources: [MetaQuotes, `order_send`](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py), and for the package being Windows only, [the NexusTrader notes on Bybit's MT5](https://nexustrader.readthedocs.io/en/latest/exchange/bybit_tradfi.html).
- **Bybit lists the United States among the places it does not serve.** Source: [Bybit, Service Restricted Countries](https://bybit.com/en/help-center/article/Service-Restricted-Countries), dated 2026-05-07 in the copy that was read. Whether an account can be held is between its holder and Bybit. Nothing built here depends on the broker being Bybit: the bridge speaks MetaTrader 5, and any broker that gives out an MT5 login will do.

Not found on any of Bybit's pages that could be read: the size of one AUDUSD lot, the smallest lot, and how near the market an order may sit. So none of them is assumed. The bridge reads them from the terminal, the `--check` below prints them, and the engine refuses a price feed whose lot or digits are not what her arithmetic uses.

## Her rules

In `src/trading/forex.ts`. Every forex order she places goes through them.

- **AUDUSD only.** Another pair is refused. Only a pair quoted in dollars can be added without more work, because its loss at the stop is a fixed number of pips.
- **0.01 lot.** She does not choose the size.
- **A limit order, and nothing else.** She names her price and which way. To buy, her price has to be under the ask. To sell, it has to be over the bid. A price at the market or through it would be a market order, so it is refused. The order then waits for a day, and is cancelled if her price has not come.
- **The stop is where the trade has lost $3.** One pip on 0.01 lot of AUDUSD is 10 cents, so the stop is 30 pips from her entry: under it for a buy, over it for a sale. The book works it out. She does not send a stop and nothing moves it.
- **The target is hers**, from her own research, with her reasons in her own words. It has to be on the side she profits on.
- **One trade in the pair at a time.** An order that a visitor, a web page or a chat message was the reason for is refused, as with coins. While the kill switch is on, nothing is placed, filled or closed.

The owner may set, and neither has to be set: `LUMEN_FX_LOTS`, the size of one trade (unset, 0.01), and `LUMEN_FX_RISK_USD`, what it loses at its stop (unset, 3). The stop follows from the two: 0.02 lot and $3 is 15 pips, 0.01 lot and $5 is 50. If the figures do not divide evenly the stop is put nearer, so the loss is never more than he said. `LUMEN_TRADE_DAILY_LOSS_USD`, if he sets it, is one limit over coins and forex together.

## The paper book

Forex is on paper, whatever `LUMEN_TRADING_LIVE` says. The engine holds her order and plays it against the broker's own prices.

- A buy is filled at her limit when the **ask** comes down to it. A sale is filled when the **bid** comes up to it.
- A trade is closed on the price she can get out at: the bid for a buy, the ask for a sale. At her stop or past it, it is closed at that price. If the market jumped past her stop, over a weekend for one, she is out at the worse price and the loss is more than $3. At her target or past it, it is closed at the target.
- The engine looks once a minute, and at each look it is given every price change since the last one, in order. So a price that touched her limit, her stop or her target between two looks is not missed, and what happened first is played first.
- Each fill and each close writes a line in the ledger, marked PAPER, with no money in it.

What the paper book does not do:

- It takes off no overnight swap and no commission. In Bybit's default account mode the cost is in the spread, which the bid and the ask already carry.
- The bridge reads the price four times a second. A spike shorter than that can be missed.
- The bridge keeps ten minutes of prices. If the engine was off for longer, what happened in between is not played.
- The engine and the bridge are meant to run on the one computer. Their clocks are then the same clock.

## The price bridge

`bridge/mt5_bridge.py`. One Python file, standard library only, plus MetaTrader's package.

It attaches to the MetaTrader 5 terminal that is already open and logged in. It holds no account number and no password: the terminal does. It listens on the same computer only, at `127.0.0.1`. It answers one instruction, `quote`. No call that places, changes, closes or cancels an order is in the file, and a test fails if one is added.

To set it up on the Windows computer, once:

1. Install MetaTrader 5 from metatrader5.com and log in to the account. Use a demo login first if the broker gives one.
2. Install Python 3 from python.org, then the package:

```powershell
pip install MetaTrader5
```

3. See what the terminal shows. This prints, changes nothing, and needs no setting:

```powershell
cd projects\lumen
python bridge\mt5_bridge.py --check
```

It prints the kind of account and the server it is on, what the terminal calls AUDUSD, the size of a lot, the smallest lot, how near the market an order may sit, which kinds of order the broker allows, whether programs may trade, and what the broker itself says 30 pips on 0.01 lot comes to. It then watches the price for three seconds and says whether it moved. The account number is not printed, so the print can be pasted anywhere. **The order half will be built from this print.**

If more than one MetaTrader 5 is installed, look at the server name on the second line. If it is not the broker meant, point the bridge at the right terminal with `LUMEN_MT5_TERMINAL`, below.

4. Make a secret, and give the same one to the bridge and to the engine:

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
$env:LUMEN_FX_BRIDGE_SECRET = "the line that printed"
python bridge\mt5_bridge.py
```

and in the engine's `.env.local`:

```
LUMEN_FX_BRIDGE_URL=http://127.0.0.1:8765
LUMEN_FX_BRIDGE_SECRET=the same line
```

Leave the bridge's window open. Ctrl+C stops it.

The bridge reads these, and only the first has to be set:

- `LUMEN_FX_BRIDGE_SECRET`, the secret above.
- `LUMEN_FX_BRIDGE_PORT`, the port on this computer. Unset, 8765.
- `LUMEN_FX_SYMBOL_AUDUSD`, the terminal's own name for AUDUSD. A broker often adds to the name, such as `AUDUSD.s`. The bridge finds the name itself and the check prints it with the others it saw. Set this only if it picked the wrong one.
- `LUMEN_MT5_TERMINAL`, the full path of `terminal64.exe`, if more than one terminal is installed.

Never put the MT5 password in the engine's settings. If `MT5_PASSWORD` or `LUMEN_MT5_PASSWORD` is set there, forex stays shut.

### What the two say to each other

The engine sends a POST to the bridge with this body, and the header `x-lumen-signature`, an HMAC-SHA256 of the body made with the secret:

```json
{ "instruction": "quote", "pair": "AUDUSD", "sinceMs": 1795316400000, "nonce": "32 hex characters", "issuedAtMs": 1795316460000 }
```

The bridge refuses a request with a wrong signature, a send time more than a minute from its own clock, or a nonce it has seen. To a stranger it answers 401 with nothing in it. To the engine it answers, signed the same way:

```json
{ "ok": true, "nonce": "the request's own", "pair": "AUDUSD", "symbol": "AUDUSD.s", "digits": 5, "contract": 100000, "stopsLevel": 0, "account": "demo", "path": [[1795316412250, 65100, 65108], [1795316437500, 65096, 65104]] }
```

`path` is every price change after `sinceMs`, oldest first: the time on the bridge's own clock, the bid and the ask. Prices are in points, so 65100 is 0.65100. It always holds at least the newest one. The bridge does not pass on the price it found when it started, because with the market shut that price could be days old.

The engine believes an answer only if it is signed with the secret and carries the nonce it sent. It does not read a feed whose `digits` is not 5 or whose `contract` is not 100000. It calls a bridge only at `127.0.0.1`, `localhost` or an `https` address.

An instruction other than `quote` is answered `READ_ONLY`.

## How it was checked

- `tests/forex.test.ts`: the rules and the paper book, 18 tests.
- `tests/fxBridge.test.ts`: the bridge started as its own process and asked over the wire by the engine's own code, through a whole paper trade. What stands in is the terminal: a small file answers the bridge's read calls. So the signing, the nonce and the answer are checked across the two languages. **The bridge has not been run against a real MetaTrader 5 terminal.** That takes the owner's computer, and step 3 above is that run.

## Not built

- **The order half.** The bridge placing her limit order at the broker with its stop and its target attached, so that the broker holds all three and they act with her engine off. It is the next build. It starts from the print of step 3, and its first run is on a demo login.
- **Nothing places a forex order yet.** She has no way to do her research and send one, as with coins. These rules are reached only by the tests.
- Her forex orders are not on the floor page.
- Her MetaTrader account's balance is not read into her books.
- Any pair but AUDUSD.
