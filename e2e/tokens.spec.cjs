const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures.cjs');
const { prepare, generate, answer, openMenu } = require('./flows.cjs');
const state = { balance: 2200, streak: 0, checkedIn: false, canMakeup: true, makeupCost: 200, reward: 10, exchangeRate: 0.025 };

test('guest token header opens Google sign-in without requesting token data', async ({ guestPage: page, sandbox }) => {
  await prepare(page);
  await expect(page.locator('#tokenHeader')).toHaveText('Sign in to start earning tokens');
  await page.locator('#tokenHeader').click();
  await expect(page.locator('#accountDialog')).toBeVisible();
  expect(sandbox.calls.filter(call => call.path.startsWith('/api/tokens/'))).toHaveLength(0);
});

test('token panel and new guide section work in four languages with today and tomorrow rewards', async ({ signedInPage: page, sandbox }) => {
  await prepare(page);
  for (const locale of ['zh-TW', 'en-US', 'ja-JP', 'ar']) {
    const messages = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/locales', `${locale}.json`), 'utf8')).messages;
    // Use the browser's locale data, which can differ from Node's ICU data.
    const counts = await page.evaluate(locale => [80, 100].map(value => new Intl.NumberFormat(locale).format(value)), locale);
    sandbox.mockToken('status', { ...state, balance: 1240, streak: 4, canMakeup: false, reward: 80 });
    await page.locator('#languageSelect').selectOption(locale);
    await page.locator('#tokenHeader').click();
    await expect(page.locator('#tokenTitle')).toHaveText(messages['tokens.title']);
    await expect(page.locator('#tokenRewardLine')).toHaveText(messages['tokens.todayReward'].replace('{count}', counts[0]));
    await expect(page.locator('#tokenToday')).toHaveText(messages['tokens.notCheckedIn']);
    await expect(page.locator('#tokenMakeupButton')).not.toBeVisible();
    await expect(page.locator('#tokenExchangeButton')).toHaveText(messages['tokens.exchange']);
    await expect(page.locator('#tokenDialog')).not.toContainText('tokens.');
    await page.locator('#tokenClose').click();
    sandbox.mockToken('status', { ...state, balance: 1320, streak: 5, checkedIn: true, canMakeup: false, reward: 0 });
    await page.locator('#tokenHeader').click();
    await expect(page.locator('#tokenRewardLine')).toHaveText(messages['tokens.tomorrowReward'].replace('{count}', counts[1]));
    await expect(page.locator('#tokenToday')).toHaveText(messages['tokens.checkedIn']);
    await page.locator('#tokenClose').click();
    await page.locator('#guideEntry').click();
    await expect(page.locator('#guideToc button')).toHaveCount(13);
    await expect(page.locator('#guide-section-13')).toContainText(messages['tokens.exchange']);
    await expect(page.locator('#guide-section-12')).toContainText(messages['guide.section12.question7']);
    await expect(page.locator('#guideView')).not.toContainText('guide.');
    await page.locator('#guideBackTop').click();
    const header = await page.locator('#tokenHeader').boundingBox();
    expect(header.x).toBeGreaterThanOrEqual(0);
    expect(header.x + header.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('successful AI analysis displays the server check-in award only once', async ({ signedInPage: page, sandbox }) => {
  await prepare(page);
  let first = true;
  sandbox.handleApi('respond', request => {
    const analysis = JSON.parse(request.postData()).kind === 'analysis';
    const checkedIn = analysis && first;
    if (analysis) {
      first = false;
      sandbox.mockToken('status', { ...state, balance: 1310, streak: 6, checkedIn: true, reward: 0, canMakeup: false });
    }
    return { status: 200, body: {
      text: JSON.stringify(analysis ? { overall: 85, structure: 85, detail: 85, fluency: 85, strength: 'Clear example', improve: 'Add a closing', summary: 'Useful practice' }
        : ['What makes a community strong?', 'What did you learn?', 'How can you help?']),
      usage: { inputTokens: 100, outputTokens: 50 }, cost: 0.1,
      balance: { spent: 0.2, credit: 1, balance: 0.8, exhausted: false },
      checkIn: { checkedIn, reward: checkedIn ? 100 : 0, streak: 6, balance: 1310 },
    } };
  });
  await generate(page);
  await page.locator('#transcript').fill(answer);
  await page.locator('#analyzeButton').click();
  await expect(page.locator('#overallScore')).toHaveText('85');
  await expect(page.locator('#tokenCheckInNotice')).toHaveText('6-day streak! You earned 100 tokens');
  await expect(page.locator('#tokenCheckInNotice')).toBeVisible();
  await expect(page.locator('#tokenHeader')).toContainText('1,310');
  await page.locator('#analyzeButton').click();
  await expect(page.locator('#tokenCheckInNotice')).not.toBeVisible();
});

test('makeup and exchange confirm before posting and exchange refreshes AI credit', async ({ signedInPage: page, sandbox }) => {
  await prepare(page);
  sandbox.mockToken('status', state);
  await page.locator('#tokenHeader').click();
  await expect(page.locator('#tokenMakeupButton')).toBeVisible();
  for (const id of ['tokenMakeupButton', 'tokenExchangeButton']) {
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator(`#${id}`).click();
  }
  expect(sandbox.calls.filter(call => ['/api/tokens/makeup', '/api/tokens/exchange'].includes(call.path))).toHaveLength(0);
  const madeUp = { ...state, balance: 2000, streak: 1, canMakeup: false, reward: 20 };
  sandbox.handleToken('makeup', () => { sandbox.mockToken('status', madeUp); return { status: 200, body: madeUp }; });
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('200'); await dialog.accept(); });
  await page.locator('#tokenMakeupButton').click();
  await expect(page.locator('#tokenMakeupButton')).not.toBeVisible();
  await page.locator('#tokenExchangeUnits').fill('2');
  sandbox.handleToken('exchange', request => {
    expect(JSON.parse(request.postData())).toEqual({ units: 2 });
    const updated = { ...madeUp, balance: 0 };
    sandbox.mockToken('status', updated);
    sandbox.mockApi('balance', { spent: 1, credit: 1.05, balance: 0.05, exhausted: false });
    return { status: 200, body: { units: 2, tokensSpent: 2000, creditAdded: 0.05, rateUsd: 0.025, status: updated } };
  });
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('0.05'); expect(dialog.message()).toContain('2,000'); await dialog.accept(); });
  await page.locator('#tokenExchangeButton').click();
  await expect(page.locator('#tokenPanelMessage')).toContainText('US$ 0.05');
  await expect(page.locator('#tokenExchangeButton')).toBeDisabled();
  await page.locator('#tokenClose').click();
  await openMenu(page, 'apiUsageButton');
  await expect(page.locator('#systemAiBalance')).toHaveText('Used $1.0000 / Credit $1.0500');
});

test('insufficient tokens and unavailable makeup show clear fixed messages', async ({ signedInPage: page, sandbox }) => {
  await prepare(page); sandbox.mockToken('status', state);
  sandbox.allowConsoleError(/^Failed to load resource:.*(?:400|Bad Request)/);
  await page.locator('#tokenHeader').click();
  sandbox.mockToken('exchange', { error: 'insufficient_tokens' }, 400);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#tokenExchangeButton').click();
  await expect(page.locator('#tokenPanelMessage')).toHaveText('Not enough tokens. Check your latest balance and try again.');
  await expect(page.locator('#tokenMakeupButton')).toBeEnabled();
  sandbox.mockToken('makeup', { error: 'makeup_unavailable' }, 400);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#tokenMakeupButton').click();
  await expect(page.locator('#tokenPanelMessage')).toHaveText('Yesterday already has a check-in or makeup and cannot be made up again.');
});
