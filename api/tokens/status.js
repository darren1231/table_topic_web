const { handleTokenStatus } = require('../_lib/tokens.js');
exports.GET = function GET(request) {
  return handleTokenStatus({ request, env: process.env, fetch: globalThis.fetch });
};
