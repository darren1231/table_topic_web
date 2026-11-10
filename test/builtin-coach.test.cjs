const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { app, publicDir } = require('./helpers/frontend.cjs');
const api = () => require('../public/builtin-coach.js');

test('shuffle accepts an injected random function and leaves the source array unchanged', () => {
  const items = Object.freeze(['first', 'second', 'third']);
  let calls = 0;
  const shuffled = api().shuffle(items, () => { calls++; return 0.5; });
  assert.deepEqual(shuffled, ['first', 'second', 'third']);
  assert.notEqual(shuffled, items);
  assert.ok(calls > 0);
  assert.deepEqual(api().shuffle([], () => { throw new Error('No comparison needed'); }), []);
});

test('shuffle still defaults to Math.random at call time', t => {
  const coach = api();
  const random = t.mock.method(Math, 'random', () => 0.5);
  assert.deepEqual(coach.shuffle(['one', 'two']), ['one', 'two']);
  assert.ok(random.mock.callCount() > 0);
});

test('English grammar review retains sentence order and its existing correction rules', () => {
  const examples = [
    ['i am agree.', 'I agree.'], ['The people is kind!', 'The people are kind!'],
    ['I did not went home?', 'I did not go home?'], ["I didn't went home.", "I didn't go home."],
    ['I didn’t went home.', 'I didn’t go home.'], ['This is more better.', 'This is better.'],
  ];
  for (const [original, corrected] of examples) {
    const rows = api().basicEnglishGrammarReview(original);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].original, original);
    assert.equal(rows[0].corrected, corrected);
    assert.equal(rows[0].isCorrect, false);
    assert.equal(rows[0].example, corrected);
    assert.ok(rows[0].issue);
    assert.ok(rows[0].explanation);
    assert.ok(rows[0].rule);
  }
  assert.deepEqual(api().basicEnglishGrammarReview('i agree. The people is kind!').map(row => row.corrected), ['I agree.', 'The people are kind!']);
});

test('grammar review keeps the first detected rule and preserves acceptable, empty and mixed-language text', () => {
  const [multiple] = api().basicEnglishGrammarReview('i am agree.');
  assert.equal(multiple.rule, 'The pronoun “I” is always capitalized.');
  assert.ok(multiple.issue.includes('“Agree” is a verb'));
  const [correct] = api().basicEnglishGrammarReview('I agree.');
  assert.equal(correct.isCorrect, true);
  assert.equal(correct.original, correct.corrected);
  assert.equal(correct.issue, 'No obvious grammar error was detected by the built-in check.');
  assert.deepEqual(api().basicEnglishGrammarReview('   '), []);
  assert.equal(api().basicEnglishGrammarReview('i agree，謝謝。')[0].corrected, 'I agree，謝謝。');
});

const locales = ['zh-TW', 'en-US', 'ja-JP', 'ar'];
const questionTemplates = Object.freeze(Object.fromEntries(locales.map(locale => {
  const catalog = JSON.parse(fs.readFileSync(path.join(publicDir, `locales/${locale}.json`), 'utf8'));
  return [locale, Object.freeze(catalog.questionTemplates.map(template => topic => template.replaceAll('{topic}', topic)))];
})));
const provider = (getLanguage = () => 'en-US') => api().createLocalProvider({ questionTemplates, getLanguage, random: () => 0.5 });

test('builtin questions use the injected order, default count and topic in all four languages', async () => {
  const coach = provider();
  const expectedFirst = {
    'zh-TW': '如果要用一個親身經歷來說明「community」對你的意義，你會分享哪個故事？',
    'en-US': 'What personal story best explains what “community” means to you?',
    'ja-JP': '「community」があなたにとって何を意味するか、実体験を交えて話してください。',
    ar: 'ما القصة الشخصية التي تشرح على أفضل وجه معنى «community» بالنسبة إليك؟',
  };
  for (const locale of locales) {
    const questions = await coach.generateQuestions('community', locale);
    assert.equal(questions.length, 3);
    assert.equal(questions[0], expectedFirst[locale]);
    assert.ok(questions.every(question => question.includes('community')));
  }
});

test('builtin question counts cycle the original templates and preserve the Chinese fallback', async () => {
  const coach = provider();
  const questions = await coach.generateQuestions('community', 'en-US', 7);
  assert.equal(questions.length, 7);
  assert.equal(questions[0], questions[5]);
  assert.equal(questions[1], questions[6]);
  assert.deepEqual(await coach.generateQuestions('community', 'en-US', 0), []);
  assert.deepEqual(await coach.generateQuestions('community', 'unsupported', 2), await coach.generateQuestions('community', 'zh-TW', 2));
  assert.equal(questionTemplates['en-US'].length, 5);
});

test('builtin question generation still uses Math.random when no random dependency is supplied', async t => {
  const coach = api().createLocalProvider({ questionTemplates, getLanguage: () => 'en-US' });
  const random = t.mock.method(Math, 'random', () => 0.5);
  const questions = await coach.generateQuestions('community', 'en-US', 1);
  assert.equal(questions[0], 'What personal story best explains what “community” means to you?');
  assert.ok(random.mock.callCount() > 0);
});

