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
for (const catalog of catalogs.slice(1)) {
  assert.deepEqual(Object.keys(catalog.messages), Object.keys(fallback.messages), `${catalog.meta.code} and fallback message keys differ`);
  assert.deepEqual(Object.keys(catalog.placeholders), Object.keys(fallback.placeholders), `${catalog.meta.code} and fallback placeholder keys differ`);
}
console.log(`Validated ${catalogs.length} locale catalogs and ${Object.keys(fallback.messages).length} UI messages.`);

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const catalogued = new Set([...Object.values(fallback.messages), ...Object.values(fallback.placeholders)]);
const textValues = [...html.matchAll(/>([^<>]+)</g)].map(match => match[1].trim()).filter(Boolean);
const attributeValues = [...html.matchAll(/(?:title|aria-label|placeholder)="([^"]+)"/g)].map(match => match[1].trim());
const missing = [...new Set([...textValues, ...attributeValues])]
  .filter(value => /[\u3400-\u9fff]/u.test(value) && !catalogued.has(value));
assert.deepEqual(missing, [], `index.html contains uncatalogued UI text: ${missing.join(' | ')}`);
