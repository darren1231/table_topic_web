const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadCloud, DATA_KEY, MODE_KEY, APPLIED_KEY, userSession } = require('./helpers/cloud.cjs');
const payload = name => ({ history: [{ id: name }], projects: [{ id: 'project' }] });
const tick = () => new Promise(resolve => setImmediate(resolve));
const uploaded = env => env.state.uploads.map(upload => upload.row.payload);

test('startup as B ignores A pending marker without deleting the local payload', async () => {
  const local = payload('retained-local');
  const env = await loadCloud({ session: { user: { id: 'account-B' } }, local: {
    [MODE_KEY]: 'cloud', [DATA_KEY]: JSON.stringify(local),
    'tableTopicsImportPending.v1': JSON.stringify({ owner: 'account-A' }),
  } });
  assert.equal(env.api.hasPendingImport(), false);
  assert.deepEqual(JSON.parse(env.localStorage.getItem(DATA_KEY)), local);
  assert.deepEqual(uploaded(env), [local]);
  assert.equal(env.state.uploads[0].row.user_id, 'account-B');
});

test('signing out retains A pending marker and restoring A still protects its local import', async () => {
  const env = await loadCloud(); await env.click('enableCloudButton');
  const imported = payload('pending-for-A');
  const lease = env.api.beginImport();
  env.localStorage.setItem(DATA_KEY, JSON.stringify(imported)); lease.commit();
  await env.click('signOutButton');
  assert.equal(env.api.hasPendingImport(), true);
  env.state.session = userSession; env.state.authChanged('SIGNED_IN', userSession);
  assert.equal(env.api.hasPendingImport(), true);
  assert.deepEqual(JSON.parse(env.localStorage.getItem(DATA_KEY)), imported);
});

test('switching from pending A to B retires the old marker and allows B to synchronize normally', async () => {
  const env = await loadCloud(); await env.click('enableCloudButton');
  const imported = payload('imported-for-A');
  const lease = env.api.beginImport();
  env.localStorage.setItem(DATA_KEY, JSON.stringify(imported)); lease.commit();
  env.state.upsert = async () => ({ error: { message: 'denied' } });
  assert.equal(await env.api.replaceData(imported), false);
  const nextSession = { user: { id: 'account-B', user_metadata: {} } };
  env.state.upsert = async () => ({ error: null }); env.state.uploads.length = 0;
  env.state.session = nextSession;
  env.state.authChanged('SIGNED_IN', nextSession);
  await env.advance(0);
  assert.equal(env.api.hasPendingImport(), false);
  assert.equal(env.localStorage.getItem('tableTopicsImportPending.v1'), null);
  assert.notEqual(env.node('syncStatus').textContent, 'backup.import.pending');
  assert.equal(env.state.uploads.at(-1).row.user_id, 'account-B');
  const edited = payload('edited-by-B');
  env.localStorage.setItem(DATA_KEY, JSON.stringify(edited)); env.api.scheduleSync(edited);
  await env.advance(900);
  assert.deepEqual(uploaded(env).at(-1), edited);
  assert.equal(env.state.uploads.at(-1).row.user_id, 'account-B');
});

test('import discards an in-flight upload queue and serializes the committed replacement after it', async () => {
  const old = payload('old'), imported = payload('imported');
  const env = await loadCloud({ local: { [DATA_KEY]: JSON.stringify(old) } });
  await env.click('enableCloudButton'); env.state.uploads.length = 0;
  let finish;
  env.state.upsert = () => new Promise(resolve => { finish = resolve; });
  const running = env.click('syncNowButton');
  env.api.scheduleSync(payload('queued-old')); await env.advance(900);
  const lease = env.api.beginImport();
  env.localStorage.setItem(DATA_KEY, JSON.stringify(imported)); lease.commit();
  const replacement = env.api.replaceData(imported);
  env.state.upsert = async () => ({ error: null }); finish({ error: null });
  await running; await env.advance(50);
  assert.equal(await replacement, true);
  assert.deepEqual(uploaded(env), [old, imported]);
});

