const assert = require('node:assert/strict');
const { test } = require('node:test');
const { browser } = require('./helpers/frontend.cjs');
const fs = require('node:fs');
const path = require('node:path');

function fixture({ signedIn = true, rpc } = {}) {
  const b = browser();
  let session = signedIn ? { user: { id: 'fake-feedback-user' } } : null;
  let listener;
  const calls = [];
  const client = { auth: {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: callback => { listener = callback; },
  }, rpc: async (name, params) => {
    calls.push({ name, params });
    return rpc ? rpc(name, params) : { data: name === 'get_my_feedback' ? [] : 42 };
  } };
  const controller = require('../public/feedback-ui.js').createFeedbackController({ client, document: b.context.document,
    t: key => key, getLocale: () => 'en-US', schedule: fn => fn(),
    getContext: () => ({ view: 'practice', userAgent: 'Fake Test Browser', language: 'en-US', appVersion: '2.0.0',
      submittedAt: '2026-11-13T01:00:00.000Z', transcript: 'PRIVATE PRACTICE', email: 'PRIVATE EMAIL', token: 'PRIVATE TOKEN' }),
    onSignIn: () => { b.signInOpened = true; } });
  controller.initialize();
  return Object.assign(b, { controller, calls, setSession: async next => { session = next; await listener('SIGNED_OUT', next); } });
}

test('feedback dialog prompts guests to sign in without any database call', async () => {
  const f = fixture({ signedIn: false });
  await f.controller.open();
  assert.equal(f.get('#feedbackDialog').open, true);
  assert.equal(f.get('#feedbackMessage').textContent, 'feedback.signInRequired');
  assert.equal(f.get('#feedbackSubmit').disabled, true);
  await f.controller.submit();
  assert.deepEqual(f.calls, []);
  f.get('#feedbackSignIn').click();
  assert.equal(f.signInOpened, true);
  assert.equal(f.get('#feedbackDialog').open, false);
});

test('signed-in feedback submits only five technical fields, thanks the user and clears the form', async () => {
  const f = fixture(); await f.controller.open();
  f.get('#feedbackType').value = 'suggestion';
  f.get('#feedbackDescription').value = 'Please add a timer';
  f.get('#feedbackIncludeContext').checked = true;
  f.get('#feedbackDescription').oninput();
  assert.equal(f.get('#feedbackCount').textContent, '18/2000');
  await f.controller.submit();
  assert.deepEqual(f.calls.map(call => call.name), ['get_my_feedback', 'submit_feedback', 'get_my_feedback']);
  assert.deepEqual(f.calls[1].params, { p_type: 'suggestion', p_message: 'Please add a timer', p_context: {
    view: 'practice', userAgent: 'Fake Test Browser', language: 'en-US', appVersion: '2.0.0', submittedAt: '2026-11-13T01:00:00.000Z',
  } });
  assert.equal(f.get('#feedbackMessage').textContent, 'feedback.thanks');
  assert.equal(f.get('#feedbackDescription').value, '');
  assert.equal(f.get('#feedbackType').value, 'bug');
  assert.equal(f.get('#feedbackIncludeContext').checked, true);
  assert.equal(f.get('#feedbackCount').textContent, '0/2000');
});

test('unchecking technical information sends SQL null without collecting context', async () => {
  const f = fixture(); await f.controller.open();
  f.get('#feedbackDescription').value = 'A private report';
  f.get('#feedbackIncludeContext').checked = false;
  await f.controller.submit();
  assert.equal(f.calls.find(call => call.name === 'submit_feedback').params.p_context, null);
});

test('description counts Unicode characters and rejects empty, overlong or invalid types without submitting', async () => {
  const f = fixture(); await f.controller.open();
  for (const [type, text] of [['bug', ' \n\t'], ['bug', '字'.repeat(2001)], ['unknown', 'Report']]) {
    f.get('#feedbackType').value = type; f.get('#feedbackDescription').value = text;
    await f.controller.submit();
    assert.equal(f.get('#feedbackMessage').textContent, 'feedback.invalidInput');
    assert.equal(f.get('#feedbackDescription').value, text);
  }
  assert.equal(f.calls.filter(call => call.name === 'submit_feedback').length, 0);
  f.get('#feedbackType').value = 'bug'; f.get('#feedbackDescription').value = '😀'.repeat(2000);
  f.get('#feedbackDescription').oninput();
  assert.equal(f.get('#feedbackCount').textContent, '2000/2000');
  await f.controller.submit();
  assert.equal(f.calls.find(call => call.name === 'submit_feedback').params.p_message, '😀'.repeat(2000));
});

