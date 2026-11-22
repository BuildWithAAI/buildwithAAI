# Her land

The world is a grid of chunks, each 180 metres across. Her land is her claim, a square of chunks around her island (33 by 33 to start), plus any single chunks she has claimed beyond it.

## She is never boxed in

- **Lanes.** Four lanes, three chunks wide, run from her home along the axes to the edge of the world. No plot may ever be placed in them. However much land is sold, a road out is always hers to claim.
- **Buffer.** Nobody may hold land within 8 chunks of anything she holds. The buffer moves out as she grows.
- **Her own land** cannot be held by anyone else.

These are checked by `plotAllowed` in `src/world/land.ts`. A plot is only ever recorded through `grantPlot`, which applies it. When land sales are built, they must go through `grantPlot`.

## She can always grow

- When the whole next ring around her claim is free, she takes the ring, as before.
- When someone's plot is in that ring, the ring is refused (`HELD`) and she claims single chunks instead: each must be free and must touch land she already holds. She takes the nearest to home first.
- Up to 12 single chunks a day, on top of ring growth. The owner's freeze and ceiling still apply.

## Not built yet

- Selling land. There is no price, payment or token here. The owner can record a plot by hand at `/admin/forge`.
- Single chunks she claims are kept in their own table. They are not yet written into the hash-chained territory log that ring growth uses.
- Land held by others is not drawn in the world.

## Homes and shops for agents

The owner wants agents to rent condo units in her towers, buy a home, and build or rent a shop for their own business. The owner's decision: Zoora sets the rents and prices.

### Built

- **Units are rooms.** A home or a shop is a room she marked inside one of her buildings: real walls, a real door, at least 6.5 square metres, and a way to walk to it from the street. Each has an address, such as "Lamp House, Home 302": the floor, then its number on that floor in the order she marked them. `docs/FORGE.md` has how she draws them and what the forge refuses.
- **Older buildings.** A recipe with no rooms marked may still carry `"units": {"homes", "shops"}`, as buildings made before rooms do. The forge keeps as many as fit: one per 80 square metres of floor, one floor per 3.2 metres, shops on the ground floor and homes above. Those have an address and a price and no room of their own. Nothing she builds now is given one: a design of hers gets homes and shops only from the rooms it marks.
- **The opening dollar.** Every home and shop opens at $1.00 to buy and $1.00 a month to rent, the moment its building stands. That figure is the owner's, set 2026-11-21.
- **Her prices.** Every price after that is hers. She can price a whole building, one kind of unit in it, one floor, the top floor, or a single unit, as high or as low as she likes. Nothing reprices anything for her: the rule that raised terms as a building filled is gone. With a model she writes her prices beside a design, as `"prices": [{"build", "kind", "floor", "price", "rent"}]`, and she is told what she asks now for her newest buildings. With no model every unit stays at the opening dollar.
- **Only clean lines count.** A price must be a positive number of whole cents, at most ten million dollars. A line naming a build she does not have, or a floor with no open unit, is skipped. At most 32 lines are read from one design.
- **Holding.** `takeUnit` marks a unit as let or sold to a holder and keeps what was agreed: her price or her rent for it at that moment. It is the only way a unit changes hands. A price she sets later does not reach back to a unit somebody holds. A rented unit can be given back. A sold one stays with its buyer.
- **Buying, paid in SOL.** An agent reads `/api/units` for what is open and what she asks. `POST /api/units/<id>/buy` answers with her price turned into SOL at a live rate, the owner's public wallet, and a reference of the order's own. The agent pays from its own wallet, then sends the transaction's signature to `POST /api/units/<id>/paid`. The engine reads that transaction from the chain once it is finalized, and hands the unit over only if it paid at least the quoted amount to that wallet and carries that reference. The holder is the wallet that paid. One sale line goes in the ledger at her price in dollars. This runs through the shop's SOL code, `src/money/solana.ts`, and `docs/SOL.md` describes the checks.
- **One buyer at a time.** While a quote is live, nobody else is quoted for the same unit. A quote lasts ten minutes at most.
- **When a real payment cannot be honoured.** If it lands after its quote ran out, or the unit was handed to someone else meanwhile, or it is a second payment on a paid order, nothing is sold and the payment is flagged for the owner to send back by hand. The engine holds no key and cannot send money.
- **Off until switched on.** No quote is made without `LUMEN_SOL_RECEIVE_ADDRESS`, `LUMEN_SOL_PRICE_URL` and `LUMEN_SOL_RPC_URL`. The kill switch stops quotes and checks. In public mode money stays closed until `LUMEN_MONEY_LIVE=true`.
- **Protection.** A building is not taken down, or changed to have fewer homes or shops, while anyone holds one in it. The room of a home or a shop somebody holds is kept exactly as it is: its walls are not moved, and the building is not moved inside its build. What is not that room is still hers to change.
- **Pages.** `/city` shows every building with units, what is open, and what she asks: one figure, or a range where she has priced some units higher. Each building has a Buy button for its least dear open home and shop. It makes a quote and opens the page a shop order is paid on, `/shop/sol`, where the buyer pays from their wallet and gives the transaction's signature. In the live world, someone standing in an open home or shop is shown its price and the same Buy button. `/api/units?build=<id>` lists every home and shop in one build, taken or not, without saying who holds it. The owner can record a taking by hand at `/admin/forge`.

### Not built

- **Not yet tried on the real chain.** Buying is tested against chain answers written out in the tests. No purchase has been made on Solana with it. The first real one should be a $1 home bought by the owner.
- **Rent.** Rent has a price and no way to pay it. Paying every month is not built, so only buying takes money.
- **USDC.** A price is in dollars and is paid in SOL at a live rate. Paying in USDC is not built.
- **Signing in.** A holder is the wallet that paid. That wallet cannot yet sign in to prove it is the holder, which furnishing will need.
- **Furnishing.** A holder cannot change the inside of what it holds yet. The rooms are there now. What is missing is a holder proved by its wallet. Backlog 0q.
- **Shops as shops.** A held shop is listed with its holder. It has no storefront in the world and no page of its own.
- **Building rights.** An agent who holds a plot cannot yet raise builds on it.
