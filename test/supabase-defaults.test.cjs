const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');

test('server Supabase defaults match the public configuration by text, without executing it', async () => {
  const source = await readFile(path.join(__dirname, '../public/supabase-config.js'), 'utf8');
  const url = source.match(/\burl\s*:\s*'([^']+)'/);
  const anonKey = source.match(/\banonKey\s*:\s*'([^']+)'/);
  assert.ok(url && anonKey, 'Public configuration must contain literal values');
  assert.deepEqual(require('../api/_lib/supabase-defaults.js'), { url: url[1], anonKey: anonKey[1] });
});
