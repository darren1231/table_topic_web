const { test, expect } = require('./fixtures.cjs');
const { prepare, openMenu } = require('./flows.cjs');

test.skip(({ browserName }) => browserName !== 'chromium', 'WebKit iPhone has no fake microphone; real iPhone capture and background suspension need device testing.');

async function recordingWorkspace(page) {
  await prepare(page);
  await openMenu(page, 'openAiSettingsButton');
  await page.locator('#smartCorrectionInput').uncheck();
  await page.locator('#transcriptionModeSelect').selectOption('api');
  await page.locator('#saveProjectButton').click();
  await page.locator('[data-practice-flow="manuscript"]').click();
  await expect(page.locator('#transcriptionModeQuick')).toHaveValue('api');
}

function transcription(text, spent = 0.01) {
  return { text, usage: { audioSeconds: 2, inputTokens: 0, outputTokens: 0 }, cost: 0.01,
    balance: { spent, credit: 1, balance: 1 - spent, exhausted: false } };
}

async function visibility(page, state) {
  // Browser lifecycle boundary only: real MediaRecorder, streams, app listeners
  // and transcription queue remain untouched.
  await page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('real recorded audio is uploaded on pause and its transcript appears in the answer', async ({ signedInPage: page, sandbox }) => {
  await recordingWorkspace(page);
  sandbox.handleApi('transcribe', request => {
    expect(request.method()).toBe('POST');
    expect(request.headers()['content-type']).toContain('multipart/form-data; boundary=');
    const body = request.postDataBuffer();
    expect(body.length).toBeGreaterThan(100);
    expect(body.toString()).toContain('name="file"');
    expect(body.toString()).toContain('name="kind"');
    expect(body.toString()).toContain('transcription');
    return { body: transcription('Our garden brings neighbors together.'), status: 200 };
  });
  await page.locator('#resumeRecordButton').click();
  await expect(page.locator('#recordVisual')).toHaveClass(/recording/);
  await expect(page.locator('#timer')).not.toHaveText('00:00');
  await page.locator('#pauseRecordButton').click();
  await expect(page.locator('#transcript')).toHaveValue('Our garden brings neighbors together.');
  await expect(page.locator('#resumeRecordButton')).toBeEnabled();
  expect(sandbox.calls.filter(call => call.path === '/api/ai/transcribe')).toHaveLength(1);
  expect(sandbox.calls.filter(call => call.path === '/api/ai/respond')).toHaveLength(0);
});

test('background interruption retains audio until explicit resume and appends two segments in order', async ({ signedInPage: page, sandbox }) => {
  await recordingWorkspace(page);
  let releaseFirst;
  const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
  let uploads = 0;
  sandbox.handleApi('transcribe', async () => {
    uploads++;
    if (uploads === 1) await firstResponse;
    return { body: transcription(uploads === 1 ? 'First retained segment.' : 'Second recorded segment.', uploads * 0.01), status: 200 };
  });
  await page.locator('#resumeRecordButton').click();
  await expect(page.locator('#recordVisual')).toHaveClass(/recording/);
  await expect(page.locator('#timer')).not.toHaveText('00:00');
  await visibility(page, 'hidden');
  await expect(page.locator('#pauseRecordButton')).toBeDisabled();
  expect(uploads).toBe(0);
  await visibility(page, 'visible');
  await expect(page.locator('#recordStatus')).toContainText('Saved');
  const retained = await page.locator('#timer').innerText();
  await expect(page.locator('#recordStatus')).toContainText(retained);
  await expect(page.locator('#resumeRecordButton')).toBeEnabled();
  await expect(page.locator('#stopRecordButton')).toBeVisible();
  expect(uploads).toBe(0);
  await page.locator('#resumeRecordButton').click();
  await expect.poll(() => uploads).toBe(1);
  await expect(page.locator('#recordVisual')).toHaveClass(/recording/);
  await expect(page.locator('#timer')).not.toHaveText(retained);
  await page.locator('#pauseRecordButton').click();
  await expect(page.locator('#pauseRecordButton')).toBeDisabled();
  expect(uploads).toBe(1);
  releaseFirst();
  await expect(page.locator('#transcript')).toHaveValue('First retained segment.\nSecond recorded segment.');
  expect(uploads).toBe(2);
  expect(sandbox.calls.filter(call => call.path === '/api/ai/transcribe')).toHaveLength(2);
});
