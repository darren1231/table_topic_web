const assert = require('node:assert/strict');
const { test } = require('node:test');
const api = () => require('../public/system-ai.js');

test('system provider selection uses authentication rather than sync mode and does not mutate old projects', () => {
  const project = Object.freeze({ provider: 'openai', apiKey: 'legacy-placeholder' });
  assert.equal(api().selectProvider({ signedIn: false, enableByok: false, project }), 'builtin');
  assert.equal(api().selectProvider({ signedIn: true, enableByok: false, project }), 'system');
  assert.equal(api().selectProvider({ signedIn: true, enableByok: false, project: { provider: 'builtin' } }), 'system');
  assert.equal(api().selectProvider({ signedIn: true, enableByok: true, project }), 'openai');
  assert.equal(api().selectProvider({ signedIn: false, enableByok: true, project }), 'builtin');
  assert.equal(project.apiKey, 'legacy-placeholder');
});

test('system response classification uses fixed message keys and falls back only for credit exhaustion', () => {
  assert.deepEqual(api().interpretResponse(200), { ok: true, code: null, messageKey: null, fallbackToBuiltin: false });
  const cases = [[401, 'unauthorized', 'signInAgain'], [402, 'credit_exhausted', 'creditExhausted'],
    [400, 'invalid_input', 'invalidInput'], [502, 'upstream_error', 'serviceError'],
    [503, 'configuration_error', 'unavailable'], [0, 'network_error', 'networkError']];
  for (const [status, code, key] of cases) {
    assert.deepEqual(api().interpretResponse(status), {
      ok: false, code, messageKey: `systemAi.${key}`, fallbackToBuiltin: status === 402,
    });
  }
});

test('audio upload check accepts exactly 4 MiB and rejects oversized or invalid sizes', () => {
  assert.equal(api().isAudioTooLarge(4 * 1024 * 1024), false);
  assert.equal(api().isAudioTooLarge(4 * 1024 * 1024 + 1), true);
  for (const size of [-1, NaN, Infinity, '123', undefined]) assert.equal(api().isAudioTooLarge(size), true);
});

test('system client gets a fresh token for every request and sends no provider keys or model', async () => {
  let reads = 0;
  const calls = [];
  const client = api().createClient({
    getAccessToken: async () => `user-placeholder-${++reads}`,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ text: 'Answer', usage: { inputTokens: 1, outputTokens: 2 }, cost: 0.0045, balance: null });
    },
  });
  for (const kind of ['questions', 'analysis', 'polish', 'agent']) {
    await client.respond({ instructions: 'Coach', input: 'Practice', kind, model: 'ignored', apiKey: 'ignored' });
  }
  assert.equal(reads, 4);
  for (const [index, call] of calls.entries()) {
    assert.equal(call.url, '/api/ai/respond');
    assert.equal(call.init.headers.Authorization, `Bearer user-placeholder-${index + 1}`);
    assert.deepEqual(Object.keys(JSON.parse(call.init.body)).sort(), ['input', 'instructions', 'kind']);
  }
});

test('system client uploads multipart with transcription kind and blocks oversize before token or fetch', async () => {
  const calls = [];
  let tokens = 0;
  const client = api().createClient({
    getAccessToken: async () => { tokens++; return 'user-placeholder'; },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ text: 'Transcript', usage: { audioSeconds: 60 }, cost: 0.0045, balance: null });
    },
  });
  await client.transcribe({ file: new Blob(['audio']), prompt: 'Preserve language' });
  assert.equal(calls[0].url, '/api/ai/transcribe');
  assert.equal(calls[0].init.body.get('kind'), 'transcription');
  assert.equal(calls[0].init.body.get('prompt'), 'Preserve language');
  assert.equal(calls[0].init.body.has('model'), false);
  await assert.rejects(client.transcribe({ file: new Blob([new Uint8Array(4 * 1024 * 1024 + 1)]), prompt: '' }), { messageKey: 'systemAi.audioTooLarge' });
  assert.equal(tokens, 1);
  assert.equal(calls.length, 1);
});

test('system client refuses missing sessions and maps API failures without showing untrusted error bodies', async () => {
  const missing = api().createClient({ getAccessToken: async () => null, fetch: () => { throw new Error('Must not fetch'); } });
  await assert.rejects(missing.respond({}), { code: 'unauthorized', messageKey: 'systemAi.signInAgain' });
  for (const status of [400, 401, 402, 502, 503]) {
    const client = api().createClient({
      getAccessToken: async () => 'user-placeholder',
      fetch: async () => Response.json({ error: 'UNTRUSTED_HTML_OR_KEY' }, { status }),
    });
    await assert.rejects(client.respond({}), error => {
      assert.equal(error.messageKey, api().interpretResponse(status).messageKey);
      assert.equal(error.fallbackToBuiltin, status === 402);
      assert.equal(error.message.includes('UNTRUSTED'), false);
      return true;
    });
  }
});

test('system client rejects network and malformed successes instead of inventing free usage', async () => {
  for (const fetch of [async () => { throw new Error('PRIVATE_NETWORK_MESSAGE'); },
    async () => new Response('invalid-json'), async () => Response.json({ text: 'Missing cost and usage' })]) {
    const client = api().createClient({ getAccessToken: async () => 'user-placeholder', fetch });
    await assert.rejects(client.respond({}), error => {
      assert.ok(['systemAi.networkError', 'systemAi.serviceError'].includes(error.messageKey));
      assert.ok(!error.message.includes('PRIVATE_NETWORK'));
      return true;
    });
  }
});
