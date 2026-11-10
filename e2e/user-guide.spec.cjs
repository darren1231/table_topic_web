const { test, expect } = require('./fixtures.cjs');

test('home guide entry is above the heading and contents scroll to the chosen section', async ({ guestPage: page }) => {
  const entry = page.locator('#guideEntry'), heading = page.locator('#homeView h1');
  await expect(entry).toHaveText('使用說明書');
  const buttonBox = await entry.boundingBox(), headingBox = await heading.boundingBox();
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(headingBox.y);
  await entry.click();
  await expect(page).toHaveURL(/#guide$/);
  await expect(page.locator('#guideView')).toBeVisible();
  await expect(page.locator('#guideTitle')).toHaveText('使用說明書');
  await expect(page.locator('#guideSections > section')).toHaveCount(12);
  await expect(page.locator('#guideToc button')).toHaveCount(12);
  await page.locator('#guideToc button').last().click();
  await expect(page.locator('#guide-section-12')).toBeInViewport();
  await expect(page).toHaveURL(/#guide$/);
  await expect(page.locator('#guideView')).not.toContainText('guide.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('shared guide hash opens directly and both home buttons and practice action work', async ({ guestPage: page }) => {
  // A shared URL starts a fresh document, rather than a same-document hash change.
  await page.goto('about:blank');
  await page.goto('/#guide');
  await expect(page.locator('#guideView')).toBeVisible();
  await page.locator('#guideBackTop').click();
  await expect(page.locator('#homeView')).toBeVisible();
  await page.locator('#guideEntry').click();
  await page.locator('#guideBackBottom').click();
  await expect(page.locator('#homeView')).toBeVisible();
  await page.locator('#guideEntry').click();
  await page.locator('#guideStart').click();
  await expect(page.locator('#practiceView')).toBeVisible();
  await expect(page.locator('#questionModeButton')).toHaveClass(/active/);
  await expect(page.locator('#topicInput')).toBeVisible();
});
