const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures.cjs');
const messages = locale => JSON.parse(fs.readFileSync(path.join(__dirname, '../public/locales', `${locale}.json`), 'utf8')).messages;
const payload = '<img src=x onerror=alert(1)> " onmouseover="x';
const initial = [
  { id: 41, user_id: 'fake-a', email: 'alice@example.invalid', type: 'bug', status: 'new', priority: null,
    message: '😀'.repeat(45), created_at: '2026-11-13T01:00:00Z', admin_note: 'Original note', issue_url: null,
    context: { view: 'practice', userAgent: payload, language: 'en-US', appVersion: '2.0.0', submittedAt: '2026-11-13T01:00:00Z' } },
  { id: 42, user_id: 'fake-b', email: 'bob@example.invalid', type: 'suggestion', status: 'triaged', priority: 'normal',
    message: payload, created_at: '2026-11-12T01:00:00Z', admin_note: '', context: null, issue_number: 7, issue_url: 'https://github.com/example/project/issues/7' },
  { id: 43, user_id: 'fake-c', email: payload, type: 'other', status: 'done', priority: 'later',
    message: 'Third report', created_at: '2026-11-11T01:00:00Z', admin_note: '', context: null, issue_number: 8, issue_url: 'javascript:alert(1)' },
];

function setup(sandbox) {
  let records = structuredClone(initial);
  sandbox.mockRpc('admin_list_ai_usage', []); sandbox.mockRpc('admin_list_tokens', []);
  sandbox.handleRpc('admin_list_feedback', () => ({ body: records }));
  sandbox.handleRpc('admin_update_feedback', request => {
    const values = JSON.parse(request.postData());
    records = records.map(item => {
      if (!values.p_ids.includes(item.id)) return item;
      return { ...item, priority: values.p_priority ?? item.priority,
        status: values.p_status ?? (values.p_priority && item.status === 'new' ? 'triaged' : item.status),
        admin_note: values.p_note ?? item.admin_note };
    });
    return { body: values.p_ids.length };
  });
}

async function openAdmin(page) {
  await page.goto('/admin'); await expect(page.locator('#adminData')).toBeVisible();
  await page.locator('#adminLanguage').selectOption('en-US');
}
const row = (page, id) => page.locator('#adminFeedbackRows tr').filter({ has: page.getByText(`#${id}`, { exact: true }) });

test('admin filters feedback and applies all five batch actions with refreshed results', async ({ signedInPage: page, sandbox }) => {
  setup(sandbox); await openAdmin(page);
  await expect(page.locator('#adminFeedbackRows tr')).toHaveCount(3);
  await expect(row(page, 41).locator('button')).toHaveText('😀'.repeat(40));
  await page.locator('#adminFeedbackStatus').selectOption('triaged');
  await page.locator('#adminFeedbackType').selectOption('suggestion');
  await page.locator('#adminFeedbackPriority').selectOption('normal');
  await expect(page.locator('#adminFeedbackRows tr')).toHaveCount(1);
  await expect(row(page, 42)).toBeVisible();
  for (const filter of ['Status', 'Type', 'Priority']) await page.locator(`#adminFeedback${filter}`).selectOption('all');
  const steps = [
    ['Urgent', 'urgent', null], ['Normal', 'normal', null], ['Later', 'later', null], ['Decline', null, 'wont_fix'], ['Done', null, 'done'],
  ];
  for (const [button, priority, status] of steps) {
    await row(page, 41).locator('input[type=checkbox]').check(); await row(page, 42).locator('input[type=checkbox]').check();
    const before = sandbox.calls.filter(call => call.path.endsWith('/admin_list_feedback')).length;
    await page.locator(`#adminFeedback${button}`).click();
    await expect(page.locator('#adminFeedbackMessage')).toHaveText(messages('en-US')['adminFeedback.saved']);
    await expect(page.locator('#adminFeedbackUrgent')).toBeDisabled();
    const call = sandbox.calls.filter(call => call.path.endsWith('/admin_update_feedback')).at(-1);
    expect(JSON.parse(call.body)).toEqual({ p_ids: [41, 42], p_priority: priority, p_status: status, p_note: null });
    expect(sandbox.calls.filter(call => call.path.endsWith('/admin_list_feedback')).length).toBeGreaterThan(before);
    if (priority) await expect(row(page, 41)).toContainText(messages('en-US')[`adminFeedback.${priority}`]);
  }
  await page.locator('#adminFeedbackStatus').selectOption('done');
  await expect(page.locator('#adminFeedbackRows tr')).toHaveCount(3);
});

