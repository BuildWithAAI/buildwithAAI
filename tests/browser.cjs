/* SYNTHETIC offline browser QA. No financial observations or live provider calls. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {});
  const errors = [];
  fs.mkdirSync('ui-results', {recursive:true});
  for (const [name, viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
    const page = await browser.newPage({viewport});
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8787');
    await page.locator('#connection').filter({hasText:'API available'}).waitFor();
    if (process.env.AAI_TEST_ACCESS_TOKEN) {
      await page.locator('#access-dialog').waitFor({state:'visible'});
      await page.locator('#access-token').fill('wrong_application_access_token_12345');
      await page.locator('#access-form button').click();
      await page.locator('#access-error').filter({hasText:'not accepted'}).waitFor();
      await page.locator('#access-token').fill(process.env.AAI_TEST_ACCESS_TOKEN);
      await page.locator('#access-form button').click();
      await page.locator('#access-dialog').waitFor({state:'hidden'});
      assert.equal(await page.locator('#access-token').inputValue(), '');
      assert(await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0), 'no persisted access token');
    }
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    await page.locator('#mint').fill(mint);
    await page.locator('#scan-form button').click();
    await page.locator('#token-name').filter({hasText:'SYNTHETIC TEST'}).waitFor();
    assert.equal(await page.locator('#token-name img').count(), 0, 'provider metadata must remain text');
    await page.locator('#loading').waitFor({state:'hidden'});
    await page.locator('#coverage-notice').filter({hasText:'largest token accounts'}).waitFor();
    assert.match(await page.locator('#report-badge').innerText(), /Partial report/);
    assert.equal(await page.locator('#metrics .metric').count(), 6);
    assert.match(await page.locator('#metrics').innerText(), /Unavailable/);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow');
    await page.screenshot({path:`ui-results/${name}-report.png`,fullPage:true});
    await page.locator('#watch').click();
    await page.locator('#watch').filter({hasText:'Watch saved'}).waitFor();
    await page.locator('[data-page=watchlist]').click();
    await page.locator('.watch-card').first().waitFor();
    await page.locator('.watch-card button').filter({hasText:'Remove'}).first().click();
    await page.locator('#watchlist').filter({hasText:'No saved watches'}).waitFor();
    await page.locator('[data-page=risk]').click();
    assert.match(await page.locator('#receipts').innerText(), /Synthetic/);
    await page.locator('[data-page=wallet]').click();
    await page.locator('#wallet-address').fill('11111111111111111111111111111111');
    await page.locator('#wallet-form button').click();
    await page.locator('#wallet-result').waitFor({state:'visible'});
    assert.match(await page.locator('#wallet-result').innerText(), /Unavailable/);
    await page.locator('[data-page=status]').click();
    await page.locator('#system-status').filter({hasText:'DISABLED'}).waitFor();
    assert.match(await page.locator('#system-status').innerText(), /Application checks/);
    assert.match(await page.locator('#system-status').innerText(), /Last report data/);
    assert.match(await page.locator('#system-status').innerText(), /UNAVAILABLE/);
    await page.screenshot({path:`ui-results/${name}-status.png`,fullPage:true});
    await page.locator('[data-page=overview]').click();
    await page.route('**/api/scan', route => route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'Synthetic capacity reached'})}));
    await page.locator('#refresh').click();
    await page.locator('#error').filter({hasText:'Synthetic capacity reached'}).waitFor();
    await page.locator('#loading').waitFor({state:'hidden'});
    assert.equal(await page.locator('#refresh').isEnabled(), true);
    await page.close();
  }
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  await browser.close();
  console.log('PASS: desktop/mobile authenticated access, scan, partial coverage, literal metadata, missingness, capacity errors, watch persistence, wallet, risk, status and overflow');
})().catch(error => {console.error(error);process.exit(1);});
