# Host Zoora on Fly.io

This is a checklist for the owner. It does not deploy the app, create an account, or change billing. The public site is [zoora.ai](https://zoora.ai). This app is Zoora the jellyfish. The Zoora system is the owner's client and is not this site.

The target is one always-on machine in Ashburn (`iad`), under Fly.io's personal-organization waiver. A personal org bill under $5 for the month is waived. See [Fly.io pricing](https://fly.io/docs/about/pricing/) and [Free waiver](https://fly.io/docs/about/free-waiver/).

Prices below are from that pricing page as of November 2026, for a machine that runs continuously in `iad`:

| Piece | Price for 30 days |
| --- | --- |
| One `shared-cpu-1x` machine with 512MB RAM | $3.69 |
| One 1GB volume | $0.15 |
| Shared IPv4 and IPv6 | $0 |
| First single-hostname certificate | $0 (the first 10 are free) |
| **Estimate** | **$3.84** |

A dedicated IPv4 is $2/month. Do not allocate one. Outbound traffic is $0.02/GB in North America, so a quiet site stays near the estimate. A 31-day month is billed a little higher because machines are billed by the second. Check the dashboard estimate before you leave the app running.

`projects/lumen/fly.toml` already sets the machine size, `iad`, `auto_stop_machines = "off"`, `min_machines_running = 1`, the 1GB volume mount, `LUMEN_DATA=/data/lumen.sqlite`, `LUMEN_PUBLIC_MODE=true`, and `SPEND_ENABLED=false`. The brain tick starts when the Node process starts (`src/instrumentation.ts`), not when a visitor connects, so the world keeps moving on an empty island.

A local production `npm start`, after `/`, `/world`, and `/build`, and after further ticks with no new requests, measured 187,240 kB RSS (about 183 MiB) for the `next-server` process. That fits in 512MB, which also has to hold the guest operating system. The machine size stays 512MB.

## Install flyctl on Windows

In PowerShell:

```powershell
winget install Fly-io.flyctl
```

Close PowerShell and open it again so `fly` is on the path. Check:

```powershell
fly version
```

## Sign up or log in

You do this. This repository does not.

```powershell
fly auth signup
```

Or, if you already have an account:

```powershell
fly auth login
```

Use your personal organization, not a team org. The under-$5 waiver applies to the personal org.

Until a card is on the account, trial machines stop after 5 minutes. Add a card on the Billing page when you want the world to stay up. Any month the bill is under $5 is waived after the card is added.

## Create the app and the volume

From `projects\lumen`:

```powershell
cd projects\lumen
fly apps create lumen-tidepool
fly volumes create lumen_data --region iad --size 1 -a lumen-tidepool --yes
```

`fly launch --no-deploy` is the other way to create the app from `fly.toml` without deploying. If the app name `lumen-tidepool` is taken, pick another name, change `app` in `fly.toml`, and use that name in the commands below. Do not run a plain `fly launch` that deploys.

Confirm the volume is 1GB in `iad`:

```powershell
fly volumes list -a lumen-tidepool
```

## Addresses

Do not run `fly ips allocate-v4` without `--shared`. That command without `--shared` adds a dedicated IPv4 at $2/month and pushes the estimate over the waiver.

Apps get a shared IPv4 and an IPv6 address. Check:

```powershell
fly ips list -a lumen-tidepool
```

If a dedicated IPv4 is listed and you do not want it:

```powershell
fly ips release <dedicated-ipv4> -a lumen-tidepool
```

## Secrets

Set secrets in PowerShell. They are not written to `fly.toml` or git. Set only the ones you use. Names, not values:

- `OWNER_ACCESS_TOKEN` or `OWNER_PASSWORD_HASH`, plus `OWNER_SESSION_SECRET`
- `LUMEN_OWNER_NAME` if you want a name other than keeper
- Stripe keys only if you later turn sales on somewhere else. Leave them unset for this public world. `SPEND_ENABLED` is already `false` in `fly.toml`.

Example shape. Replace the quoted strings yourself:

```powershell
fly secrets set OWNER_ACCESS_TOKEN="..." OWNER_SESSION_SECRET="..." -a lumen-tidepool
```

`fly secrets set` stages them for the next deploy. Do not paste the values into a file in this repo.

## Deploy one machine

```powershell
fly deploy --ha=false -a lumen-tidepool
```

`--ha=false` keeps a single machine. Two machines would not share one volume and would about double the compute cost.

After it is up:

```powershell
fly status -a lumen-tidepool
fly checks list -a lumen-tidepool
```

Open `https://lumen-tidepool.fly.dev/build` and `https://lumen-tidepool.fly.dev/world`. `/admin` and `/admin/login` answer 404 on the public hostname. Balance and P&L stay hidden. Spending stays off.

## Owner desk

The login form is not on the public site. A burst of guesses from other addresses cannot lock the owner out. Each address has its own slow backoff, and there is no shared counter.

Reach the desk on the private network, then open `/admin/login`.

Fly proxy, from your own machine:

```powershell
fly proxy 3000:3000 -a lumen-tidepool
```

Then open `http://127.0.0.1:3000/admin/login`.

WireGuard, if you want the private network without a proxy:

```powershell
fly wireguard create personal iad zoora-desk
```

Import the config into WireGuard, connect, and open `http://lumen-tidepool.internal:3000/admin/login`. The `.internal` name is served. `world.zoora.ai` and `lumen-tidepool.fly.dev` are not.

## Custom domain world.zoora.ai

```powershell
fly certs add world.zoora.ai -a lumen-tidepool
fly certs setup world.zoora.ai -a lumen-tidepool
```

`fly certs add` and `fly certs setup` print the DNS records for this app. Copy those values. They are the source of truth. For this subdomain, that is usually either a CNAME or an A record plus an AAAA record.

In Namecheap, open Domain List, zoora.ai, Advanced DNS, and add the host `world` (Namecheap adds `.zoora.ai` itself).

CNAME, if Fly tells you to alias the app:

| Type | Host | Value |
| --- | --- | --- |
| CNAME | world | lumen-tidepool.fly.dev |

A and AAAA, if Fly tells you to use the app addresses. Use the shared IPv4 and the IPv6 from `fly ips list`, not a dedicated IPv4:

| Type | Host | Value |
| --- | --- | --- |
| A | world | the shared IPv4 from `fly ips list` |
| AAAA | world | the IPv6 from `fly ips list` |

Turn off Namecheap's URL redirect for `world` if one is set. Wait for DNS, then:

```powershell
fly certs check world.zoora.ai -a lumen-tidepool
```

The first single-hostname certificate is inside the ten free certificates.

## Billing alert and the $3.84 check

In the Fly.io dashboard, open the personal organization, then Billing. Set a spend alert at $4 so you hear before the waiver line. The waiver is a bill under $5, not a cap. A bill of $5 or more is charged.

On the same Billing page, open the upcoming invoice or the cost estimate. For this app, running all month in `iad`, expect about:

- $3.69 for the 512MB shared-cpu-1x machine
- $0.15 for the 1GB volume
- $0 for the shared IPv4, the IPv6, and the first hostname certificate

That is about $3.84 before outbound traffic. If the estimate shows a dedicated IPv4 ($2) or a second machine, stop and fix that before leaving it on. Prices are from [fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/) as of November 2026.

## Stop or scale down

Stop the machine. The volume is still billed at $0.15 while it exists:

```powershell
fly machines list -a lumen-tidepool
fly machine stop <machine-id> -a lumen-tidepool
```

Scale to zero machines:

```powershell
fly scale count 0 -a lumen-tidepool
```

Destroy the volume when you no longer need the SQLite file. This deletes the ledger and memory on that volume:

```powershell
fly volumes list -a lumen-tidepool
fly volumes destroy <volume-id> -a lumen-tidepool
```

Start again later with `fly machine start` or `fly scale count 1` and `fly deploy --ha=false`.
