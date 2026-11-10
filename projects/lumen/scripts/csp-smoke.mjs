import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = new URL("..", import.meta.url);
const shots = process.env.RUNNER_TEMP || tmpdir();
const port = await new Promise((resolve) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    const chosen = typeof address === "object" && address ? address.port : 0;
    probe.close(() => resolve(chosen));
  });
});
const base = `http://127.0.0.1:${port}`;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", env: process.env });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`))));
  });
}

await run("npx", ["next", "build"]);
await mkdir(shots, { recursive: true });

const server = spawn("npx", ["next", "start", "-p", String(port)], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", LUMEN_PUBLIC_MODE: "true", NODE_ENV: "production" },
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout?.on("data", (chunk) => { serverLog += chunk; });
server.stderr?.on("data", (chunk) => { serverLog += chunk; });

function stopServer() {
  if (!server.pid) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
}

const hard = setTimeout(() => {
  stopServer();
  console.error(serverLog.slice(-2000));
  process.exit(1);
}, 180_000);
hard.unref?.();

try {
  let up = false;
  for (let i = 0; i < 60; i += 1) {
    if (server.exitCode != null) break;
    try {
      const health = await fetch(`${base}/healthz`);
      if (health.ok) { up = true; break; }
    } catch { /* starting */ }
    await delay(500);
  }
  if (!up) throw new Error(`server did not start\n${serverLog}`);

  async function check(page, path, ready) {
    const problems = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(String(error)));
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-hydrated=yes]", { timeout: 15000, state: "attached" });
    if (ready) await ready(page);
    const blocked = problems.filter((line) => /content security policy|refused to execute|application error/i.test(line));
    if (blocked.length) throw new Error(`CSP or crash on ${path}: ${blocked.join(" | ")}`);
    if (problems.length) throw new Error(`console error on ${path}: ${problems.join(" | ")}`);
  }

  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await check(page, "/", async (open) => {
    const dismiss = open.getByRole("button", { name: "Dismiss" });
    if (await dismiss.count()) {
      await dismiss.click();
      await open.waitForSelector("[role=dialog]", { state: "detached" });
    }
  });
  await page.screenshot({ path: `${shots}/home.png`, fullPage: true });
  await check(page, "/guestbook");
  await page.screenshot({ path: `${shots}/guestbook.png`, fullPage: true });
  await check(page, "/world", async (open) => {
    await open.locator(".world-tip, [data-world-fallback]").first().waitFor({ timeout: 15000 });
  });
  await page.screenshot({ path: `${shots}/world-tip.png` });
  await browser.close();

  const plain = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-webgl"] });
  const fallback = await plain.newPage();
  const crashed = [];
  fallback.on("pageerror", (error) => crashed.push(String(error)));
  await fallback.goto(`${base}/world?cam=saloon`, { waitUntil: "domcontentloaded" });
  await fallback.getByText("can't draw the 3D world").waitFor({ timeout: 15000 });
  const body = await fallback.locator("body").innerText();
  if (/application error/i.test(body) || crashed.length) throw new Error(`WebGL fallback crashed: ${crashed.join(" | ")} ${body.slice(0, 200)}`);
  await fallback.screenshot({ path: `${shots}/world-fallback.png` });
  await plain.close();
  await writeFile(`${shots}/csp-smoke-ok`, "ok\n");
} finally {
  clearTimeout(hard);
  stopServer();
  await delay(400);
}
