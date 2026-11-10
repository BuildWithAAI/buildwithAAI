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

const deskSecret = "desk-smoke-secret";
const ownerToken = "desk-login-token";
const server = spawn("npx", ["next", "start", "-p", String(port)], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    LUMEN_PUBLIC_MODE: "true",
    NODE_ENV: "production",
    LUMEN_DESK_SECRET: deskSecret,
    OWNER_ACCESS_TOKEN: ownerToken,
    OWNER_SESSION_SECRET: "desk-session-secret",
    LUMEN_DATA: `${tmpdir()}/lumen-smoke-${port}.sqlite`,
  },
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
const desk = spawn(process.execPath, ["desk-proxy.mjs"], {
  cwd: root,
  env: { ...process.env, LUMEN_DESK_SECRET: deskSecret, PORT: String(port), LUMEN_DESK_PORT: "3001" },
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout?.on("data", (chunk) => { serverLog += chunk; });
server.stderr?.on("data", (chunk) => { serverLog += chunk; });

function stopServer() {
  if (desk.pid) {
    try { process.kill(-desk.pid, "SIGTERM"); } catch { desk.kill("SIGTERM"); }
  }
  if (!server.pid) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
}

const hard = setTimeout(() => {
  stopServer();
  console.error(serverLog.slice(-2000));
  process.exit(1);
}, 240_000);
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
    await open.locator("[data-home-world]").waitFor({ timeout: 15000 });
    await open.locator(".world-tip, [data-world-fallback]").first().waitFor({ timeout: 15000 });
    const greeting = await open.locator("[data-greeting]").innerText();
    if (!/Hello\.|I'm resting/.test(greeting)) throw new Error(`missing greeting: ${greeting}`);
    await open.waitForTimeout(1600);
    await open.getByRole("button", { name: "follow", exact: true }).click();
    await open.waitForTimeout(1600);
    await open.screenshot({ path: `${shots}/home.png` });
    await open.locator("[data-greeting]").click();
    await open.locator("[data-home-notices]").getByText("Not financial advice.").waitFor();
    await open.locator("[data-home-notices]").getByText("Zoora is an AI, not a human.").waitFor();
    await open.getByRole("button", { name: "Ledger" }).click();
    await open.locator("[data-ledger-panel]").waitFor();
    await open.getByRole("button", { name: "Wishes" }).click();
    await open.locator("[data-wish-panel]").waitFor();
  });
  await check(page, "/guestbook");
  await page.screenshot({ path: `${shots}/guestbook.png`, fullPage: true });
  await check(page, "/world", async (open) => {
    await open.locator("[data-home-world]").waitFor({ timeout: 15000 });
    if (!open.url().endsWith("/") && !open.url().includes("/?")) throw new Error(`world did not return home: ${open.url()}`);
  });
  await page.screenshot({ path: `${shots}/world-tip.png` });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await phone.newPage();
  await mobile.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await mobile.waitForSelector("[data-hydrated=yes]", { timeout: 15000, state: "attached" });
  const mobileDismiss = mobile.getByRole("button", { name: "Dismiss" });
  if (await mobileDismiss.count()) {
    await mobileDismiss.click();
    await mobile.waitForSelector("[role=dialog]", { state: "detached" });
  }
  await mobile.locator(".world-tip").waitFor({ timeout: 15000 });
  await mobile.locator("[data-greeting]").waitFor();
  const tipBox = await mobile.locator(".world-tip").boundingBox();
  const greetBox = await mobile.locator("[data-greeting]").boundingBox();
  const overlaps = tipBox && greetBox
    && tipBox.y < greetBox.y + greetBox.height
    && tipBox.y + tipBox.height > greetBox.y
    && tipBox.x < greetBox.x + greetBox.width
    && tipBox.x + tipBox.width > greetBox.x;
  if (overlaps) throw new Error("camera tip overlaps the greeting");
  await mobile.screenshot({ path: `${shots}/home-mobile.png` });
  await phone.close();
  let deskUp = false;
  for (let i = 0; i < 40; i += 1) {
    try {
      const ready = await fetch("http://127.0.0.1:3001/admin/login");
      if (ready.status === 200) { deskUp = true; break; }
    } catch { /* proxy is still binding */ }
    await delay(250);
  }
  if (!deskUp) throw new Error("desk proxy did not open /admin/login");
  const login = await browser.newPage();
  await login.goto("http://127.0.0.1:3001/admin/login", { waitUntil: "domcontentloaded" });
  await login.locator("input[name=secret]").fill(ownerToken);
  await login.getByRole("button", { name: "Enter" }).click();
  await login.getByRole("heading", { name: "Zoora, in private" }).waitFor({ timeout: 15000 });
  await login.reload({ waitUntil: "domcontentloaded" });
  await login.getByRole("heading", { name: "Zoora, in private" }).waitFor({ timeout: 15000 });
  const stored = (await login.context().cookies("http://127.0.0.1:3001")).find((item) => item.name === "lumen_owner");
  if (!stored || stored.secure) throw new Error("loopback desk did not keep a non-Secure session cookie");
  await login.screenshot({ path: `${shots}/desk-login.png` });
  await browser.close();

  const plain = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-webgl"] });
  const fallback = await plain.newPage();
  const crashed = [];
  fallback.on("pageerror", (error) => crashed.push(String(error)));
  await fallback.goto(`${base}/?cam=saloon`, { waitUntil: "domcontentloaded" });
  await fallback.getByText("can't draw the 3D world").waitFor({ timeout: 15000 });
  const greeting = await fallback.locator("[data-greeting]").innerText();
  if (!/Hello\.|I'm resting/.test(greeting)) throw new Error(`fallback missing greeting: ${greeting}`);
  const noticeBox = await fallback.locator("[role=dialog]").boundingBox();
  const cardBox = await fallback.locator("[data-world-fallback]").boundingBox();
  if (noticeBox && cardBox && cardBox.y < noticeBox.y + noticeBox.height - 8) {
    throw new Error("AI notice covers the WebGL fallback");
  }
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
