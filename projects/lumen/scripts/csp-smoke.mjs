import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const port = 3107;
const base = `http://127.0.0.1:${port}`;
const root = new URL("..", import.meta.url);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", env: process.env });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`))));
  });
}

await run("npx", ["next", "build"]);

const server = spawn("npx", ["next", "start", "-p", String(port)], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", LUMEN_PUBLIC_MODE: "true", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk; });
server.stderr.on("data", (chunk) => { serverLog += chunk; });

try {
  let up = false;
  for (let i = 0; i < 60; i += 1) {
    try {
      const health = await fetch(`${base}/healthz`);
      if (health.ok) { up = true; break; }
    } catch { /* starting */ }
    await delay(500);
  }
  if (!up) throw new Error(`server did not start\n${serverLog}`);

  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  const problems = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(String(error)));

  async function open(path) {
    problems.length = 0;
    await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-hydrated=yes]", { timeout: 15000, state: "attached" });
    const csp = problems.filter((line) => /content security policy|refused to execute/i.test(line));
    if (csp.length) throw new Error(`CSP violation on ${path}: ${csp.join(" | ")}`);
    if (problems.length) throw new Error(`console error on ${path}: ${problems.join(" | ")}`);
  }

  await open("/");
  const dismiss = page.getByRole("button", { name: "Dismiss" });
  if (await dismiss.count()) {
    await dismiss.click();
    await page.waitForSelector("[role=dialog]", { state: "detached" });
  }
  const shots = process.env.RUNNER_TEMP || tmpdir();
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/home.png`, fullPage: true });

  await open("/guestbook");
  await page.screenshot({ path: `${shots}/guestbook.png`, fullPage: true });

  problems.length = 0;
  await page.goto(`${base}/world`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-hydrated=yes]", { timeout: 15000, state: "attached" });
  await page.getByText("Drag to look around").waitFor({ timeout: 15000 });
  if (problems.some((line) => /content security policy|refused to execute/i.test(line))) {
    throw new Error(`CSP violation on /world: ${problems.join(" | ")}`);
  }
  if (problems.length) throw new Error(`console error on /world: ${problems.join(" | ")}`);
  await page.screenshot({ path: `${shots}/world-tip.png` });
  await browser.close();
  await writeFile(`${shots}/csp-smoke-ok`, "ok\n");
} finally {
  server.kill("SIGTERM");
  await delay(300);
  if (!server.killed) server.kill("SIGKILL");
}
