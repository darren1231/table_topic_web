const fs = require('node:fs/promises');
const { test, expect, session } = require('./fixtures.cjs');

test('cloud startup restores valid remote data after corrupt local data without uploading an empty history', async ({ page, context, sandbox }) => {
  const remote = { history: [{ id: 'cloud-history', date: '2026-11-10', topic: 'Cloud', question: 'Why?', answer: 'Preserved remotely.' }] };
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let reads = 0;
  sandbox.handleUserData(async request => {
    if (request.method() === 'GET') {
      reads++;
      if (reads === 1) await held;
      return { body: { payload: remote, updated_at: '2026-11-10T04:00:00Z' } };
    }
    return { body: {} };
  });
  await context.addInitScript(value => {
    if (!localStorage.getItem('cloud-recovery-seeded')) {
      localStorage.setItem('tableTopicsPractice.v1', '{broken');
      localStorage.setItem('tableTopicsStorageMode', 'cloud');
      localStorage.setItem('sb-e2e-auth-token', JSON.stringify(value));
      localStorage.setItem('cloud-recovery-seeded', '1');
    }
  }, session);
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('#suggestions button')).toHaveCount(5);
  await expect.poll(() => reads).toBeGreaterThan(0);
  await page.clock.runFor(1200);
  expect(sandbox.calls.filter(call => call.path === '/rest/v1/user_data' && call.body)).toHaveLength(0);
  release();
  await expect(page.locator('#historyList .history-item')).toHaveCount(1);
  await page.evaluate(() => window.tableTopicsCloud.ready);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('tableTopicsPractice.v1')));
  expect(restored.history[0]).toMatchObject(remote.history[0]);
  for (const call of sandbox.calls.filter(call => call.path === '/rest/v1/user_data' && call.body)) {
    expect(JSON.parse(call.body).payload.history.length).toBeGreaterThan(0);
  }
});

for (const [name, entries] of [
  ['broken JSON', { 'tableTopicsPractice.v1': '{broken', 'tableTopicsAIProjects.v1': '{bad', 'tableTopicsSpeechSettings.v1': '{oops' }],
  ['invalid types', { 'tableTopicsPractice.v1': '{"history":[null]}', 'tableTopicsAIProjects.v1': '[]', 'tableTopicsSpeechSettings.v1': 'false' }],
]) {
  test(`startup recovers ${name} and exports the exact originals once`, async ({ page, context }) => {
    await context.addInitScript(values => {
      if (!localStorage.getItem('recovery-test-seeded')) {
        for (const [key, raw] of Object.entries(values)) localStorage.setItem(key, raw);
        localStorage.setItem('tableTopicsLanguage.v1', 'en-US');
        localStorage.setItem('recovery-test-seeded', '1');
      }
    }, entries);
    await page.goto('/');
    await expect(page.locator('#suggestions button')).toHaveCount(5);
    await expect(page.locator('#dataRecoveryNotice')).toBeVisible();
    await expect(page.locator('#dataRecoveryMessage')).toContainText('originals were preserved');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#exportRecoveryButton').click();
    const exported = JSON.parse(await fs.readFile(await (await downloadPromise).path(), 'utf8'));
    for (const [key, raw] of Object.entries(entries)) {
      expect(exported.entries.find(entry => entry.key.startsWith(`${key}.corrupt.`)).raw).toBe(raw);
    }
    await page.reload();
    await expect(page.locator('#suggestions button')).toHaveCount(5);
    await expect(page.locator('#dataRecoveryNotice')).not.toBeVisible();
  });
}

test('valid legacy startup preserves history and never shows a recovery warning', async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('tableTopicsPractice.v1', JSON.stringify({ history: [{ date: '2026-11-10', topic: 'Legacy', answer: 'Kept' }] }));
  });
  await page.goto('/');
  await expect(page.locator('#suggestions button')).toHaveCount(5);
  await expect(page.locator('#dataRecoveryNotice')).not.toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tableTopicsPractice.v1')).history[0].answer)).toBe('Kept');
});
