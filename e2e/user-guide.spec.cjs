const { test, expect } = require('./fixtures.cjs');

test('home guide entry is above the heading and contents scroll to the chosen section', async ({ guestPage: page }) => {
  const entry = page.locator('#guideEntry'), heading = page.locator('#homeView h1');
  await expect(entry.locator('#guideEntryTitle')).toHaveText('使用說明書');
  await expect(entry.locator('#guideEntryHint')).toHaveText('第一次使用？3 分鐘看懂怎麼練習');
  await expect(entry).toHaveAttribute('aria-label', '使用說明書');
  const buttonBox = await entry.boundingBox(), headingBox = await heading.boundingBox();
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(headingBox.y);
  const practiceBox = await page.locator('.entry-grid .entry-card').first().boundingBox();
  expect(Math.abs(buttonBox.width - practiceBox.width)).toBeLessThanOrEqual(1);
  await expect(entry.locator('[aria-hidden="true"]')).toHaveCount(2);
  await entry.click();
  await expect(page).toHaveURL(/#guide$/);
  await expect(page.locator('#guideView')).toBeVisible();
  await expect(page.locator('#guideTitle')).toHaveText('使用說明書');
  await expect(page.locator('#guideSections > section')).toHaveCount(13);
  await expect(page.locator('#guideToc button')).toHaveCount(13);
  await page.locator('#guideToc button').last().click();
  await expect(page.locator('#guide-section-13')).toBeInViewport();
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

test('guide changes all four languages immediately and uses the actual interface labels', async ({ guestPage: page }, testInfo) => {
  await page.locator('#guideEntry').click();
  const locales = [
    ['zh-TW', '使用說明書', '這個網站能做什麼', '第一次使用？3 分鐘看懂怎麼練習'],
    ['en-US', 'User guide', 'What this website can do', 'New here? Learn to practice in 3 minutes'],
    ['ja-JP', '使い方ガイド', 'このサイトでできること', '初めての方へ：3分でわかる練習の始め方'],
    ['ar', 'دليل الاستخدام', 'ما الذي يقدمه هذا الموقع', 'أول زيارة؟ تعلّم كيف تتدرّب في 3 دقائق'],
  ];
  for (const [locale, title, firstHeading, hint] of locales) {
    await page.locator('#languageSelect').selectOption(locale);
    await expect(page.locator('#guideTitle')).toHaveText(title);
    await expect(page.locator('#guide-section-1 h2')).toHaveText(`1. ${firstHeading}`);
    await expect(page.locator('#guideEntryTitle')).toHaveText(title);
    await expect(page.locator('#guideEntryHint')).toHaveText(hint);
    await expect(page.locator('#guideEntry')).toHaveAttribute('aria-label', title);
    await expect(page.locator('#guideView')).not.toContainText('guide.');
    const label = id => page.locator(`#${id}`).innerText().then(text => text.replace('→', '').trim());
    await expect(page.locator('#guide-section-3')).toContainText(await label('generateButton'));
    await expect(page.locator('#guide-section-3')).toContainText(await label('randomTopicButton'));
    await expect(page.locator('#guide-section-10')).toContainText(await label('exportLocalButton'));
    await expect(page.locator('#guide-section-10')).toContainText(await page.locator('#backupButton strong').innerText());
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#guideBackTop').click();
    const entry = page.locator('#guideEntry');
    await expect(entry).toBeVisible();
    await expect(entry.locator('#guideEntryHint')).toBeVisible();
    if (testInfo.project.name === 'webkit-iphone') {
      const box = await entry.boundingBox(), viewport = page.viewportSize();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await entry.click();
    await expect(page.locator('#guideView')).toBeVisible();
  }
});

test('guide entry is a keyboard-operable button', async ({ guestPage: page }) => {
  const entry = page.locator('#guideEntry');
  await expect(entry).toHaveJSProperty('tagName', 'BUTTON');
  await entry.focus();
  await expect(entry).toBeFocused();
  await entry.press('Enter');
  await expect(page.locator('#guideView')).toBeVisible();
  await page.locator('#guideBackTop').click();
  await entry.focus();
  await entry.press('Space');
  await expect(page.locator('#guideView')).toBeVisible();
});
