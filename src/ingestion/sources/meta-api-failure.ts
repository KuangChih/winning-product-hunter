/**
 * How a stored Meta Ad Library API error message is classified (no imports: the discovery
 * page's client components use it to explain the message). Matches `MetaApiError` messages:
 * "Meta Ad Library API HTTP 400 (code 190): …".
 *
 * - `token`: the access token is invalid or expired (code 190): the user must renew it;
 * - `rate_limited`: Meta's rate limit (613, or Graph's generic 4, 17, 32, HTTP 429);
 * - `request`: Meta refused the request itself (e.g. no access to the Ad Library API yet);
 * - `service`: Meta or the network failed.
 */
export type MetaApiFailureKind = "token" | "rate_limited" | "request" | "service";

export function metaApiFailureKind(message: string | null | undefined): MetaApiFailureKind | null {
  if (!message) return null;
  const m = /Meta Ad Library API HTTP (\d+)(?: \(code (\d+)\))?/.exec(message);
  if (!m) return null;
  const status = Number(m[1]);
  const code = m[2] === undefined ? null : Number(m[2]);
  if (code === 190) return "token";
  if (status === 429 || [4, 17, 32, 613].includes(code ?? -1)) return "rate_limited";
  if (status >= 400 && status < 500) return "request";
  return "service";
}
