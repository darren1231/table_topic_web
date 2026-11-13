const { handleFeedbackIssue } = require('../_lib/feedback-issue.js');

exports.POST = function POST(request) {
  return handleFeedbackIssue({ request, env: process.env, fetch: globalThis.fetch });
};
