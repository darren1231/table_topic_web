const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { publicDir } = require('./helpers/frontend.cjs');
const { recordingBrowser } = require('./helpers/recording.cjs');

test('both recording modes acquire wake lock on start and release on pause and discard', async () => {
  for (const mode of ['browser', 'api']) {
    const b = recordingBrowser(mode, async () => Response.json({ text: 'Saved', usage: {}, cost: 0, balance: null }));
    await b.run('startRecording()');
    assert.ok(b.wake.acquires > 0);
    b.run('pauseRecording()');
    assert.ok(b.wake.releases > 0);
    await b.settle();
    const releases = b.wake.releases;
    b.run('resetRecording()');
    assert.ok(b.wake.releases > releases);
    assert.equal(b.run('state.isRecording'), false);
  }
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.ok(html.indexOf('src="wake-lock.js"') < html.indexOf('src="app.js"'));
});

const result = text => Response.json({ text, usage: {}, cost: 0, balance: null });

test('API interruption events retain final audio without uploading or automatically reopening the microphone', async () => {
  for (const event of ['hidden', 'pagehide', 'ended', 'mute', 'error', 'stop']) {
    const uploads = [];
    const b = recordingBrowser('api', async (url, init) => { uploads.push(init); return result('Saved'); });
    await b.run('startRecording()'); b.tick(12);
    const recorder = b.recorders[0];
    if (event === 'hidden') b.visible(false);
    else if (event === 'pagehide') b.window.dispatchEvent({ type: 'pagehide' });
    else if (event === 'error') recorder.onerror();
    else if (event === 'stop') recorder.stop();
    else b.streams[0].track.emit(event);
    await b.settle();
    assert.equal(b.run('state.isRecording'), false, event);
    assert.equal(b.run('state.isPaused'), true);
    assert.equal(recorder.stops, 1);
    assert.equal(b.streams[0].track.stopped, true);
    assert.equal(uploads.length, 0);
    b.visible(true); await b.settle();
    assert.equal(b.streams.length, 1);
    assert.equal(b.get('#resumeRecordButton').disabled, false);
    assert.ok(b.get('#recordStatus').textContent.includes('00:12'));
    assert.equal(b.run('state.seconds'), 12);
    assert.ok(b.wake.releases > 0);
    assert.equal(uploads.length, 0);
  }
});

test('API resume queues the retained segment first, accumulates time and transcribes segments in order', async () => {
  const uploads = [];
  let resolveFirst;
  const b = recordingBrowser('api', async (url, init) => {
    uploads.push(await init.body.get('file').text());
    if (uploads.length === 1) return new Promise(resolve => { resolveFirst = resolve; });
    return result('Second');
  });
  await b.run('startRecording()'); b.tick(10); b.visible(false);
  b.window.dispatchEvent({ type: 'pagehide' }); b.streams[0].track.emit('ended');
  await b.settle(); b.visible(true);
  await b.run('resumeRecording()'); await b.settle();
  assert.equal(b.streams.length, 2);
  assert.deepEqual(uploads, ['segment-1']);
  b.tick(5); b.run('stopRecording()'); await b.settle();
  assert.equal(b.run('state.seconds'), 15);
  assert.equal(b.get('#timer').textContent, '00:15');
  assert.equal(b.run('apiRecordingSession.totalSeconds'), 15);
  assert.deepEqual(uploads, ['segment-1']);
  resolveFirst(result('First')); await b.settle();
  assert.deepEqual(uploads, ['segment-1', 'segment-2']);
  assert.equal(b.get('#transcript').value, 'First\nSecond');
  b.run('stopRecording()'); await b.settle();
  assert.equal(uploads.length, 2);
});

test('API resume waits for the final data event and duplicate interruption events do not duplicate a segment', async () => {
  const uploads = [];
  const b = recordingBrowser('api', async (url, init) => { uploads.push(await init.body.get('file').text()); return result('Saved'); });
  await b.run('startRecording()');
  b.recorders[0].deferStop = true;
  b.visible(false); b.window.dispatchEvent({ type: 'pagehide' }); b.streams[0].track.emit('mute');
  b.visible(true);
  const resuming = b.run('resumeRecording()'); await b.settle();
  assert.equal(b.streams.length, 1);
  b.streams[0].track.emit('ended');
  b.recorders[0].finishStop(); await resuming; await b.settle();
  assert.deepEqual(uploads, ['segment-1']);
  assert.equal(b.streams.length, 2);
  assert.equal(b.recorders[0].stops, 1);
});

test('stopping interrupted API audio submits the retained final segment without opening a microphone', async () => {
  const uploads = [];
  const b = recordingBrowser('api', async (url, init) => { uploads.push(init); return result('Final'); });
  await b.run('startRecording()'); b.tick(4); b.visible(false); await b.settle(); b.visible(true);
  assert.equal(b.get('#stopRecordButton')?.classList.contains('hidden'), false);
  assert.equal(b.get('#stopRecordButton')?.textContent, 'Stop and transcribe');
  b.get('#stopRecordButton').click(); await b.settle();
  assert.equal(uploads.length, 1);
  assert.equal(b.get('#transcript').value, 'Final');
  assert.equal(b.streams.length, 1);
});

test('discard drops retained segments and delayed stop data without uploading them', async () => {
  for (const delayed of [false, true]) {
    const uploads = [];
    const b = recordingBrowser('api', async (url, init) => { uploads.push(init); return result('Must not upload'); });
    await b.run('startRecording()'); b.recorders[0].deferStop = delayed;
    b.visible(false); await b.settle(); b.run('resetRecording()');
    if (delayed) b.recorders[0].finishStop();
    b.visible(true); b.run('stopRecording()'); await b.settle();
    assert.equal(uploads.length, 0);
    assert.equal(b.run('state.seconds'), 0);
    assert.equal(b.get('#transcript').value, '');
    await b.run('resumeRecording()'); await b.settle();
    assert.equal(uploads.length, 0);
  }
});

