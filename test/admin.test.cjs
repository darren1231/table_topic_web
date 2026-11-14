const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Element, publicDir } = require('./helpers/frontend.cjs');

const rows = [
  { user_id: 'a', email: '<img src=x onerror=alert(1)>', created_at: '2026-11-07T00:00:00Z', kind: 'analysis', model: '<script>bad</script>', status: 'success', input_tokens: 10, output_tokens: 5, estimated_cost: '0.25', audio_seconds: '0' },
  { user_id: 'b', email: 'member@example.invalid', created_at: '2026-11-08T00:00:00Z', kind: 'transcription', model: 'gpt-transcribe', status: 'error', input_tokens: 0, output_tokens: 0, estimated_cost: '0.5', audio_seconds: '30.5' },
];
const tokenRows = [
  { user_id: 'a', email: rows[0].email, balance: '1240', streak: 8, last_check_in: '2026-11-10' },
  { user_id: 'b', email: rows[1].email, balance: 0, streak: 0, last_check_in: null },
];

function fixture({ signedIn = true, rpc } = {}) {
  const ids = ['adminData', 'adminStatus', 'adminSignIn', 'adminSignOut', 'adminRefresh', 'adminLanguage',
    'adminPeriod', 'adminKind', 'adminUserFilter', 'adminCalls', 'adminInputTokens', 'adminOutputTokens',
    'adminCost', 'adminAudioSeconds', 'adminUserRows', 'adminUsageRows', 'adminTokenRows'];
  const html = fs.readFileSync(path.join(publicDir, 'admin.html'), 'utf8');
  const nodes = new Map([...new Set([...ids, ...[...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])])].map(id => [id, new Element()]));
  let session = signedIn ? { user: { id: 'admin' } } : null;
  let authListener;
  const calls = [];
  const document = { getElementById: id => nodes.get(id), createElement: tag => new Element(tag), querySelectorAll: () => [] };
  const client = {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: listener => { authListener = listener; },
      signInWithOAuth: async options => { calls.push(options); return {}; },
      signOut: async () => { session = null; return {}; },
    },
    rpc: async name => { calls.push(name); return rpc ? rpc(name) : { data: name === 'admin_list_feedback' ? [] : name === 'admin_list_tokens' ? tokenRows : rows, error: null }; },
  };
  const controller = require('../public/admin.js').createAdminController({ client, document, t: key => key,
    getLocale: () => 'en-US', now: () => new Date('2026-11-08T12:00:00Z'), schedule: fn => fn(),
    redirectTo: 'https://app.example.invalid/admin' });
  return { nodes, calls, controller, setSession: next => { session = next; }, auth: (...args) => authListener(...args) };
}

test('admin page is independent and the main site exposes no admin link', () => {
  const html = fs.readFileSync(path.join(publicDir, 'admin.html'), 'utf8');
  assert.ok(!/src="(?:cloud|app)\.js"/.test(html));
  for (const script of ['supabase-config.js', 'i18n.js', 'usage-stats.js', 'admin.js']) assert.ok(html.includes(`src="${script}"`));
  assert.ok(!/href=["'][^"']*admin/.test(fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')));
  assert.ok(html.includes('api-ledger-table'));
});

