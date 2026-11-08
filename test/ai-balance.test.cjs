const assert = require('node:assert/strict');
const { test } = require('node:test');
const env = { SUPABASE_URL: 'https://database.example.invalid', SUPABASE_PUBLISHABLE_KEY: 'public-placeholder' };
const handle = args => require('../api/_lib/balance.js').handleBalance(args);

async function run({ method = 'GET', auth = 'Bearer user-placeholder', authStatus = 200, user = { id: 'member' }, spent = '0.25', balanceStatus = 200, credit, fail = false } = {}) {
  const calls = [];
  const response = await handle({
    request: new Request('https://app.example.invalid/api/ai/balance', { method, headers: { Authorization: auth } }),
    env: { ...env, ...(credit === undefined ? {} : { AI_USER_CREDIT_USD: credit }) },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (fail) throw new Error('PRIVATE_NETWORK_BODY');
      return url.endsWith('/auth/v1/user') ? Response.json(user, { status: authStatus })
        : Response.json([{ spent }], { status: balanceStatus });
    },
  });
  return { response, calls };
}

test('balance is GET-only and rejects missing credentials before service access', async () => {
  const wrong = await run({ method: 'POST' });
  assert.equal(wrong.response.status, 405); assert.equal(wrong.response.headers.get('Allow'), 'GET');
  assert.equal(wrong.calls.length, 0);
  for (const auth of ['', 'Basic placeholder', 'Bearer two values']) {
    const result = await run({ auth }); assert.equal(result.response.status, 401); assert.equal(result.calls.length, 0);
  }
});

test('balance verifies identity and forwards user authorization and apikey to both Supabase endpoints', async () => {
  const { response, calls } = await run();
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { spent: 0.25, credit: 1, balance: 0.75, exhausted: false });
  assert.deepEqual(calls.map(call => [call.url, call.init.method]), [
    [`${env.SUPABASE_URL}/auth/v1/user`, 'GET'], [`${env.SUPABASE_URL}/rest/v1/rpc/get_my_ai_balance`, 'POST'],
  ]);
  for (const call of calls) {
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get('Authorization'), 'Bearer user-placeholder');
    assert.equal(headers.get('apikey'), 'public-placeholder');
  }
  assert.equal(calls[1].init.body, '{}');
});

test('balance returns exhausted with a successful status even at zero or exceeded credit, without AI keys', async () => {
  for (const [spent, credit] of [['1', '1'], ['2', '1'], ['0', '0']]) {
    const { response } = await run({ spent, credit });
    assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(data.exhausted, true); assert.equal(data.balance, 0);
  }
});

test('balance rejects unverified sessions without calling the balance RPC', async () => {
  for (const options of [{ authStatus: 401 }, { user: {} }, { fail: true }]) {
    const { response, calls } = await run(options); assert.equal(response.status, 401); assert.equal(calls.length, 1);
    assert.deepEqual(await response.json(), { error: 'unauthorized' });
  }
});

test('balance fails closed for malformed totals, failed RPCs and invalid credit without leaking raw errors', async () => {
  for (const options of [{ spent: null }, { spent: '-1' }, { spent: 'NaN' }, { balanceStatus: 500 }, { credit: '-1' }, { credit: 'Infinity' }]) {
    const { response } = await run(options); assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('PRIVATE'));
  }
});

test('balance exports a GET Web handler', async () => {
  const { GET } = require('../api/ai/balance.js');
  assert.ok(await GET(new Request('https://app.example.invalid/api/ai/balance', { method: 'POST' })) instanceof Response);
});
