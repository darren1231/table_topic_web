const assert = require('node:assert/strict');
const { test } = require('node:test');

test('reward line uses the server reward before check-in and the next streak reward afterward', () => {
  const { rewardLine } = require('../public/token-ui.js');
  assert.deepEqual(rewardLine({ checkedIn: false, reward: 123, streak: 4 }), { key: 'tokens.todayReward', count: 123 });
  for (const [streak, count] of [[1, 20], [2, 30], [3, 50], [4, 80], [5, 100], [6, 100], [8, 100]]) {
    assert.deepEqual(rewardLine({ checkedIn: true, reward: 0, streak }), { key: 'tokens.tomorrowReward', count });
  }
});

test('token client reads fresh credentials, validates data and sends only exchange units', async () => {
  const { createClient } = require('../public/token-ui.js');
  const calls = []; let reads = 0;
  const state = { balance: 2200, streak: 2, checkedIn: false, canMakeup: true, makeupCost: 200, reward: 30 };
  const client = createClient({ getAccessToken: async () => `FAKE-${++reads}`, fetch: async (url, init) => {
    calls.push({ url, init });
    return Response.json(url.endsWith('exchange') ? { units: 1, tokensSpent: 1000, creditAdded: 0.025, rateUsd: 0.025, status: state }
      : url.endsWith('status') ? { ...state, exchangeRate: 0.025 } : state);
  } });
  assert.equal((await client.status()).exchangeRate, 0.025);
  assert.equal((await client.makeup()).balance, 2200);
  assert.equal((await client.exchange(1)).creditAdded, 0.025);
  assert.deepEqual(calls.map(call => call.url), ['/api/tokens/status', '/api/tokens/makeup', '/api/tokens/exchange']);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[1].init.body, '{}');
  assert.equal(calls[2].init.body, '{"units":1}');
  calls.forEach((call, i) => assert.equal(call.init.headers.Authorization, `Bearer FAKE-${i + 1}`));
});

test('token client maps only known errors, rejects malformed data and requires login', async () => {
  const { createClient, validCheckIn } = require('../public/token-ui.js');
  for (const [status, error, key] of [[400, 'insufficient_tokens', 'tokens.insufficient'], [400, 'makeup_unavailable', 'tokens.makeupUnavailable'],
    [401, 'unauthorized', 'systemAi.signInAgain'], [503, '<img onerror=alert(1)>', 'tokens.unavailable']]) {
    const client = createClient({ getAccessToken: async () => 'FAKE-token', fetch: async () => Response.json({ error }, { status }) });
    await assert.rejects(client.makeup(), { messageKey: key });
  }
  for (const data of [null, { balance: '<img>' }, { balance: -1 }, { checkedIn: 'yes' }]) {
    const client = createClient({ getAccessToken: async () => 'FAKE-token', fetch: async () => Response.json(data) });
    await assert.rejects(client.status(), { messageKey: 'tokens.unavailable' });
  }
  const guest = createClient({ getAccessToken: async () => null, fetch: () => { throw new Error('No guest network'); } });
  await assert.rejects(guest.status(), { code: 'unauthorized' });
  const offline = createClient({ getAccessToken: async () => 'FAKE-token', fetch: async () => { throw new Error('PRIVATE'); } });
  await assert.rejects(offline.status(), { messageKey: 'tokens.networkError' });
  assert.equal(validCheckIn({ checkedIn: true, reward: '<img>', streak: 1, balance: 1 }), false);
});
