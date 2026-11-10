const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { app, publicDir } = require('./helpers/frontend.cjs');
const catalogs = Object.fromEntries(['zh-TW', 'en-US', 'ja-JP', 'ar'].map(locale =>
  [locale, JSON.parse(fs.readFileSync(path.join(publicDir, 'locales', `${locale}.json`), 'utf8')).messages]));
const guideKeys = messages => Object.keys(messages).filter(key => key.startsWith('guide.'));

test('all four guide catalogs have the same nonempty keys and twelve complete sections', () => {
  const keys = guideKeys(catalogs['zh-TW']);
  assert.ok(keys.length > 50, 'Guide content must exist');
  for (const messages of Object.values(catalogs)) {
    assert.deepEqual(guideKeys(messages), keys);
    for (const key of keys) assert.ok(typeof messages[key] === 'string' && messages[key].trim(), key);
    for (let section = 1; section <= 12; section++) assert.ok(messages[`guide.section${section}.title`]);
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
  assert.equal(b.get('#guideSections').children.length, 12);
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
  for (const id of ['guideTitle', 'guideSubtitle', 'guideTocTitle', 'guideToc', 'guideSections', 'guideBackTop', 'guideBackBottom', 'guideStart', 'guideEntry']) walk(b.get(`#${id}`));
  assert.ok(nodes.filter(node => node.textContent === payload).length > 50);
  for (const node of nodes) {
    assert.equal(node.htmlWrites, 0);
    assert.ok(!['IMG', 'SCRIPT', 'IFRAME'].includes(node.tagName));
    assert.ok(!Object.keys(node.attributes).some(attribute => /^on/i.test(attribute)));
  }
});
