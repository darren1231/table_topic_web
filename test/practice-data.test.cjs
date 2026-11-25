const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { app, publicDir } = require('./helpers/frontend.cjs');
const api = () => require('../public/practice-data.js');
const plain = value => JSON.parse(JSON.stringify(value));
const now = '2026-11-10T04:00:00.000Z';

function fixedApi() {
  const context = vm.createContext({ Date: class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  } });
  for (const file of ['practice-stats.js', 'practice-display.js', 'practice-data.js']) vm.runInContext(fs.readFileSync(path.join(publicDir, file), 'utf8'), context);
  return context.PracticeData;
}

test('legacy practice data gains version 5 collections and existing history defaults in place', () => {
  const data = { history: [{ date: '2026-11-09', question: '今天的練習', answer: '分享一個故事' }], custom: 'keep' };
  assert.equal(api().ensureDataSchema(data), data);
  assert.deepEqual(data, {
    history: [{ id: 'legacy_2026-11-09_0', date: '2026-11-09', question: '今天的練習', answer: '分享一個故事',
      language: 'zh-TW', completedAt: '2026-11-09T12:00:00' }],
    custom: 'keep', version: 5, reviewCards: [], reviewEvents: [], scripts: [], apiUsage: [],
  });
});

test('schema migration resets invalid roots and collections while preserving existing valid fields', () => {
  for (const data of [null, false, 'invalid', 42]) {
    assert.deepEqual(api().ensureDataSchema(data), { history: [], reviewCards: [], reviewEvents: [], scripts: [], apiUsage: [], version: 5 });
  }
  const entry = { id: 'practice-existing', date: '2026-11-08', language: 'ja-JP', completedAt: 'existing-time' };
  const data = { history: [entry], reviewCards: null, reviewEvents: {}, scripts: false, apiUsage: 'invalid', version: 1 };
  api().ensureDataSchema(data);
  assert.equal(data.history[0], entry);
  assert.deepEqual(entry, { id: 'practice-existing', date: '2026-11-08', language: 'ja-JP', completedAt: 'existing-time' });
  for (const key of ['reviewCards', 'reviewEvents', 'scripts', 'apiUsage']) assert.deepEqual(data[key], []);
  assert.equal(data.version, 5);
});

test('schema migration recovers English review grammar and normalizes manuscript collections', () => {
  const data = {
    history: [{ id: 'source', language: 'en-US', metrics: { comparisons: [{ before: 'i agree.',
      isGrammarCorrect: false, grammarIssue: 'Capitalization', grammarExplanation: 'Capitalize I',
      grammarRule: 'Use I', grammarExample: 'I agree.' }] } }],
    reviewCards: [{ sourceHistoryId: 'source', language: 'en-US', before: 'I agree!', tags: 'old', createdAt: now },
      { language: 'zh-TW', before: '你好', grammarRule: 'keep', updatedAt: 'old-time' }],
    scripts: [{ paragraphs: [{ text: 'Draft', versions: null, analyses: false }], fullReviews: null, tags: 'old' }],
  };
  api().ensureDataSchema(data);
  assert.deepEqual(data.reviewCards[0], {
    sourceHistoryId: 'source', language: 'en-US', before: 'I agree!', tags: [], createdAt: now, updatedAt: now,
    status: 'active', isGrammarCorrect: false, grammarIssue: 'Capitalization', grammarExplanation: 'Capitalize I',
    grammarRule: 'Use I', grammarExample: 'I agree.',
  });
  assert.equal(data.reviewCards[1].grammarRule, 'keep');
  assert.equal(data.reviewCards[1].updatedAt, 'old-time');
  assert.deepEqual(data.scripts, [{ status: 'active', tags: [], fullReviews: [], paragraphs: [{ text: 'Draft', versions: [], analyses: [] }] }]);
});

test('schema defaults use the existing local date and current timestamp when legacy fields are absent', () => {
  const data = { history: [{}], reviewCards: [{ language: 'en-US' }], scripts: [{}] };
  fixedApi().ensureDataSchema(data);
  assert.deepEqual(plain(data.history), [{ id: 'legacy_date_0', date: '2026-11-10', language: 'unknown', completedAt: '2026-11-10T12:00:00' }]);
  assert.equal(data.reviewCards[0].updatedAt, now);
  assert.deepEqual(plain(data.scripts), [{ status: 'active', tags: [], paragraphs: [], fullReviews: [] }]);
});

