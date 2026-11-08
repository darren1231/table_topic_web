const { readBalanceConfig } = require('./config.js');
const defaults = require('./supabase-defaults.js');
const { getCreditBalance } = require('./billing.js');

async function handleBalance({ request, env, fetch }) {
  const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer [^\s]+$/i.test(authorization)) return json({ error: 'unauthorized' }, 401);
  let config;
  try { config = readBalanceConfig(env, defaults); } catch { return json({ error: 'configuration_error' }, 503); }
  const url = config.supabase.url.replace(/\/+$/, '');
  const headers = { apikey: config.supabase.publishableKey, Authorization: authorization, 'Content-Type': 'application/json' };
  try {
    const response = await fetch(`${url}/auth/v1/user`, { method: 'GET', headers });
    if (!response.ok) return json({ error: 'unauthorized' }, 401);
    const user = await response.json();
    if (typeof user?.id !== 'string' || !user.id) return json({ error: 'unauthorized' }, 401);
  } catch { return json({ error: 'unauthorized' }, 401); }
  try {
    const response = await fetch(`${url}/rest/v1/rpc/get_my_ai_balance`, { method: 'POST', headers, body: '{}' });
    if (!response.ok) throw new Error('Balance read failed');
    const data = await response.json();
    if (!Array.isArray(data) || data.length !== 1) throw new Error('Invalid balance');
    return json(getCreditBalance(data[0]?.spent, config.credit));
  } catch { return json({ error: 'balance_unavailable' }, 503); }
}

module.exports = { handleBalance };
