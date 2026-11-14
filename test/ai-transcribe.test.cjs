const assert = require('node:assert/strict');
const { fakeSigningSecret, fakeUserId, fakeAuthorization, fakeJwt } = require('./helpers/signing.cjs');
const { test } = require('node:test');
const { assertTiming } = require('./helpers/server-timing.cjs');

const env = { USAGE_SIGNING_SECRET: fakeSigningSecret,
  CHATGPT_PREVIEW_KEY: 'preview-placeholder', CHATGPT_PRODUCTION_KEY: 'production-placeholder',
  SUPABASE_URL: 'https://database.example.invalid', SUPABASE_PUBLISHABLE_KEY: 'public-placeholder',
  AI_TRANSCRIBE_INPUT_USD_PER_MTOK: '0.4', AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK: '1.2',
};
const authorization = fakeAuthorization;
const usage = { input_tokens: 1_000_000, output_tokens: 500_000 };
const handleTranscribe = args => require('../api/_lib/transcribe.js').handleTranscribe(args);

function request(values = {}, options = {}) {
  const form = new FormData();
  const fields = {
    file: new Blob(['fake-audio-bytes'], { type: 'audio/webm' }),
    prompt: 'Preserve every spoken language', kind: 'transcription', ...values,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (value instanceof Blob) form.append(key, value, 'practice.webm');
    else form.append(key, value);
  }
  const method = options.method || 'POST';
  return new Request('https://app.example.invalid/api/ai/transcribe', {
    method, headers: { Authorization: authorization, ...options.headers },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: options.rawBody ?? form }),
  });
}

function fixture(options = {}) {
  const calls = [], logs = [];
  const fetch = async (url, init) => {
    const entry = {
      url, method: init.method, headers: new Headers(init.headers), signal: init.signal,
      body: init.body instanceof FormData ? init.body : init.body ? JSON.parse(init.body) : null,
    };
    calls.push(entry);
    if (url.endsWith('/rpc/get_my_ai_balance')) {
      if (options.balanceInvalidJson) return new Response('invalid-json', { status: options.balanceStatus ?? 200 });
      if (options.balanceThrows) throw new Error('Simulated balance failure');
      return Response.json(options.balanceBody ?? [{ spent: options.spent ?? '0', bonus_credit: options.bonus ?? '0' }], { status: options.balanceStatus ?? 200 });
    }
    if (url === 'https://api.openai.com/v1/audio/transcriptions') {
      if (options.honorAbort) init.signal?.throwIfAborted();
      if (options.openaiThrows) throw options.openaiThrows;
      if (options.invalidJson) return new Response('not-json');
      return Response.json(options.openaiBody ?? { text: 'Transcribed practice speech', usage }, { status: options.openaiStatus ?? 200 });
    }
    if (url.endsWith('/rpc/record_ai_usage')) {
      if (options.recordThrows) throw options.recordThrows;
      return Response.json(options.recordBody ?? '00000000-0000-0000-0000-000000000002', { status: options.recordStatus ?? 200 });
    }
    throw new Error('Unexpected fake fetch URL');
  };
  return {
    calls, logs,
    run: (req = request(), overrides = {}) => handleTranscribe({
      request: req, env: { ...env, ...overrides }, fetch,
      logger: { error: (...args) => logs.push(args.join(' ')) },
    }),
  };
}

const aiCalls = f => f.calls.filter(call => call.url === 'https://api.openai.com/v1/audio/transcriptions');
const records = f => f.calls.filter(call => call.url.endsWith('/rpc/record_ai_usage'));

test('transcribe adds bonus credit before quota checks and retains it after accounting', async () => {
  const f = fixture({ spent: '1', bonus: '1' });
  const response = await f.run();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.balance.credit, 2); assert.equal(result.balance.spent, 2);
  assert.equal(result.balance.exhausted, true);
  for (const bonus_credit of [null, '-1', 'NaN', 'Infinity']) {
    const bad = fixture({ balanceBody: [{ spent: '0', bonus_credit }] });
    assert.equal((await bad.run()).status, 503); assert.equal(aiCalls(bad).length, 0);
  }
});