test('backup defaults clear every project API key and deep-copy the practice and settings', () => {
  const practice = { history: [{ answer: 'Saved answer' }], reviewCards: [], version: 5 };
  const settings = { activeId: 'one', projects: [{ id: 'one', apiKey: 'first-placeholder' }, { id: 'two', apiKey: 'second-placeholder' }] };
  const backup = fixedApi().buildBackup(practice, settings, 'en-US');
  assert.deepEqual(plain(backup), {
    format: 'table-topics-practice-backup', version: 1, exportedAt: now, includesApiKeys: false,
    data: { practice, aiSettings: { activeId: 'one', projects: [{ id: 'one', apiKey: '' }, { id: 'two', apiKey: '' }] }, language: 'en-US' },
  });
  backup.data.practice.history[0].answer = 'Backup-only edit';
  backup.data.aiSettings.projects[0].id = 'backup-only';
  assert.equal(practice.history[0].answer, 'Saved answer');
  assert.deepEqual(settings.projects, [{ id: 'one', apiKey: 'first-placeholder' }, { id: 'two', apiKey: 'second-placeholder' }]);
});

test('explicitly including API keys preserves placeholder values without sharing mutable objects', () => {
  const settings = { projects: [{ apiKey: 'project-placeholder', name: 'Original' }] };
  const backup = api().buildBackup({ history: [] }, settings, 'zh-TW', true);
  assert.equal(backup.includesApiKeys, true);
  assert.equal(backup.data.aiSettings.projects[0].apiKey, 'project-placeholder');
  backup.data.aiSettings.projects[0].name = 'Changed';
  assert.equal(settings.projects[0].name, 'Original');
});

test('backup filename preserves the existing local-date naming convention', () => {
  assert.equal(fixedApi().backupFilename(), 'table-topics-backup-2026-11-10.json');
});

function importPayload({ history = [], projects = [{ id: 'imported', apiKey: '' }], language = 'en-US' } = {}) {
  return { format: 'table-topics-practice-backup', version: 1,
    data: { practice: { history }, aiSettings: { activeId: 'imported', projects }, language } };
}

test('backup parsing retains the payload and derives the confirmation count and API-key indicator', () => {
  const payload = importPayload({ history: [{ id: 'one' }, { id: 'two' }] });
  assert.deepEqual(api().parseBackup(JSON.stringify(payload)), { payload, count: 2, hasKeys: false });
  const withKeys = importPayload({ projects: [{ id: 'imported', apiKey: 'import-placeholder' }] });
  assert.equal(api().parseBackup(JSON.stringify(withKeys)).hasKeys, true);
});

test('backup parsing preserves JSON syntax errors and rejects only the existing invalid shapes', () => {
  assert.throws(() => api().parseBackup('{invalid-json'), SyntaxError);
  const valid = importPayload();
  for (const payload of [null, {}, { ...valid, format: 'other-format' }, { ...valid, data: null },
    { ...valid, data: { ...valid.data, practice: { history: {} } } },
    { ...valid, data: { ...valid.data, practice: { history: null } } },
    { ...valid, data: { ...valid.data, aiSettings: { projects: 'invalid' } } }]) {
    assert.equal(api().parseBackup(JSON.stringify(payload)), null);
  }
});

test('F06 rejects invalid history entries and unusable AI project selections before import', () => {
  for (const history of [[null], [false], [[]], [{ id: {} }]]) {
    assert.equal(api().parseBackup(JSON.stringify(importPayload({ history }))), null);
  }
  for (const projects of [[], [null], [[]], [{ id: '' }], [{ id: 'a' }, { id: 'a' }]]) {
    assert.equal(api().parseBackup(JSON.stringify(importPayload({ projects }))), null);
  }
  const dangling = importPayload();
  dangling.data.aiSettings.activeId = 'missing';
  assert.equal(api().parseBackup(JSON.stringify(dangling)), null);
});

