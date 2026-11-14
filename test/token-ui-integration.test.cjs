const assert = require('node:assert/strict');
const { test } = require('node:test');
const { app } = require('./helpers/frontend.cjs');

test('guest token header offers sign-in without fetching token data', () => {
  const b = app({ signedIn: false });
  assert.equal(b.get('#tokenHeader')?.textContent, b.run('t("tokens.signInHint")'));
  let opened = false;
  b.get('#accountButton').onclick = () => { opened = true; };
  b.get('#tokenHeader').click();
  assert.equal(opened, true); assert.equal(b.tokenCalls.length, 0);
});

test('makeup and exchange require confirmation and refresh server credit after exchange', async () => {
  let state = { balance: 3300, streak: 0, checkedIn: false, canMakeup: true, makeupCost: 200, reward: 10, exchangeRate: 0.025 };
  let credit = 1;
  const b = app({ tokenFetch: async (url, init) => {
    if (url.endsWith('status')) return Response.json(state);
    if (url.endsWith('makeup')) { state = { ...state, balance: 3100, streak: 1, canMakeup: false, reward: 20 }; return Response.json(state); }
    assert.equal(init.body, '{"units":1}'); credit = 1.025;
    state = { ...state, balance: 2100 };
    return Response.json({ units: 1, tokensSpent: 1000, creditAdded: 0.025, rateUsd: 0.025, status: state });
  }, balanceFetch: async () => Response.json({ spent: 1, credit, balance: credit - 1, exhausted: credit <= 1 }) });
  await b.run('openTokenPanel()');
  const before = b.tokenCalls.length;
  b.context.confirm = () => false;
  await b.run("runTokenAction('makeup'); runTokenAction('exchange');");
  assert.equal(b.tokenCalls.length, before);
  b.context.confirm = () => true;
  await b.run("runTokenAction('makeup')");
  assert.equal(b.get('#tokenMakeupButton').classList.contains('hidden'), true);
  await b.run("runTokenAction('exchange')");
  assert.equal(b.run('tokenState.balance'), 2100);
  assert.equal(b.run('systemBalance.credit'), 1.025);
  assert.equal(b.run('systemCreditExhausted'), false);
  assert.equal(b.get('#systemAiBalance').textContent, b.run('t("systemAi.balance", {spent:"1.0000",credit:"1.0250"})'));
});

test('token panel renders server balance and today reward, then tomorrow reward after check-in', async () => {
  let checkedIn = false;
  const b = app({ tokenFetch: async () => Response.json({ balance: 1240, streak: 5, checkedIn, canMakeup: true,
    makeupCost: 200, reward: 80, exchangeRate: 0.025 }) });
  await b.run('openTokenPanel()');
  assert.equal(b.get('#tokenDialog').open, true);
  assert.equal(b.get('#tokenHeader').textContent, b.run('t("tokens.header", {balance:"1,240",streak:"5"})'));
  assert.equal(b.get('#tokenRewardLine').textContent, b.run('t("tokens.todayReward", {count:80})'));
  checkedIn = true;
  await b.run('refreshTokenStatus()');
  assert.equal(b.get('#tokenRewardLine').textContent, b.run('t("tokens.tomorrowReward", {count:100})'));
  assert.equal(b.get('#tokenMakeupButton').classList.contains('hidden'), false);
  for (const id of ['tokenHeader', 'tokenBalance', 'tokenStreak', 'tokenToday', 'tokenRewardLine', 'tokenExchangeHint', 'tokenPanelMessage']) assert.equal(b.get(`#${id}`).htmlWrites, 0);
});

test('analysis displays a check-in notice only for a validated new server award', async () => {
  let award = true;
  const b = app({ fetch: async () => Response.json({ text: 'Feedback', usage: { inputTokens: 1, outputTokens: 1 }, cost: 0.01,
    balance: { spent: 0.01, credit: 1, balance: 0.99, exhausted: false },
    checkIn: { checkedIn: award, reward: award ? 100 : 0, streak: 6, balance: 1240 } }) });
  await b.run("callSystemApi('respond', {instructions:'Coach', input:'Answer', kind:'analysis'}, getActiveProject(), 'analysis')");
  assert.equal(b.get('#tokenCheckInNotice').textContent, b.run('t("tokens.checkInNotice", {streak:"6",reward:"100"})'));
  assert.equal(b.get('#tokenCheckInNotice').classList.contains('hidden'), false);
  assert.equal(b.get('#tokenCheckInNotice').htmlWrites, 0);
  award = false;
  await b.run("callSystemApi('respond', {instructions:'Coach', input:'Answer', kind:'analysis'}, getActiveProject(), 'analysis')");
  assert.equal(b.get('#tokenCheckInNotice').classList.contains('hidden'), true);
});

