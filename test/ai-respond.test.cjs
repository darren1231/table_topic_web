const assert = require('node:assert/strict');
const { fakeSigningSecret, fakeUserId, fakeAuthorization, fakeJwt } = require('./helpers/signing.cjs');
const { test } = require('node:test');
const { assertTiming } = require('./helpers/server-timing.cjs');

const env = { USAGE_SIGNING_SECRET: fakeSigningSecret,
  CHATGPT_PREVIEW_KEY: 'preview-placeholder',
  CHATGPT_PRODUCTION_KEY: 'production-placeholder',
  SUPABASE_URL: 'https://database.example.invalid',
  SUPABASE_PUBLISHABLE_KEY: 'public-placeholder',
};
const authorization = fakeAuthorization;
const body = { instructions: 'Coach the speaker', input: 'My practice answer', kind: 'analysis' };
const usage = { input_tokens: 1_000_000, output_tokens: 500_000 };
const handleRespond = args => require('../api/_lib/respond.js').handleRespond(args);

function request(value = body, options = {}) {
  const method = options.method || 'POST';
  return new Request('https://app.example.invalid/api/ai/respond', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: authorization, ...options.headers },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: options.rawBody ?? JSON.stringify(value) }),
  });
}

function fixture(options = {}) {
  const calls = [], logs = [];
  const fetch = async (url, init) => {
    const entry = { url, method: init.method, headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : null, signal: init.signal };
    calls.push(entry);
    if (url.endsWith('/rpc/get_my_ai_balance')) {
      if (options.balanceInvalidJson) return new Response('invalid-json', { status: options.balanceStatus ?? 200 });
      if (options.balanceThrows) throw new Error('Simulated balance failure');
      return Response.json(options.balanceBody ?? [{ spent: options.spent ?? '0' }], { status: options.balanceStatus ?? 200 });
    }
    if (url === 'https://api.openai.com/v1/responses') {
      if (options.honorAbort) init.signal?.throwIfAborted();
      if (options.openaiThrows) throw options.openaiThrows;
      if (options.openaiInvalidJson) return new Response('not-json', { status: 200 });
      return Response.json(options.openaiBody ?? { output_text: 'A useful coaching response', usage }, { status: options.openaiStatus ?? 200 });
    }
    if (url.endsWith('/rpc/record_ai_usage')) {
      if (options.recordThrows) throw options.recordThrows;
      return Response.json(options.recordBody ?? {
        id: '00000000-0000-0000-0000-000000000002',
        checkIn: entry.body.p_kind === 'analysis' && entry.body.p_status === 'success'
          ? { checkedIn: true, reward: 10, streak: 1, balance: 10 }
          : { checkedIn: false, reward: 0, streak: 0, balance: 0 },
      }, { status: options.recordStatus ?? 200 });
    }
    throw new Error('Unexpected fake fetch URL');
  };
  return {
    calls, logs, fetch,
    run: (req = request(), overrides = {}) => handleRespond({
      request: req, env: { ...env, ...overrides }, fetch,
      logger: { error: (...args) => logs.push(args.join(' ')) },
    }),
  };
}

const aiCalls = f => f.calls.filter(call => call.url === 'https://api.openai.com/v1/responses');
const records = f => f.calls.filter(call => call.url.endsWith('/rpc/record_ai_usage'));

test('respond returns only the database check-in result without calculating rewards on the server', async () => {
  const checkIn = { checkedIn: true, reward: 100, streak: 8, balance: 1240 };
  const f = fixture({ recordBody: { id: 'FAKE-unused-record-id', checkIn: { ...checkIn, secret: 'FAKE-must-not-appear' } } });
  const result = await (await f.run()).json();
  assert.deepEqual(result.checkIn, checkIn);
  assert.ok(!JSON.stringify(result).includes('FAKE-must-not-appear'));
  const failed = fixture({ recordStatus: 500 });
  const failedResult = await (await failed.run()).json();
  assert.equal(failedResult.checkIn, null);
  assert.equal(failedResult.balance, null);
  assert.equal(failedResult.text, 'A useful coaching response');
  const questions = fixture();
  const questionResult = await (await questions.run(request({ ...body, kind: 'questions' }))).json();
  assert.deepEqual(questionResult.checkIn, { checkedIn: false, reward: 0, streak: 0, balance: 0 });
});

test('respond does not claim a reward or balance when the accounting response is malformed', async () => {
  for (const recordBody of [{ checkIn: null }, { checkIn: { checkedIn: true, reward: -1, streak: 1, balance: 10 } },
    { checkIn: { checkedIn: 'yes', reward: 10, streak: 1, balance: 10 } }, 'FAKE-old-uuid-result']) {
    const f = fixture({ recordBody });
    const response = await f.run();
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.checkIn, null);
    assert.equal(result.balance, null);
    assert.equal(result.text, 'A useful coaching response');
    assert.equal(f.logs.length, 1);
  }
});

