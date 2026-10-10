import type { Source } from "@/ingestion/types";
import type { FxRates } from "@/lib/fx";
import { MARKETS, marketWeight } from "@/lib/markets";
import { marketRetailPrice } from "@/lib/retail-price";
import { median, theilSenSlope } from "./stats";

const DAY = 86_400_000;

export interface ItemInput {
  source: Source;
  kind: string;
  advertiserId: string | null;
  format: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  priceCents: number | null;
  currency: string | null;
  /** ISO countries the item applies to. */
  countries: string[];
  /** Snapshots for this item, any order. */
  snapshots: Array<{ metric: string; value: number; observedAt: Date }>;
}

/**
 * Raw, un-normalized evidence for one product. `null` means the product has no data for
 * that signal; it must not be treated as zero (ADR-002).
 */
export interface ProductFeatures {
  /** 0–1 already: saturating function of how long the longest-running ads have been live. */
  longevity: number | null;
  activeAds: number;
  activeAdvertisers: number;
  /**
   * New ads + new advertisers in the last 14 days, plus half a point per extra ad sharing a
   * creative (advertisers duplicate creatives that work).
   */
  newAdActivity14d: number | null;
  /** 0–1: how many target markets have active ads, weighted by market tier. */
  marketReach: number | null;
  /** Distinct stores selling it (Shopify Global Catalog sellers). */
  sellingStores: number | null;
  /** Median retail price across stores, in USD cents (converted with ECB rates). */
  retailUsdCents: number | null;
  /** Theil-Sen slope of search interest per week, relative to the series median. */
  trendSlope: number | null;
  /** Latest recent-orders count on the marketplace. */
  marketplaceOrders: number | null;
  supplierPriceCents: number | null;
  /** Days since the earliest observation of this product anywhere. */
  ageDays: number;
  sources: Source[];
}

/** τ (days) per creative format: static ads naturally live longer than video (scoring.md). */
const LONGEVITY_TAU: Record<string, number> = { video: 30, image: 60, carousel: 45 };
const DEFAULT_TAU = 45;

function latest(snapshots: ItemInput["snapshots"], metric: string): number | null {
  let best: { value: number; t: number } | null = null;
  for (const s of snapshots) {
    if (s.metric !== metric) continue;
    const t = s.observedAt.getTime();
    if (!best || t > best.t) best = { value: s.value, t };
  }
  return best?.value ?? null;
}

/** Sum of tier weights of the five priority markets: full reach = active ads in all five. */
const FULL_REACH = MARKETS.filter((m) => m.tier === 1).reduce(
  (s, m) => s + marketWeight(m.code),
  0,
);

export function extractFeatures(
  items: ItemInput[],
  firstSeenAt: Date,
  now: Date,
  fx: FxRates | null = null,
): ProductFeatures {
  const ads = items.filter((i) => i.kind === "ad" && i.startedAt);
  const active = ads.filter((a) => !a.endedAt || a.endedAt > now);

  let longevity: number | null = null;
  if (ads.length > 0) {
    const values = ads
      .map((a) => {
        const end = a.endedAt && a.endedAt < now ? a.endedAt : now;
        const days = Math.max(0, (end.getTime() - a.startedAt!.getTime()) / DAY);
        const tau = LONGEVITY_TAU[a.format ?? ""] ?? DEFAULT_TAU;
        // Stopped ads count at half weight: they survived, but the advertiser gave up.
        return (1 - Math.exp(-days / tau)) * (a.endedAt && a.endedAt <= now ? 0.5 : 1);
      })
      .sort((x, y) => y - x)
      .slice(0, 3);
    longevity = values.reduce((s, v) => s + v, 0) / values.length;
  }

  let newAdActivity14d: number | null = null;
  if (ads.length > 0) {
    const cutoff = now.getTime() - 14 * DAY;
    const newAds = ads.filter((a) => a.startedAt!.getTime() >= cutoff).length;
    const firstAdByAdvertiser = new Map<string, number>();
    for (const a of ads) {
      if (!a.advertiserId) continue;
      const t = a.startedAt!.getTime();
      firstAdByAdvertiser.set(
        a.advertiserId,
        Math.min(t, firstAdByAdvertiser.get(a.advertiserId) ?? t),
      );
    }
    const newAdvertisers = [...firstAdByAdvertiser.values()].filter((t) => t >= cutoff).length;
    const duplicatedCreatives = active.reduce((sum, a) => {
      const variants = latest(a.snapshots, "creative_variants") ?? 1;
      return sum + Math.max(0, variants - 1);
    }, 0);
    newAdActivity14d = newAds + newAdvertisers + 0.5 * duplicatedCreatives;
  }

  let marketReach: number | null = null;
  if (ads.length > 0) {
    const countries = new Set(active.flatMap((a) => a.countries));
    const reach = [...countries].reduce((s, c) => s + marketWeight(c), 0);
    marketReach = Math.min(1, reach / FULL_REACH);
  }

  const storeProducts = items.filter((i) => i.kind === "store_product");
  const sellingStores = storeProducts.length
    ? new Set(storeProducts.map((s) => s.advertiserId).filter(Boolean)).size
    : null;
  const retail = marketRetailPrice(
    storeProducts.flatMap((s) =>
      s.priceCents === null ? [] : [{ priceCents: s.priceCents, currency: s.currency }],
    ),
    "US",
    fx,
  );

  let trendSlope: number | null = null;
  const trendPoints = items
    .filter((i) => i.kind === "trend")
    .flatMap((i) => i.snapshots.filter((s) => s.metric === "search_interest"))
    .map((s) => ({ x: s.observedAt.getTime() / (7 * DAY), y: s.value }));
  if (trendPoints.length >= 4) {
    const base = Math.max(1, median(trendPoints.map((p) => p.y)));
    trendSlope = theilSenSlope(trendPoints) / base;
  }

  const listings = items.filter((i) => i.kind === "listing");
  const orders = listings
    .map((l) => latest(l.snapshots, "units_sold_90d"))
    .filter((v): v is number => v !== null);
  const prices = listings.map((l) => l.priceCents).filter((v): v is number => v !== null);

  // Ads often predate our first crawl, so a product is as old as its oldest ad.
  const earliest = Math.min(firstSeenAt.getTime(), ...ads.map((a) => a.startedAt!.getTime()));

  return {
    longevity,
    activeAds: active.length,
    activeAdvertisers: new Set(active.map((a) => a.advertiserId).filter(Boolean)).size,
    newAdActivity14d,
    marketReach,
    sellingStores,
    retailUsdCents: retail?.medianCents ?? null,
    trendSlope,
    marketplaceOrders: orders.length ? Math.max(...orders) : null,
    supplierPriceCents: prices.length ? Math.min(...prices) : null,
    ageDays: Math.max(0, (now.getTime() - earliest) / DAY),
    sources: [...new Set(items.map((i) => i.source))].sort(),
  };
}
