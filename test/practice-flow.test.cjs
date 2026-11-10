const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { app, publicDir } = require('./helpers/frontend.cjs');
const { practiceDom } = require('./helpers/practice-dom.cjs');
const catalog = JSON.parse(fs.readFileSync(path.join(publicDir, 'locales/en-US.json'), 'utf8'));
const now = '2026-11-10T04:00:00.000Z';
const answer = 'I am agree because people is kind. For example, we share books. Finally, I feel happy.';
const snapshot = b => JSON.parse(b.run('JSON.stringify(saved)'));

function guest(t, options = {}) {
  const calls = [];
  const dom = practiceDom();
  const b = app({ signedIn: false, now,
    storageEntries: [['tableTopicsLanguage.v1', 'en-US']], ...options,
    createElement: dom.createElement,
    fetch: async (...args) => { calls.push(args); throw new Error('Network is forbidden in builtin flow tests'); },
  });
  const querySelector = b.context.document.querySelector;
  b.context.document.querySelector = selector => dom.ids.get(selector) || querySelector(selector);
  b.context.I18n.questionTemplates = () => catalog.questionTemplates.map(template => topic => template.replaceAll('{topic}', topic));
  t.after(() => { assert.equal(calls.length, 0); assert.equal(b.balanceCalls.length, 0); });
  return b;
}

async function complete(b, topic = 'community gardens', text = answer) {
  b.get('#topicInput').value = topic;
  await b.run('generatePractice()');
  b.get('#transcript').value = text;
  await b.run('analyzeAnswer()');
  return snapshot(b).history[0];
}

test('guest generates three builtin questions and sees the first question ready for an answer', async t => {
  const b = guest(t);
  b.get('#topicInput').value = 'community gardens';
  b.get('#transcript').value = 'Previous draft';
  await b.run('generatePractice()');
  const questions = JSON.parse(b.run('JSON.stringify(state.questions)'));
  assert.equal(questions.length, 3);
  assert.equal(new Set(questions).size, 3);
  assert.ok(questions.every(question => question.includes('community gardens')));
  assert.equal(b.get('#questionText').textContent, questions[0]);
  assert.equal(b.get('#topicBadge').textContent, 'community gardens');
  assert.equal(b.get('#questionIndex').textContent, 'Question 1 of 3');
  assert.equal(b.get('#transcript').value, '');
  assert.equal(b.get('#timer').textContent, '00:00');
  assert.equal(b.get('#practicePanel').classList.contains('hidden'), false);
  assert.equal(b.get('#feedbackPanel').classList.contains('hidden'), true);
  assert.equal(b.get('#generateButton').disabled, false);
  assert.equal(b.run('getActiveProject().provider'), 'builtin');
  assert.equal(b.balanceCalls.length, 0);
});

test('guest analysis creates one complete history entry and displays the observed builtin scores', async t => {
  const b = guest(t);
  const entry = await complete(b);
  assert.equal(snapshot(b).history.length, 1);
  assert.match(entry.id, /^practice_\d+_.+$/);
  assert.equal(entry.date, '2026-11-10');
  assert.equal(entry.completedAt, now);
  assert.equal(entry.mode, 'question');
  assert.equal(entry.language, 'en-US');
  assert.equal(entry.topic, 'community gardens');
  assert.equal(entry.question, b.get('#questionText').textContent);
  assert.equal(entry.answer, answer);
  assert.equal(entry.score, 72);
  assert.deepEqual(['overall', 'structure', 'detail', 'fluency'].map(key => entry.metrics[key]), [72, 74, 70, 72]);
  assert.equal(entry.metrics._historyId, entry.id);
  assert.equal(entry.metrics.comparisons.length, 3);
  for (const [key, value] of [['overall', 72], ['structure', 74], ['detail', 70], ['fluency', 72]]) {
    assert.equal(String(b.get(`#${key}Score`).textContent), String(value));
  }
  assert.equal(b.get('#feedbackPanel').classList.contains('hidden'), false);
  assert.equal(b.get('#analyzeButton').disabled, false);
  assert.equal(b.get('#rawAgentResponse').textContent, 'The built-in coach is active, so there is no external API response.');
});

