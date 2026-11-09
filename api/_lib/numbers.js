// Decimal strings are needed for environment variables and PostgreSQL numeric results.
function nonNegativeNumber(value, { allowString = false } = {}) {
  if (allowString && typeof value === 'string') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) {
      throw new TypeError('Expected a finite non-negative number');
    }
    value = Number(value.trim());
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError('Expected a finite non-negative number');
  }
  return value;
}

module.exports = { nonNegativeNumber };
