const { test, expect, openApp, expectOnlyView } = require('../helpers/app-fixture');

test('home loads and its core entry cards open the correct practice mode', async ({ page }) => {
  await openApp(page);
  await expectOnlyView(page, 'homeView');
  await expect(page.locator('.entry-card')).toHaveCount(3);
  await expect(page.locator('[data-practice-flow="question"]')).toBeVisible();
  await page.locator('[data-practice-flow="question"]').click();
  await expectOnlyView(page, 'practiceView');
  await expect(page.locator('#questionModeButton')).toHaveClass(/active/);
  await page.locator('[data-nav="home"]').first().click();
  await page.locator('[data-practice-flow="manuscript"]').click();
  await expectOnlyView(page, 'practiceView');
  await expect(page.locator('#manuscriptModeButton')).toHaveClass(/active/);
  await expect(page.locator('#topicPanel')).toBeHidden();
});