test('admin saves and clears a single note, sees literal technical details and only safe issue links', async ({ signedInPage: page, sandbox }) => {
  setup(sandbox); await openAdmin(page);
  await expect(row(page, 42).locator('a')).toHaveAttribute('href', initial[1].issue_url);
  await expect(row(page, 42).locator('a')).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(row(page, 43).locator('a')).toHaveCount(0);
  await expect(page.locator('#adminFeedbackSection img, #adminFeedbackSection [onmouseover]')).toHaveCount(0);
  await row(page, 41).locator('button').click();
  await expect(page.locator('#adminFeedbackBody')).toHaveText(initial[0].message);
  await expect(page.locator('#adminFeedbackContext')).toContainText(payload);
  await expect(page.locator('#adminFeedbackNote')).toHaveValue('Original note');
  await page.locator('#adminFeedbackNote').fill(payload);
  await page.locator('#adminFeedbackSaveNote').click();
  await expect(page.locator('#adminFeedbackMessage')).toHaveText(messages('en-US')['adminFeedback.saved']);
  expect(JSON.parse(sandbox.calls.filter(call => call.path.endsWith('/admin_update_feedback')).at(-1).body))
    .toEqual({ p_ids: [41], p_priority: null, p_status: null, p_note: payload });
  await expect(page.locator('#adminFeedbackNote')).toHaveValue(payload);
  await page.locator('#adminFeedbackNote').fill(''); await page.locator('#adminFeedbackSaveNote').click();
  await expect(page.locator('#adminFeedbackNote')).toHaveValue('');
  await expect.poll(() => JSON.parse(sandbox.calls.filter(call => call.path.endsWith('/admin_update_feedback')).at(-1).body).p_note).toBe('');
  await expect(page.locator('#adminFeedbackIssue')).toBeEnabled();
  const before = sandbox.calls.length; await page.locator('#adminFeedbackIssue').evaluate(button => button.click());
  await expect(page.locator('#feedbackIssueDialog')).toBeVisible();
  expect(sandbox.calls).toHaveLength(before);
  await page.locator('#feedbackIssueClose').click();
  expect(sandbox.calls.filter(call => call.path.includes('begin_issue') || call.path.includes('/api/feedback/'))).toHaveLength(0);
});

test('admin update errors preserve notes and show fixed messages for missing records and invalid batches', async ({ signedInPage: page, sandbox }) => {
  setup(sandbox); await openAdmin(page); await row(page, 41).locator('button').click();
  await page.locator('#adminFeedbackNote').fill('Keep this note');
  sandbox.allowConsoleError(/Failed to load resource/);
  for (const [message, key] of [['feedback_not_found', 'notFound'], ['invalid_feedback_batch', 'invalidBatch']]) {
    sandbox.mockRpc('admin_update_feedback', { code: '22023', message }, 400);
    await page.locator('#adminFeedbackSaveNote').click();
    await expect(page.locator('#adminFeedbackMessage')).toHaveText(messages('en-US')[`adminFeedback.${key}`]);
    await expect(page.locator('#adminFeedbackNote')).toHaveValue('Keep this note');
  }
});

test('feedback section translates in four languages and denied feedback permissions hide all private data', async ({ signedInPage: page, sandbox }) => {
  setup(sandbox); await openAdmin(page); await row(page, 41).locator('button').click();
  for (const locale of ['zh-TW', 'en-US', 'ja-JP', 'ar']) {
    const m = messages(locale); await page.locator('#adminLanguage').selectOption(locale);
    await expect(page.locator('#adminFeedbackTitle')).toHaveText(m['feedback.title']);
    await expect(page.locator('#adminFeedbackUrgent')).toHaveText(m['adminFeedback.markUrgent']);
    await expect(page.locator('#adminFeedbackSaveNote')).toHaveText(m['adminFeedback.saveNote']);
    await expect(page.locator('#adminFeedbackIssueHint')).toHaveText(m['feedbackIssue.openHint']);
    await expect(page.locator('#adminFeedbackSection')).not.toContainText('adminFeedback.');
  }
  sandbox.mockRpc('admin_list_feedback', { code: '42501', message: 'Admin access required' }, 403);
  sandbox.allowConsoleError(/Failed to load resource/);
  await page.locator('#adminRefresh').click();
  await expect(page.locator('#adminStatus')).toHaveText(messages('ar')['admin.denied']);
  await expect(page.locator('#adminData')).not.toBeVisible();
  await expect(page.locator('#adminFeedbackRows tr')).toHaveCount(0);
  await expect(page.locator('#adminFeedbackBody')).toHaveText('');
  await expect(page.locator('#adminFeedbackNote')).toHaveValue('');
});
