const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { app, publicDir } = require('./helpers/frontend.cjs');
const { practiceDom } = require('./helpers/practice-dom.cjs');
const api = () => require('../public/review-cards.js');
const now = Date.parse('2026-11-10T04:00:00.000Z');
const clock = () => now;
const filters = overrides => ({ reviewLanguage: 'all', libraryStatus: 'active', librarySearch: '',
  libraryDateFrom: '', libraryDateTo: '', libraryDateType: 'createdAt', librarySort: 'dueAsc', ...overrides });
const cards = Object.freeze([
  { id: 'a', status: 'active', language: 'en-US', dueAt: '2026-11-08T04:00:00Z', createdAt: '2026-11-01T04:00:00Z',
    lastReviewedAt: '2026-11-05T04:00:00Z', repetitions: 6, intervalDays: 30, label: 'Opening', topic: 'Community',
    question: 'How did you help?', before: 'Original account', after: 'Clearer story', grammarIssue: 'Subject agreement',
    grammarExplanation: 'Plural noun', grammarRule: 'Use are', grammarExample: 'Neighbors are kind.', tags: ['GARDEN'] },
  { id: 'b', status: 'active', language: 'zh-TW', dueAt: '2026-11-10T04:00:00Z', createdAt: '2026-11-02T04:00:00Z',
    lastReviewedAt: '2026-11-08T04:00:00Z', repetitions: 3, intervalDays: 15, label: 'Detail', topic: 'Friends', before: 'Original detail', after: 'Improved detail' },
  { id: 'c', status: 'archived', language: 'en-US', dueAt: '2026-11-11T04:00:00Z', createdAt: '2026-11-03T04:00:00Z',
    lastReviewedAt: '2026-11-07T04:00:00Z', repetitions: 0, intervalDays: 0, topic: 'Travel' },
  { id: 'd', status: 'trashed', language: 'en-US', dueAt: '2026-11-07T04:00:00Z', createdAt: '2026-11-04T04:00:00Z' },
].map(Object.freeze));
const ids = rows => rows.map(row => row.id);

test('due cards include the current instant and past times, filter language and exclude inactive cards', () => {
  assert.deepEqual(ids(api().dueCards(cards, 'all', clock)), ['a', 'b']);
  assert.deepEqual(ids(api().dueCards(cards, 'zh-TW', clock)), ['b']);
  assert.deepEqual(ids(api().dueCards(cards, 'en-US', clock)), ['a']);
  assert.deepEqual(api().dueCards([{ status: 'active', dueAt: new Date(now + 1).toISOString() },
    { status: 'active', dueAt: 'invalid-date' }], 'all', clock), []);
  assert.deepEqual(ids(cards), ['a', 'b', 'c', 'd']);
});

test('mastery keeps its existing weighting and clamps the resulting percentage', () => {
  for (const [card, expected] of [[{}, 0], [{ repetitions: 3, intervalDays: 15 }, 50],
    [{ repetitions: 6, intervalDays: 30 }, 100], [{ repetitions: 100, intervalDays: 100 }, 100],
    [{ repetitions: -10, intervalDays: -10 }, 0]]) assert.equal(api().cardMastery(card), expected);
});

test('review status labels call the supplied UI translator only for the selected label', () => {
  const calls = [];
  const ui = (zh, en) => { calls.push([zh, en]); return en; };
  assert.equal(api().reviewStatusLabel('archived', ui), 'Archived');
  assert.equal(api().reviewStatusLabel('trashed', ui), 'Trash');
  assert.equal(api().reviewStatusLabel(undefined, ui), 'Active');
  assert.deepEqual(calls, [['已封存', 'Archived'], ['垃圾桶', 'Trash'], ['啟用中', 'Active']]);
});

test('library filtering combines language and status and searches the existing text and grammar fields', () => {
  assert.deepEqual(ids(api().filteredLibraryCards(cards, filters())), ['a', 'b']);
  assert.deepEqual(ids(api().filteredLibraryCards(cards, filters({ reviewLanguage: 'en-US' }))), ['a']);
  assert.deepEqual(ids(api().filteredLibraryCards(cards, filters({ libraryStatus: 'archived' }))), ['c']);
  for (const query of [' opening ', 'COMMUNITY', 'help?', 'account', 'clearer', 'subject agreement', 'plural noun', 'use are', 'neighbors are kind', 'garden']) {
    assert.deepEqual(ids(api().filteredLibraryCards(cards, filters({ libraryStatus: 'all', librarySearch: query }))), ['a']);
  }
  assert.deepEqual(api().filteredLibraryCards(cards, filters({ librarySearch: 'no match' })), []);
});

