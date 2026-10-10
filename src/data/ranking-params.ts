import { isTargetMarket } from "@/lib/markets";
import type { RankingFilters, RankingSort } from "./products";

const SORTS: RankingSort[] = ["score", "newest", "least_crowded"];

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Parses ranking page search params; unknown or invalid values fall back to defaults. */
export function parseRankingParams(
  params: Params,
): Required<Pick<RankingFilters, "sort">> & RankingFilters & { includeSample: boolean } {
  const q = first(params.q)?.trim() || undefined;
  const marketRaw = first(params.market)?.toUpperCase();
  const minScoreRaw = Number(first(params.minScore));
  const sortRaw = first(params.sort) as RankingSort | undefined;
  return {
    q,
    market: marketRaw && isTargetMarket(marketRaw) ? marketRaw : undefined,
    minScore: Number.isFinite(minScoreRaw) && first(params.minScore) ? minScoreRaw : undefined,
    sort: sortRaw && SORTS.includes(sortRaw) ? sortRaw : "score",
    includeSample: first(params.sample) === "1",
  };
}
