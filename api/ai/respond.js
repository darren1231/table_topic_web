const { handleRespond } = require('../_lib/respond.js');

// Named Web Standard handler, using the repository's CommonJS module format.
exports.POST = function POST(request) {
  return handleRespond({ request, env: process.env, fetch: globalThis.fetch });
};
