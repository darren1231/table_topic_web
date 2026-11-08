const assert = require('node:assert/strict');
const { test } = require('node:test');
const sanitizeErrorMessage = (...args) => require('../api/_lib/errors.js').sanitizeErrorMessage(...args);

test('error cleanup redacts credential-like prefixes including OpenAI, Supabase and other provider keys', () => {
  for (const prefix of ['sk-', 'sk-proj-', 'sk-ant-', 'sk_live_', 'sb_secret_', 'sb_publishable_', 'ghp_', 'github_pat_']) {
    const placeholder = prefix + 'NOT_A_REAL_CREDENTIAL_123';
    const message = sanitizeErrorMessage(`Rejected: ${placeholder}. Please retry.`);
    assert.equal(message, 'Rejected: [REDACTED]. Please retry.');
  }
});

test('error cleanup redacts authorization, labeled secrets and JWT-like values', () => {
  const credential = 'NOT_A_REAL_CREDENTIAL_123';
  const messages = [
    `Authorization: Bearer ${credential}`,
    `Basic ${credential}`,
    `api_key=${credential}`,
    `x-api-key: ${credential}`,
    `{"access_token":"${credential}"}`,
    `refreshToken='${credential}'`,
    ['eyJNOTREAL', 'NOTREALPAYLOAD', 'NOTREALSIGNATURE'].join('.'),
  ];
  for (const source of messages) {
    const message = sanitizeErrorMessage(source);
    assert.ok(message.includes('[REDACTED]'), source);
    assert.ok(!message.includes(credential));
    assert.ok(!message.includes('NOTREALPAYLOAD'));
  }
});

test('error cleanup removes caller-supplied secrets literally before truncating', () => {
  const placeholder = 'not-real.[special]+(value)?$';
  const source = 'x'.repeat(490) + placeholder + ' trailing';
  const result = sanitizeErrorMessage(source, [placeholder]);
  assert.ok(result.length <= 500);
  assert.ok(!result.includes('not-real'));
  assert.equal(sanitizeErrorMessage(`${placeholder} twice ${placeholder}`, [placeholder, '', null]), '[REDACTED] twice [REDACTED]');
  const prefixed = 'sk-' + 'NOT_REAL'.repeat(20);
  assert.ok(!sanitizeErrorMessage('x'.repeat(490) + prefixed).includes('sk-'));
});

test('error cleanup uses only a message, never serializes upstream bodies or stacks, and caps output at 500', () => {
  const error = new Error('Safe explanation');
  error.body = 'UPSTREAM_BODY_MUST_NOT_APPEAR';
  assert.equal(sanitizeErrorMessage(error), 'Safe explanation');
  assert.equal(sanitizeErrorMessage({ body: error.body, message: error.body }), 'AI request failed');
  for (const input of [null, undefined, {}, 123, '']) {
    assert.equal(sanitizeErrorMessage(input), 'AI request failed');
  }
  assert.equal(sanitizeErrorMessage('x'.repeat(501)), 'x'.repeat(500));
  assert.equal(sanitizeErrorMessage('First\nSecond\r\nThird\u0000'), 'First Second  Third ');
});
