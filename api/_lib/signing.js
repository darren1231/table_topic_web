const { createHmac, randomUUID } = require('node:crypto');
const { ConfigurationError } = require('./errors.js');

function signingSecret(value) {
  if (typeof value !== 'string' || !value.trim() || [...value].length < 32) throw new ConfigurationError();
  return value; // Preserve the exact UTF-8 bytes; do not trim signing material.
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new TypeError('Invalid signing UUID');
  return value.toLowerCase();
}

// Match PostgreSQL trim_scale(numeric)::text, including JSON's exponent notation.
function decimal(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError('Invalid signing number');
  const [coefficient, exponent] = String(value).split('e');
  if (exponent === undefined) return coefficient;
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

function usagePayload(userId, record) {
  for (const count of [record.p_input_tokens, record.p_output_tokens]) {
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('Invalid signing token count');
  }
  for (const field of [record.p_kind, record.p_status, record.p_model]) {
    if (typeof field !== 'string' || field.includes('|')) throw new TypeError('Invalid signing text');
  }
  return [uuid(userId), record.p_kind, record.p_status, record.p_model,
    record.p_input_tokens, record.p_output_tokens, decimal(record.p_estimated_cost),
    decimal(record.p_audio_seconds ?? 0), new Date(record.p_issued_at).toISOString(), uuid(record.p_nonce)].join('|');
}

function signUsage(userId, record, secret, { issuedAt = new Date().toISOString(), nonce = randomUUID() } = {}) {
  signingSecret(secret);
  const signed = { ...record, p_audio_seconds: record.p_audio_seconds ?? 0,
    p_issued_at: new Date(issuedAt).toISOString(), p_nonce: uuid(nonce) };
  signed.p_signature = createHmac('sha256', secret).update(usagePayload(userId, signed), 'utf8').digest('hex');
  return signed;
}

// Decoding is NOT authentication. Call only after PostgREST has successfully
// authenticated this exact token through a uid-checking RPC (AI balance or token status).
function subjectFromVerifiedToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new TypeError('Invalid verified token');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  return uuid(claims?.sub);
}

function exchangePayload(userId, args) {
  if (!Number.isInteger(args.p_units) || args.p_units < 1 || args.p_units > 2147483) throw new TypeError('Invalid exchange units');
  return ['exchange', uuid(userId), args.p_units, decimal(args.p_rate_usd),
    new Date(args.p_issued_at).toISOString(), uuid(args.p_nonce)].join('|');
}

function signExchange(userId, units, rate, secret, { issuedAt = new Date().toISOString(), nonce = randomUUID() } = {}) {
  signingSecret(secret);
  const args = { p_units: units, p_rate_usd: rate, p_issued_at: new Date(issuedAt).toISOString(), p_nonce: uuid(nonce) };
  return { ...args, p_signature: createHmac('sha256', secret).update(exchangePayload(userId, args), 'utf8').digest('hex') };
}

module.exports = { usagePayload, signUsage, signingSecret, subjectFromVerifiedToken, exchangePayload, signExchange };
