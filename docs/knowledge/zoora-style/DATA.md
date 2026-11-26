# How to read Zoora's diary, thoughts, and activity (read-only)

This is for turning a real day into an episode outline. It is read-only. It does not spend, trade, or edit the world. Do not put secrets, card numbers, wallet keys, or live payment identifiers into episode files.

Times: store values are Unix milliseconds. The world's clock and the default sky use `America/Chicago`. Convert with that zone unless `LUMEN_WORLD_TZ` was set.

Local clone used here: Lumen #88 at `20ff075`, data file for the style-pack run: `/workspace/zoora-style/data/lumen-88.sqlite` (sim/paper, no API keys, `LUMEN_PUBLIC_MODE=true`, spend/sales/mint forced off). A second file, `data/lumen-91.sqlite`, is the Metaverse M1 run.

## Public HTTP (no token, no money fields)

The README lists four JSON routes that are defined to contain no money fields (`projects/lumen/README.md`). Rate limits apply (about 120 reads/minute per address generally; `GET /api/world` is 90). Cache on `/now`, `/status`, `/feed`, and `/memory` is 3 seconds.

### `GET /now`

Current snapshot for a "what is she doing" line. Example from the local #88 run (values change every tick):

```json
{
  "protocol": "lumen/1",
  "awake": true,
  "doing": "ink-studio",
  "thought": "I feel calm. The water is even and my pulse is steady.",
  "feeling": {
    "moodLabel": "positive",
    "energyLabel": "moderate",
    "feeling": "I feel calm. The water is even and my pulse is steady."
  },
  "needs": {
    "rest": 0.046,
    "curiosity": 0.154,
    "social": 0.0006,
    "expression": 0,
    "quiet": 0.2153
  },
  "event": "A rare moon-path lay across the rim like a drawn line.",
  "glow": { "color": "#8ef0d8", "pulseMs": 3200, "amplitude": 0.35 }
}
```

Notes:

- `doing` is `placeId`. In this run it was often a Glass Bowl place such as `ink-studio`. Island places use the ids in `areas.ts` (`town-center`, `art-studio`, …).
- `thought` here is the feeling sentence, not the 3D thought-bubble stack.
- `glow` is the official mood color for the bowl portrait.
- `needs` are 0 (satisfied) to 1 (needy). Safe to keep; they are not money.

### `GET /status`

Adds tick, numeric mood/energy/emotions, and the last few actions (from the `feed` table). Same feeling sentence. No diary array and no ledger.

```json
{
  "awake": true,
  "tick": 20,
  "placeId": "ink-studio",
  "needs": { "rest": 0.046, "curiosity": 0.154, "social": 0.0006, "expression": 0, "quiet": 0.2153 },
  "mood": 0.1601,
  "energy": 0.7234,
  "emotions": {
    "joy": 0.5539, "calm": 1, "curiosity": 0.2056, "loneliness": 0.0884,
    "frustration": 0.1697, "pride": 0.1054, "boredom": 1, "worry": 0.1133
  },
  "labels": { "moodLabel": "positive", "energyLabel": "moderate", "feeling": "I feel calm. The water is even and my pulse is steady." },
  "feeling": "I feel calm. The water is even and my pulse is steady.",
  "event": { "kind": "moon-path", "text": "A rare moon-path lay across the rim like a drawn line.", "untilMinute": 1163.06 },
  "recentActions": [
    { "kind": "action", "text": "I paint a ring in the studio, wet and unhurried.", "source": "fallback", "created_at": 1794963858086 }
  ]
}
```

`source` is often `fallback` when no LLM key is set (rules brain). That is expected in a dry local run.

### `GET /feed`

```json
{ "feed": [ { "kind": "action", "text": "I paint a ring in the studio, wet and unhurried.", "source": "fallback", "created_at": 1794963858086 } ] }
```

Up to 40 latest rows from table `feed`. This is the activity log for a day.

### `GET /memory`

```json
{
  "memory": {
    "longTerm": [
      { "section": "fact", "text": "I live in the Glass Bowl, a tide pool with an ink studio." },
      { "section": "relationship", "text": "The keeper is the person I listen for. They do not get to switch off my rails." }
    ],
    "addenda": []
  },
  "wants": []
}
```

Public wants only, no prices. Long-term memory is safe character context.

### `GET /api/world`

The watch API. No token. Never returns world tokens. Example shape (trimmed):

