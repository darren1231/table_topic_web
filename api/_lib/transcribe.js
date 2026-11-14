const { signUsage, subjectFromVerifiedToken } = require('./signing.js');
const { createServerTiming } = require('./server-timing.js');
const { createRpc } = require('./supabase-rpc.js');
const { readConfig } = require('./config.js');
const supabaseDefaults = require('./supabase-defaults.js');
const { calculateTranscriptionCost, getCreditBalance, getAiCreditBalance } = require('./billing.js');
const { validateTranscriptionInput } = require('./validation.js');
const { sanitizeErrorMessage } = require('./errors.js');

async function handleTranscribe({ request, env, fetch, logger = console }) {
  const timing = createServerTiming(['balance', 'openai', 'record']);
  const json = timing.json;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  const authorization = request.headers.get('Authorization') || '';
  const credential = authorization.match(/^Bearer ([^\s]+)$/i);
  if (!credential) return json({ error: 'unauthorized' }, 401);

  let config;
  try {
    config = readConfig(env, supabaseDefaults);
  } catch {
    return json({ error: 'configuration_error' }, 503);
  }

  const baseUrl = config.supabase.url.replace(/\/+$/, '');
  const headers = {
    apikey: config.supabase.publishableKey,
    Authorization: authorization,
    'Content-Type': 'application/json',
  };
  const secrets = [config.signingSecret, config.apiKey, config.supabase.publishableKey, credential[1]];
  const log = (message, error) => logger.error(message, sanitizeErrorMessage(error, secrets));
  const rpc = createRpc({ fetch, baseUrl, headers });
  const readBalance = () => timing.measure('balance', async () => {
    const response = await rpc('get_my_ai_balance');
    const data = await response.json();
    if (!Array.isArray(data) || data.length !== 1) throw new Error('Invalid balance response');
    return getAiCreditBalance(data[0], config.credit);
  });

  let balance;
  try {
    balance = await readBalance();
  } catch (error) {
    return error?.unauthorized ? json({ error: 'unauthorized' }, 401) : json({ error: 'balance_unavailable' }, 503);
  }
  let userId;
  try { userId = subjectFromVerifiedToken(credential[1]); }
  catch { return json({ error: 'unauthorized' }, 401); }
  if (balance.exhausted) return json({ error: 'credit_exhausted' }, 402);

  let input;
  try {
    const form = await request.formData();
    input = validateTranscriptionInput({
      file: form.get('file'), prompt: form.get('prompt'), kind: form.get('kind'),
    });
  } catch {
    return json({ error: 'invalid_input' }, 400);
  }
  if (!config.transcription.available) return json({ error: 'configuration_error' }, 503);

  const startedAt = Date.now();
  let text = '', usage = { inputTokens: 0, outputTokens: 0, audioSeconds: 0 }, cost = 0;
  let inputRate = 0, outputRate = 0;
  let status = 'success', error = '';
  timing.start('openai');
  try {
    const form = new FormData();
    form.append('file', input.file, input.file.name);
    form.append('model', config.transcription.model);
    form.append('prompt', input.prompt);
    form.append('response_format', 'json');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', signal: AbortSignal.timeout(60_000),
      // fetch supplies Content-Type with the correct multipart boundary.
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
    });
    const data = await response.json();
    const charge = calculateTranscriptionCost(data?.usage, config.transcription);
    usage = charge.usage;
    cost = charge.cost;
    inputRate = charge.inputRate;
    outputRate = charge.outputRate;
    if (!response.ok || typeof data.text !== 'string') throw new Error('OpenAI transcription failed');
    text = data.text;
  } catch {
    status = 'error';
    // Unknown usage stays zero only on an error record, never a successful result.
    error = 'OpenAI transcription failed';
  } finally {
    timing.end('openai');
  }

  let recorded = false;
  timing.start('record');
  try {
    await rpc('record_ai_usage', signUsage(userId, {
      p_provider: 'openai', p_model: config.transcription.model, p_kind: 'transcription',
      p_status: status, p_error: error,
      p_input_tokens: usage.inputTokens, p_output_tokens: usage.outputTokens,
      p_input_rate: inputRate, p_output_rate: outputRate,
      p_estimated_cost: cost, p_duration_ms: Math.max(0, Date.now() - startedAt),
      p_audio_seconds: usage.audioSeconds,
    }, config.signingSecret));
    recorded = true;
  } catch (recordError) {
    log('AI transcription usage recording failed', recordError);
  } finally {
    timing.end('record');
  }

  if (status === 'error') return json({ error: 'upstream_error' }, 502);
  balance = recorded ? getCreditBalance(balance.spent + cost, balance.credit) : null;
  return json({ text, usage, cost, balance });
}

module.exports = { handleTranscribe };