test('quota, validation, authentication and network errors show fixed messages and preserve the draft', async () => {
  for (const [error, key] of [
    [{ code: 'P0001', message: 'feedback_daily_limit' }, 'dailyLimit'],
    [{ code: '22023', message: 'PRIVATE RAW ERROR' }, 'invalidInput'],
    [{ code: '42501' }, 'signInRequired'], [{ code: 'PGRST301' }, 'signInRequired'],
    [{ code: 'NETWORK', message: '<img src=x onerror=alert(1)>' }, 'networkError'],
  ]) {
    const f = fixture({ rpc: async name => name === 'get_my_feedback' ? { data: [] } : { error } });
    await f.controller.open(); f.get('#feedbackDescription').value = 'Keep my draft';
    await f.controller.submit();
    assert.equal(f.get('#feedbackMessage').textContent, `feedback.${key}`);
    assert.equal(f.get('#feedbackDescription').value, 'Keep my draft');
    assert.equal(f.get('#feedbackSubmit').disabled, false);
  }
  const f = fixture({ rpc: async name => { if (name === 'submit_feedback') throw new Error('Offline'); return { data: [] }; } });
  await f.controller.open(); f.get('#feedbackDescription').value = 'Keep'; await f.controller.submit();
  assert.equal(f.get('#feedbackMessage').textContent, 'feedback.networkError');
});

test('my feedback renders only simplified status and literal text, with no private fields or HTML writes', async () => {
  const payload = '<img src=x onerror=alert(1)> " onmouseover="x';
  const records = ['received', 'in_progress', 'done', 'declined'].map((public_status, i) => ({
    id: i + 1, type: 'bug', created_at: '2026-11-13T01:00:00Z', message: payload, public_status,
    admin_note: 'PRIVATE NOTE', priority: 'urgent', issue_url: 'javascript:alert(1)', email: 'PRIVATE EMAIL',
  }));
  const f = fixture({ rpc: async () => ({ data: records }) }); await f.controller.open();
  const rows = f.get('#feedbackList').children;
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.children[1].textContent), ['feedback.received', 'feedback.inProgress', 'feedback.done', 'feedback.declined']);
  const visit = node => { assert.equal(node.htmlWrites, 0); for (const child of node.children) visit(child); };
  for (const row of rows) { visit(row); assert.equal(row.children[3].textContent, payload); assert.equal(row.children.length, 4); }
});

test('list load failure is separate from submission success and contains no raw error', async () => {
  const f = fixture({ rpc: async name => name === 'get_my_feedback' ? { error: { message: 'PRIVATE ERROR' } } : { data: 1 } });
  await f.controller.open(); assert.equal(f.get('#feedbackListMessage').textContent, 'feedback.loadFailed');
  f.get('#feedbackDescription').value = 'Report'; await f.controller.submit();
  assert.equal(f.get('#feedbackMessage').textContent, 'feedback.thanks');
  assert.equal(f.get('#feedbackListMessage').textContent, 'feedback.loadFailed');
});

test('double submission is prevented and signing out discards stale list responses', async () => {
  let resolve;
  const f = fixture({ rpc: async name => name === 'get_my_feedback' ? { data: [] } : new Promise(done => { resolve = done; }) });
  await f.controller.open(); f.get('#feedbackDescription').value = 'One report';
  const one = f.controller.submit(), two = f.controller.submit();
  await new Promise(done => setImmediate(done));
  assert.equal(f.calls.filter(call => call.name === 'submit_feedback').length, 1);
  assert.equal(f.get('#feedbackSubmit').disabled, true);
  resolve({ data: 1 }); await Promise.all([one, two]);
  assert.equal(f.get('#feedbackSubmit').disabled, false);
  let finish;
  const g = fixture({ rpc: async () => new Promise(done => { finish = done; }) });
  const opening = g.controller.open(); await new Promise(done => setImmediate(done));
  await g.setSession(null);
  finish({ data: [{ id: 1, message: 'OTHER ACCOUNT', public_status: 'received' }] }); await opening;
  assert.equal(g.get('#feedbackList').children.length, 0);
  assert.equal(g.get('#feedbackMessage').textContent, 'feedback.signInRequired');
});

test('authentication failures offer a sign-in action and signing out invalidates an in-flight submission', async () => {
  const f = fixture({ rpc: async name => name === 'get_my_feedback' ? { data: [] } : { error: { code: '42501' } } });
  await f.controller.open(); f.get('#feedbackDescription').value = 'Report'; await f.controller.submit();
  assert.equal(f.get('#feedbackSignIn').classList.contains('hidden'), false);
  let finish;
  const g = fixture({ rpc: async name => name === 'get_my_feedback' ? { data: [] } : new Promise(done => { finish = done; }) });
  await g.controller.open(); g.get('#feedbackDescription').value = 'Report';
  const sending = g.controller.submit(); await new Promise(done => setImmediate(done));
  await g.setSession(null); finish({ data: 1 }); await sending;
  assert.equal(g.get('#feedbackMessage').textContent, 'feedback.signInRequired');
  assert.equal(g.get('#feedbackSubmit').disabled, true);
  assert.equal(g.calls.filter(call => call.name === 'get_my_feedback').length, 1);
});

test('all feedback messages exist and are translated in four locale catalogs', () => {
  const catalogs = ['zh-TW', 'en-US', 'ja-JP', 'ar'].map(locale => JSON.parse(fs.readFileSync(path.join(__dirname, '../public/locales', `${locale}.json`), 'utf8')).messages);
  const keys = Object.keys(catalogs[0]).filter(key => key.startsWith('feedback.'));
  assert.ok(keys.length >= 20);
  for (const catalog of catalogs.slice(1)) for (const key of keys) {
    assert.ok(catalog[key]?.trim(), key); assert.notEqual(catalog[key], catalogs[0][key], key);
  }
});
