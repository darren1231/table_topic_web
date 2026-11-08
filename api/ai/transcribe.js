const { handleTranscribe } = require('../_lib/transcribe.js');

exports.POST = function POST(request) {
  return handleTranscribe({ request, env: process.env, fetch: globalThis.fetch });
};