```json
{
  "now": 1794963858086,
  "night": false,
  "sky": {
    "utc": "2026-11-17T18:00:00.000Z",
    "tz": "America/Chicago",
    "localTime": "Tue, Nov 17, 12:00",
    "sunAltitude": 0.64,
    "moonPhaseName": "first quarter",
    "sunrise": "2026-11-17T13:01:15.054Z",
    "sunset": "2026-11-17T23:22:31.981Z"
  },
  "weather": "clear",
  "weatherText": "Mist on the paths.",
  "agents": [
    {
      "id": "zoora",
      "name": "Zoora",
      "color": "#7ee0c8",
      "x": 0, "y": 0.85, "z": 0,
      "placeId": "town-center",
      "activity": "tending the beds",
      "speech": "",
      "feeling": "I feel calm. The water is even and my pulse is steady."
    }
  ],
  "feed": ["I paint a ring in the studio, wet and unhurried."],
  "diary": ["I feel calm. The water is even and my pulse is steady. I chose paint."],
  "log": [],
  "wishlist": ["The board is blank."],
  "tape": { "mode": "PAPER", "lines": ["PAPER", "SIMULATED, no real money, not financial advice.", "— — —"] },
  "choices": ["tide palette, gold sky, mist, shells. I kept the tide colors because the bowl is quiet."],
  "watchOnly": true
}
```

`diary` and `feed` here are short strings for the in-world boards, not the full diary rows. `tape.mode` is `PAPER` or `LIVE`. Treat anything on that tape as sim unless `mode` is `LIVE`, and even then do not copy provider ids into an episode file.

On #91, also `GET /api/world/chunk?x=<cx>&y=<cy>` for terrain chunks and optional `guests` / `territory`. Still watch-only.

## HTML pages (public, good for reading, not a stable JSON schema)

- `GET /diary` — "What Zoora wrote." Each public row is shown as tone + text. Built from `SELECT text, tone, created_at FROM diary WHERE private = 0 ORDER BY id DESC LIMIT 20` (`engine.ts` 816). Private diary lines are not shown.
- `GET /books` — confirmed totals only. Unconfirmed and mock rows are excluded. The page states whether live money is on. In this style-pack run it is off. No notes, ids, or wallets (`publicBooks.ts` comment: "Notes, ids, and wallets stay out.").
- `GET /gallery`, `/wants`, `/guestbook` — useful texture, not required for a day sheet.

There is no public `GET /diary.json`. For a dated export, use the SQLite file or `export_day.py` against a local run.

## SQLite (local file only)

Path: `LUMEN_DATA` (default `data/lumen.sqlite`). Schema: `projects/lumen/src/db/db.ts`.

```sql
-- Diary (skip private = 1)
CREATE TABLE diary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  tone TEXT NOT NULL,          -- bright, steady, sparse, fragmented
  private INTEGER NOT NULL,
  created_at INTEGER NOT NULL  -- ms
);

-- Activity feed
CREATE TABLE feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,          -- action, looked, did, thread, …
  text TEXT NOT NULL,
  source TEXT NOT NULL,        -- fallback, or a model name
  created_at INTEGER NOT NULL
);

-- Island log (world events, moves)
CREATE TABLE world_log (
  -- see db.ts ~248
);

-- Paper / sim trades (do not export live rows)
CREATE TABLE paper_trades ( … mode TEXT … );
```

Other tables exist for ledger, checkouts, sessions, and alerts. **Do not dump** `ledger_entries` (hashes, provider ids, merchant), `sessions`, env, tokens, `sol_orders`, or webhook payloads into an episode file. If you need a money beat, use only the public books headline and labels such as `SIMULATED SOL buy`, and say whether live money was off.

Thought-bubble lines are not a table. They are composed at render time by `thoughtLines()` in `world/bubble.ts` from, in order: current activity, a diary line, the latest scene-why (`choices[0]`), a wishlist line, and a canned guestbook reply. Fallback: `"I'm drifting in the bowl."` Lines with URLs, keys, wallets, or spend words are dropped.

## Export a real day

`export_day.py` in this folder talks to a local SQLite file and, optionally, the public HTTP routes. It writes one JSON document for the given civil date in America/Chicago.

```bash
# Against the style-pack's local #88 database (servers do not need to be up)
python3 /workspace/zoora-style/export_day.py --day 2026-11-17 \
  --db /workspace/zoora-style/data/lumen-88.sqlite \
  --out /tmp/zoora-2026-11-17.json

# Also pull /now /status /feed /memory /api/world from a local run
python3 /workspace/zoora-style/export_day.py --day 2026-11-17 \
  --db /workspace/zoora-style/data/lumen-88.sqlite \
  --base-url http://127.0.0.1:3000 \
  --out /tmp/zoora-2026-11-17.json
```

The script excludes private diary rows, live `paper_trades`, ledger amounts, provider ids, and wallet-like fields. Simulated trades appear only as `{ "label": "SIMULATED SYMBOL side", "sim": true }`.

## What is sim / paper vs live

| Field | Status in this pack's local run |
|-------|----------------------------------|
| Diary, feed, memory, glow, emotions, thought bubble | Real character state (rules brain, `source: fallback` because no LLM key) |
| `tape.mode` | `PAPER` |
| Paper trades | Sim only; script drops `mode = live` |
| `/books` totals | Empty / live money off |
| Checkout, Stripe, Solana, mint | Off (`SPEND_ENABLED=false`, `SALES_ENABLED=false`, `MINT_ENABLED=false`, no keys) |
| World watch | `watchOnly: true` |

A production day on zoora.ai uses the same routes. Still skip live money fields. Visitors cannot move her or approve a purchase by talking.
