const { ConfigurationError } = require('./errors.js');
const { nonNegativeNumber } = require('./numbers.js');

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
    return {
      apiKey,
      text: {
        model: requiredString(env.AI_MODEL ?? 'gpt-5.6-luna'),
        inputRate: numberSetting('AI_INPUT_USD_PER_MTOK', 0.2),
        outputRate: numberSetting('AI_OUTPUT_USD_PER_MTOK', 1.2),
      },
      transcription: {
        model: requiredString(env.AI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe'),
        inputRate,
        outputRate,
        available: inputRate !== null && outputRate !== null,
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

module.exports = { readConfig };
