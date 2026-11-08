const assert = require('node:assert/strict');
const { test } = require('node:test');
const calculateCost = (...args) => require('../api/_lib/billing.js').calculateCost(...args);
const getCreditBalance = (...args) => require('../api/_lib/billing.js').getCreditBalance(...args);

test('cost charges input and output per million tokens with no rounding of small charges', () => {
  assert.equal(calculateCost({ inputTokens: 1_000_000, outputTokens: 500_000 }, { inputRate: 0.2, outputRate: 1.2 }), 0.8);
  assert.equal(calculateCost({ inputTokens: 0, outputTokens: 0 }, { inputRate: 0.2, outputRate: 1.2 }), 0);
  assert.equal(calculateCost({ inputTokens: 10, outputTokens: 20 }, { inputRate: 0, outputRate: 0 }), 0);
  assert.ok(Math.abs(calculateCost({ inputTokens: 1, outputTokens: 1 }, { inputRate: 0.2, outputRate: 1.2 }) - 0.0000014) < 1e-20);
});

test('cost rejects malformed usage, negative rates and overflow rather than producing invalid charges', () => {
  for (const field of ['inputTokens', 'outputTokens']) {
    for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '100', null, undefined]) {
      assert.throws(() => calculateCost({ inputTokens: 1, outputTokens: 1, [field]: value }, { inputRate: 1, outputRate: 1 }), TypeError);
    }
  }
  for (const field of ['inputRate', 'outputRate']) {
    for (const value of [-1, NaN, Infinity, '1', null, undefined]) {
      assert.throws(() => calculateCost({ inputTokens: 1, outputTokens: 1 }, { inputRate: 1, outputRate: 1, [field]: value }), TypeError);
    }
  }
  assert.throws(() => calculateCost(
    { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 }, { inputRate: Number.MAX_VALUE, outputRate: 1 },
  ), RangeError);
});

test('credit is exhausted at or above its limit, including zero credit', () => {
  assert.deepEqual(getCreditBalance('0.25', 1), { spent: 0.25, credit: 1, balance: 0.75, exhausted: false });
  assert.deepEqual(getCreditBalance(1, 1), { spent: 1, credit: 1, balance: 0, exhausted: true });
  assert.deepEqual(getCreditBalance('1.25', 1), { spent: 1.25, credit: 1, balance: 0, exhausted: true });
  assert.deepEqual(getCreditBalance(0, 0), { spent: 0, credit: 0, balance: 0, exhausted: true });
  assert.equal(getCreditBalance('0.999999', 1).exhausted, false);
});

test('credit rejects invalid database totals or limits instead of treating them as unused credit', () => {
  for (const value of [-1, NaN, Infinity, '-Infinity', 'NaN', '', ' ', '0x10', null, undefined, false, {}]) {
    assert.throws(() => getCreditBalance(value, 1), TypeError);
    assert.throws(() => getCreditBalance(0, value), TypeError);
  }
});