test('transcribe rejects absent signing configuration and unusable verified subjects without OpenAI', async () => {
  for (const secret of [undefined, '', 'FAKE-short']) {
    const f = fixture();
    assert.equal((await f.run(request(), { USAGE_SIGNING_SECRET: secret })).status, 503);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal((await f.run(request({}, { headers: { Authorization: 'Bearer FAKE-not-a-jwt' } }))).status, 401);
  assert.equal(f.calls.length, 1);
  assert.equal(aiCalls(f).length, 0);
});

test('transcribe signs token, duration and failure records', async () => {
  for (const options of [{}, { openaiBody: { text: 'Speech', usage: { type: 'duration', seconds: 60.5 } } }, { openaiStatus: 500 }]) {
    const f = fixture(options);
    await f.run();
    const entry = records(f)[0].body;
    assert.match(entry.p_signature ?? '', /^[a-f0-9]{64}$/);
    const { createHmac } = require('node:crypto');
    const { usagePayload } = require('../api/_lib/signing.js');
    assert.equal(entry.p_signature, createHmac('sha256', fakeSigningSecret).update(usagePayload(fakeUserId, entry)).digest('hex'));
    assert.equal(f.calls.filter(call => call.url.startsWith(env.SUPABASE_URL)).length, 2);
  }
});

test('transcribe rejects non-POST methods and invalid credentials before service access', async () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
    const f = fixture();
    const response = await f.run(request({}, { method }));
    assert.ok(response instanceof Response);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'POST');
    assert.equal(f.calls.length, 0);
  }
  for (const header of ['', 'Bearer', 'Bearer ', 'Basic placeholder', 'Bearer two values']) {
    const f = fixture();
    const response = await f.run(request({}, { headers: { Authorization: header } }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'unauthorized' });
    assert.equal(f.calls.length, 0);
  }
});

test('transcribe authenticates via the balance RPC and rejects auth errors without OpenAI', async () => {
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

test('transcribe refuses exhausted credit before validating input and never calls OpenAI', async () => {
  for (const [spent, credit] of [['1', '1'], ['2', '1'], ['0', '0']]) {
    const f = fixture({ spent });
    const response = await f.run(request({}, { rawBody: 'invalid multipart' }), { AI_USER_CREDIT_USD: credit });
    assert.equal(response.status, 402);
    assert.deepEqual(await response.json(), { error: 'credit_exhausted' });
    assert.equal(f.calls.length, 1);
    assert.equal(aiCalls(f).length, 0);
    assert.equal(records(f).length, 0);
  }
});

test('transcribe fails closed when initial balance is unavailable or malformed', async () => {
  for (const options of [{ balanceStatus: 400, balanceBody: { code: 'PGRST300', message: 'PRIVATE_ERROR' } }, { balanceInvalidJson: true }, { balanceStatus: 500 }, { balanceThrows: true }, { balanceBody: [] }, { balanceBody: {} }, { balanceBody: [{ spent: '-1' }] }, { balanceBody: [{ spent: 'NaN' }] }]) {
    const f = fixture(options);
    assert.equal((await f.run()).status, 503);
    assert.equal(aiCalls(f).length, 0);
  }
});

test('transcribe rejects invalid minute prices and other configuration without OpenAI', async () => {
  for (const overrides of [
    { AI_TRANSCRIBE_USD_PER_MINUTE: '-1' }, { AI_TRANSCRIBE_USD_PER_MINUTE: 'NaN' },
    { AI_TRANSCRIBE_USD_PER_MINUTE: 'Infinity' }, { AI_TRANSCRIBE_USD_PER_MINUTE: '' },
    { AI_TRANSCRIBE_INPUT_USD_PER_MTOK: '-1' }, { AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK: 'NaN' },
    { AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK: 'Infinity' }, { CHATGPT_PREVIEW_KEY: undefined },
    { VERCEL_ENV: 'production', CHATGPT_PRODUCTION_KEY: undefined },
  ]) {
    const f = fixture();
    const response = await f.run(request(), overrides);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'configuration_error' });
    assert.equal(aiCalls(f).length, 0);
    assert.equal(records(f).length, 0);
  }
});

