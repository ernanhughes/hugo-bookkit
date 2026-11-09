// Manual QA for book reference previews. Playwright is not installed here,
// so this runs wherever a browser can be driven; it follows the same
// fixture pattern as tests/test_references.py (serve that fixture site).
// Generate fixture: run only the fixture-writing part of the test, copy the
// site to BOOKKIT_QA_DIR/library, serve it, then:
//   node tests/references.browser.cjs http://127.0.0.1:8766/library
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const base = process.argv[2] || 'http://127.0.0.1:8766/library';
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ hasTouch: true, isMobile: false });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/books/alpha/01-chapter/`);

    const link = page.locator('a.bookkit-ref').first();
    await link.waitFor();

    // Mouse: hover reveals the preview, leaving dismisses it.
    await link.hover();
    const preview = page.locator('.bookkit-ref-preview').first();
    await preview.waitFor({ state: 'visible' });
    assert.match(await preview.textContent(), /versioned claim/);
    await page.mouse.move(5, 5);
    await preview.waitFor({ state: 'hidden' });

    // Keyboard: focus reveals, Escape dismisses and refocuses the link.
    await link.focus();
    await preview.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await preview.waitFor({ state: 'hidden' });
    assert.strictEqual(await page.evaluate(() => document.activeElement.textContent), await link.textContent());

    // Touch toggle: opens without navigating.
    await page.locator('[data-bookkit-ref-toggle]').first().click();
    await preview.waitFor({ state: 'visible' });
    assert.strictEqual(page.url(), `${base}/books/alpha/01-chapter/`);

    // Full document navigation works from the preview.
    await Promise.all([
      page.waitForURL('**/references/decisions/alpha-decision/'),
      page.locator('.bookkit-ref-more a').first().click(),
    ]);
    assert.match(await page.content(), /Alpha Architecture Decision/);

    // Viewport clamping: narrow viewport keeps the preview on screen.
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(`${base}/books/alpha/01-chapter/`);
    await page.locator('a.bookkit-ref').first().hover();
    const box = await page.locator('.bookkit-ref-preview').first().boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 360, 'preview overflows viewport');

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})();
