const assert = require('node:assert/strict');
const { test } = require('node:test');
const data = require('../public/practice-data.js');
const fixtures = require('./fixtures/legacy-coach-results.json');
const { app, Element } = require('./helpers/frontend.cjs');
const payload = practice => ({ format: 'table-topics-practice-backup', version: 1,
  data: { practice, aiSettings: { activeId: 'builtin', projects: [{ id: 'builtin' }] }, language: 'en-US' } });

for (const fixture of fixtures) {
  test(`imports and safely renders ${fixture.name} without discarding a practice`, () => {
    const input = { history: [{ date: '2026-11-10', score: '72', answer: 'I agree.', metrics: fixture.metrics }] };
    const result = data.parseBackup(JSON.stringify(payload(input)));
    assert.ok(result);
    assert.equal(result.payload.data.practice.history[0].score, 72);
    const metrics = result.payload.data.practice.history[0].metrics;
    assert.equal(metrics.improvements[0].detail, typeof fixture.metrics.improvements[0] === 'string' ? fixture.metrics.improvements[0] : fixture.metrics.improvements[0].detail);
    const b = app({ signedIn: false }); b.context.imported = result.payload.data.practice;
    b.nodes.set('#historyCoachReport', new Element());
    assert.doesNotThrow(() => b.run('saved=imported; ensureDataSchema(); openHistoryDetail(0);'));
    assert.equal(result.payload.data.practice.history.length, 1);
    assert.equal(input.history[0].score, '72');
    assert.equal(result.payload.data.practice.history[0]._displayOriginals.score, '72');
    if (typeof fixture.metrics.improvements[0] === 'string') {
      assert.deepEqual(metrics._displayOriginals.improvements, fixture.metrics.improvements);
    }
  });
}

test('display irregularities are normalized while collection and scheduling errors remain invalid', () => {
  const result = data.parseBackup(JSON.stringify(payload({ history: [{ date: '2026-11-10', metrics: {
    improvements: [null, 'Be specific'], comparisons: [null, { before: 12, after: 'new' }], scoreDetails: [{ before: '70', after: '90' }],
  } }] })));
  assert.ok(result);
  assert.equal(result.payload.data.practice.history[0].metrics.improvements[0].detail, 'Be specific');
  assert.equal(result.payload.data.practice.history[0].metrics.scoreDetails[0].before, 70);
  for (const practice of [{ history: [null] }, { history: [], reviewCards: [{ id: 'c', before: 'a', after: 'b', dueAt: 'broken' }] }]) {
    assert.equal(data.parseBackup(JSON.stringify(payload(practice))), null);
  }
});

test('invalid backup errors identify the data category and one-based record index', () => {
  const value = payload({ history: [], reviewCards: [
    { id: 'one', before: 'a', after: 'b', language: 'en-US', dueAt: '2026-11-10T00:00:00Z' },
    { id: 'two', before: 'a', after: 'b', language: 'en-US', dueAt: '2026-11-10T00:00:00Z' }, null,
  ] });
  assert.throws(() => data.requireBackup(JSON.stringify(value)), error => {
    assert.equal(error.messageKey, 'backup.invalid.reviewCards');
    assert.equal(error.variables.index, 3);
    return true;
  });
});

test('actual app generation paths produce a backup that can be restored', async () => {
  const b = app({ signedIn: false, now: '2026-11-10T04:00:00Z' });
  b.nodes.set('#revealAnswerButton', new Element());
  // The manuscript data path still has DOM selectors for its legacy workspace.
  b.context.document.querySelector = selector => {
    if (!b.nodes.has(selector)) b.nodes.set(selector, new Element());
    return b.nodes.get(selector);
  };
  b.context.requestAnimationFrame = () => {};
  b.context.scriptButton = new Element('button');
  await b.run(`state.language='en-US'; state.topic='Gardens'; state.questions=['Why gardens?'];
    $('#transcript').value='I agree because gardens help people. Finally, they bring us together.'; analyzeAnswer();`);
  b.run(`toggleReviewCard(saved.history[0].metrics,0,{checked:true}); rateReview(saved.reviewCards[0],'good');
    state.scriptSearch=''; state.scriptStatus='active'; newScript(); currentScript().paragraphs[0].text='I am agree with this plan.';`);
  await b.run('analyzeScriptParagraph(currentScript().paragraphs[0].id,scriptButton);');
  await b.run('runFullScriptReview();');
  b.run(`recordApiUsage({id:'test',name:'Test',provider:'openai',model:'test'},
    {usage:{input_tokens:50,output_tokens:20},kind:'analysis'});`);
  const original = JSON.parse(b.run('JSON.stringify(saved)'));
  assert.equal(original.history.length, 1);
  assert.equal(original.reviewEvents.length, 1);
  assert.equal(original.scripts[0].paragraphs[0].analyses.length, 1);
  assert.equal(original.apiUsage.length, 1);
  const restored = data.parseBackup(b.run('JSON.stringify(buildBackup())'));
  assert.ok(restored);
  assert.deepEqual(restored.payload.data.practice, original);
  // Startup is a repair path, not a strict import of a foreign document.
  original.history.push({ ...original.history[0] });
  delete original.reviewCards[0].dueAt;
  const restarted = app({ signedIn: false, storageEntries: [['tableTopicsPractice.v1', JSON.stringify(original)]] });
  assert.equal(restarted.run('dataRecovery.hadRecovery()'), false);
  assert.equal(restarted.run('saved.history.length'), 2);
  assert.equal(restarted.run('saved.scripts[0].paragraphs[0].analyses.length'), 1);
});