test('respond signs success and upstream-error records with fresh nonces and no secrets in responses', async () => {
  const nonces = new Set();
  for (const options of [{}, { openaiStatus: 500 }]) {
    const f = fixture(options);
    const response = await f.run();
    const entry = records(f)[0].body;
    assert.match(entry.p_signature ?? '', /^[a-f0-9]{64}$/);
    const { createHmac } = require('node:crypto');
    const { usagePayload } = require('../api/_lib/signing.js');
    assert.equal(entry.p_signature, createHmac('sha256', fakeSigningSecret).update(usagePayload(fakeUserId, entry)).digest('hex'));
    assert.ok(Math.abs(Date.now() - Date.parse(entry.p_issued_at)) < 5000);
    nonces.add(entry.p_nonce);
    const text = await response.text();
    for (const privateValue of [fakeSigningSecret, entry.p_signature, entry.p_nonce]) assert.ok(!text.includes(privateValue));
    assert.equal(f.calls.filter(call => call.url.startsWith(env.SUPABASE_URL)).length, 2);
  }
  assert.equal(nonces.size, 2);
});

test('respond rejects non-POST requests before any service access', async () => {
  const f = fixture();
  for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await f.run(request(body, { method }));
    assert.ok(response instanceof Response);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'POST');
  }
  assert.equal(f.calls.length, 0);
});

test('respond requires a nonempty Bearer credential before any service access', async () => {
  for (const header of ['', 'Bearer', 'Bearer ', 'Basic not-a-token', 'Bearer two values']) {
    const f = fixture();
    const response = await f.run(request(body, { headers: { Authorization: header } }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'unauthorized' });
    assert.equal(f.calls.length, 0);
  }
});

test('respond authenticates via the balance RPC and rejects auth errors without OpenAI', async () => {
  for (const options of [{ balanceStatus: 401 }, { balanceStatus: 403 }, { balanceStatus: 401, balanceInvalidJson: true },
    ...['42501', 'PGRST301', 'PGRST302', 'PGRST303', '28000', '28P01'].map(code => ({ balanceStatus: 400, balanceBody: { code } }))]) {
    const f = fixture(options);
    const response = await f.run();
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'unauthorized' });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].method, 'POST');
    assert.ok(f.calls[0].url.endsWith('/rpc/get_my_ai_balance'));
    assert.equal(aiCalls(f).length, 0);
  }
});

test('respond refuses exhausted and zero credit without calling OpenAI or recording usage', async () => {
  for (const [spent, credit] of [['1', '1'], ['1.1', '1'], ['0', '0']]) {
    const f = fixture({ spent });
    const response = await f.run(request(), { AI_USER_CREDIT_USD: credit });
    assert.equal(response.status, 402);
    assert.deepEqual(await response.json(), { error: 'credit_exhausted' });
    assert.equal(f.calls.length, 1);
    assert.equal(aiCalls(f).length, 0);
    assert.equal(records(f).length, 0);
  }
});

test('respond validates JSON, combined length and text-only kinds after auth and credit checks', async () => {
  const requests = [
    request({ ...body, input: 'x'.repeat(60_001) }), request({ ...body, kind: 'transcription' }),
    request({ ...body, kind: 'unknown' }), request({ ...body, instructions: null }), request(null),
    request(body, { rawBody: '{invalid-json' }),
  ];
  for (const req of requests) {
    const f = fixture();
    const response = await f.run(req);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_input' });
    assert.equal(f.calls.length, 1);
  }
});

test('respond fails closed for missing selected keys or invalid numeric configuration', async () => {
  for (const overrides of [
    { USAGE_SIGNING_SECRET: undefined }, { USAGE_SIGNING_SECRET: 'FAKE-short' },
    { CHATGPT_PREVIEW_KEY: undefined },
    { VERCEL_ENV: 'production', CHATGPT_PRODUCTION_KEY: undefined },
    { AI_INPUT_USD_PER_MTOK: '-1' }, { AI_USER_CREDIT_USD: 'NaN' },
  ]) {
    const f = fixture();
    const response = await f.run(request(), overrides);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'configuration_error' });
    assert.equal(f.calls.length, 0);
  }
});

