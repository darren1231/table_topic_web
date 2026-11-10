const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { app, publicDir } = require('./helpers/frontend.cjs');
const modulePath = path.join(publicDir, 'practice-stats.js');
const api = () => require(modulePath);

function fixedClock() {
  const now = new Date(2026, 10, 10, 12).getTime();
  const context = vm.createContext({ Date: class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  } });
  vm.runInContext(fs.readFileSync(modulePath, 'utf8'), context);
  return context.PracticeStats;
}

const history = Object.freeze([
  { id: 'newest', date: '2026-11-10', language: 'en-US' },
  { id: 'middle-en', date: '2026-11-09', language: 'en-US' },
  { id: 'middle-zh', date: '2026-11-08', language: 'zh-TW' },
  { id: 'oldest', date: '2026-11-07', language: 'en-US' },
].map(Object.freeze));

test('date keys use Asia/Taipei calendar dates on either side of midnight', () => {
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const stats = require(${JSON.stringify(modulePath)});
    assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'Asia/Taipei');
    for (const [instant, expected] of [
      ['2026-11-09T15:59:59.999Z', '2026-11-09'],
      ['2026-11-09T16:00:00.000Z', '2026-11-10'],
      ['2026-12-31T15:59:59.999Z', '2026-12-31'],
      ['2026-12-31T16:00:00.000Z', '2027-01-01'],
    ]) {
      assert.equal(stats.localDateKey(instant), expected);
      assert.equal(stats.todayKey(new Date(instant)), expected);
    }
  `], { env: { ...process.env, TZ: 'Asia/Taipei' }, stdio: 'pipe' });
});

test('date keys keep their default current-date behavior in the browser UMD export', () => {
  const stats = fixedClock();
  assert.equal(stats.localDateKey(), '2026-11-10');
  assert.equal(stats.todayKey(), '2026-11-10');
});

test('streaks include yesterday when today has no practice', () => {
  const stats = fixedClock();
  const records = [{ date: '2026-11-09' }, { date: '2026-11-08' }];
  assert.deepEqual(JSON.parse(JSON.stringify(stats.calculateStreaks(records))), { current: 2, longest: 2 });
});

test('streaks break across a missing day and retain the longest previous run', () => {
  const stats = fixedClock();
  const records = ['2026-11-10', '2026-11-08', '2026-11-07', '2026-11-06'].map(date => ({ date }));
  assert.deepEqual(JSON.parse(JSON.stringify(stats.calculateStreaks(records))), { current: 1, longest: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(stats.calculateStreaks(records.slice(1)))), { current: 0, longest: 3 });
});

test('streaks count duplicate same-day practices once without mutating unsorted history', () => {
  const stats = fixedClock();
  const records = Object.freeze(['2026-11-09', '2026-11-10', '2026-11-09', '2026-11-08'].map(date => Object.freeze({ date })));
  assert.deepEqual(JSON.parse(JSON.stringify(stats.calculateStreaks(records))), { current: 3, longest: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(stats.calculateStreaks([]))), { current: 0, longest: 0 });
});

test('language inference preserves Chinese, English, mixed text and empty input behavior', () => {
  const stats = api();
  assert.equal(stats.inferLanguage({ answer: '今天練習表達自己的想法。' }), 'zh-TW');
  assert.equal(stats.inferLanguage({ question: 'Tell a personal story.' }), 'en-US');
  assert.equal(stats.inferLanguage({ question: '中文', answer: 'abc' }), 'zh-TW');
  assert.equal(stats.inferLanguage({ question: '中文', answer: 'abcd' }), 'en-US');
  assert.equal(stats.inferLanguage({ question: '', answer: '' }), 'unknown');
  assert.equal(stats.inferLanguage({}), 'unknown');
});

test('KNOWN ISSUE F11: Japanese and Arabic are not recognized as their own languages', () => {
  // KNOWN ISSUE: F11 — only ASCII Latin letters and CJK ideographs are counted.
  assert.equal(api().inferLanguage({ answer: '今日は日本語を練習します。' }), 'zh-TW');
  assert.equal(api().inferLanguage({ answer: 'こんにちは。' }), 'unknown');
  assert.equal(api().inferLanguage({ answer: 'مرحبا بالعالم' }), 'unknown');
});

test('trend entries filter language before selecting the latest count and return oldest first', () => {
  const stats = api();
  assert.deepEqual(stats.trendEntries(history, 'en-US', '2').map(entry => entry.id), ['middle-en', 'newest']);
  assert.deepEqual(stats.trendEntries(history, 'en-US', '3').map(entry => entry.id), ['oldest', 'middle-en', 'newest']);
  assert.deepEqual(stats.trendEntries(history, 'all', '2').map(entry => entry.id), ['middle-en', 'newest']);
  assert.deepEqual(stats.trendEntries(history, 'en-US', 'all').map(entry => entry.id), ['oldest', 'middle-en', 'newest']);
  assert.deepEqual(stats.trendEntries(history, 'zh-TW', '10').map(entry => entry.id), ['middle-zh']);
  assert.deepEqual(stats.trendEntries(history, 'ja-JP', 'all'), []);
  assert.equal(history[0].id, 'newest');
});

test('calendar history filtering preserves stored order and returns all or matching languages', () => {
  assert.deepEqual(api().filteredHistory(history, 'all'), history);
  assert.notEqual(api().filteredHistory(history, 'all'), history);
  assert.deepEqual(api().filteredHistory(history, 'en-US').map(entry => entry.id), ['newest', 'middle-en', 'oldest']);
  assert.deepEqual(api().filteredHistory(history, 'ar'), []);
});

test('app adapters read current history and current filter state after changes', () => {
  const b = app({ signedIn: false, now: '2026-11-10T04:00:00Z' });
  b.run(`saved.history = ${JSON.stringify(history)}; state.trendLanguage = 'en-US'; state.trendPeriod = '2'; state.calendarLanguage = 'zh-TW';`);
  assert.deepEqual(JSON.parse(b.run('JSON.stringify(trendEntries().map(entry => entry.id))')), ['middle-en', 'newest']);
  assert.deepEqual(JSON.parse(b.run('JSON.stringify(filteredHistory().map(entry => entry.id))')), ['middle-zh']);
  b.run("state.trendLanguage = 'zh-TW'; state.calendarLanguage = 'all'; saved.history = saved.history.slice(1);");
  assert.deepEqual(JSON.parse(b.run('JSON.stringify(trendEntries().map(entry => entry.id))')), ['middle-zh']);
  assert.equal(b.run('filteredHistory().length'), 3);
  assert.equal(b.run('filteredHistory("en-US").length'), 2);
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.ok(html.includes('src="practice-stats.js"'));
  assert.ok(html.indexOf('src="practice-stats.js"') < html.indexOf('src="app.js"'));
});
