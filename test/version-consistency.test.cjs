const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { app } = require('./helpers/frontend.cjs');

const root = path.join(__dirname, '..');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const release = changelog.match(/^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})\r?$/m);
const browser = app({ signedIn: false });
const history = JSON.parse(browser.run('JSON.stringify(VERSION_HISTORY)'));

test('package, website and latest dated changelog release have the same version', () => {
  assert.ok(release, 'CHANGELOG must contain a dated release heading');
  assert.ok(history.length > 0, 'Website must contain a version history');
  assert.equal(packageVersion, release[1], 'package.json version must match CHANGELOG');
  assert.equal(history[0].version, release[1], 'Latest website version must match CHANGELOG');
});

test('latest website release date matches the latest dated changelog heading', () => {
  assert.ok(release, 'CHANGELOG must contain a dated release heading');
  assert.equal(history[0].date, release[2]);
});

test('website versions are strictly ordered from newest to oldest numerically', () => {
  const versions = history.map(entry => {
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    return entry.version.split('.').map(Number);
  });
  for (let i = 1; i < versions.length; i++) {
    const newer = versions[i - 1], older = versions[i];
    const component = newer.findIndex((value, index) => value !== older[index]);
    assert.ok(component !== -1 && newer[component] > older[component],
      `${history[i - 1].version} must be newer than ${history[i].version}`);
  }
});
