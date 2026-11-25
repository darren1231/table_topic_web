(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./practice-stats.js'));
  else root.PracticeData=factory(root.PracticeStats);
})(typeof globalThis!=='undefined'?globalThis:this,function(PracticeStats){
  const { localDateKey, inferLanguage } = PracticeStats;
  // Legacy startup API intentionally normalizes its owned data in place.
  // Imported data is validated before this function can touch it.
  function ensureDataSchema(saved) {
    if (!isRecord(saved)) saved = { history: [] };
    for (const key of ['history', 'reviewCards', 'reviewEvents', 'scripts', 'apiUsage']) {
      if (!Array.isArray(saved[key])) saved[key] = [];
    }
    saved.version = 5;
    saved.history.forEach((entry, index) => {
      entry.id ||= `legacy_${entry.date || 'date'}_${index}`;
      entry.date ||= localDateKey();
      entry.language ||= inferLanguage(entry);
      entry.completedAt ||= `${entry.date}T12:00:00`;
    });
    saved.reviewCards.forEach(card => {
      card.status ||= 'active';
      card.tags = Array.isArray(card.tags) ? card.tags : [];
      card.updatedAt ||= card.createdAt || new Date().toISOString();
      if (card.sourceType === 'translation' || card.grammarIssue || card.grammarExplanation || card.language !== 'en-US') return;
      const history = saved.history.find(item => item.id === card.sourceHistoryId);
      const metrics = history?.metrics || {};
      const candidates = [...(Array.isArray(metrics.comparisons) ? metrics.comparisons : []),
        ...(Array.isArray(metrics.grammarCorrections) ? metrics.grammarCorrections : [])];
      const clean = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const match = candidates.find(item => clean(item.before ?? item.original) === clean(card.before));
      if (!match) return;
      card.isGrammarCorrect = match.isGrammarCorrect ?? match.isCorrect;
      card.grammarIssue = match.grammarIssue || match.issue || '';
      card.grammarExplanation = match.grammarExplanation || match.explanation || '';
      card.grammarRule = match.grammarRule || match.rule || '';
      card.grammarExample = match.grammarExample || match.example || '';
    });
    saved.scripts.forEach(script => {
      script.status ||= 'active';
      script.tags = Array.isArray(script.tags) ? script.tags : [];
      script.paragraphs = Array.isArray(script.paragraphs) ? script.paragraphs : [];
      script.fullReviews = Array.isArray(script.fullReviews) ? script.fullReviews : [];
      script.paragraphs.forEach(paragraph => {
        paragraph.versions = Array.isArray(paragraph.versions) ? paragraph.versions : [];
        paragraph.analyses = Array.isArray(paragraph.analyses) ? paragraph.analyses : [];
      });
    });
    return saved;
  }
  function buildBackup(saved,aiSettings,language,includeApiKeys=false){
    const projects=JSON.parse(JSON.stringify(aiSettings));
    if(!includeApiKeys)projects.projects?.forEach(project=>{project.apiKey='';});
    return {format:'table-topics-practice-backup',version:1,exportedAt:new Date().toISOString(),includesApiKeys:includeApiKeys,data:{practice:JSON.parse(JSON.stringify(saved)),aiSettings:projects,language}};
  }
  function backupFilename(){return `table-topics-backup-${localDateKey()}.json`;}
  function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function strings(record, keys) { return keys.every(key => record[key] === undefined || typeof record[key] === 'string'); }
  function numbers(record, keys) {
    return keys.every(key => record[key] === undefined || typeof record[key] === 'number' && Number.isFinite(record[key]) && record[key] >= 0);
  }
  function booleans(record, keys) { return keys.every(key => record[key] === undefined || typeof record[key] === 'boolean'); }
  function choice(record, key, choices) { return record[key] === undefined || choices.includes(record[key]); }
  function textList(value) { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
  function optionalList(record, key, check) { return record[key] === undefined || Array.isArray(record[key]) && record[key].every(check); }
  function day(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function dates(record, keys) {
    return keys.every(key => record[key] === undefined || typeof record[key] === 'string'
      && /^\d{4}-\d{2}-\d{2}T/.test(record[key]) && day(record[key].slice(0, 10)) && Number.isFinite(new Date(record[key]).getTime()));
  }
  function uniqueIds(rows) {
    const ids = rows.filter(row => row.id !== undefined).map(row => row.id);
    return ids.every(id => typeof id === 'string' && id.trim()) && new Set(ids).size === ids.length;
  }
  function safeTree(root) {
    const pending = [root];
    while (pending.length) {
      const value = pending.pop();
      if (typeof value === 'number' && !Number.isFinite(value)) return false;
      if (!value || typeof value !== 'object') continue;
      for (const key of Object.keys(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) return false;
        pending.push(value[key]);
      }
    }
    return true;
  }
  function pair(value) {
    return isRecord(value) && strings(value, ['label', 'before', 'after', 'original', 'corrected', 'issue', 'explanation', 'rule', 'example',
      'grammarIssue', 'grammarExplanation', 'grammarRule', 'grammarExample']) && booleans(value, ['isGrammarCorrect', 'isCorrect']);
  }
  function coachResult(value) {
    return isRecord(value)
      && strings(value, ['summary', 'rewritten', 'strength', 'improve', '_rawResponse'])
      && numbers(value, ['overall', 'structure', 'detail', 'fluency', 'improvedOverall'])
      && optionalList(value, 'comparisons', pair) && optionalList(value, 'grammarCorrections', pair)
      && optionalList(value, 'improvements', item => isRecord(item) && strings(item, ['title', 'detail']))
      && optionalList(value, 'scoreDetails', item => isRecord(item) && strings(item, ['name', 'beforeNote', 'afterNote']) && numbers(item, ['before', 'after']));
  }
  function historyEntry(entry) {
    return isRecord(entry) && strings(entry, ['id', 'date', 'topic', 'title', 'question', 'answer', 'language', 'mode'])
      && (entry.date === undefined || day(entry.date)) && dates(entry, ['completedAt']) && numbers(entry, ['score'])
      && (entry.metrics === undefined || coachResult(entry.metrics));
  }
  function reviewCard(card) {
    if (!isRecord(card) || !strings(card, ['id', 'before', 'after', 'language', 'topic', 'question', 'label', 'sourceType',
      'sourceHistoryId', 'sourceScriptId', 'sourceParagraphId', 'sourceAnalysisId', 'grammarIssue', 'grammarExplanation', 'grammarRule', 'grammarExample'])
      || !['id', 'before', 'after', 'language'].every(key => typeof card[key] === 'string' && card[key].trim())
      || typeof card.dueAt !== 'string' || !dates(card, ['createdAt', 'updatedAt', 'dueAt', 'deletedAt'])
      || !numbers(card, ['intervalDays', 'easeFactor', 'repetitions', 'lapses', 'comparisonIndex', 'grammarIndex'])
      || !booleans(card, ['isGrammarCorrect', 'sourceDeleted']) || !choice(card, 'status', ['active', 'archived', 'trashed'])
      || !choice(card, 'previousStatus', ['active', 'archived']) || card.tags !== undefined && !textList(card.tags)) return false;
    if (card.lastReviewedAt !== undefined && card.lastReviewedAt !== null && !dates(card, ['lastReviewedAt'])) return false;
    if (!choice(card, 'lastRating', [null, 'again', 'hard', 'good', 'easy'])) return false;
    if (card.sourceType === 'translation' && (Array.from(card.before).length > 300 || Array.from(card.after).length > 1200)) return false;
    return choice(card, 'translationStyle', ['formal', 'conversational', 'concise'])
      && strings(card, ['translationNote', 'explanationLanguage'])
      && (card.translationNote === undefined || card.translationNote.trim() && Array.from(card.translationNote).length <= 200)
      && (card.explanationLanguage === undefined || /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(card.explanationLanguage));
  }
  function paragraphAnalysis(value) {
    return isRecord(value) && strings(value, ['id', 'overview', 'sourceText', '_rawResponse']) && dates(value, ['createdAt'])
      && optionalList(value, 'suggestions', item => isRecord(item) && typeof item.text === 'string' && strings(item, ['label', 'style', 'rationale']))
      && optionalList(value, 'comparisons', pair);
  }
  function paragraph(value) {
    return isRecord(value) && typeof value.text === 'string' && strings(value, ['id']) && dates(value, ['createdAt', 'updatedAt'])
      && optionalList(value, 'versions', item => isRecord(item)
        && typeof item.text === 'string' && strings(item, ['id', 'source', 'style', 'analysisId', 'restoredFrom']) && dates(item, ['createdAt']))
      && optionalList(value, 'analyses', paragraphAnalysis)
      && (value.versions === undefined || uniqueIds(value.versions)) && (value.analyses === undefined || uniqueIds(value.analyses));
  }
  function script(value) {
    return isRecord(value) && strings(value, ['id', 'title', 'topic', 'purpose', 'audience', 'tone', 'language'])
      && dates(value, ['createdAt', 'updatedAt', 'deletedAt']) && numbers(value, ['targetMinutes'])
      && choice(value, 'status', ['active', 'archived', 'trashed']) && choice(value, 'previousStatus', ['active', 'archived'])
      && (value.tags === undefined || textList(value.tags)) && optionalList(value, 'paragraphs', paragraph)
      && (value.paragraphs === undefined || uniqueIds(value.paragraphs))
      && optionalList(value, 'fullReviews', item => isRecord(item) && dates(item, ['createdAt'])
        && strings(item, ['id', 'summary', 'transitions', 'repetition', 'tone', 'opening', 'closing', '_rawResponse'])
        && (item.recommendations === undefined || textList(item.recommendations)));
  }
  function reviewEvent(value) {
    return isRecord(value) && strings(value, ['id', 'cardId']) && dates(value, ['reviewedAt', 'nextDueAt'])
      && numbers(value, ['previousIntervalDays']) && choice(value, 'rating', ['again', 'hard', 'good', 'easy']);
  }
  function usage(value) {
    return isRecord(value) && strings(value, ['id', 'projectId', 'projectName', 'provider', 'model', 'kind', 'error'])
      && choice(value, 'status', ['success', 'error']) && booleans(value, ['priced']) && dates(value, ['createdAt'])
      && numbers(value, ['inputTokens', 'outputTokens', 'audioSeconds', 'inputRate', 'outputRate', 'estimatedCost', 'durationMs']);
  }
  function project(value) {
    return isRecord(value) && typeof value.id === 'string' && Boolean(value.id.trim())
      && strings(value, ['name', 'provider', 'model', 'endpoint', 'apiKey', 'prompt', 'transcriptionMode', 'transcriptionModel', 'transcriptionEndpoint'])
      && numbers(value, ['inputTokenRate', 'outputTokenRate']) && booleans(value, ['smartCorrection']);
  }
  function validatePractice(practice) {
    if (!isRecord(practice) || !safeTree(practice) || !Array.isArray(practice.history)) return false;
    if (!choice(practice, 'version', [1, 2, 3, 4, 5]) || !practice.history.every(historyEntry) || !uniqueIds(practice.history)) return false;
    for (const [key, check] of [['reviewCards', reviewCard], ['scripts', script], ['reviewEvents', reviewEvent], ['apiUsage', usage]]) {
      if (!optionalList(practice, key, check) || practice[key] !== undefined && !uniqueIds(practice[key])) return false;
    }
    return true;
  }
  function validateAiSettings(settings) {
    if (!isRecord(settings) || !safeTree(settings) || !Array.isArray(settings.projects) || !settings.projects.length) return false;
    return settings.projects.every(project) && uniqueIds(settings.projects)
      && (settings.activeId === undefined || settings.projects.some(project => project.id === settings.activeId));
  }
  function validateSpeechSettings(settings) {
    return isRecord(settings) && safeTree(settings) && typeof settings.voiceURI === 'string'
      && typeof settings.rate === 'number' && settings.rate >= 0.1 && settings.rate <= 10;
  }
  function parseBackup(text) {
    const payload = JSON.parse(text);
    if (!isRecord(payload) || !safeTree(payload) || payload.format !== 'table-topics-practice-backup' || !isRecord(payload.data)
      || !choice(payload, 'version', [1]) || !strings(payload.data, ['language'])) return null;
    const { practice, aiSettings } = payload.data;
    if (!validatePractice(practice) || !validateAiSettings(aiSettings)) return null;
    const projects = aiSettings.projects;
    if (!Array.isArray(projects) || !projects.length || !projects.every(project) || !uniqueIds(projects)) return null;
    if (aiSettings.activeId === undefined) aiSettings.activeId = projects[0].id;
    if (!projects.some(project => project.id === aiSettings.activeId)) return null;
    return { payload, count: practice.history.length, hasKeys: projects.some(project => Boolean(project.apiKey)) };
  }
  return { ensureDataSchema, buildBackup, backupFilename, parseBackup, validatePractice, validateAiSettings, validateSpeechSettings };
});