test('transcribe rejects an audio file over 4 MiB after authentication and balance', async () => {
  const f = fixture();
  const response = await f.run(request({ file: new Blob([new Uint8Array(4 * 1024 * 1024 + 1)]) }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_input' });
  assert.equal(f.calls.length, 1);
});

test('transcribe accepts exactly 4 MiB and a 2000-character prompt', async () => {
  const f = fixture();
  const response = await f.run(request({ file: new Blob([new Uint8Array(4 * 1024 * 1024)]), prompt: '😀'.repeat(2000) }));
  assert.equal(response.status, 200);
  assert.equal(aiCalls(f)[0].body.get('file').size, 4 * 1024 * 1024);
});

test('transcribe rejects a prompt longer than 2000 characters without contacting OpenAI', async () => {
  const f = fixture();
  assert.equal((await f.run(request({ prompt: 'x'.repeat(2001) }))).status, 400);
  assert.equal(f.calls.length, 1);
});

test('transcribe rejects missing or empty files, missing prompts, wrong kinds and malformed multipart', async () => {
  for (const fields of [
    { file: undefined }, { file: 'not-a-file' }, { file: new Blob([]) }, { prompt: undefined },
    { kind: undefined }, { kind: 'agent' }, { kind: 'analysis' }, { kind: 'questions' }, { kind: 'polish' },
  ]) {
    const f = fixture();
    assert.equal((await f.run(request(fields))).status, 400);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture();
  assert.equal((await f.run(request({}, { rawBody: 'invalid multipart' }))).status, 400);
  assert.equal(f.calls.length, 1);
});

test('transcribe sends only multipart file, server model, prompt and json format with a 60-second signal', async () => {
  for (const environment of ['production', 'development']) {
    const f = fixture();
    const response = await f.run(request({ model: 'untrusted-model', response_format: 'text' }), {
      VERCEL_ENV: environment, AI_TRANSCRIBE_MODEL: 'server-audio-model',
    });
    assert.equal(response.status, 200);
    const call = aiCalls(f)[0];
    assert.equal(call.method, 'POST');
    assert.ok(call.signal instanceof AbortSignal);
    assert.equal(call.headers.get('Content-Type'), null, 'fetch must generate the multipart boundary');
    assert.equal(call.headers.get('Authorization'), `Bearer ${environment === 'production' ? env.CHATGPT_PRODUCTION_KEY : env.CHATGPT_PREVIEW_KEY}`);
    assert.equal(call.headers.get('apikey'), null);
    assert.deepEqual([...call.body.keys()].sort(), ['file', 'model', 'prompt', 'response_format']);
    assert.equal(call.body.get('model'), 'server-audio-model');
    assert.equal(call.body.get('prompt'), 'Preserve every spoken language');
    assert.equal(call.body.get('response_format'), 'json');
    assert.equal(await call.body.get('file').text(), 'fake-audio-bytes');
    assert.equal(call.body.get('file').name, 'practice.webm');
  }
});

test('transcribe records voice token costs and returns the computed balance with the text', async () => {
  const f = fixture({ spent: '0.25' });
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const result = await response.json();
  assert.deepEqual(result, {
    text: 'Transcribed practice speech', usage: { inputTokens: 1_000_000, outputTokens: 500_000, audioSeconds: 0 }, cost: 1,
    balance: { spent: 1.25, credit: 1, balance: 0, exhausted: true },
  });
  assert.deepEqual(f.calls.map(call => call.url), [
    `${env.SUPABASE_URL}/rest/v1/rpc/get_my_ai_balance`,
    'https://api.openai.com/v1/audio/transcriptions', `${env.SUPABASE_URL}/rest/v1/rpc/record_ai_usage`,
  ]);
  for (const call of f.calls.filter(call => call.url.startsWith(env.SUPABASE_URL))) {
    assert.equal(call.headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(call.headers.get('Authorization'), authorization);
    assert.equal(call.method, 'POST');
  }
  const entry = records(f)[0].body;
  const { p_issued_at, p_nonce, p_signature, ...accounting } = entry;
  assert.deepEqual({ ...accounting, p_duration_ms: 0 }, {
    p_provider: 'openai', p_model: 'gpt-transcribe', p_kind: 'transcription', p_status: 'success', p_error: '',
    p_input_tokens: 1_000_000, p_output_tokens: 500_000, p_input_rate: 0.4, p_output_rate: 1.2,
    p_estimated_cost: 1, p_duration_ms: 0, p_audio_seconds: 0,
  });
  assert.ok(Number.isSafeInteger(entry.p_duration_ms) && entry.p_duration_ms >= 0);
  assert.equal(f.logs.length, 0);
});

test('transcribe allows explicit zero rates but still requires actual numeric token usage', async () => {
  const f = fixture();
  const response = await f.run(request(), { AI_TRANSCRIBE_INPUT_USD_PER_MTOK: '0', AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK: '0' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cost, 0);
  assert.equal(records(f)[0].body.p_input_tokens, 1_000_000);
});

test('transcribe refuses results without complete valid usage instead of allowing a free transcription', async () => {
  for (const rawUsage of [undefined, null, {}, { type: 'duration' },
    { input_tokens: 1 }, { input_tokens: null, output_tokens: 1 },
    { input_tokens: '1', output_tokens: 1 }, { input_tokens: -1, output_tokens: 1 },
    { input_tokens: 1, output_tokens: null }, { input_tokens: 1, output_tokens: 0.5 }]) {
    const f = fixture({ openaiBody: { text: 'MUST_NOT_RETURN_THIS_TEXT', usage: rawUsage } });
    const response = await f.run();
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'upstream_error' });
    assert.equal(records(f).length, 1);
    assert.equal(records(f)[0].body.p_status, 'error');
    assert.equal(records(f)[0].body.p_estimated_cost, 0);
  }
});

test('transcribe duration usage uses minute pricing without token prices and stores only audio seconds', async () => {
  for (const raw of [{ type: 'duration', seconds: 90 }, { seconds: 90 }, { type: 'tokens', seconds: 90 }]) {
    const f = fixture({ openaiBody: { text: 'Duration transcript', usage: raw } });
    const response = await f.run(request(), { AI_TRANSCRIBE_INPUT_USD_PER_MTOK: undefined, AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK: undefined });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.text, 'Duration transcript');
    assert.ok(Math.abs(result.cost - 0.00675) < 1e-15);
    assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0, audioSeconds: 90 });
    const entry = records(f)[0].body;
    assert.equal(entry.p_audio_seconds, 90);
    assert.equal(entry.p_input_tokens, 0);
    assert.equal(entry.p_output_tokens, 0);
    assert.equal(entry.p_input_rate, 0);
    assert.equal(entry.p_output_rate, 0);
    assert.ok(Math.abs(entry.p_estimated_cost - 0.00675) < 1e-15);
  }
});

