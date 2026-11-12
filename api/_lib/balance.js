const { createServerTiming } = require('./server-timing.js');
const { createRpc } = require('./supabase-rpc.js');
const { readBalanceConfig } = require('./config.js');
const defaults = require('./supabase-defaults.js');
const { getAiCreditBalance } = require('./billing.js');

async function handleBalance({ request, env, fetch }) {
  const timing = createServerTiming(['balance']);
  const json = timing.json;
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer [^\s]+$/i.test(authorization)) return json({ error: 'unauthorized' }, 401);
  let config;
  try { config = readBalanceConfig(env, defaults); } catch { return json({ error: 'configuration_error' }, 503); }
  const url = config.supabase.url.replace(/\/+$/, '');
  const headers = { apikey: config.supabase.publishableKey, Authorization: authorization, 'Content-Type': 'application/json' };
  const rpc = createRpc({ fetch, baseUrl: url, headers });
  try {
    const balance = await timing.measure('balance', async () => {
      const response = await rpc('get_my_ai_balance');
      const data = await response.json();
      if (!Array.isArray(data) || data.length !== 1) throw new Error('Invalid balance');
      return getAiCreditBalance(data[0], config.credit);
    });
    return json(balance);
  } catch (error) {
    return error?.unauthorized ? json({ error: 'unauthorized' }, 401) : json({ error: 'balance_unavailable' }, 503);
  }
}

module.exports = { handleBalance };