test('library date filters include both bounds and use the selected date field', () => {
  assert.deepEqual(ids(api().filteredLibraryCards(cards, filters({ libraryStatus: 'all', libraryDateFrom: '2026-11-02', libraryDateTo: '2026-11-03' }))), ['b', 'c']);
  assert.deepEqual(ids(api().filteredLibraryCards(cards, filters({ libraryStatus: 'all', libraryDateType: 'lastReviewedAt',
    libraryDateFrom: '2026-11-06', libraryDateTo: '2026-11-08' }))), ['b', 'c']);
});

test('library sort modes preserve existing date and mastery order without changing the source array', () => {
  for (const [librarySort, expected] of [['dueAsc', ['d', 'a', 'b', 'c']], ['dueDesc', ['c', 'b', 'a', 'd']],
    ['createdDesc', ['d', 'c', 'b', 'a']], ['createdAsc', ['a', 'b', 'c', 'd']],
    ['reviewedDesc', ['b', 'c', 'a', 'd']], ['masteryDesc', ['a', 'b', 'c', 'd']]]) {
    assert.deepEqual(ids(api().filteredLibraryCards(cards, filters({ libraryStatus: 'all', librarySort }))), expected);
  }
  assert.deepEqual(ids(cards), ['a', 'b', 'c', 'd']);
});

test('good ratings preserve the 1-day, 3-day and existing later-review interval progression', () => {
  for (const [repetitions, intervalDays, days, dueAt] of [
    [0, 0, 1, '2026-11-11T04:00:00.000Z'], [1, 1, 3, '2026-11-13T04:00:00.000Z'],
    [2, 3, 7, '2026-11-17T04:00:00.000Z'],
  ]) {
    const card = { id: 'rated', status: 'active', repetitions, intervalDays, easeFactor: 2.3 };
    assert.equal(api().rateReview(card, 'good', clock), intervalDays);
    assert.equal(card.repetitions, repetitions + 1);
    assert.equal(card.intervalDays, days);
    assert.equal(card.dueAt, dueAt);
    assert.equal(card.easeFactor, 2.3);
    assert.equal(card.status, 'active');
    assert.equal(card.lastRating, 'good');
    assert.equal(card.lastReviewedAt, '2026-11-10T04:00:00.000Z');
    assert.equal(card.updatedAt, card.lastReviewedAt);
  }
});

test('hard ratings retain interval rounding, minimum one day and minimum ease factor', () => {
  for (const [intervalDays, factor, expectedDays, expectedFactor, dueAt] of [
    [0, undefined, 1, 2.2, '2026-11-11T04:00:00.000Z'],
    [5, 1.3, 6, 1.3, '2026-11-16T04:00:00.000Z'],
  ]) {
    const card = { intervalDays, easeFactor: factor };
    api().rateReview(card, 'hard', clock);
    assert.equal(card.intervalDays, expectedDays);
    assert.ok(Math.abs(card.easeFactor - expectedFactor) < 1e-12);
    assert.equal(card.repetitions, 1);
    assert.equal(card.dueAt, dueAt);
  }
});

test('easy ratings retain first-review four days, later interval scaling and the ease cap', () => {
  for (const [repetitions, intervalDays, days, dueAt] of [
    [0, 0, 4, '2026-11-14T04:00:00.000Z'], [1, 1, 7, '2026-11-17T04:00:00.000Z'],
    [2, 5, 16, '2026-11-26T04:00:00.000Z'],
  ]) {
    const card = { repetitions, intervalDays, easeFactor: 2.95 };
    api().rateReview(card, 'easy', clock);
    assert.equal(card.intervalDays, days);
    assert.equal(card.dueAt, dueAt);
    assert.equal(card.easeFactor, 3);
  }
});

