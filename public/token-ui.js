(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TokenUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function rewardLine(status) {
    return status.checkedIn
      ? { key: 'tokens.tomorrowReward', count: [10, 20, 30, 50, 80, 100][Math.min(status.streak, 5)] }
      : { key: 'tokens.todayReward', count: status.reward };
  }
  function fail(code) {
    const keys = { unauthorized: 'systemAi.signInAgain', insufficient_tokens: 'tokens.insufficient', makeup_unavailable: 'tokens.makeupUnavailable',
      invalid_input: 'tokens.invalidInput', network_error: 'tokens.networkError', unavailable: 'tokens.unavailable' };
    return Object.assign(new Error('Token request failed'), { code, messageKey: keys[code] || keys.unavailable });
  }
  function validStatus(data) {
    if (!data || !['balance', 'streak', 'reward', 'makeupCost'].every(key => Number.isSafeInteger(data[key]) && data[key] >= 0)
      || typeof data.checkedIn !== 'boolean' || typeof data.canMakeup !== 'boolean') throw fail('unavailable');
    return { balance: data.balance, streak: data.streak, checkedIn: data.checkedIn, canMakeup: data.canMakeup, makeupCost: data.makeupCost, reward: data.reward };
  }
  function rate(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw fail('unavailable');
    return value;
  }
  function validCheckIn(value) {
    return Boolean(value && typeof value.checkedIn === 'boolean'
      && ['reward', 'streak', 'balance'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0));
  }
  function createClient({ fetch, getAccessToken }) {
    async function send(action, body) {
      let token;
      try { token = await getAccessToken(); } catch { throw fail('unauthorized'); }
      if (!token) throw fail('unauthorized');
      let response;
      try { response = await fetch(`/api/tokens/${action}`, { method: action === 'status' ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, ...(action === 'status' ? {} : { 'Content-Type': 'application/json' }) },
        ...(action === 'status' ? {} : { body: JSON.stringify(body || {}) }) });
      } catch { throw fail('network_error'); }
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) throw fail('unauthorized');
        if (response.status === 400 && ['insufficient_tokens', 'makeup_unavailable', 'invalid_input'].includes(data?.error)) throw fail(data.error);
        throw fail('unavailable');
      }
      if (action === 'status') return { ...validStatus(data), exchangeRate: rate(data.exchangeRate) };
      if (action === 'makeup') return validStatus(data);
      if (!data || !Number.isInteger(data.units) || data.units !== body.units || data.tokensSpent !== body.units * 1000) throw fail('unavailable');
      return { units: data.units, tokensSpent: data.tokensSpent, creditAdded: rate(data.creditAdded), rateUsd: rate(data.rateUsd), status: validStatus(data.status) };
    }
    return { status: () => send('status'), makeup: () => send('makeup'), exchange: units => send('exchange', { units }) };
  }
  return { rewardLine, validCheckIn, createClient };
});