test('discard also cancels segments waiting behind an already submitted request', async () => {
  let resolveFirst;
  const uploads = [];
  const b = recordingBrowser('api', async (url, init) => { uploads.push(init); return new Promise(resolve => { resolveFirst = resolve; }); });
  await b.run('startRecording()'); b.visible(false); await b.settle(); b.visible(true);
  await b.run('resumeRecording()'); await b.settle();
  b.run('stopRecording()'); await b.settle(); b.run('resetRecording()');
  resolveFirst(result('Already submitted')); await b.settle();
  assert.equal(uploads.length, 1);
});

test('each API segment independently applies the existing 4 MiB upload check', async () => {
  const uploads = [];
  const b = recordingBrowser('api', async (url, init) => { uploads.push(init); return result('Small segment'); });
  await b.run('startRecording()');
  b.recorders[0].finalBlob = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)]);
  b.visible(false); await b.settle(); b.visible(true);
  await b.run('resumeRecording()'); await b.settle();
  assert.equal(uploads.length, 0);
  b.run('stopRecording()'); await b.settle();
  assert.equal(uploads.length, 1);
  assert.equal(b.get('#transcript').value, 'Small segment');
});

test('queued audio stays retained if its turn arrives while the page is hidden', async () => {
  let resolveFirst;
  const uploads = [];
  const b = recordingBrowser('api', async (url, init) => {
    uploads.push(await init.body.get('file').text());
    if (uploads.length === 1) return new Promise(resolve => { resolveFirst = resolve; });
    return result(`Text ${uploads.length}`);
  });
  await b.run('startRecording()'); b.visible(false); await b.settle(); b.visible(true);
  await b.run('resumeRecording()'); await b.settle();
  b.visible(false); await b.settle(); b.visible(true);
  await b.run('resumeRecording()'); await b.settle();
  b.visible(false); await b.settle();
  resolveFirst(result('Text 1')); await b.settle();
  assert.deepEqual(uploads, ['segment-1']);
  b.visible(true); await b.settle();
  assert.deepEqual(uploads, ['segment-1']);
  await b.run('resumeRecording()'); await b.settle();
  assert.deepEqual(uploads, ['segment-1', 'segment-2', 'segment-3']);
});

test('browser recognition keeps its existing reconnection behavior on visibility changes', async () => {
  const b = recordingBrowser('browser');
  const restarts = [];
  b.context.setTimeout = fn => { restarts.push(fn); return 1; };
  await b.run('startRecording()');
  const previous = b.run('state.recognition');
  b.visible(false); previous.onend();
  assert.equal(b.run('state.isRecording'), true);
  restarts[0]();
  assert.notEqual(b.run('state.recognition'), previous);
  assert.equal(b.streams.length, 0);
});

test('an interrupted microphone permission request cannot turn recording back on when it resolves', async () => {
  const b = recordingBrowser();
  const original = b.context.navigator.mediaDevices.getUserMedia;
  let resolve;
  b.context.navigator.mediaDevices.getUserMedia = () => new Promise(done => { resolve = done; });
  const starting = b.run('startRecording()');
  await b.settle(); b.visible(false); b.visible(true);
  const stream = await original(); resolve(stream);
  await starting;
  assert.equal(stream.track.stopped, true);
  assert.equal(b.recorders.length, 0);
  assert.equal(b.run('state.isRecording'), false);
  assert.equal(b.get('#resumeRecordButton').disabled, false);
});

test('microphone denial leaves recording stopped and allows an explicit retry', async () => {
  const b = recordingBrowser();
  const original = b.context.navigator.mediaDevices.getUserMedia;
  b.context.navigator.mediaDevices.getUserMedia = async () => { throw new Error('Denied'); };
  await b.run('startRecording()');
  assert.equal(b.run('state.isRecording'), false);
  assert.equal(b.get('#resumeRecordButton').disabled, false);
  assert.ok(b.get('#recordStatus').textContent.includes('Could not start'));
  b.context.navigator.mediaDevices.getUserMedia = original;
  await b.run('resumeRecording()');
  assert.equal(b.run('state.isRecording'), true);
});

test('discarded stop events cannot affect a newly started recording', async () => {
  const uploads = [];
  const b = recordingBrowser('api', async (url, init) => { uploads.push(init); return result('New segment'); });
  await b.run('startRecording()'); b.recorders[0].deferStop = true;
  b.visible(false); b.run('resetRecording()'); b.visible(true);
  await b.run('resumeRecording()');
  const releases = b.wake.releases;
  b.recorders[0].finishStop(); await b.settle();
  assert.equal(b.run('state.isRecording'), true);
  assert.equal(b.wake.releases, releases);
  assert.equal(b.streams[1].track.stopped, false);
  assert.equal(uploads.length, 0);
  b.run('stopRecording()'); await b.settle();
  assert.equal(uploads.length, 1);
});

test('recording scripts load before app and interruption messages exist intact in every locale', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.ok(html.indexOf('src="recording-session.js"') < html.indexOf('src="app.js"'));
  for (const locale of ['zh-TW', 'en-US', 'ja-JP', 'ar']) {
    const messages = JSON.parse(fs.readFileSync(path.join(publicDir, `locales/${locale}.json`), 'utf8')).messages;
    assert.ok(messages['recording.interrupted'].includes('{time}'));
    for (const key of ['recording.interrupted', 'recording.startFailed', 'recording.finish']) assert.ok(!messages[key].includes('??'));
  }
});