test('admin distinguishes signed-out, forbidden and load failure states without exposing tokens', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const cases = [
    [{ signedIn: false }, 'admin.signInRequired'],
    [{ rpc: async () => ({ error: { code: '42501', message: 'Admin access required' } }) }, 'admin.denied'],
    [{ rpc: async () => ({ error: { code: '42804', message: 'Query type mismatch', token: 'PRIVATE_TOKEN' } }) }, 'admin.loadFailed'],
    [{ rpc: async () => { throw Object.assign(new Error('Network failure'), { code: 'NETWORK', token: 'PRIVATE_TOKEN' }); } }, 'admin.loadFailed'],
  ];
  for (const [options, expected] of cases) {
    const f = fixture(options); await f.controller.initialize();
    assert.equal(f.nodes.get('adminStatus').textContent, expected);
    f.controller.render();
    assert.equal(f.nodes.get('adminStatus').textContent, expected);
    assert.equal(f.nodes.get('adminData').classList.contains('hidden'), true);
    assert.equal(f.nodes.get('adminUserRows').children.length, 0);
    assert.equal(f.nodes.get('adminUsageRows').children.length, 0);
    if (options.signedIn === false) assert.equal(f.calls.length, 0);
  }
  assert.equal(logs.length, 2);
  assert.ok(JSON.stringify(logs).includes('42804'));
  assert.ok(JSON.stringify(logs).includes('Query type mismatch'));
  assert.ok(JSON.stringify(logs).includes('Network failure'));
  assert.ok(!JSON.stringify(logs).includes('PRIVATE_TOKEN'));
});

test('admin loads the protected RPC, displays totals and treats database text literally', async () => {
  const f = fixture(); await f.controller.initialize();
  assert.deepEqual(f.calls, ['admin_list_ai_usage', 'admin_list_tokens', 'admin_list_feedback']);
  assert.equal(f.nodes.get('adminData').classList.contains('hidden'), false);
  assert.equal(f.nodes.get('adminCalls').textContent, '2');
  assert.equal(f.nodes.get('adminInputTokens').textContent, '10');
  assert.equal(f.nodes.get('adminOutputTokens').textContent, '5');
  assert.equal(f.nodes.get('adminCost').textContent, 'US$0.750000');
  assert.equal(f.nodes.get('adminAudioSeconds').textContent, '30.5');
  assert.equal(f.nodes.get('adminUserRows').children.length, 2);
  assert.equal(f.nodes.get('adminUsageRows').children[0].children[1].textContent, rows[0].email);
  assert.equal(f.nodes.get('adminUsageRows').children[0].children[3].textContent, rows[0].model);
  assert.equal(f.nodes.get('adminTokenRows').children.length, 2);
  assert.deepEqual(f.nodes.get('adminTokenRows').children[0].children.map(cell => cell.textContent), [rows[0].email, '1,240', '8', '2026-11-10']);
  assert.equal(f.nodes.get('adminTokenRows').children[1].children[3].textContent, '—');
  for (const element of f.nodes.values()) assert.equal(element.htmlWrites, 0);
});

test('denied feedback RPC clears every admin table and does not expose cached feedback', async () => {
  const f = fixture({ rpc: async name => name === 'admin_list_feedback' ? { error: { code: '42501' } } : { data: rows } });
  await f.controller.initialize();
  assert.equal(f.nodes.get('adminStatus').textContent, 'admin.denied');
  assert.equal(f.nodes.get('adminData').classList.contains('hidden'), true);
  assert.equal(f.nodes.get('adminFeedbackRows').children.length, 0);
  assert.equal(f.nodes.get('adminFeedbackBody').textContent, '');
});

test('denied token RPC hides all admin data and clears cached token rows', async () => {
  const f = fixture({ rpc: async name => name === 'admin_list_tokens'
    ? { error: { code: '42501' } } : { data: rows } });
  await f.controller.initialize();
  assert.equal(f.nodes.get('adminStatus').textContent, 'admin.denied');
  assert.equal(f.nodes.get('adminData').classList.contains('hidden'), true);
  assert.equal(f.nodes.get('adminTokenRows').children.length, 0);
  assert.equal(f.nodes.get('adminUsageRows').children.length, 0);
});

