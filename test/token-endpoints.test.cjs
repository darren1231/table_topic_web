const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertTiming } = require('./helpers/server-timing.cjs');
const { fakeSigningSecret, fakeAuthorization, fakeUserId } = require('./helpers/signing.cjs');
const env = { USAGE_SIGNING_SECRET: fakeSigningSecret, SUPABASE_URL: 'https://database.example.invalid', SUPABASE_PUBLISHABLE_KEY: 'FAKE-public-key' };
const status = { balance: 3000, streak: 0, checkedIn: false, canMakeup: true, makeupCost: 200, reward: 10 };
function fixture(options = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    if (options.fail) throw new Error(`FAKE-network-error ${fakeSigningSecret}`);
    const name = url.split('/').at(-1);
    if (name === 'get_my_token_status') return Response.json(options.statusBody ?? status, { status: options.statusCode ?? 200 });
    if (name === 'makeup_yesterday') return Response.json(options.makeupBody ?? { ...status, balance: 2800, streak: 1, canMakeup: false, reward: 20 }, { status: options.makeupCode ?? 200 });
    if (name === 'exchange_tokens') return Response.json(options.exchangeBody ?? {
      units: body.p_units, tokensSpent: body.p_units * 1000, creditAdded: body.p_units * body.p_rate_usd,
      rateUsd: body.p_rate_usd, status: { ...status, balance: 3000 - body.p_units * 1000 },
    }, { status: options.exchangeCode ?? 200 });
    throw new Error('Unexpected fake URL');
  };
  return { calls, run: async (action, { method = action === 'status' ? 'GET' : 'POST', auth = fakeAuthorization, body = { units: 2 }, rawBody, overrides = {} } = {}) => {
    const { handleTokenStatus, handleTokenMakeup, handleTokenExchange } = require('../api/_lib/tokens.js');
    const handle = { status: handleTokenStatus, makeup: handleTokenMakeup, exchange: handleTokenExchange }[action];
    return handle({ request: new Request(`https://app.example.invalid/api/tokens/${action}`, {
      method, headers: { Authorization: auth, 'Content-Type': 'application/json' },
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: rawBody ?? JSON.stringify(body) }),
    }), env: { ...env, ...overrides }, fetch });
  } };
}

test('token status authenticates through one RPC and returns only status data with numeric timing', async () => {
  const f = fixture();
  const response = await f.run('status');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), status);
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].url.endsWith('/rpc/get_my_token_status'));
  assert.deepEqual(f.calls[0].body, {});
  assert.equal(new Headers(f.calls[0].init.headers).get('Authorization'), fakeAuthorization);
  assert.equal(new Headers(f.calls[0].init.headers).get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
  assertTiming(response, ['status', 'total']);
});

test('makeup calls only yesterday RPC with no user-controlled date and returns the new status', async () => {
  const f = fixture();
  const response = await f.run('makeup', { body: { day: '1900-01-01', user_id: 'FAKE-other-user' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).balance, 2800);
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].url.endsWith('/rpc/makeup_yesterday'));
  assert.deepEqual(f.calls[0].body, {});
  assertTiming(response, ['makeup', 'total']);
});

test('exchange verifies identity before signing and ignores all client-supplied rates and identities', async () => {
  const f = fixture();
  const response = await f.run('exchange', { body: { units: 2, rate: 999, user_id: 'FAKE-other-user', signature: 'FAKE-forgery' }, overrides: { TOKEN_EXCHANGE_USD_PER_1000: '0.025' } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.creditAdded, 0.05);
  assert.equal(result.status.balance, 1000);
  assert.deepEqual(f.calls.map(call => call.url.split('/').at(-1)), ['get_my_token_status', 'exchange_tokens']);
  const args = f.calls[1].body;
  assert.equal(args.p_units, 2); assert.equal(args.p_rate_usd, 0.025);
  const { exchangePayload } = require('../api/_lib/signing.js');
  const { createHmac } = require('node:crypto');
  assert.equal(args.p_signature, createHmac('sha256', fakeSigningSecret).update(exchangePayload(fakeUserId, args)).digest('hex'));
  for (const secret of [fakeSigningSecret, args.p_signature, args.p_nonce]) assert.ok(!JSON.stringify(result).includes(secret));
  assertTiming(response, ['status', 'exchange', 'total']);
});

test('token endpoints return allowlisted business errors but never raw database bodies', async () => {
  for (const [action, reason] of [['makeup', 'makeup_unavailable'], ['makeup', 'insufficient_tokens'], ['exchange', 'insufficient_tokens']]) {
    const f = fixture({ [`${action}Body`]: { code: '22023', message: reason }, [`${action}Code`]: 400 });
    const response = await f.run(action);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: reason });
  }
  const f = fixture({ makeupBody: { code: '22023', message: `FAKE-private-error ${fakeSigningSecret}` }, makeupCode: 400 });
  const response = await f.run('makeup');
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_input' });
});

