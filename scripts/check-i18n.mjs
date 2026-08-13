import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const locales = ['zh-TW', 'en-US', 'ja-JP'];
const catalogs = await Promise.all(locales.map(async locale => {
  const catalog = JSON.parse(await readFile(new URL(`../locales/${locale}.json`, import.meta.url)));
  assert.equal(catalog.meta.code, locale, `${locale}: meta.code must match its filename`);
  assert.ok(catalog.meta.htmlLang, `${locale}: meta.htmlLang is required`);
  assert.ok(catalog.meta.label, `${locale}: meta.label is required`);
  assert.ok(Array.isArray(catalog.topics) && catalog.topics.length, `${locale}: topics cannot be empty`);
  assert.ok(Array.isArray(catalog.questionTemplates) && catalog.questionTemplates.length, `${locale}: questionTemplates cannot be empty`);
  assert.ok(catalog.questionTemplates.every(value => value.includes('{topic}')), `${locale}: every question template needs {topic}`);
  return catalog;
}));

const [fallback, english] = catalogs;
assert.deepEqual(Object.keys(english.messages), Object.keys(fallback.messages), 'English and fallback message keys differ');
assert.deepEqual(Object.keys(english.placeholders), Object.keys(fallback.placeholders), 'English and fallback placeholder keys differ');
assert.equal(new Set(Object.values(fallback.messages)).size, Object.values(fallback.messages).length, 'Fallback messages must be unique');
console.log(`Validated ${catalogs.length} locale catalogs and ${Object.keys(fallback.messages).length} UI messages.`);
