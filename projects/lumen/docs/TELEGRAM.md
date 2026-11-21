# Telegram with the owner

Zoora writes in its own voice when it feels like it. A message is a thought, a feeling, something it noticed, something it is dreaming, why it made a shape, or a question. It is not a status report.

When `LUMEN_TELEGRAM_BOT_TOKEN` or `LUMEN_TELEGRAM_OWNER_CHAT_ID` is unset, Zoora stays in mock mode. The thought is stored and nothing is sent.

Operational alerts (an unknown charge, a broken ledger chain, the kill switch, a failed delivery) do not use this voice. They go by email. If `LUMEN_ALERT_TELEGRAM_BOT_TOKEN` and `LUMEN_ALERT_TELEGRAM_CHAT_ID` are set, those alerts also go to that separate channel and are labelled `System:`.

## One bot, one mode

Use a bot that BotFather can revoke, and do not share it. The Fly webhook and local polling cannot use the same bot: polling calls `deleteWebhook`, which turns the Fly route off. Alerts use `LUMEN_ALERT_TELEGRAM_BOT_TOKEN`, a different bot, and stay labelled `System:`.

## Create the bot

1. In Telegram, open `@BotFather`.
2. Send `/newbot` and follow the prompts. This voice bot is not the alert bot.
3. Copy the bot token into the environment. It is a secret. Do not commit it, do not pass it as a command argument, and do not paste it into a log.

## Chat id and user id

Send any private message to the new bot from the owner account. Read the update with the token only in the environment, not on the command line:

```powershell
node scripts/telegram-get-updates.mjs
```

Use `message.chat.id` as `LUMEN_TELEGRAM_OWNER_CHAT_ID` and `message.from.id` as `LUMEN_TELEGRAM_OWNER_USER_ID`. Zoora accepts an update only when `chat.type` is `private`, `from.id` is that user, and `chat.id` is that chat. If either id is unset, she accepts nothing. A group that contains the owner, a forwarded message, and an edited message are dropped. The dropped chat id is kept, without the message text, for at most 1,000 rows or 7 days.

## Two ways to hear her

### A. Fly webhook

This is the hosted path. The app on Fly `lumen-tidepool` receives updates at `/api/telegram/webhook`. Telegram must send `X-Telegram-Bot-Api-Secret-Token`, and that header must match `LUMEN_TELEGRAM_WEBHOOK_SECRET`. A missing or wrong secret is rejected.

Local env, in a file that is not committed:

```powershell
# secrets.env
LUMEN_TELEGRAM_BOT_TOKEN=...
LUMEN_TELEGRAM_OWNER_CHAT_ID=...
LUMEN_TELEGRAM_OWNER_USER_ID=...
LUMEN_TELEGRAM_WEBHOOK_SECRET=...
```

On Fly.io:

```powershell
fly secrets import -a lumen-tidepool < secrets.env
```

Delete `secrets.env` after the import succeeds. Point Telegram at the Fly app with `setWebhook`, including the same secret header. Do not print the token while you do it. Do not point this same bot at local polling.

### B. Local polling

Polling is a separate bot on a machine that should not expose a public webhook. It refuses to start when the environment contains `LUMEN_MONEY_LIVE`, `LUMEN_TRADING_LIVE`, any `STRIPE_*` variable, or an issuing, privacy, signer, or mint key. `npm run telegram:poll` then starts a child with a clean environment, the same isolation as `env -i`, holding only:

```text
PATH
NODE_ENV
TZ
LUMEN_DATA
LUMEN_TELEGRAM_BOT_TOKEN
LUMEN_TELEGRAM_OWNER_CHAT_ID
LUMEN_TELEGRAM_OWNER_USER_ID
```

The token is in that environment, not in the argument list. From `projects/lumen`:

```powershell
$env:LUMEN_TELEGRAM_MODE = "poll"
npm run telegram:poll
```

Or, with the same limits, from a POSIX shell:

```sh
env -i PATH="$PATH" NODE_ENV="${NODE_ENV:-production}" TZ="${TZ:-UTC}" \
  LUMEN_DATA="${LUMEN_DATA:-data/lumen.sqlite}" \
  LUMEN_TELEGRAM_BOT_TOKEN="$LUMEN_TELEGRAM_BOT_TOKEN" \
  LUMEN_TELEGRAM_OWNER_CHAT_ID="$LUMEN_TELEGRAM_OWNER_CHAT_ID" \
  LUMEN_TELEGRAM_OWNER_USER_ID="$LUMEN_TELEGRAM_OWNER_USER_ID" \
  node scripts/telegram-poll.mjs
```

The script sets `LUMEN_TELEGRAM_MODE=poll` when it is unset, and it refuses to start when that variable is set to anything else. On start it calls `deleteWebhook`, then `getUpdates`, and it remembers the update offset. The temporary bundle is deleted when the process exits. It uses the same owner check as the webhook. A thought she offers on her own still waits about 30 minutes, and she stays quiet from 23:00 to 07:00 America/Chicago. A direct command still answers.

Plain text is commands-only unless `LUMEN_TELEGRAM_COMMANDS_ONLY` is the exact string `false`. In the default mode she answers `I only answer /help, /mood, /needs, /status and /world here for now`, writes nothing to messages or brain state, and does not call api.x.ai. Talk, including Grok when `LUMEN_XAI_API_KEY` is set, runs only when that flag is `false`. The read-only commands stay on the recorded state either way. `/status` says it reads this instance's local data, not production. The key and the bot token are not written into the prompt body or the log. Any error text that contains the bot token, or a `api.telegram.org/bot...` URL, is redacted before it is printed.

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
| `/status` | Awake or asleep, the tick, whether live money is on, whether checkout is open, whether the Saloon is paper, and the kill switch. She says this is this instance's local data, not production. No balance is invented. With live money off, she says she does not have one. |
| `/world` | Her place, and the scene she published: palette, sky, weather, decoration, garden stage. |
| `/help` | The list above, and the reminder that a message cannot spend. |

With commands-only on, an unknown slash gets the same short canned line as plain text. It is not talk and it cannot spend. Set `LUMEN_TELEGRAM_COMMANDS_ONLY=false` to let plain text through as talk. That talk still cannot spend, change a toggle, mint, touch the kill switch, or change a price. A chat that is not a private message from the owner user in the owner chat is dropped.

Zoora may stay quiet for hours. At most about one unsolicited thought goes out every 30 minutes. Quiet hours are 23:00–07:00 America/Chicago. A thought she has already told the owner is not sent again.
