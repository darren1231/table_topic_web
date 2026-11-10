const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const api = require('../public/review-cards.js');
const dataApi = require('../public/practice-data.js');
const now = Date.parse('2026-11-10T04:00:00Z');
const day = 86400000;
const ids = cards => cards.map(card => card.id);
const queued = (count, extra = {}) => Array.from({ length: count }, (_, i) => ({
  id: `new-${String(i).padStart(2, '0')}`, status: 'active', language: 'en-US',
  createdAt: new Date(now - day + i * 1000).toISOString(), introducedAt: null, dueAt: null, ...extra,
}));

test('new-card slots are consumed only by first review events and reset the next day', () => {
  const cards = queued(25), reviewEvents = [], options = { now, newCardsPerDay: 10, reviewEvents };
  assert.equal(api.todaysNewCards(cards, options).length, 10);
  for (let i = 0; i < 10; i++) {
    api.markIntroduced(cards[i], now);
    reviewEvents.push({ cardId: cards[i].id, reviewedAt: new Date(now).toISOString() });
    if (i === 3) assert.deepEqual(ids(api.todaysNewCards(cards, options)), ids(cards.slice(4, 10)));
  }
  assert.deepEqual(api.todaysNewCards(cards, options), []);
  assert.deepEqual(ids(api.todaysNewCards(cards, { ...options, now: now + day })), ids(cards.slice(10, 20)));
});

test('daily quota requires both introduction and first review on the current local day', () => {
  const cards = queued(5);
  cards[0].introducedAt = new Date(now - day).toISOString();
  cards[0].dueAt = new Date(now - day).toISOString();
  const reviewEvents = [{ cardId: cards[0].id, reviewedAt: new Date(now).toISOString() }];
  const options = { now, newCardsPerDay: 2, reviewEvents };
  // A migrated old card's first-ever review is a due review, not a new-card slot.
  assert.deepEqual(ids(api.todaysNewCards(cards, options)), ['new-01', 'new-02']);
  // A newly queued card first reviewed today does consume a slot.
  api.markIntroduced(cards[1], now);
  reviewEvents.push({ cardId: cards[1].id, reviewedAt: new Date(now).toISOString() });
  assert.deepEqual(ids(api.todaysNewCards(cards, options)), ['new-02']);
  // Explicit scheduling today creates an introduction but no review event.
  api.bulkSetDueDate(cards, new Set([cards[2].id]), '2026-11-12', () => now);
  assert.deepEqual(ids(api.todaysNewCards(cards, options)), ['new-03']);
});

test('viewing cards never mutates or advances the queue even after five days away', () => {
  const cards = queued(25), before = structuredClone(cards);
  for (const offset of [0, 1, 5]) {
    const options = { now: now + offset * day, newCardsPerDay: 10 };
    assert.deepEqual(ids(api.todaysNewCards(cards, options)), ids(cards.slice(0, 10)));
    assert.deepEqual(api.reviewCounts(cards, options), { relearning: 0, review: 0, newToday: 10, queued: 25 });
  }
  assert.deepEqual(cards, before);
});

test('daily limits accept zero and 200 but invalid settings fall back to ten', () => {
  const cards = queued(210);
  for (const [limit, count] of [[0, 0], [200, 200], [2, 2], [-1, 10], [201, 10], [2.5, 10], ['2', 10], [NaN, 10], [Infinity, 10]]) {
    assert.equal(api.todaysNewCards(cards, { now, newCardsPerDay: limit }).length, count);
    const data = dataApi.ensureDataSchema({ reviewSettings: { newCardsPerDay: limit } });
    assert.equal(data.reviewSettings.newCardsPerDay, count);
  }
});

