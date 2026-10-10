import type { Source } from "@/ingestion/types";
import type { FxRates } from "@/lib/fx";
import { MARKETS, marketWeight } from "@/lib/markets";
import { marketRetailPrice, OWN_LISTING_PROVIDER } from "@/lib/retail-price";
import { median, robustZ, theilSenSlope } from "./stats";

const DAY = 86_400_000;

export interface ItemInput {
  source: Source;
  /** Who supplied it, e.g. "shopify_catalog_lookup" for the advertiser's own listing. */
  provider?: string;
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
  /**
   * Robust z-score of today's number of observed ads against the previous days (needs at
   * least `MOMENTUM_MIN_BASELINE_DAYS` days of history); null until then.
   */
  adMomentum: number | null;
  /** Days of ad history behind `adMomentum`. */
  adHistoryDays: number;
  /** 0–1: how many target markets have active ads, weighted by market tier. */
  marketReach: number | null;
  /** Distinct stores selling it (Shopify Global Catalog sellers). */
  sellingStores: number | null;
  /** The product's own retail price: the advertiser's store listing, in USD cents (ECB). */
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

/** Momentum needs at least this many earlier days of ad observations as a baseline. */
export const MOMENTUM_MIN_BASELINE_DAYS = 4;
export const MOMENTUM_MAX_BASELINE_DAYS = 14;

/**
 * Ads observed per collection day (UTC), for momentum: the counts of the latest
 * `MOMENTUM_MAX_BASELINE_DAYS + 1` days, oldest first, and how many days there are in all.
 */
export interface AdDays {
  recent: number[];
  total: number;
}

/** `AdDays` from the ads' snapshots (an ad counts once per day it has any snapshot). */
export function adDaysOf(ads: ItemInput[]): AdDays {
  const adsPerDay = new Map<string, Set<number>>();
  ads.forEach((a, idx) => {
    for (const s of a.snapshots) {
      const day = s.observedAt.toISOString().slice(0, 10);
      adsPerDay.set(day, (adsPerDay.get(day) ?? new Set()).add(idx));
    }
  });
  const daily = [...adsPerDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, s]) => s.size);
  return { recent: daily.slice(-1 - MOMENTUM_MAX_BASELINE_DAYS), total: daily.length };
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
  /**
   * Ad observation days computed elsewhere (e.g. in SQL, see src/scoring/run.ts); by default
   * from the ads' snapshots, which must then hold every snapshot.
   */
  adDays?: AdDays,
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

  // Momentum: ads seen per collection day (from their daily snapshots), latest day vs baseline.
  const days = adDays ?? adDaysOf(ads);
  const daily = days.recent.slice(-1 - MOMENTUM_MAX_BASELINE_DAYS);
  const adMomentum =
    days.total > MOMENTUM_MIN_BASELINE_DAYS && daily.length > 0
      ? robustZ(daily[daily.length - 1], daily.slice(0, -1))
      : null;

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
  // Only the advertiser's own listing is this product; search results are similar products.
  const retail = marketRetailPrice(
    storeProducts
      .filter((s) => s.provider === OWN_LISTING_PROVIDER)
      .flatMap((s) =>
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
    adMomentum,
    adHistoryDays: days.total,
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
