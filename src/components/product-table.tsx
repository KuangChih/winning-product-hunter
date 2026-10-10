import Link from "next/link";
import { type RankedProduct, type RankingFilters, signalValue } from "@/data/products";
import { rankingHref } from "@/data/ranking-params";
import { getDictionary } from "@/i18n/dictionaries";
import { countryName, fill } from "@/i18n/format";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { formatAgo, formatUsd } from "@/lib/format";
import { marketTier } from "@/lib/markets";
import { cn } from "@/lib/utils";
import { confidenceLabel, SUB_SCORE_ORDER, type SubScoreName } from "@/scoring/score";
import { ProductThumb } from "./product-thumb";
import { ScoreBadge } from "./score-badge";
import { WatchStar } from "./watch-button";

/**
 * Countries with evidence, priority (tier 1) markets emphasized. With `max`, the rest fold into
 * a "+N" chip whose tooltip says how many more there are.
 */
export function MarketList({
  markets,
  locale = DEFAULT_LOCALE,
  max,
}: {
  markets: string[];
  locale?: Locale;
  max?: number;
}) {
  if (markets.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const shown = max === undefined ? markets : markets.slice(0, max);
  const more = markets.length - shown.length;
  const chip = "rounded px-1.5 py-0.5 font-mono text-xs";
  return (
    <ul className="flex flex-wrap gap-1">
      {shown.map((m) => (
        <li
          key={m}
          title={countryName(m, locale)}
          className={cn(
            chip,
            marketTier(m) === 1 ? "bg-primary text-primary-foreground" : "bg-secondary",
          )}
        >
          {m}
        </li>
      ))}
      {more > 0 && (
        <li
          title={fill(getDictionary(locale).ranking.moreMarkets, { n: more })}
          className={cn(chip, "text-muted-foreground border")}
        >
          +{more}
        </li>
      )}
    </ul>
  );
}

/** A sub-score (0–100), or a dash when the product has no real data for it. */
function SignalValue({ value, noData }: { value: number | null; noData: string }) {
  if (value === null) {
    return (
      <span className="text-muted-foreground" title={noData}>
        —
      </span>
    );
  }
  return <>{value}</>;
}

function PriceText({ cents }: { cents: number | null }) {
  return cents === null ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <>{formatUsd(cents)}</>
  );
}

/**
 * Desktop ranking (shown from the `lg` breakpoint): one compact row per product, with the seven
 * sub-scores as narrow columns whose headers sort by that signal.
 */
