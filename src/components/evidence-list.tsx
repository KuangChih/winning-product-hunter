import type { EvidenceItem } from "@/data/product-detail";
import { type Dictionary, getDictionary } from "@/i18n/dictionaries";
import { countryName, fill } from "@/i18n/format";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import type { FxRates } from "@/lib/fx";
import { MARKETS, sortByMarketPriority } from "@/lib/markets";
import { marketRetailPrice, OWN_LISTING_PROVIDER } from "@/lib/retail-price";
import { sourceLabel } from "@/lib/sources";
import { Sparkline } from "./sparkline";

const DAY = 86_400_000;

type T = Dictionary["evidence"];

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatPrice(cents: number, currency: string | null) {
  return `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();
}

const count = (n: number) => n.toLocaleString("en-US");

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-4"
    >
      {children}
    </a>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function AdRow({ ad, now, t, locale }: { ad: EvidenceItem; now: Date; t: T; locale: Locale }) {
  const end = ad.endedAt && ad.endedAt < now ? ad.endedAt : now;
  const days = ad.startedAt ? Math.round((end.getTime() - ad.startedAt.getTime()) / DAY) : null;
  const active = !ad.endedAt || ad.endedAt > now;
  const variants = ad.metrics.creative_variants;
  const parts = [
    evidenceLabel(ad, t, locale),
    ad.countries.length ? ad.countries.join(", ") : null,
    ad.format ? (t.formats[ad.format] ?? ad.format) : null,
    variants && variants > 1 ? fill(t.sharedCreative, { n: variants }) : null,
    ad.startedAt ? fill(t.started, { date: formatDate(ad.startedAt) }) : null,
    days !== null ? fill(t.days, { n: days }) : null,
    active ? t.active : t.stopped,
  ];
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 border-t py-2 first:border-t-0">
      <div>
        <div className="font-medium">{ad.advertiserName ?? t.unknownAdvertiser}</div>
        <div className="text-muted-foreground text-xs">{parts.filter(Boolean).join(" · ")}</div>
      </div>
      {ad.url && <ExternalLink href={ad.url}>{t.viewAd}</ExternalLink>}
    </li>
  );
}

/** Source label; the public Ad Library website covers all countries, the API only the EU/UK. */
function evidenceLabel(e: EvidenceItem, t: T, locale: Locale) {
  if (e.source !== "meta_ads") return sourceLabel(e.source, locale);
  return e.provider === "ad_library_web" ? t.metaWeb : t.metaApi;
}

const MAX_ADS_SHOWN = 20;

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
}: {
  items: EvidenceItem[];
  supply: EvidenceItem[];
  fxRates: FxRates | null;
  t: T;
  locale: Locale;
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
                  <div>
                    <div className="font-medium">{o.title}</div>
                    <div className="text-muted-foreground text-xs">
                      {o.advertiserName ?? t.unknownStore} ·{" "}
                      {formatPrice(o.priceCents!, o.currency)}
                      {o.metrics.rating !== undefined
                        ? ` · ★ ${o.metrics.rating} (${o.metrics.rating_count ?? 0})`
                        : ""}
                    </div>
                  </div>
                  {o.url && <ExternalLink href={o.url}>{t.viewStore}</ExternalLink>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
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
  const t = getDictionary(locale).evidence;
  const ads = evidence
    .filter((e) => e.kind === "ad")
    .sort((a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0));
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

  return (
    <div className="space-y-8">
      {ads.length > 0 && (
        <Section title={fill(t.adsHeading, { n: ads.length })}>
          {activeAds.length > 0 && (
            <p className="text-muted-foreground text-xs">
              {t.activeAdsIntro}{" "}
              {activeAds
                .map((a) => `${a.countries[0]} ~${count(a.metrics.active_ads)}`)
                .join(" · ")}
            </p>
          )}
          <ul className="rounded-lg border px-3">
            {ads.slice(0, MAX_ADS_SHOWN).map((ad) => (
              <AdRow key={ad.id} ad={ad} now={now} t={t} locale={locale} />
            ))}
          </ul>
          {ads.length > MAX_ADS_SHOWN && (
            <p className="text-muted-foreground text-xs">
              {fill(t.showingLongest, { shown: MAX_ADS_SHOWN, total: ads.length })}
            </p>
          )}
        </Section>
      )}
      {trends.length > 0 && (
        <Section title={t.searchDemand}>
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
                  {trend.url && <ExternalLink href={trend.url}>{t.openTrends}</ExternalLink>}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {ownListings.length > 0 && (
        <Section title={fill(t.ownStoresHeading, { n: ownListings.length })}>
          <p className="text-muted-foreground text-xs">{t.ownStoresNote}</p>
          <StoreProducts items={ownListings} supply={[]} fxRates={fxRates} t={t} locale={locale} />
        </Section>
      )}
      {similar.length > 0 && (
        <Section title={fill(t.storesHeading, { n: similar.length })}>
          <p className="text-muted-foreground text-xs">{t.similarNote}</p>
          <StoreProducts items={similar} supply={supply} fxRates={fxRates} t={t} locale={locale} />
        </Section>
      )}
      {listings.length > 0 && (
        <Section title={t.supplierHeading}>
          <ul className="rounded-lg border px-3">
            {listings.map((l) => {
              const parts = [
                l.priceCents !== null
                  ? fill(t.price, { price: formatPrice(l.priceCents, l.currency) })
                  : null,
                l.metrics.units_sold_90d !== undefined
                  ? fill(t.sold90, { n: count(l.metrics.units_sold_90d) })
                  : null,
                l.metrics.stores_listed !== undefined
                  ? fill(t.listedBy, { n: count(l.metrics.stores_listed) })
                  : null,
              ];
              return (
                <li
                  key={l.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-t py-2 first:border-t-0"
                >
                  <div>
                    <div className="font-medium">{sourceLabel(l.source, locale)}</div>
                    <div className="text-muted-foreground text-xs">
                      {parts.filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {l.url && <ExternalLink href={l.url}>{t.viewListing}</ExternalLink>}
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
