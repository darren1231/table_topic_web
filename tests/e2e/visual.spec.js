const { test, expect, openApp, enterQuestionPractice } = require('../helpers/app-fixture');

test('home entry cards visual contract', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.entry-grid')).toHaveScreenshot('home-entry-cards.png', { animations: 'disabled' });
});

test('desktop transcript actions visual contract', async ({ page }) => {
  await openApp(page);
  await enterQuestionPractice(page);
  await page.locator('#transcript').fill('穩定的視覺測試草稿內容，用來呈現字數與主要分析按鈕。');
  await expect(page.locator('.textarea-footer')).toHaveScreenshot('transcript-actions-desktop.png', { animations: 'disabled' });
});

test('mobile transcript actions visual contract', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await enterQuestionPractice(page);
  await page.locator('#transcript').fill('穩定的手機視覺測試草稿內容。');
  await expect(page.locator('.textarea-footer')).toHaveScreenshot('transcript-actions-mobile.png', { animations: 'disabled' });
});
