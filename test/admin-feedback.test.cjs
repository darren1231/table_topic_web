const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Element, publicDir } = require('./helpers/frontend.cjs');

const records = [
  { id: 11, priority: null, status: 'new', type: 'bug', message: '😀'.repeat(45), created_at: '2026-11-13T01:00:00Z',
    email: 'alice@example.invalid', context: { view: 'practice', userAgent: 'Fake browser', language: 'en-US', appVersion: '2.0.0', submittedAt: '2026-11-13T01:00:00Z' }, admin_note: 'Existing note', issue_url: null },
  { id: 12, priority: 'urgent', status: 'triaged', type: 'suggestion', message: 'A useful suggestion', created_at: '2026-11-12T01:00:00Z',
    email: 'bob@example.invalid', context: null, admin_note: '', issue_number: 9, issue_url: 'https://github.com/example/project/issues/9' },
];

function fixture({ rpc, issueFetch } = {}) {
  const html = fs.readFileSync(path.join(publicDir, 'admin.html'), 'utf8');
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element()]));
  const calls = [], denied = [], issueCalls = [];
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: 'FAKE-admin' }, access_token: 'FAKE-admin-token' } } }) }, rpc: async (name, params) => {
    calls.push({ name, params });
    return rpc ? rpc(name, params) : { data: name === 'admin_list_feedback' ? structuredClone(records) : 1 };
  } };
  const controller = require('../public/admin-feedback.js').createFeedbackAdmin({ client,
    document: { getElementById: id => nodes.get(id), createElement: tag => new Element(tag) },
    t: key => key, getLocale: () => 'en-US', onDenied: error => denied.push(error),
    fetch: async (url, init) => { issueCalls.push({ url, init }); return issueFetch ? issueFetch(url, init) : Response.json({ number: 42, url: 'https://github.com/example/project/issues/42', reused: false }); } });
  controller.initialize();
  return { nodes, calls, denied, issueCalls, controller, get: id => nodes.get(id) };
}

test('feedback admin renders the list with Unicode summaries and opens an editable issue draft without posting', () => {
  const f = fixture(); f.controller.setRecords(structuredClone(records));
  const rows = f.get('adminFeedbackRows').children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[1].textContent, '#11');
  assert.equal(rows[0].children[4].children[0].textContent, '😀'.repeat(40));
  assert.equal(rows[0].children[6].textContent, 'alice@example.invalid');
  rows[0].children[4].children[0].click();
  assert.equal(f.get('adminFeedbackBody').textContent, records[0].message);
  assert.equal(f.get('adminFeedbackNote').value, 'Existing note');
  assert.equal(f.get('adminFeedbackIssue').disabled, false);
  f.get('adminFeedbackIssue').click();
  assert.equal(f.get('feedbackIssueDialog').open, true);
  assert.equal(f.get('feedbackIssueTitleInput').value, '😀'.repeat(45));
  assert.ok(f.get('feedbackIssueBodyInput').value.includes('以下為使用者回饋原文'));
  assert.deepEqual(f.issueCalls, []);
  assert.deepEqual(f.calls, []);
});

test('confirmed issue sends the edited draft with latest access token then refreshes the list', async () => {
  const updated = [{ ...records[0], issue_number: 42, issue_url: 'https://github.com/example/project/issues/42', status: 'issue_created' }];
  const f = fixture({ rpc: async () => ({ data: updated }) }); f.controller.setRecords(structuredClone(records));
  f.get('adminFeedbackRows').children[0].children[4].children[0].click(); f.get('adminFeedbackIssue').click();
  f.get('feedbackIssueTitleInput').value = 'Edited title';
  f.get('feedbackIssueBodyInput').value += '\nEdited summary';
  await f.get('feedbackIssueForm').onsubmit({ preventDefault() {} });
  assert.equal(f.issueCalls.length, 1); assert.equal(f.issueCalls[0].url, '/api/feedback/issue');
  assert.equal(new Headers(f.issueCalls[0].init.headers).get('Authorization'), 'Bearer FAKE-admin-token');
  const body = JSON.parse(f.issueCalls[0].init.body); assert.equal(body.id, 11); assert.equal(body.title, 'Edited title');
  assert.ok(body.body.endsWith('Edited summary')); assert.deepEqual(body.labels, ['feedback', 'bug']);
  assert.equal(f.get('feedbackIssueDialog').open, false); assert.equal(f.get('adminFeedbackIssue').disabled, true);
  assert.equal(f.get('adminFeedbackDetailStatus').textContent, 'adminFeedback.issueCreated');
  assert.deepEqual(f.calls.map(call => call.name), ['admin_list_feedback']);
});

