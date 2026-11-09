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
