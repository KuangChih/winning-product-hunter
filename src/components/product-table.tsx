import Link from "next/link";
import { type RankedProduct, type RankingFilters, signalValue } from "@/data/products";
import { rankingHref } from "@/data/ranking-params";
import { getDictionary } from "@/i18n/dictionaries";
import { countryName, fill } from "@/i18n/format";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { formatUsd } from "@/lib/format";
import { marketTier } from "@/lib/markets";
import { sourceLabel } from "@/lib/sources";
import { cn } from "@/lib/utils";
import { confidenceLabel, SUB_SCORE_ORDER } from "@/scoring/score";
import { ProductThumb } from "./product-thumb";
import { ScoreBadge } from "./score-badge";

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <ScoreBadge score={score} />
      <div className="bg-muted h-2 w-20 overflow-hidden rounded-full" aria-hidden>
        <div className="bg-primary h-full rounded-full" style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

/** Countries with evidence; priority (tier 1) markets are emphasized. */
export function MarketList({
  markets,
  locale = DEFAULT_LOCALE,
}: {
  markets: string[];
  locale?: Locale;
}) {
  if (markets.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {markets.map((m) => (
        <li
          key={m}
          title={countryName(m, locale)}
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-xs",
            marketTier(m) === 1 ? "bg-primary text-primary-foreground" : "bg-secondary",
          )}
        >
          {m}
        </li>
      ))}
    </ul>
  );
}

export function ProductTable({
  products,
  locale,
  filters = {},
}: {
  products: RankedProduct[];
  locale: Locale;
  /** Current filters, so the signal column headers can link to a sort that keeps them. */
  filters?: RankingFilters;
}) {
  const { ranking: t, common, breakdown } = getDictionary(locale);
  return (
    <div className="overflow-x-auto rounded-lg border">
      {/* Scroll sideways on small screens instead of squeezing every column into tall rows. */}
      <table className="w-full min-w-[96rem] text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">{t.columns.rank}</th>
            <th className="px-3 py-2 font-medium">{t.columns.product}</th>
            <th className="px-3 py-2 font-medium">{t.columns.score}</th>
            {SUB_SCORE_ORDER.map((name) => {
              const active = filters.sort === name;
              return (
                <th
                  key={name}
                  scope="col"
                  aria-sort={active ? "descending" : undefined}
                  title={breakdown.methods[name]}
                  className="px-2 py-2 text-right font-medium"
                >
                  <Link
                    href={rankingHref({ ...filters, sort: name })}
                    // Every prefetch renders the page on the server (a full ranking query each);
                    // fetch on hover or click instead of for all headers and rows at once.
                    prefetch={false}
                    aria-label={fill(t.sortByColumn, { signal: t.signals[name] })}
                    className={active ? "text-foreground underline" : "hover:text-foreground"}
                  >
                    {t.signals[name]}
                    {active ? " ↓" : ""}
                  </Link>
                </th>
              );
            })}
            <th className="px-3 py-2 text-right font-medium">{t.columns.price}</th>
            <th className="px-3 py-2 font-medium">{t.columns.confidence}</th>
            <th className="px-3 py-2 font-medium">{t.columns.markets}</th>
            <th className="px-3 py-2 font-medium">{t.columns.evidence}</th>
            <th className="px-3 py-2 font-medium">{t.columns.advertisers}</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => (
            <tr key={p.id} className="hover:bg-muted/30 border-t">
              <td className="text-muted-foreground px-3 py-3 tabular-nums">{i + 1}</td>
              <td className="min-w-48 px-3 py-3">
                <div className="flex items-center gap-3">
                  <ProductThumb src={p.imageUrl} size="sm" />
                  <Link
                    href={`/products/${p.slug}`}
                    prefetch={false}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {p.title}
                  </Link>
                </div>
              </td>
              <td className="px-3 py-3">
                <ScoreBar score={p.score} />
              </td>
              {SUB_SCORE_ORDER.map((name) => {
                const v = signalValue(p, name);
                return (
                  <td key={name} className="px-2 py-3 text-right font-mono tabular-nums">
                    {v === null ? (
                      <span className="text-muted-foreground" title={t.noData}>
                        —
                      </span>
                    ) : (
                      v
                    )}
                  </td>
                );
              })}
              <td className="px-3 py-3 text-right tabular-nums">
                {p.retailUsdCents === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatUsd(p.retailUsdCents)
                )}
              </td>
              <td className="px-3 py-3">{common.confidence[confidenceLabel(p.confidence)]}</td>
              <td className="min-w-44 px-3 py-3">
                <MarketList markets={p.markets} locale={locale} />
              </td>
              <td className="min-w-48 px-3 py-3">
                <ul className="flex flex-wrap gap-1">
                  {p.sources.map((s) => (
                    <li key={s} className="bg-secondary rounded px-1.5 py-0.5 text-xs">
                      {sourceLabel(s, locale)}
                    </li>
                  ))}
                </ul>
              </td>
              <td className="px-3 py-3 tabular-nums">{p.breakdown.saturation.activeAdvertisers}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