test('issue errors keep the editable draft and missing GitHub configuration has a specific message', async () => {
  for (const [error, expected] of [['github_not_configured', 'notConfigured'], ['feedback_contains_email', 'containsEmail'],
    ['feedback_issue_pending', 'pending'], ['issue_record_failed', 'retry'], ['github_error', 'failed']]) {
    const f = fixture({ issueFetch: async () => Response.json({ error, message: 'PRIVATE RAW ERROR' }, { status: 503 }) });
    f.controller.setRecords(structuredClone(records)); f.get('adminFeedbackRows').children[0].children[4].children[0].click(); f.get('adminFeedbackIssue').click();
    const body = f.get('feedbackIssueBodyInput').value;
    await f.get('feedbackIssueForm').onsubmit({ preventDefault() {} });
    assert.equal(f.get('feedbackIssueDialog').open, true); assert.equal(f.get('feedbackIssueBodyInput').value, body);
    assert.equal(f.get('feedbackIssueMessage').textContent, `feedbackIssue.${expected}`);
  }
});

test('draft validation runs before posting and sign-out discards an in-flight issue response', async () => {
  const f = fixture(); f.controller.setRecords(structuredClone(records)); f.get('adminFeedbackRows').children[0].children[4].children[0].click(); f.get('adminFeedbackIssue').click();
  f.get('feedbackIssueTitleInput').value = 'ALICE@EXAMPLE.INVALID'; await f.get('feedbackIssueForm').onsubmit({ preventDefault() {} });
  assert.equal(f.get('feedbackIssueMessage').textContent, 'feedbackIssue.containsEmail'); assert.equal(f.issueCalls.length, 0);
  let finish;
  const g = fixture({ issueFetch: async () => new Promise(done => { finish = done; }) });
  g.controller.setRecords(structuredClone(records)); g.get('adminFeedbackRows').children[0].children[4].children[0].click(); g.get('adminFeedbackIssue').click();
  const sending = g.get('feedbackIssueForm').onsubmit({ preventDefault() {} }); await new Promise(done => setImmediate(done));
  await g.get('feedbackIssueForm').onsubmit({ preventDefault() {} }); assert.equal(g.issueCalls.length, 1);
  g.controller.clear(); finish(Response.json({ number: 42, reused: false })); await sending;
  assert.equal(g.get('feedbackIssueDialog').open, false); assert.equal(g.get('feedbackIssueBodyInput').value, '');
  assert.equal(g.get('adminFeedbackRows').children.length, 0); assert.equal(g.calls.length, 0);
});

test('a reload outage after successful issue creation is shown on the main page', async () => {
  const f = fixture({ rpc: async () => { throw new Error('FAKE offline'); } });
  f.controller.setRecords(structuredClone(records)); f.get('adminFeedbackRows').children[0].children[4].children[0].click(); f.get('adminFeedbackIssue').click();
  await f.get('feedbackIssueForm').onsubmit({ preventDefault() {} });
  assert.equal(f.get('feedbackIssueDialog').open, false);
  assert.equal(f.get('adminFeedbackMessage').textContent, 'adminFeedback.reloadFailed');
});

test('feedback filters combine status type and priority and clear hidden selections', () => {
  const f = fixture(); f.controller.setRecords(structuredClone(records));
  const select = f.get('adminFeedbackRows').children[0].children[0].children[0]; select.checked = true; select.onchange();
  assert.equal(f.get('adminFeedbackUrgent').disabled, false);
  f.get('adminFeedbackStatus').value = 'triaged'; f.get('adminFeedbackStatus').onchange();
  assert.equal(f.get('adminFeedbackRows').children.length, 1);
  assert.equal(f.get('adminFeedbackRows').children[0].children[1].textContent, '#12');
  assert.equal(f.get('adminFeedbackUrgent').disabled, true);
  f.get('adminFeedbackType').value = 'bug'; f.get('adminFeedbackType').onchange();
  assert.equal(f.get('adminFeedbackRows').children[0].children[0].textContent, 'adminFeedback.empty');
  f.get('adminFeedbackStatus').value = 'all'; f.get('adminFeedbackPriority').value = 'none'; f.get('adminFeedbackPriority').onchange();
  assert.equal(f.get('adminFeedbackRows').children[0].children[1].textContent, '#11');
});

