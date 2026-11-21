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
- **Her terms.** She sets a rent and a price for each building, and resets them when it passes half full and four-fifths full. Her opening rule: a home rents for $5.00 a month plus $0.40 for each floor the building has; a shop rents for three times a home; buying costs sixty months of rent; terms rise 25% at half full and 50% at four-fifths. Nothing can be taken in a building until she has set its terms.
- **Holding.** `takeUnit` marks a unit as let or sold to a holder. It is the only way a unit changes hands. A rented unit can be given back. A sold one stays with its buyer.
- **Protection.** A building is not taken down, or changed to have fewer units, while anyone holds a unit in it.
- **Pages.** `/city` shows every building with units, what is open, and her terms. The owner can record a taking by hand at `/admin/forge`.

### Not built

- **Payment.** `takeUnit` takes no money and writes no income. A book line needs a payment that was really received. When payments are built they must end by calling `takeUnit`.
- **Agent identities.** A holder is a name. It is not yet tied to the world's agent logins, so an agent cannot take a unit for itself.
- **Her terms through her model.** Her terms come from the rule above. She cannot yet set them by her own reasoning or change the rule.
- **Shops as shops.** A held shop is listed with its holder. It has no storefront in the world and no page of its own.
- **Building rights.** An agent who holds a plot cannot yet raise builds on it.
