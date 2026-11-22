# Setup day

The owner's direction, 2026-11-22: "We will do everything on the computer at once when everything is complete and ready to fully setup."

So nothing asks him to run a step on his computer before then. Everything that needs his computer, his wallet or his broker login is on this page, in the order it is done, and it is done in one sitting. Everything that can be built and checked without his computer is built and checked before that day.

This page is kept true as pieces land. A step whose piece is not built yet says so.

## What has to be built first

The owner decides when the build is complete. These are the pieces that are not built today, in the order they are being built:

- [ ] **Her research and her own orders** (backlog 0v). Today nothing decides to place an order.
- [ ] **The coin signer for his one wallet** (0t, 0e). Today a coin order has nowhere to go.
- [ ] **Loading the world by area** (0c). Today the public view cannot load a world of 400 builds.
- [ ] **The open security findings** (0z). Four matter before real keys go in.
- [ ] **The owner's decision on what she builds with no model** (0z).
- [ ] **The setup command** (0y). One command that walks this page in order and writes down what it saw.

Built and waiting for the day: the engine, her world and her rooms, her trading rules, the forex bridge (`docs/FOREX.md`), the floor page, home sales in SOL (`docs/LAND.md`, `docs/SOL.md`).

## What he needs to have ready

- The Windows computer, with a real graphics card, and three programs: Git, Node.js 22.13 or newer, and Python 3.
- MetaTrader 5, installed from metatrader5.com, and the broker's MT5 login: its ID, its server and its password. They are typed into the terminal and nowhere else.
- Money in that account. Whatever he deposits is her balance.
- A model key for her brain: the provider's address, the key and the model's name.
- His one wallet. The engine is given its public address only.
- Optional: a Telegram bot token and his numeric chat and user ids (`docs/TELEGRAM.md`).

**Never typed into the engine, its settings, this repository or a chat:** the wallet's private key or seed phrase, and the MT5 password. The engine refuses to trade if it finds one in its settings.

## The sitting, in order

Each step ends on something that can be seen. If a step does not end that way, the sitting stops there and what was seen is written down. Nothing later depends on guessing.

### 1. The engine, private

```powershell
git pull
cd projects\lumen
npm install
npm run build
copy .env.example .env.local
```

In `.env.local`: `OWNER_PASSWORD_HASH` (from `npm run hash-password`), `OWNER_SESSION_SECRET`, `LUMEN_LLM_BASE_URL`, `LUMEN_LLM_API_KEY`, `LUMEN_LLM_MODEL`. The table in `README.md` says what each is. Leave `LUMEN_PUBLIC_MODE` unset: the first run is private.

**Set the model key before the first start.** With no working model the engine builds for her from the things it knows how to make, at places drawn by chance, and it starts within the first minute (`docs/AUDIT_2026-11-22.md`, finding 2).

```powershell
npm start
```

Ends on: `http://localhost:3000` opens her world in a browser with the model key set, and the frame rate and the look are written down (backlog 0b).

### 2. Forex: the bridge to the broker

`docs/FOREX.md`, "The bridge", has every step. In short:

1. The terminal is open and logged in, with **Algo Trading** on.
2. `pip install MetaTrader5`
3. `python bridge\mt5_bridge.py --check`. It sends nothing. It prints the kind of account, what the terminal calls AUDUSD, the size of a lot, whether programs may trade, the terminal's own sum for a 30-pip loss, the terminal's own answer to an order like hers, whether the pair's history can be read, and how far the broker's clock is from UTC.
4. `python bridge\mt5_bridge.py --prove`. **This places one real order**, 0.01 lot, 300 pips under the market where it cannot fill, reads it back, shows it is not sent twice, and pulls it. The market has to be open.
5. A secret is made and given to the bridge and to the engine, the bridge is started, and the engine is started again.

Ends on: `/floor` says LIVE and "Forex is connected to the broker", and what `--check` and `--prove` printed is saved with the date (backlog 0w).

If `--check` shows an account that nets its trades, or one that does not let programs trade, the sitting stops here for forex. The bridge refuses to trade on either, and says which.

### 3. Coins: his wallet and the signer

Not built yet (backlog 0t). When it is, this step sets the signer's address and the secret it shares with the engine, and ends on `/floor` saying "Coins are connected to the signer".

### 4. Her first order

Not built yet (backlog 0v). When it is, this step ends on her first real order showing on `/floor` with her limit, the book's stop, her target and her reasons.

### 5. The first home sale

His wallet's public address goes in `LUMEN_SOL_RECEIVE_ADDRESS`, and he buys one $1 home with his own wallet. `docs/SOL.md` has the settings and `docs/LAND.md` has how a home is bought.

Ends on: the unit shows as sold to that wallet, the ledger has one confirmed sale of $1.00 with the transaction's signature, and the SOL is in the receiving wallet (backlog 0r).

### 6. Optional: Telegram

`docs/TELEGRAM.md`. Ends on `/status` answering from his own chat.

## What is known and not known before the day

Checked without his computer: every rule in her trading book, the bridge against a stand-in for MetaTrader, the engine and the bridge run together, and the pages (`docs/TRADING.md`, `docs/FOREX.md`).

Not known until the day, because only his computer can show it: what his broker's account allows, what it calls AUDUSD, how it fills a waiting order, and how the world looks and runs on his graphics card. Each of these is read and printed by the step that needs it before anything is sent, so a surprise stops the sitting at that step and costs nothing.