export function ProductTable({
  products,
  locale,
  filters = {},
  now = new Date(),
}: {
  products: RankedProduct[];
  locale: Locale;
  /** Current filters, so the signal column headers can link to a sort that keeps them. */
  filters?: RankingFilters;
  now?: Date;
}) {
  const { ranking: t, common, breakdown } = getDictionary(locale);
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              {t.columns.product}
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              {t.columns.score}
            </th>
            {SUB_SCORE_ORDER.map((name) => {
              const active = filters.sort === name;
              return (
                <th
                  key={name}
                  scope="col"
                  aria-sort={active ? "descending" : undefined}
                  title={`${t.signals[name]}: ${breakdown.methods[name]}`}
                  className="w-12 px-1 py-2 text-right font-medium"
                >
                  <Link
                    href={rankingHref({ ...filters, sort: name })}
                    aria-label={fill(t.sortByColumn, { signal: t.signals[name] })}
                    className={cn(
                      "underline-offset-4",
                      active ? "text-foreground underline" : "hover:text-foreground",
                    )}
                  >
                    {t.signalsShort[name]}
                    {active ? "↓" : ""}
                  </Link>
                </th>
              );
            })}
            <th scope="col" className="px-2 py-2 text-right font-medium">
              {t.columns.price}
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              {t.columns.markets}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t.columns.advertisers}
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className="hover:bg-muted/30 border-t">
              <td className="px-3 py-2">
                <div className="flex items-center gap-3">
                  <ProductThumb src={p.imageUrl} size="sm" />
                  <div className="min-w-0">
                    <Link
                      href={`/products/${p.slug}`}
                      className="line-clamp-2 font-medium underline-offset-4 hover:underline"
                    >
                      {p.title}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {fill(t.firstSeen, { when: formatAgo(p.firstSeenAt, now, locale) })}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-2 py-2">
                <ScoreBadge score={p.score} />
                <div className="text-muted-foreground mt-0.5 text-xs whitespace-nowrap">
                  {fill(t.confidenceLevel, {
                    level: common.confidence[confidenceLabel(p.confidence)],
                  })}
                </div>
              </td>
              {SUB_SCORE_ORDER.map((name) => (
                <td key={name} className="px-1 py-2 text-right font-mono tabular-nums">
                  <SignalValue value={signalValue(p, name)} noData={t.noData} />
                </td>
              ))}
              <td className="px-2 py-2 text-right tabular-nums">
                <PriceText cents={p.retailUsdCents} />
              </td>
              <td className="px-2 py-2">
                <MarketList markets={p.markets} locale={locale} max={3} />
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {p.breakdown.saturation.activeAdvertisers}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One product as a card (phones and tablets, and the home page). */
export function ProductCard({
  product: p,
  locale,
  watched,
  now = new Date(),
}: {
  product: RankedProduct;
  locale: Locale;
  /** Watch state, for the star; leave out to hide the star. */
  watched?: boolean;
  now?: Date;
}) {
  const { ranking: t, common } = getDictionary(locale);
  const meta = [
    p.retailUsdCents === null ? t.noPrice : formatUsd(p.retailUsdCents),
    p.breakdown.saturation.activeAdvertisers === 1
      ? t.advertiserCountOne
      : fill(t.advertiserCount, { n: p.breakdown.saturation.activeAdvertisers }),
    fill(t.firstSeen, { when: formatAgo(p.firstSeenAt, now, locale) }),
  ];
  return (
    <article className="flex h-full flex-col gap-3 rounded-lg border p-3">
      <div className="flex gap-3">
        <ProductThumb src={p.imageUrl} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm leading-snug font-medium">
            <Link
              href={`/products/${p.slug}`}
              className="line-clamp-2 underline-offset-4 hover:underline"
            >
              {p.title}
            </Link>
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">{meta.join(" · ")}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ScoreBadge score={p.score} size="lg" />
          <span className="text-muted-foreground text-xs whitespace-nowrap">
            {fill(t.confidenceLevel, { level: common.confidence[confidenceLabel(p.confidence)] })}
          </span>
        </div>
      </div>
      <div className="flex min-h-9 items-center justify-between gap-2">
        <MarketList markets={p.markets} locale={locale} max={4} />
        {watched !== undefined && (
          <WatchStar
            productId={p.id}
            watched={watched}
            label={fill(t.watchProduct, { title: p.title })}
            tooltip={fill(watched ? t.unwatchProduct : t.watchProduct, { title: p.title })}
          />
        )}
      </div>
      <SignalGrid product={p} labels={t} />
    </article>
  );
}

/** The seven sub-scores in a row of small cells (abbreviated labels; full name on hover). */
function SignalGrid({
  product,
  labels: t,
}: {
  product: RankedProduct;
  labels: ReturnType<typeof getDictionary>["ranking"];
}) {
  return (
    <dl className="bg-muted/40 mt-auto grid grid-cols-7 gap-px overflow-hidden rounded-md text-center">
      {SUB_SCORE_ORDER.map((name: SubScoreName) => (
        <div key={name} title={t.signals[name]} className="px-0.5 py-1">
          <dt className="text-muted-foreground truncate text-[0.6875rem] leading-tight">
            {t.signalsShort[name]}
          </dt>
          <dd className="font-mono text-sm tabular-nums">
            <SignalValue value={signalValue(product, name)} noData={t.noData} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The ranking, responsive: a compact table from `lg` up, cards below it (no sideways scrolling
 * on a phone). Both are in the page; CSS shows one.
 */
export function ProductList({
  products,
  locale,
  filters,
  watchedIds,
  now = new Date(),
}: {
  products: RankedProduct[];
  locale: Locale;
  filters?: RankingFilters;
  watchedIds: Set<string>;
  now?: Date;
}) {
  return (
    <>
      <div className="hidden lg:block">
        <ProductTable products={products} locale={locale} filters={filters} now={now} />
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
        {products.map((p) => (
          <li key={p.id}>
            <ProductCard product={p} locale={locale} watched={watchedIds.has(p.id)} now={now} />
          </li>
        ))}
      </ul>
    </>
  );
}
