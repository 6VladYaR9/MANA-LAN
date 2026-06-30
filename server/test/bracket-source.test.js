const assert = require('node:assert/strict');
const test = require('node:test');

function freshBracketSource() {
  const modulePath = require.resolve('../services/bracketSource');
  delete require.cache[modulePath];
  return require('../services/bracketSource');
}

test('bracket source serves stale cache when Google Sheets fetch fails', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    GOOGLE_SHEETS_PUBLIC_CSV_URL: process.env.GOOGLE_SHEETS_PUBLIC_CSV_URL,
    GOOGLE_SHEETS_ID: process.env.GOOGLE_SHEETS_ID,
    GOOGLE_SHEETS_API_KEY: process.env.GOOGLE_SHEETS_API_KEY,
    BRACKET_CACHE_TTL_MS: process.env.BRACKET_CACHE_TTL_MS,
    BRACKET_FETCH_TIMEOUT_MS: process.env.BRACKET_FETCH_TIMEOUT_MS
  };

  try {
    process.env.GOOGLE_SHEETS_PUBLIC_CSV_URL = 'https://example.test/bracket.csv';
    delete process.env.GOOGLE_SHEETS_ID;
    delete process.env.GOOGLE_SHEETS_API_KEY;
    process.env.BRACKET_CACHE_TTL_MS = '1';
    process.env.BRACKET_FETCH_TIMEOUT_MS = '1000';

    global.fetch = async () => new Response('Stage,A,B\nSeed,1,2\n');
    const bracketSource = freshBracketSource();
    const first = await bracketSource.getBracketRows();
    assert.equal(first.cached, false);
    assert.deepEqual(first.rows, [['Stage', 'A', 'B'], ['Seed', '1', '2']]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    global.fetch = async () => {
      throw new Error('network down');
    };

    const second = await bracketSource.getBracketRows();
    assert.equal(second.cached, true);
    assert.equal(second.stale, true);
    assert.equal(second.error, 'network down');
    assert.deepEqual(second.rows, first.rows);
  } finally {
    global.fetch = originalFetch;
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    delete require.cache[require.resolve('../services/bracketSource')];
  }
});
