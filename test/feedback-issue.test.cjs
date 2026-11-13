const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DISCLAIMER } = require('../public/feedback-issue-draft.js');
// All credentials in this file are deliberately fake; fetch never uses the network.
const env = { SUPABASE_URL: 'https://fake-feedback.supabase.invalid', SUPABASE_PUBLISHABLE_KEY: 'FAKE-publishable-key', GITHUB_ISSUES_TOKEN: 'FAKE-github-token' };
const reservation = { id: 12, created_at: '2026-11-13T04:00:00Z', email: 'reporter@example.invalid', issue_pending_token: '00000000-0000-4000-8000-000000000012' };
const draft = { id: 12, title: 'A bug report', body: `## Report\n> ${DISCLAIMER}\n> A bug`, labels: ['feedback', 'bug'] };
const issue = { number: 42, html_url: 'https://github.com/darren1231/table_topic_web/issues/42', body: '<!-- table-topic-feedback:12 -->' };
function fixture(handler) {
  const calls = [], logs = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined }; calls.push(call);
    const custom = handler ? await handler(call, calls) : undefined;
    if (custom !== undefined) return custom;
    if (call.url.endsWith('/admin_begin_issue')) return Response.json(reservation);
    if (call.url.endsWith('/admin_finish_issue') || call.url.endsWith('/admin_cancel_issue')) return Response.json(null);
    if (call.url.includes('/issues?')) return Response.json([]);
    if (init.method === 'GET' && call.url.includes('/labels/')) return Response.json({});
    if (call.url.endsWith('/issues') && init.method === 'POST') return Response.json(issue, { status: 201 });
    throw new Error(`Unexpected fake fetch: ${call.url}`);
  };
  return { calls, logs, run: async ({ body = draft, rawBody, auth = 'Bearer FAKE-user-token', method = 'POST', overrides = {} } = {}) => {
    const { handleFeedbackIssue } = require('../api/_lib/feedback-issue.js');
    return handleFeedbackIssue({ request: new Request('https://app.example.invalid/api/feedback/issue', {
      method, headers: { Authorization: auth, 'Content-Type': 'application/json' },
      ...(method === 'GET' ? {} : { body: rawBody ?? JSON.stringify(body) }),
    }), env: { ...env, ...overrides }, fetch, logger: { error: (...values) => logs.push(values) } });
  } };
}

test('feedback issue rejects methods and malformed Bearer before network access', async () => {
  const wrong = fixture(); assert.equal((await wrong.run({ method: 'GET' })).status, 405); assert.equal(wrong.calls.length, 0);
  for (const auth of ['', 'Basic FAKE', 'Bearer', 'Bearer two tokens']) {
    const f = fixture(); assert.equal((await f.run({ auth })).status, 401); assert.equal(f.calls.length, 0);
  }
});

test('authorized issue creation searches first, appends server marker and records the same reservation token', async () => {
  const f = fixture(); const response = await f.run();
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { number: 42, url: issue.html_url, reused: false });
  const begin = f.calls[0]; assert.ok(begin.url.endsWith('/admin_begin_issue')); assert.deepEqual(begin.body, { p_id: 12 });
  assert.equal(new Headers(begin.init.headers).get('Authorization'), 'Bearer FAKE-user-token');
  assert.equal(new Headers(begin.init.headers).get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
  const search = f.calls[1]; const query = new URL(search.url).searchParams;
  assert.equal(query.get('state'), 'all'); assert.equal(query.get('since'), reservation.created_at); assert.equal(query.get('per_page'), '100');
  const post = f.calls.find(call => call.url.endsWith('/issues') && call.init.method === 'POST');
  assert.deepEqual(post.body, { title: draft.title, body: `${draft.body}\n\n<!-- table-topic-feedback:12 -->`, labels: draft.labels });
  for (const call of f.calls.filter(call => call.url.startsWith('https://api.github.com/'))) {
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get('Authorization'), `Bearer ${env.GITHUB_ISSUES_TOKEN}`);
    assert.equal(headers.get('Accept'), 'application/vnd.github+json'); assert.equal(headers.get('X-GitHub-Api-Version'), '2022-11-28');
    assert.ok(headers.get('User-Agent')); assert.ok(call.init.signal instanceof AbortSignal);
  }
  assert.deepEqual(f.calls.at(-1).body, { p_id: 12, p_token: reservation.issue_pending_token, p_number: 42, p_url: issue.html_url });
  assert.match(response.headers.get('Server-Timing'), /^reserve;dur=\d+\.\d, github;dur=\d+\.\d, record;dur=\d+\.\d, cancel;dur=\d+\.\d, total;dur=\d+\.\d$/);
});

