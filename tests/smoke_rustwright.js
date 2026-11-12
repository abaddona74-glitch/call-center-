const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('rustwright');

test('Rustwright Fast Smoke Test - Chromium launch & evaluation', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.goto('https://example.com');
        const title = await page.title();
        assert.match(title, /Example Domain/i);

        const result = await page.evaluate('1 + 1');
        assert.equal(result, 2);
    } finally {
        await browser.close();
    }
});
