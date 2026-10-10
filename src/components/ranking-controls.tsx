import Link from "next/link";
import type { RankingFilters } from "@/data/products";
import { rankingHref, signalParam } from "@/data/ranking-params";
import { getDictionary } from "@/i18n/dictionaries";
import { countryName, fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { MARKETS } from "@/lib/markets";
import { sourceLabel } from "@/lib/sources";
import { SUB_SCORE_ORDER } from "@/scoring/score";

/** Evidence sources worth filtering by (sources we collect or plan to collect soon). */
const FILTER_SOURCES = ["meta_ads", "shopify", "cj", "google_trends", "tiktok_ads"];

const fieldClass =
  "border-input bg-background h-9 rounded-md border px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1";

/**
 * Search, filters and sort for the ranking page. A plain GET form, so it works without
 * JavaScript and every filtered view has a shareable URL.
 */
export function RankingControls({
  filters,
  includeSample,
  resultCount,
  locale,
}: {
  filters: RankingFilters;
  includeSample: boolean;
  resultCount?: number;
  locale: Locale;
}) {
  const t = getDictionary(locale).ranking;
  const activeSignals = SUB_SCORE_ORDER.filter((n) => filters.signals?.[n] !== undefined).length;

  return (
    <div className="mb-6 space-y-3">
      <form
        method="get"
        action="/products"
        role="search"
        aria-label={t.filterLabel}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t.search}</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder={t.searchPlaceholder}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t.market}</span>
          <select name="market" defaultValue={filters.market ?? ""} className={fieldClass}>
            <option value="">{t.allMarkets}</option>
            {MARKETS.map((m) => (
              <option key={m.code} value={m.code}>
                {countryName(m.code, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t.minScore}</span>
          <select
            name="minScore"
            defaultValue={filters.minScore?.toString() ?? ""}
            className={fieldClass}
          >
            <option value="">{t.any}</option>
            {[40, 50, 60, 70].map((s) => (
              <option key={s} value={s}>
                {s}+
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t.minPrice}</span>
          <input
            type="number"
            name="minPrice"
            min={0}
            step={1}
            inputMode="numeric"
            defaultValue={filters.minPrice ?? ""}
            className={`${fieldClass} w-28`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t.maxPrice}</span>
          <input
            type="number"
            name="maxPrice"
            min={0}
            step={1}
            inputMode="numeric"
            defaultValue={filters.maxPrice ?? ""}
            className={`${fieldClass} w-28`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t.source}</span>
          <select name="source" defaultValue={filters.source ?? ""} className={fieldClass}>
            <option value="">{t.anySource}</option>
            {FILTER_SOURCES.map((s) => (
              <option key={s} value={s}>
                {sourceLabel(s, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t.sortBy}</span>
          <select name="sort" defaultValue={filters.sort ?? "score"} className={fieldClass}>
            {Object.entries(t.sorts).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            {SUB_SCORE_ORDER.map((name) => (
              <option key={name} value={name}>
                {fill(t.sortBySignal, { signal: t.signals[name] })}
              </option>
            ))}
          </select>
        </label>
        {includeSample && <input type="hidden" name="sample" value="1" />}
        <button
          type="submit"
          className="bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium"
        >
          {t.apply}
        </button>
        <Link
          href={includeSample ? "/products?sample=1" : "/products"}
          className="text-muted-foreground h-9 content-center text-sm underline-offset-4 hover:underline"
        >
          {t.reset}
        </Link>
        <details className="w-full" open={activeSignals > 0}>
          <summary className="text-muted-foreground cursor-pointer text-sm">
            {activeSignals > 0
              ? fill(t.signalFiltersActive, { n: activeSignals })
              : t.signalFilters}
          </summary>
          <div className="mt-2 flex flex-wrap gap-3">
            {SUB_SCORE_ORDER.map((name) => (
              <label key={name} className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">{t.signals[name]}</span>
                <select
                  name={signalParam(name)}
                  defaultValue={filters.signals?.[name]?.toString() ?? ""}
                  className={fieldClass}
                >
                  <option value="">{t.signalAny}</option>
                  <option value="data">{t.signalHasData}</option>
                  {[40, 60, 80].map((v) => (
                    <option key={v} value={v}>
                      {v}+
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
      </form>
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
        {resultCount !== undefined && <span>{fill(t.resultCount, { n: resultCount })} ·</span>}
        <Link
          href={rankingHref(filters, !includeSample)}
          className="underline-offset-4 hover:underline"
        >
          {includeSample ? t.showRealOnly : t.includeSample}
        </Link>
      </div>
    </div>
  );
}
