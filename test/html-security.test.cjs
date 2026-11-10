const assert = require('node:assert/strict');
const { test } = require('node:test');
const { app, Element } = require('./helpers/frontend.cjs');
const parser = import('parse5');
const attack = '<img src=x onerror=alert(1)> " onmouseover="x';
const date = '2026-11-10T04:00:00.000Z';

async function safeHtml(html) {
  const { parseFragment } = await parser;
  const root = parseFragment(html);
  function walk(node) {
    assert.ok(!['img', 'script', 'iframe', 'object', 'embed', 'style', 'base', 'link', 'meta'].includes(node.tagName), `Unsafe tag ${node.tagName}`);
    for (const attribute of node.attrs || []) {
      assert.ok(!/^on/i.test(attribute.name), `Executable attribute ${attribute.name}`);
      if (['href', 'src', 'xlink:href', 'action', 'formaction'].includes(attribute.name)) {
        assert.ok(attribute.value === '' || /^(?:https?:|#)/i.test(attribute.value), `Unsafe URL ${attribute.value}`);
      }
      if (attribute.name.startsWith('data-')) assert.match(attribute.value, /^[\p{L}\p{N}_.:\- ]*$/u);
      if (attribute.name === 'class') assert.ok(!attribute.value.includes('malicious-class'));
    }
    for (const child of node.childNodes || []) walk(child);
    if (node.content) walk(node.content);
  }
  walk(root);
  return root;
}

function fixture(enableByok = false, storageEntries) {
  const b = app({ signedIn: false, now: date, enableByok, storageEntries });
  b.nodes.set('#historyCoachReport', new Element());
  b.nodes.set('#revealAnswerButton', new Element());
  for (const id of ['scriptProjectList', 'scriptParagraphList', 'fullScriptReviewResult']) b.nodes.set(`#${id}`, new Element());
  b.context.payload = attack;
  return b;
}

test('history, detail and day views encode stored fields and format only finite scores', async () => {
  const b = fixture();
  b.run('saved.history=[{id:payload,topic:payload,question:payload,answer:payload,date:payload,score:payload,metrics:{structure:payload,detail:"Infinity",fluency:payload,_rawResponse:payload}}]; renderHistory(); openHistoryDetail(0);');
  await safeHtml(b.get('#historyList').innerHTML);
  await safeHtml(b.get('#historyDetailContent').innerHTML);
  await safeHtml(b.get('#historyCoachReport').innerHTML);
  b.run(`saved.history[0].date='2026-11-10'; openDayDetail('2026-11-10',document.createElement('button'));`);
  await safeHtml(b.get('#dayDetailContent').innerHTML);
  assert.ok(!b.get('#historyDetailContent').innerHTML.includes('Infinity'));
});

test('AI report notes remain quoted text and malformed numeric output cannot create markup', async () => {
  const b = fixture();
  b.run('renderCoachReport({summary:payload,rewritten:payload,overall:payload,improvements:[{title:payload,detail:payload}],comparisons:[{before:payload,after:payload}],scoreDetails:[{name:payload,before:72,after:90,beforeNote:payload,afterNote:payload}]});');
  await safeHtml(b.get('#coachReport').innerHTML);
  assert.ok(b.get('#coachReport').innerHTML.includes('&quot; onmouseover=&quot;x'));
});

test('review cards whitelist status classes and identifiers and normalize schedule numbers', async () => {
  const b = fixture();
  b.run('saved.reviewCards=[{id:payload,status:payload,language:"en-US",label:payload,topic:payload,question:payload,before:payload,after:payload,tags:[payload],intervalDays:payload,repetitions:"Infinity",lapses:payload,grammarIssue:payload,grammarExplanation:payload,grammarRule:payload,grammarExample:payload,sourceType:"script",sourceScriptId:payload}]; state.libraryStatus="all"; renderReviewLibrary();');
  await safeHtml(b.get('#reviewLibrary').innerHTML);
  assert.ok(!/\b(?:Infinity|NaN)\b/.test(b.get('#reviewLibrary').innerHTML));
  b.run('saved.reviewCards[0].status="active malicious-class"; renderReviewLibrary();');
  await safeHtml(b.get('#reviewLibrary').innerHTML);
});

test('legacy API usage and project renderers cannot inject error attributes, status classes or IDs', async () => {
  const b = fixture(true);
  b.run(`saved.apiUsage=[{createdAt:'${date}',projectName:payload,model:payload,provider:payload,status:payload,error:payload,inputTokens:'Infinity',outputTokens:payload,inputRate:'Infinity',outputRate:payload,estimatedCost:'Infinity',priced:true}];`);
  b.get('#apiUsagePeriod').value = 'all'; b.get('#apiUsageKind').value = 'all';
  b.run('renderApiUsageDashboard();');
  await safeHtml(b.get('#apiUsageList').innerHTML);
  assert.ok(!/\b(?:Infinity|NaN)\b/.test(b.get('#apiUsageList').innerHTML));
  b.run('saved.apiUsage[0].status="success malicious-class"; renderApiUsageDashboard();');
  await safeHtml(b.get('#apiUsageList').innerHTML);
  b.run('aiSettings={activeId:payload,projects:[{id:payload,name:payload,provider:"builtin"}]}; renderProjectSettings();');
  await safeHtml(b.get('#projectSelect').innerHTML);
});

test('pricing URLs are restricted to HTTP(S) and pricing text is encoded', async () => {
  const b = fixture();
  b.run('MODEL_PRICING["test-model"]={provider:payload,note:payload,url:"javascript:alert(1)",input:0.2,output:1.2};');
  b.get('#modelSelect').value = 'test-model';
  b.run('applySelectedModelPricing();');
  await safeHtml(b.get('#modelPricingHint').innerHTML);
  b.context.testUrl = 'https://example.invalid/?q=" onmouseover="x';
  b.run('MODEL_PRICING["test-model"].url=testUrl; applySelectedModelPricing();');
  await safeHtml(b.get('#modelPricingHint').innerHTML);
});

test('trend SVGs encode dates and accept only finite numbers and allowlisted series classes', async () => {
  const b = fixture();
  b.run('saved.history=[{date:payload,score:"Infinity",metrics:{structure:payload,detail:"Infinity",fluency:payload}}]; state.trendPeriod="all"; renderScoreTrends();');
  for (const id of ['scoreTrendChart', 'metricTrendChart', 'trendSummary']) {
    await safeHtml(b.get(`#${id}`).innerHTML);
    assert.ok(!/\b(?:Infinity|NaN)\b/.test(b.get(`#${id}`).innerHTML));
  }
  await safeHtml(b.run('trendSvg(saved.history,[{label:payload,className:"series-overall malicious-class",value:()=>payload}])'));
});

test('script paragraphs, versions, analyses and full reviews encode all content and identifiers', async () => {
  const b = fixture();
  b.run(`saved.scripts=[{id:payload,status:'active',title:payload,topic:payload,updatedAt:'${date}',paragraphs:[{id:payload,text:payload,versions:[{id:payload,text:payload},{id:payload,text:payload}],analyses:[{id:payload,overview:payload,suggestions:[{label:payload,style:payload,text:payload,rationale:payload}],comparisons:[{before:payload,after:payload,grammarIssue:payload}],_rawResponse:payload}]}]}]; state.currentScriptId=payload;state.scriptSearch='';state.scriptStatus='active';renderScriptProjects();renderScriptParagraphs();renderFullScriptReview({summary:payload,transitions:payload,recommendations:[payload]});`);
  for (const id of ['scriptProjectList', 'scriptParagraphList', 'fullScriptReviewResult']) await safeHtml(b.get(`#${id}`).innerHTML);
});

test('malicious backup data remains inert after import and a fresh app reload', async () => {
  const b = fixture();
  const backup = { format: 'table-topics-practice-backup', data: { language: 'en-US',
    practice: { history: [{ id: attack, date: '2026-11-10', topic: attack, question: attack, answer: attack, score: attack }],
      reviewCards: [{ id: attack, status: attack, before: attack, after: attack, intervalDays: attack }] },
    aiSettings: { activeId: 'builtin', projects: [{ id: 'builtin', provider: 'builtin', name: attack }] } } };
  b.context.backupFile = { text: async () => JSON.stringify(backup) };
  b.context.confirm = () => true;
  b.window.tableTopicsCloud.replaceData = async () => true;
  await b.run('importBackupFile(backupFile)');
  const reloaded = fixture(false, b.storage);
  reloaded.run('renderHistory();state.libraryStatus="all";renderReviewLibrary();');
  await safeHtml(reloaded.get('#historyList').innerHTML);
  await safeHtml(reloaded.get('#reviewLibrary').innerHTML);
});

test('normal history markup, card identifiers, note text and HTTP pricing links retain their display', async () => {
  const b = fixture();
  b.run('saved.history=[{id:"practice_1",topic:"Gardens",question:"Why?",date:"2026-11-10",score:85}];renderHistory();');
  assert.equal(b.get('#historyList').innerHTML, '<article class="history-item" data-history-index="0" tabindex="0" role="button"><div class="history-score">85</div><div><h4>Gardens</h4><p>Why?</p></div><time>2026-11-10</time></article>');
  const html = b.run('renderLibraryCard({id:"practice_1:0",status:"archived",before:"I agree.",after:"I fully agree.",intervalDays:3,repetitions:2,lapses:0})');
  await safeHtml(html);
  assert.ok(html.includes('data-library-edit="practice_1:0"'));
  assert.ok(html.includes('library-status status-archived'));
  b.context.note = 'Speaker\'s "opening"';
  b.run('renderCoachReport({scoreDetails:[{before:70,after:90,beforeNote:note}]});');
  const root = await safeHtml(b.get('#coachReport').innerHTML);
  const titles = [];
  (function walk(node) { for (const attr of node.attrs || []) if (attr.name === 'title') titles.push(attr.value); for (const child of node.childNodes || []) walk(child); })(root);
  assert.ok(titles.includes('Speaker\'s "opening"'));
  b.run('MODEL_PRICING["normal-model"]={provider:"Example",url:"https://example.invalid/pricing?q=1&x=2",input:0.2,output:1.2};');
  b.get('#modelSelect').value = 'normal-model'; b.run('applySelectedModelPricing();');
  await safeHtml(b.get('#modelPricingHint').innerHTML);
  assert.ok(b.get('#modelPricingHint').innerHTML.includes('href="https://example.invalid/pricing?q=1&amp;x=2"'));
});

test('system usage continues to create literal text nodes and renders only finite amounts', () => {
  const b = fixture();
  b.get('#apiUsagePeriod').value = 'all';
  b.run(`saved.apiUsage=[{createdAt:'${date}',projectName:payload,model:payload,provider:'system',kind:'transcription',inputTokens:'Infinity',outputTokens:payload,estimatedCost:'Infinity',status:'error'}];renderApiUsageDashboard();`);
  const row = b.get('#apiUsageList').children[0];
  assert.equal(row.htmlWrites, 0);
  assert.equal(row.children[1].textContent, attack);
  assert.equal(row.children[4].textContent, 'US$0.000000');
});