test('transcribe duration pricing honors per-minute overrides and zero pricing', async () => {
  for (const rate of ['0.01', '0']) {
    const f = fixture({ openaiBody: { text: 'Duration transcript', usage: { seconds: 30.5 } } });
    const response = await f.run(request(), { AI_TRANSCRIBE_USD_PER_MINUTE: rate });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cost, 30.5 / 60 * Number(rate));
  }
});

test('transcribe token usage without either token price is recorded as an error, never returned', async () => {
  for (const overrides of [
    { AI_TRANSCRIBE_INPUT_USD_PER_MTOK: undefined }, { AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK: undefined },
    { AI_TRANSCRIBE_INPUT_USD_PER_MTOK: undefined, AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK: undefined },
  ]) {
    const f = fixture();
    const response = await f.run(request(), overrides);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'upstream_error' });
    assert.equal(aiCalls(f).length, 1);
    assert.equal(records(f)[0].body.p_status, 'error');
    assert.equal(records(f)[0].body.p_audio_seconds, 0);
    assert.equal(records(f)[0].body.p_input_rate, 0);
    assert.equal(records(f)[0].body.p_output_rate, 0);
  }
});

test('transcribe invalid duration never falls back to token billing or exposes the transcript', async () => {
  for (const seconds of [null, -1, '60', 'NaN', 'Infinity']) {
    const f = fixture({ openaiBody: { text: 'MUST_NOT_RETURN', usage: { ...usage, type: 'duration', seconds } } });
    const response = await f.run();
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'upstream_error' });
    assert.equal(records(f)[0].body.p_status, 'error');
    assert.equal(records(f)[0].body.p_audio_seconds, 0);
  }
});

