const assert = require('node:assert/strict');

function assertTiming(response, names) {
  const header = response.headers.get('Server-Timing');
  assert.equal(typeof header, 'string');
  const metrics = header.split(', ');
  assert.equal(metrics.length, names.length);
  names.forEach((name, index) => {
    assert.match(metrics[index], new RegExp(`^${name};dur=\\d+\\.\\d+$`));
  });
  assert.equal(response.headers.get('Timing-Allow-Origin'), null);
  assert.equal(response.headers.get('Access-Control-Expose-Headers'), 'Server-Timing');
}

module.exports = { assertTiming };
