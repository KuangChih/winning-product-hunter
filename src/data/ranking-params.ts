import { isTargetMarket } from "@/lib/markets";
import { SOURCE_LABELS } from "@/lib/sources";
import { SUB_SCORE_ORDER, type SubScoreName } from "@/scoring/score";
import type { RankingFilters, RankingSort, SignalFilter } from "./products";

const SORTS: RankingSort[] = ["score", "newest", "least_crowded", ...SUB_SCORE_ORDER];

/** URL parameter for a sub-score filter, e.g. `min_longevity=60` or `min_momentum=data`. */
export function signalParam(name: SubScoreName) {
  return `min_${name}`;
}

function signalFilter(value: string | undefined): SignalFilter | undefined {
  if (value === "data") return "data";
  if (!value?.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : undefined;
}

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A non-negative whole-dollar amount, or undefined for empty / invalid input. */
function priceParam(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

/** Parses ranking page search params; unknown or invalid values fall back to defaults. */
export function parseRankingParams(
  params: Params,
): Required<Pick<RankingFilters, "sort">> & RankingFilters {
  const q = first(params.q)?.trim() || undefined;
  const marketRaw = first(params.market)?.toUpperCase();
  const minScoreRaw = Number(first(params.minScore));
  const sortRaw = first(params.sort) as RankingSort | undefined;
  const source = first(params.source);
  const signals: Partial<Record<SubScoreName, SignalFilter>> = {};
  for (const name of SUB_SCORE_ORDER) {
    const rule = signalFilter(first(params[signalParam(name)]));
    if (rule !== undefined) signals[name] = rule;
  }
  return {
    q,
    market: marketRaw && isTargetMarket(marketRaw) ? marketRaw : undefined,
    minScore: Number.isFinite(minScoreRaw) && first(params.minScore) ? minScoreRaw : undefined,
    minPrice: priceParam(first(params.minPrice)),
    maxPrice: priceParam(first(params.maxPrice)),
    source: source && source in SOURCE_LABELS ? source : undefined,
    signals: Object.keys(signals).length ? signals : undefined,
    sort: sortRaw && SORTS.includes(sortRaw) ? sortRaw : "score",
  };
}

/** URL for the ranking page with these filters; defaults are left out to keep links short. */
export function rankingHref(filters: RankingFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.market) params.set("market", filters.market);
  if (filters.minScore !== undefined) params.set("minScore", String(filters.minScore));
  if (filters.minPrice !== undefined) params.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice !== undefined) params.set("maxPrice", String(filters.maxPrice));
  if (filters.source) params.set("source", filters.source);
  for (const name of SUB_SCORE_ORDER) {
    const rule = filters.signals?.[name];
    if (rule !== undefined) params.set(signalParam(name), String(rule));
  }
  if (filters.sort && filters.sort !== "score") params.set("sort", filters.sort);
  const qs = params.toString();
  return qs ? `/products?${qs}` : "/products";
}
