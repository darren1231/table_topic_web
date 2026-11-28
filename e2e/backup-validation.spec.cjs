const { test, expect, session } = require('./fixtures.cjs');
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

test('importing an English backup from Chinese immediately applies the whole language workflow', async ({ guestPage: page }) => {
  await page.locator('#languageSelect').selectOption('zh-TW');
  await expect(page.locator('#todayLabel')).toContainText('11月');
  await openMenu(page, 'backupButton');
  page.once('dialog', dialog => dialog.accept());
  await upload(page, backup());
  await expect(page.locator('#backupDialog')).not.toBeVisible();
  await expect(page.locator('#homeView h1')).toHaveText('What would you like to practice?');
  await expect(page.locator('#languageSelect')).toHaveValue('en-US');
  await expect(page.locator('#todayLabel')).toContainText('November');
  await expect(page.locator('#suggestions button').first()).toHaveText('travel');
  await expect(page.locator('#importCommitStatus')).toHaveText('Imported locally.');
});

for (const key of ['tableTopicsPractice.v1', 'tableTopicsAIProjects.v1', 'tableTopicsLanguage.v1']) {
  test(`failed local write ${key} preserves all keys and the running memory`, async ({ guestPage: page }) => {
    await openMenu(page, 'backupButton');
    const previous = await page.evaluate(() => ({ ...localStorage }));
    await page.evaluate(target => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === target) { Storage.prototype.setItem = original; throw new DOMException('Fixture quota', 'QuotaExceededError'); }
        return original.call(this, key, value);
      };
    }, key);
    page.once('dialog', dialog => dialog.accept());
    await upload(page, backup());
    await expect(page.locator('#toast')).toContainText('Original data restored; memory unchanged.');
    expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(previous);
    await expect(page.locator('#backupDialog')).toBeVisible();
    await page.evaluate(() => persist());
    expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(previous);
  });
}

for (const failure of ['rejection', 'timeout']) {
  test(`cloud ${failure} keeps the local commit visible and allows retry without stale uploads`, async ({ guestPage: page, sandbox }) => {
    let failing = true, release;
    const remote = await page.evaluate(() => JSON.parse(localStorage.getItem('tableTopicsPractice.v1')));
    const held = new Promise(resolve => { release = resolve; });
    sandbox.allowConsoleError(/403|Forbidden/);
    sandbox.handleUserData(async request => {
      if (request.method() === 'GET') return { body: { payload: remote, updated_at: '2026-11-10T04:00:00Z' } };
      if (failing && failure === 'timeout') await held;
      return failing && failure === 'rejection' ? { body: { message: 'denied' }, status: 403 } : { body: {} };
    });
    await page.evaluate(value => {
      localStorage.setItem('sb-e2e-auth-token', JSON.stringify(value));
      localStorage.setItem('tableTopicsStorageMode', 'cloud');
    }, session);
    // A matching remote row avoids holding a separate startup upload in this timeout test.
    failing = false;
    await page.reload();
    await page.evaluate(() => window.tableTopicsCloud.ready);
    failing = true;
    await page.clock.install();
    await openMenu(page, 'backupButton');
    const before = sandbox.calls.length;
    const writes = () => sandbox.calls.slice(before).filter(call => call.path === '/rest/v1/user_data' && call.body);
    page.once('dialog', dialog => dialog.accept());
    await upload(page, backup());
    await expect(page.locator('#backupDialog')).not.toBeVisible();
    await expect(page.locator('#historyList .history-item')).toHaveCount(1);
    await expect.poll(() => writes().length).toBeGreaterThan(0);
    if (failure === 'timeout') await page.clock.runFor(16000);
    await expect(page.locator('#importCommitStatus')).toContainText('Imported locally; cloud sync is pending.');
    await expect(page.locator('#retryImportSyncButton')).toBeEnabled();
    await page.evaluate(() => persist());
    await page.clock.runFor(1000);
    expect(writes().length).toBeGreaterThan(0);
    for (const call of writes()) expect(JSON.parse(call.body).payload.history[0].topic).toBe('Legacy');
    failing = false; release();
    await page.locator('#retryImportSyncButton').click();
    await page.clock.runFor(100);
    await expect(page.locator('#importCommitStatus')).toHaveText('Imported locally and synced to the cloud.');
    await expect(page.locator('#retryImportSyncButton')).not.toBeVisible();
    for (const call of writes()) expect(JSON.parse(call.body).payload.history[0].topic).toBe('Legacy');
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
    await expect(page.locator('#toast')).toContainText('Import failed:');
    await expect(page.locator('#toast')).toContainText('Invalid');
    expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(previous);
    await expect(page.locator('#backupDialog')).toBeVisible();
    await expect(page.locator('#importBackupInput')).toHaveValue('');
  }
  expect(confirmations).toBe(0);
  expect(sandbox.calls).toHaveLength(requestsBefore);
});

test('legacy backup restores and reexports translation metadata and manuscript defaults', async ({ guestPage: page }) => {
  const value = backup();
  value.data.practice.history[0].metrics = require('../test/fixtures/legacy-coach-results.json')[0].metrics;
  value.data.practice.history[0].score = '72';
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
  expect(exported.data.practice.history[0].metrics.improvements[0].detail).toBe('Open with a clear position');
  expect(exported.data.practice.history[0].score).toBe(72);
});

test('invalid third review card reports its exact category and position without writing', async ({ guestPage: page }) => {
  const value = backup();
  value.data.practice.reviewCards = [
    { id: 'one', language: 'en-US', before: 'a', after: 'b', dueAt: '2026-11-10T00:00:00Z' },
    { id: 'two', language: 'en-US', before: 'a', after: 'b', dueAt: '2026-11-10T00:00:00Z' }, null,
  ];
  await openMenu(page, 'backupButton');
  const original = await page.evaluate(() => localStorage.getItem('tableTopicsPractice.v1'));
  await upload(page, value);
  await expect(page.locator('#toast')).toHaveText('Import failed: Invalid Review cards item 3.');
  expect(await page.evaluate(() => localStorage.getItem('tableTopicsPractice.v1'))).toBe(original);
});
