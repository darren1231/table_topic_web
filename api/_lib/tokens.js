const { createServerTiming } = require('./server-timing.js');
const { createRpc } = require('./supabase-rpc.js');
const { readTokenConfig } = require('./config.js');
const { subjectFromVerifiedToken, signExchange } = require('./signing.js');
const { nonNegativeNumber } = require('./numbers.js');
const { InputError } = require('./errors.js');
const defaults = require('./supabase-defaults.js');

function tokenStatus(raw) {
  if (!raw || ![raw.balance, raw.streak, raw.makeupCost, raw.reward].every(value => Number.isSafeInteger(value) && value >= 0)
    || typeof raw.checkedIn !== 'boolean' || typeof raw.canMakeup !== 'boolean') throw new Error('Invalid token status');
  return { balance: raw.balance, streak: raw.streak, checkedIn: raw.checkedIn, canMakeup: raw.canMakeup, makeupCost: raw.makeupCost, reward: raw.reward };
}

async function handleTokens({ request, env, fetch }, action) {
  const timing = createServerTiming(action === 'exchange' ? ['status', 'exchange'] : [action]);
  const json = timing.json;
  const method = action === 'status' ? 'GET' : 'POST';
  if (request.method !== method) return json({ error: 'method_not_allowed' }, 405, { Allow: method });
  const authorization = request.headers.get('Authorization') || '';
  const credential = authorization.match(/^Bearer ([^\s]+)$/i);
  if (!credential) return json({ error: 'unauthorized' }, 401);
  let config;
  try { config = readTokenConfig(env, defaults); } catch { return json({ error: 'configuration_error' }, 503); }
  const rpc = createRpc({ fetch, baseUrl: config.supabase.url.replace(/\/+$/, ''), headers: {
    apikey: config.supabase.publishableKey, Authorization: authorization, 'Content-Type': 'application/json',
  } });
  try {
    if (action === 'status') return json({ ...await timing.measure('status', async () => tokenStatus(await (await rpc('get_my_token_status')).json())), exchangeRate: config.exchangeRate });
    if (action === 'makeup') return json(await timing.measure('makeup', async () => tokenStatus(await (await rpc('makeup_yesterday')).json())));
    await timing.measure('status', async () => tokenStatus(await (await rpc('get_my_token_status')).json()));
    let userId;
    try { userId = subjectFromVerifiedToken(credential[1]); }
    catch { return json({ error: 'unauthorized' }, 401); }
    let body;
    try { body = await request.json(); } catch { throw new InputError(); }
    if (!body || Array.isArray(body) || !Number.isInteger(body.units) || body.units < 1 || body.units > 2147483) throw new InputError();
    if (!Number.isFinite(body.units * config.exchangeRate)) return json({ error: 'configuration_error' }, 503);
    const result = await timing.measure('exchange', async () => (await rpc('exchange_tokens',
      signExchange(userId, body.units, config.exchangeRate, config.signingSecret))).json());
    if (result?.units !== body.units || result?.tokensSpent !== body.units * 1000) throw new Error('Invalid exchange result');
    return json({ units: result.units, tokensSpent: result.tokensSpent,
      creditAdded: nonNegativeNumber(result.creditAdded), rateUsd: nonNegativeNumber(result.rateUsd), status: tokenStatus(result.status) });
  } catch (error) {
    if (error?.unauthorized) return json({ error: 'unauthorized' }, 401);
    if (error instanceof InputError) return json({ error: 'invalid_input' }, 400);
    if (error?.reason) return json({ error: error.reason }, 400);
    if (error?.rpcCode === '22023') return json({ error: 'invalid_input' }, 400);
    return json({ error: 'tokens_unavailable' }, 503);
  }
}

const handleTokenStatus = args => handleTokens(args, 'status');
const handleTokenMakeup = args => handleTokens(args, 'makeup');
const handleTokenExchange = args => handleTokens(args, 'exchange');
module.exports = { handleTokenStatus, handleTokenMakeup, handleTokenExchange };
