import { pathToFileURL } from "node:url";
import { redactToken } from "./telegram-redact.mjs";

export const BOT_COMMANDS = [
  { command: "mood", description: "How Zoora feels right now" },
  { command: "needs", description: "What Zoora needs" },
  { command: "status", description: "A truthful status with no invented balance" },
  { command: "world", description: "The place, sky, and weather she chose" },
  { command: "help", description: "Read-only commands" },
];

export async function setMyCommands({ token, fetchImpl = fetch, writeError = (line) => console.error(line) }) {
  if (!token) {
    writeError("LUMEN_TELEGRAM_BOT_TOKEN is unset.");
    return 1;
  }
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: BOT_COMMANDS }),
    });
    if (!response.ok) {
      writeError(`setMyCommands failed (${response.status}).`);
      return 1;
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "setMyCommands failed";
    writeError(redactToken(message, token));
    return 1;
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  const code = await setMyCommands({ token: process.env.LUMEN_TELEGRAM_BOT_TOKEN ?? "" });
  if (code === 0) console.log("Commands set.");
  process.exit(code);
}
