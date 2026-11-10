const fs = require('node:fs/promises');
const { test, expect } = require('./fixtures.cjs');
const { answer, prepare, complete, openMenu } = require('./flows.cjs');

test.beforeEach(async ({ guestPage }) => prepare(guestPage));

test('guest completes a built-in practice and receives scores and feedback', async ({ guestPage: page, sandbox }) => {
  await complete(page);
  await expect(page.locator('#overallScore')).toHaveText('72');
  await expect(page.locator('#structureScore')).toHaveText('74');
  await expect(page.locator('#coachReport .coach-summary')).not.toBeEmpty();
  await expect(page.locator('#coachReport .comparison-card')).toHaveCount(3);
  expect(sandbox.calls).toEqual([]);
});

test('history survives reload and opens the saved answer and detailed report', async ({ guestPage: page }) => {
  await complete(page);
  await expect(page.locator('#historyList .history-item')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#suggestions button')).toHaveCount(5);
  await page.locator('#historyList .history-item').click();
  await expect(page.locator('#historyDialog')).toBeVisible();
  await expect(page.locator('#historyDetailTitle')).toContainText('community gardens');
  await expect(page.locator('#historyDetailContent .report-answer')).toHaveText(answer);
  await expect(page.locator('#historyCoachReport .coach-summary')).not.toBeEmpty();
});

test('completed practice updates the streak and calendar day details', async ({ guestPage: page }) => {
  await complete(page);
  await expect(page.locator('#streakCount')).toHaveText('1');
  await page.locator('#streakButton').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  const day = page.locator('[data-date="2026-11-10"]');
  await expect(day.locator('.day-count')).toHaveText('1');
  await day.click();
  await expect(page.locator('#dayDetailContent .day-practice')).toHaveCount(1);
  await expect(page.locator('#dayDetailContent')).toContainText('community gardens');
});

test('guest adds a review card, rates it, searches and bulk archives it', async ({ guestPage: page }) => {
  await complete(page);
  await page.locator('#coachReport [data-review-index]').first().check();
  await expect(page.locator('#dueReviewCount')).toHaveText('1');
  await page.locator('#reviewNavButton').click();
  await expect(page.locator('#reviewSession .review-prompt')).not.toBeEmpty();
  await page.locator('#revealAnswerButton').click();
  await expect(page.locator('#reviewSession .review-answer')).toBeVisible();
  await page.locator('[data-rating="good"]').click();
  await expect(page.locator('#dueReviewCount')).toHaveText('0');
  await page.locator('#librarySearchInput').fill('I am agree');
  await expect(page.locator('#reviewLibrary .library-card-rich')).toHaveCount(1);
  await page.locator('#librarySelectPage').check();
  await page.locator('#bulkArchiveButton').click();
  await expect(page.locator('#reviewLibrary .library-card-rich')).toHaveCount(0);
  await page.locator('#libraryStatusFilter').selectOption('archived');
  await expect(page.locator('#reviewLibrary .status-archived')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#suggestions button')).toHaveCount(5);
  await page.locator('#libraryStatusFilter').selectOption('archived');
  await expect(page.locator('#reviewLibrary .status-archived')).toHaveCount(1);
});

test('all four languages update the main heading and practice button', async ({ guestPage: page }) => {
  const locales = [
    ['zh-TW', '今天想練什麼？', '產生題目'],
    ['en-US', 'What would you like to practice?', 'Question generation'],
    ['ja-JP', '今日は何を練習しますか？', '質問の生成'],
    ['ar', 'ماذا تود أن تتدرّب؟', 'إنشاء الأسئلة'],
  ];
  for (const [locale, heading, button] of locales) {
    await page.locator('#languageSelect').selectOption(locale);
    await expect(page.locator('#homeView h1')).toHaveText(heading);
    await expect(page.locator('#generateButton')).toContainText(button);
  }
  // KNOWN ISSUE: main site does not set RTL direction for Arabic; do not change public/ here.
  test.info().annotations.push({ type: 'KNOWN ISSUE', description: 'Arabic main site has no RTL layout.' });
});

test('downloaded JSON backup restores practice and review cards after clearing storage', async ({ guestPage: page }) => {
  await complete(page);
  await page.locator('#coachReport [data-review-index]').first().check();
  await openMenu(page, 'backupButton');
  // Exercise the browser download fallback instead of an OS-native save picker.
  await page.evaluate(() => { delete window.showSaveFilePicker; });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportLocalButton').click();
  const download = await downloadPromise;
  const path = await download.path();
  const backup = JSON.parse(await fs.readFile(path, 'utf8'));
  expect(download.suggestedFilename()).toBe('table-topics-backup-2026-11-10.json');
  expect(backup.format).toBe('table-topics-practice-backup');
  expect(backup.data.practice.history).toHaveLength(1);
  expect(backup.data.practice.reviewCards).toHaveLength(1);
  expect(backup.data.practice.history[0].answer).toBe(answer);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#suggestions button')).toHaveCount(5);
  await expect(page.locator('#dueReviewCount')).toHaveText('0');
  await openMenu(page, 'backupButton');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#importBackupInput').setInputFiles(path);
  await expect(page.locator('#backupDialog')).not.toBeVisible();
  await expect(page.locator('#dueReviewCount')).toHaveText('1');
  await expect(page.locator('#historyList .history-item')).toHaveCount(1);
  await page.locator('#historyList .history-item').click();
  await expect(page.locator('#historyDetailContent .report-answer')).toHaveText(answer);
});
