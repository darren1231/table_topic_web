function createRpc({ fetch, baseUrl, headers, reasons = ['insufficient_tokens', 'makeup_unavailable'] }) {
  return async (name, args = {}) => {
    const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST', headers, body: JSON.stringify(args),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const unauthorized = response.status === 401 || response.status === 403
        || ['42501', 'PGRST301', 'PGRST302', 'PGRST303', '28000', '28P01'].includes(data?.code);
      // Keep upstream bodies and credentials out of public errors and diagnostics.
      const reason = ['22023', '55000'].includes(data?.code) && reasons.includes(data?.message)
        ? data.message : undefined;
      throw Object.assign(new Error(`Supabase RPC failed (HTTP ${response.status})`), { unauthorized, rpcCode: data?.code, reason });
    }
    return response;
  };
}

module.exports = { createRpc };
