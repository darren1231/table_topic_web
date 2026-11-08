const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { browser, app, publicDir } = require('./helpers/frontend.cjs');

function success(text = 'Transcript') {
  return Response.json({ text, usage: { inputTokens: 0, outputTokens: 0, audioSeconds: 60 }, cost: 0.0045,
    balance: { spent: 0.2, credit: 1, balance: 0.8, exhausted: false } });
}

test('local-mode sessions refresh their access tokens without requiring cloud sync', async () => {
  const b = browser();
  let session = { user: { id: 'member-one' }, access_token: 'first-placeholder' };
  b.context.window.SUPABASE_CONFIG = { url: 'https://database.example.invalid', anonKey: 'public-placeholder' };
  b.context.window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session } }) } }) };
  b.run(fs.readFileSync(path.join(publicDir, 'cloud.js'), 'utf8'));
  const cloud = b.context.window.tableTopicsCloud;
  assert.equal(await cloud.getAccessToken(), 'first-placeholder');
  assert.equal(cloud.isSignedIn(), true);
  assert.equal(cloud.isEnabled(), false);
  session = { user: { id: 'member-one' }, access_token: 'refreshed-placeholder' };
  assert.equal(await cloud.getAccessToken(), 'refreshed-placeholder');
  session = null;
  assert.equal(await cloud.getAccessToken(), null);
  assert.equal(cloud.isSignedIn(), false);
  assert.ok(![...b.storage.values()].some(value => value.includes('placeholder')));
});

test('disabled BYOK retains old projects but exposes only the managed provider and hides key controls', () => {
  const b = app();
  assert.equal(b.run('getActiveProject().provider'), 'system');
  assert.equal(b.run('aiSettings.projects.find(p=>p.id==="legacy").apiKey'), 'legacy-placeholder');
  assert.ok(b.get('#projectSelect').children.every(option => option.value !== 'legacy'));
  for (const id of ['providerSelect', 'modelSelect', 'endpointInput', 'apiKeyInput', 'transcriptionModelInput', 'transcriptionEndpointInput']) {
    assert.equal(b.get(`#${id}`).closest('label').classList.contains('hidden'), true, id);
  }
  assert.equal(b.get('#testConnectionButton').classList.contains('hidden'), true);
  b.setUser(null);
  assert.equal(b.run('getActiveProject().provider'), 'builtin');
  assert.equal(b.get('#systemAiNoticeText').textContent, b.run('t("systemAi.signInHint")'));
  let opened = false;
  b.get('#accountButton').onclick = () => { opened = true; };
  b.get('#systemAiSigninButton').click();
  assert.equal(opened, true);
});

test('refreshing the same signed-in identity preserves unsaved prompt edits', () => {
  const b = app();
  b.get('#promptInput').value = 'Unsaved prompt';
  b.setUser('member-one');
  assert.equal(b.get('#promptInput').value, 'Unsaved prompt');
});

test('questions, analysis, polish and other calls use system endpoints and store server costs locally', async () => {
  const calls = [];
  const b = app({ fetch: async (url, init) => {
    const payload = JSON.parse(init.body); calls.push({ url, payload });
    return success(payload.kind === 'questions' ? '["Question"]' : payload.kind === 'analysis'
      ? '{"overall":75,"rewritten":"Improved"}' : 'Hi');
  } });
  await b.run('aiProvider.generateQuestions("topic", "en-US", 1)');
  await b.run('aiProvider.analyze("A sufficient practice answer")');
  await b.run('polishTranscriptWithAgent("Hi", getActiveProject())');
  await b.run('callAgent("Other task")');
  assert.deepEqual(calls.map(call => call.payload.kind), ['questions', 'analysis', 'polish', 'agent']);
  assert.ok(calls.every(call => call.url === '/api/ai/respond' && !('apiKey' in call.payload)));
  assert.equal(b.run('saved.apiUsage.length'), 4);
  assert.equal(b.run('saved.apiUsage.every(item=>item.provider==="system"&&item.estimatedCost===0.0045&&item.priced)'), true);
  assert.equal(b.get('#systemAiBalance').textContent, b.run('t("systemAi.balance", {spent:"0.2000", credit:"1.0000"})'));
  b.setUser('member-two');
  assert.equal(b.get('#systemAiBalance').textContent, b.run('t("systemAi.balanceUnknown")'));
});