test('builtin English analysis keeps its observed scores, sentence corrections and report structure', async () => {
  const text = 'I am agree because people is kind. For example, we share books. Finally, I feel happy.';
  const result = await provider().analyze(text);
  assert.deepEqual([result.overall, result.structure, result.detail, result.fluency], [72, 74, 70, 72]);
  for (const key of ['strength', 'improve', 'summary', 'rewritten']) assert.equal(typeof result[key], 'string');
  assert.equal(result.improvements.length, 3);
  assert.equal(result.scoreDetails.length, 5);
  assert.equal(result.comparisons.length, 3);
  assert.deepEqual(result.grammarCorrections, []);
  assert.equal(result.comparisons[0].before, 'I am agree because people is kind.');
  assert.equal(result.comparisons[0].after, 'I agree because people are kind.');
  assert.equal(result.comparisons[0].isGrammarCorrect, false);
  assert.ok(result.comparisons[0].grammarRule);
  assert.equal(result.improvedOverall, 92);
});

test('builtin scores stay within their existing bounds for empty, short, long and filler-heavy input', async () => {
  const coach = provider();
  const empty = await coach.analyze('');
  assert.deepEqual([empty.overall, empty.structure, empty.detail, empty.fluency], [55, 52, 48, 65]);
  for (const text of ['A short answer.', 'First, for example, a story. Finally, because details matter. '.repeat(30), 'um '.repeat(100)]) {
    for (const locale of locales) {
      const result = await provider(() => locale).analyze(text);
      for (const key of ['overall', 'structure', 'detail', 'fluency']) {
        assert.ok(Number.isInteger(result[key]) && result[key] >= 0 && result[key] <= 100);
      }
      assert.equal(result.improvements.length, 3);
      assert.equal(result.scoreDetails.length, 5);
    }
  }
  assert.equal((await coach.analyze('um '.repeat(100))).fluency, 45);
});

test('builtin feedback preserves its existing length, signpost and detail guidance', async () => {
  const english = provider();
  assert.ok((await english.analyze('A simple answer.')).improve.startsWith('Use signposts'));
  assert.ok((await english.analyze('First, I chose a clear position. Finally, I returned to my opening point.')).improve.startsWith('Add a specific person'));
  assert.ok((await english.analyze('First, for example, I shared a story. Finally, I returned to my point.')).improve.startsWith('End by returning'));
  assert.ok((await english.analyze('A personal story about community gardens. '.repeat(5))).strength.startsWith('You developed your point'));
  const chinese = provider(() => 'zh-TW');
  assert.ok((await chinese.analyze('短句')).improve.includes('路標'));
  assert.ok((await chinese.analyze('首先要說清楚。最後再次總結。')).improve.includes('具體人物'));
  assert.ok((await chinese.analyze('首先要說清楚。例如有一次經驗。最後再次總結。')).improve.startsWith('結尾再用一句話'));
  assert.ok((await chinese.analyze('字'.repeat(121))).strength.startsWith('回答有足夠篇幅'));
});

test('a provider reads the current analysis language instead of capturing its initial value', async () => {
  let language = 'en-US';
  const coach = provider(() => language);
  assert.ok((await coach.analyze('A personal story.')).summary.startsWith('Your answer'));
  language = 'zh-TW';
  assert.ok((await coach.analyze('一個親身故事。')).summary.startsWith('你的回答'));
});

test('KNOWN ISSUE F09: English and Chinese rewrites remain fixed templates for unrelated answers', async () => {
  // KNOWN ISSUE: F09 — the rewritten speech is fixed and does not reflect the submitted topic or answer.
  for (const locale of ['en-US', 'zh-TW']) {
    const coach = provider(() => locale);
    const first = await coach.analyze('Our garden helps neighbors grow vegetables.');
    const second = await coach.analyze('Learning piano helps me appreciate music.');
    assert.equal(first.rewritten, second.rewritten);
    assert.equal(first.rewritten.includes('garden'), false);
    assert.equal(second.rewritten.includes('piano'), false);
    assert.ok(first.rewritten.includes(locale === 'en-US' ? 'Any powerful technology' : '任何強大的技術'));
  }
});

test('KNOWN ISSUE: Japanese and Arabic analysis still use the Chinese feedback branch', async () => {
  // KNOWN ISSUE: analysis distinguishes only en-US; Japanese and Arabic receive the Chinese fallback.
  for (const [locale, text] of [['ja-JP', '今日は友達と話しました。'], ['ar', 'قصة قصيرة عن الأصدقاء.']]) {
    const result = await provider(() => locale).analyze(text);
    assert.ok(result.summary.startsWith('你的回答'));
    assert.equal(result.improvements[0].title, '開場先亮出立場');
    assert.equal(result.comparisons[0].label, '開場');
  }
});

test('app adapters keep current-language analysis and load the builtin module before app', async () => {
  const b = app({ signedIn: false });
  b.run("state.language = 'en-US';");
  assert.ok((await b.run('localProvider.analyze("A personal story.")')).summary.startsWith('Your answer'));
  b.run("state.language = 'zh-TW';");
  assert.ok((await b.run('localProvider.analyze("一個親身故事。")')).summary.startsWith('你的回答'));
  assert.equal(b.run('basicEnglishGrammarReview("i agree.")[0].corrected'), 'I agree.');
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.ok(html.includes('src="builtin-coach.js"'));
  assert.ok(html.indexOf('src="builtin-coach.js"') < html.indexOf('src="app.js"'));
});
