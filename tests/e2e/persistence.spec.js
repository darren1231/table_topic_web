const { test, expect, openApp, enterQuestionPractice, completePractice } = require('../helpers/app-fixture');

test('completed practice remains after reload', async ({ page }) => {
  await openApp(page);
  await enterQuestionPractice(page, '成長');
  await completePractice(page);
  const historyText = await page.locator('#historyList .history-item').innerText();
  await page.reload();
  await expect(page.locator('#historyList .history-item')).toHaveCount(1);
  await expect(page.locator('#historyList .history-item')).toContainText(historyText.split('\n')[1]);
});
