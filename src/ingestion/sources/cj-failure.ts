/**
 * How a CJ API failure is classified (no imports: the discovery page's client components use it
 * to explain a stored error message).
 *
 * - `auth`: the API key or token was refused (fix the key; never retried in the run);
 * - `points`: today's API points are used up;
 * - `rate_limited`: too many requests (QPS);
 * - `service`: CJ had a temporary problem;
 * - `other`: anything else (e.g. one product not found).
 */
export type CjErrorKind = "auth" | "points" | "rate_limited" | "service" | "other";

/** Codes from CJ's global error table (docs/research/cj-api.md). */
export function cjErrorKind(code: number, message: string, httpStatus: number | null): CjErrorKind {
  if (/points/i.test(message)) return "points";
  if (
    code === 1600200 ||
    code === 429 ||
    httpStatus === 429 ||
    /too many|exceeded limit/i.test(message)
  ) {
    return "rate_limited";
  }
  if ([1600001, 1600002, 1600003, 1601000].includes(code) || httpStatus === 401) return "auth";
  if (code === 1600000 || (httpStatus !== null && httpStatus >= 500)) return "service";
  return "other";
}

/** The kind of a stored CJ error message ("CJ API error 1600001: …"); null when not from CJ. */
export function cjFailureKind(message: string): CjErrorKind | null {
  if (message.startsWith("CJ refused the API key")) return "auth";
  const m = /CJ API error (\d+): ([\s\S]*)/.exec(message);
  if (!m) return null;
  const code = Number(m[1]);
  return cjErrorKind(code, m[2], code >= 400 && code < 600 ? code : null);
}
