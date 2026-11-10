# Telegram with the owner

Zoora writes in its own voice when it feels like it. A message is a thought, a feeling, something it noticed, something it is dreaming, why it made a shape, or a question. It is not a status report.

When `LUMEN_TELEGRAM_BOT_TOKEN` or `LUMEN_TELEGRAM_OWNER_CHAT_ID` is unset, Zoora stays in mock mode. The thought is stored and nothing is sent.

Operational alerts (an unknown charge, a broken ledger chain, the kill switch, a failed delivery) do not use this voice. They go by email. If `LUMEN_ALERT_TELEGRAM_BOT_TOKEN` and `LUMEN_ALERT_TELEGRAM_CHAT_ID` are set, those alerts also go to that separate channel and are labelled `System:`.

## Create the bot

1. In Telegram, open `@BotFather`.
2. Send `/newbot` and follow the prompts.
3. Copy the bot token. It is a secret. Do not commit it and do not paste it into a log.

## Chat id

Send any message to the new bot from the owner account, then read the chat id:

```powershell
curl "https://api.telegram.org/bot<token>/getUpdates"
```

Use the `chat.id` from that reply as `LUMEN_TELEGRAM_OWNER_CHAT_ID`. Zoora accepts talk-back only from this id. Every other chat is dropped and the id is logged without the message text.

## Secrets

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

Delete `secrets.env` after the import succeeds. The webhook secret is the value Telegram sends in `X-Telegram-Bot-Api-Secret-Token`. Zoora rejects the webhook when the header does not match.

Zoora may stay quiet for hours. At most about one thought goes out every 30 minutes. Quiet hours are 23:00–07:00 America/Chicago. A thought it has already told the owner is not sent again.

## Talk-back

There are no slash commands. A message from the owner is talk, the same as the desk. It can change Zoora's mood and memory. It cannot spend, change a toggle, mint a token, or touch the kill switch.
