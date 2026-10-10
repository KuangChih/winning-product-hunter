import Link from "next/link";
import type { RankingFilters } from "@/data/products";
import { MARKETS } from "@/lib/markets";

const SORT_LABELS = {
  score: "Highest score",
  newest: "Newest",
  least_crowded: "Least crowded",
} as const;

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
}: {
  filters: RankingFilters;
  includeSample: boolean;
  resultCount?: number;
}) {
  const sampleToggleHref = (on: boolean) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.market) params.set("market", filters.market);
    if (filters.minScore !== undefined) params.set("minScore", String(filters.minScore));
    if (filters.sort && filters.sort !== "score") params.set("sort", filters.sort);
    if (on) params.set("sample", "1");
    const qs = params.toString();
    return qs ? `/products?${qs}` : "/products";
  };

  return (
    <div className="mb-6 space-y-3">
      <form
        method="get"
        action="/products"
        role="search"
        aria-label="Filter products"
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="e.g. neck massager"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Market</span>
          <select name="market" defaultValue={filters.market ?? ""} className={fieldClass}>
            <option value="">All markets</option>
            {MARKETS.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Min. score</span>
          <select
            name="minScore"
            defaultValue={filters.minScore?.toString() ?? ""}
            className={fieldClass}
          >
            <option value="">Any</option>
            {[40, 50, 60, 70].map((s) => (
              <option key={s} value={s}>
                {s}+
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Sort by</span>
          <select name="sort" defaultValue={filters.sort ?? "score"} className={fieldClass}>
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {includeSample && <input type="hidden" name="sample" value="1" />}
        <button
          type="submit"
          className="bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium"
        >
          Apply
        </button>
        <Link
          href={includeSample ? "/products?sample=1" : "/products"}
          className="text-muted-foreground h-9 content-center text-sm underline-offset-4 hover:underline"
        >
          Reset
        </Link>
      </form>
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
        {resultCount !== undefined && <span>{resultCount} products ·</span>}
        <Link
          href={sampleToggleHref(!includeSample)}
          className="underline-offset-4 hover:underline"
        >
          {includeSample ? "Show real data only" : "Include sample data"}
        </Link>
      </div>
    </div>
  );
}