test('pending import survives restart and never pulls older remote data over the committed local snapshot', async () => {
  const imported = payload('imported');
  const env = await loadCloud({ local: { [MODE_KEY]: 'cloud', [DATA_KEY]: JSON.stringify(imported),
    'tableTopicsImportPending.v1': JSON.stringify({ owner: userSession.user.id }) },
    remote: { payload: payload('old'), updated_at: '2099-01-01T00:00:00Z' } });
  assert.deepEqual(JSON.parse(env.localStorage.getItem(DATA_KEY)), imported);
  assert.deepEqual(uploaded(env), [imported]);
  assert.equal(env.state.reloads, 0);
  assert.equal(env.api.hasPendingImport(), false);
});

test('edits during an import upload remain pending until the latest local snapshot is retried', async () => {
  const imported = payload('imported'), edited = payload('edited');
  const env = await loadCloud(); await env.click('enableCloudButton');
  const lease = env.api.beginImport();
  env.localStorage.setItem(DATA_KEY, JSON.stringify(imported)); lease.commit();
  let finish;
  env.state.upsert = () => new Promise(resolve => { finish = resolve; });
  const running = env.api.replaceData(imported);
  env.localStorage.setItem(DATA_KEY, JSON.stringify(edited));
  env.api.scheduleSync(edited);
  finish({ error: null });
  assert.equal(await running, false);
  assert.equal(env.api.hasPendingImport(), true);
  env.state.upsert = async () => ({ error: null });
  assert.equal(await env.api.replaceData(edited), true);
  assert.deepEqual(uploaded(env).at(-1), edited);
});

test('import invalidates old sync timers and prevents a late pull from restoring the previous practice', async () => {
  const old = payload('old'), imported = payload('imported');
  const env = await loadCloud({ local: { [DATA_KEY]: JSON.stringify(old) } });
  await env.click('enableCloudButton'); env.state.uploads.length = 0;
  env.api.scheduleSync(old);
  let finish;
  env.state.readRemote = () => new Promise(resolve => { finish = resolve; });
  env.visibility();
  const lease = env.api.beginImport();
  env.localStorage.setItem(DATA_KEY, JSON.stringify(imported)); lease.commit();
  finish({ data: { payload: old, updated_at: '2099-01-01T00:00:00Z' }, error: null });
  await tick();
  assert.deepEqual(JSON.parse(env.localStorage.getItem(DATA_KEY)), imported);
  assert.equal(await env.api.replaceData(imported), true);
  await env.advance(900);
  assert.deepEqual(uploaded(env), [imported]);
});

test('a rejected import stays pending across polling and can retry the current local snapshot', async () => {
  const old = payload('old'), imported = payload('imported');
  const env = await loadCloud({ local: { [DATA_KEY]: JSON.stringify(old) } });
  await env.click('enableCloudButton');
  env.state.upsert = async () => ({ error: { message: 'denied' } });
  const lease = env.api.beginImport();
  env.localStorage.setItem(DATA_KEY, JSON.stringify(imported)); lease.commit();
  assert.equal(await env.api.replaceData(imported), false);
  assert.equal(env.api.hasPendingImport(), true);
  env.state.remote = { payload: old, updated_at: '2099-01-01T00:00:00Z' };
  env.poll(); await tick();
  assert.deepEqual(JSON.parse(env.localStorage.getItem(DATA_KEY)), imported);
  env.state.upsert = async () => ({ error: null });
  assert.equal(await env.api.replaceData(JSON.parse(env.localStorage.getItem(DATA_KEY))), true);
  assert.equal(env.api.hasPendingImport(), false);
});

