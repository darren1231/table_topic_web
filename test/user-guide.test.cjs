const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { app, publicDir } = require('./helpers/frontend.cjs');
const catalogs = Object.fromEntries(['zh-TW', 'en-US', 'ja-JP', 'ar'].map(locale =>
  [locale, JSON.parse(fs.readFileSync(path.join(publicDir, 'locales', `${locale}.json`), 'utf8')).messages]));
const guideKeys = messages => Object.keys(messages).filter(key => key.startsWith('guide.'));

test('all four guide catalogs have thirteen complete sections and six FAQ entries', () => {
  const keys = guideKeys(catalogs['zh-TW']);
  assert.ok(keys.length > 50, 'Guide content must exist');
  for (const messages of Object.values(catalogs)) {
    assert.deepEqual(guideKeys(messages), keys);
    for (const key of keys) assert.ok(typeof messages[key] === 'string' && messages[key].trim(), key);
    for (let section = 1; section <= 13; section++) assert.ok(messages[`guide.section${section}.title`]);
    assert.equal(Object.keys(messages).filter(key => /^guide\.section12\.question\d+$/.test(key)).length, 6);
    assert.equal(Object.keys(messages).filter(key => /^guide\.section12\.answer\d+$/.test(key)).length, 6);
  }
});

test('every English Japanese and Arabic guide message is translated from Chinese', () => {
  for (const locale of ['en-US', 'ja-JP', 'ar']) {
    for (const key of guideKeys(catalogs['zh-TW'])) {
      assert.notEqual(catalogs[locale][key], catalogs['zh-TW'][key], `${locale}: untranslated ${key}`);
    }
  }
});

test('guide instructions quote the corresponding labels in each locale catalog', () => {
  const references = {
    'guide.home': ['static.009'], 'guide.section2.item1': ['ui.188', 'ui.182'],
    'guide.section2.item3': ['ui.017', 'ui.155'], 'guide.section3.item1': ['ui.005', 'ui.006'],
    'guide.section3.item2': ['admin.questions'], 'guide.section4.item1': ['ui.182'],
    'guide.section4.item2': ['ui.155'], 'guide.section5.item1': ['ui.092'],
    'guide.section5.item2': ['ui.093'], 'guide.section5.item5': ['ui.091', 'ui.013'],
    'guide.section6.item1': ['ui.020', 'ui.021', 'ui.022', 'ui.023'],
    'guide.section6.item2': ['ui.024', 'ui.025'], 'guide.section6.item5': ['ui.052'],
    'guide.section7.item2': ['ui.071', 'review.reveal', 'review.again', 'review.hard', 'review.good', 'review.easy'],
    'guide.section7.item3': ['review.again'], 'guide.section7.item4': ['ui.086'],
    'guide.section8.item1': ['ui.088'], 'guide.section8.item2': ['static.013'],
    'guide.section8.item3': ['ui.028'], 'guide.section9.item3': ['ui.194'],
    'guide.section9.item4': ['settings.011'], 'guide.section10.item1': ['ui.199', 'ui.104', 'ui.105'],
    'guide.section10.item3': ['ui.108'], 'guide.section11.item1': ['ui.004'],
    'guide.section12.answer2': ['ui.091', 'ui.013'], 'guide.section12.answer5': ['version.001'],
    'guide.section13.item5': ['tokens.exchange'],
  };
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const [key, labels] of Object.entries(references)) {
      for (const label of labels) assert.ok(messages[key].includes(messages[label]), `${locale}: ${key} must include ${label}`);
    }
    assert.ok(messages['guide.section7.item1'].includes(locale === 'zh-TW' ? '加入複習' : 'Add to review'));
  }
});

function guideApp() {
  const b = app({ signedIn: false });
  b.context.URLSearchParams = URLSearchParams;
  b.context.location.search = '';
  b.window.scrollTo = () => {};
  b.context.I18n.topics = () => ['one', 'two', 'three', 'four', 'five'];
  b.context.I18n.observe = () => {};
  for (const view of ['home', 'practice', 'calendar', 'review', 'trends', 'guide']) {
    const node = b.get(`#${view}View`);
    if (node) node.id = `${view}View`;
  }
  const queryAll = b.context.document.querySelectorAll;
  b.context.document.querySelectorAll = selector => selector === '.app-view'
    ? ['home', 'practice', 'calendar', 'review', 'trends', 'guide'].map(view => b.get(`#${view}View`)).filter(Boolean)
    : queryAll(selector);
  return b;
}

test('guide navigation displays its view, renders content and preserves auth callback hashes', () => {
  const b = guideApp();
  b.run("navigateTo('guide');");
  assert.equal(b.context.location.hash, 'guide');
  assert.equal(b.get('#guideView').classList.contains('hidden'), false);
  assert.equal(b.get('#homeView').classList.contains('hidden'), true);
  assert.equal(b.get('#guideSections').children.length, 13);
  assert.equal(b.get('#guideToc').children.length, 13);
  assert.equal(b.get('#guideSections').children[11].children.at(-1).children.length, 12);
  b.context.location.hash = '#access_token=fake-callback';
  b.run("navigateTo('guide');");
  assert.equal(b.context.location.hash, '#access_token=fake-callback');
});

test('initial guide hash uses the real app initialization route', () => {
  const b = guideApp();
  b.context.location.hash = '#guide';
  b.run('init();');
  assert.equal(b.get('#guideView').classList.contains('hidden'), false);
  assert.equal(b.get('#homeView').classList.contains('hidden'), true);
});

test('guide content creates text nodes, never markup from catalog values', () => {
  const b = guideApp();
  const payload = '<img src=x onerror=alert(1)> " onmouseover="x';
  b.context.I18n.translate = key => key.startsWith('guide.') ? payload : key;
  b.run('renderGuide();');
  const nodes = [];
  const walk = node => { nodes.push(node); for (const child of node.children) walk(child); };
  for (const id of ['guideTitle', 'guideSubtitle', 'guideTocTitle', 'guideToc', 'guideSections', 'guideBackTop', 'guideBackBottom', 'guideStart', 'guideEntry', 'guideEntryTitle', 'guideEntryHint']) walk(b.get(`#${id}`));
  assert.equal(b.get('#guideEntryHint').textContent, payload);
  assert.equal(b.get('#guideEntry').getAttribute('aria-label'), payload);
  assert.ok(nodes.filter(node => node.textContent === payload).length > 50);
  for (const node of nodes) {
    assert.equal(node.htmlWrites, 0);
    assert.ok(!['IMG', 'SCRIPT', 'IFRAME'].includes(node.tagName));
    assert.ok(!Object.keys(node.attributes).some(attribute => /^on/i.test(attribute)));
  }
});
