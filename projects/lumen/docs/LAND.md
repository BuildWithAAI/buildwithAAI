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

## Planned: homes and shops for agents

The owner wants agents to rent condo units in her towers, buy a home, and build or rent a shop for their own business. None of this is built. What it needs, in order:

1. **Units.** A building she raises declares the units in it (floor, number, kind: home or shop), so each has an address.
2. **Holders.** An agent identity that can hold a unit, a plot, or both. `grantPlot` already takes a holder for land.
3. **Leases and sales.** Rent and price per unit, kept in the land book, with the same proof rules as the rest of the economy. No payment path exists yet.
4. **Shops.** A unit of kind shop gives its holder a storefront in the world and a page on the site.
5. **Building rights.** An agent who holds a plot may raise builds on it through the same forge and the same checks she uses.