test('token Web entry points export their specified HTTP methods', async () => {
  for (const [name, verb] of [['status', 'GET'], ['makeup', 'POST'], ['exchange', 'POST']]) {
    const entry = require(`../api/tokens/${name}.js`)[verb];
    const response = await entry(new Request(`https://app.example.invalid/api/tokens/${name}`, { method: verb === 'GET' ? 'POST' : 'GET' }));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), verb);
  }
});

test('all token endpoints enforce methods, Bearer credentials and valid configuration before network access', async () => {
  for (const action of ['status', 'makeup', 'exchange']) {
    const wrong = fixture();
    const badMethod = await wrong.run(action, { method: action === 'status' ? 'POST' : 'GET' });
    assert.equal(badMethod.status, 405); assert.equal(wrong.calls.length, 0);
    for (const auth of ['', 'Bearer', 'Basic FAKE', 'Bearer two values']) {
      const f = fixture(); assert.equal((await f.run(action, { auth })).status, 401); assert.equal(f.calls.length, 0);
    }
    for (const overrides of [{ USAGE_SIGNING_SECRET: undefined }, { USAGE_SIGNING_SECRET: 'FAKE-short' },
      ...['-1', 'NaN', 'Infinity', '', 'bad'].map(value => ({ TOKEN_EXCHANGE_USD_PER_1000: value }))]) {
      const f = fixture(); const response = await f.run(action, { overrides });
      assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'configuration_error' });
      assert.equal(f.calls.length, 0);
    }
  }
});

test('auth failures and RPC outages stop exchange before signing and expose only fixed errors', async () => {
  for (const action of ['status', 'makeup', 'exchange']) {
    const step = action === 'makeup' ? 'makeup' : 'status';
    for (const [code, http] of [['PGRST301', 400], ['42501', 400], ['PGRST302', 401], ['PGRST303', 403], ['28000', 400], ['28P01', 400]]) {
      const f = fixture({ [`${step}Body`]: { code, message: fakeSigningSecret }, [`${step}Code`]: http });
      const response = await f.run(action);
      assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'unauthorized' });
      assert.equal(f.calls.length, 1);
      assertTiming(response, action === 'exchange' ? ['status', 'exchange', 'total'] : [action, 'total']);
    }
    for (const options of [{ fail: true }, { [`${step}Code`]: 500, [`${step}Body`]: { message: fakeSigningSecret } }, { [`${step}Body`]: { balance: -1 } }]) {
      const f = fixture(options); const response = await f.run(action);
      assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'tokens_unavailable' });
      assert.equal(f.calls.length, 1);
    }
  }
});

test('exchange validates positive integer units only after authenticated status and ignores unverified subjects', async () => {
  for (const body of [{}, null, [], { units: 0 }, { units: -1 }, { units: 1.5 }, { units: '1' }, { units: 2147484 }]) {
    const f = fixture(); const response = await f.run('exchange', { body });
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'invalid_input' });
    assert.equal(f.calls.length, 1);
  }
  const invalid = fixture(); assert.equal((await invalid.run('exchange', { rawBody: '{bad-json' })).status, 400);
  const badSubject = fixture(); assert.equal((await badSubject.run('exchange', { auth: 'Bearer FAKE-not-a-jwt' })).status, 401);
  assert.equal(badSubject.calls.length, 1);
});

test('exchange defaults to 0.01, supports zero and rejects overflowing configuration and malformed results', async () => {
  for (const [overrides, rate] of [[{}, 0.01], [{ TOKEN_EXCHANGE_USD_PER_1000: '0' }, 0]]) {
    const f = fixture(); assert.equal((await f.run('exchange', { overrides })).status, 200);
    assert.equal(f.calls[1].body.p_rate_usd, rate);
  }
  const overflow = fixture(); assert.equal((await overflow.run('exchange', { overrides: { TOKEN_EXCHANGE_USD_PER_1000: '1e308' } })).status, 503);
  assert.equal(overflow.calls.length, 1);
  for (const exchangeBody of [{}, { units: 2, tokensSpent: 2000, creditAdded: -1, rateUsd: 0.01, status },
    { units: 2, tokensSpent: 2000, creditAdded: 0.02, rateUsd: 0.01, status: null }]) {
    const f = fixture({ exchangeBody }); const response = await f.run('exchange');
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'tokens_unavailable' });
  }
});
