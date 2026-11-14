const { signUsage, subjectFromVerifiedToken } = require('./signing.js');
const { createServerTiming } = require('./server-timing.js');
const { createRpc } = require('./supabase-rpc.js');
const { readConfig } = require('./config.js');
const supabaseDefaults = require('./supabase-defaults.js');
const { calculateCost, getCreditBalance, getAiCreditBalance } = require('./billing.js');
const { validateRespondInput } = require('./validation.js');
const { sanitizeErrorMessage } = require('./errors.js');

function responseUsage(raw, required) {
  if (required && (!raw || raw.input_tokens === undefined || raw.output_tokens === undefined)) {
    throw new Error('Missing OpenAI usage');
  }
  return { inputTokens: raw?.input_tokens ?? 0, outputTokens: raw?.output_tokens ?? 0 };
}

async function handleRespond({ request, env, fetch, logger = console }) {
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
    input = validateRespondInput(await request.json());
  } catch {
    return json({ error: 'invalid_input' }, 400);
  }

  const startedAt = Date.now();
  let text = '', usage = { inputTokens: 0, outputTokens: 0 }, cost = 0;
  let status = 'success', error = '';
  timing.start('openai');
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.text.model, instructions: input.instructions, input: input.input,
        store: false, max_output_tokens: 8000,
      }),
    });
    const data = await response.json();
    const candidateUsage = responseUsage(data?.usage, response.ok);
    const candidateCost = calculateCost(candidateUsage, config.text);
    usage = candidateUsage;
    cost = candidateCost;
    if (!response.ok) throw new Error('OpenAI request failed');
    // Keep the existing public/app.js callAgent Responses text precedence.
    text = data.output_text || data.output?.flatMap(item => item.content || [])
      .map(item => item.text).filter(Boolean).join('') || '';
    if (typeof text !== 'string') throw new Error('Invalid OpenAI text response');
  } catch {
    status = 'error';
    // Neither public errors nor usage diagnostics contain the upstream error body.
    error = 'OpenAI request failed';
  } finally {
    timing.end('openai');
  }

  let recorded = false, checkIn = null;
  timing.start('record');
  try {
    const recordedResponse = await rpc('record_ai_usage', signUsage(userId, {
      p_provider: 'openai', p_model: config.text.model, p_kind: input.kind,
      p_status: status, p_error: error,
      p_input_tokens: usage.inputTokens, p_output_tokens: usage.outputTokens,
      p_input_rate: config.text.inputRate, p_output_rate: config.text.outputRate,
      p_estimated_cost: cost, p_duration_ms: Math.max(0, Date.now() - startedAt),
    }, config.signingSecret));
    const result = await recordedResponse.json();
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid usage recording result');
    const value = result.checkIn;
    if (!value || typeof value.checkedIn !== 'boolean'
      || ![value.reward, value.streak, value.balance].every(number => Number.isSafeInteger(number) && number >= 0)) {
      throw new Error('Invalid check-in result');
    }
    checkIn = { checkedIn: value.checkedIn, reward: value.reward, streak: value.streak, balance: value.balance };
    recorded = true;
  } catch (recordError) {
    // Generation has already happened: preserve the result rather than retry/bill twice.
    log('AI usage recording failed', recordError);
  } finally {
    timing.end('record');
  }

  if (status === 'error') return json({ error: 'upstream_error' }, 502);
  balance = recorded ? getCreditBalance(balance.spent + cost, balance.credit) : null;
  return json({ text, usage, cost, balance, checkIn });
}

module.exports = { handleRespond };
