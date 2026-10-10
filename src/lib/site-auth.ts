/**
 * Site-wide password protection for the personal-use phase (ADR-008). Enabled only when
 * SITE_PASSWORD is set; the cookie holds a hash derived from the password, so changing the
 * password signs everyone out. Works in both the proxy and server actions (Web Crypto only).
 */

export const SITE_AUTH_COOKIE = "wph_site";
export const SITE_AUTH_MAX_AGE = 60 * 60 * 24 * 30;

export function sitePassword(): string | undefined {
  return process.env.SITE_PASSWORD || undefined;
}

export async function siteToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`winning-product-hunter:site:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (length is not secret here: both are fixed-size hashes). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidSiteToken(token: string | undefined, password: string) {
  return token !== undefined && safeEqual(token, await siteToken(password));
}

/** Only same-site relative paths are allowed after login (no open redirects). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }
  return next.startsWith("/login") ? "/" : next;
}
