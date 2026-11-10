# Host Zoora on your computer

The public site is [zoora.ai](https://zoora.ai). This page is how to show the jellyfish and the build log from the owner's machine, through a tunnel, at a name such as `world.zoora.ai`. The Zoora system (the owner's client) is not this website. Spending stays off when `LUMEN_PUBLIC_MODE=true`.

The desk, the ledger, the database file, and the env file stay on this computer.

## Run the site

From `projects/lumen`.

Windows (PowerShell):

```powershell
cd projects\lumen
npm install
$env:LUMEN_PUBLIC_MODE = "true"
$env:LUMEN_TRUSTED_PROXY = "cloudflare"
npm start
```

macOS (Terminal):

```bash
cd projects/lumen
npm install
LUMEN_PUBLIC_MODE=true LUMEN_TRUSTED_PROXY=cloudflare npm start
```

`npm start` serves the built site. If you have not built it yet, run `npm run build` first. The site listens on port 3000. Open `http://127.0.0.1:3000/build` and `http://127.0.0.1:3000/world` on that computer before opening the tunnel.

## Cloudflare Tunnel

Install `cloudflared` from Cloudflare. The examples use the hostname `world.zoora.ai`. Use a name you control.

Windows and macOS use the same commands:

```bash
cloudflared tunnel login
cloudflared tunnel create zoora-world
cloudflared tunnel route dns zoora-world world.zoora.ai
cloudflared tunnel run --url http://127.0.0.1:3000 zoora-world
```

Leave that window open. Visitors use `https://world.zoora.ai`. Cloudflare sets `CF-Connecting-IP`. With `LUMEN_TRUSTED_PROXY=cloudflare`, rate limits use that address.

## ngrok, for a quick try

```bash
ngrok http 3000
```

Then start the site with `LUMEN_TRUSTED_PROXY=ngrok` instead of `cloudflare`. ngrok prints an https address. It lasts until you stop ngrok. It does not set `world.zoora.ai`.

## Stop it

In the site window, press Ctrl+C. In the tunnel window, press Ctrl+C. Stopping either one takes the public name offline. The SQLite file is still on the computer.

## What stays private

With `LUMEN_PUBLIC_MODE=true`:

- `/admin`, the keeper desk, and `/admin/ledger` require an owner session. The login page stays available so the owner can sign in.
- Balance and P&L are hidden. Gallery prices and print cost figures are hidden.
- Spending is forced off, even if `SPEND_ENABLED=true`.
- Pages send a strict content security policy and the other security headers.
- Each address is limited to 120 requests a minute.
- `LUMEN_DATA`, `.env.local`, tokens, and the card issuer stay on this machine. Do not put them in the tunnel command line.

When you finish a backlog item, append a block to `docs/BUILD_LOG.md` so `/build` shows it.
