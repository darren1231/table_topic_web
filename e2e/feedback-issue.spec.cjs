const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures.cjs');
const { DISCLAIMER } = require('../public/feedback-issue-draft.js');
const messages = locale => JSON.parse(fs.readFileSync(path.join(__dirname, '../public/locales', `${locale}.json`), 'utf8')).messages;
const report = { id: 51, user_id: 'FAKE-private-user', email: 'reporter@example.invalid', type: 'suggestion', status: 'triaged', priority: 'urgent',
  message: '@someone\n@org/team fixes #12\nA useful suggestion', created_at: '2026-11-13T01:00:00Z', admin_note: 'FAKE private admin note',
  context: { view: 'practice', userAgent: 'Fake browser', language: 'en-US', appVersion: '2.0.0', submittedAt: '2026-11-13T01:00:00Z' }, issue_number: null, issue_url: null };
function setup(sandbox) {
  sandbox.mockRpc('admin_list_ai_usage', []); sandbox.mockRpc('admin_list_tokens', []); sandbox.mockRpc('admin_list_feedback', [report]);
}
async function openDraft(page) {
  await page.goto('/admin'); await expect(page.locator('#adminData')).toBeVisible();
  await page.locator('#adminLanguage').selectOption('en-US');
  await page.locator('#adminFeedbackRows button').click(); await page.locator('#adminFeedbackIssue').click();
  await expect(page.locator('#feedbackIssueDialog')).toBeVisible();
}

test('issue draft is editable in four languages, neutralizes mentions and requires explicit confirmation', async ({ signedInPage: page, sandbox }) => {
  setup(sandbox); await openDraft(page); await page.locator('#feedbackIssueClose').click();
  for (const locale of ['zh-TW', 'en-US', 'ja-JP', 'ar']) {
    const m = messages(locale); await page.locator('#adminLanguage').selectOption(locale); await page.locator('#adminFeedbackIssue').click();
    await expect(page.locator('#feedbackIssueDialog .security-note')).toHaveText(m['feedbackIssue.publicWarning']);
    await expect(page.locator('#feedbackIssueSubmit')).toHaveText(m['feedbackIssue.confirm']);
    const body = await page.locator('#feedbackIssueBodyInput').inputValue();
    expect(body).toContain(`## ${m['feedbackIssue.summaryHeading']}`); expect(body).toContain(`> ${DISCLAIMER}`);
    expect(body).toContain('> ＠someone\n> ＠org/team fixes #12');
    expect(body).not.toMatch(/@someone|@org|reporter@example|FAKE-private-user|FAKE private admin note|table-topic-feedback:/);
    await expect(page.locator('#feedbackIssueLabels input[value="enhancement"]')).toBeChecked();
    await expect(page.locator('#feedbackIssueLabels input[value="priority: urgent"]')).toBeChecked();
    expect(await page.locator('#feedbackIssueDialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.locator('#feedbackIssueClose').click();
  }
  expect(sandbox.calls.filter(call => call.path === '/api/feedback/issue')).toHaveLength(0);
});

test('confirmed edited issue posts once and displays refreshed issue link and status', async ({ signedInPage: page, sandbox }) => {
  setup(sandbox);
  sandbox.handleFeedback('issue', request => {
    expect(request.headers().authorization).toMatch(/^Bearer /);
    sandbox.mockRpc('admin_list_feedback', [{ ...report, issue_number: 88, issue_url: 'https://github.com/example/project/issues/88', status: 'issue_created' }]);
    return { status: 200, body: { number: 88, url: 'https://github.com/example/project/issues/88', reused: false } };
  });
  await openDraft(page);
  await page.locator('#feedbackIssueTitleInput').fill('Edited title');
  const body = await page.locator('#feedbackIssueBodyInput').inputValue();
  await page.locator('#feedbackIssueBodyInput').fill(`${body}\nEdited summary`);
  await page.locator('#feedbackIssueLabels input[value="enhancement"]').uncheck(); await page.locator('#feedbackIssueLabels input[value="bug"]').check();
  await page.locator('#feedbackIssueSubmit').click();
  await expect(page.locator('#feedbackIssueDialog')).not.toBeVisible();
  await expect(page.locator('#adminFeedbackRows a')).toHaveAttribute('href', 'https://github.com/example/project/issues/88');
  await expect(page.locator('#adminFeedbackDetailStatus')).toHaveText(messages('en-US')['adminFeedback.issueCreated']);
  await expect(page.locator('#adminFeedbackIssue')).toBeDisabled();
  const calls = sandbox.calls.filter(call => call.path === '/api/feedback/issue'); expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0].body)).toEqual({ id: 51, title: 'Edited title', body: `${body}\nEdited summary`, labels: ['feedback', 'bug', 'priority: urgent'] });
  expect(sandbox.calls.filter(call => /admin_(begin|finish|cancel)_issue/.test(call.path))).toHaveLength(0);
});

test('missing configuration and privacy errors are clear and retry can link an existing issue', async ({ signedInPage: page, sandbox }) => {
  setup(sandbox); await openDraft(page); sandbox.allowConsoleError(/Failed to load resource/);
  const body = await page.locator('#feedbackIssueBodyInput').inputValue();
  await page.locator('#feedbackIssueTitleInput').fill('REPORTER@EXAMPLE.INVALID'); await page.locator('#feedbackIssueSubmit').click();
  await expect(page.locator('#feedbackIssueMessage')).toHaveText(messages('en-US')['feedbackIssue.containsEmail']);
  expect(sandbox.calls.filter(call => call.path === '/api/feedback/issue')).toHaveLength(0);
  await page.locator('#feedbackIssueTitleInput').fill('A safe title');
  for (const [error, key, status] of [['github_not_configured', 'notConfigured', 503], ['issue_record_failed', 'retry', 503], ['missing_disclaimer', 'missingDisclaimer', 400]]) {
    sandbox.mockFeedback('issue', { error }, status); await page.locator('#feedbackIssueSubmit').click();
    await expect(page.locator('#feedbackIssueMessage')).toHaveText(messages('en-US')[`feedbackIssue.${key}`]);
    await expect(page.locator('#feedbackIssueBodyInput')).toHaveValue(body);
  }
  sandbox.handleFeedback('issue', () => {
    sandbox.mockRpc('admin_list_feedback', [{ ...report, issue_number: 88, issue_url: 'https://github.com/example/project/issues/88', status: 'issue_created' }]);
    return { body: { number: 88, url: 'https://github.com/example/project/issues/88', reused: true } };
  });
  await page.locator('#feedbackIssueSubmit').click();
  await expect(page.locator('#feedbackIssueDialog')).not.toBeVisible();
  await expect(page.locator('#adminFeedbackMessage')).toHaveText(messages('en-US')['feedbackIssue.reused']);
  await expect(page.locator('#adminFeedbackRows a')).toHaveAttribute('href', 'https://github.com/example/project/issues/88');
});
