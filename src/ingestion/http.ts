export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = "HttpError";
  }
}

/** Waits `ms`; rejects with the signal's reason as soon as `signal` aborts. */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /**
   * Per-attempt timeout. A timed-out attempt counts as a network error (retried); an abort of
   * the caller's own `init.signal` is never retried.
   */
  timeoutMs?: number;
  sleep?: Sleep;
  fetchImpl?: typeof fetch;
}

export const defaultSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function isRetryable(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * fetch with exponential backoff on 408/429/5xx and network errors.
 * Honors Retry-After. Non-retryable responses throw HttpError immediately.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const {
    retries = 3,
    baseDelayMs = 500,
    maxDelayMs = 30_000,
    timeoutMs,
    sleep = defaultSleep,
    fetchImpl = fetch,
  } = opts;
  const outer = init.signal ?? undefined;

  for (let attempt = 0; ; attempt++) {
    outer?.throwIfAborted();
    const signal =
      timeoutMs === undefined
        ? outer
        : outer
          ? AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, signal ? { ...init, signal } : init);
    } catch (err) {
      if (attempt >= retries || outer?.aborted) throw err;
      await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** attempt), outer);
      continue;
    }
    // With `redirect: "manual"` the caller checks each redirect hop itself.
    if (res.ok || (init.redirect === "manual" && res.status >= 300 && res.status < 400)) {
      return res;
    }
    if (!isRetryable(res.status) || attempt >= retries) {
      throw new HttpError(res.status, url, await res.text().catch(() => ""));
    }
    const delay = retryAfterMs(res.headers.get("retry-after")) ?? baseDelayMs * 2 ** attempt;
    await sleep(Math.min(maxDelayMs, delay), outer);
  }
}

/**
 * Spaces out calls so that at most one starts every `intervalMs`. `notBefore` (epoch ms) carries
 * the previous process's next allowed request time over, e.g. from a saved pipeline run; it is
 * clamped to `now + intervalMs` so a clock running ahead on another machine cannot stall us.
 * The returned `wait` rejects as soon as its signal aborts.
 */
export function createRateLimiter(
  intervalMs: number,
  now: () => number = Date.now,
  sleep: Sleep = defaultSleep,
  notBefore = 0,
) {
  let next = Math.min(notBefore, now() + intervalMs);
  return async function wait(signal?: AbortSignal) {
    signal?.throwIfAborted();
    const t = now();
    const startAt = Math.max(t, next);
    next = startAt + intervalMs;
    if (startAt > t) await sleep(startAt - t, signal);
  };
}
