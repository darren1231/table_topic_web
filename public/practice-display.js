(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PracticeDisplay = factory();
})(globalThis, function () {
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  function replace(owner, key, value) {
    if (JSON.stringify(owner[key]) === JSON.stringify(value)) return;
    if (owner[key] !== undefined) {
      if (!record(owner._displayOriginals)) owner._displayOriginals = {};
      if (!Object.hasOwn(owner._displayOriginals, key)) owner._displayOriginals[key] = owner[key];
    }
    owner[key] = value;
  }
  function texts(owner, keys) {
    for (const key of keys) if (owner[key] !== undefined && typeof owner[key] !== 'string') replace(owner, key, text(owner[key]));
  }
  function numeric(owner, keys, limit = Infinity) {
    for (const key of keys) {
      if (owner[key] === undefined) continue;
      const value = typeof owner[key] === 'string' ? owner[key].trim().replace(/\s*(?:\/\s*100|%)$/, '') : owner[key];
      const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
      replace(owner, key, Number.isFinite(number) ? Math.max(0, Math.min(limit, number)) : 0);
    }
  }
  function list(owner, key, transform) {
    if (owner[key] === undefined) return;
    const rows = Array.isArray(owner[key]) ? owner[key] : [owner[key]];
    replace(owner, key, rows.filter(item => item !== null).map(item => transform(record(item) ? { ...item } : { detail: text(item) })));
  }
  function comparison(item) {
    texts(item, ['label', 'before', 'after', 'original', 'corrected', 'issue', 'explanation', 'rule', 'example',
      'grammarIssue', 'grammarExplanation', 'grammarRule', 'grammarExample']);
    for (const key of ['isGrammarCorrect', 'isCorrect']) {
      if (item[key] !== undefined && typeof item[key] !== 'boolean') replace(item, key, item[key] === 'true');
    }
    return item;
  }
  function metrics(owner) {
    if (owner.metrics === undefined) return;
    if (!record(owner.metrics)) replace(owner, 'metrics', { summary: text(owner.metrics) });
    const value = owner.metrics;
    texts(value, ['summary', 'rewritten', 'strength', 'improve', '_rawResponse']);
    numeric(value, ['overall', 'structure', 'detail', 'fluency', 'improvedOverall'], 100);
    list(value, 'improvements', item => { texts(item, ['title', 'detail']); return item; });
    for (const key of ['comparisons', 'grammarCorrections', 'grammar_corrections', 'sentenceCorrections']) list(value, key, comparison);
    for (const key of ['scoreDetails', 'scores']) list(value, key, item => {
      texts(item, ['name', 'category', 'item', 'beforeNote', 'afterNote']);
      numeric(item, ['before', 'after', 'originalScore', 'improvedScore', 'score'], 100);
      return item;
    });
  }
  // Operates only on a validated owner's data; the public normalize API below clones first.
  function normalizeOwned(practice) {
    if (Array.isArray(practice.history)) for (const entry of practice.history) {
      if (!record(entry)) continue;
      texts(entry, ['topic', 'title', 'question', 'answer']);
      numeric(entry, ['score'], 100);
      metrics(entry);
    }
    if (Array.isArray(practice.apiUsage)) for (const entry of practice.apiUsage) {
      if (!record(entry)) continue;
      numeric(entry, ['inputTokens', 'outputTokens', 'audioSeconds', 'inputRate', 'outputRate', 'estimatedCost', 'durationMs']);
    }
    return practice;
  }
  return { normalize: practice => normalizeOwned(JSON.parse(JSON.stringify(practice))) };
});
