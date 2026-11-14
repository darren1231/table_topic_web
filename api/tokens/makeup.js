const { handleTokenMakeup } = require('../_lib/tokens.js');
exports.POST = function POST(request) {
  return handleTokenMakeup({ request, env: process.env, fetch: globalThis.fetch });
};