test('invalid drafts release the reservation with identifiable 400 errors before any GitHub request', async () => {
  for (const [change, expected] of [[{ title: '' }, 'invalid_title'], [{ title: '😀'.repeat(201) }, 'invalid_title'],
    [{ body: '字'.repeat(60001) }, 'invalid_body'], [{ labels: ['bad'] }, 'invalid_labels'],
    [{ body: 'Missing statement' }, 'missing_disclaimer'], [{ title: 'REPORTER@EXAMPLE.INVALID' }, 'feedback_contains_email'],
    [{ body: `${draft.body}\nreporter＠example.invalid` }, 'feedback_contains_email'],
    [{ body: `${draft.body}\n<!-- table-topic-feedback:12 -->` }, 'reserved_issue_marker']]) {
    const f = fixture(); const response = await f.run({ body: { ...draft, ...change } });
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: expected });
    assert.deepEqual(f.calls.map(call => call.url.split('/').at(-1)), ['admin_begin_issue', 'admin_cancel_issue']);
    assert.deepEqual(f.calls.at(-1).body, { p_id: 12, p_token: reservation.issue_pending_token });
  }
});

test('only verified admins reach GitHub and unavailable configuration releases the reservation', async () => {
  for (const [code, http, expected] of [['42501', 403, 403], ['PGRST301', 401, 401], ['PGRST302', 400, 401], ['28P01', 400, 401]]) {
    const f = fixture(call => call.url.endsWith('/admin_begin_issue') ? Response.json({ code, message: 'FAKE-private-message' }, { status: http }) : undefined);
    assert.equal((await f.run()).status, expected); assert.equal(f.calls.length, 1);
  }
  for (const reason of ['feedback_issue_pending', 'feedback_issue_exists']) {
    const f = fixture(() => Response.json({ code: '55000', message: reason }, { status: 400 }));
    const response = await f.run(); assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: reason });
    assert.equal(f.calls.length, 1);
  }
  for (const overrides of [{ GITHUB_ISSUES_TOKEN: undefined }, { GITHUB_ISSUES_TOKEN: '' }, { GITHUB_ISSUES_REPO: 'owner/../evil' }]) {
    const f = fixture(); const response = await f.run({ overrides });
    assert.equal(response.status, 503); assert.ok(['github_not_configured', 'configuration_error'].includes((await response.json()).error));
    assert.equal(f.calls.length, 2); assert.ok(f.calls.at(-1).url.endsWith('/admin_cancel_issue'));
  }
});

test('a timed-out POST that actually created an issue is reused on retry without a second POST', async () => {
  let remoteIssue = null, posts = 0;
  const f = fixture(call => {
    if (call.url.includes('/issues?')) return Response.json(remoteIssue ? [remoteIssue] : []);
    if (call.url.endsWith('/issues') && call.init.method === 'POST') { posts++; remoteIssue = { ...issue, body: call.body.body }; throw new DOMException('FAKE timeout', 'TimeoutError'); }
  });
  assert.equal((await f.run()).status, 502); assert.ok(f.calls.at(-1).url.endsWith('/admin_cancel_issue'));
  const retry = await f.run(); assert.equal(retry.status, 200); assert.equal((await retry.json()).reused, true); assert.equal(posts, 1);
});

test('a failed finish releases only its own token and retry reuses the already created issue', async () => {
  let remoteIssue = null, finishes = 0, posts = 0;
  const f = fixture(call => {
    if (call.url.includes('/issues?')) return Response.json(remoteIssue ? [remoteIssue] : []);
    if (call.url.endsWith('/issues') && call.init.method === 'POST') { posts++; remoteIssue = { ...issue, body: call.body.body }; return Response.json(remoteIssue, { status: 201 }); }
    if (call.url.endsWith('/admin_finish_issue') && finishes++ === 0) return Response.json({ code: 'XX000', message: env.GITHUB_ISSUES_TOKEN }, { status: 500 });
  });
  const failed = await f.run(); assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { error: 'issue_record_failed' });
  assert.deepEqual(f.calls.at(-1).body, { p_id: 12, p_token: reservation.issue_pending_token });
  const retry = await f.run(); assert.equal(retry.status, 200); assert.equal((await retry.json()).reused, true); assert.equal(posts, 1);
});

test('search follows up to five fixed-origin pages, skips PRs and exact markers cannot match another ID', async () => {
  const f = fixture(call => {
    if (!call.url.includes('/issues?')) return;
    const page = Number(new URL(call.url).searchParams.get('page'));
    return Response.json(page === 3 ? [issue] : Array.from({ length: 100 }, (_, i) => ({ ...issue, number: i + 100,
      body: page === 1 ? '<!-- table-topic-feedback:123 -->' : issue.body, ...(page === 2 ? { pull_request: {} } : {}) })));
  });
  const result = await f.run(); assert.equal(result.status, 200); assert.equal((await result.json()).reused, true);
  assert.deepEqual(f.calls.filter(call => call.url.includes('/issues?')).map(call => new URL(call.url).searchParams.get('page')), ['1', '2', '3']);
  assert.equal(f.calls.filter(call => call.init.method === 'POST' && call.url.endsWith('/issues')).length, 0);
  const capped = fixture(call => call.url.includes('/issues?') ? Response.json(Array.from({ length: 100 }, () => ({ body: 'Unrelated' }))) : undefined);
  assert.equal((await capped.run()).status, 200); assert.equal(capped.calls.filter(call => call.url.includes('/issues?')).length, 5);
});

