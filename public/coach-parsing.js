(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./coach-result-utils.js'));
  else root.CoachParsing=factory(root.CoachResultUtils);
})(typeof globalThis!=='undefined'?globalThis:this,function(CoachResultUtils){
  function extractJson(text) { const clean = String(text).replace(/```json|```/gi,'').trim(); const start = Math.min(...['{','['].map(c => { const i=clean.indexOf(c); return i<0?Infinity:i; })); if (!Number.isFinite(start)) throw new Error('Agent 未回傳 JSON'); return JSON.parse(clean.slice(start)); }
  function normalizeApiUsage(usage={}){return{inputTokens:Number(usage.input_tokens??usage.prompt_tokens??usage.inputTokens??0)||0,outputTokens:Number(usage.output_tokens??usage.completion_tokens??usage.outputTokens??0)||0};}
  function parseScore(value, fallback=0) { if(typeof value==='number'&&Number.isFinite(value)) return Math.max(0,Math.min(100,Math.round(value))); const text=String(value??'').trim(); const match=text.match(/^(\d{1,3})(?:\s*(?:\/\s*100|%))?$/); return match?Math.max(0,Math.min(100,Number(match[1]))):fallback; }
  function baseScoreForCategory(name,r) { const n=String(name||''); if(/結構|邏輯|總結|立場/.test(n))return r.structure; if(/內容|相關|具體|準確/.test(n))return r.detail; if(/語言|流暢|感染|表達/.test(n))return r.fluency; return r.overall; }
  function normalizeCoachResult(r,text='') {
    r.overall=parseScore(r.overall??r.overallScore??r.total_score,70); r.structure=parseScore(r.structure??r.structureScore,70); r.detail=parseScore(r.detail??r.detailScore??r.accuracy,70); r.fluency=parseScore(r.fluency??r.fluencyScore,70);
    const comparisonParts=CoachResultUtils.partitionComparisons(r.comparisons);
    r.summary ||= r.strength; r.improvements = Array.isArray(r.improvements)?r.improvements:[]; r.comparisons=comparisonParts.text; r.rewritten ||= r.rewrittenSpeech||r.improved_answer||text;
    const rawGrammar=Array.isArray(r.grammarCorrections)?r.grammarCorrections:(Array.isArray(r.grammar_corrections)?r.grammar_corrections:(Array.isArray(r.sentenceCorrections)?r.sentenceCorrections:[]));
    r.grammarCorrections=rawGrammar.map((item,index)=>({original:String(item.original??item.before??''),corrected:String(item.corrected??item.after??item.original??''),isCorrect:item.isCorrect===true||item.is_correct===true,issue:String(item.issue??item.error??''),explanation:String(item.explanation??item.reason??''),rule:String(item.rule??''),example:String(item.example??''),index})).filter(item=>item.original);
    if(r.grammarCorrections.length&&!r.comparisons.some(item=>item.grammarExplanation||item.grammarIssue)){const normalized=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');r.comparisons=r.grammarCorrections.map((grammar,index)=>{const match=r.comparisons.find(item=>normalized(item.before)===normalized(grammar.original));return {label:match?.label||`Sentence ${index+1}`,before:grammar.original,after:match?.after||grammar.corrected,isGrammarCorrect:grammar.isCorrect,grammarIssue:grammar.issue,grammarExplanation:grammar.explanation,grammarRule:grammar.rule,grammarExample:grammar.example};});}
    const suppliedScores=Array.isArray(r.scoreDetails)?r.scoreDetails:(Array.isArray(r.scores)?r.scores:[]);
    const recoveredScores=suppliedScores.length?[]:comparisonParts.scoreOnly.map(x=>({name:x.label??x.name,before:x.before,after:x.after,beforeNote:x.beforeNote,afterNote:x.afterNote}));
    const rawScores=[...suppliedScores,...recoveredScores];
    r.scoreDetails=rawScores.map((x,i)=>{const name=x.name||x.category||x.item||`評分項目 ${i+1}`;const base=baseScoreForCategory(name,r);const rawBefore=x.before??x.original??x.originalScore??x.score??x.before_score;const rawAfter=x.after??x.improved??x.improvedScore??x.after_score;const before=parseScore(rawBefore,base);const after=parseScore(rawAfter,Math.min(96,Math.max(before+18,82)));return{name,before,after,beforeNote:x.beforeNote||(typeof rawBefore==='string'&&!/^\s*\d/.test(rawBefore)?rawBefore:''),afterNote:x.afterNote||(typeof rawAfter==='string'&&!/^\s*\d/.test(rawAfter)?rawAfter:'')}});
    const averageAfter=r.scoreDetails.length?Math.round(r.scoreDetails.reduce((sum,x)=>sum+x.after,0)/r.scoreDetails.length):Math.min(96,r.overall+20);
    r.improvedOverall=parseScore(r.improvedOverall??r.improved_overall??r.afterOverall,averageAfter); return r;
  }
  return { extractJson, normalizeApiUsage, parseScore, baseScoreForCategory, normalizeCoachResult };
});
