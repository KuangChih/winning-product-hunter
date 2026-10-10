import { ExternalLink as ExternalIcon } from "lucide-react";
import type { ProductDetail } from "@/data/product-detail";
import { getDictionary } from "@/i18n/dictionaries";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { type AdFacts, externalHref } from "@/lib/ad-facts";
import { formatUsd } from "@/lib/format";
import { confidenceLabel } from "@/scoring/score";
import { Notice } from "./notice";
import { MarketList } from "./product-table";
import { ProductThumb } from "./product-thumb";
import { ScoreBadge } from "./score-badge";
import { Sparkline } from "./sparkline";
import { WatchButton } from "./watch-button";

const linkClass =
  "hover:bg-secondary inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium";

/**
 * The top of a product page: photo, name, score with confidence and history, the watch toggle,
 * and the two links to check the product at its source (the advertiser's page and an ad).
 */
export function ProductSummary({
  product,
  facts,
  watched,
  locale,
}: {
  product: ProductDetail;
  facts: AdFacts;
  watched: boolean;
  locale: Locale;
}) {
  const dict = getDictionary(locale);
  const t = dict.detail;
  const storePage = externalHref(product.canonicalUrl);
  return (
    <section aria-labelledby="product-title" className="space-y-4 rounded-xl border p-4 sm:p-6">
      <div className="flex gap-4">
        <ProductThumb src={product.imageUrl} size="lg" className="size-20 sm:size-24" />
        <div className="min-w-0 flex-1 space-y-1">
          <h1
            id="product-title"
            className="text-xl font-semibold tracking-tight break-words sm:text-3xl"
          >
            {product.title}
          </h1>
          <p className="text-muted-foreground text-sm">
            {fill(t.firstSeen, { date: product.firstSeenAt.toISOString().slice(0, 10) })}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {product.score ? (
          <>
            <div className="flex items-center gap-3">
              <ScoreBadge score={product.score.score} size="lg" />
              <div className="text-sm">
                <div className="text-muted-foreground text-xs">{t.winningScore}</div>
                <div>
                  {t.confidence}{" "}
                  <span className="font-medium">
                    {dict.common.confidence[confidenceLabel(product.score.confidence)]}
                  </span>
                </div>
                <div className="text-muted-foreground text-xs">
                  {fill(t.updated, { date: product.score.computedAt.toISOString().slice(0, 10) })}
                </div>
              </div>
            </div>
            <Sparkline
              values={product.scoreHistory.map((s) => s.score)}
              label={t.scoreHistory}
              width={120}
              height={36}
            />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t.notScored}</p>
        )}
        <div className="sm:ml-auto">
          <WatchButton productId={product.id} watched={watched} labels={t} />
        </div>
      </div>

      {(storePage || facts.primaryAd) && (
        <div className="flex flex-wrap gap-2">
          {storePage && (
            <a href={storePage} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {t.advertiserPage}
              <ExternalIcon aria-hidden className="size-3.5" />{" "}
              <span className="sr-only">{t.newTab}</span>
            </a>
          )}
          {facts.primaryAd && (
            <a
              href={facts.primaryAd.url}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              {t.metaAd}
              {facts.primaryAd.days !== null && (
                <span className="text-muted-foreground font-normal">
                  {" "}
                  ({fill(t.metaAdDays, { n: facts.primaryAd.days })})
                </span>
              )}
              <ExternalIcon aria-hidden className="size-3.5" />{" "}
              <span className="sr-only">{t.newTab}</span>
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 font-medium break-words tabular-nums">{children}</dd>
    </div>
  );
}

const DASH = <span className="text-muted-foreground">—</span>;

/**
 * Key numbers from the collected evidence. Missing data is a dash, never an estimate. When the
 * ads link to several stores, a note says the product may mix different items (same handle).
 */
export function KeyFacts({
  facts,
  markets,
  retailUsdCents,
  locale,
}: {
  facts: AdFacts;
  markets: string[];
  retailUsdCents: number | null;
  locale: Locale;
}) {
  const t = getDictionary(locale).detail;
  const domains = facts.landingDomains;
  return (
    <section aria-labelledby="facts-heading" className="space-y-3">
      <h2 id="facts-heading" className="text-xl font-semibold">
        {t.factsHeading}
      </h2>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Fact label={t.activeAds}>
          {facts.totalAds === 0
            ? DASH
            : fill(t.activeAdsValue, { active: facts.activeAds, total: facts.totalAds })}
        </Fact>
        <Fact label={t.advertisers}>{facts.totalAds === 0 ? DASH : facts.activeAdvertisers}</Fact>
        <Fact label={t.longestRun}>
          {facts.longestRunDays === null
            ? DASH
            : fill(t.longestRunValue, { n: facts.longestRunDays })}
        </Fact>
        <Fact label={t.retailPrice}>
          {retailUsdCents === null ? DASH : formatUsd(retailUsdCents)}
        </Fact>
        <Fact label={t.domains}>
          {domains.length === 0 ? DASH : domains.length === 1 ? domains[0] : domains.length}
        </Fact>
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs">{t.markets}</dt>
          <dd className="mt-1">
            <MarketList markets={markets} locale={locale} max={6} />
          </dd>
        </div>
      </dl>
      {domains.length > 1 && (
        <Notice tone="warning" heading="h3" title={fill(t.domainsWarnTitle, { n: domains.length })}>
          <p>{t.domainsWarnBody}</p>
          <ul className="flex flex-wrap gap-1.5">
            {domains.map((d) => (
              <li key={d} className="bg-secondary rounded px-1.5 py-0.5 font-mono text-xs">
                {d}
              </li>
            ))}
          </ul>
        </Notice>
      )}
    </section>
  );
}
