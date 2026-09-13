const base = require('@playwright/test');

const test = base.test.extend({
  page: async ({ page }, use) => {
    const runtimeErrors = [];
    page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') runtimeErrors.push(`console.error: ${message.text()}`);
    });

    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1') return route.continue();
      if (['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'].includes(url.hostname)) {
        return route.fulfill({ status: 204, body: '' });
      }
      runtimeErrors.push(`unexpected external request: ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    });
    await page.addInitScript(() => {
      if (window.name !== '__playwright_storage_initialized__') {
        localStorage.clear();
        sessionStorage.clear();
        window.name = '__playwright_storage_initialized__';
      }
      window.SpeechRecognition = undefined;
      window.webkitSpeechRecognition = undefined;
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => { throw new Error('Microphone use is forbidden in automated tests'); } }
      });
    });
    await use(page);
    base.expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
  }
});

async function openApp(page) {
  await page.goto('/');
  await base.expect(page.locator('#homeView')).toBeVisible();
}

async function enterQuestionPractice(page, topic = '勇氣') {
  await page.locator('[data-practice-flow="question"]').click();
  await base.expect(page.locator('#practiceView')).toBeVisible();
  await page.locator('#topicInput').fill(topic);
  await page.locator('#generateButton').click();
  await base.expect(page.locator('#practicePanel')).toBeVisible();
  await base.expect(page.locator('#questionText')).not.toBeEmpty();
}

async function completePractice(page, text = '我認為勇氣很重要，因為有一次我克服害怕並完成挑戰，最後也更相信自己。') {
  await page.locator('#transcript').fill(text);
  await page.locator('#analyzeButton').click();
  await base.expect(page.locator('#feedbackPanel')).toBeVisible();
  await base.expect(page.locator('#overallScore')).toHaveText(/^\d+$/);
  await base.expect(page.locator('#historyList .history-item')).toHaveCount(1);
}

async function expectOnlyView(page, id) {
  const views = page.locator('.app-view');
  await base.expect(page.locator(`#${id}`)).toBeVisible();
  await base.expect(page.locator('.app-view:not(.hidden)')).toHaveCount(1);
  await base.expect(page.locator(`#${id}`)).toHaveClass(/active-view/);
}

module.exports = { test, expect: base.expect, openApp, enterQuestionPractice, completePractice, expectOnlyView };
