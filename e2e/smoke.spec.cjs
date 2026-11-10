const { test, expect } = require('./fixtures.cjs');

test('guest can load the home page', async ({ guestPage: page }) => {
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('[data-practice-flow="question"]')).toBeVisible();
  await expect(page.locator('#languageSelect')).toHaveValue('zh-TW');
  expect((await page.request.get('/admin')).status()).toBe(200);
  expect((await page.request.get('/does-not-exist')).status()).toBe(404);
});
