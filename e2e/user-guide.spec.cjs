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

test('guide changes all four languages immediately and uses the actual interface labels', async ({ guestPage: page }) => {
  await page.locator('#guideEntry').click();
  const locales = [
    ['zh-TW', '使用說明書', '這個網站能做什麼'],
    ['en-US', 'User guide', 'What this website can do'],
    ['ja-JP', '使い方ガイド', 'このサイトでできること'],
    ['ar', 'دليل الاستخدام', 'ما الذي يقدمه هذا الموقع'],
  ];
  for (const [locale, title, firstHeading] of locales) {
    await page.locator('#languageSelect').selectOption(locale);
    await expect(page.locator('#guideTitle')).toHaveText(title);
    await expect(page.locator('#guide-section-1 h2')).toHaveText(`1. ${firstHeading}`);
    await expect(page.locator('#guideEntry')).toHaveText(title);
    await expect(page.locator('#guideView')).not.toContainText('guide.');
    const label = id => page.locator(`#${id}`).innerText().then(text => text.replace('→', '').trim());
    await expect(page.locator('#guide-section-3')).toContainText(await label('generateButton'));
    await expect(page.locator('#guide-section-3')).toContainText(await label('randomTopicButton'));
    await expect(page.locator('#guide-section-10')).toContainText(await label('exportLocalButton'));
    await expect(page.locator('#guide-section-10')).toContainText(await page.locator('#backupButton strong').innerText());
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
