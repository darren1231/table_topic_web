const { handleBalance } = require('../_lib/balance.js');

exports.GET = function GET(request) {
  return handleBalance({ request, env: process.env, fetch: globalThis.fetch });
};
