/**
 * Where an ad's landing page ends up (ADR-018): some stores redirect to another domain or a new
 * product handle, and the Shopify catalog only knows the final page. Only the final URL is kept:
 * no page content is read or stored. Rules (ADR-006): robots.txt is honoured, every request
 * carries an honest User-Agent, the caller spaces requests (≥ 2 s), and a refusal (403 / 429)
 * stops the run's checks.
 */

export const STORE_PAGES_PROVIDER = "store_pages";
export const STORE_PAGES_USER_AGENT =
  "winning-product-hunter/1.0 (personal product research; follows robots.txt)";

/**
 * Whether robots.txt lets any crawler (`User-agent: *`) fetch `path`: the longest matching
 * Allow / Disallow rule wins (`*` wildcards and a trailing `$` supported). No group for `*` or
 * an empty file allows everything.
 */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  const allow: string[] = [];
  const disallow: string[] = [];
  let inStar = false;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^(user-agent|allow|disallow)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      // Consecutive User-agent lines share one group.
      inStar = (lastWasAgent && inStar) || value === "*";
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!inStar || !value) continue;
    (field === "allow" ? allow : disallow).push(value);
  }
  const matches = (rule: string) => {
    const anchored = rule.endsWith("$");
    const body = (anchored ? rule.slice(0, -1) : rule)
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
  };
  const longest = (rules: string[]) =>
    rules.filter(matches).reduce((len, r) => Math.max(len, r.length), -1);
  const d = longest(disallow);
  return d < 0 || longest(allow) >= d;
}

export type RedirectOutcome =
  "redirected" | "same" | "disallowed" | "not_found" | "error" | "blocked";

export interface RedirectResult {
  url: string;
  outcome: RedirectOutcome;
  /** The page the redirects end at (query string dropped); null unless reached. */
  finalUrl: string | null;
  status: number | null;
}

export interface RedirectResolverOptions {
  fetchImpl?: typeof fetch;
  /** Awaited before every request (robots.txt included); the caller paces them. */
  wait: (signal?: AbortSignal) => Promise<void>;
  timeoutMs?: number;
  /** Counts every request sent. */
  onRequest?: () => void;
}

/** Whether the response came from the requested store (not a site it redirected to). */
const sameSite = (r: Response, u: URL) =>
  !r.url || new URL(r.url).hostname.replace(/^www\./, "") === u.hostname.replace(/^www\./, "");

const stripQuery = (u: string) => {
  const x = new URL(u);
  x.search = "";
  x.hash = "";
  return x.toString();
};

/**
 * Resolves landing URLs one at a time, reading each store's robots.txt once. HEAD first; a
 * store that refuses HEAD (405 / 501) gets a GET whose body is never read.
 */
export function createRedirectResolver({
  fetchImpl = fetch,
  wait,
  timeoutMs = 15_000,
  onRequest,
}: RedirectResolverOptions) {
  const robots = new Map<string, string>();
  const send = async (url: string, method: "HEAD" | "GET", signal?: AbortSignal) => {
    await wait(signal);
    onRequest?.();
    const timeout = AbortSignal.timeout(timeoutMs);
    return fetchImpl(url, {
      method,
      redirect: "follow",
      headers: { "User-Agent": STORE_PAGES_USER_AGENT },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  };
  return async function resolve(url: string, signal?: AbortSignal): Promise<RedirectResult> {
    const u = new URL(url);
    try {
      if (!robots.has(u.origin)) {
        const r = await send(`${u.origin}/robots.txt`, "GET", signal);
        if (r.status === 403 || r.status === 429) {
          await r.body?.cancel().catch(() => {});
          if (sameSite(r, u)) return { url, outcome: "blocked", finalUrl: null, status: r.status };
          // The store's domain forwards elsewhere: no robots.txt of its own; the page is checked.
          robots.set(u.origin, "");
        } else {
          robots.set(u.origin, r.ok ? await r.text() : "");
        }
      }
      if (!robotsAllows(robots.get(u.origin)!, u.pathname)) {
        return { url, outcome: "disallowed", finalUrl: null, status: null };
      }
      let r = await send(url, "HEAD", signal);
      if (r.status === 405 || r.status === 501) {
        r = await send(url, "GET", signal);
      }
      await r.body?.cancel().catch(() => {});
      if (r.status === 403 || r.status === 429) {
        // Refused by the store itself: blocked. Refused after a redirect to another site
        // (measured: a lapsed store domain forwarded to a domain marketplace): the page is gone.
        return {
          url,
          outcome: sameSite(r, u) ? "blocked" : "error",
          finalUrl: null,
          status: r.status,
        };
      }
      if (r.status === 404 || r.status === 410) {
        return { url, outcome: "not_found", finalUrl: null, status: r.status };
      }
      if (!r.ok) return { url, outcome: "error", finalUrl: null, status: r.status };
      const finalUrl = stripQuery(r.url || url);
      return {
        url,
        outcome: finalUrl === stripQuery(url) ? "same" : "redirected",
        finalUrl,
        status: r.status,
      };
    } catch (err) {
      if (signal?.aborted) throw err;
      return { url, outcome: "error", finalUrl: null, status: null };
    }
  };
}