test('token-only users can be filtered and token data is always rendered as text', async () => {
  const payload = '<img src=x onerror=alert(1)>';
  const f = fixture({ rpc: async name => ({ data: name === 'admin_list_tokens'
    ? [{ user_id: 'new-user', email: payload, balance: 'Infinity', streak: '<script>', last_check_in: payload }] : rows }) });
  await f.controller.initialize();
  assert.ok(f.nodes.get('adminUserFilter').children.some(option => option.value === 'new-user'));
  f.nodes.get('adminUserFilter').value = 'new-user'; f.controller.render();
  const row = f.nodes.get('adminTokenRows').children[0];
  assert.deepEqual(row.children.map(cell => cell.textContent), [payload, '—', '—', '—']);
  for (const cell of row.children) { assert.equal(cell.htmlWrites, 0); assert.equal(cell.children.length, 0); }
  assert.equal(f.nodes.get('adminCalls').textContent, '0');
});

test('sign-out during the token RPC discards the pending response and clears both tables', async () => {
  let resolve, started;
  const waiting = new Promise(done => { started = done; });
  const f = fixture({ rpc: name => name === 'admin_list_tokens'
    ? (started(), new Promise(done => { resolve = done; })) : Promise.resolve({ data: rows }) });
  const initializing = f.controller.initialize(); await waiting;
  await f.controller.signOut(); resolve({ data: tokenRows }); await initializing;
  assert.equal(f.nodes.get('adminData').classList.contains('hidden'), true);
  assert.equal(f.nodes.get('adminTokenRows').children.length, 0);
  assert.equal(f.nodes.get('adminUsageRows').children.length, 0);
});

test('admin filtering updates totals and details while user spend remains a labeled lifetime total', async () => {
  const f = fixture(); await f.controller.initialize();
  f.nodes.get('adminKind').value = 'transcription'; f.controller.render();
  assert.equal(f.nodes.get('adminCalls').textContent, '1');
  assert.equal(f.nodes.get('adminCost').textContent, 'US$0.500000');
  assert.equal(f.nodes.get('adminUsageRows').children.length, 1);
  assert.equal(f.nodes.get('adminUserRows').children.length, 2);
  f.nodes.get('adminUserFilter').value = 'a'; f.controller.render();
  assert.equal(f.nodes.get('adminCalls').textContent, '0');
  assert.equal(f.nodes.get('adminUserRows').children.length, 1);
  assert.equal(f.nodes.get('adminUserRows').children[0].children[2].textContent, 'US$0.250000');
});

test('admin sign-in requests Google account selection and sign-out clears pending data', async () => {
  let resolve, started;
  const waiting = new Promise(done => { started = done; });
  const f = fixture({ rpc: () => { started(); return new Promise(done => { resolve = done; }); } });
  const initializing = f.controller.initialize(); await waiting;
  await f.controller.signOut();
  resolve({ data: rows }); await initializing;
  assert.equal(f.nodes.get('adminData').classList.contains('hidden'), true);
  assert.equal(f.nodes.get('adminUsageRows').children.length, 0);
  await f.controller.signIn();
  assert.deepEqual(f.calls.at(-1), { provider: 'google', options: {
    redirectTo: 'https://app.example.invalid/admin', queryParams: { prompt: 'select_account' },
  } });
});

test('all admin text keys exist in four locales and contain intact Unicode', () => {
  const html = fs.readFileSync(path.join(publicDir, 'admin.html'), 'utf8');
  const js = fs.readFileSync(path.join(publicDir, 'admin.js'), 'utf8');
  const keys = [...new Set([
    ...[...html.matchAll(/data-admin-i18n="(admin\.[A-Za-z]+)"/g)].map(match => match[1]),
    ...[...js.matchAll(/['"](admin\.[A-Za-z]+)['"]/g)].map(match => match[1]),
  ])];
  assert.ok(keys.length > 10);
  for (const locale of ['zh-TW', 'en-US', 'ja-JP', 'ar']) {
    const messages = JSON.parse(fs.readFileSync(path.join(publicDir, `locales/${locale}.json`), 'utf8')).messages;
    for (const key of keys) { assert.equal(typeof messages[key], 'string', `${locale} ${key}`); assert.ok(!/\?{2,}/.test(messages[key])); }
  }
});