test('again schedules ten minutes and resets intervalDays to zero', () => {
  const card = { repetitions: 4, intervalDays: 7, lapses: 2, easeFactor: 1.35 };
  const ticks = [now, now + 5];
  assert.equal(api().rateReview(card, 'again', () => ticks.shift()), 7);
  assert.equal(card.dueAt, '2026-11-10T04:10:00.000Z');
  assert.equal(card.repetitions, 0);
  assert.equal(card.lapses, 3);
  assert.equal(card.easeFactor, 1.3);
  assert.equal(card.intervalDays, 0);
  assert.equal(card.lastRating, 'again');
  assert.equal(card.lastReviewedAt, '2026-11-10T04:00:00.005Z');
  assert.equal(card.updatedAt, card.lastReviewedAt);
  assert.equal(ticks.length, 0);
});

test('bulk status logic changes only selected cards and clears existing trash metadata', () => {
  const data = [{ id: 'selected', status: 'trashed', deletedAt: 'old', previousStatus: 'active' },
    { id: 'untouched', status: 'active', updatedAt: 'keep' }];
  api().bulkSetStatus(data, ['selected'], 'archived', clock);
  assert.deepEqual(data, [{ id: 'selected', status: 'archived', updatedAt: '2026-11-10T04:00:00.000Z' },
    { id: 'untouched', status: 'active', updatedAt: 'keep' }]);
});

test('bulk due dates update selected active and archived cards, skip trash and preserve selection', () => {
  const data = [{ id: 'a', status: 'active' }, { id: 'b', status: 'archived' }, { id: 'c', status: 'trashed', dueAt: 'keep' }, { id: 'd' }];
  const selected = new Set(['a', 'b', 'c']);
  let ticks = 0;
  api().bulkSetDueDate(data, selected, '2026-11-15', () => now + ticks++);
  const expected = new Date(2026, 10, 15, 9).toISOString();
  assert.equal(data[0].dueAt, expected);
  assert.equal(data[1].dueAt, expected);
  assert.equal(data[0].updatedAt, '2026-11-10T04:00:00.000Z');
  assert.equal(data[1].updatedAt, '2026-11-10T04:00:00.001Z');
  assert.deepEqual(data[2], { id: 'c', status: 'trashed', dueAt: 'keep' });
  assert.deepEqual(data[3], { id: 'd' });
  assert.deepEqual([...selected], ['a', 'b', 'c']);
});