test('respond rejects unusable subjects after the balance RPC and never calls OpenAI', async () => {
  for (const token of ['FAKE-not-a-jwt', 'FAKE.e30.FAKE', `FAKE.${Buffer.from(JSON.stringify({ sub: 'not-a-uuid' })).toString('base64url')}.FAKE`]) {
    const f = fixture();
    const response = await f.run(request(body, { headers: { Authorization: `Bearer ${token}` } }));
    assert.equal(response.status, 401);
    assert.equal(f.calls.length, 1);
    assert.equal(aiCalls(f).length, 0);
  }
});

test('respond never calls OpenAI if the balance cannot be read or validated', async () => {
  for (const options of [
    { balanceStatus: 500 }, { balanceThrows: true }, { balanceInvalidJson: true },
    { balanceStatus: 400, balanceBody: { code: 'PGRST300', message: 'PRIVATE_ERROR' } }, { balanceBody: [] }, { balanceBody: [{ spent: '-1' }] },
    { balanceBody: [{ spent: 'NaN' }] }, { balanceBody: {} },
  ]) {
    const f = fixture(options);
    assert.equal((await f.run()).status, 503);
    assert.equal(aiCalls(f).length, 0);
  }
});

test('respond authenticates, checks balance, generates, records, then computes the updated balance', async () => {
  const f = fixture({ spent: '0.1' });
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const result = await response.json();
  assert.equal(result.text, 'A useful coaching response');
  assert.deepEqual(result.usage, { inputTokens: 1_000_000, outputTokens: 500_000 });
  assert.equal(result.cost, 0.8);
  assert.equal(result.balance.spent, 0.9);
  assert.equal(result.balance.credit, 1);
  assert.ok(Math.abs(result.balance.balance - 0.1) < 1e-15);
  assert.deepEqual(f.calls.map(call => call.url), [
    `${env.SUPABASE_URL}/rest/v1/rpc/get_my_ai_balance`,
    'https://api.openai.com/v1/responses', `${env.SUPABASE_URL}/rest/v1/rpc/record_ai_usage`,
  ]);
  for (const call of f.calls.filter(call => call.url.startsWith(env.SUPABASE_URL))) {
    assert.equal(call.headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(call.headers.get('Authorization'), authorization);
    assert.equal(call.method, 'POST');
  }
  const entry = records(f)[0].body;
  const { p_issued_at, p_nonce, p_signature, ...accounting } = entry;
  assert.deepEqual({ ...accounting, p_duration_ms: 0 }, {
    p_provider: 'openai', p_model: 'gpt-5.6-luna', p_kind: 'analysis', p_status: 'success', p_error: '',
    p_input_tokens: 1_000_000, p_output_tokens: 500_000, p_input_rate: 0.2, p_output_rate: 1.2,
    p_estimated_cost: 0.8, p_duration_ms: 0, p_audio_seconds: 0,
  });
  assert.ok(Number.isSafeInteger(entry.p_duration_ms) && entry.p_duration_ms >= 0);
  assert.equal(f.logs.length, 0);
});

test('respond ignores client models and uses the selected environment key with exactly the Responses payload', async () => {
  for (const environment of ['production', 'development']) {
    const f = fixture();
    const response = await f.run(request({ ...body, model: 'untrusted-model', apiKey: 'untrusted-placeholder' }), {
      VERCEL_ENV: environment, AI_MODEL: 'server-test-model',
    });
    assert.equal(response.status, 200);
    const call = aiCalls(f)[0];
    assert.deepEqual(call.body, { model: 'server-test-model', instructions: body.instructions, input: body.input, store: false, max_output_tokens: 8000 });
    assert.equal(call.method, 'POST');
    assert.equal(call.headers.get('Authorization'), `Bearer ${environment === 'production' ? env.CHATGPT_PRODUCTION_KEY : env.CHATGPT_PREVIEW_KEY}`);
    assert.equal(call.headers.get('apikey'), null);
    assert.equal(records(f)[0].body.p_model, 'server-test-model');
  }
});

test('respond disables OpenAI response storage even when the client requests it', async () => {
  const f = fixture();
  assert.equal((await f.run(request({ ...body, store: true }))).status, 200);
  assert.equal(aiCalls(f)[0].body.store, false);
});

test('respond caps output at 8000 tokens even when the client requests a larger limit', async () => {
  const f = fixture();
  assert.equal((await f.run(request({ ...body, max_output_tokens: 100_000 }))).status, 200);
  assert.equal(aiCalls(f)[0].body.max_output_tokens, 8000);
});

test('respond sets a 60-second AbortSignal and records timeouts as OpenAI errors', async t => {
  const signal = AbortSignal.abort(new DOMException('Simulated timeout', 'TimeoutError'));
  const timeout = t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 60_000);
    return signal;
  });
  const f = fixture({ honorAbort: true });
  const response = await f.run();
  assert.equal(timeout.mock.callCount(), 1);
  assert.equal(aiCalls(f)[0].signal, signal);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'upstream_error' });
  assert.equal(records(f).length, 1);
  assert.equal(records(f)[0].body.p_status, 'error');
  assert.equal(records(f)[0].body.p_estimated_cost, 0);
});

