const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { app, publicDir } = require('./helpers/frontend.cjs');
const api = () => require('../public/html-utils.js');

test('HTML escaping covers text and both attribute quote delimiters without losing ordinary text', () => {
  assert.equal(api().escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(api().escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(api().escapeHtml('" onmouseover="x'), '&quot; onmouseover=&quot;x');
  for (const value of [null, undefined]) assert.equal(api().escapeHtml(value), '');
  assert.equal(api().escapeHtml(85), '85');
  assert.equal(api().escapeHtml('一般文字 English العربية'), '一般文字 English العربية');
});

test('safe URLs allow only absolute HTTP and HTTPS URLs', () => {
  for (const value of ['https://example.invalid/path?q=1&x=2', 'http://example.invalid/']) assert.equal(api().safeUrl(value), value);
  for (const value of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<img src=x onerror=alert(1)>',
    'vbscript:msgbox(1)', 'file:///tmp/file', '//example.invalid/', '/relative', '', null, undefined]) {
    assert.equal(api().safeUrl(value), '');
  }
});

test('HTML utility is available before other scripts on both pages and app delegates escaping', () => {
  for (const file of ['index.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(publicDir, file), 'utf8');
    assert.ok(html.includes('src="html-utils.js"'));
    assert.equal(html.match(/<script\b[^>]*src="([^"]+)"/)[1], 'html-utils.js');
  }
  const b = app({ signedIn: false });
  assert.equal(b.run('escapeHtml(`" onmouseover="x`)'), '&quot; onmouseover=&quot;x');
});
