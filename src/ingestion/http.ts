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

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
    sleep = defaultSleep,
    fetchImpl = fetch,
  } = opts;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch (err) {
      if (attempt >= retries || init.signal?.aborted) throw err;
      await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** attempt));
      continue;
    }
    if (res.ok) return res;
    if (!isRetryable(res.status) || attempt >= retries) {
      throw new HttpError(res.status, url, await res.text().catch(() => ""));
    }
    const delay = retryAfterMs(res.headers.get("retry-after")) ?? baseDelayMs * 2 ** attempt;
    await sleep(Math.min(maxDelayMs, delay));
  }
}

/** Spaces out calls so that at most one starts every `intervalMs`. */
export function createRateLimiter(
  intervalMs: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = defaultSleep,
) {
  let next = 0;
  return async function wait() {
    const t = now();
    const startAt = Math.max(t, next);
    next = startAt + intervalMs;
    if (startAt > t) await sleep(startAt - t);
  };
}
