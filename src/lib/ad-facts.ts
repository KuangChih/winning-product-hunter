/** Facts derived from a product's ads (pure; shared by the detail page and the ad browser). */

const DAY_MS = 86_400_000;

export interface AdTiming {
  startedAt: Date | null;
  endedAt: Date | null;
}

/** Still running: no end date, or one in the future. */
export function isAdActive(ad: AdTiming, now: Date): boolean {
  return !ad.endedAt || ad.endedAt > now;
}

/** Whole days an ad has run (until now, or until it stopped); null without a start date. */
export function adRunDays(ad: AdTiming, now: Date): number | null {
  if (!ad.startedAt) return null;
  const end = isAdActive(ad, now) ? now : ad.endedAt!;
  return Math.max(0, Math.round((end.getTime() - ad.startedAt.getTime()) / DAY_MS));
}

/**
 * A link that is safe to open from our page: http(s) only, so a stored `javascript:` or `data:`
 * URL from a source can never run in our origin. Anything else gives null (no link).
 */
export function externalHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** "https://www.Shop.com/products/x" → "shop.com"; null when it is not a web URL. */
export function urlHost(url: string | null | undefined): string | null {
  const href = externalHref(url);
  return href ? new URL(href).hostname.toLowerCase().replace(/^www\./, "") : null;
}

/**
 * The same Meta ad can be stored twice: from the Ad Library website and from the official API
 * (ADR-015). Both records link to the same public Ad Library page, so source + link identify
 * the real ad. Keeps one record per real ad (the website's when there are both: it has the
 * format and the countries outside the UK/EU) and lists every provider that saw it; `merge`
 * combines a twin into the kept record.
 */
export function dedupeAdRecords<
  T extends { kind: string; source: string; url: string | null; provider?: string },
>(
  records: T[],
  merge: (kept: T, twin: T) => T = (kept) => kept,
): Array<T & { providers: string[] }> {
  const out: Array<T & { providers: string[] }> = [];
  const at = new Map<string, number>();
  const apiLast = (r: T) => (r.provider === "ad_library_api" ? 1 : 0);
  for (const r of [...records].sort((a, b) => apiLast(a) - apiLast(b))) {
    const key = r.kind === "ad" && r.url ? `${r.source}|${r.url}` : null;
    const i = key === null ? undefined : at.get(key);
    if (i === undefined) {
      if (key !== null) at.set(key, out.length);
      out.push({ ...r, providers: r.provider ? [r.provider] : [] });
      continue;
    }
    const kept = out[i];
    out[i] = {
      ...merge(kept, r),
      providers:
        r.provider && !kept.providers.includes(r.provider)
          ? [...kept.providers, r.provider]
          : kept.providers,
    };
  }
  return out;
}

export interface FactsAd extends AdTiming {
  kind: string;
  source: string;
  provider?: string;
  url: string | null;
  advertiserId: string | null;
  advertiserName: string | null;
  landingUrl: string | null;
  countries: string[];
}

export interface AdFacts {
  totalAds: number;
  activeAds: number;
  /** Distinct advertisers with an active ad (by advertiser id, like the scoring). */
  activeAdvertisers: number;
  /** Longest run of any ad in days; null when no ad has a start date. */
  longestRunDays: number | null;
  /** Hosts the ads send people to, most ads first. */
  landingDomains: string[];
  /** The longest-running active Meta ad with a link, to check at the source. */
  primaryAd: { url: string; days: number | null } | null;
}

export function adFacts(evidence: FactsAd[], now: Date): AdFacts {
  const ads = dedupeAdRecords(evidence.filter((e) => e.kind === "ad"));
  const active = ads.filter((a) => isAdActive(a, now));

  const runs = ads.map((a) => adRunDays(a, now)).filter((d): d is number => d !== null);

  const domainCounts = new Map<string, number>();
  for (const a of ads) {
    const host = urlHost(a.landingUrl);
    if (host) domainCounts.set(host, (domainCounts.get(host) ?? 0) + 1);
  }
  const landingDomains = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([host]) => host);

  let primaryAd: AdFacts["primaryAd"] = null;
  let primaryStart = Infinity;
  for (const a of active) {
    const href = externalHref(a.url);
    if (a.source !== "meta_ads" || !href) continue;
    const start = a.startedAt?.getTime() ?? Infinity;
    if (!primaryAd || start < primaryStart) {
      primaryAd = { url: href, days: adRunDays(a, now) };
      primaryStart = start;
    }
  }

  return {
    totalAds: ads.length,
    activeAds: active.length,
    activeAdvertisers: new Set(active.map((a) => a.advertiserId).filter(Boolean)).size,
    longestRunDays: runs.length ? Math.max(...runs) : null,
    landingDomains,
    primaryAd,
  };
}
