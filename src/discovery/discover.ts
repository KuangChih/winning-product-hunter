import { inArray } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { products } from "@/db/schema";
import { runIngestion, type AdapterMeta, type IngestionResult } from "@/ingestion/run";
import type { FetchedItem, SourceAdapter } from "@/ingestion/types";
import { slugify } from "@/matching/normalize";
import { landingKey, titleFromHandle, type LandingKey } from "./landing";

const DAY = 86_400_000;

export interface DiscoveryGroup {
  landing: LandingKey;
  title: string;
  ads: FetchedItem[];
  /** Distinct store hosts advertising this product. */
  stores: string[];
}

/** Thresholds for turning a group of ads into a tracked product (tunable after back-testing). */
export const DISCOVERY_RULES = {
  /** At least this many ads point at the product… */
  minAds: 2,
  /** …or one ad is reused in this many creatives… */
  minCreativeVariants: 2,
  /** …or one ad has been running at least this long. */
  minRunningDays: 14,
};

function landingOf(item: FetchedItem): LandingKey | null {
  const raw = item.raw as { landing_url?: string | null } | null;
  return landingKey(raw?.landing_url);
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Groups ads by product landing page (ads without a product page are dropped). */
export function groupAdsByLanding(items: FetchedItem[]): DiscoveryGroup[] {
  const groups = new Map<string, { landing: LandingKey; ads: FetchedItem[] }>();
  for (const item of items) {
    if (item.kind !== "ad") continue;
    const landing = landingOf(item);
    if (!landing) continue;
    const g = groups.get(landing.key) ?? { landing, ads: [] };
    g.ads.push(item);
    groups.set(landing.key, g);
  }
  return [...groups.values()].map(({ landing, ads }) => {
    const stores = [...new Set(ads.map((a) => landingOf(a)?.host).filter((h): h is string => !!h))];
    // Ignore unrendered templates such as "{{product.name}}".
    const adTitle = mostCommon(
      ads.map((a) => a.title?.trim() ?? "").filter((t) => t.length > 0 && !t.includes("{{")),
    );
    // A Shopify handle is a cleaner product name than ad copy ("Shop now!", emoji...).
    const title = landing.handle ? titleFromHandle(landing.handle) : (adTitle ?? landing.host);
    return { landing, title, ads, stores };
  });
}

export function isPromising(group: DiscoveryGroup, now: Date): boolean {
  return isPromisingAds(group.ads, now);
}

/** The `DISCOVERY_RULES` test on the ads of one product (any grouping). */
export function isPromisingAds(ads: FetchedItem[], now: Date): boolean {
  if (ads.length >= DISCOVERY_RULES.minAds) return true;
  return ads.some((ad) => {
    const variants = ad.metrics.find((m) => m.metric === "creative_variants")?.value ?? 1;
    const days = ad.startedAt ? (now.getTime() - ad.startedAt.getTime()) / DAY : 0;
    return (
      variants >= DISCOVERY_RULES.minCreativeVariants || days >= DISCOVERY_RULES.minRunningDays
    );
  });
}

export interface DiscoveryResult {
  adsFetched: number;
  groups: number;
  productsCreated: number;
  productsUpdated: number;
  ingestion: IngestionResult;
}

/** Runs the ad source over the queries, keeping what arrived before any failure. */
export async function fetchDiscoveryItems(
  adapter: SourceAdapter,
  queries: string[],
  signal?: AbortSignal,
): Promise<{ items: FetchedItem[]; failure?: unknown }> {
  const items: FetchedItem[] = [];
  try {
    for await (const item of adapter.fetch({ queries, limit: 10_000, signal })) {
      items.push(item);
    }
    // Adapters stop quietly on abort; a cut-short sweep must not look complete.
    signal?.throwIfAborted();
  } catch (err) {
    // The caller stopped us (e.g. a time budget): not a source failure.
    if (signal?.aborted) throw err;
    return { items, failure: err };
  }
  return { items };
}

async function productIdsByLandingKey(db: AnyDatabase, keys: string[]) {
  const rows = keys.length
    ? await db
        .select({
          id: products.id,
          landingKey: products.landingKey,
          mergedInto: products.mergedInto,
        })
        .from(products)
        .where(inArray(products.landingKey, keys))
    : [];
  // A merged duplicate's landing key keeps pointing at the product it was merged into.
  return new Map(rows.map((p) => [p.landingKey!, p.mergedInto ?? p.id]));
}

/**
 * Groups fetched ads by landing page, tracks promising groups as products and stores the ads
 * attached to their product; keyword-level items (e.g. active ad counts) are stored
 * unattached. Everything fetched is stored even when the fetch failed part-way; the ingestion
 * run is then recorded as failed.
 */
export async function storeDiscovery(
  db: AnyDatabase,
  meta: AdapterMeta,
  queries: string[],
  fetched: FetchedItem[],
  failure: unknown,
  now: Date,
  opts: { pipelineRunId?: number; ingestionRunId?: number } = {},
): Promise<DiscoveryResult> {
  const groups = groupAdsByLanding(fetched).filter((g) => isPromising(g, now));
  const idByKey = await productIdsByLandingKey(
    db,
    groups.map((g) => g.landing.key),
  );

  const usedSlugs = new Set(
    (await db.select({ slug: products.slug }).from(products)).map((p) => p.slug),
  );
  const toCreate = groups.filter((g) => !idByKey.has(g.landing.key));
  let productsCreated = 0;
  if (toCreate.length > 0) {
    // Another process may create the same product meanwhile: skip landing-key conflicts, then
    // re-read. A slug clash still throws, so a group is never dropped silently.
    const inserted = await db
      .insert(products)
      .values(
        toCreate.map((g) => {
          let slug = slugify(g.title);
          for (let n = 2; usedSlugs.has(slug); n++) slug = `${slugify(g.title)}-${n}`;
          usedSlugs.add(slug);
          const starts = g.ads.map((a) => a.startedAt?.getTime()).filter((t): t is number => !!t);
          return {
            slug,
            title: g.title,
            landingKey: g.landing.key,
            canonicalUrl: g.landing.url,
            imageUrl: g.ads.find((a) => a.imageUrl)?.imageUrl,
            firstSeenAt: new Date(Math.min(now.getTime(), ...starts)),
          };
        }),
      )
      .onConflictDoNothing({ target: products.landingKey })
      .returning({ id: products.id, landingKey: products.landingKey });
    productsCreated = inserted.length;
    for (const p of inserted) idByKey.set(p.landingKey!, p.id);
    const missing = toCreate.map((g) => g.landing.key).filter((k) => !idByKey.has(k));
    for (const [key, id] of await productIdsByLandingKey(db, missing)) idByKey.set(key, id);
  }

  const productIdByAd = new Map<string, string>();
  for (const g of groups) {
    const productId = idByKey.get(g.landing.key);
    if (!productId) continue;
    for (const ad of g.ads) productIdByAd.set(ad.externalId, productId);
  }
  // Keep ads that belong to a tracked product, plus keyword-level evidence.
  const toStore = fetched.flatMap((item) => {
    if (item.kind === "ad") {
      const productId = productIdByAd.get(item.externalId);
      return productId ? [{ ...item, productId }] : [];
    }
    return [item];
  });

  const ingestion = await runIngestion(
    db,
    {
      source: meta.source,
      provider: meta.provider,
      async *fetch() {
        yield* toStore;
        if (failure) throw failure;
      },
    },
    { queries, limit: toStore.length + 1 },
    () => now,
    { pipelineRunId: opts.pipelineRunId, runId: opts.ingestionRunId },
  );

  return {
    adsFetched: fetched.filter((i) => i.kind === "ad").length,
    groups: groups.length,
    productsCreated,
    productsUpdated: groups.length - toCreate.length,
    ingestion,
  };
}

/**
 * Sweeps keywords with an ad source, groups ads by landing page and tracks promising groups as
 * products (`fetchDiscoveryItems` + `storeDiscovery`). If the source blocks part-way,
 * everything collected so far is still stored and the run is recorded as failed.
 */
export async function runDiscovery(
  db: AnyDatabase,
  adapter: SourceAdapter,
  keywords: string[],
  now: Date = new Date(),
): Promise<DiscoveryResult> {
  const { items, failure } = await fetchDiscoveryItems(adapter, keywords);
  return storeDiscovery(db, adapter, keywords, items, failure, now);
}
