import { describe, expect, it } from "vitest";
import { applyRankingFilters, type RankedProduct, signalValue } from "./products";
import { parseRankingParams, rankingHref } from "./ranking-params";

/** A ranked product with the given sub-score values (0–1; null = no data). */
const product = (title: string, score: number, subs: Record<string, number | null>) =>
  ({
    id: title,
    slug: title,
    title,
    score,
    sources: ["meta_ads"],
    markets: ["US"],
    retailUsdCents: null,
    breakdown: {
      saturation: { ageDays: 1, penalty: 0, activeAdvertisers: 1, value: 0 },
      subScores: Object.fromEntries(
        Object.entries(subs).map(([k, value]) => [
          k,
          { value, weight: 0.15, raw: null, basis: "" },
        ]),
      ),
    },
  }) as unknown as RankedProduct;

const items = [
  product("A", 60, { longevity: 0.9, momentum: null }),
  product("B", 70, { longevity: 0.5, momentum: 0.8 }),
  product("C", 50, { longevity: null, momentum: 0.95 }),
];

describe("sub-score signals", () => {
  it("shows each signal as 0–100, or null when there is no real data", () => {
    expect(signalValue(items[0], "longevity")).toBe(90);
    expect(signalValue(items[0], "momentum")).toBeNull();
    // A sub-score missing from an older breakdown is also "no data", never zero.
    expect(signalValue(items[0], "margin")).toBeNull();
  });

  it("sorts by one signal, highest first, with products lacking it last", () => {
    const titles = (sort: "longevity" | "momentum") =>
      applyRankingFilters([...items], { sort }).map((p) => p.title);
    expect(titles("longevity")).toEqual(["A", "B", "C"]);
    expect(titles("momentum")).toEqual(["C", "B", "A"]);
  });

  it("filters on a signal having data or reaching a minimum", () => {
    const titles = (signals: Parameters<typeof applyRankingFilters>[1]["signals"]) =>
      applyRankingFilters([...items], { signals }).map((p) => p.title);
    expect(titles({ momentum: "data" })).toEqual(["B", "C"]);
    expect(titles({ longevity: 60 })).toEqual(["A"]);
    expect(titles({ longevity: "data", momentum: "data" })).toEqual(["B"]);
  });

  it("reads signal filters and sorts from the URL and writes them back", () => {
    const parsed = parseRankingParams({
      min_longevity: "60",
      min_momentum: "data",
      min_margin: "150",
      sort: "momentum",
    });
    expect(parsed.signals).toEqual({ longevity: 60, momentum: "data" });
    expect(parsed.sort).toBe("momentum");
    expect(parseRankingParams({}).signals).toBeUndefined();

    const { includeSample, ...filters } = parsed;
    expect(rankingHref(filters, includeSample)).toBe(
      "/products?min_longevity=60&min_momentum=data&sort=momentum",
    );
  });
});
