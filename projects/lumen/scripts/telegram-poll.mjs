import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactToken } from "./telegram-redact.mjs";

export const POLL_ALLOWLIST = ["PATH", "NODE_ENV", "TZ", "LUMEN_DATA", "LUMEN_TELEGRAM_BOT_TOKEN", "LUMEN_TELEGRAM_OWNER_CHAT_ID", "LUMEN_TELEGRAM_OWNER_USER_ID", "LUMEN_TELEGRAM_MODE"];

export function forbiddenPollKeys(env) {
  return Object.keys(env).filter((key) => {
    const value = env[key];
    if (value == null || String(value).length === 0) return false;
    const upper = key.toUpperCase();
    if (upper === "LUMEN_MONEY_LIVE" || upper === "LUMEN_TRADING_LIVE") return true;
    if (upper.includes("PRIVATE_KEY") || upper.includes("ISSUER") || upper.includes("STRIPE")) return true;
    if (upper.startsWith("LUMEN_STRIPE_")) return true;
    if ((upper.endsWith("_SECRET") || upper.endsWith("_TOKEN")) && upper !== "LUMEN_TELEGRAM_BOT_TOKEN") return true;
    return /ISSUING|PRIVACY|SIGNER|MINT/i.test(key);
  });
}

/** True only when the process environment is exactly the poll allowlist. */
export function pollEnvAllowed(env) {
  const keys = Object.keys(env).filter((key) => env[key] != null && String(env[key]).length > 0);
  if (keys.length !== POLL_ALLOWLIST.length) return false;
  const allow = new Set(POLL_ALLOWLIST);
  return keys.every((key) => allow.has(key));
}

/** The child process receives only these names. Secrets stay in the environment, not in argv. */
export function minimalPollEnv(env) {
  const next = {
    PATH: env.PATH || "/usr/bin",
    NODE_ENV: env.NODE_ENV || "production",
    TZ: env.TZ || "UTC",
    LUMEN_TELEGRAM_MODE: "poll",
  };
  for (const key of POLL_ALLOWLIST) {
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
  if (!pollEnvAllowed(process.env)) {
    console.error("Refusing to poll because the environment is not the Telegram allowlist.");
    process.exit(1);
  }
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
