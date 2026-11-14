const assert = require('node:assert/strict');
const { fakeSigningSecret } = require('./helpers/signing.cjs');
const { test } = require('node:test');

// Deliberately non-credential placeholders; never read the developer environment.
const defaults = { url: 'https://database.example.invalid', anonKey: 'public-placeholder' };
const env = { USAGE_SIGNING_SECRET: fakeSigningSecret, CHATGPT_PREVIEW_KEY: 'preview-placeholder', CHATGPT_PRODUCTION_KEY: 'production-placeholder' };
const readConfig = (...args) => require('../api/_lib/config.js').readConfig(...args);

test('config selects production credentials only for the exact production environment', () => {
  assert.equal(readConfig({ ...env, VERCEL_ENV: 'production' }, defaults).apiKey, 'production-placeholder');
  for (const environment of [undefined, 'preview', 'development', 'staging', '', 'Production']) {
    assert.equal(readConfig({ ...env, VERCEL_ENV: environment }, defaults).apiKey, 'preview-placeholder');
  }
  for (const environment of ['production', 'preview']) {
    const missingSelected = environment === 'production'
      ? { CHATGPT_PREVIEW_KEY: 'preview-placeholder' }
      : { CHATGPT_PRODUCTION_KEY: 'production-placeholder' };
    assert.throws(() => readConfig({ ...missingSelected, VERCEL_ENV: environment }, defaults), {
      status: 503, code: 'configuration_error',
    });
  }
});

test('config provides specified defaults and accepts independent Supabase overrides', () => {
  const input = Object.freeze({ ...env });
  const config = readConfig(input, Object.freeze(defaults));
  assert.deepEqual(config, {
    signingSecret: fakeSigningSecret,
    apiKey: 'preview-placeholder',
    text: { model: 'gpt-5.6-luna', inputRate: 0.2, outputRate: 1.2 },
    transcription: { model: 'gpt-transcribe', inputRate: null, outputRate: null, usdPerMinute: 0.0045, available: true },
    credit: 1,
    supabase: { url: defaults.url, publishableKey: defaults.anonKey },
  });
  assert.deepEqual(readConfig({ ...env, SUPABASE_URL: 'https://override.example.invalid' }, defaults).supabase, {
    url: 'https://override.example.invalid', publishableKey: defaults.anonKey,
  });
  assert.deepEqual(readConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: 'override-placeholder' }, defaults).supabase, {
    url: defaults.url, publishableKey: 'override-placeholder',
  });
});

test('config uses explicit models, rates and zero credit without replacing zero with defaults', () => {
  const config = readConfig({
    ...env, AI_MODEL: 'text-test-model', AI_TRANSCRIBE_MODEL: 'audio-test-model',
    AI_INPUT_USD_PER_MTOK: '0', AI_OUTPUT_USD_PER_MTOK: ' 2.5 ', AI_USER_CREDIT_USD: '0',
    AI_TRANSCRIBE_INPUT_USD_PER_MTOK: '0', AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK: '1e-2',
  }, defaults);
  assert.deepEqual(config.text, { model: 'text-test-model', inputRate: 0, outputRate: 2.5 });
  assert.deepEqual(config.transcription, { model: 'audio-test-model', inputRate: 0, outputRate: 0.01, usdPerMinute: 0.0045, available: true });
  assert.equal(config.credit, 0);
});

test('transcription is available with the per-minute default even without token prices', () => {
  for (const prices of [{}, { AI_TRANSCRIBE_INPUT_USD_PER_MTOK: '0' }, { AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK: '1' }]) {
    assert.equal(readConfig({ ...env, ...prices }, defaults).transcription.available, true);
  }
  assert.equal(readConfig({ ...env, AI_TRANSCRIBE_INPUT_USD_PER_MTOK: '0', AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK: '0' }, defaults).transcription.available, true);
});

test('transcription per-minute price supports an override and explicit zero', () => {
  for (const rate of ['0.01', '0']) {
    const config = readConfig({ ...env, AI_TRANSCRIBE_USD_PER_MINUTE: rate }, defaults);
    assert.equal(config.transcription.usdPerMinute, Number(rate));
    assert.equal(config.transcription.available, true);
  }
});

test('every numeric environment setting rejects invalid values with a safe configuration error', () => {
  const names = [
    'AI_INPUT_USD_PER_MTOK', 'AI_OUTPUT_USD_PER_MTOK', 'AI_USER_CREDIT_USD',
    'AI_TRANSCRIBE_INPUT_USD_PER_MTOK', 'AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK',
    'AI_TRANSCRIBE_USD_PER_MINUTE',
  ];
  for (const name of names) {
    for (const value of ['-1', 'NaN', 'Infinity', '-Infinity', '1e309', '', ' ', '1oops', '0x10', null, true, []]) {
      assert.throws(() => readConfig({ ...env, [name]: value }, defaults), error => {
        assert.equal(error.status, 503);
        assert.equal(error.code, 'configuration_error');
        assert.equal(error.message, 'AI configuration is unavailable');
        return true;
      }, `${name} must reject ${String(value)}`);
    }
  }
});

test('missing keys, blank model names and missing Supabase settings are configuration errors', () => {
  for (const field of ['CHATGPT_PREVIEW_KEY', 'AI_MODEL', 'AI_TRANSCRIBE_MODEL', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']) {
    assert.throws(() => readConfig({ ...env, [field]: ' ' }, defaults), { status: 503 });
  }
  assert.throws(() => readConfig(env), { status: 503 });
});