test('all five batch actions send only selected IDs, explicit null unchanged fields, and reload', async () => {
  for (const [button, priority, status] of [['Urgent', 'urgent', null], ['Normal', 'normal', null], ['Later', 'later', null],
    ['Decline', null, 'wont_fix'], ['Done', null, 'done']]) {
    const f = fixture(); f.controller.setRecords(structuredClone(records));
    for (const row of f.get('adminFeedbackRows').children) { const checkbox = row.children[0].children[0]; checkbox.checked = true; checkbox.onchange(); }
    await f.get(`adminFeedback${button}`).onclick();
    assert.deepEqual(f.calls, [
      { name: 'admin_update_feedback', params: { p_ids: [11, 12], p_priority: priority, p_status: status, p_note: null } },
      { name: 'admin_list_feedback', params: undefined },
    ]);
    assert.equal(f.get('adminFeedbackMessage').textContent, 'adminFeedback.saved');
    assert.equal(f.get('adminFeedbackUrgent').disabled, true);
  }
});

test('single feedback notes save and clear with no bulk fields, then render refreshed data', async () => {
  const f = fixture({ rpc: async name => ({ data: name === 'admin_list_feedback' ? [{ ...records[0], admin_note: 'Fresh saved note' }] : 1 }) });
  f.controller.setRecords(structuredClone(records));
  f.get('adminFeedbackRows').children[0].children[4].children[0].click();
  f.get('adminFeedbackNote').value = 'Fresh saved note'; await f.get('adminFeedbackSaveNote').onclick();
  assert.deepEqual(f.calls[0].params, { p_ids: [11], p_priority: null, p_status: null, p_note: 'Fresh saved note' });
  assert.equal(f.get('adminFeedbackNote').value, 'Fresh saved note');
  f.get('adminFeedbackNote').value = ''; await f.get('adminFeedbackSaveNote').onclick();
  assert.equal(f.calls[2].params.p_note, '');
});

test('issue links are created only for exact HTTPS GitHub origin and every database value is text', () => {
  const payload = '<img src=x onerror=alert(1)> " onmouseover="x';
  const urls = ['https://github.com/example/project/issues/9', 'javascript:alert(1)', 'https://github.com.evil.invalid/a',
    'https://github.com@evil.invalid/a', 'http://github.com/a', '//github.com/a', 'https://github.com/\\evil.invalid/a'];
  const f = fixture();
  f.controller.setRecords(urls.map((issue_url, id) => ({ ...records[0], id: id + 1, issue_url, issue_number: 9, message: payload,
    email: payload, admin_note: payload, context: { view: payload, extra: 'PRIVATE UNEXPECTED FIELD' } })));
  const rows = f.get('adminFeedbackRows').children;
  assert.equal(rows[0].children[7].children[0].tagName, 'A');
  assert.equal(rows[0].children[7].children[0].getAttribute('rel'), 'noopener noreferrer');
  assert.equal(rows[0].children[7].children[0].getAttribute('href'), urls[0]);
  for (const row of rows.slice(1)) assert.equal(row.children[7].children.length, 0);
  rows[0].children[4].children[0].click();
  assert.equal(f.get('adminFeedbackBody').textContent, payload);
  assert.equal(f.get('adminFeedbackContext').children[1].textContent, payload);
  assert.equal(f.get('adminFeedbackContext').children.length, 2);
  const visit = node => { assert.equal(node.htmlWrites, 0); assert.ok(!['IMG', 'SCRIPT'].includes(node.tagName)); for (const child of node.children) visit(child); };
  for (const node of f.nodes.values()) visit(node);
});

test('batch errors are clear and keep notes and selections for retry without showing raw errors', async () => {
  for (const [message, expected] of [['feedback_not_found', 'notFound'], ['invalid_feedback_batch', 'invalidBatch'], ['PRIVATE RAW ERROR', 'updateFailed']]) {
    const f = fixture({ rpc: async () => ({ error: { code: '22023', message } }) });
    f.controller.setRecords(structuredClone(records));
    const row = f.get('adminFeedbackRows').children[0], checkbox = row.children[0].children[0];
    checkbox.checked = true; checkbox.onchange(); row.children[4].children[0].click();
    f.get('adminFeedbackNote').value = 'Unsaved note'; await f.get('adminFeedbackSaveNote').onclick();
    assert.equal(f.get('adminFeedbackMessage').textContent, `adminFeedback.${expected}`);
    assert.equal(f.get('adminFeedbackNote').value, 'Unsaved note');
    assert.equal(f.get('adminFeedbackUrgent').disabled, false);
    assert.equal(f.calls.length, 1);
  }
});

