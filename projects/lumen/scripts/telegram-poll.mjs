import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactToken } from "./telegram-redact.mjs";

export function preparePollEnv(env) {
  if (env.LUMEN_TELEGRAM_MODE && env.LUMEN_TELEGRAM_MODE !== "poll") {
    return false;
  }
  env.LUMEN_TELEGRAM_MODE = "poll";
  delete env.LUMEN_MONEY_LIVE;
  delete env.LUMEN_TRADING_LIVE;
  env.LUMEN_SALES_MODE = "disabled";
  env.LUMEN_SALES_ENABLED = "false";
  env.SALES_ENABLED = "false";
  env.LUMEN_SPEND_ENABLED = "false";
  env.SPEND_ENABLED = "false";
  env.MINT_ENABLED = "false";
  return true;
}

export async function launchPoll({ env = process.env, run, writeError = (line) => console.error(line) }) {
  if (!preparePollEnv(env)) {
    writeError("Refusing to poll because LUMEN_TELEGRAM_MODE is not poll.");
    return 1;
  }
  if (env.LUMEN_MONEY_LIVE === "true" || env.LUMEN_TRADING_LIVE === "true" || env.LUMEN_SALES_MODE !== "disabled") {
    writeError("Refusing to poll because money would stay live.");
    return 1;
  }
  try {
    await run();
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "poll failed";
    writeError(redactToken(message, env.LUMEN_TELEGRAM_BOT_TOKEN ?? ""));
    return 1;
  }
}

async function loadPoller() {
  const built = await build({
    entryPoints: [path.join(path.dirname(new URL(import.meta.url).pathname), "../src/integrations/telegramPoll.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const dir = mkdtempSync(path.join(tmpdir(), "lumen-tg-"));
  const file = path.join(dir, "poll.mjs");
  writeFileSync(file, built.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  const code = await launchPoll({
    run: async () => {
      const poller = await loadPoller();
      await poller.runTelegramPoll(process.env);
    },
  });
  process.exit(code);
}
