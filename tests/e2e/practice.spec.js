const { test, expect, openApp, enterQuestionPractice, completePractice } = require('../helpers/app-fixture');

test.beforeEach(async ({ page }) => openApp(page));

test('built-in coach completes the protected impromptu answer flow', async ({ page }) => {
  await enterQuestionPractice(page);
  await completePractice(page);
  const score = Number(await page.locator('#overallScore').textContent());
  expect(Number.isFinite(score)).toBe(true);
  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(100);
});

test('try again resets the answer and next question resets prior state', async ({ page }) => {
  await enterQuestionPractice(page);
  const firstQuestion = await page.locator('#questionText').textContent();
  await completePractice(page);
  await page.locator('#retryButton').click();
  await expect(page.locator('#feedbackPanel')).toBeHidden();
  await expect(page.locator('#transcript')).toHaveValue('');
  await expect(page.locator('#questionText')).toHaveText(firstQuestion);

  await page.locator('#transcript').fill('第二次回答也有超過十五個字，因為我想確認下一題可以完全重設狀態。');
  await page.locator('#analyzeButton').click();
  await expect(page.locator('#feedbackPanel')).toBeVisible();
  await page.locator('#nextButton').click();
  await expect(page.locator('#questionText')).not.toHaveText(firstQuestion);
  await expect(page.locator('#transcript')).toHaveValue('');
  await expect(page.locator('#feedbackPanel')).toBeHidden();
  await expect(page.locator('#timer')).toHaveText('00:00');
  await expect(page.locator('#pauseRecordButton')).toBeDisabled();
});

test('question and free-manuscript drafts remain isolated', async ({ page }) => {
  await enterQuestionPractice(page);
  const question = await page.locator('#questionText').textContent();
  await page.locator('#transcript').fill('這是即興模式獨立保存的回答草稿內容。');
  await page.locator('#manuscriptModeButton').click();
  await expect(page.locator('#practicePanel .section-heading h2')).toHaveText('開始自由講稿');
  await expect(page.locator('#analyzeButton')).toHaveText('分析我的講稿 ✦');
  await expect(page.locator('#topicPanel')).toBeHidden();
  await expect(page.locator('#transcript')).toHaveValue('');
  await page.locator('#transcript').fill('這是自由講稿模式自己的草稿。');
  await page.locator('#questionModeButton').click();
  await expect(page.locator('#practicePanel .section-heading h2')).toHaveText('開始即興回答');
  await expect(page.locator('#transcript')).toHaveValue('這是即興模式獨立保存的回答草稿內容。');
  await expect(page.locator('#questionText')).toHaveText(question);
  await page.locator('#manuscriptModeButton').click();
  await expect(page.locator('#transcript')).toHaveValue('這是自由講稿模式自己的草稿。');
});

test('language switching updates key controls without changing mode or draft', async ({ page }) => {
  await enterQuestionPractice(page);
  await page.locator('#transcript').fill('這份草稿在語言切換之後必須繼續保留。');
  await page.locator('#languageSelect').selectOption('en-US');
  await expect(page.locator('[data-practice-flow="question"] strong')).toHaveText('Impromptu Q&A');
  await expect(page.locator('#practicePanel .section-heading h2')).toHaveText('Start your impromptu answer');
  await expect(page.locator('#analyzeButton')).toHaveText('Analyze my answer ✦');
  await expect(page.locator('#questionModeButton')).toHaveClass(/active/);
  await expect(page.locator('#transcript')).toHaveValue('這份草稿在語言切換之後必須繼續保留。');
  await page.locator('#languageSelect').selectOption('zh-TW');
  await expect(page.locator('#transcript')).toHaveValue('這份草稿在語言切換之後必須繼續保留。');
});
