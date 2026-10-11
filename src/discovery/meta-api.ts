/**
 * Products from the official Meta Ad Library API (ADR-015). The API has no landing page URL, so
 * ads are grouped by what every ad card does show: the link caption (the domain shown in the
 * call-to-action section) and the link title. Groups pass the same `DISCOVERY_RULES` as the
 * website's ads. A group is attached to a product found on the Ad Library website only when it
 * is the same store and clearly the same title; when in doubt it stays separate.
 */
import { and, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { products, sourceItems } from "@/db/schema";
import { AD_LIBRARY_PROVIDER } from "@/pipeline/runner/guards";
import type { FetchedItem } from "@/ingestion/types";
import { jaccard, slugify, titleTokens } from "@/matching/normalize";
import { isPromisingAds } from "./discover";
import { normalizeHandle } from "./landing";

export const META_API_RULES = {
  /** A link title needs at least this many content words to name a product. */
  minTitleTokens: 2,
  /** Title similarity (word Jaccard) needed to attach a group to a website-found product. */
  attachMinJaccard: 0.6,
};

/** Product key of an official-API group (`products.landing_key`). */
export function metaApiProductKey(domain: string, title: string): string {
  return `meta-api:${domain}|${title}`;
}

/** Link-title texts that are calls to action or offers, not product names. */
const GENERIC_TITLES = new Set([
  "shop now",
  "buy now",
  "order now",
  "learn more",
  "get yours",
  "get yours now",
  "get offer",
  "get it now",
  "sign up",
  "free shipping",
  "limited offer",
  "limited time offer",
  "shop the sale",
  "see more",
  "discover more",
  "click here",
]);

/** Domains that are not a store (social networks, link shorteners, messengers). */
const NOT_A_STORE =
  /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|messenger\.com|m\.me|whatsapp\.com|wa\.me|threads\.net|tiktok\.com|youtube\.com|linktr\.ee|bit\.ly)$/;

/**
 * The store domain a link caption shows ("WWW.EXAMPLE.CO.UK", "example.com/products/x"); null
 * when the caption is not a plain domain (free text, an app store name…).
 */
export function captionDomain(caption: string | null | undefined): string | null {
  if (!caption) return null;
  const host = caption
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/?#\s]/)[0]
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host))
    return null;
  return NOT_A_STORE.test(host) ? null : host;
}

/**
 * The normalized link title ("Posture Corrector – 50% OFF!" → "posture corrector 50 off"), or
 * null when it cannot name a product: an unrendered template, a call to action, or fewer than
 * `minTitleTokens` content words.
 */
export function normalizeLinkTitle(title: string | null | undefined): string | null {
  if (!title || title.includes("{{")) return null;
  const text = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!text || GENERIC_TITLES.has(text)) return null;
  if (titleTokens(text).size < META_API_RULES.minTitleTokens) return null;
  return text;
}

