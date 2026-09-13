const { test, expect, openApp, expectOnlyView } = require('../helpers/app-fixture');

test.beforeEach(async ({ page }) => openApp(page));

test('navigation visits practice, calendar, review, trends, then home with one active destination', async ({ page }) => {
  await page.locator('[data-practice-flow="question"]').click();
  await expectOnlyView(page, 'practiceView');
  await page.locator('#streakButton').click();
  await expectOnlyView(page, 'calendarView');
  await page.locator('#reviewNavButton').click();
  await expectOnlyView(page, 'reviewView');
  await page.locator('#settingsButton').click();
  await page.locator('#scoreTrendsButton').click();
  await expectOnlyView(page, 'trendsView');
  await page.locator('[data-nav="home"]').first().click();
  await expectOnlyView(page, 'homeView');
  await expect(page.locator('.mobile-nav [data-nav].active')).toHaveCount(1);
  await expect(page.locator('.mobile-nav [data-nav="home"]')).toHaveClass(/active/);
});

test('settings menu and dialogs do not overlap', async ({ page }) => {
  const menu = page.locator('#settingsMenu');
  await page.locator('#settingsButton').click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  for (const [button, dialog] of [['#backupButton', '#backupDialog'], ['#accountButton', '#accountDialog'], ['#apiUsageButton', '#apiUsageDialog']]) {
    await page.locator('#settingsButton').click();
    await page.locator(button).click();
    await expect(menu).toBeHidden();
    await expect(page.locator(dialog)).toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator(dialog)).toBeHidden();
  }
});
