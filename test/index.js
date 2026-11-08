const assert = require('node:assert/strict');
const { test } = require('node:test');

test('test environment can query an in-memory PostgreSQL database', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const database = new PGlite();

  try {
    const result = await database.query('SELECT 1 AS value');
    assert.deepEqual(result.rows, [{ value: 1 }]);
  } finally {
    await database.close();
  }
});
