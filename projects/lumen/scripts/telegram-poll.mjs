import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactToken } from "./telegram-redact.mjs";

const ALLOWED = ["PATH", "NODE_ENV", "TZ", "LUMEN_TELEGRAM_BOT_TOKEN", "LUMEN_TELEGRAM_OWNER_CHAT_ID", "LUMEN_TELEGRAM_OWNER_USER_ID", "LUMEN_DATA"];

export function forbiddenPollKeys(env) {
  return Object.keys(env).filter((key) => {
    const value = env[key];
    if (value == null || String(value).length === 0) return false;
    if (key === "LUMEN_MONEY_LIVE" || key === "LUMEN_TRADING_LIVE") return true;
    if (key.startsWith("STRIPE_")) return true;
    return /ISSUING|PRIVACY|SIGNER|MINT/i.test(key);
  });
}

/** The child process receives only these names. Secrets stay in the environment, not in argv. */
export function minimalPollEnv(env) {
  const next = {
    PATH: env.PATH || "/usr/bin",
    NODE_ENV: env.NODE_ENV || "production",
    TZ: env.TZ || "UTC",
    LUMEN_TELEGRAM_MODE: "poll",
  };
  for (const key of ALLOWED) {
    if (env[key]) next[key] = env[key];
  }
  if (!next.LUMEN_DATA) next.LUMEN_DATA = "data/lumen.sqlite";
  return next;
}

export function preparePollEnv(env) {
  if (env.LUMEN_TELEGRAM_MODE && env.LUMEN_TELEGRAM_MODE !== "poll") return false;
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

export function removePollBundle(file) {
  if (!file) return;
  rmSync(file, { force: true });
  rmSync(path.dirname(file), { recursive: true, force: true });
}

export async function launchPoll({ env = process.env, run, writeError = (line) => console.error(line) }) {
  const forbidden = forbiddenPollKeys(env);
  if (forbidden.length) {
    writeError("Refusing to poll because a money, issuing, privacy, signer, or mint variable is set.");
    return 1;
  }
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
  return { poller: await import(pathToFileURL(file).href), file };
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry && !process.argv.includes("--minimal")) {
  const forbidden = forbiddenPollKeys(process.env);
  if (forbidden.length) {
    console.error("Refusing to poll because a money, issuing, privacy, signer, or mint variable is set.");
    process.exit(1);
  }
  const child = spawnSync(process.execPath, [process.argv[1], "--minimal"], {
    env: minimalPollEnv(process.env),
    stdio: "inherit",
  });
  process.exit(child.status ?? 1);
}

if (import.meta.url === entry) {
  let bundle = "";
  const code = await launchPoll({
    run: async () => {
      const loaded = await loadPoller();
      bundle = loaded.file;
      try {
        await loaded.poller.runTelegramPoll(process.env);
      } finally {
        removePollBundle(bundle);
        bundle = "";
      }
    },
  });
  removePollBundle(bundle);
  process.exit(code);
}
