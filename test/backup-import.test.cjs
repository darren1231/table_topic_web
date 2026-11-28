const assert = require('node:assert/strict');
const { test } = require('node:test');
const { create } = require('../public/backup-import.js');

function fixture({ failKey, cloudResult = true } = {}) {
  const keys = { practice: 'practice', ai: 'ai', language: 'language' };
  const values = new Map([['practice', '{"history":[{"id":"old"}]}'], ['ai', '{"activeId":"old"}'], ['language', 'en-US']]);
  const old = [...values], commits = [], messages = [], timers = new Map();
  let timerId = 0, cloudCalls = 0, failed = false;
  const imported = { practice: { history: [{ id: 'new' }] }, aiSettings: { activeId: 'new' }, language: 'ja-JP' };
  const nodes = new Map();
  const document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, Object.assign(new EventTarget(), { value: '', textContent: '', disabled: false,
      close() {}, classList: { toggle() {} } }));
    return nodes.get(id);
  } };
  const storage = { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key), setItem(key, value) {
    if (key === failKey && !failed) { failed = true; throw new Error('quota'); }
    values.set(key, value);
  } };
  const cloud = { isEnabled: () => true, replaceData: async () => { cloudCalls++; return cloudResult; } };
  const authEvents = new EventTarget();
  const importer = create({ document, storage, keys, readBackup: () => ({ payload: { data: imported }, count: 1, hasKeys: false }),
    getCloud: () => cloud, authEvents, supportsLanguage: () => true, getLanguage: () => 'en-US', confirm: () => true,
    onCommit: value => commits.push(value), refresh() {}, toast: message => messages.push(message), t: key => key,
    ui: (zh, en) => en, schedule(fn) { const id = ++timerId; timers.set(id, fn); return id; }, cancel: id => timers.delete(id), timeoutMs: 10 });
  return { importer, document, authEvents, values, old, commits, messages, timers, cloud, imported, cloudCalls: () => cloudCalls,
    import: () => importer.importFile({ text: async () => '{}' }) };
}

for (const failKey of ['practice', 'ai', 'language']) {
  test(`failed ${failKey} write rolls back prior keys and never publishes memory or calls cloud`, async () => {
    const f = fixture({ failKey });
    await f.import();
    assert.deepEqual([...f.values], f.old);
    assert.deepEqual(f.commits, []);
    assert.equal(f.cloudCalls(), 0);
    assert.ok(f.messages.at(-1).includes('backup.import.localFailed'));
  });
}

test('pending marker failure rolls back all local keys before publishing memory', async () => {
  const f = fixture();
  let canceled = false;
  f.cloud.beginImport = () => ({ commit() { throw new Error('marker quota'); }, cancel() { canceled = true; } });
  await f.import();
  assert.deepEqual([...f.values], f.old);
  assert.deepEqual(f.commits, []);
  assert.equal(canceled, true);
  assert.equal(f.cloudCalls(), 0);
});

test('cloud rejection keeps the local commit in memory and retry sends the latest local practice', async () => {
  const f = fixture({ cloudResult: false });
  await f.import();
  assert.equal(f.commits.length, 1);
  assert.deepEqual(JSON.parse(f.values.get('practice')), f.commits[0].practice);
  assert.ok(f.messages.at(-1).includes('backup.import.pending'));
  let retried;
  f.values.set('practice', '{"history":[{"id":"new"},{"id":"edited"}]}');
  f.cloud.replaceData = async value => { retried = value; return true; };
  await f.importer.retry();
  assert.deepEqual(retried.history.map(row => row.id), ['new', 'edited']);
  assert.ok(f.messages.at(-1).includes('backup.import.synced'));
});

test('cloud timeout reports a local commit as pending, not a rollback or a successful remote write', { timeout: 1000 }, async () => {
  const f = fixture();
  f.cloud.replaceData = () => new Promise(() => {});
  const imported = f.import();
  for (let index = 0; index < 8; index++) await Promise.resolve();
  for (const fn of [...f.timers.values()]) fn();
  await imported;
  assert.equal(f.commits.length, 1);
  assert.deepEqual(JSON.parse(f.values.get('practice')), f.commits[0].practice);
  assert.ok(f.messages.at(-1).includes('backup.import.pending'));
});

test('disposing during file reading prevents late writes, then initialization can start a fresh import', async () => {
  const f = fixture();
  f.importer.initialize(); f.importer.initialize();
  let finish;
  const running = f.importer.importFile({ text: () => new Promise(resolve => { finish = resolve; }) });
  f.importer.dispose(); f.importer.dispose();
  finish('{}'); await running;
  assert.deepEqual([...f.values], f.old);
  assert.deepEqual(f.commits, []);
  f.importer.initialize();
  await f.import();
  assert.equal(f.commits.length, 1);
  f.importer.dispose();
});

test('double clicking import while the cloud is pending publishes only one local commit', async () => {
  const f = fixture();
  let finish;
  f.cloud.replaceData = () => new Promise(resolve => { finish = resolve; });
  const running = f.import();
  for (let index = 0; index < 8; index++) await Promise.resolve();
  await f.import();
  assert.equal(f.commits.length, 1);
  finish(true); await running;
});

test('restored pending notice reflects cloud initialization completing its retry', async () => {
  const f = fixture();
  let finish, pending = true;
  f.cloud.hasPendingImport = () => pending;
  f.cloud.ready = new Promise(resolve => { finish = resolve; });
  f.importer.initialize();
  f.cloud.getUserId = () => 'A';
  f.authEvents.dispatchEvent(new Event('tabletopics:auth'));
  assert.equal(f.document.getElementById('importCommitStatus').textContent, 'backup.import.pending');
  pending = false; finish();
  f.authEvents.dispatchEvent(new Event('tabletopics:auth'));
  await Promise.resolve();
  assert.equal(f.document.getElementById('importCommitStatus').textContent, 'backup.import.synced');
  f.importer.dispose();
});

test('switching accounts clears the old import notice and ignores its late success', async () => {
  const f = fixture();
  let owner = 'A', pending = true, finish;
  f.cloud.getUserId = () => owner;
  f.cloud.hasPendingImport = () => pending;
  f.cloud.replaceData = () => new Promise(resolve => { finish = resolve; });
  f.importer.initialize();
  const running = f.import();
  for (let index = 0; index < 8; index++) await Promise.resolve();
  owner = 'B'; pending = false;
  f.authEvents.dispatchEvent(new Event('tabletopics:auth'));
  finish(true); await running;
  assert.equal(f.document.getElementById('importCommitStatus').textContent, '');
  assert.deepEqual(f.messages, []);
  f.importer.dispose();
});
