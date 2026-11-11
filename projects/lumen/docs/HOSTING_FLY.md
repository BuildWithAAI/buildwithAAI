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

`projects/lumen/fly.toml` already sets the machine size, `iad`, `auto_stop_machines = "off"`, `min_machines_running = 1`, the 1GB volume mount, `LUMEN_DATA=/data/lumen.sqlite`, and `LUMEN_PUBLIC_MODE=true`. That flag is the public site and the closed login. It is not the money switch, and it is not turned off to go live. `LUMEN_VISITORS_ENABLED` defaults to false. It is not in `fly.toml`. Leave it unset, or set it to `false`, and visiting agents stay off. Only the exact value `true` opens registration. Live money also needs the secret `LUMEN_MONEY_LIVE=true`, which is not in `fly.toml`. Spending still needs `LUMEN_SPEND_ENABLED=true` and `STRIPE_ISSUING_KEY`, a different key from `STRIPE_SECRET_KEY`. Live sales still need `LUMEN_SALES_ENABLED=true`. A Privacy.com charge is posted to `POST /api/privacy/charge` with the owner credential. The body is a transaction id, merchant, and amount. The card number is not in it. The brain tick starts when the Node process starts (`src/instrumentation.ts`), not when a visitor connects, so the world keeps moving on an empty island.

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

## Volume snapshots

The SQLite file on `lumen_data` is the ledger and the memory. `fly.toml` keeps automatic daily snapshots and retains them for 5 days (`snapshot_retention = 5`, `scheduled_snapshots = true`). Five days is the platform default. The minimum is 1 day and the maximum is 60. A longer retention keeps more copies of the 1GB volume and can add snapshot storage.

Snapshot storage is $0.08 per GB per month after the first 10GB, which is free. Five daily copies of this 1GB volume stay inside that free 10GB.

List the copies:

```powershell
fly volumes list -a lumen-tidepool
fly volumes snapshots list <volume-id> -a lumen-tidepool
```

To restore, create a new volume in `iad` from one of those snapshot ids, mount it, and open the desk. Do not destroy the current volume until that copy is the one the machine is using.

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
- `STRIPE_SECRET_KEY` (`sk_live_`), `STRIPE_WEBHOOK_SECRET`, and `LUMEN_SALES_ENABLED=true` turn on shop checkout. The keys alone do not.
- `LUMEN_SPEND_ENABLED=true` plus `LUMEN_CARD_ISSUER=stripe_issuing` and `STRIPE_ISSUING_KEY`, or `PRIVACY_API_KEY`, turns on card spending. Reusing the sales key does not. The card's own limit is the cap.
- `MINT_SIGNER_URL` and `LUMEN_MINT_SIGNER_SECRET` turn on minting. Do not put the mint private key here. The signer process holds it and must reject a caller that does not present `x-lumen-signature`. `LUMEN_MINT_NETWORK=devnet` is off unless the owner sets that exact value for their own testing.

Put the values in a file on your machine, not in this repo. `secrets.env` is only an example name:

```powershell
fly secrets import -a lumen-tidepool < secrets.env
```

`fly secrets import` stages them for the next deploy. Do not commit `secrets.env`. Delete `secrets.env` from the owner machine after the import succeeds.

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

A missing or empty `Fly-Client-IP` does not open the desk. The public edge sets that header. A session cookie on that edge still cannot open the desk, because every desk page and every desk action checks the same gate.

The machine also listens on port 3001. That port is not an `[http_service]` port, so the public edge cannot route to it. A small proxy on 3001 strips `Fly-Client-IP` and adds `x-lumen-desk`. The secret is generated when the machine boots. It is not in `fly.toml`.

Reach the desk with Fly's proxy, from your own machine:

```powershell
fly proxy 3001:3001 -a lumen-tidepool
```

Then open `http://127.0.0.1:3001/admin/login`. Port 3000 is the public site. Do not use it for the desk. `world.zoora.ai`, `zoora.ai`, and `lumen-tidepool.fly.dev` are the public edge. They set `Fly-Client-IP`, and `/admin/login` stays closed there. Do not open the desk through the private WireGuard hostname.

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

## Apex zoora.ai and www

Verify zoora.ai in GitHub Pages first, while the current site still lives there. Add the TXT or other records GitHub shows. Wait until GitHub says the domain is verified. Leave that verification record in place permanently. After the cutover, remove zoora.ai and www.zoora.ai from the GitHub Pages custom domain list so Pages stops serving the site. Do not delete the verification record.

Keep mail on Namecheap Email Forwarding. In Namecheap, open Domain List, zoora.ai, and turn Email Forwarding on. The MX hosts that setting uses are `eforward1.registrar-servers.com`, `eforward2.registrar-servers.com`, `eforward3.registrar-servers.com`, `eforward4.registrar-servers.com`, and `eforward5.registrar-servers.com`. Leave those MX records and the SPF record in place.

About a day before the switch, lower the TTL on the apex A and AAAA records and the www CNAME to 300 seconds. The old answers then expire before the records change. Before you add Fly's addresses, delete the four GitHub Pages A records (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`) and delete the `www` CNAME that points at GitHub Pages.

Run the certificate commands immediately before you change DNS:

```powershell
fly certs add zoora.ai -a lumen-tidepool
fly certs add www.zoora.ai -a lumen-tidepool
```

Then, in Namecheap, open Domain List, zoora.ai, Advanced DNS. Use the shared IPv4 and the IPv6 from `fly ips list`, not a dedicated IPv4.

| Type | Host | Value |
| --- | --- | --- |
| A | @ | the shared IPv4 from `fly ips list` |
| AAAA | @ | the IPv6 from `fly ips list` |
| CNAME | www | lumen-tidepool.fly.dev |

```powershell
fly certs check zoora.ai -a lumen-tidepool
fly certs check www.zoora.ai -a lumen-tidepool
```

`www.zoora.ai` answers with a redirect to `https://zoora.ai` and keeps the path.

After the certificates are issued, add CAA records so only Let's Encrypt can issue for this name:

| Type | Host | Value |
| --- | --- | --- |
| CAA | @ | 0 issue "letsencrypt.org" |
| CAA | @ | 0 issuewild ";" |

Add DMARC at `p=none` first, so mail keeps flowing while you watch reports. A later change can move it to `p=quarantine` and then `p=reject`.

| Type | Host | Value |
| --- | --- | --- |
| TXT | _dmarc | v=DMARC1; p=none; rua=mailto:dmarc@zoora.ai |

Add the DKIM CNAMEs that Kit shows for the sending domain. Copy those hosts and values from Kit. Do not invent them.

Wait a week after the DNS switch, then turn on DNSSEC in Namecheap. Turning it on the same day as the record change can fail validation while resolvers still hold the old answers.

After the switch, check each of these before you call it done:

- `https://zoora.ai/healthz` returns ok.
- `https://www.zoora.ai/` redirects to `https://zoora.ai/` and keeps a path such as `/world`.
- `fly certs check` is issued for both names.
- MX and SPF still answer, and the DMARC TXT is `p=none`.
- The Kit DKIM CNAMEs resolve.
- The GitHub verification record is still present, and the Pages custom domain is gone.
- `https://zoora.ai/admin/login` stays closed. The desk is only `fly proxy 3001:3001`.

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
