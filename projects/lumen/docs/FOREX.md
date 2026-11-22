# Zoora's forex

The owner's direction, 2026-11-22:

- AUDUSD first, at Bybit, and every trade a limit order.
- If no way exists for a program to place that trade, one is built.
- **There is no paper trading. Everything is live.**

So her forex order is a real order. It goes from her engine to a bridge on the owner's computer, and from the bridge through the MetaTrader 5 terminal to the broker, with its stop and its target in the same request. The broker then holds all three.

**What has not happened yet:** the bridge has never been run against a real MetaTrader 5 terminal. Everything below was checked against a stand-in for the terminal. The first run on the owner's computer is `--check`, which sends nothing, and then `--prove`, which places one real order that cannot fill and pulls it again. And nothing decides to place a forex order yet: she has no way to do her research and send one.

## Where AUDUSD can be traded by a program

Checked on 2026-11-22. Each line names where it came from.

- **Bybit's forex runs on MetaTrader 5.** Bybit calls it the MT5 CFD account. It was called TradFi until July 2026. It is a separate account from the unified trading account and is funded with USDT, which it shows as USDx. Source: [Bybit Learn, "What is MetaTrader 5 (MT5)? Your guide to Bybit CFD"](https://www.bybit.com/en/learn/tradfi/what-is-bybit-metatrader-5-mt5).
- **Bybit's trading API cannot trade it.** Bybit's API guide says its CFD products use MetaTrader 5 and are not supported by the V5 API. The API does trade three forex perpetual contracts of Bybit's own, EURUSDUSDT, GBPUSDUSDT and USDJPYUSDT, listed on 2026-09-08. AUDUSD is not one of them. Sources: [Bybit V5 API, TradFi integration](https://bybit-exchange.github.io/docs/v5/tradfi-integration) and [Finance Magnates](https://www.financemagnates.com/cryptocurrency/exchange/bybit-adds-247-fx-majors-to-its-crypto-derivatives-account/). The live list of those contracts could not be read from the build machine, so "three" is what those two pages say and not a count made today.
- **So her AUDUSD orders go through a MetaTrader 5 terminal.** Bybit's guide says to install the terminal from MetaTrader's own site and log in with the MT5 ID, server and password, which are separate from the Bybit login. Bybit says Expert Advisors may automate trades there. Sources: the Bybit Learn page above and [Bybit Learn, "How to use Bybit MT5"](https://www.bybit.com/en/learn/tradfi/how-to-use-bybit-mt5).
- **MetaTrader has an official Python package** that lets a program on the same Windows computer read prices and send orders through the terminal. Its request carries the price, the stop and the target together, and `order_check` has the terminal check a request without sending it. Sources: [MetaQuotes, `order_send`](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py), [`order_check`](https://www.mql5.com/en/docs/python_metatrader5/mt5ordercheck_py), [`order_calc_profit`](https://www.mql5.com/en/docs/python_metatrader5/mt5ordercalcprofit_py), [`history_deals_get`](https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py). For the package being Windows only: [the NexusTrader notes on Bybit's MT5](https://nexustrader.readthedocs.io/en/latest/exchange/bybit_tradfi.html).
- **A waiting order is filled the "return" way.** MetaQuotes' book says a pending order must use the return filling policy whatever the pair's execution mode. Source: [MQL5 book, the page on execution and filling modes](https://www.mql5.com/en/book/automation/experts/experts_execution_filling). The bridge sends that, and tries the other two only if the broker's own check refuses it.
- **Bybit lists the United States among the places it does not serve.** Source: [Bybit, Service Restricted Countries](https://bybit.com/en/help-center/article/Service-Restricted-Countries), dated 2026-05-07 in the copy that was read. Whether an account can be held is between its holder and Bybit. Nothing built here depends on the broker being Bybit: the bridge speaks MetaTrader 5, and any broker that gives out an MT5 login on a hedging account will do.

Not found on any of Bybit's pages that could be read: the size of one AUDUSD lot, the smallest lot, how near the market an order may sit, and whether its account lets a program trade. So none of them is assumed. The bridge reads each from the terminal before every order and refuses the order if one is not as her arithmetic needs, and `--check` prints them all.

## Her rules

In `src/trading/forex.ts`, and the two that are money are held in the bridge as well.

- **AUDUSD only.** Another pair is refused. Only a pair quoted in dollars can be added without more work, because its loss at the stop is a fixed number of pips.
- **0.01 lot.** She does not choose the size.
- **A limit order, and nothing else.** She names her price and which way. To buy, her price has to be under the ask. To sell, it has to be over the bid. The bridge checks that against the live price, and a price at the market or through it is refused: it would be a market order. The order then waits at the broker for a day, and is pulled if her price has not come.
- **The stop is where the trade has lost $3.** One pip on 0.01 lot of AUDUSD is 10 cents, so the stop is 30 pips from her entry: under it for a buy, over it for a sale. The book works it out. She does not send a stop, and nothing in the engine or the bridge can move one.
- **The target is hers**, from her own research, with her reasons in her own words. It has to be on the side she profits on.
- **One trade in the pair at a time.** An order that a visitor, a web page or a chat message was the reason for is refused, as with coins.
- **She does not close a trade by choice.** Neither the engine nor the bridge has a way to. A trade ends at its stop or its target, at the broker. The owner can always close one himself in the terminal, and the book writes that down as what it was.

The owner may set, and neither has to be set: `LUMEN_FX_LOTS`, the size of one trade (unset, 0.01), and `LUMEN_FX_RISK_USD`, what it loses at its stop (unset, 3). The stop follows from the two: 0.02 lot and $3 is 15 pips, 0.01 lot and $5 is 50. If the figures do not divide evenly the stop is put nearer, so the loss is never more than he said. **Set them for the bridge as well as the engine.** The bridge refuses an order that is not its own size or that loses more than its own figure, so if the two disagree no order is placed.

When she may not trade: while the kill switch is on; while an unclear word about a real order is waiting for the owner (`trading_unknown`); while a brake is tripped; on the public site with money still shut; if he has set the ladder to "earned" and has not approved the step that opens trading; past `LUMEN_TRADE_DAILY_LOSS_USD`, if he sets it, which is one limit over coins and forex. Whether her money covers a trade is the broker's to say: the terminal checks every order against the account before it is sent.

There is no switch that turns forex on. It is on when the bridge is set up, which is `LUMEN_FX_BRIDGE_URL` and `LUMEN_FX_BRIDGE_SECRET` in the engine and the bridge running on the computer. `LUMEN_TRADING_LIVE` is not read.

## What happens to an order

1. The engine checks her order against the rules and writes it down as on its way. Only then does it ask the bridge. An order that is written down is never sent a second time.
2. The bridge refuses it unless it is the owner's size, the terminal and the account are open to a program's orders, the account is a hedging one in dollars or USDT, the pair is the size and digits her arithmetic assumes, and her price is on the waiting side of the live market.
3. The bridge asks the terminal for its own sum of what the trade loses at its stop. If that is not what the rule says, the order is refused.
4. The bridge has the terminal check the order, without sending it. The broker's no, if it says no, is passed back with its reason.
5. The bridge writes the order in its own record, then sends it: a waiting limit order with its stop and its target in the one request.
6. The bridge reads the order back from the broker. If its price, size, stop or target is not what was sent, it pulls the order and says so. If it cannot pull it, it says so loudly, and her trading stops until the owner has looked.
7. From then on the engine asks the bridge once a minute where the order stands, and writes that down: waiting, filled, closed at its stop, closed at its target, closed some other way, or pulled. The fill, the exit and the result are the broker's own figures, with its commission and its swap taken off.

If the bridge gives no clear word, the order stays written as on its way, no other order is placed in the pair, and the engine keeps asking. The bridge finds an order the broker took by the note it carries. An order the bridge has no record of after two minutes never reached the broker and is written off.

The kill switch pulls every order of hers that is still waiting at the broker. A trade that is already open is left as it is, with its stop and its target.

Each fill and each close writes a line in her ledger, marked LIVE, with no money in it: her books take their money from the account's own balance, not from a sum of trades. If the terminal is logged in to a broker's practice account, the broker says so, and the order and its ledger lines are marked DEMO and counted apart from real money.

## The bridge

`bridge/mt5_bridge.py`. One Python file, standard library only, plus MetaTrader's package.

It attaches to the MetaTrader 5 terminal that is already open and logged in. It holds no account number and no password: the terminal does. It listens on the same computer only, at `127.0.0.1`.

It answers four instructions: `quote`, `place`, `state` and `cancel`. There is no market order in the file, no changing of a stop or a target, no closing of a trade and no login, and a test fails if one is added. It sends the broker two kinds of request only: a waiting limit order, and the removal of one.

To set it up on the Windows computer, once:

1. Install MetaTrader 5 from metatrader5.com and log in to the account.
2. In the terminal, press **Algo Trading** so it is on, and in Tools, Options, Expert Advisors leave "Disable automatic trading via external Python API" unticked.
3. Install Python 3 from python.org, then the package:

```powershell
pip install MetaTrader5
```

4. See what the terminal shows. This sends nothing and needs no setting:

```powershell
cd projects\lumen
python bridge\mt5_bridge.py --check
```

It prints the kind of account and the server it is on, what the terminal calls AUDUSD, the size of a lot, the smallest lot, how near the market an order may sit, which kinds of order the broker allows, and whether programs may trade. It prints the terminal's own sum for a 30-pip loss on 0.01 lot, and the terminal's own answer to an order like hers, asked without sending one. It then watches the price for three seconds. The account number is not printed, so the print can be pasted anywhere.

If more than one MetaTrader 5 is installed, look at the server name on the second line. If it is not the broker meant, point the bridge at the right terminal with `LUMEN_MT5_TERMINAL`, below.

5. Prove the road. **This places one real order on the account**, of her size, 300 pips under the market where it cannot be filled, with its stop and its target. It reads it back from the broker, asks to place it again to see that it is not sent twice, pulls it, and checks nothing is left:

```powershell
python bridge\mt5_bridge.py --prove
```

It needs the market to be open. It is the same road every order of hers takes, so what it prints is what that road does on this account.

6. Make a secret, and give the same one to the bridge and to the engine:

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

Leave the bridge's window open. Ctrl+C stops it. Orders and trades already at the broker stay there with their stops and targets, whether the bridge or the engine is running or not.

The bridge reads these, and only the first has to be set:

- `LUMEN_FX_BRIDGE_SECRET`, the secret above.
- `LUMEN_FX_BRIDGE_PORT`, the port on this computer. Unset, 8765.
- `LUMEN_FX_LOTS` and `LUMEN_FX_RISK_USD`, the owner's two figures. Unset, 0.01 and 3. Set them here if they are set for the engine.
- `LUMEN_FX_SYMBOL_AUDUSD`, the terminal's own name for AUDUSD. A broker often adds to the name, such as `AUDUSD.s`. The bridge finds the name itself and the check prints it with the others it saw. Set this only if it picked the wrong one.
- `LUMEN_MT5_TERMINAL`, the full path of `terminal64.exe`, if more than one terminal is installed.
- `LUMEN_FX_BRIDGE_JOURNAL`, where its record of what it sent is kept. Unset, `.zoora\mt5-bridge.json` in the home folder. It holds her orders' ids, tickets and prices, and no secret. Do not delete it while an order is out.

Never put the MT5 password in the engine's settings. If `MT5_PASSWORD` or `LUMEN_MT5_PASSWORD` is set there, forex stays shut.

### What the two say to each other

The engine sends a POST to the bridge with a JSON body, and the header `x-lumen-signature`, an HMAC-SHA256 of the body made with the secret. Every body carries a `nonce` of 32 hex characters and `issuedAtMs`. The bridge refuses a request with a wrong signature, a send time more than a minute from its own clock, or a nonce it has seen. To a stranger it answers 401 with nothing in it. Every answer to the engine is signed the same way and carries the request's nonce, and the engine believes nothing else.

```json
{ "instruction": "place", "id": "fx-1a2b3c4d", "pair": "AUDUSD", "side": "buy", "centiLots": 1, "limit": 65000, "stop": 64700, "target": 65600, "lossCents": 300 }
```

Prices are in points, so 65000 is 0.65000. `centiLots` is hundredths of a lot. The answer says where it stands:

```json
{ "ok": true, "id": "fx-1a2b3c4d", "status": "resting", "ticket": "70000002", "account": "real", "side": "buy", "centiLots": 1, "limit": 65000, "stop": 64700, "target": 65600 }
```

or why not, with the broker's own words if it was the broker:

```json
{ "ok": false, "reason": "BROKER_10016", "brokerSays": "Invalid stops" }
```

`{ "instruction": "state", "id": "fx-1a2b3c4d" }` and `{ "instruction": "cancel", "id": "fx-1a2b3c4d" }` are answered the same way. `status` is one of `none`, `unknown`, `refused`, `resting`, `open`, `closed`, `cancelled`. An open trade carries `fill`. A closed one carries `fill`, `exit`, `exitWhy` (`stop`, `target` or `other`), `resultCents` and `costCents`.

`{ "instruction": "quote", "pair": "AUDUSD", "sinceMs": 1795316400000 }` is answered with `path`: every price change after that time, oldest first, as the time on the bridge's own clock, the bid and the ask. It is for her research. The bridge does not pass on the price it found when it started, because with the market shut that price could be days old.

The refusals: `LOTS`, `RISK`, `LEVELS`, `FX_LIMIT`, `ALREADY`, `PAIR`, `SIDE`, `ID` from the rules; `TERMINAL`, `TRADING_OFF`, `ACCOUNT_OFF`, `NETTING`, `CURRENCY`, `SYMBOL`, `SPEC`, `ORDER_KIND`, `SYMBOL_OFF`, `NO_PRICE`, `SUM`, `CHECK` from what the terminal shows; `BROKER_` and a number when the broker's check or the broker itself said no; `READBACK` when the order was pulled because it was not what was sent, `READBACK_STUCK` when it could not be pulled; `UNKNOWN` when there was no clear word.

## How it was checked

- `tests/forex.test.ts`, 17 tests: the engine's side, with a bridge of a few lines standing in. What she sends, every gate, an order never sent twice, a quiet bridge, the broker's figures written down, forged answers ignored, the alarm when the broker holds something other than she sent.
- `tests/fxBridge.test.ts`, 15 tests: the bridge started as its own process and asked over the wire, by raw requests and by the engine's own code. Every request it sent the broker is read back and compared, whole. A trade is followed to its stop, its target, a jump past the stop, and a close by hand.
- Twenty-six deliberate breaks of the bridge and the book, one at a time. The tests caught each one that mattered. One break was a check the terminal's sum already covered, and that check was removed.

What stands in, in both, is MetaTrader: a file in `tests/fixtures/mt5` that answers the bridge's calls the way MetaQuotes' pages say the terminal does. **It is not a terminal and not a broker.** Whether Bybit's account lets a program trade, how it fills a waiting order, what it does to an order's note, and what its figures look like are all still to be seen, and steps 4 and 5 above are how.

## Not built

- **Her research and her own orders.** Nothing decides to place a forex order. The rules above are reached by the tests, by `--prove`, and by nothing else.
- Her forex orders are not on the floor page.
- Her MetaTrader account's balance is not read into her books.
- Any pair but AUDUSD. A broker account that nets every trade in a pair into one position: the bridge refuses to trade on it.
- An order waiting at the broker when the engine is off for more than a day is not pulled until the engine is back. It keeps its stop and its target.
