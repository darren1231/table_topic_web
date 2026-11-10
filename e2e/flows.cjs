const { expect } = require('./fixtures.cjs');

const answer = 'I am agree because people is kind. For example, we share books. Finally, I feel happy.';

async function prepare(page) {
  await page.clock.setFixedTime(new Date('2026-11-10T04:00:00Z'));
  await page.reload();
  await expect(page.locator('#suggestions button')).toHaveCount(5);
  await page.locator('#languageSelect').selectOption('en-US');
  await expect(page.locator('#homeView h1')).toHaveText('What would you like to practice?');
}

async function generate(page) {
  await page.locator('[data-practice-flow="question"]').click();
  await page.locator('#topicInput').fill('community gardens');
  await page.locator('#generateButton').click();
  await expect(page.locator('#practicePanel')).toBeVisible();
  await expect(page.locator('#questionText')).not.toBeEmpty();
}

async function complete(page) {
  await generate(page);
  await page.locator('#transcript').fill(answer);
  await page.locator('#analyzeButton').click();
  await expect(page.locator('#feedbackPanel')).toBeVisible();
  await expect(page.locator('#analyzeButton')).toBeEnabled();
}

async function openMenu(page, id) {
  await page.locator('#settingsButton').click();
  await page.locator(`#${id}`).click();
}

module.exports = { answer, prepare, generate, complete, openMenu };
