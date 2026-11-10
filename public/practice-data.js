(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./practice-stats.js'));
  else root.PracticeData=factory(root.PracticeStats);
})(typeof globalThis!=='undefined'?globalThis:this,function(PracticeStats){
  const { localDateKey, inferLanguage } = PracticeStats;
  function ensureDataSchema(saved){
    if(!saved||typeof saved!=='object')saved={history:[]};if(!Array.isArray(saved.history))saved.history=[];if(!Array.isArray(saved.reviewCards))saved.reviewCards=[];if(!Array.isArray(saved.reviewEvents))saved.reviewEvents=[];if(!Array.isArray(saved.scripts))saved.scripts=[];if(!Array.isArray(saved.apiUsage))saved.apiUsage=[];saved.version=5;
    saved.history.forEach((x,i)=>{x.id ||= `legacy_${x.date||'date'}_${i}`;x.language ||= inferLanguage(x);x.completedAt ||= `${x.date||localDateKey()}T12:00:00`;});
    saved.reviewCards.forEach(card=>{card.status||='active';card.tags=Array.isArray(card.tags)?card.tags:[];card.updatedAt||=card.createdAt||new Date().toISOString();if(card.grammarIssue||card.grammarExplanation||card.language!=='en-US')return;const history=saved.history.find(item=>item.id===card.sourceHistoryId);const metrics=history?.metrics||{};const candidates=[...(Array.isArray(metrics.comparisons)?metrics.comparisons:[]),...(Array.isArray(metrics.grammarCorrections)?metrics.grammarCorrections:[])];const clean=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');const match=candidates.find(item=>clean(item.before??item.original)===clean(card.before));if(!match)return;card.isGrammarCorrect=match.isGrammarCorrect??match.isCorrect;card.grammarIssue=match.grammarIssue||match.issue||'';card.grammarExplanation=match.grammarExplanation||match.explanation||'';card.grammarRule=match.grammarRule||match.rule||'';card.grammarExample=match.grammarExample||match.example||'';});
    saved.scripts.forEach(script=>{script.status||='active';script.tags=Array.isArray(script.tags)?script.tags:[];script.paragraphs=Array.isArray(script.paragraphs)?script.paragraphs:[];script.fullReviews=Array.isArray(script.fullReviews)?script.fullReviews:[];script.paragraphs.forEach(paragraph=>{paragraph.versions=Array.isArray(paragraph.versions)?paragraph.versions:[];paragraph.analyses=Array.isArray(paragraph.analyses)?paragraph.analyses:[];});});
    return saved;
  }
  function buildBackup(saved,aiSettings,language,includeApiKeys=false){
    const projects=JSON.parse(JSON.stringify(aiSettings));
    if(!includeApiKeys)projects.projects?.forEach(project=>{project.apiKey='';});
    return {format:'table-topics-practice-backup',version:1,exportedAt:new Date().toISOString(),includesApiKeys:includeApiKeys,data:{practice:JSON.parse(JSON.stringify(saved)),aiSettings:projects,language}};
  }
  function backupFilename(){return `table-topics-backup-${localDateKey()}.json`;}
  function parseBackup(text){const payload=JSON.parse(text);if(payload?.format!=='table-topics-practice-backup'||!payload.data||!Array.isArray(payload.data.practice?.history)||!Array.isArray(payload.data.aiSettings?.projects))return null;const count=payload.data.practice.history.length;const hasKeys=payload.data.aiSettings.projects.some(project=>project.apiKey);return {payload,count,hasKeys};}
  return { ensureDataSchema, buildBackup, backupFilename, parseBackup };
});
