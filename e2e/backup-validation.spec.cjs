const { test, expect } = require('./fixtures.cjs');
const { prepare, openMenu } = require('./flows.cjs');

test.beforeEach(async ({ guestPage }) => prepare(guestPage));

function backup() {
  return { format: 'table-topics-practice-backup', data: {
    practice: { history: [{ date: '2026-11-09', topic: 'Legacy', question: 'Why?', answer: 'A legacy answer.' }] },
    aiSettings: { projects: [{ id: 'builtin', provider: 'builtin', apiKey: '' }] }, language: 'en-US',
  } };
}

async function upload(page, value) {
  await page.locator('#importBackupInput').setInputFiles({
    name: 'practice.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
  });
}

test('invalid nested backups leave local data and the open page unchanged without a confirmation', async ({ guestPage: page, sandbox }) => {
  await openMenu(page, 'backupButton');
  const previous = await page.evaluate(() => ({ ...localStorage }));
  let confirmations = 0;
  page.on('dialog', async dialog => { confirmations++; await dialog.dismiss(); });
  const requestsBefore = sandbox.calls.length;
  const malformed = [backup(), backup(), backup()];
  malformed[0].data.practice.history = [null];
  malformed[1].data.aiSettings.projects = [];
  malformed[2].data.practice.scripts = [{ id: 's', paragraphs: [null] }];
  for (const value of malformed) {
    await upload(page, value);
    await expect(page.locator('#toast')).toHaveText('Import failed: This is not a valid Table Topics backup file');
    expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(previous);
    await expect(page.locator('#backupDialog')).toBeVisible();
    await expect(page.locator('#importBackupInput')).toHaveValue('');
  }
  expect(confirmations).toBe(0);
  expect(sandbox.calls).toHaveLength(requestsBefore);
});

test('legacy backup restores and reexports translation metadata and manuscript defaults', async ({ guestPage: page }) => {
  const value = backup();
  const card = { id: 'translation-one', sourceType: 'translation', language: 'ja-JP', before: '明天見', after: 'また明日',
    translationStyle: 'conversational', translationNote: '用於朋友間道別。', explanationLanguage: 'zh-TW',
    dueAt: '2026-11-09T00:00:00Z', tags: [], repetitions: 0, intervalDays: 0, easeFactor: 2.3, lapses: 0 };
  value.data.practice.reviewCards = [card];
  value.data.practice.scripts = [{ id: 's', title: 'Legacy manuscript', paragraphs: [{ id: 'p', text: 'Draft' }] }];
  await openMenu(page, 'backupButton');
  page.once('dialog', dialog => dialog.accept());
  await upload(page, value);
  await expect(page.locator('#backupDialog')).not.toBeVisible();
  await expect(page.locator('#dueReviewCount')).toHaveText('1');
  await expect(page.locator('#historyList .history-item')).toHaveCount(1);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('tableTopicsPractice.v1')));
  expect(restored.reviewCards[0]).toMatchObject(card);
  expect(restored.scripts[0].paragraphs[0]).toMatchObject({ text: 'Draft', versions: [], analyses: [] });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tableTopicsAIProjects.v1')).activeId)).toBe('builtin');
  await openMenu(page, 'backupButton');
  await page.evaluate(() => { delete window.showSaveFilePicker; });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportLocalButton').click();
  const download = await downloadPromise;
  const exported = JSON.parse(await require('node:fs/promises').readFile(await download.path(), 'utf8'));
  expect(exported.data.practice.reviewCards[0]).toMatchObject(card);
  expect(exported.data.practice.history[0].id).toBe('legacy_2026-11-09_0');
});
