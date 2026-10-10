/**
 * Turns an ad's landing page URL into a product key. Dropshipping stores usually run on
 * Shopify, whose product pages live at `/products/<handle>`; different stores selling the
 * same supplier product very often keep the same handle, so the handle is the key. Other
 * explicit product URL patterns (/product/<slug>, /p/<slug>, /dp/<id>, /item/<slug>) fall back
 * to host + path. Anything else (home pages, collections, advertorials, listicles, quizzes) is
 * not treated as a product: precision matters more than recall for discovery.
 */

export interface LandingKey {
  /** Stable identifier used to group ads into one product. */
  key: string;
  /** Store host without "www.". */
  host: string;
  /** Shopify-style product handle, when present. */
  handle: string | null;
  /** Normalized URL (no query or fragment). */
  url: string;
}

/** Path prefixes that mark a single product page on non-Shopify stores. */
const PRODUCT_PREFIXES = new Set(["product", "p", "dp", "item"]);

/** "instant-posture-corrector-1", "...-copy" and "...-copy-1" are the same product. */
export function normalizeHandle(handle: string): string {
  let h = decodeURIComponent(handle)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  // Strip duplicate-product suffixes in any order.
  for (let prev = ""; prev !== h;) {
    prev = h;
    h = h.replace(/-copy$/, "").replace(/-\d{1,3}$/, "");
  }
  return h;
}

export function landingKey(rawUrl: string | null | undefined): LandingKey | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (/(^|\.)(facebook|instagram|fb|messenger)\.(com|me)$/.test(host)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const normalizedUrl = `https://${host}${url.pathname.replace(/\/+$/, "")}`;

  // Shopify product pages, possibly under a collection or locale prefix.
  const productsAt = segments.lastIndexOf("products");
  if (productsAt !== -1 && segments[productsAt + 1]) {
    const handle = normalizeHandle(segments[productsAt + 1]);
    if (handle) return { key: `handle:${handle}`, host, handle, url: normalizedUrl };
  }

  const prefixAt = segments.findIndex((s) => PRODUCT_PREFIXES.has(s.toLowerCase()));
  if (prefixAt !== -1 && segments[prefixAt + 1]) {
    const path = segments
      .slice(prefixAt, prefixAt + 2)
      .join("/")
      .toLowerCase();
    return { key: `url:${host}/${path}`, host, handle: null, url: normalizedUrl };
  }
  return null;
}

/** "instant-posture-corrector" → "Instant Posture Corrector". */
export function titleFromHandle(handle: string): string {
  return handle
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
