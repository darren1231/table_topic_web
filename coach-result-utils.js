(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CoachResultUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function isNumericScore(value) {
    if (typeof value === 'number') return Number.isFinite(value);
    return /^\s*\d{1,3}(?:\s*(?:\/\s*100|%))?\s*$/.test(String(value ?? ''));
  }

  function partitionComparisons(comparisons) {
    return (Array.isArray(comparisons) ? comparisons : []).reduce((result, item) => {
      if (!item || typeof item !== 'object') return result;
      const before = item.before ?? item.original;
      const after = item.after ?? item.improved ?? item.corrected;
      if (isNumericScore(before) && isNumericScore(after)) result.scoreOnly.push(item);
      else if (String(before ?? '').trim() && String(after ?? '').trim()) result.text.push({...item, before, after});
      return result;
    }, {text: [], scoreOnly: []});
  }

  return {isNumericScore, partitionComparisons};
});
