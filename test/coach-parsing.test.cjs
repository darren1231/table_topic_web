const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { app, publicDir } = require('./helpers/frontend.cjs');
const api = () => require('../public/coach-parsing.js');

test('JSON extraction preserves objects, arrays, code fences and leading explanation', () => {
  for (const text of ['{"overall":85}', '```json\n{"overall":85}\n```', '```JSON\n{"overall":85}\n```',
    'Here is the result:\n{"overall":85}']) {
    assert.deepEqual(api().extractJson(text), { overall: 85 });
  }
  assert.deepEqual(api().extractJson('Questions:\n```json\n["First?","Second?"]\n```'), ['First?', 'Second?']);
});

test('incomplete JSON keeps its syntax error and a non-JSON response keeps its original error message', () => {
  assert.throws(() => api().extractJson('{"overall":85'), SyntaxError);
  assert.throws(() => api().extractJson('["First?",'), SyntaxError);
  assert.throws(() => api().extractJson('No structured answer was supplied.'), { message: 'Agent 未回傳 JSON' });
});

test('KNOWN ISSUE: valid JSON followed by explanation is rejected instead of extracting only the JSON', () => {
  // KNOWN ISSUE: extractJson strips a prefix but passes all trailing prose to JSON.parse.
  assert.throws(() => api().extractJson('Result:\n{"overall":85}\nThat is my assessment.'), SyntaxError);
});

test('usage normalization accepts provider aliases, numeric strings and missing fields', () => {
  for (const usage of [{ input_tokens: 120, output_tokens: 30 }, { prompt_tokens: '120', completion_tokens: '30' },
    { inputTokens: 120, outputTokens: 30 }]) {
    assert.deepEqual(api().normalizeApiUsage(usage), { inputTokens: 120, outputTokens: 30 });
  }
  assert.deepEqual(api().normalizeApiUsage(), { inputTokens: 0, outputTokens: 0 });
  assert.deepEqual(api().normalizeApiUsage({ input_tokens: 'invalid' }), { inputTokens: 0, outputTokens: 0 });
});

test('usage alias precedence preserves explicit zero and falls through only nullish fields', () => {
  assert.deepEqual(api().normalizeApiUsage({ input_tokens: 0, prompt_tokens: 20, inputTokens: 40,
    output_tokens: null, completion_tokens: 30, outputTokens: 50 }), { inputTokens: 0, outputTokens: 30 });
  assert.deepEqual(api().normalizeApiUsage({ input_tokens: null, prompt_tokens: undefined, inputTokens: 40 }),
    { inputTokens: 40, outputTokens: 0 });
});

test('KNOWN ISSUE: usage normalization accepts negative, fractional and infinite token counts', () => {
  // KNOWN ISSUE: the legacy frontend coerces token counts without validating their range or finiteness.
  assert.deepEqual(api().normalizeApiUsage({ input_tokens: -4, output_tokens: 0.5 }), { inputTokens: -4, outputTokens: 0.5 });
  assert.equal(api().normalizeApiUsage({ input_tokens: 'Infinity' }).inputTokens, Infinity);
});

test('score parsing rounds numbers, clamps supported scores and accepts integer score strings', () => {
  const stats = api();
  for (const [value, expected] of [[84.4, 84], [84.5, 85], [-10, 0], [120, 100],
    ['85', 85], [' 85/100 ', 85], ['85 %', 85], ['105', 100], ['001', 1], [0, 0]]) {
    assert.equal(stats.parseScore(value), expected);
  }
});

test('unsupported score strings and missing or nonfinite values preserve the supplied fallback', () => {
  for (const value of [undefined, null, '', 'not a score', '85.5', '-1', '1000', NaN, Infinity]) {
    assert.equal(api().parseScore(value, 71), 71);
  }
  assert.equal(api().parseScore(undefined), 0);
});

