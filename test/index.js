const assert = require('node:assert/strict');
const { test } = require('node:test');

require('./coach-result-utils.test.cjs');
require('./speech-utils.test.cjs');
require('./ai-usage.test.cjs');
require('./signing.test.cjs');
require('./signed-usage.test.cjs');
require('./tokens.test.cjs');
require('./feedback.test.cjs');
require('./feedback-ui.test.cjs');
require('./token-endpoints.test.cjs');
require('./token-ui.test.cjs');
require('./token-ui-integration.test.cjs');
require('./ai-config.test.cjs');
require('./ai-billing.test.cjs');
require('./ai-validation.test.cjs');
require('./ai-errors.test.cjs');
require('./supabase-defaults.test.cjs');
require('./ai-respond.test.cjs');
require('./ai-transcribe.test.cjs');
require('./ai-balance.test.cjs');
require('./usage-stats.test.cjs');
require('./admin.test.cjs');
require('./admin-feedback.test.cjs');
require('./feedback-issue-draft.test.cjs');
require('./feedback-issue.test.cjs');
require('./system-ai.test.cjs');
require('./system-ai-integration.test.cjs');
require('./wake-lock.test.cjs');
require('./recording-integration.test.cjs');
require('./recording-session.test.cjs');
require('./practice-flow.test.cjs');
require('./practice-stats.test.cjs');
require('./practice-data.test.cjs');
require('./coach-parsing.test.cjs');
require('./builtin-coach.test.cjs');
require('./review-cards.test.cjs');
require('./html-utils.test.cjs');
require('./html-security.test.cjs');
require('./i18n.test.cjs');
require('./cloud.test.cjs');
require('./version-consistency.test.cjs');
require('./user-guide.test.cjs');

test('test environment can query an in-memory PostgreSQL database', async () => {
  const { createDatabase } = require('./helpers/database.cjs');
  const database = createDatabase();

  try {
    const result = await database.query('SELECT 1 AS value');
    assert.deepEqual(result.rows, [{ value: 1 }]);
  } finally {
    await database.close();
  }
});
