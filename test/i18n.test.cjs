const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadI18n, element, text } = require('./helpers/i18n.cjs');

function catalogs() {
  return Object.fromEntries([
    ['zh-TW', 'zh-Hant', '開始', '輸入回答'],
    ['en-US', 'en', 'Start', 'Enter answer'],
    ['ja-JP', 'ja', '開始する', '回答を入力'],
    ['ar', 'ar', 'ابدأ', 'أدخل الإجابة'],
  ].map(([code, htmlLang, start, answer]) => [code, {
    meta: { code, htmlLang },
    messages: { start, greeting: 'Hello {name}, {name}: {count}', ...(code === 'zh-TW' ? { fallback: '備用' } : {}) },
    placeholders: { answer },
  }]));
}

test('i18n translate interpolates repeated variables and falls back to Chinese then key', async () => {
  const { i18n, requests } = loadI18n({ catalogs: catalogs() });
  await i18n.ready;
  assert.deepEqual(requests, ['locales/zh-TW.json', 'locales/en-US.json', 'locales/ja-JP.json', 'locales/ar.json']);
  i18n.setLocale('en-US');
  assert.equal(i18n.translate('greeting', { name: 'Ada', count: 0 }), 'Hello Ada, Ada: 0');
  // KNOWN ISSUE: Replacement strings interpret $& as the matched variable instead of literal user text.
  assert.equal(i18n.translate('greeting', { name: '$&', count: 0 }), 'Hello {name}, {name}: 0');
  assert.equal(i18n.translate('greeting'), 'Hello {name}, {name}: {count}');
  assert.equal(i18n.translate('fallback'), '備用');
  assert.equal(i18n.translate('missing'), 'missing');
});

test('i18n setLocale uses catalog lang and unsupported locales fall back', async () => {
  const { i18n, document } = loadI18n({ catalogs: catalogs(), storedLocale: 'ja-JP' });
  await i18n.ready;
  assert.equal(i18n.translate('start'), '開始する');
  for (const [locale, lang] of [['zh-TW', 'zh-Hant'], ['en-US', 'en'], ['ja-JP', 'ja'], ['ar', 'ar'], ['fr', 'zh-Hant']]) {
    i18n.setLocale(locale);
    assert.equal(document.documentElement.lang, lang);
  }
  assert.equal(i18n.translate('start'), '開始');
  const unsupported = loadI18n({ catalogs: catalogs(), storedLocale: 'fr' });
  await unsupported.i18n.ready;
  assert.equal(unsupported.i18n.translate('start'), '開始');
});

test('i18n source and value lookup recognize catalog sections and legacy fallback', async () => {
  const { i18n } = loadI18n({ catalogs: catalogs() });
  await i18n.ready;
  assert.equal(i18n.fromSource('未知', 'Legacy'), '未知');
  i18n.setLocale('en-US');
  assert.equal(i18n.fromSource('開始', 'Legacy'), 'Start');
  assert.equal(i18n.fromSource('未知', 'Legacy'), 'Legacy');
  assert.equal(i18n.fromSource('未知'), '未知');
  assert.equal(i18n.keyForSource('開始'), 'start');
  assert.equal(i18n.keyForSource('Start'), undefined);
  for (const value of ['開始', 'Start', '開始する', 'ابدأ']) assert.equal(i18n.keyForValue(value), 'start');
  assert.equal(i18n.keyForValue('Enter answer', 'placeholders'), 'answer');
  assert.equal(i18n.keyForSource('輸入回答', 'placeholders'), 'answer');
  assert.equal(i18n.keyForValue('unknown'), undefined);
});

test('i18n apply translates text and attributes, preserves whitespace and reuses bindings', async () => {
  const label = text('  開始\n');
  const script = text('開始');
  const style = text('開始');
  const unknown = text('custom');
  const input = element('input', { placeholder: 'Enter answer', title: '開始', 'aria-label': '開始' });
  const body = element('body', {}, label, element('script', {}, script), element('style', {}, style), unknown, input);
  const { i18n } = loadI18n({ catalogs: catalogs(), body });
  await i18n.ready;
  i18n.setLocale('en-US');
  i18n.apply();
  assert.equal(label.nodeValue, '  Start\n');
  assert.equal(input.placeholder, 'Enter answer');
  assert.equal(input.getAttribute('title'), 'Start');
  assert.equal(input.getAttribute('aria-label'), 'Start');
  assert.equal(input.getAttribute('data-i18n-title-source'), '開始');
  assert.equal(script.nodeValue, '開始');
  assert.equal(style.nodeValue, '開始');
  assert.equal(unknown.nodeValue, 'custom');
  i18n.setLocale('ja-JP');
  i18n.apply(body);
  assert.equal(label.nodeValue, '  開始する\n');
  assert.equal(input.placeholder, '回答を入力');
  assert.equal(input.getAttribute('title'), '開始する');
  assert.equal(input.getAttribute('aria-label'), '開始する');
  label.nodeValue = '備用';
  i18n.apply();
  assert.equal(label.nodeValue, '備用');
});

test('i18n apply currently translates user text matching an interface message', async () => {
  const userText = text('開始');
  const { i18n } = loadI18n({ catalogs: catalogs(), body: element('body', {}, element('textarea', {}, userText)) });
  await i18n.ready;
  i18n.setLocale('en-US');
  i18n.apply();
  // KNOWN ISSUE: User-authored text matching a source message is translated as interface text.
  assert.equal(userText.nodeValue, 'Start');
});

for (const failedLocale of ['zh-TW', 'en-US', 'ja-JP', 'ar']) {
  test(`i18n ready rejects when ${failedLocale} fails to load`, async () => {
    const data = catalogs();
    const { i18n } = loadI18n({ fetchCatalog: async locale => locale === failedLocale
      ? { ok: false, status: 503 }
      : { ok: true, json: async () => data[locale] } });
    // KNOWN ISSUE: Any failed catalog rejects ready, including an inactive locale; no partial-success result is returned.
    await assert.rejects(i18n.ready, { message: `Unable to load locale ${failedLocale}: HTTP 503` });
  });
}

test('i18n ready rejects invalid catalog metadata and network errors', async () => {
  const invalid = loadI18n({ fetchCatalog: async () => ({ ok: true, json: async () => ({ meta: { code: 'invalid' } }) }) });
  await assert.rejects(invalid.i18n.ready, /Invalid locale catalog/);
  const offline = loadI18n({ fetchCatalog: async () => { throw new Error('offline fixture'); } });
  await assert.rejects(offline.i18n.ready, /offline fixture/);
});
