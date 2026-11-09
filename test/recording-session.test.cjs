const assert = require('node:assert/strict');
const { test } = require('node:test');
const api = () => require('../public/recording-session.js');

test('recording session seals numbered segments, resumes and accumulates duration without mutation', () => {
  const idle = api().create();
  assert.equal(idle.status, 'idle');
  const first = api().resume(idle);
  assert.equal(first.status, 'recording');
  const interrupted = api().interrupt(first, 65);
  assert.equal(interrupted.status, 'interrupted');
  assert.deepEqual(interrupted.segments, [{ sequence: 1, seconds: 65, submitted: false }]);
  assert.equal(idle.segments.length, 0);
  const stopped = api().stop(api().resume(interrupted), 35);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.totalSeconds, 100);
  assert.deepEqual(stopped.segments.map(segment => [segment.sequence, segment.seconds]), [[1, 65], [2, 35]]);
});

test('duplicate events cannot seal or submit a segment twice and stopping interrupted audio retains it', () => {
  const recording = api().resume(api().create());
  assert.deepEqual(api().resume(recording), recording);
  const interrupted = api().interrupt(recording, 12);
  assert.deepEqual(api().interrupt(interrupted, 99), interrupted);
  const stopped = api().stop(interrupted);
  assert.equal(stopped.totalSeconds, 12);
  assert.deepEqual(api().stop(stopped), stopped);
  const first = api().takePending(stopped);
  assert.deepEqual(first.segments.map(segment => segment.sequence), [1]);
  assert.equal(api().takePending(first.session).segments.length, 0);
  assert.equal(api().takePending(api().create()).segments.length, 0);
});

test('recording duration rejects invalid values instead of corrupting the cumulative timer', () => {
  for (const seconds of [-1, NaN, Infinity, '10']) {
    assert.throws(() => api().interrupt(api().resume(api().create()), seconds));
  }
});