test('legacy settings without activeId select the first project without discarding custom fields', () => {
  const payload = importPayload();
  delete payload.data.aiSettings.activeId;
  payload.data.practice.custom = { note: 'keep' };
  const parsed = api().parseBackup(JSON.stringify(payload));
  assert.equal(parsed.payload.data.aiSettings.activeId, 'imported');
  assert.deepEqual(parsed.payload.data.practice.custom, { note: 'keep' });
});

function translationCard(overrides = {}) {
  return { id: 'translation-one', sourceType: 'translation', language: 'ja-JP', before: '原句', after: '訳文',
    dueAt: now, createdAt: now, translationStyle: 'conversational', translationNote: '日常會話',
    explanationLanguage: 'zh-TW', tags: [], ...overrides };
}

test('backup parsing validates supplied collections and nested manuscript and coach records', () => {
  const invalid = [
    { reviewCards: null }, { reviewCards: [null] }, { reviewCards: [translationCard({ before: {} })] },
    { reviewCards: [translationCard({ tags: [null] })] }, { reviewCards: [translationCard({ dueAt: 'not-a-date' })] },
    { reviewCards: [translationCard({ repetitions: -1 })] }, { reviewCards: [translationCard({ status: 'broken' })] },
    { reviewCards: [translationCard(), translationCard()] },
    { scripts: {} }, { scripts: [null] }, { scripts: [{ id: 's', paragraphs: [null] }] },
    { scripts: [{ id: 's', paragraphs: [{ id: 'p', text: 'draft', versions: [null] }] }] },
    { scripts: [{ id: 's', paragraphs: [{ id: 'p', analyses: [{ suggestions: {} }] }] }] },
    { scripts: [{ id: 's', fullReviews: [{ recommendations: [null] }] }] },
    { reviewEvents: [null] }, { apiUsage: [false] },
  ];
  for (const fields of invalid) {
    const payload = importPayload();
    Object.assign(payload.data.practice, fields);
    assert.equal(api().parseBackup(JSON.stringify(payload)), null, JSON.stringify(fields));
  }
});

test('translation metadata has bounded text and stable styles without requiring it on old cards', () => {
  for (const fields of [
    { translationStyle: 'unknown' }, { translationNote: 12 }, { translationNote: '文'.repeat(201) },
    { explanationLanguage: [] }, { translationStyle: null },
  ]) {
    const payload = importPayload();
    payload.data.practice.reviewCards = [translationCard(fields)];
    assert.equal(api().parseBackup(JSON.stringify(payload)), null);
  }
  const payload = importPayload();
  payload.data.practice.reviewCards = [translationCard({ translationNote: '😀'.repeat(200) })];
  const result = api().parseBackup(JSON.stringify(payload));
  assert.deepEqual(result.payload.data.practice.reviewCards, payload.data.practice.reviewCards);
});

test('backup import rejects unsafe keys, unsupported versions and wrong settings types', () => {
  const invalid = [
    payload => { payload.version = 2; },
    payload => { payload.data.practice.version = 6; },
    payload => { payload.data.aiSettings.projects[0].apiKey = {}; },
    payload => { payload.data.aiSettings.projects[0].smartCorrection = 'false'; },
    payload => { payload.data.aiSettings.projects[0].inputTokenRate = -1; },
    payload => { payload.data.language = []; },
    payload => { payload.data.practice.history = [{ date: '2026-02-30' }]; },
    payload => { payload.data.practice.custom = JSON.parse('{"__proto__":{"polluted":true}}'); },
  ];
  for (const mutate of invalid) {
    const payload = importPayload(); mutate(payload);
    assert.equal(api().parseBackup(JSON.stringify(payload)), null);
  }
  assert.equal({}.polluted, undefined);
});