test('language filtering precedes queue selection while first-review slots are shared globally', () => {
  const cards = queued(3);
  cards[0].language = cards[1].language = 'zh-TW';
  const options = { now, newCardsPerDay: 2, language: 'en-US', reviewEvents: [] };
  assert.deepEqual(ids(api.todaysNewCards(cards, options)), ['new-02']);
  api.markIntroduced(cards[2], now);
  options.reviewEvents.push({ cardId: 'new-02', reviewedAt: new Date(now).toISOString() });
  assert.deepEqual(ids(api.todaysNewCards(cards, { ...options, language: 'zh-TW' })), ['new-00']);
  assert.equal(api.reviewCounts(cards, { ...options, language: 'zh-TW' }).newToday, 1);
});

test('quota uses earliest events regardless of order, excludes trash and counts archived cards', () => {
  const cards = queued(5);
  for (let i = 0; i < 3; i++) api.markIntroduced(cards[i], now);
  cards[1].status = 'trashed'; cards[2].status = 'archived';
  const events = [
    { cardId: 'new-00', reviewedAt: new Date(now).toISOString() },
    { cardId: 'new-01', reviewedAt: new Date(now).toISOString() },
    { cardId: 'new-02', reviewedAt: new Date(now).toISOString() },
    { cardId: 'new-00', reviewedAt: new Date(now - day).toISOString() },
  ];
  assert.equal(api.todaysNewCards(cards, { now, newCardsPerDay: 2, reviewEvents: events }).length, 1);
});

test('new-card queue sorts by creation time then id and excludes inactive cards', () => {
  const cards = queued(4, { createdAt: new Date(now).toISOString() }).reverse();
  cards[0].status = 'trashed'; cards[1].status = 'archived';
  assert.deepEqual(ids(api.buildReviewQueue(cards, { now, newCardsPerDay: 1 })), ['new-00']);
  assert.deepEqual(api.reviewCounts(cards, { now, newCardsPerDay: 1 }), { relearning: 0, review: 0, newToday: 1, queued: 2 });
});

for (const [r, n, positions] of [[40, 10, [4, 9, 14, 19, 24, 29, 34, 39, 44, 49]], [3, 5, [0, 2, 3, 5, 7]], [0, 4, [0, 1, 2, 3]]]) {
  test(`queue evenly interleaves R=${r} reviews with N=${n} new cards after relearning`, () => {
    const reviews = Array.from({ length: r }, (_, i) => ({ id: `review-${i}`, status: 'active',
      introducedAt: new Date(now - day).toISOString(), dueAt: new Date(now - day + i * 1000).toISOString() }));
    const relearn = { id: 'again', status: 'active', introducedAt: new Date(now - day).toISOString(), lastRating: 'again', dueAt: new Date(now).toISOString() };
    const future = { ...relearn, id: 'future', dueAt: new Date(now + 1).toISOString() };
    const cards = [...queued(n), ...reviews.reverse(), relearn, future];
    const options = { now, newCardsPerDay: 10 };
    const result = api.buildReviewQueue(cards, options);
    assert.equal(result[0].id, 'again');
    assert.deepEqual(result.slice(1).flatMap((card, i) => card.introducedAt === null ? [i] : []), positions);
    assert.deepEqual(ids(result.filter(card => card.id.startsWith('review-'))), Array.from({ length: r }, (_, i) => `review-${i}`));
    assert.deepEqual(api.reviewCounts(cards, options), { relearning: 1, review: r, newToday: n, queued: n });
    assert.deepEqual(ids(api.buildReviewQueue(cards, options)), ids(result));
  });
}

test('first rating introduces new cards once; again clears interval and remains relearning only when due', () => {
  for (const rating of ['again', 'hard', 'good', 'easy']) {
    const [card] = queued(1);
    api.markIntroduced(card, now);
    api.rateReview(card, rating, () => now);
    api.markIntroduced(card, now + day);
    assert.equal(card.introducedAt, new Date(now).toISOString());
    if (rating === 'again') {
      assert.equal(card.intervalDays, 0);
      assert.equal(api.reviewCounts([card], { now }).relearning, 0);
      assert.equal(api.reviewCounts([card], { now: now + 600000 }).relearning, 1);
    }
  }
});

