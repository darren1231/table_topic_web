(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UsageStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const dateValue = row => row.created_at ?? row.createdAt;
  const userId = row => String(row.user_id ?? row.userId ?? '');
  function amount(value) {
    const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0;
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function filterRecords(records, { period = 'month', kind = 'all', userId: user = 'all', now = new Date() } = {}) {
    const end = new Date(now).getTime();
    const date = new Date(end);
    const start = period === 'month' ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
      : period === '7' || period === '30' ? end - Number(period) * 86400000 : -Infinity;
    return records.filter(row => {
      if (kind !== 'all' && (kind === 'text' ? row.kind === 'transcription' : row.kind !== kind)) return false;
      if (user !== 'all' && userId(row) !== user) return false;
      if (period === 'all') return true;
      const created = new Date(dateValue(row)).getTime();
      return Number.isFinite(created) && created >= start && created <= end;
    });
  }

  function summarize(records) {
    return records.reduce((total, row) => ({
      calls: total.calls + 1,
      inputTokens: total.inputTokens + amount(row.input_tokens ?? row.inputTokens),
      outputTokens: total.outputTokens + amount(row.output_tokens ?? row.outputTokens),
      totalCost: total.totalCost + amount(row.estimated_cost ?? row.estimatedCost),
      audioSeconds: total.audioSeconds + amount(row.audio_seconds ?? row.audioSeconds),
    }), { calls: 0, inputTokens: 0, outputTokens: 0, totalCost: 0, audioSeconds: 0 });
  }

  function groupByUser(records) {
    const groups = new Map();
    for (const row of records) {
      const id = userId(row);
      const group = groups.get(id) || { userId: id, email: String(row.email ?? ''), calls: 0, spent: 0, lastUsedAt: null };
      group.calls++;
      group.spent += amount(row.estimated_cost ?? row.estimatedCost);
      const timestamp = new Date(dateValue(row)).getTime();
      if (Number.isFinite(timestamp) && (!group.lastUsedAt || timestamp > new Date(group.lastUsedAt).getTime())) group.lastUsedAt = new Date(timestamp).toISOString();
      groups.set(id, group);
    }
    return [...groups.values()].sort((a, b) => b.spent - a.spent || a.userId.localeCompare(b.userId));
  }

  return { filterRecords, summarize, groupByUser };
});
