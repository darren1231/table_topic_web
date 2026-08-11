const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RetryLogic = require('../retry-logic.js');

test('retry retains the question and associates attempt 2 with attempt 1', () => {
  const first = { id: 'a1', sessionId: 'session', question: 'Same question?', retryGoals: [{ id: 'g1', text: 'Lead with the conclusion.' }] };
  const second = RetryLogic.associateAttempt({ id: 'a2', question: 'Wrong question' }, first);
  assert.equal(second.question, first.question);
  assert.equal(second.parentAttemptId, first.id);
  assert.equal(second.retryOf, first.id);
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(second.attemptNumber, 2);
});

test('score comparisons calculate positive, zero, and negative deltas', () => {
  const rows = RetryLogic.scoreComparisons(
    { overall: 60, structure: 62, detail: 70, fluency: 78 },
    { overall: 70, structure: 81, detail: 70, fluency: 74 }
  );
  assert.deepEqual(rows.map(row => [row.key, row.delta, row.direction]), [
    ['overall', 10, 'up'], ['structure', 19, 'up'], ['detail', 0, 'same'], ['fluency', -4, 'down']
  ]);
  assert.equal(RetryLogic.deltaLabel(19), '↑19');
  assert.equal(RetryLogic.deltaLabel(0), '→0');
  assert.equal(RetryLogic.deltaLabel(-4), '↓4');
});

test('legacy standalone records and absent metrics remain safe', () => {
  const legacy = RetryLogic.associateAttempt({ id: 'legacy', question: 'Old question' });
  assert.equal(legacy.attemptNumber, 1);
  assert.equal(legacy.sessionId, 'legacy');
  assert.deepEqual(RetryLogic.scoreComparisons({}, {}), []);
});

test('goal results preserve every retry goal and normalize unknown statuses', () => {
  const goals = [{ text: 'State the point early.' }, { text: 'Add an example.' }, { text: 'Close clearly.' }];
  const results = RetryLogic.normalizeGoalResults([
    { status: 'achieved', explanation: 'Done.' },
    { status: 'partial' },
    { status: 'invalid' }
  ], goals);
  assert.deepEqual(results.map(result => result.status), ['achieved', 'partial', 'partial']);
});

test('comparison failure preserves the normal Attempt 2 record', async () => {
  const second = { id: 'a2', metrics: { overall: 82 }, answer: 'Normal feedback remains.' };
  const outcome = await RetryLogic.generateComparisonSafely(second, async () => { throw new Error('offline'); });
  assert.equal(outcome.attempt.metrics.overall, 82);
  assert.equal(outcome.attempt.answer, second.answer);
  assert.equal(outcome.attempt.retryComparisonError, 'offline');
  assert.equal(outcome.attempt.retryComparison, undefined);
});

test('retry goals and goal completion have dedicated UI surfaces', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(html, /id="retryMission"/);
  assert.match(html, /id="retryGoalList"/);
  assert.match(html, /id="retryComparison"/);
  assert.match(app, /renderRetryMission\(parent\)/);
  assert.match(app, /class="goal-results"/);
});
