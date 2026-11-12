const { ConfigurationError } = require('./errors.js');
const { nonNegativeNumber } = require('./numbers.js');
const { signingSecret } = require('./signing.js');

// gpt-transcribe: USD per minute. Source checked 2026-11-08:
// https://developers.openai.com/api/docs/pricing
const DEFAULT_TRANSCRIBE_USD_PER_MINUTE = 0.0045;

function requiredString(value) {
  if (typeof value !== 'string' || !value.trim()) throw new ConfigurationError();
  return value.trim();
}

// The caller supplies the public/supabase-config.js values as { url, anonKey }.
// No process.env, file reads, or network access occur at this boundary.
function readConfig(env = {}, supabaseDefaults = {}) {
  const numberSetting = (name, fallback) => env[name] === undefined
    ? fallback : nonNegativeNumber(env[name], { allowString: true });

  try {
    const apiKey = requiredString(env.VERCEL_ENV === 'production'
      ? env.CHATGPT_PRODUCTION_KEY : env.CHATGPT_PREVIEW_KEY);
    const inputRate = numberSetting('AI_TRANSCRIBE_INPUT_USD_PER_MTOK', null);
    const outputRate = numberSetting('AI_TRANSCRIBE_OUTPUT_USD_PER_MTOK', null);
    const usdPerMinute = numberSetting('AI_TRANSCRIBE_USD_PER_MINUTE', DEFAULT_TRANSCRIBE_USD_PER_MINUTE);
    return {
      signingSecret: signingSecret(env.USAGE_SIGNING_SECRET),
      apiKey,
      text: {
        model: requiredString(env.AI_MODEL ?? 'gpt-5.6-luna'),
        inputRate: numberSetting('AI_INPUT_USD_PER_MTOK', 0.2),
        outputRate: numberSetting('AI_OUTPUT_USD_PER_MTOK', 1.2),
      },
      transcription: {
        model: requiredString(env.AI_TRANSCRIBE_MODEL ?? 'gpt-transcribe'),
        inputRate,
        outputRate,
        usdPerMinute,
        available: usdPerMinute !== null,
      },
      credit: numberSetting('AI_USER_CREDIT_USD', 1),
      supabase: {
        url: requiredString(env.SUPABASE_URL ?? supabaseDefaults.url),
        publishableKey: requiredString(env.SUPABASE_PUBLISHABLE_KEY ?? supabaseDefaults.anonKey),
      },
    };
  } catch {
    // Never echo environment values (including accidentally misplaced credentials).
    throw new ConfigurationError();
  }
}

function readBalanceConfig(env = {}, defaults = {}) {
  try {
    return {
      signingSecret: signingSecret(env.USAGE_SIGNING_SECRET),
      credit: env.AI_USER_CREDIT_USD === undefined ? 1 : nonNegativeNumber(env.AI_USER_CREDIT_USD, { allowString: true }),
      supabase: { url: requiredString(env.SUPABASE_URL ?? defaults.url), publishableKey: requiredString(env.SUPABASE_PUBLISHABLE_KEY ?? defaults.anonKey) },
    };
  } catch { throw new ConfigurationError(); }
}

module.exports = { readConfig, readBalanceConfig };
