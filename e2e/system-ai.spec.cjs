const { test, expect } = require('./fixtures.cjs');
const { answer, prepare, generate, openMenu } = require('./flows.cjs');

const questions = ['How do community gardens bring people together?', 'What did you learn from sharing books?', 'How would you improve your community?'];
const report = {
  overall: 85, structure: 86, detail: 84, fluency: 85,
  strength: 'A concrete example supports your point.', improve: 'Make the closing more specific.',
  summary: 'Your garden example gives the audience a clear picture.', rewritten: 'Our garden connects neighbors through shared work and books.',
  comparisons: [{ label: 'Opening', before: 'I am agree', after: 'I agree' }],
  improvements: [{ title: 'Clear closing', detail: 'End with one practical next step.' }],
};

function result(text, spent, cost = 0.1) {
  return { text: JSON.stringify(text), usage: { inputTokens: 100, outputTokens: 50 }, cost,
    balance: { spent, credit: 1, balance: 1 - spent, exhausted: false } };
}

test('signed-in speaker uses system AI and sees server costs and updated credit', async ({ signedInPage: page, sandbox }) => {
  await prepare(page);
  await openMenu(page, 'apiUsageButton');
  await expect(page.locator('#systemAiBalance')).toHaveText('Used $0.0000 / Credit $1.0000');
  await page.locator('#closeApiUsageButton').click();
  sandbox.handleApi('respond', request => ({ status: 200,
    body: JSON.parse(request.postData()).kind === 'questions' ? result(questions, 0.1) : result(report, 0.3, 0.2) }));
  await generate(page);
  await expect(page.locator('#questionText')).toHaveText(questions[0]);
  await page.locator('#transcript').fill(answer);
  await page.locator('#analyzeButton').click();
  await expect(page.locator('#overallScore')).toHaveText('85');
  await expect(page.locator('#coachReport .coach-summary')).toHaveText(report.summary);
  sandbox.mockApi('balance', { spent: 0.3, credit: 1, balance: 0.7, exhausted: false });
  await openMenu(page, 'apiUsageButton');
  await expect(page.locator('#systemAiBalance')).toHaveText('Used $0.3000 / Credit $1.0000');
  await expect(page.locator('#apiUsageCalls')).toHaveText('2');
  await expect(page.locator('#apiUsageTotalCost')).toHaveText('US$0.300000');
  await expect(page.locator('#apiUsageList tr')).toHaveCount(2);
  await expect(page.locator('#apiUsageList')).toContainText('100 tokens');
});

test('402 shows exhausted credit and falls back to built-in feedback', async ({ signedInPage: page, sandbox }) => {
  await prepare(page);
  sandbox.mockApi('respond', result(questions, 0.1));
  await generate(page);
  sandbox.mockApi('respond', { error: 'credit_exhausted' }, 402);
  // Expected HTTP error from the intentionally rejected mock API response.
  sandbox.allowConsoleError(/^(?:Failed to load resource:.*402|Failed to load resource:.*Payment Required)/);
  await page.locator('#transcript').fill(answer);
  await page.locator('#analyzeButton').click();
  await expect(page.locator('#systemAiNoticeText')).toContainText('AI credit is exhausted');
  await expect(page.locator('#feedbackPanel')).toBeVisible();
  await expect(page.locator('#overallScore')).toHaveText('72');
  await expect(page.locator('#historyList .history-item')).toHaveCount(1);
  const before = sandbox.calls.filter(call => call.path === '/api/ai/respond').length;
  await page.locator('#retryButton').click();
  await page.locator('#transcript').fill(answer);
  await page.locator('#analyzeButton').click();
  await expect(page.locator('#feedbackPanel')).toBeVisible();
  expect(sandbox.calls.filter(call => call.path === '/api/ai/respond')).toHaveLength(before);
});

test('401 asks the speaker to sign in again without saving a successful analysis', async ({ signedInPage: page, sandbox }) => {
  await prepare(page);
  sandbox.mockApi('respond', result(questions, 0.1));
  await generate(page);
  sandbox.mockApi('respond', { error: 'unauthorized' }, 401);
  // Expected HTTP error from the intentionally expired-session mock.
  sandbox.allowConsoleError(/^Failed to load resource:.*(?:401|Unauthorized)/);
  await page.locator('#transcript').fill(answer);
  await page.locator('#analyzeButton').click();
  await expect(page.locator('#toast')).toContainText('Your session expired');
  await expect(page.locator('#systemAiSigninButton')).toBeVisible();
  await expect(page.locator('#analyzeButton')).toBeEnabled();
  await expect(page.locator('#feedbackPanel')).not.toBeVisible();
  await expect(page.locator('#historyList .history-item')).toHaveCount(0);
  await page.locator('#systemAiSigninButton').click();
  await expect(page.locator('#accountDialog')).toBeVisible();
});
