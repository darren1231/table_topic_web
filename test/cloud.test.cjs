const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadCloud, DATA_KEY, MODE_KEY, APPLIED_KEY, userSession } = require('./helpers/cloud.cjs');
const payload = name => ({ history: [{ id: name }], projects: [{ id: 'project' }] });
const tick = () => new Promise(resolve => setImmediate(resolve));
const uploaded = env => env.state.uploads.map(upload => upload.row.payload);

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
  env.state.upsert = async () => { throw new Error('fixture upload failure'); };
  assert.equal(await env.click('syncNowButton'), false);
  assert.equal(env.node('syncStatus').textContent, 'cloud.syncFailed');
  assert.equal(env.node('syncStatus').className, 'sync-status error');
});

test('cloud unconfigured local mode never uploads and replaceData writes local storage', async () => {
  const env = await loadCloud({ configured: false });
  assert.equal(env.api.isEnabled(), false);
  assert.equal(env.node('syncStatus').textContent, 'cloud.notConfigured');
  assert.equal(await env.api.replaceData(payload('imported')), true);
  env.api.scheduleSync(payload('ignored'));
  await env.advance(900);
  assert.deepEqual(JSON.parse(env.localStorage.getItem(DATA_KEY)), payload('imported'));
  assert.deepEqual(uploaded(env), []);
});
