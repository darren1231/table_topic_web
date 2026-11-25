const fs = require('node:fs/promises');
const { test, expect } = require('./fixtures.cjs');

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
