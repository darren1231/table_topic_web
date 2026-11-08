const { readConfig } = require('./config.js');
const supabaseDefaults = require('./supabase-defaults.js');
const { calculateCost, getCreditBalance } = require('./billing.js');
const { validateRespondInput } = require('./validation.js');
const { sanitizeErrorMessage } = require('./errors.js');

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function responseUsage(raw, required) {
  if (required && (!raw || raw.input_tokens === undefined || raw.output_tokens === undefined)) {
    throw new Error('Missing OpenAI usage');
  }
  return { inputTokens: raw?.input_tokens ?? 0, outputTokens: raw?.output_tokens ?? 0 };
}

async function handleRespond({ request, env, fetch, logger = console }) {
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
  const secrets = [config.apiKey, config.supabase.publishableKey, credential[1]];
  const log = (message, error) => logger.error(message, sanitizeErrorMessage(error, secrets));
  const rpc = async (name, args = {}) => {
    const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST', headers, body: JSON.stringify(args),
    });
    if (!response.ok) throw new Error(`Supabase RPC failed (HTTP ${response.status})`);
    return response;
  };
  const readBalance = async () => {
    const response = await rpc('get_my_ai_balance');
    const data = await response.json();
    if (!Array.isArray(data) || data.length !== 1) throw new Error('Invalid balance response');
    return getCreditBalance(data[0]?.spent, config.credit);
  };

  try {
    const response = await fetch(`${baseUrl}/auth/v1/user`, { method: 'GET', headers });
    if (!response.ok) return json({ error: 'unauthorized' }, 401);
    const user = await response.json();
    if (typeof user?.id !== 'string' || !user.id) return json({ error: 'unauthorized' }, 401);
  } catch {
    return json({ error: 'unauthorized' }, 401);
  }

  let balance;
  try {
    balance = await readBalance();
  } catch {
    return json({ error: 'balance_unavailable' }, 503);
  }
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
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.text.model, instructions: input.instructions, input: input.input }),
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
  }

  try {
    await rpc('record_ai_usage', {
      p_provider: 'openai', p_model: config.text.model, p_kind: input.kind,
      p_status: status, p_error: error,
      p_input_tokens: usage.inputTokens, p_output_tokens: usage.outputTokens,
      p_input_rate: config.text.inputRate, p_output_rate: config.text.outputRate,
      p_estimated_cost: cost, p_duration_ms: Math.max(0, Date.now() - startedAt),
    });
  } catch (recordError) {
    // Generation has already happened: preserve the result rather than retry/bill twice.
    log('AI usage recording failed', recordError);
  }

  if (status === 'error') return json({ error: 'upstream_error' }, 502);
  try {
    balance = await readBalance();
  } catch (balanceError) {
    log('AI balance refresh failed', balanceError);
    balance = null;
  }
  return json({ text, usage, cost, balance });
}

module.exports = { handleRespond };
