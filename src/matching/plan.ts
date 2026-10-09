import type { SourceItemKind } from "@/ingestion/types";
import { containment, jaccard, slugify, titleTokens } from "./normalize";

export interface ProductRef {
  id: string;
  slug: string;
  title: string;
}

export interface UnmatchedItem {
  id: string;
  kind: SourceItemKind;
  title: string | null;
  imageUrl: string | null;
  firstSeenAt: Date;
}

export interface NewProduct {
  /** Temporary key used by assignments until the product is inserted. */
  key: string;
  slug: string;
  title: string;
  imageUrl: string | null;
  firstSeenAt: Date;
}

export interface Assignment {
  itemId: string;
  /** Existing product id, or the key of a product in `newProducts`. */
  productRef: { existing: string } | { created: string };
  similarity: number;
}

export interface MatchPlan {
  newProducts: NewProduct[];
  assignments: Assignment[];
  unmatched: string[];
}

export const MATCH_THRESHOLDS = {
  /** Minimum title Jaccard for an ad/listing to join an existing product. */
  title: 0.6,
  /** Share of a trend keyword's tokens that must appear in the product title. */
  keyword: 1,
};

interface Candidate {
  ref: Assignment["productRef"];
  tokens: Set<string>;
}

/**
 * Entity resolution v0 (text only, see ADR-004): ads and listings join the most similar
 * product by title or create one; trend keywords attach to a product whose title contains
 * every keyword token. Items that can't be placed are left unmatched rather than guessed.
 */
export function planMatches(products: ProductRef[], items: UnmatchedItem[]): MatchPlan {
  const candidates: Candidate[] = products.map((p) => ({
    ref: { existing: p.id },
    tokens: titleTokens(p.title),
  }));
  const usedSlugs = new Set(products.map((p) => p.slug));
  const plan: MatchPlan = { newProducts: [], assignments: [], unmatched: [] };

  const sorted = [...items].sort(
    (a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime() || a.id.localeCompare(b.id),
  );
  const [trends, others] = [
    sorted.filter((i) => i.kind === "trend"),
    sorted.filter((i) => i.kind !== "trend"),
  ];

  for (const item of others) {
    const tokens = titleTokens(item.title ?? "");
    if (tokens.size === 0) {
      plan.unmatched.push(item.id);
      continue;
    }
    let best: { c: Candidate; score: number } | undefined;
    for (const c of candidates) {
      const score = jaccard(tokens, c.tokens);
      if (score >= MATCH_THRESHOLDS.title && (!best || score > best.score)) best = { c, score };
    }
    if (best) {
      plan.assignments.push({ itemId: item.id, productRef: best.c.ref, similarity: best.score });
      continue;
    }
    const title = item.title!.trim();
    let slug = slugify(title);
    for (let n = 2; usedSlugs.has(slug); n++) slug = `${slugify(title)}-${n}`;
    usedSlugs.add(slug);
    const key = `new:${plan.newProducts.length}`;
    plan.newProducts.push({
      key,
      slug,
      title,
      imageUrl: item.imageUrl,
      firstSeenAt: item.firstSeenAt,
    });
    candidates.push({ ref: { created: key }, tokens });
    plan.assignments.push({ itemId: item.id, productRef: { created: key }, similarity: 1 });
  }

  for (const item of trends) {
    const tokens = titleTokens(item.title ?? "");
    let best: { c: Candidate; score: number } | undefined;
    for (const c of candidates) {
      if (containment(tokens, c.tokens) < MATCH_THRESHOLDS.keyword) continue;
      // Prefer the product whose title is closest to the keyword (most specific match).
      const score = jaccard(tokens, c.tokens);
      if (!best || score > best.score) best = { c, score };
    }
    if (best) plan.assignments.push({ itemId: item.id, productRef: best.c.ref, similarity: 1 });
    else plan.unmatched.push(item.id);
  }

  return plan;
}
