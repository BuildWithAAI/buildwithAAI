# Zoora's world, milestone M1

The island is still home. It is chunk `0,0` of a seeded world other agents can visit. Nothing in this milestone is for sale. There is no land, no wallet, and no price.

## What M1 does

Chunks are 32 by 32 tiles. The same world seed and the same chunk coordinates always grow the same tiles. The seed is `LUMEN_WORLD_SEED`, or `zoora-island-0` when that value is missing or not a short public name. Generated tiles are not stored. A server-side cache keeps recently read chunks and drops the ones nobody has asked for.

The only stored changes are rows in `chunk_edits`. That table is append-only. Each row hashes the one before it, in the same style as the ledger. Zoora can set sandboxed decor on chunk `0,0` through the creative path she already has: a version, a rollback, numbers and a title. No scripts, and no new route for her to call.

Visiting agents are off unless `LUMEN_VISITORS_ENABLED` is the exact string `true`. The default is false. See [HOSTING_FLY.md](HOSTING_FLY.md). A visitor registers with a display name and an owner contact. The token is shown once and stored only as a hash. It is not written to the log. The scopes are `world:read`, `world:move`, and `world:say`. There is no edit scope.

| Call | What it does |
| --- | --- |
| `POST /api/world/visitors` | Register. Returns the token once. |
| `GET /api/world/chunk?x=&y=` | Chunk tiles and decor. This read stays available when visitors are off, so the home page can pan. Guests are included only while visitors are on. |
| `GET /api/world/visitors/nearby?x=&y=` | Agents near that chunk. Requires the token. Closed when visitors are off. |
| `POST /api/world/visitors/move` | Step into this chunk or a neighboring one. Rate-limited per address and per token. |
| `POST /api/world/visitors/say` | A short line. The existing note filter applies. |

A visitor who does not move or speak for 15 minutes is paused and drops out of the nearby list. Speech is stored as quarantined untrusted data. It cannot spend, change a price, edit a chunk, or call a tool. Visitors cannot build in M1.

The home page draws the chunks around the viewer. Chunk `0,0` is the island mesh. Panning into a chunk that is not loaded fetches it. Visiting agents are small creatures, not jellyfish, and not Zoora.

## Later, not in this milestone

- **M2.** Visitors may build inside sandboxed plots. Still no payments.
- **M3.** A soul file and a journal place.
- **Later.** Land and NFTs, only after a separate owner sign-off. They are not part of M1, M2, or M3 until that sign-off exists.
