# Telegram with the owner

Zoora writes in its own voice when it feels like it. A message is a thought, a feeling, something it noticed, something it is dreaming, why it made a shape, or a question. It is not a status report.

When `LUMEN_TELEGRAM_BOT_TOKEN` or `LUMEN_TELEGRAM_OWNER_CHAT_ID` is unset, Zoora stays in mock mode. The thought is stored and nothing is sent.

Operational alerts (an unknown charge, a broken ledger chain, the kill switch, a failed delivery) do not use this voice. They go by email. If `LUMEN_ALERT_TELEGRAM_BOT_TOKEN` and `LUMEN_ALERT_TELEGRAM_CHAT_ID` are set, those alerts also go to that separate channel and are labelled `System:`.

## Create the bot

1. In Telegram, open `@BotFather`.
2. Send `/newbot` and follow the prompts. The bot in this note is `@ZooraJellyfishBot`.
3. Copy the bot token into the environment. It is a secret. Do not commit it, do not pass it as a command argument, and do not paste it into a log.

## Chat id

Send any message to the new bot from the owner account, then read the chat id. Put the token in the environment first so it is not stored in the shell history as part of a copied command:

```powershell
# PowerShell. The token stays in the environment.
curl "https://api.telegram.org/bot$env:LUMEN_TELEGRAM_BOT_TOKEN/getUpdates"
```

Use the `chat.id` from that reply as `LUMEN_TELEGRAM_OWNER_CHAT_ID`. Zoora accepts talk and the read-only commands only from this id. Every other chat is dropped and the id is logged without the message text.

## Two ways to hear her

### A. Fly webhook

This is the hosted path. The app on Fly `lumen-tidepool` receives updates at `/api/telegram/webhook`. Telegram must send `X-Telegram-Bot-Api-Secret-Token`, and that header must match `LUMEN_TELEGRAM_WEBHOOK_SECRET`. A missing or wrong secret is rejected.

Local env, in a file that is not committed:

```powershell
# secrets.env
LUMEN_TELEGRAM_BOT_TOKEN=...
LUMEN_TELEGRAM_OWNER_CHAT_ID=...
LUMEN_TELEGRAM_WEBHOOK_SECRET=...
```

On Fly.io:

```powershell
fly secrets import -a lumen-tidepool < secrets.env
```

Delete `secrets.env` after the import succeeds. Point Telegram at the Fly app with `setWebhook`, including the same secret header. Do not print the token while you do it. Polling calls `deleteWebhook` when it starts, so turn polling off before you rely on this route again.

### B. Local polling

Polling is for a machine that should not expose a public webhook. From `projects/lumen`, with the token and the owner chat id already in the environment:

```powershell
$env:LUMEN_TELEGRAM_MODE = "poll"
npm run telegram:poll
```

The script sets `LUMEN_TELEGRAM_MODE=poll` when it is unset, and it refuses to start when that variable is set to anything else. On start it calls `deleteWebhook`, then `getUpdates`, and it remembers the update offset. It uses the same owner-only handler as the webhook. A thought she offers on her own still waits about 30 minutes, and she stays quiet from 23:00 to 07:00 America/Chicago. A direct command still answers.

Polling also forces money off for that process: `LUMEN_MONEY_LIVE` and `LUMEN_TRADING_LIVE` are removed, sales and spend and mint are set off, the shop checkout stays fail-closed, and the Saloon stays paper only.

Without `LUMEN_XAI_API_KEY`, replies are the canned lines from her state. When that key is set, ordinary talk can use Grok (`LUMEN_XAI_MODEL`, default `grok-4`). The read-only commands stay on the recorded state either way. The key and the bot token are not written into the prompt body or the log. Any error text that contains the bot token, or a `api.telegram.org/bot...` URL, is redacted before it is printed.

## Command menu

Register the read-only menu once. The token is read from `LUMEN_TELEGRAM_BOT_TOKEN` and is not printed, including when the call fails:

```powershell
node scripts/telegram-set-commands.mjs
```

## What she will answer

These five commands are accepted only from `LUMEN_TELEGRAM_OWNER_CHAT_ID`. They read her state and answer in her voice:

| Command | What she reads |
| --- | --- |
| `/mood` | The mood sentence already in her brain. If she has not woken, she says so. |
| `/needs` | Rest, curiosity, social, expression, and quiet, as stored. |
| `/status` | Awake or asleep, the tick, whether live money is on, whether checkout is open, whether the Saloon is paper, and the kill switch. No balance is invented. With live money off, she says she does not have one. |
| `/world` | Her place, and the scene she published: palette, sky, weather, decoration, garden stage. |
| `/help` | The list above, and the reminder that a message cannot spend. |

An unknown slash, including one that names a switch, is talk. It can be heard. It cannot spend, change a toggle, mint, touch the kill switch, or change a price. A chat that is not the owner is dropped.

Zoora may stay quiet for hours. At most about one unsolicited thought goes out every 30 minutes. Quiet hours are 23:00–07:00 America/Chicago. A thought she has already told the owner is not sent again.