test('legacy and translation backups survive export, import and normalization without losing data', () => {
  const payload = importPayload({ history: [{ date: '2026-11-09', question: '題目', answer: '回答' }] });
  delete payload.version;
  delete payload.data.aiSettings.activeId;
  const oldCard = { id: 'old-card', language: 'en-US', before: 'old', after: 'new', dueAt: now };
  payload.data.practice.reviewCards = [oldCard, translationCard()];
  payload.data.practice.scripts = [{ id: 's', title: '稿', paragraphs: [{ id: 'p', text: '內文' }] }];
  payload.data.practice.custom = { futureNote: 'keep' };
  const parsed = api().parseBackup(JSON.stringify(payload));
  const practice = api().ensureDataSchema(parsed.payload.data.practice);
  assert.equal(practice.history[0].id, 'legacy_2026-11-09_0');
  assert.deepEqual(practice.reviewCards[0].tags, []);
  assert.equal(practice.reviewCards[1].translationNote, '日常會話');
  assert.equal(practice.reviewCards[1].grammarIssue, undefined);
  assert.deepEqual(practice.scripts[0].paragraphs[0].versions, []);
  assert.deepEqual(practice.scripts[0].paragraphs[0].analyses, []);
  const backup = api().buildBackup(practice, parsed.payload.data.aiSettings, 'zh-TW');
  const restored = api().parseBackup(JSON.stringify(backup));
  assert.deepEqual(restored.payload.data.practice, practice);
  assert.deepEqual(restored.payload.data.practice.custom, { futureNote: 'keep' });
  assert.equal(restored.payload.data.aiSettings.activeId, 'imported');
});

test('normalization fills missing history dates and never backfills grammar onto translation cards', () => {
  const data = { history: [{ id: 'source', metrics: { comparisons: [
    { before: '原句', grammarIssue: 'Not translation guidance' },
  ] } }], reviewCards: [translationCard({ sourceHistoryId: 'source', language: 'en-US' })] };
  fixedApi().ensureDataSchema(data);
  assert.equal(data.history[0].date, '2026-11-10');
  assert.equal(data.reviewCards[0].grammarIssue, undefined);
});

test('backup validation checks nested renderer inputs and translation text bounds', () => {
  const payload = importPayload();
  for (const metrics of [
    { improvements: {} }, { improvements: [null] }, { scoreDetails: {} },
    { scoreDetails: [{ before: {}, after: 50 }] },
  ]) {
    payload.data.practice.history = [{ metrics }];
    assert.ok(api().parseBackup(JSON.stringify(payload)));
  }
  payload.data.practice.history = [];
  for (const fields of [{ before: '文'.repeat(301) }, { after: '文'.repeat(1201) }, { translationNote: '' }]) {
    payload.data.practice.reviewCards = [translationCard(fields)];
    assert.equal(api().parseBackup(JSON.stringify(payload)), null);
  }
});

test('backup parsing rejects manuscript records that would fail when edited or rendered', () => {
  for (const script of [
    { id: 's', paragraphs: [{}] },
    { id: 's', paragraphs: [{ id: 'p', text: 'Draft', versions: [{}] }] },
    { id: 's', paragraphs: [{ id: 'p', text: 'Draft', analyses: [{ suggestions: [{}] }] }] },
  ]) {
    const payload = importPayload(); payload.data.practice.scripts = [script];
    assert.equal(api().parseBackup(JSON.stringify(payload)), null);
  }
});

test('app schema and backup adapters use current state and keep persistence outside the data module', () => {
  const b = app({ signedIn: false, now });
  b.run("saved={history:[]}; aiSettings={activeId:'current',projects:[{id:'current',apiKey:'current-placeholder'}]}; state.language='ja-JP';");
  const writes = [];
  b.window.tableTopicsCloud.scheduleSync = data => writes.push(plain(data));
  b.run('ensureDataSchema();');
  assert.deepEqual(JSON.parse(b.storage.get('tableTopicsPractice.v1')), writes[0]);
  assert.equal(writes.length, 1);
  const backup = JSON.parse(b.run('JSON.stringify(buildBackup())'));
  assert.deepEqual(backup.data.practice, writes[0]);
  assert.equal(backup.data.language, 'ja-JP');
  assert.equal(backup.data.aiSettings.projects[0].apiKey, '');
  assert.equal(b.run('buildBackup(true).data.aiSettings.projects[0].apiKey'), 'current-placeholder');
  assert.equal(b.run('backupFilename()'), 'table-topics-backup-2026-11-10.json');
  assert.equal(writes.length, 1);
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.ok(html.includes('src="practice-data.js"'));
  assert.ok(html.indexOf('src="practice-stats.js"') < html.indexOf('src="practice-data.js"'));
  assert.ok(html.indexOf('src="practice-data.js"') < html.indexOf('src="app.js"'));
});

