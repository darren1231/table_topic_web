const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');

test('index.html contains no duplicate ids', () => {
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, [], `duplicate ids: ${duplicates.join(', ')}`);
});

test('core DOM contract remains present', () => {
  for (const id of ['homeView', 'practiceView', 'transcript', 'analyzeButton', 'feedbackPanel', 'historyList']) {
    assert.match(html, new RegExp(`\\bid=["']${id}["']`), `missing #${id}`);
  }
});

test('cloud.js loads before app.js', () => {
  const cloud = html.search(/<script[^>]+src=["']cloud\.js["']/);
  const app = html.search(/<script[^>]+src=["']app\.js["']/);
  assert.ok(cloud >= 0 && app >= 0, 'both application scripts must be loaded');
  assert.ok(cloud < app, 'cloud.js must load before app.js');
});

test('vercel.json is valid JSON', () => {
  assert.doesNotThrow(() => JSON.parse(read('vercel.json')));
});

test('application JavaScript parses successfully', () => {
  for (const file of ['app.js', 'cloud.js']) {
    assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), `${file} must parse`);
  }
});