test('a stale applied-remote marker cannot upload corrupt local defaults over a valid remote', async () => {
  const timestamp = '2026-11-10T01:00:00Z', remote = payload('remote-retained');
  const env = await loadCloud({ local: { [MODE_KEY]: 'cloud', [DATA_KEY]: '{broken' },
    sessionValues: { [APPLIED_KEY]: timestamp }, remote: { payload: remote, updated_at: timestamp } });
  assert.deepEqual(JSON.parse(env.localStorage.getItem(DATA_KEY)), remote);
  assert.deepEqual(uploaded(env), []);
});

test('recovered empty startup data cannot upload before cloud restore or while reload is pending', async () => {
  const env = await loadCloud({ local: { [DATA_KEY]: '{broken' } });
  const data = require('../public/practice-data.js');
  const recovery = require('../public/storage-recovery.js').create({ storage: env.localStorage });
  const fallback = recovery.read(DATA_KEY, { validate: data.validatePractice, fallback: () => ({ history: [] }) });
  const remote = payload('kept-in-cloud');
  let finish;
  env.state.readRemote = () => new Promise(resolve => { finish = resolve; });
  const enabling = env.click('enableCloudButton');
  env.api.scheduleSync(fallback);
  await env.advance(900);
  assert.deepEqual(uploaded(env), []);
  finish({ data: { payload: remote, updated_at: '2026-11-10T01:00:00Z' }, error: null });
  await enabling;
  assert.deepEqual(JSON.parse(env.localStorage.getItem(DATA_KEY)), remote);
  env.api.scheduleSync(fallback);
  await env.advance(900);
  assert.deepEqual(uploaded(env), []);
});

test('invalid remote practice never overwrites local data, reloads or uploads defaults', async () => {
  for (const invalid of [{ history: [null] }, { history: 'wrong' }, [], 'text', { history: [], reviewCards: [null] }]) {
    const raw = JSON.stringify(payload('local'));
    const env = await loadCloud({ local: { [MODE_KEY]: 'cloud', [DATA_KEY]: raw }, remote: { payload: invalid } });
    assert.equal(env.localStorage.getItem(DATA_KEY), raw);
    assert.equal(env.state.reloads, 0);
    assert.equal(env.state.uploads.length, 0);
    assert.equal(env.node('syncStatus').textContent, 'cloud.invalidPayload');
  }
});

for (const [name, raw, expected] of [
  ['valid JSON', JSON.stringify(payload('local')), payload('local')],
  ['invalid JSON', '{broken', { history: [] }],
  ['missing data', undefined, { history: [] }],
]) {
  test(`cloud reads ${name} through the upload path`, async () => {
    const env = await loadCloud({ local: raw === undefined ? {} : { [DATA_KEY]: raw } });
    await env.click('enableCloudButton');
    assert.deepEqual(uploaded(env), [expected]);
    assert.equal(env.state.uploads[0].row.user_id, userSession.user.id);
    assert.deepEqual(env.state.uploads[0].options, { onConflict: 'user_id' });
    assert.ok(Number.isFinite(Date.parse(env.state.uploads[0].row.updated_at)));
    assert.deepEqual(env.state.reads[0], { columns: 'payload, updated_at', column: 'user_id', value: userSession.user.id });
  });
}

test('cloud auth sign-in enables cloud and remote data overwrites local data', async () => {
  const remote = payload('remote');
  const env = await loadCloud({ session: null, local: { [MODE_KEY]: 'cloud', [DATA_KEY]: JSON.stringify(payload('unsynced')) }, remote: { payload: remote, updated_at: '2026-11-10T01:00:00Z' } });
  assert.equal(env.api.isSignedIn(), false);
  env.state.authChanged('SIGNED_IN', userSession);
  await env.advance(0);
  // KNOWN ISSUE: F02/F03 - Enabling cloud replaces unsynced local data without merging or confirmation.
  assert.deepEqual(JSON.parse(env.localStorage.getItem(DATA_KEY)), remote);
  assert.equal(env.state.reloads, 1);
  assert.equal(env.sessionStorage.getItem(APPLIED_KEY), '2026-11-10T01:00:00Z');
  assert.equal(env.sessionStorage.getItem('tableTopicsCloudNotice'), 'cloud.loadedLatest');
  assert.equal(env.state.uploads.length, 0);
  assert.equal(env.api.getUserId(), userSession.user.id);
});