test('category base scores keep the current Chinese keyword mapping', () => {
  const result = { overall: 71, structure: 62, detail: 68, fluency: 75 };
  for (const name of ['結構', '邏輯', '總結', '立場']) assert.equal(api().baseScoreForCategory(name, result), 62);
  for (const name of ['內容', '相關', '具體', '準確']) assert.equal(api().baseScoreForCategory(name, result), 68);
  for (const name of ['語言', '流暢', '感染', '表達']) assert.equal(api().baseScoreForCategory(name, result), 75);
  assert.equal(api().baseScoreForCategory('other', result), 71);
  assert.equal(api().baseScoreForCategory(undefined, result), 71);
});

test('KNOWN ISSUE: English category names fall back to overall rather than their category scores', () => {
  // KNOWN ISSUE: category matching only recognizes Chinese keywords.
  const result = { overall: 71, structure: 62, detail: 68, fluency: 75 };
  for (const name of ['Structure', 'Detail', 'Fluency', 'Grammar accuracy']) {
    assert.equal(api().baseScoreForCategory(name, result), 71);
  }
});

test('coach normalization mutates the supplied result and fills the existing defaults', () => {
  const result = { strength: 'Clear position', _historyId: 'practice-placeholder', _rawResponse: 'raw-placeholder' };
  assert.equal(api().normalizeCoachResult(result, 'Original answer'), result);
  assert.deepEqual(result, {
    strength: 'Clear position', _historyId: 'practice-placeholder', _rawResponse: 'raw-placeholder',
    overall: 70, structure: 70, detail: 70, fluency: 70, summary: 'Clear position',
    improvements: [], comparisons: [], rewritten: 'Original answer', grammarCorrections: [], scoreDetails: [], improvedOverall: 90,
  });
});

test('coach normalization preserves score aliases, rewrite precedence and explicit improved overall scores', () => {
  const result = api().normalizeCoachResult({ overallScore: '85/100', structureScore: '72%', accuracy: '68', fluencyScore: 80.7,
    summary: 'Existing summary', improvements: 'invalid', rewrittenSpeech: 'Alias rewrite', afterOverall: '93' });
  assert.deepEqual([result.overall, result.structure, result.detail, result.fluency, result.improvedOverall], [85, 72, 68, 81, 93]);
  assert.equal(result.summary, 'Existing summary');
  assert.equal(result.rewritten, 'Alias rewrite');
  assert.deepEqual(result.improvements, []);
  assert.equal(api().normalizeCoachResult({ total_score: '60', improved_answer: 'Other alias', improved_overall: 0 }).improvedOverall, 0);
  assert.equal(api().normalizeCoachResult({ improved_answer: 'Other alias' }).rewritten, 'Other alias');
  assert.equal(api().normalizeCoachResult({ rewritten: 'Original rewrite', rewrittenSpeech: 'Ignored alias' }).rewritten, 'Original rewrite');
});

test('numeric comparisons become score rows while text comparisons stay separate through CoachResultUtils', () => {
  const result = api().normalizeCoachResult({ comparisons: [
    { label: '結構', before: '72/100', after: '91%' },
    { label: 'Phrase', original: 'Original phrase', improved: 'Improved phrase' }, null, { before: 'Incomplete' },
  ] });
  assert.deepEqual(result.scoreDetails, [{ name: '結構', before: 72, after: 91, beforeNote: '', afterNote: '' }]);
  assert.deepEqual(result.comparisons, [{ label: 'Phrase', original: 'Original phrase', improved: 'Improved phrase',
    before: 'Original phrase', after: 'Improved phrase' }]);
  assert.equal(result.improvedOverall, 91);
});

test('supplied score aliases override recovered numeric comparisons and determine improved average', () => {
  const result = api().normalizeCoachResult({ comparisons: [{ label: 'Ignored score', before: 1, after: 2 }], scores: [
    { category: '結構', originalScore: '60', improvedScore: '90' },
    { item: '內容', score: '62', after_score: '88' },
    { name: '語言', original: '64', improved: '92' },
  ] });
  assert.deepEqual(result.scoreDetails.map(row => [row.name, row.before, row.after]), [['結構', 60, 90], ['內容', 62, 88], ['語言', 64, 92]]);
  assert.equal(result.improvedOverall, 90);
});

