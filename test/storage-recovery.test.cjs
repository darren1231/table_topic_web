const assert = require('node:assert/strict');
const { test } = require('node:test');
const data = require('../public/practice-data.js');

function environment(entries = []) {
  const values = new Map(entries);
  const storage = { get length() { return values.size; }, key: index => [...values.keys()][index],
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const recovery = require('../public/storage-recovery.js').create({ storage, now: () => 123 });
  return { values, storage, recovery };
}

for (const [name, raw, validate, fallback] of [
  ['practice JSON', '{broken', value => data.validatePractice(value), { history: [] }],
  ['practice structure', '{"history":[null]}', value => data.validatePractice(value), { history: [] }],
  ['AI structure', '{"projects":[]}', value => data.validateAiSettings(value), { activeId: 'builtin', projects: [{ id: 'builtin' }] }],
  ['speech structure', '{"rate":"bad"}', value => data.validateSpeechSettings(value), { voiceURI: '', rate: 0.9 }],
]) {
  test(`startup preserves corrupt ${name} verbatim before using defaults`, () => {
    const { recovery, values } = environment([['key', raw]]);
    assert.deepEqual(recovery.read('key', { validate, fallback: () => fallback }), fallback);
    assert.equal(values.get('key.corrupt.123'), raw);
    assert.equal(recovery.hadRecovery(), true);
    assert.deepEqual(recovery.list(), [{ key: 'key.corrupt.123', raw }]);
    assert.doesNotThrow(() => recovery.write('key', JSON.stringify(fallback)));
  });
}

test('valid legacy startup data is retained without a recovery notice or extra writes', () => {
  const original = { history: [{ date: '2026-11-10', answer: 'A legacy answer' }] };
  const { recovery, values } = environment([['practice', JSON.stringify(original)]]);
  assert.deepEqual(recovery.read('practice', { validate: data.validatePractice, fallback: () => ({ history: [] }) }), original);
  assert.equal(values.size, 1);
  assert.equal(recovery.hadRecovery(), false);
});

test('startup keeps repairable duplicate IDs and missing schedules while import stays strict', () => {
  const original = { history: [{ id: 'old', date: '2026-11-10' }, { id: 'old', date: '2026-11-10' }],
    reviewCards: [{ id: 'card', before: 'Old', after: 'New', language: 'en-US' }],
    scripts: [{ id: 'script', paragraphs: [{ text: 'Draft', versions: null, analyses: false }] }] };
  const { recovery } = environment([['practice', JSON.stringify(original)]]);
  const loaded = recovery.read('practice', { validate: data.validateStartupPractice, fallback: () => ({ history: [] }) });
  assert.equal(recovery.hadRecovery(), false);
  data.ensureDataSchema(loaded);
  assert.equal(loaded.history.length, 2);
  assert.equal(loaded.reviewCards[0].before, 'Old');
  assert.ok(Number.isFinite(Date.parse(loaded.reviewCards[0].dueAt)));
  assert.deepEqual(loaded.scripts[0].paragraphs[0].versions, []);
  assert.equal(data.validatePractice(original), false);
});

test('backup collisions preserve both originals and failed backup writes protect the primary value', () => {
  const { recovery, storage, values } = environment([['key', '{bad'], ['key.corrupt.123', 'older']]);
  recovery.read('key', { validate: data.validatePractice, fallback: () => ({ history: [] }) });
  assert.equal(values.get('key.corrupt.123'), 'older');
  assert.equal(values.get('key.corrupt.123.1'), '{bad');
  values.set('blocked', '{original');
  storage.setItem = () => { throw new Error('quota'); };
  recovery.read('blocked', { validate: data.validatePractice, fallback: () => ({ history: [] }) });
  assert.throws(() => recovery.write('blocked', '{}'));
  assert.equal(values.get('blocked'), '{original');
  assert.ok(recovery.list().some(entry => entry.key === 'blocked' && entry.raw === '{original'));
});

test('recovery notice binds once, dismisses once and releases its download listeners', () => {
  const { recovery } = environment([['key', '{broken']]);
  recovery.read('key', { validate: data.validatePractice, fallback: () => ({ history: [] }) });
  const nodes = new Map(), downloads = [];
  const document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, Object.assign(new EventTarget(), {
      classList: { toggle() {}, add() {} }, textContent: '',
    }));
    return nodes.get(id);
  } };
  const notice = require('../public/storage-recovery.js').createNotice({ document, recovery, t: key => key,
    download: raw => downloads.push(JSON.parse(raw)) });
  notice.initialize(); notice.initialize();
  document.getElementById('exportRecoveryButton').dispatchEvent(new Event('click'));
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].entries[0].raw, '{broken');
  notice.dispose(); notice.dispose();
  document.getElementById('exportRecoveryButton').dispatchEvent(new Event('click'));
  assert.equal(downloads.length, 1);
});
