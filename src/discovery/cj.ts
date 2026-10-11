/**
 * CJ Dropshipping discovery rules (ADR-014): which CJ products are worth a detail request and
 * which become tracked products. Thresholds were set from real CJ answers (2026-10-11, see
 * docs/research/cj-api.md) and are meant to be re-tuned with back-testing.
 */
import {
  parseCjPriceCents,
  parseCjVariants,
  type CjListProduct,
  type CjProductDetail,
} from "@/ingestion/sources/cj";
import type { CjCandidate } from "@/pipeline/runner/types";

const DAY = 86_400_000;

export const CJ_RULES = {
  /** A list product needs at least this many CJ users listing it to get a detail request. */
  minListedForDetail: 50,
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
 * New products a request may add for detail requests (the run's detail budget is shared).
 * Measured 2026-10-11 (docs/research/cj-api.md): the most-listed products of CJ's trending list
 * and of a keyword search led to 13 tracked products out of 40 details; CJ's best match plus a
 * "listed in the last 365 days" trending filter led to 3 out of 36 (mostly products without
 * orders). Recency comes from the order rule (`maxDaysSinceLastOrder`), not from the lists.
 */
export const CJ_TAKE = {
  trending: 10,
  keyword: 3,
  /** Most-listed results of a keyword drift off topic further down; look at the first 20. */
  keywordWindow: 20,
};

/**
 * Adds the most-listed qualifying products of one list answer (on sale, listed by at least
 * `minListedForDetail` CJ users) to the candidates: at most `take` new ones from the first
 * `window` results, and never more than `max` candidates in all. A product found again only
 * notes the request that found it.
 */
export function addCandidates(
  existing: CjCandidate[],
  products: CjListProduct[],
  foundBy: string,
  { take, window = Infinity, max }: { take: number; window?: number; max: number },
): CjCandidate[] {
  const out = existing.map((c) => ({ ...c, foundBy: [...c.foundBy] }));
  const byId = new Map(out.map((c) => [c.id, c]));
  const qualifying = products
    .slice(0, window)
    .filter(
      (p) =>
        !!p.id &&
        !!p.nameEn &&
        // "3" = on sale; anything else cannot be sold now.
        (p.saleStatus === undefined || p.saleStatus === "3") &&
        typeof p.listedNum === "number" &&
        p.listedNum >= CJ_RULES.minListedForDetail,
    )
    .sort((a, b) => b.listedNum! - a.listedNum! || a.id.localeCompare(b.id));
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
      listedNum: p.listedNum!,
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