test('missing labels are created first and concurrent label creation is verified before continuing', async () => {
  let labelGets = 0;
  const f = fixture(call => {
    if (call.init.method === 'GET' && call.url.includes('/labels/')) {
      labelGets++; return Response.json({}, { status: labelGets === 1 ? 404 : 200 });
    }
    if (call.url.endsWith('/labels') && call.init.method === 'POST') return Response.json({}, { status: 422 });
  });
  assert.equal((await f.run()).status, 200);
  assert.equal(f.calls.filter(call => call.url.endsWith('/labels')).length, 1);
  assert.deepEqual(f.calls.find(call => call.url.endsWith('/labels')).body, { name: 'feedback', color: 'd4c5f9' });
  const created = fixture(call => {
    if (call.init.method === 'GET' && call.url.includes('/labels/')) return Response.json({}, { status: 404 });
    if (call.url.endsWith('/labels')) return Response.json({}, { status: 201 });
  });
  assert.equal((await created.run()).status, 200); assert.equal(created.calls.filter(call => call.url.endsWith('/labels')).length, 2);
});

test('GitHub errors, malformed results and timeouts cancel without leaking upstream bodies or credentials', async t => {
  const delays = []; t.mock.method(AbortSignal, 'timeout', ms => { delays.push(ms); return new AbortController().signal; });
  for (const stage of ['search', 'labels', 'post', 'malformed']) {
    const f = fixture(call => {
      if (stage === 'search' && call.url.includes('/issues?') || stage === 'labels' && call.url.includes('/labels/')) return Response.json({ message: env.GITHUB_ISSUES_TOKEN }, { status: 500 });
      if (stage === 'post' && call.url.endsWith('/issues')) throw new Error(`FAKE upstream failure ${env.GITHUB_ISSUES_TOKEN}`);
      if (stage === 'malformed' && call.url.endsWith('/issues')) return Response.json({ number: 42, html_url: 'https://evil.invalid/FAKE' });
    });
    const response = await f.run(); assert.equal(response.status, 502); assert.deepEqual(await response.json(), { error: 'github_error' });
    assert.ok(f.calls.at(-1).url.endsWith('/admin_cancel_issue'));
    assert.ok(!JSON.stringify(f.logs).includes(env.GITHUB_ISSUES_TOKEN));
  }
  assert.ok(delays.length); assert.ok(delays.every(ms => ms === 60000));
});

test('failed cancellation cannot clear a replacement token or expose credentials in logs', async () => {
  const f = fixture(call => {
    if (call.url.includes('/issues?')) throw new Error(env.GITHUB_ISSUES_TOKEN);
    if (call.url.endsWith('/admin_cancel_issue')) return Response.json({ code: '55000', message: 'feedback_issue_token_mismatch' }, { status: 400 });
  });
  assert.equal((await f.run()).status, 502);
  assert.deepEqual(f.calls.at(-1).body, { p_id: 12, p_token: reservation.issue_pending_token });
  assert.deepEqual(f.logs, [['Feedback issue reservation release failed']]);
});

test('unexpected upstream error properties cannot become public response codes or statuses', async () => {
  const f = fixture(call => { if (call.url.includes('/issues?')) throw Object.assign(new Error('FAKE'), { publicCode: env.GITHUB_ISSUES_TOKEN, status: 418 }); });
  const response = await f.run(); assert.equal(response.status, 502); assert.deepEqual(await response.json(), { error: 'github_error' });
});

test('invalid IDs and JSON never reserve and the Web entry exports POST without unrelated AI configuration', async () => {
  for (const body of [null, [], {}, { id: -1 }, { id: 0 }, { id: 1.5 }, { id: '9223372036854775808' }]) {
    const f = fixture(); assert.equal((await f.run({ body })).status, 400); assert.equal(f.calls.length, 0);
  }
  const bad = fixture(); assert.equal((await bad.run({ rawBody: '{bad' })).status, 400); assert.equal(bad.calls.length, 0);
  const entry = require('../api/feedback/issue.js');
  const response = await entry.POST(new Request('https://app.example.invalid/api/feedback/issue'));
  assert.equal(response.status, 405); assert.equal(response.headers.get('Allow'), 'POST');
});
