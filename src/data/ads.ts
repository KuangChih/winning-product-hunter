import { and, arrayContains, count, eq, gt, ilike, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { products, sourceItems } from "@/db/schema";
import { isTargetMarket } from "@/lib/markets";

/** Sources that produce ads, in the order shown in the platform filter. */
export const AD_PLATFORMS = [
  "meta_ads",
  "tiktok_ads",
  "tiktok_creative_center",
  "google_ads",
] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export type AdStatus = "active" | "stopped";
/** longest: running the longest first (the strongest profitability signal); newest: just launched. */
export type AdSort = "longest" | "newest" | "last_seen";
const SORTS: AdSort[] = ["longest", "newest", "last_seen"];

export const AD_PAGE_SIZE = 50;

export interface AdFilters {
  /** Every word must appear in the ad title or advertiser name (case-insensitive). */
  q?: string;
  /** ISO country the ad runs in. */
  market?: string;
  platform?: AdPlatform;
  status?: AdStatus;
  sort?: AdSort;
  /** 1-based page number. */
  page?: number;
}

export interface AdQueryOptions extends AdFilters {
  /**
   * Include sample (fixture) ads: for tests that seed fixtures only. The website never passes
   * it (sample data is never shown).
   */
  includeSample?: boolean;
  now?: Date;
}

export interface AdListItem {
  id: string;
  source: string;
  provider: string;
  title: string | null;
  url: string | null;
  imageUrl: string | null;
  advertiserName: string | null;
  /** Where the ad sends people (the store's page), from the source's raw payload. */
  landingUrl: string | null;
  countries: string[];
  format: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  lastSeenAt: Date;
  /** The product this ad was matched to, if any. */
  product: { slug: string; title: string } | null;
}

export interface AdPage {
  ads: AdListItem[];
  total: number;
  page: number;
  pageCount: number;
}

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Parses ad browser search params; unknown or invalid values fall back to defaults. */
export function parseAdParams(
  params: Params,
): Required<Pick<AdFilters, "sort" | "page">> & AdFilters {
  const market = first(params.market)?.toUpperCase();
  const platform = first(params.platform) as AdPlatform | undefined;
  const status = first(params.status);
  const sort = first(params.sort) as AdSort | undefined;
  const page = Math.floor(Number(first(params.page)));
  return {
    q: first(params.q)?.trim() || undefined,
    market: market && isTargetMarket(market) ? market : undefined,
    platform: platform && AD_PLATFORMS.includes(platform) ? platform : undefined,
    status: status === "active" || status === "stopped" ? status : undefined,
    sort: sort && SORTS.includes(sort) ? sort : "longest",
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/** Escapes LIKE wildcards so a search for "100%" matches literally. */
function likeTerm(word: string) {
  return `%${word.replace(/[\\%_]/g, "\\$&")}%`;
}

/** Ads across platforms, filtered, sorted and paginated in the database. */
export async function getAds(db: AnyDatabase, options: AdQueryOptions = {}): Promise<AdPage> {
  const { q, market, platform, status, sort = "longest", includeSample = false } = options;
  const now = options.now ?? new Date();
  const page = Math.max(1, options.page ?? 1);

  const words = (q ?? "").split(/\s+/).filter(Boolean);
  const where = and(
    eq(sourceItems.kind, "ad"),
    includeSample ? undefined : ne(sourceItems.provider, "fixture"),
    // An official-API record of an ad already collected from the website is the same ad
    // (ADR-015): list it once.
    sql`not (${sourceItems.provider} = 'ad_library_api' and exists (
      select 1 from source_items w
      where w.source = ${sourceItems.source} and w.provider = 'ad_library_web'
        and 'api|' || w.external_id = ${sourceItems.externalId}))`,
    platform ? eq(sourceItems.source, platform) : undefined,
    market ? arrayContains(sourceItems.countries, [market]) : undefined,
    status === "active"
      ? or(isNull(sourceItems.endedAt), gt(sourceItems.endedAt, now))
      : status === "stopped"
        ? lte(sourceItems.endedAt, now)
        : undefined,
    ...words.map((w) =>
      or(ilike(sourceItems.title, likeTerm(w)), ilike(sourceItems.advertiserName, likeTerm(w))),
    ),
  );

  const order = {
    longest: [sql`${sourceItems.startedAt} asc nulls last`, sql`${sourceItems.id}`],
    newest: [sql`${sourceItems.startedAt} desc nulls last`, sql`${sourceItems.id}`],
    last_seen: [sql`${sourceItems.lastSeenAt} desc`, sql`${sourceItems.id}`],
  }[sort];

  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(sourceItems).where(where),
    db
      // Explicit columns: the raw payload is large and only its landing URL is shown.
      .select({
        item: {
          id: sourceItems.id,
          source: sourceItems.source,
          provider: sourceItems.provider,
          title: sourceItems.title,
          url: sourceItems.url,
          imageUrl: sourceItems.imageUrl,
          advertiserName: sourceItems.advertiserName,
          landingUrl: sql<string | null>`${sourceItems.raw}->>'landing_url'`,
          countries: sourceItems.countries,
          format: sourceItems.format,
          startedAt: sourceItems.startedAt,
          endedAt: sourceItems.endedAt,
          lastSeenAt: sourceItems.lastSeenAt,
        },
        productSlug: products.slug,
        productTitle: products.title,
      })
      .from(sourceItems)
      .leftJoin(products, eq(sourceItems.productId, products.id))
      .where(where)
      .orderBy(...order)
      .limit(AD_PAGE_SIZE)
      .offset((page - 1) * AD_PAGE_SIZE),
  ]);

  return {
    ads: rows.map(({ item, productSlug, productTitle }) => ({
      id: item.id,
      source: item.source,
      provider: item.provider,
      title: item.title,
      url: item.url,
      imageUrl: item.imageUrl,
      advertiserName: item.advertiserName,
      landingUrl: item.landingUrl,
      countries: item.countries,
      format: item.format,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      lastSeenAt: item.lastSeenAt,
      product: productSlug && productTitle ? { slug: productSlug, title: productTitle } : null,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / AD_PAGE_SIZE)),
  };
}
