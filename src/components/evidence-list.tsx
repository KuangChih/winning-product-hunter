import type { EvidenceItem } from "@/data/product-detail";
import type { FxRates } from "@/lib/fx";
import { MARKETS, marketName, sortByMarketPriority } from "@/lib/markets";
import { marketRetailPrice } from "@/lib/retail-price";
import { sourceLabel } from "@/lib/sources";
import { Sparkline } from "./sparkline";

const DAY = 86_400_000;

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatPrice(cents: number, currency: string | null) {
  return `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();
}

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

function AdRow({ ad, now }: { ad: EvidenceItem; now: Date }) {
  const end = ad.endedAt && ad.endedAt < now ? ad.endedAt : now;
  const days = ad.startedAt ? Math.round((end.getTime() - ad.startedAt.getTime()) / DAY) : null;
  const active = !ad.endedAt || ad.endedAt > now;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 border-t py-2 first:border-t-0">
      <div>
        <div className="font-medium">{ad.advertiserName ?? "Unknown advertiser"}</div>
        <div className="text-muted-foreground text-xs">
          {evidenceLabel(ad)}
          {ad.countries.length ? ` · ${ad.countries.join(", ")}` : ""}
          {ad.format ? ` · ${ad.format}` : ""}
          {ad.metrics.creative_variants && ad.metrics.creative_variants > 1
            ? ` · ${ad.metrics.creative_variants} ads use this creative`
            : ""}
          {ad.startedAt ? ` · started ${formatDate(ad.startedAt)}` : ""}
          {days !== null ? ` · ${days} days` : ""}
          {` · ${active ? "active" : "stopped"}`}
        </div>
      </div>
      {ad.url && <ExternalLink href={ad.url}>View ad</ExternalLink>}
    </li>
  );
}

/** Source label; the public Ad Library website covers all countries, the API only the EU/UK. */
function evidenceLabel(e: EvidenceItem) {
  if (e.source !== "meta_ads") return sourceLabel(e.source);
  return e.provider === "ad_library_web" ? "Meta Ad Library" : "Meta Ads (EU API)";
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
}: {
  items: EvidenceItem[];
  supply: EvidenceItem[];
  fxRates: FxRates | null;
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
        return (
          <div key={c} className="rounded-lg border">
            <div className="bg-muted/40 flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{marketName(c)}</span>
              <span className="text-muted-foreground text-xs">
                {price &&
                  `Median price ${formatPrice(price.medianCents, price.currency)}` +
                    (price.converted > 0 && fxRates
                      ? ` (${price.converted} converted at ECB rates of ${fxRates.date})`
                      : "")}
                {total !== undefined &&
                  ` · ~${total.toLocaleString("en-US")} matching products in Shopify catalog`}
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
                      {o.advertiserName ?? "Unknown store"} ·{" "}
                      {formatPrice(o.priceCents!, o.currency)}
                      {o.metrics.rating !== undefined
                        ? ` · ★ ${o.metrics.rating} (${o.metrics.rating_count ?? 0})`
                        : ""}
                    </div>
                  </div>
                  {o.url && <ExternalLink href={o.url}>View store</ExternalLink>}
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
}: {
  evidence: EvidenceItem[];
  now: Date;
  fxRates?: FxRates | null;
}) {
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
  const listings = evidence.filter((e) => e.kind === "listing");

  return (
    <div className="space-y-8">
      {ads.length > 0 && (
        <Section title={`Ads (${ads.length})`}>
          {activeAds.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Active ads for this search in Meta Ad Library:{" "}
              {activeAds
                .map((a) => `${a.countries[0]} ~${a.metrics.active_ads.toLocaleString("en-US")}`)
                .join(" · ")}
            </p>
          )}
          <ul className="rounded-lg border px-3">
            {ads.slice(0, MAX_ADS_SHOWN).map((ad) => (
              <AdRow key={ad.id} ad={ad} now={now} />
            ))}
          </ul>
          {ads.length > MAX_ADS_SHOWN && (
            <p className="text-muted-foreground text-xs">
              Showing the {MAX_ADS_SHOWN} longest-running of {ads.length} ads.
            </p>
          )}
        </Section>
      )}
      {trends.length > 0 && (
        <Section title="Search demand">
          <ul className="space-y-3">
            {trends.map((t) => {
              const series = t.series.search_interest ?? [];
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-4 rounded-lg border p-3">
                  <div className="min-w-40">
                    <div className="font-medium">“{t.title}”</div>
                    <div className="text-muted-foreground text-xs">
                      {sourceLabel(t.source)}
                      {t.region ? ` · ${t.region}` : ""} · {series.length} weeks
                    </div>
                  </div>
                  <Sparkline
                    values={series.map((p) => p.value)}
                    label={`Search interest for ${t.title}`}
                  />
                  {t.url && <ExternalLink href={t.url}>Open in Google Trends</ExternalLink>}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {storeProducts.length > 0 && (
        <Section title={`Stores selling it (${storeProducts.length})`}>
          <StoreProducts items={storeProducts} supply={supply} fxRates={fxRates} />
        </Section>
      )}
      {listings.length > 0 && (
        <Section title="Supplier listings">
          <ul className="rounded-lg border px-3">
            {listings.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-t py-2 first:border-t-0"
              >
                <div>
                  <div className="font-medium">{sourceLabel(l.source)}</div>
                  <div className="text-muted-foreground text-xs">
                    {l.priceCents !== null ? `Price ${formatPrice(l.priceCents, l.currency)}` : ""}
                    {l.metrics.units_sold_90d !== undefined
                      ? ` · ${l.metrics.units_sold_90d.toLocaleString("en-US")} sold in 90 days`
                      : ""}
                    {l.metrics.stores_listed !== undefined
                      ? ` · listed by ${l.metrics.stores_listed.toLocaleString("en-US")} stores`
                      : ""}
                  </div>
                </div>
                {l.url && <ExternalLink href={l.url}>View listing</ExternalLink>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {evidence.length === 0 && (
        <p className="text-muted-foreground text-sm">No evidence collected yet.</p>
      )}
    </div>
  );
}
