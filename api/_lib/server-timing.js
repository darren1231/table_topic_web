function createServerTiming(names) {
  const startedAt = performance.now();
  const durations = Object.fromEntries(names.map(name => [name, 0]));
  const starts = {};
  return {
    start(name) { starts[name] = performance.now(); },
    end(name) { durations[name] = Math.max(0, performance.now() - starts[name]); },
    async measure(name, operation) {
      this.start(name);
      try { return await operation(); } finally { this.end(name); }
    },
    json(body, status = 200, headers = {}) {
      const timing = [...Object.entries(durations), ['total', Math.max(0, performance.now() - startedAt)]]
        .map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`).join(', ');
      return Response.json(body, { status, headers: {
        'Cache-Control': 'no-store', ...headers,
        'Server-Timing': timing, 'Access-Control-Expose-Headers': 'Server-Timing',
      } });
    },
  };
}

module.exports = { createServerTiming };
