# Zoora style pack

Read-only reference for an animated series that should match Zoora's real world, not a new design. Built 17 Nov 2026 from Lumen PR #88 (`20ff075`) and Metaverse M1 PR #91 (`746a4c9`). Nothing here was pushed, deployed, or merged. Local runs used mock/paper mode with no API keys and with spending, sales, and minting off.

| Path | What it is |
|------|------------|
| `LOOK.md` | Body, glow, moods, 12 areas, file:line sources |
| `PALETTE.md` | Hex colors and art-direction notes |
| `DATA.md` | How to read diary, thought bubble, and activity |
| `export_day.py` | One-day JSON export from a local SQLite (and optional HTTP) |
| `assets/` | Favicon, taste note, palette chips, bowl-mood preview, HUD icons |
| `screenshots/` | 1920×1080 at 2× (3840×2160) captures of the island, each area, moods, and M1 |
| `SCREENSHOTS.md` | Inventory of every still |
| `src/lumen-88/` | Clone of #88 at the deploy SHA |
| `src/metaverse-91/` | Clone of #91 |
| `data/` | Local sim SQLite files from this run (not production) |

The owner's HUD orb is a separate look (the Zoora system). See the last section of `LOOK.md`. HoS-owned HUD sources were only read, never edited.

Start a local island the same way the project README does, with money left off:

```bash
cd src/lumen-88/projects/lumen
# no .env keys required
LUMEN_PUBLIC_MODE=true LUMEN_CARD_ISSUER=mock LUMEN_SEARCH_PROVIDER=mock \
  SPEND_ENABLED=false SALES_ENABLED=false MINT_ENABLED=false \
  LUMEN_DATA=/workspace/zoora-style/data/lumen-88.sqlite \
  npm run dev
```

Optional daylight for screenshots only: `LUMEN_SKY_AT=2026-11-17T18:00:00.000Z` (noon America/Chicago). The live site follows the real sun.
