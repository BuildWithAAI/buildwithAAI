# Screenshots

All island and page shots are 1920×1080 CSS pixels at 2× device scale (3840×2160 PNG), taken from local sim/paper runs with no API keys and with spending off. Daylight views used the official `LUMEN_SKY_AT` hook set to noon America/Chicago on 17 Nov 2026. One night overview was taken at about 19:06 that evening from the real clock.

Bowl mood stills are cropped figures from `assets/bowl-moods.html` (the Scene.tsx recipe). Prefix `88-` is Lumen PR #88 at `20ff075`. Prefix `91-` is Metaverse M1 PR #91 at `746a4c9`.

## Island and the 12 areas

- `88-island-overview.png` / `91-island-overview.png` — wide view of the island
- `88-island-overview-night.png` — same rig after sunset (authentic clock)
- `88-island-topdown.png` / `91-island-topdown.png` — plan view, paths meeting at Town Center
- `91-m1-wide-chunks.png` — M1 top-down showing procedural terrain chunks around the island
- `88-area-town-center.png` and the matching `91-area-*` for: art-studio, music-studio, coding-basement, beach-dock, forest-trail, garden-greenhouse, market-row, lighthouse-hill, research-station, solana-saloon, solana-saloon-interior, trading-floor, trading-floor-interior
- `88-together.png` / `91-together.png` — plaza camera

## Zoora close-ups

- `88-zoora-closeup.png` / `91-zoora-closeup.png` — 3D jellyfish, follow camera zoomed in (the built-in `/?cam=zoora` rig is a fixed town-center seat and is often empty or underground)
- `88-zoora-closeup-clean.png` / `91-zoora-closeup-clean.png` — same, UI chrome hidden
- `88-zoora-follow.png` / `91-zoora-follow.png` — follow camera, medium distance (91 shows M1 hills)
- `88-zoora-bowl-moods-sheet.png` — all bowl portraits
- `88-zoora-mood-{joy,calm,curiosity,loneliness,frustration,pride,boredom,worry,asleep}.png`

In the 3D close-ups she is teal `#7ee0c8` even when the label says boredom; mood color lives on the bowl portraits and in `GET /now` `glow`.

## Pages

- `88-diary-page.png` / `91-diary-page.png` — `/diary`
- `88-books-page.png` / `91-books-page.png` — `/books` (confirmed totals, live money off)
- `88-gallery-page.png` / `91-gallery-page.png` — `/gallery`
- `88-ledger-panel.png` / `91-ledger-panel.png` — public Ledger drawer on the island

Re-take with `node /workspace/zoora-style/capture.cjs` (and `--meta` for #91) after the apps are running. Close-ups may need a follow+zoom pass if `/?cam=zoora` is dark.