interface ApiAdRaw {
  ad_creative_link_titles?: unknown;
  ad_creative_link_captions?: unknown;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

/**
 * The product an official-API ad shows: one store domain and one product title across all its
 * cards. Carousels or catalogs with several titles or domains are left out (ambiguous).
 */
export function apiAdProduct(
  item: FetchedItem,
): { domain: string; title: string; display: string } | null {
  if (item.kind !== "ad") return null;
  const raw = (item.raw ?? {}) as ApiAdRaw;
  const captions = strings(raw.ad_creative_link_captions);
  const titles = strings(raw.ad_creative_link_titles);
  const domains = new Set(captions.map(captionDomain));
  const normalized = new Set(titles.map(normalizeLinkTitle));
  if (domains.size !== 1 || normalized.size !== 1) return null;
  const [domain] = domains;
  const [title] = normalized;
  if (!domain || !title) return null;
  return { domain, title, display: titles[0].trim() };
}

export interface MetaApiGroup {
  key: string;
  domain: string;
  /** Normalized title (part of the key). */
  title: string;
  /** Product name to show: the most common original link title. */
  displayTitle: string;
  ads: FetchedItem[];
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/** Groups official-API ads by store domain + normalized link title (others are dropped). */
export function groupApiAds(items: FetchedItem[]): MetaApiGroup[] {
  const groups = new Map<
    string,
    { domain: string; title: string; ads: FetchedItem[]; shown: string[] }
  >();
  const seen = new Set<string>();
  for (const item of items) {
    // The same ad can come back from several keywords: count it once.
    if (seen.has(item.externalId)) continue;
    const p = apiAdProduct(item);
    if (!p) continue;
    seen.add(item.externalId);
    const key = metaApiProductKey(p.domain, p.title);
    const g = groups.get(key) ?? { domain: p.domain, title: p.title, ads: [], shown: [] };
    g.ads.push(item);
    g.shown.push(p.display);
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => ({
    key,
    domain: g.domain,
    title: g.title,
    displayTitle: mostCommon(g.shown),
    ads: g.ads,
  }));
}

export function isApiGroupPromising(group: MetaApiGroup, now: Date): boolean {
  return isPromisingAds(group.ads, now);
}

/** A product found on the Ad Library website, with the store hosts its ads link to. */
export interface WebProduct {
  id: string;
  title: string;
  /** `handle:<handle>` products: the Shopify handle. */
  handle: string | null;
  hosts: string[];
}

/**
 * The website-found product a group is clearly the same as: same store host, and the same
 * Shopify handle (decisive) or else a title with word Jaccard ≥ `attachMinJaccard`.
 * "ambiguous" when several products of that store qualify equally: the group is then neither
 * attached nor tracked on its own (it would duplicate one of them). Null when none qualifies.
 */
export function pickWebProduct(
  group: MetaApiGroup,
  candidates: WebProduct[],
): string | "ambiguous" | null {
  const store = candidates.filter((c) => c.hosts.includes(group.domain));
  const handle = normalizeHandle(slugify(group.title));
  const byHandle = [...new Set(store.filter((c) => c.handle === handle).map((c) => c.id))];
  if (byHandle.length === 1) return byHandle[0];
  if (byHandle.length > 1) return "ambiguous";
  const tokens = titleTokens(group.title);
  const similar = [
    ...new Set(
      store
        .filter((c) => jaccard(tokens, titleTokens(c.title)) >= META_API_RULES.attachMinJaccard)
        .map((c) => c.id),
    ),
  ];
  if (similar.length === 1) return similar[0];
  return similar.length > 1 ? "ambiguous" : null;
}

const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

const urlPatterns = (domain: string) =>
  ["https://", "http://", "https://www.", "http://www."].map(
    (p) => `${p}${domain.replace(/[\\%_]/g, "\\$&")}/%`,
  );

/**
 * Products found on the Ad Library website (not CJ, not the official API) whose product page or
 * whose website ads point at one of `domains`.
 */
export async function webProductsByDomain(
  db: AnyDatabase,
  domains: string[],
): Promise<WebProduct[]> {
  if (domains.length === 0) return [];
  const wanted = new Set(domains);
  const patterns = domains.flatMap(urlPatterns);
  const [byPage, byAds] = await Promise.all([
    db
      .select({ id: products.id, url: products.canonicalUrl })
      .from(products)
      .where(
        and(
          isNull(products.mergedInto),
          or(...patterns.map((p) => ilike(products.canonicalUrl, p))),
        ),
      ),
    db
      .select({
        id: sourceItems.productId,
        url: sql<string | null>`${sourceItems.raw}->>'landing_url'`,
      })
      .from(sourceItems)
      .where(
        and(
          eq(sourceItems.source, "meta_ads"),
          eq(sourceItems.provider, AD_LIBRARY_PROVIDER),
          eq(sourceItems.kind, "ad"),
          or(...patterns.map((p) => ilike(sql`${sourceItems.raw}->>'landing_url'`, p))),
        ),
      ),
  ]);
  const hosts = new Map<string, Set<string>>();
  for (const r of [...byPage, ...byAds]) {
    const host = hostOf(r.url);
    if (!r.id || !host || !wanted.has(host)) continue;
    hosts.set(r.id, (hosts.get(r.id) ?? new Set()).add(host));
  }
  if (hosts.size === 0) return [];
  const rows = await db
    .select({ id: products.id, title: products.title, key: products.landingKey })
    .from(products)
    .where(and(inArray(products.id, [...hosts.keys()]), isNull(products.mergedInto)));
  return rows
    .filter((r) => !r.key?.startsWith("cj:") && !r.key?.startsWith("meta-api:"))
    .map((r) => ({
      id: r.id,
      title: r.title,
      handle: r.key?.startsWith("handle:") ? r.key.slice("handle:".length) : null,
      hosts: [...hosts.get(r.id)!],
    }));
}

/**
 * Products the website records of the same ads (same Ad Library ID) are attached to: the
 * surest sign an official-API group is a product already found on the website.
 */
export async function webTwinProducts(
  db: AnyDatabase,
  libraryIds: string[],
): Promise<Map<string, string>> {
  if (libraryIds.length === 0) return new Map();
  const rows = await db
    .select({ externalId: sourceItems.externalId, productId: sourceItems.productId })
    .from(sourceItems)
    .where(
      and(
        eq(sourceItems.source, "meta_ads"),
        eq(sourceItems.provider, AD_LIBRARY_PROVIDER),
        inArray(sourceItems.externalId, libraryIds),
      ),
    );
  return new Map(rows.flatMap((r) => (r.productId ? [[r.externalId, r.productId]] : [])));
}
