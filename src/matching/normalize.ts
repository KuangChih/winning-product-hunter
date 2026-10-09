/** Words that describe the offer, not the product, and would make unrelated items look alike. */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "for",
  "with",
  "of",
  "in",
  "on",
  "to",
  "new",
  "hot",
  "sale",
  "free",
  "shipping",
  "limited",
  "stock",
  "today",
  "only",
  "best",
  "seller",
  "offer",
  "deal",
  "pcs",
  "pc",
  "set",
]);

function singularize(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.endsWith("ss") || token.endsWith("us")) return token;
  if (token.endsWith("s")) return token.slice(0, -1);
  return token;
}

/** Lowercased, punctuation-free, de-pluralized content tokens of a product title. */
export function titleTokens(title: string): Set<string> {
  const tokens = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t) && !/^\d+$/.test(t))
    .map(singularize);
  return new Set(tokens);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Share of `needle` tokens present in `haystack` (1 = all keyword tokens appear). */
export function containment(needle: Set<string>, haystack: Set<string>): number {
  if (needle.size === 0) return 0;
  let hit = 0;
  for (const t of needle) if (haystack.has(t)) hit++;
  return hit / needle.size;
}

export function slugify(title: string): string {
  return (
    title
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "product"
  );
}
