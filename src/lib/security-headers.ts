/**
 * Response headers for every route (ADR-010). The site is private (ADR-008), so it also asks
 * search engines not to index it.
 *
 * No full Content-Security-Policy yet: the inline theme script would need a per-request nonce,
 * which makes every page dynamic. `frame-ancestors` alone covers clickjacking.
 */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Links go to ad libraries and other stores; do not tell them where visitors came from.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];
