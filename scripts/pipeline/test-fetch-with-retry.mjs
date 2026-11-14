// Quick test of fetch-with-retry retry behaviour.
import { fetchBufferWithRetry, fetchWithRetry, FetchWithRetryError } from './fetch-with-retry.js';

let passed = 0;
let failed = 0;

function pass(msg) {
  passed++;
  console.log(`  PASS ${msg ? `(${msg})` : ''}`);
}

function fail(msg) {
  failed++;
  console.log(`  FAIL ${msg ? `(${msg})` : ''}`);
}

let attempts = 0;
const mockFetch = async (url, init) => {
  attempts++;
  if (attempts < 3) {
    // Simulate a 503
    return new Response('service unavailable', { status: 503, statusText: 'Service Unavailable' });
  }
  return new Response('ok', { status: 200 });
};

// Patch global fetch for this test
const original = globalThis.fetch;
globalThis.fetch = mockFetch;

async function test() {
  console.log('Test 1: 503 -> 503 -> 200, expect success after 2 retries');
  attempts = 0;
  try {
    const r = await fetchWithRetry('http://example.com/test', { maxRetries: 3, baseBackoffMs: 10 });
    console.log(`  Result: HTTP ${r.status}, attempts: ${attempts}`);
    if (r.status === 200 && attempts === 3) pass();
    else fail(`status=${r.status} attempts=${attempts}`);
  } catch (err) {
    fail(`${err}`);
  }

  console.log('\nTest 2: 404 (non-retryable), expect no retry — fetchWithRetry returns the response; caller checks .ok');
  attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return new Response('not found', { status: 404 });
  };
  try {
    const r = await fetchWithRetry('http://example.com/test', { maxRetries: 3, baseBackoffMs: 10 });
    if (r.status === 404 && attempts === 1) {
      pass('returned 404 immediately, no retry');
    } else {
      fail(`status=${r.status} attempts=${attempts}`);
    }
  } catch (err) {
    fail(`unexpected error ${err}`);
  }

  console.log('\nTest 3: 429 (rate-limited), expect retry');
  attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts < 2) return new Response('rate', { status: 429 });
    return new Response('ok', { status: 200 });
  };
  try {
    const r = await fetchWithRetry('http://example.com/test', { maxRetries: 3, baseBackoffMs: 10 });
    if (r.status === 200 && attempts === 2) pass('200 after 2 attempts');
    else fail(`status=${r.status} attempts=${attempts}`);
  } catch (err) {
    fail(`${err}`);
  }

  console.log('\nTest 4: Network error (TypeError), expect retry then give up');
  attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    throw new TypeError('fetch failed: ECONNRESET');
  };
  try {
    await fetchWithRetry('http://example.com/test', { maxRetries: 2, baseBackoffMs: 10 });
    fail('expected error');
  } catch (err) {
    if (err instanceof FetchWithRetryError && err.attempts === 3) {
      pass('gave up after 3 total attempts');
    } else {
      fail(`${err}`);
    }
  }

  console.log('\nTest 5: fetchBufferWithRetry on 404, expect fast failure on attempt 1 without retry');
  attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return new Response('Not Found', { status: 404, statusText: 'Not Found' });
  };
  try {
    await fetchBufferWithRetry('http://example.com/test.zip', { maxRetries: 3, baseBackoffMs: 10 });
    fail('expected error');
  } catch (err) {
    if (err instanceof FetchWithRetryError && err.attempts === 1) {
      pass('fast failed on attempt 1 without retrying 404');
    } else {
      fail(`attempts=${attempts} err=${err}`);
    }
  }

  console.log('\nTest 6: externalSignal abort in fetchBufferWithRetry, expect immediate abort');
  attempts = 0;
  const ac = new AbortController();
  globalThis.fetch = async (url, init) => {
    attempts++;
    ac.abort();
    throw new DOMException('This operation was aborted', 'AbortError');
  };
  try {
    await fetchBufferWithRetry('http://example.com/test.zip', {
      maxRetries: 3,
      baseBackoffMs: 10,
      signal: ac.signal,
    });
    fail('expected abort error');
  } catch (err) {
    if (
      (err.name === 'AbortError' ||
        (err instanceof FetchWithRetryError && err.message.includes('Request aborted by caller'))) &&
      attempts === 1
    ) {
      pass('aborted immediately on attempt 1 without retry');
    } else {
      fail(`attempts=${attempts} err=${err}`);
    }
  }

  globalThis.fetch = original;

  console.log(`\n============================================================\nResults: ${passed} passed, ${failed} failed\n============================================================`);
  if (failed > 0) process.exit(1);
}

test().catch((e) => {
  console.error(e);
  process.exit(1);
});
