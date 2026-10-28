// Development-only checks; exported pages have no runtime JavaScript or remote assets.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const root = path.resolve(__dirname, '..', 'evidence-output');
  const folder = path.join(root, 'notebook-report');
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const network = [], errors = [];
      page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(path.join(folder, 'audit.html')).href);
      const notice = await page.locator('#readiness').innerText();
      if (!notice.includes('SYNTHETIC') || !notice.includes('funded trading blocked')) throw Error('Missing research boundary');
      if (await page.locator('.cards .card').count() !== 3) throw Error('Missing notebook cards');
      if (await page.locator('#evaluations tbody tr').count() !== 3) throw Error('Missing retained evaluations');
      if (await page.locator('#receipts tbody tr').count() !== 2) throw Error('Missing raw data receipts');
      if (await page.locator('#events tbody tr').count() !== 6) throw Error('Missing event history');
      if (!/^[a-f0-9]{64}$/.test(await page.locator('#checkpoint').innerText())) throw Error('Missing checkpoint');
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Body overflow');
      await page.screenshot({ path: path.join(root, 'notebook-' + viewport.width + '.png'), fullPage: true });
      await page.locator('a[href="study.html"]').click();
      if (!page.url().endsWith('/study.html') || !(await page.title()).includes('SFP')) throw Error('Study link failed');
      if (await page.locator('details').count() !== 3) throw Error('Latest study fold details missing');
      if (network.length || errors.length) throw Error('Network or page error');
      checks.push({ viewport, synthetic_blocked_notice: true, cards: 3, evaluations: 3, receipts: 2,
                    events: 6, checkpoint_visible: true, no_body_overflow: true,
                    study_link_and_three_folds: true, external_requests: 0, page_errors: 0 });
      await page.close();
    }
    fs.writeFileSync(path.join(root, 'notebook-ui.json'), JSON.stringify({
      protocol: 'ZOORA_BT007_NOTEBOOK_UI_V1', source_head_sha: process.env.SOURCE_HEAD_SHA || null,
      browser: 'Chromium desktop and phone-sized viewport; not actual iPhone Safari', checks,
    }, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ notebook_ui_viewports: 2, checks_per_viewport: 10, external_requests: 0 }) + '\n');
  } finally { await browser.close(); }
}
main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
