/**
 * Hand-off between ticks over HTTP (ADR-013): a finished tick POSTs the next tick to this
 * deployment. The token goes only to an allow-listed origin, never to a `Host` a client chose.
 */
import { pipelineTickToken } from "@/lib/internal-auth";

type Env = Record<string, string | undefined>;

export const TICK_PATH = "/api/internal/pipeline/tick";
export const KICK_TIMEOUT_MS = 10_000;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Where the next tick is sent: on Vercel only the production domain (preview deployments are
 * protected and run no chain); locally only the request's origin when it is a loopback host.
 * Null: no trusted origin, no hand-off (the status poll and the cron resume the run).
 */
export function resolveSelfOrigin(
  requestOrigin: string | null,
  env: Env = process.env,
): string | null {
  if (env.VERCEL) {
    const host = env.VERCEL_PROJECT_PRODUCTION_URL;
    return env.VERCEL_ENV === "production" && host && !/[/\s]/.test(host)
      ? `https://${host}`
      : null;
  }
  if (!requestOrigin) return null;
  try {
    const url = new URL(requestOrigin);
    if (!LOCAL_HOSTS.has(url.hostname) || !/^https?:$/.test(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export type KickResult = { ok: true } | { ok: false; error: string; retryable: boolean };

/** Asks the next function to run a tick of `runId` (it answers 202 at once). */
export async function kickTick({
  origin,
  runId,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = KICK_TIMEOUT_MS,
}: {
  origin: string;
  runId: number;
  env?: Env;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<KickResult> {
  const token = await pipelineTickToken(env);
  if (!token) return { ok: false, error: "No CRON_SECRET or DATABASE_URL", retryable: false };
  let res: Response;
  try {
    res = await fetchImpl(`${origin}${TICK_PATH}`, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ runId }),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      error: timedOut
        ? `Next tick did not answer within ${timeoutMs / 1000} s`
        : `Next tick request failed: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
    };
  }
  // 200 is only a success when it is the tick route saying the run had already finished; any
  // other 200 (a firewall page, another app on a custom domain) would stall the chain silently.
  if (res.status === 200) {
    const body: unknown = await res.json().catch(() => null);
    if ((body as { accepted?: unknown } | null)?.accepted === false) return { ok: true };
    return {
      ok: false,
      error: "HTTP 200: unexpected response from the tick route",
      retryable: false,
    };
  }
  await res.body?.cancel().catch(() => undefined);
  if (res.status === 202) return { ok: true };
  if (res.status === 508) {
    return { ok: false, error: "HTTP 508: Vercel loop detection", retryable: false };
  }
  if (res.status >= 500) return { ok: false, error: `HTTP ${res.status}`, retryable: true };
  return {
    ok: false,
    // 401/403/3xx: a token mismatch, Deployment Protection or a firewall challenge.
    error: `HTTP ${res.status}: the next tick was refused (token, protection or firewall)`,
    retryable: false,
  };
}
