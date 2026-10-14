// Development-only source report checks; runtime pages use no scripts or remote assets.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const root = path.resolve(__dirname, '..', 'evidence-output');
  const folder = path.join(root, 'provider-source');
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const network = [], errors = [];
      page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(path.join(folder, 'source.html')).href);
      const boundary = await page.locator('#boundary').innerText();
      if (!boundary.includes('SYNTHETIC') || !boundary.includes('funded trading blocked')) throw Error('Missing source boundary');
      if (await page.locator('.cards .card').count() !== 3) throw Error('Missing source cards');
      if (!(await page.locator('#screen').innerText()).includes('PASS_LOCAL_DATA_SCREEN_ONLY')) throw Error('Missing local-only data screen');
      if (!(await page.locator('#contract').innerText()).includes('721_ROWS_VS_DOCUMENTED_720')) throw Error('Hidden provider discrepancy');
      if (!(await page.locator('#transport').innerText()).includes('LOCAL_FILE_IMPORT_NOT_WITNESSED')) throw Error('False transport claim');
      if (await page.locator('#requests tbody tr').count() !== 2) throw Error('Missing raw receipts');
      if (!(await page.locator('body').innerText()).includes('not an AAI token')) throw Error('Missing market boundary');
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Body overflow');
      for (const name of ['SOURCE_NOTES.md', 'quality.json', 'history.csv']) {
        if (await page.locator('a[href="' + name + '"]').count() !== 1 || !fs.existsSync(path.join(folder, name))) throw Error('Broken local record link');
      }
      if (network.length || errors.length) throw Error('External request or page error');
      await page.screenshot({ path: path.join(root, 'source-' + viewport.width + '.png'), fullPage: true });
      checks.push({ viewport, blocked_synthetic_boundary: true, cards: 3, local_only_screen: true,
                    provider_contract_warning: true, file_import_label: true, request_receipts: 2,
                    market_boundary: true, no_body_overflow: true, local_record_links: 3,
                    external_requests: 0, page_errors: 0 });
      await page.close();
    }
    fs.writeFileSync(path.join(root, 'source-ui.json'), JSON.stringify({
      protocol: 'ZOORA_BT008_SOURCE_UI_V1', source_head_sha: process.env.SOURCE_HEAD_SHA || null,
      browser: 'Chromium desktop/phone-sized viewport; not actual iPhone Safari', checks,
    }, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ source_ui_viewports: 2, checks_per_viewport: 11, external_requests: 0 }) + '\n');
  } finally { await browser.close(); }
}
main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
