(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RetryLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SCORE_KEYS = ['overall', 'structure', 'detail', 'fluency'];

  function normalizeRetryGoals(goals, fallback = []) {
    const source = Array.isArray(goals) && goals.length ? goals : fallback;
    return source.slice(0, 3).map((goal, index) => ({
      id: String(goal?.id || `goal_${index + 1}`),
      text: String(goal?.text || goal?.detail || goal || '').trim(),
      category: goal?.category ? String(goal.category) : undefined
    })).filter(goal => goal.text);
  }

  function associateAttempt(record, parent) {
    if (!parent) return { ...record, attemptNumber: 1, sessionId: record.sessionId || record.id };
    return {
      ...record,
      attemptNumber: Math.max(2, Number(parent.attemptNumber || 1) + 1),
      parentAttemptId: parent.id,
      retryOf: parent.id,
      sessionId: parent.sessionId || parent.id,
      question: parent.question,
      retryGoals: normalizeRetryGoals(parent.retryGoals || parent.metrics?.retryGoals)
    };
  }

  function scoreComparisons(firstMetrics = {}, secondMetrics = {}) {
    return SCORE_KEYS.map(key => {
      const before = Number(firstMetrics[key]);
      const after = Number(secondMetrics[key]);
      if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
      const delta = Math.round(after) - Math.round(before);
      return { key, before: Math.round(before), after: Math.round(after), delta, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same' };
    }).filter(Boolean);
  }

  function deltaLabel(delta) {
    return delta > 0 ? `↑${delta}` : delta < 0 ? `↓${Math.abs(delta)}` : '→0';
  }

  function normalizeGoalResults(results, goals) {
    const allowed = new Set(['achieved', 'partial', 'not_achieved']);
    return normalizeRetryGoals(goals).map((goal, index) => {
      const result = Array.isArray(results) ? results[index] : null;
      return {
        goal: goal.text,
        status: allowed.has(result?.status) ? result.status : 'partial',
        explanation: String(result?.explanation || '').trim()
      };
    });
  }

  function isScoreValue(value) {
    if (typeof value === 'number') return Number.isFinite(value);
    return /^\s*\d{1,3}(?:\s*(?:%|\/\s*100))?\s*$/.test(String(value ?? ''));
  }

  function comparableText(value) {
    return String(value ?? '').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  }

  function isGroundedInTranscript(before, transcript) {
    if (typeof transcript !== 'string') return true;
    const source = comparableText(transcript);
    const candidate = comparableText(before);
    return candidate.length >= 2 && source.includes(candidate);
  }

  function partitionCoachComparisons(comparisons, transcript) {
    return (Array.isArray(comparisons) ? comparisons : []).reduce((result, item) => {
      if (!item || typeof item !== 'object') return result;
      const before = item.before ?? item.original;
      const after = item.after ?? item.improved ?? item.corrected;
      if (isScoreValue(before) && isScoreValue(after)) {
        result.scoreComparisons.push({ ...item, name: item.name || item.category || item.label });
      } else if (String(before ?? '').trim() && String(after ?? '').trim() && isGroundedInTranscript(before, transcript)) {
        result.sentenceComparisons.push({ ...item, before: String(before), after: String(after) });
      }
      return result;
    }, { sentenceComparisons: [], scoreComparisons: [] });
  }

  async function generateComparisonSafely(secondAttempt, generate) {
    try {
      return { attempt: { ...secondAttempt, retryComparison: await generate() }, error: null };
    } catch (error) {
      return { attempt: { ...secondAttempt, retryComparisonError: String(error?.message || error) }, error };
    }
  }

  return { SCORE_KEYS, normalizeRetryGoals, associateAttempt, scoreComparisons, deltaLabel, normalizeGoalResults, isScoreValue, comparableText, isGroundedInTranscript, partitionCoachComparisons, generateComparisonSafely };
});
