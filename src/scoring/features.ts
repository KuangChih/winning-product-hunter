import type { Source } from "@/ingestion/types";
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
  /** New ads + new advertisers in the last 14 days. */
  newAdActivity14d: number | null;
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

export function extractFeatures(items: ItemInput[], firstSeenAt: Date, now: Date): ProductFeatures {
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
    newAdActivity14d = newAds + newAdvertisers;
  }

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
    trendSlope,
    marketplaceOrders: orders.length ? Math.max(...orders) : null,
    supplierPriceCents: prices.length ? Math.min(...prices) : null,
    ageDays: Math.max(0, (now.getTime() - earliest) / DAY),
    sources: [...new Set(items.map((i) => i.source))].sort(),
  };
}
