import { redactToken } from "./telegram-redact.mjs";

const token = process.env.LUMEN_TELEGRAM_BOT_TOKEN ?? "";
if (!token) {
  console.error("LUMEN_TELEGRAM_BOT_TOKEN is unset.");
  process.exit(1);
}

let response;
try {
  response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
} catch (error) {
  const message = error instanceof Error ? error.message : "getUpdates failed";
  console.error(redactToken(message, token));
  process.exit(1);
}
const text = await response.text();
process.stdout.write(`${redactToken(text, token)}\n`);
if (!response.ok) process.exit(1);