test('practice history is serialized to localStorage and survives a fresh app context', async t => {
  const b = guest(t);
  const entry = await complete(b);
  const stored = JSON.parse(b.storage.get('tableTopicsPractice.v1'));
  assert.equal(stored.history.length, 1);
  assert.equal(stored.history[0].id, entry.id);
  assert.equal(stored.history[0].score, 72);
  assert.equal(stored.history[0].answer, answer);
  const reloaded = guest(t, { storageEntries: b.storage });
  assert.deepEqual(snapshot(reloaded).history, stored.history);
  reloaded.run('renderHistory(); updateStats(); renderCalendar();');
  assert.ok(reloaded.get('#historyList').innerHTML.includes('data-history-index="0"'));
  assert.ok(reloaded.get('#historyList').innerHTML.includes('community gardens'));
  assert.ok(reloaded.get('#historyList').innerHTML.includes(entry.question));
  assert.equal(String(reloaded.get('#streakCount').textContent), '1');
});

test('completing a practice updates history, daily progress, calendar heat and streak displays', async t => {
  const previous = guest(t, { now: '2026-11-09T04:00:00.000Z' });
  const older = await complete(previous, 'sharing books');
  const b = guest(t, { storageEntries: previous.storage });
  b.run('renderHistory(); updateStats(); renderCalendar();');
  assert.equal(b.get('#progressText').textContent, '0 / 3 questions');
  const newer = await complete(b);
  assert.deepEqual(snapshot(b).history.map(entry => entry.id), [newer.id, older.id]);
  assert.equal(b.get('#historyList').querySelectorAll('.history-item').length, 2);
  assert.equal(b.get('#progressText').textContent, '1 / 3 questions');
  assert.equal(b.get('#homePracticeProgress').textContent, 'Today 1 / 3');
  assert.equal(b.get('#progressBar').style.width, '33.33333333333333%');
  assert.equal(String(b.get('#streakCount').textContent), '2');
  assert.deepEqual([...b.get('#calendarStats').innerHTML.matchAll(/<b>(\d+)<\/b><span>([^<]+)<\/span>/g)]
    .map(match => [Number(match[1]), match[2]]), [[2, 'This month'], [2, 'Active days'], [2, 'Current streak'], [2, 'Best streak']]);
  const day = b.get('#calendarGrid').querySelectorAll('[data-date]').find(node => node.dataset.date === '2026-11-10');
  assert.equal(day.classList.contains('heat-1'), true);
});

test('selecting an analysis comparison creates one linked review card and persists it across reload', async t => {
  const b = guest(t);
  const entry = await complete(b);
  assert.equal(snapshot(b).reviewCards.length, 0);
  const toggles = b.get('#coachReport').querySelectorAll('[data-review-index]');
  assert.equal(toggles.length, 3);
  toggles[0].click();
  const [card] = snapshot(b).reviewCards;
  assert.equal(card.id, `${entry.id}:0`);
  assert.equal(card.sourceHistoryId, entry.id);
  assert.equal(card.comparisonIndex, 0);
  assert.equal(card.topic, entry.topic);
  assert.equal(card.question, entry.question);
  assert.equal(card.before, 'I am agree because people is kind.');
  assert.equal(card.after, 'I agree because people are kind.');
  assert.equal(card.language, 'en-US');
  assert.equal(card.status, 'active');
  assert.equal(card.dueAt, now);
  assert.equal(card.createdAt, now);
  assert.equal(card.intervalDays, 0);
  assert.equal(card.repetitions, 0);
  assert.equal(String(b.get('#dueReviewCount').textContent), '1');
  assert.equal(String(b.get('#homeDueReviewCount').textContent), '1');
  toggles[0].onchange();
  assert.equal(snapshot(b).reviewCards.length, 1);
  const reloaded = guest(t, { storageEntries: b.storage });
  assert.deepEqual(snapshot(reloaded).reviewCards, [card]);
});

test('KNOWN ISSUE F09: unrelated builtin answers receive the same generic technology rewrite', async t => {
  const b = guest(t);
  const first = await complete(b, 'gardening', 'Our community garden brings neighbors together. We grow fresh vegetables and share them every week.');
  const second = await complete(b, 'learning music', 'Learning piano helped me listen carefully. Every evening I practice a new song with my sister.');
  // KNOWN ISSUE: F09 — the builtin coach returns a fixed rewrite unrelated to the learner answer.
  assert.equal(first.metrics.rewritten, second.metrics.rewritten);
  assert.ok(first.metrics.rewritten.startsWith('In my view, this question needs to be understood from two different perspectives.'));
  assert.ok(first.metrics.rewritten.includes('Any powerful technology can create serious consequences'));
  assert.equal(first.metrics.rewritten.includes('garden'), false);
  assert.equal(second.metrics.rewritten.includes('piano'), false);
});
