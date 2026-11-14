const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures.cjs');
const { prepare, openMenu } = require('./flows.cjs');
const messages = locale => JSON.parse(fs.readFileSync(path.join(__dirname, '../public/locales', `${locale}.json`), 'utf8')).messages;

test('guest feedback prompts sign-in without calling feedback RPCs', async ({ guestPage: page, sandbox }) => {
  await prepare(page); await openMenu(page, 'feedbackButton');
  await expect(page.locator('#feedbackDialog')).toBeVisible();
  await expect(page.locator('#feedbackMessage')).toHaveText(messages('en-US')['feedback.signInRequired']);
  await expect(page.locator('#feedbackSubmit')).toBeDisabled();
  expect(sandbox.calls.filter(call => call.path.includes('feedback'))).toHaveLength(0);
  await page.locator('#feedbackSignIn').click();
  await expect(page.locator('#accountDialog')).toBeVisible();
});

test('feedback sends only technical metadata, can omit context, and safely lists simplified statuses', async ({ signedInPage: page, sandbox }) => {
  sandbox.mockRpc('get_my_feedback', []); sandbox.mockRpc('submit_feedback', 42);
  await prepare(page);
  await page.evaluate(() => {
    document.getElementById('transcript').value = 'PRIVATE PRACTICE CONTENT';
    document.getElementById('rawAgentResponse').textContent = 'PRIVATE AI RESPONSE';
    localStorage.setItem('fake-private-key', 'PRIVATE KEY');
  });
  await openMenu(page, 'feedbackButton');
  await expect(page.locator('#feedbackCount')).toHaveText('0/2000');
  await expect(page.locator('#feedbackIncludeContext')).toBeChecked();
  await page.locator('#feedbackType').selectOption('suggestion');
  await page.locator('#feedbackDescription').fill('Please add a timer');
  await expect(page.locator('#feedbackCount')).toHaveText('18/2000');
  await page.locator('#feedbackSubmit').click();
  await expect(page.locator('#feedbackMessage')).toHaveText(messages('en-US')['feedback.thanks']);
  await expect(page.locator('#feedbackDescription')).toHaveValue('');
  const first = JSON.parse(sandbox.calls.find(call => call.path.endsWith('/submit_feedback')).body);
  expect(first.p_type).toBe('suggestion');
  expect(Object.keys(first.p_context).sort()).toEqual(['appVersion', 'language', 'submittedAt', 'userAgent', 'view']);
  expect(first.p_context.view).toBe('home'); expect(first.p_context.language).toBe('en-US');
  expect(first.p_context.appVersion).toBe('2.0.0');
  expect(first.p_context.userAgent).toBe(await page.evaluate(() => navigator.userAgent));
  expect(first.p_context.submittedAt).toBe('2026-11-10T04:00:00.000Z');
  expect(JSON.stringify(first.p_context)).not.toMatch(/PRIVATE|speaker@|access_token|refresh_token|transcript/);
  const payload = '<img src=x onerror=alert(1)> " onmouseover="x';
  sandbox.mockRpc('get_my_feedback', ['received', 'in_progress', 'done', 'declined'].map((public_status, i) => ({
    id: i + 1, type: 'bug', created_at: '2026-11-13T01:00:00Z', message: payload, public_status,
  })));
  await page.locator('#feedbackDescription').fill('Another report');
  await page.locator('#feedbackIncludeContext').uncheck();
  await page.locator('#feedbackSubmit').click();
  await expect(page.locator('#feedbackList article')).toHaveCount(4);
  const submissions = sandbox.calls.filter(call => call.path.endsWith('/submit_feedback'));
  expect(submissions).toHaveLength(2); expect(JSON.parse(submissions[1].body).p_context).toBeNull();
  await expect(page.locator('#feedbackList img, #feedbackList [onmouseover]')).toHaveCount(0);
  await expect(page.locator('#feedbackList p').first()).toHaveText(payload);
  for (const key of ['received', 'inProgress', 'done', 'declined']) await expect(page.locator('#feedbackList')).toContainText(messages('en-US')[`feedback.${key}`]);
});

test('feedback shows validation, daily limit and network errors without clearing the draft', async ({ signedInPage: page, sandbox }) => {
  sandbox.mockRpc('get_my_feedback', []);
  await prepare(page); await openMenu(page, 'feedbackButton');
  await page.locator('#feedbackDescription').fill(' ');
  await page.locator('#feedbackSubmit').click();
  await expect(page.locator('#feedbackMessage')).toHaveText(messages('en-US')['feedback.invalidInput']);
  expect(sandbox.calls.filter(call => call.path.endsWith('/submit_feedback'))).toHaveLength(0);
  await page.locator('#feedbackDescription').fill('Keep this report');
  for (const [code, message, key, status] of [
    ['P0001', 'feedback_daily_limit', 'dailyLimit', 400], ['22023', 'invalid_feedback_input', 'invalidInput', 400],
    ['NETWORK', 'PRIVATE RAW ERROR', 'networkError', 503], ['42501', 'Authentication required', 'signInRequired', 403],
  ]) {
    sandbox.mockRpc('submit_feedback', { code, message }, status);
    // Browser resource errors are expected for these deliberately failed RPCs.
    sandbox.allowConsoleError(/Failed to load resource/);
    await page.locator('#feedbackSubmit').click();
    await expect(page.locator('#feedbackMessage')).toHaveText(messages('en-US')[`feedback.${key}`]);
    await expect(page.locator('#feedbackDescription')).toHaveValue('Keep this report');
  }
});

test('feedback labels and guide FAQ are translated in all four languages without mobile overflow', async ({ signedInPage: page, sandbox }) => {
  sandbox.mockRpc('get_my_feedback', []);
  await prepare(page);
  for (const locale of ['zh-TW', 'en-US', 'ja-JP', 'ar']) {
    const m = messages(locale); await page.locator('#languageSelect').selectOption(locale);
    await openMenu(page, 'feedbackButton');
    await expect(page.locator('#feedbackTitle')).toHaveText(m['feedback.title']);
    await expect(page.locator('#feedbackContextLabel')).toHaveText(m['feedback.includeContext']);
    await expect(page.locator('#feedbackSubmit')).toHaveText(m['feedback.submit']);
    await expect(page.locator('#feedbackMineTitle')).toHaveText(m['feedback.mine']);
    await expect(page.locator('#feedbackDialog')).not.toContainText('feedback.');
    expect(await page.locator('#feedbackDialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.locator('#feedbackClose').click();
    await page.locator('#guideEntry').click();
    await expect(page.locator('#guide-section-12')).toContainText(m['guide.section12.question8']);
    await expect(page.locator('#guide-section-12')).toContainText(m['guide.section12.answer8']);
    await page.locator('#guideBackTop').click();
  }
});
