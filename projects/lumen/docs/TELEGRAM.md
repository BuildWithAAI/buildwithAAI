# Telegram with the owner

Zoora can message the keeper, and the keeper can talk back. This is not a spending channel. A message cannot approve a purchase, change the kill switch, or mint a token.

When `LUMEN_TELEGRAM_BOT_TOKEN` or `LUMEN_TELEGRAM_OWNER_CHAT_ID` is unset, Zoora stays in mock mode. Messages are stored for the desk and nothing is sent.

## Create the bot

1. In Telegram, open `@BotFather`.
2. Send `/newbot` and follow the prompts.
3. Copy the bot token. It is a secret. Do not commit it and do not paste it into a log.

## Chat id

Send any message to the new bot from the owner account, then read the chat id:

```powershell
curl "https://api.telegram.org/bot<token>/getUpdates"
```

Use the `chat.id` from that reply. That number is `LUMEN_TELEGRAM_OWNER_CHAT_ID`. Zoora accepts talk-back only from this id. Every other chat is dropped and the id is logged without the message text.

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

The webhook secret is the value Telegram sends in `X-Telegram-Bot-Api-Secret-Token`. Set it on the bot when you call `setWebhook`. Zoora rejects the webhook when the header does not match.

Quiet hours are 23:00–07:00 America/Chicago. Alerts still go out. Other notes wait, and at most one non-alert note goes out every 30 minutes. The desk can turn each kind off: build, diary, research, summary, alert.

## Talk-back

The only commands are `/status`, `/diary`, and `/pause_builds`. Anything else is owner chat, the same as the desk. `/pause_builds` only stops creative building.