test('bulk scheduling introduces queued cards without events or daily quota consumption', () => {
  const cards = queued(3);
  api.bulkSetDueDate(cards, new Set(['new-00']), '2026-11-12', () => now);
  assert.equal(cards[0].introducedAt, new Date(now).toISOString());
  assert.equal(cards[0].dueAt, new Date(2026, 10, 12, 9).toISOString());
  assert.equal(api.todaysNewCards(cards, { now, newCardsPerDay: 2, reviewEvents: [] }).length, 2);
  assert.equal(api.reviewCounts(cards, { now: now + 3 * day, newCardsPerDay: 0 }).review, 1);
});

test('schema upgrades all legacy statuses without changing due dates and is idempotent', () => {
  const cards = ['active', 'archived', 'trashed'].map(status => ({ id: status, status, createdAt: new Date(now - day).toISOString(), dueAt: new Date(now - day).toISOString() }));
  cards.push(...queued(1));
  const data = dataApi.ensureDataSchema({ reviewCards: cards });
  for (const card of cards.slice(0, 3)) assert.equal(card.introducedAt, card.createdAt);
  assert.equal(cards[3].introducedAt, null);
  assert.equal(cards[3].dueAt, null);
  assert.deepEqual(data.reviewSettings, { newCardsPerDay: 10 });
  const before = structuredClone(data);
  assert.deepEqual(dataApi.ensureDataSchema(data), before);
  assert.equal(api.reviewCounts(cards, { now, newCardsPerDay: 0 }).review, 1);
});

test('analysis creates comparison and incorrect grammar queue cards once, respecting trashed cards', () => {
  const result = { comparisons: [0, 1, 2].map(i => ({ label: `Sentence ${i}`, before: `Before ${i}`, after: `After ${i}` })),
    grammarCorrections: [{ original: 'I is', corrected: 'I am', isCorrect: false }, { original: 'I am', corrected: 'I am', isCorrect: true }] };
  const history = { id: 'practice-one', topic: 'Gardens', language: 'en-US', question: 'Why gardens?' };
  const cards = api.cardsFromAnalysis(result, history, now);
  assert.deepEqual(ids(cards), ['practice-one:0', 'practice-one:1', 'practice-one:2', 'practice-one:grammar:0']);
  for (const card of cards) {
    assert.equal(card.introducedAt, null); assert.equal(card.dueAt, null); assert.equal(card.status, 'active');
    assert.equal(card.sourceHistoryId, history.id); assert.equal(card.topic, history.topic);
  }
  cards[0].status = 'trashed';
  assert.deepEqual(api.cardsFromAnalysis(result, history, now, cards), []);
  cards[0].tags.push('one-card-only');
  assert.deepEqual(cards[1].tags, []);
  assert.equal(result.comparisons.length, 3);
});

test('first-review quota follows device-local midnight in Asia/Taipei', () => {
  execFileSync(process.execPath, ['-e', `
    const assert=require('node:assert/strict'), api=require(${JSON.stringify(require.resolve('../public/review-cards.js'))});
    const cards=[{id:'old',status:'active',introducedAt:'2026-11-09T15:59:00Z'}, {id:'new',status:'active',introducedAt:null,createdAt:'2026-11-01T00:00:00Z',dueAt:null}];
    const reviewEvents=[{cardId:'old',reviewedAt:'2026-11-09T15:59:00Z'}];
    assert.equal(api.todaysNewCards(cards,{now:Date.parse('2026-11-09T15:59:30Z'),newCardsPerDay:1,reviewEvents}).length,0);
    assert.equal(api.todaysNewCards(cards,{now:Date.parse('2026-11-09T16:00:00Z'),newCardsPerDay:1,reviewEvents}).length,1);
  `], { env: { ...process.env, TZ: 'Asia/Taipei' } });
});
