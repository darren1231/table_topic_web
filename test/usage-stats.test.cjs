const assert = require('node:assert/strict');
const { test } = require('node:test');
const stats = () => require('../public/usage-stats.js');
const now = new Date('2026-11-08T12:00:00Z');
const records = [
  { id: 'old', user_id: 'a', email: 'a@example.invalid', created_at: '2026-10-01T00:00:00Z', kind: 'analysis', estimated_cost: '0.25', input_tokens: 10, output_tokens: 5, audio_seconds: '0' },
  { id: 'month', user_id: 'a', email: 'a@example.invalid', created_at: '2026-11-01T00:00:00Z', kind: 'questions', estimated_cost: '0.5', input_tokens: 20, output_tokens: 10 },
  { id: 'week', user_id: 'b', email: 'b@example.invalid', created_at: '2026-11-01T12:00:00Z', kind: 'transcription', estimated_cost: '0.125', audio_seconds: '30.5' },
  { id: 'latest', userId: 'a', email: 'a@example.invalid', createdAt: '2026-11-08T12:00:00Z', kind: 'agent', estimatedCost: 0.125, inputTokens: 3, outputTokens: 2, audioSeconds: 0 },
];

test('usage filters support UTC month, rolling inclusive 7/30 days and all periods without mutating records', () => {
  const before = JSON.stringify(records);
  const ids = period => stats().filterRecords(records, { period, now }).map(row => row.id);
  assert.deepEqual(ids('month'), ['month', 'week', 'latest']);
  assert.deepEqual(ids('7'), ['week', 'latest']);
  assert.deepEqual(ids('30'), ['month', 'week', 'latest']);
  assert.deepEqual(ids('all'), ['old', 'month', 'week', 'latest']);
  assert.equal(JSON.stringify(records), before);
  assert.deepEqual(stats().filterRecords([{ created_at: '2026-11-09T00:00:00Z' }, { created_at: 'invalid' }], { period: '7', now }), []);
});

test('usage filters combine purpose and user identity and distinguish all text calls from agent-only calls', () => {
  assert.deepEqual(stats().filterRecords(records, { period: 'all', kind: 'questions', userId: 'a', now }).map(row => row.id), ['month']);
  assert.deepEqual(stats().filterRecords(records, { period: 'all', kind: 'agent', now }).map(row => row.id), ['latest']);
  assert.deepEqual(stats().filterRecords(records, { period: 'all', kind: 'text', now }).map(row => row.id), ['old', 'month', 'latest']);
  assert.equal(stats().filterRecords(records, { period: 'all', userId: 'missing', now }).length, 0);
});

test('usage summary totals calls, tokens, cost and fractional audio seconds across both field conventions', () => {
  assert.deepEqual(stats().summarize(records), { calls: 4, inputTokens: 33, outputTokens: 17, totalCost: 1, audioSeconds: 30.5 });
  assert.deepEqual(stats().summarize([]), { calls: 0, inputTokens: 0, outputTokens: 0, totalCost: 0, audioSeconds: 0 });
  const invalid = [{ input_tokens: 'NaN', output_tokens: -1, estimated_cost: 'Infinity', audio_seconds: null }];
  assert.deepEqual(stats().summarize(invalid), { calls: 1, inputTokens: 0, outputTokens: 0, totalCost: 0, audioSeconds: 0 });
});

test('per-user totals use stable user IDs and report lifetime spend and latest use', () => {
  assert.deepEqual(stats().groupByUser(records), [
    { userId: 'a', email: 'a@example.invalid', calls: 3, spent: 0.875, lastUsedAt: '2026-11-08T12:00:00.000Z' },
    { userId: 'b', email: 'b@example.invalid', calls: 1, spent: 0.125, lastUsedAt: '2026-11-01T12:00:00.000Z' },
  ]);
  assert.deepEqual(stats().groupByUser([]), []);
});
