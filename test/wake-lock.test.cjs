const assert = require('node:assert/strict');
const { test } = require('node:test');

function fixture(request) {
  const events = new Map(), locks = [], calls = [];
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => events.set(name, fn) };
  const navigator = { wakeLock: { request: async type => {
    calls.push(type);
    if (request) return request();
    const lock = { released: false, addEventListener: (name, fn) => { lock.onrelease = fn; },
      async release() { lock.released = true; lock.onrelease?.(); } };
    locks.push(lock); return lock;
  } } };
  const api = require('../public/wake-lock.js').createWakeLock({ navigator, document });
  const visible = async value => { document.visibilityState = value; events.get('visibilitychange')?.(); await Promise.resolve(); await Promise.resolve(); };
  return { api, calls, locks, visible };
}

test('wake lock acquires screen once and reacquires on visibility restoration only while recording', async () => {
  const f = fixture();
  await Promise.all([f.api.acquire(), f.api.acquire()]);
  assert.deepEqual(f.calls, ['screen']);
  await f.visible('hidden'); await f.locks[0].release();
  await f.visible('visible');
  assert.deepEqual(f.calls, ['screen', 'screen']);
  await f.api.release();
  assert.equal(f.locks[1].released, true);
  await f.visible('hidden'); await f.visible('visible');
  assert.equal(f.calls.length, 2);
});

test('wake lock ignores unsupported browsers and request or release errors', async () => {
  const { createWakeLock } = require('../public/wake-lock.js');
  const unsupported = createWakeLock({ navigator: {}, document: {} });
  await unsupported.acquire(); await unsupported.release();
  const rejected = fixture(async () => { throw new Error('Denied'); });
  await rejected.api.acquire(); await rejected.api.release();
  const failingRelease = fixture(async () => ({ release: async () => { throw new Error('Gone'); } }));
  await failingRelease.api.acquire(); await failingRelease.api.release();
});

test('wake lock releases a late request after recording has stopped', async () => {
  let resolve, released = 0;
  const f = fixture(() => new Promise(done => { resolve = done; }));
  const acquiring = f.api.acquire();
  await f.api.release();
  resolve({ release: async () => { released++; } });
  await acquiring;
  assert.equal(released, 1);
  await f.visible('visible');
  assert.equal(f.calls.length, 1);
});