test('missing numeric score fields use category defaults and preserve descriptive notes', () => {
  const result = api().normalizeCoachResult({ overall: 61, structure: 62, detail: 68, fluency: 75, scoreDetails: [
    { name: '結構', before: 'Needs a clearer opening', after: 'Clear opening' },
    { category: '內容', before_score: 68 }, { item: '語言', score: 75 }, {},
  ] });
  assert.deepEqual(result.scoreDetails, [
    { name: '結構', before: 62, after: 82, beforeNote: 'Needs a clearer opening', afterNote: 'Clear opening' },
    { name: '內容', before: 68, after: 86, beforeNote: '', afterNote: '' },
    { name: '語言', before: 75, after: 93, beforeNote: '', afterNote: '' },
    { name: '評分項目 4', before: 61, after: 82, beforeNote: '', afterNote: '' },
  ]);
  assert.equal(result.improvedOverall, 86);
});

test('grammar aliases become canonical corrections and merge into matching sentence comparisons', () => {
  for (const key of ['grammarCorrections', 'grammar_corrections', 'sentenceCorrections']) {
    const result = api().normalizeCoachResult({ comparisons: [{ label: 'Opening', before: 'I agree!', after: 'I fully agree.' }],
      [key]: [{ before: 'i agree.', after: 'I agree.', is_correct: false, error: 'Capitalization', reason: 'Capitalize I', rule: 'Use I', example: 'I agree.' },
        { original: '' }],
    });
    assert.deepEqual(result.grammarCorrections, [{ original: 'i agree.', corrected: 'I agree.', isCorrect: false,
      issue: 'Capitalization', explanation: 'Capitalize I', rule: 'Use I', example: 'I agree.', index: 0 }]);
    assert.deepEqual(result.comparisons, [{ label: 'Opening', before: 'i agree.', after: 'I fully agree.', isGrammarCorrect: false,
      grammarIssue: 'Capitalization', grammarExplanation: 'Capitalize I', grammarRule: 'Use I', grammarExample: 'I agree.' }]);
  }
});

test('existing comparison grammar metadata keeps its current precedence over separate grammar corrections', () => {
  const comparison = { before: 'Original', after: 'Existing improvement', grammarIssue: 'Existing note' };
  const result = api().normalizeCoachResult({ comparisons: [comparison], grammarCorrections: [{ original: 'Original', corrected: 'Other improvement', isCorrect: true }] });
  assert.deepEqual(result.comparisons, [comparison]);
  assert.equal(result.grammarCorrections[0].isCorrect, true);
});

test('app adapters expose the same parsing behavior and load the UMD dependency before app', () => {
  const b = app({ signedIn: false });
  b.context.rawCoach = 'Response: ```json\n{"overall":"85/100","structure":60}\n```';
  const result = JSON.parse(b.run('JSON.stringify(normalizeCoachResult(extractJson(rawCoach), "Answer"))'));
  assert.equal(result.overall, 85);
  assert.equal(result.structure, 60);
  assert.equal(result.rewritten, 'Answer');
  assert.equal(b.run('parseScore("90%")'), 90);
  assert.equal(b.run('baseScoreForCategory("結構", {structure:62})'), 62);
  assert.deepEqual(JSON.parse(b.run('JSON.stringify(normalizeApiUsage({prompt_tokens:20,completion_tokens:5}))')), { inputTokens: 20, outputTokens: 5 });
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.ok(html.includes('src="coach-parsing.js"'));
  assert.ok(html.indexOf('src="coach-result-utils.js"') < html.indexOf('src="coach-parsing.js"'));
  assert.ok(html.indexOf('src="coach-parsing.js"') < html.indexOf('src="app.js"'));
});