test('402 finishes feedback with builtin and avoids later system requests, while 401 asks for sign-in', async () => {
  let calls = 0;
  const b = app({ fetch: async () => { calls++; return Response.json({ error: 'credit_exhausted' }, { status: 402 }); } });
  const result = await b.run('aiProvider.analyze("A practice answer that is long enough.")');
  assert.equal(typeof result.overall, 'number');
  assert.equal(b.run('getActiveProject().provider'), 'builtin');
  assert.equal(b.get('#toast').textContent, b.run('t("systemAi.creditExhausted")'));
  await b.run('aiProvider.generateQuestions("topic","en-US",1)');
  assert.equal(calls, 1);
  const unauthorized = app({ fetch: async () => Response.json({ error: 'UNTRUSTED' }, { status: 401 }) });
  await assert.rejects(unauthorized.run('callAgent("Task")'), { code: 'unauthorized' });
  assert.equal(unauthorized.get('#toast').textContent, unauthorized.run('t("systemAi.signInAgain")'));
});

test('visitors continue with builtin questions and feedback without any API request', async () => {
  const b = app({ signedIn: false });
  assert.equal(b.run('getActiveProject().provider'), 'builtin');
  b.context.I18n.questionTemplates = () => [topic => `Question about ${topic}`];
  assert.equal((await b.run('aiProvider.generateQuestions("topic","en-US",1)')).length, 1);
  assert.equal(typeof (await b.run('aiProvider.analyze("A practice answer.")')).overall, 'number');
});

test('an account change during token refresh prevents uploading the previous account input', async () => {
  let calls = 0;
  const b = app({ fetch: async () => { calls++; return success(); } });
  b.window.tableTopicsCloud.getAccessToken = async () => { b.setUser('member-two'); return 'other-user-placeholder'; };
  await assert.rejects(b.run('callAgent("Previous account input")'), { code: 'unauthorized' });
  assert.equal(calls, 0);
});

test('both recording paths use system transcription, preserve text, and reject oversized audio locally', async () => {
  const calls = [];
  const b = app({ fetch: async (url, init) => { calls.push({ url, init }); return success(); } });
  b.run('getActiveProject().smartCorrection=false');
  b.context.audio = new Blob(['audio'], { type: 'audio/webm' });
  await b.run('transcribeAudioBlob(audio,getActiveProject())');
  await b.run('transcribeAudioBlobV2(audio,getActiveProject())');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url === '/api/ai/transcribe' && call.init.body.get('kind') === 'transcription'));
  assert.equal(b.get('#transcript').value, 'Transcript\nTranscript');
  assert.equal(b.run('saved.apiUsage.filter(item=>item.kind==="transcription"&&item.estimatedCost===0.0045).length'), 2);
  b.context.audio = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)]);
  b.run('state.isTranscribing=true; updateRecorderControls()');
  await b.run('transcribeAudioBlobV2(audio,getActiveProject())');
  assert.equal(calls.length, 2);
  assert.equal(b.get('#toast').textContent, b.run('t("systemAi.audioTooLarge")'));
  assert.equal(b.run('state.isTranscribing'), false);
  assert.equal(b.get('#resumeRecordButton').disabled, false);
});

test('new system UI uses text nodes and new message keys exist in every locale', () => {
  const b = app();
  b.run('renderManagedProjectSettings(); renderSystemUsageDashboard()');
  for (const id of ['projectSelect', 'systemAiNoticeText', 'systemAiBalance', 'apiUsageList']) assert.equal(b.get(`#${id}`).htmlWrites, 0);
  const sources = ['system-ai.js', 'app.js'].map(file => fs.readFileSync(path.join(publicDir, file), 'utf8')).join('\n');
  const keys = [...new Set([...sources.matchAll(/['"](systemAi\.[A-Za-z]+)['"]/g)].map(match => match[1]))];
  for (const locale of ['zh-TW', 'en-US', 'ja-JP', 'ar']) {
    const messages = JSON.parse(fs.readFileSync(path.join(publicDir, `locales/${locale}.json`), 'utf8')).messages;
    for (const key of keys) {
      assert.equal(typeof messages[key], 'string', `${locale}: ${key}`);
      assert.ok(!/\?{2,}/.test(messages[key]), `${locale}: ${key} must preserve Unicode`);
    }
  }
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.ok(html.indexOf('src="system-ai.js"') < html.indexOf('src="app.js"'));
});
