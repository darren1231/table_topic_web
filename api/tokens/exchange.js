const { handleTokenExchange } = require('../_lib/tokens.js');
exports.POST = function POST(request) {
  return handleTokenExchange({ request, env: process.env, fetch: globalThis.fetch });
};
