const { test, expect } = require('./fixtures.cjs');
const { answer, prepare, complete } = require('./flows.cjs');

test.beforeEach(async ({ guestPage }) => prepare(guestPage));

async function sixCards(page) {
  await complete(page);
  await page.locator('#nextButton').click();
  await page.locator('#transcript').fill(answer);
  await page.locator('#analyzeButton').click();
  await expect(page.locator('#historyList .history-item')).toHaveCount(2);
}

async function rateFirst(page) {
  await page.locator('#revealAnswerButton').click();
  await page.locator('[data-rating="good"]').click();
}

test('analysis queues all cards, defaults to checked and respects deselection and restoration', async ({ guestPage: page }) => {
  await complete(page);
  await expect(page.locator('#coachReport [data-review-index]:checked')).toHaveCount(3);
  await expect(page.locator('#dueReviewCount')).toHaveText('3');
  await page.locator('#coachReport [data-review-index]').first().uncheck();
  await expect(page.locator('#dueReviewCount')).toHaveText('2');
  await page.locator('#coachReport [data-review-index]').first().check();
  await expect(page.locator('#dueReviewCount')).toHaveText('3');
  await page.locator('#reviewNavButton').click();
  await expect(page.locator('#reviewCountNew')).toHaveText('3');
  await expect(page.locator('#reviewCountDue')).toHaveText('0');
  await expect(page.locator('#reviewCountQueued')).toHaveText('3');
  await page.locator('#revealAnswerButton').click();
  await expect(page.locator('#reviewCountQueued')).toHaveText('3');
  await page.locator('[data-rating="good"]').click();
  await expect(page.locator('#reviewCountQueued')).toHaveText('2');
});

test('daily limit persists, first ratings consume two slots and next day exposes only two more', async ({ guestPage: page }) => {
  await sixCards(page);
  await page.locator('#reviewNavButton').click();
  await page.locator('#newCardsPerDay').fill('2');
  await page.locator('#newCardsPerDay').press('Tab');
  await page.reload();
  await expect(page.locator('#newCardsPerDay')).toHaveValue('2');
  await expect(page.locator('#reviewCountNew')).toHaveText('2');
  await rateFirst(page); await rateFirst(page);
  await expect(page.locator('#reviewCountNew')).toHaveText('0');
  await expect(page.locator('#reviewCountQueued')).toHaveText('4');
  await expect(page.locator('#dueReviewCount')).toHaveText('0');
  await page.clock.setFixedTime(new Date('2026-11-11T04:00:00Z'));
  await page.locator('#reviewNavButton').click();
  await expect(page.locator('#reviewCountNew')).toHaveText('2');
  await expect(page.locator('#reviewCountDue')).toHaveText('2');
  await expect(page.locator('#dueReviewCount')).toHaveText('4');
  await expect(page.locator('#homeDueReviewCount')).toHaveText('4');
});

test('five days without reviewing keep the same queue front and do not accumulate new slots', async ({ guestPage: page }) => {
  await sixCards(page);
  await page.locator('#reviewNavButton').click();
  await page.locator('#newCardsPerDay').fill('2');
  await page.locator('#newCardsPerDay').press('Tab');
  const first = await page.locator('#reviewSession .review-prompt').innerText();
  await page.clock.setFixedTime(new Date('2026-11-15T04:00:00Z'));
  await page.reload();
  await expect(page.locator('#reviewSession .review-prompt')).toHaveText(first);
  await expect(page.locator('#reviewCountNew')).toHaveText('2');
  await expect(page.locator('#reviewCountDue')).toHaveText('0');
  await expect(page.locator('#reviewCountQueued')).toHaveText('6');
  await expect(page.locator('#dueReviewCount')).toHaveText('2');
});

test('language counts distinguish selected and all languages while badges remain global', async ({ guestPage: page }) => {
  await complete(page);
  await page.locator('#reviewNavButton').click();
  await page.locator('#reviewLanguageFilter [data-language="zh-TW"]').click();
  await expect(page.locator('#reviewCountNew')).toHaveText('0');
  await expect(page.locator('#reviewAllCounts')).toContainText('3');
  await expect(page.locator('#reviewCurrentCounts')).toContainText('0');
  await expect(page.locator('#dueReviewCount')).toHaveText('3');
  await expect(page.locator('#homeDueReviewCount')).toHaveText('3');
  await page.locator('#reviewLanguageFilter [data-language="en-US"]').click();
  await expect(page.locator('#reviewCountNew')).toHaveText('3');
});

test('bulk scheduling removes a new card from the queue without consuming a daily slot', async ({ guestPage: page }) => {
  await sixCards(page);
  await page.locator('#reviewNavButton').click();
  await page.locator('#newCardsPerDay').fill('2');
  await page.locator('#newCardsPerDay').press('Tab');
  await page.locator('[data-library-select]').first().check();
  await page.locator('#bulkDueDateInput').fill('2026-11-12');
  await page.locator('#bulkDueButton').click();
  await expect(page.locator('#reviewCountQueued')).toHaveText('5');
  await expect(page.locator('#reviewCountNew')).toHaveText('2');
  await page.clock.setFixedTime(new Date('2026-11-12T04:00:00Z'));
  await page.reload();
  await expect(page.locator('#reviewCountDue')).toHaveText('1');
  await expect(page.locator('#reviewCountNew')).toHaveText('2');
  await page.locator('#newCardsPerDay').fill('0');
  await page.locator('#newCardsPerDay').press('Tab');
  await expect(page.locator('#reviewCountNew')).toHaveText('0');
  await expect(page.locator('#reviewCountDue')).toHaveText('1');
  await expect(page.locator('#dueReviewCount')).toHaveText('1');
});

test('individual library archive keeps the badges and queue counts synchronized', async ({ guestPage: page }) => {
  await complete(page);
  await page.locator('#reviewNavButton').click();
  await page.locator('[data-library-toggle-status]').first().click();
  await expect(page.locator('#reviewCountNew')).toHaveText('2');
  await expect(page.locator('#dueReviewCount')).toHaveText('2');
  await expect(page.locator('#homeDueReviewCount')).toHaveText('2');
});
