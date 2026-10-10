import type { RankingFilters } from "@/data/products";
import { rankingHref, signalParam } from "@/data/ranking-params";
import { getDictionary } from "@/i18n/dictionaries";
import { countryName, fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { MARKETS } from "@/lib/markets";
import { sourceLabel } from "@/lib/sources";
import { SUB_SCORE_ORDER } from "@/scoring/score";
import { FilterChips, FilterDisclosure, type FilterChip } from "./filter-disclosure";
import { fieldClass } from "./ui/field";

/** Evidence sources worth filtering by (sources we collect or plan to collect soon). */
const FILTER_SOURCES = ["meta_ads", "shopify", "cj", "google_trends", "tiktok_ads"];

/** Applied filters as removable chips, in form order. */
export function rankingFilterChips(filters: RankingFilters, locale: Locale): FilterChip[] {
  const { ranking: t, common } = getDictionary(locale);
  const chip = (name: string, value: string, without: RankingFilters): FilterChip => ({
    label: fill(common.chip, { name, value }),
    removeHref: rankingHref(without),
  });
  const chips: FilterChip[] = [];
  if (filters.q) chips.push(chip(t.search, filters.q, { ...filters, q: undefined }));
  if (filters.market) {
    chips.push(
      chip(t.market, countryName(filters.market, locale), { ...filters, market: undefined }),
    );
  }
  if (filters.minScore !== undefined) {
    chips.push(chip(t.minScore, `${filters.minScore}+`, { ...filters, minScore: undefined }));
  }
  if (filters.minPrice !== undefined) {
    chips.push(chip(t.minPrice, `US$${filters.minPrice}`, { ...filters, minPrice: undefined }));
  }
  if (filters.maxPrice !== undefined) {
    chips.push(chip(t.maxPrice, `US$${filters.maxPrice}`, { ...filters, maxPrice: undefined }));
  }
  if (filters.source) {
    chips.push(
      chip(t.source, sourceLabel(filters.source, locale), { ...filters, source: undefined }),
    );
  }
  for (const name of SUB_SCORE_ORDER) {
    const rule = filters.signals?.[name];
    if (rule === undefined) continue;
    const rest = { ...filters.signals };
    delete rest[name];
    chips.push(
      chip(t.signals[name], rule === "data" ? t.signalHasData : `${rule}+`, {
        ...filters,
        signals: Object.keys(rest).length ? rest : undefined,
      }),
    );
  }
  return chips;
}

/**
 * Search, filters and sort for the ranking page. A plain GET form, so it works without
 * JavaScript and every filtered view has a shareable URL. Search and sort stay visible; the
 * other filters fold away, and applied ones show as removable chips.
 */
export function RankingControls({
  filters,
  result,
  locale,
}: {
  filters: RankingFilters;
  /** All matching products and the positions shown on this page (from / to are 1-based). */
  result?: { total: number; from: number; to: number };
  locale: Locale;
}) {
  const { ranking: t, common } = getDictionary(locale);
  const activeSignals = SUB_SCORE_ORDER.filter((n) => filters.signals?.[n] !== undefined).length;
  const folded =
    [filters.market, filters.minScore, filters.minPrice, filters.maxPrice, filters.source].filter(
      (v) => v !== undefined,
    ).length + activeSignals;

  return (
    <div className="mb-6 space-y-3">
      <form
        method="get"
        action="/products"
        role="search"
        aria-label={t.filterLabel}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs">
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
        <button
          type="submit"
          className="bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium"
        >
          {t.apply}
        </button>
        <FilterDisclosure
          label={common.filters}
          activeLabel={common.filtersActive}
          activeCount={folded}
          applyLabel={t.apply}
        >
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
        </FilterDisclosure>
      </form>
      <FilterChips
        chips={rankingFilterChips(filters, locale)}
        clearHref={rankingHref({ sort: filters.sort })}
        labels={common}
      />
      {result !== undefined && (
        <p className="text-muted-foreground text-sm">
          {fill(t.resultCount, { n: result.total.toLocaleString("en-US") })}
          {result.total > result.to - result.from + 1 &&
            fill(t.showing, { from: result.from, to: result.to })}
        </p>
      )}
    </div>
  );
}