test('cloud signature without timestamp hashes the serialized remote payload', async () => {
  const env = await loadCloud({ remote: { payload: { history: [] } } });
  await env.click('enableCloudButton');
  assert.equal(env.sessionStorage.getItem(APPLIED_KEY), '14:-1165135242');
  assert.equal(env.state.reloads, 1);
});

test('cloud already-applied signature uploads locally migrated data instead of reloading again', async () => {
  const local = payload('migrated');
  const env = await loadCloud({ local: { [DATA_KEY]: JSON.stringify(local) }, remote: { payload: { history: [] } }, sessionValues: { [APPLIED_KEY]: '14:-1165135242' } });
  await env.click('enableCloudButton');
  assert.deepEqual(uploaded(env), [local]);
  assert.equal(env.sessionStorage.getItem(APPLIED_KEY), null);
  assert.equal(env.state.reloads, 0);
});

test('cloud startup in cloud mode uploads local data when the remote payload is empty', async () => {
  const local = payload('startup');
  const env = await loadCloud({ local: { [MODE_KEY]: 'cloud', [DATA_KEY]: JSON.stringify(local) }, remote: { payload: {} } });
  assert.equal(env.api.isEnabled(), true);
  assert.deepEqual(uploaded(env), [local]);
  assert.equal(env.state.reloads, 0);
});

test('cloud scheduleSync debounces uploads for 900 milliseconds', async () => {
  const env = await loadCloud();
  await env.click('enableCloudButton');
  env.state.uploads.length = 0;
  env.api.scheduleSync(payload('first'));
  await env.advance(500);
  env.api.scheduleSync(payload('last'));
  await env.advance(899);
  assert.deepEqual(uploaded(env), []);
  await env.advance(1);
  assert.deepEqual(uploaded(env), [payload('last')]);
});

test('cloud queues the latest cloned payload while an upload is in flight', async () => {
  const env = await loadCloud();
  await env.click('enableCloudButton');
  env.state.uploads.length = 0;
  let finish;
  env.state.upsert = () => new Promise(resolve => { finish = resolve; });
  const pending = env.click('syncNowButton');
  const queued = payload('queued');
  env.api.scheduleSync(payload('superseded'));
  await env.advance(900);
  env.api.scheduleSync(queued);
  await env.advance(900);
  queued.history[0].id = 'mutated';
  assert.equal(env.state.uploads.length, 1);
  env.state.upsert = async () => ({ error: null });
  finish({ error: null });
  await pending;
  assert.deepEqual(uploaded(env), [{ history: [] }, payload('queued')]);
});

test('cloud polling overwrites pending local changes and reloads for newer remote data', async () => {
  const old = payload('old');
  const env = await loadCloud({ local: { [DATA_KEY]: JSON.stringify(old) }, remote: { payload: old, updated_at: '2026-11-10T01:00:00Z' } });
  await env.click('enableCloudButton');
  env.localStorage.setItem(DATA_KEY, JSON.stringify(payload('unsynced')));
  env.api.scheduleSync(payload('unsynced'));
  env.state.remote = { payload: payload('new-remote'), updated_at: '2026-11-10T02:00:00Z' };
  env.poll();
  await tick();
  // KNOWN ISSUE: F02/F03 - Polling overwrites local edits even when a local upload is pending.
  assert.deepEqual(JSON.parse(env.localStorage.getItem(DATA_KEY)), payload('new-remote'));
  assert.equal(env.state.reloads, 1);
  assert.equal(env.state.uploads.length, 0);
});

