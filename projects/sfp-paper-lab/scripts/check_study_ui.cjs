// Dev-only Chromium checks. The exported report has no runtime JavaScript or network service.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const root = path.resolve(__dirname, '..', 'evidence-output');
  const target = path.join(root, 'study-report', 'study.html');
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const network = [], errors = [];
      page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(target).href);
      if (!(await page.locator('.notice').innerText()).includes('SYNTHETIC')) throw Error('Missing synthetic banner');
      if ((await page.locator('.cards .card').count()) !== 3) throw Error('Missing status cards');
      if ((await page.locator('details').count()) !== 3) throw Error('Missing fold ledger');
      await page.locator('details summary').first().click();
      if ((await page.locator('details').first().getAttribute('open')) === null) throw Error('Fold does not expand');
      if ((await page.locator('details').first().locator('tbody tr').count()) !== 24) throw Error('Hidden trial count differs');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) throw Error('Body overflow at ' + viewport.width);
      const screen = await page.locator('.scroll table').first().locator('tbody tr').first().locator('td').nth(1).boundingBox();
      if (!screen || screen.x < 0 || screen.x + screen.width > viewport.width) throw Error('Screen status hidden off viewport');
      if (network.length || errors.length) throw Error('Network or page errors');
      const screenshot = path.join(root, 'study-' + viewport.width + '.png');
      await page.screenshot({ path: screenshot, fullPage: true });
      checks.push({ viewport, synthetic_banner: true, cards: 3, fold_ledgers: 3,
                    expanded_trials: 24, no_body_overflow: true, screen_status_visible: true,
                    external_requests: 0, page_errors: 0 });
      await page.close();
    }
    const record = { protocol: 'ZOORA_BT006_PORTABLE_REPORT_UI_V1',
                     source_head_sha: process.env.SOURCE_HEAD_SHA || null,
                     browser: 'Chromium desktop and phone-sized viewport; not real iPhone Safari', checks };
    fs.writeFileSync(path.join(root, 'study-ui.json'), JSON.stringify(record, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ study_ui_viewports: 2, checks_per_viewport: 8, external_requests: 0 }) + '\n');
  } finally { await browser.close(); }
}
main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
