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

function boxesOverlap(a, b) {
  if (!a || !b) return false;
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function shootNarrow(browser, base, shots, viewport, file) {
  const context = await browser.newContext({ viewport });
  const mobile = await context.newPage();
  await mobile.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await mobile.waitForSelector("[data-hydrated=yes]", { timeout: 15000, state: "attached" });
  const notice = mobile.getByRole("dialog", { name: "AI disclosure" });
  if (await notice.count()) {
    await notice.waitFor({ timeout: 5000 });
    const noticeBox = await notice.boundingBox();
    const controls = [
      ["Ledger", await mobile.getByRole("button", { name: "Ledger" }).boundingBox()],
      ["Wishes", await mobile.getByRole("button", { name: "Wishes" }).boundingBox()],
      ["Menu", await mobile.getByRole("button", { name: "Menu" }).boundingBox()],
      ["time", await mobile.locator(".banner-time").boundingBox()],
    ];
    for (const [name, box] of controls) {
      if (boxesOverlap(noticeBox, box)) throw new Error(`AI notice covers ${name}`);
    }
    await mobile.getByRole("button", { name: "Dismiss" }).click();
    await mobile.waitForSelector("[role=dialog]", { state: "detached" });
  }
  await mobile.locator(".world-tip").waitFor({ timeout: 15000 });
  await mobile.locator("[data-greeting]").waitFor();
  await mobile.getByRole("button", { name: "Places", exact: true }).waitFor();
  await mobile.getByRole("button", { name: "Menu" }).waitFor();
  await mobile.getByRole("button", { name: "Ledger" }).waitFor();
  await mobile.getByRole("button", { name: "Wishes" }).waitFor();
  if (await mobile.getByRole("button", { name: "overview", exact: true }).count()) {
    throw new Error("place chips are still open on a narrow screen");
  }
  if (await mobile.locator(".banner-extra", { hasText: "Clear paths" }).isVisible()) {
    throw new Error("status chips should stay behind Menu");
  }
  const time = await mobile.locator(".banner-time").innerText();
  if (/up |down /.test(time)) throw new Error(`time pill is still long: ${time}`);
  const timeBox = await mobile.locator(".banner-time").boundingBox();
  if (timeBox && timeBox.height > 46) throw new Error(`time pill wraps: ${timeBox.height}px`);
  await mobile.locator("[data-thought]").waitFor({ timeout: 15000 });
  await mobile.waitForTimeout(1200);
  const tipBox = await mobile.locator(".world-tip").boundingBox();
  const greetBox = await mobile.locator("[data-greeting]").boundingBox();
  const placesBox = await mobile.getByRole("button", { name: "Places", exact: true }).boundingBox();
  const menuBox = await mobile.getByRole("button", { name: "Menu" }).boundingBox();
  const thoughtBox = await mobile.locator("[data-thought]").boundingBox();
  if (boxesOverlap(tipBox, greetBox)) throw new Error("camera tip overlaps the greeting");
  if (boxesOverlap(tipBox, placesBox)) throw new Error("camera tip overlaps Places");
  if (boxesOverlap(tipBox, menuBox)) throw new Error("camera tip overlaps Menu");
  const ledgerBox = await mobile.getByRole("button", { name: "Ledger" }).boundingBox();
  if (boxesOverlap(thoughtBox, ledgerBox) || boxesOverlap(thoughtBox, menuBox)) {
    throw new Error("thought bubble covers a top control");
  }
  if (!thoughtBox || thoughtBox.x < -1 || thoughtBox.y < -1 || thoughtBox.x + thoughtBox.width > viewport.width + 1 || thoughtBox.y + thoughtBox.height > viewport.height + 1) {
    throw new Error(`thought bubble is off the ${viewport.width}px screen`);
  }
  await mobile.screenshot({ path: `${shots}/${file}` });
  await mobile.locator("[data-greeting]").click();
  await mobile.locator("[data-home-notices]").waitFor();
  if (await mobile.locator(".world-tip").isVisible()) {
    const openTip = await mobile.locator(".world-tip").boundingBox();
    const drawer = await mobile.locator(".home-drawer").boundingBox();
    if (boxesOverlap(openTip, drawer)) throw new Error("camera toast overlaps the open drawer");
  }
  await context.close();
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
  console.error("smoke timed out");
  process.exit(1);
}, 420_000);
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
  await shootNarrow(browser, base, shots, { width: 390, height: 844 }, "home-mobile.png");
  await shootNarrow(browser, base, shots, { width: 768, height: 1024 }, "home-tablet.png");
  let deskUp = false;
  for (let i = 0; i < 40; i += 1) {
    try {
      const ready = await fetch("http://127.0.0.1:3001/admin/login", { signal: AbortSignal.timeout(8000) });
      if (ready.status === 200) { deskUp = true; break; }
    } catch { /* proxy is still binding */ }
    await delay(250);
  }
  if (!deskUp) throw new Error("desk proxy did not open /admin/login");
  const login = await browser.newPage();
  await login.goto("http://127.0.0.1:3001/admin/login", { waitUntil: "domcontentloaded" });
  await login.locator("input[name=secret]").waitFor();
  await login.screenshot({ path: `${shots}/desk-login.png` });
  await login.locator("input[name=secret]").fill(ownerToken);
  await login.getByRole("button", { name: "Enter" }).click();
  await login.getByRole("heading", { name: "Zoora, in private" }).waitFor({ timeout: 15000 });
  await login.reload({ waitUntil: "domcontentloaded" });
  await login.getByRole("heading", { name: "Zoora, in private" }).waitFor({ timeout: 15000 });
  const stored = (await login.context().cookies("http://127.0.0.1:3001")).find((item) => item.name === "lumen_owner");
  if (!stored || stored.secure) throw new Error("loopback desk did not keep a non-Secure session cookie");
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