test('no selection or authorization never updates and note limits count Unicode characters', async () => {
  const f = fixture(); await f.get('adminFeedbackUrgent').onclick();
  f.controller.setRecords(structuredClone(records)); await f.get('adminFeedbackUrgent').onclick();
  assert.deepEqual(f.calls, []);
  f.get('adminFeedbackRows').children[0].children[4].children[0].click();
  f.get('adminFeedbackNote').value = '😀'.repeat(2001); await f.get('adminFeedbackSaveNote').onclick();
  assert.equal(f.get('adminFeedbackMessage').textContent, 'adminFeedback.invalidBatch'); assert.equal(f.calls.length, 0);
  f.get('adminFeedbackNote').value = '😀'.repeat(2000); await f.get('adminFeedbackSaveNote').onclick();
  assert.equal(f.calls[0].params.p_note, '😀'.repeat(2000));
  f.controller.clear(); await f.get('adminFeedbackSaveNote').onclick();
  assert.equal(f.get('adminFeedbackRows').children.length, 0);
  assert.equal(f.get('adminFeedbackNote').value, '');
});

test('updates cannot be duplicated and cleared admin access discards a pending response', async () => {
  let finish;
  const f = fixture({ rpc: async () => new Promise(done => { finish = done; }) }); f.controller.setRecords(structuredClone(records));
  const checkbox = f.get('adminFeedbackRows').children[0].children[0].children[0]; checkbox.checked = true; checkbox.onchange();
  const pending = f.get('adminFeedbackUrgent').onclick(); await f.get('adminFeedbackUrgent').onclick();
  assert.equal(f.calls.length, 1); assert.equal(f.get('adminFeedbackUrgent').disabled, true);
  f.controller.clear(); finish({ data: 1 }); await pending;
  assert.equal(f.calls.length, 1); assert.equal(f.get('adminFeedbackRows').children.length, 0);
  assert.equal(f.get('adminFeedbackUrgent').disabled, true);
});

test('permission revocation clears private feedback and failed refresh distinguishes saved changes', async () => {
  const f = fixture({ rpc: async () => ({ error: { code: '42501' } }) }); f.controller.setRecords(structuredClone(records));
  f.get('adminFeedbackRows').children[0].children[4].children[0].click();
  await f.get('adminFeedbackSaveNote').onclick();
  assert.equal(f.denied[0].code, '42501'); assert.equal(f.get('adminFeedbackRows').children.length, 0);
  assert.equal(f.get('adminFeedbackBody').textContent, ''); assert.equal(f.get('adminFeedbackNote').value, '');
  const g = fixture({ rpc: async name => { if (name === 'admin_list_feedback') throw new Error('Offline'); return { data: 1 }; } });
  g.controller.setRecords(structuredClone(records)); g.get('adminFeedbackRows').children[0].children[4].children[0].click();
  await g.get('adminFeedbackSaveNote').onclick(); assert.equal(g.get('adminFeedbackMessage').textContent, 'adminFeedback.reloadFailed');
});

test('all feedback admin labels have complete translations in four languages', () => {
  const html = fs.readFileSync(path.join(publicDir, 'admin.html'), 'utf8');
  const source = fs.readFileSync(path.join(publicDir, 'admin-feedback.js'), 'utf8');
  const keys = [...new Set([...html.matchAll(/data-admin-i18n="(adminFeedback\.[A-Za-z]+)"/g), ...source.matchAll(/'(adminFeedback\.[A-Za-z]+)'/g)].map(match => match[1]))];
  keys.push(...['view', 'userAgent', 'language', 'appVersion', 'submittedAt'].map(key => `adminFeedback.${key}`));
  const catalogs = ['zh-TW', 'en-US', 'ja-JP', 'ar'].map(locale => JSON.parse(fs.readFileSync(path.join(publicDir, 'locales', `${locale}.json`), 'utf8')).messages);
  assert.ok(keys.length > 25);
  for (const key of keys) for (let i = 0; i < catalogs.length; i++) {
    assert.ok(catalogs[i][key]?.trim(), key);
  }
  for (const catalog of catalogs.slice(1)) assert.ok(keys.some(key => catalog[key] !== catalogs[0][key]));
});