test('respond uses output_text first and otherwise joins output content text like the existing callAgent', async () => {
  for (const [payload, expected] of [
    [{ output_text: 'Preferred', output: [{ content: [{ text: 'Ignored' }] }] }, 'Preferred'],
    [{ output: [{ content: [{ text: 'First' }, { type: 'other' }] }, { content: [{ text: 'Second' }] }] }, 'FirstSecond'],
  ]) {
    const f = fixture({ openaiBody: { ...payload, usage } });
    assert.equal((await (await f.run()).json()).text, expected);
  }
});

test('respond records unsuccessful OpenAI calls without returning or persisting the raw error body', async () => {
  const raw = 'UPSTREAM_BODY_DO_NOT_EXPOSE ' + env.CHATGPT_PREVIEW_KEY;
  const f = fixture({ openaiStatus: 429, openaiBody: { error: { message: raw }, usage } });
  const response = await f.run();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'upstream_error' });
  const entry = records(f)[0].body;
  assert.equal(entry.p_status, 'error');
  assert.equal(entry.p_estimated_cost, 0.8);
  assert.equal(entry.p_error.includes('UPSTREAM_BODY'), false);
  assert.equal(entry.p_error.includes(env.CHATGPT_PREVIEW_KEY), false);
});

test('respond records network failures and invalid JSON as errors, with no invented usage', async () => {
  for (const options of [
    { openaiThrows: new Error(`network ${env.CHATGPT_PREVIEW_KEY} ${authorization}`) },
    { openaiInvalidJson: true },
    { openaiBody: { output_text: 'No usage provided' } },
    { openaiBody: { output_text: 'Invalid usage', usage: { input_tokens: -1, output_tokens: 1 } } },
  ]) {
    const f = fixture(options);
    const response = await f.run();
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'upstream_error' });
    assert.equal(records(f).length, 1);
    const entry = records(f)[0].body;
    assert.equal(entry.p_status, 'error');
    assert.equal(entry.p_estimated_cost, 0);
    assert.equal(entry.p_error.includes(env.CHATGPT_PREVIEW_KEY), false);
    assert.ok(entry.p_error.length <= 500);
  }
});

test('respond retains AI results when recording fails and logs only redacted diagnostics', async () => {
  for (const options of [
    { recordStatus: 500, recordBody: { message: `PRIVATE_BODY ${env.CHATGPT_PREVIEW_KEY}` } },
    { recordThrows: new Error(`${fakeSigningSecret} ${env.CHATGPT_PREVIEW_KEY} ${env.SUPABASE_PUBLISHABLE_KEY} ${authorization}`) },
  ]) {
    const f = fixture(options);
    const response = await f.run();
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.text, 'A useful coaching response');
    assert.equal(result.cost, 0.8);
    assert.equal(result.balance, null);
    assert.equal(aiCalls(f).length, 1);
    assert.equal(records(f).length, 1);
    assert.ok(f.logs.length > 0);
    const logs = f.logs.join(' ');
    for (const secret of [env.CHATGPT_PREVIEW_KEY, env.SUPABASE_PUBLISHABLE_KEY, fakeJwt, fakeSigningSecret, 'PRIVATE_BODY']) {
      assert.equal(logs.includes(secret), false);
      assert.equal(JSON.stringify(result).includes(secret), false);
    }
  }
});

test('respond sends numeric-only Server-Timing on success and all error paths', async () => {
  for (const [options, req, overrides] of [
    [{}, request(), {}], [{}, request({}, { headers: { Authorization: '' } }), {}],
    [{}, request({}, { method: 'GET' }), {}], [{}, request(), { AI_USER_CREDIT_USD: '-1' }],
    [{ balanceStatus: 401 }, request(), {}], [{ balanceStatus: 500 }, request(), {}],
    [{ spent: '1' }, request(), {}], [{}, request({ kind: 'invalid' }), {}],
    [{ openaiThrows: new Error('PRIVATE') }, request(), {}], [{ recordStatus: 500 }, request(), {}],
  ]) {
    const f = fixture(options);
    assertTiming(await f.run(req, overrides), ['balance', 'openai', 'record', 'total']);
  }
});

test('Vercel entry exports a POST Web handler returning a Response', async () => {
  const { POST } = require('../api/ai/respond.js');
  assert.equal(typeof POST, 'function');
  const response = await POST(request(body, { method: 'GET' }));
  assert.ok(response instanceof Response);
  assert.equal(response.status, 405);
});
