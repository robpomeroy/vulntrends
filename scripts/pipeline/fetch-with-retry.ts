/**
 * Shared fetch-with-retry helper for the data pipeline parsers.
 *
 * Every source parser needs the same resilience: a single network hiccup
 * shouldn't kill a 30-minute data build. This module centralises that
 * behaviour so each parser can opt in with one line of code.
 *
 * Features:
 *   - **Timeout** via `AbortController` (default 30s, configurable)
 *   - **Retry** with exponential backoff (default 4 attempts: initial + 3
 *     retries with 1s, 2s, 4s backoff)
 *   - **Jitter** (±200ms random) to avoid thundering-herd retries from
 *     multiple sources hitting the same API simultaneously
 *   - **Retryable status codes**: 429 (rate-limited), 502, 503, 504
 *     — but NOT other 4xx, which are usually auth/permission errors
 *     that won't fix themselves on retry
 *   - **Network errors** (ECONNRESET, UND_ERR_SOCKET, etc.) are always
 *     retried — they're transient by definition
 *
 * Usage:
 *   import { fetchWithRetry } from '../fetch-with-retry.js';
 *   const response = await fetchWithRetry(url, { timeoutMs: 60_000 });
 *
 * For backward compatibility, `fetch` and `fetchWithRetry` accept the
 * same RequestInit fields, plus three optional extras (all have sensible
 * defaults):
 *
 *   - `timeoutMs`     — request timeout in ms (default 30_000)
 *   - `maxRetries`    — number of retry attempts after the first try
 *                       (default 3)
 *   - `baseBackoffMs` — base backoff in ms; doubled on each retry, with
 *                       ±200ms jitter (default 1_000)
 *
 * The function returns the `Response` on success. On final failure it
 * throws an `Error` with the cumulative attempt history in the message.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 1_000;
const JITTER_MS = 200;

/** Status codes that indicate a transient failure — worth retrying. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/** Internal sentinel error for failures that must not be retried. */
class NonRetryableError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'NonRetryableError';
    this.status = status;
  }
}

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random integer in [0, n). */
function randomInt(n: number): number {
  return Math.floor(Math.random() * n);
}

export interface FetchWithRetryOptions extends Omit<RequestInit, 'signal'> {
  /** Request timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Number of retry attempts after the first try. Default 3. */
  maxRetries?: number;
  /** Base backoff in ms; doubled on each retry. Default 1_000. */
  baseBackoffMs?: number;
  /**
   * Per-request AbortSignal. Composed with the internal timeout signal
   * so that the request aborts on whichever fires first.
   */
  signal?: AbortSignal;
}

export class FetchWithRetryError extends Error {
  readonly attempts: number;
  readonly lastStatus: number | undefined;
  readonly url: string;
  readonly causes: unknown[];

  constructor(
    message: string,
    options: {
      attempts: number;
      lastStatus: number | undefined;
      url: string;
      causes: unknown[];
    },
  ) {
    super(message);
    this.name = 'FetchWithRetryError';
    this.attempts = options.attempts;
    this.lastStatus = options.lastStatus;
    this.url = options.url;
    this.causes = options.causes;
  }
}

/**
 * Shared retry loop that executes a fetch request and processes its response.
 */
async function executeWithRetry<T>(
  url: string,
  options: FetchWithRetryOptions,
  action: (response: Response) => Promise<T>,
): Promise<T> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
    signal: externalSignal,
    ...fetchOptions
  } = options;

  const causes: unknown[] = [];
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // If external caller has already aborted, abort immediately without retrying
    if (externalSignal?.aborted) {
      throw new FetchWithRetryError(`Request aborted by caller: ${url}`, {
        attempts: attempt + 1,
        lastStatus,
        url,
        causes,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
      lastStatus = response.status;

      // Retryable HTTP status (429, 502, 503, 504)
      if (RETRYABLE_STATUSES.has(response.status)) {
        try {
          await response.arrayBuffer();
        } catch {
          // Ignore body drain failure
        }
        causes.push(new Error(`HTTP ${response.status}`));
      } else {
        // Return or consume body under active timeout
        return await action(response);
      }
    } catch (err) {
      // Caller aborts must not be retried or masked as timeouts
      if (externalSignal?.aborted) {
        throw new FetchWithRetryError(`Request aborted by caller: ${url}`, {
          attempts: attempt + 1,
          lastStatus,
          url,
          causes,
        });
      }

      // Non-retryable errors (e.g. 404 in fetchBufferWithRetry) fail immediately
      if (err instanceof NonRetryableError) {
        throw new FetchWithRetryError(`fetchWithRetry: ${url} failed with ${err.message}`, {
          attempts: attempt + 1,
          lastStatus: err.status ?? lastStatus,
          url,
          causes: [...causes, err],
        });
      }

      if (err instanceof Error && err.name === 'AbortError') {
        causes.push(new Error(`timeout after ${timeoutMs}ms`));
      } else {
        causes.push(err);
      }
    } finally {
      clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }

    if (attempt < maxRetries) {
      const backoff = baseBackoffMs * 2 ** attempt + randomInt(JITTER_MS * 2) - JITTER_MS;
      const clamped = Math.max(0, backoff);
      await sleep(clamped);
    }
  }

  const lastCause = causes[causes.length - 1];
  const lastMessage = lastCause instanceof Error ? lastCause.message : String(lastCause);
  throw new FetchWithRetryError(
    `fetchWithRetry: ${url} failed after ${maxRetries + 1} attempts (last: ${lastMessage})`,
    {
      attempts: maxRetries + 1,
      lastStatus,
      url,
      causes,
    },
  );
}

/**
 * Fetch a URL with retry, backoff, and timeout.
 *
 * Retries are triggered for:
 *   - Network errors (TypeError thrown by fetch on connection failures)
 *   - HTTP status codes in RETRYABLE_STATUSES (429/502/503/504)
 *
 * Non-retryable failures (other 4xx, 5xx not in the retryable set) return
 * immediately on the first try — there's no point retrying an auth error.
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  return executeWithRetry(url, options, async (response) => response);
}

/**
 * Fetch a URL with retry, backoff, and timeout, reading the full response
 * body into a Buffer under the active timeout deadline.
 *
 * This ensures large downloads (such as OSV bulk ZIP archives) do not stall
 * indefinitely if headers arrive but the body trickle-stalls outside the
 * initial fetch() call.
 */
export async function fetchBufferWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Buffer> {
  return executeWithRetry(url, options, async (response) => {
    if (!response.ok) {
      throw new NonRetryableError(`HTTP ${response.status}: ${response.statusText}`, response.status);
    }
    const arrayBuf = await response.arrayBuffer();
    return Buffer.from(arrayBuf);
  });
}
