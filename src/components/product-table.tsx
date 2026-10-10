import Link from "next/link";
import type { RankedProduct } from "@/data/products";
import { type Dictionary, getDictionary } from "@/i18n/dictionaries";
import { countryName } from "@/i18n/format";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { marketTier } from "@/lib/markets";
import { sourceLabel } from "@/lib/sources";
import { cn } from "@/lib/utils";
import { confidenceLabel } from "@/scoring/score";

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-right font-mono text-sm font-semibold tabular-nums">
        {score.toFixed(0)}
      </span>
      <div className="bg-muted h-2 w-24 overflow-hidden rounded-full" aria-hidden>
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

export function SampleDataBadge({
  className,
  t = getDictionary(DEFAULT_LOCALE).common,
}: {
  className?: string;
  t?: Dictionary["common"];
}) {
  return (
    <span
      className={cn(
        "rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400",
        className,
      )}
      title={t.sampleDataTitle}
    >
      {t.sampleData}
    </span>
  );
}

export function ProductTable({ products, locale }: { products: RankedProduct[]; locale: Locale }) {
  const { ranking: t, common } = getDictionary(locale);
  return (
    <div className="overflow-x-auto rounded-lg border">
      {/* Scroll sideways on small screens instead of squeezing every column into tall rows. */}
      <table className="w-full min-w-[60rem] text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">{t.columns.rank}</th>
            <th className="px-3 py-2 font-medium">{t.columns.product}</th>
            <th className="px-3 py-2 font-medium">{t.columns.score}</th>
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
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/products/${p.slug}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {p.title}
                  </Link>
                  {p.isSample && <SampleDataBadge t={common} />}
                </div>
              </td>
              <td className="px-3 py-3">
                <ScoreBar score={p.score} />
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
