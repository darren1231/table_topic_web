const { nonNegativeNumber } = require('./numbers.js');

function calculateCost({ inputTokens, outputTokens }, { inputRate, outputRate }) {
  for (const count of [inputTokens, outputTokens]) {
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('Invalid token count');
  }
  nonNegativeNumber(inputRate);
  nonNegativeNumber(outputRate);
  const cost = inputTokens / 1_000_000 * inputRate + outputTokens / 1_000_000 * outputRate;
  if (!Number.isFinite(cost)) throw new RangeError('AI usage cost overflow');
  return cost;
}

function getCreditBalance(spent, credit) {
  spent = nonNegativeNumber(spent, { allowString: true });
  credit = nonNegativeNumber(credit, { allowString: true });
  return { spent, credit, balance: Math.max(0, credit - spent), exhausted: spent >= credit };
}

function calculateTranscriptionCost(raw, prices) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Missing transcription usage');
  if (raw.type === 'duration' || Object.hasOwn(raw, 'seconds')) {
    const seconds = nonNegativeNumber(raw.seconds);
    const rate = nonNegativeNumber(prices.usdPerMinute);
    const cost = seconds / 60 * rate;
    if (!Number.isFinite(cost)) throw new RangeError('AI usage cost overflow');
    return {
      usage: { inputTokens: 0, outputTokens: 0, audioSeconds: seconds },
      cost, inputRate: 0, outputRate: 0,
    };
  }
  if (raw.type !== undefined && raw.type !== 'tokens') throw new TypeError('Unknown transcription usage type');
  const usage = { inputTokens: raw.input_tokens, outputTokens: raw.output_tokens, audioSeconds: 0 };
  // Token prices have no default; absent rates must not allow free results.
  const cost = calculateCost(usage, prices);
  return { usage, cost, inputRate: prices.inputRate, outputRate: prices.outputRate };
}

module.exports = { calculateCost, getCreditBalance, calculateTranscriptionCost };
