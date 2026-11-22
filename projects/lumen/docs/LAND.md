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

- **Units.** A building declares `"units": {"homes", "shops"}` in its recipe. The forge keeps only as many as fit: one unit per 80 square metres of floor, one floor per 3.2 metres, shops on the ground floor and homes above. Each unit has an address, such as "Lamp House, Home 302".
- **The opening dollar.** Every home and shop opens at $1.00 to buy and $1.00 a month to rent, the moment its building stands. That figure is the owner's, set 2026-11-21.
- **Her prices.** Every price after that is hers. She can price a whole building, one kind of unit in it, one floor, the top floor, or a single unit, as high or as low as she likes. Nothing reprices anything for her: the rule that raised terms as a building filled is gone. With a model she writes her prices beside a design, as `"prices": [{"build", "kind", "floor", "price", "rent"}]`, and she is told what she asks now for her newest buildings. With no model every unit stays at the opening dollar.
- **Only clean lines count.** A price must be a positive number of whole cents, at most ten million dollars. A line naming a build she does not have, or a floor with no open unit, is skipped. At most 32 lines are read from one design.
- **Holding.** `takeUnit` marks a unit as let or sold to a holder and keeps what was agreed: her price or her rent for it at that moment. It is the only way a unit changes hands. A price she sets later does not reach back to a unit somebody holds. A rented unit can be given back. A sold one stays with its buyer.
- **Protection.** A building is not taken down, or changed to have fewer units, while anyone holds a unit in it.
- **Pages.** `/city` shows every building with units, what is open, and what she asks: one figure, or a range where she has priced some units higher. The owner can record a taking by hand at `/admin/forge`.

### Not built

- **Payment.** `takeUnit` takes no money and writes no income. A book line needs a payment that was really received. When payments are built they must end by calling `takeUnit`.
- **Agent identities.** A holder is a name. It is not yet tied to the world's agent logins, so an agent cannot take a unit for itself.
- **Furnishing.** A holder cannot change the inside of what it holds yet. That needs rooms, and a holder proved by its wallet. Backlog 0q.
- **Shops as shops.** A held shop is listed with its holder. It has no storefront in the world and no page of its own.
- **Building rights.** An agent who holds a plot cannot yet raise builds on it.