test('business errors display translated messages and disable repeated actions while awaiting the server', async () => {
  let release;
  const b = app({ tokenFetch: async url => {
    if (url.endsWith('status')) return Response.json({ balance: 2000, streak: 0, checkedIn: false, canMakeup: true, makeupCost: 200, reward: 10, exchangeRate: 0.01 });
    return new Promise(resolve => { release = resolve; });
  } });
  await b.run('openTokenPanel()'); b.context.confirm = () => true;
  const pending = b.run("runTokenAction('makeup')");
  await new Promise(done => setImmediate(done));
  assert.equal(b.get('#tokenMakeupButton').disabled, true);
  const before = b.tokenCalls.length;
  await b.run("runTokenAction('makeup')"); assert.equal(b.tokenCalls.length, before);
  release(Response.json({ error: 'makeup_unavailable' }, { status: 400 })); await pending;
  assert.equal(b.get('#tokenPanelMessage').textContent, b.run('t("tokens.makeupUnavailable")'));
  const exchange = b.run("runTokenAction('exchange')");
  await new Promise(done => setImmediate(done));
  release(Response.json({ error: 'insufficient_tokens' }, { status: 400 })); await exchange;
  assert.equal(b.get('#tokenPanelMessage').textContent, b.run('t("tokens.insufficient")'));
});

test('sign-out clears token state and late status replies cannot restore the old account', async () => {
  let resolve;
  const b = app({ signedIn: false, tokenFetch: () => new Promise(done => { resolve = done; }) });
  b.setUser('member-one');
  await new Promise(done => setImmediate(done));
  b.setUser(null);
  resolve(Response.json({ balance: 9999, streak: 99, checkedIn: true, canMakeup: true, makeupCost: 200, reward: 0, exchangeRate: 0.01 }));
  await new Promise(done => setImmediate(done));
  assert.equal(b.run('tokenState'), null);
  assert.equal(b.get('#tokenHeader').textContent, b.run('t("tokens.signInHint")'));
  assert.equal(b.get('#tokenCheckInNotice').classList.contains('hidden'), true);
});

test('makeup eligibility uses the server flag even when the visible balance is below its cost', async () => {
  const b = app({ tokenFetch: async () => Response.json({ balance: 150, streak: 0, checkedIn: false,
    canMakeup: true, makeupCost: 200, reward: 10, exchangeRate: 0.01 }) });
  await b.run('openTokenPanel()');
  assert.equal(b.get('#tokenMakeupButton').disabled, false);
  assert.equal(b.get('#tokenMakeupButton').classList.contains('hidden'), false);
  assert.equal(b.get('#tokenExchangeButton').disabled, true);
});

test('expired token status clears account data and offers the existing sign-in dialog', async () => {
  const b = app({ tokenFetch: async () => Response.json({ error: 'unauthorized' }, { status: 401 }) });
  await b.run('openTokenPanel()');
  assert.equal(b.run('tokenState'), null);
  assert.equal(b.get('#tokenPanelMessage').textContent, b.run('t("systemAi.signInAgain")'));
  assert.equal(b.get('#tokenSigninButton').classList.contains('hidden'), false);
  let opened = false; b.get('#accountButton').onclick = () => { opened = true; };
  b.get('#tokenSigninButton').click(); assert.equal(opened, true);
});

test('all four token catalogs are complete and translated, including the two reward lines', () => {
  const fs = require('node:fs'), path = require('node:path');
  const { publicDir } = require('./helpers/frontend.cjs');
  const catalogs = Object.fromEntries(['zh-TW', 'en-US', 'ja-JP', 'ar'].map(locale => [locale, JSON.parse(fs.readFileSync(path.join(publicDir, 'locales', `${locale}.json`), 'utf8')).messages]));
  const keys = Object.keys(catalogs['zh-TW']).filter(key => key.startsWith('tokens.'));
  for (const [locale, messages] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(messages).filter(key => key.startsWith('tokens.')), keys);
    for (const key of keys) { assert.ok(messages[key]?.trim(), key); if (locale !== 'zh-TW') assert.notEqual(messages[key], catalogs['zh-TW'][key], `${locale}: ${key}`); }
  }
  assert.equal(catalogs['zh-TW']['tokens.todayReward'], '今天完成 AI 分析可得 {count} 枚');
  assert.equal(catalogs['zh-TW']['tokens.tomorrowReward'], '明天繼續可得 {count} 枚');
});
