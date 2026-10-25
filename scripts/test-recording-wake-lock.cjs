const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRecordingWakeLock } = require('../recording-wake-lock.js');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Sentinel extends EventTarget {
  released = false;
  releases = 0;
  async release() {
    this.releases++;
    this.released = true;
    this.dispatchEvent(new Event('release'));
  }
}
function fixture(request) {
  const document = new EventTarget();
  document.visibilityState = 'visible';
  const window = new EventTarget();
  const changes = [];
  const calls = [];
  const navigator = request === null ? {} : { wakeLock: { request: type => {
    calls.push(type);
    return request ? request() : Promise.resolve(new Sentinel());
  } } };
  const controller = createRecordingWakeLock({ navigator, document, window, onChange: s => changes.push(s) });
  const visibility = state => { document.visibilityState = state; document.dispatchEvent(new Event('visibilitychange')); };
  return { controller, document, window, changes, calls, visibility };
}

test('recording acquires one screen lock; pausing releases it and continuing reacquires', async () => {
  const locks = [];
  const f = fixture(() => { const s = new Sentinel(); locks.push(s); return Promise.resolve(s); });
  f.controller.setActive(true);
  f.controller.setActive(true);
  await flush();
  assert.equal(f.controller.status, 'active');
  assert.deepEqual(f.calls, ['screen']);
  f.controller.setActive(false);
  assert.equal(f.controller.status, 'idle');
  assert.equal(locks[0].releases, 1);
  f.controller.setActive(true);
  await flush();
  assert.equal(f.controller.status, 'active');
  assert.equal(f.calls.length, 2);
});

test('stopping before the request resolves releases the late lock', async () => {
  const d = deferred(), s = new Sentinel(), f = fixture(() => d.promise);
  f.controller.setActive(true);
  f.controller.setActive(false);
  d.resolve(s);
  await flush();
  assert.equal(s.releases, 1);
  assert.equal(f.controller.status, 'idle');
});

test('a new recording waits for the stale request and obtains its own lock', async () => {
  const d = deferred(), old = new Sentinel(), next = new Sentinel();
  let count = 0;
  const f = fixture(() => ++count === 1 ? d.promise : Promise.resolve(next));
  f.controller.setActive(true);
  f.controller.setActive(false);
  f.controller.setActive(true);
  d.resolve(old);
  await flush();
  assert.equal(old.releases, 1);
  assert.equal(next.released, false);
  assert.equal(f.controller.status, 'active');
  assert.equal(f.calls.length, 2);
});

test('background releases the lock; returning reacquires only while recording', async () => {
  const s = new Sentinel(), f = fixture(() => Promise.resolve(s.released ? new Sentinel() : s));
  f.controller.setActive(true);
  await flush();
  f.visibility('hidden');
  assert.equal(s.released, true);
  assert.equal(f.controller.status, 'background');
  f.visibility('visible');
  await flush();
  assert.equal(f.controller.status, 'active');
  f.controller.setActive(false);
  f.visibility('hidden');
  f.visibility('visible');
  await flush();
  assert.equal(f.calls.length, 2);
  assert.equal(f.controller.status, 'idle');
});

test('backgrounding during a pending request cannot retain the resulting lock', async () => {
  const d = deferred(), s = new Sentinel(), f = fixture(() => d.promise);
  f.controller.setActive(true);
  f.visibility('hidden');
  d.resolve(s);
  await flush();
  assert.equal(s.released, true);
  assert.equal(f.controller.status, 'background');
});

test('permission rejection is recoverable through an explicit retry', async () => {
  let fail = true;
  const f = fixture(() => fail ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(new Sentinel()));
  f.controller.setActive(true);
  await flush();
  assert.equal(f.controller.status, 'denied');
  fail = false;
  await f.controller.retry();
  assert.equal(f.controller.status, 'active');
});

test('unsupported browsers show a fallback without throwing', async () => {
  const f = fixture(null);
  f.controller.setActive(true);
  await flush();
  assert.equal(f.controller.status, 'unsupported');
  f.controller.setActive(false);
  assert.equal(f.controller.status, 'idle');
});

