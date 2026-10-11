import { ChevronDown } from "lucide-react";
import type { EvidenceItem } from "@/data/product-detail";
import { type Dictionary, getDictionary } from "@/i18n/dictionaries";
import { countryName, fill } from "@/i18n/format";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { adRunDays, dedupeAdRecords, externalHref, urlHost } from "@/lib/ad-facts";
import type { FxRates } from "@/lib/fx";
import { MARKETS, sortByMarketPriority } from "@/lib/markets";
import { marketRetailPrice, OWN_LISTING_PROVIDER } from "@/lib/retail-price";
import { sourceLabel } from "@/lib/sources";
import { cn } from "@/lib/utils";
import { AdRunBadges } from "./ad-badges";
import { Sparkline } from "./sparkline";

type T = Dictionary["evidence"];

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatPrice(cents: number, currency: string | null) {
  return `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();
}

const count = (n: number) => n.toLocaleString("en-US");

/** A link to the source, in a new tab; nothing for a missing or non-web URL. */
export function ExternalLink({
  href,
  children,
  newTab,
  className,
}: {
  href: string | null | undefined;
  children: React.ReactNode;
  /** Screen-reader note: "(opens in a new tab)". */
  newTab: string;
  className?: string;
}) {
  const safe = externalHref(href);
  if (!safe) return null;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("underline underline-offset-4", className)}
    >
      {children} <span className="sr-only">{newTab}</span>
    </a>
  );
}

/**
 * One kind of evidence as a native disclosure, its count in the always-visible summary. The
 * heading stays a real heading (inside the summary) so the page outline still lists it.
 */
function Section({
  title,
  open = false,
  children,
}: {
  title: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="group/section rounded-lg border">
      <summary className="hover:bg-muted/40 flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <h3 className="font-semibold">{title}</h3>
        <ChevronDown
          aria-hidden
          className="text-muted-foreground size-4 shrink-0 transition-transform group-open/section:rotate-180"
        />
      </summary>
      <div className="space-y-3 border-t px-3 py-3">{children}</div>
    </details>
  );
}

type AdRecord = EvidenceItem & { providers: string[] };

/** Website and official-API records of the same ad, shown as one row (ADR-015). */
function mergeTwin(kept: EvidenceItem, twin: EvidenceItem): EvidenceItem {
  return {
    ...kept,
    countries: [...new Set([...kept.countries, ...twin.countries])],
    metrics: { ...twin.metrics, ...kept.metrics },
    startedAt: kept.startedAt ?? twin.startedAt,
  };
}

const formatCount = (n: number) => n.toLocaleString("en-US");

/** Reach from the official API; "—" when the API returned the ad without a reach estimate. */
function reachText(ad: AdRecord, t: T): string | null {
  if (!ad.providers.includes("ad_library_api")) return null;
  const parts = [
    ad.metrics.eu_total_reach !== undefined
      ? fill(t.euReach, { n: formatCount(ad.metrics.eu_total_reach) })
      : null,
    ad.metrics.uk_total_reach !== undefined
      ? fill(t.ukReach, { n: formatCount(ad.metrics.uk_total_reach) })
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t.reachMissing;
}

function AdRow({ ad, now, t, locale }: { ad: AdRecord; now: Date; t: T; locale: Locale }) {
  const { detail } = getDictionary(locale);
  const variants = ad.metrics.creative_variants;
  const parts = [
    ad.providers.length > 1
      ? ad.providers.map((p) => evidenceLabel({ ...ad, provider: p }, t, locale)).join(" + ")
      : evidenceLabel(ad, t, locale),
    ad.countries.length ? ad.countries.join(", ") : null,
    ad.format ? (t.formats[ad.format] ?? ad.format) : null,
    variants && variants > 1 ? fill(t.sharedCreative, { n: variants }) : null,
    ad.startedAt ? fill(t.started, { date: formatDate(ad.startedAt) }) : null,
    urlHost(ad.landingUrl),
    reachText(ad, t),
  ];
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium break-words">
            {ad.advertiserName ?? t.unknownAdvertiser}
          </span>
          <AdRunBadges ad={ad} now={now} labels={t} />
        </div>
        <div className="text-muted-foreground text-xs break-words">
          {parts.filter(Boolean).join(" · ")}
        </div>
      </div>
      <ExternalLink href={ad.url} newTab={detail.newTab} className="text-sm">
        {t.viewAd}
      </ExternalLink>
    </li>
  );
}

/** Source label; the public Ad Library website covers all countries, the API only the EU/UK. */
function evidenceLabel(e: EvidenceItem, t: T, locale: Locale) {
  if (e.source !== "meta_ads") return sourceLabel(e.source, locale);
  return e.provider === "ad_library_web" ? t.metaWeb : t.metaApi;
}

/** Ads shown before "Show all": the longest-running ones. */
export const ADS_SHOWN_FIRST = 5;

function countryOrder(e: EvidenceItem) {
  const c = e.countries[0];
  const i = MARKETS.findIndex((m) => m.code === c);
  return i === -1 ? MARKETS.length : i;
}

/** Retail offers from other stores, grouped by ship-to country, cheapest first. */
function StoreProducts({
  items,
  supply,
  fxRates,
  t,
  locale,
  newTab,
}: {
  items: EvidenceItem[];
  supply: EvidenceItem[];
  fxRates: FxRates | null;
  t: T;
  locale: Locale;
  newTab: string;
}) {
  const byCountry = new Map<string, EvidenceItem[]>();
  for (const item of items) {
    const c = item.countries[0] ?? "—";
    byCountry.set(c, [...(byCountry.get(c) ?? []), item]);
  }
  const countries = sortByMarketPriority(byCountry.keys());
  return (
    <div className="space-y-4">
      {countries.map((c) => {
        const offers = byCountry
          .get(c)!
          .filter((o) => o.priceCents !== null)
          .sort((a, b) => a.priceCents! - b.priceCents!);
        const price = marketRetailPrice(
          offers.map((o) => ({ priceCents: o.priceCents!, currency: o.currency })),
          c,
          fxRates,
        );
        const total = supply.find((s) => s.countries[0] === c)?.metrics.catalog_results;
        const summary = [
          price
            ? fill(t.medianPrice, { price: formatPrice(price.medianCents, price.currency) }) +
              (price.converted > 0 && fxRates
                ? fill(t.converted, { n: price.converted, date: fxRates.date })
                : "")
            : null,
          total !== undefined ? fill(t.catalogMatches, { n: count(total) }) : null,
        ];
        return (
          <div key={c} className="rounded-lg border">
            <div className="bg-muted/40 flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{countryName(c, locale)}</span>
              <span className="text-muted-foreground text-xs">
                {summary.filter(Boolean).join(" · ")}
              </span>
            </div>
            <ul className="px-3">
              {offers.slice(0, 8).map((o) => (
                <li
                  key={o.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-t py-2 first:border-t-0"
                >
                  <div className="min-w-0">
                    <div className="font-medium break-words">{o.title}</div>
                    <div className="text-muted-foreground text-xs">
                      {o.advertiserName ?? t.unknownStore} ·{" "}
                      {formatPrice(o.priceCents!, o.currency)}
                      {o.metrics.rating !== undefined
                        ? ` · ★ ${o.metrics.rating} (${o.metrics.rating_count ?? 0})`
                        : ""}
                    </div>
                  </div>
                  <ExternalLink href={o.url} newTab={newTab}>
                    {t.viewStore}
                  </ExternalLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Longest-running first; ads without a start date last. */
function byRunDays(now: Date) {
  return (a: EvidenceItem, b: EvidenceItem) =>
    (adRunDays(b, now) ?? -1) - (adRunDays(a, now) ?? -1);
}

export function EvidenceList({
  evidence,
  now,
  fxRates = null,
  locale = DEFAULT_LOCALE,
}: {
  evidence: EvidenceItem[];
  now: Date;
  fxRates?: FxRates | null;
  locale?: Locale;
}) {
  const dict = getDictionary(locale);
  const t = dict.evidence;
  const newTab = dict.detail.newTab;
  const ads = dedupeAdRecords(
    evidence.filter((e) => e.kind === "ad"),
    mergeTwin,
  ).sort(byRunDays(now));
  const activeAds = evidence
    .filter((e) => e.kind === "trend" && e.metrics.active_ads !== undefined)
    .sort((a, b) => countryOrder(a) - countryOrder(b));
  const trends = evidence.filter(
    (e) =>
      e.kind === "trend" &&
      (e.metrics.search_interest !== undefined || e.series.search_interest !== undefined),
  );
  const supply = evidence
    .filter((e) => e.kind === "trend" && e.metrics.catalog_results !== undefined)
    .sort((a, b) => countryOrder(a) - countryOrder(b));
  const storeProducts = evidence.filter((e) => e.kind === "store_product");
  const ownListings = storeProducts.filter((e) => e.provider === OWN_LISTING_PROVIDER);
  const similar = storeProducts.filter((e) => e.provider !== OWN_LISTING_PROVIDER);
  const listings = evidence.filter((e) => e.kind === "listing");

  const first = ads.slice(0, ADS_SHOWN_FIRST);
  const rest = ads.slice(ADS_SHOWN_FIRST);
  const adRows = (list: AdRecord[]) =>
    list.map((ad) => <AdRow key={ad.id} ad={ad} now={now} t={t} locale={locale} />);

  return (
    <div className="space-y-3">
      {ads.length > 0 && (
        <Section title={fill(t.adsHeading, { n: ads.length })} open>
          {activeAds.length > 0 && (
            <p className="text-muted-foreground text-xs">
              {t.activeAdsIntro}{" "}
              {activeAds
                .map((a) => `${a.countries[0]} ~${count(a.metrics.active_ads)}`)
                .join(" · ")}
            </p>
          )}
          {ads.some((a) => a.providers.includes("ad_library_api")) && (
            <p className="text-muted-foreground text-xs">{t.reachNote}</p>
          )}
          <ul className="divide-y">{adRows(first)}</ul>
          {rest.length > 0 && (
            // The rest behind a native disclosure: works without JavaScript.
            <details className="group/more">
              <summary className="w-fit cursor-pointer text-sm font-medium underline-offset-4 hover:underline">
                <span className="group-open/more:hidden">{fill(t.showAll, { n: ads.length })}</span>
                <span className="hidden group-open/more:inline">{t.showFewer}</span>
              </summary>
              <ul className="mt-2.5 divide-y border-t pt-2.5">{adRows(rest)}</ul>
            </details>
          )}
        </Section>
      )}
      {ownListings.length > 0 && (
        <Section title={fill(t.ownStoresHeading, { n: ownListings.length })} open>
          <p className="text-muted-foreground text-xs">{t.ownStoresNote}</p>
          <StoreProducts
            items={ownListings}
            supply={[]}
            fxRates={fxRates}
            t={t}
            locale={locale}
            newTab={newTab}
          />
        </Section>
      )}
      {similar.length > 0 && (
        <Section title={fill(t.storesHeading, { n: similar.length })}>
          <p className="text-muted-foreground text-xs">{t.similarNote}</p>
          <StoreProducts
            items={similar}
            supply={supply}
            fxRates={fxRates}
            t={t}
            locale={locale}
            newTab={newTab}
          />
        </Section>
      )}
      {trends.length > 0 && (
        <Section title={fill(t.searchDemand, { n: trends.length })}>
          <ul className="space-y-3">
            {trends.map((trend) => {
              const series = trend.series.search_interest ?? [];
              return (
                <li
                  key={trend.id}
                  className="flex flex-wrap items-center gap-4 rounded-lg border p-3"
                >
                  <div className="min-w-40">
                    <div className="font-medium">“{trend.title}”</div>
                    <div className="text-muted-foreground text-xs">
                      {sourceLabel(trend.source, locale)}
                      {trend.region ? ` · ${trend.region}` : ""} ·{" "}
                      {fill(t.weeks, { n: series.length })}
                    </div>
                  </div>
                  <Sparkline
                    values={series.map((p) => p.value)}
                    label={fill(t.searchInterestFor, { title: trend.title ?? "" })}
                  />
                  <ExternalLink href={trend.url} newTab={newTab}>
                    {t.openTrends}
                  </ExternalLink>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {listings.length > 0 && (
        <Section title={fill(t.supplierHeading, { n: listings.length })}>
          {listings.some((l) => l.source === "cj") && (
            <p className="text-muted-foreground text-xs">{t.cjCountNote}</p>
          )}
          <ul className="divide-y">
            {listings.map((l) => {
              const parts = [
                l.priceCents !== null
                  ? fill(t.price, { price: formatPrice(l.priceCents, l.currency) })
                  : null,
                l.metrics.units_sold_90d !== undefined
                  ? fill(t.sold90, { n: count(l.metrics.units_sold_90d) })
                  : null,
                l.metrics.orders_total !== undefined
                  ? fill(t.cjOrders, { n: count(l.metrics.orders_total) })
                  : null,
                l.metrics.stores_listed !== undefined
                  ? fill(t.listedBy, { n: count(l.metrics.stores_listed) })
                  : null,
              ];
              return (
                <li
                  key={l.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0 last:pb-0"
                >
                  <div>
                    <div className="font-medium">{sourceLabel(l.source, locale)}</div>
                    <div className="text-muted-foreground text-xs">
                      {parts.filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <ExternalLink href={l.url} newTab={newTab}>
                    {t.viewListing}
                  </ExternalLink>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {evidence.length === 0 && <p className="text-muted-foreground text-sm">{t.none}</p>}
    </div>
  );
}