test('bulk due dates retain 09:00 local time in Asia/Taipei', () => {
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const cards = require(${JSON.stringify(path.join(publicDir, 'review-cards.js'))});
    const data = [{id:'one',status:'active'}];
    cards.bulkSetDueDate(data,new Set(['one']),'2026-11-15',()=>${now});
    assert.equal(data[0].dueAt,'2026-11-15T01:00:00.000Z');
  `], { env: { ...process.env, TZ: 'Asia/Taipei' }, stdio: 'pipe' });
});

function reviewApp(data = cards) {
  const dom = practiceDom();
  const b = app({ signedIn: false, now, createElement: dom.createElement });
  const query = b.context.document.querySelector;
  b.context.document.querySelector = selector => dom.ids.get(selector) || query(selector);
  b.run(`saved.reviewCards = ${JSON.stringify(data)}; saved.reviewEvents = [];`);
  const writes = [];
  b.window.tableTopicsCloud.scheduleSync = data => writes.push(JSON.parse(JSON.stringify(data)));
  return { ...b, writes, saved: () => JSON.parse(b.run('JSON.stringify(saved)')) };
}

test('app rating adapter retains event creation, persistence, badge updates and reveal reset', () => {
  const b = reviewApp([{ id: 'rated', status: 'active', language: 'en-US', intervalDays: 0, repetitions: 0,
    easeFactor: 2.3, dueAt: '2026-11-09T04:00:00Z', before: 'Original', after: 'Improved' }]);
  b.run("state.reviewRevealed = true; rateReview(saved.reviewCards[0], 'good');");
  const saved = b.saved();
  assert.equal(saved.reviewEvents.length, 1);
  const { id, ...event } = saved.reviewEvents[0];
  assert.ok(id.startsWith('review_'));
  assert.deepEqual(event, { cardId: 'rated', rating: 'good', reviewedAt: '2026-11-10T04:00:00.000Z',
    previousIntervalDays: 0, nextDueAt: '2026-11-11T04:00:00.000Z' });
  assert.equal(b.writes.length, 1);
  assert.deepEqual(JSON.parse(b.storage.get('tableTopicsPractice.v1')), saved);
  assert.equal(b.run('state.reviewRevealed'), false);
  assert.equal(String(b.get('#dueReviewCount').textContent), '0');
});

test('app bulk adapters retain selection clearing, persistence and empty-date validation', () => {
  const b = reviewApp();
  b.run("state.librarySelected = new Set(['a','b']); bulkSetStatus('archived');");
  assert.deepEqual(b.saved().reviewCards.slice(0, 2).map(card => card.status), ['archived', 'archived']);
  assert.equal(b.run('state.librarySelected.size'), 0);
  assert.equal(b.writes.length, 1);
  b.run("state.librarySelected = new Set(['a','c','d']);");
  b.get('#bulkDueDateInput').value = '';
  b.run('bulkSetDueDate();');
  assert.equal(b.writes.length, 1);
  assert.equal(b.run('state.librarySelected.size'), 3);
  assert.equal(b.get('#toast').textContent, 'Choose a date first');
  b.get('#bulkDueDateInput').value = '2026-11-15';
  b.run('bulkSetDueDate();');
  assert.equal(b.writes.length, 2);
  assert.equal(b.run('state.librarySelected.size'), 0);
  assert.equal(b.saved().reviewCards[0].dueAt, new Date(2026, 10, 15, 9).toISOString());
  assert.equal(b.saved().reviewCards[2].dueAt, new Date(2026, 10, 15, 9).toISOString());
  assert.equal(b.saved().reviewCards[3].dueAt, '2026-11-07T04:00:00Z');
});

test('existing trash and restore flows preserve prior active or archived status without deleting cards', () => {
  const b = reviewApp();
  b.run("state.librarySelected = new Set(['a','b','c']); trashReviewCards(['a','c']);");
  let saved = b.saved();
  assert.equal(saved.reviewCards.length, 4);
  assert.deepEqual([saved.reviewCards[0].previousStatus, saved.reviewCards[2].previousStatus], ['active', 'archived']);
  for (const card of [saved.reviewCards[0], saved.reviewCards[2]]) {
    assert.equal(card.status, 'trashed');
    assert.equal(card.deletedAt, '2026-11-10T04:00:00.000Z');
  }
  assert.equal(b.run('state.librarySelected.size'), 1);
  assert.deepEqual(JSON.parse(b.run('JSON.stringify(dueCards().map(card=>card.id))')), ['b']);
  b.run("restoreReviewCards(['a','c']);");
  saved = b.saved();
  assert.deepEqual(saved.reviewCards.map(card => card.status), ['active', 'active', 'archived', 'trashed']);
  for (const card of [saved.reviewCards[0], saved.reviewCards[2]]) {
    assert.equal(Object.hasOwn(card, 'deletedAt'), false);
    assert.equal(Object.hasOwn(card, 'previousStatus'), false);
  }
  assert.equal(b.writes.length, 2);
  assert.deepEqual(JSON.parse(b.storage.get('tableTopicsPractice.v1')), saved);
});

test('existing restoration defaults to active when the saved previous status is unsupported', () => {
  const b = reviewApp([{ id: 'orphan', status: 'trashed', previousStatus: 'unsupported', deletedAt: 'old',
    language: 'en-US', dueAt: '2026-11-09T04:00:00Z', before: 'Original', after: 'Improved' }]);
  b.run("state.librarySelected = new Set(['orphan']); restoreReviewCards(['orphan']);");
  assert.equal(b.saved().reviewCards[0].status, 'active');
  assert.equal(b.run('state.librarySelected.size'), 0);
  assert.equal(b.writes.length, 1);
});

test('app filter adapters read current state and load review cards after practice statistics', () => {
  const b = reviewApp();
  b.run("state.reviewLanguage='en-US';");
  assert.deepEqual(JSON.parse(b.run('JSON.stringify(dueCards().map(card=>card.id))')), ['a']);
  b.run("state.reviewLanguage='zh-TW';");
  assert.deepEqual(JSON.parse(b.run('JSON.stringify(dueCards().map(card=>card.id))')), ['b']);
  assert.deepEqual(JSON.parse(b.run('JSON.stringify(filteredLibraryCards().map(card=>card.id))')), ['b']);
  assert.equal(b.run('cardMastery(saved.reviewCards[1])'), 50);
  assert.equal(b.run('reviewStatusLabel("archived")'), 'Archived');
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.ok(html.includes('src="review-cards.js"'));
  assert.ok(html.indexOf('src="practice-stats.js"') < html.indexOf('src="review-cards.js"'));
  assert.ok(html.indexOf('src="review-cards.js"') < html.indexOf('src="app.js"'));
});
