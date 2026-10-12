/**
 * CJ Dropshipping discovery rules (ADR-014): which CJ products are worth a detail request and
 * which become tracked products. Thresholds were set from real CJ answers (2026-10-11, see
 * docs/research/cj-api.md) and are meant to be re-tuned with back-testing.
 */
import {
  parseCjPriceCents,
  parseCjImages,
  parseCjVariants,
  type CjListProduct,
  type CjProductDetail,
} from "@/ingestion/sources/cj";
import type { CjCandidate } from "@/pipeline/runner/types";

const DAY = 86_400_000;

export const CJ_RULES = {
  /**
   * A product is tracked when CJ reports at least this many orders under it (CJ's own count;
   * the period is not published, see the research note)…
   */
  minOrders: 50,
  /** …and its latest paid order is this recent (it is still selling, not a past hit). */
  maxDaysSinceLastOrder: 30,
};

/** Product key of a CJ product (`products.landing_key`, see ADR-014). */
export function cjProductKey(id: string): string {
  return `cj:${id}`;
}

/**
 * New products a keyword search may add for detail requests (user rule 2026-10-11: only CJ's
 * verifiable sales count). CJ's lists cannot be sorted by sales: its "trending" list is CJ's own
 * pick (possibly what CJ wants sold) and the listing count is not sales, so neither selects
 * candidates. A keyword's best-match results (relevance only) all get a detail request (0
 * points, paced 1.5 s), and the detail's order count and latest paid order decide.
 */
export const CJ_TAKE = {
  /** Every on-sale product of the first 40 best-match results (user decision 2026-10-12). */
  keyword: 40,
  keywordWindow: 40,
};

/**
 * Adds the on-sale products of one keyword answer, in CJ's best-match order (relevance, not
 * popularity), to the candidates: at most `take` new ones from the first `window` results, and
 * never more than `max` candidates in all. A product found again only notes the request that
 * found it. The listing count plays no part (it is not sales).
 */
export function addCandidates(
  existing: CjCandidate[],
  products: CjListProduct[],
  foundBy: string,
  { take, window = Infinity, max }: { take: number; window?: number; max: number },
): CjCandidate[] {
  const out = existing.map((c) => ({ ...c, foundBy: [...c.foundBy] }));
  const byId = new Map(out.map((c) => [c.id, c]));
  const qualifying = products.slice(0, window).filter(
    (p) =>
      !!p.id &&
      !!p.nameEn &&
      // "3" = on sale; anything else cannot be sold now.
      (p.saleStatus === undefined || p.saleStatus === "3"),
  );
  let added = 0;
  for (const p of qualifying) {
    const prev = byId.get(p.id);
    if (prev) {
      if (!prev.foundBy.includes(foundBy)) prev.foundBy.push(foundBy);
      continue;
    }
    if (added >= take || out.length >= max) continue;
    added++;
    const c: CjCandidate = {
      id: p.id,
      title: p.nameEn.trim(),
      imageUrl: p.bigImage ?? null,
      priceCents: parseCjPriceCents(p.nowPrice ?? p.sellPrice) ?? null,
      listedNum: typeof p.listedNum === "number" ? p.listedNum : null,
      createAt: typeof p.createAt === "number" ? p.createAt : null,
      category: p.threeCategoryName ?? null,
      foundBy: [foundBy],
      detail: null,
    };
    out.push(c);
    byId.set(c.id, c);
  }
  return out;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function candidateDetail(d: CjProductDetail): NonNullable<CjCandidate["detail"]> {
  return {
    listed: num(d.listed),
    soldOut: num(d.soldOut),
    orderCount: num(d.orderCount),
    totalQuantity: num(d.totalQuantity),
    totalRefundQuantity: num(d.totalRefundQuantity),
    latestPaymentDate: num(d.latestPaymentDate),
    createdAt: d.createdate && /^\d+$/.test(d.createdate) ? Number(d.createdate) : null,
    variants: parseCjVariants(d),
    images: parseCjImages(d),
  };
}

/**
 * Worth tracking: CJ's documented 90-day sales, or its order count, reach `minOrders`, with a
 * recent paid order. Products without a detail answer are never tracked (no sales evidence).
 */
export function isCjPromising(c: CjCandidate, now: Date): boolean {
  const d = c.detail;
  if (!d) return false;
  const sold = d.soldOut ?? d.orderCount;
  if (sold === null || sold < CJ_RULES.minOrders) return false;
  if (d.latestPaymentDate === null) return false;
  return now.getTime() - d.latestPaymentDate <= CJ_RULES.maxDaysSinceLastOrder * DAY;
}