function importApp({ confirmed = true, cloudResult = true } = {}) {
  const b = app({ signedIn: false, now });
  const confirmations = [], cloudWrites = [], timers = [];
  let reads = 0, reloads = 0;
  b.context.confirm = message => { confirmations.push(message); return confirmed; };
  b.context.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
  b.context.location.reload = () => { reloads++; };
  b.window.tableTopicsCloud.replaceData = async data => { cloudWrites.push(plain(data)); return cloudResult; };
  b.get('#importBackupInput').value = 'selected-backup.json';
  return { ...b, confirmations, cloudWrites, timers, reads: () => reads, reloads: () => reloads,
    async import(text) { b.context.backupFile = { text: async () => { reads++; return text; } }; await b.run('importBackupFile(backupFile)'); },
  };
}

test('import UI still reads once, confirms, writes local data and schedules reload after cloud replacement', async () => {
  const b = importApp();
  const payload = importPayload({ history: [{ id: 'imported-practice' }], projects: [{ id: 'imported', apiKey: 'import-placeholder' }] });
  await b.import(JSON.stringify(payload));
  assert.equal(b.reads(), 1);
  assert.deepEqual(b.confirmations, ['Import 1 practices and replace all current data? This file contains API keys.']);
  assert.deepEqual(JSON.parse(b.storage.get('tableTopicsPractice.v1')), payload.data.practice);
  assert.deepEqual(JSON.parse(b.storage.get('tableTopicsAIProjects.v1')), payload.data.aiSettings);
  assert.equal(b.storage.get('tableTopicsLanguage.v1'), 'en-US');
  assert.deepEqual(b.cloudWrites, [payload.data.practice]);
  assert.equal(b.reloads(), 0);
  const reload = b.timers.find(timer => timer.delay === 700);
  assert.ok(reload); reload.callback();
  assert.equal(b.reloads(), 1);
  assert.equal(b.get('#importBackupInput').value, '');
});

test('canceling import leaves local data intact and does not replace cloud data or reload', async () => {
  const b = importApp({ confirmed: false });
  const previous = [...b.storage];
  await b.import(JSON.stringify(importPayload()));
  assert.equal(b.reads(), 1);
  assert.equal(b.confirmations.length, 1);
  assert.deepEqual([...b.storage], previous);
  assert.deepEqual(b.cloudWrites, []);
  assert.equal(b.timers.some(timer => timer.delay === 700), false);
  assert.equal(b.get('#importBackupInput').value, '');
});

test('invalid import shapes and JSON preserve existing failure UI without writing or confirming', async () => {
  const malformed = importPayload({ history: [null] });
  const invalidCard = importPayload(); invalidCard.data.practice.reviewCards = [translationCard({ after: {} })];
  for (const text of [JSON.stringify({ format: 'wrong' }), '{invalid-json', JSON.stringify(malformed), JSON.stringify(invalidCard)]) {
    const b = importApp();
    const previous = [...b.storage];
    await b.import(text);
    assert.deepEqual([...b.storage], previous);
    assert.deepEqual(b.confirmations, []);
    assert.deepEqual(b.cloudWrites, []);
    assert.ok(b.get('#toast').textContent.startsWith('Import failed: '));
    if (text.includes('wrong')) assert.ok(b.get('#toast').textContent.includes('Backup'));
    assert.equal(b.get('#importBackupInput').value, '');
  }
});

test('KNOWN ISSUE: failed cloud import leaves overwritten local data and the old in-memory practice', async () => {
  const b = importApp({ cloudResult: false });
  const previous = JSON.parse(b.run('JSON.stringify(saved)'));
  const payload = importPayload({ history: [{ id: 'imported-practice' }] });
  await b.import(JSON.stringify(payload));
  // KNOWN ISSUE: localStorage is overwritten before cloud replacement succeeds, without rollback or updating saved.
  assert.deepEqual(JSON.parse(b.storage.get('tableTopicsPractice.v1')), payload.data.practice);
  assert.deepEqual(JSON.parse(b.run('JSON.stringify(saved)')), previous);
  assert.equal(b.timers.some(timer => timer.delay === 700), false);
  assert.equal(b.get('#toast').textContent, 'Imported locally, but cloud update failed. Keep this page open and try again.');
});
