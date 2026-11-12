const assert = require('node:assert/strict');
const { test } = require('node:test');

test('AI credit includes the database bonus and rejects malformed or overflowing totals', () => {
  const { getAiCreditBalance } = require('../api/_lib/billing.js');
  assert.deepEqual(getAiCreditBalance({ spent: '1', bonus_credit: '0.03' }, 1), {
    spent: 1, credit: 1.03, balance: 0.030000000000000027, exhausted: false,
  });
  for (const bonus_credit of [undefined, null, '-1', 'NaN', 'Infinity']) assert.throws(() => getAiCreditBalance({ spent: '0', bonus_credit }, 1));
  assert.throws(() => getAiCreditBalance({ spent: '0', bonus_credit: 1e308 }, 1e308));
});
const calculateCost = (...args) => require('../api/_lib/billing.js').calculateCost(...args);
const getCreditBalance = (...args) => require('../api/_lib/billing.js').getCreditBalance(...args);
const calculateTranscriptionCost = (...args) => require('../api/_lib/billing.js').calculateTranscriptionCost(...args);

test('transcription duration billing accepts fractional seconds and uses per-minute pricing', () => {
  for (const usage of [{ type: 'duration', seconds: 90 }, { seconds: 90 }, { type: 'tokens', seconds: 90 }]) {
    const result = calculateTranscriptionCost(usage, { usdPerMinute: 0.0045 });
    assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0, audioSeconds: 90 });
    assert.equal(result.inputRate, 0);
    assert.equal(result.outputRate, 0);
    assert.ok(Math.abs(result.cost - 0.00675) < 1e-15);
  }
  assert.equal(calculateTranscriptionCost({ seconds: 30.5 }, { usdPerMinute: 0.0045 }).usage.audioSeconds, 30.5);
  assert.equal(calculateTranscriptionCost({ seconds: 0 }, { usdPerMinute: 0.0045 }).cost, 0);
  assert.equal(calculateTranscriptionCost({ seconds: 90 }, { usdPerMinute: 0 }).cost, 0);
});

test('transcription token billing requires both prices and records zero audio seconds', () => {
  const raw = { type: 'tokens', input_tokens: 1_000_000, output_tokens: 500_000 };
  assert.deepEqual(calculateTranscriptionCost(raw, { inputRate: 0.4, outputRate: 1.2 }), {
    usage: { inputTokens: 1_000_000, outputTokens: 500_000, audioSeconds: 0 }, cost: 1, inputRate: 0.4, outputRate: 1.2,
  });
  for (const prices of [{}, { inputRate: 0 }, { outputRate: 0 }, { inputRate: null, outputRate: 1 }]) {
    assert.throws(() => calculateTranscriptionCost(raw, prices), TypeError);
  }
});

test('transcription rejects absent usage, invalid seconds, invalid rates and overflow without a token fallback', () => {
  const prices = { usdPerMinute: 0.0045, inputRate: 0.4, outputRate: 1.2 };
  for (const raw of [undefined, null, {}, [], { type: 'duration' }, { type: 'unexpected', input_tokens: 1, output_tokens: 1 }]) {
    assert.throws(() => calculateTranscriptionCost(raw, prices), TypeError);
  }
  for (const seconds of [undefined, null, '60', -1, NaN, Infinity, {}, false]) {
    assert.throws(() => calculateTranscriptionCost({ seconds, input_tokens: 1, output_tokens: 1 }, prices), TypeError);
  }
  for (const rate of [undefined, null, '0.0045', -1, NaN, Infinity]) {
    assert.throws(() => calculateTranscriptionCost({ seconds: 60 }, { usdPerMinute: rate }), TypeError);
  }
  assert.throws(() => calculateTranscriptionCost({ seconds: Number.MAX_VALUE }, { usdPerMinute: Number.MAX_VALUE }), RangeError);
});

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
