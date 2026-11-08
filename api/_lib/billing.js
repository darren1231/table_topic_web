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

module.exports = { calculateCost, getCreditBalance };