test('system release shows a warning without an automatic retry loop', async () => {
  const s = new Sentinel(), f = fixture(() => Promise.resolve(s));
  f.controller.setActive(true);
  await flush();
  await s.release();
  assert.equal(f.controller.status, 'released');
  await flush();
  assert.equal(f.calls.length, 1);
  f.controller.setActive(false);
  await f.controller.retry();
  assert.equal(f.calls.length, 1);
});

test('pagehide releases and pageshow restores a recording lock for back-forward cache', async () => {
  const s = new Sentinel(), f = fixture(() => Promise.resolve(s.released ? new Sentinel() : s));
  f.controller.setActive(true);
  await flush();
  f.window.dispatchEvent(new Event('pagehide'));
  assert.equal(s.released, true);
  assert.equal(f.controller.status, 'background');
  f.window.dispatchEvent(new Event('pageshow'));
  await flush();
  assert.equal(f.controller.status, 'active');
  assert.equal(f.calls.length, 2);
});

test('a lock already released on arrival is never reported as active', async () => {
  const s = new Sentinel();
  await s.release();
  const f = fixture(() => Promise.resolve(s));
  f.controller.setActive(true);
  await flush();
  assert.equal(f.controller.status, 'released');
});

function appFixture(mode) {
  const document = new EventTarget(), window = new EventTarget(), locks = [];
  document.visibilityState = 'visible';
  const elements = new Map();
  document.querySelector = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', textContent: '', dataset: {}, classList: { toggle() {}, add() {}, remove() {} }
    });
    return elements.get(selector);
  };
  window.SpeechRecognition = class {
    start() {}
    stop() {}
    abort() {}
  };
  const navigator = {
    wakeLock: { request: async () => { const s = new Sentinel(); locks.push(s); return s; } },
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) }
  };
  class Recorder {
    static isTypeSupported() { return true; }
    state = 'inactive';
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.onstop?.(); }
  }
  window.MediaRecorder = Recorder;
  const context = vm.createContext({
    window, document, navigator, MediaRecorder: Recorder,
    localStorage: { getItem: () => null },
    SpeechUtils: { createQueueState: () => ({}) },
    RecordingWakeLock: { createRecordingWakeLock },
    I18n: { ready: new Promise(() => {}), fromSource: s => s, translate: s => s },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    requestAnimationFrame() {}, console
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), context);
  vm.runInContext(`
    getActiveProject = () => ({ transcriptionMode: '${mode}', apiKey: 'test', transcriptionEndpoint: '/test', transcriptionModel: 'test' });
    currentScript = () => null;
  `, context);
  return { context, locks, run: source => vm.runInContext(source, context) };
}

for (const mode of ['browser', 'api']) {
  test(`actual ${mode} practice flow releases on pause, reset and question change`, async () => {
    const f = appFixture(mode);
    await f.run('startRecording()');
    await flush();
    assert.equal(f.run('recordingWakeLock.status'), 'active');
    f.run('pauseRecording()');
    assert.equal(f.locks[0].released, true);
    assert.equal(f.run('recordingWakeLock.status'), 'idle');
    // API onstop completes without chunks in this fixture.
    f.run('state.isTranscribing = false');
    await f.run('startRecording()');
    await flush();
    f.run('resetRecording()');
    assert.equal(f.locks[1].released, true);
    await f.run('startRecording()');
    await flush();
    f.run('resetRecorderForQuestion()');
    assert.equal(f.locks[2].released, true);
    assert.equal(f.run('recordingWakeLock.status'), 'idle');
  });
}

test('actual paragraph flow shares the lock with practice and releases after both stop', async () => {
  const f = appFixture('browser');
  await f.run('toggleScriptRecording("paragraph")');
  await flush();
  assert.equal(f.run('recordingWakeLock.status'), 'active');
  await f.run('startRecording()');
  await flush();
  assert.equal(f.locks.length, 1);
  f.run('pauseRecording()');
  assert.equal(f.locks[0].released, false);
  await f.run('toggleScriptRecording("paragraph")');
  assert.equal(f.locks[0].released, true);
  assert.equal(f.run('recordingWakeLock.status'), 'idle');
});
