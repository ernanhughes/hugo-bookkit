// Run after building exampleSite and serving its public directory:
//   node tests/local-data-demo.browser.cjs http://127.0.0.1:8780
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const base = process.argv[2] || 'http://127.0.0.1:8780';
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/local-data-demo/`);
    await page.locator('[data-local-data-demo-note]').waitFor();
    await page.waitForFunction(() => /No saved note|Loaded from this browser/.test(document.querySelector('[data-local-data-demo-status]')?.textContent || ''));
    await page.locator('[data-local-data-demo-note]').fill('The demo survives a reload.');
    await page.waitForFunction(() => /Saved locally/.test(document.querySelector('[data-local-data-demo-status]')?.textContent || ''));
    await page.reload();
    await page.waitForFunction(() => /Loaded from this browser/.test(document.querySelector('[data-local-data-demo-status]')?.textContent || ''));
    assert.equal(await page.locator('[data-local-data-demo-note]').inputValue(), 'The demo survives a reload.');
    assert.deepEqual(errors, []);
    console.log('ExampleSite local-data demo: module import, save, commit status and reload persistence passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