test('cloud skips polling while hidden and ignores older remote timestamps', async () => {
  const local = payload('local');
  const env = await loadCloud({ local: { [DATA_KEY]: JSON.stringify(local) }, remote: { payload: local, updated_at: '2026-11-10T02:00:00Z' } });
  await env.click('enableCloudButton');
  const reads = env.state.reads.length;
  env.document.visibilityState = 'hidden';
  env.poll();
  assert.equal(env.state.reads.length, reads);
  env.state.remote = { payload: payload('older'), updated_at: '2026-11-10T01:00:00Z' };
  env.document.visibilityState = 'visible';
  env.visibility();
  await tick();
  assert.equal(env.state.reads.length, reads + 1);
  assert.deepEqual(JSON.parse(env.localStorage.getItem(DATA_KEY)), local);
  assert.equal(env.state.reloads, 0);
});

test('cloud switching to local cancels scheduled uploads and retains data and session', async () => {
  const env = await loadCloud();
  await env.click('enableCloudButton');
  env.state.uploads.length = 0;
  env.api.scheduleSync(payload('pending'));
  await env.click('useLocalButton');
  await env.advance(900);
  assert.equal(env.api.isEnabled(), false);
  assert.equal(env.api.isSignedIn(), true);
  assert.equal(env.localStorage.getItem(MODE_KEY), 'local');
  assert.equal(env.node('syncStatus').textContent, 'cloud.switchedLocal');
  assert.deepEqual(uploaded(env), []);
  assert.equal(env.state.signOuts, 0);
});

test('cloud sign-out disables uploads and clears the active user without deleting local data', async () => {
  const local = payload('retained');
  const env = await loadCloud({ local: { [DATA_KEY]: JSON.stringify(local) } });
  await env.click('enableCloudButton');
  env.state.uploads.length = 0;
  env.api.scheduleSync(payload('pending'));
  await env.click('signOutButton');
  await env.advance(900);
  assert.equal(env.state.signOuts, 1);
  assert.equal(env.api.isSignedIn(), false);
  assert.equal(env.api.getUserId(), null);
  assert.equal(env.api.isEnabled(), false);
  assert.equal(env.localStorage.getItem(MODE_KEY), 'local');
  assert.deepEqual(JSON.parse(env.localStorage.getItem(DATA_KEY)), local);
  assert.deepEqual(uploaded(env), []);
});

test('cloud read and upload errors report failure without replacing local data', async () => {
  const env = await loadCloud({ local: { [DATA_KEY]: JSON.stringify(payload('local')) } });
  env.state.readError = { message: 'fixture read failure' };
  await env.click('enableCloudButton');
  assert.deepEqual(uploaded(env), []);
  assert.deepEqual(JSON.parse(env.localStorage.getItem(DATA_KEY)), payload('local'));
  env.state.readError = null;
  env.visibility();
  await tick(); // A successful read must reopen the upload gate before testing an upload failure.
  env.state.upsert = async () => { throw new Error('fixture upload failure'); };
  assert.equal(await env.click('syncNowButton'), false);
  assert.equal(env.node('syncStatus').textContent, 'cloud.syncFailed');
  assert.equal(env.node('syncStatus').className, 'sync-status error');
});

test('cloud unconfigured adapter never uploads or changes locally committed storage', async () => {
  const env = await loadCloud({ configured: false });
  assert.equal(env.api.isEnabled(), false);
  assert.equal(env.node('syncStatus').textContent, 'cloud.notConfigured');
  env.localStorage.setItem(DATA_KEY, JSON.stringify(payload('committed')));
  assert.equal(await env.api.replaceData(payload('ignored')), true);
  env.api.scheduleSync(payload('ignored'));
  await env.advance(900);
  assert.deepEqual(JSON.parse(env.localStorage.getItem(DATA_KEY)), payload('committed'));
  assert.deepEqual(uploaded(env), []);
});
