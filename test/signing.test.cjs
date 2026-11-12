const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHmac } = require('node:crypto');

// Deliberately fake test-only secret; never read process.env.
const fakeSecret = 'FAKE-TEST-ONLY-signing-secret-00000000';
const userId = '00000000-0000-0000-0000-000000000001';
const record = {
  p_kind: 'analysis', p_status: 'success', p_model: 'fake-model',
  p_input_tokens: 100, p_output_tokens: 50, p_estimated_cost: 1e-7,
  p_audio_seconds: 60.5, p_issued_at: '2026-11-12T04:05:06.007Z',
  p_nonce: 'AAAAAAAA-0000-0000-0000-000000000001',
};
const payload = `${userId}|analysis|success|fake-model|100|50|0.0000001|60.5|2026-11-12T04:05:06.007Z|aaaaaaaa-0000-0000-0000-000000000001`;

test('usage signing has an exact canonical payload and UTF-8 HMAC-SHA256', () => {
  const { usagePayload, signUsage } = require('../api/_lib/signing.js');
  assert.equal(usagePayload(userId.toUpperCase(), record), payload);
  const signed = signUsage(userId, record, fakeSecret, {
    issuedAt: record.p_issued_at, nonce: record.p_nonce,
  });
  assert.equal(signed.p_signature, createHmac('sha256', fakeSecret).update(payload, 'utf8').digest('hex'));
  assert.equal(signed.p_nonce, record.p_nonce.toLowerCase());
  assert.equal(signed.p_issued_at, record.p_issued_at);
});

test('missing or short signing secrets fail closed without echoing credentials', () => {
  const { readConfig, readBalanceConfig } = require('../api/_lib/config.js');
  const { signUsage } = require('../api/_lib/signing.js');
  for (const secret of [undefined, null, '', 'FAKE-short-secret', 123, ' '.repeat(32)]) {
    const env = { CHATGPT_PREVIEW_KEY: 'FAKE-test-api-key', USAGE_SIGNING_SECRET: secret };
    const defaults = { url: 'https://example.invalid', anonKey: 'FAKE-public-key' };
    for (const read of [readConfig, readBalanceConfig]) {
      assert.throws(() => read(env, defaults), { status: 503, code: 'configuration_error' });
    }
    assert.throws(() => signUsage(userId, record, secret), { code: 'configuration_error' });
  }
});

test('exchange signatures are domain-separated and bind user, units, rate, time and nonce', () => {
  const { exchangePayload, signExchange } = require('../api/_lib/signing.js');
  const args = { p_units: 2, p_rate_usd: 0.01, p_issued_at: record.p_issued_at, p_nonce: record.p_nonce };
  const expected = `exchange|${userId}|2|0.01|2026-11-12T04:05:06.007Z|aaaaaaaa-0000-0000-0000-000000000001`;
  assert.equal(exchangePayload(userId, args), expected);
  const signed = signExchange(userId, 2, 0.01, fakeSecret, { issuedAt: record.p_issued_at, nonce: record.p_nonce });
  assert.equal(signed.p_signature, createHmac('sha256', fakeSecret).update(expected).digest('hex'));
});
