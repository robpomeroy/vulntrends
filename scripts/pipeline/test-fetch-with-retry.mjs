// Quick test of fetch-with-retry retry behaviour.
import { fetchWithRetry, FetchWithRetryError } from './fetch-with-retry.js';

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
    if (r.status === 200 && attempts === 3) console.log('  PASS');
    else console.log('  FAIL');
  } catch (err) {
    console.log(`  FAIL: ${err}`);
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
      console.log('  PASS (returned 404 immediately, no retry)');
    } else {
      console.log(`  FAIL: status=${r.status} attempts=${attempts}`);
    }
  } catch (err) {
    console.log(`  FAIL: unexpected error ${err}`);
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
    if (r.status === 200 && attempts === 2) console.log('  PASS (200 after 2 attempts)');
    else console.log(`  FAIL: status=${r.status} attempts=${attempts}`);
  } catch (err) {
    console.log(`  FAIL: ${err}`);
  }

  console.log('\nTest 4: Network error (TypeError), expect retry then give up');
  attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    throw new TypeError('fetch failed: ECONNRESET');
  };
  try {
    await fetchWithRetry('http://example.com/test', { maxRetries: 2, baseBackoffMs: 10 });
    console.log('  FAIL: expected error');
  } catch (err) {
    if (err instanceof FetchWithRetryError && err.attempts === 3) {
      console.log(`  PASS (gave up after 3 total attempts)`);
    } else {
      console.log(`  FAIL: ${err}`);
    }
  }

  globalThis.fetch = original;
}

test().catch((e) => {
  console.error(e);
  process.exit(1);
});