test('transcribe records HTTP failures with known usage but never exposes the upstream body', async () => {
  const f = fixture({ openaiStatus: 429, openaiBody: { usage, error: { message: `PRIVATE_BODY ${env.CHATGPT_PREVIEW_KEY}` } } });
  const response = await f.run();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'upstream_error' });
  const entry = records(f)[0].body;
  assert.equal(entry.p_status, 'error');
  assert.equal(entry.p_estimated_cost, 1);
  assert.ok(!entry.p_error.includes('PRIVATE_BODY') && !entry.p_error.includes(env.CHATGPT_PREVIEW_KEY));
});

test('transcribe records network and malformed upstream responses as errors', async () => {
  for (const options of [
    { openaiThrows: new Error(`${env.CHATGPT_PREVIEW_KEY} ${authorization}`) }, { invalidJson: true },
    { openaiBody: { usage, text: 123 } }, { openaiBody: { usage } },
  ]) {
    const f = fixture(options);
    const response = await f.run();
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'upstream_error' });
    assert.equal(records(f).length, 1);
    assert.equal(records(f)[0].body.p_status, 'error');
    assert.ok(!records(f)[0].body.p_error.includes(env.CHATGPT_PREVIEW_KEY));
  }
});

test('transcribe uses a 60000ms AbortSignal and accounts timeouts as errors', async t => {
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
  assert.equal(records(f)[0].body.p_status, 'error');
  assert.equal(records(f)[0].body.p_estimated_cost, 0);
});

test('transcribe keeps paid results if accounting fails and logs no keys or upstream bodies', async () => {
  for (const options of [
    { recordStatus: 500, recordBody: { message: `PRIVATE_BODY ${env.CHATGPT_PREVIEW_KEY}` } },
    { recordThrows: new Error(`${fakeSigningSecret} ${env.CHATGPT_PREVIEW_KEY} ${env.SUPABASE_PUBLISHABLE_KEY} ${authorization}`) },
  ]) {
    const f = fixture(options);
    const response = await f.run();
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.text, 'Transcribed practice speech');
    assert.equal(result.cost, 1);
    assert.equal(result.balance, null);
    assert.equal(aiCalls(f).length, 1);
    assert.equal(records(f).length, 1);
    assert.ok(f.logs.length > 0);
    for (const secret of [env.CHATGPT_PREVIEW_KEY, env.SUPABASE_PUBLISHABLE_KEY, fakeJwt, fakeSigningSecret, 'PRIVATE_BODY']) {
      assert.ok(!f.logs.join(' ').includes(secret));
      assert.ok(!JSON.stringify(result).includes(secret));
    }
  }
});

test('transcribe sends numeric-only Server-Timing on success and all error paths', async () => {
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

test('transcribe Vercel entry exports a POST Web handler', async () => {
  const { POST } = require('../api/ai/transcribe.js');
  assert.equal(typeof POST, 'function');
  const response = await POST(request({}, { method: 'GET' }));
  assert.ok(response instanceof Response);
  assert.equal(response.status, 405);
});
