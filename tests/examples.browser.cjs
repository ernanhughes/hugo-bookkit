// Generate fixture: set BOOKKIT_QA_DIR, run unittest test_examples.py; serve that directory.
// Then: node tests/examples.browser.cjs http://127.0.0.1:8766/library
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const base = process.argv[2] || 'http://127.0.0.1:8766/library';
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/examples/`);
    await page.locator('[data-result-link]').first().waitFor();
    assert.equal(await page.locator('[data-result-link]').count(), 3);
    await page.locator('[data-search-book]').selectOption('beta');
    await page.locator('[data-search-status]').filter({ hasText: 'of 1 examples' }).waitFor();
    assert.equal(await page.locator('[data-result-link]').textContent(), 'Beta example');
    assert.equal(await page.locator('[data-result-link]').getAttribute('href'), '/library/examples/beta/01-chapter/');
    await page.locator('[data-search-book]').selectOption('');
    await page.locator('[data-site-search-input]').fill('needle_identifier');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.locator('[data-result-link]').filter({ hasText: 'Alpha example' }).waitFor();
    assert.equal(await page.locator('[data-result-link]').count(), 1);
    await page.locator('[data-result-link]').click();
    for (const block of await page.locator('[data-example-code]').all()) {
      await block.locator('[data-example-copy]').click();
      await block.getByRole('status').filter({ hasText: 'Copied.' }).waitFor();
      assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), await block.locator('textarea').inputValue());
    }
    await page.getByRole('link', { name: 'Back to chapter:', exact: false }).click();
    assert.ok(page.url().endsWith('/books/alpha/renamed/'));
    const summary = page.locator('[data-bookkit-example] summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-bookkit-example]').evaluate(node => node.open), true);
    assert.equal(await page.locator('[data-bookkit-example] a').filter({ hasText: 'Leaf resource' }).getAttribute('href'), '/library/examples/alpha/01-chapter/note.txt');
    await page.keyboard.press('Escape');
    assert.equal(await summary.evaluate(node => document.activeElement === node), true);
    assert.equal(await page.locator('[data-bookkit-example]').evaluate(node => node.open), false);
    for (const width of [320, 375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await summary.click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.locator('[data-example-close]').click();
    }
    assert.deepEqual(errors, []);
    console.log('Shared multi-book filtering, source copying (four languages), relative resource links, keyboard and mobile checks passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
